#!/bin/bash
# Build-specific CPU generation measurement; run from repository root.
# usage: generation-read-probe.sh output-prefix compiled-publisher
# Publisher settings are supplied through PP_* environment variables.
set -euo pipefail
out=${1:?output prefix};publisher=${2:?compiled publisher}
T=/sys/kernel/tracing
bin=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64
G=pp_generation_$$
[[ $(cat "$T/tracing_on") == 0 ]] || { echo 'Trace already active; leaving it untouched.' >&2; exit 1; }
readelf -n "$bin/vrcompositor" | rg -q 'f5c560dcaa16d7b2625ece684b02396505e0768f' || { echo 'Compositor build mismatch' >&2; exit 1; }
readelf -n "$bin/vrclient.so" | rg -q 'c3439e6dd64f87cc2b451764611189cd788d037e' || { echo 'Client build mismatch' >&2; exit 1; }
created=()
old_buffer=$(cat "$T/buffer_size_kb")
cleanup(){ echo 0 > "$T/tracing_on"; if [[ -e "$T/events/$G/enable" ]]; then echo 0 > "$T/events/$G/enable"; fi; for n in "${created[@]}"; do echo "-:$G/$n" >> "$T/uprobe_events"; done; if [[ -n ${PP_TRACE_BUFFER_KB:-} ]]; then echo "$old_buffer" > "$T/buffer_size_kb"; fi; }
trap cleanup EXIT
if [[ -n ${PP_TRACE_BUFFER_KB:-} ]]; then
 [[ $PP_TRACE_BUFFER_KB =~ ^[0-9]+$ ]] && ((PP_TRACE_BUFFER_KB >= 1 && PP_TRACE_BUFFER_KB <= 65536)) || { echo 'Invalid trace buffer size' >&2; exit 1; }
 echo "$PP_TRACE_BUFFER_KB" > "$T/buffer_size_kb"
fi
add(){ echo "p:$G/$1 $bin/$2:$3 $4" >> "$T/uprobe_events"; created+=("$1"); }
add frame vrcompositor 0x238c10 ''
add pose_read vrcompositor 0x23906a 'index=%r13:u32 m0=+0x560c(%dx):x64 m1=+0x5614(%dx):x64 m2=+0x561c(%dx):x64 m3=+0x5624(%dx):x64 m4=+0x562c(%dx):x64 m5=+0x5634(%dx):x64'
add tex_read vrcompositor 0x23e410 'index=%r15:u32 texture=%ax:u64'
add pose_write vrclient.so 0x3aec2a 'handle=%r12:u64'
add tex_publish vrclient.so 0x55ee90 'index=%si:u32 slot=%dx:u32 shared=%cx:u64'
add frame_sync_signal vrcompositor 0x17be5e 'old_index=%r12:u32'
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
status=0
PP_TRACE_MARKER=1 "$publisher" > "$out.api.txt" 2>&1 || status=$?
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out.trace"
exit "$status"
