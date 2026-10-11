# Issues

Bug and task tracking without GitHub. Each issue is a **folder**, so repro scripts, logs,
captures and REPL transcripts live next to the write-up instead of in `_scratch/` or `logs/`.

```
issues/
  floating-circle-in-base-environment/
    README.md        # the issue (required)
    capture.png      # anything else that helps: shots, logs, repro.ts, repl.txt
  FIXED-some-old-bug/
    README.md
```

## Conventions

- **Name**: kebab-case statement of the defect, not the fix
  (`capture-receiver-has-no-reconnect`, not `add-reconnect`).
- **Fixed**: rename the folder with a `FIXED-` prefix and set the status line. Keep the folder;
  it is the record of what was wrong and why.
- **Won't fix / superseded**: `WONTFIX-` prefix, with one line saying why.
- **README.md shape** (only the title and status are mandatory; a two-line issue is fine):

  ```markdown
  # <one-line statement>

  Status: open | in progress | fixed YYYY-MM-DD (`commit` / file) | wontfix
  Track: <petplay-2.0 track, if any>

  ## What happens
  ## Expected
  ## Repro
  ## Notes / evidence
  ```

- Dates are absolute (`2026-10-11`), never "yesterday".
- Point at code as `path/file.ts:123`.
- Agent playtest runs that find a bug write the issue folder directly, with the capture and REPL
  transcript attached (see [agentic playtesting](../petplay-2.0/agentic-playtesting.md)).

## Listing

```bash
ls markdown/issues | grep -v -E '^(FIXED|WONTFIX)-|README'   # open
grep -l 'Track: capture' markdown/issues/*/README.md          # by track
```
