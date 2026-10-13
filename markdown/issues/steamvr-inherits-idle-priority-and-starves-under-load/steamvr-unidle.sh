#!/usr/bin/env bash
# Move the running SteamVR processes off SCHED_IDLE (inherited from steamvr-watch via
# ananicy's deno rule) back to normal scheduling. The compositor gets a nice boost so
# VRChat can't starve it. Temporary: restarting SteamVR inherits SCHED_IDLE again.
set -u
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

boost() { # name nice
  for pid in $(pgrep -x "$1"); do
    for tid in $(ls /proc/$pid/task); do
      chrt -o -p 0 "$tid" 2>/dev/null
      renice -n "$2" -p "$tid" >/dev/null 2>&1
    done
    echo "$1 $pid -> $(chrt -p $pid | head -1 | sed 's/.*: //') nice=$(ps -o ni= -p $pid | tr -d ' ')"
  done
}

boost vrcompositor -10
boost vrserver -5
boost vrdashboard 0
