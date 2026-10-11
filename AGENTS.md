# AGENTS.md

Entry point for coding agents working in this repo. Read this first.

## Where things are

- `docs/`: settled, user-facing explanation. Start with `docs/ARCHITECTURE.md` (processes, actors,
  message graph, frame pipeline).
- `markdown/`: plans and work in progress. Read
  [`markdown/what-petplay-is.md`](markdown/what-petplay-is.md) for what PetPlay is (and isn't),
  then the active plan, [`markdown/petplay-2.0/README.md`](markdown/petplay-2.0/README.md).
- `markdown/issues/`: the bug tracker, one folder per issue. Conventions are in
  [`markdown/issues/README.md`](markdown/issues/README.md). When you find a bug you aren't fixing
  right now, file it there with evidence (logs, captures, repro) inside the folder. When you fix
  one, rename the folder to `FIXED-<slug>` and set its status line.

## Working rules

- **Agent work must not need SteamVR.** Run with `--novr` (or the null driver for OpenVR-path
  work). PetPlay is an always-on service, and the SteamVR overlay is one client among several.
  Don't add code that makes the service depend on SteamVR.
- **The interface is the system.** There's no separate agent API, and there won't be an MCP one.
  Talk to a running server through the agent REPL (`deno task server` → `:3987`; `--agent-repl-port`
  to pick another). Anything you'd do twice becomes an actor, loaded with `POST /create`.
- **`/eval` can kill the process.** Never call native FFI or state-changing GL/raylib functions from
  `/eval`. That includes OpenVR calls that return structs by value, `BeginTextureMode`, any draw
  call, and `LoadImageFromTexture` on a live render target. They segfault, and native crashes
  can't be caught. Put GPU-side checks behind a flag inside the render loop and read the result
  over the REPL.
- **Don't kill a reproduced bug to apply a fix.** Inspect it live first (REPL, `/reload` on the
  actor) and capture evidence into the issue folder.
- **Visual checks:** `deno task client capture -- --path=shot.png` renders exactly what the headset
  sees. Use `--width=`/`--height=` to make UI text legible.
- Type check with `deno task check`.

## Git

Agents may manage git however they see fit (commit, amend their own unpushed commits, branch,
rebase), with these rules:

- **Work on `main`** on this machine unless told otherwise.
- **Commit as the configured git identity.** Never add `Co-Authored-By` (or any other co-author
  trailer), and never change `user.name`/`user.email` or pass `--author`.
- **Every agent-made commit ends with an attribution trailer** naming the harness, its version,
  the exact model ID and the harness thread/session ID:

  ```
  Agent: <harness> <version>; model <exact model id>; thread <thread/session id>
  ```

  For example:

  ```
  Agent: Claude Code 2.1.296; model claude-opus-5-5; thread 941be8c7-aca1-4664-b284-7cc0eed69e21
  ```

  Use the precise model ID (`claude-opus-5-5`, not "Claude" or "Opus"). Use the real thread ID
  from the harness, e.g. `$CLAUDE_CODE_SESSION_ID` in Claude Code, or your harness's equivalent
  thread/session ID. If you can't determine a value, write `unknown` rather than guessing.
- Don't push unless asked.
