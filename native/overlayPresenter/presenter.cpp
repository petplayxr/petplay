// Public OpenVR FnTable:IVROverlay_027 only. Called on the
// render/context-owning thread.
#include "../../submodules/OpenVR_TS_Bindings_Deno/CTest/openvr_capi.h"
#include <GL/gl.h>
#include <chrono>
#include <cstdint>
#include <cstring>
static double now_ms() {
  return std::chrono::duration<double, std::milli>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
extern "C" uint32_t pp_overlay_abi() {
  return std::strcmp(IVROverlay_Version, "IVROverlay_027") == 0 ? 27 : 0;
}
// stats: GPU finish ms, wait ms, publication ms, completed setters, error, wait
// result.
extern "C" int32_t pp_overlay_present(VR_IVROverlay_FnTable *api, uint64_t left,
                                      uint64_t right, uint32_t lt, uint32_t rt,
                                      const float *views, const float *frusta,
                                      uint32_t timeout_ms, uint32_t show,
                                      double *stats) {
  if (!api || !views || !frusta || !stats || !left || !right || !lt || !rt ||
      !timeout_ms)
    return -1;
  std::memset(stats, 0, 6 * sizeof(double));
  if (!glGetString(GL_VERSION)) {
    stats[4] = -2;
    return -2;
  }
  auto t = now_ms();
  glFinish();
  stats[0] = now_ms() - t;
  t = now_ms();
  auto wait = api->WaitFrameSync(timeout_ms);
  stats[1] = now_ms() - t;
  stats[5] = wait;
  if (wait != EVROverlayError_VROverlayError_None) {
    stats[4] = wait;
    return wait;
  }
  // All preparation, GPU completion, and the blocking wait precede this phase.
  t = now_ms();
  uint64_t handles[2] = {left, right};
  uint32_t textures[2] = {lt, rt};
  int32_t error = 0;
  for (int i = 0; i < 2 && !error; i++) {
    Texture_t texture{reinterpret_cast<void *>(uintptr_t(textures[i])),
                      ETextureType_TextureType_OpenGL,
                      EColorSpace_ColorSpace_Auto};
    error = api->SetOverlayTexture(handles[i], &texture);
    if (!error)
      stats[3]++;
  }
  for (int i = 0; i < 2 && !error; i++) {
    HmdMatrix34_t view;
    VROverlayProjection_t projection;
    std::memcpy(&view, views + i * 12, sizeof(view));
    std::memcpy(&projection, frusta + i * 4, sizeof(projection));
    error = api->SetOverlayTransformProjection(
        handles[i], ETrackingUniverseOrigin_TrackingUniverseStanding, &view,
        &projection, static_cast<EVREye>(i));
    if (!error)
      stats[3]++;
  }
  if (show && !error)
    for (int i = 0; i < 2 && !error; i++)
      error = api->ShowOverlay(handles[i]);
  stats[2] = now_ms() - t;
  stats[4] = error;
  return error;
}
