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
    return { sheet: sheetName, parts };
  }

  PK.schdoc = { parse, records, ELECTRICAL };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
