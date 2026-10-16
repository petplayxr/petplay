const { serialize } = await import("node:v8");
const view = [...state.views.values()][0];
const enc = view.wireEncoder;
const orig = enc.encode;
const rows = [];
let prev = null;
const key = (x) => { const { geometry, ...r } = x; return serialize(r).toString("base64"); };
await new Promise((resolve) => {
  enc.encode = function (p) {
    try {
      const cur = { panels: p.ui.panels.map(key), texts: p.ui.texts.map(key), images: p.ui.images.map(key) };
      if (prev) {
        const r = {};
        for (const k of Object.keys(cur)) {
          let c = 0; for (let i = 0; i < cur[k].length; i++) if (cur[k][i] !== prev[k][i]) c++;
          r[k] = c + "/" + cur[k].length;
        }
        rows.push(r);
      }
      prev = cur;
      if (rows.length === 1) rows.push({ panelSample: p.ui.panels[0], anchored: p.ui.panels.filter(x=>x.renderAnchor).length + "/" + p.ui.panels.length });
    } catch (e) { rows.push({ err: String(e) }); }
    if (rows.length >= 40) { enc.encode = orig; resolve(); }
    return orig.call(this, p);
  };
  setTimeout(() => { enc.encode = orig; resolve(); }, 5000);
});
delete enc.encode;
return JSON.stringify(rows, (k, v) => ArrayBuffer.isView(v) ? Array.from(v).map(n=>+n.toFixed?.(3)) : v);
