// The part library: one JSON file per part (or family), kept in this browser (IndexedDB) and synced
// with the private repo pincheck_data (parts/<id>.json) when signed in. The format is in docs/part-format.md.
(function (PK) {
  'use strict';
  const P = PK.params;
  const SCHEMA = 'pincheck.part/1';
  const REPO = { owner: 'chrismessick-dpd', name: 'pincheck_data', dir: 'parts' };

  const norm = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'part';
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const glob = pat => new RegExp('^' + norm(pat).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

  // ── Guessing a new file's kind and pin roles from the schematic ──
  function guessKind(part) {
    const d = ((part.description || '') + ' ' + (part.params['Capacitor Type'] ? 'capacitor' : '')).toLowerCase();
    const names = part.pins.map(p => p.name.toUpperCase());
    if (part.kind === 'crystal' || /crystal|oscillator|resonator/.test(d)) return 'crystal';
    if (names.filter(n => /^P[A-K]\d{1,2}\b/.test(n)).length >= 8 || /microcontroller|\bmcu\b|cortex|risc-v/.test(d)) return 'mcu';
    if (/\bmodule\b|\bmod\b|wi-?fi|bluetooth|\brf\b|lora|gnss|\blte\b/.test(d)) return 'module';
    if (/regulator|\bldo\b|buck|boost|step-down|step-up|dc[- ]?dc|charge pump/.test(d)) return 'regulator';
    if (/load switch|efuse|e-fuse|hot[- ]swap|power switch|high[- ]side switch|ideal diode/.test(d)) return 'switch';
    if (/supervisor|reset ic|voltage detector|voltage monitor|watchdog/.test(d)) return 'supervisor';
    if (/charger|gauge|pmic|battery/.test(d)) return 'power';
    if (/transceiver|\bcan\b|rs-?485|rs-?232|\busb\b|isolator|uart|ethernet|\bphy\b|\bi2c\b|level shift|repeater/.test(d)) return 'interface';
    if (/op[- ]?amp|operational|amplifier|comparator|current sense|instrumentation/.test(d)) return 'analog';
    if (/\badc\b|\bdac\b|analog[- ]to[- ]digital|digital[- ]to[- ]analog|voltage reference|reference/.test(d)) return 'converter';
    if (/gate driver|motor driver|h-bridge|led driver|half[- ]bridge/.test(d)) return 'driver';
    if (/eeprom|fram|flash|sram|memory/.test(d)) return 'memory';
    if (/sensor|accelerometer|gyro|humidity|temperature/.test(d)) return 'sensor';
    if (/\bgate\b|inverter|buffer|\bnand\b|\bnor\b|\bxor\b|flip-flop|multiplexer|\bmux\b|logic|schmitt/.test(d) || /^(SN)?74/.test(norm(part.mpn))) return 'logic';
    return P.ICS.includes(part.kind) ? 'ic' : (part.kind || 'other');
  }

  const POWER = /^(VDD|VCC|VIN|AVDD|DVDD|IOVDD|VBAT|VDDA|VDDIO|VIO|VS|V\+|PVIN|PVDD|VCCIO|VCCA|VCCB|VBUS|VDDUSB|VREF\+?|VSUP|VBB|VM|VCP|VLOGIC|VL)(\b|[_\d]|$)/;
  const GROUND = /^(GND|VSS|AGND|DGND|PGND|SGND|VSSA|GNDA|GNDD)|^(V-|COM)$/;
  // `kind` sharpens a few names: a regulator's OUT is power out and its BOOT a bootstrap; an op-amp's OUT is analog.
  function guessRole(pin, kind) {
    const n = pin.name.toUpperCase().replace(/[\s#~/\\]+$/g, '');
    if (/^(NC|N\.C\.|N\/C)(\d*)$/.test(n)) return 'nc';
    if (/^DNC\d*$/.test(n)) return 'dnc';
    if (/^(EP|EPAD|PAD|THERMAL|TAB|PWRPAD|DAP)\d*$/.test(n)) return 'pad';
    if (GROUND.test(n)) return 'ground';
    const regLike = ['regulator', 'power', 'switch', 'module'].includes(kind);
    if (/^(VOUT|OUT|VO|VREG|LDO_?OUT)(\b|[_\d]|$)/.test(n)) return regLike ? 'power-out' : kind === 'analog' ? 'analog' : 'output';
    if (/^(VCAP|VDDCORE_?OUT|V11|VDD11)(\b|[_\d]|$)/.test(n)) return 'power-out';
    if (regLike && /^(BOOT|BST|VBST|BTST|VBOOT|CBOOT|BS|CB)$/.test(n)) return 'bootstrap';
    if (kind === 'analog' && /^([+-]?V?IN[+-]?|IN[AB]?[+-])\w*$/.test(n)) return 'analog';
    if (POWER.test(n) || /^VDD/.test(n) || /^VCC/.test(n)) return 'power-in';
    if (/^(N?RST|N?RESET|MR|NMR|XRES)\b/.test(n) || /^P\w+[-_ ]N?RST$/.test(n)) return 'reset';
    if (/BOOT\d?$|^BOOT/.test(n) && !/^BST/.test(n)) return 'boot';
    if (/^(BST|VBST|BTST|VBOOT|CBOOT|BOOTSTRAP|CB|BS)$/.test(n)) return 'bootstrap';
    if (/^(OSC|XTAL|XIN|X1|CLKIN|XI)\b|OSC_?IN|OSC32_IN/.test(n)) return 'clock-in';
    if (/^(XOUT|X2|XO)\b|OSC_?OUT|OSC32_OUT/.test(n)) return 'clock-out';
    if (/^(EN|ENABLE|SHDN|N?SHDN|CE|ON|ON\/OFF)\b|_EN$/.test(n)) return 'enable';
    if (/^(FB|VFB|ADJ|VSENSE)\b/.test(n)) return 'feedback';
    if (/^(SW|LX|PH|SW\d)\b/.test(n)) return 'switch';
    if (/^(PG|PGOOD|POK|PWRGD|PGD)\b/.test(n)) return 'power-good';
    if (/^P[A-K]\d{1,2}\b/.test(n)) return 'io';
    return { input: 'input', output: 'output', io: 'io', power: 'power-in', 'power-out': 'power-out', 'open-collector': 'open-drain', 'open-emitter': 'output', hiz: 'output', nc: 'nc' }[pin.type] || 'other';
  }
  // The supply domain a power pin belongs to: its name without numbering ("VDD_2" and "VDD3" are VDD).
  // A pin named for two supplies ("VDD/VDDA") takes the first.
  const domainOf = full => {
    const name = String(full).split('/')[0];
    if (/^\d+V\d*$/i.test(name)) return name.toUpperCase(); // "3V3" is a rail, not VDD3
    return name.toUpperCase().replace(/[\s_-]*\d+$/, '').replace(/_\w*$/, m => (/^_(A|IO|USB|CORE|SMPS|PLL|LDO|OSC)$/.test(m) ? m : '')) || name;
  };

  // A new part file from a schematic part: identity, pins with guessed roles, and the values the
  // schematic's own parameters give (Altium's parametric data), each unverified.
  function fromSchematic(part, by) {
    const kind = guessKind(part);
    const pins = part.pins.map(p => ({ num: p.num, name: p.name, role: guessRole(p, kind) }));
    const domains = [...new Set(pins.filter(p => p.role === 'power-in').map(p => domainOf(p.name)))];
    const main = domains.find(d => /^(VDD|VCC|VIN|VS|V\+)$/.test(d)) || domains[0] || '';
    for (const p of pins) {
      if (p.role === 'power-in') p.domain = domainOf(p.name);
      else if (['io', 'input', 'output', 'open-drain', 'reset', 'boot', 'enable', 'clock-in', 'clock-out', 'power-good'].includes(p.role) && main) p.domain = /^VDDIO/.test(domains.join(' ')) && kind !== 'mcu' ? domains.find(d => /^VDDIO/.test(d)) : main;
    }
    const values = [];
    const num = k => P.parseNum((part.params[k] || '').replace(/,/g, ''));
    const src = 'schematic parameter';
    const lo = num('Min Supply Voltage'), hi = num('Max Supply Voltage');
    if (main && (lo != null || hi != null)) values.push({ k: 'supply.range', on: main, min: lo, max: hi, unit: 'V', src, note: 'From the schematic part\'s Min/Max Supply Voltage' });
    const tl = num('Min Operating Temperature'), th = num('Max Operating Temperature');
    if (tl != null || th != null) values.push({ k: 'temp.range', min: tl, max: th, unit: '°C', src });
    const f = num('Clock Frequency');
    if (f != null && kind === 'mcu') values.push({ k: 'clk.fmax', value: f, unit: 'Hz', src });
    if (kind === 'crystal' && num('Frequency') != null) values.push({ k: 'xtal.f', value: num('Frequency'), unit: 'Hz', src });
    if (kind === 'crystal' && num('Load Capacitance') != null) values.push({ k: 'xtal.cl', value: num('Load Capacitance'), unit: 'F', src });
    const mpn = part.mpn || part.libRef || part.ref;
    return {
      schema: SCHEMA, id: slug(mpn), mpn, match: [], manufacturer: part.params.Manufacturer || part.params['Manufacturer 1'] || '',
      kind, description: part.description || '', package: part.params['Case/Package'] || '',
      datasheet: { title: '', rev: '', url: part.params['Datasheet URL'] || part.params.Datasheet || '', sha256: '' },
      pins, domains: main ? domains : [], values,
      made: { by: by || '', at: now(), how: 'from schematic' }, updated: now()
    };
  }

  // ── Matching ──
  // A schematic part matches a file by its part number or one of the file's match patterns ("STM32G071K?U6*").
  function find(lib, mpn) {
    const n = norm(mpn);
    if (!n) return null;
    for (const f of lib) if (norm(f.mpn) === n) return f;
    for (const f of lib) if ((f.match || []).some(p => glob(p).test(n))) return f;
    return null;
  }
  // Files for close part numbers (another package or packing suffix), to offer as a start.
  function near(lib, mpn) {
    const n = norm(mpn);
    if (n.length < 6) return [];
    const common = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
    return lib.map(f => ({ f, c: common(norm(f.mpn), n) })).filter(x => x.c >= Math.max(6, Math.min(n.length, norm(x.f.mpn).length) - 4)).sort((a, b) => b.c - a.c).slice(0, 3).map(x => x.f);
  }

  // Do the file's pins agree with the schematic symbol's? Mismatches name the pin number.
  function pinCheck(file, part) {
    const out = [];
    const fp = new Map(file.pins.map(p => [String(p.num).toUpperCase(), p]));
    const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const p of part.pins) {
      const f = fp.get(String(p.num).toUpperCase());
      if (!f) { out.push({ num: p.num, sch: p.name, file: null }); continue; }
      const a = clean(p.name), b = clean(f.name);
      if (a && b && a !== b && !a.includes(b) && !b.includes(a)) out.push({ num: p.num, sch: p.name, file: f.name });
    }
    const sp = new Set(part.pins.map(p => String(p.num).toUpperCase()));
    for (const f of file.pins) if (!sp.has(String(f.num).toUpperCase())) out.push({ num: f.num, sch: null, file: f.name });
    return out;
  }

  function stats(file) {
    const v = file.values || [];
    const ok = v.filter(x => x.ok).length;
    return { values: v.length, verified: ok, pins: file.pins.length, roles: file.pins.filter(p => p.role && p.role !== 'other').length };
  }

  // Check a file someone made or edited (by hand or with the Claude skill): the shape, the keys,
  // the units. Returns problems as text; empty means fine.
  function validate(file) {
    const errs = [];
    if (!file || typeof file !== 'object') return ['Not a JSON object'];
    if (file.schema !== SCHEMA) errs.push('schema should be "' + SCHEMA + '"');
    if (!file.mpn) errs.push('mpn is missing');
    if (!Array.isArray(file.pins)) errs.push('pins should be a list');
    if (!Array.isArray(file.values)) errs.push('values should be a list');
    (file.pins || []).forEach((p, i) => {
      if (p.num == null || p.num === '') errs.push('pin ' + (i + 1) + ' has no num');
      if (p.role && !P.ROLES[p.role]) errs.push('pin ' + p.num + ': unknown role "' + p.role + '"');
    });
    (file.values || []).forEach((v, i) => {
      const c = P.byKey.get(v.k);
      if (!v.k) errs.push('value ' + (i + 1) + ' has no k');
      else if (c && c.unit && v.unit && v.unit !== c.unit) errs.push(v.k + ': unit "' + v.unit + '", the catalog says "' + c.unit + '"');
      for (const f of ['min', 'typ', 'max', 'value']) if (v[f] != null && typeof v[f] !== 'number' && typeof v[f] !== 'string') errs.push(v.k + ': ' + f + ' should be a number or an expression');
    });
    return errs;
  }

  // ── Storage: IndexedDB in this browser ──
  const DB = () => (PK.DEMO ? 'pincheck-demo' : 'pincheck');
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB(), 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('parts', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(typeof IDBRequest !== 'undefined' && out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); };
  const all = () => tx('parts', 'readonly', s => s.getAll());
  const put = f => tx('parts', 'readwrite', s => s.put(f));
  const del = id => tx('parts', 'readwrite', s => s.delete(id));
  const meta = (k, v) => tx('meta', v === undefined ? 'readonly' : 'readwrite', s => (v === undefined ? s.get(k) : s.put(v, k)));

  // Saving keeps the file and marks it for the next sync. `local` holds this browser's bookkeeping
  // (the repo blob it was based on, whether it has unsynced edits) and is never written to the repo.
  async function save(file) {
    file.updated = now();
    file.local = Object.assign({}, file.local, { dirty: true });
    await put(file);
    return file;
  }
  const strip = f => { const c = JSON.parse(JSON.stringify(f)); delete c.local; return c; };
  const dump = f => JSON.stringify(strip(f), null, 2) + '\n';

  // ── Sync with pincheck_data ──
  async function token() {
    const w = window.SignoffFoot ? window.SignoffFoot.who() : { token: '' };
    if (!w.token) return '';
    const A = window.SignoffAuth;
    return A && A.owns && A.owns(w.token) ? A.token() : w.token;
  }
  async function gh(path, opts = {}) {
    const t = await token();
    const r = await fetch('https://api.github.com' + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opts.headers || {}) }));
    if (r.status === 404 && opts.allow404) return null;
    if (!r.ok) { const e = new Error('GitHub ' + r.status + ' on ' + path); e.status = r.status; throw e; }
    return r.status === 204 ? null : (opts.raw ? r.text() : r.json());
  }
  // UTF-8 to base64 in chunks: spreading a large file's bytes as arguments overflows the stack.
  const b64 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(bin); };

  // Pull files that changed in the repo, push files edited here. A file edited both here and in the
  // repo since the last sync keeps the newer `updated` and saves the other as "<id>.conflict".
  async function sync(say = () => {}) {
    if (PK.DEMO) return { pulled: 0, pushed: 0, demo: true };
    if (!(await token())) return { pulled: 0, pushed: 0, signedOut: true };
    const base = `/repos/${REPO.owner}/${REPO.name}/contents/${REPO.dir}`;
    const list = (await gh(base, { allow404: true })) || [];
    const remote = new Map(list.filter(x => x.type === 'file' && /\.json$/.test(x.name)).map(x => [x.name.replace(/\.json$/, ''), x]));
    const local = new Map((await all()).map(f => [f.id, f]));
    let pulled = 0, pushed = 0, conflicts = 0;
    for (const [id, r] of remote) {
      const l = local.get(id);
      if (l && l.local && l.local.sha === r.sha) continue;
      say('Reading ' + id);
      const text = await gh(`${base}/${encodeURIComponent(r.name)}`, { headers: { Accept: 'application/vnd.github.raw' }, raw: true });
      let f; try { f = JSON.parse(text); } catch (e) { say(id + ': not JSON, skipped'); continue; }
      if (l && l.local && l.local.dirty) {
        if ((l.updated || '') >= (f.updated || '')) { await put(Object.assign(strip(f), { id: id + '.conflict', local: { sha: null, dirty: false, conflictOf: id } })); l.local.sha = r.sha; await put(l); conflicts++; continue; }
        await put(Object.assign(strip(l), { id: id + '.conflict', local: { sha: null, dirty: false, conflictOf: id } })); conflicts++;
      }
      f.local = { sha: r.sha, dirty: false };
      await put(f); pulled++;
    }
    for (const f of await all()) {
      if (!f.local || !f.local.dirty || f.local.conflictOf) continue;
      say('Saving ' + f.id);
      const body = { message: 'Pincheck: ' + f.mpn + (f.local.sha ? ' updated' : ' added'), content: b64(dump(f)) };
      if (f.local.sha) body.sha = f.local.sha;
      const res = await gh(`${base}/${encodeURIComponent(f.id)}.json`, { method: 'PUT', body: JSON.stringify(body) });
      f.local = { sha: res.content.sha, dirty: false };
      await put(f); pushed++;
    }
    await meta('synced', now());
    return { pulled, pushed, conflicts };
  }
  async function remove(f) {
    if (f.local && f.local.sha && !PK.DEMO) {
      await gh(`/repos/${REPO.owner}/${REPO.name}/contents/${REPO.dir}/${encodeURIComponent(f.id)}.json`, { method: 'DELETE', body: JSON.stringify({ message: 'Pincheck: ' + f.mpn + ' removed', sha: f.local.sha }) });
    }
    await del(f.id);
  }

  PK.library = { SCHEMA, REPO, norm, slug, glob, guessKind, guessRole, domainOf, fromSchematic, find, near, pinCheck, stats, validate, all, put, save, remove, meta, sync, dump, strip, token };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
