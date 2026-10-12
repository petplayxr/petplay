# Track 4: The most basic UI/UX

None of this is novel. It's the stuff whose absence makes the app feel like a dev build.

## Settings

- **One settings store.** Typed schema, defaults, persisted to
  `$XDG_CONFIG_HOME/petplay/settings.json`, change events on the actor bus. Same shape as
  `spatialLayoutPersistence.ts`, but for preferences. Today values are spread across CLI flags,
  `.env` and per-feature files (`grabboxOutlineMode.ts`, `controllerLaserMode.ts`,
  `windowLayerMode.ts`, ...).
- **A settings surface**, reachable from the wrist menu, with tabs (general, displays, input,
  keyboard, wrist, startup). Built on the existing uikit UI (`classes/environment/ui`).
- Migrate flags → settings where a user would ever want to change them (keyboard locale, laser
  mode, outline mode, capture FPS, start-with-SteamVR).

**Progress (2026-10-11):** `classes/settings.ts` is the store (grab-box outline, laser beam,
keyboard locale; persisted, unknown keys kept). The `webxr` actor loads it on init and answers
`GETSETTINGS` / `SETSETTING`. The wrist settings tile opens a Settings page with toggles and the
Monitors list. The laser toggle hides the beam only: turning the ray pointer off too would leave no
way to point at the page and undo it. `keyboardLocale` picks the keyboard's key legends: the keyboard's
own settings have a "Key legends" row (Auto, or one locale), and Auto goes back to the launch
choice (`--keyboard-locale`, env, host layout). Scripted check: `utils/playtest.ts`.

## First run

- Explain the portal dialog ("choose **Full Workspace**") *before* it appears.
- A short in-VR intro covering grab, resize, the wrist menu and the keyboard. Skippable, and
  replayable from settings.
- Sensible default placement for the first display, relative to the HMD rather than the origin.

## Base environment

- Remove the stray floating circle: [issue](../issues/floating-circle-in-base-environment/README.md).
- Audit everything else drawn in the scene that a user would read as a bug: debug markers,
  placeholder geometry, axis gizmos left visible behind a flag.

## Feedback & affordances

- Hover/press states on every interactive element, plus haptics on hover/click (parity item).
- Tooltips on toolbar icons.
- Visible status when something is degraded: capture lost, SteamVR detached, a repair in progress.
  Today this is only visible through `deno task status`.
- Notifications/toasts (parity item) double as the channel for the above.

## Done when

A first-time user goes from launch → a placed, typed-into desktop → a changed setting with no
external instructions, verified in a recorded playtest.
