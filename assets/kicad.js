// KiCad netlist XML reader (Eeschema's "kicadxml" export: `kicad-cli sch export netlist --format kicadxml`).
// Gives components with their fields, each library part's pins (number, name, type), and the nets.
(function (PK) {
  'use strict';

  // A small XML reader, enough for netlists: elements, attributes, text, and the five entities.
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] != null ? ENT[e] : m));
  function xml(text) {
    const root = { tag: '#root', attrs: {}, kids: [], text: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const top = stack[stack.length - 1];
      if (m[1] != null) top.text += m[1];
      else if (m[2]) { if (stack.length > 1) stack.pop(); }
      else if (m[3]) {
        const el = { tag: m[3], attrs: {}, kids: [], text: '' };
        m[4].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { el.attrs[k] = unent(a != null ? a : b); return ''; });
        top.kids.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6]) top.text += unent(m[6]);
    }
    return root;
  }
  const kids = (el, tag) => (el ? el.kids.filter(k => k.tag === tag) : []);
  const kid = (el, tag) => kids(el, tag)[0] || null;
  const txt = el => (el ? el.text.trim() : '');

  // KiCad's pin types, mapped to the ones Pincheck uses (the same words as Altium's, schdoc.js).
  const TYPE = { input: 'input', output: 'output', bidirectional: 'io', tri_state: 'hiz', passive: 'passive', free: 'passive', unspecified: 'passive', power_in: 'power', power_out: 'power-out', open_collector: 'open-collector', open_emitter: 'open-emitter', no_connect: 'nc' };

  function parse(text, name) {
    const doc = kid(xml(text), 'export');
    if (!doc) throw new Error('Not a KiCad XML netlist (no <export>)');
    const libparts = new Map();
    for (const lp of kids(kid(doc, 'libparts'), 'libpart')) {
      libparts.set(lp.attrs.lib + ':' + lp.attrs.part, {
        description: txt(kid(lp, 'description')),
        pins: kids(kid(lp, 'pins'), 'pin').map(p => ({ num: p.attrs.num || '', name: p.attrs.name || '', type: TYPE[p.attrs.type] || 'passive' }))
      });
    }
    const parts = [];
    for (const c of kids(kid(doc, 'components'), 'comp')) {
      const params = {};
      for (const f of kids(kid(c, 'fields'), 'field')) if (f.attrs.name) params[f.attrs.name] = txt(f);
      for (const p of kids(c, 'property')) if (p.attrs.name && !(p.attrs.name in params) && !/^(Sheetname|Sheetfile|ki_)/i.test(p.attrs.name)) params[p.attrs.name] = p.attrs.value || '';
      const ls = kid(c, 'libsource') || { attrs: {} };
      const lp = libparts.get(ls.attrs.lib + ':' + ls.attrs.part) || { pins: [], description: '' };
      const sheet = kid(c, 'sheetpath');
      if (txt(kid(c, 'value'))) params.Value = params.Value || txt(kid(c, 'value'));
      parts.push({
        ref: c.attrs.ref || '', libRef: ls.attrs.part || '', description: ls.attrs.description || txt(kid(c, 'description')) || lp.description,
        footprint: txt(kid(c, 'footprint')), params,
        pins: lp.pins.map(p => Object.assign({}, p)), sheets: [sheet ? (sheet.attrs.names || '/') : name]
      });
    }
    const pinTypes = new Map();
    const nets = kids(kid(doc, 'nets'), 'net').map(n => ({
      name: (n.attrs.name || '').replace(/^\//, ''),
      nodes: kids(n, 'node').map(d => {
        if (d.attrs.pintype) pinTypes.set(d.attrs.ref + '.' + d.attrs.pin, d.attrs);
        return { ref: d.attrs.ref, pin: d.attrs.pin };
      })
    }));
    // Netlists from KiCad 6 on name each node's pin and type; fill parts whose library part wasn't listed.
    for (const p of parts) {
      if (p.pins.length) continue;
      for (const [k, a] of pinTypes) if (k.startsWith(p.ref + '.')) p.pins.push({ num: a.pin, name: (a.pinfunction || '').replace(/_\d+$/, ''), type: TYPE[a.pintype.replace(/\+no_connect$/, '')] || 'passive' });
    }
    return { sheet: name, parts, nets };
  }

  PK.kicad = { parse, xml };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
