# Capture receiver has no reconnect

Status: open
Track: capture-in-repo, stability-performance

`classes/ScreenCapturer/frame_receiver_worker.ts` posts `disconnected` on TCP loss, and
`ScreenCapturer` (`scclass.ts`) doesn't handle it. A helper restart is only noticed through
`onExit`, and a dropped socket with a live helper is never noticed at all.

Expected: on `disconnected`, back off and reconnect, and surface "capture lost" in status/UI.

Source: `docs/ARCHITECTURE.md` §9.
