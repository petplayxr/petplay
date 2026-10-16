const { serialize } = await import("node:v8");
const view = [...state.views.values()][0];
const enc = view.wireEncoder;
const orig = enc.encode;
const rows = [];
let prev = null;
await new Promise((resolve) => {
  enc.encode = function (p) {
    try {
      const ex = p.leftEye, inst = ex.frame.instances, ui = p.ui;
      const mats = new Map();
      for (const i of inst) mats.set(i.nodeId, i.worldMatrix);
      let changed = 0, same = 0;
      if (prev) for (const [id, m] of mats) { const o = prev.get(id); if (o && o.every((v, k) => v === m[k])) same++; else changed++; }
      prev = mats;
      const sz = (x) => serialize(x).byteLength;
      const uiKeys = {};
      for (const k of Object.keys(ui)) uiKeys[k] = { n: Array.isArray(ui[k]) ? ui[k].length : null, bytes: sz(ui[k]) };
      let textGeomBytes = 0, textMatBytes = 0;
      for (const t of ui.texts ?? []) { if (t.geometry) textGeomBytes += t.geometry.positions.byteLength + t.geometry.uvs.byteLength + t.geometry.indices.byteLength; }
      rows.push({ inst: inst.length, instBytes: sz(inst), lights: sz(ex.frame.lights ?? []), camera: sz(ex.frame.camera ?? null), assets: sz(ex.assets), frame: sz(p.frame), ui: uiKeys, textGeomBytes, changed, same, instKeys: inst[0] ? Object.keys(inst[0]) : [], textKeys: ui.texts?.[0] ? Object.keys(ui.texts[0]) : [] });
    } catch (e) { rows.push({ err: String(e) }); }
    if (rows.length >= 30) { enc.encode = orig; resolve(); }
    return orig.call(this, p);
  };
  setTimeout(() => { enc.encode = orig; resolve(); }, 5000);
});
delete enc.encode;
return JSON.stringify({ n: rows.length, first: rows[1], last: rows[rows.length - 1], changed: rows.map((r) => r.changed), restored: enc.encode === orig });
