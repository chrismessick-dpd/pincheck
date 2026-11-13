// Pincheck's scan panel, the counterpart of Fabcheck's inspection stage: at the top of the Overview, every
// dropped sheet as a thumbnail in a grid, all running at once while the checks play. Dots pop in and fade
// over the pins each check reads, what was read stays as small solid dots, a sheet being read pulses its
// outline, and findings land as marks where they sit (✕ in a striped square, ▲ dotted, i in a ring: never
// hue alone). Beside it, the check under way; along the top, Fabcheck's progress bar, which becomes a slider
// of checks once the run is done, to replay one. Designed in lab/scan-panel.html (Chris, 2026-11-13).
//
// The checks themselves finish in milliseconds (assets/checks.js), so this is a paced replay of the finished
// run, about 8 seconds whatever the design's size (Chris). It shows only for designs with sheet drawings
// (PK.design's `drawings`); a netlist alone gets no panel, as Fabcheck shows no stage without a board.
//
// PK.scan.attach(host, design, run, opts) puts the design's panel in `host`, keeping the same panel (and its
// animation) across re-renders while `run` is the same object. opts.play starts a replay; opts.onDone is
// called when a replay ends; opts.lib is the library the run used. PK.scan.running(design) is true while it
// plays. PK.scan.emptyHtml() is the start page's empty panel, which takes a drop or a click.
(function (PK) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RM = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b || a + 's');
  const SEVCH = { error: '✕', warn: '▲', info: 'i' };
  const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const TOTAL = 8000;        // a replay's length, ms (Chris, 2026-11-13: about 8 s)
  const MAX_BEATS = 8;       // at most this many beats per sheet per check; more parts share a beat
  const HOLD = 900;          // a replayed check holds at its end this long before playing again
  const REPLAY_SLOW = 2.5;   // a replayed check plays this much slower than in the run, so its words can be read (Chris)
  const CARD_MIN = 208;      // the narrowest thumbnail; columns share the width equally

  const counts = fs => { const c = { error: 0, warn: 0, info: 0 }; for (const f of fs) c[f.severity]++; return c; };
  const cnt = c => '<span class="sp-c e" title="Errors"><b aria-hidden="true">✕</b>' + c.error + '</span><span class="sp-c w" title="Warnings"><b aria-hidden="true">▲</b>' + c.warn + '</span><span class="sp-c i" title="Notes"><b aria-hidden="true">i</b>' + c.info + '</span>';
  const fileIdOf = (run, ref) => { const v = run.parts && run.parts[ref]; return !v ? null : typeof v === 'string' ? v : v.file || v.id || null; };

  // ── Where things are: board pins and parts on the sheets ──
  // Board designators (C1.2, a channel copy) map to the sheet's designator (C1), as the viewer does.
  function geometry(d) {
    const sheets = (d.drawings || []).map((dr, i) => {
      const b = dr.bounds || [0, 0, dr.w, dr.h];
      return { i, dr, name: (dr.name || 'Sheet ' + (i + 1)).replace(/\.schdoc$/i, ''), b, bw: Math.max(1, b[2] - b[0]), bh: Math.max(1, b[3] - b[1]) };
    });
    const at = new Map(), comp = new Map();
    for (const s of sheets) {
      for (const p of s.dr.pins) {
        if (p.hidden) continue;
        const k = p.ref + '\u0000' + p.num, dir = DIR[p.orient & 3] || [1, 0];
        if (!at.has(k)) at.set(k, []);
        at.get(k).push({ sheet: s.i, x: p.x, y: p.y, dx: dir[0], dy: dir[1] });
      }
      for (const c of s.dr.comps) if (c.bbox && !comp.has(c.ref)) comp.set(c.ref, { sheet: s.i, x: (c.bbox[0] + c.bbox[2]) / 2, y: (c.bbox[1] + c.bbox[3]) / 2, part: true });
    }
    const schRef = p => p.schRef || (comp.has(p.ref) ? p.ref : ((/^(.+?)[._]\w+$/.exec(p.ref) || [])[1] || p.ref));
    const pinAt = new Map(), partAt = new Map();
    for (const p of d.parts) {
      const s = schRef(p);
      if (comp.has(s)) partAt.set(p.ref, comp.get(s));
      for (const pin of p.pins) { const l = at.get(s + '\u0000' + pin.num); if (l) pinAt.set(p.ref + '.' + pin.num, l); }
    }
    return { sheets, pinAt, partAt };
  }

  // ── The replay: a step per check (the catalog's order), a lane per sheet, a beat per part ──
  function plan(d, run, lib, G) {
    const files = new Map((lib || []).map(f => [f.id, f]));
    const filed = new Set(d.parts.map(p => p.ref).filter(r => fileIdOf(run, r)));
    const fileOf = ref => files.get(fileIdOf(run, ref));
    const netOf = new Map(), nets = new Map();
    for (const n of d.nets || []) { nets.set(n.name, n.nodes.map(x => x.ref + '.' + x.pin)); for (const x of n.nodes) netOf.set(x.ref + '.' + x.pin, n.name); }
    const roleOf = (ref, num) => { const f = fileOf(ref); const p = f && (f.pins || []).find(x => x.num === num); return p ? p.role || '' : ''; };
    const pins = d.parts.flatMap(p => p.pins.map(pin => ({ ref: p.ref, key: p.ref + '.' + pin.num, num: pin.num, name: pin.name || '', type: pin.type || '', kind: p.kind })));
    const fp = pins.filter(p => filed.has(p.ref));
    const isPower = p => /power|supply/.test(roleOf(p.ref, p.num)) || p.type === 'power';
    const isGround = p => /ground/.test(roleOf(p.ref, p.num)) || /^(GND|VSS|AGND|DGND|PGND|EP|PAD)/i.test(p.name);
    const BUS = /SDA|SCL|I2C|TX|RX|MOSI|MISO|SCK|SCLK|SPI|CS\b|NSS|INT|IRQ|UART|CAN|USB|D[PM]\b/i;
    const onNets = re => fp.filter(p => re.test(netOf.get(p.key) || ''));
    const neighbors = (refs, kinds) => {
      const out = [];
      for (const p of pins) if (kinds.includes(p.kind) && !filed.has(p.ref)) {
        const n = netOf.get(p.key);
        if (n && !/^(GND|AGND|DGND|PGND|VSS)$/i.test(n) && (nets.get(n) || []).some(k => refs.has(k.split('.')[0]))) out.push(p);
      }
      return out;
    };
    const regs = new Set([...filed].filter(r => { const f = fileOf(r); return f && /regulator|ldo|buck|boost|switch/.test(f.kind || ''); }));
    const xtals = new Set(d.parts.filter(p => p.kind === 'crystal').map(p => p.ref));
    const ics = () => d.parts.filter(p => p.kind === 'ic' || p.kind === 'crystal').map(p => ({ ref: p.ref, part: true }));
    const T = {
      supply: () => fp.filter(isPower), ground: () => fp.filter(isGround),
      signal: () => fp.filter(p => netOf.has(p.key) && !isPower(p) && !isGround(p)),
      open: () => fp.filter(p => !netOf.has(p.key)),
      straps: () => fp.filter(p => /reset|boot|enable|strap/.test(roleOf(p.ref, p.num)) || /RST|RESET|BOOT|^EN$|_EN$/i.test(p.name)),
      rails: () => run.rails.flatMap(r => (nets.get(r.net) || []).map(k => pins.find(p => p.key === k)).filter(Boolean)),
      decoupling: () => neighbors(filed, ['capacitor']),
      regulator: () => fp.filter(p => regs.has(p.ref)).concat(neighbors(regs, ['capacitor', 'inductor', 'resistor'])),
      crystal: () => pins.filter(p => xtals.has(p.ref)).concat(neighbors(xtals, ['capacitor']))
    };
    const TARGETS = {
      'supply.range': T.supply, 'supply.absmax': T.supply, 'supply.unpowered': T.supply, 'supply.ground': T.ground,
      'supply.switchnode': T.regulator, 'supply.tied': T.supply, 'supply.rails': T.rails,
      'io.absmax': T.signal, 'io.recommended': T.signal, 'io.vih': T.signal, 'io.contention': T.signal,
      'pins.dnc': T.open, 'pins.unused': T.open, 'pins.float': T.straps,
      'func.af': () => onNets(BUS), 'func.i2c': () => onNets(/SDA|SCL|I2C/i), 'func.exti': () => onNets(/INT|IRQ|EXTI/i), 'func.uart': () => onNets(/TX|RX|UART/i),
      'parts.decoupling': T.decoupling, 'parts.ext': T.decoupling, 'parts.regulator': T.regulator, 'parts.crystal': T.crystal,
      'straps.i2c': () => onNets(/SDA|SCL|I2C/i), 'library.coverage': ics, 'library.pins': () => fp
    };
    // Each target at each place it's drawn (a pin on two sheets is read on both).
    const place = t => t.part ? (G.partAt.has(t.ref) ? [G.partAt.get(t.ref)] : []) : (G.pinAt.get(t.key) || []);
    const locate = f => {
      for (const k of f.pins || []) if (G.pinAt.has(k)) return G.pinAt.get(k)[0];
      for (const r of f.refs || []) if (G.partAt.has(r)) return G.partAt.get(r);
      for (const n of f.nets || []) for (const k of nets.get(n) || []) if (G.pinAt.has(k)) return G.pinAt.get(k)[0];
      return null;
    };
    const steps = PK.checks.CATALOG.map((c, i) => {
      const cov = run.coverage[c.key] || { checked: 0, skipped: 0, findings: 0 };
      const lanes = new Map();
      if (cov.checked) for (const t of (TARGETS[c.key] || (() => []))()) for (const l of place(t)) {
        if (!lanes.has(l.sheet)) lanes.set(l.sheet, new Map());
        const byRef = lanes.get(l.sheet);
        if (!byRef.has(t.ref)) byRef.set(t.ref, []);
        byRef.get(t.ref).push({ key: t.key, ref: t.ref, part: !!t.part, x: l.x, y: l.y });
      }
      // A lane per sheet; its parts in beats, several parts to a beat on a busy sheet.
      const L = [...lanes].map(([sheet, byRef]) => {
        const parts = [...byRef];
        const per = Math.ceil(parts.length / MAX_BEATS);
        const beats = [];
        for (let k = 0; k < parts.length; k += per) {
          const grp = parts.slice(k, k + per);
          beats.push({ ref: grp[0][0], more: grp.length - 1, sheet, targets: grp.flatMap(g => g[1]) });
        }
        return { sheet, beats };
      }).sort((a, b) => a.sheet - b.sheet);
      const longest = Math.max(0, ...L.map(l => l.beats.length));
      const fs = run.findings.filter(f => f.check === c.key && !f.waived).map(f => ({ f, at: locate(f) }));
      return { i, key: c.key, group: c.group, title: c.title, needs: c.needs, cov, lanes: L, beats: L.flatMap(l => l.beats), findings: fs.map(x => x.f), at: new Map(fs.map(x => [x.f, x.at])), w: longest ? 300 + longest * 280 : 90 };
    });
    // Every replay takes about TOTAL ms, each check its share by how much it reads.
    const sum = steps.reduce((a, s) => a + s.w, 0) || 1;
    let t = 0;
    for (const s of steps) { s.dur = s.w / sum * TOTAL; s.t0 = t; t += s.dur; s.t1 = t; }
    return { steps, total: t, filed };
  }

  // The state at time t: the check under way, where each of its lanes has got to, and what came before.
  function stateAt(P, t) {
    t = Math.max(0, Math.min(P.total, t));
    const done = t >= P.total;
    let si = P.steps.findIndex(s => t < s.t1);
    if (si < 0) si = P.steps.length - 1;
    const s = P.steps[si];
    const local = (t - s.t0) / s.dur;
    const lanes = done ? [] : s.lanes.map(l => { const bi = Math.min(l.beats.length - 1, Math.floor(local * l.beats.length)); return { sheet: l.sheet, n: l.beats.length, bi, beat: l.beats[bi] }; });
    const main = lanes.reduce((m, l) => !m || l.n > m.n ? l : m, null);
    const checked = new Set(), findings = [];
    const take = bs => { for (const b of bs) for (const tg of b.targets) checked.add(tg.key || tg.ref); };
    for (const x of P.steps) {
      if (done || x.i < si) { take(x.beats); findings.push(...x.findings); }
      else if (x.i === si) x.lanes.forEach((l, k) => take(l.beats.slice(0, lanes[k].bi)));
    }
    return { t, done, si, step: s, lanes, lane: main, bi: main ? main.bi : -1, beat: main ? main.beat : null, checked, findings, frac: t / P.total, pick: null, loop: 0 };
  }
  // A picked check, replayed: the run as it stood when that check began, its reading again, and its own
  // findings from the start. `u` is how far through the check (0 to 1).
  function pickAt(P, i, u, loop) {
    const s = P.steps[i];
    const S = stateAt(P, s.t0 + Math.min(0.999, Math.max(0, u)) * s.dur);
    S.pick = i; S.loop = loop || 0;
    for (const f of s.findings) if (!S.findings.includes(f)) S.findings.push(f);
    return S;
  }

  // ── Drawing ──
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const PATTERNS = '<defs><pattern id="sp-hatch-e" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="4" height="4" class="sp-hf-e"/><line x1="0" y1="0" x2="0" y2="4" class="sp-hl-e"/></pattern>' +
    '<pattern id="sp-dots-w" width="3.2" height="3.2" patternUnits="userSpaceOnUse"><rect width="3.2" height="3.2" class="sp-hf-w"/><circle cx="1.6" cy="1.6" r="0.75" class="sp-hl-w"/></pattern></defs>';
  // A sheet as a thumbnail: its frame, part bodies, pins, wires, and buses (no text at this size).
  function sheetSvg(s) {
    const dr = s.dr, b = s.b, f = n => Math.round(n * 10) / 10;
    const line = pts => { let p = ''; for (let i = 0; i + 1 < pts.length; i += 2) p += (i ? 'L' : 'M') + f(pts[i]) + ' ' + f(pts[i + 1]); return p; };
    let body = '', frame = '', pins = '', wires = '', buses = '';
    for (const sh of dr.shapes) {
      let p = '';
      if (sh.t === 'line' || sh.t === 'bez') p = line(sh.pts);
      else if (sh.t === 'poly') p = line(sh.pts) + 'Z';
      else if (sh.t === 'rect') p = 'M' + f(sh.x0) + ' ' + f(sh.y0) + 'H' + f(sh.x1) + 'V' + f(sh.y1) + 'H' + f(sh.x0) + 'Z';
      else if (sh.t === 'ellipse' || sh.t === 'arc') p = 'M' + f(sh.cx - sh.rx) + ' ' + f(sh.cy) + 'a' + f(sh.rx) + ' ' + f(sh.ry) + ' 0 1 0 ' + f(sh.rx * 2) + ' 0a' + f(sh.rx) + ' ' + f(sh.ry) + ' 0 1 0 ' + f(-sh.rx * 2) + ' 0';
      if (sh.layer === 'body') body += p; else frame += p;
    }
    for (const p of dr.pins) if (!p.hidden) pins += 'M' + f(p.bx) + ' ' + f(p.by) + 'L' + f(p.x) + ' ' + f(p.y);
    for (const w of dr.wires) wires += line(w);
    for (const w of dr.buses) buses += line(w);
    const flip = 'matrix(1 0 0 -1 0 ' + f(b[1] + b[3]) + ')';
    return '<svg class="sp-svg" viewBox="' + f(b[0]) + ' ' + f(b[1]) + ' ' + f(s.bw) + ' ' + f(s.bh) + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc('Sheet ' + (s.i + 1) + ', ' + s.name) + '">' + PATTERNS +
      '<rect class="sp-paper" x="' + f(b[0]) + '" y="' + f(b[1]) + '" width="' + f(s.bw) + '" height="' + f(s.bh) + '"/>' +
      '<g transform="' + flip + '"><path class="sp-frame" d="' + frame + '"/><path class="sp-body" d="' + body + '"/><path class="sp-pin" d="' + pins + '"/><path class="sp-wire" d="' + wires + '"/><path class="sp-bus" d="' + buses + '"/>' +
      '<path class="sp-read" d=""/></g><g class="sp-marks"></g><g class="sp-fx"></g></svg>';
  }
  // A finding's mark, upright: ✕ in a striped square, ▲ dotted, i in a ring. A click opens it on the sheet.
  function mark(parent, f, x, y, s) {
    const g = el('g', { class: 'sp-mark sev-' + f.severity, transform: 'translate(' + x + ' ' + y + ') scale(' + s + ')', 'data-show': f.id, tabindex: '-1' }, parent);
    if (f.severity === 'error') { el('rect', { x: -9, y: -9, width: 18, height: 18, rx: 3, class: 'mk-shape', fill: 'url(#sp-hatch-e)' }, g); el('path', { d: 'M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5', class: 'mk-glyph' }, g); }
    else if (f.severity === 'warn') { el('path', { d: 'M0 -11L10.5 8H-10.5Z', class: 'mk-shape', fill: 'url(#sp-dots-w)' }, g); el('path', { d: 'M0 -3.5V2.5M0 5V5.4', class: 'mk-glyph' }, g); }
    else { el('circle', { r: 8, class: 'mk-shape' }, g); el('path', { d: 'M0 -1V4M0 -4V-3.6', class: 'mk-glyph' }, g); }
    el('title', {}, g).textContent = SEVCH[f.severity] + ' ' + f.title;
    return g;
  }
  function pop(parent, x, y, r, delay, frozen) {
    if (RM()) return;
    const g = el('g', { class: 'sp-pop', transform: 'translate(' + x + ' ' + y + ')' }, parent);
    el('circle', { r: r * 2.4, class: 'pp-ring', 'stroke-width': r * 0.35 }, g); el('circle', { r, class: 'pp-core' }, g);
    for (const n of [g, ...g.children]) n.style.animationDelay = (frozen != null ? -frozen : delay) + 'ms';
    if (frozen != null) g.classList.add('frozen'); else g.addEventListener('animationend', e => { if (e.target === g) g.remove(); });
  }
  const setOnce = (node, key, html) => { if (node._k === key) return; node._k = key; node.innerHTML = typeof html === 'function' ? html() : html; };
  const stepKey = S => S.done ? 'done' : (S.pick != null ? 'p' : '') + S.si + ':' + S.lanes.map(l => l.bi).join(',');

  function progHtml(P) {
    let h = '<div class="sp-prog"><div class="sp-bar"><i class="sp-fill"></i><span class="sp-run"><s></s></span><div class="sp-steps">', g = '';
    for (const s of P.steps) {
      const l = (s.t0 / P.total * 100).toFixed(2), w = (s.dur / P.total * 100).toFixed(2);
      const sev = s.findings.some(f => f.severity === 'error') ? 'e' : s.findings.some(f => f.severity === 'warn') ? 'w' : '';
      h += '<span class="' + (s.group !== g ? 'm0' : '') + '" style="left:' + l + '%"></span>';
      if (sev) h += '<b class="' + sev + '" data-i="' + s.i + '" style="left:' + l + '%;width:' + w + '%"></b>';
      g = s.group;
    }
    h += '</div><div class="sp-picks">';
    // Once the run is done, one even slot per check, slid along to replay it (Fabcheck's bar). A group's first
    // check has a taller tick; an error's is tallest and striped, a warning's tall and dotted.
    g = '';
    for (const s of P.steps) {
      const sev = s.findings.some(f => f.severity === 'error') ? ' e' : s.findings.some(f => f.severity === 'warn') ? ' w' : '';
      h += '<span class="' + (s.group !== g ? 'm0' : '') + sev + '" data-i="' + s.i + '" title="' + esc((s.i + 1) + '. ' + s.title) + '"></span>';
      g = s.group;
    }
    return h + '</div></div><div class="sp-meta"><span class="sp-meta-l"></span><span class="sp-meta-r"></span></div></div>';
  }

  // The words beside the gallery: the check under way, or the finished run.
  function sideText(P, S, run, sheets) {
    if (S.done) {
      const c = counts(run.findings.filter(f => !f.waived));
      return '<div class="sp-eyebrow">Checks finished</div><div class="sp-title">' + plural(c.error, 'error') + ' · ' + plural(c.warn, 'warning') + '</div>' +
        '<div class="sp-desc">Each mark is a finding where it sits: ✕ an error, ▲ a warning, i a note. Pick one to see it on the sheet, or slide along the bar to replay a check.</div>';
    }
    const s = S.step;
    // What each sheet is reading right now, by name: "Reading U7 on Power, U4 on MCU, and D3 on IO".
    const part = b => '<b>' + esc(b.ref) + '</b>' + (b.more ? ' (+' + b.more + ')' : '');
    const on = S.lanes.filter(l => l.beat).map(l => part(l.beat) + (sheets.length > 1 ? ' on ' + esc(sheets[l.sheet].name) : ''));
    const list = on.length > 3 ? on.slice(0, 2).concat(['parts on ' + (on.length - 2) + ' more sheets']) : on;
    const joined = list.length < 3 ? list.join(' and ') : list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
    const what = s.cov.checked ? (on.length ? 'Reading ' + joined : 'Nothing on the sheets to show') : 'Nothing on this design for it';
    let h = '<div class="sp-eyebrow">' + esc(s.group) + ' · check ' + (s.i + 1) + ' of ' + P.steps.length + (S.pick != null ? ' · replay' : '') + '</div><div class="sp-title">' + esc(s.title) + '</div>' +
      '<div class="sp-desc">Needs ' + esc(s.needs) + '. <span class="sp-now">' + what + '</span></div>';
    if (S.pick != null && s.cov.checked) {
      const fs = s.findings;
      h += '<div class="sp-found">' + (fs.length ? '<div class="sp-found-h">Found</div><ul>' + fs.slice(0, 5).map(f => '<li class="sev-' + f.severity + '"><b aria-hidden="true">' + SEVCH[f.severity] + '</b><button class="sp-flink" data-show="' + esc(f.id) + '">' + esc(f.title) + '</button></li>').join('') + (fs.length > 5 ? '<li class="more">and ' + (fs.length - 5) + ' more</li>' : '') + '</ul>'
        : '<div class="sp-found-h"><span class="sp-ok" aria-hidden="true">✓</span> Nothing found</div>') + '</div>';
    }
    return h;
  }

  // ── The panel ──
  class Panel {
    constructor(d, run, lib) {
      this.d = d; this.run = run;
      this.G = geometry(d);
      this.P = plan(d, run, lib, this.G);
      const sheets = this.G.sheets;
      const e = this.el = document.createElement('section');
      e.className = 'card sp-panel';
      e.innerHTML = progHtml(this.P) + '<div class="sp-galwrap"><div class="sp-grid' + (sheets.length === 1 ? ' n1' : '') + '">' + sheets.map(s =>
        '<figure class="sp-card" data-s="' + s.i + '"><div class="sp-card-art">' + sheetSvg(s) + '</div><figcaption><span class="sp-card-n">' + (s.i + 1) + '</span> <span class="sp-card-name">' + esc(s.name) + '</span><span class="sp-card-c"></span></figcaption></figure>').join('') +
        '</div><div class="sp-cap"></div></div><p class="sp-sr" aria-live="polite"></p>';
      this.cards = [...e.querySelectorAll('.sp-card')];
      this.svgs = this.cards.map(c => c.querySelector('svg'));
      this.last = {}; this.marked = null; this.readSig = [];
      this.mode = { kind: 'done' }; this.raf = 0;
      this.events();
      // Equal columns that fill the width, a short last row centered; the width comes from the panel alone,
      // so the cards hold still through the run.
      const grid = e.querySelector('.sp-grid');
      this.ro = new ResizeObserver(() => {
        const W = grid.clientWidth, GAP = 12;
        if (!W) return;
        const cols = Math.max(1, Math.min(sheets.length, Math.floor((W + GAP) / (CARD_MIN + GAP))));
        grid.style.setProperty('--card-w', Math.floor((W - GAP * (cols - 1)) / cols) + 'px');
        this.scaleUnits(); this.paint(this.S || stateAt(this.P, this.P.total), true);
      });
      this.ro.observe(grid);
    }
    // Sheet units per screen pixel on each thumbnail, so dots and marks keep their size on screen.
    scaleUnits() {
      this.u = this.svgs.map((svg, i) => { const s = this.G.sheets[i], r = svg.getBoundingClientRect(); return r.width ? Math.max(s.bw / r.width, s.bh / (r.height || r.width)) : s.bw / 300; });
    }
    play(onDone) { this.onDone = onDone; this.go({ kind: 'live', start: performance.now() }); }
    finish() { const was = this.mode.kind === 'live'; this.go({ kind: 'done' }); if (was && this.onDone) this.onDone(); }
    get running() { return this.mode.kind === 'live'; }
    go(m) { this.mode = m; if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)); }
    frame(now) {
      this.raf = 0;
      const m = this.mode;
      if (m.kind === 'live') {
        const S = stateAt(this.P, RM() ? this.P.total : now - m.start);
        this.paint(S);
        if (S.done) { this.mode = { kind: 'done' }; if (this.onDone) this.onDone(); return; }
      } else if (m.kind === 'pick') {
        const s = this.P.steps[m.i], D = s.dur * REPLAY_SLOW, el2 = now - m.start, loop = D + HOLD;
        this.paint(pickAt(this.P, m.i, RM() ? 1 : (el2 % loop) / D, RM() ? 0 : Math.floor(el2 / loop)));
      } else { this.paint(stateAt(this.P, this.P.total)); return; }
      if (this.el.isConnected) this.raf = requestAnimationFrame(t => this.frame(t));
      else if (m.kind === 'live') { this.mode = { kind: 'done' }; if (this.onDone) this.onDone(); }
    }
    pick(i) {
      i = Math.max(0, Math.min(this.P.steps.length - 1, i));
      if (this.mode.kind === 'pick' && this.mode.i === i) return;
      this.go({ kind: 'pick', i, start: performance.now() });
    }

    paint(S, again) {
      this.S = S;
      if (!this.u) this.scaleUnits();
      const P = this.P, e = this.el;
      this.progress(S);
      setOnce(e.querySelector('.sp-cap'), stepKey(S), () => sideText(P, S, this.run, this.G.sheets));
      const busy = new Set(S.lanes.map(l => l.sheet));
      this.cards.forEach((c, i) => {
        c.classList.toggle('busy', busy.has(i));
        const fs = S.findings.filter(f => { const a = this.at(f); return a && a.sheet === i; });
        setOnce(c.querySelector('.sp-card-c'), fs.length + ':' + S.pick, () => fs.length ? cnt(counts(fs)) : '');
      });
      // What has been read: one path of small dots per sheet, rebuilt when the set grows or shrinks.
      const sig = S.checked.size + ':' + (S.pick != null ? S.pick : '') + (again ? ':' + Date.now() : '');
      if (sig !== this.readSig) {
        this.readSig = sig;
        const paths = this.svgs.map(() => '');
        for (const k of S.checked) {
          const locs = k.includes('.') ? this.G.pinAt.get(k) : (this.G.partAt.has(k) ? [this.G.partAt.get(k)] : null);
          if (!locs) continue;
          for (const l of locs) { const r = 1.6 * this.u[l.sheet]; paths[l.sheet] += 'M' + (l.x - r).toFixed(1) + ' ' + l.y.toFixed(1) + 'a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (2 * r).toFixed(1) + ' 0a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (-2 * r).toFixed(1) + ' 0'; }
        }
        this.svgs.forEach((svg, i) => svg.querySelector('.sp-read').setAttribute('d', paths[i]));
      }
      // Findings as marks, rebuilt when the list changes.
      const fsig = S.findings.length + ':' + (S.pick != null ? S.pick : '') + (again ? ':' + Date.now() : '');
      if (fsig !== this.marked) {
        const grew = this.marked != null && S.findings.length > +String(this.marked).split(':')[0];
        this.marked = fsig;
        this.svgs.forEach(svg => { svg.querySelector('.sp-marks').textContent = ''; });
        for (const f of S.findings) {
          const a = this.at(f); if (!a) continue;
          const s = this.G.sheets[a.sheet], u = this.u[a.sheet], Y = s.b[1] + s.b[3] - a.y, off = 13 * u;
          const m = mark(this.svgs[a.sheet].querySelector('.sp-marks'), f, a.x + (a.part ? 0 : (a.dx || 0) * off), Y - (a.part ? 0 : (a.dy || 0) * off), u * 0.75);
          if (grew && f === S.findings[S.findings.length - 1] && !RM()) m.classList.add('land');
        }
      }
      // Scan dots: each lane's current beat on its sheet, once per beat.
      for (const l of S.lanes) {
        const key = S.si + ':' + l.bi + ':' + S.loop;
        if (!l.beat || this.last[l.sheet] === key) continue;
        this.last[l.sheet] = key;
        const s = this.G.sheets[l.sheet], fx = this.svgs[l.sheet].querySelector('.sp-fx'), u = this.u[l.sheet];
        l.beat.targets.slice(0, 40).forEach((t, k) => pop(fx, t.x, s.b[1] + s.b[3] - t.y, (t.part ? 7 : 4) * u, k * 22, null));
      }
    }
    at(f) { if (!this.atMap) { this.atMap = new Map(); for (const s of this.P.steps) for (const [x, a] of s.at) this.atMap.set(x, a); } return this.atMap.get(f) || null; }
    progress(S) {
      const P = this.P, e = this.el;
      const st = e.querySelector('.sp-sr'), sk = S.done ? 'done' : (S.pick != null ? 'p' : '') + S.si;
      if (st._k !== sk) { st._k = sk; const c = counts(S.findings); st.textContent = S.done ? 'Checks finished: ' + plural(c.error, 'error') + ', ' + plural(c.warn, 'warning') + '.' : (S.pick != null ? 'Replaying check ' : 'Check ') + (S.si + 1) + ' of ' + P.steps.length + ': ' + S.step.title; }
      const prog = e.querySelector('.sp-prog'), stepped = S.done || S.pick != null, bar = e.querySelector('.sp-bar');
      prog.classList.toggle('steps', stepped); prog.classList.toggle('done', S.done);
      if (stepped) {
        bar.tabIndex = 0; bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', 'Replay one check');
        bar.setAttribute('aria-valuemin', 1); bar.setAttribute('aria-valuemax', P.steps.length);
        bar.setAttribute('aria-valuenow', S.pick != null ? S.pick + 1 : P.steps.length);
        bar.setAttribute('aria-valuetext', S.pick != null ? 'Check ' + (S.pick + 1) + ': ' + P.steps[S.pick].title : 'All checks');
      } else { bar.removeAttribute('tabindex'); bar.removeAttribute('role'); bar.title = 'Skip to the end'; }
      for (const sp of e.querySelectorAll('.sp-picks span')) sp.classList.toggle('cur', S.pick != null && +sp.dataset.i === S.pick);
      e.querySelector('.sp-fill').style.transform = 'scaleX(' + S.frac + ')';
      e.querySelector('.sp-run').style.width = (S.frac * 100) + '%';
      for (const b of e.querySelectorAll('.sp-steps b')) b.hidden = +b.dataset.i >= S.si && !S.done;
      const c = counts(S.findings);
      setOnce(e.querySelector('.sp-meta-l'), (S.pick != null ? 'pick' : S.done ? 'done' : 'run') + c.error + c.warn + c.info, () =>
        S.pick != null ? 'Replaying one check · <button class="sp-back" data-sp="all">Back to all results</button>' :
        S.done ? '<span class="sp-ok" aria-hidden="true">✓</span> Checked: ' + cnt(c) : cnt(c) + ' <span class="sp-muted">so far</span>');
      e.querySelector('.sp-meta-r').textContent = S.pick != null ? 'Check ' + (S.pick + 1) + ' of ' + P.steps.length : S.done ? plural(P.steps.length, 'check') + ' · ' + plural(this.G.sheets.length, 'sheet') : Math.round(S.frac * 100) + '%';
    }

    // While playing, a press on the bar skips to the end. Once done, press and slide (a vertical swipe still
    // scrolls), or the arrow keys, Home, and End, to replay one check; Escape or Back to all results returns.
    events() {
      const e = this.el, n = () => this.P.steps.length;
      const stepAtX = (bar, x) => { const r = bar.getBoundingClientRect(); return Math.floor((x - r.left) / r.width * n()); };
      e.addEventListener('pointerdown', ev => {
        const bar = ev.target.closest('.sp-bar');
        if (!bar) return;
        if (this.mode.kind === 'live') { this.finish(); return; }
        bar.setPointerCapture(ev.pointerId);
        this.pick(stepAtX(bar, ev.clientX));
        const move = v => this.pick(stepAtX(bar, v.clientX));
        const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
        bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
      });
      e.addEventListener('keydown', ev => {
        if (!ev.target.closest('.sp-prog.steps .sp-bar')) return;
        const m = this.mode, cur = m.kind === 'pick' ? m.i : n();
        if (ev.key === 'Escape') { ev.preventDefault(); this.go({ kind: 'done' }); return; }
        const to = { ArrowLeft: cur - 1, ArrowDown: cur - 1, ArrowRight: m.kind === 'pick' ? cur + 1 : 0, ArrowUp: m.kind === 'pick' ? cur + 1 : 0, Home: 0, End: n() - 1 }[ev.key];
        if (to == null) return;
        ev.preventDefault(); this.pick(to);
      });
      e.addEventListener('click', ev => { if (ev.target.closest('[data-sp="all"]')) this.go({ kind: 'done' }); });
    }
  }

  // ── For app.js ──
  function attach(host, d, run, opts) {
    opts = opts || {};
    if (!d.drawings || !d.drawings.length || !run) { host.remove(); return null; }
    let p = d._scan;
    if (!p || p.run !== run) {
      if (p) { cancelAnimationFrame(p.raf); p.ro.disconnect(); }
      p = d._scan = new Panel(d, run, opts.lib || []);
    }
    host.replaceWith(p.el);
    if (opts.play) p.play(opts.onDone);
    else if (!p.running && !p.raf) p.go(p.mode.kind === 'pick' ? p.mode : { kind: 'done' });
    return p;
  }
  const running = d => !!(d && d._scan && d._scan.running);

  // The start page's panel, empty: a drop target, as Fabcheck's start page is.
  function emptyHtml(note) {
    return '<section class="card sp-panel sp-empty" data-act="open">' +
      '<div class="sp-prog"><div class="sp-bar"></div><div class="sp-meta"><span class="sp-muted">Ready</span><span></span></div></div>' +
      '<div class="sp-galwrap"><div class="sp-grid sp-ghosts">' + [1, 2, 3].map(() => '<figure class="sp-card"><div class="sp-card-art"><div class="sp-ghost"></div></div><figcaption><span class="sp-card-name sp-muted">Sheet</span></figcaption></figure>').join('') + '</div>' +
      '<div class="sp-cap"><div class="sp-eyebrow">Drop to check</div><div class="sp-title">Drop an Altium project, its sheets, or a netlist</div><div class="sp-desc">' + note + '</div>' +
      '<div class="sp-actions"><button class="btn btn-primary" data-act="open">Choose files…</button><button class="btn" data-act="open-dir">Choose folder…</button></div></div></div></section>';
  }

  PK.scan = { attach, running, emptyHtml, geometry, plan, stateAt, pickAt, TOTAL };
})(window.PK = window.PK || {});
