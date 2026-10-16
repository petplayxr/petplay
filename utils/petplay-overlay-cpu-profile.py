#!/usr/bin/env python3
"""Capture matched presenter V8 CPU profiles with live/frozen scene delivery."""
import argparse
import json
from pathlib import Path
import time
import urllib.request


def message(target, kind, payload=None, timeout=10):
    request = urllib.request.Request('http://127.0.0.1:3987/message', data=json.dumps({
        'target': target, 'type': kind, 'payload': payload,
        'reply': True, 'timeoutMs': int(timeout * 1000),
    }).encode(), headers={'content-type': 'application/json'})
    result = json.load(urllib.request.urlopen(request, timeout=timeout + 5))
    if not result.get('ok'):
        raise RuntimeError(result)
    value = result['result']
    if isinstance(value, dict) and '__actorError' in value:
        raise RuntimeError(value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--output', type=Path, default=Path('logs/ovrdriver-lab/cpu-profile'))
    args = parser.parse_args()
    if not 1 <= args.seconds <= 30:
        parser.error('--seconds must be 1..30')
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    renderer = message('webxr', '__HEALTH__')['independentRenderer']['actor']
    if not renderer:
        raise RuntimeError('Independent renderer not running')
    previous = message(renderer, '__HEALTH__')
    try:
        for label, frozen in [('live', False), ('frozen', True)]:
            message(renderer, 'SETRENDERERDEBUG', {'freezeScene': frozen})
            time.sleep(1)
            message(renderer, 'SETRENDERWORKPROBE', True)
            before = message(renderer, '__HEALTH__')
            profile = message(renderer, 'PROFILECPU', args.seconds * 1000, args.seconds + 10)
            after = message(renderer, '__HEALTH__')
            work = message(renderer, 'GETRENDERWORKPROBE')
            (args.output / f'{label}.cpuprofile').write_text(json.dumps(profile))
            (args.output / f'{label}-work.json').write_text(json.dumps({
                'before': before, 'after': after, 'work': work,
            }, indent=2))
            print(label, 'samples', len(profile.get('samples', [])),
                  'rendered', after['renderFrameId'] - before['renderFrameId'],
                  'received', after['receivedScenes'] - before['receivedScenes'], flush=True)
    finally:
        message(renderer, 'SETRENDERERDEBUG', {'freezeScene': previous['freezeScene']})
        message(renderer, 'SETRENDERWORKPROBE', False)


if __name__ == '__main__':
    main()
