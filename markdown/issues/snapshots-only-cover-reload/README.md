# Actor snapshots only cover RELOAD, not REBOOT

Status: open
Track: stability-performance

`__SNAPSHOT__` state is carried across actor `RELOAD` only, and most actors don't implement it.
A `REBOOT` or a crash restart loses in-memory state.

Source: `docs/ARCHITECTURE.md` §9.
