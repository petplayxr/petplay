#!/bin/bash
# Map sampled overlay image semaphores to final compositor Vulkan waits; build-specific.
# usage: import-map.sh <output.trace> [seconds]
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
add sampled 0x186640 'handle=+0x10(%bx):u64 wrapper=%r13:u64 shared=+0x48(%r13):u64 vt=+0(+0x48(%r13)):u64 mainvt=-0x68(+0x48(%r13)):u64 getsem=+0x30(-0x68(+0x48(%r13))):u64 semfield=-0x28(+0x48(%r13)):u64 semvt=+0(-0x28(+0x48(%r13))):u64 native=+0x10(+0x58(-0x28(+0x48(%r13)))):u64 backend=+0x68(%r13):u64 backendvt=+0(+0x68(%r13)):u64'
add presubmit 0x439530 'waitsem=+0(+0xf0(%di)):u64 waitvalue=+8(+0xf0(%di)):u64 signalobj=+0(+0x410(%di)):u64'
add sem_get 0x3f81a0 'object=%di:u64 storedsem=+0x40(%di):u64'
add sem_result 0x3f81e9 'sem=%r12:u64'
add actual_submit 0x43d481 'waitcount=+0x10(%dx):u32 signalcount=+0x38(%dx):u32 w0=+0(+0x18(%dx)):u64 w1=+8(+0x18(%dx)):u64 w2=+16(+0x18(%dx)):u64 w3=+24(+0x18(%dx)):u64'
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
sleep "$secs"
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out"
