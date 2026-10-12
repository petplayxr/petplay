# Track 6: XSOverlay parity

Reference: the AssetRipper export at
`/home/ellie/git/xsoextract/AssetRipper_export_20260819_191117`. The first survey is in
[`docs/basics.md`](../../docs/basics.md) (HAVE / PARTIAL / LACK per area, with the XSO source file
names). This file is the **checklist** for working through it. Scope is everyday usability, not
every XSO feature.

Legend: `[x]` have · `[~]` partial · `[ ]` lack. **Bold** = everyday, M2/M3 blocking.

The "not yet in a headset" items below are what `utils/headsetCheck.ts` walks through in one
sitting (see [agentic-playtesting](agentic-playtesting.md)).

## Window / display

- [~] **Overlay registry: spawn/despawn, per-window opacity, curve, size**. Opacity: "Opacity"
  pills (100/75/50/25%) in a window's settings, persisted per node, sent to the overlay host as
  `SetOverlayAlpha`; verified in `--novr` (uikit fades, layout saves it), not yet on real overlays
  Curve: "Curve" pills (Flat/10/20/30%, OpenVR's fraction of a cylinder) in a display's settings,
  persisted, sent as `SetOverlayCurvature`; the ray proxy bends to the same cylinder
  (`displayInstance/curvedSurface.ts`) so clicks land on the curved pixels. The grab-box chrome
  stays flat. Assumes OpenVR keeps the centre column on the transform with the edges toward the
  viewer; check in a headset
- [~] **Grab / push-pull / scale gestures**, plus sensitivity settings
- [~] **Attach to hand / head / world**: "Anchored to" pills in a window's settings (World, Head,
  Left hand, Right hand) move its whole hierarchy to that space without a jump, persisted per node;
  recenter and snapping skip attached windows. Verified in `--novr` by moving the synthetic hands
  and the emulated headset; the overlays following in a headset is not yet checked
- [~] **Pin / lock window**: per-node `locked` (toolbar Lock action) freezes grabs, persisted;
  verified in `--novr` through the UI (toolbar click toggles it; a locked display doesn't move under
  a grab, an unlocked one does)
- [~] Mouse-block and auto-hide per window. Mouse-block: "Laser drives mouse" On/Off in a
  display's settings (per-node `mouseBlocked`, persisted). The laser still lands on the window
  and grabs it, but sends no moves, clicks or stick scroll. Toggled through the UI in `--novr`;
  the desktop cursor staying put needs a headset check. Auto-hide: "Hide when looking away"
  On/Off (per-node `autoHide`). Like XSO's vision clipping, the window fades out over 0.2 s once
  the head turns 60° from where it faces, comes back under 55°, and takes no rays while hidden
  (`displayInstance/autoHide.ts`). Fade factor checked in `--novr` by turning the emulated head;
  the overlay fading needs a headset check
- [~] **Named layouts: save/load**: three slots on the wrist (Settings → Saved layouts), files in
  `layouts/slot-N.json` beside the live layout, each showing its display count and when it was
  saved; playtested in `--novr`. Not named yet
- [ ] **Window list with live previews and monitor picker**
- [ ] Individual app-window capture (not just monitors/workspace crops)
- [x] Toolbar follows its window edge; spawn-in animation. It hangs 15 mm below the bottom edge
  at a constant world size however far the window is scaled, grows downward when settings
  open, and pops in over 150 ms.
- [ ] Capture backend choice (Windows)

## Wrist

- [~] **Wrist menu root**
- [x] **Clock / date** (session length dropped on purpose, see `wristOverlay.tsx`)
- [~] **Battery for HMD/controllers/trackers**: wrist tile shows L/R controller and HMD from OpenVR
  (30 s poll), low-battery toast under 15%; verified in `--novr` with fake readings, not yet on
  hardware. No trackers
