import re,sys,collections,bisect
by=collections.defaultdict(list)
for l in open(sys.argv[1]):
    if l.startswith("#"): continue
    m=re.match(r"\s*(.+?)-(\d+)\s+\[\d+\]\s+\S+\s+([\d.]+):\s+(\S+):\s?(.*)",l)
    if not m: continue
    comm,tid,t,name,rest=m.groups(); t=float(t)*1000
    if name=="drm_vblank_event":
        name="vblank_crtc"+re.search(r"crtc=(\d+)",rest).group(1)
    elif name=="tracing_mark_write":
        mm=re.match(r"(\[[^\]]+\]\s*[A-Za-z\- ]*?)(?:\s*(begin_ctx|end_ctx)|:|\[|\(| id=| \d|$)",rest)
        if not mm: continue
        tg=re.search(r"tgid=(\d+)",rest)
        name=mm.group(1).strip()+(" "+mm.group(2)[:-4] if mm.group(2) else "")+(" tgid"+tg.group(1) if tg and "SetOverlay" in rest else "")
        if "petplay" in rest and "SubmitRenderPass" in rest: name+=" petplay"
    by[name].append(t)
vb=sorted(next(v for n,v in by.items() if n.startswith("vblank") and abs(sorted(b-a for a,b in zip(v,v[1:]))[len(v)//2]-13.333)<0.3))
def ph(t):
    i=bisect.bisect_right(vb,t)-1
    return t-vb[i] if i>=0 else None
rows=[]
pat=re.compile(sys.argv[2]) if len(sys.argv)>2 else None
for n,ts in by.items():
    if n.startswith("vblank") or len(ts)<20: continue
    if pat and not pat.search(n): continue
    p=sorted(x for x in (ph(t) for t in ts) if x is not None)
    q=lambda f:p[int(f*(len(p)-1))]
    rows.append((q(.5),n,len(p),q(0),q(.05),q(.95),q(1)))
for r in sorted(rows): print("%-55s n=%5d p50 %6.2f | min %6.2f p5 %6.2f p95 %6.2f max %6.2f"%(r[1][:55],r[2],r[0],r[3],r[4],r[5],r[6]))
