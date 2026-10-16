"""Choose a source in the private test compositor's chooser, never to the user's desktop.

Wire messages implement KDE fake-input v4 (authenticate and keyboard_key only):
https://github.com/KDE/plasma-wayland-protocols/blob/master/src/protocols/fake-input.xml
This is test automation, not PetPlay's input backend.
"""
import os
import socket
import struct
from pathlib import Path


def choose_source():
    runtime = Path(os.environ['XDG_RUNTIME_DIR'])
    assert runtime.name.startswith('petplay-capture-'), 'Refusing non-test runtime'
    assert os.environ['WAYLAND_DISPLAY'] == 'petplay-capture-test'
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(2)
        conn.connect(str(runtime / 'petplay-capture-test'))

        def send(object_id, opcode, payload=b''):
            conn.sendall(struct.pack('=II', object_id, ((8 + len(payload)) << 16) | opcode) + payload)

        def string(value):
            value = value.encode() + b'\0'
            return struct.pack('=I', len(value)) + value + bytes((-len(value)) % 4)

        def exact(count):
            data = bytearray()
            while len(data) < count:
                chunk = conn.recv(count - len(data))
                if not chunk:
                    raise RuntimeError('Private Wayland connection closed')
                data.extend(chunk)
            return data

        def roundtrip(callback):
            send(1, 0, struct.pack('=I', callback))
            while True:
                object_id, word = struct.unpack('=II', exact(8))
                payload = exact((word >> 16) - 8)
                opcode = word & 0xffff
                if object_id == callback and opcode == 0:
                    return
                if object_id == 1 and opcode == 0:
                    raise RuntimeError('Private Wayland protocol error: ' + repr(payload))
                if object_id == 2 and opcode == 0:
                    name, length = struct.unpack_from('=II', payload)
                    interface = payload[8:8 + length - 1].decode()
                    version = struct.unpack_from('=I', payload, 8 + ((length + 3) & ~3))[0]
                    if interface == 'org_kde_kwin_fake_input' and version >= 4:
                        globals_found.append((name, min(version, 4)))

        globals_found = []
        send(1, 1, struct.pack('=I', 2))  # wl_display.get_registry
        roundtrip(3)
        if not globals_found:
            raise RuntimeError('Private KWin lacks test input protocol v4')
        name, version = globals_found[0]
        send(2, 0, struct.pack('=I', name) + string('org_kde_kwin_fake_input') + struct.pack('=II', version, 4))
        send(4, 0, string('PetPlay capture test') + string('Select only the private test output'))
        roundtrip(5)
        # Tab from the search field to the first output card, then activate with Space.
        # Enter in KDE 6.7's search field can accept twice and replace the returned stream.
        send(4, 10, struct.pack('=II', 15, 1))  # KEY_TAB pressed
        send(4, 10, struct.pack('=II', 15, 0))
        roundtrip(6)
        send(4, 10, struct.pack('=II', 57, 1))  # KEY_SPACE pressed
        send(4, 10, struct.pack('=II', 57, 0))
        roundtrip(7)
