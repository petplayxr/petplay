"""Usage: snapshot-pairs.py capture.trace [overlay-slot-index ...]

Reports API-publication counts, not the pixel generations the GPU samples.
Pass PetPlay's slot indices to exclude other clients. With no indices, report slots
that have both producer updates and compositor reads in the trace.
"""
import collections
import json
import re
import sys

rows = []
for line in open(sys.argv[1]):
    match = re.search(
        r"\s(\d+\.\d+): (pose_read|tex_read|pose_write|tex_write): .*? (index|handle)=(\d+)",
        line,
    )
    if match:
        timestamp, kind, _, index = match.groups()
        rows.append((float(timestamp), kind, int(index) & 0xffffffff, line.strip()))
# A multi-CPU trace need not be in exact timestamp order.
rows.sort(key=lambda row: row[0])
latest = collections.defaultdict(lambda: {"tex": 0, "pose": 0})
poses = {}
pairs = []
for timestamp, kind, index, line in rows:
    if kind.endswith("write"):
        latest[index][kind.split("_")[0]] += 1
    elif kind == "pose_read":
        poses[index] = (timestamp, latest[index]["pose"])
    elif index in poses:
        pose_time, pose_count = poses.pop(index)
        handle = re.search(r"texture=(\d+)", line)
        pairs.append({
            "index": index,
            "pose_t": pose_time,
            "tex_t": timestamp,
            "delay_ms": (timestamp - pose_time) * 1000,
            "pose_publications": pose_count,
            "texture_publications": latest[index]["tex"],
            "shared_handle": int(handle[1]) if handle else None,
        })
indices = [int(value, 0) for value in sys.argv[2:]] or sorted(latest)
for index in indices:
    selected = [pair for pair in pairs if pair["index"] == index]
    if not selected:
        continue
    delays = sorted(pair["delay_ms"] for pair in selected)
    mismatches = [pair for pair in selected if pair["pose_publications"] != pair["texture_publications"]]
    quantile = lambda fraction: delays[int(fraction * (len(delays) - 1))]
    print(json.dumps({
        "index": index, "pairs": len(selected),
        "delay_ms": {"p50": quantile(.5), "p95": quantile(.95), "max": delays[-1]},
        "distinct_shared_handles": sorted({pair["shared_handle"] for pair in selected if pair["shared_handle"] is not None}),
        "publication_count_differences": len(mismatches),
        "examples": mismatches[:2],
    }))
