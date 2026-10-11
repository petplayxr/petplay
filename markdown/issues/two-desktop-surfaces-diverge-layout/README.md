# Two desktop surfaces hold separate spatial graphs

Status: open
Track: stability-performance, ui-ux-basics

`desktopControl` (`--control`) mounts a second `WebXRScene` with its own spatial graph and
persists it to the same `spatial-layout.json` as the server. Neither side watches the file, so
concurrent edits diverge until a restart. The decoupled `desktopView` can't grab at all.

Direction: give `desktopView` interaction (input forwarded to the server's scene), then retire
the `--control` surface.

Source: `docs/ARCHITECTURE.md` §2/§5/§9.
