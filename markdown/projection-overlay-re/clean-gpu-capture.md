# Clean runtime GPU control and a mixed-generation draw

Investigation on 2026-10-13, following [the initial capture](gpu-capture.md). Same SteamVR binaries and private RenderDoc 1.46 layer. No production pacing changes, commits, or uploads.

## Final corrected projection experiment

The diagnostic now submits the **world-to-eye view matrix**, matching PetPlay. A fresh full runtime with the private capture layer produced three independently acknowledged captures. Producer `petplay.re.gpu-dmabuf.566934` retained each state behind a file gate until a newer capture completed, with `PP_RD_AFTER_FRAME` preventing reused results.

| Capture | Texture generation | Pose generation | Draw / image |
| --- | --- | --- | --- |
| **1145** | **0** | **0** | **173 / 4599** |
| **1277** | **0** | **1** | **173 / 4599** |
| **1412** | **1** | **1** | **173 / 4959** |

All three projection draws bind uniform buffer **224**, offset **3584**, size **624**. The first two submitted rotation columns match the decoded projection constants with maximum error **4.60e-7** (pose 0) or **5.01e-7** (pose 1); the other pose differs by about **0.19355**. Source-center linear blue is **0.000303268** for image 0 and **0.000606537** for image 1, corresponding to blue bytes 1 and 2. `correct-generation-classification.json` records the comparison; assertions check both pose matches, the retained generation-0 image during the mixed stage, and the changed generation-1 pixels.

Frame 1145 also establishes **projection-only final output**: after first-eye lens-distortion pass end **202**, swapchain image **154** visibly contains the broad green patch in the left eye; the right eye has the ordinary scene. Intermediate **729** contains the patch too. No ordinary diagnostic quad was present. Frame 1277 also exports a visible left-eye patch at the changed projection in `correct-mixed-output_texture_154.png`; replay contains other scene artifacts, which are not evidence of the publication mechanism. This resolves the invalid transform and output ambiguity of the earlier controls below.

The deliberately held pose-first stage confirms that a projection draw can combine **new view constants with an old immutable image**, followed by a correctly paired new image. This is a positive mixing control. It does not establish how often the compositor mixes generations during ordinary consecutive setters, or identify an atomic public publication API. Capture timing is perturbed and cannot define a portable present window.

## Initial working output control

The normal runtime showed a green ordinary overlay quad one meter ahead of the starting HMD pose. The user confirmed it was visible. A **full** runtime restart with the private capture layer preserved the working display; the user confirmed both display and square were visible.

Frame 680 caught startup before the diagnostic appeared. Frame **2422** contains producer `petplay.re.gpu-dmabuf.557572`, with indexed quad draws at events **140/240**, sampled image **3702**, and a resolved intermediate **729**. At first-eye pass end **159**, that intermediate contains **461,859** pixels within three byte values of the diagnostic RGB 64/128/1, at bounds **2238/2214–3029/2946**. This is a positive composed-image control.

Frame **4006** also contains projection producer `petplay.re.gpu-dmabuf.558495`, draw **153**, source image **9753**, and uniform buffer **224**, offset **2336**, size **624**. Its source center reads linear RGBA **0.0512695/0.21582/0.000303268/1**. The source pose rotation is recoverable from the first two columns of the reflected projection matrix.

The first-eye lens-distortion draw is **199**, pass end **201**, output image **153**. The saved output visibly contains the green control through lens distortion. Both quad and projection controls were present in this capture, so green output alone cannot establish which one contributed each patch. A strict byte comparison with the producer RGB returns zero after the final color/distortion processing; do not use exact source RGB as an output classifier. Inspect the actual output attachment: selecting image 154 in this frame selects an unused swapchain image and reads zero.

## Diagnostic transform correction

The initial projection controls supplied an eye-to-world HMD pose. That is incorrect for projection overlays: PetPlay already supplies a tracking-origin-to-eye **view** matrix (`classes/openVrProjectionOverlays.ts`, `writeEyeFromTracking`). The probe now inverts the sampled HMD rigid transform for projection geometry, while ordinary quads retain the eye-to-world convention. The initial projection-only frame 7885 did not establish a visible green patch in its resolved output; its bound-image/constant generation comparison below remains valid, but is not a visible mixed-fragment control.

## GPU identification of a mixed draw

The next producer, `petplay.re.gpu-dmabuf.560462`, uses projection geometry only. It renders distinct immutable DMA-BUF images, fences GL before import, and changes pose generation 1 by a **0.2 radian local yaw**. Generation 0 encodes blue byte 1; generation 1 encodes blue byte 2. Imported shared handles are **313533169389** and **317828136685** respectively.

A deliberately separated pose-first update is a **positive mixing control**, not a production pacing method or a measurement of race frequency. The producer publishes image/pose 0, advances pose to 1 while retaining image 0, then publishes image 1. It logs all submitted matrices.

