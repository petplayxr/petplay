import sys,subprocess
so=sys.argv[1]; d=open(so,'rb').read()
out=subprocess.run(["readelf","-lW",so],capture_output=True,text=True).stdout
segs=[(int(p[1],16),int(p[2],16),int(p[4],16)) for p in (l.split() for l in out.splitlines()) if p and p[0]=="LOAD"]
def off(va):
    for o,v,sz in segs:
        if v<=va<v+sz: return o+va-v
for a in sys.argv[2:]:
    o=off(int(a,16)); print(a, d[o:d.find(b'\0',o)][:120])
