#!/bin/bash
set -euo pipefail
# Run from repository root. Usage: bank-switch-probe.sh <output-prefix>
# Build-specific sites; see ../README.md. Only creates transparent, isolated test overlays.
out=${1:?output prefix required}
T=/sys/kernel/tracing
G=pp_banks_$$
bin=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrcompositor
if [[ $(cat "$T/tracing_on") != 0 ]]; then
 echo 'A trace is already running; leaving it untouched.' >&2
 exit 1
fi
created=()
cleanup() {
 echo 0 > "$T/tracing_on"
 if [[ -e "$T/events/$G/enable" ]]; then echo 0 > "$T/events/$G/enable"; fi
 for n in "${created[@]}"; do echo "-:$G/$n" >> "$T/uprobe_events"; done
}
trap cleanup EXIT
echo "p:$G/visibility $bin:0x239130 index=%r13:u32 flags=+0x5a1d(%dx):u8 kind=+0x55f0(%dx):u32" >> "$T/uprobe_events"
created+=(visibility)
echo "p:$G/frame $bin:0x238c10" >> "$T/uprobe_events"
created+=(frame)
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
deno run -A --no-check markdown/projection-overlay-re/tools/overlay-banks.ts > "$out.pixels.txt" 2>&1
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out.trace"
