#include <openvr.h>
#include <gbm.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdio>
#include <cstring>
#include <vector>
#include <cstdlib>
#include <chrono>
#include <thread>
int main() {
 setvbuf(stdout,nullptr,_IOLBF,0);
 const int delay=getenv("PP_DMABUF_STAGE_MS") ? atoi(getenv("PP_DMABUF_STAGE_MS")) : 220;
 vr::EVRInitError error;
 vr::VR_Init(&error, vr::VRApplication_Overlay);
 if(error) { fprintf(stderr,"init %d\n",error); return 1; }
 auto overlay=(vr::IVROverlay*)vr::VR_GetGenericInterface("IVROverlay_028",&error);
 auto ipc=(vr::IVRIPCResourceManagerClient*)vr::VR_GetGenericInterface("IVRIPCResourceManagerClient_003",&error);
 if(!overlay || !ipc) { fprintf(stderr,"interfaces unavailable %d\n",error); vr::VR_Shutdown(); return 1; }
 uint32_t nf=0; bool fq=ipc->GetDmabufFormats(&nf,nullptr);
 printf("format query %d count %u\n",fq,nf);
 uint32_t nm=0;bool mq=ipc->GetDmabufModifiers(vr::VRApplication_Overlay,GBM_FORMAT_ARGB8888,&nm,nullptr);
 printf("modifier query %d count %u\n",mq,nm);
 std::vector<uint64_t> mods(nm);if(nm){ipc->GetDmabufModifiers(vr::VRApplication_Overlay,GBM_FORMAT_ARGB8888,&nm,mods.data());for(auto m:mods)printf("supported modifier %llu\n",(unsigned long long)m);}
 int fd=open("/dev/dri/renderD128",O_RDWR|O_CLOEXEC);
 auto dev=gbm_create_device(fd);
 if(!dev) { perror("gbm device");vr::VR_Shutdown();return 1; }
 vr::VROverlayHandle_t h=0;
 char key[128]; snprintf(key,sizeof(key),"petplay.re.dmabuf.%d",getpid());
 auto r=overlay->CreateOverlay(key,key,&h);
 if(r) { fprintf(stderr,"create %d\n",r);return 1; }
 overlay->SetOverlayAlpha(h,1.f);
 vr::HmdMatrix34_t mat{}; mat.m[0][0]=mat.m[1][1]=mat.m[2][2]=1;
 vr::VROverlayProjection_t proj{-1,1,-1,1};
 printf("pid %d overlay %llu index %u\n",getpid(),(unsigned long long)h,(unsigned)h);
 printf("projection %d\n",overlay->SetOverlayTransformProjection(h,vr::TrackingUniverseStanding,&mat,&proj,vr::Eye_Left));
 std::vector<gbm_bo*> buffers;
 std::vector<vr::SharedTextureHandle_t> shared;
 int status=0;
 const int generations=getenv("PP_DMABUF_GENERATIONS") ? atoi(getenv("PP_DMABUF_GENERATIONS")) : 3;
 for(int i=0;i<generations;i++) {
  uint64_t linear=0;
  auto bo=gbm_bo_create_with_modifiers2(dev,16,16,GBM_FORMAT_ARGB8888,&linear,1,GBM_BO_USE_RENDERING);
  if(!bo){ perror("gbm create");status=1;break; }
  buffers.push_back(bo);
  uint32_t stride=0;void *mapData=nullptr;
  auto pixels=(unsigned char*)gbm_bo_map(bo,0,0,16,16,GBM_BO_TRANSFER_WRITE,&stride,&mapData);
  if(!pixels){perror("gbm map");status=1;break;}
  // Transparent pixels encode the generation in RGB; no visible overlay image.
  for(int y=0;y<16;y++) for(int x=0;x<16;x++) {auto p=pixels+y*stride+x*4;p[0]=i+1;p[1]=0;p[2]=0;p[3]=0;}
  gbm_bo_unmap(bo,mapData);
  int imageFd=gbm_bo_get_fd(bo);
  vr::DmabufAttributes_t attrs{};
  attrs.unWidth=attrs.unHeight=16;attrs.unDepth=attrs.unMipLevels=attrs.unArrayLayers=attrs.unSampleCount=1;
  attrs.unFormat=GBM_FORMAT_ARGB8888;attrs.ulModifier=gbm_bo_get_modifier(bo);attrs.unPlaneCount=1;
  attrs.plane[0]={0,gbm_bo_get_stride(bo),imageFd};
  vr::SharedTextureHandle_t sh=0;
  bool ok=ipc->ImportDmabuf(vr::VRApplication_Overlay,&attrs,&sh);
  close(imageFd);
  printf("import generation %d success %d shared %llu modifier %llu\n",i,ok,(unsigned long long)sh,(unsigned long long)attrs.ulModifier);
  if(!ok){status=1;break;}shared.push_back(sh);
  vr::Texture_t texture{&shared.back(),vr::TextureType_SharedTextureHandle,vr::ColorSpace_Auto};
  auto sr=overlay->SetOverlayTexture(h,&texture);
  printf("submit %d\n",sr);
  if(sr){status=1;break;}
  overlay->ShowOverlay(h);
  std::this_thread::sleep_for(std::chrono::milliseconds(delay));
 }
 overlay->HideOverlay(h);overlay->ClearOverlayTexture(h);overlay->DestroyOverlay(h);
 // This experiment retains every producer buffer/import until the client is shut down.
 // It does not use these diagnostic waits as retirement guarantees.
 std::this_thread::sleep_for(std::chrono::milliseconds(1000));
 for(auto sh:shared)ipc->UnrefResource(sh);
 vr::VR_Shutdown();
 for(auto bo:buffers)gbm_bo_destroy(bo);
 gbm_device_destroy(dev);close(fd);
 return status;
}
