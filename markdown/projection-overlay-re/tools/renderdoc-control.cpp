// Build against the exact RenderDoc replay headers matching the loaded library.
#include "renderdoc_replay.h"
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <ctime>
#include <algorithm>
#include <thread>
REPLAY_PROGRAM_MARKER();
int main(int argc,char **argv){
 if(argc!=3 && argc!=4){fprintf(stderr,"usage: renderdoc-control <target-ident> <expected-executable-name> [queue-frame]\n");return 2;}
 auto ctl=RENDERDOC_CreateTargetControl("127.0.0.1",strtoul(argv[1],nullptr,10),"PetPlay overlay RE",false);
 if(!ctl){fprintf(stderr,"connection failed\n");return 1;}
 printf("target %s pid %u API %s\n",ctl->GetTarget().c_str(),ctl->GetPID(),ctl->GetAPI().c_str());
 if(ctl->GetTarget()!=argv[2]){fprintf(stderr,"unexpected target; no capture requested\n");ctl->Shutdown();return 1;}
 printf("connected %d busy %s\n",ctl->Connected(),ctl->GetBusyClient().c_str());
 auto ready=std::chrono::steady_clock::now()+std::chrono::seconds(10);
 bool presenting=false;
 uint32_t previousFrame=0;bool hadPrevious=false;
 if(const char *s=getenv("PP_RD_AFTER_FRAME")){previousFrame=strtoul(s,nullptr,10);hadPrevious=true;}
 while(ctl->Connected() && !presenting && std::chrono::steady_clock::now()<ready){
  auto m=ctl->ReceiveMessage(nullptr);
  if(m.type==TargetControlMessageType::NewCapture){hadPrevious=true;previousFrame=std::max(previousFrame,m.newCapture.frameNumber);}
  if(m.type!=TargetControlMessageType::Noop)printf("message type %u connected %d\n",(unsigned)m.type,ctl->Connected());
  if(m.type==TargetControlMessageType::RegisterAPI){
   printf("API %s presenting %d supported %d %s\n",m.apiUse.name.c_str(),m.apiUse.presenting,m.apiUse.supported,m.apiUse.supportMessage.c_str());
   presenting=m.apiUse.name=="Vulkan" && m.apiUse.presenting && m.apiUse.supported;
  }
 }
 if(!presenting){fprintf(stderr,"no supported presenting Vulkan API; no capture requested\n");ctl->Shutdown();return 1;}
 // Drain reconnect history before requesting a new frame. Timestamps alone
 // cannot distinguish captures requested within the same second.
 auto drainEnd=std::chrono::steady_clock::now()+std::chrono::seconds(1);
 while(ctl->Connected() && std::chrono::steady_clock::now()<drainEnd){
  auto m=ctl->ReceiveMessage(nullptr);
  if(m.type==TargetControlMessageType::NewCapture){hadPrevious=true;previousFrame=std::max(previousFrame,m.newCapture.frameNumber);}
  if(m.type==TargetControlMessageType::Noop)std::this_thread::sleep_for(std::chrono::milliseconds(10));
 }
 printf("history latest frame %u present %d\n",previousFrame,hadPrevious);
 auto requestedAt=std::time(nullptr);
 if(argc==4)ctl->QueueCapture(strtoul(argv[3],nullptr,10),1);
 else ctl->TriggerCapture(1);
 auto end=std::chrono::steady_clock::now()+std::chrono::seconds(45);
 int status=1;
 while(ctl->Connected() && std::chrono::steady_clock::now()<end){
  auto m=ctl->ReceiveMessage(nullptr);
  if(m.type!=TargetControlMessageType::Noop)printf("message type %u connected %d\n",(unsigned)m.type,ctl->Connected());
  if(m.type==TargetControlMessageType::NewCapture && m.newCapture.timestamp>=(uint64_t)requestedAt && (!hadPrevious || m.newCapture.frameNumber>previousFrame)){printf("capture frame %u bytes %llu path %s API %s\n",m.newCapture.frameNumber,(unsigned long long)m.newCapture.byteSize,m.newCapture.path.c_str(),m.newCapture.api.c_str());status=0;break;}
 }
 ctl->Shutdown();return status;
}
