# Wrist button clicks nudge the menu and mark it as moved

Status: fixed 2026-10-12 (`classes/environment/wristMenu/logic.tsx`)
Track: ui-ux-basics (found by `tests/playtest/wrist.ts`)

## What happens

Every trigger click on a wrist menu button also reaches the panel's grab handle as a grab that
barely moves. The handle applied it and saved the end pose as `wristMenuOffset`. So:

- In the headset, hand jitter during each press moved the menu a little, and the drift added up
  over a session.
- After the first click the Wrist menu page read "Position: moved" with RESET enabled, though
  nothing had been moved. Every playtest run's saved settings had a near-zero offset.

## Fix

The grab only moves the panel once it passes a slop (1 cm or about 3°). Below that, a press
leaves the panel and the setting alone. The `settings-toggles` step of `deno task playtest wrist`
checks clicks leave `wristMenuOffset` unset (it fails without the fix), and `grab-moves-menu`
checks a 6 cm drag still moves the menu and saves the offset.
