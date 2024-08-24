type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function stringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => 
    typeof v === 'bigint' ? v.toString() : v
  );
}

function parse(text: string): unknown {
  return JSON.parse(text, (_, value) => {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      return BigInt(value.slice(0, -1));
    }
    return value;
  });
}

export { stringify, parse };