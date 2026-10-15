import { captureTextBatchTransforms, textBatchTransformsMatch } from "./uiTextBatchTransforms.ts";

Deno.test("world-baked text cache invalidates when tracking mutates the same snapshot", () => {
  const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const texts = [{ worldMatrix: matrix }];
  const cached = captureTextBatchTransforms(texts);
  if (!textBatchTransformsMatch(texts, cached)) {
    throw new Error("Unchanged stereo eye should reuse batch");
  }
  matrix[12] = .25;
  if (textBatchTransformsMatch(texts, cached)) {
    throw new Error("Tracked text reused stale world vertices");
  }
  const updated = captureTextBatchTransforms(texts);
  if (!textBatchTransformsMatch(texts, updated)) {
    throw new Error("Updated batch should be reusable for second eye");
  }
  if (cached[12] !== 0) throw new Error("Cache must own its transform snapshot");
});
