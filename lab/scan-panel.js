// Pincheck lab: the scan panel. One engine (the run, its steps and beats, a clock that can be frozen
// with ?at=) and three renderers that only draw:
//   A · gallery  sheet cards, dots popping and fading over each sheet as it's checked (Chris's idea)
//   B · stack    Fabcheck's stage: the sheets as an exploded stack, a detail drawing beside it
//   C · closeup  the part being checked, drawn from its pin count, and the power tree as rails resolve
// The checks run for real (PK.checks.run on the demo) and are replayed at a readable pace: they take a
// few milliseconds. Sheets are made up (layoutSheets) in the shape the viewer will give: Altium 10 mil
// units, Y up, pins keyed REF.PIN.
// URL: ?dir=gallery|stack|closeup  &theme=light|dark  &at=0..1 (freeze at that point of the replay)
(function () {
  'use strict';
  const PK = window.PK;
  const NS = 'http://www.w3.org/2000/svg';
  const Q = new URLSearchParams(location.search);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RM = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b || a + 's');
  const SEVCH = { error: '✕', warn: '▲', info: 'i' };

  // ── Made-up sheets: the geometry adapter ──
  // { name, w, h, parts: [{ ref, x, y, w, h, kind, label, filed }], pins: Map(key → { key, ref, x, y, side, name }),
  //   wires: [[x1, y1, x2, y2]], ports: [{ x, y, side, net, gnd }], labels: [{ x, y, text, side }] }
  // Real SchDoc sheets would fill the same shape (viewer session); a netlist alone would use this layout.
  const SHEETS = [
    { name: 'Power', refs: ['J1', 'F1', 'RV1', 'PS1', 'U7', 'L1', 'C1', 'C2', 'C3', 'C13', 'R5', 'R6', 'J3', 'R14', 'R15'] },
    { name: 'MCU and display', refs: ['U4', 'J2', 'C4', 'C5', 'C6', 'C41', 'R12', 'R13', 'D3', 'D4', 'R16', 'R17'] },
    { name: 'Relays and radio', refs: ['U1', 'K1', 'K2', 'J4', 'Q1', 'Q2', 'D1', 'D2', 'R1', 'R2', 'C8', 'C9'] }
  ];
  const POWER = /^(GND|5V|3V3|VBUS|AC_N|AC_LF)$/;

  function layoutSheets(design, run) {
    const byRef = new Map(design.parts.map(p => [p.ref, p]));
    const netOf = new Map();
    for (const n of design.nets || []) for (const d of n.nodes) netOf.set(d.ref + '.' + d.pin, n.name);
    const placed = new Set();
    const groups = SHEETS.map(s => ({ name: s.name, refs: s.refs.filter(r => byRef.has(r)) }));
    groups.forEach(g => g.refs.forEach(r => placed.add(r)));
    const rest = design.parts.map(p => p.ref).filter(r => !placed.has(r));
    if (rest.length) groups[groups.length - 1].refs.push(...rest);
    // Lab only: ?sheets=N splits the made-up sheets, to see a design with more pages.
    const want = Math.max(1, Math.min(24, +Q.get('sheets') || groups.length));
    if (want !== groups.length) {
      const k = Math.ceil(want / groups.length), out = [];
      for (const g of groups) for (let j = 0; j < k; j++) {
        const refs = g.refs.filter((r, n) => n % k === j);
        if (refs.length) out.push({ name: k > 1 ? g.name + ' ' + (j + 1) : g.name, refs });
      }
      const extra = out.splice(want);
      if (extra.length) out[out.length - 1].refs.push(...extra.flatMap(g => g.refs));
      groups.splice(0, groups.length, ...out);
    }
    return groups.map((g, si) => {
      const W = 1150, H = 760, sh = { i: si, name: g.name, w: W, h: H, parts: [], pins: new Map(), wires: [], ports: [], labels: [] };
      const big = g.refs.map(r => byRef.get(r)).filter(p => p.pins.length > 3 || /^(U|J|PS|K)/.test(p.ref));
      const small = g.refs.map(r => byRef.get(r)).filter(p => !big.includes(p));
      big.sort((a, b) => b.pins.length - a.pins.length);
      // Big parts across the middle: pins down both sides (a connector down one).
      let x = 90;
      for (const p of big) {
        const oneSide = /^J/.test(p.ref);
        const n = p.pins.length, rows = oneSide ? n : Math.ceil(n / 2);
        const w = oneSide ? 70 : n > 12 ? 190 : 120, h = Math.max(60, rows * 20 + 20);
        const y = Math.round(H / 2 + h / 2);
        const part = addPart(sh, p, x, y, w, h, run);
        p.pins.forEach((pin, k) => {
          const left = oneSide || k < rows, row = left ? k : k - rows;
          const py = y - 20 - row * 20;
          addPin(sh, part, pin, left ? x - 30 : x + w + 30, py, left ? 'l' : 'r');
        });
        x += w + 150;
      }
      // Passives in columns after them, then along the top and bottom.
      const cells = [];
      for (let cx = x - 40; cx < W - 60; cx += 80) for (let cy = H - 110; cy > 150; cy -= 150) cells.push([cx, cy]);
      for (let cx = 70; cx < x - 120; cx += 80) { cells.push([cx, H - 50]); cells.push([cx, 120]); }
      small.forEach((p, k) => {
        const c = cells[k % cells.length];
        const part = addPart(sh, p, c[0], c[1], 30, 60, run);
        p.pins.slice(0, 3).forEach((pin, j) => addPin(sh, part, pin, c[0] + 15 + (j === 2 ? 20 : 0), j === 0 ? c[1] + 20 : c[1] - 80, j === 0 ? 't' : 'b'));
      });
      // Wires for the small nets (an L between neighbors), power ports and net labels for the rest.
      const onSheet = new Map();
      for (const [key, pin] of sh.pins) { const net = netOf.get(key); pin.net = net; if (net) (onSheet.get(net) || onSheet.set(net, []).get(net)).push(pin); }
      for (const [net, pins] of onSheet) {
        if (POWER.test(net)) { for (const p of pins) sh.ports.push({ x: p.x, y: p.y, side: p.side, net, gnd: net === 'GND' }); continue; }
        const total = (design.nets.find(n => n.name === net) || { nodes: [] }).nodes.length;
        if (pins.length < total || pins.length === 1) for (const p of pins) sh.labels.push({ x: p.x, y: p.y, side: p.side, text: net });
        pins.sort((a, b) => a.x - b.x || a.y - b.y);
        for (let k = 1; k < pins.length; k++) {
          const a = pins[k - 1], b = pins[k];
          const mx = Math.round((a.x + b.x) / 20) * 10;
          sh.wires.push([a.x, a.y, mx, a.y], [mx, a.y, mx, b.y], [mx, b.y, b.x, b.y]);
        }
      }
      return sh;
    });
  }
  function addPart(sh, p, x, y, w, h, run) {
    const part = { ref: p.ref, x, y, w, h, kind: p.kind, label: p.mpn || p.libRef || '', filed: !!fileIdOf(run, p.ref), ic: p.kind === 'ic' || p.kind === 'crystal', pins: [] };
    sh.parts.push(part);
    return part;
  }
  // run.parts: { ref: file id or null } (docs/checks.md); objects tolerated.
  function fileIdOf(run, ref) { const v = run.parts[ref]; return !v ? null : typeof v === 'string' ? v : v.file || v.id || null; }
  function addPin(sh, part, pin, x, y, side) {
    const key = part.ref + '.' + pin.num;
    const rec = { key, ref: part.ref, num: pin.num, name: pin.name, type: pin.type, x, y, side, sheet: sh.i };
    sh.pins.set(key, rec); part.pins.push(rec);
  }

  // ── The replay: steps (one per check, the catalog's order) and beats (one per part a step reads) ──
  function plan(design, run, sheets, lib) {
    const pinAt = new Map(), partAt = new Map();
    for (const sh of sheets) { for (const [k, p] of sh.pins) pinAt.set(k, p); for (const p of sh.parts) partAt.set(p.ref, { sh, p }); }
    const filed = new Set(Object.keys(run.parts).filter(r => fileIdOf(run, r)));
    const fileOf = ref => lib.find(f => f.id === fileIdOf(run, ref));
    const netOf = new Map(), nets = new Map();
    for (const n of design.nets || []) { nets.set(n.name, n.nodes.map(d => d.ref + '.' + d.pin)); for (const d of n.nodes) netOf.set(d.ref + '.' + d.pin, n.name); }
    const roleOf = key => { const [ref, num] = key.split('.'); const f = fileOf(ref); const p = f && f.pins.find(x => x.num === num); return p ? p.role || '' : ''; };
    const fPins = [...pinAt.values()].filter(p => filed.has(p.ref));
    const sel = {
      power: () => fPins.filter(p => /power/.test(roleOf(p.key)) || p.type === 'power'),
      ground: () => fPins.filter(p => /ground/.test(roleOf(p.key)) || /^(GND|VSS)/.test(p.name)),
      signal: () => fPins.filter(p => netOf.has(p.key) && !/power|ground/.test(roleOf(p.key)) && p.type !== 'power'),
      all: () => fPins,
      open: () => fPins.filter(p => !netOf.has(p.key)),
      named: re => fPins.filter(p => re.test(netOf.get(p.key) || '')),
      railNets: () => [...new Set(run.rails.map(r => r.net))].flatMap(n => (nets.get(n) || []).map(k => pinAt.get(k)).filter(Boolean)),
      caps: () => [...pinAt.values()].filter(p => /^C\d/.test(p.ref) && /^(3V3|5V|VBUS)$/.test(netOf.get(p.key) || '')),
      reg: () => fPins.filter(p => /regulator|switch|feedback|bootstrap/.test(fileOf(p.ref).kind + ' ' + roleOf(p.key))).concat([...pinAt.values()].filter(p => /^(SW|FB|BST)$/.test(netOf.get(p.key) || '') && !filed.has(p.ref))),
      ics: () => [...partAt.values()].filter(x => x.p.ic).map(x => ({ ref: x.p.ref, part: true, x: x.p.x + x.p.w / 2, y: x.p.y - x.p.h / 2, sheet: x.sh.i }))
    };
    const TARGETS = {
      'supply.range': sel.power, 'supply.absmax': sel.power, 'supply.unpowered': sel.power, 'supply.ground': sel.ground,
      'supply.switchnode': () => sel.named(/^SW$/), 'supply.tied': sel.power, 'supply.rails': sel.railNets,
      'io.absmax': sel.signal, 'io.recommended': sel.signal, 'io.vih': sel.signal, 'io.contention': sel.signal,
      'pins.dnc': sel.open, 'pins.unused': sel.open, 'pins.float': () => fPins.filter(p => /RST|BOOT|EN$/.test(p.name)),
      'func.af': () => sel.named(/SDA|SCL|TX|RX|MOSI|MISO|SCK|INT/), 'func.i2c': () => sel.named(/I2C/), 'func.exti': () => sel.named(/INT/),
      'func.uart': () => sel.named(/UART|TX|RX/), 'parts.decoupling': sel.caps, 'parts.ext': sel.caps, 'parts.regulator': sel.reg,
      'parts.crystal': () => [], 'straps.i2c': () => sel.named(/I2C/), 'library.coverage': sel.ics, 'library.pins': sel.all
    };
    const locate = f => {
      for (const k of f.pins || []) if (pinAt.has(k)) return pinAt.get(k);
      for (const r of f.refs || []) if (partAt.has(r)) { const { sh, p } = partAt.get(r); return { ref: r, x: p.x + p.w / 2, y: p.y - p.h / 2, sheet: sh.i, part: true }; }
      for (const n of f.nets || []) for (const k of nets.get(n) || []) if (pinAt.has(k)) return pinAt.get(k);
      return null;
    };
    const steps = PK.checks.CATALOG.map((c, i) => {
      const cov = run.coverage[c.key] || { checked: 0, skipped: 0, findings: 0 };
      const targets = cov.checked ? (TARGETS[c.key] || (() => []))() : [];
      const byPart = new Map();
      for (const t of targets) (byPart.get(t.ref) || byPart.set(t.ref, []).get(t.ref)).push(t);
      const beats = [...byPart].map(([ref, ts]) => ({ ref, sheet: ts[0].sheet, targets: ts }));
      // A lane per sheet: the replay reads every sheet a check touches at once, each sheet's parts in turn.
      const lanes = [];
      for (const b of beats) { let l = lanes.find(x => x.sheet === b.sheet); if (!l) lanes.push(l = { sheet: b.sheet, beats: [] }); l.beats.push(b); }
      const longest = Math.max(0, ...lanes.map(l => l.beats.length));
      const fs = run.findings.filter(f => f.check === c.key).map(f => Object.assign({ at: locate(f) }, f));
      return { i, key: c.key, group: c.group, title: c.title, needs: c.needs, cov, beats, lanes, findings: fs, dur: longest ? Math.min(2400, 520 + longest * 360) : 260 };
    });
    let t = 0;
    for (const s of steps) { s.t0 = t; t += s.dur; s.t1 = t; }
    return { steps, total: t, pinAt, partAt, netOf, fileOf, filed };
  }

  // The state at time t: the step under way, where each of its lanes (sheets) has got to, and everything
  // finished before it. S.beat is the main lane's (the sheet with the most to read), for one-view renderers.
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
      const fin = done || x.i < si;
      if (fin) { take(x.beats); findings.push(...x.findings); }
      else if (x.i === si) x.lanes.forEach((l, k) => take(l.beats.slice(0, lanes[k].bi)));
    }
    return { t, done, si, step: s, lanes, lane: main, bi: main ? main.bi : -1, beat: main ? main.beat : null, local, checked, findings, frac: t / P.total };
  }
  // A picked check, replayed: the run as it stood when that check began, its reading played again, and its
  // own findings shown from the start. `u` is how far through the check (0 to 1).
  function pickAt(P, i, u, loop) {
    const s = P.steps[i];
    const S = stateAt(P, s.t0 + Math.min(0.999, Math.max(0, u)) * s.dur);
    S.pick = i; S.loop = loop || 0;
    for (const f of s.findings) if (!S.findings.includes(f)) S.findings.push(f);
    return S;
  }

  // ── Shared drawing ──
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  function defs(svg) {
    const d = el('defs', {}, svg);
    d.innerHTML = '<pattern id="sp-hatch-e" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="4" height="4" class="sp-hf-e"/><line x1="0" y1="0" x2="0" y2="4" class="sp-hl-e"/></pattern>' +
      '<pattern id="sp-dots-w" width="3.2" height="3.2" patternUnits="userSpaceOnUse"><rect width="3.2" height="3.2" class="sp-hf-w"/><circle cx="1.6" cy="1.6" r="0.75" class="sp-hl-w"/></pattern>';
  }
  // A sheet in sheet units, flipped to SVG's Y down. Returns the group and an index of its pin and part nodes.
  function drawSheet(sh, parent, opts) {
    opts = opts || {};
    const g = el('g', { class: 'sp-sheet' }, parent);
    el('rect', { x: 0, y: 0, width: sh.w, height: sh.h, class: 'sp-paper', rx: 6 }, g);
    if (!opts.plain) {
      el('rect', { x: 18, y: 18, width: sh.w - 36, height: sh.h - 36, class: 'sp-frame' }, g);
      el('rect', { x: sh.w - 280, y: sh.h - 78, width: 262, height: 60, class: 'sp-frame' }, g);
      const tb = el('text', { x: sh.w - 268, y: sh.h - 40, class: 'sp-tb' }, g); tb.textContent = sh.name;
    }
    const Y = y => sh.h - y;
    const wires = el('path', { class: 'sp-wire', d: sh.wires.map(w => 'M' + w[0] + ' ' + Y(w[1]) + 'H' + w[2] + 'V' + Y(w[3])).join('') }, g);
    wires.setAttribute('d', sh.wires.map(w => 'M' + w[0] + ' ' + Y(w[1]) + 'L' + w[2] + ' ' + Y(w[3])).join(''));
    const idx = { pins: new Map(), parts: new Map() };
    for (const p of sh.parts) {
      const pg = el('g', { class: 'sp-part' + (p.ic ? ' ic' : '') + (p.ic && !p.filed ? ' nofile' : '') }, g);
      el('rect', { x: p.x, y: Y(p.y), width: p.w, height: p.h, rx: p.ic ? 3 : 2, class: 'sp-body' }, pg);
      if (!opts.plain) { const t = el('text', { x: p.x, y: Y(p.y) - 6, class: 'sp-ref' + (p.ic ? ' big' : '') }, pg); t.textContent = p.ref; }
      idx.parts.set(p.ref, pg);
      for (const pin of p.pins) {
        const bx = pin.side === 'l' ? p.x : pin.side === 'r' ? p.x + p.w : pin.x;
        const by = pin.side === 't' ? p.y : pin.side === 'b' ? p.y - p.h : pin.y;
        el('line', { x1: pin.x, y1: Y(pin.y), x2: bx, y2: Y(by), class: 'sp-pin' }, pg);
        const dot = el('circle', { cx: pin.x, cy: Y(pin.y), r: opts.dotR || 3.2, class: 'sp-pd' }, pg);
        idx.pins.set(pin.key, dot);
      }
    }
    for (const pt of sh.ports) {
      const dx = pt.side === 'l' ? -14 : pt.side === 'r' ? 14 : 0, dy = pt.side === 't' ? -14 : pt.side === 'b' ? 14 : 0;
      const x = pt.x + dx, y = Y(pt.y) + dy;
      el('path', { class: 'sp-port', d: 'M' + pt.x + ' ' + Y(pt.y) + 'L' + x + ' ' + y + (pt.gnd ? 'm-7 0h14m-10 4h6' : 'm-6 0h12') }, g);
    }
    if (!opts.plain) for (const lb of sh.labels) {
      const t = el('text', { x: lb.x + (lb.side === 'l' ? -4 : 4), y: Y(lb.y) - 3, class: 'sp-net', 'text-anchor': lb.side === 'l' ? 'end' : 'start' }, g);
      t.textContent = lb.text;
    }
    idx.marks = el('g', { class: 'sp-marks' }, g);
    idx.fx = el('g', { class: 'sp-fx' }, g);
    idx.Y = Y;
    return idx;
  }
  // A finding's mark: ✕ in a hatched square, ▲ dotted, i in a ring. Shape first, color second.
  function mark(parent, f, x, y, s) {
    const g = el('g', { class: 'sp-mark sev-' + f.severity + (f.unverified ? ' unv' : ''), transform: 'translate(' + x + ' ' + y + ') scale(' + s + ')' }, parent);
    if (f.severity === 'error') { el('rect', { x: -9, y: -9, width: 18, height: 18, rx: 3, class: 'mk-shape', fill: 'url(#sp-hatch-e)' }, g); el('path', { d: 'M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5', class: 'mk-glyph' }, g); }
    else if (f.severity === 'warn') { el('path', { d: 'M0 -11L10.5 8H-10.5Z', class: 'mk-shape', fill: 'url(#sp-dots-w)' }, g); el('path', { d: 'M0 -3.5V2.5M0 5V5.4', class: 'mk-glyph' }, g); }
    else { el('circle', { r: 8, class: 'mk-shape' }, g); el('path', { d: 'M0 -1V4M0 -4V-3.6', class: 'mk-glyph' }, g); }
    const tt = el('title', {}, g); tt.textContent = SEVCH[f.severity] + ' ' + f.title;
    return g;
  }
  // A scan dot: pops in and fades (CSS). Frozen screenshots pause it partway.
  function pop(parent, x, y, r, delay, frozen) {
    if (RM()) return;
    const g = el('g', { class: 'sp-pop', transform: 'translate(' + x + ' ' + y + ')' }, parent);
    el('circle', { r: r * 2.4, class: 'pp-ring' }, g); el('circle', { r: r, class: 'pp-core' }, g);
    g.style.setProperty('--r', r);
    if (frozen != null) { g.style.animationDelay = -frozen + 'ms'; g.classList.add('frozen'); for (const c of g.children) { c.style.animationDelay = -frozen + 'ms'; } }
    else { g.style.animationDelay = delay + 'ms'; for (const c of g.children) c.style.animationDelay = delay + 'ms'; g.addEventListener('animationend', e => { if (e.target === g) g.remove(); }); }
  }
  // Sets an element's HTML only when its key changes, so a figure's fade isn't restarted every frame.
  const setOnce = (node, key, html) => { if (node._k === key) return; node._k = key; node.innerHTML = typeof html === 'function' ? html() : html; };
  const stepKey = S => S.done ? 'done' : (S.pick != null ? 'p' : '') + S.si + ':' + S.bi;
  function counts(fs) { const c = { error: 0, warn: 0, info: 0 }; for (const f of fs) c[f.severity]++; return c; }
  const cnt = c => '<span class="sp-c e" title="Errors"><b aria-hidden="true">✕</b>' + c.error + '</span><span class="sp-c w" title="Warnings"><b aria-hidden="true">▲</b>' + c.warn + '</span><span class="sp-c i" title="Notes"><b aria-hidden="true">i</b>' + c.info + '</span>';

  // The progress bar along the top (Fabcheck's): a tick per check, a group's first one taller, the
  // stretch of a step that found something hatched (stripes for errors, dots for warnings).
  function progHtml(P) {
    let h = '<div class="sp-prog"><div class="sp-bar"><i class="sp-fill"></i><span class="sp-run"><s></s></span><div class="sp-steps">';
    let g = '';
    for (const s of P.steps) {
      const l = (s.t0 / P.total * 100).toFixed(2), w = (s.dur / P.total * 100).toFixed(2);
      const sev = s.findings.some(f => f.severity === 'error') ? 'e' : s.findings.some(f => f.severity === 'warn') ? 'w' : '';
      h += '<span class="' + (s.group !== g ? 'm0' : '') + '" style="left:' + l + '%"></span>';
      if (sev) h += '<b class="' + sev + '" data-i="' + s.i + '" style="left:' + l + '%;width:' + w + '%"></b>';
      g = s.group;
    }
    h += '</div><div class="sp-picks">';
    // Once the run is done, one even slot per check (easy to land on), slid along to replay that check
    // (Fabcheck's bar). A group's first check has a taller tick; a check that found an error has the tallest,
    // with stripes, one that found a warning a tall dotted one (never hue alone).
    g = '';
    for (const s of P.steps) {
      const sev = s.findings.some(f => f.severity === 'error') ? ' e' : s.findings.some(f => f.severity === 'warn') ? ' w' : '';
      h += '<span class="' + (s.group !== g ? 'm0' : '') + sev + '" data-i="' + s.i + '" title="' + esc((s.i + 1) + '. ' + s.title) + '"></span>';
      g = s.group;
    }
    return h + '</div></div><div class="sp-meta"><span class="sp-meta-l"></span><span class="sp-meta-r"></span></div></div>';
  }
  function progUpdate(root, P, S) {
    const st = document.getElementById('sp-status'), sk = S.done ? 'done' : (S.pick != null ? 'p' : '') + S.si;
    if (st && st._k !== sk) { st._k = sk; st.textContent = S.done ? 'Checks finished: ' + plural(counts(S.findings).error, 'error') + ', ' + plural(counts(S.findings).warn, 'warning') + '.' : (S.pick != null ? 'Replaying check ' : 'Check ') + (S.si + 1) + ' of ' + P.steps.length + ': ' + S.step.title; }
    // Done or replaying: the bar is the row of checks, the picked one marked.
    const prog = root.querySelector('.sp-prog'), stepped = S.done || S.pick != null;
    prog.classList.toggle('steps', stepped);
    const bar = root.querySelector('.sp-bar');
    if (stepped) {
      bar.tabIndex = 0; bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', 'Replay one check');
      bar.setAttribute('aria-valuemin', 1); bar.setAttribute('aria-valuemax', P.steps.length);
      bar.setAttribute('aria-valuenow', S.pick != null ? S.pick + 1 : P.steps.length);
      bar.setAttribute('aria-valuetext', S.pick != null ? 'Check ' + (S.pick + 1) + ': ' + P.steps[S.pick].title : 'All checks');
    } else { bar.removeAttribute('tabindex'); bar.removeAttribute('role'); }
    for (const sp of root.querySelectorAll('.sp-picks span')) sp.classList.toggle('cur', S.pick != null && +sp.dataset.i === S.pick);
    root.querySelector('.sp-fill').style.transform = 'scaleX(' + S.frac + ')';
    root.querySelector('.sp-run').style.width = (S.frac * 100) + '%';
    root.querySelector('.sp-prog').classList.toggle('done', S.done);
    for (const b of root.querySelectorAll('.sp-steps b')) b.hidden = +b.dataset.i >= S.si && !S.done;
    const c = counts(S.findings);
    const ml = S.pick != null ? 'pick' : S.done ? 'done' + c.error + c.warn + c.info : null;
    setOnce(root.querySelector('.sp-meta-l'), ml || 'run' + c.error + c.warn + c.info, () =>
      S.pick != null ? 'Replaying one check · <button class="sp-back" data-act="all">Back to all results</button>' :
      S.done ? '<span class="sp-ok" aria-hidden="true">✓</span> Checked: ' + cnt(c) + ' <span class="sp-muted">· slide along the bar to replay a check</span>' : cnt(c) + ' <span class="sp-muted">so far</span>');
    root.querySelector('.sp-meta-r').textContent = S.pick != null ? 'Check ' + (S.pick + 1) + ' of ' + P.steps.length : S.done ? P.steps.length + ' checks · ' + S.checked.size + ' pins and parts read' : Math.round(S.frac * 100) + '%';
  }
  // The step's words, as Fabcheck's stage side has them.
  function sideText(P, S, run) {
    if (S.done) {
      const c = counts(run.findings);
      return '<div class="sp-eyebrow">Checks finished</div><div class="sp-title">' + plural(c.error, 'error') + ' · ' + plural(c.warn, 'warning') + '</div>' +
        '<div class="sp-desc">Each mark is a finding where it sits: ✕ an error, ▲ a warning, i a note. Hover a mark for its title (in Pincheck, a click would open it in Findings).</div>';
    }
    const s = S.step, gi = [...new Set(P.steps.map(x => x.group))].indexOf(s.group) + 1;
    const nb = S.lane ? S.lane.n : 0, others = S.lanes.length - 1;
    const what = s.cov.checked ? (S.beat ? 'Reading <b>' + esc(S.beat.ref) + '</b>' + (nb > 1 ? ' · part ' + (S.bi + 1) + ' of ' + nb : '') + (others > 0 ? ' · and ' + plural(others, 'other sheet') + ' at once' : '') : '') : 'Nothing on this board for it';
    let h = '<div class="sp-eyebrow">' + esc(s.group) + ' · check ' + (s.i + 1) + ' of ' + P.steps.length + (S.pick != null ? ' · replay' : '') + '</div><div class="sp-title">' + esc(s.title) + '</div>' +
      '<div class="sp-desc">Needs ' + esc(s.needs) + '. <span class="sp-now">' + what + '</span></div>';
    if (S.pick != null && s.cov.checked) {
      const fs = s.findings;
      h += '<div class="sp-found">' + (fs.length ? '<div class="sp-found-h">Found</div><ul>' + fs.slice(0, 5).map(f => '<li class="sev-' + f.severity + '"><b aria-hidden="true">' + SEVCH[f.severity] + '</b>' + esc(f.title) + '</li>').join('') + (fs.length > 5 ? '<li class="more">and ' + (fs.length - 5) + ' more</li>' : '') + '</ul>'
        : '<div class="sp-found-h"><span class="sp-ok" aria-hidden="true">✓</span> Nothing found</div>') + '</div>';
    }
    return h;
  }

  // ── A · Sheet gallery ──
  // Every sheet in a grid of large thumbnails, all running at once: dots pop in and fade over the pins each
  // check reads on that sheet, what it read stays as small solid dots, and findings land as marks. A sheet
  // being read pulses its outline. The check under way is on the right. (Chris, 2026-11-13: a grid, not a
  // large view with thumbnails.)
  const gallery = {
    mount(root, ctx) {
      const { P, sheets } = ctx;
      const n = sheets.length, plain = n > 1; // compact thumbnails leave out designators and net names
      root.innerHTML = progHtml(P) + '<div class="sp-galwrap grid"><div class="sp-grid n' + Math.min(n, 4) + '">' + sheets.map(sh =>
        '<figure class="sp-card" data-s="' + sh.i + '"><div class="sp-card-art"></div><figcaption><span class="sp-card-n">' + (sh.i + 1) + '</span> <span class="sp-card-name">' + esc(sh.name) + '</span><span class="sp-card-c"></span></figcaption></figure>').join('') +
        '</div><div class="sp-cap"></div></div>';
      this.small = { idx: sheets.map(sh => {
        const svg = el('svg', { viewBox: '-10 -10 ' + (sh.w + 20) + ' ' + (sh.h + 20), class: 'sp-svg', role: 'img', 'aria-label': 'Sheet ' + (sh.i + 1) + ', ' + sh.name }, root.querySelector('.sp-card[data-s="' + sh.i + '"] .sp-card-art'));
        defs(svg);
        return drawSheet(sh, svg, { dotR: plain ? 7 : 5, plain });
      }), marked: -1, last: {} };
      this.root = root; this.ctx = ctx; this.plain = plain;
      // Equal columns that fill the space left of the check, a short last row centered under them. The
      // width comes only from the panel's width, so the cards hold still through the run.
      const grid = root.querySelector('.sp-grid');
      const fit = () => {
        const W = grid.clientWidth, GAP = 12, MIN = 208;
        const cols = Math.max(1, Math.min(n, Math.floor((W + GAP) / (MIN + GAP))));
        grid.style.setProperty('--card-w', Math.floor((W - GAP * (cols - 1)) / cols) + 'px');
      };
      fit();
      if (this.ro) this.ro.disconnect();
      this.ro = new ResizeObserver(fit); this.ro.observe(grid);
    },
    update(S, frozen) {
      const { P, run } = this.ctx, root = this.root;
      progUpdate(root, P, S);
      setOnce(root.querySelector('.sp-cap'), stepKey(S), () => sideText(P, S, run));
      const busy = new Set(S.lanes.map(l => l.sheet));
      root.querySelectorAll('.sp-card').forEach((c, i) => {
        c.classList.toggle('busy', busy.has(i));
        const fs = S.findings.filter(f => f.at && f.at.sheet === i);
        setOnce(c.querySelector('.sp-card-c'), fs.length, () => fs.length ? cnt(counts(fs)) : '');
      });
      paintChecked(this.small.idx, S);
      paintFindings(this.small, S, this.plain ? 40 : 22);
      laneDots(this.small, S.lanes, S, frozen, this.plain ? 24 : 14);
    }
  };
  // Scan dots for each lane's current beat, on that lane's sheet; once per beat (or on every frozen render).
  function laneDots(R, lanes, S, frozen, r) {
    for (const l of lanes) {
      const key = S.si + ':' + l.bi + ':' + (S.loop || 0);
      if (!l.beat || (R.last[l.sheet] === key && frozen == null)) continue;
      R.last[l.sheet] = key;
      const idx = R.idx[l.sheet];
      if (frozen != null) idx.fx.textContent = '';
      l.beat.targets.slice(0, 40).forEach((t, k) => pop(idx.fx, t.x, idx.Y(t.y), t.part ? r * 2 : r, k * 22, frozen != null ? 180 + k * 10 : null));
    }
  }
  function paintChecked(idxs, S) {
    for (const idx of idxs) for (const [k, dot] of idx.pins) dot.classList.toggle('ok', S.checked.has(k));
    for (const idx of idxs) for (const [r, g] of idx.parts) g.classList.toggle('ok', S.checked.has(r));
  }
  function paintFindings(R, S, size) {
    if (R.marked === S.findings.length) return;
    for (const idx of R.idx) idx.marks.textContent = '';
    for (const f of S.findings) {
      if (!f.at) continue;
      const idx = R.idx[f.at.sheet];
      const off = size * 1.6, sd = f.at.side;
      const m = mark(idx.marks, f, f.at.x + (sd === 'l' ? -off : sd === 'r' ? off : 0), idx.Y(f.at.y) + (sd === 't' ? -off : sd === 'b' ? off : f.at.part ? 0 : 0), size / 10);
      if (S.findings.length > R.marked && f === S.findings[S.findings.length - 1] && !RM()) m.classList.add('land');
    }
    R.marked = S.findings.length;
  }


  // ── B · Sheet stack (Fabcheck's stage) ──
  // The sheets stand upright and recede into the page, front to back, like files in a drawer seen from
  // the front left: each face foreshortened across and its far edge raised. The one under check rises
  // out of the deck. (Was layers lying flat, as Fabcheck's; Chris, 2026-11-13.)
  const VW = 720, PW = 190, PH = 300, SKEW = 64, RISE = 16, X0 = 16, TOP = 40;
  const stack = {
    mount(root, ctx) {
      const { P, sheets } = ctx;
      root.innerHTML = progHtml(P) + '<div class="sp-stage"><div class="sp-stage-art"></div><div class="sp-stage-side"><div class="sp-stage-text"></div><div class="sp-detail"></div></div></div>';
      const n = sheets.length, GAP = n > 1 ? Math.min(92, 330 / (n - 1)) : 0;
      const LX = X0 + (n - 1) * GAP + PW + 26;
      const H = TOP + (n - 1) * RISE + PH + 34;
      const svg = el('svg', { viewBox: '0 0 ' + Math.max(VW, LX + 170) + ' ' + H, class: 'sp-svg sp-stack', role: 'img', 'aria-label': 'The design\'s sheets, stacked into the page' }, root.querySelector('.sp-stage-art'));
      defs(svg);
      this.layers = []; this.idx = []; this.legend = [];
      const order = sheets.map((sh, i) => i).reverse(); // back sheets first, so the front ones cover them
      const groups = [];
      for (const i of order) groups[i] = el('g', { class: 'sp-layer', style: '--i:' + i }, svg);
      sheets.forEach((sh, i) => {
        const L = groups[i];
        const sc = 1 - i * Math.min(0.06, 0.3 / Math.max(1, n - 1)); // each sheet further back a little smaller
        const x0 = X0 + i * GAP, y0 = TOP + (n - 1 - i) * RISE + SKEW * sc + PH * (1 - sc) / 2;
        const a = PW * sc / sh.w, d = PH * sc / sh.h, k = -SKEW * sc / sh.w;
        const face = el('g', { transform: 'matrix(' + a + ' ' + k + ' 0 ' + d + ' ' + x0 + ' ' + y0 + ')' }, L);
        const idx = drawSheet(sh, face, { plain: true, dotR: 6 });
        // Marks and scan dots drawn upright over the face, not skewed with it.
        idx.marks.remove(); idx.fx.remove();
        idx.marks = el('g', { class: 'sp-marks' }); idx.fx = el('g', { class: 'sp-fx' });
        idx.Y = y => y;
        idx.project = (x, y) => [x0 + x * a, y0 + (sh.h - y) * d + x * k];
        const t = el('text', { x: LX, y: TOP + 20 + i * 20, class: 'sp-lbl' }, svg);
        t.dataset.base = (i + 1) + ' · ' + sh.name; t.textContent = t.dataset.base;
        this.legend.push(t);
        this.layers.push(L); this.idx.push(idx);
      });
      // Marks and scan dots above every sheet, so a sheet further back still shows what is found and read on it.
      const top = el('g', { class: 'sp-top' }, svg);
      for (const idx of this.idx) { top.appendChild(idx.fx); top.appendChild(idx.marks); }
      this.root = root; this.ctx = ctx; this.svg = svg; this.marked = -1; this.lastBeat = null;
    },
    update(S, frozen) {
      const { P, run } = this.ctx, root = this.root;
      progUpdate(root, P, S);
      root.querySelector('.sp-stage').classList.toggle('is-running', !S.done);
      setOnce(root.querySelector('.sp-stage-text'), stepKey(S), () => sideText(P, S, run));
      const active = S.done ? -1 : S.beat ? S.beat.sheet : -1;
      const busy = new Set(S.lanes.map(l => l.sheet));
      this.layers.forEach((L, i) => { L.classList.toggle('on', i === active); L.classList.toggle('busy', busy.has(i)); });
      this.legend.forEach((t, i) => { t.classList.toggle('on', i === active); t.classList.toggle('busy', busy.has(i)); const tx = (busy.has(i) ? '● ' : '') + t.dataset.base; if (t.textContent !== tx) t.textContent = tx; });
      paintChecked(this.idx, S);
      if (this.marked !== S.findings.length) {
        for (const idx of this.idx) idx.marks.textContent = '';
        for (const f of S.findings) {
          if (!f.at) continue;
          const idx = this.idx[f.at.sheet], [x, y] = idx.project(f.at.x, f.at.y);
          const g = el('g', { class: 'sp-pinmark' }, idx.marks);
          el('line', { x1: x, y1: y, x2: x, y2: y - 22, class: 'sp-stem' }, g);
          el('circle', { cx: x, cy: y, r: 1.8, class: 'sp-foot' }, g);
          const m = mark(g, f, x, y - 28, 0.62);
          if (f === S.findings[S.findings.length - 1] && S.findings.length > this.marked && this.marked >= 0 && !RM()) g.classList.add('drop');
          void m;
        }
        this.marked = S.findings.length;
      }
      // Every sheet the check reads gets its dots at once.
      this.last = this.last || {};
      for (const l of S.lanes) {
        const key = S.si + ':' + l.bi + ':' + (S.loop || 0);
        if (!l.beat || (this.last[l.sheet] === key && frozen == null)) continue;
        this.last[l.sheet] = key;
        const idx = this.idx[l.sheet];
        if (frozen != null) idx.fx.textContent = '';
        l.beat.targets.slice(0, 40).forEach((t, k) => { const [x, y] = idx.project(t.x, t.y); pop(idx.fx, x, y, t.part ? 4 : 2.4, k * 22, frozen != null ? 180 + k * 10 : null); });
      }
      setOnce(root.querySelector('.sp-detail'), stepKey(S), () => detail(this.ctx, S));
    }
  };

  // The detail drawing beside the stack: what the step compares, as a gauge where it's a number.
  function detail(ctx, S) {
    const { P, run } = ctx;
    if (S.done) return railsFig(run);
    const s = S.step, t = S.beat && S.beat.targets[0];
    if (/^supply\.(range|absmax|tied|unpowered)$/.test(s.key) && t && t.key) {
      const tr = S.beat.targets.find(x => run.rails.some(r => r.net === P.netOf.get(x.key))) || t;
      const f = P.fileOf(tr.ref), net = P.netOf.get(tr.key), rail = run.rails.find(r => r.net === net);
      const val = (k) => f && (f.values || []).find(v => v.k === k);
      const rng = val('supply.range') || val('reg.vin'), abs = val('supply.absmax');
      if (rng && rail) return gauge(tr.ref + ' ' + tr.name, net, rail.v, rng.min, rng.max, abs ? abs.max : null, !!rng.ok);
    }
    if (/^io\./.test(s.key) && t && t.key) {
      const net = P.netOf.get(t.key), rail = run.rails.find(r => r.net === 'I2C_SCL') ; void rail;
      return pinFig(t, net, 'A signal pin against its domain\'s limits');
    }
    if (/^func\./.test(s.key) && t && t.key) return pinFig(t, P.netOf.get(t.key), 'The net\'s name against the pin\'s functions');
    if (/^parts\./.test(s.key) && t) return '<svg class="sp-fig" viewBox="0 0 260 110" aria-hidden="true"><path class="d-wire" d="M20 30H240M20 80H240"/><path class="d-wire" d="M130 30V48M130 62V80"/><path class="d-hot" d="M114 48H146M114 62H146"/><text class="d-cap" x="130" y="102">' + esc(t.ref) + ' on ' + esc(P.netOf.get(t.key) || '') + ': value, voltage, and dielectric</text></svg>';
    if (/^library\./.test(s.key) && t) return '<div class="sp-figtext">' + esc(t.ref) + ': looking for its part file, then matching every pin name to the symbol.</div>';
    return '';
  }
  function gauge(label, net, v, min, max, abs, ok) {
    const hi = Math.max(abs || max, v) * 1.12, X = x => 16 + x / hi * 228;
    const over = v > max;
    return '<svg class="sp-fig" viewBox="0 0 260 112" role="img" aria-label="' + esc(label + ' at ' + v + ' V; range ' + min + ' to ' + max + ' V') + '">' +
      '<text class="d-cap l" x="16" y="14">' + esc(label) + ' · ' + esc(net) + '</text>' +
      '<rect class="d-track" x="16" y="40" width="228" height="12" rx="6"/>' +
      '<rect class="d-band" x="' + X(min) + '" y="40" width="' + (X(max) - X(min)) + '" height="12" rx="6"/>' +
      (abs ? '<path class="d-abs" d="M' + X(abs) + ' 32V60"/><text class="d-cap" x="' + X(abs) + '" y="72">abs max ' + abs + ' V</text>' : '') +
      '<path class="d-needle' + (over ? ' bad' : '') + '" d="M' + X(v) + ' 30V62"/><path class="d-arrow" d="M' + (X(v) - 5) + ' 24H' + (X(v) + 5) + 'L' + X(v) + ' 31Z"/>' +
      '<text class="d-cap" x="' + X(min) + '" y="90">' + min + ' V</text><text class="d-cap" x="' + X(max) + '" y="90">' + max + ' V</text>' +
      '<text class="d-cap b" x="' + X(v) + '" y="21">' + v.toFixed(2).replace(/\.?0+$/, '') + ' V</text>' +
      '<text class="d-cap l" x="16" y="108">' + (ok ? 'Range verified' : 'Range not verified yet: a warning at most') + '</text></svg>';
  }
  function pinFig(t, net, cap) {
    return '<svg class="sp-fig" viewBox="0 0 260 96" aria-hidden="true"><rect class="d-body" x="14" y="18" width="80" height="58" rx="4"/><path class="d-pin" d="M94 47H130"/><circle class="d-hotdot" cx="130" cy="47" r="4"/>' +
      '<text class="d-cap l" x="22" y="40">' + esc(t.ref) + '</text><text class="d-cap l" x="22" y="58">' + esc(t.name) + ' · ' + esc(t.num) + '</text>' +
      '<path class="d-wire" d="M130 47H200"/><text class="d-cap l b" x="138" y="40">' + esc(net || 'no net') + '</text><text class="d-cap l" x="14" y="92">' + esc(cap) + '</text></svg>';
  }
  function railsFig(run) {
    const rs = run.rails.slice(0, 5);
    return '<div class="sp-rails">' + rs.map(r => '<div class="sp-rail"><span class="sp-rail-v">' + esc(r.v.toFixed(2).replace(/\.?0+$/, '')) + ' V</span><span class="sp-rail-n">' + esc(r.net) + '</span><span class="sp-rail-f">' + esc(r.from) + '</span></div>').join('') + '</div>';
  }

  // ── C · Part close-up ──
  // The part under check drawn as its package from the pin count (works with a netlist alone), a strip of
  // the design's ICs under it, and beside it the power tree, its rails lighting as their voltages are known.
  const closeup = {
    mount(root, ctx) {
      const { P, design, run } = ctx;
      this.ics = design.parts.filter(p => p.kind === 'ic' || p.kind === 'crystal' || /^PS/.test(p.ref));
      root.innerHTML = progHtml(P) + '<div class="sp-stage cu"><div class="sp-cu-art"><div class="sp-cu-pkg"></div><div class="sp-cu-strip">' +
        this.ics.map(p => '<button class="sp-chip" data-ref="' + esc(p.ref) + '"><b>' + esc(p.ref) + '</b><span>' + esc(p.mpn || p.libRef) + '</span><i class="sp-chip-c"></i></button>').join('') +
        '</div></div><div class="sp-stage-side"><div class="sp-stage-text"></div><div class="sp-detail"></div><div class="sp-tree"></div></div></div>';
      this.root = root; this.ctx = ctx; this.cur = null; this.marked = -1; this.lastBeat = null;
      this.tree(true);
      void run;
    },
    pkg(ref) {
      const { design, P } = this.ctx;
      const p = design.parts.find(x => x.ref === ref);
      const box = this.root.querySelector('.sp-cu-pkg');
      box.textContent = '';
      const n = p.pins.length, quad = n >= 16 && !/^U1$/.test(ref) && !/MODULE|MINI/i.test(p.mpn || '');
      const S = 300, B = quad ? 150 : 110, cx = 230, cy = 190;
      const svg = el('svg', { viewBox: '0 0 460 380', class: 'sp-svg sp-pkgsvg', role: 'img', 'aria-label': ref + ', ' + n + ' pins' }, box);
      defs(svg);
      const g = el('g', {}, svg);
      const bw = quad ? B * 2 : B * 2, bh = quad ? B * 2 : Math.max(120, Math.ceil(n / 2) * 13 + 30);
      el('rect', { x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh, rx: quad ? 10 : 8, class: 'cu-body' + (P.filed.has(ref) ? '' : ' nofile') }, g);
      el('circle', { cx: cx - bw / 2 + 16, cy: cy - bh / 2 + 16, r: 5, class: 'cu-dot1' }, g);
      const t1 = el('text', { x: cx, y: cy - 6, class: 'cu-ref' }, g); t1.textContent = ref;
      const t2 = el('text', { x: cx, y: cy + 16, class: 'cu-mpn' }, g); t2.textContent = p.mpn || p.libRef;
      if (!P.filed.has(ref)) { const t3 = el('text', { x: cx, y: cy + 36, class: 'cu-mpn' }, g); t3.textContent = 'no part file: not checked'; }
      const idx = { pins: new Map(), marks: el('g', {}, svg), fx: el('g', {}, svg), at: new Map() };
      const sides = quad ? 4 : 2, per = Math.ceil(n / sides);
      const sorted = p.pins.slice().sort((a, b) => PK.design.natural(a.num, b.num));
      sorted.forEach((pin, k) => {
        const side = Math.floor(k / per), j = k % per;
        let x, y, lx, ly, anchor, ox = 0, oy = 0;
        if (quad) {
          const span = bw - 30, pos = -span / 2 + (per > 1 ? j * span / (per - 1) : 0);
          if (side === 0) { x = cx - bw / 2; y = cy + pos; ox = -1; }
          else if (side === 1) { x = cx + pos; y = cy + bh / 2; oy = 1; }
          else if (side === 2) { x = cx + bw / 2; y = cy - pos; ox = 1; }
          else { x = cx - pos; y = cy - bh / 2; oy = -1; }
        } else {
          const span = bh - 30, pos = -span / 2 + (per > 1 ? j * span / (per - 1) : 0);
          if (side === 0) { x = cx - bw / 2; y = cy + pos; ox = -1; } else { x = cx + bw / 2; y = cy - pos; ox = 1; }
        }
        const len = 12, tx = x + ox * len, ty = y + oy * len;
        el('path', { d: 'M' + x + ' ' + y + 'L' + tx + ' ' + ty, class: 'cu-pin' }, g);
        const dot = el('circle', { cx: tx, cy: ty, r: per > 10 ? 3 : 4.5, class: 'sp-pd' }, g);
        idx.pins.set(ref + '.' + pin.num, dot); idx.at.set(ref + '.' + pin.num, [tx, ty, ox, oy]);
        const net = P.netOf.get(ref + '.' + pin.num);
        if (per <= 18 || k % 2 === 0) {
          lx = tx + ox * 6; ly = ty + oy * 6;
          anchor = ox < 0 ? 'end' : ox > 0 ? 'start' : 'middle';
          const lab = el('text', { x: lx, y: ly + (oy > 0 ? 8 : oy < 0 ? -2 : 3), class: 'cu-net' + (net ? '' : ' open'), 'text-anchor': anchor }, g);
          if (oy) lab.setAttribute('transform', 'rotate(' + (oy > 0 ? 60 : -60) + ' ' + lx + ' ' + ly + ')'), lab.setAttribute('text-anchor', oy > 0 ? 'start' : 'start');
          lab.textContent = net || pin.name;
        }
      });
      this.idx = [idx]; this.cur = ref; this.marked = -1;
    },
    tree(first) {
      const { run } = this.ctx;
      const T = this.root.querySelector('.sp-tree');
      if (first) {
        // Sources to rails to loads, from the run's rails (made from the demo; a real tree follows `from`).
        T.innerHTML = '<div class="sp-eyebrow sp-tree-h">Power tree</div>' + run.rails.map(r => '<div class="sp-tr" data-net="' + esc(r.net) + '"><span class="sp-tr-n">' + esc(r.net) + '</span><span class="sp-tr-v">' + esc(r.v.toFixed(2).replace(/\.?0+$/, '')) + ' V</span><span class="sp-tr-f">' + esc(r.from) + '</span></div>').join('');
      }
    },
    update(S, frozen) {
      const { P, run } = this.ctx, root = this.root;
      progUpdate(root, P, S);
      root.querySelector('.sp-stage').classList.toggle('is-running', !S.done);
      setOnce(root.querySelector('.sp-stage-text'), stepKey(S), () => sideText(P, S, run));
      const ref = S.beat && this.ics.some(p => p.ref === S.beat.ref) ? S.beat.ref : S.done ? (this.cur || 'U4') : this.cur || 'U4';
      if (ref !== this.cur) this.pkg(ref);
      root.querySelectorAll('.sp-chip').forEach(c => {
        c.classList.toggle('on', c.dataset.ref === this.cur);
        const fs = S.findings.filter(f => (f.refs || []).includes(c.dataset.ref) || (f.pins || []).some(k => k.startsWith(c.dataset.ref + '.')));
        c.querySelector('.sp-chip-c').innerHTML = fs.length && P.filed.has(c.dataset.ref) ? cnt(counts(fs)) : !P.filed.has(c.dataset.ref) ? '<span class="sp-muted">no file</span>' : (S.checked.has(c.dataset.ref) || [...S.checked].some(k => k.startsWith(c.dataset.ref + '.')) ? '<span class="sp-ok">✓</span>' : '');
        c.classList.toggle('nofile', !P.filed.has(c.dataset.ref));
      });
      const idx = this.idx[0];
      for (const [k, dot] of idx.pins) dot.classList.toggle('ok', S.checked.has(k));
      const mine = S.findings.filter(f => (f.pins || []).some(k => idx.at.has(k)));
      if (this.marked !== mine.length) {
        idx.marks.textContent = '';
        for (const f of mine) { const k = f.pins.find(x => idx.at.has(x)); const [x, y, ox, oy] = idx.at.get(k); mark(idx.marks, f, x - ox * 26 + (oy ? 14 : 0), y - oy * 26, 0.9); }
        this.marked = mine.length;
      }
      const key = S.si + ':' + S.bi + ':' + (S.loop || 0);
      if (S.beat && S.beat.ref === this.cur && (key !== this.lastBeat || frozen != null)) {
        this.lastBeat = key;
        if (frozen != null) idx.fx.textContent = '';
        S.beat.targets.forEach((t, k) => { const a = idx.at.get(t.key); if (a) pop(idx.fx, a[0], a[1], 4.5, k * 45, frozen != null ? 160 + k * 12 : null); });
      }
      // Rails light once Supply's rail check has passed them; before that they wait, hollow.
      const railStep = P.steps.find(s => s.key === 'supply.rails');
      const lit = S.done || S.si > railStep.i ? 1 : S.si === railStep.i ? S.local : 0;
      setOnce(root.querySelector('.sp-detail'), stepKey(S), () => S.done ? '' : detail(this.ctx, S));
      root.querySelectorAll('.sp-tr').forEach((r, i, all) => r.classList.toggle('on', i < Math.ceil(lit * all.length)));
    }
  };

  // ── The page ──
  const DIRS = { gallery, stack, closeup };
  async function main() {
    const theme = Q.get('theme');
    if (theme) document.documentElement.dataset.theme = theme;
    const text = await (await fetch('../demo/thermostat-main-pcba.xml', { cache: 'reload' })).text();
    const design = await PK.design.build([new File([text], 'thermostat-main-pcba.xml')]);
    const lib = await Promise.all(['stm32g071kbu6', 'tps562201ddcr'].map(async n => (await fetch('../demo/library/' + n + '.json', { cache: 'reload' })).json()));
    const run = PK.checks.run(design, lib);
    const sheets = layoutSheets(design, run);
    const P = plan(design, run, sheets, lib);
    const ctx = { design, run, sheets, P, lib };
    const panel = document.getElementById('sp-panel');
    let dir = DIRS[Q.get('dir')] ? Q.get('dir') : 'gallery', R = null, raf = 0;
    const at = Q.has('at') ? Math.max(0, Math.min(1, +Q.get('at'))) : null;
    // mode: { kind: 'live' | 'done' | 'pick', start, i }
    let mode = null;
    const HOLD = 900; // a picked check holds at its end this long before it plays again
    function frame(now) {
      raf = 0;
      if (mode.kind === 'live') {
        const S = stateAt(P, now - mode.start);
        R.update(S, null);
        if (S.done) { mode = { kind: 'done' }; return; }
      } else if (mode.kind === 'pick') {
        const s = P.steps[mode.i], el = now - mode.start, loop = s.dur + HOLD;
        R.update(pickAt(P, mode.i, RM() ? 1 : (el % loop) / s.dur, RM() ? 0 : Math.floor(el / loop)), null);
      } else { R.update(stateAt(P, P.total), null); return; }
      raf = requestAnimationFrame(frame);
    }
    function go(m) { mode = m; if (!raf) raf = requestAnimationFrame(frame); }
    function show(d) {
      dir = d; cancelAnimationFrame(raf); raf = 0;
      document.querySelectorAll('#sp-dir button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dir === d));
      panel.className = 'sp-panel card dir-' + d;
      R = Object.create(DIRS[d]); R.mount(panel, ctx);
      if (Q.has('pick')) { const i = Math.max(0, Math.min(P.steps.length - 1, (+Q.get('pick') || 1) - 1)); mode = { kind: 'pick', i }; R.update(pickAt(P, i, at != null ? at : 0.5), 1); return; }
      if (at != null) { mode = { kind: at >= 1 ? 'done' : 'frozen' }; R.update(stateAt(P, at * P.total), 1); return; }
      go({ kind: 'live', start: performance.now() });
    }
    // Picking a check on the finished bar: press and slide (a vertical swipe still scrolls), or the arrow
    // keys, Home, and End; Escape or Back to all results returns to the finished run.
    function pick(i) {
      i = Math.max(0, Math.min(P.steps.length - 1, i));
      if (mode && mode.kind === 'pick' && mode.i === i) return;
      go({ kind: 'pick', i, start: performance.now() });
    }
    const stepAtX = (bar, x) => { const r = bar.getBoundingClientRect(); return Math.floor((x - r.left) / r.width * P.steps.length); };
    const canPick = () => mode && (mode.kind === 'done' || mode.kind === 'pick');
    panel.addEventListener('pointerdown', e => {
      const bar = e.target.closest('.sp-prog.steps .sp-bar');
      if (!bar || !canPick()) return;
      bar.setPointerCapture(e.pointerId);
      pick(stepAtX(bar, e.clientX));
      const move = ev => pick(stepAtX(bar, ev.clientX));
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
    panel.addEventListener('keydown', e => {
      if (!e.target.closest('.sp-prog.steps .sp-bar') || !canPick()) return;
      const cur = mode.kind === 'pick' ? mode.i : P.steps.length;
      const to = { ArrowLeft: cur - 1, ArrowDown: cur - 1, ArrowRight: mode.kind === 'pick' ? cur + 1 : 0, ArrowUp: mode.kind === 'pick' ? cur + 1 : 0, Home: 0, End: P.steps.length - 1 }[e.key];
      if (e.key === 'Escape') { e.preventDefault(); go({ kind: 'done' }); return; }
      if (to == null) return;
      e.preventDefault(); pick(to);
    });
    panel.addEventListener('click', e => { if (e.target.closest('[data-act="all"]')) go({ kind: 'done' }); });
    document.getElementById('sp-dir').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.dir); });
    document.getElementById('sp-replay').addEventListener('click', () => show(dir));
    document.getElementById('sp-theme').addEventListener('click', () => {
      const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      r.dataset.theme = dark ? 'light' : 'dark';
    });
    window.SP = { ctx, stateAt, pickAt, show, pick };
    show(dir);
  }
  main().catch(e => { document.getElementById('sp-panel').textContent = 'The lab stopped: ' + e.message; console.error(e); });
})();
