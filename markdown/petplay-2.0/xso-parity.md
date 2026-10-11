# Track 6: XSOverlay parity

Reference: the AssetRipper export at `/home/ellie/git/xsoextract/AssetRipper_export_20260819_191117`.
The first survey is in [`docs/basics.md`](../../docs/basics.md) (HAVE / PARTIAL / LACK per
area, with the XSO source file names). This file is the **checklist** for working through it.
Scope is everyday usability, not every XSO feature.

Legend: `[x]` have · `[~]` partial · `[ ]` lack. **Bold** = everyday, M2/M3 blocking.

## Window / display

- [~] **Overlay registry: spawn/despawn, per-window opacity, curve, size**
- [~] **Grab / push-pull / scale gestures**, plus sensitivity settings
- [ ] **Attach to hand / head / world**
- [ ] **Pin / lock window**
- [ ] Mouse-block and auto-hide per window
- [ ] **Named layouts: save/load**
- [ ] **Window list with live previews and monitor picker**
- [ ] Individual app-window capture (not just monitors/workspace crops)
- [ ] Toolbar follows its window edge; spawn-in animation
- [ ] Capture backend choice (Windows)

## Wrist

- [~] **Wrist menu root**
- [ ] **Clock / date / session length**
- [ ] **Battery for HMD/controllers/trackers**
- [ ] Media now-playing row
- [ ] Wrist offset/rotation/scale/opacity settings, dominant hand

## Keyboard

- [~] **Layout loading + locale switching** (`--keyboard-locale`)
- [~] Sticky / toggle modifiers
- [ ] **Keyboard pin + opacity**
- [ ] Typing sounds

## Settings

- [ ] **Global settings store + surface** → [track 4](./ui-ux-basics.md)

## Notifications

- [ ] **Toast queue with an overlay slot**
- [ ] External API: XSO-compatible WebSocket/UDP so VRChat tools that already target XSO
      work with PetPlay unchanged. This one item is worth a lot.

## Input / feedback

- [~] Laser hover/click
- [ ] **Haptics on hover/click**
- [ ] **Recenter action**
- [ ] SteamVR input bindings for our actions, user-rebindable
- [ ] Tooltips

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