- [~] **Media now-playing row**: MPRIS through `playerctl --follow` (`mediaStore.ts`). While a
  player runs, the top-right tile becomes MEDIA (previous, play/pause, next, sent to that player)
  and the bottom row shows "Artist · Title" cut to fit. Checked in `--novr` against a fake MPRIS
  player; not yet in the headset or against a real player.
- [~] **Wrist offset/rotation/scale/opacity settings, dominant hand**: Settings → Wrist menu
  picks the hand (the mount is mirrored on the left grip; the other controller gets the ray), the
  size (75–150%) and the opacity (100/75/50%; the depth occluder is dropped below 100% so the
  controller shows through). Grabbing the panel with the other hand moves and turns it, and
  letting go saves where it is (mirrored when switching hands); RESET puts it back. Verified in
  `--novr`, not yet in the headset

## Keyboard

- [x] **Layout loading + locale switching** (`--keyboard-locale`, or "Key legends" in the
  keyboard's settings, saved as `keyboardLocale`)
- [~] Sticky / toggle modifiers
- [~] **Keyboard pin + opacity**: pin is the toolbar Lock; opacity uses the same per-node pills as
  windows (the depth occluder is dropped below 100% so the desktop shows through)
- [x] Typing sounds: spatial key clicks through the native raylib audio context (they already
  existed), with an On/Off `typingSounds` setting in the keyboard's own settings panel. The
  toggle is checked in `--novr`; whether the clicks sound right needs a headset

## Settings

- [~] **Global settings store + surface** → [track 4](./ui-ux-basics.md): store, actor messages and
  a wrist settings page landed 2026-10-11; tabs and more keys still to come

## Notifications

- [x] **Toast queue with an overlay slot**: head-locked stack of up to 3 (`toastStore.ts`,
      `toastOverlay.tsx`); used for layout slots and capture lost/reconnected. Long titles and
      content word-wrap to the card (`ui/wrapText.ts`)
- [~] External API: XSO-compatible WebSocket/UDP so VRChat tools that already target XSO work with
  PetPlay unchanged. `xsoNotificationReceiver.ts`: legacy UDP 42069 and WebSocket 42070
  `SendNotification`, verified with an external sender in `--novr`. Notifications only; no icons
  yet, and none of the API's other commands
- [x] **Desktop notifications mirrored as toasts** (Linux): `desktopNotifications.ts` watches
  `Notify` calls with `busctl --user monitor --json`, so the desktop daemon keeps its own popup.
  Markup is stripped, critical urgency takes the warning tone, updates replace their toast. Off
  with Settings → Desktop notifications on the wrist. Verified in `--novr` with a `gdbus` sender

## Input / feedback

- [~] Laser hover/click: cursor dot at the hit point (grey-square bug fixed)
- [~] **Haptics on hover/click**: OpenVR vibration action, pulses on wrist/toolbar hover and click,
  "Vibration" setting; pulse routing verified in `--novr` (no sink there), not yet felt on hardware
- [~] **Recenter action**: wrist tile moves the whole layout (yaw only) in front of the head;
  verified in `--novr`, not yet in a headset
- [ ] SteamVR input bindings for our actions, user-rebindable
- [x] Tooltips: icon-only controls name themselves while hovered, in a place that already holds
  text. Wrist tiles and media buttons use the footer (in place of the status line), and toolbar
  actions use the card's title pill. Disabled controls say why ("Recenter (show windows
  first)"). Checked in `--novr`

## Misc

- [ ] FPS caps (per capture)
- [ ] Night light / tint
- [ ] Localization
- [ ] Plugins / web-app host
- [ ] Crash reporting (decision)

## Already ahead of XSO

Worth keeping visible so parity work doesn't flatten them: the shared WebXR/R3F scene, spatial
attachments (`docs/SPATIAL_ATTACHMENTS.md`), desktop preview of the exact headset view, the agent
REPL, Linux-native capture/input, and the Steam Frame path.