| Capture | Draw | Bound image | Decoded texture | Decoded pose |
| --- | --- | --- | --- | --- |
| **7830** | **136** | **34016** | generation **0** | generation **0** |
| **7885** | **137** | **34016** | generation **0** | generation **1** |

Both draws bind uniform buffer **224**, offset **1712**, size **624**. The first two source rotation columns appear unchanged in `_child0`, the first reflected matrix. Comparing its float entries 0/1/4/5/8/9 against source rotation entries 0/4/1/5/2/6 yields maximum absolute error **5.13e-7** for pose 0 in frame 7830, and **4.65e-7** for pose 1 in frame 7885. The alternative pose differs by about **0.19218**. Both sampled image centers retain the blue-byte-1 signature, linear blue **0.000303268**, with alpha 1.

Thus the actual projection draw can bind a new pose with an old texture using public setters. This confirms the generation classifier at GPU draw state. It does **not** prove a race between the compositor's two reads during normal consecutive setters, quantify normal judder, or show an atomic publication boundary exposed by a public API.

## Capture freshness and state holds

The first experiment used short diagnostic holds. Later captures missed the overlay after it had already been retired. The revised producer has optional bounded file gates: `PP_GPU_CAPTURE_GATE_DIR` holds after `texture-0`, `pose-1`, and `texture-1` until the respective file exists. These are diagnostic state holds, with a 120-second timeout and ordinary cleanup on failure.

The controller initially still accepted a previous capture delivered on reconnect in the same timestamp second. Consequently the files labelled `gated-stable-a.control.txt` and `gated-mixed-control.control.txt` both reported frame 7830, while `gated-stable-b.control.txt` reported frame 7885. Classification above is based on actual saved frame contents and logged submitted matrices, **not those stage filenames**. Actual frame 7886 was captured after the overlay disappeared and is not a stable generation-1 control.

`renderdoc-control.cpp` now drains reconnect history before triggering and rejects frame numbers at or below the highest prior capture. The first drain stopped at an early `Noop` and still returned stale frames in a cube regression. The corrected drain allows reconnect history to arrive, records captures during API readiness too, and accepts `PP_RD_AFTER_FRAME` as an explicit last-frame floor. Three successive cube captures passed with distinct frames **339/528/714**. A future run must verify three distinct frame paths and diagnostic contents before releasing each gate. Do not treat the initial stage filenames as proof of acknowledgement correctness.

`renderdoc-inspect.cpp` supports optional `PP_RD_TEXTURE_IDS=153,729,...` to restrict texture exports and readbacks, avoiding unrelated large textures. Draw enumeration remains complete.

Other new probe options, all off by default:

- `PP_GPU_VISIBLE_CONTROL=1`: an opaque 8×8 patch in the 16×16 image; the 0/0 texel remains transparent for the existing producer check.
- `PP_GPU_QUAD_CONTROL=1`: ordinary absolute quad, 0.6 m wide, one meter ahead of the sampled HMD pose.
- `PP_GPU_POSE_GENERATIONS=1`: yaw-coded projection poses, logged per generation.
- `PP_GPU_POSE_TEXTURE_GAP_MS`: optional deliberate inter-setter gap after generation 0; never a pacing rule.

## Saved evidence and next check

Final evidence is in `/tmp/petplay-projection-re-20261013/`: `correct-view-runtime_frame{1145,1277,1412}.rdc`, `correct-gated.api.txt`, `correct-{stable-a,mixed-control,stable-b}.{control,actions,draw}.txt`, exported `correct-*-draw` constants/source images, `correct-projection-output*`, `correct-mixed-output*`, `correct-generation-draws.json`, and `correct-generation-classification.json`.

Initial evidence in the same directory includes: `clean-runtime_frame{680,2422,4006,7830,7885,7886}.rdc`, producer/control logs, `clean-quad2-pass*`, `clean-projection-draw*`, `clean-projection-final*`, `gated-frame7830*`, `gated-frame7885*`, and `mixed-generation-classification.json`. Frames 5286/5511/5517 belong to the short-hold attempt and must not be assumed to identify the intended stages.

Next: measure **normal consecutive publication** with generation-labelled CPU read traces. The corrected acknowledgement and stable generation-1 control passed in the final experiment above. Capture stalls change timing, so do not derive a portable millisecond window or normal race frequency from captured frame timing.

The complete runtime was restarted normally after capture, without the private capture environment or disabled watchdogs. Final server/compositor PIDs were **567862/567881**. Launcher SHA-256 still matches the original `e1f429d8517c7e68352582182472830ebbaed3da0626fe84b551529d4dc1cadb`; tracefs is off. PetPlay WebXR health reports running with no error.
