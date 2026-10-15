#!/usr/bin/env python3
"""Count compositor scenegraph snapshots of four bank handles: trace A_L A_R B_L B_R."""
import collections
import json
import re
import sys

indices = [int(s) for s in sys.argv[2:]]
if len(indices) != 4 or len(set(indices)) != 4:
    raise SystemExit("usage: bank-switch-states.py capture.trace A_L A_R B_L B_R")
frames = []
current = None
with open(sys.argv[1]) as source:
    for line in source:
        if ": frame:" in line:
            match = re.search(r"(\d+\.\d+): frame:", line)
            current = {"time": float(match[1]), "visibility": {}}
            frames.append(current)
        if ": visibility:" in line and current is not None:
            match = re.search(r"index=(\d+) flags=(\d+) kind=(\d+)", line)
            if match and int(match[1]) in indices:
                if int(match[3]) != 8:
                    continue  # Creation/setup can be captured before projection is configured.
                current["visibility"][int(match[1])] = int(bool(int(match[2]) & 8))
counts = collections.Counter(
    tuple(f["visibility"][i] for i in indices)
    for f in frames if len(f["visibility"]) == 4
)
print(json.dumps({"indices": indices, "complete_snapshots": sum(counts.values()),
                  "states": {"/".join(map(str, k)): n for k, n in counts.items()}}, indent=2))
