#!/bin/bash
# Probe producer copy inputs and its final Vulkan submit; build-specific addresses.
# usage: copy-submit-probe.sh <output.trace> [seconds]
set -euo pipefail
out=${1:?output trace required}
secs=${2:-3}
T=/sys/kernel/tracing
V=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrclient.so
G=pp_copy_$$
[[ $(cat "$T/tracing_on") == 0 ]]
created=()
cleanup(){ echo 0 > "$T/tracing_on"; if [[ -e "$T/events/$G/enable" ]]; then echo 0 > "$T/events/$G/enable"; fi; for n in "${created[@]}"; do echo "-:$G/$n" >> "$T/uprobe_events"; done; }
trap cleanup EXIT
add(){ echo "p:$G/$1 $V:$2 $3" >> "$T/uprobe_events"; created+=("$1"); }
add copy 0x35a920 'output=%dx:u64 outputimage=+0(%dx):u64 blitsemaphore=+0x30(%dx):u64 outputsem=+0x18(%dx):u64 sourceimage=+0(%cx):u64'
add presubmit 0x35d477 'waitcount=+0x10(%dx):u32 signalcount=+0x38(%dx):u32 waitsem=+0(+0x18(%dx)):u64 signalsem=+0(+0x40(%dx)):u64 countingsignalvalue=+0(+0x28(+8(%dx))):u64 binarywaitvalue=+0(+0x18(+8(%dx))):u64 cmdsemobj=+0x40(%r12):u64 waittarget=%di:u64'
add postsubmit 0x35d479 'result=%ax:s32'
add semget 0x35d319 'object=%ax:u64 vt=+0(%ax):u64 getnative=+0x40(+0(%ax)):u64 getvalue=+0x70(+0(%ax)):u64'
add publication 0x3b1fd9 'overlay=%bx:u64'
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
sleep "$secs"
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out"
