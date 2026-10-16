#!/usr/bin/env python3
"""Summarise a V8 `.cpuprofile` (from utils/petplay-overlay-cpu-profile.py, the renderer's
PROFILECPU, or a worker `node:inspector` session).

  petplay-cpuprofile-analyze.py prof.cpuprofile --frames 760
      top self and inclusive time, per frame when --frames is given
  ... --under renderRaythreeFrame --depth 2
      time below a function, by call path
  ... --between onDeviceFrame
      what runs outside that function (a frame tick), overall and during gaps between ticks
      longer than --gap-ms

Functions match by name, as printed: `name file:line`.
"""
import argparse
import collections
import json


class Profile:
    def __init__(self, path):
        data = json.load(open(path))
        self.nodes = {n['id']: n for n in data['nodes']}
        self.parent = {c: n['id'] for n in data['nodes'] for c in n.get('children', [])}
        self.samples = data['samples']
        deltas = data['timeDeltas']
        # A sample's weight is the time until the next one.
        self.weights = [d / 1000 for d in deltas[1:]] + [0]
        self.times = []
        t = data['startTime']
        for d in deltas:
            t += d
            self.times.append(t / 1000)
        self._stacks = {}

    def name(self, node_id):
        frame = self.nodes[node_id]['callFrame']
        file = frame['url'].split('/')[-1]
        name = frame['functionName'] or '(anon)'
        return f"{name} {file}:{frame['lineNumber'] + 1}" if file else name

    def stack(self, node_id):
        """Root-first names."""
        if node_id not in self._stacks:
            out, n = [], node_id
            while n in self.nodes:
                out.append(self.name(n))
                n = self.parent.get(n)
            self._stacks[node_id] = out[::-1]
        return self._stacks[node_id]


def matches(entry, function):
    return entry == function or entry.startswith(function + ' ')


def summary(profile, frames, top):
    self_time, inclusive, total = collections.Counter(), collections.Counter(), 0
    for sample, weight in zip(profile.samples, profile.weights):
        stack = profile.stack(sample)
        total += weight
        self_time[stack[-1]] += weight
        for entry in set(stack):
            inclusive[entry] += weight
    scale = frames or 1
    unit = 'ms/frame' if frames else 'ms'
    print(f'sampled {total:.0f} ms' + (f' over {frames} frames ({total / frames:.2f} ms/frame)'
                                        if frames else ''))
    print(f'\n-- top self ({unit})')
    for entry, weight in self_time.most_common(top):
        print(f'{weight / scale:9.3f}  {entry}')
    print(f'\n-- top inclusive ({unit})')
    for entry, weight in inclusive.most_common(top):
        print(f'{weight / scale:9.3f}  {entry}')


def under(profile, function, depth, frames, top):
    paths, total = collections.Counter(), 0
    for sample, weight in zip(profile.samples, profile.weights):
        stack = profile.stack(sample)
        index = next((i for i, e in enumerate(stack) if matches(e, function)), None)
        if index is None:
            continue
        total += weight
        paths[' > '.join(stack[index + 1:index + 1 + depth]) or '(self)'] += weight
    scale = frames or 1
    print(f'{function}: {total / scale:.3f} ' + ('ms/frame' if frames else 'ms'))
    for path, weight in paths.most_common(top):
        print(f'{weight / scale:9.3f}  {path}')


def between(profile, function, gap_ms, top):
    inside = [any(matches(e, function) for e in profile.stack(s)) for s in profile.samples]
    if not any(inside):
        raise SystemExit(f'{function} not found in the profile')
    starts = [profile.times[i] for i in range(1, len(inside)) if inside[i] and not inside[i - 1]]
    gaps = [(a, b) for a, b in zip(starts, starts[1:]) if b - a > gap_ms]
    print(f'{len(starts)} ticks of {function}; {len(gaps)} gaps over {gap_ms} ms')
    skip = {'(root)', '(anon)', '(program)', 'runMicrotasks', 'processTicksAndRejections'}

    def report(label, picked):
        tasks, leaves = collections.Counter(), collections.Counter()
        for i in picked:
            stack = profile.stack(profile.samples[i])
            leaves[stack[-1]] += profile.weights[i]
            task = next((e for e in stack[:-1] if e.split(' ')[0] not in skip), stack[-1])
            tasks[task] += profile.weights[i]
        print(f'\n== {label}: {sum(profile.weights[i] for i in picked):.0f} ms')
        for entry, weight in tasks.most_common(top):
            print(f'   task {weight:8.1f}  {entry}')
        for entry, weight in leaves.most_common(top):
            print(f'   self {weight:8.1f}  {entry}')

    busy = [i for i, s in enumerate(profile.samples)
            if not inside[i] and not profile.stack(s)[-1].startswith('(idle)')]
    report(f'busy outside {function}', busy)
    report('busy outside it during long gaps',
           [i for i in busy if any(a < profile.times[i] < b for a, b in gaps)])


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('profile')
    parser.add_argument('--frames', type=int, help='divide times by this many frames')
    parser.add_argument('--top', type=int, default=25)
    parser.add_argument('--under', help='break down the time below this function')
    parser.add_argument('--depth', type=int, default=2)
    parser.add_argument('--between', help='analyse what runs outside this frame-tick function')
    parser.add_argument('--gap-ms', type=float, default=20)
    args = parser.parse_args()
    profile = Profile(args.profile)
    if args.under:
        under(profile, args.under, args.depth, args.frames, args.top)
    elif args.between:
        between(profile, args.between, args.gap_ms, args.top)
    else:
        summary(profile, args.frames, args.top)


if __name__ == '__main__':
    main()
