// Pincheck's stored runs (docs/send-to-signoff-ee.md): a sent run is kept in this browser and, when signed
// in, stored with the board's Signoff EE review, as Fabcheck stores its runs (../pcb_dfm/assets/repo.js).
//
//   <dataPath>pincheck/<projectId>/runs/<runId>.json         { run, findings }
//   <dataPath>pincheck/<projectId>/designs/<key>.json.gz     gzip of { v: 1, design, library }
//
// The bundle is the design as read (parts, nets, sheet drawings) and the part files it was checked against,
// so a reopened run is the same run. Pincheck only writes to a review's repo; Signoff EE reads a run back
// and hands it over in IndexedDB dovetail-handoff (the engine's github.js, S.handoff), as for Fabcheck.
(function (PK) {
  'use strict';
  const NS = 'signoff.v1.';
  const load = (k, d) => { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  let fetchImpl = null, testToken = null; // tests inject a fake GitHub and a token here
  const token = () => { if (testToken != null) return testToken; try { return sessionStorage.getItem('signoff.token') || localStorage.getItem('signoff.token') || ''; } catch (e) { return ''; } };
  const RUN_ID = /^pk[a-z0-9]{6,40}$/;

  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha256(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  const gzip = bytes => pipe(bytes, new CompressionStream('gzip'));
  const gunzip = bytes => pipe(bytes, new DecompressionStream('gzip'));
  const newId = () => 'pk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // The part files the design's parts matched, without this browser's sync state.
  function libraryUsed(d, lib) {
    const L = PK.library, out = new Map();
    for (const p of d.parts) { const f = p.mpn && L.find(lib, p.mpn); if (f && !out.has(f.id)) out.set(f.id, L.strip(f)); }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  // The design as stored: what reading the files gave, not what the app added since (its run, scan state).
  const DESIGN_KEYS = ['name', 'source', 'netlist', 'sheets', 'parts', 'nets', 'notes', 'drawings'];
  function designOf(d) { const o = {}; for (const k of DESIGN_KEYS) o[k] = d[k] == null ? null : d[k]; return o; }
  // Findings as stored: the contract's fields, with the waiver as sent.
  function compact(findings) {
    return findings.map(f => ({ id: f.id, check: f.check, group: f.group, severity: f.severity, title: f.title, detail: f.detail || '',
      refs: f.refs || [], pins: f.pins || [], nets: f.nets || [], basis: f.basis || [], unverified: !!f.unverified,
      waived: f.waived ? { reason: f.waived.reason || '', by: f.waived.by || '', at: f.waived.at || '', scope: f.waived.scope || 'one' } : null }));
  }

  // A run record and its bundle for the open design. Resolves { run, findings, bundle: Uint8Array (gzip) }.
  async function make(d, lib, by) {
    const library = libraryUsed(d, lib);
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, design: designOf(d), library }));
    const key = (await sha256(json)).slice(0, 16);
    const bundle = await gzip(json);
    const findings = compact(d.run.findings);
    const c = { error: 0, warn: 0, info: 0, waived: 0 };
    for (const f of findings) { if (f.waived) c.waived++; else c[f.severity]++; }
    const st = library.reduce((a, f) => { const s = PK.library.stats(f); a.values += s.values; a.verified += s.verified; return a; }, { files: library.length, values: 0, verified: 0 });
    const run = {
      id: newId(), at: new Date().toISOString(), by: by || '', tool: { name: 'Pincheck', version: PK.VERSION || 'dev' },
      design: { name: d.name, source: d.source || '', netlist: d.netlist || '', sheets: (d.sheets || []).length, parts: d.parts.length, nets: (d.nets || []).length,
        key, sha256: await sha256(bundle), size: bundle.length, path: null },
      library: st, summary: c, stored: null,
    };
    return { run, findings, bundle };
  }

  // Open a bundle: { design, library }, or throws.
  async function open(bundle) {
    const b = JSON.parse(new TextDecoder().decode(await gunzip(bundle)));
    if (!b || b.v !== 1 || !b.design || !Array.isArray(b.design.parts)) throw new Error('not a Pincheck run');
    return { design: b.design, library: Array.isArray(b.library) ? b.library : [] };
  }

  // ── Runs kept in this browser: every sent run, so Signoff's links find it here (the demo's only way) ──
  const DB = () => (PK.DEMO ? 'pincheck-runs-demo' : 'pincheck-runs');
  function tx(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB(), 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('runs')) r.result.createObjectStore('runs', { keyPath: 'id' }); };
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result, t = db.transaction('runs', mode), q = fn(t.objectStore('runs'));
        t.oncomplete = () => { db.close(); res(q && q.result); };
        t.onerror = () => { db.close(); rej(t.error); };
      };
    });
  }
  const keep = entry => tx('readwrite', s => s.put({ id: entry.run.id, run: entry.run, findings: entry.findings, bundle: entry.bundle, projectId: entry.projectId || '', at: new Date().toISOString() }));
  const kept = id => tx('readonly', s => s.get(id));

  // The hand-off Signoff EE left for this run (dovetail-handoff, store runs), taken once and kept here.
  function handoffTx(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(PK.DEMO ? 'dovetail-handoff-demo' : 'dovetail-handoff', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('runs')) r.result.createObjectStore('runs', { keyPath: 'id' }); };
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result, t = db.transaction('runs', mode), q = fn(t.objectStore('runs'));
        t.oncomplete = () => { db.close(); res(q && q.result); };
        t.onerror = () => { db.close(); rej(t.error); };
      };
    });
  }
  async function takeHandoff(id) {
    const e = await handoffTx('readonly', s => s.get(id)).catch(() => null);
    if (!e || e.tool !== 'pincheck' || !e.run || e.run.id !== id || !(e.bundle instanceof Uint8Array)) return null;
    // The bundle was checked against its SHA-256 by Signoff; check it again before trusting it.
    if (e.run.design && e.run.design.sha256 && (await sha256(e.bundle)) !== e.run.design.sha256) return null;
    await keep(e).catch(() => {});
    await handoffTx('readwrite', s => s.delete(id)).catch(() => {});
    return e;
  }
  // A run by id: kept here, else handed over by Signoff EE. Resolves the entry or null.
  async function find(id) {
    if (!RUN_ID.test(id || '')) return null;
    return (await kept(id).catch(() => null)) || takeHandoff(id);
  }

  // ── Storing with the board's review (as Fabcheck's repo.js) ──
  // The board's home repo and the folder for its runs, as Signoff EE decides it.
  function home(projectId) {
    const s = load('settings', {}) || {}, roster = load('roster', {}) || {}, homes = load('homes', {}) || {};
    const owner = s.owner || 'chrismessick-dpd';
    const dataRepo = s.dataRepo || 'ee_design_review_data';
    const shared = roster.shared && roster.shared[projectId] && roster.shared[projectId].repo;
    const repo = shared || homes[projectId] || owner + '/' + dataRepo;
    const isData = repo.toLowerCase() === (owner + '/' + dataRepo).toLowerCase();
    const dataPath = isData && s.dataPath ? s.dataPath.replace(/\/+$/, '') + '/' : '';
    return { repo, dir: dataPath + 'pincheck/' + projectId + '/', branch: s.branch || 'main' };
  }
  function storeFor(repo, branch) {
    const [owner, name] = repo.split('/');
    return new window.Signoff.GitHubStore({ owner, repo: name, branch: branch || 'main', token: token() }, fetchImpl || undefined);
  }
  function readiness(projectId) {
    const h = home(projectId);
    if (!window.Signoff || !window.Signoff.GitHubStore) return { ok: false, repo: h.repo, text: 'the GitHub engine did not load' };
    if (!token()) return { ok: false, repo: h.repo, signIn: true, text: 'you are not signed in to GitHub in this tab. Send asks you to sign in' };
    if (!(window.crypto && crypto.subtle) || typeof CompressionStream === 'undefined') return { ok: false, repo: h.repo, text: 'storing needs a secure page (http://localhost or https) in a current browser' };
    return { ok: true, repo: h.repo };
  }
  const probes = new Map();
  function probe(projectId) {
    const r = readiness(projectId);
    if (!r.ok) return Promise.resolve(r);
    const key = r.repo + ' ' + token().length + token().slice(-6);
    if (!probes.has(key)) {
      probes.set(key, storeFor(r.repo).api('').then(info => info && info.permissions && info.permissions.push === false
        ? { ok: false, repo: r.repo, text: `this token can read ${r.repo} but not write to it` } : r,
      err => {
        if (!(err.status === 401 || err.status === 404 || err.status === 403)) probes.delete(key);
        return { ok: false, repo: r.repo, text: err.status === 401 ? 'GitHub rejected the sign-in (expired or revoked?); sign in again in Settings'
          : err.status === 404 || err.status === 403 ? `this sign-in can't open ${r.repo}` : `GitHub didn't answer (${err.message || err})` };
      }));
    }
    return probes.get(key);
  }

  // Store a made run (make()) with the board: the run file and the bundle, in one commit, before the issues
  // are written, so they carry where the run is. Never throws: resolves { ok, run, res } or { ok: false, why }.
  async function store(made, projectId, progress) {
    progress = progress || (() => {});
    const ready = readiness(projectId);
    if (!ready.ok) return { ok: false, why: ready.text };
    const h = home(projectId);
    const path = h.dir + 'designs/' + made.run.design.key + '.json.gz';
    const run = Object.assign({}, made.run, { stored: { repo: h.repo, dir: h.dir }, design: Object.assign({}, made.run.design, { path }) });
    const files = [
      { path, bytes: made.bundle },
      { path: h.dir + 'runs/' + run.id + '.json', text: JSON.stringify({ run, findings: made.findings }, null, 1) },
    ];
    const bytes = made.bundle.length + files[1].text.length;
    progress(`Uploading to ${h.repo} (${(bytes / 1024).toFixed(0)} KB)…`, 0.3);
    try {
      const res = await storeFor(h.repo, h.branch).putFiles(files, {
        message: `Pincheck: store run ${run.id} (${run.design.name})`,
        onProgress: (done, total) => progress(`Uploading to ${h.repo}: ${done} of ${total} new files…`, 0.3 + 0.6 * (total ? done / total : 1)),
        onRetry: n => progress(`Someone else pushed first; retrying (${n})…`),
      });
      made.run = run;
      return { ok: true, run, res };
    } catch (err) {
      return { ok: false, why: err.status === 404 || err.status === 403 ? `this sign-in can't write to ${h.repo}` : (err.message || String(err)) };
    }
  }

  PK.runs = { make, open, keep, kept, find, takeHandoff, home, readiness, probe, store, libraryUsed, designOf, compact, sha256, gzip, gunzip,
    signedIn: () => !!token(), clearProbes: () => probes.clear(), setFetch: f => { fetchImpl = f; }, setToken: t => { testToken = t; }, RUN_ID };
})(window.PK = window.PK || {});
