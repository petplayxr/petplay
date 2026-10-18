# VRC camera: wrist-menu setup page

Goal: from inside VR, with no terminal, go from "VRChat camera in hand" to "OBS shows PetPlay
composited over VRChat's camera". Today this takes `deno task client camera …` on the desktop.
`vrc-camera-layer.md` lists the missing in-VR trigger under "Known gaps".

## Where it lives

A **CAMERA** page under Settings, beside WRIST, MONITORS and LAYOUTS. The home screen's 4×4 grid
is full, and camera setup is occasional, so a page is the right weight. Settings' sub-page row
gets a fourth pill. If four don't fit the 448-wide row, the labels shorten (`SCREENS` for
`MONITORS`).

The home screen gets one small change: while the recording layer is running, the footer status
reads `Camera layer on · synced` (or `· not synced`). The layer is otherwise invisible from
inside VR, and forgetting it is running means a stray capture window.

## The page

```
┌──────────────────────────────────────────┐
│ [BACK]  [ VRC CAMERA                ]    │
│                                          │
│ VRChat camera   seen 1 s ago · 45°   ●   │  readout
│ Calibrate              0.6 cm · good [ON]│  the switch, live accuracy
│   right hand · left 21 cm · 84 samples   │  detail line while ON
│ Recording layer      1920×1080  [START]  │
│                                          │
│ Move the camera around and turn it.      │  hint line
│ Switch off when the ball sits on it.     │
└──────────────────────────────────────────┘
```

1. **VRChat camera** (readout). `not seen` until a pose arrives over OSC, then `seen <n> s ago`
   plus the FOV from `/usercamera/Zoom`. A dot shows the pose is live (moved within ~2 s).
   Without this, a failed calibration gives no hint whether OSC is reaching PetPlay at all.
2. **Calibrate**: an ON/OFF switch, not a timed capture.
   - **ON** clears the samples and starts collecting. The row's value is the live accuracy:
     `move the camera…` until the first fit, then `0.6 cm · good` (under 1 cm), `1.4 cm · fair`
     (under 2 cm) or `3.1 cm · rough`. It improves as you move and turn the camera.
   - The detail line underneath shows the **detected hand**: the hand whose movement matches
     the camera's better, the other hand's fit error, and the sample count. For example,
     `right hand · left 21 cm · 84 samples`. A small gap between the two means the hands moved
     together and the detection is weak; the line then says `move only the camera hand`.
   - A **green ball** sits where the current calibration predicts the camera to be. It is drawn
     in VR only, never in the recording layer. When the ball sits on VRChat's camera model and
     stays there as you move, the calibration is good. OSC lags the controller, so the ball
     trails while moving; judge it when still.
   - **OFF** keeps the last fit, and the camera can be let go. The ball remains visible while
     the recording layer is running; otherwise it hides. Samples stop
     before you let go, which is the reason it's a switch: nothing has to guess when the camera
     was released. Switching off with no fit yet keeps the previous calibration, if any.
   - Long-pressing the row (or a CLEAR pill beside it while OFF) drops the calibration.
3. **Recording layer**: START/STOP for the transparent window (`STARTVRCCAMERAVIEW` /
   `STOPVRCCAMERAVIEW` on `main`), with a resolution pill that cycles 1920×1080 → 1280×720 →
   2560×1440. It must match VRChat's stream resolution so OBS can lay them 1:1, and the choice
   persists as a setting (`vrcCameraResolution`). Usable before or after calibrating; the
   window stays empty until a calibration exists.
4. **Hint line** (dim text), picked by state:

   | state | hint |
   | --- | --- |
   | no pose yet | Open VRChat's camera: Action Menu → Tools → Camera, then switch it to Stream. |
   | not calibrated | Grab the camera and switch Calibrate on. |
   | calibrating, no fit yet | Move the camera around and turn it through different angles. |
   | calibrating, fit | Switch off when the green ball sits on the camera. |
   | calibrated, layer off | Start the recording layer. |
   | calibrated, layer on | In OBS, capture "PetPlay VRC Camera" above VRChat's camera. |

The flow in VR: open VRChat's camera and hold it, open Settings → CAMERA, switch Calibrate on,
move and turn the camera until the accuracy reads good and the ball sits on the camera, switch
it off, let go. Then START the layer, if it isn't already running.

## Calibration engine changes

