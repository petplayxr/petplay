# Keys in front of a selected window's toolbar ignore presses

Status: fixed 2026-10-12 (`classes/environment/keyboard/keyboard.tsx`)
Track: agentic playtesting (found by the first `deno task playtest smoke` run)

## What happens

Grab a window (which selects it and shows its context toolbar), then point at the keyboard hinged
under it and pull the trigger on a middle-row key such as `h`: nothing is typed and the key does not
light. The laser ends a few centimetres behind the key.

## Why

The toolbar hangs below the window's bottom edge, so with the default layout it passes through the
hinged keyboard. Toolbars use `pointerEventsOrder: 20` and the keyboard used `2`. pmndrs ranks
targets by order before distance, so the toolbar behind the keys won every ray that crossed it.

## Fix

The keyboard now uses order 20 as well: level with toolbars, the nearer surface wins, and both still
beat the display ray proxies at 1. The `type` and `window-settings` steps of
`tests/playtest/smoke.ts` cover both sides: keys in front of the toolbar type, and the toolbar's
settings button below the keyboard still opens the window's settings.
