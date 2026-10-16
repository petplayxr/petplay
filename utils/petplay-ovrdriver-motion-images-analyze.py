#!/usr/bin/env python3
"""Fit fixed-frequency motion; remove constant phase/gain before measuring residuals.
Producer CPU timestamps are not display times. Fits are diagnostics, not proof of
physical-HMD jitter or an absolute motion-to-photon measurement.
"""
import argparse
import json
import math
from pathlib import Path


def quantiles(values):
    s = sorted(values)
    return {"min": s[0], "p50": s[len(s)//2], "p95": s[min(len(s)-1, int(len(s)*.95))], "max": s[-1]}


def solve(matrix, vector):
    a = [list(row) + [value] for row, value in zip(matrix, vector)]
    for i in range(len(a)):
        pivot = max(range(i, len(a)), key=lambda j: abs(a[j][i]))
        a[i], a[pivot] = a[pivot], a[i]
        if abs(a[i][i]) < 1e-12:
            raise ValueError("Singular trajectory fit")
        divisor = a[i][i]
        a[i] = [x / divisor for x in a[i]]
        for j in range(len(a)):
            if j != i:
                scale = a[j][i]
                a[j] = [x-scale*y for x, y in zip(a[j], a[i])]
    return [row[-1] for row in a]


def fit(times, positions, frequency, epoch):
    if len(times) < 30:
        raise ValueError("Need at least 30 samples")
    omega = 2*math.pi*frequency
    basis = [[1, math.sin(omega*(t-epoch)), math.cos(omega*(t-epoch))] for t in times]
    coefficients = solve([[sum(row[i]*row[j] for row in basis) for j in range(3)] for i in range(3)],
                         [sum(row[i]*x for row, x in zip(basis, positions)) for i in range(3)])
    predicted = [sum(a*b for a, b in zip(coefficients, row)) for row in basis]
    residual = [x-y for x, y in zip(positions, predicted)]
    return {"samples": len(times), "offset": coefficients[0],
            "amplitude": math.hypot(*coefficients[1:]),
            "phaseLeadMs": math.atan2(coefficients[2], coefficients[1])/omega*1000,
            "absoluteResidual": quantiles([abs(x) for x in residual]),
            "residualStep": quantiles([abs(b-a) for a, b in zip(residual, residual[1:])]),
            "unexpectedRepeats": sum(abs(b-a) < .2 and abs(pb-pa) > 1.5
                                     for a,b,pa,pb in zip(positions,positions[1:],predicted,predicted[1:]))}


def frame_delivery(samples, producer):
    invalid = [r for r in samples if not r.get("frameIdValid")]
    if invalid:
        raise ValueError(f"Frame ID invalid in {len(invalid)}/{len(samples)} images; do not infer repeated frames")
    published = {r["generation"]: r for r in producer if r["published"]}
    unknown = sorted({r["frameId"] for r in samples if r["frameId"] not in published})
    if unknown:
        raise ValueError(f"Captured IDs absent from successful publication log: {unknown}")
    deltas = [b["frameId"]-a["frameId"] for a,b in zip(samples,samples[1:])]
    events = [{"submission": b["submission"], "previous": a["frameId"], "current": b["frameId"], "delta": b["frameId"]-a["frameId"]}
              for a,b in zip(samples,samples[1:]) if b["frameId"]-a["frameId"] != 1]
    result = {"decoded": len(samples), "firstId": samples[0]["frameId"], "lastId": samples[-1]["frameId"],
              "repeatedFrames": sum(d==0 for d in deltas), "skippedProducerIds": sum(max(0,d-1) for d in deltas),
              "backwardFrames": sum(d<0 for d in deltas), "events": events}
    timestamped = [r for r in samples if published[r["frameId"]].get("sampleMonotonicSeconds")]
    if timestamped:
        result["sampleToCopySubmitMs"] = quantiles([(r["submittedNs"]/1e9-published[r["frameId"]]["sampleMonotonicSeconds"])*1000 for r in timestamped])
        result["publicationEndToCopySubmitMs"] = quantiles([(r["submittedNs"]/1e9-published[r["frameId"]]["publicationMonotonicSeconds"])*1000 for r in timestamped])
        result["predictionTargetLeadAtCopySubmitMs"] = quantiles([(published[r["frameId"]]["sampleMonotonicSeconds"]+published[r["frameId"]]["predictionMs"]/1000-r["submittedNs"]/1e9)*1000 for r in timestamped])
    return result


def analyze(probe, capture):
    records = []
    # The general lab probe emits one pretty-printed leading cadence report.
    decoder = json.JSONDecoder()
    text = Path(probe).read_text()
    while text.strip():
        text = text.lstrip()
        try:
            record, end = decoder.raw_decode(text)
        except json.JSONDecodeError:
            # Raylib/actor startup may also log ordinary text on stdout.
            _, separator, text = text.partition("\n")
            if not separator:
                break
            continue
        records.append(record)
        text = text[end:]
    report = next(r for r in records if isinstance(r, dict) and r.get("experiment") == "motion-images")
    rows = [json.loads(line) for line in (Path(capture)/"motion.ndjson").read_text().splitlines()]
    complete = json.loads((Path(capture)/"motion.complete").read_text())
    if complete != report["completion"] or complete["writeFailed"] or len(rows) != complete["copiedImages"]:
        raise ValueError("Capture/probe accounting mismatch")
    if complete["droppedImages"]:
        raise ValueError("Capture dropped images: measurement needs investigation")
    if len(rows) != complete["attempts"]*2 or complete["attempts"] != 450:
        raise ValueError("Expected exactly two eye images for each of 450 submissions")
    missing = [r for r in rows if r["count"] == 0]
    if missing:
        raise ValueError(f"Marker missing in {len(missing)}/{len(rows)} images")
    identity_coverage = None
    if report.get("renderer") and any("frameIdValid" in r for r in rows):
        identity_coverage = {"images": len(rows), "valid": sum(bool(r.get("frameIdValid")) for r in rows)}
        if identity_coverage["valid"] != len(rows):
            raise ValueError(f"Invalid frame IDs including warmup: {identity_coverage}")
        published_ids = {r["generation"] for r in report["renderer"]["rows"] if r["published"]}
        if any(r["frameId"] not in published_ids for r in rows):
            raise ValueError("Captured ID absent from successful publication log, including warmup")
    # Allocation/first-use warmup: exclude the first 30 producer submissions.
    cutoff = sorted(set(r["submission"] for r in rows))[30]
    rows = [r for r in rows if r["submission"] >= cutoff]
    frequency, epoch = report["config"]["frequencyHz"], report["epochSeconds"]
    images = []
    for inode in sorted(set(r["inode"] for r in rows)):
        samples = sorted((r for r in rows if r["inode"] == inode), key=lambda r:r["submittedNs"])
        result = fit([r["submittedNs"]/1e9 for r in samples], [r["sumX"]/r["count"] for r in samples], frequency, epoch)
        result.update(inode=inode, units="pixels", markerPixels=quantiles([r["count"] for r in samples]))
        images.append(result)
    # Group the triple-buffered images by their fitted stereo offset. Never
    # difference samples from different eyes or mistake ring reuse for a frame.
    midpoint = (min(i["offset"] for i in images) + max(i["offset"] for i in images))/2
    eyes = []
    for side in (0, 1):
        members = [i["inode"] for i in images if int(i["offset"] > midpoint) == side]
        samples = sorted((r for r in rows if r["inode"] in members), key=lambda r:r["submittedNs"])
        if len({r["submission"] for r in samples}) != len(samples):
            raise ValueError("Stereo clustering assigned two images of one submission to the same eye")
        result = fit([r["submittedNs"]/1e9 for r in samples], [r["sumX"]/r["count"] for r in samples], frequency, epoch)
        result.update(inodes=members, units="pixels", intervalMs=quantiles([(b["submittedNs"]-a["submittedNs"])/1e6 for a,b in zip(samples,samples[1:])]))
        if report.get("renderer") and any("frameIdValid" in r for r in samples):
            result["frameDelivery"] = frame_delivery(samples, report["renderer"]["rows"])
        eyes.append(result)
    stereo = None
    if report.get("renderer") and any("frameIdValid" in r for r in rows):
        paired = {}
        for r in rows:
            paired.setdefault(r["submission"], []).append(r)
        stereo = {"submissions": len(paired), "mismatchedIds": [
            {"submission": submission, "ids": [r["frameId"] for r in pair]}
            for submission, pair in paired.items() if len(pair) != 2 or pair[0]["frameId"] != pair[1]["frameId"]]}
    poses = [r for r in report["rows"] if r["stage"] == "capture-on" and r["valid"]]
    pose_fit = fit([(r["before"]+r["after"])/2 for r in poses], [r["x"]*1000 for r in poses], frequency, epoch) if poses else {"scope":"Public pose samples not recorded in renderer-only probe"}
    pose_fit["units"] = "millimeters"
    producer = None
    if report.get("renderer"):
        samples = report["renderer"]["rows"]
        producer = {"samples": len(samples), "published": sum(r["published"] for r in samples),
                    "predictionMs": quantiles([r["predictionMs"] for r in samples]),
                    "publicationIntervalMs": quantiles([b["publicationEndMs"]-a["publicationEndMs"] for a,b in zip(samples,samples[1:])]),
                    "renderDurationMs": quantiles([r["renderEndMs"]-r["renderStartMs"] for r in samples]),
                    "distinctOutputTextures": len({r["textures"]["output"] for r in samples})}
        timestamped = [r for r in samples if r.get("sampleMonotonicSeconds")]
        if timestamped:
            errors = [abs(r["x"] - (-.25 + .12*math.sin(2*math.pi*frequency*(r["sampleMonotonicSeconds"]+r["predictionMs"]/1000-epoch))))*1000 for r in timestamped]
            producer["predictedPoseErrorMm"] = quantiles(errors)
    return {"publication": report.get("publication", "unrecorded; consult probe command"), "accounting": complete, "perImageTrajectory": images, "perEyeTrajectory": eyes, "stereoFrameIdentity": stereo, "frameIdentityCoverage": identity_coverage, "publicPoseTrajectory": pose_fit, "producer": producer,
            "completionPollDelayMs": quantiles([(r["completedNs"]-r["submittedNs"])/1e6 for r in rows]),
            "cpuAnalysisMs": quantiles([(r["analyzeEndNs"]-r["analyzeBeginNs"])/1e6 for r in rows]),
            "cadence": [r for r in records if isinstance(r, dict) and r.get("experiment") == "motion-image-cadence"],
            "limits": "Per-inode fits remove constant phase/gain. Timestamps are producer CPU times, not GPU execution or display times. Synthetic driver disables Linux async reprojection."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("probe")
    parser.add_argument("capture")
    args = parser.parse_args()
    print(json.dumps(analyze(args.probe, args.capture), indent=2))
