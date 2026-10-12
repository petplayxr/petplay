/**
 * Word wrap for MSDF `Text`, which lays out one line per `\n` and never wraps by itself. Breaks
 * greedily at spaces; a single word wider than the line keeps a line to itself.
 */
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
