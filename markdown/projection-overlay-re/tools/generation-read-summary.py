"""Identify actual pose matrices and advertised texture handles at compositor CPU reads.
Usage: generation-read-summary.py output-prefix
This does not identify GPU samples or measure an uninstrumented race frequency.
"""
import json,re,struct,sys
from pathlib import Path
prefix=Path(sys.argv[1]);api=Path(str(prefix)+'.api.txt').read_text()
slot=int(re.search(r'pid \d+ overlay \d+ index (\d+)',api)[1])
poses={int(m[1]):list(map(float,m[2].split())) for m in re.finditer(r'^pose generation (\d+) (.+)$',api,re.M)}
textures={int(m[2]):int(m[1]) for m in re.finditer(r'^import generation (\d+) success 1 shared (\d+)',api,re.M)}
assert poses and textures
trace=Path(str(prefix)+'.trace').read_text()
counts=re.search(r'entries-in-buffer/entries-written: (\d+)/(\d+)',trace)
assert counts and counts[1]==counts[2],'trace entries lost'
rows=[]
for line in trace.splitlines():
 m=re.search(r' (\d+\.\d+): (frame|pose_read|tex_read|pose_write|tex_publish|tracing_mark_write): (.*)',line)
 if m:rows.append((float(m[1]),m[2],m[3]))
rows.sort()
frame=0;pending=None;pairs=[];unclassified=0;begins={};windows={};waits={}
for t,kind,data in rows:
 if kind=='tracing_mark_write':
  w=re.search(r'pp_gpu wait_done (\d+)',data)
  if w:waits[int(w[1])]=t
  m=re.search(r'pp_gpu pair_(begin|done) (\d+)',data)
  if m:
   g=int(m[2])
   if m[1]=='begin':begins[g]=t
   elif g in begins:windows[g]=(begins[g],t)
 elif kind=='frame':frame+=1;pending=None
 elif kind in ('pose_read','tex_read'):
  m=re.search(r'index=(\d+)',data)
  if not m or int(m[1])!=slot:continue
  if kind=='pose_read':
   chunks=[re.search(r'm'+str(i)+r'=(0x[0-9a-f]+)',data) for i in range(6)]
   if not all(chunks):unclassified+=1;pending=None;continue
   values=struct.unpack('<12f',b''.join(int(m[1],16).to_bytes(8,'little') for m in chunks))
   errors={g:max(abs(a-b) for a,b in zip(values,p)) for g,p in poses.items()}
   g=min(errors,key=errors.get)
   if errors[g]>2e-7:unclassified+=1;pending=None;continue
   pending=(t,g,frame,errors[g])
  elif pending:
   handle=int(re.search(r'texture=(\d+)',data)[1]);g=textures.get(handle)
   if g is None:unclassified+=1;pending=None;continue
   pt,pg,pf,error=pending;pending=None
   pairs.append(dict(frame=pf,pose_t=pt,texture_t=t,pose_generation=pg,texture_generation=g,pose_error=error,read_gap_ms=(t-pt)*1000))
def quantiles(v):
 v=sorted(v)
 return {k:v[int(q*(len(v)-1))] for k,q in [('p50',.5),('p95',.95),('max',1)]} if v else {}
mixed=[p for p in pairs if p['pose_generation']!=p['texture_generation']]
for p in mixed:
 w=windows.get(p['texture_generation'])
 p['texture_pair_window']=w
 p['wait_done_t']=waits.get(p['texture_generation'])
 p['wait_to_pair_ms']=(w[0]-p['wait_done_t'])*1000 if w and p['wait_done_t'] is not None else None
 p['whole_pair_between_reads']=bool(w and p['pose_t']<w[0] and w[1]<p['texture_t'])
summary=dict(wait_to_pair_ms=quantiles([(a-waits[g])*1000 for g,(a,b) in windows.items() if g in waits]),slot=slot,producer_generations=len(poses),classified_pairs=len(pairs),unclassified_reads=unclassified,mixed_pairs=len(mixed),whole_pair_crossings=sum(p['whole_pair_between_reads'] for p in mixed),read_gap_ms=quantiles([p['read_gap_ms'] for p in pairs]),setter_pair_ms=quantiles([(b-a)*1000 for a,b in windows.values()]),examples=mixed[:8],trace_entries=int(counts[1]))
Path(str(prefix)+'.pairs.json').write_text(json.dumps(pairs,indent=2))
Path(str(prefix)+'.summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
