#!/usr/bin/env python3
"""Full-scene wrist sweep: rate residuals on constant-speed legs, not duplicate counting.
Frame ordinals at the synthetic runtime's 75 Hz define the reference grid. Fixed
phase is fitted out independently per leg. Apparent timing error also includes
rasterization/resampling; it is not a physical presentation timestamp.
"""
import argparse
import json
import math
from pathlib import Path


def stats(values):
    values = sorted(values)
    if not values:
        return None
    return {"min": values[0], "p50": values[len(values)//2], "p95": values[min(len(values)-1,int(len(values)*.95))], "max": values[-1]}


def linear_fit(samples):
    ts = [a for a,b in samples]
    xs = [b for a,b in samples]
    mt, mx = sum(ts)/len(ts), sum(xs)/len(xs)
    slope = sum((t-mt)*(x-mx) for t,x in samples)/sum((t-mt)**2 for t in ts)
    intercept = mx-slope*mt
    errors = [x-(intercept+slope*t) for t,x in samples]
    return slope, intercept, errors


def polygon_centroid(points):
    area = sx = sy = 0
    for p,q in zip(points, points[1:]+points[:1]):
        cross=p[0]*q[1]-q[0]*p[1]
        area+=cross; sx+=(p[0]+q[0])*cross; sy+=(p[1]+q[1])*cross
    if abs(area)<1e-8:
        raise ValueError("Degenerate projected marker")
    return sx/(3*area), sy/(3*area)


def shifted_projection(pub, side, delta_x):
    head=pub["head"]
    if any(abs(head[i]-(1 if i in (0,5,10) else 0))>1e-5 for i in [0,1,2,4,5,6,8,9,10]):
        raise ValueError("Sweep rate reference requires fixed unrotated synthetic head")
    points=[]
    focal=pub["leftProjection"][0]*480
    for world,projected in zip(pub["marker"]["worldCorners"],pub["marker"][side]["corners"]):
        depth=-(world[2]-head[14])
        if depth<=0:
            raise ValueError("Marker behind head")
        points.append([projected["x"]+delta_x*focal/depth,projected["y"]])
    return polygon_centroid(points)[0]


def analyze(probe_path, directory):
    probe = json.loads(Path(probe_path).read_text())
    label = probe.get("captureLabel", "motion")
    rows = [json.loads(line) for line in (Path(directory)/(label+".ndjson")).read_text().splitlines()]
    completion = json.loads((Path(directory)/(label+".complete")).read_text())
    if completion != probe["completion"] or completion["copiedImages"] != len(rows) or completion["droppedImages"] or completion["writeFailed"]:
        raise ValueError("Capture accounting failure")
    if len(rows) != 900 or completion["attempts"] != 450:
        raise ValueError("Expected 450 stereo submissions")
    publications = {r["generation"]:r for r in probe["renderer"]["rows"] if r["published"]}
    for r in rows:
        if not r.get("frameIdValid") or r["frameId"] not in publications:
            raise ValueError("Invalid or unknown frame ID")
        if not r.get("wristCount"):
            raise ValueError("Wrist marker missing: reject occlusion/visibility before estimating phase")
    submissions = sorted({r["submission"] for r in rows})
    if len(submissions) != 450:
        raise ValueError("Submission accounting failure")
    ordinals = {submission:i for i,submission in enumerate(submissions)}
    paired = {}
    for r in rows:
        paired.setdefault(r["submission"],[]).append(r)
    if any(len(pair)!=2 for pair in paired.values()):
        raise ValueError("Expected two images per submission")
    copy_times=[sum(r["submittedNs"] for r in paired[s])/len(paired[s])/1e6 for s in submissions][30:]
    copy_intervals=[b-a for a,b in zip(copy_times,copy_times[1:])]
    if min(copy_intervals)<5 or max(copy_intervals)>25:
        raise ValueError("Capture cadence does not support a continuous synthetic 75 Hz ordinal reference")
    # Classify stereo using the head-fixed tag's location, supplied by the layer,
    # rather than controller position. Sweeps can cross the center of the view.
    inodes = {}
    for inode in {r["inode"] for r in rows}:
        group = [r for r in rows if r["inode"]==inode]
        inodes[inode] = sum(r["idFirstX"] for r in group)/len(group)
    center = (min(inodes.values())+max(inodes.values()))/2
    results=[]
    for side in ["left","right"]:
        # Left eye sees head-fixed strip shifted right (negative eye offset).
        members={inode for inode,offset in inodes.items() if (offset>center)==(side=="left")}
        samples=sorted([r for r in rows if r["inode"] in members],key=lambda r:r["submission"])
        if len(samples)!=450 or len({r["submission"] for r in samples})!=450:
            raise ValueError("Invalid stereo grouping")
        legs={}
        geometry=[]
        for r in samples:
            if ordinals[r["submission"]]<30:
                continue
            pub=publications[r["frameId"]]
            target=pub["sampleMonotonicSeconds"]+pub["predictionMs"]/1000
            hand=0 if pub["marker"]["space"].startswith("left") else 1
            halfcycle=(target-probe["epochSeconds"])*probe["config"]["frequencyHz"]*2+hand*.5
            leg=math.floor(halfcycle)
            fraction=halfcycle-leg
            # 80% plateau, with extra 50 ms guard on either side.
            guard=.05*probe["config"]["frequencyHz"]*2
            if not .1+guard < fraction < .9-guard:
                continue
            centroid=r["wristSumX"]/r["wristCount"]
            expected=pub["marker"][side]["x"]
            geometry.append(centroid-expected)
            legs.setdefault(leg,[]).append((ordinals[r["submission"]],centroid,pub,r))
        summaries=[]
        for leg,group in sorted(legs.items()):
            if len(group)<15:
                continue
            slope,intercept,pixel_line_errors=linear_fit([(frame,x) for frame,x,_,_ in group])
            world_slope,world_intercept,world_errors=linear_fit([(frame,pub["marker"]["world"][0]) for frame,_,pub,_ in group])
            # Evaluate the actual tilted quad at a constant-speed world reference.
            # This keeps perspective/nonlinear area-centroid geometry in the model.
            errors=[]
            expected_steps=[]
            for frame,x,pub,_ in group:
                dx=world_intercept+world_slope*frame-pub["marker"]["world"][0]
                expected=shifted_projection(pub,side,dx)
                errors.append(x-expected)
                expected_steps.append(shifted_projection(pub,side,dx+world_slope)-expected)
            mean=sum(errors)/len(errors)
            errors=[e-mean for e in errors]  # Fixed raster calibration is not shaking.
            image_step=sum(expected_steps)/len(expected_steps)
            direction=1 if leg%2==0 else -1
            velocity=direction*4*probe["config"]["frequencyHz"]*probe["config"]["positionAmplitudeM"]/.9
            summaries.append({"leg":leg,"direction":direction,"samples":len(group),"slopePxPerFrame":slope,
                "projectedReferenceStepPx":image_step,"renderedWorldSpeedMPerSecond":world_slope*75,"commandedSpeedMPerSecond":velocity,
                "renderedWorldRateResidualMm":stats([abs(e)*1000 for e in world_errors]),
                "absoluteResidualPx":stats([abs(x) for x in errors]),
                "uncorrectedLineResidualPx":stats([abs(x) for x in pixel_line_errors]),
                "apparentTimingResidualMs":stats([abs(x/image_step)*1000/75 for x in errors]),
                "residualStepPx":stats([abs(b-a) for a,b in zip(errors,errors[1:])])})
        if not any(r["direction"]==1 for r in summaries) or not any(r["direction"]==-1 for r in summaries):
            raise ValueError("Need accepted constant-speed legs in both directions")
        results.append({"eye":side,"legs":summaries,"centroidMinusRenderedProjectionPx":stats(geometry),
            "repeatedIds":sum(a["frameId"]==b["frameId"] for a,b in zip(samples,samples[1:]))})
    return {"condition":probe["condition"],"mode":probe.get("mode"),"coverage":{"images":len(rows),"validIds":len(rows)},"copySubmissionIntervalMs":stats(copy_intervals),"eyes":results,
        "limits":"Constant offset/rate fitted per leg on synthetic 75 Hz ordinal grid. Apparent timing residual includes spatial error. Not physical scanout latency."}


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("probe")
    p.add_argument("directory")
    args=p.parse_args()
    print(json.dumps(analyze(args.probe,args.directory),indent=2))
