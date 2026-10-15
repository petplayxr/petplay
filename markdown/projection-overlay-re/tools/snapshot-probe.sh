#!/bin/bash
# usage: snapshot-probe.sh <seconds> <output.trace> [SteamVR linux64 directory]
# Addresses are specific to the BuildIDs in ../README.md. Requires user-owned tracefs.
set -euo pipefail
secs=${1:?seconds required}
out=${2:?output path required}
bin=${3:-$HOME/.local/share/Steam/steamapps/common/SteamVR/bin/linux64}
T=/sys/kernel/tracing
G=pp_snapshot_$$
if [[ $(cat "$T/tracing_on") != 0 ]]; then
  echo 'A trace is already running; leaving it untouched.' >&2
  exit 1
fi
old_vblank=$(cat "$T/events/drm/drm_vblank_event/enable")
created=()
cleanup() {
  echo 0 > "$T/tracing_on"
  if [[ -e "$T/events/$G/enable" ]]; then echo 0 > "$T/events/$G/enable"; fi
  echo "$old_vblank" > "$T/events/drm/drm_vblank_event/enable"
  for n in "${created[@]}"; do echo "-:$G/$n" >> "$T/uprobe_events"; done
}
trap cleanup EXIT
add_probe() {
  echo "p:$G/$1 $bin/$2:$3 $4" >> "$T/uprobe_events"
  created+=("$1")
}
# ELF executable file offsets = virtual address - 0x1000 in this build.
add_probe pose_read vrcompositor 0x23906a 'index=%r13:u32 m0=+0x560c(%dx):u64'
add_probe tex_read vrcompositor 0x23e410 'index=%r15:u32 texture=%ax:u64'
add_probe pose_write vrclient.so 0x3aec2a 'handle=%r12:u64'
add_probe tex_write vrclient.so 0x3b1fd9 'handle=%bx:u64'
echo > "$T/trace"
echo 1 > "$T/events/$G/enable"
echo 1 > "$T/events/drm/drm_vblank_event/enable"
echo 1 > "$T/tracing_on"
sleep "$secs"
echo 0 > "$T/tracing_on"
cp "$T/trace" "$out"