- **Open-ended capture.** `VrcCameraTracker` gets `beginLiveCalibration()` and
  `endLiveCalibration()` alongside the timed `startCalibration` (the CLI and `vrlab` keep that).
  While live, samples accumulate under the existing stillness and novelty gates, up to a cap of
  ~300; past it, the sample closest to another in pose is dropped, so coverage keeps growing.
- **Solve off the render thread.** One solve costs **60–110 ms** (20–400 samples, measured
  2026-10-18), i.e. 5–8 frames at 75 Hz. The live solver therefore runs in its own Deno Worker:
  the tracker posts the sample set when it has grown (at most ~2×/s) and adopts each result as
  it arrives. A solve still running when new samples come waits for that one to finish.
- **Both hands' fits.** `solveVrcCameraCalibration` already fits both hands and keeps the
  lower-error one; it returns the other hand's error too, for the detail line and the
  weak-detection warning.
- **The ball** is `applyVrcCameraCalibration(fit, latestWorldPose)`, a small green sphere in the
  scene. It is tagged so the `camera: "vrc"` view skips it (it would sit on that camera's lens).

## Plumbing

- The wrist menu renders in the webxr worker, where the `VrcCameraTracker` lives. Its status goes
  to a small `vrcCameraStore` (`useVrcCameraStatus()`, the same shape as `batteryStore` and
  `mediaStore`). `webxr` publishes to it on pose arrival (throttled), on each new fit, and on
  switch changes. No polling over the bus.
- Layer status is `main`'s (`VRCCAMERAVIEWSTATUS`). The page asks on open and after START/STOP.
  The desktop-control child reaches actors through the REPL, as `requestDesktopActor` already
  does for the wrist state.
- `STARTVRCCAMERAVIEW` reads the resolution from settings, so the wrist and
  `client camera --width/--height` agree.

## Testing (synthetic lab)

`vrlab` can drive this end to end, which is the point of building it:

- The synthetic right hand holds the VRChat camera and points at the left-wrist panel:
  Settings → CAMERA → Calibrate ON, sweep, check that the ball lands on the camera in
  `vrlab eye`, Calibrate OFF, START. A third hand would make this easier; until then the sweep
  pauses while the right hand presses.
- `vrlab:camera-check` grows a `--via-menu` mode that does its calibration and START through the
  page instead of actor messages, then runs the same OBS assertions.
- Unit tests: live accumulation with the sample cap, both-hand fits (detection margin), and the
  worker round trip.

## Implementation and validation

Implemented in the wrist menu under Settings → CAMERA. The live worker fits both hands,
shows RMS error in centimetres and the detected hand, and keeps its latest fit when the switch
is turned off. CLEAR removes it. Calibration is not persisted; recording-layer resolution is.
Resolution can be changed while the recording layer is stopped. Desktop-control previews show
an availability hint; these controls currently live in the VR scene worker.

Live calibration now retains the best achieved RMS error: worse or null solves do not replace
it. The first fit needs 24 consistent samples. Once a good fit exists, unrelated hand movement
pauses sampling while keeping the mapped camera and ball intact. Re-grabs and left/right
handoffs are detected from a consistent camera offset in the moving controller's frame;
each grab starts a fresh sample segment but retains the world mapping, best error and total
accepted-sample count. The free hand no longer vetoes sampling after the holder is known.
New fits must also agree with the prior good mapping at its camera positions, so a spurious
low-error solve from an unrelated movement cannot move the ball away.

The green ball is a non-interactive scene mesh. Its extraction is tagged and filtered from
recording views before wire encoding, while headset/preview extraction retains it.

`deno task playtest camera` exercises the pointer path without SteamVR: opens Settings → CAMERA,
feeds camera OSC paired with synthetic controller poses, checks hand choice and sub-millimetre
alignment, checks the ball and recording exclusion, freezes and clears calibration, and
starts/stops the recording layer using the saved resolution. Unit tests cover both hands,
sample replacement past the cap, obsolete worker results/errors and the worker round trip.
Use an isolated settings/layout path for manual runs. Agent-generated captures belong in
`_scratch/`.

The real VRChat/OBS check in `vrlab:camera-check` still uses the timed calibration path; menu
interaction and locomotion in VRChat have not been verified by the new headless test.

## Session assumptions

The normal VRChat camera mode is expected to follow the playspace. Do not automatically clear
calibration or ask the user to resync when moving. The current world→tracking fit remains fixed;
behaviour through VRChat locomotion still needs a real-session check. Switching camera modes,
closing the camera or starting another VRChat session may require recalibration.

Calibration is not persisted across PetPlay restarts. The recording layer starts only when
START is pressed, and remains independent of the calibration switch.
