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
    { key: 'supply.offboard', group: 'Supply', title: 'Rails that come only through a connector', needs: 'pin roles' },
    { key: 'supply.charge', group: 'Supply', title: 'Chargers fed above their charge voltage', needs: 'reg.vout.range (charge voltage), reg.vout' },
    { key: 'io.absmax', group: 'I/O levels', title: 'Pins below their absolute maximum', needs: 'io.absmax, io.ft.absmax, pin absmax' },
    { key: 'io.recommended', group: 'I/O levels', title: 'Pins within their recommended maximum', needs: 'pin vmax' },
    { key: 'io.vih', group: 'I/O levels', title: 'Inputs that read a driver\'s high level', needs: 'io.vih, driver domain' },
    { key: 'io.vil', group: 'I/O levels', title: 'Inputs that read a driver\'s low level', needs: 'io.vil, io.vol' },
    { key: 'io.unpowered', group: 'I/O levels', title: 'Inputs driven while their part is unpowered', needs: 'io.absmax, io.ft.absmax, io.absmax.off, rail sources' },
    { key: 'io.contention', group: 'I/O levels', title: 'One driver on each net', needs: 'pin roles (output)' },
    { key: 'pins.dnc', group: 'Pins', title: 'Do-not-connect pins left open', needs: 'pin roles' },
    { key: 'pins.unused', group: 'Pins', title: 'Pins that must be connected or tied', needs: 'pin unused rules' },
    { key: 'pins.float', group: 'Pins', title: 'Reset, boot, and enable pins not floating', needs: 'pin roles, en.default' },
    { key: 'nets.names', group: 'Nets', title: 'Nets with one name on the sheets', needs: 'the SchDoc sheets' },
    { key: 'nets.dangling', group: 'Nets', title: 'Signal nets that reach another part', needs: 'the netlist' },
    { key: 'nets.pulls', group: 'Nets', title: 'One pull resistor per net and rail', needs: 'the netlist' },
    { key: 'func.af', group: 'Pin functions', title: 'Interface nets on pins with that function', needs: 'pin functions' },
    { key: 'func.i2c', group: 'Pin functions', title: 'An I2C bus on one peripheral', needs: 'pin functions' },
    { key: 'func.exti', group: 'Pin functions', title: 'Interrupt nets on separate EXTI lines', needs: 'pin functions (EXTIn)' },
    { key: 'func.uart', group: 'Pin functions', title: 'UART TX to RX', needs: 'pin functions, pin names' },
    { key: 'func.i2cpull', group: 'Pin functions', title: 'I2C buses pulled up to a voltage every part takes', needs: 'io.vih, pin absmax or vmax, io.absmax' },
    { key: 'func.switch', group: 'Pin functions', title: 'Signal switches something on the board can close', needs: 'sw.default' },
    { key: 'parts.decoupling', group: 'Required parts', title: 'Decoupling on each supply domain', needs: 'dec.c, dec.bulk' },
    { key: 'parts.ext', group: 'Required parts', title: 'Capacitors a pin requires', needs: 'pin ext' },
    { key: 'parts.regulator', group: 'Required parts', title: 'Regulator capacitors and inductor in range', needs: 'reg.cin, reg.cout, reg.l, reg.cboot' },
    { key: 'parts.crystal', group: 'Required parts', title: 'Crystal load capacitors', needs: 'xtal.cl' },
    { key: 'parts.sense', group: 'Required parts', title: 'Current-sense resistors and the current they allow', needs: 'sense.vfs' },
    { key: 'parts.fields', group: 'Required parts', title: 'Value, comment, and description agree', needs: 'part parameters' },
    { key: 'straps.i2c', group: 'Straps', title: 'I2C addresses unique on each bus', needs: 'i2c.addr' },
    { key: 'straps.output', group: 'Straps', title: 'Strap pins that become outputs reach their rail through a resistor', needs: 'strap.latch, pin functions' },
    { key: 'conn.mate', group: 'Connectors', title: 'Connectors wired as what mates with them', needs: 'connector assignments, mate profiles, pin functions' },
    { key: 'power.input', group: 'Connectors', title: 'Power inputs on their rail and ground', needs: 'power input assignments' },
    { key: 'power.contacts', group: 'Connectors', title: 'Power input current within the contacts\' rating', needs: 'connector rate.i' },
    { key: 'power.protection', group: 'Connectors', title: 'A fuse, TVS, and reverse-polarity protection before the first load', needs: 'power input assignments' },
    { key: 'conn.contacts', group: 'Connectors', title: 'Pads of one contact on one net', needs: 'pin contact' },
    { key: 'power.ratings', group: 'Connectors', title: 'Parts in a power input\'s path rated for its current and voltage', needs: 'rate.i, l.irms, q.id, q.vds, d.if, d.vr, tvs.vrwm' },
    { key: 'library.coverage', group: 'Library', title: 'ICs with a part file', needs: 'the library' },
    { key: 'library.pins', group: 'Library', title: 'Part file pins match the symbol', needs: 'the library' },
  ];
  const byKey = new Map(CATALOG.map(c => [c.key, c]));

  // ── Small helpers ──
  const fmtV = v => (v == null ? '?' : (+v.toFixed(3)).toString() + ' V');
  const isAuto = (name, M) => {
    if (/^Net[A-Z]*\d+_\w+$|^N\$?\d+$|^unconnected-|^Net-\(/i.test(name)) return true;
    const m = /^Net([A-Z][A-Z0-9.]*)_[A-Z0-9]+$/i.exec(name); // NetJA_22: a designator with no digits, or a channel copy
    return !!(m && M && M.parts.has(m[1]));
  };
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
    // Regulators and switches held off: an active-high enable on ground, directly or through 0 Ω links (Chris,
    // 2026-11-13: a fitted buck-boost whose EN a jumper tied low). They make no rail.
    const held = new Map(); // ref → the enable pin
    const toGround = net => { for (let seen = new Set([net]), fr = [net], d = 0; fr.length && d < 4; d++) { const nx = []; for (const n of fr) { if (ground.has(n)) return true; for (const x of M.nets.get(n) || []) { const q = M.parts.get(x.ref); if (!q || q.kind !== 'resistor') continue; const rv = passiveValue(q, 'Ω'); if (!rv || rv.dnp || rv.v == null || rv.v > 1) continue; const e = twoPin(M, q); const o = e && (e[0] === n ? e[1] : e[0]); if (o && !seen.has(o)) { seen.add(o); nx.push(o); } } } fr = nx; } return false; };
    for (const [ref, f] of M.files) {
      if (f.kind !== 'regulator' && f.kind !== 'switch') continue;
      for (const pin of f.pins) {
        // Active-low enables (ENB, nEN) are off when high, not when grounded; SHDN is off when grounded.
        if (pin.role !== 'enable' || /^(EN_?B|ENBAR|N_?EN|ENN|CE_?B|ON_?B)$|BAR$/i.test(String(pin.name).replace(/^[#~!]/, 'N'))) continue;
        const net = M.netOf.get(ref + '.' + pin.num);
        if (net && toGround(net)) held.set(ref, Object.assign({ net }, pin));
      }
    }
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
      if (held.has(ref)) continue;
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
      // An output set by strap resistors (reg.vout.strap, 2026-11-13): "CFG1 = 36.5 kΩ, CFG2 = 0 Ω: 3.3 V".
      const strap = !vout && M.valueOf(f, 'reg.vout.strap');
      if (strap && strap.list && outPins.length) {
        const st = strapPick(M, ground, ref, f, strap.list);
        if (st) for (const op of outPins) setReg(M.netOf.get(ref + '.' + op.num), st.v, ref + ' output, strapped ' + st.how + ' (' + f.mpn + ')', { basis: [basisOf(f, strap)], unverified: !strap.ok, reg: ref });
      }
      // A programmable output (set over I2C) can go as high as its range: carried with the rail, for its loads' limits.
      const prog = M.valueOf(f, 'reg.vout.range');
      const vprog = prog && prog.max != null && f.kind === 'regulator' && vout && /i2c|register|program|smbus|pmbus|default/i.test((vout.cond || '') + ' ' + (vout.note || '')) ? prog.max : null;
      if (vout && typeof vtyp(vout) === 'number') {
        for (const op of (fbIsOut ? [fb] : outPins)) setReg(M.netOf.get(ref + '.' + op.num), vtyp(vout), ref + ' output (' + f.mpn + ')', Object.assign({ basis: [basisOf(f, vout)], unverified: !vout.ok, reg: ref }, vprog != null ? { vprog, progBasis: basisOf(f, prog) } : {}));
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
          setReg(top.net, v, ref + ' output: ' + fmtV(vtyp(vref)) + ' × (1 + ' + P.fmt(top.v, 'Ω') + ' / ' + P.fmt(bot.v, 'Ω') + ') (' + top.r.ref + ', ' + bot.r.ref + ')', { basis: [basisOf(f, vref)], unverified: !vref.ok, reg: ref });
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
      if (f && f.kind === 'switch' && !held.has(p.ref)) {
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
        // A rail a regulator also drives (a battery through a protector's FETs, and a converter through an ideal diode)
        // takes both: its range runs from the lower to the higher.
        if (had && had.reg && !had.input && net !== net0) { const lo = x => (x.vmin != null ? x.vmin : x.v), hi = x => (x.vmax != null ? x.vmax : x.v); V.set(net, Object.assign({}, had, { vmin: Math.min(lo(had), lo(s)), vmax: Math.max(hi(had), hi(s)), from: had.from + '; also ' + s.from + ', through ' + via.join(', ') })); continue; }
        if (net === net0 || ground.has(net) || (had && had.from !== 'net name' && had.input !== a.ref)) continue;
        V.set(net, Object.assign({}, s, { from: s.from + ', through ' + via.join(', ') }));
      }
    }
    return { V, ground, conflicts, held };
  }

  // The line of a strap table whose resistors match the board: "CFG1 = 36.5 kΩ, CFG2 = 0 Ω: 3.3 V". Each pin's
  // resistance to ground (0 when tied, open when nothing), within 3%; also "SEL = high" or "low".
  function strapPick(M, ground, ref, f, list) {
    const rOf = name => {
      const pin = f.pins.find(x => String(x.name).toUpperCase() === name.toUpperCase()); if (!pin) return undefined;
      const net = M.netOf.get(ref + '.' + pin.num);
      if (!net || (M.nets.get(net) || []).length <= 1) return { r: Infinity, lvl: 'open' };
      if (ground.has(net)) return { r: 0, lvl: 'low' };
      for (const n of M.nets.get(net)) { const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor') continue; const e = twoPin(M, q); const o = e && (e[0] === net ? e[1] : e[0]); const v = passiveValue(q, 'Ω'); if (o && ground.has(o) && v && !v.dnp && v.v != null) return { r: v.v, lvl: v.v <= 1 ? 'low' : null }; }
      return { r: null, lvl: 'high' };
    };
    for (const line of list) {
      const [lhs, rhs] = String(line).split(/:(.+)/);
      const out = /(\d+(?:\.\d+)?)\s*V\b/.exec(rhs || ''); if (!out) continue;
      const pairs = lhs.split(/[,;]|\band\b/).map(x => /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i.exec(x)).filter(Boolean);
      if (!pairs.length) continue;
      // Alternatives with "|": "CFG2 = 0 Ω | 511 Ω | 1.15 kΩ" (CFG2 also sets something else, the current limit).
      const fits = pairs.every(([, name, wants]) => {
        const got = rOf(name); if (!got) return false;
        return wants.split(/\s*\|\s*/).some(want => {
          if (/^(high|low|open)$/i.test(want)) return got.lvl === want.toLowerCase();
          const r = P.parseNum(want.replace(/\s+/g, ''), 'Ω'); if (r == null) return false;
          return r === 0 ? got.r === 0 : got.r != null && isFinite(got.r) && Math.abs(got.r - r) <= 0.03 * r;
        });
      });
      if (fits) return { v: +out[1], how: pairs.map(([, name]) => { const g = rOf(name); return name + ' ' + (g.r === 0 ? '0 Ω' : g.r != null && isFinite(g.r) ? P.fmt(g.r, 'Ω') : g.lvl); }).join(', ') };
    }
    return null;
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
        const i2cPin = fp && (/^(I2C\d*_)?(SDA|SCL|SCLK|SDAT)\d?$/i.test(String(fp.name).split('/')[0]) || (fp.functions || []).some(x => /\bI2C\d*[\s_]+(SDA|SCL)\b/i.test(x)) && /SDA|SCL/i.test(fp.name));
        if (fp && !i2cPin && (fp.role === 'output' || fp.role === 'io' || fp.role === 'open-drain') && fp.domain) {
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
      // A dead end (a 0 Ω link to a pull-up) doesn't hide a connector on this net.
      if ((rv && !rv.dnp && rv.v != null && rv.v <= 1) || q.kind === 'inductor' || /^(FB|F|L)\d/i.test(q.ref) || (q.kind === 'diode' && !isLed(q) && NV.V.has(other))) { const r = up(other, q.ref); if (r.root) return r; }
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
  // 0 Ω jumpers become links (Chris, 2026-11-13: three-pad "Y" jumpers were read as crystals, and nothing crossed them).
  function fitted(design) {
    const off = new Set(design.parts.filter(p => p.dnp).map(p => p.ref));
    const links = new Map(); // ref → { pads fitted, the part as a 0 Ω resistor }
    for (const p of design.parts) { if (off.has(p.ref)) continue; const l = linkOf(p); if (l) links.set(p.ref, l); }
    if (!off.size && !links.size) return design;
    const parts = design.parts.filter(p => !off.has(p.ref)).map(p => (links.has(p.ref) ? links.get(p.ref).part : p));
    const drop = (x) => off.has(x.ref) || (links.has(x.ref) && !links.get(x.ref).pads.includes(String(x.pin)));
    return Object.assign({}, design, { parts, nets: design.nets ? design.nets.map(n => Object.assign({}, n, { nodes: n.nodes.filter(x => !drop(x)) })) : design.nets });
  }
  // A 0 Ω jumper: two or three pads, a value of 0 (or a description saying 0 ohm, jumper, or link), and not an IC, a
  // capacitor, or an inductor. A three-pad one joins the pads its description names ("1-2 connected"), else 1 and 2.
  const ZERO = /^\s*0(\.0+)?\s*(R|Ω|ohms?)?\s*$/i;
  function linkOf(p) {
    if (p.pins.length < 2 || p.pins.length > 3 || ['ic', 'capacitor', 'inductor', 'connector', 'transistor', 'diode'].includes(p.kind)) return null;
    if (p.kind === 'resistor' && p.pins.length === 2) return null; // a plain 0 Ω resistor is already a link
    const pr = p.params || {}, desc = [pr.Description, p.description].filter(Boolean).join(' ');
    const zero = ZERO.test(pr.Value || '') || (!pr.Value && ZERO.test(pr.Comment || ''));
    const says = /\b0\s*(ohm|Ω|R)\b|\bjumper\b|\bsolder[\s-]?bridge\b|\bzero[\s-]?ohm\b/i.test(desc);
    if (!zero && !says) return null;
    const m = /\b(\d+)\s*[-–]\s*(\d+)\s*(?:connected|fitted|closed|shorted|joined)/i.exec(desc);
    const pads = m ? [m[1], m[2]] : p.pins.slice(0, 2).map(x => String(x.num));
    if (pads.some(n => !p.pins.some(x => String(x.num) === n))) return null;
    const part = Object.assign({}, p, { kind: 'resistor', link: true, params: Object.assign({}, pr, { Value: '0' }), pins: p.pins.filter(x => pads.includes(String(x.num))), mpn: '' });
    return { pads, part };
  }
  // Names a net carries on the sheets (Chris, 2026-11-13: a pin drawn on a power port, but Altium named the net by a net
  // label on the same wire and dropped the port's name): per netlist net, the power ports and net labels on it.
  function sheetNames(design) {
    const out = new Map(); // net → { powers: Set, labels: Set }; out.hier: the design has sheet symbols or channels
    if (!design.drawings || !design.drawings.length || !design.nets || !PK.schdoc || !PK.schdoc.connect) return out;
    const netOf = new Map();
    for (const n of design.nets) for (const x of n.nodes) netOf.set(x.ref + '.' + x.pin, n.name);
    const schToBoard = new Map(); // schematic designator → board designators (a channel's copies)
    for (const p of design.parts) { const s = p.schRef || p.ref; if (!schToBoard.has(s)) schToBoard.set(s, []); schToBoard.get(s).push(p.ref); }
    out.hier = design.drawings.some(d => (d.sheets || []).length || (d.ports || []).length) || [...schToBoard.values()].some(v => v.length > 1);
    for (const d of design.drawings) {
      let c; try { c = PK.schdoc.connect(d); } catch (e) { continue; }
      const groups = new Map(); // group → { nets, powers, labels }
      const g = id => { if (!groups.has(id)) groups.set(id, { nets: new Set(), powers: new Set(), labels: new Set() }); return groups.get(id); };
      d.pins.forEach((p, i) => { const id = c.pin[i]; if (id == null || id < 0) return; const rs = schToBoard.get(p.ref) || [p.ref]; if (rs.length !== 1) return; const n = netOf.get(rs[0] + '.' + p.num); if (n) g(id).nets.add(n); });
      d.powers.forEach((p, i) => { if (c.power[i] != null && p.text) g(c.power[i]).powers.add(p.text); });
      d.labels.forEach((l, i) => { if (c.label[i] != null && l.text) g(c.label[i]).labels.add(l.text); });
      for (const x of groups.values()) for (const n of x.nets) {
        if (!out.has(n)) out.set(n, { powers: new Set(), labels: new Set() });
        x.powers.forEach(v => out.get(n).powers.add(v)); x.labels.forEach(v => out.get(n).labels.add(v));
      }
    }
    return out;
  }

  function run(design, lib, conn) {
    const t0 = Date.now();
    design = fitted(design);
    const M = model(design, lib || [], conn);
    M.sheetNames = sheetNames(design);
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
      // A regulator held off by its enable makes nothing: what its capacitors and inductor lack is a note.
      const h = f.refs[0] && NV.held.get(f.refs[0]);
      if (h && ['parts.regulator', 'parts.ext', 'parts.decoupling', 'supply.range'].includes(check) && !f.heldNote) { f.severity = 'info'; f.detail += ' ' + f.refs[0] + ' is held off (its ' + h.name + ' is on ' + h.net + '), so this matters only if it is enabled.'; }
      delete f.heldNote;
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

    // Regulators held off by their enable (fitted for nothing, or an option to finish).
    for (const [ref, h] of NV.held) {
      tick('parts.regulator');
      const f = M.files.get(ref), outs = f.pins.filter(x => x.role === 'power-out' || x.role === 'switch').map(x => M.netOf.get(ref + '.' + x.num)).filter(Boolean);
      add('parts.regulator', 'warn', ref + ' is fitted but held off: its ' + h.name + ' is on ' + h.net, ref + ' (' + f.mpn + ') never runs while ' + h.name + ' is tied low' + (outs.length ? ', so ' + [...new Set(outs)].join(', ') + ' carries nothing' : '') + '. If it is an option, leave it and its inductor and capacitors unfitted in this build, or check them as if it ran. Its other findings are notes.', { refs: [ref], pins: [ref + '.' + h.num], nets: [h.net], key: ref + ' held', heldNote: true });
    }

    netChecks();

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
        const label = ref + ' ' + String(pin.name).replace(/\\/g, '') + ' (pin ' + pin.num + ')'; // Altium's overbar backslashes off

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
          else if (!nv && !driven) {
            // What the sheets call it (a power port nothing else uses), and the rail the part file ties it to.
            const sn = M.sheetNames && M.sheetNames.get(net);
            const ports = sn ? [...sn.powers] : [];
            const lonely = ports.filter(x => ![...M.sheetNames].some(([n2, s2]) => n2 !== net && s2.powers.has(x)));
            const tl = (val('supply.tied') || {}).list || [];
            const line = pin.domain && tl.find(l => new RegExp('\\b' + pin.domain + '\\b').test(l));
            const partner = line && ((line.replace(/\(\s*or\b[^)]*\)/gi, ' ').match(/[A-Z][A-Z0-9_+]+/g) || []).find(d => d !== pin.domain && (f.domains || []).includes(d)));
            const pnet = partner && domainNet(M, ref, partner);
            add('supply.unpowered', 'error', label + ' is not on a supply rail' + (pnet ? ': tie it to ' + partner + ' (' + pnet + ')' : ''), 'Its net ' + net + ' has no known voltage and nothing that supplies one: no regulator output, connector, or rail reached through an inductor, ferrite bead, or series resistor up to 1 kΩ. On it: ' + nodes.filter(n => n.ref !== ref).map(n => n.ref + ' ' + ((M.filePin(n.ref, n.pin) || (M.parts.get(n.ref) || { pins: [] }).pins.find(x => x.num === n.pin) || {}).name || n.pin)).slice(0, 8).join(', ') + '.' +
              (ports.length ? ' On the sheets it is drawn on power port ' + ports.join(' and ') + (lonely.length ? ', which nothing else in the design is on, so it looks connected but carries nothing' : '') + '.' : '') +
              (pnet ? ' The part file says: ' + line + '.' : ' Check it isn\'t swapped with a neighboring pin.'), Object.assign({}, where, pnet ? { nets: [net, pnet] } : {}));
          }
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
              // A programmable source can be set above what this pin takes (2026-11-13).
              const am2 = absmax ? lim(absmax.value != null ? absmax.value : absmax.max) : null;
              if (!high && nv.vprog != null && hi != null && nv.vprog > hi + 1e-6) add('supply.range', 'warn', label + ' would be at ' + fmtV(nv.vprog) + ' if ' + nv.reg + ' is set to its maximum', net + ' comes from ' + nv.reg + ', which powers up at ' + fmtV(nv.v) + ' but can be set up to ' + fmtV(nv.vprog) + ' (' + nv.from + '). ' + pin.domain + '\'s recommended maximum is ' + fmtV(hi) + (am2 != null ? ', absolute ' + fmtV(am2) + (nv.vprog > am2 ? ', which it would exceed' : '') : '') + '. Cap the setting in firmware at ' + fmtV(hi) + '.', Object.assign({ basis: [basisOf(f, range)].concat(nv.progBasis ? [nv.progBasis] : []), key: key + ' prog' }, where));
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
          // On a net, but with nothing on this board to hold it (2026-11-13): driven only through a connector, or only by
          // MCU pins, which float in reset. A pull that lets go once driven ("smart" pull-downs) doesn't count.
          const keeps = pulled && !/smart|releas|disconnect|lets go/i.test([pin.reset, pin.note, (val('en.default') || {}).text].filter(Boolean).join(' '));
          if (!alone && net && !keeps && !NV.ground.has(net) && !NV.V.has(net)) {
            const others = nodes.filter(n => n.ref !== ref).map(n => ({ n, q: M.parts.get(n.ref), fp: M.filePin(n.ref, n.pin) }));
            const pull = others.some(o => o.q && (o.q.kind === 'resistor' || o.q.kind === 'capacitor'));
            const conn = others.filter(o => o.q && (o.q.kind === 'connector' || (M.files.get(o.q.ref) || {}).kind === 'connector'));
            const mcu = others.filter(o => (M.files.get(o.n.ref) || {}).kind === 'mcu');
            // An MCU's reset and boot pins have internal pulls and belong on a debug header; this is for other parts.
            if (!pull && others.length && conn.length === others.length && f.kind !== 'mcu') add('pins.float', 'warn', label + ' is driven only through ' + [...new Set(conn.map(o => o.n.ref))].join(', '), 'Nothing on this board holds ' + net + ': with the other board off, in reset, or unplugged it floats, and ' + ref + ' may come out of ' + (pin.role === 'reset' ? 'reset' : 'shutdown') + ' on its own. Add a pull to its safe level here.', where);
            else if (!pull && mcu.length && mcu.length === others.length && pin.role === 'enable') add('pins.float', 'warn', label + ' floats while ' + mcu[0].n.ref + ' is in reset', 'Only ' + mcu.map(o => o.n.ref + ' ' + ((o.fp || {}).name || o.n.pin)).join(', ') + ' drive' + (mcu.length === 1 ? 's' : '') + ' ' + net + ', and MCU pins float during and after reset.' + (pulled ? ' ' + ref + '\'s own pull lets go once the pin has been driven high, so after a reset with it on, it floats.' : ' ' + ref + ' has no internal pull.') + ' Add a pull-down (100 kΩ to 1 MΩ).', where);
          }
        }

        // I/O levels.
        if (net && !['power-in', 'power-out', 'ground', 'pad', 'bus', 'nc', 'dnc', 'switch', 'bootstrap', 'feedback'].includes(pin.role)) {
          const highs = highLevels(M, NV, net).filter(h => !(h.ref === ref && h.pin === pin.num));
          const top = highs.length ? highs.reduce((a, b) => (b.v > a.v ? b : a)) : null;
          const own = pin.absmax != null ? { v: evalExpr(pin.absmax, doms), basis: null, src: 'this pin\'s absolute maximum' } : null;
          const dom = pin.domain;
          const ioAbs = dom && val('io.absmax', dom), ftAbs = pin.ft && val('io.ft.absmax');
          const limit = own && own.v != null ? own : ftAbs ? { v: evalExpr(ftAbs.value != null ? ftAbs.value : ftAbs.max, doms), b: ftAbs, src: '5 V tolerant pins\' absolute maximum' } : ioAbs ? { v: evalExpr(ioAbs.value != null ? ioAbs.value : ioAbs.max, doms), b: ioAbs, src: dom + ' I/O absolute maximum' } : null;
          const ownRail = top && top.kind === 'pull-up' && top.ref == null && dom && domainNet(M, ref, dom) === net && limit && typeof (limit.b ? (limit.b.value != null ? limit.b.value : limit.b.max) : pin.absmax) === 'string';
          if (top && limit && limit.v != null && !ownRail) {
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
              // VOL is specified at a test current (4 mA); into CMOS inputs that sink nanoamps the low is millivolts. Only
              // pull-ups on the net make the driver sink current, so compare only when they draw a tenth of the test current.
              const it = /(\d+(?:\.\d+)?)\s*(m|µ|u)A/i.exec((vol.cond || '') + ' ' + (vol.note || ''));
              if (it) {
                const test = parseFloat(it[1]) * (it[2].toLowerCase() === 'm' ? 1e-3 : 1e-6);
                let sink = 0;
                for (const n2 of M.nets.get(h.net || net) || []) { const q = M.parts.get(n2.ref); if (!q || q.kind !== 'resistor') continue; const e = twoPin(M, q); const o = e && (e[0] === (h.net || net) ? e[1] : e[0]); const rv = passiveValue(q, 'Ω'); if (o && NV.V.has(o) && rv && rv.v > 1) sink += NV.V.get(o).v / rv.v; }
                if (sink < 0.1 * test) continue;
              }
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
        const total = caps.reduce((s, c) => s + (c.v || 0), 0);
        const capList = caps.length ? caps.map(c => c.ref + ' ' + (c.v != null ? P.fmt(c.v, 'F') : '?')).join(', ') : 'none';
        if (need) {
          const near = caps.filter(c => c.v != null && c.v >= need * 0.5);
          // Smaller capacitors in parallel make up a microfarad-class value (two 10 µF for 22 µF); not for high-frequency nanofarads.
          const madeUp = need >= 1e-6 && total >= need * pins.length * 0.85;
          const ms = new Set((p.sheets || []).filter(s => /\.schdoc$/i.test(s)));
          const loc = ms.size ? caps.filter(c => { const q = M.parts.get(c.id); return q && (q.sheets || []).some(s => ms.has(s)); }) : caps;
          const locOk = loc.filter(c => c.v != null && c.v >= need * 0.5).length >= pins.length || (need >= 1e-6 && loc.reduce((s, c) => s + (c.v || 0), 0) >= need * pins.length * 0.85);
          if ((near.length >= pins.length || madeUp) && need >= 1e-6 && !locOk) add('parts.decoupling', 'info', ref + ' ' + dom + '\'s ' + P.fmt(need, 'F') + ' is on another sheet', 'On ' + [...ms].join(', ') + ' with ' + ref + ': ' + (loc.length ? loc.map(c => c.ref + ' ' + (c.v != null ? P.fmt(c.v, 'F') : '?')).join(', ') : 'none') + '. The ' + P.fmt(need, 'F') + ' it counts (' + caps.filter(c => !loc.includes(c)).map(c => c.ref).slice(0, 8).join(', ') + ') is drawn by other parts, so it\'s probably placed by them. Add one at ' + ref + '\'s pins, or confirm the layout puts one there.', { refs: [ref].concat(loc.map(c => c.id)), nets: netsD, basis: [basisOf(f, dc)], key: ref + ' ' + dom + ' local' });
          if (near.length < pins.length && !madeUp) add('parts.decoupling', 'warn', ref + ' ' + dom + ': ' + (caps.length ? P.fmt(total, 'F') + ' in ' + caps.length + ' capacitor' + (caps.length === 1 ? '' : 's') : 'no decoupling capacitor') + ' for ' + pins.length + ' supply pin' + (pins.length === 1 ? '' : 's') + ' wanting ' + P.fmt(need, 'F') + ' each', 'The part file asks for ' + P.fmt(need, 'F') + ' at each ' + dom + ' pin. On ' + netsD.join(', ') + ': ' + capList + '. Capacitors anywhere on the net, or past a 0 Ω link, count, so check they sit at the pins.', { refs: [ref].concat(caps.map(c => c.id)).slice(0, 30), nets: netsD, basis: [basisOf(f, dc)] });
        }
        const b = bulk && (bulk.value != null ? bulk.value : bulk.min);
        if (b) {
          // Bulk the datasheet asks for only in some cases ("if the supply is more than a few centimeters away") is a note.
          const cond = /remote|far|away|distance|more than a few|long (cable|wire|lead)|if the (input )?(supply|source)|typical selection|recommended if/i.test((bulk.cond || '') + ' ' + (bulk.note || ''));
          // Bulk counts where the part is: capacitors on another sheet sit by other parts (a real board's amplifier, 2026-11-13).
          const mySheets = new Set((p.sheets || []).filter(s => /\.schdoc$/i.test(s)));
          const local = mySheets.size ? caps.filter(c => { const q = M.parts.get(c.id); return q && (q.sheets || []).some(s => mySheets.has(s)); }) : caps;
          const localTotal = local.reduce((s, c) => s + (c.v || 0), 0);
          if (total < b * 0.9) add('parts.decoupling', cond ? 'info' : 'warn', ref + ' ' + dom + ' has ' + P.fmt(total, 'F') + ' on its rail, less than ' + P.fmt(b, 'F') + ' bulk', 'Every capacitor to ground on ' + netsD.join(', ') + ' counted.' + (cond ? ' The datasheet asks for it only in some cases: ' + (bulk.cond || bulk.note) + '.' : ''), { refs: [ref], nets: netsD, basis: [basisOf(f, bulk)] });
          else if (localTotal < b * 0.9 && local.length < caps.length) add('parts.decoupling', cond || b < 4.7e-6 ? 'info' : 'warn', ref + ' ' + dom + '\'s ' + P.fmt(b, 'F') + ' bulk is on another sheet', 'On ' + [...mySheets].join(', ') + ' with ' + ref + ': ' + (local.length ? local.map(c => c.ref + ' ' + P.fmt(c.v || 0, 'F')).join(', ') : 'none') + ' (' + P.fmt(localTotal, 'F') + '). The rest (' + caps.filter(c => !local.includes(c)).map(c => c.ref).slice(0, 8).join(', ') + ') is drawn by other parts, so it\'s probably placed by them. Add bulk at ' + ref + '\'s pins, or confirm the layout puts some there.', { refs: [ref].concat(local.map(c => c.id)), nets: netsD, basis: [basisOf(f, bulk)], key: ref + ' ' + dom + ' local' });
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
        // Saturation (2026-11-13): the inductor's rating against what the regulator needs (reg.l.isat, else its switch
        // current limit). Unknown ratings: a chip inductor in 0603 or smaller is well under an amp.
        const isat = val('reg.l.isat'), ilim = val('reg.ilim');
        const needI = isat ? (isat.value != null ? isat.value : isat.min) : ilim ? (ilim.max != null ? ilim.max : ilim.typ != null ? ilim.typ : ilim.value) : null;
        if (needI && inds.length) for (const q of inds) {
          tick('parts.regulator');
          const lf = M.files.get(q.ref), ls = lf && (M.valueOf(lf, 'l.isat') || M.valueOf(lf, 'rate.i'));
          const txt = [q.params.Description, q.description, q.params.Comment, q.params.Value].filter(Boolean).join(' ');
          const fromText = (/(\d+(?:\.\d+)?)\s*A\b(?!\w)/.exec(txt) || [])[1];
          const have = ls ? (ls.value != null ? ls.value : ls.min != null ? ls.min : ls.typ) : fromText != null ? +fromText : null;
          const size = (/\b(01005|0201|0402|0603|1005|1608)\b/.exec([q.params.Footprint, q.footprint, q.params.PackageReference, txt].filter(Boolean).join(' ')) || [])[1];
          const why = isat ? 'needs ' + P.fmt(needI, 'A') + ' saturation current' + (isat.cond ? ' (' + isat.cond + ')' : '') : 'switch current limit is up to ' + P.fmt(needI, 'A');
          const b = [basisOf(f, isat || ilim)].concat(ls ? [basisOf(lf, ls)] : []);
          if (have != null && have < needI * 0.999) add('parts.regulator', 'warn', q.ref + ' is rated ' + P.fmt(have, 'A') + '; ' + ref + ' ' + why, (ls ? 'From ' + lf.mpn + '.' : 'From ' + q.ref + '\'s description.') + ' An inductor that saturates at the current limit loses its inductance and lets the current spike.', { refs: [ref, q.ref], basis: b, key: q.ref + ' isat' });
          else if (have == null && size && needI >= 0.8) add('parts.regulator', 'warn', q.ref + ' is a ' + size + ' inductor; ' + ref + ' ' + why, q.ref + '\'s saturation current isn\'t known (no part file or rating in its parameters), and chip inductors that small are usually rated well under an amp. Check its datasheet, or use a larger one.', { refs: [ref, q.ref], basis: b, key: q.ref + ' isat' });
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
    connectorChecksMore({ M, NV, add, tick });
    return finish();

    // Checks that came from a Claude scan of a real board (docs/claude-scan.md, docs/learned.md, 2026-11-13).
    function netChecks() {
      const names = M.sheetNames;
      const pinName = (ref, num) => ((M.filePin(ref, num) || (M.parts.get(ref) || { pins: [] }).pins.find(x => String(x.num) === String(num)) || {}).name) || num;
      const isTP = q => /^TP/i.test(q.ref) || /\btest\s*point\b|^TP[_-]/i.test([q.params.Footprint, q.params.Description, q.libRef, q.description].filter(Boolean).join(' '));
      const isConn = q => q && (q.kind === 'connector' || (M.files.get(q.ref) || {}).kind === 'connector');
      const signal = n => !NV.ground.has(n) && !NV.V.has(n);
      const doms = ref => domainVoltages(M, NV, ref);
      const valOf = v => (v == null ? null : v.value != null ? v.value : v.max != null ? v.max : v.typ != null ? v.typ : v.min);
      // Nets joined to this one by 0 Ω links (1 Ω or less, and jumpers).
      const linked = net => { const out = [net]; for (let i = 0; i < out.length && out.length < 12; i++) for (const n of M.nets.get(out[i]) || []) { const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor') continue; const rv = passiveValue(q, 'Ω'); if (!rv || rv.dnp || rv.v == null || rv.v > 1) continue; const e = twoPin(M, q); const o = e && (e[0] === out[i] ? e[1] : e[0]); if (o && !out.includes(o) && !NV.ground.has(o)) out.push(o); } return out; };
      // A rail some signal turns on and off: it comes through a load switch whose enable is driven, not tied.
      const ctlSwitched = net => railRoot(M, NV, net).refs.some(x => { const f = M.files.get(x); if (!f || f.kind !== 'switch') return false; const en = f.pins.find(p => p.role === 'enable'); const n = en && M.netOf.get(x + '.' + en.num); return !!n && linked(n).every(signal); });

      // Nets with two names: a power port and a net label (or two of either) on one wire. Altium keeps one.
      for (const [net, s] of names) {
        tick('nets.names');
        const all = [...s.powers, ...s.labels].filter((x, i, a) => a.findIndex(y => y.toUpperCase() === x.toUpperCase()) === i);
        if (all.length < 2) continue;
        // In a hierarchical design net labels are local to their sheet: only a power port against another name counts.
        if (names.hier && !(s.powers.size && all.length > s.powers.size) && s.powers.size < 2) continue;
        const kept = stripChan(net), lost = all.filter(x => x.toUpperCase() !== kept.toUpperCase());
        const what = x => (s.powers.has(x) ? 'power port ' : 'net label ') + x;
        const elsewhere = lost.filter(x => [...names].some(([n2, s2]) => n2 !== net && (s2.powers.has(x) || s2.labels.has(x))));
        add('nets.names', 'warn', net + ' also carries ' + lost.join(' and ') + ' on the sheets', 'One wire carries ' + all.map(what).join(' and ') + '. The netlist names the net ' + kept + ', so ' + lost.join(' and ') + (lost.length === 1 ? ' is' : ' are') + ' dropped: ' + (elsewhere.length ? 'it isn\'t joined to the rest of ' + elsewhere.join(' and ') + ' elsewhere in the design.' : 'nothing else in the design uses ' + (lost.length === 1 ? 'that name' : 'those names') + ' either.') + ' On it: ' + (M.nets.get(net) || []).map(n => n.ref + '.' + n.pin + ' ' + pinName(n.ref, n.pin)).slice(0, 8).join(', ') + '.', { nets: [net], refs: [...new Set((M.nets.get(net) || []).map(n => n.ref))].slice(0, 12), pins: (M.nets.get(net) || []).map(n => n.ref + '.' + n.pin).slice(0, 12) });
      }

      // Signal nets that reach nothing: one part (often a protection channel and its own flow-through pin), or one
      // connector pin and test points.
      for (const [net, nodes] of M.nets) {
        if (!signal(net) || isAuto(net, M) || nodes.length < 2) continue;
        const qs = [...new Set(nodes.map(n => n.ref))].map(r => M.parts.get(r)).filter(Boolean);
        const real = qs.filter(q => !isTP(q)), tps = qs.filter(isTP);
        tick('nets.dangling');
        if (real.length !== 1) continue;
        const q = real[0], f = M.files.get(q.ref);
        if (isConn(q) && tps.length) add('nets.dangling', 'warn', net + ' reaches only ' + q.ref + ' pin ' + nodes.filter(n => n.ref === q.ref).map(n => n.pin).join(', ') + ' and test points', 'Nothing else on this board is on ' + net + ' (' + tps.map(t => t.ref).join(', ') + ' are test points). A signal named for a part or an interface usually goes somewhere: check it isn\'t a misnamed or unrouted net.', { refs: [q.ref].concat(tps.map(t => t.ref)), pins: nodes.map(n => n.ref + '.' + n.pin), nets: [net] });
        else if (!tps.length && !isConn(q) && (f ? f.kind === 'protection' : false)) add('nets.dangling', 'info', net + ' reaches only ' + q.ref + ', a protection part', q.ref + ' pins ' + nodes.map(n => n.pin).join(' and ') + ' are on ' + net + ' and nothing else is, so that channel protects nothing. Finish the connection, or mark it unused.', { refs: [q.ref], pins: nodes.map(n => n.ref + '.' + n.pin), nets: [net] });
        else if (!tps.length && !isConn(q) && !f) add('nets.dangling', 'info', net + ' reaches only ' + q.ref, 'Only ' + q.ref + ' pins ' + nodes.map(n => n.pin).join(' and ') + ' are on ' + net + '.', { refs: [q.ref], pins: nodes.map(n => n.ref + '.' + n.pin), nets: [net] });
      }

      // Two or more pull resistors from one net to one rail.
      for (const [net, nodes] of M.nets) {
        if (!signal(net)) continue;
        const by = new Map();
        for (const n of nodes) {
          const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor' || q.link) continue;
          const e = twoPin(M, q); const o = e && (e[0] === net ? e[1] : e[0]);
          if (!o || !NV.V.has(o) || NV.ground.has(o)) continue;
          const v = passiveValue(q, 'Ω'); if (v && (v.dnp || (v.v != null && v.v <= 1))) continue;
          if (!by.has(o)) by.set(o, []); by.get(o).push({ ref: q.ref, v: v && v.v });
        }
        for (const [rail, rs] of by) {
          tick('nets.pulls');
          if (rs.length < 2) continue;
          const known = rs.filter(r => r.v), par = known.length === rs.length ? 1 / known.reduce((s, r) => s + 1 / r.v, 0) : null;
          add('nets.pulls', 'info', net + ' has ' + rs.length + ' pull resistors to ' + rail, rs.map(r => r.ref + ' ' + (r.v ? P.fmt(r.v, 'Ω') : '(no value)')).join(' and ') + (par ? ', ' + P.fmt(par, 'Ω') + ' together' : '') + '. Usually one is meant; check the parallel value is what the net needs.', { refs: rs.map(r => r.ref), nets: [net, rail] });
        }
      }

      // Value, Comment, and Description that disagree, a value of "?", and an IC whose Value names another part.
      const SIZE = /\b(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)\b/;
      for (const q of M.parts.values()) {
        if (q.link) continue;
        const pr = q.params || {};
        const fields = [['Value', pr.Value], ['Comment', pr.Comment], ['Description', pr.Description || q.description]].filter(([, t]) => t && !/^=/.test(t) && !/\de[-+]?\d/i.test(t));
        const say = [];
        if (['resistor', 'capacitor', 'inductor'].includes(q.kind)) {
          tick('parts.fields');
          if (fields.some(([k, t]) => k !== 'Description' && /^\s*\?+\s*$/.test(t)) && !fields.some(([k, t]) => k !== 'Description' && /\d/.test(t))) say.push('its value is "?"');
          const unit = q.kind === 'resistor' ? 'Ω' : q.kind === 'capacitor' ? 'F' : 'H';
          const vals = fields.map(([k, t]) => [k, passiveValue({ params: { Value: t }, kind: q.kind }, unit)]).filter(([, v]) => v && v.v != null);
          for (let i = 1; i < vals.length; i++) if (Math.abs(vals[i][1].v - vals[0][1].v) > 0.011 * Math.max(vals[i][1].v, vals[0][1].v)) { say.push('its ' + vals[0][0] + ' says ' + P.fmt(vals[0][1].v, unit) + ' and its ' + vals[i][0] + ' ' + P.fmt(vals[i][1].v, unit)); break; }
          if (q.kind === 'capacitor') {
            const volts = fields.map(([k, t]) => [k, (/(\d+(?:\.\d+)?)\s*V(?:DC)?\b/i.exec(t) || [])[1]]).filter(([, v]) => v);
            for (let i = 1; i < volts.length; i++) if (+volts[i][1] !== +volts[0][1]) { say.push('its ' + volts[0][0] + ' says ' + volts[0][1] + ' V and its ' + volts[i][0] + ' ' + volts[i][1] + ' V'); break; }
          }
          const sizes = [['PackageReference', pr.PackageReference], ['Footprint', pr.Footprint || q.footprint]].map(([k, t]) => [k, (SIZE.exec(t || '') || [])[1]]).filter(([, v]) => v);
          if (sizes.length === 2 && sizes[0][1] !== sizes[1][1]) say.push('its ' + sizes[0][0] + ' is ' + sizes[0][1] + ' and its ' + sizes[1][0] + ' ' + sizes[1][1]);
        } else if (q.kind === 'ic' && q.mpn && pr.Value && !isConn(q)) {
          tick('parts.fields');
          const a = String(pr.Value).toUpperCase().replace(/[^A-Z0-9]/g, ''), b = q.mpn.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (PK.design && /[A-Z]/.test(a) && /\d/.test(a) && a.length >= 5 && !a.includes(b.slice(0, 5)) && !b.includes(a.slice(0, 5)) && !/^(VALUE|COMMENT)$/.test(a)) say.push('its Value says ' + pr.Value + ' but its part number is ' + q.mpn);
        }
        if (say.length) add('parts.fields', 'warn', q.ref + ': ' + say[0], (say.length > 1 ? 'Also ' + say.slice(1).join('; ') + '. ' : '') + 'A BOM built from one field gets a different part than one built from another. Make the fields agree.', { refs: [q.ref] });
      }

      // Rails that come only through a connector and feed loads but no regulator: they're up only when the other board is.
      for (const [net, s] of NV.V) {
        if (NV.ground.has(net) || s.input || s.reg || !(s.v > 0)) continue; // a regulator made it (through an inductor too)
        const loads = (M.nets.get(net) || []).filter(n => (M.filePin(n.ref, n.pin) || {}).role === 'power-in');
        if (!loads.length || loads.some(n => ['regulator', 'switch'].includes((M.files.get(n.ref) || {}).kind))) continue;
        if ((M.nets.get(net) || []).some(n => (M.filePin(n.ref, n.pin) || {}).role === 'power-out')) continue;
        tick('supply.offboard');
        const r = railRoot(M, NV, net);
        const c = r.root && M.parts.get(r.root);
        if (!c || !isConn(c) || r.refs.some(x => M.files.get(x) && M.files.get(x).kind !== 'connector')) continue;
        const conns = [...new Set((M.nets.get(net) || []).map(n => M.parts.get(n.ref)).filter(isConn).map(q => q.ref))];
        if (conns.length > 1) conns.sort((a, b) => M.parts.get(b).pins.length - M.parts.get(a).pins.length);
        add('supply.offboard', 'info', net + ' comes only through ' + (conns.length ? conns.join(', ') : c.ref) + ': nothing on this board makes it', 'It feeds ' + [...new Set(loads.map(n => n.ref + ' ' + pinName(n.ref, n.pin)))].slice(0, 6).join(', ') + ', which run only while the board on ' + c.ref + ' supplies ' + net + '. Fine if meant; then their decoupling here, and power-up with that board unplugged, matter more.', { refs: [c.ref].concat(loads.map(n => n.ref)).slice(0, 10), nets: [net] });
      }

      // I2C buses: pull-ups, and the voltage window every part on the bus takes.
      const I2C_PIN = /^(I2C\d*_)?(SDA|SCL|SCLK|SDAT)\d?$/i;
      const busNets = new Map();
      for (const [net, nodes] of M.nets) {
        if (!signal(net)) continue;
        const pins = nodes.map(n => ({ n, fp: M.filePin(n.ref, n.pin) })).filter(x => x.fp && (I2C_PIN.test(x.fp.name) || (x.fp.functions || []).some(fn => /I2C\d*[\s_]+(SDA|SCL)\b/i.test(fn)) && /SDA|SCL/i.test(net + x.fp.name)));
        if (pins.length) busNets.set(net, pins);
      }
      const doneBus = new Set();
      for (const [net, pins] of busNets) {
        if (doneBus.has(net)) continue;
        const pair = [net].concat([...busNets.keys()].filter(n => n !== net && n.replace(/SDA|SCLK|SCL/i, '#').toUpperCase() === net.replace(/SDA|SCLK|SCL/i, '#').toUpperCase()));
        pair.forEach(n => doneBus.add(n));
        tick('func.i2cpull');
        // A pull-up past a series resistor (logicNode) or in a resistor array counts; an array whose other side is unknown
        // makes "none" uncertain, so it's a warning then.
        let unsure = false;
        const pulledUp = n => logicNode(M, n).some(({ net: ln }) => (M.nets.get(ln) || []).some(x => {
          const q = M.parts.get(x.ref); if (!q || q.link) return false;
          const arr = /^R[NA]\d/i.test(q.ref) || (q.kind === 'resistor' && q.pins.length > 2);
          if (q.kind !== 'resistor' && !arr) return false;
          const others = q.pins.filter(pp => String(pp.num) !== String(x.pin)).map(pp => M.netOf.get(q.ref + '.' + pp.num)).filter(o => o && o !== ln);
          if (others.some(o => NV.V.has(o) && NV.V.get(o).v > 0)) return true;
          if (arr) unsure = true;
          return false;
        }));
        const pulled = pair.filter(pulledUp);
        if (pulled.length === pair.length) continue;
        const devs = [].concat(...pair.map(n => busNets.get(n))).filter((x, i, a) => a.findIndex(y => y.n.ref === x.n.ref && y.n.pin === x.n.pin) === i);
        let hi = null, hiBy = '', lo = null, loBy = '';
        for (const { n, fp } of devs) {
          const f = M.files.get(n.ref), d = doms(n.ref);
          const lims = [[fp.vmax, 'recommended'], [fp.absmax, 'absolute']].filter(([v]) => v != null).map(([v, k]) => [evalExpr(v, d), k]);
          const ioa = fp.domain && M.valueOf(f, 'io.absmax', fp.domain);
          if (!lims.length && ioa) lims.push([evalExpr(valOf(ioa), d), 'absolute']);
          for (const [v, k] of lims) if (v != null && (hi == null || v < hi)) { hi = v; hiBy = n.ref + ' ' + fp.name + ' (' + k + ' maximum)'; }
          const vih = fp.domain && M.valueOf(f, 'io.vih', fp.domain);
          const vv = vih && evalExpr(vih.value != null ? vih.value : vih.min != null ? vih.min : vih.max, d);
          if (vv != null && (lo == null || vv > lo)) { lo = vv; loBy = n.ref + ' ' + fp.name + ' (VIH)'; }
        }
        const conn = pair.some(n => (M.nets.get(n) || []).some(x => isConn(M.parts.get(x.ref))));
        const window = lo != null || hi != null ? ' Pull them up to a rail between ' + (lo != null ? fmtV(lo) + ' (' + loBy + ')' : '…') + ' and ' + (hi != null ? fmtV(hi) + ' (' + hiBy + ')' : '…') + '.' : '';
        const refs = [...new Set(devs.map(x => x.n.ref))];
        if (conn) add('func.i2cpull', 'warn', pair.join(' and ') + ' have no pull-ups on this board', 'The bus leaves through a connector, so the pull-ups must be on the other board.' + window + ' On it: ' + refs.join(', ') + '.', { refs, nets: pair, pins: devs.map(x => x.n.ref + '.' + x.n.pin).slice(0, 12) });
        else add('func.i2cpull', unsure ? 'warn' : 'error', pair.join(' and ') + ' have no pull-ups', 'I2C lines are open-drain and need a pull-up each.' + (unsure ? ' A resistor array is on the bus, but its other side isn\'t on a known rail; check it.' : '') + window, { refs, nets: pair });
      }

      // Signal switches that start open, with nothing on this board to close them.
      for (const [ref, f] of M.files) {
        const sd = M.valueOf(f, 'sw.default');
        if (!sd || !/\b(open|off|disconnected|power[\s-]?down)\b/i.test(sd.text || '')) continue;
        tick('func.switch');
        // Its control lines: I2C, or an enable that's a signal (one tied to a rail or ground is set, not controlled).
        const ctl = f.pins.filter(x => I2C_PIN.test(x.name) || x.role === 'enable').map(x => M.netOf.get(ref + '.' + x.num)).filter(n => n && signal(n));
        const master = ctl.some(n => (M.nets.get(n) || []).some(x => x.ref !== ref && (M.files.get(x.ref) || {}).kind === 'mcu'));
        if (master || !ctl.length) continue;
        add('func.switch', 'warn', ref + '\'s switch starts open, and nothing on this board can close it', f.mpn + ': ' + sd.text + '. Its control (' + [...new Set(ctl)].join(', ') + ') reaches no MCU on this board, so the signals through it are cut until something on another board sets it, which can\'t happen before that board\'s firmware runs (a USB boot loader, for one). Add a bypass, or a controller here.', { refs: [ref], nets: [...new Set(ctl)], basis: [basisOf(f, sd)] });
      }

      // Strap pins that become outputs after they're read: tie them through a resistor, never straight to a rail.
      for (const [ref, f] of M.files) {
        for (const pin of f.pins) {
          const txt = (pin.functions || []).join(' ') + ' ' + (pin.note || '');
          if (!/\bstrap\b/i.test(txt + ' ' + pin.role) && pin.role !== 'boot') continue;
          if (!/\boutput\b/i.test(txt)) continue;
          const net = M.netOf.get(ref + '.' + pin.num); if (!net) continue;
          tick('straps.output');
          if (!NV.ground.has(net) && !(NV.V.has(net) && NV.V.get(net).v > 0)) continue;
          add('straps.output', 'warn', ref + ' ' + pin.name + ' is tied straight to ' + net, 'It is read as a strap at power-up and can then become an output (' + (pin.functions || []).filter(x => /output/i.test(x)).join('; ') + '). Driven into ' + net + ' it shorts. Strap it through a resistor' + (pin.ext ? ' (' + pin.ext + ')' : '') + '.', { refs: [ref], pins: [ref + '.' + pin.num], nets: [net] });
        }
      }

      // Current-sense resistors: the current a gauge or protector measures and protects at.
      for (const [ref, f] of M.files) {
        const vfs = M.valueOf(f, 'sense.vfs'); if (!vfs) continue;
        const sp = f.pins.find(x => /^(CSP|SNSP|ISNS\+|SENSE\+|SRP|CS\+|ISP)$/i.test(x.name)), sn = f.pins.find(x => /^(CSN|SNSN|ISNS-|SENSE-|SRN|CS-|ISN)$/i.test(x.name));
        const a = sp && M.netOf.get(ref + '.' + sp.num), b = sn && M.netOf.get(ref + '.' + sn.num);
        if (!a || !b) { skip('parts.sense'); continue; }
        const r = (M.nets.get(a) || []).map(n => M.parts.get(n.ref)).find(q => q && q.kind === 'resistor' && (twoPin(M, q) || []).includes(b));
        const rv = r && passiveValue(r, 'Ω');
        tick('parts.sense');
        if (!rv || !rv.v) { add('parts.sense', 'info', ref + '\'s sense resistor between ' + sp.name + ' and ' + sn.name + ' wasn\'t found', 'No resistor with a value joins ' + a + ' and ' + b + '.', { refs: [ref], nets: [a, b] }); continue; }
        const v = valOf(vfs), i = v / rv.v;
        add('parts.sense', 'info', ref + ' measures and protects up to about ' + P.fmt(i, 'A') + ' through ' + r.ref + ' (' + P.fmt(rv.v, 'Ω') + ')', f.mpn + '\'s sense full scale is ' + P.fmt(v, 'V') + (vfs.cond ? ' (' + vfs.cond + ')' : '') + '. A peak load above about ' + P.fmt(i, 'A') + ' trips its protection or saturates its measurement; compare with the peak current of everything the battery feeds.', { refs: [ref, r.ref], nets: [a, b], basis: [basisOf(f, vfs)] });
      }

      // Chargers fed from a regulator whose power-up default is below the charge voltage.
      for (const [ref, f] of M.files) {
        const cv = M.valueOf(f, 'reg.vout.range');
        if (f.kind !== 'power' || !cv || cv.min == null) continue;
        for (const pin of f.pins.filter(x => x.role === 'power-in' && !/^(BATT?|VBAT|CELL|VDD|VCC|REG)$/i.test(x.name))) {
          const net = M.netOf.get(ref + '.' + pin.num); if (!net) continue;
          // The source: this net's, or one a resistor up to 10 kΩ away (a detection pin's series resistor).
          let src = NV.V.get(net), via = '';
          if (!src || !src.reg) for (const n of M.nets.get(net) || []) { const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor') continue; const rv = passiveValue(q, 'Ω'); if (!rv || rv.dnp || rv.v > 1e4) continue; const e = twoPin(M, q); const o = e && (e[0] === net ? e[1] : e[0]); const s2 = o && NV.V.get(o); if (s2 && s2.reg) { src = s2; via = ' through ' + q.ref; break; } }
          if (!src || !src.reg) continue;
          const rf = M.files.get(src.reg), def = rf && M.valueOf(rf, 'reg.vout'), prog = rf && M.valueOf(rf, 'reg.vout.range');
          const dv = def && (def.typ != null ? def.typ : def.value);
          if (dv == null) continue;
          tick('supply.charge');
          if (dv >= cv.min + 0.15) continue;
          add('supply.charge', 'warn', ref + ' ' + pin.name + ' is fed from ' + src.reg + ', which starts at ' + fmtV(dv) + ', below the ' + fmtV(cv.min) + ' charge voltage', ref + ' (' + f.mpn + ') charges from ' + pin.name + ' (' + net + via + '), whose source ' + src.reg + ' (' + rf.mpn + ') powers up at ' + fmtV(dv) + (prog ? ' and is programmable up to ' + fmtV(prog.max) : '') + '. Until something raises it above the cell, nothing charges' + (prog ? '; record which controller does, and what happens if it doesn\'t run' : '') + '.', { refs: [ref, src.reg], pins: [ref + '.' + pin.num], nets: [net], basis: [basisOf(f, cv), basisOf(rf, def)] });
        }
      }

      // An overvoltage cutoff set above what the protected rail's loads take.
      for (const [ref, f] of M.files) {
        const ov = M.valueOf(f, 'sw.ovlo'); if (!ov || NV.held.has(ref)) continue;
        const op = f.pins.find(x => /^OVLO|^OV$|OVP$/i.test(x.name)); if (!op) continue;
        const onet = M.netOf.get(ref + '.' + op.num); if (!onet) continue;
        const inNets = f.pins.filter(x => /^V?IN\d?$/i.test(x.name)).map(x => M.netOf.get(ref + '.' + x.num));
        let top = null, bot = null;
        for (const n of M.nets.get(onet) || []) { const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor') continue; const e = twoPin(M, q); const o = e && (e[0] === onet ? e[1] : e[0]); const v = passiveValue(q, 'Ω'); if (!o || !v || v.dnp || !v.v) continue; if (NV.ground.has(o)) bot = { q, v: v.v }; else if (inNets.includes(o)) top = { q, v: v.v }; }
        if (!top || !bot) { skip('supply.range'); continue; }
        const k = 1 + top.v / bot.v, tmax = (ov.max != null ? ov.max : valOf(ov)) * k, ttyp = (ov.typ != null ? ov.typ : valOf(ov)) * k;
        const outs = f.pins.filter(x => /^V?OUT\d?$/i.test(x.name)).map(x => M.netOf.get(ref + '.' + x.num)).filter(Boolean);
        const over = [];
        for (const on of [...new Set(outs)]) for (const n of M.nets.get(on) || []) {
          if (n.ref === ref) continue;
          const fp = M.filePin(n.ref, n.pin), lf = M.files.get(n.ref);
          if (!fp || fp.role !== 'power-in' || !fp.domain) continue;
          const rg = M.valueOf(lf, 'supply.range', fp.domain), mx = rg && evalExpr(rg.max, doms(n.ref));
          if (mx != null && tmax > mx + 1e-6 && !over.some(o => o.ref === n.ref)) over.push({ ref: n.ref, name: fp.name, mx, net: on, basis: basisOf(lf, rg) });
        }
        tick('supply.range');
        if (over.length) add('supply.range', 'warn', ref + '\'s overvoltage cutoff lets ' + over[0].net + ' reach ' + fmtV(tmax) + ', above ' + over.map(o => o.ref + ' ' + o.name + '\'s ' + fmtV(o.mx)).join(', '), top.q.ref + ' ' + P.fmt(top.v, 'Ω') + ' over ' + bot.q.ref + ' ' + P.fmt(bot.v, 'Ω') + ' on ' + op.name + ' set the trip at ' + fmtV(ttyp) + ' (up to ' + fmtV(tmax) + ' with the threshold\'s tolerance). Between the loads\' recommended maximum and the trip, ' + ref + ' passes the input straight through. Lower the trip (a larger ' + bot.q.ref + ' or a smaller ' + top.q.ref + ').', { refs: [ref, top.q.ref, bot.q.ref].concat(over.map(o => o.ref)), pins: [ref + '.' + op.num], nets: [onet].concat(outs), basis: [basisOf(f, ov)].concat(over.map(o => o.basis)), key: ref + ' ovlo' });
      }

      // An MCU's reset held by a buffer whose input is pulled up only to a rail from another board.
      for (const [ref, f] of M.files) {
        if (f.kind !== 'mcu') continue;
        const mainDom = (f.pins.find(x => x.role === 'power-in' && /^VDD$/i.test(x.domain || '')) || f.pins.find(x => x.role === 'power-in') || {}).domain;
        const myRail = mainDom && domainNet(M, ref, mainDom);
        for (const rp of f.pins.filter(x => x.role === 'reset')) {
          const net = M.netOf.get(ref + '.' + rp.num); if (!net) continue;
          for (const n of [].concat(...linked(net).map(x => M.nets.get(x) || []))) {
            const dp = M.filePin(n.ref, n.pin), df = M.files.get(n.ref);
            if (n.ref === ref || !dp || !['open-drain', 'output'].includes(dp.role)) continue;
            for (const ip of df.pins.filter(x => x.role === 'input')) {
              const inet = M.netOf.get(n.ref + '.' + ip.num); if (!inet) continue;
              for (const m of M.nets.get(inet) || []) {
                const q = M.parts.get(m.ref); if (!q || q.kind !== 'resistor' || q.link) continue;
                const e = twoPin(M, q); const rail = e && (e[0] === inet ? e[1] : e[0]);
                if (!rail || !NV.V.has(rail) || !(NV.V.get(rail).v > 0)) continue;
                const rr = railRoot(M, NV, rail), mr = myRail ? railRoot(M, NV, myRail) : { root: null };
                const c = rr.root && M.parts.get(rr.root);
                tick('io.unpowered');
                if (!c || !isConn(c) || rr.refs.some(x => M.files.get(x) && M.files.get(x).kind !== 'connector') || mr.root === rr.root) continue;
                const named = rr.chain[rr.chain.length - 1] || rail;
                add('io.unpowered', 'warn', ref + ' is held in reset whenever ' + named + ' is off: ' + n.ref + '\'s input is pulled up only to it', ref + ' ' + rp.name + ' is driven by ' + n.ref + ' ' + dp.name + ' (' + dp.role + '), whose input ' + ip.name + ' (' + inet + ') is pulled up by ' + q.ref + ' to ' + rail + (named !== rail ? ' (' + named + ')' : '') + ', which comes only through ' + c.ref + '. With that board unplugged or off, ' + n.ref + ' holds ' + ref + ' in reset, so this board can\'t start or be programmed alone. If that\'s meant, note it; else pull the input up to ' + myRail + '.', { refs: [ref, n.ref, q.ref, c.ref], pins: [ref + '.' + rp.num, n.ref + '.' + n.pin, n.ref + '.' + ip.num], nets: [net, inet, rail], key: ref + ' reset ' + rail });
              }
            }
          }
        }
      }

      // MCU pins pulled up from reset into a part or connector on a switched rail: back-powering it until firmware runs.
      for (const [ref, f] of M.files) {
        if (f.kind !== 'mcu') continue;
        const myRail = domainNet(M, ref, (f.pins.find(x => x.role === 'power-in') || {}).domain);
        for (const pin of f.pins) {
          if (!/pull[\s-]?up/i.test(pin.reset || '')) continue;
          const net = M.netOf.get(ref + '.' + pin.num); if (!net || !signal(net)) continue;
          for (const n of M.nets.get(net) || []) {
            const q = M.parts.get(n.ref); if (!q || n.ref === ref) continue;
            let sw = null;
            if (isConn(q)) for (const x of q.pins) { const xn = M.netOf.get(q.ref + '.' + x.num); if (!xn || !NV.V.has(xn) || !(NV.V.get(xn).v > 0) || xn === myRail) continue; if (ctlSwitched(xn)) { sw = xn; break; } }
            else { const fp = M.filePin(n.ref, n.pin); const dn = fp && fp.domain && domainNet(M, n.ref, fp.domain); if (dn && dn !== myRail && ctlSwitched(dn)) sw = dn; }
            if (!sw) continue;
            tick('io.unpowered');
            add('io.unpowered', 'info', ref + ' ' + pin.name + ' pulls up from reset into ' + n.ref + ', whose rail ' + sw + ' is switched', ref + '\'s ' + pin.name + ' comes out of reset with its internal pull-up on' + (pin.functions && pin.functions.length ? ' (' + pin.functions[0] + ')' : '') + ', so it feeds ' + net + ' into ' + n.ref + ' while ' + sw + ' may still be off (back-powering it through the pull-up). Have firmware set the pin low or analog first, or add a pull-down.', { refs: [ref, n.ref], pins: [ref + '.' + pin.num, n.ref + '.' + n.pin], nets: [net, sw], key: ref + '.' + pin.num + ' pu' });
            break;
          }
        }
      }
    }

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
          else if (ex[0] === 'nrst') add('conn.mate', 'warn', title + ' is not connected', 'Without reset the tool can\'t connect under reset, which some firmware (low power, SWD pins reused) needs.', where);
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
  // Connectors nobody has assigned (2026-11-13, from a Claude scan of a real board): debug headers without reset, power
  // coming in unprotected, a current limit above the contacts, load current through small contacts, and the pads of one
  // contact on different nets.
  function connectorChecksMore(C) {
    const { M, NV, add, tick } = C;
    const isConn = q => q && (q.kind === 'connector' || (M.files.get(q.ref) || {}).kind === 'connector');
    const assigned = new Set(M.conn.assign.map(a => a.ref));
    const rateOf = ref => { const f = M.files.get(ref), r = f && M.valueOf(f, 'rate.i'); return r ? { per: r.value != null ? r.value : r.max != null ? r.max : r.typ, basis: basisOf(f, r), f } : null; };
    const pinsOn = (ref, net) => M.parts.get(ref).pins.filter(x => M.netOf.get(ref + '.' + x.num) === net);
    const conns = [...M.parts.values()].filter(isConn);

    // A debug header (SWDIO and SWCLK on it) with no reset line.
    for (const c of conns) {
      if (assigned.has(c.ref)) continue;
      const nets = c.pins.map(x => M.netOf.get(c.ref + '.' + x.num)).filter(Boolean);
      if (!nets.some(n => /SWDIO|SWDAT|TMS/i.test(n)) || !nets.some(n => /SWCLK|TCK/i.test(n))) continue;
      // A header, not a board-to-board connector passing the lines through: debug lines are a third of what it carries.
      const dbg = nets.filter(n => /SWDIO|SWDAT|TMS|SWCLK|TCK|SWO|TDO|TDI|N?RST|RESET|VREF|VTREF/i.test(n)).length;
      if (dbg * 3 < nets.filter(n => !NV.ground.has(n)).length) continue;
      tick('conn.mate');
      if (nets.some(n => /N?RST|RESET/i.test(n))) continue;
      const open = c.pins.filter(x => !M.netOf.get(c.ref + '.' + x.num) || (M.nets.get(M.netOf.get(c.ref + '.' + x.num)) || []).length <= 1).map(x => x.num);
      add('conn.mate', 'warn', c.ref + ' carries ' + nets.filter(n => /SWDIO|SWDAT|TMS|SWCLK|TCK/i.test(n)).join(' and ') + ' but no reset', 'A debug header without reset can\'t connect under reset, which firmware that sleeps or reuses the debug pins needs.' + (open.length ? ' Pin' + (open.length > 1 ? 's ' : ' ') + open.join(', ') + ' ' + (open.length > 1 ? 'are' : 'is') + ' open: if one is the header\'s reset, wire it to the target\'s reset.' : '') + ' Assign ' + c.ref + '\'s mate on the Connectors tab to check its pinout.', { refs: [c.ref], pins: open.map(n => c.ref + '.' + n), nets, key: c.ref + ' nrst' });
    }

    // Power coming in on an unassigned connector: a connector pin on a net that feeds an eFuse, load switch, or
    // regulator input directly.
    for (const c of conns) {
      if (assigned.has(c.ref)) continue;
      const seen = new Set();
      for (const x of c.pins) {
        const net = M.netOf.get(c.ref + '.' + x.num);
        if (!net || seen.has(net) || NV.ground.has(net)) continue;
        seen.add(net);
        const feeds = (M.nets.get(net) || []).filter(n => { const fp = M.filePin(n.ref, n.pin), f = M.files.get(n.ref); return fp && fp.role === 'power-in' && f && (f.kind === 'regulator' || (f.kind === 'switch' && (M.valueOf(f, 'sw.ovlo') || M.valueOf(f, 'sw.ilim') || /e-?fuse|hot[- ]?swap|surge|over-?voltage/i.test(f.description || '')))); });
        if (!feeds.length) continue;
        // Only power that arrives here: not a rail this board makes and sends out (a regulator's or switch's output on it).
        if ((M.nets.get(net) || []).some(n => n.ref !== c.ref && (M.filePin(n.ref, n.pin) || {}).role === 'power-out') || (NV.V.get(net) || {}).reg) continue;
        const target = feeds[0], tf = M.files.get(target.ref);
        tick('power.protection');
        const shunts = (M.nets.get(net) || []).map(n => M.parts.get(n.ref)).filter(q => q && q.kind !== 'capacitor' && !isConn(q) && q.pins.length <= 3 && q.pins.some(pp => NV.ground.has(M.netOf.get(q.ref + '.' + pp.num))));
        const tvs = shunts.find(q => (q.kind === 'diode' && !isLed(q)) || /^(TVS|D|RV|VR)\d/i.test(q.ref) || /tvs|esd|transient|varistor/i.test(textOf(q)) || ((M.files.get(q.ref) || {}).kind === 'protection'));
        const caps = (M.nets.get(net) || []).map(n => M.parts.get(n.ref)).filter(q => q && q.kind === 'capacitor' && (twoPin(M, q) || []).some(e => NV.ground.has(e)));
        const lack = [!tvs && 'TVS', !caps.length && 'input capacitor'].filter(Boolean);
        const pins = pinsOn(c.ref, net).map(pp => pp.num);
        if (lack.length) add('power.protection', tf.kind === 'switch' ? 'warn' : 'info', c.ref + ' brings ' + net + ' into ' + target.ref + ' with no ' + lack.join(' or '), c.ref + ' pin' + (pins.length > 1 ? 's ' : ' ') + pins.join(', ') + ' feed' + (pins.length > 1 ? '' : 's') + ' ' + target.ref + ' ' + ((M.filePin(target.ref, target.pin) || {}).name || target.pin) + ' (' + tf.mpn + ') directly. Power arriving on a cable needs a clamp and a ceramic capacitor between the connector and the first part: hot-plugging and current interrupts ring the cable\'s inductance. A clamp after ' + target.ref + ' protects only what follows it. Set ' + c.ref + ' as a power input on the Connectors tab so its rating and path are checked too.', { refs: [c.ref, target.ref].concat(shunts.map(q => q.ref)), pins: pins.map(n => c.ref + '.' + n), nets: [net], key: c.ref + ' ' + net + ' in' });

        // An eFuse's current limit set by a resistor (ILIM = k / RILM), against the contacts carrying it in and back.
        const ilim = tf.kind === 'switch' && M.valueOf(tf, 'sw.ilim');
        const ilmPin = tf.pins.find(pp => /^(I?LIM|ILM|RILM|ISET|ICL)$/i.test(pp.name));
        const kv = M.valueOf(tf, 'sw.ilim.k');
        const k = kv ? (kv.value != null ? kv.value : kv.typ) : ilim && +((/(\d{2,6}(?:\.\d+)?)\s*\/\s*I_?LIM/i.exec(ilim.note || '') || [])[1] || NaN);
        const rate = rateOf(c.ref);
        if (!ilmPin || !k || !rate || rate.per == null) continue;
        const rn = M.netOf.get(target.ref + '.' + ilmPin.num);
        const rr = rn && (M.nets.get(rn) || []).map(n => M.parts.get(n.ref)).find(q => q && q.kind === 'resistor' && (twoPin(M, q) || []).some(e => NV.ground.has(e)));
        const rv = rr && passiveValue(rr, 'Ω');
        if (!rv || !rv.v) continue;
        tick('power.contacts');
        const i = k / rv.v, iHi = i * 1.1; // a resistor-set limit is good to about ±10%
        const gnd = c.pins.filter(pp => NV.ground.has(M.netOf.get(c.ref + '.' + pp.num))).length;
        const n = Math.max(1, Math.min(pins.length, gnd || pins.length));
        const rv2 = M.valueOf(rate.f, 'rate.i'), rnote = [rv2.cond, rv2.note].filter(Boolean).join('; ');
        if (iHi > rate.per * n + 1e-9) add('power.contacts', 'warn', target.ref + '\'s current limit (about ' + P.fmt(i, 'A') + ', up to ' + P.fmt(iHi, 'A') + ') is above ' + c.ref + '\'s ' + P.fmt(rate.per * n, 'A') + ' of contacts', rr.ref + ' ' + P.fmt(rv.v, 'Ω') + ' on ' + ilmPin.name + ' sets about ' + P.fmt(i, 'A') + ' (' + k + ' / RILM' + (kv ? '' : ', from the part file\'s note') + '), and a resistor-set limit is good to about 10%. ' + c.ref + ' carries it on ' + pins.length + ' pin' + (pins.length > 1 ? 's' : '') + ' and returns it on ' + (gnd || 'no') + ' ground pin' + (gnd === 1 ? '' : 's') + ', rated ' + P.fmt(rate.per, 'A') + ' each' + (rnote ? ' (' + rnote.slice(0, 160) + ')' : '') + '. The contacts can carry more than their rating before ' + target.ref + ' trips. Raise ' + rr.ref + ', or carry the current on more contacts.', { refs: [target.ref, rr.ref, c.ref], pins: pins.map(nn => c.ref + '.' + nn), nets: [net], basis: [basisOf(tf, ilim || kv), rate.basis], key: c.ref + ' ilim' });
      }
    }

    // A linear regulator's input crossing a connector on fewer contacts than its rated current needs (its input current
    // is its output current).
    for (const [ref, f] of M.files) {
      if (f.kind !== 'regulator' || NV.held.has(ref) || f.pins.some(pp => pp.role === 'switch')) continue;
      const io = M.valueOf(f, 'reg.iout'); if (!io) continue;
      const imax = io.max != null ? io.max : io.value != null ? io.value : io.typ; if (!imax) continue;
      // The input that carries the load current (IN, VIN), not a bias or enable supply.
      for (const pp of f.pins.filter(x => x.role === 'power-in' && /^V?IN\d?$/i.test(x.name))) {
        const net = M.netOf.get(ref + '.' + pp.num); if (!net) continue;
        for (const c of conns) {
          const pins = pinsOn(c.ref, net); if (!pins.length) continue;
          const rate = rateOf(c.ref); if (!rate || rate.per == null) continue;
          tick('power.contacts');
          if (imax <= rate.per * pins.length + 1e-9) continue;
          add('power.contacts', 'warn', ref + ' can draw ' + P.fmt(imax, 'A') + ' on ' + net + ' through ' + pins.length + ' of ' + c.ref + '\'s ' + P.fmt(rate.per, 'A') + ' contacts', ref + ' (' + f.mpn + ') is a linear regulator, so its input current is its output current, up to ' + P.fmt(imax, 'A') + '. ' + net + ' comes in on ' + c.ref + ' pin' + (pins.length > 1 ? 's ' : ' ') + pins.map(x => x.num).join(', ') + '. Use more contacts, or confirm the load stays under ' + P.fmt(rate.per * pins.length, 'A') + '.', { refs: [ref, c.ref], pins: pins.map(x => c.ref + '.' + x.num).concat(ref + '.' + pp.num), nets: [net], basis: [basisOf(f, io), rate.basis], key: ref + ' ' + c.ref + ' contacts' });
        }
      }
    }

    // Speaker, motor, and coil lines through a connector on one small contact each.
    // Output pairs, not their digital controls: SPK_P, SPK_OUTN, OUTP, MOTOR_A, COIL1.
    const LOAD = /^[LR]?(SPK|SPKR|SPEAKER|LEFT|RIGHT)\d?_?(OUT)?_?[PN+-]$|^(SPK|SPKR)?_?OUT[PN]$|^(MOTOR|MOT|COIL|SOL(ENOID)?)\d*_?(OUT)?_?([AB]|[PN]|\d)?\d?$/i;
    for (const [net, nodes] of M.nets) {
      if (!LOAD.test(net) || NV.ground.has(net)) continue;
      for (const c of conns) {
        const pins = nodes.filter(n => n.ref === c.ref); if (pins.length !== 1) continue;
        const rate = rateOf(c.ref); if (!rate || rate.per == null) continue;
        tick('power.contacts');
        if (rate.per >= 1) continue;
        add('power.contacts', 'warn', net + ' crosses ' + c.ref + ' on one ' + P.fmt(rate.per, 'A') + ' contact', net + ' looks like a speaker, motor, or coil line, whose peak current is the supply voltage over the load (about 1 A for 4 V into 4 Ω). ' + c.ref + ' pin ' + pins[0].pin + ' is rated ' + P.fmt(rate.per, 'A') + '. Check the peak current, or use more contacts.', { refs: [c.ref], pins: [c.ref + '.' + pins[0].pin], nets: [net], basis: [rate.basis], key: c.ref + ' ' + net });
      }
    }

    // The pads of one contact (a part file's pin `contact`) on different nets: a short through the contact.
    for (const c of conns) {
      const f = M.files.get(c.ref); if (!f) continue;
      const groups = new Map();
      for (const pp of f.pins) if (pp.contact) { if (!groups.has(pp.contact)) groups.set(pp.contact, []); groups.get(pp.contact).push(pp); }
      for (const [k, list] of groups) {
        if (list.length < 2) continue;
        tick('conn.contacts');
        const nets = [...new Set(list.map(pp => M.netOf.get(c.ref + '.' + pp.num)).filter(Boolean))];
        if (nets.length > 1) add('conn.contacts', 'error', c.ref + '\'s contact ' + k + ' joins ' + nets.join(' and '), 'Pads ' + list.map(pp => pp.num).join(', ') + ' are one contact in ' + f.mpn + ', so ' + nets.join(' and ') + ' are shorted through it. Check the symbol and footprint number the pads as the part file does.', { refs: [c.ref], pins: list.map(pp => c.ref + '.' + pp.num), nets, key: c.ref + ' contact ' + k });
      }
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
    const hexes = lines.map(l => (l.match(/0x[0-9a-f]{2}(?![0-9a-f])/ig) || []).map(h => parseInt(h, 16)));
    const all = [].concat(...hexes);
    if (!all.length) return null;
    if (new Set(all).size === 1) return { addr: all[0], how: 'fixed at 0x' + all[0].toString(16).toUpperCase() };
    // An address set in memory or registers: the line marked default (2026-11-13).
    const def = lines.findIndex(l => /\bdefault\b/i.test(l) && !/^\s*[A-Z][A-Z0-9_/]*\s*(=|is|tied)/i.test(l));
    if (def >= 0 && hexes[def].length) return { addr: hexes[def], how: 'default: ' + lines[def].replace(/\s*\(.*$/, '') + ' → ' + hexes[def].map(h => '0x' + h.toString(16).toUpperCase()).join(', ') };
    for (let i = 0; i < lines.length; i++) {
      // "ADR = GND", "ADR = 10 kΩ to GND", "A0 low": a strap through a resistor reads the same as one tied straight.
      const m = /^\s*([A-Z][A-Z0-9_/]*)\s*(?:=|is|tied to|to|:)?\s*(?:[\d.]+\s*[kKM]?\s*(?:Ω|ohms?)?\s*(?:to|pull(?:ed)?[\s-]?(?:up|down)?\s*to)\s*)?(GND|VSS|VDD|VCC|VIO|SDA|SCL|low|high|open|float|pulled up|pulled down)\b/i.exec(lines[i]);
      if (!m || !hexes[i].length) continue;
      const pin = f.pins.find(x => x.name.toUpperCase() === m[1].toUpperCase() || x.name.toUpperCase().split('/').includes(m[1].toUpperCase()));
      if (!pin) continue;
      const net = M.netOf.get(ref + '.' + pin.num);
      // A strap resistor to ground or a rail reads as that level.
      const viaR = () => { for (const n of M.nets.get(net) || []) { const q = M.parts.get(n.ref); if (!q || q.kind !== 'resistor') continue; const e = twoPin(M, q); const o = e && (e[0] === net ? e[1] : e[0]); const rv = passiveValue(q, 'Ω'); if (!o || (rv && rv.dnp)) continue; if (NV.ground.has(o)) return 'GND'; if (NV.V.has(o)) return 'VDD'; } return null; };
      const level = !net || (M.nets.get(net) || []).length <= 1 ? 'open' : NV.ground.has(net) ? 'GND' : /SDA/i.test(net) ? 'SDA' : /SCL/i.test(net) ? 'SCL' : NV.V.has(net) ? 'VDD' : viaR();
      if (!level) continue;
      const want = m[2].toUpperCase();
      const same = want === level || (level === 'GND' && /^(VSS|LOW|PULLED DOWN)$/.test(want)) || (level === 'VDD' && /^(VCC|VIO|HIGH|PULLED UP)$/.test(want)) || (level === 'open' && /^(OPEN|FLOAT)$/.test(want));
      if (same) return { addr: hexes[i][0], how: pin.name + ' ' + (net ? 'on ' + net : 'open') + ' → 0x' + hexes[i][0].toString(16).toUpperCase() };
    }
    return null;
  }

  PK.checks = { CATALOG, byKey, run, evalExpr, voltageFromName, passiveValue };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
