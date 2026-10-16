#!/usr/bin/env python3
"""Report producer geometry and CPU publication separately; never infer display cadence."""
import glob
import json
import math
import os
import sys


def percentile(values, p):
    return round(sorted(values)[min(len(values) - 1, int(p * len(values)))], 3) if values else None


for path in sys.argv[1:]:
    paths = sorted(glob.glob(os.path.join(path, '*.json'))) if os.path.isdir(path) else [path]
    for filename in paths:
        data = json.load(open(filename))
        rows = data.get('capture', data).get('rows', [])
        if not rows:
            print(os.path.basename(filename), 'NO SAMPLES; not a valid comparison')
            continue
        if 'expectedCentroidX' in rows[0]:
            print(filename, 'UNTIMED PRODUCER GEOMETRY ONLY')
            for target in sorted({r['target'] for r in rows}):
                samples = [r for r in rows if r['target'] == target]
                errors = [r['centroidX'] - r['expectedCentroidX'] for r in samples if r['centroidX'] is not None]
                bad_ids = sum(r['missingBits'] > 0 or r['decodedGeneration'] != r['generation'] for r in samples)
                print(target, 'samples', len(samples), 'missing marker', len(samples) - len(errors),
                      'generation errors', bad_ids, 'max pixel error', round(max(map(abs, errors)), 4) if errors else None,
                      'RMS pixel error', round(math.sqrt(sum(e*e for e in errors)/len(errors)), 4) if errors else None)
        else:
            print(filename, 'CPU PUBLICATION ONLY; compositor consumption unmeasured')
            standby = sum(r.get('hmdActivity') == 3 for r in rows)
            print('samples', len(rows), 'published', sum(r['published'] for r in rows), 'standby samples', standby)
            if standby:
                print('INVALID as an awake workload A/B: headset entered standby')
            samples = [r for r in rows if r['published'] and r['elapsedMs'] > 250]
            gaps = [b['publicationEndMs'] - a['publicationEndMs'] for a, b in zip(samples, samples[1:])]
            steps = [b['targetMs'] - a['targetMs'] for a, b in zip(samples, samples[1:])]
            print('after 250 ms warmup; publication gap p50/p95/max ms', [percentile(gaps, q) for q in (.5, .95, 1)])
            print('target-time step p05/p50/p95 ms', [percentile(steps, q) for q in (.05, .5, .95)],
                  'target steps <= 0', sum(s <= 0 for s in steps))
