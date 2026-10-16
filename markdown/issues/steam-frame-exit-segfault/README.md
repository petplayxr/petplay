# ARM64 PetPlay exits with SIGSEGV after actor cleanup on DroidFrame

Status: open
Track: stability-performance

On 2026-10-16, the compiled ARM64 PetPlay candidate connected to genuine Frame SteamVR 2.17.10
on Quest/DroidFrame, kept its renderer running and advanced overlay uploads. The smoke harness
then sent SIGINT to the PetPlay process only. It logged ordered actor cleanup, `CLEAN` and/or
`exit! WOOF~`, but the child returned `-11` (SIGSEGV), without a forced kill.

This reproduced both before and after fixing the separate sound-alias crash. The no-VR control
exited with code 0. Frame remained running with fresh images after the latest tests. This does
not establish whether the remaining fault belongs to PetPlay lifetime handling, native libraries
or DroidFrame's substitutions. The October 7 short clean controls did not prove this fixed.

Repro: follow `docs/STEAM_FRAME_TESTING.md`, run the VR health smoke with `--hold-seconds 20`,
and inspect the return code separately from readiness and advancing uploads. `evidence.json`
records the latest candidate and JS run. Complete local logs/maps are under
`_scratch/steam-frame-2026-10-16/`. Do not call the live smoke a pass until shutdown is clean.

An instrumented 10-second repeat returned parent exit 0 but captured a native descendant fault
in `vrclient.so` at module offset `0x2584b8` (`traced-child-fault.json`). The harness initially
misclassified this as passing; it now rejects recorded native faults regardless of the parent's
exit code. The following uninstrumented 10-second health control passed with exit 0 and advancing
uploads. This remains intermittent; no-VR plus all six JS interactions also exits 0.
