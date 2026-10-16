# Native overlay presenter is a C++ build step

Status: open
Track: decoupled renderer / portability

## What happens

`native/overlayPresenter/presenter.cpp` builds into `resources/libpetplay_overlay_presenter.so`
(`deno task overlay:presenter:build`). The decoupled renderer needs it for the projection path
and for `panoramaPacing: "presenter"`. It is a separate, Linux-only C++ toolchain step.

Since `08dc690` it loads only on first use, so the default panorama path doesn't need it.

## Expected

Rewrite it in Deno FFI (direct OpenVR and GL calls from `classes/overlayPresenterNative.ts`)
or in Zig, like `submodules/petplay_ovrdriver`, so it builds wherever the rest of PetPlay does.
Keep its tests (`native/overlayPresenter/presenter_test.cpp`) as the behaviour to match:
the finish, wait and publish phases, and dropping late frames.

## Notes

`native/waitFrameSyncProbe/` and `native/compositorTimingProbe/` are standalone diagnostic
tools, not runtime code. Each file's header comment has its build command.
