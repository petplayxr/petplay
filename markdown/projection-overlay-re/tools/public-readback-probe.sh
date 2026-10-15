#!/bin/bash
# Build-specific offsets: executable segment file offsets are ELF vaddr minus 0x1000.
# usage: public-readback-probe.sh <output-prefix> <compiled-public-readback>
set -euo pipefail
out=${1:?output prefix required}
publisher=${2:?compiled public-readback executable required}
T=/sys/kernel/tracing
G=pp_readback_$$
C=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrcompositor
if [[ $(cat "$T/tracing_on") != 0 ]]; then echo "Trace already active; leaving it untouched." >&2; exit 1; fi
created=()
cleanup(){ echo 0 > "$T/tracing_on"; [[ ! -e "$T/events/$G/enable" ]] || echo 0 > "$T/events/$G/enable"; for n in "${created[@]}";do echo "-:$G/$n" >> "$T/uprobe_events";done; }
trap cleanup EXIT
add(){ echo "p:$G/$1 $C:$2 $3" >> "$T/uprobe_events";created+=("$1"); }
add dump_request 0x269bc0 'context=%di:x64'
add dump_pending 0x163c4d 'flag=+0x1f9(%r12):u8'
add dump_path 0x16436d 'path=+0(%si):string'
add dump_execute 0x175000 'path=+0(%si):string'
add sync_argument 0x174ef0 'argument=%si:x64 create_target=+0x1f0(+0(+0x25608(%di))):x64 wait_target=+0x210(+0(+0x25608(%di))):x64'
add renderer_wait 0x174f6e 'target=+0x210(%ax):x64 argument=%si:x64 value=%dx:x64'
client=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrclient.so
echo "p:$G/mirror_import $client:0x34d77a shared=%si:u64" >> "$T/uprobe_events"
created+=(mirror_import)
add mirror_publish 0x164c6d 'shared=%ax:u64'
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
"$publisher" > "$out.api.txt" 2>&1
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out.trace"
