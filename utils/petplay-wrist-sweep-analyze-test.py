#!/usr/bin/env python3
"""Independent controls: fresh IDs with alternating pose-time error must register as shake."""
import importlib.util
import json
import math
import tempfile
from pathlib import Path

spec=importlib.util.spec_from_file_location("wrist_analyzer",Path(__file__).with_name("petplay-wrist-sweep-analyze.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def sweep(t):
    cycle=(t*.35+.25)%1
    direction=1 if cycle<.5 else -1
    phase=(cycle if cycle<.5 else cycle-.5)*2
    ramp=.1
    if phase<ramp:
        distance=.5*(phase-ramp/math.pi*math.sin(math.pi*phase/ramp))
    elif phase>1-ramp:
        u=phase-(1-ramp)
        distance=phase-ramp/2-.5*(u-ramp/math.pi*math.sin(math.pi*u/ramp))
    else:
        distance=phase-ramp/2
    return direction*(2*distance/(1-ramp)-1)


def fixture(folder,jitter_seconds):
    publications=[]
    images=[]
    for frame in range(450):
        t=frame/75
        x=.25+.12*sweep(t+(jitter_seconds if frame%2 else -jitter_seconds))
        corners=[[x+dx,1.2+dy,-.5] for dx,dy in [(-.01,-.01),(.01,-.01),(.01,.01),(-.01,.01)]]
        def project(eye):
            points=[{"x":479.5+(p[0]-eye)*960,"y":479.5-(p[1]-1.6)*960} for p in corners]
            return {"x":sum(p["x"] for p in points)/4,"y":sum(p["y"] for p in points)/4,"corners":points}
        marker={"space":"right-hand","world":[x,1.2,-.5],"worldCorners":corners,"left":project(-.032),"right":project(.032)}
        publications.append({"generation":frame+1,"published":True,"sampleMonotonicSeconds":100+t,"predictionMs":0,"marker":marker,
            "head":[1,0,0,0,0,1,0,0,0,0,1,0,0,1.6,0,1],"leftProjection":[1]+[0]*15})
        for eye,side in enumerate(["left","right"]):
            images.append({"submittedNs":int((100+t)*1e9),"submission":frame+1,"inode":100+frame%3+eye*3,"frameIdValid":True,"frameId":frame+1,"wristCount":1000,
                "wristSumX":marker[side]["x"]*1000,"wristSumY":marker[side]["y"]*1000,"idFirstX":162 if eye==0 else 100})
    complete={"attempts":450,"copiedImages":900,"droppedImages":0,"writeFailed":False}
    (folder/"test.ndjson").write_text("\n".join(json.dumps(r) for r in images))
    (folder/"test.complete").write_text(json.dumps(complete))
    path=folder/"probe.json"
    path.write_text(json.dumps({"captureLabel":"test","condition":"test","mode":"test","epochSeconds":100,
        "config":{"frequencyHz":.35,"positionAmplitudeM":.12},"completion":complete,"renderer":{"rows":publications}}))
    return module.analyze(path,folder)


with tempfile.TemporaryDirectory() as temp:
    folder=Path(temp)
    for jitter in [0,.003]:
        result=fixture(folder,jitter)
        for eye in result["eyes"]:
            assert eye["repeatedIds"]==0
            assert max(abs(eye["centroidMinusRenderedProjectionPx"][k]) for k in ["min","max"])<1e-8
            for leg in eye["legs"]:
                residual=leg["apparentTimingResidualMs"]["p95"]
                assert residual<1e-6 if jitter==0 else 2.5<residual<3.5,(jitter,leg)
print("PASS: unique frames with ±3 ms pose-time alternation detected; zero-jitter/perspective geometry control stays clean")
