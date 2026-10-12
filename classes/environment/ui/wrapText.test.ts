import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { wrapText } from "./wrapText.ts";

// One unit per character keeps the expected breaks readable.
const measure = (line: string) => Promise.resolve(line.length);

Deno.test("wrapText breaks at the last space that fits", async () => {
  assertEquals(
    await wrapText("the quick brown fox jumps", 10, measure),
    "the quick\nbrown fox\njumps",
  );
});

Deno.test("wrapText keeps short text, existing newlines and overlong words", async () => {
  assertEquals(await wrapText("short", 10, measure), "short");
  assertEquals(await wrapText("a b\nc d", 10, measure), "a b\nc d");
  assertEquals(
    await wrapText("tiny supercalifragilistic end", 10, measure),
    "tiny\nsupercalifragilistic\nend",
  );
});
