#define GL_GLEXT_PROTOTYPES
#include <openvr.h>
#include <gbm.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <vector>
#include <chrono>
#include <thread>
#include <cmath>

static void require(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
static void marker(const char *label, uint64_t value) {
 if(!getenv("PP_TRACE_MARKER")) return;
 int fd = open("/sys/kernel/tracing/trace_marker",O_WRONLY | O_CLOEXEC);
 if(fd >= 0) { char text[160]; int n=snprintf(text,sizeof(text),"pp_gpu %s %llu\n",label,(unsigned long long)value);write(fd,text,n);close(fd); }
}
static int option(const char *key, int fallback) { auto s = getenv(key); return s ? atoi(s) : fallback; }
static void reportTiming(const char *stage) {
 if(!option("PP_GPU_REPORT_TIMING",0))return;
 vr::Compositor_FrameTiming timing{};timing.m_nSize=sizeof(timing);
 auto comp=vr::VRCompositor();bool valid=comp->GetFrameTiming(&timing);
 printf("runtime %s scene_pid %u timing_valid %d frame %u scene_gpu_ms %g compositor_gpu_ms %g client_interval_ms %g presents %u dropped %u\n",stage,comp->GetCurrentSceneFocusProcess(),valid,timing.m_nFrameIndex,timing.m_flPreSubmitGpuMs,timing.m_flCompositorRenderGpuMs,timing.m_flClientFrameIntervalMs,timing.m_nNumFramePresents,timing.m_nNumDroppedFrames);
}
static void captureGate(const char *stage,int generation) {
 const char *directory=getenv("PP_GPU_CAPTURE_GATE_DIR");if(!directory)return;
 char path[1024];snprintf(path,sizeof(path),"%s/%s-%d",directory,stage,generation);
 printf("capture gate %s\n",path);
 auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(120);
 while(access(path,F_OK)!=0) {
  require(std::chrono::steady_clock::now()<deadline,"capture gate timed out");
  std::this_thread::sleep_for(std::chrono::milliseconds(20));
 }
}
struct RenderDevice {
 int fd = -1;
 gbm_device *gbm = nullptr;
 EGLDisplay display = EGL_NO_DISPLAY;
 EGLContext context = EGL_NO_CONTEXT;
 PFNEGLCREATEIMAGEKHRPROC createImage = nullptr;
 PFNEGLDESTROYIMAGEKHRPROC destroyImage = nullptr;
 using ImageTarget = void (*)(GLenum, void*);
 ImageTarget imageTarget = nullptr;
 void init() {
  const char *node = getenv("PP_DRM_NODE");
  fd = open(node ? node : "/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
  require(fd >= 0, "open render node failed");
  gbm = gbm_create_device(fd); require(gbm, "GBM device failed");
  auto platform = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
  require(platform, "EGL platform display unavailable");
  display = platform(EGL_PLATFORM_GBM_KHR, gbm, nullptr);
  require(display != EGL_NO_DISPLAY && eglInitialize(display, nullptr, nullptr), "EGL init failed");
  require(eglBindAPI(EGL_OPENGL_API), "EGL OpenGL bind failed");
  EGLint configAttrs[] = {EGL_RENDERABLE_TYPE,EGL_OPENGL_BIT,EGL_SURFACE_TYPE,EGL_WINDOW_BIT,EGL_NONE};
  EGLConfig config; EGLint count = 0;
  require(eglChooseConfig(display, configAttrs, &config, 1, &count) && count, "EGL config failed");
  EGLint attrs[] = {EGL_CONTEXT_MAJOR_VERSION,3,EGL_CONTEXT_MINOR_VERSION,3,EGL_NONE};
  context = eglCreateContext(display, config, EGL_NO_CONTEXT, attrs);
  require(context != EGL_NO_CONTEXT, "EGL context failed");
  require(eglMakeCurrent(display,EGL_NO_SURFACE,EGL_NO_SURFACE,context), "surfaceless context failed");
  createImage = (PFNEGLCREATEIMAGEKHRPROC)eglGetProcAddress("eglCreateImageKHR");
  destroyImage = (PFNEGLDESTROYIMAGEKHRPROC)eglGetProcAddress("eglDestroyImageKHR");
  imageTarget = (ImageTarget)eglGetProcAddress("glEGLImageTargetTexture2DOES");
  require(createImage && destroyImage && imageTarget, "EGL image import functions unavailable");
  printf("GL renderer %s\n",glGetString(GL_RENDERER));
 }
 ~RenderDevice() {
  if(display != EGL_NO_DISPLAY) {
   eglMakeCurrent(display,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT);
   if(context != EGL_NO_CONTEXT) eglDestroyContext(display,context);
   eglTerminate(display);
  }
  if(gbm) gbm_device_destroy(gbm);
  if(fd >= 0) close(fd);
 }
};
struct RenderImage {
 RenderDevice &device;
 gbm_bo *bo = nullptr; int fd = -1; EGLImageKHR image = EGL_NO_IMAGE_KHR;
 GLuint texture = 0, framebuffer = 0;
 explicit RenderImage(RenderDevice &d): device(d) {}
 void render(int generation) {
  uint64_t linear = 0;
  bo = gbm_bo_create_with_modifiers2(device.gbm,16,16,GBM_FORMAT_ARGB8888,&linear,1,GBM_BO_USE_RENDERING);
  require(bo, "linear GBM allocation failed");
  fd = gbm_bo_get_fd(bo); require(fd >= 0, "GBM export failed");
  EGLint attrs[] = {EGL_WIDTH,16,EGL_HEIGHT,16,EGL_LINUX_DRM_FOURCC_EXT,GBM_FORMAT_ARGB8888,
   EGL_DMA_BUF_PLANE0_FD_EXT,fd,EGL_DMA_BUF_PLANE0_OFFSET_EXT,0,
   EGL_DMA_BUF_PLANE0_PITCH_EXT,(EGLint)gbm_bo_get_stride(bo),
   EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT,0,EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT,0,EGL_NONE};
  image = device.createImage(device.display,EGL_NO_CONTEXT,EGL_LINUX_DMA_BUF_EXT,nullptr,attrs);
  require(image != EGL_NO_IMAGE_KHR, "EGL DMA-BUF import failed");
  glGenTextures(1,&texture); glBindTexture(GL_TEXTURE_2D,texture);
  device.imageTarget(GL_TEXTURE_2D,image);
  glGenFramebuffers(1,&framebuffer); glBindFramebuffer(GL_FRAMEBUFFER,framebuffer);
  glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);
  require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "DMA-BUF framebuffer incomplete");
  glViewport(0,0,16,16); glDisable(GL_FRAMEBUFFER_SRGB);
  // Encode generation in RGB; alpha zero keeps this diagnostic overlay invisible.
  glClearColor(0,0,(generation % 255 + 1)/255.f,0); glClear(GL_COLOR_BUFFER_BIT);
  // Optional capture marker: one opaque texel, near a corner or at the center.
  // This is diagnostic visibility, never a production publication/pacing path.
  if(option("PP_GPU_VISIBLE_MARKER",0)) {
   glEnable(GL_SCISSOR_TEST);int markerXY=option("PP_GPU_MARKER_CENTER",0)?8:14;glScissor(markerXY,markerXY,1,1);
   glClearColor(64/255.f,128/255.f,(generation % 255 + 1)/255.f,1);
   glClear(GL_COLOR_BUFFER_BIT);glDisable(GL_SCISSOR_TEST);
  }
  if(option("PP_GPU_VISIBLE_CONTROL",0)) {
   // A broad patch makes the positive output control easy to see; leave 0/0
   // transparent so the original producer readback check remains meaningful.
   glEnable(GL_SCISSOR_TEST);glScissor(4,4,8,8);
   glClearColor(64/255.f,128/255.f,(generation % 255 + 1)/255.f,1);
   glClear(GL_COLOR_BUFFER_BIT);glDisable(GL_SCISSOR_TEST);
  }
  GLsync fence = glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE,0); require(fence, "GL fence failed");
  glFlush(); GLenum result = glClientWaitSync(fence,0,GL_TIMEOUT_IGNORED); glDeleteSync(fence);
  require(result == GL_ALREADY_SIGNALED || result == GL_CONDITION_SATISFIED, "GPU fence did not complete");
  unsigned char pixel[4]; glReadPixels(0,0,1,1,GL_RGBA,GL_UNSIGNED_BYTE,pixel);
  require(glGetError() == GL_NO_ERROR, "GL operation failed");
  require(pixel[2] == generation % 255 + 1 && pixel[3] == 0, "producer pixel readback mismatch");
  printf("gpu generation %d fence %u pixel %u/%u/%u/%u\n",generation,result,pixel[0],pixel[1],pixel[2],pixel[3]);
 }
 ~RenderImage() {
  if(framebuffer) glDeleteFramebuffers(1,&framebuffer);
  if(texture) glDeleteTextures(1,&texture);
  if(image != EGL_NO_IMAGE_KHR) device.destroyImage(device.display,image);
  if(fd >= 0) close(fd);
  if(bo) gbm_bo_destroy(bo);
 }
};
int main() {
 setvbuf(stdout,nullptr,_IOLBF,0);
 bool initialized = false; vr::VROverlayHandle_t overlayHandle = 0;
 vr::IVROverlay *overlay = nullptr; vr::IVRIPCResourceManagerClient *ipc = nullptr;
 std::vector<vr::SharedTextureHandle_t> owned;
 int status = 0;
 try {
  RenderDevice device; device.init();
  vr::EVRInitError error;
  vr::VR_Init(&error,vr::VRApplication_Overlay); require(!error,"OpenVR init failed"); initialized = true;
  overlay = (vr::IVROverlay*)vr::VR_GetGenericInterface("IVROverlay_028",&error);
  ipc = (vr::IVRIPCResourceManagerClient*)vr::VR_GetGenericInterface("IVRIPCResourceManagerClient_003",&error);
  require(overlay && ipc,"public interfaces unavailable");
  reportTiming("begin");
  char key[128]; snprintf(key,sizeof(key),"petplay.re.gpu-dmabuf.%d",getpid());
  require(!overlay->CreateOverlay(key,key,&overlayHandle),"create overlay failed");
  require(!overlay->SetOverlayAlpha(overlayHandle,1),"set alpha failed");
  vr::HmdMatrix34_t matrix{}; matrix.m[0][0]=matrix.m[1][1]=matrix.m[2][2]=1;
  if(option("PP_GPU_POSE_CURRENT",0)) {
   vr::TrackedDevicePose_t poses[vr::k_unMaxTrackedDeviceCount]{};
   vr::VRSystem()->GetDeviceToAbsoluteTrackingPose(vr::TrackingUniverseStanding,0,poses,vr::k_unMaxTrackedDeviceCount);
   require(poses[vr::k_unTrackedDeviceIndex_Hmd].bPoseIsValid,"HMD pose invalid");
   matrix=poses[vr::k_unTrackedDeviceIndex_Hmd].mDeviceToAbsoluteTracking;
   printf("projection pose current HMD");for(const auto &row:matrix.m)for(float v:row)printf(" %g",v);puts("");
   if(!option("PP_GPU_QUAD_CONTROL",0)) {
    // Projection takes tracking-origin-to-eye (view), unlike absolute quads.
    auto world=matrix;
    for(int row=0;row<3;row++) {
     for(int col=0;col<3;col++)matrix.m[row][col]=world.m[col][row];
     matrix.m[row][3]=0;
     for(int col=0;col<3;col++)matrix.m[row][3]-=matrix.m[row][col]*world.m[col][3];
    }
    printf("projection view inverse HMD");for(const auto &row:matrix.m)for(float v:row)printf(" %g",v);puts("");
   }
  }
  vr::VROverlayProjection_t projection{-1,1,-1,1};
  if(option("PP_GPU_QUAD_CONTROL",0)) {
   for(int row=0;row<3;row++) matrix.m[row][3]-=matrix.m[row][2];
   require(!overlay->SetOverlayWidthInMeters(overlayHandle,.6f),"quad width failed");
   require(!overlay->SetOverlayTransformAbsolute(overlayHandle,vr::TrackingUniverseStanding,&matrix),"quad transform failed");
   printf("control geometry absolute quad one meter ahead\n");
  } else {
   require(!overlay->SetOverlayTransformProjection(overlayHandle,vr::TrackingUniverseStanding,&matrix,&projection,vr::Eye_Left),"projection failed");
  }
  printf("pid %d overlay %llu index %u\n",getpid(),(unsigned long long)overlayHandle,(unsigned)overlayHandle);
  const char *mode = getenv("PP_RELEASE_MODE"); if(!mode) mode = "retain";
  require(!strcmp(mode,"retain") || !strcmp(mode,"replace") || !strcmp(mode,"immediate") || !strcmp(mode,"frame_sync"),"unknown release mode");
  printf("release mode %s\n",mode);
  const int generations = option("PP_DMABUF_GENERATIONS",3), delay = option("PP_DMABUF_STAGE_MS",220);
  for(int generation=0;generation<generations;generation++) {
   // Local BO/EGL/GL objects are destroyed after this iteration; import references are separate.
   RenderImage image(device); image.render(generation);
   vr::DmabufAttributes_t attrs{};
   attrs.unWidth=attrs.unHeight=16; attrs.unDepth=attrs.unMipLevels=attrs.unArrayLayers=attrs.unSampleCount=1;
   attrs.unFormat=GBM_FORMAT_ARGB8888;attrs.ulModifier=0;attrs.unPlaneCount=1;
   attrs.plane[0]={0,gbm_bo_get_stride(image.bo),image.fd};
   vr::SharedTextureHandle_t handle=0;
   require(ipc->ImportDmabuf(vr::VRApplication_Overlay,&attrs,&handle),"SteamVR import failed");
   owned.push_back(handle);
   printf("import generation %d success 1 shared %llu modifier 0\n",generation,(unsigned long long)handle);
   auto pose=matrix;
   bool poseGenerations=option("PP_GPU_POSE_GENERATIONS",0);
   if(poseGenerations) {
    require(!option("PP_GPU_QUAD_CONTROL",0),"pose generations require projection geometry");
    float angle=option("PP_GPU_UNIQUE_POSES",0)?generation*.001f:(generation%2)*.2f;
    float c=std::cos(angle),s=std::sin(angle);
    for(int row=0;row<3;row++) {
     pose.m[row][0]=c*matrix.m[row][0]-s*matrix.m[row][2];
     pose.m[row][2]=s*matrix.m[row][0]+c*matrix.m[row][2];
    }
   }
   auto printPose=[&](){printf("pose generation %d",generation);for(const auto &row:pose.m)for(float v:row)printf(" %.9g",v);puts("");};
   auto publishPose=[&](){
    if(!poseGenerations)return;
    require(!overlay->SetOverlayTransformProjection(overlayHandle,vr::TrackingUniverseStanding,&pose,&projection,vr::Eye_Left),"generation projection failed");
    if(getenv("PP_GPU_CAPTURE_GATE_DIR"))printPose();
    if(generation)captureGate("pose",generation);
    int gap=generation?option("PP_GPU_POSE_TEXTURE_GAP_MS",0):0;
    if(gap>0)std::this_thread::sleep_for(std::chrono::milliseconds(gap));
   };
   vr::Texture_t texture{&handle,vr::TextureType_SharedTextureHandle,vr::ColorSpace_Auto};
   auto publishTexture=[&](){require(!overlay->SetOverlayTexture(overlayHandle,&texture),"submit failed");};
   if(option("PP_GPU_WAIT_BEFORE_PUBLISH",0)) {
    marker("wait_begin",generation);
    require(!overlay->WaitFrameSync(1000),"pre-publication FrameSync timed out");
    marker("wait_done",generation);
    int jitter=option("PP_GPU_AFTER_SYNC_JITTER_US",0);
    // Deliberate descheduling control, not a recommended delay or frame edge.
    if(jitter>0)std::this_thread::sleep_for(std::chrono::microseconds((uint64_t(generation)*421)%uint64_t(jitter)));
   }
   // No logging, rendering, or trace-marker syscall between ordinary setters.
   marker("pair_begin",generation);
   if(option("PP_GPU_TEXTURE_FIRST",0)){publishTexture();publishPose();}
   else {publishPose();publishTexture();}
   marker("pair_done",generation);
   if(poseGenerations && !getenv("PP_GPU_CAPTURE_GATE_DIR"))printPose();
   printf("texture generation %d published\n",generation);
   if(!strcmp(mode,"immediate")) {
    require(ipc->UnrefResource(handle),"immediate unref failed");owned.pop_back();
    printf("unref immediate %llu\n",(unsigned long long)handle);
   } else if((!strcmp(mode,"replace") || !strcmp(mode,"frame_sync")) && owned.size()>1) {
    if(!strcmp(mode,"frame_sync")) {
     require(!overlay->WaitFrameSync(1000),"post-publication FrameSync timed out");
     marker("frame_sync_done",handle);
    }
    auto old=owned.front(); require(ipc->UnrefResource(old),"replaced unref failed");owned.erase(owned.begin());
    marker("unref_previous",old);
    printf("unref replaced %llu\n",(unsigned long long)old);
   }
   require(!overlay->ShowOverlay(overlayHandle),"show failed");
   captureGate("texture",generation);
   if(delay>0) std::this_thread::sleep_for(std::chrono::milliseconds(delay));
  }
  require(!overlay->HideOverlay(overlayHandle),"hide failed");
  require(!overlay->ClearOverlayTexture(overlayHandle),"clear failed");
  require(!overlay->DestroyOverlay(overlayHandle),"destroy failed");overlayHandle=0;
  if(!strcmp(mode,"frame_sync")) require(!overlay->WaitFrameSync(1000),"final FrameSync timed out");
  for(auto h:owned) require(ipc->UnrefResource(h),"final unref failed");owned.clear();
  printf("publisher imports released\n");
  reportTiming("end");
  // Diagnostic observation tail only. Never used as permission to rewrite a buffer.
  std::this_thread::sleep_for(std::chrono::milliseconds(option("PP_CAPTURE_TAIL_MS",1200)));
 } catch(const std::exception &e) { fprintf(stderr,"probe failed: %s\n",e.what());status=1; }
 if(overlay && overlayHandle) {overlay->HideOverlay(overlayHandle);overlay->ClearOverlayTexture(overlayHandle);overlay->DestroyOverlay(overlayHandle);}
 if(ipc) for(auto h:owned) ipc->UnrefResource(h);
 if(initialized) vr::VR_Shutdown();
 return status;
}
