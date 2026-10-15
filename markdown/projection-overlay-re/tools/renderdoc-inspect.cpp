// Matching replay headers/library are required. Read-only capture replay and pixel inspection.
#include "renderdoc_replay.h"
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <algorithm>
static unsigned long long rid(ResourceId r){static_assert(sizeof(r)==8);uint64_t n;memcpy(&n,&r,8);return n;}
static void variables(const rdcarray<ShaderVariable>&vars){
 for(const auto &v:vars){
  printf("  shader variable %s rows %u columns %u type %u",v.name.c_str(),v.rows,v.columns,(unsigned)v.type);
  if(v.type==VarType::Float)for(unsigned i=0;i<std::min<unsigned>(v.rows*v.columns,16);i++)printf(" %g",v.value.f32v[i]);
  puts("");variables(v.members);
 }
}
REPLAY_PROGRAM_MARKER();
static void walk(IReplayController *r,const SDFile &s,const rdcarray<ActionDescription>&actions){
 for(const auto &a:actions){
  printf("event %u flags %u name %s\n",a.eventId,(unsigned)a.flags,a.GetName(s).c_str());
  if((a.flags & ActionFlags::Drawcall)!=ActionFlags::NoFlags){
   r->SetFrameEvent(a.eventId,true);
   for(const auto &access:r->GetDescriptorAccess()){
    auto descriptors=r->GetDescriptors(access.descriptorStore,{DescriptorRange(access)});
    for(const auto &d:descriptors)printf("  descriptor stage %u type %u resource %llu offset %llu size %llu\n",(unsigned)access.stage,(unsigned)access.type,rid(d.resource),(unsigned long long)d.byteOffset,(unsigned long long)d.byteSize);
   }
   const auto *vk=r->GetVulkanPipelineState();
   if(vk)for(const auto &d:vk->currentPass.framebuffer.attachments)printf("  attachment %llu\n",rid(d.resource));
  }
  walk(r,s,a.children);
 }
}
int main(int argc,char **argv){
 if(argc!=2 && argc!=4){fprintf(stderr,"usage: renderdoc-inspect capture.rdc [event-id output-prefix]\n");return 2;}
 RENDERDOC_InitialiseReplay(GlobalEnvironment(),{});
 auto f=RENDERDOC_OpenCaptureFile();auto result=f->OpenFile(argv[1],"rdc",nullptr);
 if(!result.OK()){fprintf(stderr,"open failed %u\n",(unsigned)result.code);f->Shutdown();RENDERDOC_ShutdownReplay();return 1;}
 auto opened=f->OpenCapture(ReplayOptions(),nullptr);
 if(!opened.first.OK()){fprintf(stderr,"replay failed %u\n",(unsigned)opened.first.code);f->Shutdown();RENDERDOC_ShutdownReplay();return 1;}
 auto r=opened.second;walk(r,f->GetStructuredData(),r->GetRootActions());
 if(argc==4){
  r->SetFrameEvent(strtoul(argv[2],nullptr,10),true);
  const auto *vk=r->GetVulkanPipelineState();
 for(const auto &access:r->GetDescriptorAccess())if(access.type==DescriptorType::ConstantBuffer){
   for(const auto &d:r->GetDescriptors(access.descriptorStore,{DescriptorRange(access)})){
    if(vk && (access.stage==ShaderStage::Vertex || access.stage==ShaderStage::Pixel)){
     const auto &shader=access.stage==ShaderStage::Vertex?vk->vertexShader:vk->fragmentShader;
     variables(r->GetCBufferVariableContents(vk->graphics.pipelineResourceId,shader.resourceId,access.stage,shader.entryPoint,access.index,d.resource,d.byteOffset,d.byteSize));
    }
    auto bytes=r->GetBufferData(d.resource,d.byteOffset,std::min<uint64_t>(d.byteSize,4096));
    char path[1024];snprintf(path,sizeof(path),"%s_constant_%llu_%llu.bin",argv[3],rid(d.resource),(unsigned long long)d.byteOffset);
    auto file=fopen(path,"wb");if(file){fwrite(bytes.data(),1,bytes.size(),file);fclose(file);}
   }
  }
 }
 for(const auto &t:r->GetTextures()){
  if(const char *ids=getenv("PP_RD_TEXTURE_IDS")) {
   bool selected=false;const char *next=ids;
   while(*next){char *end=nullptr;auto id=strtoull(next,&end,10);if(end==next)break;if(id==rid(t.resourceId))selected=true;next=*end==','?end+1:end;}
   if(!selected)continue;
  }
  printf("texture %llu dimensions %ux%u format %s\n",rid(t.resourceId),t.width,t.height,t.format.Name().c_str());
  if(argc==4 && t.format.compByteWidth==1 && t.format.compCount==4){
   auto bytes=r->GetTextureData(t.resourceId,Subresource());
   uint64_t colored=0;uint32_t minX=t.width,minY=t.height,maxX=0,maxY=0;
   for(uint32_t y=0;y<t.height;y++)for(uint32_t x=0;x<t.width;x++){
    size_t i=(size_t(y)*t.width+x)*4;
    if(i+3<bytes.size() && (bytes[i] || bytes[i+1] || bytes[i+2]) && bytes[i+3]){
     colored++;minX=std::min(minX,x);minY=std::min(minY,y);maxX=std::max(maxX,x);maxY=std::max(maxY,y);
    }
   }
   printf("  nonzero-alpha colored pixels %llu bounds %u/%u..%u/%u\n",(unsigned long long)colored,minX,minY,maxX,maxY);
   char path[1024];snprintf(path,sizeof(path),"%s_texture_%llu.png",argv[3],rid(t.resourceId));
   TextureSave save;save.resourceId=t.resourceId;save.destType=FileType::PNG;
   auto saved=r->SaveTexture(save,path);printf("  save result %u\n",(unsigned)saved.code);
  }
  if(t.width==16 && t.height==16){
   auto marker=r->PickPixel(t.resourceId,14,14,Subresource(),CompType::Typeless);
   printf("  marker14 %g %g %g %g\n",marker.floatValue[0],marker.floatValue[1],marker.floatValue[2],marker.floatValue[3]);
  }
  auto p=r->PickPixel(t.resourceId,t.width/2,t.height/2,Subresource(),CompType::Typeless);
  printf("  center %g %g %g %g\n",p.floatValue[0],p.floatValue[1],p.floatValue[2],p.floatValue[3]);
 }
 r->Shutdown();f->Shutdown();RENDERDOC_ShutdownReplay();return 0;
}
