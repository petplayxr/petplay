/** Apply an explicit capture-session environment only to the helper, leaving OpenVR untouched. */
export function captureSessionEnvironment(): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "WAYLAND_DISPLAY"]) {
    const value = Deno.env.get(`PETPLAY_CAPTURE_${name}`);
    if (value) overrides[name] = value;
  }
  return overrides;
}
