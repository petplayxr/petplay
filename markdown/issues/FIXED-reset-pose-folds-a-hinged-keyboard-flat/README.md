# Reset pose folds a hinged keyboard flat against its window

Status: fixed 2026-10-12 (`classes/environment/spatialGraph.ts`)
Track: agentic playtesting (found by the `toolbar-reset` step of `tests/playtest/keyboard.ts`)

## What happens

Select the keyboard hinged under a window and press Reset pose (the refresh button) on its toolbar.
The keyboard swings to 0°, hanging straight down in the window's plane, instead of leaning back out
at the -55° it docks at. Reset is the button you reach for after knocking the keyboard about, and it
left it in a position nobody types on.

## Why

`resetSpatialNodeTransform` set every hinge to angle 0. That is right for a display docked to a
window's side (its slot rests at 0) but not for the keyboard, whose bottom slot rests at -55°.

## Fix

A hinge now resets to its slot's resting angle for that kind of node (`attachments[kind].angle`).
A unit test in `spatialGraph.test.ts` covers the keyboard, and the playtest step bends the hinge,
presses Reset pose and expects the resting angle back.
