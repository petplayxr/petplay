#!/bin/sh
# usage: probe.sh <seconds> <out> <vaddr...>   (vrcompositor text vaddrs; file offset = vaddr - 0x1000)
T=/sys/kernel/tracing; V=/home/ellie/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrcompositor
secs=$1; out=$2; shift 2
echo 0 > $T/tracing_on; echo > $T/trace
for a in "$@"; do printf 'p:svr/f_%s %s:0x%x\n' "${a#0x}" "$V" $((a - 0x1000)) >> $T/uprobe_events; done
echo 1 > $T/events/svr/enable
echo 1 > $T/events/drm/drm_vblank_event/enable
echo 8192 > $T/buffer_size_kb
echo 1 > $T/tracing_on; sleep "$secs"; echo 0 > $T/tracing_on
cp $T/trace "$out"
echo 0 > $T/events/svr/enable; echo 0 > $T/events/drm/drm_vblank_event/enable
grep '^p:svr/' $T/uprobe_events | sed 's/^p:/-:/; s/ .*//' >> $T/uprobe_events
