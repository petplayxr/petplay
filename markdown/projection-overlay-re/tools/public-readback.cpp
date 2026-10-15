// Diagnostic public output access; never treats mirror access as a fence.
// Reuses the hidden EGL context helper from the GPU probe; its renamed main is not called.
#define main dmabuf_probe_main
#include "dmabuf-gpu-probe.cpp"
#undef main
int main() {
 RenderDevice render;render.init();vr::EVRInitError error;
 vr::VR_Init(&error,vr::VRApplication_Overlay);if(error){fprintf(stderr,"init %d\n",error);return 1;}
 auto comp=vr::VRCompositor();if(!comp){vr::VR_Shutdown();return 2;}
 bool visible=comp->IsMirrorWindowVisible();printf("mirror initially visible %d\n",visible);
 for(int i=0;i<2;i++){
  if(i==1){comp->ShowMirrorWindow();std::this_thread::sleep_for(std::chrono::seconds(1));}
  vr::glUInt_t id=0;vr::glSharedTextureHandle_t shared=nullptr;
  auto result=comp->GetMirrorTextureGL(vr::Eye_Left,&id,&shared);
  printf("mirror pass %d result %d id %u shared %p visible %d\n",i,result,id,shared,comp->IsMirrorWindowVisible());
  if(!result)comp->ReleaseSharedGLTexture(id,shared);
 }
 if(!visible)comp->HideMirrorWindow();
 printf("scene focus %u last renderer %u\n",comp->GetCurrentSceneFocusProcess(),comp->GetLastFrameRenderer());
 comp->CompositorDumpImages();puts("requested public image dump");
 std::this_thread::sleep_for(std::chrono::seconds(3));
 vr::VR_Shutdown();return 0;
}
