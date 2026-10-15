# Consecutive setters, WaitFrameSync, and VRChat

Measurements taken in the 2026-10-14 session, recorded durably on 2026-10-15. Same build-specific addresses as the README. These are **instrumented compositor CPU selections**, not GPU readbacks or uninstrumented judder rates. Public APIs publish the diagnostic; private uprobes observe the consumer.

## Measurement

`tools/generation-read-probe.sh` runs the isolated transparent `dmabuf-gpu-probe.cpp` publisher. Each image is a fresh immutable DMA-BUF, GPU-fenced before import, with its own logged shared handle. `PP_GPU_UNIQUE_POSES=1` assigns each generation a distinct matrix. There is no logging, rendering, trace-marker syscall, or deliberate sleep between the ordinary pose/texture setters. Markers bracket the entire setter pair.

The probe records all 12 source matrix floats at the compositor's shared pose read, and the selected shared handle at the later texture read. `tools/generation-read-summary.py` matches those values to producer generations, pairs reads within a scenegraph update, and rejects traces whose entry counts indicate loss. Pose classification tolerance is 2e-7; observed errors in mismatch examples were below 5e-9. All accepted runs below had zero unclassified reads.

## Results

Each short run published 256 images. Unsynchronized runs used a 7 ms diagnostic inter-iteration interval to exercise changing phase; this is not a proposed production interval. Synchronized runs rendered and fenced the image **before** waiting, then published immediately after successful `WaitFrameSync`.

| Workload | Publication | Mixed / classified selections | Entire setter pair between reads |
| --- | --- | --- | --- |
| Before VRChat launch | unsynchronized, pose first | 2 / 155 | 2 |
| Before VRChat launch | unsynchronized, texture first | 6 / 153 | 6 |
| Before VRChat launch | immediate after FrameSync, pose first | 0 / 255 | 0 |
| Before VRChat launch | immediate after FrameSync, texture first | 0 / 255 | 0 |
| VRChat initial/home world | unsynchronized, pose first | 7 / 165 | 4 |
| VRChat initial/home world | unsynchronized, texture first | 5 / 160 | 1 |
| VRChat initial/home world | immediate after FrameSync, pose first | 0 / 255 | 0 |
| VRChat initial/home world | immediate after FrameSync, texture first | 0 / 255 | 0 |

The user confirmed that VRChat's home world was loaded and working. Public compositor queries in the synchronized VRChat runs identified scene PID **577653**, matching `VRChat.exe`. Beginning/end timing snapshots in the pose-first run reported scene GPU times **6.49/9.53 ms**, compositor GPU times **0.53/0.57 ms**, and client intervals **7.18/17.57 ms**. These are context snapshots, not workload percentiles or a crowded-world benchmark.

One unsynchronized crossing before VRChat:

```text
55371.296513 compositor reads pose generation 94
55371.296572 producer starts setter pair for generation 95
55371.296589 producer finishes both setters
55371.296630 compositor selects texture generation 95
```

Both setters completed in **17 microseconds**, entirely inside the compositor's **117 microsecond** read gap. Reversing the setters cannot prevent this mechanism. Fast consecutive API calls do not make the compositor's separate snapshots atomic.

## Late-worker control

With VRChat in its home world, a 768-image control deliberately delayed publication after a successful wait by `(generation * 421) % 20000` microseconds. No delay was inserted between the two setters. This models late/descheduled work; it is not a normal workload frequency estimate or a recommended delay.

Result: **5 mixed selections / 1111 classified frame pairs**; three entire setter pairs fell between the reads. In one:

```text
55789.356306 FrameSync wait completes
55789.367887 compositor reads pose generation 264
55789.367939 producer starts pair for generation 265
55789.367962 producer finishes both setters
55789.367965 compositor selects texture generation 265
```

Thus a successful wait is useful for phase alignment but does not reserve a future publication interval. Immediate-after-wait results support a candidate, not an all-workload guarantee. Do not turn the observed ~11 ms late-worker crossings into a new fixed threshold.

## Failed captures and recovery

The first 768-image delayed trace lost entries (**242294 retained / 266126 written**) and was rejected by the analyzer. A retry overlapped VRChat startup and stopped at generation **272** with a one-second pre-publication FrameSync timeout; it is not a steady-state baseline. The runner was corrected to save traces on publisher failure. The later complete VRChat delayed run had **245213 retained / 245213 written** entries.

For larger runs, `PP_TRACE_BUFFER_KB=16384` temporarily doubled the per-CPU trace buffer; the runner restores its previous **8195 KiB** value on exit and disables/removes its own probes. No SteamVR restart, RenderDoc injection, production pacing change, commit, or upload was made in this measurement round. VRChat was left running after the test.

Raw captures and JSON summaries were saved under `/tmp/petplay-projection-re-20261013/` with prefixes `natural-{pose,texture}-first`, `sync-{pose,texture}-first`, `vrchat-{pose,texture}-first`, `vrchat-sync-{pose,texture}-first`, and `vrchat-sync-delayed`. **That scratch directory was no longer present when checked on 2026-10-15, and tracefs permissions had reset.** The numerical results above are preserved from the successful tool outputs in the investigation chat; the raw traces cannot currently be reanalyzed. Preserve future accepted captures outside `/tmp`.

## Timeout semantics and direction

Valve's [public OpenVR header](https://github.com/ValveSoftware/openvr/blob/master/headers/openvr.h) documents `WaitFrameSync` as a runtime-frame wait and explicitly warns that signals can be dropped in non-async mode due to scene performance. The parameter is an integer millisecond timeout. A timeout is not a measurement of overlay compute cost. Extra timeout headroom can accommodate rounding or scheduling/runtime jitter, but does not establish a pose/texture coherence guarantee.

Candidate direction: prepare immutable images and matching views ahead of publication; wait on the runtime event; keep publication short; handle timeout separately from render cost. Still unresolved: detecting a wakeup that has become too late through public APIs, coherent two-eye publication, and behavior in heavier VRChat worlds. Repeat mixed-generation observation with those conditions before claiming a portable presenter.
