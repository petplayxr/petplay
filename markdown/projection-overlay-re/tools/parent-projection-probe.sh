#!/bin/bash
set -euo pipefail
# Run from repository root. Usage: parent-projection-probe.sh <output-prefix>
# Build-specific sites; see ../README.md. Only creates transparent, isolated test overlays.
out=${1:?output prefix required}
T=/sys/kernel/tracing
G=pp_parent_$$
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
echo "p:$G/visibility $bin:0x239189 index=%r13:u32 kind=+0(%ax):u32 parent=+0x50(%ax):u64 leaf=+0x30(%ax):x64 root=+0(+0x8(%ax)):x64 enabled=+0x18(+0(+0x8(%ax))):u64 linked=+0x50(+0x30(%ax)):x64" >> "$T/uprobe_events"
created+=(visibility)
echo "p:$G/frame $bin:0x238c10" >> "$T/uprobe_events"
created+=(frame)
echo "p:$G/tex_read $bin:0x23e410 index=%r15:u32 texture=%ax:u64" >> "$T/uprobe_events"
created+=(tex_read)
echo "p:$G/traverse $bin:0x21247a node=%si:x64 visitor=+0xe8(+0(%di)):x64" >> "$T/uprobe_events"
created+=(traverse)
echo "p:$G/pose_record $bin:0x23e671 index=%r15:u32 m0=+0x28(%bx):x64 m1=+0x30(%bx):x64 m2=+0x38(%bx):x64 m3=+0x40(%bx):x64 m4=+0x48(%bx):x64 m5=+0x50(%bx):x64 shape=+0x10c(%r12):u32" >> "$T/uprobe_events"
created+=(pose_record)
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/tracing_on"
deno run -A --no-check markdown/projection-overlay-re/tools/overlay-parent.ts > "$out.api.txt" 2>&1
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out.trace"
