// Altium's "Protel2" netlist (Design › Netlist For Project › Protel2): the whole project, with repeated
// channels expanded to their board designators ("C1.1" is channel 1 of C1).
//
//   PROTEL NETLIST 2.0
//   [                         one block per part: DESIGNATOR, FOOTPRINT, PARTTYPE, DESCRIPTION, each
//   DESIGNATOR                followed by its value, then the part's parameters as name/value lines
//   U3
//   …
//   ]
//   (                         one block per net: its name, then a line per pin:
//   3V3                       <designator>-<pin> <PARTTYPE>-<pin name> <electrical type>
//   U2.1-3 TCAN1042-VCC Power
//   )
//
// Pins appear only in nets, so pins on no net are missing; the SchDoc sheets fill them in.
(function (PK) {
  'use strict';
  const TYPE = { passive: 'passive', io: 'io', input: 'input', output: 'output', power: 'power', opencollector: 'open-collector', openemitter: 'open-emitter', hiz: 'hiz' };

  // Bytes → text: Altium writes Windows-1252 ("125°C"); a UTF-8 file is read as UTF-8.
  function decode(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }
  const sniff = text => /^﻿?PROTEL NETLIST 2\.0/.test(text) ? 2 : /^﻿?\s*\[\s*[\r\n]/.test(text) ? 1 : 0;

  function parse(text, name) {
    if (sniff(text) !== 2) throw new Error(name + ': not a Protel2 netlist' + (sniff(text) === 1 ? ' (this is the older Protel format, which has no pin names: export Protel2)' : ''));
    const lines = text.split(/\r?\n/);
    const parts = [], byRef = new Map(), nets = [];
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l === '[') {
        const body = [];
        for (i++; i < lines.length && lines[i].trim() !== ']'; i++) body.push(lines[i].replace(/\s+$/, ''));
        if (body.length % 2 && body[body.length - 1].trim() === '*') body.pop();
        const head = {}, params = {};
        for (let k = 0; k + 1 < body.length; k += 2) {
          const key = body[k].trim(), val = body[k + 1].trim();
          if (k < 8 && /^(DESIGNATOR|FOOTPRINT|PARTTYPE|DESCRIPTION)$/.test(key)) head[key] = val;
          else if (key && val && val !== '*') params[key] = val;
        }
        if (!head.DESIGNATOR) continue;
        const p = {
          ref: head.DESIGNATOR, libRef: '', description: head.DESCRIPTION || params.Description || '', footprint: head.FOOTPRINT || '',
          partType: head.PARTTYPE || '', params, pins: [], sheets: [name]
        };
        if (!params.Comment && head.PARTTYPE) params.Comment = head.PARTTYPE;
        parts.push(p); byRef.set(p.ref, p);
      } else if (l === '(') {
        const netName = (lines[++i] || '').trim();
        const nodes = [];
        for (i++; i < lines.length && lines[i].trim() !== ')'; i++) {
          const t = lines[i].trim();
          if (!t) continue;
          const sp = t.indexOf(' ');
          const refPin = sp < 0 ? t : t.slice(0, sp);
          const rest = sp < 0 ? '' : t.slice(sp + 1).trim();
          // The designator is the longest known one that the pin follows after a dash.
          let ref = null;
          for (let d = refPin.lastIndexOf('-'); d > 0; d = refPin.lastIndexOf('-', d - 1)) if (byRef.has(refPin.slice(0, d))) { ref = refPin.slice(0, d); break; }
          if (!ref) { const d = refPin.indexOf('-'); if (d <= 0) continue; ref = refPin.slice(0, d); }
          const pin = refPin.slice(ref.length + 1);
          const tm = /\s(\S+)$/.exec(' ' + rest);
          const type = tm ? TYPE[tm[1].toLowerCase()] || 'passive' : 'passive';
          let label = tm ? rest.slice(0, rest.length - tm[1].length).trim() : rest;
          const part = byRef.get(ref);
          if (part && part.partType && label.startsWith(part.partType + '-')) label = label.slice(part.partType.length + 1);
          else { const d = label.lastIndexOf('-'); if (d >= 0) label = label.slice(d + 1); }
          nodes.push({ ref, pin });
          if (part && !part.pins.some(x => x.num === pin)) part.pins.push({ num: pin, name: label, type });
        }
        nets.push({ name: netName, nodes });
      }
    }
    return { sheet: name, parts, nets };
  }

  PK.protel = { parse, decode, sniff };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
