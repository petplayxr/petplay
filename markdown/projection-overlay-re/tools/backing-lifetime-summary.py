#!/usr/bin/env python3
"""Correlate actual import identities with deferred backing-memory frees.
Build-specific trace evidence; does not prove pixels, all paths, or a reuse fence.
"""
import collections
import json
import re
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: backing-lifetime-summary.py trace publisher.api.txt')
handles = set(re.findall(r'shared (\d+) modifier', open(sys.argv[2]).read()))
pending_import = {}
pending_poll = {}
completed = set()
current = {}
rows = []
for line in open(sys.argv[1]):
    match = re.search(r'-(\d+)\s+.*? (\d+\.\d+): (\w+):', line)
    if not match:
        continue
    tid, timestamp, event = match.groups()
    timestamp = float(timestamp)
    data = dict(re.findall(r'(\w+)=(\S+)', line))
    if event == 'import_begin':
        pending_import[tid] = data['shared']
    elif event == 'import_end':
        handle = pending_import.pop(tid, None)
        if handle not in handles or data.get('wrapper') == '0x0':
            continue
        row = dict(shared=handle, backend=data['backend'], memory=data.get('memory'),
                   imported=timestamp, timeline='0x0', use='0', sub='0', marks=0)
        rows.append(row)
        current[data['backend']] = row
    elif event == 'poll':
        pending_poll[tid] = (data['timeline'], data['use'], data['sub'])
    elif event == 'poll_result':
        point = pending_poll.pop(tid, None)
        if point and data['result'] == '0':
            completed.add(point)
    elif event in ('mark', 'release', 'image_destroy', 'memory_free', 'actual_texture_destroy'):
        key = data.get('backend') if event == 'actual_texture_destroy' else data.get('object')
        row = current.get(key)
        if row is None:
            continue
        if event in ('mark', 'release', 'image_destroy'):
            row.update({k: data[k] for k in ('timeline', 'use', 'sub')})
        if event == 'mark':
            row['marks'] += 1
        elif event == 'actual_texture_destroy':
            row['wrapper_cleanup'] = timestamp
        elif event == 'release':
            row['backend_release'] = timestamp
        elif event == 'image_destroy':
            row['backend_destroy'] = timestamp
            row['destroy_memory'] = data.get('memory')
        elif event == 'memory_free':
            row['memory_free'] = timestamp
            row['free_memory'] = data['memory']
            row['completion_observed_before_free'] = (
                row['timeline'] == '0x0' or
                (row['timeline'], row['use'], row['sub']) in completed)
            current.pop(key, None)
freed = [r for r in rows if 'memory_free' in r]
print(json.dumps(dict(
    actual_imports=len(rows),
    imports_with_owned_memory=sum(r.get('memory') not in (None, '0x0') for r in rows),
    memory_frees=len(freed),
    imported_memory_matches_freed=sum(r.get('memory') == r.get('free_memory') for r in freed),
    frees_with_completion_evidence=sum(r['completion_observed_before_free'] for r in freed),
    frees_without_completion_evidence=[r['shared'] for r in freed if not r['completion_observed_before_free']],
    unmatched_imports=[r['shared'] for r in rows if 'memory_free' not in r],
    last_use_point_counts=dict(collections.Counter(r['marks'] for r in rows)),
    images=rows), indent=2))
