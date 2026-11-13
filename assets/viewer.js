// Pincheck's Schematic view, the counterpart of Fabcheck's Board: draws the dropped Altium sheets
// (PK.schdoc.graphics) on a canvas, with sheet tabs, pan and zoom, and hover names for pins and nets, and
// jumps to findings: the sheet with most of a finding's pins opens, framed, its parts, pins, and nets
// highlighted. Every finding with a place on the sheet carries a mark that is never color alone: errors
// a striped circle with ✕, warnings a dotted triangle with ▲ (Chris is colorblind).
//
// PK.viewer.render(container, design, state) is called by app.js on every render of the tab; one viewer
// is kept per design so the view doesn't jump. state.showFinding (a finding) is consumed once.
(function (PK) {
  'use strict';
  const S = PK.schdoc;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const SEV = { error: '✕', warn: '▲', info: 'i' };
  const RANK = { error: 0, warn: 1, info: 2 };
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
  const TEXT_EM = 0.8;           // a font's size in points drawn as this many sheet units per point
  const MIN_TEXT_PX = 3.5;       // smaller text isn't drawn

  // ── The model: each sheet's drawing, prepared once per design ──
  function model(d) {
    if (d._sch && d._sch.drawings === d.drawings) return d._sch;
    const partOf = new Map(d.parts.map(p => [p.ref, p]));
    const schRef = ref => { const p = partOf.get(ref); if (p) return p.schRef || p.ref; const m = /^(.+?)[._]\w+$/.exec(ref); return m ? m[1] : ref; };
    // The netlist's nets by schematic pin (a channel sheet's pin is on one net per channel).
    const netsAt = new Map();
    for (const n of d.nets || []) for (const node of n.nodes) {
      const k = schRef(node.ref) + '\u0000' + node.pin;
      if (!netsAt.has(k)) netsAt.set(k, []);
      if (!netsAt.get(k).includes(n.name)) netsAt.get(k).push(n.name);
    }
    const sheets = (d.drawings || []).map(dr => prepareSheet(dr, netsAt));
    d._sch = { drawings: d.drawings, sheets, schRef, partOf, hitRun: null, hits: new Map() };
    return d._sch;
  }

  function prepareSheet(dr, netsAt) {
    const c = S.connect(dr);
    const groupNets = Array.from({ length: c.groups }, () => new Set());
    const groupNames = Array.from({ length: c.groups }, () => new Set());
    dr.pins.forEach((p, i) => { const g = c.pin[i]; if (g >= 0) for (const n of netsAt.get(p.ref + '\u0000' + p.num) || []) groupNets[g].add(n); });
    dr.labels.forEach((l, i) => { if (l.text) groupNames[c.label[i]].add(l.text); });
    dr.powers.forEach((l, i) => { if (l.text) groupNames[c.power[i]].add(l.text); });
    dr.ports.forEach((l, i) => { if (l.name) groupNames[c.port[i]].add(l.name); });
    // A group's names: the netlist's, else its labels'.
    const netsOf = g => (g < 0 ? [] : groupNets[g].size ? [...groupNets[g]] : [...groupNames[g]]);
    const byNet = new Map();
    for (let g = 0; g < c.groups; g++) for (const n of new Set([...groupNets[g], ...groupNames[g]])) { if (!byNet.has(n)) byNet.set(n, []); byNet.get(n).push(g); }
    const pinsByKey = new Map();
    dr.pins.forEach((p, i) => { const k = p.ref + '\u0000' + p.num; if (!pinsByKey.has(k)) pinsByKey.set(k, []); pinsByKey.get(k).push(i); });
    const comps = new Map(); // ref → its placed units
    for (const x of dr.comps) { if (!comps.has(x.ref)) comps.set(x.ref, []); comps.get(x.ref).push(x); }
    // A grid of wire segments and pins, for hovering.
    const CELL = 40, grid = new Map();
    const put = (x0, y0, x1, y1, item) => {
      for (let gx = Math.floor(Math.min(x0, x1) / CELL); gx <= Math.floor(Math.max(x0, x1) / CELL); gx++)
        for (let gy = Math.floor(Math.min(y0, y1) / CELL); gy <= Math.floor(Math.max(y0, y1) / CELL); gy++) {
          const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(item);
        }
    };
    dr.wires.forEach((w, i) => { for (let j = 0; j + 3 < w.length; j += 2) put(w[j], w[j + 1], w[j + 2], w[j + 3], { k: 'wire', i, seg: [w[j], w[j + 1], w[j + 2], w[j + 3]] }); });
    dr.pins.forEach((p, i) => { if (!p.hidden) put(p.bx, p.by, p.x, p.y, { k: 'pin', i, seg: [p.bx, p.by, p.x, p.y] }); });
    const namesOf = g => (g < 0 ? [] : [...groupNames[g]]); // what the drawing names it: labels, ports, power ports
    return { dr, conn: c, netsOf, namesOf, byNet, pinsByKey, comps, grid, CELL, paths: null, texts: null };
  }

  // Where a finding is on each sheet: { sheet index: { pins, comps, groups, score } }.
  function hitsOf(m, f) {
    if (m.hits.has(f.id)) return m.hits.get(f.id);
    const out = [];
    m.sheets.forEach((s, si) => {
      const h = { si, pins: [], comps: [], groups: new Set(), score: 0 };
      for (const key of f.pins || []) {
        const dot = key.lastIndexOf('.');
        if (dot <= 0) continue;
        const ref = m.schRef(key.slice(0, dot)), num = key.slice(dot + 1);
        for (const i of s.pinsByKey.get(ref + '\u0000' + num) || []) if (!h.pins.includes(i)) h.pins.push(i);
      }
      for (const r of f.refs || []) { const ref = m.schRef(r); if (s.comps.has(ref) && !h.comps.includes(ref)) h.comps.push(ref); }
      for (const n of f.nets || []) for (const g of s.byNet.get(n) || []) h.groups.add(g);
      h.score = h.pins.length * 4 + h.comps.length * 2 + (h.groups.size ? 1 : 0);
      if (h.score) out.push(h);
    });
    out.sort((a, b) => b.score - a.score || a.si - b.si);
    m.hits.set(f.id, out);
    return out;
  }

  // ── Drawing a sheet into paths and texts (sheet units, Y up) ──
  function build(s) {
    if (s.paths) return;
    const dr = s.dr;
    const P = () => new Path2D();
    const p = { sheet: P(), bodyFill: P(), body: P(), bodyThick: P(), pins: P(), wires: P(), buses: P(), junctions: P(), power: P(), powerFill: P(), ports: P(), sym: P(), symFill: P(), noerc: P(), notesFill: P(), notes: P() };
    const texts = [];
    const T = (x, y, str, o) => texts.push(Object.assign({ x, y, s: str, size: 10, orient: 0, just: 0, cls: 'text' }, o));
    const poly = (path, pts, close) => { if (pts.length < 4) return; path.moveTo(pts[0], pts[1]); for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]); if (close) path.closePath(); };
    for (const sh of dr.shapes) {
      const stroke = sh.layer === 'body' ? (sh.w >= 3 ? p.bodyThick : p.body) : p.sheet;
      const fill = sh.layer === 'body' ? p.bodyFill : null;
      if (sh.t === 'line') poly(stroke, sh.pts, false);
      else if (sh.t === 'bez') { const q = sh.pts; if (q.length >= 8) { stroke.moveTo(q[0], q[1]); for (let i = 2; i + 5 < q.length; i += 6) stroke.bezierCurveTo(q[i], q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5]); } }
      else if (sh.t === 'poly') { poly(stroke, sh.pts, true); if (sh.fill && fill) poly(fill, sh.pts, true); }
      else if (sh.t === 'rect') {
        const x = Math.min(sh.x0, sh.x1), y = Math.min(sh.y0, sh.y1), w = Math.abs(sh.x1 - sh.x0), h = Math.abs(sh.y1 - sh.y0);
        const add = path => { if (sh.rx && path.roundRect) path.roundRect(x, y, w, h, Math.min(sh.rx, w / 2, h / 2)); else path.rect(x, y, w, h); };
        add(stroke); if (sh.fill && fill) add(fill);
      } else if (sh.t === 'ellipse') {
        stroke.moveTo(sh.cx + sh.rx, sh.cy); stroke.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, Math.PI * 2);
        if (sh.fill && fill) { fill.moveTo(sh.cx + sh.rx, sh.cy); fill.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, Math.PI * 2); }
      } else if (sh.t === 'arc') {
        const a0 = sh.a0 * Math.PI / 180, a1 = sh.a1 * Math.PI / 180;
        stroke.moveTo(sh.cx + sh.rx * Math.cos(a0), sh.cy + sh.ry * Math.sin(a0));
        stroke.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, a0, a1 <= a0 ? a1 + Math.PI * 2 : a1);
      }
    }
    // Pins: the line, the name inside the body, the number along the pin.
    for (const pin of dr.pins) {
      if (pin.hidden) continue;
      p.pins.moveTo(pin.bx, pin.by); p.pins.lineTo(pin.x, pin.y);
      const vert = pin.orient === 1 || pin.orient === 3;
      if (pin.showName && pin.name) {
        const [dx, dy] = DIR[pin.orient];
        T(pin.bx - dx * 4, pin.by - dy * 4, pin.name, { size: 9, orient: vert ? 1 : 0, just: pin.orient === 0 || pin.orient === 1 ? 5 : 3, cls: 'pinname', bar: true });
      }
      if (pin.showNum && pin.num) {
        const o = pin.orient;
        if (o === 0) T(pin.bx + 3, pin.by + 1, pin.num, { size: 8, just: 0, cls: 'pinnum' });
        else if (o === 2) T(pin.bx - 3, pin.by + 1, pin.num, { size: 8, just: 2, cls: 'pinnum' });
        else if (o === 1) T(pin.bx - 1, pin.by + 3, pin.num, { size: 8, orient: 1, just: 0, cls: 'pinnum' });
        else T(pin.bx - 1, pin.by - 3, pin.num, { size: 8, orient: 1, just: 2, cls: 'pinnum' });
      }
    }
    for (const t of dr.texts) T(t.x, t.y, t.s, { size: t.size, orient: t.orient, just: t.mirror ? mirrorJust(t.just) : t.just, bold: t.bold, cls: t.kind === 'designator' ? 'designator' : t.kind === 'param' ? 'param' : t.kind === 'body' ? 'text' : 'sheettext', bar: t.kind === 'body' });
    for (const w of dr.wires) poly(p.wires, w, false);
    for (const b of dr.buses) poly(p.buses, b, false);
    for (const [x, y] of dr.junctions) { p.junctions.moveTo(x + 2, y); p.junctions.arc(x, y, 2, 0, Math.PI * 2); }
    for (const l of dr.labels) if (l.text) T(l.x, l.y + (l.orient === 0 || l.orient === 2 ? 1 : 0), l.text, { size: l.font.size, orient: l.orient, just: l.just, cls: 'netlabel', bar: true });
    for (const pw of dr.powers) powerPort(pw, p, T);
    for (const pt of dr.ports) port(pt, p, T);
    for (const sy of dr.sheets) {
      p.sym.rect(sy.x, sy.y - sy.h, sy.w, sy.h); p.symFill.rect(sy.x, sy.y - sy.h, sy.w, sy.h);
      if (sy.name) T(sy.x, sy.y + 2, sy.name, { size: 10, cls: 'designator' });
      if (sy.file) T(sy.x, sy.y - sy.h - 2, sy.file, { size: 9, just: 6, cls: 'param' });
      for (const e of sy.entries) {
        const vert = e.side >= 2, inward = e.side === 0 ? 1 : e.side === 1 ? -1 : e.side === 2 ? -1 : 1;
        if (!vert) { p.sym.rect(e.side === 0 ? e.x : e.x - 10, e.y - 3, 10, 6); T(e.x + inward * 13, e.y, e.name, { size: 8, just: e.side === 0 ? 3 : 5, cls: 'pinname' }); }
        else { p.sym.rect(e.x - 3, e.side === 2 ? e.y - 10 : e.y, 6, 10); T(e.x, e.y + inward * 13, e.name, { size: 8, orient: 1, just: e.side === 2 ? 5 : 3, cls: 'pinname' }); }
      }
    }
    for (const n of dr.noerc) { p.noerc.moveTo(n.x - 3, n.y - 3); p.noerc.lineTo(n.x + 3, n.y + 3); p.noerc.moveTo(n.x - 3, n.y + 3); p.noerc.lineTo(n.x + 3, n.y - 3); }
    for (const fr of dr.frames) {
      const x = Math.min(fr.x0, fr.x1), y = Math.min(fr.y0, fr.y1), w = Math.abs(fr.x1 - fr.x0), h = Math.abs(fr.y1 - fr.y0);
      if (fr.fill || fr.note) p.notesFill.rect(x, y, w, h);
      if (fr.border || fr.note) p.notes.rect(x, y, w, h);
      if (fr.note) { p.notes.moveTo(x + w - 10, y + h); p.notes.lineTo(x + w, y + h - 10); }
      const lines = wrap(fr.text, fr.font.size * TEXT_EM, w - 8);
      lines.forEach((ln, i) => T(x + 4, y + h - 4 - i * fr.font.size * TEXT_EM * 1.2, ln, { size: fr.font.size, just: 6, cls: 'sheettext' }));
      if (fr.note && fr.author) T(x + 4, y + 4, fr.author, { size: 8, just: 0, cls: 'param' });
    }
    s.paths = p; s.texts = texts;
  }
  const mirrorJust = j => j % 3 === 0 ? j + 2 : j % 3 === 2 ? j - 2 : j;

  let measurer = null;
  function wrap(text, em, width) {
    if (!measurer) measurer = document.createElement('canvas').getContext('2d');
    measurer.font = em + 'px ' + FONT;
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? line + ' ' + word : word;
        if (line && measurer.measureText(tryLine).width > width) { out.push(line); line = word; } else line = tryLine;
      }
      out.push(line);
    }
    return out;
  }

  // Power ports: a stem from the connection point, then the symbol by style (0 circle, 1 arrow, 2 bar,
  // 3 wave, 4 power ground, 5 signal ground, 6 earth), pointing along ORIENTATION.
  function powerPort(pw, p, T) {
    const [dx, dy] = DIR[pw.orient], [px, py] = [-dy, dx];
    const at = (a, b) => [pw.x + dx * a + px * b, pw.y + dy * a + py * b];
    const line = (a0, b0, a1, b1) => { const [x0, y0] = at(a0, b0), [x1, y1] = at(a1, b1); p.power.moveTo(x0, y0); p.power.lineTo(x1, y1); };
    let reach = 10;
    if (pw.style === 4) { line(0, 0, 10, 0); line(10, -10, 10, 10); line(13, -6.5, 13, 6.5); line(16, -3, 16, 3); reach = 18; }
    else if (pw.style === 5) { line(0, 0, 10, 0); const a = at(10, -8), b = at(10, 8), c = at(17, 0); p.power.moveTo(a[0], a[1]); p.power.lineTo(b[0], b[1]); p.power.lineTo(c[0], c[1]); p.power.closePath(); reach = 19; }
    else if (pw.style === 6) { line(0, 0, 10, 0); line(10, -10, 10, 10); for (const b of [-10, 0, 10]) line(10, b, 16, b - 4); reach = 18; }
    else if (pw.style === 0) { line(0, 0, 6, 0); const [cx, cy] = at(8, 0); p.power.moveTo(cx + 2, cy); p.power.arc(cx, cy, 2, 0, Math.PI * 2); reach = 12; }
    else if (pw.style === 1) { line(0, 0, 6, 0); const a = at(6, -4), b = at(6, 4), c = at(10, 0); p.powerFill.moveTo(a[0], a[1]); p.powerFill.lineTo(b[0], b[1]); p.powerFill.lineTo(c[0], c[1]); p.powerFill.closePath(); reach = 12; }
    else if (pw.style === 3) { line(0, 0, 6, 0); const [x0, y0] = at(6, -6), [x1, y1] = at(6, 6); const [c1x, c1y] = at(10, -3), [c2x, c2y] = at(2, 3); p.power.moveTo(x0, y0); p.power.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1); reach = 12; }
    else { line(0, 0, 10, 0); line(10, -10, 10, 10); reach = 12; }
    if (!pw.show || !pw.text) return;
    const [tx, ty] = at(reach + 2, 0);
    const o = pw.orient;
    T(tx, ty, pw.text, { size: pw.font.size, just: o === 0 ? 3 : o === 2 ? 5 : o === 1 ? 1 : 7, cls: 'power' });
  }

  // Ports: a box WIDTH long and HEIGHT tall from LOCATION, pointed by STYLE (0 none, 1 left, 2 right, 3 both;
  // 4–7 the same, vertical).
  function port(pt, p, T) {
    const vert = pt.style >= 4, st = pt.style % 4, h = pt.h / 2, w = pt.w, k = Math.min(h, w / 3);
    const pts = [[0, -h], [w - (st === 2 || st === 3 ? k : 0), -h], [w, 0], [w - (st === 2 || st === 3 ? k : 0), h], [st === 1 || st === 3 ? k : 0, h], [0, 0], [st === 1 || st === 3 ? k : 0, -h]];
    const map = ([a, b]) => (vert ? [pt.x - b, pt.y + a] : [pt.x + a, pt.y + b]);
    const q = pts.map(map);
    p.ports.moveTo(q[0][0], q[0][1]);
    for (const [x, y] of q.slice(1)) p.ports.lineTo(x, y);
    p.ports.closePath();
    const [cx, cy] = map([w / 2, 0]);
    T(cx, cy, pt.name, { size: pt.font.size, orient: vert ? 1 : 0, just: 4, cls: 'port', bar: true });
  }

  // ── Colors from the suite's tokens ──
  let colors = null;
  function readColors(el) {
    const cs = getComputedStyle(el);
    const v = (k, f) => (cs.getPropertyValue(k) || '').trim() || f;
    return {
      bg: v('--bg-sunk', '#eee'), paper: v('--bg-elev', '#fff'), edge: v('--hair-2', '#ccc'), hair: v('--hair', '#ddd'),
      text: v('--text', '#111'), text2: v('--text-2', '#444'), text3: v('--text-3', '#888'),
      accent: v('--accent', '#0a7'), accentInk: v('--accent-ink', '#064'), accentSoft: v('--accent-soft', '#dff'),
      issue: v('--issue', '#d00'), warn: v('--warn', '#960'), onWarn: v('--on-warn', '#000'), issueSoft: v('--issue-soft', '#fdd'), warnSoft: v('--warn-soft', '#ffd'),
      dark: document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') !== 'light' && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches))
    };
  }
  // Canvas versions of --issue-hatch (stripes) and --warn-hatch (dots), in screen pixels.
  function patterns(ctx, c, dpr) {
    const make = (draw, size) => { const cv = document.createElement('canvas'); cv.width = cv.height = Math.round(size * dpr); const g = cv.getContext('2d'); g.scale(dpr, dpr); draw(g, size); return ctx.createPattern(cv, 'repeat'); };
    return {
      issue: make((g, n) => { g.fillStyle = c.issueSoft; g.fillRect(0, 0, n, n); g.strokeStyle = c.issue; g.globalAlpha = 0.45; g.lineWidth = 1.5; g.beginPath(); for (let i = -n; i <= n * 2; i += 6) { g.moveTo(i, 0); g.lineTo(i - n, n); } g.stroke(); }, 6),
      warn: make((g, n) => { g.fillStyle = c.warnSoft; g.fillRect(0, 0, n, n); g.fillStyle = c.warn; g.globalAlpha = 0.7; g.beginPath(); g.arc(n / 2, n / 2, 1, 0, Math.PI * 2); g.fill(); }, 5)
    };
  }

  // ── The viewer ──
  class Viewer {
    constructor(d) {
      this.d = d; this.si = 0; this.views = []; this.sel = null; this.hover = null; this.railOpen = true;
      const el = this.el = document.createElement('div');
      el.className = 'sv';
      el.__viewer = this;
      el.innerHTML = '<div class="sv-tabs" role="tablist"></div><div class="sv-body"><div class="sv-stage"><canvas class="sv-canvas" tabindex="0" aria-label="Schematic sheet"></canvas>' +
        '<div class="sv-tools"><button class="icon-btn" data-sv="in" title="Zoom in (+)" aria-label="Zoom in">+</button><button class="icon-btn" data-sv="out" title="Zoom out (−)" aria-label="Zoom out">−</button><button class="icon-btn" data-sv="fit" title="Fit the sheet (F)" aria-label="Fit the sheet"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></button></div>' +
        '<div class="sv-tip" hidden></div></div><aside class="sv-rail"></aside></div>';
      this.canvas = el.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
      this.tip = el.querySelector('.sv-tip');
      this.events();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(el.querySelector('.sv-stage'));
      const mo = new MutationObserver(() => { colors = null; this.pat = null; this.draw(); });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colors = null; this.pat = null; this.draw(); });
    }
    get m() { return model(this.d); }
    get sheet() { return this.m.sheets[this.si]; }
    live() { return ((this.d.run && this.d.run.findings) || []).filter(f => !f.waived); }

    mount(container, state) {
      this.state = state;
      this.size();
      container.replaceChildren(this.el);
      this.renderTabs(); this.renderRail();
      // Fit or frame once the canvas has its size (resize does it).
      const f = state.showFinding;
      if (f) { state.showFinding = null; this.pending = f.id; }
      this.resize();
    }
    // The viewer fills the main pane below the toolbar.
    size() {
      const main = document.getElementById('main'), tb = document.getElementById('toolbar');
      if (main) this.el.style.height = Math.max(320, main.clientHeight - (tb ? tb.offsetHeight : 0)) + 'px';
    }
    resize() {
      const st = this.el.querySelector('.sv-stage'), w = st.clientWidth, h = st.clientHeight;
      if (!w || !h) return;
      if (w === this.cw && h === this.ch && !this.pending && this.views[this.si]) { this.draw(); return; }
      const dpr = window.devicePixelRatio || 1;
      const old = this.cw ? [this.cw, this.ch] : null;
      this.cw = w; this.ch = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.pat = null;
      const v = this.views[this.si];
      if (v && old) { v.ox += (w - old[0]) / 2; v.oy += (h - old[1]) / 2; }
      if (this.pending) { const id = this.pending; this.pending = null; this.focus(id, false); }
      else if (!v) this.fit(false);
      this.draw();
    }

    // ── Views ──
    fitBox(b, pad) {
      const w = this.cw || 800, h = this.ch || 600, bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
      const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
      return { scale, ox: w / 2 - (b[0] + bw / 2) * scale, oy: h / 2 + (b[1] + bh / 2) * scale };
    }
    fit(animate) { const s = this.sheet; if (!s) return; this.go(this.fitBox(s.dr.bounds, 16), animate); }
    go(v, animate) {
      cancelAnimationFrame(this.fly);
      const from = this.views[this.si];
      if (!animate || !from || reduced()) { this.views[this.si] = v; this.draw(); return; }
      const t0 = performance.now(), T = 380;
      // Zoom in log space and move the center along, so the flight reads as a camera move.
      const c0 = this.center(from), c1 = this.center(v);
      const step = now => {
        const t = Math.min(1, (now - t0) / T), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const scale = Math.exp(Math.log(from.scale) + (Math.log(v.scale) - Math.log(from.scale)) * e);
        const cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
        this.views[this.si] = { scale, ox: this.cw / 2 - cx * scale, oy: this.ch / 2 + cy * scale };
        this.draw();
        if (t < 1) this.fly = requestAnimationFrame(step);
      };
      this.fly = requestAnimationFrame(step);
    }
    center(v) { return [(this.cw / 2 - v.ox) / v.scale, (v.oy - this.ch / 2) / v.scale]; }
    zoomAt(k, sx, sy) {
      const v = this.views[this.si]; if (!v) return;
      const b = this.sheet.dr.bounds, fit = this.fitBox(b, 16).scale;
      const scale = Math.min(fit * 80, Math.max(fit * 0.5, v.scale * k));
      const x = (sx - v.ox) / v.scale, y = (v.oy - sy) / v.scale;
      this.views[this.si] = { scale, ox: sx - x * scale, oy: sy + y * scale };
      this.draw();
    }
    toSheet(sx, sy) { const v = this.views[this.si]; return [(sx - v.ox) / v.scale, (v.oy - sy) / v.scale]; }

    showSheet(si, animate) {
      if (si === this.si || !this.m.sheets[si]) return;
      this.si = si; this.hover = null; this.tip.hidden = true;
      if (!this.views[si]) this.fit(false);
      this.renderTabs(); this.renderRail(); this.draw();
    }

    // ── Findings ──
    focus(id, animate) {
      const f = this.live().find(x => x.id === id) || ((this.d.run && this.d.run.findings) || []).find(x => x.id === id);
      if (!f) return;
      this.sel = f.id;
      const hits = hitsOf(this.m, f);
      if (!hits.length) { this.renderRail(); this.draw(); return; }
      const best = hits.some(h => h.si === this.si) && hits[0].score === (hits.find(h => h.si === this.si) || {}).score ? this.si : hits[0].si;
      const moved = best !== this.si;
      if (moved) { this.si = best; this.renderTabs(); }
      const box = this.frameOf(f, hits.find(h => h.si === best));
      if (box) {
        // Frame with room around it, so the parts nearby show where on the sheet it is.
        const pad = 60, minW = 260, minH = 170;
        let [x0, y0, x1, y1] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
        if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
        if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
        const target = this.fitBox([x0, y0, x1, y1], 24);
        if (!this.views[best] || moved) this.views[best] = this.fitBox(this.sheet.dr.bounds, 16);
        this.go(target, animate !== false && !moved);
      }
      this.renderRail();
    }
    frameOf(f, h) {
      if (!h) return null;
      const s = this.m.sheets[h.si], dr = s.dr;
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      const take = (x, y) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); };
      for (const i of h.pins) { const p = dr.pins[i]; take(p.x, p.y); take(p.bx, p.by); }
      // Its pins when it names any (a part's other pins are context); else its parts' bodies.
      if (!h.pins.length) for (const r of h.comps) for (const c of s.comps.get(r) || []) { take(c.bbox[0], c.bbox[1]); take(c.bbox[2], c.bbox[3]); }
      if (b[0] === Infinity) for (const g of h.groups) {
        dr.wires.forEach((w, i) => { if (s.conn.wire[i] === g) for (let j = 0; j < w.length; j += 2) take(w[j], w[j + 1]); });
        dr.labels.forEach((l, i) => { if (s.conn.label[i] === g) take(l.x, l.y); });
        dr.powers.forEach((l, i) => { if (s.conn.power[i] === g) take(l.x, l.y); });
      }
      return b[0] === Infinity ? null : b;
    }
    // A finding's marks on this sheet: at its pins, else at its parts, else on its net.
    marksOf(f, h) {
      const s = this.sheet, dr = s.dr, out = [];
      if (h.pins.length) for (const i of h.pins) out.push([dr.pins[i].x, dr.pins[i].y]);
      else if (h.comps.length) for (const r of h.comps.slice(0, 6)) for (const c of s.comps.get(r) || []) out.push([c.bbox[2], c.bbox[3]]);
      else for (const g of h.groups) {
        const li = dr.labels.findIndex((l, i) => s.conn.label[i] === g);
        if (li >= 0) { out.push([dr.labels[li].x, dr.labels[li].y]); continue; }
        const wi = dr.wires.findIndex((w, i) => s.conn.wire[i] === g);
        if (wi >= 0) out.push([dr.wires[wi][0], dr.wires[wi][1]]);
      }
      return out;
    }
    sheetFindings(si) {
      return this.live().map(f => ({ f, h: hitsOf(this.m, f).find(x => x.si === si) })).filter(x => x.h)
        .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity]);
    }
    step(dir) {
      const all = this.live().filter(f => hitsOf(this.m, f).length);
      if (!all.length) return;
      const i = all.findIndex(f => f.id === this.sel);
      const next = all[(i + dir + all.length) % all.length] || all[0];
      this.focus(next.id, true);
    }

    // ── Drawing ──
    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); });
    }
    paint() {
      const s = this.sheet, v = this.views[this.si], ctx = this.ctx;
      if (!s || !v || !this.cw) return;
      build(s);
      if (!colors) colors = readColors(this.el);
      const c = colors, dpr = this.dpr;
      if (!this.pat) this.pat = patterns(ctx, c, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = c.bg; ctx.fillRect(0, 0, this.cw, this.ch);
      const k = v.scale, px = 1 / k;
      const sheetT = () => ctx.setTransform(dpr * k, 0, 0, -dpr * k, dpr * v.ox, dpr * v.oy);
      sheetT();
      const dr = s.dr, p = s.paths;
      // The paper.
      ctx.fillStyle = c.paper; ctx.fillRect(0, 0, dr.w, dr.h);
      ctx.lineWidth = px; ctx.strokeStyle = c.edge; ctx.strokeRect(0, 0, dr.w, dr.h);
      const lw = units => Math.max(px, units);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // The finding's nets and the hovered net, under everything.
      const selF = this.sel && this.live().find(f => f.id === this.sel);
      const selH = selF && hitsOf(this.m, selF).find(h => h.si === this.si);
      const glow = (groups, color, width, alpha) => {
        if (!groups || !groups.size) return;
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = Math.max(width * px, 3);
        const path = new Path2D();
        dr.wires.forEach((w, i) => { if (groups.has(s.conn.wire[i])) { path.moveTo(w[0], w[1]); for (let j = 2; j + 1 < w.length; j += 2) path.lineTo(w[j], w[j + 1]); } });
        dr.pins.forEach((pin, i) => { if (groups.has(s.conn.pin[i])) { path.moveTo(pin.bx, pin.by); path.lineTo(pin.x, pin.y); } });
        ctx.stroke(path); ctx.restore();
      };
      if (selH) glow(selH.groups, selF.severity === 'error' ? c.issue : selF.severity === 'warn' ? c.warn : c.accent, 7, 0.35);
      if (this.hover && this.hover.g >= 0) glow(new Set([this.hover.g]), c.accent, 6, 0.25);

      ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.04)' : c.accentSoft; ctx.fill(p.bodyFill);
      ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.03)' : c.accentSoft; ctx.fill(p.symFill);
      ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)'; ctx.fill(p.notesFill);
      ctx.strokeStyle = c.text3; ctx.lineWidth = lw(0.6); ctx.stroke(p.sheet);
      ctx.strokeStyle = c.hair; ctx.lineWidth = lw(0.6); ctx.stroke(p.notes);
      ctx.strokeStyle = c.text2; ctx.lineWidth = lw(1); ctx.stroke(p.body); ctx.lineWidth = lw(2.5); ctx.stroke(p.bodyThick);
      ctx.lineWidth = lw(1); ctx.stroke(p.pins); ctx.stroke(p.sym);
      ctx.strokeStyle = c.accent; ctx.lineWidth = lw(1); ctx.stroke(p.wires); ctx.lineWidth = lw(3); ctx.stroke(p.buses);
      ctx.fillStyle = c.accent; ctx.fill(p.junctions);
      ctx.strokeStyle = c.accentInk; ctx.lineWidth = lw(1); ctx.stroke(p.power); ctx.fillStyle = c.accentInk; ctx.fill(p.powerFill); ctx.stroke(p.ports);
      ctx.strokeStyle = c.text3; ctx.stroke(p.noerc);

      // The selected finding's parts: a dashed box around each.
      if (selH) {
        ctx.save(); ctx.setLineDash([4 * px, 3 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = selF.severity === 'error' ? c.issue : selF.severity === 'warn' ? c.warn : c.accent;
        // Each unit of its parts, or with pins named, only the units holding them.
        const pinUnits = new Set(selH.pins.map(i => dr.pins[i].cid));
        for (const r of selH.comps) for (const cp of s.comps.get(r) || []) {
          if (selH.pins.length && !pinUnits.has(cp.cid)) continue;
          const [x0, y0, x1, y1] = cp.bbox; ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
        }
        ctx.restore();
      }

      // Text, in screen space so it stays upright and crisp; skipped when too small or off screen.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = 'alphabetic';
      const col = { text: c.text2, pinname: c.text, pinnum: c.text3, designator: c.text, param: c.text3, netlabel: c.accentInk, power: c.accentInk, port: c.accentInk, sheettext: c.text2 };
      const fonts = new Map();
      for (const t of s.texts) {
        const size = t.size * TEXT_EM * k;
        if (size < MIN_TEXT_PX) continue;
        const sx = v.ox + t.x * k, sy = v.oy - t.y * k;
        const reach = (t.s.length * 0.62 + 1) * size;
        if (sx < -reach || sx > this.cw + reach || sy < -reach || sy > this.ch + reach) continue;
        const fk = (t.bold ? 'bold ' : '') + size.toFixed(1);
        if (!fonts.has(fk)) fonts.set(fk, (t.bold ? '600 ' : '') + size.toFixed(1) + 'px ' + FONT);
        ctx.font = fonts.get(fk);
        ctx.fillStyle = col[t.cls] || c.text2;
        drawText(ctx, t, sx, sy, size);
      }

      // Finding marks: every finding with a place here, the selected one larger and ringed.
      const list = this.sheetFindings(this.si);
      this.markHits = [];
      for (const { f, h } of list.slice().reverse()) {
        const on = f.id === this.sel;
        for (const [x, y] of this.marksOf(f, h)) {
          const sx = v.ox + x * k, sy = v.oy - y * k;
          if (sx < -20 || sx > this.cw + 20 || sy < -20 || sy > this.ch + 20) continue;
          mark(ctx, sx, sy, f.severity, on ? 11 : 7.5, c, this.pat, on);
          this.markHits.push({ x: sx, y: sy, r: on ? 12 : 9, id: f.id });
        }
      }
    }

    // ── Hover and clicks ──
    pick(sx, sy) {
      const s = this.sheet, v = this.views[this.si];
      if (!s || !v) return null;
      for (const mh of (this.markHits || []).slice().reverse()) if (Math.hypot(mh.x - sx, mh.y - sy) <= mh.r) return { finding: mh.id };
      const [x, y] = this.toSheet(sx, sy), tol = 5 / v.scale;
      let best = null, bd = tol;
      const seen = new Set();
      for (let gx = Math.floor((x - tol) / s.CELL); gx <= Math.floor((x + tol) / s.CELL); gx++)
        for (let gy = Math.floor((y - tol) / s.CELL); gy <= Math.floor((y + tol) / s.CELL); gy++)
          for (const it of s.grid.get(gx + ',' + gy) || []) {
            if (seen.has(it)) continue; seen.add(it);
            const dd = segDist(x, y, it.seg) - (it.k === 'pin' ? tol * 0.4 : 0);
            if (dd < bd) { bd = dd; best = it; }
          }
      if (best) {
        if (best.k === 'pin') { const pin = s.dr.pins[best.i]; return { pin, g: s.conn.pin[best.i] }; }
        return { g: s.conn.wire[best.i] };
      }
      // Over a part's body: name the part.
      let comp = null;
      for (const cp of [].concat(...s.comps.values())) { const b = cp.bbox; if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && (!comp || area(b) < area(comp.bbox))) comp = cp; }
      return comp ? { comp, g: -1 } : null;
    }
    tipFor(hit) {
      const s = this.sheet;
      if (hit.finding) { const f = this.live().find(x => x.id === hit.finding); return f ? '<b>' + SEV[f.severity] + ' ' + esc(f.title) + '</b>' : ''; }
      const nets = s.netsOf(hit.g);
      const netLine = nets.length ? '<span class="sv-tip-net">' + (nets.length > 1 ? 'Nets ' : 'Net ') + esc(nets.slice(0, 6).join(', ')) + (nets.length > 6 ? ', …' : '') + '</span>' : '';
      if (hit.pin) {
        const part = this.m.partOf.get(hit.pin.ref);
        return '<b>' + esc(hit.pin.ref) + ' pin ' + esc(hit.pin.num) + '</b> ' + esc(hit.pin.name.replace(/\\/g, '')) + (part && part.mpn ? ' <span class="pk-muted">' + esc(part.mpn) + '</span>' : '') + (netLine ? '<br>' + netLine : '<br><span class="pk-muted">No net</span>');
      }
      if (hit.comp) { const part = this.m.partOf.get(hit.comp.ref) || [...this.m.partOf.values()].find(p => p.schRef === hit.comp.ref); return '<b>' + esc(hit.comp.ref) + '</b> ' + esc(part ? part.mpn || part.params.Comment || '' : hit.comp.libRef) + (part && part.description ? '<br><span class="pk-muted">' + esc(part.description.slice(0, 80)) + '</span>' : ''); }
      return netLine || '<span class="pk-muted">Wire on no net</span>';
    }

    events() {
      const cv = this.canvas;
      const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      const pointers = new Map();
      let drag = null, moved = false, pinch = null;
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const [sx, sy] = pos(e);
        const k = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0015);
        this.zoomAt(k, sx, sy);
      }, { passive: false });
      cv.addEventListener('pointerdown', e => {
        cv.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, pos(e));
        cancelAnimationFrame(this.fly);
        if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; drag = null; return; }
        const v = this.views[this.si];
        drag = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy }; moved = false;
      });
      cv.addEventListener('pointermove', e => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pos(e));
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const v = this.views[this.si]; v.ox += c[0] - pinch.c[0]; v.oy += c[1] - pinch.c[1];
          this.zoomAt(dd / pinch.d, c[0], c[1]); pinch = { d: dd, c }; moved = true; return;
        }
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          if (moved) { const v = this.views[this.si]; v.ox = drag.ox + dx; v.oy = drag.oy + dy; this.tip.hidden = true; this.draw(); cv.classList.add('grabbing'); }
          return;
        }
        if (this._hoverRaf) return;
        const [sx, sy] = pos(e);
        this._hoverRaf = requestAnimationFrame(() => {
          this._hoverRaf = 0;
          const hit = this.pick(sx, sy);
          const g = hit && hit.g != null ? hit.g : -1;
          if ((this.hover ? this.hover.g : -1) !== g) { this.hover = hit && g >= 0 ? { g } : null; this.draw(); }
          cv.style.cursor = hit && hit.finding ? 'pointer' : '';
          if (!hit) { this.tip.hidden = true; return; }
          this.tip.innerHTML = this.tipFor(hit);
          this.tip.hidden = !this.tip.innerHTML;
          const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
          this.tip.style.left = Math.min(this.cw - tw - 6, sx + 14) + 'px';
          this.tip.style.top = (sy + 18 + th > this.ch ? sy - th - 10 : sy + 18) + 'px';
        });
      });
      const up = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        cv.classList.remove('grabbing');
        if (drag && !moved && e.type === 'pointerup') {
          const hit = this.pick(...pos(e));
          if (hit && hit.finding) this.focus(hit.finding, true);
        }
        drag = null;
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => { this.tip.hidden = true; if (this.hover) { this.hover = null; this.draw(); } });
      cv.addEventListener('dblclick', e => { const [sx, sy] = pos(e); this.zoomAt(2, sx, sy); });

      this.el.addEventListener('click', e => {
        const b = e.target.closest('[data-sv],[data-sheet],[data-svf],[data-svopen]');
        if (!b) return;
        if (b.dataset.sheet != null) { this.showSheet(+b.dataset.sheet); return; }
        if (b.dataset.svf) { this.focus(b.dataset.svf, true); return; }
        if (b.dataset.svopen) { this.state.openFinding = b.dataset.svopen; return; } // app.js then switches to Findings
        const a = b.dataset.sv;
        if (a === 'in') this.zoomAt(1.5, this.cw / 2, this.ch / 2);
        else if (a === 'out') this.zoomAt(1 / 1.5, this.cw / 2, this.ch / 2);
        else if (a === 'fit') this.fit(true);
        else if (a === 'prev') this.step(-1);
        else if (a === 'next') this.step(1);
        else if (a === 'rail') { this.railOpen = !this.railOpen; this.el.classList.toggle('rail-closed', !this.railOpen); this.renderRail(); }
        else if (a === 'clear') { this.sel = null; this.renderRail(); this.draw(); }
      });
    }

    // ── Sheet tabs and the findings rail ──
    renderTabs() {
      const m = this.m;
      this.el.querySelector('.sv-tabs').innerHTML = m.sheets.map((s, i) => {
        const fs = this.sheetFindings(i), e = fs.filter(x => x.f.severity === 'error').length, w = fs.filter(x => x.f.severity === 'warn').length;
        return '<button role="tab" data-sheet="' + i + '" class="sv-tab' + (i === this.si ? ' on' : '') + '" title="' + esc(s.dr.name) + '">' + esc(s.dr.name.replace(/\.schdoc$/i, '')) +
          (e ? ' <span class="sv-count sv-count-error"><span aria-hidden="true">✕</span> ' + e + '</span>' : '') + (w ? ' <span class="sv-count sv-count-warn"><span aria-hidden="true">▲</span> ' + w + '</span>' : '') + '</button>';
      }).join('');
    }
    renderRail() {
      const rail = this.el.querySelector('.sv-rail');
      const list = this.sheetFindings(this.si);
      const sel = this.sel && this.live().find(f => f.id === this.sel);
      const all = this.live().filter(f => hitsOf(this.m, f).length);
      let h = '<div class="sv-rail-head"><button class="icon-btn" data-sv="rail" title="' + (this.railOpen ? 'Hide' : 'Show') + ' the findings" aria-label="Toggle the findings list">' + (this.railOpen ? '›' : '‹') + '</button>' +
        (this.railOpen ? '<b>' + list.length + ' finding' + (list.length === 1 ? '' : 's') + ' on this sheet</b>' : '') + '</div>';
      if (!this.railOpen) { rail.innerHTML = h; return; }
      if (sel) {
        const hits = hitsOf(this.m, sel), i = all.findIndex(f => f.id === sel.id);
        h += '<div class="sv-sel"><div class="sv-sel-nav"><button class="btn btn-sm" data-sv="prev" title="Previous finding (P)">‹ Prev</button><span class="pk-muted">' + (i + 1) + ' of ' + all.length + '</span><button class="btn btn-sm" data-sv="next" title="Next finding (N)">Next ›</button></div>' +
          '<div class="sv-sel-title"><span class="pk-sev pk-sev-' + sel.severity + '"><span aria-hidden="true">' + SEV[sel.severity] + '</span>' + ({ error: 'Error', warn: 'Warning', info: 'Note' })[sel.severity] + '</span>' + (sel.unverified ? ' <span class="pk-tag-unv">unverified</span>' : '') + '</div>' +
          '<b>' + esc(sel.title) + '</b><p>' + esc(sel.detail) + '</p>';
        if (!hits.length) h += '<p class="pk-muted">None of its parts, pins, or nets is drawn on these sheets.</p>';
        const others = hits.filter(x => x.si !== this.si);
        if (others.length) h += '<div class="sv-also"><span class="pk-muted">Also on</span> ' + others.map(x => '<button class="tag" data-sheet="' + x.si + '">' + esc(this.m.sheets[x.si].dr.name.replace(/\.schdoc$/i, '')) + '</button>').join(' ') + '</div>';
        h += '<div class="pk-btns">' + '<button class="btn btn-sm" data-tab="findings" data-svopen="' + esc(sel.id) + '">Open in Findings</button>' + (sel.refs[0] ? '<button class="btn btn-sm" data-config="' + esc(sel.refs[0]) + '">Open ' + esc(sel.refs[0]) + '\'s part</button>' : '') + '<button class="btn btn-sm" data-sv="clear">Clear</button></div></div>';
      } else if (all.length) h += '<p class="pk-muted sv-hint">Click a finding or a mark on the sheet. N and P step through them, F fits the sheet.</p>';
      h += '<div class="sv-list">' + list.map(({ f }) => '<button class="sv-item' + (sel && f.id === sel.id ? ' on' : '') + '" data-svf="' + esc(f.id) + '"><span class="pk-sevdot pk-sev-' + f.severity + '" aria-hidden="true">' + SEV[f.severity] + '</span><span>' + esc(f.title) + '</span></button>').join('') + '</div>';
      if (!list.length) h += '<p class="pk-muted sv-hint">' + (this.live().length ? 'No findings on this sheet.' : 'No findings.') + '</p>';
      rail.innerHTML = h;
      const on = rail.querySelector('.sv-item.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
  }

  const area = b => (b[2] - b[0]) * (b[3] - b[1]);
  function segDist(x, y, [x0, y0, x1, y1]) {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L)) : 0;
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
  }

  // Text at a screen point, by Altium's justification (0–8: bottom, middle, top × left, center, right) and
  // orientation in quarter turns. Upside-down text (2, 3) is drawn readable, anchored the same way.
  // A backslash after a character draws a bar over it (R\E\S\E\T\).
  function drawText(ctx, t, sx, sy, size) {
    let o = t.orient & 3, j = t.just;
    if (o >= 2) { o -= 2; j = 8 - j; }
    const h = j % 3, vb = Math.floor(j / 3);
    const bars = t.bar && t.s.includes('\\');
    const str = bars ? t.s.replace(/\\/g, '') : t.s;
    ctx.save();
    ctx.translate(sx, sy);
    if (o === 1) ctx.rotate(-Math.PI / 2);
    ctx.textAlign = h === 0 ? 'left' : h === 1 ? 'center' : 'right';
    const y = vb === 0 ? -size * 0.12 : vb === 1 ? size * 0.36 : size * 0.86;
    ctx.fillText(str, 0, y);
    if (bars) {
      const w = ctx.measureText(str).width, x0 = h === 0 ? 0 : h === 1 ? -w / 2 : -w;
      let plain = '';
      ctx.lineWidth = Math.max(0.6, size / 14); ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      for (let i = 0; i < t.s.length; i++) {
        const ch = t.s[i];
        if (ch === '\\') continue;
        const a = ctx.measureText(plain).width;
        plain += ch;
        if (t.s[i + 1] === '\\') { const b = ctx.measureText(plain).width; ctx.moveTo(x0 + a, y - size * 0.8); ctx.lineTo(x0 + b, y - size * 0.8); }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // A finding mark: errors a striped circle with ✕, warnings a dotted triangle with ▲'s shape, notes a
  // plain circle with i. The selected one is larger with a ring.
  function mark(ctx, x, y, sev, r, c, pat, on) {
    ctx.save();
    ctx.beginPath();
    if (sev === 'warn') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.lineTo(x - r * 1.1, y + r * 0.8); ctx.closePath(); }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = sev === 'error' ? pat.issue : sev === 'warn' ? pat.warn : c.accentSoft;
    ctx.fill();
    ctx.lineWidth = on ? 2 : 1.4; ctx.strokeStyle = sev === 'error' ? c.issue : sev === 'warn' ? c.warn : c.accent; ctx.stroke();
    if (on) { ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = sev === 'error' ? c.issue : sev === 'warn' ? c.text : c.accentInk;
    ctx.font = '700 ' + Math.round(r * (sev === 'warn' ? 0.95 : 1.2)) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sev === 'error' ? '✕' : sev === 'warn' ? '!' : 'i', x, y + (sev === 'warn' ? r * 0.12 : 0.5));
    ctx.restore();
  }

  // ── Entry point ──
  function render(container, d, state) {
    if (!d.drawings || !d.drawings.length) {
      const why = d.source === 'kicad'
        ? '<h2>No drawing in a KiCad netlist</h2><p>A KiCad XML netlist lists the parts and their connections but not how the sheets are drawn, so there is nothing to show here. The checks, Overview, and Findings work the same.</p>'
        : '<h2>No sheets to draw</h2><p>Only the netlist was opened. Drop the project\'s .SchDoc sheets together with its Protel2 netlist to see them here.</p>';
      container.innerHTML = '<div class="page"><div class="empty"><div class="empty-art"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h10M7 16h6"/></svg></div>' + why + '</div></div>';
      if (state) state.showFinding = null;
      return;
    }
    if (!d._viewer) d._viewer = new Viewer(d);
    // A rerun or a waiver brings new finding objects: forget their places.
    const m = model(d);
    if (m.hitRun !== d.run) { m.hitRun = d.run; m.hits.clear(); }
    d._viewer.mount(container, state);
  }

  // Keys while the schematic shows: F fits, N and P step through findings, + and − zoom.
  document.addEventListener('keydown', e => {
    const el = document.querySelector('.sv');
    if (!el || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.sheet-wrap')) return;
    const v = PK.viewer._active();
    if (!v) return;
    const k = e.key.toLowerCase();
    if (k === 'f') v.fit(true);
    else if (k === 'n') v.step(1);
    else if (k === 'p') v.step(-1);
    else if (k === '+' || k === '=') v.zoomAt(1.5, v.cw / 2, v.ch / 2);
    else if (k === '-') v.zoomAt(1 / 1.5, v.cw / 2, v.ch / 2);
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => { const v = PK.viewer._active(); if (v) { v.size(); } });

  PK.viewer = {
    render, model, hitsOf: (d, f) => hitsOf(model(d), f),
    _active: () => { const el = document.querySelector('.sv'); return el ? el.__viewer || null : null; }
  };
})(window.PK = window.PK || {});
