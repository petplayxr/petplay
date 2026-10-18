# VRC camera layer for recording

PetPlay renders a second, transparent view of its scene from VRChat's user camera, so OBS can
stack it over VRChat's own camera output. VR keeps rendering as usual; the layer is a second
`desktopView` instance (`camera: "vrc"`) that draws the same scene IR from another pose.

## Pieces

- `cameraOrigin` (`petplay/VRCOriginCamera.ts`) receives `/usercamera/Pose` and `/usercamera/Zoom`
  over OSCQuery and forwards both to `webxr`.
- `webxr` holds a `VrcCameraTracker` (`classes/vrcCameraCalibration.ts`): the latest world pose and
  the world→tracking calibration. Views registered with `camera: "vrc"` get the calibrated pose
  (`vrcCamera`) and a transparent background with every frame.
- `desktopView` in VRC mode opens a `FLAG_WINDOW_TRANSPARENT` window, builds its view/projection
  from that pose, draws no FPS counter, and stays empty until a calibration exists.

## Calibration

The OSC pose is in VRChat world space; the scene is in OpenVR tracking space. Grab-to-calibrate
fits `p_track = s·R(yaw)·p_world + t` plus the camera's grip offset in the holding hand, using
positions only (VRChat's smoothing and auto-level change the reported rotation, not where the
camera is). Samples are taken only while the hand is nearly still, because OSC lags the controller.
RANSAC plus worst-sample trimming drop samples from a camera that was let go mid-capture.

**Locomotion invalidates it.** Joystick moves, snap turns and teleports change the mapping; redo
the calibration afterwards.

## Use

```bash
deno task client camera --width=1920 --height=1080   # match VRChat's stream resolution
deno task client camera calibrate                    # hold the VRChat camera, turn it slowly (10 s)
deno task client camera status
deno task client camera --stop
```

In OBS (Linux): add a PipeWire window capture of VRChat for the camera feed, then a PipeWire window
capture of "PetPlay VRC Camera" above it. KDE keeps the window's alpha.

## Known gaps

- VRChat's `Zoom` is taken as the vertical FOV; `--fov=<deg>` is the fallback until VRChat
  reports it. Not yet checked against a real VRChat frame.
- Semi-transparent panels come out more transparent than in VR: raylib's `BLEND_ALPHA` blends
  the alpha channel the same way it blends colour, so translucent alpha ends up squared.
- No in-VR trigger for calibration yet (a wrist-menu button would fit).
- Spout (Windows) output isn't implemented; on Windows the same transparent window can be captured.
