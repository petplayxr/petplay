# Baseline

## 2026-10-16: live PetPlay scene, synthetic hand sweep

Setup: real HMD, synthetic `petplay_ovrdriver` controllers sweeping, VRChat home, full UI
visible (wrist, keyboard, displays), decoupled renderer in projection mode, compact wire
(`petplay-ir-v8-base64-v2-ui-assets`). The producer was sampled by temporarily wrapping
`view.wireEncoder.encode` over 30–40 consecutive frames from the agent REPL, then restored.

Packet: **about 114 KB of base64 per scene**, sent every frame to one view.

| Section | Items | Serialized (V8) | Changing per frame |
|---|---:|---:|---:|
| raythree instances | 12 | 5.0 KB | 0 (2 in 2 of 30 frames) |
| lights | – | 0.4 KB | – |
| camera | – | 0.4 KB | – |
| shadow frame | – | 0.8 KB | – |
| uikit panels | 104 | 37.5 KB | 16–18 |
| uikit texts | 106–107 | 59.5 KB (16.7 KB glyph geometry, stripped by the compact wire when unchanged) | 12–18 |
| uikit images | 3 | 1.2 KB | 1 |

- The changing panels are exactly the 16 with a `renderAnchor`, out of 104. Their
  `worldMatrix` and `clipping` are baked into world space from the sim's hand pose. The
  renderer replaces both from `renderAnchor.localMatrix` and its own fresh anchor.
- Per-instance fields: `kind, nodeId, geometryId, materialId, worldMatrix (f64×16),
  normalMatrix (f64), renderOrder, layerMask, transparent, receiveShadow, castShadow,
  renderAnchor`.
- Per-text fields: `worldMatrix, renderAnchor, text, color, fontSize, align, anchorX, font,
  rootIndex, bounds, geometry`.

From the V8 CPU profile in the jitter doc (10 s, 660 scenes received):
`decodeOverlayScene` 1.20 s inclusive, about **1.8 ms per scene**. GC was 226 ms live versus
51 ms frozen. Text batches were rebuilt 2.1 times per stereo frame after the glyph interning
fix, from world-matrix changes on anchored text.

Probe scripts: webxr-actor eval bodies in `utils/petplay-ir-probe-sections.js` and
`utils/petplay-ir-probe-changes.js`. Post one as `{"target":"webxr","code":...,"timeoutMs":8000}`
to the agent REPL's `/eval`. Each wraps the first view's encoder for about 30 frames and
restores it.
