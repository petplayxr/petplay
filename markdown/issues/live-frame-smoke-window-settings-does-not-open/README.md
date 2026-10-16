# Live Frame smoke does not open the window settings

Status: open
Track: agentic-playtesting

On 2026-10-16, the compiled ARM64 `--vr --playtest smoke` run on Quest/DroidFrame passed showing,
moving and resizing windows, typing `h i`, and changing a setting. The `window-settings` step
failed: “the toolbar's settings button opens the window's settings”. The corresponding local
desktop smoke passes. The failed live step ran for 4091 ms at a median frame interval of 49.3 ms.

The cause is unclassified: investigate controller delivery, targeting and timing before treating
it as a confirmed physical-headset UI defect. Synthetic hands override live IVRInput through the
production controller bridge; they do not exercise physical bindings. Repeat the live run using
`docs/STEAM_FRAME_TESTING.md`. `evidence.json` contains the step outcomes and candidate identity.
