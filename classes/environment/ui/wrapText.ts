/**
 * Fitting text to a width for MSDF `Text`, which lays out one line per `\n` and never wraps or
 * truncates by itself.
 */

/** Breaks greedily at spaces; a single word wider than the line keeps a line to itself. */
export async function wrapText(
  text: string,
  maxWidth: number,
  measure: (line: string) => Promise<number>,
): Promise<string> {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && await measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Cuts `text` to fit on one line, ending in an ellipsis when anything was cut. */
export async function truncateText(
  text: string,
  maxWidth: number,
  measure: (line: string) => Promise<number>,
): Promise<string> {
  if (await measure(text) <= maxWidth) return text;
  // Longest prefix that still fits with the ellipsis, by binary search over characters.
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (await measure(`${text.slice(0, mid).trimEnd()}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}
