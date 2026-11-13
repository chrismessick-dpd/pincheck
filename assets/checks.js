// Pincheck's checks: a design's nets and parts against the part library. The contract (finding shape,
// net voltages, the catalog) is docs/checks.md. Synchronous and offline; never an LLM.
(function (PK) {
  'use strict';
  const P = PK.params, L = PK.library;

  // ── The catalog ──
  const CATALOG = [
    { key: 'supply.range', group: 'Supply', title: 'Supply pins within their recommended range', needs: 'supply.range, supply.absmax' },
    { key: 'supply.absmax', group: 'Supply', title: 'Supply pins below their absolute maximum', needs: 'supply.absmax, supply.absmin' },
    { key: 'supply.unpowered', group: 'Supply', title: 'Supply pins with a source', needs: 'pin roles' },
    { key: 'supply.ground', group: 'Supply', title: 'Ground pins and pads on ground', needs: 'pin roles' },
    { key: 'supply.switchnode', group: 'Supply', title: 'Switch nodes off supply rails', needs: 'pin roles (switch)' },
    { key: 'supply.tied', group: 'Supply', title: 'Domains that must share a rail', needs: 'supply.tied' },
    { key: 'supply.rails', group: 'Supply', title: 'Rails driven from two places', needs: 'regulator outputs' },
    { key: 'io.absmax', group: 'I/O levels', title: 'Pins below their absolute maximum', needs: 'io.absmax, io.ft.absmax, pin absmax' },
    { key: 'io.recommended', group: 'I/O levels', title: 'Pins within their recommended maximum', needs: 'pin vmax' },
    { key: 'io.vih', group: 'I/O levels', title: 'Inputs that read a driver\'s high level', needs: 'io.vih, driver domain' },
    { key: 'io.vil', group: 'I/O levels', title: 'Inputs that read a driver\'s low level', needs: 'io.vil, io.vol' },
    { key: 'io.unpowered', group: 'I/O levels', title: 'Inputs driven while their part is unpowered', needs: 'io.absmax, io.ft.absmax, io.absmax.off, rail sources' },
    { key: 'io.contention', group: 'I/O levels', title: 'One driver on each net', needs: 'pin roles (output)' },
    { key: 'pins.dnc', group: 'Pins', title: 'Do-not-connect pins left open', needs: 'pin roles' },
    { key: 'pins.unused', group: 'Pins', title: 'Pins that must be connected or tied', needs: 'pin unused rules' },
    { key: 'pins.float', group: 'Pins', title: 'Reset, boot, and enable pins not floating', needs: 'pin roles' },
    { key: 'func.af', group: 'Pin functions', title: 'Interface nets on pins with that function', needs: 'pin functions' },
    { key: 'func.i2c', group: 'Pin functions', title: 'An I2C bus on one peripheral', needs: 'pin functions' },
    { key: 'func.exti', group: 'Pin functions', title: 'Interrupt nets on separate EXTI lines', needs: 'pin functions (EXTIn)' },
    { key: 'func.uart', group: 'Pin functions', title: 'UART TX to RX', needs: 'pin functions, pin names' },
    { key: 'parts.decoupling', group: 'Required parts', title: 'Decoupling on each supply domain', needs: 'dec.c, dec.bulk' },
    { key: 'parts.ext', group: 'Required parts', title: 'Capacitors a pin requires', needs: 'pin ext' },
    { key: 'parts.regulator', group: 'Required parts', title: 'Regulator capacitors and inductor in range', needs: 'reg.cin, reg.cout, reg.l, reg.cboot' },
    { key: 'parts.crystal', group: 'Required parts', title: 'Crystal load capacitors', needs: 'xtal.cl' },
    { key: 'straps.i2c', group: 'Straps', title: 'I2C addresses unique on each bus', needs: 'i2c.addr' },
    { key: 'conn.mate', group: 'Connectors', title: 'Connectors wired as what mates with them', needs: 'connector assignments, mate profiles, pin functions' },
    { key: 'power.input', group: 'Connectors', title: 'Power inputs on their rail and ground', needs: 'power input assignments' },
    { key: 'power.contacts', group: 'Connectors', title: 'Power input current within the contacts\' rating', needs: 'connector rate.i' },
    { key: 'power.protection', group: 'Connectors', title: 'A fuse, TVS, and reverse-polarity protection before the first load', needs: 'power input assignments' },
    { key: 'power.ratings', group: 'Connectors', title: 'Parts in a power input\'s path rated for its current and voltage', needs: 'rate.i, l.irms, q.id, q.vds, d.if, d.vr, tvs.vrwm' },
    { key: 'library.coverage', group: 'Library', title: 'ICs with a part file', needs: 'the library' },
    { key: 'library.pins', group: 'Library', title: 'Part file pins match the symbol', needs: 'the library' },
  ];
  const byKey = new Map(CATALOG.map(c => [c.key, c]));

  // ── Small helpers ──
  const fmtV = v => (v == null ? '?' : (+v.toFixed(3)).toString() + ' V');
  const isAuto = name => /^Net[A-Z]*\d+_\w+$|^N\$?\d+$|^unconnected-|^Net-\(/i.test(name);
  // Ground by name: GND, AGND, PGND, GND_ISO, GND2, VSS, 0V. A channel suffix (".2") is ignored.
  const stripChan = name => String(name).replace(/^\//, '').replace(/\.\d+$/, '');
  const GND_NAME = /^((D|A|P|S|C|ISO|SIG|PWR|CHASSIS)_?)?(GND|VSS)(_?(ISO|A|D|P|\d+|IN|OUT|PWR|SIG|CHASSIS|EARTH))*$|^0V$|^GROUND$|^EARTH$|^CHASSIS$/i;
  const isGndName = name => GND_NAME.test(stripChan(name));

  // A voltage stated by a net's name, only when the name is a rail's: 3V3, +3.3V, VCC_1V8, P5V0, +24V,
  // 12V_IN, 5V0_ISO, +3V3_AUX. Names with signal words (12V_SENSE, PG_3V3, 5V_MON) are not rails.
  const RAIL_WORDS = new Set(['', 'P', 'V', 'VCC', 'VDD', 'VIN', 'VOUT', 'IN', 'OUT', 'COMP', 'ISO', 'MCU', 'SYS', 'BUS', 'A', 'D', 'DIG', 'ANA', 'AUX', 'REG', 'LDO', 'RAIL', 'SUPPLY', 'PWR', 'POWER', 'MAIN', 'IO', 'TCVR', 'USB', 'CAN', 'LOGIC', 'CORE', 'UPS', 'BATT', 'EXT', 'FILT', 'F', 'PERIPH', 'SNS_PWR', 'AON', 'STBY', 'SW']);
  function voltageFromName(name) {
    const n = stripChan(name).toUpperCase();
    let v = null, rest = n;
    let m = /(?:^|[_+\-\s])\+?P?(\d{1,2})V(\d{1,2})(?=$|[_\-\s])/.exec(n);
    if (m) { v = +(m[1] + '.' + m[2]); rest = n.replace(m[0], '_'); }
    else if ((m = /(?:^|[_+\-\s])\+?(\d{1,3}(?:\.\d{1,2})?)V(?:DC)?(?=$|[_\-\s])/.exec(n))) { v = +m[1]; rest = n.replace(m[0], '_'); }
    // V1.8MCU, V3.3IO, +V1.8_INT: a V, a voltage with a decimal point, then the rail's name.
    else if ((m = /^\+?V(\d{1,2}\.\d{1,2})[_\-]?([A-Z][A-Z0-9]*)?$/.exec(n))) return +m[1];
    if (v == null) return null;
    const words = rest.split(/[_\-+\s]+/);
    return words.every(w => RAIL_WORDS.has(w) || /^\d+$/.test(w)) ? v : null;
  }

  // Values of passives from their parameters: "10k", "4K99", "0R", "100nF", "C_100nF_0603_50V", "2.2uH".
  function textsOf(p) { return [p.params.Value, p.params.Comment, p.partType, p.libRef, p.description, p.mpn].filter(Boolean).map(String); }
  // Separators around a value: start or end, space, underscore, comma, slash, or a dash.
  const SEP = '(?:^|[\\s_,/(\\-])', END = '(?=$|[\\s_,/)\\-])';
  const R_CODE = new RegExp(SEP + '(\\d+)([RKkM])(\\d*)(?:Ω|ohms?)?' + END);                    // 4K7, 0R, 1R5, 10k
  const R_DEC = new RegExp(SEP + '(\\d+\\.\\d+)\\s*([kKM])(?:Ω|ohms?)?' + END);                   // 33.2k, 4.99K
  const R_PLAIN = new RegExp(SEP + '(\\d+(?:\\.\\d+)?)\\s*([kKM]?)\\s*(?:Ω|ohms?)' + END, 'i');   // 10 kΩ, 100 ohm
  const C_VAL = new RegExp(SEP + '(\\d+(?:\\.\\d+)?)\\s*([pnuµ])F?' + END, 'i');                 // 100nF, 100n, 4.7uF
  const C_FULL = new RegExp(SEP + '(\\d+(?:\\.\\d+)?)\\s*([pnuµm]?)F' + END, 'i');               // 10F? only with F
  const L_VAL = new RegExp(SEP + '(\\d+(?:\\.\\d+)?)\\s*([pnuµm]?)H' + END, 'i');                // 2.2uH, 470nH
  function passiveValue(p, unit) {
    const PRE = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, '': 1 };
    const round = v => +v.toPrecision(10);
    for (const raw of textsOf(p)) {
      if (/\bDNP\b|\bNF\b|not\s*fitted|do not (populate|fit)/i.test(raw)) return { dnp: true };
      const t = raw.replace(/(\d)([pnuµ])(\d)/gi, '$1.$3$2'); // 4u7 → 4.7u
      if (unit === 'Ω') {
        let m = R_CODE.exec(t);
        if (m) return { v: round(parseFloat(m[1] + '.' + (m[3] || '0')) * (/r/i.test(m[2]) ? 1 : PRE[m[2]] || 1)) };
        m = R_DEC.exec(t);
        if (m) return { v: round(parseFloat(m[1]) * PRE[m[2]]) };
        m = R_PLAIN.exec(t);
        if (m) return { v: round(parseFloat(m[1]) * (PRE[m[2]] || 1)) };
        if (p.kind === 'resistor' && /^\d+(\.\d+)?$/.test(t.trim())) return { v: parseFloat(t) };
      } else if (unit === 'F') {
        const m = C_VAL.exec(t) || C_FULL.exec(t);
        if (m) return { v: round(parseFloat(m[1]) * (PRE[m[2].toLowerCase() === 'u' ? 'u' : m[2]] || PRE[m[2].toLowerCase()] || 1)) };
      } else {
        const m = L_VAL.exec(t);
        if (m) return { v: round(parseFloat(m[1]) * (PRE[m[2].toLowerCase() === 'u' ? 'u' : m[2]] || PRE[m[2].toLowerCase()] || 1)) };
      }
    }
    return null;
  }

  // Expressions in part files: numbers, domain names, + - * /, parentheses, min(), max().
  function evalExpr(expr, doms) {
    if (typeof expr === 'number') return expr;
    if (expr == null) return null;
    const s = String(expr).replace(/\s+/g, '');
    let i = 0;
    const names = Object.keys(doms).sort((a, b) => b.length - a.length);
    const peek = () => s[i];
    function num() {
      const m = /^\d*\.?\d+(?:e[-+]?\d+)?/i.exec(s.slice(i));
      if (!m) return null;
      i += m[0].length; return parseFloat(m[0]);
    }
    function atom() {
      if (peek() === '(') { i++; const v = sum(); if (peek() === ')') i++; return v; }
      if (peek() === '-') { i++; const v = atom(); return v == null ? null : -v; }
      if (peek() === '+') { i++; return atom(); }
      const fn = /^(min|max)\(/i.exec(s.slice(i));
      if (fn) {
        i += fn[0].length; const args = [sum()];
        while (peek() === ',') { i++; args.push(sum()); }
        if (peek() === ')') i++;
        if (args.some(a => a == null)) return null;
        return fn[1].toLowerCase() === 'min' ? Math.min(...args) : Math.max(...args);
      }
      for (const n of names) if (s.startsWith(n, i)) { i += n.length; return doms[n]; }
      const v = num();
      return v;
    }
    function prod() { let v = atom(); while (v != null && (peek() === '*' || peek() === '/')) { const o = s[i++]; const w = atom(); if (w == null) return null; v = o === '*' ? v * w : v / w; } return v; }
    function sum() { let v = prod(); while (v != null && (peek() === '+' || peek() === '-')) { const o = s[i++]; const w = prod(); if (w == null) return null; v = o === '+' ? v + w : v - w; } return v; }
    const v = sum();
    return i === s.length && v != null && isFinite(v) ? +v.toPrecision(12) : null;
  }

  // ── The model: nets, parts, part files ──
  function model(design, lib, conn) {
    const parts = new Map(design.parts.map(p => [p.ref, p]));
    const nets = new Map();
    const netOf = new Map();
    for (const n of design.nets || []) {
      if (!nets.has(n.name)) nets.set(n.name, []);
      for (const node of n.nodes) { nets.get(n.name).push(node); netOf.set(node.ref + '.' + node.pin, n.name); }
    }
    const files = new Map(), why = {};
    for (const p of design.parts) {
      const f = p.mpn ? L.find(lib, p.mpn) : null;
      if (f) files.set(p.ref, f);
      why[p.ref] = f ? f.id : null;
    }
    // An exposed pad the part file numbers PAD (or EP) may be numbered 11 or 7 on the symbol: give the file's
    // number the net of the symbol's pad pin (named EP, EXP, PAD, or the like, and not a number the file uses).
    const PAD_NAME = /^(E?PAD|EP|EXP|THERMAL|THERMAL[\s_]?PAD|TAB|POWERPAD|GND[\s_]?PAD|SLUG)$/i;
    for (const [ref, f] of files) {
      const p = parts.get(ref);
      const nums = new Set(f.pins.map(x => String(x.num).toUpperCase()));
      for (const fp of f.pins) {
        if (fp.role !== 'pad' || netOf.has(ref + '.' + fp.num) || p.pins.some(x => String(x.num).toUpperCase() === String(fp.num).toUpperCase())) continue;
        const sp = p.pins.find(x => PAD_NAME.test(String(x.name || '').trim()) && !nums.has(String(x.num).toUpperCase()));
        const n = sp && netOf.get(ref + '.' + sp.num);
        if (n) netOf.set(ref + '.' + fp.num, n);
      }
    }
    const filePin = (ref, num) => { const f = files.get(ref); return f ? f.pins.find(x => String(x.num).toUpperCase() === String(num).toUpperCase()) : null; };
    const valueOf = (f, k, on) => (f.values || []).find(v => v.k === k && (v.on || '') === (on || '')) || (on ? null : null);
    // Connector assignments (assets/mates.js forDesign): only those whose connector is on this design.
    const c = conn || {};
    const assign = (c.assign || []).filter(a => a && parts.has(a.ref));
    const profiles = c.profiles instanceof Map ? Object.fromEntries(c.profiles) : (c.profiles || {});
    return { design, lib, parts, nets, netOf, files, why, filePin, valueOf, conn: { assign, profiles } };
  }

  // Two-pin parts: [ref, netA, netB].
  function twoPin(M, p) {
    if (p.pins.length !== 2) return null;
    const a = M.netOf.get(p.ref + '.' + p.pins[0].num), b = M.netOf.get(p.ref + '.' + p.pins[1].num);
    return [a, b];
  }

  // ── Net voltages ──
  function voltages(M) {
    const V = new Map(); // net → { v, from, unverified, basis }
    const set = (net, v, from, extra) => { if (net && v != null && !V.has(net)) V.set(net, Object.assign({ v, from }, extra || {})); };
    const ground = new Set();
    for (const [name, nodes] of M.nets) {
      if (isGndName(name)) { ground.add(name); continue; }
      // An unnamed (or oddly named) net is ground when most of the part-file supply pins on it are
      // ground pins, and its name states no voltage. One miswired ground pin can't make a rail ground.
      if (voltageFromName(name) != null) continue;
      let g = 0, pw = 0;
      for (const n of nodes) { const fp = M.filePin(n.ref, n.pin); if (!fp) continue; if (fp.role === 'ground') g++; else if (fp.role === 'power-in' || fp.role === 'power-out') pw++; }
      if (g >= 2 && g > 2 * pw) ground.add(name);
    }
    for (const g of ground) set(g, 0, 'ground');
    // Power inputs (docs/connectors.md): the voltage someone gave for a connector's supply pins, a range. `v` is
    // the typical (or the middle); vmin and vmax travel with it, and the supply checks use both ends.
    for (const a of M.conn.assign) {
      const pw = a.power; if (!pw || !pw.v) continue;
      const r = pw.v, typ = r.typ != null ? r.typ : r.min != null && r.max != null ? (r.min + r.max) / 2 : r.max != null ? r.max : r.min;
      if (typeof typ !== 'number') continue;
      const lo = r.min != null ? r.min : typ, hi = r.max != null ? r.max : typ;
      for (const pin of pw.pins || []) {
        const net = M.netOf.get(a.ref + '.' + pin);
        if (net && !ground.has(net) && !V.has(net)) V.set(net, { v: typ, vmin: lo, vmax: hi, from: a.ref + ' power input (' + (lo !== hi ? fmtV(lo).replace(' V', '') + ' to ' + fmtV(hi) : fmtV(typ)) + ')', input: a.ref });
      }
    }
    const conflicts = [];
    const setReg = (net, v, from, extra) => {
      if (!net || v == null) return;
      const had = V.get(net);
      if (had && had.from !== 'net name' && had.from !== 'ground' && Math.abs(had.v - v) > 0.05 * Math.max(v, had.v)) conflicts.push({ net, a: had, b: Object.assign({ v, from }, extra) });
      if (!had || had.from === 'net name') V.set(net, Object.assign({ v, from }, extra));
    };
    // Regulator outputs.
    for (const [ref, f] of M.files) {
      const p = M.parts.get(ref);
      const outPins = f.pins.filter(x => x.role === 'power-out');
      const vout = M.valueOf(f, 'reg.vout');
      const vref = M.valueOf(f, 'reg.vref');
      const fb = f.pins.find(x => x.role === 'feedback');
      const vtyp = v => (v.typ != null ? v.typ : v.value != null ? v.value : v.min != null && v.max != null ? (v.min + v.max) / 2 : v.max != null ? v.max : v.min);
      // A fixed-output part with no output pin senses its output on FB (TPS62231: FB to VOUT). Only when FB isn't
      // a divider's midpoint (no resistor from it to ground).
      const fbIsOut = !outPins.length && fb && (() => {
        const fbNet = M.netOf.get(ref + '.' + fb.num);
        return fbNet && !(M.nets.get(fbNet) || []).some(n => { const r = M.parts.get(n.ref); const e = r && r.kind === 'resistor' && twoPin(M, r); return e && e.some(x => x !== fbNet && ground.has(x)); });
      })();
      if (vout && typeof vtyp(vout) === 'number') {
        for (const op of (fbIsOut ? [fb] : outPins)) setReg(M.netOf.get(ref + '.' + op.num), vtyp(vout), ref + ' output (' + f.mpn + ')', { basis: [basisOf(f, vout)], unverified: !vout.ok });
      } else if (vref && fb && typeof vtyp(vref) === 'number') {
        const fbNet = M.netOf.get(ref + '.' + fb.num);
        if (!fbNet) continue;
        let top = null, bot = null;
        for (const node of M.nets.get(fbNet) || []) {
          const r = M.parts.get(node.ref);
          if (!r || r.kind !== 'resistor') continue;
          const ends = twoPin(M, r); if (!ends) continue;
          const other = ends[0] === fbNet ? ends[1] : ends[0];
          const val = passiveValue(r, 'Ω'); if (!val || val.dnp || !val.v) continue;
          if (ground.has(other)) bot = { r, v: val.v }; else top = { r, v: val.v, net: other };
        }
        if (top && bot) {
          const v = vtyp(vref) * (1 + top.v / bot.v);
          setReg(top.net, v, ref + ' output: ' + fmtV(vtyp(vref)) + ' × (1 + ' + P.fmt(top.v, 'Ω') + ' / ' + P.fmt(bot.v, 'Ω') + ') (' + top.r.ref + ', ' + bot.r.ref + ')', { basis: [basisOf(f, vref)], unverified: !vref.ok });
        }
      }
    }
    // Net names.
    for (const name of M.nets.keys()) { const v = voltageFromName(name); if (v != null) set(name, v, 'net name'); }
    // Through parts that pass DC, until nothing changes.
    const passes = [];
    for (const p of M.parts.values()) {
      if (p.kind === 'resistor') { const val = passiveValue(p, 'Ω'); if (val && !val.dnp && val.v != null && val.v <= 1) { const e = twoPin(M, p); if (e) passes.push([p.ref, e[0], e[1]]); } }
      else if (p.kind === 'inductor' || /^(FB|F)\d/i.test(p.ref)) { const e = twoPin(M, p); if (e) passes.push([p.ref, e[0], e[1]]); }
      const f = M.files.get(p.ref);
      if (f && f.kind === 'switch') {
        const ins = f.pins.filter(x => /^(V?IN\d?|VS)$/i.test(x.name)).map(x => M.netOf.get(p.ref + '.' + x.num)).filter(Boolean);
        const outs = f.pins.filter(x => /^(V?OUT\d?)$/i.test(x.name)).map(x => M.netOf.get(p.ref + '.' + x.num)).filter(Boolean);
        for (const a of ins) for (const b of outs) passes.push([p.ref + ' (assumed on)', a, b]);
      }
    }
    // A switch node (a regulator's SW pin) carries no DC voltage of its own: nothing passes into or out of it.
    const switchNodes = new Set();
    // A switch pin tied to a rail that already has a voltage (an MCU's unused SMPS pin on 3V3) doesn't make it one.
    for (const [ref, f] of M.files) for (const pin of f.pins) if (pin.role === 'switch') { const n = M.netOf.get(ref + '.' + pin.num); if (n && !V.has(n)) switchNodes.add(n); }
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false;
      for (const [ref, a, b] of passes) {
        if (!a || !b || switchNodes.has(a) || switchNodes.has(b)) continue;
        if (V.has(a) && !V.has(b) && !ground.has(b)) { const s = V.get(a); V.set(b, Object.assign({}, s, { from: s.from + ', through ' + ref })); changed = true; }
        else if (V.has(b) && !V.has(a) && !ground.has(a)) { const s = V.get(b); V.set(a, Object.assign({}, s, { from: s.from + ', through ' + ref })); changed = true; }
        else if (V.has(a) && V.has(b) && V.get(a).from === 'net name' && V.get(b).from !== 'net name' && !/through/.test(V.get(b).from || '')) { const s = V.get(b); V.set(a, Object.assign({}, s, { from: s.from + ', through ' + ref })); changed = true; }
      }
    }
    // A power input's range reaches its first load through the parts in its path (fuses, diodes, FETs), over a net's
    // name: the parts on it see the input's maximum, less a diode drop that isn't counted.
    for (const a of M.conn.assign) {
      const pw = a.power; if (!pw || !pw.v) continue;
      const net0 = (pw.pins || []).map(n => M.netOf.get(a.ref + '.' + n)).find(n => n && V.has(n) && V.get(n).input === a.ref);
      if (!net0) continue;
      const s = V.get(net0);
      for (const [net, via] of powerPath(M, ground, net0, a.ref).nets) {
        const had = V.get(net);
        if (net === net0 || ground.has(net) || (had && had.from !== 'net name' && had.input !== a.ref)) continue;
        V.set(net, Object.assign({}, s, { from: s.from + ', through ' + via.join(', ') }));
      }
    }
    return { V, ground, conflicts };
  }

  function basisOf(f, v) { return { file: f.id, mpn: f.mpn, k: v.k, on: v.on || '', page: v.page, verified: !!v.ok }; }

  // The voltage each supply domain of a part instance is at: the net of any of its power-in pins.
  function domainVoltages(M, NV, ref) {
    const f = M.files.get(ref); const out = {};
    if (!f) return out;
    for (const pin of f.pins) {
      if (pin.role !== 'power-in' || !pin.domain || out[pin.domain] != null) continue;
      const net = M.netOf.get(ref + '.' + pin.num);
      if (net && NV.V.has(net)) out[pin.domain] = NV.V.get(net).v;
    }
    for (const g of ['GND', 'VSS', 'AGND', 'VSSA', 'GND1', 'GND2']) if (out[g] == null) out[g] = 0;
    return out;
  }

  // The high level of a signal net: pull-ups to known rails, and outputs driving it (their domain's voltage).
  // A net that is itself a rail is tied to it. Otherwise resistors to known nets set its idle level by
  // Thevenin (a pull-up alone gives the rail; a divider gives the divided voltage); a resistor with no
  // known value counts as a plain pull-up.
  // A logic signal crosses series resistors (Chris, 2026-11-13: a 22 Ω between a transceiver's TXD and an MCU, up to
  // 1 kΩ): every net reached through them, with the resistors crossed, up to two hops. See seriesLinks.
  function logicNode(M, net) {
    const out = [{ net, via: [] }];
    if (!M.links) return out;
    const seen = new Set([net]);
    for (let i = 0; i < out.length; i++) {
      if (out[i].via.length >= 2) continue;
      for (const l of M.links.get(out[i].net) || []) if (!seen.has(l.net)) { seen.add(l.net); out.push({ net: l.net, via: out[i].via.concat(l.ref) }); }
    }
    return out;
  }
  const through = via => (via.length ? ' (through ' + via.join(', ') + ')' : '');
  function highLevels(M, NV, net) {
    const out = [];
    if (NV.ground.has(net)) return out;
    if (NV.V.has(net)) { const s = NV.V.get(net); return [{ v: s.vmax != null ? s.vmax : s.v, by: 'the rail itself (' + s.from + ')', kind: 'pull-up', ref: null }]; }
    for (const { net: n, via } of logicNode(M, net)) {
      let gsum = 0, isum = 0;
      const rails = [], lows = [], unknown = [];
      for (const node of M.nets.get(n) || []) {
        const p = M.parts.get(node.ref); if (!p) continue;
        if (p.kind === 'resistor') {
          const e = twoPin(M, p); if (!e) continue;
          const other = e[0] === n ? e[1] : e[0];
          if (!other || other === n || !NV.V.has(other)) continue;
          const val = passiveValue(p, 'Ω');
          if (val && val.dnp) continue;
          const vo = NV.V.get(other).v;
          if (val && val.v > 0) { gsum += 1 / val.v; isum += vo / val.v; (vo > 0 ? rails : lows).push(p.ref + ' to ' + other); }
          else if (vo > 0) unknown.push({ v: vo, ref: p.ref, other });
          continue;
        }
        const fp = M.filePin(node.ref, node.pin);
        if (fp && (fp.role === 'output' || fp.role === 'io' || fp.role === 'open-drain') && fp.domain) {
          const doms = domainVoltages(M, NV, node.ref), dv = doms[fp.domain];
          if (dv == null || fp.role === 'open-drain') continue;
          // Its guaranteed high (io.voh, as an expression in its own supply), for reading thresholds; dv for maximums.
          const f = M.files.get(node.ref), voh = f && M.valueOf(f, 'io.voh', fp.domain);
          const vohV = voh ? evalExpr(voh.value != null ? voh.value : voh.min != null ? voh.min : voh.typ, doms) : null;
          const vohE = voh && (voh.value != null ? voh.value : voh.min != null ? voh.min : voh.typ);
          out.push({ v: dv, voh: vohV != null && vohV <= dv ? vohV : null, vohExpr: typeof vohE === 'string', rail: domainNet(M, node.ref, fp.domain), vohBasis: voh && vohV != null ? basisOf(f, voh) : null, domain: fp.domain, net: n, via,
            by: node.ref + '.' + node.pin + ' (' + fp.name + ', ' + fp.domain + ')' + through(via), kind: fp.role === 'output' ? 'output' : 'io', ref: node.ref, pin: node.pin });
        }
      }
      if (gsum > 0 && rails.length) {
        const v = isum / gsum;
        if (v > 0.01) out.push({ v, by: rails.join(', ') + (lows.length ? ' with ' + lows.join(', ') + ' (a divider)' : '') + through(via), kind: 'pull-up', ref: null, net: n, via });
      }
      for (const u of unknown) out.push({ v: u.v, by: u.ref + ' to ' + u.other + ' (value unknown)' + through(via), kind: 'pull-up', ref: u.ref, net: n, via });
    }
    return out;
  }

  // Where a rail comes from (Chris, 2026-11-13: a transceiver's 5 V logic side into an MCU on a USB-powered 3.3 V
  // rail): up through regulators (their highest supply input), load switches, and series parts to a power input, a
  // connector, or nothing known. Returns { root, chain: [nets], switched, refs }.
  const CORE_OUT = /^(VCAP|VDD11|V11|VDDCORE|VCORE|VDDLDO|VDD_?CORE)/i;
  function railRoot(M, NV, net, seen) {
    seen = seen || new Set();
    const none = { root: null, chain: net ? [net] : [], switched: false, refs: [] };
    if (!net || seen.has(net) || seen.size > 16 || NV.ground.has(net)) return none;
    seen.add(net);
    const s = NV.V.get(net);
    if (s && s.input) return { root: s.input, chain: [net], switched: false, refs: [s.input] };
    const nodes = M.nets.get(net) || [];
    const up = (next, ref, sw) => { const r = railRoot(M, NV, next, seen); return { root: r.root, chain: [net].concat(r.chain), switched: r.switched || !!sw, refs: [ref].concat(r.refs) }; };
    for (const n of nodes) {
      const fp = M.filePin(n.ref, n.pin), f = M.files.get(n.ref);
      if (!fp || fp.role !== 'power-out' || CORE_OUT.test(fp.name)) continue;
      const ins = [...new Set(f.pins.filter(x => x.role === 'power-in').map(x => M.netOf.get(n.ref + '.' + x.num)).filter(x => x && x !== net && !NV.ground.has(x)))];
      ins.sort((a, b) => ((NV.V.get(b) || { v: 0 }).v - (NV.V.get(a) || { v: 0 }).v));
      return ins.length ? up(ins[0], n.ref, f.kind === 'switch') : { root: n.ref, chain: [net], switched: false, refs: [n.ref] };
    }
    for (const n of nodes) {
      const q = M.parts.get(n.ref); if (!q) continue;
      const e = twoPin(M, q);
      const other = e && (e[0] === net ? e[1] : e[0]);
      if (!other || other === net || NV.ground.has(other)) continue;
      const rv = q.kind === 'resistor' ? passiveValue(q, 'Ω') : null;
      if ((rv && !rv.dnp && rv.v != null && rv.v <= 1) || q.kind === 'inductor' || /^(FB|F|L)\d/i.test(q.ref) || (q.kind === 'diode' && !isLed(q) && NV.V.has(other))) return up(other, q.ref);
    }
    const c = nodes.map(n => M.parts.get(n.ref)).find(q => q && (q.kind === 'connector' || (M.files.get(q.ref) || {}).kind === 'connector'));
    if (c) return { root: c.ref, chain: [net], switched: false, refs: [c.ref] };
    return none;
  }
  // The net a part's supply domain is on.
  function domainNet(M, ref, dom) {
    const f = M.files.get(ref); if (!f) return null;
    for (const p of f.pins) if (p.role === 'power-in' && p.domain === dom) { const n = M.netOf.get(ref + '.' + p.num); if (n) return n; }
    return null;
  }
  // Can these two rails be up one without the other? 'no' when one is made from the other or both come from one
  // source with no switch between; 'yes' when their sources differ or a switch is in the way; 'unknown' otherwise.
  function independent(M, NV, a, b) {
    if (!a || !b || a === b) return { v: 'no' };
    const ra = railRoot(M, NV, a), rb = railRoot(M, NV, b);
    const ia = ra.chain.indexOf(b), ib = rb.chain.indexOf(a);
    if (ia >= 0 || ib >= 0) {
      // One is made from the other: independent only through a switch.
      return { v: (ia >= 0 ? ra : rb).switched ? 'yes' : 'no', ra, rb };
    }
    if (!ra.root || !rb.root) return { v: 'unknown', ra, rb };
    if (ra.root !== rb.root) return { v: 'yes', ra, rb };
    return { v: ra.switched || rb.switched ? 'yes' : 'no', ra, rb };
  }

  // Series resistors that join two logic nets into one signal: two pins, a known value up to 1 kΩ (Chris, 2026-11-13),
  // neither end ground or a rail (that's a pull), each end on a logic pin (an IC's I/O pin, or a connector), and not
  // half of a divider (a resistor from either end to ground more than 20 times the series one would make it one).
  const LOGIC_ROLES = new Set(['io', 'input', 'output', 'open-drain', 'reset', 'enable', 'boot', 'clock-in', 'clock-out', 'power-good', 'bus', 'other']);
  function seriesLinks(M, NV) {
    const links = new Map();
    const passive = q => ['resistor', 'capacitor', 'inductor', 'diode', 'crystal'].includes(q.kind);
    const logicOn = net => (M.nets.get(net) || []).some(n => { const q = M.parts.get(n.ref); if (!q || passive(q)) return false; const fp = M.filePin(n.ref, n.pin); return fp ? LOGIC_ROLES.has(fp.role) : true; });
    const toGround = (net, self) => (M.nets.get(net) || []).map(n => M.parts.get(n.ref)).filter(q => q && q !== self && q.kind === 'resistor').map(q => { const e = twoPin(M, q); const v = passiveValue(q, 'Ω'); return e && e.some(x => NV.ground.has(x)) && v && !v.dnp ? v.v : null; }).filter(v => v != null);
    for (const p of M.parts.values()) {
      if (p.kind !== 'resistor') continue;
      const e = twoPin(M, p); if (!e || !e[0] || !e[1] || e[0] === e[1]) continue;
      const val = passiveValue(p, 'Ω'); if (!val || val.dnp || val.v == null || val.v > 1000) continue;
      if (e.some(n => NV.ground.has(n) || NV.V.has(n))) continue;
      if (!logicOn(e[0]) || !logicOn(e[1])) continue;
      if (e.some(n => toGround(n, p).some(g => val.v > g / 20))) continue;
      for (const [a, b] of [[e[0], e[1]], [e[1], e[0]]]) { if (!links.has(a)) links.set(a, []); links.get(a).push({ net: b, ref: p.ref }); }
    }
    return links;
  }

  // ── The checks ──
  // Parts not fitted (a variant's list, or DNP on the part; design.js) leave the checks, and their pins leave the nets.
  function fitted(design) {
    if (!design.parts.some(p => p.dnp)) return design;
    const off = new Set(design.parts.filter(p => p.dnp).map(p => p.ref));
    return Object.assign({}, design, { parts: design.parts.filter(p => !p.dnp), nets: design.nets ? design.nets.map(n => Object.assign({}, n, { nodes: n.nodes.filter(x => !off.has(x.ref)) })) : design.nets });
  }

  function run(design, lib, conn) {
    const t0 = Date.now();
    design = fitted(design);
    const M = model(design, lib || [], conn);
    const needFiles = new Set(); // parts a check wanted a part file for (a power path's FETs, fuses, and inductors)
    const NV = voltages(M);
    M.links = seriesLinks(M, NV);
    const findings = [];
    const coverage = Object.fromEntries(CATALOG.map(c => [c.key, { checked: 0, skipped: 0, findings: 0 }]));
    const seen = new Set();
    const add = (check, severity, title, detail, extra) => {
      const c = byKey.get(check);
      const f = Object.assign({ check, group: c.group, severity, title, detail, refs: [], pins: [], nets: [], basis: [] }, extra || {});
      f.id = check + ':' + (f.key || f.pins[0] || f.refs[0] || f.nets[0] || title);
      delete f.key;
      if (seen.has(f.id)) return; seen.add(f.id);
      // Unverified values only warn (docs/checks.md).
      const unv = f.basis.filter(b => !b.verified);
      if (unv.length) {
        f.unverified = true;
        if (f.severity === 'error') f.severity = 'warn';
        f.detail += ' Rests on unverified ' + unv.map(b => b.mpn + ' ' + b.k + (b.on ? ' (' + b.on + ')' : '') + (b.page ? ', p.' + b.page : '')).join('; ') + '.';
      }
      findings.push(f); coverage[check].findings++;
    };
    const tick = (k, n = 1) => { coverage[k].checked += n; };
    const skip = (k, n = 1) => { coverage[k].skipped += n; };
    const hasNets = !!(design.nets && design.nets.length);

    // Library coverage and pin agreement.
    for (const g of PK.design.groups(design, ['ic', 'crystal'])) {
      const f = M.files.get(g.refs[0]);
      tick('library.coverage');
      if (!f) { add('library.coverage', 'info', (g.mpn || g.refs[0]) + ' has no part file', 'Not checked: ' + g.refs.join(', ') + '. Configure it in Parts to check its pins.', { refs: g.refs.slice(0, 50) }); continue; }
      tick('library.pins');
      const mism = L.pinCheck(f, g.part).filter(m => m.sch != null && m.file != null);
      if (mism.length) add('library.pins', 'warn', g.mpn + ': ' + mism.length + ' pin name' + (mism.length === 1 ? ' differs' : 's differ') + ' from the part file', mism.slice(0, 6).map(m => 'pin ' + m.num + ' is “' + m.sch + '” on the symbol, “' + m.file + '” in the file').join('; ') + (mism.length > 6 ? '; …' : '') + '. Check the symbol against the datasheet.', { refs: g.refs.slice(0, 50) });
    }
    if (!hasNets) return finish();

    // Rails driven from two places.
    for (const c of NV.conflicts) { tick('supply.rails'); add('supply.rails', 'warn', c.net + ' is set to ' + fmtV(c.a.v) + ' and ' + fmtV(c.b.v), c.a.from + ' gives ' + fmtV(c.a.v) + '; ' + c.b.from + ' gives ' + fmtV(c.b.v) + '. Two regulators on one net, or a divider that disagrees with the net\'s name.', { nets: [c.net], basis: [].concat(c.a.basis || [], c.b.basis || []) }); }
    for (const [net, s] of NV.V) if (s.from !== 'net name' && s.from !== 'ground' && !/through/.test(s.from)) {
      const named = voltageFromName(net);
      tick('supply.rails');
      if (named != null && Math.abs(named - s.v) > 0.06 * named) add('supply.rails', 'warn', net + ' is ' + fmtV(s.v) + ', not the ' + fmtV(named) + ' its name says', s.from + '.', { nets: [net], basis: s.basis || [], refs: [] });
    }

    for (const [ref, f] of M.files) {
      const p = M.parts.get(ref);
      const doms = domainVoltages(M, NV, ref);
      const val = (k, on) => M.valueOf(f, k, on);
      for (const pin of f.pins) {
        const key = ref + '.' + pin.num;
        const net = M.netOf.get(key);
        const nodes = net ? M.nets.get(net) : [];
        const alone = !net || nodes.length <= 1;
        const nv = net && NV.V.get(net);
        const where = { refs: [ref], pins: [key], nets: net ? [net] : [] };
        const label = ref + ' ' + pin.name + ' (pin ' + pin.num + ')';

        // Supply pins.
        if (pin.role === 'power-in') {
          tick('supply.unpowered');
          // On a rail: the net (or one reached through inductors, ferrite beads, fuses, and 0 Ω links) has
          // another part's power output, a connector, a diode, or an IC with no part file (which may be a
          // regulator). An inductor or capacitor alone doesn't feed a supply pin (Chris, 2026-11-13).
          // The part's own supply output counts once reached through a series part (an isolated converter's output through a
          // bead to its own isolated input), but never its core-regulator capacitor pins (VCAP, VDD11, VDDCORE).
          const CORE = /^(VCAP|VDD11|V11|VDDCORE|VCORE|VDDLDO|VDD_?CORE)/i;
          const sourceOn = (n, depth) => { const fp = M.filePin(n.ref, n.pin); const q = M.parts.get(n.ref); if (!q) return false; if (n.ref === ref && (depth === 0 || !fp || CORE.test(fp.name))) return false; const qf = M.files.get(q.ref); return (fp && fp.role === 'power-out' && !(n.ref === ref && CORE.test(fp.name))) || (n.ref !== ref && (q.kind === 'connector' || (qf && qf.kind === 'connector') || /^(D|PS|BT)\d/i.test(q.ref) || (!M.files.get(q.ref) && (q.kind === 'ic' || q.kind === 'other')))); };
          // A series resistor up to 1 kΩ feeds a supply pin too (a 10 Ω filter on a gauge's BATT, the 1 kΩ to a
          // MAX17335's PCKP): the pin is supplied, though its voltage isn't carried through.
          const passOn = (q, from) => { if (!q || q.pins.length !== 2) return null; const rv = q.kind === 'resistor' ? passiveValue(q, 'Ω') : null; const lowR = !!rv && !rv.dnp && rv.v != null && rv.v <= 1000; if (!(q.kind === 'inductor' || lowR || /^(FB|F)\d/i.test(q.ref))) return null; const e = twoPin(M, q); return e && (e[0] === from ? e[1] : e[0]); };
          let driven = false;
          for (let frontier = net ? [net] : [], seenN = new Set(frontier), d = 0; frontier.length && d < 4 && !driven; d++) {
            const next = [];
            for (const nn of frontier) for (const n of M.nets.get(nn) || []) {
              if (sourceOn(n, d)) { driven = true; break; }
              const other = passOn(M.parts.get(n.ref), nn);
              if (other && !seenN.has(other)) { if (NV.V.has(other) && NV.V.get(other).v > 0) { driven = true; break; } seenN.add(other); next.push(other); }
            }
            frontier = next;
          }
          const backup = /^(VBAT|VBACKUP|VBKP|VBAK|VRTC)/i.test(pin.domain || pin.name);
          if (alone) add('supply.unpowered', 'error', label + ' is not connected' + (backup ? ' (backup supply)' : ''), backup ? 'A backup supply pin left open. Many parts need it tied to the main supply when no battery is fitted; check the datasheet\'s power section.' : 'A supply pin on no net, or alone on its net.', where);
          else if (!nv && !driven) add('supply.unpowered', 'error', label + ' is not on a supply rail', 'Its net ' + net + ' has no known voltage and nothing that supplies one: no regulator output, connector, or rail reached through an inductor, ferrite bead, or series resistor up to 1 kΩ. On it: ' + nodes.filter(n => n.ref !== ref).map(n => n.ref + ' ' + ((M.filePin(n.ref, n.pin) || (M.parts.get(n.ref) || { pins: [] }).pins.find(x => x.num === n.pin) || {}).name || n.pin)).slice(0, 8).join(', ') + '. Check it isn\'t swapped with a neighboring pin.', where);
          if (nv && pin.domain) {
            const range = val('supply.range', pin.domain), absmax = val('supply.absmax', pin.domain), absmin = val('supply.absmin', pin.domain);
            const lim = v => evalExpr(v, doms);
            // A power input gives a range: its maximum against the upper limits, its minimum against the lower.
            const nvHi = nv.vmax != null ? nv.vmax : nv.v, nvLo = nv.vmin != null ? nv.vmin : nv.v;
            if (absmax && lim(absmax.value != null ? absmax.value : absmax.max) != null) {
              tick('supply.absmax');
              const am = lim(absmax.value != null ? absmax.value : absmax.max);
              if (nvHi > am) add('supply.absmax', 'error', label + ' at ' + fmtV(nvHi) + ' is above its ' + fmtV(am) + ' absolute maximum', pin.domain + ' on net ' + net + ' (' + nv.from + '). The absolute maximum is ' + fmtV(am) + '.', Object.assign({ basis: [basisOf(f, absmax)].concat(nv.basis || []) }, where));
            } else skip('supply.absmax');
            if (absmin) { const am = lim(absmin.value != null ? absmin.value : absmin.min); if (am != null && nvLo < am) add('supply.absmax', 'error', label + ' at ' + fmtV(nvLo) + ' is below its ' + fmtV(am) + ' absolute minimum', 'Net ' + net + ' (' + nv.from + ').', Object.assign({ basis: [basisOf(f, absmin)] }, where)); }
            // A range for when a feature is used ("USB used") applies only when the feature is wired: a pin offering it
            // sits on a net named for it, or meets another part's pin named for it (PA11 as SPI1_MISO isn't USB).
            const feat = range && /\b([A-Z][A-Z0-9]{1,8})\s+(?:is\s+)?used\b/.exec(range.cond || '');
            const featUnused = feat && !f.pins.some(x => (x.functions || []).some(fn => fn.toUpperCase().includes(feat[1])) && (() => {
              const nn = M.netOf.get(ref + '.' + x.num); if (!nn) return false;
              if (nn.toUpperCase().includes(feat[1])) return true;
              return (M.nets.get(nn) || []).some(o => o.ref !== ref && String((M.filePin(o.ref, o.pin) || {}).name || '').toUpperCase().includes(feat[1]));
            })());
            if (featUnused) skip('supply.range');
            else if (range && (range.min != null || range.max != null)) {
              tick('supply.range');
              const lo = lim(range.min), hi = lim(range.max);
              const low = lo != null && nvLo < lo - 1e-6, high = hi != null && nvHi > hi + 1e-6;
              if (low || high) add('supply.range', 'error', label + ' at ' + fmtV(high ? nvHi : nvLo) + ' is outside ' + (lo != null ? fmtV(lo) : '…') + ' to ' + (hi != null ? fmtV(hi) : '…'), pin.domain + '\'s recommended range' + (range.cond ? ' (' + range.cond + ')' : '') + '; net ' + net + ' is ' + (nvLo !== nvHi ? fmtV(nvLo).replace(' V', '') + ' to ' + fmtV(nvHi) : fmtV(nv.v)) + ' (' + nv.from + ').' + (range.note ? ' Note: ' + range.note : ''), Object.assign({ basis: [basisOf(f, range)].concat(nv.basis || []) }, where));
            } else skip('supply.range');
          } else if (pin.domain) skip('supply.range');
        }
        if (pin.role === 'ground' || pin.role === 'pad') {
          tick('supply.ground');
          if (alone && pin.role === 'ground') add('supply.ground', 'error', label + ' is not connected', 'A ground pin on no net.', where);
          else if (alone && pin.role === 'pad') add('supply.ground', 'warn', label + ', the exposed pad, is not connected', 'Most parts need the pad soldered to ground (or the net the datasheet names) for heat and grounding.', where);
          else if (net && pin.role === 'ground' && !NV.ground.has(net)) add('supply.ground', 'error', label + ' is on ' + net + ', not ground', 'A ground pin on a net that isn\'t ground' + (nv ? ' (' + fmtV(nv.v) + ')' : '') + '.', where);
        }

        if (pin.role === 'switch' && net) {
          tick('supply.switchnode');
          const others = nodes.filter(n => n.ref !== ref);
          const supplies = others.filter(n => { const fp = M.filePin(n.ref, n.pin); return fp && fp.role === 'power-in'; });
          if (NV.ground.has(net) || (nv && nv.v > 0) || supplies.length >= 2) add('supply.switchnode', 'error', label + ', a switch node, is on ' + (NV.ground.has(net) ? 'ground' : 'the rail ' + net), 'A switching regulator\'s switch pin drives an inductor; it must not be tied to ' + (NV.ground.has(net) ? 'ground' : 'a supply rail' + (nv ? ' (' + fmtV(nv.v) + ', ' + nv.from + ')' : '') + (supplies.length ? ', which feeds ' + [...new Set(supplies.map(n => n.ref))].slice(0, 5).join(', ') : '')) + '. Check it isn\'t swapped with the supply input pin.', where);
        }

        // Pins.
        if (pin.role === 'dnc') { tick('pins.dnc'); if (!alone) add('pins.dnc', 'error', label + ' is do-not-connect but is on ' + net, 'The datasheet says to leave this pin open.', where); }
        if (pin.unused === 'must' || pin.unused === 'gnd' || pin.unused === 'supply') {
          tick('pins.unused');
          if (alone) add('pins.unused', 'error', label + ' is left open', 'The part file says ' + ({ must: 'it must be driven or tied', gnd: 'to tie it to ground when unused', supply: 'to tie it to its supply when unused' })[pin.unused] + '.', where);
        }
        if (['reset', 'boot', 'enable'].includes(pin.role)) {
          tick('pins.float');
          // An internal pull the part file states makes an open pin fine: the pin's reset state, reset.pull, or en.default.
          const pulled = /pull/i.test(pin.reset || '') || (pin.role === 'reset' && val('reset.pull')) || (pin.role === 'enable' && /pull/i.test((val('en.default') || {}).text || ''));
          if (alone && pin.unused !== 'float' && !pulled) add('pins.float', pin.unused === 'must' ? 'error' : 'info', label + ' is floating', 'A ' + P.ROLES[pin.role].toLowerCase() + ' pin on no net, and the part file names no internal pull. Check what level it settles to.', where);
        }

        // I/O levels.
        if (net && !['power-in', 'power-out', 'ground', 'pad', 'bus', 'nc', 'dnc', 'switch', 'bootstrap', 'feedback'].includes(pin.role)) {
          const highs = highLevels(M, NV, net).filter(h => !(h.ref === ref && h.pin === pin.num));
          const top = highs.length ? highs.reduce((a, b) => (b.v > a.v ? b : a)) : null;
          const own = pin.absmax != null ? { v: evalExpr(pin.absmax, doms), basis: null, src: 'this pin\'s absolute maximum' } : null;
          const dom = pin.domain;
          const ioAbs = dom && val('io.absmax', dom), ftAbs = pin.ft && val('io.ft.absmax');
          const limit = own && own.v != null ? own : ftAbs ? { v: evalExpr(ftAbs.value != null ? ftAbs.value : ftAbs.max, doms), b: ftAbs, src: '5 V tolerant pins\' absolute maximum' } : ioAbs ? { v: evalExpr(ioAbs.value != null ? ioAbs.value : ioAbs.max, doms), b: ioAbs, src: dom + ' I/O absolute maximum' } : null;
          if (top && limit && limit.v != null) {
            tick('io.absmax');
            if (top.v > limit.v + 1e-6) add('io.absmax', 'error', label + ' sees ' + fmtV(top.v) + ', above its ' + fmtV(limit.v) + ' maximum', 'Net ' + net + ' is pulled or driven to ' + fmtV(top.v) + ' by ' + top.by + '. The limit is the ' + limit.src + (pin.ft ? '' : dom ? ' (the pin isn\'t marked 5 V tolerant)' : '') + '.', Object.assign({ basis: limit.b ? [basisOf(f, limit.b)] : [], refs: [ref, top.ref].filter((x, i, a) => x && a.indexOf(x) === i) }, { pins: [key].concat(top.pin ? [top.ref + '.' + top.pin] : []), nets: [net] }));
          } else if (top) skip('io.absmax');
          if (top && pin.vmax != null) {
            tick('io.recommended');
            const vm = evalExpr(pin.vmax, doms);
            if (vm != null && top.v > vm + 1e-6) add('io.recommended', 'error', label + ' sees ' + fmtV(top.v) + ', above its recommended ' + fmtV(vm), 'Net ' + net + ' is pulled or driven to ' + fmtV(top.v) + ' by ' + top.by + '.' + (pin.note ? ' ' + pin.note : ''), Object.assign({ basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' vmax', on: '', page: null, verified: false }] }, { refs: [ref], pins: [key], nets: [net] }));
          }
          // Inputs: does the driver's high level reach VIH?
          if (['input', 'io', 'reset', 'enable', 'boot'].includes(pin.role) && dom) {
            const vih = val('io.vih', dom);
            // A driver whose own supply is at 0 V is already reported under Supply.
            // Push-pull drivers set the high level whatever pulls the net (a pull-up only lifts an open drain).
            const drivers = highs.filter(h => h.kind !== 'pull-up' && h.v > 0.3);
            const pulled = highs.some(h => h.kind === 'pull-up');
            if (vih && drivers.length) {
              const need = evalExpr(vih.value != null ? vih.value : vih.min != null ? vih.min : vih.max, doms);
              if (need != null) {
                tick('io.vih');
                // The driver's guaranteed high (its io.voh) when its file gives one, else its supply.
                // A fixed VOH (no supply in it) holds for one test supply, which may not be this board's; between parts on one rail,
                // where same-supply logic is made to talk, only a VOH that scales with the supply is used.
                const myRail = domainNet(M, ref, dom);
                const lvl = h => (h.voh != null && (h.vohExpr || h.rail !== myRail) ? h.voh : h.v);
                const low = drivers.reduce((a, b) => (lvl(b) < lvl(a) ? b : a));
                const vihTxt = (typeof (vih.value != null ? vih.value : vih.min) === 'string' ? (vih.value != null ? vih.value : vih.min).replace(/\*/g, ' × ') + ' at ' + fmtV(doms[dom]) : 'VIH') + ' on ' + dom;
                const nets = [net].concat(low.net && low.net !== net ? [low.net] : []);
                if (lvl(low) < need - 1e-6) add('io.vih', 'error', label + ' needs ' + fmtV(need) + ' to read high; ' + low.by + ' drives ' + (low.voh != null ? 'at least ' : '') + fmtV(lvl(low)), 'This input reads high above ' + fmtV(need) + ' (' + vihTxt + '). The driver ' + (low.voh != null ? 'guarantees ' + fmtV(low.voh) + ' high (its VOH on ' + low.domain + ' at ' + fmtV(low.v) + ')' : 'is on a ' + fmtV(low.v) + ' supply') + '. A level shifter, or the receiver\'s logic supply on the driver\'s rail, is needed.' + (pulled ? ' A pull-up on the net doesn\'t help while the push-pull driver holds it.' : ''), { refs: [ref, low.ref], pins: [key, low.ref + '.' + low.pin], nets, basis: [basisOf(f, vih)].concat(low.vohBasis ? [low.vohBasis] : []) });
                else if (lvl(low) < need + 0.1 * (doms[dom] || 1)) add('io.vih', 'warn', label + ' reads ' + low.by + '\'s high with little margin', 'Needs ' + fmtV(need) + ' (' + vihTxt + '); the driver gives ' + fmtV(lvl(low)) + ', within 10% of the receiver\'s supply. Noise or a sagging rail can make it read low.', { refs: [ref, low.ref], pins: [key, low.ref + '.' + low.pin], nets, basis: [basisOf(f, vih)].concat(low.vohBasis ? [low.vohBasis] : []) });
              }
            }
            // Inputs: does each driver's low (its io.vol) stay under this input's VIL?
            const vil = val('io.vil', dom);
            const vilMax = vil ? evalExpr(vil.value != null ? vil.value : vil.max != null ? vil.max : vil.min, doms) : null;
            if (vilMax != null) for (const h of drivers) {
              const df = h.ref && M.files.get(h.ref), vol = df && M.valueOf(df, 'io.vol', h.domain);
              const volE = vol && (vol.value != null ? vol.value : vol.max);
              const v = vol ? evalExpr(volE, domainVoltages(M, NV, h.ref)) : null;
              if (v == null || (typeof volE !== 'string' && h.rail === domainNet(M, ref, dom))) continue;
              tick('io.vil');
              if (v > vilMax + 1e-6) add('io.vil', 'error', label + ' needs under ' + fmtV(vilMax) + ' to read low; ' + h.by + ' may give ' + fmtV(v), 'The driver\'s VOL on ' + h.domain + ' is up to ' + fmtV(v) + '; this input reads low only below ' + fmtV(vilMax) + ' (VIL on ' + dom + ').', { refs: [ref, h.ref], pins: [key, h.ref + '.' + h.pin], nets: [net].concat(h.net && h.net !== net ? [h.net] : []), basis: [basisOf(f, vil), basisOf(df, vol)], key: key + ' vil ' + h.ref + '.' + h.pin });
            }
            // Unpowered (Chris, 2026-11-13): a driver on a rail that can be up while this part's isn't. Its limit is then
            // io.absmax.off, or the pin's usual maximum with this part's supplies at 0 V (an STM32 FT pin's VDD + 4.0 V is
            // 4.0 V); a fail-safe input (io.failsafe naming the pin, or all) is fine.
            const others = drivers.filter(h => h.ref !== ref && h.domain);
            const fs = val('io.failsafe');
            const failsafe = fs && new RegExp('\\b(all|every|' + String(pin.name).replace(/[^\w]/g, '') + ')\\b', 'i').test((fs.text || '') + ' ' + (fs.list || []).join(' '));
            if (others.length && !failsafe) {
              const myNet = domainNet(M, ref, dom);
              const off = Object.fromEntries(Object.keys(doms).map(k => [k, 0]));
              const offAbs = val('io.absmax.off', dom);
              const pick = (b, src) => { const e = b.value != null ? b.value : b.max; return { v: evalExpr(e, off), b, src: src + (typeof e === 'string' ? ' (' + e + ' with its supplies off)' : '') }; };
              const lim = offAbs ? pick(offAbs, 'its absolute maximum while unpowered') : pin.ft && ftAbs ? pick(ftAbs, 'the 5 V tolerant pins\' absolute maximum') : ioAbs ? pick(ioAbs, 'its ' + dom + ' I/O absolute maximum') : null;
              if (lim && lim.v != null) {
                for (const h of others.slice().sort((a, b) => b.v - a.v)) {
                  const dn = domainNet(M, h.ref, h.domain);
                  if (!myNet || !dn || dn === myNet) continue;
                  const ind = independent(M, NV, myNet, dn);
                  if (ind.v === 'no') continue;
                  tick('io.unpowered');
                  if (h.v <= lim.v + 1e-6) continue;
                  const src = r => (r && r.root ? 'from ' + r.root + (r.refs.length > 1 ? ' through ' + r.refs.slice(0, -1).join(', ') : '') : 'source not found');
                  add('io.unpowered', ind.v === 'yes' ? 'error' : 'warn', label + ' sees ' + fmtV(h.v) + ' from ' + h.ref + ' while ' + ref + ' can be unpowered (limit ' + fmtV(lim.v) + ')',
                    h.by + ' drives up to ' + fmtV(h.v) + ' from ' + dn + ' (' + src(ind.rb) + '); ' + ref + ' ' + dom + ' is on ' + myNet + ' (' + src(ind.ra) + '). ' +
                    (ind.v === 'yes' ? 'The two rails can be up one without the other' : 'Pincheck couldn\'t tell whether the two rails come up together') + ', and with ' + ref + ' off the limit is ' + lim.src + ': ' + fmtV(lim.v) + '. The pin conducts into the unpowered part (back-powering it). Run the driver\'s logic supply from ' + myNet + ', or use a fail-safe input.',
                    { refs: [ref, h.ref], pins: [key, h.ref + '.' + h.pin], nets: [net].concat(h.net && h.net !== net ? [h.net] : [], [myNet, dn]), basis: [basisOf(f, lim.b)], key: key + ' off' });
                  break;
                }
              } else skip('io.unpowered');
            }
          }
        }
      }

      // Domains that must share a rail.
      const tied = val('supply.tied');
      if (tied && tied.list) {
        for (const line of tied.list) {
          // "VDDUSB to VDD (or VSS) when USB is unused": an alternative after "or" is a choice, not a third rail.
          const main = line.replace(/\(\s*or\b[^)]*\)/gi, ' ').replace(/\bor\b.*$/i, ' ');
          const ds = (main.match(/[A-Z][A-Z0-9_+]+/g) || []).filter((d, i, a) => doms[d] != null && a.indexOf(d) === i);
          if (ds.length < 2) continue;
          tick('supply.tied');
          const vs = ds.map(d => doms[d]);
          if (Math.max(...vs) - Math.min(...vs) > 0.05) add('supply.tied', 'warn', ref + ' ' + ds.join(' and ') + ' are on different rails', ds.map(d => d + ' ' + fmtV(doms[d])).join(', ') + '. The part file says: ' + line + '.', { refs: [ref], basis: [basisOf(f, tied)] });
        }
      }

      // Decoupling per domain, and capacitors pins require.
      // Capacitors to ground on a net, and on nets joined to it by 0 Ω links (a 1 Ω or smaller resistor is the
      // same node: C1 at a regulator's output still decouples the rail past R3 0 Ω).
      const capsOn = net => {
        const group = [net], via = { [net]: null };
        for (let i = 0; i < group.length && group.length < 12; i++) for (const n of M.nets.get(group[i]) || []) {
          const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor') continue;
          const rv = passiveValue(q, 'Ω'); if (!rv || rv.dnp || rv.v == null || rv.v > 1) continue;
          const e = twoPin(M, q); if (!e) continue;
          const o = e[0] === group[i] ? e[1] : e[0];
          if (o && !(o in via) && !NV.ground.has(o)) { via[o] = q.ref; group.push(o); }
        }
        const out = [];
        for (const g of group) for (const n of M.nets.get(g) || []) {
          const q = M.parts.get(n.ref);
          if (!q || q.kind !== 'capacitor' || out.some(c => c.ref === q.ref)) continue;
          const e = twoPin(M, q); if (!e || !(NV.ground.has(e[0]) || NV.ground.has(e[1]))) continue;
          out.push({ ref: q.ref + (via[g] ? ' (past ' + via[g] + ')' : ''), id: q.ref, v: (passiveValue(q, 'F') || {}).v });
        }
        return out;
      };
      for (const dom of f.domains || []) {
        const dc = val('dec.c', dom), bulk = val('dec.bulk', dom);
        const pins = f.pins.filter(x => x.role === 'power-in' && x.domain === dom);
        const netsD = [...new Set(pins.map(x => M.netOf.get(ref + '.' + x.num)).filter(Boolean))];
        if (!netsD.length || (!dc && !bulk)) { if (pins.length) skip('parts.decoupling'); continue; }
        tick('parts.decoupling');
        const caps = [].concat(...netsD.map(capsOn)).filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
        const need = dc && (dc.value != null ? dc.value : dc.min);
        if (need) {
          const near = caps.filter(c => c.v != null && c.v >= need * 0.5);
          if (near.length < pins.length) add('parts.decoupling', 'warn', ref + ' ' + dom + ': ' + near.length + ' decoupling capacitor' + (near.length === 1 ? '' : 's') + ' for ' + pins.length + ' supply pin' + (pins.length === 1 ? '' : 's'), 'The part file asks for ' + P.fmt(need, 'F') + ' at each ' + dom + ' pin. On ' + netsD.join(', ') + ': ' + (caps.length ? caps.map(c => c.ref + ' ' + (c.v != null ? P.fmt(c.v, 'F') : '?')).join(', ') : 'none') + '. Capacitors anywhere on the net, or past a 0 Ω link, count, so check they sit at the pins.', { refs: [ref].concat(caps.map(c => c.id)).slice(0, 30), nets: netsD, basis: [basisOf(f, dc)] });
        }
        const b = bulk && (bulk.value != null ? bulk.value : bulk.min);
        if (b) {
          const total = caps.reduce((s, c) => s + (c.v || 0), 0);
          if (total < b * 0.9) add('parts.decoupling', 'warn', ref + ' ' + dom + ' has ' + P.fmt(total, 'F') + ' on its rail, less than ' + P.fmt(b, 'F') + ' bulk', 'Every capacitor to ground on ' + netsD.join(', ') + ' counted.', { refs: [ref], nets: netsD, basis: [basisOf(f, bulk)] });
        }
      }
      for (const pin of f.pins) {
        if (!pin.ext) continue;
        const ext = pin.ext.replace(/(\d)([pnuµ])(\d)/g, '$1.$3$2');
        const net = M.netOf.get(ref + '.' + pin.num);
        const SCALE = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, '': 1 };
        // Every inductance the note names: "1 µH or 2.2 µH (effective 0.7 µH to 4.3 µH)" allows any of them, and
        // anything between the smallest and the largest.
        const hs = [...ext.matchAll(/(\d+(?:\.\d+)?)\s*([pnuµm]?)H\b/g)].map(x => parseFloat(x[1]) * SCALE[x[2]]);
        if (hs.length && net && !(pin.role === 'switch' && (NV.V.has(net) || NV.ground.has(net)))) {
          tick('parts.ext');
          const wantL = hs[0], loL = Math.min(...hs), hiL = Math.max(...hs);
          const okL = v => (v >= loL * 0.999 && v <= hiL * 1.001) || hs.some(h => Math.abs(v - h) <= 0.2 * h);
          const inds = (M.nets.get(net) || []).map(n => M.parts.get(n.ref)).filter(q => q && q.kind === 'inductor').map(q => ({ ref: q.ref, v: (passiveValue(q, 'H') || {}).v }));
          if (!inds.length) add('parts.ext', 'error', ref + ' ' + pin.name + ' needs a ' + P.fmt(wantL, 'H') + ' inductor; none is on ' + net, 'The part file says: ' + pin.ext + '. Nothing on ' + net + ' is an inductor' + (pin.role === 'switch' ? ', so this switch pin drives nothing (check it isn\'t swapped with the supply input)' : '') + '.', { refs: [ref], pins: [ref + '.' + pin.num], nets: [net], basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' ext', on: '', page: null, verified: false }] });
          else if (inds.every(x => x.v != null && !okL(x.v))) add('parts.ext', 'warn', ref + ' ' + pin.name + ' wants ' + (hs.length > 1 && loL !== hiL ? P.fmt(loL, 'H') + ' to ' + P.fmt(hiL, 'H') : P.fmt(wantL, 'H')) + '; ' + inds.map(x => x.ref + ' is ' + P.fmt(x.v, 'H')).join(', '), 'The part file says: ' + pin.ext + '.', { refs: [ref].concat(inds.map(x => x.ref)), pins: [ref + '.' + pin.num], nets: [net], basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' ext', on: '', page: null, verified: false }] });
        }
        // Capacitances in the note. One after ≤, <, "at most", "up to", or "max" is a limit on what the pin may
        // see ("≤ 10 pF on the pin"), not a part to fit. An optional part isn't required.
        const fs_ = [...ext.matchAll(/(≤|<|=<|at most|up to|max(?:imum)?\.?|less than|below)?\s*(\d+(?:\.\d+)?)\s*([pnuµm]?)F\b/gi)]
          .map(x => ({ v: parseFloat(x[2]) * SCALE[x[3].toLowerCase()], max: !!x[1] }));
        if (!fs_.length || !net) continue;
        const capMax = fs_.find(x => x.max), capNeed = /\boptional\b/i.test(ext) ? null : fs_.find(x => !x.max);
        // "between CP and BATT": a capacitor from this pin to another pin of the part, not to ground.
        const btw = /between\s+(\w+)\s+and\s+(\w+)/i.exec(ext);
        const otherName = btw && [btw[1], btw[2]].find(x => x.toUpperCase() !== String(pin.name).toUpperCase() && !/^(GND|VSS|ground|AGND|PGND)$/i.test(x));
        tick('parts.ext');
        if (otherName && capNeed) {
          const op = f.pins.find(x => String(x.name).toUpperCase() === otherName.toUpperCase());
          const oNet = op && M.netOf.get(ref + '.' + op.num);
          if (!oNet) continue;
          const across = (M.nets.get(net) || []).map(n => M.parts.get(n.ref)).filter(q => q && q.kind === 'capacitor').filter(q => { const e = twoPin(M, q); return e && e.includes(oNet); }).map(q => ({ ref: q.ref, v: (passiveValue(q, 'F') || {}).v }));
          const tot = across.reduce((s, c) => s + (c.v || 0), 0);
          if (tot < capNeed.v * 0.8) add('parts.ext', 'warn', ref + ' ' + pin.name + ' needs ' + P.fmt(capNeed.v, 'F') + ' to ' + op.name + '; ' + (across.length ? 'it has ' + P.fmt(tot, 'F') : 'there is none'), 'The part file says: ' + pin.ext + '. Capacitors between ' + net + ' and ' + oNet + ': ' + (across.length ? across.map(c => c.ref + ' ' + (c.v != null ? P.fmt(c.v, 'F') : '?')).join(', ') : 'none') + '.', { refs: [ref].concat(across.map(c => c.ref)), pins: [ref + '.' + pin.num, ref + '.' + op.num], nets: [net, oNet], basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' ext', on: '', page: null, verified: false }] });
          continue;
        }
        const caps = capsOn(net);
        const total = caps.reduce((s, c) => s + (c.v || 0), 0);
        if (capMax && total > capMax.v * 1.001) add('parts.ext', 'warn', ref + ' ' + pin.name + ' may see at most ' + P.fmt(capMax.v, 'F') + '; its net has ' + P.fmt(total, 'F'), 'The part file says: ' + pin.ext + '. Capacitors to ground on ' + net + ': ' + caps.map(c => c.ref + ' ' + (c.v != null ? P.fmt(c.v, 'F') : '?')).join(', ') + '.', { refs: [ref].concat(caps.map(c => c.id)), pins: [ref + '.' + pin.num], nets: [net], basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' ext', on: '', page: null, verified: false }] });
        if (!capNeed) continue;
        const want = capNeed.v;
        const toGnd = /to\s+(GND|ground|VSS)/i.test(pin.ext) || !/\bto\b/i.test(pin.ext);
        if (toGnd && total < want * 0.8) add('parts.ext', 'warn', ref + ' ' + pin.name + ' needs ' + P.fmt(want, 'F') + '; its net has ' + P.fmt(total, 'F'), 'The part file says: ' + pin.ext + '. Capacitors to ground on ' + net + ': ' + (caps.length ? caps.map(c => c.ref + ' ' + (c.v != null ? P.fmt(c.v, 'F') : '?')).join(', ') : 'none') + '.', { refs: [ref].concat(caps.map(c => c.id)), pins: [ref + '.' + pin.num], nets: [net], basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' ext', on: '', page: null, verified: false }] });
      }

      // Regulators: capacitors and inductor.
      if (f.kind === 'regulator') {
        const outNets = f.pins.filter(x => x.role === 'power-out').map(x => M.netOf.get(ref + '.' + x.num)).filter(Boolean);
        const inNets = f.pins.filter(x => x.role === 'power-in').map(x => M.netOf.get(ref + '.' + x.num)).filter(Boolean);
        const sw = f.pins.filter(x => x.role === 'switch').map(x => M.netOf.get(ref + '.' + x.num)).filter(Boolean);
        let outTarget = outNets.slice();
        // A buck's output is past its inductor.
        const inds = [];
        for (const n of sw) for (const node of M.nets.get(n) || []) { const q = M.parts.get(node.ref); if (q && q.kind === 'inductor') { const e = twoPin(M, q); if (e) { inds.push(q); outTarget.push(e[0] === n ? e[1] : e[0]); } } }
        outTarget = [...new Set(outTarget.filter(Boolean))];
        const sumCaps = nets => [].concat(...nets.map(capsOn)).filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
        const cout = val('reg.cout'), cin = val('reg.cin'), lr = val('reg.l'), cb = val('reg.cboot');
        if (cout && outTarget.length) {
          tick('parts.regulator');
          const caps = sumCaps(outTarget), total = caps.reduce((s, c) => s + (c.v || 0), 0);
          if (cout.min != null && total < cout.min * 0.999) add('parts.regulator', 'warn', ref + ' output has ' + P.fmt(total, 'F') + ', below the ' + P.fmt(cout.min, 'F') + ' minimum', 'Nominal values on ' + outTarget.join(', ') + ' (' + (caps.map(c => c.ref).join(', ') || 'none') + '); a ceramic capacitor loses much of its value under DC bias, so the real figure is lower.' + (cout.cond ? ' Condition: ' + cout.cond + '.' : ''), { refs: [ref].concat(caps.map(c => c.id)), nets: outTarget, basis: [basisOf(f, cout)] });
          if (cout.max != null && total > cout.max * 1.001) add('parts.regulator', 'warn', ref + ' output has ' + P.fmt(total, 'F') + ', above the ' + P.fmt(cout.max, 'F') + ' maximum', 'On ' + outTarget.join(', ') + '. Too much output capacitance can upset the loop or the start-up.', { refs: [ref], nets: outTarget, basis: [basisOf(f, cout)] });
        } else if (outTarget.length) skip('parts.regulator');
        if (cin && inNets.length && (cin.value != null || cin.min != null)) {
          tick('parts.regulator');
          const need = cin.value != null ? cin.value : cin.min;
          const caps = sumCaps(inNets), total = caps.reduce((s, c) => s + (c.v || 0), 0);
          if (total < need * 0.999) add('parts.regulator', 'warn', ref + ' input has ' + P.fmt(total, 'F') + ', below ' + P.fmt(need, 'F'), 'On ' + inNets.join(', ') + '. Every capacitor to ground on the net counts; check one sits at the pin.', { refs: [ref], nets: inNets, basis: [basisOf(f, cin)] });
        }
        if (lr && inds.length) for (const q of inds) {
          const lv = (passiveValue(q, 'H') || {}).v;
          if (lv == null) continue;
          tick('parts.regulator');
          if ((lr.min != null && lv < lr.min * 0.999) || (lr.max != null && lv > lr.max * 1.001)) add('parts.regulator', 'warn', q.ref + ' ' + P.fmt(lv, 'H') + ' is outside ' + ref + '\'s ' + (lr.min != null ? P.fmt(lr.min, 'H') : '…') + ' to ' + (lr.max != null ? P.fmt(lr.max, 'H') : '…'), (lr.cond ? 'For ' + lr.cond + '. ' : '') + 'Also check the inductor\'s saturation current against the switch current limit.', { refs: [ref, q.ref], basis: [basisOf(f, lr)] });
        }
        if (cb && (cb.value != null || cb.min != null)) {
          const bp = f.pins.find(x => x.role === 'bootstrap');
          const bn = bp && M.netOf.get(ref + '.' + bp.num);
          if (bn && sw.length) {
            tick('parts.regulator');
            const caps = (M.nets.get(bn) || []).map(n => M.parts.get(n.ref)).filter(q => q && q.kind === 'capacitor').filter(q => { const e = twoPin(M, q); return e && sw.includes(e[0] === bn ? e[1] : e[0]); });
            if (!caps.length) add('parts.regulator', 'warn', ref + ' has no bootstrap capacitor from ' + bp.name + ' to its switch node', 'The part file asks for ' + P.fmt(cb.value != null ? cb.value : cb.min, 'F') + '.', { refs: [ref], pins: [ref + '.' + bp.num], nets: [bn], basis: [basisOf(f, cb)] });
          }
        }
      }
    }

    // Two push-pull outputs of different parts on one net fight when they disagree.
    for (const [net, nodes] of M.nets) {
      if (NV.ground.has(net) || NV.V.has(net)) continue;
      const outs = nodes.filter(n => { const fp = M.filePin(n.ref, n.pin); return fp && fp.role === 'output'; });
      if (outs.length < 2) continue;
      tick('io.contention');
      const parts = [...new Set(outs.map(n => n.ref))];
      if (parts.length < 2) continue;
      add('io.contention', 'warn', parts.length + ' outputs drive ' + net, outs.map(n => n.ref + ' ' + M.filePin(n.ref, n.pin).name).join(', ') + ' are push-pull outputs on one net. If they can disagree they short each other; if one is a fitted-or-not alternative, mark the other DNP.', { refs: parts, pins: outs.map(n => n.ref + '.' + n.pin), nets: [net] });
    }

    // Crystals: load capacitors.
    for (const [ref, f] of M.files) {
      if (f.kind !== 'crystal') continue;
      const cl = M.valueOf(f, 'xtal.cl'); if (!cl) { skip('parts.crystal'); continue; }
      const want = cl.value != null ? cl.value : cl.typ;
      const p = M.parts.get(ref);
      const sig = p.pins.map(x => M.netOf.get(ref + '.' + x.num)).filter(n => n && !NV.ground.has(n));
      const nets = [...new Set(sig)];
      if (nets.length !== 2) continue;
      tick('parts.crystal');
      const cs = nets.map(n => (M.nets.get(n) || []).map(x => M.parts.get(x.ref)).filter(q => q && q.kind === 'capacitor' && (twoPin(M, q) || []).some(e => NV.ground.has(e))).map(q => ({ ref: q.ref, v: (passiveValue(q, 'F') || {}).v }))[0]);
      if (cs.some(c => !c || c.v == null)) { add('parts.crystal', 'warn', ref + ' is missing a load capacitor', 'Each crystal pin needs a capacitor to ground; found: ' + cs.map((c, i) => nets[i] + ' ' + (c ? c.ref : 'none')).join(', ') + '.', { refs: [ref], nets, basis: [basisOf(f, cl)] }); continue; }
      const stray = 4e-12;
      const eff = cs[0].v * cs[1].v / (cs[0].v + cs[1].v) + stray;
      if (Math.abs(eff - want) > 0.2 * want) add('parts.crystal', 'warn', ref + ' sees about ' + P.fmt(eff, 'F') + ' of load; it wants ' + P.fmt(want, 'F'), cs[0].ref + ' ' + P.fmt(cs[0].v, 'F') + ' and ' + cs[1].ref + ' ' + P.fmt(cs[1].v, 'F') + ' in series, plus about 4 pF of pin and board stray. The frequency will be off; for CL = ' + P.fmt(want, 'F') + ', each capacitor ≈ ' + P.fmt(2 * (want - stray), 'F') + '.', { refs: [ref, cs[0].ref, cs[1].ref], nets, basis: [basisOf(f, cl)] });
    }

    // Pin functions: interface nets on MCU pins.
    const FUNC = [
      [/(^|_)SDA\d?($|_)/i, /I2C\d*_SDA|FMPI2C\d*_SDA/i, 'I2C SDA'], [/(^|_)SCL\d?($|_)/i, /I2C\d*_SCL|FMPI2C\d*_SCL/i, 'I2C SCL'],
      [/(^|_)(SCK|SCLK|SPI\d?_CLK)($|_)/i, /SPI\d*_SCK/i, 'SPI clock'], [/(^|_)(MOSI|SDI)($|_)/i, /SPI\d*_MOSI/i, 'SPI MOSI'], [/(^|_)(MISO|SDO)($|_)/i, /SPI\d*_MISO/i, 'SPI MISO'],
      [/(^|_)(TXD?|UART\d?_TX|USART\d?_TX)($|_|\d)/i, /U?S?ART\d*_(TX|RX)|LPUART\d*_(TX|RX)/i, 'UART TX'], [/(^|_)(RXD?|UART\d?_RX|USART\d?_RX)($|_|\d)/i, /U?S?ART\d*_(RX|TX)|LPUART\d*_(RX|TX)/i, 'UART RX'],
      [/(^|_)CAN\d?_?TX($|_)/i, /F?DCAN\d*_TX|CAN\d*_TX/i, 'CAN TX'], [/(^|_)CAN\d?_?RX($|_)/i, /F?DCAN\d*_RX|CAN\d*_RX/i, 'CAN RX'],
      [/SWDIO/i, /SWDIO/i, 'SWDIO'], [/SWCLK/i, /SWCLK/i, 'SWCLK'],
    ];
    const i2cBus = new Map(); // net → peripheral per MCU
    const exti = new Map();   // ref → line → [nets]
    for (const [ref, f] of M.files) {
      if (f.kind !== 'mcu') continue;
      for (const pin of f.pins) {
        const net = M.netOf.get(ref + '.' + pin.num);
        if (!net || isAuto(net) || !pin.functions || !pin.functions.length) continue;
        const fns = pin.functions.join(' ');
        for (const [netRe, fnRe, label] of FUNC) {
          if (!netRe.test(net)) continue;
          tick('func.af');
          if (!fnRe.test(fns)) add('func.af', 'warn', ref + ' ' + pin.name + ' is on ' + net + ' but has no ' + label + ' function', 'Its functions: ' + pin.functions.slice(0, 10).join(', ') + (pin.functions.length > 10 ? ', …' : '') + '.', { refs: [ref], pins: [ref + '.' + pin.num], nets: [net], basis: [{ file: f.id, mpn: f.mpn, k: 'pin ' + pin.num + ' functions', on: '', page: null, verified: false }] });
          if (/I2C/.test(label)) { const m = new RegExp('(FMP)?I2C(\\d*)_' + (label.endsWith('SDA') ? 'SDA' : 'SCL'), 'i').exec(fns); if (m) i2cBus.set(ref + '|' + label.slice(-3) + '|' + net, { ref, pin, net, per: (m[1] || '') + 'I2C' + m[2] }); }
          if (label === 'UART TX' || label === 'UART RX') {
            tick('func.uart');
            const mine = /U?S?ART\d*_TX/i.test(fns) && !/U?S?ART\d*_RX/i.test(fns) ? 'TX' : /U?S?ART\d*_RX/i.test(fns) && !/U?S?ART\d*_TX/i.test(fns) ? 'RX' : null;
            for (const node of M.nets.get(net) || []) {
              if (node.ref === ref) continue;
              const op = M.filePin(node.ref, node.pin) || (M.parts.get(node.ref) || { pins: [] }).pins.find(x => x.num === node.pin);
              if (!op) continue;
              const other = /^(TXD?\d?|UTXD|TX_OUT)$/i.test(op.name) ? 'TX' : /^(RXD?\d?|URXD|RX_IN)$/i.test(op.name) ? 'RX' : null;
              if (mine && other && mine === other) add('func.uart', 'warn', ref + ' ' + pin.name + ' (' + mine + ') meets ' + node.ref + ' ' + op.name + ' (' + other + ') on ' + net, 'TX goes to RX. Two transmitters, or two receivers, on one line.', { refs: [ref, node.ref], pins: [ref + '.' + pin.num, node.ref + '.' + node.pin], nets: [net] });
            }
          }
        }
        // EXTI lines of interrupt-like nets.
        if (/(^|_)N?(INT|IRQ|ALERT|ALRT|DRDY|RDY|FAULT|FLT|WAKE|BUTTON|BTN)($|_|\d)/i.test(net)) {
          const m = /EXTI(\d+)/.exec(fns);
          if (m) { const k = ref; if (!exti.has(k)) exti.set(k, new Map()); const lines = exti.get(k); if (!lines.has(m[1])) lines.set(m[1], []); lines.get(m[1]).push({ net, pin }); }
        }
      }
    }
    // I2C: SDA and SCL of one bus on one peripheral.
    const byRefBus = new Map();
    for (const v of i2cBus.values()) { const k = v.ref; if (!byRefBus.has(k)) byRefBus.set(k, []); byRefBus.get(k).push(v); }
    for (const [ref, list] of byRefBus) {
      const sdas = list.filter(x => /SDA/i.test(x.net) || /SDA/.test(x.pin.functions.join(' ')) && !/SCL/i.test(x.net));
      for (const sda of list.filter(x => /SDA/i.test(x.net))) {
        const stem = sda.net.replace(/SDA/i, 'SCL');
        const scl = list.find(x => x.net.toUpperCase() === stem.toUpperCase());
        if (!scl) continue;
        tick('func.i2c');
        const sdaPers = [...new Set((sda.pin.functions.join(' ').match(/(FMP)?I2C\d*(?=_SDA)/gi) || []).map(s => s.toUpperCase()))];
        const sclPers = [...new Set((scl.pin.functions.join(' ').match(/(FMP)?I2C\d*(?=_SCL)/gi) || []).map(s => s.toUpperCase()))];
        if (sdaPers.length && sclPers.length && !sdaPers.some(p => sclPers.includes(p))) add('func.i2c', 'warn', ref + ' ' + sda.net + ' and ' + scl.net + ' are on different I2C peripherals', sda.pin.name + ' offers ' + sdaPers.join(', ') + '; ' + scl.pin.name + ' offers ' + sclPers.join(', ') + '. One peripheral needs both.', { refs: [ref], pins: [ref + '.' + sda.pin.num, ref + '.' + scl.pin.num], nets: [sda.net, scl.net] });
      }
      void sdas;
    }
    for (const [ref, lines] of exti) for (const [line, list] of lines) {
      tick('func.exti');
      if (list.length > 1) add('func.exti', 'warn', ref + ' ' + list.map(x => x.net).join(' and ') + ' share EXTI line ' + line, list.map(x => x.pin.name).join(' and ') + ' map to the same external interrupt line, so only one of them can raise an interrupt. Move one to a pin with a free line, or poll it.', { refs: [ref], pins: list.map(x => ref + '.' + x.pin.num), nets: list.map(x => x.net) });
    }

    // Straps: I2C addresses on each bus.
    const busParts = new Map(); // SDA net → [{ ref, addr, how }]
    for (const [ref, f] of M.files) {
      const ad = M.valueOf(f, 'i2c.addr');
      const sdaPin = f.pins.find(x => /(^|\/)SDA(\/|$)|^SDA\d?$/i.test(x.name));
      if (!ad || !sdaPin) continue;
      const net = M.netOf.get(ref + '.' + sdaPin.num); if (!net) continue;
      tick('straps.i2c');
      const doms = domainVoltages(M, NV, ref);
      const addr = resolveAddr(ad, f, ref, M, NV);
      if (!addr) { add('straps.i2c', 'info', ref + '\'s I2C address couldn\'t be worked out', 'The part file says: ' + (ad.list || [ad.text || ad.value]).join('; ') + '. Check its strap pins by hand.', { refs: [ref], nets: [net], basis: [basisOf(f, ad)] }); continue; }
      void doms;
      if (!busParts.has(net)) busParts.set(net, []);
      busParts.get(net).push({ ref, addr: addr.addr, how: addr.how, basis: basisOf(f, ad) });
    }
    for (const [net, list] of busParts) {
      const by = new Map();
      for (const x of list) for (const a of [].concat(x.addr)) { if (!by.has(a)) by.set(a, []); by.get(a).push(x); }
      for (const [a, xs] of by) if (xs.length > 1) add('straps.i2c', 'error', xs.map(x => x.ref).join(' and ') + ' both answer at 0x' + a.toString(16).toUpperCase().padStart(2, '0') + ' on ' + net, xs.map(x => x.ref + ': ' + x.how).join('; ') + '. Change a strap, or put them on separate buses.', { refs: xs.map(x => x.ref), nets: [net], basis: xs.map(x => x.basis) });
    }

    connectorChecks({ M, NV, add, tick, skip, need: ref => needFiles.add(ref) });
    return finish();

    function finish() {
      const order = { error: 0, warn: 1, info: 2 };
      findings.sort((a, b) => order[a.severity] - order[b.severity] || CATALOG.indexOf(byKey.get(a.check)) - CATALOG.indexOf(byKey.get(b.check)) || a.title.localeCompare(b.title, undefined, { numeric: true }));
      const rails = [...NV.V].filter(([n, s]) => s.from !== 'ground').map(([net, s]) => ({ net, v: s.v, from: s.from, unverified: !!s.unverified })).sort((a, b) => b.v - a.v || a.net.localeCompare(b.net));
      return { findings, rails, coverage, parts: M.why, ms: Date.now() - t0, hasNets, needFiles: [...needFiles] };
    }
  }

  // ── Connectors (docs/connectors.md): assigned mates and power inputs ──
  const textOf = p => textsOf(p).concat(p.params ? [p.params.Description || ''] : []).join(' ');
  const isLed = p => /\bLED\b/i.test(textOf(p)) || /^LED\d/i.test(p.ref);
  // What a target pin must offer for each expectation, read from its functions and name.
  const FN = {
    swdio: /SWDIO|SWDAT|JTMS/i, tms: /JTMS|SWDIO/i, swclk: /SWCLK|JTCK/i, tck: /JTCK|SWCLK/i, swo: /\bSWO\b|TRACESWO|JTDO/i, tdo: /JTDO|TRACESWO|\bSWO\b/i,
    tdi: /JTDI/i, ntrst: /NJTRST|JTRST/i,
    'uart-tx': /(?:LP)?U(?:S)?ART\d*_TX(?![A-Z])/i, 'uart-rx': /(?:LP)?U(?:S)?ART\d*_RX(?![A-Z])/i, 'uart-rts': /U(?:S)?ART\d*_(RTS|DE)(?![A-Z])/i, 'uart-cts': /U(?:S)?ART\d*_CTS(?![A-Z])/i
  };
  const FN_LABEL = { swdio: 'SWDIO', tms: 'JTMS', swclk: 'SWCLK', tck: 'JTCK', swo: 'SWO', tdo: 'JTDO', tdi: 'JTDI', ntrst: 'NJTRST', nrst: 'reset', 'uart-tx': 'UART TX', 'uart-rx': 'UART RX', 'uart-rts': 'UART RTS', 'uart-cts': 'UART CTS' };
  const uartsOf = (s, dir) => { const out = new Set(); const re = new RegExp('((?:LP)?U(?:S)?ART\\d*)_' + dir + '(?![A-Z])', 'gi'); let m; while ((m = re.exec(s))) out.add(m[1].toUpperCase()); return out; };

  function connectorChecks(C) {
    const { M, NV, add, tick, skip, need } = C;
    const signalPart = q => q && (q.kind === 'resistor' || q.kind === 'inductor' || /^(FB|L)\d/i.test(q.ref));
    // From a connector pin's net to the parts it reaches: across series resistors up to 1 kΩ, ferrite beads, and
    // inductors, never into ground or a rail (a pull-up's far end). Capacitors are passed over.
    function reach(start, fromRef) {
      const out = [], via = new Map([[start, []]]);
      let frontier = [start];
      for (let d = 0; frontier.length && d < 3; d++) {
        const next = [];
        for (const net of frontier) for (const n of M.nets.get(net) || []) {
          if (n.ref === fromRef) continue;
          const q = M.parts.get(n.ref); if (!q) continue;
          if (signalPart(q)) {
            const e = twoPin(M, q); if (!e) continue;
            const other = e[0] === net ? e[1] : e[0];
            if (q.kind === 'resistor') { const rv = passiveValue(q, 'Ω'); if (!rv || rv.dnp || rv.v == null || rv.v > 1000) continue; }
            if (!other || via.has(other) || NV.ground.has(other) || NV.V.has(other)) continue;
            via.set(other, via.get(net).concat(q.ref)); next.push(other);
            continue;
          }
          if (q.kind === 'capacitor') continue;
          out.push({ ref: n.ref, pin: n.pin, net, via: via.get(net), fp: M.filePin(n.ref, n.pin), file: M.files.get(n.ref), part: q });
        }
        frontier = next;
      }
      return out;
    }
    const pinText = e => [(e.fp && e.fp.name) || '', ((e.part.pins.find(x => String(x.num) === String(e.pin)) || {}).name) || '', ((e.fp && e.fp.functions) || []).join(' ')].join(' ');
    const isReset = e => (e.fp && e.fp.role === 'reset') || /(^|[\s_/-])N?RST|RESET/i.test(pinText(e));
    const meets = (e, x) => (x === 'nrst' ? isReset(e) : FN[x] ? FN[x].test(pinText(e)) : false);
    const pinLabel = e => e.ref + ' ' + ((e.fp && e.fp.name) || e.pin) + (e.via.length ? ' (through ' + e.via.join(', ') + ')' : '');

    // ── Mates: each assigned profile's pins against what the target puts there ──
    for (const a of M.conn.assign) {
      if (!a.mate) continue;
      const prof = M.conn.profiles[a.mate];
      const part = M.parts.get(a.ref);
      if (!prof) { skip('conn.mate'); add('conn.mate', 'info', a.ref + '\'s mate profile ' + a.mate + ' isn\'t in this browser', 'Sync, or import the profile, to check ' + a.ref + '.', { refs: [a.ref] }); continue; }
      const verified = !!prof.ok;
      const basisFor = pin => [{ file: prof.id, mpn: prof.name, k: 'pin ' + pin.num + ' (' + (pin.signal || pin.expect) + ')', on: '', page: pin.page || (prof.source || {}).page || null, verified }];
      const symNums = new Set(part.pins.map(x => String(x.num).toUpperCase()));
      const want = prof.pins.filter(p => !C_SKIP.has(expectsOf(p)[0]));
      const missingNums = want.filter(p => !symNums.has(String(p.num).toUpperCase()));
      tick('conn.mate');
      if (missingNums.length) {
        add('conn.mate', 'error', a.ref + ' has no pin ' + missingNums.map(p => p.num).slice(0, 6).join(', ') + ' for ' + prof.name, a.ref + ' has ' + part.pins.length + ' pins; ' + prof.name + ' uses ' + want.length + '. ' + (prof.numbering ? 'The header is numbered: ' + prof.numbering + ' ' : '') + 'Check the symbol and footprint number the header the same way.', { refs: [a.ref], basis: basisFor(missingNums[0]) });
      }
      const hits = {}; // expectation → { pin, ends }
      let mcuSeen = null;
      for (const pin of prof.pins) {
        const ex = expectsOf(pin);
        if (!ex.length || C_SKIP.has(ex[0]) || !symNums.has(String(pin.num).toUpperCase())) continue;
        const key = a.ref + '.' + pin.num;
        const net = M.netOf.get(key);
        const nodes = net ? (M.nets.get(net) || []).filter(n => n.ref !== a.ref) : [];
        const where = { refs: [a.ref], pins: [key], nets: net ? [net] : [], basis: basisFor(pin) };
        const sig = (pin.signal ? pin.signal + ', ' : '') + (PK.mates ? PK.mates.EXPECT[ex[0]] : ex[0]).replace(/^The target's /, 'the target\'s ');
        const title = a.ref + ' pin ' + pin.num + ' (' + (pin.signal || ex[0]) + ' on ' + prof.name + ')';
        tick('conn.mate');
        if (ex[0] === 'gnd') {
          if (!net || !nodes.length) add('conn.mate', 'error', title + ' is not connected', 'It should be ground (' + sig + ').', where);
          else if (!NV.ground.has(net)) add('conn.mate', 'error', title + ' is on ' + net + ', not ground', 'It should be ground.', where);
          continue;
        }
        if (ex[0] === 'nc') {
          if (net && nodes.length) add('conn.mate', 'warn', title + ' should be left open but is on ' + net, (pin.note ? pin.note + ' ' : '') + 'The tool may drive or use this pin.', where);
          continue;
        }
        if (ex[0] === 'vref') {
          const nv = net && NV.V.get(net);
          if (!net || !nodes.length) { add('conn.mate', pin.required === false ? 'warn' : 'error', title + ' is not connected', 'The tool reads the target\'s I/O voltage here to set its own levels.', where); continue; }
          if (NV.ground.has(net)) { add('conn.mate', 'error', title + ' is on ground', 'It should be the target\'s I/O supply.', where); continue; }
          if (!nv) { add('conn.mate', 'warn', title + ' is on ' + net + ', which has no known voltage', 'It should be the target\'s I/O supply.', where); continue; }
          hits.vref = { pin, net, v: nv.v, where };
          continue;
        }
        if (ex[0] === 'power-in') {
          if (!net || !nodes.length) continue; // the tool's supply unused: fine
          const nv = NV.V.get(net);
          if (NV.ground.has(net)) add('conn.mate', 'error', title + ' is on ground', 'The tool supplies ' + (pin.v != null ? fmtV(pin.v) : 'power') + ' here; it would be shorted.', where);
          else if (pin.v != null && nv && Math.abs(nv.v - pin.v) > 0.1 * pin.v) add('conn.mate', 'error', title + ' puts ' + fmtV(pin.v) + ' on ' + net + ' (' + fmtV(nv.v) + ')', 'The tool supplies ' + fmtV(pin.v) + ' here, onto a ' + fmtV(nv.v) + ' rail (' + nv.from + '). Leave the pin open or feed it to a regulator\'s input.', where);
          continue;
        }
        if (ex[0] === 'other') continue;
        // A signal: find the target pin it reaches.
        if (!net || !nodes.length) {
          if (pin.required) add('conn.mate', 'error', title + ' is not connected', 'The tool needs ' + sig + ' here.', where);
          else if (ex[0] === 'nrst') add('conn.mate', 'info', title + ' is not connected', 'Without reset the tool can\'t connect under reset, which some firmware (low power, SWD pins reused) needs.', where);
          continue;
        }
        const ends = reach(net, a.ref);
        const mcu = ends.filter(e => e.file && (e.file.kind === 'mcu' || (e.fp && (e.fp.functions || []).length)));
        if (!mcu.length) {
          skip('conn.mate');
          const ics = ends.filter(e => !['connector', 'diode'].includes(e.part.kind) && !(e.file && e.file.kind === 'protection'));
          if (ics.length) add('conn.mate', 'info', title + ' goes to ' + [...new Set(ics.map(e => e.ref))].slice(0, 3).join(', ') + ', not checked', ics.some(e => !e.file) ? 'Configure ' + ics.filter(e => !e.file).map(e => e.ref)[0] + '\'s part file (with its pin functions) to check this pin.' : 'Not an MCU pin with alternate functions; check by hand that it carries ' + sig + '.', where);
          continue;
        }
        const ok = mcu.filter(e => ex.some(x => meets(e, x)));
        if (ok.length) { hits[ex[0]] = { pin, ends: ok, where }; mcuSeen = mcuSeen || ok[0]; continue; }
        // Wrong: say what the pin is instead, and whether it's another pin of this profile.
        const e = mcu[0];
        const other = prof.pins.find(p => p !== pin && expectsOf(p).some(x => meets(e, x)));
        const is = other ? FN_LABEL[expectsOf(other).find(x => meets(e, x))] : null;
        const otherNet = other && M.netOf.get(a.ref + '.' + other.num);
        const otherUsed = otherNet && (M.nets.get(otherNet) || []).some(n => n.ref !== a.ref);
        const swapped = other ? ' It is ' + is + ', which ' + prof.name + ' takes on pin ' + other.num + (other.signal ? ' (' + other.signal + ')' : '') + (otherUsed ? ': the two are likely swapped.' : ', which is open here: it belongs there.') : '';
        add('conn.mate', 'error', title + ' reaches ' + pinLabel(e) + ', which has no ' + FN_LABEL[ex[0]] + ' function', prof.name + ' needs ' + sig + ' here.' + swapped + ' Its functions: ' + (((e.fp && e.fp.functions) || []).slice(0, 8).join(', ') || 'none listed') + '.', Object.assign({}, where, { refs: [a.ref, e.ref], pins: [key, e.ref + '.' + e.pin] }));
      }
      // UART TX and RX on one peripheral.
      const tx = hits['uart-tx'], rx = hits['uart-rx'];
      if (tx && rx) {
        tick('conn.mate');
        const a1 = uartsOf(tx.ends.map(pinText).join(' '), 'TX'), b1 = uartsOf(rx.ends.map(pinText).join(' '), 'RX');
        if (a1.size && b1.size && ![...a1].some(u => b1.has(u))) add('conn.mate', 'error', a.ref + '\'s UART TX and RX are on different peripherals', 'Pin ' + tx.pin.num + ' reaches ' + pinLabel(tx.ends[0]) + ' (' + [...a1].join(', ') + ' TX); pin ' + rx.pin.num + ' reaches ' + pinLabel(rx.ends[0]) + ' (' + [...b1].join(', ') + ' RX). ' + prof.name + '\'s serial port needs both on one.', { refs: [a.ref, tx.ends[0].ref], pins: [a.ref + '.' + tx.pin.num, a.ref + '.' + rx.pin.num], nets: [tx.where.nets[0], rx.where.nets[0]].filter(Boolean), basis: tx.where.basis });
      }
      // The reference voltage is the target MCU's I/O supply.
      if (hits.vref && mcuSeen && mcuSeen.fp && mcuSeen.fp.domain) {
        const dv = domainVoltages(M, NV, mcuSeen.ref)[mcuSeen.fp.domain];
        tick('conn.mate');
        if (dv != null && Math.abs(dv - hits.vref.v) > 0.1 * dv) add('conn.mate', 'warn', a.ref + ' pin ' + hits.vref.pin.num + ' senses ' + fmtV(hits.vref.v) + ', but ' + mcuSeen.ref + '\'s I/O is at ' + fmtV(dv), 'The tool sets its signal levels from this pin; it should be the supply of the pins it talks to (' + mcuSeen.ref + ' ' + mcuSeen.fp.domain + ').', hits.vref.where);
      }
    }

    // ── Power inputs ──
    for (const a of M.conn.assign) {
      const pw = a.power; if (!pw) continue;
      const part = M.parts.get(a.ref);
      const vr = pw.v || {}, vmax = vr.max != null ? vr.max : vr.typ, imax = pw.i;
      const rangeTxt = vr.min != null && vr.max != null ? fmtV(vr.min).replace(' V', '') + ' to ' + fmtV(vr.max) : fmtV(vmax);
      const name = a.ref + '\'s ' + rangeTxt + ' input';
      const supNets = [...new Set((pw.pins || []).map(n => M.netOf.get(a.ref + '.' + n)).filter(Boolean))];
      const retNets = [...new Set((pw.return || []).map(n => M.netOf.get(a.ref + '.' + n)).filter(Boolean))];
      tick('power.input');
      const missing = (pw.pins || []).concat(pw.return || []).filter(n => !part.pins.some(x => String(x.num) === String(n)));
      if (missing.length) add('power.input', 'error', a.ref + ' has no pin ' + missing.join(', '), 'The power input names pins the symbol doesn\'t have.', { refs: [a.ref], key: a.ref + ' pins' });
      if (!supNets.length) { add('power.input', 'error', name + ' is not connected', 'Its supply pins (' + (pw.pins || []).join(', ') + ') are on no net.', { refs: [a.ref], key: a.ref + ' open' }); continue; }
      if (supNets.length > 1) add('power.input', 'warn', name + '\'s supply pins are on ' + supNets.length + ' nets', supNets.join(', ') + '. Pins in parallel should share one net; only ' + supNets[0] + ' is followed.', { refs: [a.ref], nets: supNets, key: a.ref + ' nets' });
      if (supNets.some(n => NV.ground.has(n))) add('power.input', 'error', name + '\'s supply pins are on ground', 'Supply and return swapped, or the wrong pins named.', { refs: [a.ref], nets: supNets, key: a.ref + ' gnd' });
      for (const n of retNets) if (!NV.ground.has(n)) {
        // A return through an N-FET to ground is reverse-polarity protection, not a fault.
        const fet = (M.nets.get(n) || []).map(x => M.parts.get(x.ref)).find(q => q && /^Q\d/i.test(q.ref) && q.pins.some(pp => NV.ground.has(M.netOf.get(q.ref + '.' + pp.num))));
        if (!fet) add('power.input', 'error', name + '\'s return pin is on ' + n + ', not ground', 'The return pins (' + (pw.return || []).join(', ') + ') should reach ground.', { refs: [a.ref], nets: [n], key: a.ref + ' ret ' + n });
      }
      if (vmax == null && imax == null) continue;
      const start = supNets[0];

      const { nets, series, shunts, loads } = powerPath(M, NV.ground, start, a.ref);
      const firstLoad = [...loads].slice(0, 3);
      const pathRefs = [a.ref].concat(series.map(s => s.ref), shunts.map(s => s.ref));
      const pathWhere = { refs: pathRefs.slice(0, 12), nets: [...nets.keys()].slice(0, 8) };

      // Protection.
      const fuse = series.find(s => /^F\d/i.test(s.ref) || /fuse|ptc|poly-?switch|resettable/i.test(textOf(s.part)) || (s.file && /e-?fuse|hot[- ]?swap|current[- ]limit/i.test(s.file.description || '')));
      const tvs = shunts.find(s => /^(TVS|RV|VR|D)\d/i.test(s.ref) && (/tvs|transient|esd|varistor|\bmov\b|smaj|smbj|smcj|smf\d|sm6t|p6ke|1\.5ke|sd\d+c/i.test(textOf(s.part)) || /^(TVS|RV|VR)\d/i.test(s.ref) || (s.file && (s.file.kind === 'protection' || M.valueOf(s.file, 'tvs.vrwm')))));
      const rev = series.find(s => (s.part.kind === 'diode' && !isLed(s.part)) || /^D\d/i.test(s.ref) || /^Q\d/i.test(s.ref) || (s.file && /ideal diode|reverse/i.test((s.file.description || '') + ' ' + JSON.stringify(M.valueOf(s.file, 'sw.reverse') || ''))))
        || (retNets.some(n => !NV.ground.has(n)) ? { ref: 'a FET in the return' } : null)
        || shunts.find(s => s.part.kind === 'diode' && s !== tvs && !isLed(s.part));
      tick('power.protection');
      const lack = [!fuse && 'fuse', !tvs && 'TVS', !rev && 'reverse-polarity protection'].filter(Boolean);
      if (lack.length) add('power.protection', 'info', name + ' has no ' + (lack.length === 3 ? 'fuse, TVS, or reverse-polarity protection' : lack.join(' or ')) + ' before ' + (firstLoad.length ? firstLoad.join(', ') : 'its first load'),
        'Found on the path: ' + ([fuse && fuse.ref + ' (fuse)', tvs && tvs.ref + ' (TVS)', rev && rev.ref + ' (reverse polarity)'].filter(Boolean).join(', ') || 'nothing') + '. Not every input needs all three (a cable that can\'t be reversed, an upstream fuse); waive this when so.', Object.assign({ pins: (pw.pins || []).map(n => a.ref + '.' + n).slice(0, 4) }, pathWhere, { refs: [a.ref].concat(firstLoad) }));
      // A TVS must not conduct at the input's normal maximum.
      if (tvs && tvs.file && vmax != null) {
        const w = M.valueOf(tvs.file, 'tvs.vrwm');
        tick('power.ratings');
        if (w && (w.value != null ? w.value : w.max) < vmax) add('power.ratings', 'error', tvs.ref + '\'s ' + fmtV(w.value != null ? w.value : w.max) + ' working voltage is below ' + name + '\'s ' + fmtV(vmax) + ' maximum', 'A TVS starts to conduct above its working voltage; at the input\'s maximum it would leak or overheat.', { refs: [tvs.ref, a.ref], nets: [start], basis: [basisOf(tvs.file, w)] });
      }

      // Contacts.
      const cf = M.files.get(a.ref);
      if (imax != null) {
        const ri = cf && M.valueOf(cf, 'rate.i');
        const n = Math.min((pw.pins || []).length || 1, (pw.return || []).length || (pw.pins || []).length || 1);
        if (ri && (ri.value != null ? ri.value : ri.max) != null) {
          tick('power.contacts');
          const per = ri.value != null ? ri.value : ri.max;
          if (imax > per * n + 1e-9) add('power.contacts', 'error', name + ' carries ' + P.fmt(imax, 'A') + '; ' + a.ref + '\'s contacts are rated ' + P.fmt(per, 'A') + (n > 1 ? ' each (' + n + ' in parallel: ' + P.fmt(per * n, 'A') + ')' : ''), 'Contact current rating per pin from ' + cf.mpn + '. Use more contacts in parallel or a larger connector.', { refs: [a.ref], pins: (pw.pins || []).map(x => a.ref + '.' + x), nets: [start], basis: [basisOf(cf, ri)] });
          else if (imax > 0.5 * per * n + 1e-9) add('power.contacts', 'info', name + ' runs ' + a.ref + '\'s contacts above half their rating', P.fmt(imax, 'A') + ' on ' + P.fmt(per * n, 'A') + ' of contacts. Derating guides (ECSS, NASA) keep connector contacts to 50% of rated current.', { refs: [a.ref], nets: [start], basis: [basisOf(cf, ri)] });
        } else skip('power.contacts');
      }

      // Ratings of the parts in the path.
      const unrated = [];
      const ifUnrated = (s, why) => { unrated.push(s.ref + ' (' + why + ')'); if (!s.file && s.part.mpn) need(s.ref); };
      if (imax != null && !(cf && M.valueOf(cf, 'rate.i'))) ifUnrated({ ref: a.ref, part: part, file: cf }, cf ? 'no rate.i' : 'no part file');
      for (const s of series) {
        const f = s.file, q = s.part;
        if (!f) { ifUnrated(s, q.mpn ? 'no part file' : 'no part number'); continue; }
        const isFuse = s === fuse, isQ = q.kind === 'transistor' || /^Q\d/i.test(q.ref), isD = q.kind === 'diode' || /^D\d/i.test(q.ref), isL = q.kind === 'inductor' || /^(L|FB)\d/i.test(q.ref);
        const keys = isQ ? ['q.id'] : isD ? ['d.if', 'rate.i'] : isL ? ['l.irms', 'rate.i', 'l.isat'] : ['rate.i'];
        if (imax != null) {
          const k = keys.find(k => M.valueOf(f, k));
          if (k) {
            const r = M.valueOf(f, k), lim = r.value != null ? r.value : r.max;
            tick('power.ratings');
            if (lim != null && imax > lim + 1e-9) add('power.ratings', 'error', s.ref + ' is rated ' + P.fmt(lim, 'A') + (isFuse ? ' and would open' : '') + ' below ' + name + '\'s ' + P.fmt(imax, 'A'), (P.byKey.get(k) || { label: k }).label + ' of ' + f.mpn + '.' + (isFuse ? ' A fuse should sit above the normal current with margin for inrush.' : ''), { refs: [s.ref, a.ref], nets: [start], basis: [basisOf(f, r)] });
          } else if (q.kind === 'resistor' && M.valueOf(f, 'rate.p')) {
            const r = M.valueOf(f, 'rate.p'), rv = passiveValue(q, 'Ω'), p = rv && rv.v ? imax * imax * rv.v : null;
            tick('power.ratings');
            if (p != null && r.value != null && p > r.value) add('power.ratings', 'error', s.ref + ' dissipates ' + P.fmt(p, 'W') + ', above its ' + P.fmt(r.value, 'W') + ' rating', P.fmt(imax, 'A') + ' through ' + P.fmt(rv.v, 'Ω') + '.', { refs: [s.ref, a.ref], basis: [basisOf(f, r)] });
          } else ifUnrated(s, 'no ' + keys[0]);
        }
        if (vmax != null) {
          const vk = isQ ? 'q.vds' : isD ? 'd.vr' : null;
          const r = vk && M.valueOf(f, vk);
          if (r) {
            const lim = r.value != null ? r.value : r.max;
            tick('power.ratings');
            if (lim != null && vmax > lim) add('power.ratings', 'error', s.ref + '\'s ' + fmtV(lim) + ' ' + (isQ ? 'drain-source' : 'reverse') + ' rating is below ' + name + '\'s ' + fmtV(vmax) + ' maximum', 'From ' + f.mpn + '. Reversed or at its maximum, the input would break it down.', { refs: [s.ref, a.ref], basis: [basisOf(f, r)] });
          }
        }
      }
      if (unrated.length) { skip('power.ratings', unrated.length); add('power.ratings', 'info', name + ': ' + unrated.length + ' part' + (unrated.length === 1 ? '' : 's') + ' in its path without a rating to check', unrated.join(', ') + '. Configure their part files (Parts, Batch configure includes them) with their current ratings: rate.i for connectors and fuses, l.irms for inductors, q.id and q.vds for FETs, d.if and d.vr for diodes.', Object.assign({ key: a.ref + ' unrated' }, pathWhere)); }
    }
  }
  // A power input's path to its first load: nets reached through series parts (≤ 1 Ω, inductors and beads, fuses,
  // diodes other than LEDs, a FET's drain and source, load switches and ideal-diode parts), stopping at a net that
  // feeds an IC's supply pin. Shunts are parts from the path to ground (a TVS, a varistor), capacitors aside.
  function powerPath(M, ground, start, fromRef) {
    const nets = new Map([[start, []]]), series = [], shunts = [], loads = new Set();
    let frontier = [start];
    for (let d = 0; frontier.length && d < 6; d++) {
      const next = [];
      for (const net of frontier) {
        const nodes = M.nets.get(net) || [];
        const feeds = nodes.filter(n => n.ref !== fromRef && (M.filePin(n.ref, n.pin) || {}).role === 'power-in');
        for (const n of nodes) {
          if (n.ref === fromRef) continue;
          const q = M.parts.get(n.ref); if (!q) continue;
          const f = M.files.get(q.ref);
          const others = q.pins.map(x => M.netOf.get(q.ref + '.' + x.num)).filter(x => x && x !== net);
          if (q.kind !== 'capacitor' && q.pins.length <= 3 && others.length && others.every(x => ground.has(x))) { if (!shunts.some(s => s.ref === q.ref)) shunts.push({ ref: q.ref, part: q, file: f }); continue; }
          if (feeds.length) continue; // series parts past a net that feeds an IC come after the first load
          let outs = [];
          if (q.kind === 'resistor') { const rv = passiveValue(q, 'Ω'); if (rv && !rv.dnp && rv.v != null && rv.v <= 1) outs = others; }
          else if (q.kind === 'inductor' || /^(FB|F|L)\d/i.test(q.ref) || (q.kind === 'diode' && q.pins.length === 2 && !isLed(q))) outs = others;
          else if (q.kind === 'transistor' || /^Q\d/i.test(q.ref)) {
            // A FET in the path: drain and source, never the gate.
            const name = x => String(x.name || '').toUpperCase();
            const mine = q.pins.find(x => String(x.num) === String(n.pin));
            if (mine && /^(D|S|DRAIN|SOURCE)\d*$/.test(name(mine))) outs = q.pins.filter(x => /^(D|S|DRAIN|SOURCE)\d*$/.test(name(x))).map(x => M.netOf.get(q.ref + '.' + x.num)).filter(x => x && x !== net);
          } else if (f && (f.kind === 'switch' || /ideal diode|e-?fuse|hot[- ]?swap/i.test(f.description || ''))) {
            outs = f.pins.filter(x => /^(V?OUT\d?|SOURCE|S)$/i.test(x.name)).map(x => M.netOf.get(q.ref + '.' + x.num)).filter(x => x && x !== net);
          }
          outs = outs.filter(x => !ground.has(x));
          if (!outs.length) continue;
          if (!series.some(s => s.ref === q.ref)) series.push({ ref: q.ref, part: q, file: f });
          for (const o of outs) if (!nets.has(o)) { nets.set(o, nets.get(net).concat(q.ref)); next.push(o); }
        }
        for (const n of feeds) loads.add(n.ref);
      }
      frontier = next;
    }
    return { nets, series, shunts, loads };
  }
  const C_SKIP = new Set(['key']);
  const expectsOf = p => (Array.isArray(p.expect) ? p.expect : [p.expect]).filter(Boolean);

  // An I2C address from a part file's i2c.addr list and the levels of its strap pins.
  // Forms understood: "0x48" (fixed); "ADDR = GND: 0x48", "ADDR=SCL 0x5C", "A0 low: 0x50" (one strap).
  function resolveAddr(ad, f, ref, M, NV) {
    const lines = ad.list || (ad.text ? [ad.text] : ad.value != null ? [String(ad.value)] : []);
    const hexes = lines.map(l => (l.match(/0x[0-9a-f]{2}/ig) || []).map(h => parseInt(h, 16)));
    const all = [].concat(...hexes);
    if (!all.length) return null;
    if (new Set(all).size === 1) return { addr: all[0], how: 'fixed at 0x' + all[0].toString(16).toUpperCase() };
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*([A-Z][A-Z0-9_/]*)\s*(?:=|is|tied to|to|:)?\s*(GND|VSS|VDD|VCC|VIO|SDA|SCL|low|high|open|float|pulled up|pulled down)\b/i.exec(lines[i]);
      if (!m || !hexes[i].length) continue;
      const pin = f.pins.find(x => x.name.toUpperCase() === m[1].toUpperCase() || x.name.toUpperCase().split('/').includes(m[1].toUpperCase()));
      if (!pin) continue;
      const net = M.netOf.get(ref + '.' + pin.num);
      const level = !net || (M.nets.get(net) || []).length <= 1 ? 'open' : NV.ground.has(net) ? 'GND' : /SDA/i.test(net) ? 'SDA' : /SCL/i.test(net) ? 'SCL' : NV.V.has(net) ? 'VDD' : null;
      if (!level) continue;
      const want = m[2].toUpperCase();
      const same = want === level || (level === 'GND' && /^(VSS|LOW|PULLED DOWN)$/.test(want)) || (level === 'VDD' && /^(VCC|VIO|HIGH|PULLED UP)$/.test(want)) || (level === 'open' && /^(OPEN|FLOAT)$/.test(want));
      if (same) return { addr: hexes[i][0], how: pin.name + ' ' + (net ? 'on ' + net : 'open') + ' → 0x' + hexes[i][0].toString(16).toUpperCase() };
    }
    return null;
  }

  PK.checks = { CATALOG, byKey, run, evalExpr, voltageFromName, passiveValue };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
