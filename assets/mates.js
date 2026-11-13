// Connectors and what mates with them (docs/connectors.md, Chris 2026-11-13): mate profiles (what a programmer,
// cable, or other board needs on each pin, pincheck.mate/1) and each design's connector assignments ("J7 mates
// ST STDC14", "J1 is a 24 V, 2 A power input"; pincheck.connectors/1). Both are kept in this browser (IndexedDB)
// and synced with pincheck_data (interfaces/ and designs/). The standard profiles ship in this repo's
// interfaces/ folder and are loaded into the store when missing. The checks are in assets/checks.js.
(function (PK) {
  'use strict';
  const L = PK.library;
  const SCHEMA = 'pincheck.mate/1', CONN = 'pincheck.connectors/1';
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // What the target board puts on a pin, from the target's side.
  const EXPECT = {
    gnd: 'Ground', vref: 'Target I/O supply (sensed by the tool)', 'power-in': 'Power from the tool', swdio: 'SWDIO', swclk: 'SWCLK', swo: 'SWO',
    nrst: 'Reset (NRST)', tdi: 'JTAG TDI', tdo: 'JTAG TDO', tms: 'JTAG TMS', tck: 'JTAG TCK', ntrst: 'JTAG nTRST',
    'uart-tx': 'The target\'s UART TX', 'uart-rx': 'The target\'s UART RX', 'uart-rts': 'The target\'s RTS', 'uart-cts': 'The target\'s CTS',
    nc: 'Not connected', key: 'Key (no pin)', other: 'Other (not checked)'
  };
  const expects = p => (Array.isArray(p.expect) ? p.expect : [p.expect]).filter(Boolean);

  function validate(m) {
    const errs = [];
    if (!m || typeof m !== 'object') return ['Not a JSON object'];
    if (m.schema !== SCHEMA) errs.push('schema should be "' + SCHEMA + '"');
    if (!m.id) errs.push('id is missing');
    if (!m.name) errs.push('name is missing');
    if (!Array.isArray(m.pins) || !m.pins.length) errs.push('pins should be a list');
    (m.pins || []).forEach((p, i) => {
      if (p.num == null || p.num === '') errs.push('pin ' + (i + 1) + ' has no num');
      for (const e of expects(p)) if (!EXPECT[e]) errs.push('pin ' + p.num + ': unknown expect "' + e + '"');
    });
    return errs;
  }
  function validateConn(f) {
    const errs = [];
    if (!f || f.schema !== CONN) return ['schema should be "' + CONN + '"'];
    if (!Array.isArray(f.connectors)) errs.push('connectors should be a list');
    (f.connectors || []).forEach((c, i) => {
      if (!c.ref) errs.push('connector ' + (i + 1) + ' has no ref');
      if (!c.mate && !c.power) errs.push(c.ref + ': give mate or power');
      if (c.power && !(c.power.pins || []).length) errs.push(c.ref + ': power.pins is empty');
    });
    return errs;
  }

  // ── Storage: IndexedDB in this browser, its own database so the part library's is untouched ──
  const DB = () => (PK.DEMO ? 'pincheck-mates-demo' : 'pincheck-mates');
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB(), 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('profiles', { keyPath: 'id' }); r.result.createObjectStore('designs', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); };
  const all = store => tx(store, 'readonly', s => s.getAll());
  const put = (store, r) => tx(store, 'readwrite', s => s.put(r));
  const del = (store, id) => tx(store, 'readwrite', s => s.delete(id));

  // What the checks read, synchronously: loaded at start and after every change or sync.
  const cache = { profiles: new Map(), designs: new Map(), gen: 0 };
  async function reload() {
    cache.profiles = new Map((await all('profiles')).filter(p => !(p.local && p.local.conflictOf)).map(p => [p.id, p]));
    cache.designs = new Map((await all('designs')).filter(p => !(p.local && p.local.conflictOf)).map(p => [p.id, p]));
    cache.gen++;
  }

  // The standard profiles shipped in interfaces/ (index.json lists them). One already in the store stays,
  // unless it is an unedited copy of an older shipped one.
  async function seed(base) {
    let names = [];
    try { names = await (await fetch((base || '') + 'interfaces/index.json', { cache: 'no-cache' })).json(); } catch (e) { return 0; }
    const have = new Map((await all('profiles')).map(p => [p.id, p]));
    let n = 0;
    for (const name of names) {
      let p; try { p = await (await fetch((base || '') + 'interfaces/' + name, { cache: 'no-cache' })).json(); } catch (e) { continue; }
      if (validate(p).length) continue;
      const h = have.get(p.id);
      const stamp = x => (x && (x.updated || (x.made && x.made.at))) || '';
      if (h && !(h.local && h.local.builtin && !h.local.dirty && !h.local.sha && stamp(p) > stamp(h))) continue;
      p.local = { builtin: true, dirty: false };
      await put('profiles', p); n++;
    }
    return n;
  }
  async function load(base) { await seed(base); await reload(); }

  // ── A design's assignments: one record per design name, as waivers are kept per name ──
  const keyOf = d => L.slug(d && d.name ? d.name : 'design');
  function recordOf(d) { return cache.designs.get(keyOf(d)) || null; }
  function assignments(d) { const r = recordOf(d); return r ? r.connectors.slice() : []; }
  function assignment(d, ref) { return assignments(d).find(c => c.ref === ref) || null; }
  // What checks.run takes: the assignments and every profile they name. A run reopened from Signoff passes
  // the ones it was sent with instead (d.fromRun.connectors).
  function forDesign(d) {
    if (d && d.fromRun && d.fromRun.connectors) return d.fromRun.connectors;
    const assign = assignments(d);
    const profiles = {};
    for (const a of assign) if (a.mate && cache.profiles.has(a.mate)) profiles[a.mate] = cache.profiles.get(a.mate);
    return { assign, profiles };
  }
  // For a run's bundle: the same, without this browser's bookkeeping.
  function used(d) {
    const c = forDesign(d);
    if (!c.assign.length) return null;
    return { assign: c.assign, profiles: Object.fromEntries(Object.entries(c.profiles).map(([k, p]) => [k, L.strip(p)])) };
  }
  async function setAssignment(d, ref, entry, by) {
    const id = keyOf(d);
    const r = cache.designs.get(id) || { schema: CONN, id, design: d.name, connectors: [] };
    r.connectors = r.connectors.filter(c => c.ref !== ref);
    if (entry) r.connectors.push(Object.assign({ ref }, entry, { by: by || '', at: now() }));
    r.connectors.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    r.updated = now();
    r.local = Object.assign({}, r.local, { dirty: true });
    await put('designs', r); await reload();
    return r;
  }
  async function saveProfile(p) {
    p.updated = now();
    p.local = Object.assign({}, p.local, { dirty: true });
    await put('profiles', p); await reload();
    return p;
  }
  async function removeProfile(p) {
    if (p.local && p.local.sha && !PK.DEMO) await L.gh(`/repos/${L.REPO.owner}/${L.REPO.name}/contents/interfaces/${encodeURIComponent(p.id)}.json`, { method: 'DELETE', body: JSON.stringify({ message: 'Pincheck: mate profile ' + p.name + ' removed', sha: p.local.sha }) });
    await del('profiles', p.id); await reload();
  }
  // Import a file the Claude skill or a person wrote: a profile, a design's assignments, or a list of them.
  async function importJson(obj) {
    const list = Array.isArray(obj) ? obj : [obj];
    const out = { profiles: 0, designs: 0, errors: [] };
    for (const x of list) {
      if (x && x.schema === SCHEMA) {
        const e = validate(x); if (e.length) { out.errors.push((x.id || 'profile') + ': ' + e[0]); continue; }
        const had = cache.profiles.get(x.id); x.local = had ? Object.assign({}, had.local, { builtin: false }) : {};
        await saveProfile(x); out.profiles++;
      } else if (x && x.schema === CONN) {
        const e = validateConn(x); if (e.length) { out.errors.push((x.design || 'design') + ': ' + e[0]); continue; }
        x.id = x.id || L.slug(x.design); const had = cache.designs.get(x.id); x.local = Object.assign({}, had && had.local, { dirty: true }); x.updated = now();
        await put('designs', x); out.designs++;
      }
    }
    await reload();
    return out;
  }

  // ── Sync with pincheck_data: interfaces/ and designs/, as the part library syncs parts/ ──
  async function syncDir(store, dir, label, say) {
    const base = `/repos/${L.REPO.owner}/${L.REPO.name}/contents/${dir}`;
    const list = (await L.gh(base, { allow404: true })) || [];
    const remote = new Map(list.filter(x => x.type === 'file' && /\.json$/.test(x.name)).map(x => [x.name.replace(/\.json$/, ''), x]));
    const local = new Map((await all(store)).map(f => [f.id, f]));
    let pulled = 0, pushed = 0, conflicts = 0;
    for (const [id, r] of remote) {
      const l = local.get(id);
      if (l && l.local && l.local.sha === r.sha) continue;
      say('Reading ' + dir + '/' + id);
      const text = await L.gh(`${base}/${encodeURIComponent(r.name)}`, { headers: { Accept: 'application/vnd.github.raw' }, raw: true });
      let f; try { f = JSON.parse(text); } catch (e) { continue; }
      if (l && l.local && l.local.dirty) {
        if ((l.updated || '') >= (f.updated || '')) { await put(store, Object.assign(L.strip(f), { id: id + '.conflict', local: { conflictOf: id } })); l.local.sha = r.sha; await put(store, l); conflicts++; continue; }
        await put(store, Object.assign(L.strip(l), { id: id + '.conflict', local: { conflictOf: id } })); conflicts++;
      }
      f.local = { sha: r.sha, dirty: false };
      await put(store, f); pulled++;
    }
    for (const f of await all(store)) {
      if (!f.local || !f.local.dirty || f.local.conflictOf) continue;
      say('Saving ' + dir + '/' + f.id);
      const body = { message: 'Pincheck: ' + label(f) + (f.local.sha ? ' updated' : ' added'), content: L.b64(L.dump(f)) };
      if (f.local.sha) body.sha = f.local.sha;
      const res = await L.gh(`${base}/${encodeURIComponent(f.id)}.json`, { method: 'PUT', body: JSON.stringify(body) });
      f.local = { sha: res.content.sha, dirty: false };
      await put(store, f); pushed++;
    }
    return { pulled, pushed, conflicts };
  }
  async function sync(say = () => {}) {
    if (PK.DEMO || !(await L.token())) return { pulled: 0, pushed: 0 };
    const a = await syncDir('profiles', 'interfaces', p => 'mate profile ' + p.name, say);
    const b = await syncDir('designs', 'designs', r => 'connectors of ' + r.design, say);
    await reload();
    return { pulled: a.pulled + b.pulled, pushed: a.pushed + b.pushed, conflicts: a.conflicts + b.conflicts };
  }
  const unsynced = () => [...cache.profiles.values(), ...cache.designs.values()].filter(f => f.local && f.local.dirty).length;

  // ── Suggestions for a connector nobody has assigned: a profile whose signals its nets are named for ──
  const WORDS = {
    swdio: /SWDIO|SWDAT|TMS/, swclk: /SWCLK|TCK/, swo: /SWO|TDO/, nrst: /N?RST|RESET/, tdi: /TDI/, tdo: /TDO|SWO/, tms: /TMS|SWDIO/, tck: /TCK|SWCLK/,
    'uart-tx': /TX/, 'uart-rx': /RX/, 'uart-rts': /RTS/, 'uart-cts': /CTS/, gnd: /^(GND|VSS)/, vref: /V|3V3|VDD|VCC/, 'power-in': /V|VCC|VBUS/
  };
  function suggest(d, ref) {
    const part = d.parts.find(p => p.ref === ref); if (!part) return null;
    const netOf = new Map();
    for (const n of d.nets || []) for (const node of n.nodes) if (node.ref === ref) netOf.set(String(node.pin), String(n.name).replace(/^\//, '').toUpperCase());
    let best = null;
    for (const p of cache.profiles.values()) {
      let fit = 0, of = 0;
      for (const pin of p.pins) {
        const ex = expects(pin).filter(e => /^(swdio|swclk|swo|nrst|tdi|tdo|tms|tck|uart-)/.test(e));
        if (!ex.length) continue;
        of++;
        const net = netOf.get(String(pin.num));
        if (net && ex.some(e => WORDS[e] && WORDS[e].test(net))) fit++;
      }
      // Pin count matters too: a 6-pin header isn't a 14-pin one.
      const sameSize = part.pins.length === p.pins.length;
      const score = fit + (sameSize ? 0.5 : 0);
      if (fit >= 2 && (!best || score > best.score)) best = { id: p.id, name: p.name, fit, of, score };
    }
    return best;
  }

  PK.mates = { SCHEMA, CONN, EXPECT, expects, validate, validateConn, load, reload, seed, cache, keyOf, recordOf, assignments, assignment, forDesign, used, setAssignment, saveProfile, removeProfile, importJson, sync, unsynced, suggest, profiles: () => [...cache.profiles.values()].sort((a, b) => a.name.localeCompare(b.name)) };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
