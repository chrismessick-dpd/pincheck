// One design from dropped files: SchDoc sheets (merged by designator) or a KiCad XML netlist.
// PK.design.build(files) → { name, source, sheets, parts, nets, notes }.
// Each part: { ref, mpn, mpnFrom, libRef, description, footprint, params, pins, sheets, kind, designItemId }.
(function (PK) {
  'use strict';

  // Which parameter holds the manufacturer part number, best first. Altium vault parts often carry
  // none of these and put the part number in Comment (Dovetail's library does), so Comment comes next.
  const MPN_KEYS = ['Manufacturer Part Number', 'Manufacturer Part Number 1', 'MPN', 'Mfr Part Number', 'Mfr. Part #', 'Part Number', 'MFR_PN', 'MANUFACTURER_PART_NUMBER', 'PartNumber', 'Mfg Part Number'];
  const looksLikePn = s => !!s && s.length >= 4 && s.length <= 40 && !/\s/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s) && !/^=/.test(s);

  function identify(p) {
    const keys = Object.keys(p.params);
    for (const want of MPN_KEYS) {
      const k = keys.find(x => x.toLowerCase() === want.toLowerCase());
      if (k && p.params[k].trim()) return { mpn: p.params[k].trim(), from: k };
    }
    if (looksLikePn((p.params.Comment || '').trim())) return { mpn: p.params.Comment.trim(), from: 'Comment' };
    const lib = (p.libRef || '').replace(/-Symbol-\d+$/i, '');
    if (looksLikePn(lib) && !/^[0-9a-f]{24,}$/i.test(lib)) return { mpn: lib, from: 'library reference' };
    if (looksLikePn((p.params.Value || '').trim())) return { mpn: p.params.Value.trim(), from: 'Value' };
    return { mpn: '', from: '' };
  }

  // What kind of part, from the designator's letters (IEEE 315 / IEC 81346 habits) and the pin count.
  function classify(p) {
    const pre = (/^[A-Za-z_]+/.exec(p.ref) || [''])[0].toUpperCase();
    const n = p.pins.length;
    if (/^(U|IC|AR|VR|PS|MOD|M)$/.test(pre)) return pre === 'PS' && n <= 2 ? 'other' : 'ic';
    if (/^(Y|X|XTAL|OSC)$/.test(pre)) return 'crystal';
    if (/^(J|P|CN|CON|X?CONN|JP|H)$/.test(pre)) return 'connector';
    if (/^(R|RN|RA|RV|NTC|PTC|TH)$/.test(pre)) return 'resistor';
    if (/^(C|CP)$/.test(pre)) return 'capacitor';
    if (/^(L|FB|FL|T)$/.test(pre)) return 'inductor';
    if (/^(D|LED|TVS|Z|ZD|CR)$/.test(pre)) return 'diode';
    if (/^(Q|T|FET)$/.test(pre)) return 'transistor';
    if (/^(TP|FID|MH|MP|SW|S|K|BT|F|LS|BZ|SP|LOGO|NT)$/.test(pre)) return 'other';
    return n >= 5 ? 'ic' : 'other';
  }

  // Pins of a multi-unit part placed on several sheets are listed once each.
  function mergePart(into, p) {
    for (const [k, v] of Object.entries(p.params)) if (!(k in into.params) && v) into.params[k] = v;
    const have = new Set(into.pins.map(x => x.num));
    for (const pin of p.pins) if (!have.has(pin.num)) { into.pins.push(pin); have.add(pin.num); }
    for (const s of p.sheets) if (!into.sheets.includes(s)) into.sheets.push(s);
  }

  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  async function build(files) {
    const sheets = [], notes = [];
    const byRef = new Map();
    let nets = null, source = '';
    for (const f of files) {
      const name = f.name;
      if (/\.schdoc$/i.test(name)) {
        source = source && source !== 'altium' ? 'mixed' : 'altium';
        const r = PK.schdoc.parse(new Uint8Array(await f.arrayBuffer()), name);
        sheets.push(name);
        for (const p of r.parts) {
          if (byRef.has(p.ref)) mergePart(byRef.get(p.ref), p);
          else byRef.set(p.ref, p);
        }
      } else if (/\.(xml|net)$/i.test(name)) {
        const text = await f.text();
        if (!/<export[\s>]/.test(text)) { notes.push(name + ': not a KiCad XML netlist, skipped'); continue; }
        source = source && source !== 'kicad' ? 'mixed' : 'kicad';
        const r = PK.kicad.parse(text, name);
        sheets.push(name);
        for (const p of r.parts) { if (byRef.has(p.ref)) mergePart(byRef.get(p.ref), p); else byRef.set(p.ref, p); }
        nets = (nets || []).concat(r.nets);
      } else if (!/\.(prjpcb|prjpcbstructure|prjpcbvariants|bomdoc|outjob|intlib|pcbdoc|pcbdwf|schdot|harness)$/i.test(name)) notes.push(name + ': not a schematic or netlist, skipped');
    }
    const parts = [...byRef.values()].sort((a, b) => natural(a.ref, b.ref));
    for (const p of parts) {
      const id = identify(p);
      p.mpn = id.mpn; p.mpnFrom = id.from;
      p.kind = classify(p);
      p.pins.sort((a, b) => natural(a.num, b.num));
    }
    if (source === 'altium') notes.push('Nets aren\'t read from SchDoc files yet, so pins are listed without their connections.');
    // The design's name: the Altium project's, if its .PrjPcb came along; else the one file's, or the top sheet's.
    const prj = files.find(f => /\.prjpcb$/i.test(f.name));
    const top = sheets.find(s => /top|main|root/i.test(s));
    const base = prj ? prj.name.replace(/\.[^.]+$/, '') : files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : top ? top.replace(/\.[^.]+$/, '') + ' (' + sheets.length + ' sheets)' : (sheets.length ? sheets.length + ' sheets' : 'Design');
    return { name: base, source, sheets, parts, nets, notes };
  }

  // Parts that share a part number, grouped: [{ mpn, refs, part, kind }], the ICs first.
  function groups(design, kinds) {
    const m = new Map();
    for (const p of design.parts) {
      if (kinds && !kinds.includes(p.kind)) continue;
      const key = (p.mpn || '?' + p.libRef || '?' + p.ref).toUpperCase();
      if (!m.has(key)) m.set(key, { mpn: p.mpn, refs: [], part: p, kind: p.kind });
      m.get(key).refs.push(p.ref);
    }
    return [...m.values()];
  }

  PK.design = { build, identify, classify, groups, natural, MPN_KEYS };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
