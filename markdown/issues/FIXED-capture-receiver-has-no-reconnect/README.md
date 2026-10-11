# Capture receiver has no reconnect

Status: fixed 2026-10-11 (`ScreenCapturer.handleDisconnect`, `scheduleCaptureRestart` in `petplay/displayOverlayHost.ts`)
Track: capture-in-repo, stability-performance

`classes/ScreenCapturer/frame_receiver_worker.ts` posts `disconnected` on TCP loss, and
`ScreenCapturer` (`scclass.ts`) doesn't handle it. A helper restart is only noticed through
`onExit`, and a dropped socket with a live helper is never noticed at all.

Expected: on `disconnected`, back off and reconnect, and surface "capture lost" in status/UI.

Source: `docs/ARCHITECTURE.md` §9.

## Fix

- On `disconnected`, `ScreenCapturer` kills a still-live helper. The worker's listener accepts
  one connection only, so that helper could never deliver again. Its exit then goes through
  `onExit`.
- `displayOverlayHost` restarts from `onExit` with a 1 s to 30 s backoff, which resets after 60 s
  of stable capture. A failed restart is retried instead of leaving capture dead. The last error
  stays in `lastStartError` (actor status).
- `classes/ScreenCapturer/scclass.test.ts` covers the dropped-socket case with a fake helper.
  Not yet seen against a real portal or helper restart in a headset session.
