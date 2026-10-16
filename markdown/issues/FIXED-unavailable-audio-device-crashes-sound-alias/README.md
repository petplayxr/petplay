# Unavailable audio device crashes sound alias creation

Status: fixed 2026-10-16 (`classes/environment/raylibAudioContext.ts`, uncommitted)
Track: stability-performance

The live ARM64 JS smoke on Quest/DroidFrame crashed when showing the windows. ALSA device
initialization failed; loading a sound then returned an invalid buffer. PetPlay nevertheless
called `LoadSoundAlias`, whose raylib 5.5 implementation dereferences the source buffer at
`raudio.c:971`. The retained reporter maps the PC to `LoadSoundAlias+0x34` (`0xea83c`).

Audio is now optional: initialization/playback exceptions disable it, unavailable devices never
receive playback calls, failed wave/sound loads never reach alias creation, invalid aliases are
discarded, and delayed stop callbacks cannot use disposed buffers. Audio cleanup exceptions do
not escape into scene shutdown.

Four unit tests cover missing/throwing device initialization, invalid sound creation and delayed
stops after disposal. After the change, the same live JS smoke reaches all six steps, including
typing, without the sound-alias crash. Separate settings-assertion and process-exit failures are
tracked in their own issues. `evidence.json` pins the failing binary/library and subsequent steps.
