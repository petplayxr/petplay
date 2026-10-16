#!/usr/bin/env python3
"""Validate static public-overlay controls in fenced driver-direct image captures.

This is an image-content check, not a controller jitter or production pacing measurement.
Uses only the Python standard library. Captured PPM files and .complete metadata are required.
"""
import argparse
import json
from pathlib import Path

STAGES = ('baseline', 'quad', 'panorama', 'projection', 'all')


def pixels(path, width, height):
    with path.open('rb') as stream:
        if stream.readline() != b'P6\n':
            raise ValueError(f'{path}: expected binary P6')
        if stream.readline() != f'{width} {height}\n'.encode() or stream.readline() != b'255\n':
            raise ValueError(f'{path}: dimensions or component range mismatch')
        data = stream.read(width * height * 3 + 1)
    if len(data) != width * height * 3:
        raise ValueError(f'{path}: wrong pixel byte count')
    counts = [0, 0, 0]
    sums_x = [0, 0, 0]
    sums_y = [0, 0, 0]
    for p in range(0, len(data), 3):
        r, g, b = data[p:p+3]
        color = (0 if r > 200 and g < 20 and b < 20 else
                 1 if g > 200 and r < 20 and b < 20 else
                 2 if b > 200 and r < 20 and g < 20 else None)
        if color is not None:
            i = p // 3
            counts[color] += 1
            sums_x[color] += i % width
            sums_y[color] += i // width
    return {name: {'pixels': counts[i], 'centroid':
                  [sums_x[i] / counts[i], sums_y[i] / counts[i]] if counts[i] else None}
            for i, name in enumerate(('red', 'green', 'blue'))}


def analyze(directory, probe_log):
    native_inodes = set()
    records = {}
    for line in probe_log.read_text().splitlines():
        if not line.startswith('{"experiment"'):
            continue
        record = json.loads(line)
        if record.get('experiment') != 'direct-overlay-layer-metadata':
            continue
        records[record['stage']] = record
        for snapshot in ('before', 'after'):
            native_inodes.update(i for i in record[snapshot]['lastInodes'] if i)
    failures = []
    stages = {}
    for stage in STAGES:
        meta = json.loads((directory / f'{stage}.complete').read_text())
        if meta['captured'] != 2 or meta['skipped'] or meta['failures'] or meta['disabled']:
            raise ValueError(f'{stage}: incomplete capture: {meta}')
        if len(meta['images']) != 2 or len({i['inode'] for i in meta['images']}) != 2:
            raise ValueError(f'{stage}: expected two distinct images')
        if stage not in records or records[stage].get('capture') != meta:
            raise ValueError(f'{stage}: capture metadata does not match the guarded probe log')
        frames = []
        for image in meta['images']:
            index = image['index']
            if not isinstance(index, int) or not 0 <= index < 32:
                raise ValueError('Bad capture index')
            if image['inode'] not in native_inodes:
                raise ValueError(f'{stage}: inode not observed in the native driver: {image["inode"]}')
            frames.append({'index': index, 'inode': image['inode'],
                           'colors': pixels(directory / f'{stage}-{index}.ppm', meta['width'], meta['height'])})
        colors = [f['colors'] for f in frames]
        total = meta['width'] * meta['height']
        if stage == 'baseline':
            passed = all(c[name]['pixels'] < 100 for c in colors for name in ('red', 'green', 'blue'))
        elif stage == 'quad':
            passed = all(c['red']['pixels'] > 1000 for c in colors)
        elif stage == 'panorama':
            passed = all(c['green']['pixels'] > .99 * total for c in colors)
        elif stage == 'projection':
            blue = sorted(c['blue']['pixels'] for c in colors)
            passed = blue[0] < 100 and blue[1] > 1000  # Probe deliberately targets Eye_Left.
        else:
            passed = (all(c['red']['pixels'] > 1000 for c in colors) and
                      sum(c['green']['pixels'] for c in colors) > 1000 and
                      sum(c['blue']['pixels'] for c in colors) > 1000)
        if not passed:
            failures.append(stage)
        stages[stage] = {'passed': passed, 'images': frames}
    return {'passed': not failures, 'failures': failures,
            'scope': 'static composed-image positive controls; capture stalls frame delivery',
            'nativeInodes': sorted(native_inodes), 'stages': stages}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--probe-log', type=Path, required=True)
    args = parser.parse_args()
    report = analyze(args.directory, args.probe_log)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
