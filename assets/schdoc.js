// Altium SchDoc reader: the compound file's FileHeader stream is a list of records, each a length
// (3 bytes, little-endian), a type byte (0 = text), and "|KEY=VALUE|…" text. A record's OWNERINDEX is
// the index of its owner among the records after the header. What's read here:
//   RECORD=1  component     RECORD=2  pin          RECORD=34 designator   RECORD=41 parameter
// Wires, net labels, and ports (connectivity) aren't read yet: see docs/design.md, *Inputs*.
(function (PK) {
  'use strict';

  // ELECTRICAL on a pin record (Altium's pin types).
  const ELECTRICAL = ['input', 'io', 'output', 'open-collector', 'passive', 'hiz', 'open-emitter', 'power'];

  function utf8(latin) {
    const b = new Uint8Array(latin.length);
    for (let i = 0; i < latin.length; i++) b[i] = latin.charCodeAt(i) & 0xFF;
    try { return new TextDecoder('utf-8', { fatal: false }).decode(b); } catch (e) { return latin; }
  }

  function records(stream) {
    const out = [];
    // True Latin-1 (TextDecoder's 'latin1' is windows-1252, which would garble the UTF-8 copies).
    const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
    for (let i = 0; i + 4 <= stream.length;) {
      const len = stream[i] | stream[i + 1] << 8 | stream[i + 2] << 16, type = stream[i + 3];
      const body = stream.subarray(i + 4, i + 4 + len);
      i += 4 + len;
      if (type !== 0) { out.push({ RECORD: 'binary' }); continue; }
      const text = latin1(body).replace(/\0+$/, '');
      const r = {};
      for (const kv of text.split('|')) {
        const j = kv.indexOf('=');
        if (j <= 0) continue;
        const k = kv.slice(0, j).toUpperCase(), v = kv.slice(j + 1);
        if (k.startsWith('%UTF8%')) r[k.slice(6)] = utf8(v); // the UTF-8 copy wins over the plain one
        else if (!(k in r)) r[k] = v;
      }
      out.push(r);
    }
    return out;
  }

  // One SchDoc → { sheet, parts: [{ ref, libRef, description, params, pins, designItemId }] }.
  function parse(bytes, sheetName) {
    const cfb = PK.cfb.read(bytes);
    const fh = cfb.streams.get('FileHeader');
    if (!fh) throw new Error('No FileHeader stream: not an Altium schematic');
    const all = records(fh);
    const head = all[0] || {};
    if (!/Schematic/i.test(head.HEADER || '')) throw new Error('Not an Altium schematic document');
    const recs = all.slice(1);
    const comps = new Map();
    recs.forEach((r, k) => {
      if (r.RECORD === '1') comps.set(k, {
        ref: '', libRef: r.LIBREFERENCE || '', description: r.COMPONENTDESCRIPTION || '',
        designItemId: r.DESIGNITEMID || '', partCount: Math.max(1, (+r.PARTCOUNT || 2) - 1),
        params: {}, pins: [], sheets: [sheetName]
      });
    });
    recs.forEach(r => {
      const c = comps.get(+r.OWNERINDEX);
      if (!c) return;
      if (r.RECORD === '34') c.ref = r.TEXT || '';
      else if (r.RECORD === '41' && r.NAME && r.TEXT != null && r.TEXT !== '*') c.params[r.NAME] = r.TEXT;
      else if (r.RECORD === '2') c.pins.push({
        num: r.DESIGNATOR || '', name: (r.NAME || '').replace(/\\/g, ''), // "R\E\S\E\T\" draws an overbar
        type: ELECTRICAL[+r.ELECTRICAL || 0] || 'passive', unit: +r.OWNERPARTID || 1
      });
    });
    const parts = [...comps.values()].filter(c => c.ref);
    let drawing = null;
    try { drawing = graphics(recs, head, sheetName); } catch (e) { drawing = null; if (typeof console !== 'undefined') console.warn('Pincheck: couldn\'t read the drawing of ' + sheetName, e); }
    return { sheet: sheetName, parts, drawing };
  }

  // ── The sheet's drawing, for the schematic viewer (assets/viewer.js) ──
  // Altium coordinates are 1/100 inch (10 mil) with *_FRAC parts in 1/100000 of that; Y points up.
  // A key whose value is 0, false, or empty is left out of the record, so a missing number is 0.
  // Child records are stored in sheet coordinates, already placed, turned, and mirrored.
  const num = (r, k) => (+r[k] || 0) + (+r[k + '_FRAC'] || 0) / 1e5;
  const flag = (r, k) => r[k] === 'T';
  const pts = r => { const out = []; for (let i = 1, n = +r.LOCATIONCOUNT || 0; i <= n; i++) out.push(num(r, 'X' + i), num(r, 'Y' + i)); return out; };
  // Line widths: Smallest, Small, Medium, Large.
  const WIDTH = [0.5, 1, 3, 5];
  const lw = r => WIDTH[+r.LINEWIDTH || 0] || 1;
  // Sheet sizes by SHEETSTYLE, in 10 mil units (Altium's Document Options list): A4 … OrCAD E.
  const SHEETS = [[1150, 760], [1550, 1110], [2230, 1570], [3150, 2230], [4460, 3150], [950, 750], [1500, 950], [2000, 1500], [3200, 2000],
    [4200, 3200], [1100, 850], [1400, 850], [1700, 1100], [990, 790], [1540, 990], [2060, 1560], [3260, 2060], [4280, 3280]];
  // PINCONGLOMERATE: the low two bits turn the pin (0 points right, 1 up, 2 left, 3 down, from its body end);
  // 0x04 hides it, 0x08 shows its name, 0x10 its number. The connection end is LOCATION + PINLENGTH along that.
  const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function graphics(recs, head, sheetName) {
    const sh = recs.find(r => r.RECORD === '31') || {};
    const fonts = [null];
    for (let i = 1, n = +sh.FONTIDCOUNT || 0; i <= n; i++) fonts.push({ size: +sh['SIZE' + i] || 10, name: sh['FONTNAME' + i] || 'Arial', bold: flag(sh, 'BOLD' + i), italic: flag(sh, 'ITALIC' + i) });
    const font = id => fonts[+id || 1] || fonts[1] || { size: 10, name: 'Arial', bold: false, italic: false };
    const style = +sh.SHEETSTYLE || 0;
    let [w, h] = flag(sh, 'USECUSTOMSHEET') ? [num(sh, 'CUSTOMX') || 1500, num(sh, 'CUSTOMY') || 950] : (SHEETS[style] || SHEETS[0]);

    const d = { name: sheetName, w, h, bounds: null, shapes: [], texts: [], wires: [], buses: [], junctions: [], pins: [], labels: [], powers: [], ports: [], sheets: [], frames: [], noerc: [], images: [], comps: [] };
    // The document's own parameters (Title, Revision, …) fill "=Name" texts in the title block.
    const docParams = {};
    recs.forEach(r => { if (r.RECORD === '41' && r.OWNERINDEX == null && r.NAME) docParams[r.NAME.toUpperCase()] = r.TEXT; });

    // Owners: a component's children must belong to the placed unit (OWNERPARTID is its CURRENTPARTID,
    // or -1 for every unit) and to its display mode.
    const owner = new Map();
    recs.forEach((r, k) => {
      if (r.RECORD === '1') owner.set(k, { kind: 'comp', unit: +r.CURRENTPARTID || 1, mode: +r.DISPLAYMODE || 0, parts: Math.max(1, (+r.PARTCOUNT || 2) - 1), libRef: r.LIBREFERENCE || '', params: {}, ref: '', comp: { ref: '', unit: +r.CURRENTPARTID || 1, libRef: r.LIBREFERENCE || '', bbox: null } });
      else if (r.RECORD === '15') owner.set(k, { kind: 'sheet', sym: { x: num(r, 'LOCATION.X'), y: num(r, 'LOCATION.Y'), w: num(r, 'XSIZE'), h: num(r, 'YSIZE'), name: '', file: '', entries: [] } });
      else if (r.RECORD === '39') owner.set(k, { kind: 'template' });
    });
    recs.forEach(r => {
      const o = owner.get(+r.OWNERINDEX);
      if (o && o.kind === 'comp') {
        if (r.RECORD === '34') o.ref = r.TEXT || '';
        if (r.RECORD === '41' && r.NAME) o.params[r.NAME.toUpperCase()] = r.TEXT;
      }
    });
    const resolve = (text, params) => {
      if (text == null || text === '*') return '';
      if (text[0] !== '=') return text;
      const v = (params && params[text.slice(1).toUpperCase()]) ?? docParams[text.slice(1).toUpperCase()];
      return v == null || v === '*' ? '' : String(v);
    };
    const inPart = (r, o) => {
      const id = r.OWNERPARTID == null ? -1 : +r.OWNERPARTID; // missing: no unit of its own (0 is no unit)
      return (id === -1 || id === o.unit) && (+r.OWNERPARTDISPLAYMODE || 0) === o.mode;
    };

    recs.forEach((r, k) => {
      const o = r.OWNERINDEX != null ? owner.get(+r.OWNERINDEX) : null;
      if (o && o.kind === 'comp' && !inPart(r, o)) return;
      // Graphics on a component or the template; directly on the sheet they are drawing too.
      const layer = o && o.kind === 'comp' ? 'body' : 'sheet';
      const ref = o && o.kind === 'comp' ? o.ref : undefined;
      const cid = ref !== undefined ? +r.OWNERINDEX : undefined; // the placed component (one per unit placed)
      const t = r.RECORD;
      const shape = s => { s.layer = layer; if (ref) { s.ref = ref; s.cid = cid; } d.shapes.push(s); };
      switch (t) {
        case '2': {
          if (!o || o.kind !== 'comp') break;
          const pc = +r.PINCONGLOMERATE || 0, [dx, dy] = DIR[pc & 3], len = num(r, 'PINLENGTH');
          const bx = num(r, 'LOCATION.X'), by = num(r, 'LOCATION.Y');
          d.pins.push({ ref: o.ref, cid, num: r.DESIGNATOR || '', name: r.NAME || '', bx, by, x: bx + dx * len, y: by + dy * len, orient: pc & 3, len,
            hidden: !!(pc & 4), showName: !!(pc & 8), showNum: !!(pc & 16), type: ELECTRICAL[+r.ELECTRICAL || 0] || 'passive' });
          break;
        }
        case '4': { const s = resolve(r.TEXT, o && o.params); if (s) d.texts.push(text(r, s, layer === 'body' ? 'body' : 'label', ref)); break; }
        case '5': shape({ t: 'bez', pts: pts(r), w: lw(r) }); break;
        case '6': shape({ t: 'line', pts: pts(r), w: lw(r), dash: +r.LINESTYLEEXT || +r.LINESTYLE || 0 }); break;
        case '7': shape({ t: 'poly', pts: pts(r), w: lw(r), fill: flag(r, 'ISSOLID') }); break;
        case '8': shape({ t: 'ellipse', cx: num(r, 'LOCATION.X'), cy: num(r, 'LOCATION.Y'), rx: num(r, 'RADIUS'), ry: num(r, 'SECONDARYRADIUS') || num(r, 'RADIUS'), w: lw(r), fill: flag(r, 'ISSOLID') }); break;
        case '10': shape({ t: 'rect', x0: num(r, 'LOCATION.X'), y0: num(r, 'LOCATION.Y'), x1: num(r, 'CORNER.X'), y1: num(r, 'CORNER.Y'), rx: num(r, 'CORNERXRADIUS'), ry: num(r, 'CORNERYRADIUS'), w: lw(r), fill: flag(r, 'ISSOLID') }); break;
        case '11': shape({ t: 'arc', cx: num(r, 'LOCATION.X'), cy: num(r, 'LOCATION.Y'), rx: num(r, 'RADIUS'), ry: num(r, 'SECONDARYRADIUS') || num(r, 'RADIUS'), a0: num(r, 'STARTANGLE'), a1: r.ENDANGLE == null ? 360 : num(r, 'ENDANGLE'), w: lw(r) }); break;
        case '12': shape({ t: 'arc', cx: num(r, 'LOCATION.X'), cy: num(r, 'LOCATION.Y'), rx: num(r, 'RADIUS'), ry: num(r, 'RADIUS'), a0: num(r, 'STARTANGLE'), a1: r.ENDANGLE == null ? 360 : num(r, 'ENDANGLE'), w: lw(r) }); break;
        case '13': shape({ t: 'line', pts: [num(r, 'LOCATION.X'), num(r, 'LOCATION.Y'), num(r, 'CORNER.X'), num(r, 'CORNER.Y')], w: lw(r), dash: +r.LINESTYLE || 0 }); break;
        case '14': shape({ t: 'rect', x0: num(r, 'LOCATION.X'), y0: num(r, 'LOCATION.Y'), x1: num(r, 'CORNER.X'), y1: num(r, 'CORNER.Y'), w: lw(r), fill: flag(r, 'ISSOLID') && !flag(r, 'TRANSPARENT') }); break;
        case '15': { const s = owner.get(k).sym; d.sheets.push(s); break; }
        case '16': {
          if (!o || o.kind !== 'sheet') break;
          // DISTANCEFROMTOP counts in tens of units from the symbol's top (or left) edge.
          const s = o.sym, side = +r.SIDE || 0, dist = (+r.DISTANCEFROMTOP || 0) * 10 + (+r['DISTANCEFROMTOP_FRAC1'] || 0) / 1e5;
          const at = side === 0 ? [s.x, s.y - dist] : side === 1 ? [s.x + s.w, s.y - dist] : side === 2 ? [s.x + dist, s.y] : [s.x + dist, s.y - s.h];
          s.entries.push({ x: at[0], y: at[1], side, name: r.NAME || '', io: +r.IOTYPE || 0 });
          break;
        }
        case '17': d.powers.push({ x: num(r, 'LOCATION.X'), y: num(r, 'LOCATION.Y'), text: r.TEXT || '', style: +r.STYLE || 0, orient: +r.ORIENTATION || 0, show: flag(r, 'SHOWNETNAME'), font: font(r.FONTID) }); break;
        case '18': d.ports.push({ x: num(r, 'LOCATION.X'), y: num(r, 'LOCATION.Y'), w: num(r, 'WIDTH'), h: num(r, 'HEIGHT') || 10, name: r.NAME || '', style: +r.STYLE || 0, io: +r.IOTYPE || 0, align: +r.ALIGNMENT || 0, font: font(r.FONTID) }); break;
        case '22': d.noerc.push({ x: num(r, 'LOCATION.X'), y: num(r, 'LOCATION.Y') }); break;
        case '25': d.labels.push({ x: num(r, 'LOCATION.X'), y: num(r, 'LOCATION.Y'), text: r.TEXT || '', orient: +r.ORIENTATION || 0, just: +r.JUSTIFICATION || 0, font: font(r.FONTID) }); break;
        case '26': d.buses.push(pts(r)); break;
        case '27': d.wires.push(pts(r)); break;
        case '28': case '209': d.frames.push({ x0: num(r, 'LOCATION.X'), y0: num(r, 'LOCATION.Y'), x1: num(r, 'CORNER.X'), y1: num(r, 'CORNER.Y'), text: (r.TEXT || '').replace(/~1/g, '\n'), fill: flag(r, 'ISSOLID'), border: flag(r, 'SHOWBORDER'), note: t === '209', author: r.AUTHOR || '', font: font(r.FONTID), align: +r.ALIGNMENT || 0 }); break;
        case '29': d.junctions.push([num(r, 'LOCATION.X'), num(r, 'LOCATION.Y')]); break;
        case '30': d.images.push({ x0: num(r, 'LOCATION.X'), y0: num(r, 'LOCATION.Y'), x1: num(r, 'CORNER.X'), y1: num(r, 'CORNER.Y') }); break;
        case '32': if (o && o.kind === 'sheet') o.sym.name = r.TEXT || ''; break;
        case '33': if (o && o.kind === 'sheet') o.sym.file = r.TEXT || ''; break;
        case '34': if (o && o.kind === 'comp' && !flag(r, 'ISHIDDEN')) d.texts.push(text(r, o.ref + (o.parts > 1 ? String.fromCharCode(64 + o.unit) : ''), 'designator', o.ref)); break;
        case '37': d.buses.push([num(r, 'LOCATION.X'), num(r, 'LOCATION.Y'), num(r, 'CORNER.X'), num(r, 'CORNER.Y')]); break;
        case '41': {
          if (!o || o.kind !== 'comp' || flag(r, 'ISHIDDEN') || r['LOCATION.X'] == null && r['LOCATION.Y'] == null) break;
          const v = resolve(r.TEXT, o.params);
          if (v) d.texts.push(text(r, flag(r, 'SHOWNAME') ? r.NAME + ': ' + v : v, 'param', o.ref));
          break;
        }
      }
    });
    function text(r, s, kind, ref) {
      const f = font(r.FONTID);
      return { x: num(r, 'LOCATION.X'), y: num(r, 'LOCATION.Y'), s, kind, ref, orient: +r.ORIENTATION || 0, just: +r.JUSTIFICATION || 0, mirror: flag(r, 'ISMIRRORED'), size: f.size, bold: f.bold, italic: f.italic, font: f.name };
    }

    // Each placed component's box (its body and pins), for framing it. A part placed as several units has
    // one entry per unit (cid, its record's index), each with its own box.
    const boxes = new Map();
    const grow = (cid, x, y) => { if (cid == null) return; const b = boxes.get(cid); if (!b) boxes.set(cid, [x, y, x, y]); else { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } };
    for (const s of d.shapes) if (s.cid != null) for (const [x, y] of shapeCorners(s)) grow(s.cid, x, y);
    for (const p of d.pins) if (!p.hidden) { grow(p.cid, p.x, p.y); grow(p.cid, p.bx, p.by); }
    for (const [cid, o] of owner) if (o.kind === 'comp' && o.ref && boxes.has(cid)) d.comps.push({ ref: o.ref, cid, unit: o.unit, parts: o.parts, libRef: o.libRef, bbox: boxes.get(cid) });

    // The bounds: the sheet, grown to anything drawn outside it.
    const b = [0, 0, w, h];
    const take = (x, y) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; };
    for (const s of d.shapes) for (const [x, y] of shapeCorners(s)) take(x, y);
    for (const wv of d.wires) for (let i = 0; i < wv.length; i += 2) take(wv[i], wv[i + 1]);
    for (const p of d.pins) take(p.x, p.y);
    d.bounds = b;
    return d;
  }

  function shapeCorners(s) {
    if (s.t === 'rect') return [[s.x0, s.y0], [s.x1, s.y1]];
    if (s.t === 'ellipse' || s.t === 'arc') return [[s.cx - s.rx, s.cy - s.ry], [s.cx + s.rx, s.cy + s.ry]];
    const out = [];
    for (let i = 0; i + 1 < s.pts.length; i += 2) out.push([s.pts[i], s.pts[i + 1]]);
    return out;
  }

  // ── Connectivity on one sheet: which wires, pins, labels, ports, and power ports touch ──
  // Wires join at shared ends, at junctions, and where an end lands on another wire (a T); wires that
  // only cross don't join. Pins, labels, ports, power ports, and sheet entries join the wire they sit
  // on, and pins whose ends meet join each other. → { groups: n, wire: [group per wire],
  // pin: [group per pin, or -1], label, power, port, entry: likewise }.
  function connect(d) {
    const parent = [];
    const make = () => { parent.push(parent.length); return parent.length - 1; };
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const EPS = 0.01;
    const key = (x, y) => Math.round(x * 10) + ',' + Math.round(y * 10);
    // Segments in a coarse grid, for "which wire is this point on".
    const segs = [], grid = new Map(), CELL = 50;
    const wireNode = d.wires.map(wv => {
      const n = make();
      for (let i = 0; i + 3 < wv.length; i += 2) {
        const s = [wv[i], wv[i + 1], wv[i + 2], wv[i + 3], n];
        segs.push(s);
        const gx0 = Math.floor(Math.min(s[0], s[2]) / CELL), gx1 = Math.floor(Math.max(s[0], s[2]) / CELL), gy0 = Math.floor(Math.min(s[1], s[3]) / CELL), gy1 = Math.floor(Math.max(s[1], s[3]) / CELL);
        for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) { const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
      }
      return n;
    });
    const onSeg = (x, y, s) => {
      const [x0, y0, x1, y1] = s;
      if (x < Math.min(x0, x1) - EPS || x > Math.max(x0, x1) + EPS || y < Math.min(y0, y1) - EPS || y > Math.max(y0, y1) + EPS) return false;
      return Math.abs((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) <= EPS * Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    };
    const wiresAt = (x, y) => (grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL)) || []).filter(s => onSeg(x, y, s)).map(s => s[4]);
    // Wire ends on other wires (shared ends and T's), and junctions.
    d.wires.forEach((wv, i) => {
      for (const j of [0, wv.length - 2]) for (const n of wiresAt(wv[j], wv[j + 1])) join(wireNode[i], n);
    });
    for (const [x, y] of d.junctions) { const ns = wiresAt(x, y); for (let k = 1; k < ns.length; k++) join(ns[0], ns[k]); }
    // Points that sit on wires (or on each other, for pins and ports that meet without a wire).
    const pointNodes = new Map();
    const attach = (x, y) => {
      const n = make();
      for (const w of wiresAt(x, y)) join(n, w);
      const k = key(x, y);
      if (pointNodes.has(k)) join(n, pointNodes.get(k)); else pointNodes.set(k, n);
      return n;
    };
    const pinN = d.pins.map(p => (p.hidden ? -1 : attach(p.x, p.y)));
    const labelN = d.labels.map(l => attach(l.x, l.y));
    const powerN = d.powers.map(p => attach(p.x, p.y));
    const portN = d.ports.map(p => { const a = attach(p.x, p.y), b = attach(...portEnd(p)); join(a, b); return a; });
    const entryN = [];
    for (const s of d.sheets) for (const e of s.entries) entryN.push(attach(e.x, e.y));
    // Number the groups.
    const ids = new Map();
    const id = n => { if (n < 0) return -1; const r = find(n); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); };
    const out = { wire: wireNode.map(id), pin: pinN.map(id), label: labelN.map(id), power: powerN.map(id), port: portN.map(id), entry: entryN.map(id) };
    out.groups = ids.size;
    return out;
  }
  // A port connects at either end: STYLE 0–3 lie along X (LOCATION is the left end), 4–7 along Y
  // (LOCATION is the bottom end).
  const portEnd = p => (p.style >= 4 ? [p.x, p.y + p.w] : [p.x + p.w, p.y]);

  PK.schdoc = { parse, records, graphics, connect, portEnd, ELECTRICAL, SHEETS };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
