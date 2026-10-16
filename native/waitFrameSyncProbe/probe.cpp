// Standalone IVROverlay::WaitFrameSync timing probe: no Deno, no rendering.
// Answers whether the frame-sync phase varies on its own or only inside PetPlay.
//
// Build: c++ -std=c++17 -O2 native/waitFrameSyncProbe/probe.cpp -ldl -o probe
// Run:   probe [frames=900] [work-ms=0] [csv-path]
//   work-ms simulates render time after each sync (busy wait, so no scheduler sleep).
// Each row: wait ms, vsync phase at return (ms), vsync counter, steady-clock ms.
#include "../../submodules/OpenVR_TS_Bindings_Deno/CTest/openvr_capi.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <map>
#include <string>
#include <thread>
#include <vector>

static double now_ms() {
  return std::chrono::duration<double, std::milli>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

using InitFn = intptr_t (*)(EVRInitError *, EVRApplicationType);
using ShutdownFn = void (*)();
using GetInterfaceFn = intptr_t (*)(const char *, EVRInitError *);

static double pct(std::vector<double> v, double p) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  return v[std::min(v.size() - 1, size_t(p * v.size()))];
}

int main(int argc, char **argv) {
  int frames = argc > 1 ? std::atoi(argv[1]) : 900;
  double work_ms = argc > 2 ? std::atof(argv[2]) : 0;
  const char *csv_path = argc > 3 ? argv[3] : nullptr;
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
  init(&error, EVRApplicationType_VRApplication_Overlay);
  if (error) {
    std::fprintf(stderr, "VR_InitInternal error %d\n", error);
    return 1;
  }
  auto system = reinterpret_cast<VR_IVRSystem_FnTable *>(
      get((std::string("FnTable:") + IVRSystem_Version).c_str(), &error));
  auto overlay = reinterpret_cast<VR_IVROverlay_FnTable *>(
      get((std::string("FnTable:") + IVROverlay_Version).c_str(), &error));
  if (!system || !overlay || error) {
    std::fprintf(stderr, "interface error %d\n", error);
    return 1;
  }
  // Frame-sync pacing is tied to an overlay-owning application.
  VROverlayHandle_t handle = 0;
  char key[] = "petplay.waitframesync.probe", name[] = "WaitFrameSync probe";
  if (int e = overlay->CreateOverlay(key, name, &handle)) {
    std::fprintf(stderr, "CreateOverlay error %d\n", e);
  }

  struct Row { double wait, phase, t; uint64_t counter; int result; };
  std::vector<Row> rows;
  rows.reserve(frames);
  for (int i = 0; i < frames; i++) {
    double start = now_ms();
    int result = overlay->WaitFrameSync(100);
    double end = now_ms();
    float since = 0;
    uint64_t counter = 0;
    system->GetTimeSinceLastVsync(&since, &counter);
    rows.push_back({end - start, since * 1000.0, end, counter, result});
    while (now_ms() - end < work_ms) {
    }
  }
  if (handle) overlay->DestroyOverlay(handle);
  shutdown();

  if (csv_path) {
    FILE *f = std::fopen(csv_path, "w");
    std::fprintf(f, "wait_ms,phase_ms,counter,t_ms,result\n");
    for (auto &r : rows)
      std::fprintf(f, "%.4f,%.4f,%llu,%.4f,%d\n", r.wait, r.phase,
                   (unsigned long long)r.counter, r.t, r.result);
    std::fclose(f);
  }
  std::vector<double> phases, waits;
  std::map<long long, int> steps, errors;
  for (size_t i = 0; i < rows.size(); i++) {
    phases.push_back(rows[i].phase);
    waits.push_back(rows[i].wait);
    if (rows[i].result) errors[rows[i].result]++;
    if (i) steps[(long long)(rows[i].counter - rows[i - 1].counter)]++;
  }
  std::printf("frames %zu work %.1f ms\n", rows.size(), work_ms);
  std::printf("return phase ms after vsync: p5 %.2f p25 %.2f p50 %.2f p75 %.2f p95 %.2f "
              "min %.2f max %.2f\n",
              pct(phases, .05), pct(phases, .25), pct(phases, .5), pct(phases, .75),
              pct(phases, .95), pct(phases, 0), pct(phases, 1));
  std::printf("wait ms: p5 %.2f p50 %.2f p95 %.2f\n", pct(waits, .05), pct(waits, .5),
              pct(waits, .95));
  std::printf("vsync steps between returns:");
  for (auto &[k, v] : steps) std::printf(" %lld:%d", k, v);
  std::printf("\nerrors:");
  for (auto &[k, v] : errors) std::printf(" %lld:%d", k, v);
  std::printf("\nphase histogram (1 ms bins):");
  std::map<int, int> hist;
  for (double p : phases) hist[int(p)]++;
  for (auto &[k, v] : hist) std::printf(" %d:%d", k, v);
  std::printf("\n");
  return 0;
}
