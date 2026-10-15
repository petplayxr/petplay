#!/bin/bash
# Run from repository root. usage: lifetime-probe.sh <output-prefix> [compiled-dmabuf-probe]
# Uses build-specific uprobes; default runs the isolated GL lifetime test.
set -euo pipefail
out=${1:?output prefix required}
publisher=${2:-}
T=/sys/kernel/tracing
C=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrcompositor
G=pp_lifetime_$$
if [[ $(cat "$T/tracing_on") != 0 ]]; then
 echo 'A trace is already running; leaving it untouched.' >&2
 exit 1
fi
created=()
cleanup(){ echo 0 > "$T/tracing_on"; if [[ -e "$T/events/$G/enable" ]]; then echo 0 > "$T/events/$G/enable"; fi; for n in "${created[@]}"; do echo "-:$G/$n" >> "$T/uprobe_events"; done; }
trap cleanup EXIT
add(){ echo "p:$G/$1 $C:$2 $3" >> "$T/uprobe_events"; created+=("$1"); }
add import_begin 0x3dffa0 'shared=%si:u64'
echo "r:$G/import_end $C:0x3dffa0 wrapper=\$retval:x64 backend=+0x68(\$retval):x64 native=+0x90(+0x68(\$retval)):x64 memory=+0x38(+0x68(\$retval)):x64" >> "$T/uprobe_events"
created+=(import_end)
add sampled 0x186640 'handle=+0x10(%bx):u64 wrapper=%r13:x64 backend=+0x68(%r13):x64 timeline=+0x10(+0x68(%r13)):x64 use=+0x18(+0x68(%r13)):u64 sub=+0x20(+0x68(%r13)):u8 native=+0x90(+0x68(%r13)):x64'
add mark 0x44c1e0 'object=%di:x64 timeline=%si:x64 use=+0(%dx):u64 sub=+8(%dx):u8 vt=+0(%di):x64'
add release 0x44d090 'object=%si:x64 timeline=+0x10(%si):x64 use=+0x18(%si):u64 sub=+0x20(%si):u8 vt=+0(%si):x64'
add memory_free 0x435e6a 'object=%bx:x64 memory=%si:x64'
add image_destroy 0x435eb0 'object=%di:x64 timeline=+0x10(%di):x64 use=+0x18(%di):u64 sub=+0x20(%di):u8 native=+0x90(%di):x64 memory=+0x38(%di):x64'
add wrapper_destroy 0x3dece0 'object=%di:x64 backend=+0x68(%di):x64 shared=+0x48(%di):x64'
add wrapper_destroy_other 0x3ded40 'object=%di:x64 backend=+0x68(%di):x64 shared=+0x48(%di):x64'
add texture_release 0x3e9ec0 'texture=%r8:x64 backend=+0x68(%r8):x64 query=+0x140(+0(%di)):x64'
add cleanup_begin 0x3e1840 'renderer=%di:x64 caller=+0(%sp):x64'
add shared_wrapper_cleanup 0x3f8c10 'main=%di:x64 owner=+0x40(%di):x64 owns=+0x38(%di):u8 resource=+0x48(%di):x64 control=+0x60(%di):x64 refs=+8(+0x60(%di)):u32'
add shared_owner_final 0x3f8cf9 'owner=%di:x64 target=+0x10(%ax):x64'
add imported_resource_drop 0x3f8c5a 'resource=%si:x64 renderer=%di:x64 target=+0x20(%ax):x64'
add imported_owner_drop 0x3f8c3e 'owner=%di:x64 target=+8(%ax):x64'
add shared_drop 0x3e177b 'shared=%di:x64 target=+8(%ax):x64'
add actual_texture_destroy 0x3e14d0 'texture=%si:x64 backend=+0x68(%si):x64 shared=+0x48(%si):x64'
add poll 0x451760 'timeline=%di:x64 native=+0x40(%di):x64 use=+0(%si):u64 sub=+8(%si):u8 timeout=%dx:u64'
add poll_result 0x4517c0 'result=%ax:s32'
client=$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrclient.so
echo "p:$G/client_copy $client:0x35a920" >> "$T/uprobe_events"
created+=(client_copy)
echo "p:$G/client_publish $client:0x55ee90 index=%si:u32 slot=%dx:u32 shared=%cx:u64" >> "$T/uprobe_events"
created+=(client_publish)
echo "p:$G/client_wait $client:0x3b16e0" >> "$T/uprobe_events"
created+=(client_wait)
echo "p:$G/client_wait_result $client:0x3b179f result=%r13:u32" >> "$T/uprobe_events"
created+=(client_wait_result)
add frame_sync_signal 0x17be5e 'old_index=%r12:u32'
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
if [[ -n "$publisher" ]]; then
 "$publisher" > "$out.api.txt" 2>&1
else
 deno run -A --no-check markdown/projection-overlay-re/tools/overlay-lifetime.ts > "$out.api.txt" 2>&1
fi
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out.trace"
