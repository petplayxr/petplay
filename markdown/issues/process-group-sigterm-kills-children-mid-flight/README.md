# Process-group SIGTERM kills children mid-flight

Status: open
Track: stability-performance

A single-process SIGTERM shuts down cleanly. A process-group SIGTERM (what a terminal Ctrl-C,
systemd and some launchers send) kills the capture helper and overlay children before the
parent can tear them down in order. This matters for SteamVR auto-launch and systemd, which
both signal the whole group.

Fix direction: put children in their own process group/session and have the parent own their
shutdown.

Source: `docs/ARCHITECTURE.md` §9.
