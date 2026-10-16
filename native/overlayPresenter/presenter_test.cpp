// CPU contract tests: mock GL completion and public OpenVR calls, not a GPU
// correctness test.
#include "presenter.cpp"
#include <cassert>
#include <vector>
static bool context = true;
static std::vector<int> calls;
extern "C" const GLubyte *glGetString(GLenum) {
  return context ? reinterpret_cast<const GLubyte *>("test") : nullptr;
}
extern "C" void glFinish() { calls.push_back(-1); }
static int wait_result = 0, fail_texture = 0;
static EVROverlayError wait_frame(uint32_t) {
  calls.push_back(0);
  return static_cast<EVROverlayError>(wait_result);
}
static EVROverlayError texture(uint64_t h, Texture_t *) {
  calls.push_back(int(h));
  return static_cast<EVROverlayError>(h == uint64_t(fail_texture) ? 23 : 0);
}
static EVROverlayError projection(uint64_t h, ETrackingUniverseOrigin,
                                  HmdMatrix34_t *m, VROverlayProjection_t *,
                                  EVREye eye) {
  assert(m->m[0][0] == (eye == EVREye_Eye_Left ? 10 : 20));
  calls.push_back(int(h) + 2);
  return EVROverlayError_VROverlayError_None;
}
static EVROverlayError show(uint64_t h) {
  calls.push_back(int(h) + 4);
  return EVROverlayError_VROverlayError_None;
}
int main() {
  VR_IVROverlay_FnTable api{};
  api.WaitFrameSync = wait_frame;
  api.SetOverlayTexture = texture;
  api.SetOverlayTransformProjection = projection;
  api.ShowOverlay = show;
  float views[24] = {};
  views[0] = 10;
  views[12] = 20;
  float frusta[8] = {};
  double stats[6];
  wait_result = 34;
  assert(pp_overlay_present(&api, 1, 2, 11, 22, views, frusta, 100, 1, stats) ==
         34);
  assert((calls == std::vector<int>{-1, 0}) && stats[3] == 0);
  calls.clear();
  wait_result = 0;
  fail_texture = 2;
  assert(pp_overlay_present(&api, 1, 2, 11, 22, views, frusta, 100, 1, stats) ==
         23);
  assert((calls == std::vector<int>{-1, 0, 1, 2}) && stats[3] == 1);
  calls.clear();
  fail_texture = 0;
  assert(pp_overlay_present(&api, 1, 2, 11, 22, views, frusta, 100, 1, stats) ==
         0);
  assert((calls == std::vector<int>{-1, 0, 1, 2, 3, 4, 5, 6}) && stats[3] == 4);
  context = false;
  calls.clear();
  assert(pp_overlay_present(&api, 1, 2, 11, 22, views, frusta, 100, 1, stats) ==
             -2 &&
         calls.empty());
  // Split phases: finish and publish need the context; wait touches only OpenVR.
  assert(pp_overlay_finish(stats) == -2 && stats[4] == -2);
  context = true;
  calls.clear();
  assert(pp_overlay_finish(stats) == 0 && (calls == std::vector<int>{-1}));
  calls.clear();
  wait_result = 34;
  assert(pp_overlay_wait(&api, 100) == 34 && (calls == std::vector<int>{0}));
  assert(pp_overlay_wait(&api, 0) == -1);
  calls.clear();
  assert(pp_overlay_publish(&api, 1, 2, 11, 22, views, frusta, 0, stats) == 0);
  assert((calls == std::vector<int>{1, 2, 3, 4}) && stats[3] == 4);
  calls.clear();
  assert(pp_overlay_publish_texture(&api, 1, 11, stats) == 0 &&
         (calls == std::vector<int>{1}) && stats[3] == 5);
}
