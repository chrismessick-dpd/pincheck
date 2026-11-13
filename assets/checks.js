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
  function model(design, lib) {
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
    return { design, lib, parts, nets, netOf, files, why, filePin, valueOf };
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
    for (const [ref, f] of M.files) for (const pin of f.pins) if (pin.role === 'switch') { const n = M.netOf.get(ref + '.' + pin.num); if (n) switchNodes.add(n); }
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false;
      for (const [ref, a, b] of passes) {
        if (!a || !b || switchNodes.has(a) || switchNodes.has(b)) continue;
        if (V.has(a) && !V.has(b) && !ground.has(b)) { const s = V.get(a); V.set(b, Object.assign({}, s, { from: s.from + ', through ' + ref })); changed = true; }
        else if (V.has(b) && !V.has(a) && !ground.has(a)) { const s = V.get(b); V.set(a, Object.assign({}, s, { from: s.from + ', through ' + ref })); changed = true; }
        else if (V.has(a) && V.has(b) && V.get(a).from === 'net name' && V.get(b).from !== 'net name' && !/through/.test(V.get(b).from || '')) { const s = V.get(b); V.set(a, Object.assign({}, s, { from: s.from + ', through ' + ref })); changed = true; }
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
  function highLevels(M, NV, net) {
    const out = [];
    if (NV.ground.has(net)) return out;
    if (NV.V.has(net)) { const s = NV.V.get(net); return [{ v: s.v, by: 'the rail itself (' + s.from + ')', kind: 'pull-up', ref: null }]; }
    let gsum = 0, isum = 0;
    const rails = [], lows = [], unknown = [];
    for (const node of M.nets.get(net) || []) {
      const p = M.parts.get(node.ref); if (!p) continue;
      if (p.kind === 'resistor') {
        const e = twoPin(M, p); if (!e) continue;
        const other = e[0] === net ? e[1] : e[0];
        if (!other || other === net || !NV.V.has(other)) continue;
        const val = passiveValue(p, 'Ω');
        if (val && val.dnp) continue;
        const vo = NV.V.get(other).v;
        if (val && val.v > 0) { gsum += 1 / val.v; isum += vo / val.v; (vo > 0 ? rails : lows).push(p.ref + ' to ' + other); }
        else if (vo > 0) unknown.push({ v: vo, ref: p.ref, other });
        continue;
      }
      const fp = M.filePin(node.ref, node.pin);
      if (fp && (fp.role === 'output' || fp.role === 'io') && fp.domain) {
        const dv = domainVoltages(M, NV, node.ref)[fp.domain];
        if (dv != null) out.push({ v: dv, by: node.ref + '.' + node.pin + ' (' + fp.name + ', ' + fp.domain + ')', kind: fp.role === 'output' ? 'output' : 'io', ref: node.ref, pin: node.pin });
      }
    }
    if (gsum > 0 && rails.length) {
      const v = isum / gsum;
      if (v > 0.01) out.push({ v, by: rails.join(', ') + (lows.length ? ' with ' + lows.join(', ') + ' (a divider)' : ''), kind: 'pull-up', ref: null });
    }
    for (const u of unknown) out.push({ v: u.v, by: u.ref + ' to ' + u.other + ' (value unknown)', kind: 'pull-up', ref: u.ref });
    return out;
  }

  // ── The checks ──
  function run(design, lib) {
    const t0 = Date.now();
    const M = model(design, lib || []);
    const NV = voltages(M);
    const findings = [];
    const coverage = Object.fromEntries(CATALOG.map(c => [c.key, { checked: 0, skipped: 0, findings: 0 }]));
    const seen = new Set();
    const add = (check, severity, title, detail, extra) => {
      const c = byKey.get(check);
      const f = Object.assign({ check, group: c.group, severity, title, detail, refs: [], pins: [], nets: [], basis: [] }, extra || {});
      f.id = check + ':' + (f.pins[0] || f.refs[0] || f.nets[0] || title);
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
            if (absmax && lim(absmax.value != null ? absmax.value : absmax.max) != null) {
              tick('supply.absmax');
              const am = lim(absmax.value != null ? absmax.value : absmax.max);
              if (nv.v > am) add('supply.absmax', 'error', label + ' at ' + fmtV(nv.v) + ' is above its ' + fmtV(am) + ' absolute maximum', pin.domain + ' on net ' + net + ' (' + nv.from + '). The absolute maximum is ' + fmtV(am) + '.', Object.assign({ basis: [basisOf(f, absmax)].concat(nv.basis || []) }, where));
            } else skip('supply.absmax');
            if (absmin) { const am = lim(absmin.value != null ? absmin.value : absmin.min); if (am != null && nv.v < am) add('supply.absmax', 'error', label + ' at ' + fmtV(nv.v) + ' is below its ' + fmtV(am) + ' absolute minimum', 'Net ' + net + ' (' + nv.from + ').', Object.assign({ basis: [basisOf(f, absmin)] }, where)); }
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
              if ((lo != null && nv.v < lo - 1e-6) || (hi != null && nv.v > hi + 1e-6)) add('supply.range', 'error', label + ' at ' + fmtV(nv.v) + ' is outside ' + (lo != null ? fmtV(lo) : '…') + ' to ' + (hi != null ? fmtV(hi) : '…'), pin.domain + '\'s recommended range' + (range.cond ? ' (' + range.cond + ')' : '') + '; net ' + net + ' is ' + fmtV(nv.v) + ' (' + nv.from + ').' + (range.note ? ' Note: ' + range.note : ''), Object.assign({ basis: [basisOf(f, range)].concat(nv.basis || []) }, where));
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
            const drivers = highs.filter(h => h.kind !== 'pull-up' && h.v > 0.3);
            const pulled = highs.some(h => h.kind === 'pull-up');
            if (vih && drivers.length && !pulled) {
              const need = evalExpr(vih.value != null ? vih.value : vih.min != null ? vih.min : vih.max, doms);
              if (need != null) {
                tick('io.vih');
                const low = drivers.reduce((a, b) => (b.v < a.v ? b : a));
                if (low.v < need - 1e-6) add('io.vih', 'error', label + ' needs ' + fmtV(need) + ' to read high; ' + low.by + ' drives ' + fmtV(low.v), 'The driver\'s domain is ' + fmtV(low.v) + ', below this input\'s VIH on ' + dom + ' (' + fmtV(doms[dom]) + '). A level shifter, or a driver on the same supply, is needed.', { refs: [ref, low.ref], pins: [key, low.ref + '.' + low.pin], nets: [net], basis: [basisOf(f, vih)] });
              }
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

    return finish();

    function finish() {
      const order = { error: 0, warn: 1, info: 2 };
      findings.sort((a, b) => order[a.severity] - order[b.severity] || CATALOG.indexOf(byKey.get(a.check)) - CATALOG.indexOf(byKey.get(b.check)) || a.title.localeCompare(b.title, undefined, { numeric: true }));
      const rails = [...NV.V].filter(([n, s]) => s.from !== 'ground').map(([net, s]) => ({ net, v: s.v, from: s.from, unverified: !!s.unverified })).sort((a, b) => b.v - a.v || a.net.localeCompare(b.net));
      return { findings, rails, coverage, parts: M.why, ms: Date.now() - t0, hasNets };
    }
  }

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
