#!/usr/bin/env python3
"""Frame-timing tools for the decoupled renderer, over the agent REPL (--agent-repl, :3987).

  capture     record the renderer's frame timeline (SETFRAMETIMELINE) to JSON
  latch       per SteamVR latch window: missed and doubled frames, pose-to-display latency,
              present/sample phase histograms, and the marks around each miss
  compositor  correlate latch misses with IVRCompositor::GetFrameTimings drops recorded by
              native/compositorTimingProbe (run it alongside `capture`)
  debug       SETRENDERERDEBUG with a JSON object, or switch `panorama` / `projection`
  worker-fps  the webxr worker's scene-build rate and interval spread

Timeline rows are [ms, mark, heapUsed, ...fields]; `sample` and `present` carry
[vsyncIndex, msSinceVsync]. See markdown/projection-overlay-re/panorama-controller-jitter.md.
"""
import argparse
import collections
import csv
import json
import time
import urllib.request

REPL = 'http://127.0.0.1:3987'
PERIOD_MS = 1000 / 75


def post(path, body, timeout=10):
    request = urllib.request.Request(REPL + path, json.dumps(body).encode(),
                                     {'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(request, timeout=timeout))


def evaluate(code, timeout=10):
    result = post('/eval', {'target': 'webxr', 'code': code}, timeout)['result']
    value = result.get('inspected')
    while isinstance(value, str) and value[:1] in "'\"":
        value = json.loads(value) if value[0] == '"' else value[1:-1]
    return value


def renderer():
    return evaluate('return state.renderOwner ?? null')


def message(kind, payload=None, timeout=8):
    result = post('/message', {'target': renderer(), 'type': kind, 'payload': payload,
                               'reply': True, 'timeoutMs': int(timeout * 1000)}, timeout + 2)
    if not result.get('ok'):
        raise SystemExit(result)
    return result['result']


def capture(args):
    message('SETRENDERERDEBUG', {'freezeScene': args.freeze})
    message('SETFRAMETIMELINE', True)
    time.sleep(0.5)
    message('TAKEFRAMETIMELINE')
    rows, end = [], time.time() + args.seconds
    try:
        while time.time() < end:
            time.sleep(args.pull)
            rows += message('TAKEFRAMETIMELINE')
    finally:
        message('SETFRAMETIMELINE', False)
        if args.freeze:
            message('SETRENDERERDEBUG', {'freezeScene': False})
    json.dump({'mode': 'freeze' if args.freeze else 'live', 'rows': rows}, open(args.output, 'w'))
    print(args.output, len(rows), 'rows')


def presents(rows):
    return [(i, r) for i, r in enumerate(rows)
            if r[1] == 'present' and r[3] is not None and r[4] is not None]


def window(row, latch_ms):
    return int(((row[3] * PERIOD_MS + row[4]) - latch_ms) // PERIOD_MS)


def latch(args):
    rows = json.load(open(args.timeline))['rows']
    shown = presents(rows)
    print(f"presents {len(shown)}  drop marks {sum(1 for r in rows if r[1] == 'drop')}")
    for latch_ms in sorted({6, 8.5, 11, args.latch_ms}):
        counts = collections.Counter(window(r, latch_ms) for _, r in shown)
        first, last = min(counts), max(counts)
        empty = sum(1 for w in range(first, last + 1) if counts[w] == 0)
        double = sum(1 for c in counts.values() if c > 1)
        total = last - first + 1
        print(f'latch {latch_ms:4} ms: windows {total} empty {empty} ({100 * empty / total:.1f}%) '
              f'double {double}')
    sample, latency, present_phase, sample_phase = None, [], [], []
    for r in rows:
        if r[1] == 'sample' and r[3] is not None:
            sample = r
        elif r[1] == 'present' and sample and r[3] is not None:
            delta = (r[3] - sample[3]) * PERIOD_MS + r[4] - args.latch_ms
            latency.append(int(delta // PERIOD_MS) + 1)
            present_phase.append(int(r[4]))
            sample_phase.append(int(sample[4]))
            sample = None
    changes = sum(1 for a, b in zip(latency, latency[1:]) if a != b)
    print('display vsyncs after sample:', dict(sorted(collections.Counter(latency).items())),
          f'changes {changes}')
    print('present phase ms:', dict(sorted(collections.Counter(present_phase).items())))
    print('sample phase ms: ', dict(sorted(collections.Counter(sample_phase).items())))
    if args.misses:
        for (ia, a), (ib, b) in zip(shown, shown[1:]):
            gap = window(b, args.latch_ms) - window(a, args.latch_ms) - 1
            if gap < 1:
                continue
            print(f'--- {gap} empty window(s); present phase {a[4]:.2f} -> {b[4]:.2f}')
            previous = a[0]
            for r in rows[ia:ib + 1]:
                fields = ' '.join(f'{x:.2f}' if isinstance(x, float) else str(x) for x in r[3:9])
                print(f'   +{r[0] - a[0]:7.2f} ({r[0] - previous:6.2f}) {r[1]:9} '
                      f'heap {r[2] / 1e6:6.1f}MB  {fields}')
                previous = r[0]


def compositor(args):
    frames = list(csv.DictReader(open(args.csv)))
    for f in frames:
        for k in f:
            f[k] = float(f[k])
    # The probe notes the vsync counter when it first saw each frame; the minimum offset is
    # the closest to the frame's own vsync.
    offset = min(f['vsync_counter'] - f['system_s'] * 1000 / PERIOD_MS for f in frames)
    vsync = lambda s: s * 1000 / PERIOD_MS + offset
    drops = [(vsync(a['system_s']), vsync(b['system_s'])) for a, b in zip(frames, frames[1:])
             if a['dropped'] > 0]
    print(f"compositor app frames {len(frames)}  dropped {int(sum(f['dropped'] for f in frames))}"
          f"  mispresented {int(sum(f['mispresented'] for f in frames))}")
    shown = [r for _, r in presents(json.load(open(args.timeline))['rows'])]
    misses = [(a[3], b[3]) for a, b in zip(shown, shown[1:])
              if window(b, args.latch_ms) - window(a, args.latch_ms) >= 2]
    near = lambda lo, hi: any(d0 - 1 <= hi and d1 + 1 >= lo for d0, d1 in drops)
    hits = sum(near(lo, hi) for lo, hi in misses)
    lo, hi = int(min(r[3] for r in shown)), int(max(r[3] for r in shown))
    baseline = sum(near(v, v + 1) for v in range(lo, hi)) / max(1, hi - lo)
    print(f'latch misses {len(misses)}; next to a compositor drop {hits} '
          f'(chance {100 * baseline:.1f}%)')


def debug(args):
    if args.setting in ('panorama', 'projection'):
        projection = str(args.setting == 'projection').lower()
        evaluate(f'state.raylibProjectionOverlayEnabled = {projection}; PostMan.PostMessage('
                 f"{{target: state.renderOwner, type: 'SETPRESENTMODE', payload: '{args.setting}'}});"
                 ' return 1;')
        print('mode', args.setting)
        return
    health = message('SETRENDERERDEBUG', json.loads(args.setting))
    print({k: health.get(k) for k in ('presentMode', 'panoramaPacing', 'panoramaPresentMinMs',
                                       'dropLateFrames', 'freezeScene', 'error')})


def worker_fps(args):
    evaluate('const b = state.raythreeSceneBridge; const build = Object.getPrototypeOf(b).buildPayload;'
             ' const t = globalThis.__frameTimelineBuilds = [];'
             ' b.buildPayload = function (...a) { t.push(performance.now()); return build.apply(this, a); };'
             ' return 1;')
    try:
        time.sleep(args.seconds)
    finally:
        result = evaluate(
            'const b = state.raythreeSceneBridge; delete b.buildPayload;'
            ' const t = globalThis.__frameTimelineBuilds ?? []; delete globalThis.__frameTimelineBuilds;'
            ' return JSON.stringify(t);')
    times = json.loads(result)
    gaps = [b - a for a, b in zip(times, times[1:])]
    if not gaps:
        raise SystemExit(f'{len(times)} scene builds: is the worker running a scene?')
    spans = collections.Counter(round(g / PERIOD_MS) for g in gaps)
    gaps.sort()
    pick = lambda p: gaps[min(len(gaps) - 1, int(p * len(gaps)))]
    print(f'builds {len(times)} ({len(times) / args.seconds:.1f}/s)  interval p5 {pick(.05):.2f} '
          f'p50 {pick(.5):.2f} p95 {pick(.95):.2f} ms  vsyncs per interval {dict(sorted(spans.items()))}')


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('capture')
    p.add_argument('--seconds', type=float, default=20)
    p.add_argument('--freeze', action='store_true', help='freeze scene delivery meanwhile')
    p.add_argument('--pull', type=float, default=2, help='seconds between timeline pulls')
    p.add_argument('--output', default='frame-timeline.json')
    p.set_defaults(run=capture)
    p = sub.add_parser('latch')
    p.add_argument('timeline')
    p.add_argument('--latch-ms', type=float, default=8.5, help="SteamVR's latch phase")
    p.add_argument('--misses', action='store_true', help='print the marks around each miss')
    p.set_defaults(run=latch)
    p = sub.add_parser('compositor')
    p.add_argument('csv', help='native/compositorTimingProbe output')
    p.add_argument('timeline')
    p.add_argument('--latch-ms', type=float, default=8.5)
    p.set_defaults(run=compositor)
    p = sub.add_parser('debug')
    p.add_argument('setting', help="JSON for SETRENDERERDEBUG, or 'panorama' / 'projection'")
    p.set_defaults(run=debug)
    p = sub.add_parser('worker-fps')
    p.add_argument('--seconds', type=float, default=6)
    p.set_defaults(run=worker_fps)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()
