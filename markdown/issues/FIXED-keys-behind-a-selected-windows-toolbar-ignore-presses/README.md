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
beat the display ray proxies at 1. The `type` step of `tests/playtest/smoke.ts` covers the keys.

That left the other half broken: with the nearer surface winning, the window's toolbar buttons sat
behind the keyboard's bottom rows and could not be pressed. The smoke step that was meant to cover
them clicked the keyboard's own toolbar instead (the toolbar lookup also searched child nodes), so
it passed anyway. Once the lookup was scoped to the window, smoke failed.

Second fix (2026-10-12, `scene.tsx`, `spatialContextToolbar.tsx`): when a keyboard is hinged to a
window's bottom slot, the window's toolbar goes above the window. Its settings open as a separate
card beside the window's top-right corner: growing them up from the raised toolbar put the last
rows near 3 m, and hanging them over the window reached down behind the keyboard. The smoke,
window-settings and lifecycle playtests press the toolbar and every setting through this path.
