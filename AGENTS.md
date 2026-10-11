# AGENTS.md

- `docs/`: settled docs, starting with `docs/ARCHITECTURE.md`.
- `markdown/`: plans and work in progress. Start with `markdown/what-petplay-is.md` and
  `markdown/petplay-2.0/README.md`.
- `markdown/issues/`: the bug tracker, one folder per issue (see its README).

## Git

Manage git however you see fit. Work on `main`.

- Commit as the configured git identity. No `Co-Authored-By` or other co-author trailers.
- End every agent-made commit message with:

  ```
  Agent: <harness> <version>; model <exact model id>; thread <harness thread/session id>
  ```

  For example, `Agent: Claude Code 2.1.296; model claude-opus-5-5; thread 941be8c7-aca1-4664-b284-7cc0eed69e21`.
