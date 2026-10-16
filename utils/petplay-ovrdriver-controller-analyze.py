#!/usr/bin/env python3
"""Separate sinusoid gain/phase error from residual variation in native-controller probe samples."""
import argparse
import json
import math
from pathlib import Path


def solve(matrix, vector):
    rows = [list(row) + [value] for row, value in zip(matrix, vector)]
    for column in range(3):
        pivot = max(range(column, 3), key=lambda i: abs(rows[i][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        if abs(rows[column][column]) < 1e-12:
            raise ValueError('Insufficient trajectory phase coverage')
        divisor = rows[column][column]
        rows[column] = [value / divisor for value in rows[column]]
        for i in range(3):
            if i != column:
                factor = rows[i][column]
                rows[i] = [a - factor * b for a, b in zip(rows[i], rows[column])]
    return [row[3] for row in rows]


def summary(values):
    ordered = sorted(abs(v) for v in values)
    return {'p50': ordered[len(ordered)//2], 'p95': ordered[int(len(ordered)*.95)], 'max': ordered[-1]}


def analyze(path):
    samples = [json.loads(line) for line in path.read_text().splitlines() if line]
    groups = {}
    for row in samples:
        if row['mode'] != 'sine':
            continue
        groups.setdefault((row['predictionSeconds'], row['hand']), []).append(row)
    output = []
    for (prediction, hand), rows in sorted(groups.items()):
        design = [[1, math.sin(row['phase']), math.cos(row['phase'])] for row in rows]
        target = [row['position'][0] - (-.25 if hand == 0 else .25) for row in rows]
        matrix = [[sum(v[i]*v[j] for v in design) for j in range(3)] for i in range(3)]
        vector = [sum(v[i]*y for v, y in zip(design, target)) for i in range(3)]
        offset, sine, cosine = solve(matrix, vector)
        amplitude = math.hypot(sine, cosine)
        phase_shift = math.atan2(cosine, sine)
        residual = [1000*(y-sum(a*b for a,b in zip(v,(offset,sine,cosine)))) for v,y in zip(design,target)]
        output.append({'hand': hand, 'predictionSeconds': prediction, 'samples': len(rows),
                       'offsetMm': 1000*offset, 'amplitudeM': amplitude,
                       'amplitudeGain': amplitude/rows[0]['config']['positionAmplitudeM'],
                       'phaseShiftMs': 1000*phase_shift/(2*math.pi*rows[0]['config']['frequencyHz']),
                       'positionResidualMm': summary(residual)})
    return {'samplesFile': str(path), 'fits': output,
            'interpretation': 'Gain and phase are fitted diagnostics, not corrections. Residual includes runtime, sampling and query timing; no visual-jitter conclusion.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('samples', type=Path)
    args = parser.parse_args()
    print(json.dumps(analyze(args.samples), indent=2))
