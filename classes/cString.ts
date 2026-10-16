const encoder = new TextEncoder();

/** Encode a null-terminated UTF-8 string for native calls without loading a native library. */
export function cstr(value: string): Uint8Array {
  return encoder.encode(`${value}\0`);
}
