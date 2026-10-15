# Linux process scheduling

PetPlay names its Linux processes `petplay` (host and child render/display
processes) and `petplay-watch` (SteamVR lifetime watcher), including source/Deno
launches, and set their first OS command-line argument to `ppvr`.
Ananicy-cpp v1.2.0 prefers argv[0] over the comm name, so the earlier comm-only
change was insufficient. This identity keeps the generic `deno` rule from
matching the running app. At startup it also restores inherited SCHED_IDLE threads to SCHED_OTHER
and attempts to restore positive niceness to 0, preserving stronger existing
boosts and intentional batch/realtime policies. Other platforms are unaffected.

This is app startup behavior, not a global priority daemon. It only touches its
own threads. On Linux, raising priority can be denied by resource/capability
limits: renaming and leaving idle policy can succeed while nice +16 remains.
That is reported as a startup warning rather than breaking the app.

For machines using ananicy-cpp, `petplay.rules` supplies a narrow admin policy:
normal scheduling, nice 0 and best-effort I/O for the `ppvr` scheduling identity.
The rule includes both compiled and dev launches and leaves other Deno apps
alone. Installing it requires explicit system administration; PetPlay never
installs rules or asks for sudo on launch. On a different machine, review and
install the file to `/etc/ananicy.d/90-petplay.rules`, then reload ananicy-cpp.
Use the machine's established privilege/review flow. On Ellie's machine this
is `sudo-gui`, described in `/home/ellie/docs/sudo.md`.

The startup code is `classes/linuxScheduling.ts`. Source child processes go
through `classes/petplayChildEntry.ts`; compiled children use the ordinary
compiled entry's dispatcher. The rule may take a daemon scan interval to apply
to a renamed process. It is ordinary fair scheduling, not a realtime guarantee.

Validate with:

```bash
deno test -A classes/linuxScheduling.test.ts classes/childModule.test.ts
```

The integration test starts a source child with inherited idle scheduling and
positive niceness and checks its process identity, idle-thread recovery and
argument forwarding. A separate compiled-entry smoke was also verified on
2026-10-13. Fresh full-app compiled/headset performance is not implied by that
smoke. No additional native helper binary or dependency is needed.

To roll back the system policy, remove only the installed
`/etc/ananicy.d/90-petplay.rules` and reload ananicy-cpp. Current priorities
remain until processes exit. Revert the app startup changes to restore the old
Deno process identity behavior. Do not grant scheduling capabilities to the
shared Deno executable; that would affect unrelated scripts.

## Ellie's machine: live verification 2026-10-13

The configured nice resource limit permits the app to restore nice 0 without
root. Applied the same startup function to the already-running host and display
child through the existing local actor REPL, without restarting either app or
SteamVR. The host has 31 normal/nice-0 threads; the child has 14 normal/nice-0
threads plus eight preserved batch/nice-16 threads. Rechecked after more than
one ananicy scan interval: this state remained unchanged. The optional system
rule was not installed. Six focused tests pass, including actual source idle
recovery and batch preservation; a compiled dispatcher smoke verifies the
process name, absence of idle threads and child argument forwarding. Targeted
type checks and lint pass. The whole-repository check still reports 17 unfiltered
errors in UI, OpenVR, timers and playtests outside this scheduling change.
A full fresh-app launch and headset performance comparison remain unverified.

## Hot-reload correction (2026-10-13)

User-reported: ananicy lowered PetPlay again after WebXR hot reload; Claude had
manually restored it before the initial healthy snapshot. Static inspection
of the matching ananicy-cpp version confirms argv[0] is its first naming source.
The repaired startup routine sets argv[0] to `ppvr` as well as comm; WebXR
executes it each time its worker module loads. Three one-time unreferenced
startup rechecks (250 ms, 1 s, 3 s) recover from a delayed priority write observed
in the repeated-worker test. A previously queued old-name classification is
the working explanation for that timing, not a traced daemon finding.

Only the original argv[0] memory allocation is changed: its size/address are
validated against /proc/self/stat and the actual bytes against /proc/self/cmdline,
then a bounded write through /proc/self/mem replaces that argument. Remaining
CLI arguments and Deno.execPath are preserved. The shorter argument creates
empty padding fields in the kernel command line; discovery already filters
those fields. No other process memory, persistent system rule, or executable
file is changed. No continuously running priority watchdog is added.

Seven tests pass, including three actual worker recreations, idle recovery,
argument/executable preservation and intentional batch preservation. A compiled
dispatch smoke also passes. Two actual live WebXR actor reloads succeeded; the
first remained free of idle threads over 30 seconds with argv[0]=ppvr. Server
discovery remained valid after the second reload. Headset smoothness still
requires user confirmation.

Final follow-up verification: after the second WebXR reload, sixteen samples
over 30 seconds retained argv[0]=ppvr, no idle threads, and twenty normal
nice-0 host threads in the final sample. No manual priority reset was used
after either reload.
