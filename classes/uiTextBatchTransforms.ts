type TextTransform = { worldMatrix: ArrayLike<number> };

/** Batch vertices are baked into world space; object identity does not freeze tracking matrices. */
export function textBatchTransformsMatch(
  texts: readonly TextTransform[],
  saved: Float64Array,
): boolean {
  if (saved.length !== texts.length * 16) return false;
  for (let t = 0; t < texts.length; t++) {
    for (let i = 0; i < 16; i++) {
      if (saved[t * 16 + i] !== texts[t].worldMatrix[i]) return false;
    }
  }
  return true;
}

export function captureTextBatchTransforms(texts: readonly TextTransform[]): Float64Array {
  const saved = new Float64Array(texts.length * 16);
  for (let t = 0; t < texts.length; t++) {
    for (let i = 0; i < 16; i++) saved[t * 16 + i] = texts[t].worldMatrix[i];
  }
  return saved;
}
