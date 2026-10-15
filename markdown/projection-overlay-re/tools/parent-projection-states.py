#!/usr/bin/env python3
"""Summarize parent gating and inherited projection: trace parent left-child right-child."""
import collections
import json
import re
import sys

indices = [int(s) for s in sys.argv[2:]]
if len(indices) != 3 or len(set(indices)) != 3:
    raise SystemExit("usage: parent-projection-states.py trace parent left-child right-child")
frames = []
frame = None
with open(sys.argv[1]) as source:
    for line in source:
        if ": frame:" in line:
            frame = {"nodes": {}, "textures": [], "poses": {}}
            frames.append(frame)
        if frame is None:
            continue
        match = re.search(r"visibility:.*index=(\d+) kind=(\d+).*enabled=(\d+)", line)
        if match and int(match[1]) in indices:
            frame["nodes"][int(match[1])] = (int(match[2]), int(match[3]) & 1)
        match = re.search(r"tex_read:.*index=(\d+)", line)
        if match and int(match[1]) in indices:
            frame["textures"].append(int(match[1]))
        match = re.search(r"pose_record:.*index=(\d+) (.*)", line)
        if match and int(match[1]) in indices:
            frame["poses"][int(match[1])] = match[2]
counts = collections.Counter()
shapes = collections.Counter()
parent_pose_matches = 0
independent_child_poses = 0
for frame in frames:
    nodes = frame["nodes"]
    if len(nodes) != 3 or any(nodes[i][0] != 8 for i in indices[1:]):
        continue  # Initial subview creation is the control, not the projection-conversion test.
    textures = tuple(i in frame["textures"] for i in indices)
    counts[(nodes[indices[0]][1], textures)] += 1
    poses = frame["poses"]
    if all(i in poses for i in indices):
        for i in indices[1:]:
            shapes[re.search(r"shape=(\d+)", poses[i])[1]] += 1
            if poses[i] == poses[indices[0]]:
                parent_pose_matches += 1
            else:
                independent_child_poses += 1
print(json.dumps({
    "indices": indices,
    "projection_snapshots": sum(counts.values()),
    "parent_enabled_and_texture_selection": {
        str(k): n for k, n in counts.items()
    },
    "child_shapes": dict(shapes),
    "child_records_matching_parent_pose_and_shape": parent_pose_matches,
    "child_records_differing_from_parent_pose_or_shape": independent_child_poses,
}, indent=2))
