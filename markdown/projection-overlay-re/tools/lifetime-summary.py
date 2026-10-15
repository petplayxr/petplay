#!/usr/bin/env python3
"""Summarize image generations and lifecycle events; not headset pixel-generation proof."""
import collections
import json
import re
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: lifetime-summary.py trace publisher.api.txt")
api = open(sys.argv[2]).read()
pid_match = re.search(r"(?:probe )?pid (\d+)", api)
if not pid_match:
    raise SystemExit("publisher PID missing from API output")
pid = pid_match[1]
handles = set(re.findall(r"shared (\d+) modifier", api))
events = []
with open(sys.argv[1]) as source:
    for line in source:
        match = re.search(r"(\d+\.\d+): (\w+):", line)
        if not match:
            continue
        own = bool(re.search(r"-" + pid + r"\s", line))
        data = dict(re.findall(r"(\w+)=(\S+)", line))
        event = match[2]
        events.append((float(match[1]), event, data, own, line))
        if event == "client_publish" and own:
            handles.add(data["shared"])
events.sort(key=lambda row: row[0])
records = collections.defaultdict(list)
# Addresses can be reused for successive generations. Attribute each lifecycle event
# to the currently observed shared handle at that address, never to every historic alias.
current = {}
marks, releases, destroys = (collections.Counter() for _ in range(3))
active, seen, null_selected = set(), set(), set()
peak = 0
client_copy_calls = 0
signal_time = None
signal_count = 0
wait_entry = 0
wait_results = collections.Counter()
published = {}
handoffs = 0
unverified_handoffs = 0
last_publication = max((t for t, ev, d, own, line in events
                        if ev == "client_publish" and own), default=0)
destructions_during_publication = 0
for timestamp, event, data, own, line in events:
    if event == "sampled" and data.get("handle") in handles:
        h = data["handle"]
        # Failed/null nested user-memory reads have meaningless downstream fields.
        if data.get("wrapper") == "0x0" or data.get("backend") == "0x0":
            null_selected.add(h)
            continue
        key = (h, data["backend"])
        records[key].append(data)
        current[data["backend"]] = key
        if key not in seen:
            seen.add(key)
            active.add(key)
            peak = max(peak, len(active))
    elif event in ("mark", "release", "image_destroy"):
        key = current.get(data.get("object"))
        if key is not None:
            if event == "mark":
                marks[key] += 1
            elif event == "release":
                releases[key] += 1
            else:
                destroys[key] += 1
                active.discard(key)
                current.pop(data["object"], None)
                if timestamp < last_publication:
                    destructions_during_publication += 1
    elif event == "frame_sync_signal":
        signal_time = timestamp
        signal_count += 1
    if not own:
        continue
    if event == "client_copy":
        client_copy_calls += 1
    elif event == "client_publish":
        published[data["shared"]] = timestamp
    elif event == "client_wait":
        wait_entry = signal_count
    elif event == "client_wait_result":
        wait_results[(data["result"], signal_count - wait_entry)] += 1
    match = re.search(r"pp_gpu frame_sync_done (\d+)", line)
    if match:
        handoffs += 1
        if signal_time is None or signal_time <= published[match[1]]:
            unverified_handoffs += 1
imported_handles = {h for h, o in records}
print(json.dumps({
    "publisher_pid": int(pid), "published_shared_handles": sorted(handles, key=int),
    "client_vulkan_copy_calls": client_copy_calls,
    "selected_null_handles": sorted(null_selected, key=int),
    "selected_handles_never_imported": sorted(null_selected - imported_handles, key=int),
    "peak_observed_live_images": peak, "observed_images_remaining": len(active),
    "backend_destructions_before_final_publication": destructions_during_publication,
    "own_wait_result_and_signal_count": {str(k): n for k, n in wait_results.items()},
    "post_publication_handoffs": handoffs, "handoffs_without_observed_signal": unverified_handoffs,
    "images": [{
        "shared_handle": h, "backend": o, "record_observations": len(rs),
        "native_images_in_compositor": sorted({r["native"] for r in rs}),
        "last_use_points_observed": len({(r["use"], r["sub"]) for r in rs}),
        "mark_in_use_calls": marks[(h, o)], "release_calls": releases[(h, o)],
        "backend_destroy_calls": destroys[(h, o)],
    } for (h, o), rs in records.items()],
}, indent=2))
