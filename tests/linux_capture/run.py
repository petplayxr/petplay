#!/usr/bin/env python3
"""Exercise PetPlay capture against real portals and a private nested Wayland desktop."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=['nested', 'virtual'], default='nested')
    parser.add_argument('--helper', type=Path, default=ROOT / 'dist/native/x86_64-unknown-linux-gnu/screen-streamer')
    parser.add_argument('--out', type=Path, default=ROOT / '_scratch/linux-capture' / time.strftime('%Y%m%d-%H%M%S'))
    parser.add_argument('--inner', action='store_true', help=argparse.SUPPRESS)
    return parser.parse_args()


def outer(args):
    for executable in ['dbus-run-session', 'kwin_wayland', 'pipewire', 'pw-dump', 'wireplumber', 'deno']:
        if not shutil.which(executable):
            raise RuntimeError('Missing prerequisite: ' + executable)
    if not args.helper.is_file():
        raise RuntimeError('Build the helper first with deno task build:native, or pass --helper')
    if args.out.exists() and any(args.out.iterdir()):
        raise RuntimeError('Choose an empty --out directory to avoid stale test artifacts')
    args.out.mkdir(parents=True, exist_ok=True)
    # Keep Unix socket paths short. Never use PetPlay's managed repo-local tmp/.
    runtime = tempfile.mkdtemp(prefix='petplay-capture-', dir=os.environ['XDG_RUNTIME_DIR'])
    env = os.environ.copy()
    env.update(
        XDG_RUNTIME_DIR=runtime, PIPEWIRE_RUNTIME_DIR=runtime,
        XDG_CONFIG_HOME=str(args.out / 'config'), XDG_CACHE_HOME=str(args.out / 'cache'),
        XDG_STATE_HOME=str(args.out / 'state'), XDG_DATA_HOME=str(args.out / 'data'),
        XDG_DESKTOP_PORTAL_DIR=str(args.out / 'portal-definitions'),
        WAYLAND_DISPLAY='petplay-capture-test', QT_QPA_PLATFORM='wayland',
        XDG_CURRENT_DESKTOP='KDE', XDG_SESSION_TYPE='wayland',
        # Only this private test compositor permits automated source selection.
        KWIN_WAYLAND_NO_PERMISSION_CHECKS='1', KWIN_COMPOSE='O2', LIBGL_ALWAYS_SOFTWARE='1',
        QT_FORCE_STDERR_LOGGING='1', GIO_USE_VFS='local', NO_AT_BRIDGE='1',
        PYTHONDONTWRITEBYTECODE='1',
        DENO_DIR=json.loads(subprocess.check_output(['deno', 'info', '--json'], cwd=ROOT))['denoDir'],
    )
    for key in ['DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'PIPEWIRE_REMOTE', 'WAYLAND_SOCKET', 'AT_SPI_BUS_ADDRESS']:
        env.pop(key, None)
    # Only expose ScreenCast: do not start unrelated portal backends or hardware services.
    definitions = args.out / 'portal-definitions'
    definitions.mkdir(exist_ok=True)
    (definitions / 'kde.portal').write_text(
        '[portal]\nDBusName=org.freedesktop.impl.portal.desktop.kde\n'
        'Interfaces=org.freedesktop.impl.portal.ScreenCast;\nUseIn=KDE\n')
    config = args.out / 'config/xdg-desktop-portal'
    config.mkdir(parents=True, exist_ok=True)
    (config / 'portals.conf').write_text('[preferred]\ndefault=kde\n')
    (definitions / 'portals.conf').write_text('[preferred]\ndefault=kde\n')
    try:
        return subprocess.call([
            'dbus-run-session', '--', sys.executable, str(HERE / 'run.py'), '--inner',
            '--backend', args.backend, '--out', str(args.out), '--helper', str(args.helper),
        ], env=env, cwd=ROOT)
    finally:
        # Autostarted document portals can leave FUSE mounts after the private bus exits.
        for mount in ['doc', 'gvfs']:
            subprocess.run(['fusermount3', '-u', runtime + '/' + mount],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(runtime, ignore_errors=True)


def inner(args):
    from gi.repository import Gio, GLib
    from choose_source import choose_source

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    processes, logs = [], []
    result = {'success': False, 'backend': args.backend}
    started = time.monotonic()

    def spawn(name, command, extra=None):
        log = open(args.out / (name + '.log'), 'w')
        logs.append(log)
        env = os.environ.copy()
        env.update(extra or {})
        process = subprocess.Popen(command, env=env, cwd=ROOT, stdout=log, stderr=log,
                                   stdin=subprocess.PIPE, start_new_session=True)
        processes.append(process)
        return process

    def owner(name):
        return bus.call_sync(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner',
            GLib.Variant('(s)', (name,)), None, Gio.DBusCallFlags.NONE, 1000, None).unpack()[0]

    def wait(check, label, seconds=15):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if check():
                return
            time.sleep(.1)
        raise RuntimeError('Timed out waiting for ' + label)

    def compositor_args():
        return ['--width', '960', '--height', '720', '--no-lockscreen',
                '--no-global-shortcuts', '--no-kactivities']

    try:
        print('Starting private PipeWire, policy-only WirePlumber and KWin...', flush=True)
        spawn('pipewire', ['pipewire'])
        runtime = Path(os.environ['XDG_RUNTIME_DIR'])
        wait(lambda: (runtime / 'pipewire-0').exists(), 'private PipeWire')
        # Policy links video streams; no ALSA, Bluetooth or camera monitors are started.
        spawn('wireplumber', ['wireplumber', '--profile', 'policy'])
        if args.backend == 'nested':
            spawn('parent-kwin', ['dbus-run-session', '--', 'kwin_wayland', '--virtual',
                                 '--socket', 'petplay-capture-parent'] + compositor_args())
            wait(lambda: (runtime / 'petplay-capture-parent').exists(), 'parent KWin')
        backend = ['--wayland-display', 'petplay-capture-parent'] if args.backend == 'nested' else ['--virtual']
        spawn('kwin', ['kwin_wayland'] + backend + ['--socket', 'petplay-capture-test'] + compositor_args())
        wait(lambda: (runtime / 'petplay-capture-test').exists() and owner('org.kde.KWin'), 'private KWin')
        spawn('permissions', ['/usr/lib/xdg-permission-store'])
        spawn('portal-kde', ['/usr/lib/xdg-desktop-portal-kde'])
        wait(lambda: owner('org.freedesktop.impl.portal.desktop.kde'), 'KDE portal backend')
        spawn('portal', ['/usr/lib/xdg-desktop-portal', '--verbose'])
        wait(lambda: owner('org.freedesktop.portal.Desktop'), 'ScreenCast portal')
        spawn('pattern', [sys.executable, str(HERE / 'pattern.py')])
        time.sleep(2)
        result['portal_properties'] = bus.call_sync(
            'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
            'org.freedesktop.DBus.Properties', 'GetAll',
            GLib.Variant('(s)', ('org.freedesktop.portal.ScreenCast',)),
            None, Gio.DBusCallFlags.NONE, 10000, None).unpack()[0]
        # Disable input explicitly: this test must not create host uinput devices.
        wrapper = args.out / 'capture-only-helper'
        wrapper.write_text('#!/bin/sh\nexec ' + shlex.quote(str(args.helper)) + ' --no-input "$@"\n')
        wrapper.chmod(0o700)
        original_bus = os.environ['DBUS_SESSION_BUS_ADDRESS']
        receiver = spawn('receiver', ['deno', 'run', '-A', '--no-check', str(HERE / 'receive.ts'),
                                     str(wrapper), str(args.out / 'capture.token'), str(args.out)], {
            # Only the helper gets the real capture session. The Deno process keeps a different bus.
            'PETPLAY_CAPTURE_DBUS_SESSION_BUS_ADDRESS': original_bus,
            'PETPLAY_CAPTURE_XDG_RUNTIME_DIR': str(runtime),
            'PETPLAY_CAPTURE_WAYLAND_DISPLAY': 'petplay-capture-test',
            'DBUS_SESSION_BUS_ADDRESS': 'unix:path=' + str(runtime / 'deliberately-missing-bus'),
            # The helper must use OpenPipeWireRemote instead of the default connection.
            'PIPEWIRE_REMOTE': 'petplay-deliberately-missing',
        })
        print('Testing real portal → helper → PetPlay receiver with changing pixels...', flush=True)
        deadline = time.monotonic() + 45
        next_choose = time.monotonic() + 2
        while receiver.poll() is None:
            if time.monotonic() > deadline:
                raise RuntimeError('Capture did not finish within 45 seconds; inspect logs')
            if time.monotonic() >= next_choose and not (args.out / 'source-chosen').exists():
                choose_source()  # only the private compositor, with runtime/socket assertions
                next_choose = float('inf')
            time.sleep(.1)
        if receiver.returncode != 0:
            raise RuntimeError('PetPlay receiver failed; inspect receiver.log')
        result.update(json.loads((args.out / 'receiver-result.json').read_text()))
        result['default_pipewire_remote_poisoned'] = True
        result['elapsed_seconds'] = round(time.monotonic() - started, 2)
        result['versions'] = {
            'kwin': subprocess.check_output(['kwin_wayland', '--version'], text=True).strip(),
            'portal': subprocess.check_output(['/usr/lib/xdg-desktop-portal', '--version'], text=True).strip(),
            'pipewire': subprocess.check_output(['pipewire', '--version'], text=True).strip(),
        }
        from PySide6.QtGui import QImage
        image = QImage((args.out / 'frame.bgra').read_bytes(), 960, 720, QImage.Format.Format_ARGB32)
        if not image.save(str(args.out / 'frame.png')):
            raise RuntimeError('Could not save captured test frame')
        print(json.dumps(result, indent=2), flush=True)
        return 0
    except Exception as error:
        result.update(success=False, error=str(error))
        print(str(error), file=sys.stderr)
        return 1
    finally:
        try:
            (args.out / 'pw-dump.json').write_bytes(subprocess.check_output(['pw-dump'], timeout=3))
        except (subprocess.SubprocessError, OSError):
            pass
        (args.out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        for process in reversed(processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        for process in processes:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        for log in logs:
            log.close()


if __name__ == '__main__':
    args = arguments()
    args.out = args.out.resolve()
    args.helper = args.helper.resolve()
    sys.exit(inner(args) if args.inner else outer(args))
