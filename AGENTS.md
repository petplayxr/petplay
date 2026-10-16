# AGENTS.md

- `docs/`: settled docs, starting with `docs/ARCHITECTURE.md`.
- `markdown/`: plans and work in progress. Start with `markdown/what-petplay-is.md` and
  `markdown/petplay-2.0/README.md`.
- `markdown/issues/`: the bug tracker, one folder per issue (see its README).
- Use `_scratch/` for agent scratch files, experiments and local test artifacts. Do not use the
  repo-local `tmp/` for agent work: PetPlay manages it programmatically and may clobber its contents.
  Leave PetPlay's runtime files there.
- Type-check with `deno task check`: it filters out the vendor submodules' unrelated errors that
  raw `deno check` reports (`deno task check:all` for the unfiltered graph).

## Git

Manage git however you see fit. Work on `main`.

- Commit as the configured git identity. No `Co-Authored-By` or other co-author trailers.
- End every agent-made commit message with:

  ```
  Agent: <harness> <version>; model <exact model id>; thread <harness thread/session id>
  ```

  For example, `Agent: Claude Code 2.1.296; model claude-opus-5-5; thread 941be8c7-aca1-4664-b284-7cc0eed69e21`.
