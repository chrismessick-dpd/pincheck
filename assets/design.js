// One design from dropped files: SchDoc sheets (merged by designator) or a KiCad XML netlist.
// PK.design.build(files) → { name, source, sheets, parts, nets, notes, drawings, sheetsDrawn }; drawings are the
// SchDoc sheets' graphics (PK.schdoc.graphics), for the schematic viewer.
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

  // A board designator's schematic part: "C1.2" (channel 2 of C1) is drawn as C1; also "C1_2".
  const logicalOf = (ref, schematic) => {
    if (schematic.has(ref)) return schematic.get(ref);
    const m = /^(.+?)[._](\w+)$/.exec(ref);
    return m && schematic.has(m[1]) ? schematic.get(m[1]) : null;
  };

  async function build(files) {
    const sheets = [], notes = [], drawings = [];
    const schematic = new Map(); // parts from SchDoc sheets, by their schematic designator
    const fromNetlist = new Map(); // parts from a netlist, by their board designator
    let nets = null, netlist = '', kicad = false;
    for (const f of files) {
      const name = f.name;
      if (/\.schdoc$/i.test(name)) {
        const r = PK.schdoc.parse(new Uint8Array(await f.arrayBuffer()), name);
        sheets.push(name);
        if (r.drawing) drawings.push(r.drawing);
        for (const p of r.parts) {
          if (schematic.has(p.ref)) mergePart(schematic.get(p.ref), p);
          else schematic.set(p.ref, p);
        }
      } else if (/\.(xml|net)$/i.test(name)) {
        const text = PK.protel.decode(new Uint8Array(await f.arrayBuffer()));
        let r;
        if (/<export[\s>]/.test(text.slice(0, 4000))) { r = PK.kicad.parse(text, name); kicad = true; netlist = netlist || 'KiCad XML'; }
        else if (PK.protel.sniff(text) === 2) { r = PK.protel.parse(text, name); netlist = netlist || 'Protel2'; }
        else if (PK.protel.sniff(text) === 1) { notes.push(name + ': an older Protel netlist, which has no pin names. In Altium, export Design › Netlist For Project › Protel2.'); continue; }
        else { notes.push(name + ': not a KiCad XML or Protel2 netlist, skipped'); continue; }
        sheets.push(name);
        if (r.drawing) drawings.push(r.drawing);
        for (const p of r.parts) { if (fromNetlist.has(p.ref)) mergePart(fromNetlist.get(p.ref), p); else fromNetlist.set(p.ref, p); }
        nets = (nets || []).concat(r.nets);
      } else if (!/\.(prjpcb|prjpcbstructure|prjpcbvariants|bomdoc|outjob|intlib|pcbdoc|pcbdwf|schdot|harness|edf|edif)$/i.test(name)) notes.push(name + ': not a schematic or netlist, skipped');
    }
    // With a netlist, its parts (board designators, repeated channels expanded) are the design, and the
    // sheets fill in what it lacks: pins on no net, and parameters. Without one, the sheets' parts are.
    let byRef = schematic;
    if (fromNetlist.size) {
      byRef = fromNetlist;
      let joined = 0;
      if (schematic.size) {
        for (const p of fromNetlist.values()) {
          const s = logicalOf(p.ref, schematic);
          if (!s) continue;
          joined++;
          const had = new Set(p.pins.map(x => x.num));
          for (const pin of p.pins) { const sp = s.pins.find(x => x.num === pin.num); if (sp && (pin.type === 'passive' || !pin.name)) { pin.type = sp.type; if (!pin.name) pin.name = sp.name; } }
          for (const pin of s.pins) if (!had.has(pin.num)) p.pins.push(Object.assign({ unconnected: true }, pin));
          for (const [k, v] of Object.entries(s.params)) if (!(k in p.params)) p.params[k] = v;
          if (!p.libRef) p.libRef = s.libRef;
          p.designItemId = s.designItemId;
          p.schRef = s.ref;
        }
        const unmatched = fromNetlist.size - joined;
        if (unmatched) notes.push(unmatched + ' of the netlist\'s ' + fromNetlist.size + ' parts have no part on the sheets (by designator); their pins on no net aren\'t listed.');
      } else if (!kicad) notes.push('From the netlist alone, pins on no net aren\'t listed. Drop the SchDoc sheets with it to fill them in.');
    } else if (schematic.size) notes.push('No netlist: pins are listed without their connections. In Altium, export Design › Netlist For Project › Protel2, and drop it with the sheets.');
    const parts = [...byRef.values()].sort((a, b) => natural(a.ref, b.ref));
    for (const p of parts) {
      const id = identify(p);
      p.mpn = id.mpn; p.mpnFrom = id.from;
      p.kind = classify(p);
      p.pins.sort((a, b) => natural(a.num, b.num));
    }
    const source = netlist === 'KiCad XML' ? 'kicad' : schematic.size || netlist ? 'altium' : '';
    // The design's name: the Altium project's, if its .PrjPcb came along; else the one file's, or the top sheet's.
    // With two projects in a folder, the one named like the netlist.
    const netBase = (files.find(f => /\.net$/i.test(f.name)) || { name: '' }).name.replace(/\.[^.]+$/, '').toLowerCase();
    const prjs = files.filter(f => /\.prjpcb$/i.test(f.name));
    const prj = prjs.find(f => f.name.replace(/\.[^.]+$/, '').toLowerCase() === netBase) || prjs[0];
    // Variants (2026-11-13): parts the project's variant leaves unfitted, and parts whose own parameters say DNP,
    // are kept in the list but left out of the checks (p.dnp).
    let variants = [];
    if (prj) {
      const stem = prj.name.replace(/\.[^.]+$/, '').toLowerCase();
      const vf = files.find(f => /\.prjpcbvariants$/i.test(f.name) && f.name.replace(/\.[^.]+$/, '').toLowerCase() === stem);
      for (const f of [vf, prj].filter(Boolean)) { const v = parseVariants(PK.protel.decode(new Uint8Array(await f.arrayBuffer()))); if (v.variants.length) { variants = v.variants; variants.current = v.current; break; } }
    }
    const variant = variants.length ? (variants.find(v => v.name === variants.current) || variants[0]).name : '';
    applyVariant(parts, variants, variant);
    const dnp = parts.filter(p => p.dnp);
    if (dnp.length) notes.push((variant ? 'Variant ' + variant + ': ' : '') + dnp.length + ' part' + (dnp.length === 1 ? '' : 's') + ' not fitted (' + dnp.slice(0, 6).map(p => p.ref).join(', ') + (dnp.length > 6 ? ', …' : '') + '), left out of the checks.');
    const top = sheets.find(s => /top|main|root/i.test(s));
    const base = prj ? prj.name.replace(/\.[^.]+$/, '') : files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : top ? top.replace(/\.[^.]+$/, '') + ' (' + sheets.length + ' files)' : (sheets.length ? sheets.length + ' files' : 'Design');
    return { name: base, source, netlist, sheets, parts, nets, notes, drawings, sheetsDrawn: drawings.length > 0, variants: variants.map(v => ({ name: v.name, notFitted: v.notFitted })), variant };
  }

  // Altium's variants, from a .PrjPcb or .PrjPcbVariants: [ProjectVariantN] sections with Description=<name> and
  // VariationN=Designator=U25.1|UniqueId=…|Kind=1|AlternatePart= lines (Kind=1 is Not Fitted). CurrentVariant names
  // the one in use.
  function parseVariants(text) {
    const out = [], lines = String(text).split(/\r?\n/);
    let cur = null, current = '';
    for (const line of lines) {
      const m = /^\[(.+)\]\s*$/.exec(line);
      if (m) { cur = /^ProjectVariant\d+$/i.test(m[1]) ? { name: '', notFitted: [] } : null; if (cur) out.push(cur); continue; }
      const cv = /^CurrentVariant=(.*)$/i.exec(line); if (cv && !current) current = cv[1].trim();
      if (!cur) continue;
      const d = /^Description=(.*)$/i.exec(line); if (d && !cur.name) cur.name = d[1].trim();
      const v = /^Variation\d+=(.*)$/i.exec(line);
      if (v) {
        const f = Object.fromEntries(v[1].split('|').map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
        if (f.Kind === '1' && f.Designator) cur.notFitted.push(f.Designator);
      }
    }
    out.forEach((v, i) => { if (!v.name) v.name = 'Variant ' + (i + 1); });
    return { variants: out, current };
  }
  // Mark parts not fitted: the variant's list, or the part's own parameters (DNP=Yes, Fitted=No, a DNP comment).
  const DNP_TEXT = /\bDNP\b|\bDNF\b|not\s*fitted|no\s*fit|do not (populate|fit|place)/i;
  function applyVariant(parts, variants, name) {
    const v = (variants || []).find(x => x.name === name);
    const off = new Set(v ? v.notFitted.map(s => s.toUpperCase()) : []);
    for (const p of parts) {
      const prm = p.params || {};
      const own = Object.entries(prm).some(([k, val]) => (/^(DNP|DNF|No ?Fit|Not ?Fitted)$/i.test(k) && /^(1|y|yes|true|x)$/i.test(String(val).trim())) || (/^(Fitted|Populate|Populated|Fit)$/i.test(k) && /^(0|n|no|false)$/i.test(String(val).trim())))
        || DNP_TEXT.test(String(prm.Comment || '') + ' ' + String(prm.Value || ''));
      p.dnp = off.has(String(p.ref).toUpperCase()) || own || undefined;
      if (!p.dnp) delete p.dnp;
    }
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

  PK.design = { build, identify, classify, groups, natural, MPN_KEYS, parseVariants, applyVariant };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
