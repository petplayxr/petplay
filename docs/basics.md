# Basics — what a complete overlay app needs

Reference: XSOverlay (XSO), surveyed from the AssetRipper export at
`/home/ellie/git/xsoextract/AssetRipper_export_20260819_191117`. Status flags
are best-guess from names only: HAVE / PARTIAL / LACK.

## Window / display system — PARTIAL

- Overlay spawn/despawn registry with per-overlay opacity, width, curve,
  quality, tracked-device (`Overlay_Manager.cs`, `Unity_Overlay.cs`)
- Desktop capture backend switch (WGC vs BitBlt equivalent) + texture
  copy/scale helpers
- Grab / push-pull / scale gestures with sensitivity settings
- Attach overlay to hand / head / world / none
- Pin, lock, mouse-block, auto-hide per window
- Named layout save/load (window set + flags)
- Window list with live previews + monitor enumeration
- Toolbar follows its window edge; spawn-in animation
- Missing here: capture backend choice, pin/lock/mouse-block/auto-hide,
  named layouts, window list + previews, layout-mode grid view

## Wrist UI — PARTIAL

- Wrist root with clock/date/session-length, media row, battery row
  (`WristOverlay.cs`, `DeviceManager.cs`, `UpdateDateTime.cs`)
- Hide/show, offsets/rotation/scale, opacity, clip angle, reset position
- Dominant-hand selection, compact vs full swap
- Accent / dark-theme / adaptive-color plumbing + swappable backgrounds
- Missing here: battery source, media detection, hide/wrist-movement config,
  theming stack

## Keyboard — PARTIAL

- JSON layout loading + locale/format switching (`KeyboardLoader.cs`)
- Per-key sticky / toggle / double-tap / caps handling
- Main / nav / numpad / settings pages, modifier chips, WPM stats
- Typing sounds via soundpacks, keyboard pin, opacity
- Missing here: soundpacks, WPM/achievements tie-in, keyboard pin, opacity
  setting

## Settings model — LACK

- No global settings store yet. XSO's `XSSettings.cs` groups: keyboard,
  wrist, input (method, mouse, scroll, double-click, tooltips, keybindings),
  capture/overlay defaults (curve, scale, opacity, FPS caps, gestures,
  dampening), wrist content (time/date format, battery, media), theme,
  notifications (scale, offsets), night light (schedule), privacy
  (UUID, analytics opt-out, language, admin), URL/action openers
- Needs: one store + persistence + a settings surface (wrist or desktop),
  same shape as `spatialLayoutPersistence.ts` but for prefs

## Notifications / toasts — LACK

- Small/large popup queue with per-type icon + sound + color, test hooks
  (`NotificationHandler.cs`, `XSOMessage.cs`)
- External push API: UDP + OSC + WebSocket inbound (`ExternalMessageHandler.cs`)
- Needs: queue + overlay slot + external API; PetPlay already has the
  actor bus to hang it on

## Media / audio / haptics — PARTIAL

- Now-playing row with per-app logos, auto-detection, media theming
- Pooled SFX player (32 sources) + master-volume endpoint helpers
- Haptic pulse scaled by strength setting, hover/click durations
- Missing here: media detection, SFX player, haptics wiring

## Input — PARTIAL

- Laser raycast with hover/click, cursor visuals, touch-hold
  (`Raycaster.cs`, `LaserHandler.cs`)
- SteamVR action set (modes, recenter) + sim keybindings file
- Dual paths: touch input vs emulated mouse; input priority + block-background
- Hover/click/tooltip/setting-changed event bus; tooltips with hide setting
- Missing here: recenter action, keybinding config, input-priority policy,
  tooltips

## Misc systems — PARTIAL

- Boot order + process helpers (`Startup.cs`)
- Opt-out analytics (distinct id, version, hardware) — needs a decision
- Plugin/web-app host (bundled Discord/Twitter/Youtube equivalents)
- Night light (kelvin tint on schedule), per-camera FPS caps
- Localization (~30 locales), Steam init, Discord presence
- Crash reporting, debug console, UI utility layer (tabs, sliders, dropdowns)
- Missing here: nearly all; nearest-term useful are FPS caps and night light

## Suggested order

1. Settings store + persistence (unblocks everything with a value)
2. Grab-outline toggle follow-ups if needed (done: per-display settings entry)
3. Notifications queue (small surface, high demo value)
4. Pin/lock + named layouts (window system depth)
5. Capture backend choice + window list/previews
6. Media row, SFX, haptics, night light, FPS caps
7. Plugins, analytics decision, localization
