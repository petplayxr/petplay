#!/bin/bash
# Compare timing-ring publication to compositor GPU-finished marker; build-specific.
# usage: timing-publication.sh <output.trace> [seconds]
set -euo pipefail
out=${1:?output trace required}
secs=${2:-3}
T=/sys/kernel/tracing
C=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrcompositor
G=pp_import_$$
[[ $(cat "$T/tracing_on") == 0 ]]
created=()
cleanup(){ echo 0 > "$T/tracing_on"; if [[ -e "$T/events/$G/enable" ]]; then echo 0 > "$T/events/$G/enable"; fi; for n in "${created[@]}"; do echo "-:$G/$n" >> "$T/uprobe_events"; done; }
trap cleanup EXIT
add(){ echo "p:$G/$1 $C:$2 $3" >> "$T/uprobe_events"; created+=("$1"); }
add timing_advance 0x2835e5 'slot=%r13:u32'
add timing_advance_alt 0x27fce6 'slot=%ax:u32'
add gpu_finished 0x18fb21 ''
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
sleep "$secs"
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out"
