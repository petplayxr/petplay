// Records IVRCompositor::GetFrameTimings for every compositor frame over a run, as a background
// app (no overlay, no rendering). Shows whether frames PetPlay misses line up with compositor
// drops, mispresents or reprojection, i.e. whether SteamVR itself stalled.
//
// Build: c++ -std=c++17 -O2 native/compositorTimingProbe/probe.cpp -ldl -o probe
// Run:   probe [seconds=20] [csv-path]
// Columns follow Compositor_FrameTiming; vsync_counter is GetTimeSinceLastVsync's counter at
// the poll that first saw the frame, to map frame indices onto PetPlay's timeline.
#include "../../submodules/OpenVR_TS_Bindings_Deno/CTest/openvr_capi.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <map>
#include <string>
#include <thread>

using InitFn = intptr_t (*)(EVRInitError *, EVRApplicationType);
using ShutdownFn = void (*)();
using GetInterfaceFn = intptr_t (*)(const char *, EVRInitError *);

int main(int argc, char **argv) {
  double seconds = argc > 1 ? std::atof(argv[1]) : 20;
  const char *csv_path = argc > 2 ? argv[2] : nullptr;
  const char *lib_path = std::getenv("PETPLAY_OPENVR_LIBRARY");
  void *lib = dlopen(lib_path ? lib_path : "/usr/lib/libopenvr_api.so", RTLD_NOW);
  if (!lib) {
    std::fprintf(stderr, "dlopen: %s\n", dlerror());
    return 1;
  }
  auto init = reinterpret_cast<InitFn>(dlsym(lib, "VR_InitInternal"));
  auto shutdown = reinterpret_cast<ShutdownFn>(dlsym(lib, "VR_ShutdownInternal"));
  auto get = reinterpret_cast<GetInterfaceFn>(dlsym(lib, "VR_GetGenericInterface"));
  EVRInitError error = EVRInitError_VRInitError_None;
  init(&error, EVRApplicationType_VRApplication_Background);
  if (error) {
    std::fprintf(stderr, "VR_InitInternal error %d\n", error);
    return 1;
  }
  auto system = reinterpret_cast<VR_IVRSystem_FnTable *>(
      get((std::string("FnTable:") + IVRSystem_Version).c_str(), &error));
  auto compositor = reinterpret_cast<VR_IVRCompositor_FnTable *>(
      get((std::string("FnTable:") + IVRCompositor_Version).c_str(), &error));
  if (!system || !compositor || error) {
    std::fprintf(stderr, "interface error %d\n", error);
    return 1;
  }
  struct Row { Compositor_FrameTiming t; uint64_t vsync; };
  std::map<uint32_t, Row> frames;
  Compositor_FrameTiming batch[64];
  auto end = std::chrono::steady_clock::now() + std::chrono::duration<double>(seconds);
  while (std::chrono::steady_clock::now() < end) {
    for (auto &b : batch) b.m_nSize = sizeof(Compositor_FrameTiming);
    uint32_t n = compositor->GetFrameTimings(batch, 64);
    float since = 0;
    uint64_t counter = 0;
    system->GetTimeSinceLastVsync(&since, &counter);
    // Timings for a frame keep filling in after it first appears; keep the latest copy.
    for (uint32_t i = 0; i < n; i++) {
      auto it = frames.find(batch[i].m_nFrameIndex);
      if (it == frames.end()) frames[batch[i].m_nFrameIndex] = {batch[i], counter};
      else it->second.t = batch[i];
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  shutdown();

  FILE *f = csv_path ? std::fopen(csv_path, "w") : stdout;
  std::fprintf(f, "frame,vsync_counter,system_s,presents,mispresented,dropped,reprojection,"
                  "compositor_cpu_ms,compositor_gpu_ms,compositor_idle_ms,update_start_ms,"
                  "update_end_ms,render_start_ms,client_interval_ms,vsyncs_ready,vsyncs_to_view\n");
  for (auto &[k, r] : frames) {
    auto &t = r.t;
    std::fprintf(f, "%u,%llu,%.6f,%u,%u,%u,%u,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%u,%u\n", k,
                 (unsigned long long)r.vsync, t.m_flSystemTimeInSeconds, t.m_nNumFramePresents,
                 t.m_nNumMisPresented, t.m_nNumDroppedFrames, t.m_nReprojectionFlags,
                 t.m_flCompositorRenderCpuMs, t.m_flCompositorRenderGpuMs,
                 t.m_flCompositorIdleCpuMs, t.m_flCompositorUpdateStartMs,
                 t.m_flCompositorUpdateEndMs, t.m_flCompositorRenderStartMs,
                 t.m_flClientFrameIntervalMs, t.m_nNumVSyncsReadyForUse, t.m_nNumVSyncsToFirstView);
  }
  if (csv_path) std::fclose(f);
  return 0;
}
