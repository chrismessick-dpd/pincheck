// Pincheck UI: drop schematic sheets or a netlist, see which parts the library knows, and make part
// files for the rest (assets/editor.js). Schematics stay in this tab; only the library syncs.
(function (PK) {
  'use strict';
  const L = PK.library, P = PK.params, D = PK.design;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEMO = /[?&]demo\b/.test(location.search);
  PK.DEMO = DEMO;

  const state = { designs: [], active: null, view: 'home', tab: 'overview', lib: [], libGen: 0, filter: 'ics', libQuery: '', busy: null, sync: { at: null, busy: false, error: '' },
    q: '', sev: { error: true, warn: true, info: true }, check: '', openFinding: null };
  const active = () => state.designs.find(d => d.id === state.active) || null;

  // ── Theme and sidebar: the suite's (same keys as Partcheck and Fabcheck) ──
  const SETTINGS_KEY = 'signoff.v1.settings';
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function readTheme() { try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}).theme || 'auto'; } catch (e) { return 'auto'; } }
  function writeTheme(t) { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; s.theme = t; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ } }
  const isDark = t => t === 'dark' || (t !== 'light' && !!(darkQuery && darkQuery.matches));
  const ICON = {
    sun: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/></svg>',
    moon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M16 12.3A6.5 6.5 0 0 1 7.7 4a6.5 6.5 0 1 0 8.3 8.3z"/></svg>',
    chip: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="6" y="5" width="8" height="10" rx="1.5"/><path d="M3 8h3M3 12h3M14 8h3M14 12h3"/></svg>',
    drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>',
    sync: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5A5 5 0 0 0 3.6 4.8M3 9.5a5 5 0 0 0 9.4 1.7"/><path d="M3.3 2.5v2.6h2.6M12.7 13.5v-2.6h-2.6"/></svg>'
  };
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const b = $('#theme-btn');
    if (b) { b.innerHTML = isDark(t) ? ICON.sun : ICON.moon; b.title = isDark(t) ? 'Light mode' : 'Dark mode'; }
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(readTheme()));
  const SIDE_KEY = (DEMO ? 'pincheck.demo.' : 'pincheck.v1.') + 'sideCollapsed';
  const narrow = window.matchMedia ? matchMedia('(max-width: 860px)') : { matches: false };
  function toggleSidebar() {
    if (narrow.matches) { $('#app').classList.toggle('nav-open'); return; }
    const on = !$('#app').classList.contains('side-collapsed');
    $('#app').classList.toggle('side-collapsed', on);
    try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  document.addEventListener('click', e => {
    const app = $('#app');
    if (!app.classList.contains('nav-open') || e.target !== app) return;
    app.classList.remove('nav-open'); e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.sheet-wrap')) return;
    e.preventDefault(); toggleSidebar();
  });

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' pk-toast-error' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3600);
  }
  PK.toast = toast;
  const who = () => { const w = window.SignoffFoot ? window.SignoffFoot.who() : {}; return w.login ? '@' + w.login : (DEMO ? 'demo visitor' : 'this browser'); };

  // ── Opening designs ──
  async function openFiles(files) {
    files = [...files];
    const json = files.filter(f => /\.json$/i.test(f.name));
    const sch = files.filter(f => !/\.json$/i.test(f.name));
    for (const f of json) await importJson(await f.text(), f.name);
    if (!sch.length) return;
    state.busy = 'Reading ' + (sch.length === 1 ? sch[0].name : sch.length + ' files');
    state.view = 'design'; renderAll();
    try {
      const d = await D.build(sch);
      if (!d.parts.length) throw new Error('No parts found in ' + sch.map(f => f.name).join(', '));
      d.id = 'd' + Date.now().toString(36);
      state.designs.unshift(d); state.active = d.id; state.view = 'design'; state.tab = 'overview'; state.check = ''; state.q = ''; state.openFinding = null;
      if (d.notes.length) d.notes.forEach(n => console.info('Pincheck:', n));
    } catch (e) { toast(e.message, 'error'); state.view = active() ? 'design' : 'home'; }
    state.busy = null; renderAll();
  }

  async function importJson(text, name) {
    let g;
    try { g = JSON.parse(text); } catch (e) { toast(name + ': not JSON', 'error'); return; }
    const list = Array.isArray(g) ? g : [g];
    let n = 0;
    for (const f of list) {
      const errs = L.validate(f);
      if (errs.length) { toast(name + ': ' + errs[0], 'error'); continue; }
      f.id = f.id || L.slug(f.mpn);
      const had = state.lib.find(x => x.id === f.id);
      if (had && !confirm(f.mpn + ' is already in the library. Replace it with ' + name + '?')) continue;
      if (had) f.local = had.local;
      await L.save(f); n++;
    }
    if (n) { toast('Added ' + n + ' part file' + (n === 1 ? '' : 's') + ' to the library'); await reloadLib(); scheduleSync(); }
  }

  async function reloadLib() { state.lib = (await L.all()).filter(f => !f.local || !f.local.conflictOf); state.libGen++; renderAll(); }

  // The checks run when a design opens and again whenever the library changes (assets/checks.js).
  function ensureRun(d) {
    if (d.run && d.runGen === state.libGen) return d.run;
    try { d.run = PK.checks.run(d, state.lib); } catch (e) { console.error(e); toast('The checks stopped: ' + e.message, 'error'); d.run = { findings: [], rails: [], coverage: {}, parts: {}, ms: 0, hasNets: false }; }
    d.runGen = state.libGen;
    applyWaivers(d);
    return d.run;
  }

  // ── Waivers (as Fabcheck's): a reason is required; one finding, or every finding like it, which
  // folds channel copies together (U5.1 on BUS_RX.1 is like U5.2 on BUS_RX.2). Kept in this browser
  // per design name. Waived findings leave the counts and show in Findings' Waived section.
  const WAIVE_KEY = d => (DEMO ? 'pincheck.demo.' : 'pincheck.v1.') + 'waivers.' + d.name;
  const similarKey = f => f.check + '|' + f.title.replace(/([A-Za-z_+][\w+]*?)\.\d+\b/g, '$1');
  function loadWaivers(d) { try { return JSON.parse(localStorage.getItem(WAIVE_KEY(d)) || '[]'); } catch (e) { return []; } }
  function saveWaivers(d, list) { try { localStorage.setItem(WAIVE_KEY(d), JSON.stringify(list)); } catch (e) { toast('Couldn\'t save the waiver in this browser', 'error'); } }
  function applyWaivers(d) {
    const list = loadWaivers(d);
    for (const f of d.run.findings) f.waived = list.find(w => (w.scope === 'one' ? w.key === f.id : w.key === similarKey(f))) || null;
  }
  function waiveSheet(d, f) {
    const like = d.run.findings.filter(x => !x.waived && similarKey(x) === similarKey(f));
    const w = document.createElement('div');
    w.className = 'sheet-wrap';
    w.innerHTML = '<div class="sheet"><div class="sheet-head"><h2>Waive this finding</h2><p>' + esc(f.title) + '</p></div><div class="sheet-body">' +
      '<div class="field"><label>Why it\'s fine (required)</label><textarea class="input" rows="3" data-w="reason" placeholder="e.g. Variant choice: only one of U21 and U25 is fitted."></textarea></div>' +
      (like.length > 1 ? '<div class="field"><label><input type="radio" name="pk-wscope" value="one" checked> This finding only</label><br><label><input type="radio" name="pk-wscope" value="similar"> All ' + like.length + ' like it (' + esc(like.slice(0, 4).map(x => x.refs[0] || x.nets[0]).join(', ')) + (like.length > 4 ? ', …' : '') + ')</label></div>' : '') +
      '<p class="pk-muted">Kept in this browser for ' + esc(d.name) + '. A waived finding leaves the counts and stays listed under Waived, where it can be restored.</p></div>' +
      '<div class="sheet-foot"><button class="btn" data-w="cancel">Cancel</button><button class="btn btn-primary" data-w="save">Waive</button></div></div>';
    document.body.appendChild(w);
    w.querySelector('textarea').focus();
    w.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.w;
      if (e.target === w || a === 'cancel') { w.remove(); return; }
      if (a !== 'save') return;
      const reason = w.querySelector('textarea').value.trim();
      if (!reason) { w.querySelector('textarea').focus(); toast('Say why it\'s fine', 'error'); return; }
      const scope = (w.querySelector('input[name="pk-wscope"]:checked') || { value: 'one' }).value;
      const list = loadWaivers(d).concat([{ key: scope === 'one' ? f.id : similarKey(f), scope, reason, by: who(), at: new Date().toISOString(), title: f.title, check: f.check }]);
      saveWaivers(d, list); applyWaivers(d); w.remove(); state.openFinding = null; renderTabs(); renderView();
      toast(scope === 'one' ? 'Waived' : 'Waived ' + like.length + ' findings');
    });
  }

  // ── The library's sync with pincheck_data ──
  let syncTimer = null;
  function scheduleSync(ms = 1500) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
  async function syncNow() {
    if (DEMO || state.sync.busy) return;
    if (!(await L.token())) { renderToolbar(); return; }
    state.sync.busy = true; state.sync.error = ''; renderToolbar();
    try {
      const r = await L.sync();
      state.sync.at = Date.now();
      if (r.conflicts) toast(r.conflicts + ' part file' + (r.conflicts === 1 ? ' was' : 's were') + ' changed here and in pincheck_data: the older copy is kept as “.conflict”');
      if (r.pulled || r.pushed) await reloadLib();
    } catch (e) {
      state.sync.error = e.status === 404 ? 'pincheck_data not found (or no access)' : e.message;
    }
    state.sync.busy = false; renderToolbar();
  }

  // ── Rendering ──
  function renderAll() { renderSide(); renderToolbar(); renderTabs(); renderView(); }

  // Overview, Findings, Schematic, and Parts, as Fabcheck's toolbar tabs. The Schematic tab shows for every
  // design; a KiCad netlist's says it has no drawing (assets/viewer.js).
  function renderTabs() {
    const seg = $('#view-seg'), d = active();
    if (state.view !== 'design' || !d || state.busy) { seg.hidden = true; return; }
    const run = ensureRun(d), c = PK.pages.counts(run.findings.filter(f => !f.waived));
    const tabs = [['overview', 'Overview', ''], ['findings', 'Findings', c.error || c.warn ? '<span class="count">' + (c.error ? '✕ ' + c.error + ' ' : '') + (c.warn ? '▲ ' + c.warn : '') + '</span>' : ''], ['parts', 'Parts', '']];
    if (PK.viewer) tabs.splice(2, 0, ['schematic', 'Schematic', '']);
    seg.hidden = false;
    seg.innerHTML = tabs.map(([k, l, x]) => '<button role="tab" data-tab="' + k + '" class="' + (state.tab === k ? 'on' : '') + '">' + l + x + '</button>').join('');
  }

  function renderSide() {
    $('#design-list').innerHTML = state.designs.length ? state.designs.map(d => {
      const g = D.groups(d, ['ic', 'crystal']);
      const miss = g.filter(x => !L.find(state.lib, x.mpn)).length;
      return '<button class="proj' + (d.id === state.active && state.view === 'design' ? ' active' : '') + '" data-design="' + d.id + '"><span class="pk-ico">' + ICON.chip + '</span><span class="proj-body"><span class="proj-name">' + esc(d.name) + '</span><span class="proj-sub">' + d.parts.length + ' parts · ' + (miss ? miss + ' not in library' : 'all ICs in library') + '</span></span></button>';
    }).join('') : '<div class="side-empty">Drop schematic sheets or a netlist to start.</div>';
    $('#library-count').textContent = state.lib.length ? state.lib.length : '';
    $('#library-link').classList.toggle('active', state.view === 'library');
  }

  function renderToolbar() {
    const el = $('#toolbar-actions');
    if (DEMO) { el.innerHTML = '<span class="pk-muted">Demo library (this browser only)</span>'; return; }
    const unsynced = state.lib.filter(f => f.local && f.local.dirty).length;
    const signed = window.SignoffFoot && window.SignoffFoot.who().token;
    let label;
    if (!signed) label = 'Library in this browser only · sign in to sync';
    else if (state.sync.busy) label = 'Syncing the library…';
    else if (state.sync.error) label = '✕ ' + state.sync.error;
    else if (unsynced) label = unsynced + ' unsynced';
    else if (state.sync.at) label = 'Library synced ' + ago(state.sync.at);
    else label = 'Library not synced yet';
    el.innerHTML = '<span class="pk-muted' + (state.sync.error ? ' pk-err' : '') + '">' + esc(label) + '</span>' + (signed ? '<button class="icon-btn" data-act="sync" title="Sync the library with pincheck_data" aria-label="Sync">' + ICON.sync + '</button>' : '');
  }
  const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };

  function renderView() {
    const v = $('#view');
    if (state.busy) { v.innerHTML = '<div class="page"><div class="card pk-busy"><div class="pk-spin"></div><div>' + esc(state.busy) + '</div></div></div>'; return; }
    if (state.view === 'library') { v.innerHTML = libraryPage(); return; }
    const d = active();
    if (state.view === 'design' && d) {
      const ctx = { lib: state.lib, state, hasSheets: !!d.sheetsDrawn };
      if (state.tab === 'findings') v.innerHTML = PK.pages.findings(d, ensureRun(d), ctx);
      else if (state.tab === 'parts') v.innerHTML = designPage(d);
      else if (state.tab === 'schematic' && PK.viewer) { ensureRun(d); PK.viewer.render(v, d, state); }
      else v.innerHTML = PK.pages.overview(d, ensureRun(d), ctx);
      return;
    }
    v.innerHTML = homePage();
  }

  function homePage() {
    return '<div class="page"><div class="eyebrow">Prototype</div><h1 class="page-title">Pincheck</h1>' +
      '<p class="pk-lede">Checks a schematic against what each part allows: supply ranges, I/O levels, pin functions, and more. It starts by finding the ICs and looking each one up in the part library. Parts it doesn\'t know yet get a part file, which you fill in by hand or with Claude from the datasheet.</p>' +
      '<button class="card pk-drop" data-act="open"><span class="pk-drop-ico">' + ICON.drop + '</span><b>Drop schematic sheets or a netlist</b><span class="pk-muted">Altium: every .SchDoc of the project, with its Protel2 netlist (Design › Netlist For Project › Protel2) for the nets. KiCad: the XML netlist. Read in this tab and never uploaded.</span></button>' +
      (DEMO ? '' : '<div class="pk-demo-row"><a class="btn" href="?demo">Try the demo</a><span class="pk-muted">The made-up Smart Thermostat\'s Main PCBA, with a small library.</span></div>') +
      '<div class="grid grid-3" style="margin-top:22px">' +
      what('1. Find the parts', 'Every IC, crystal, and other active part, with its part number from the schematic\'s parameters, Comment, or library reference.') +
      what('2. Fill the library', 'Each part file holds the pins with their roles and supply domains, and the values the checks use, each with its datasheet page. Values start unverified; a person ticks each against the page.') +
      what('3. Check (next)', 'Net voltages worked out from the regulators, then every pin checked against its part: supplies in range, I/O levels, pins that need a supply or pull, and alternate functions.') +
      '</div></div>';
  }
  const what = (h, p) => '<div class="card pk-what"><b>' + h + '</b><p>' + p + '</p></div>';

  const FILTERS = { ics: ['ICs and crystals', ['ic', 'crystal']], active: ['All but passives', ['ic', 'crystal', 'transistor', 'diode', 'connector', 'other']], all: ['All parts', null] };
  function designPage(d) {
    const all = D.groups(d, FILTERS[state.filter][1]);
    const ics = D.groups(d, ['ic', 'crystal']);
    const known = ics.filter(g => L.find(state.lib, g.mpn));
    const rows = all.map(g => {
      const f = L.find(state.lib, g.mpn);
      const s = f ? L.stats(f) : null;
      const mism = f ? L.pinCheck(f, g.part).length : 0;
      const near = !f && g.mpn ? L.near(state.lib, g.mpn) : [];
      const status = f
        ? '<span class="pk-st pk-st-ok">✓ In library</span><div class="pk-sub">' + s.verified + ' of ' + s.values + ' values verified</div>' + (mism ? '<div class="pk-sub pk-warn">▲ ' + mism + ' pin' + (mism === 1 ? '' : 's') + ' differ</div>' : '')
        : g.mpn ? '<span class="pk-st pk-st-miss">▲ Not in library</span>' : '<span class="pk-st pk-st-none">No part number</span>';
      return '<tr><td>' + status + '</td><td class="pk-refs"' + (g.refs.length > 8 ? ' title="' + esc(g.refs.join(', ')) + '"' : '') + '>' + esc(g.refs.length > 8 ? g.refs.slice(0, 6).join(', ') + ', … (' + g.refs.length + ')' : g.refs.join(', ')) + '</td>' +
        '<td><span class="pk-mono">' + esc(g.mpn || '—') + '</span>' + (g.part.mpnFrom ? '<div class="pk-sub">from ' + esc(g.part.mpnFrom) + '</div>' : '') +
        near.map(n => '<div class="pk-sub">Close to <span class="pk-mono">' + esc(n.mpn) + '</span> <button class="pk-link" data-alias="' + esc(n.id) + '" data-mpn="' + esc(g.mpn) + '">Use its file</button></div>').join('') + '</td>' +
        '<td class="pk-desc">' + esc(g.part.description || g.part.params.Value || '') + '</td><td class="pk-num">' + g.part.pins.length + '</td>' +
        '<td>' + (g.kind === 'ic' || g.kind === 'crystal' || f ? '<button class="btn btn-sm' + (f ? '' : ' btn-primary') + '" data-config="' + esc(g.part.ref) + '">' + (f ? 'Open' : 'Configure') + '</button>' : '') + '</td></tr>';
    }).join('');
    const missing = ics.filter(g => g.mpn && !L.find(state.lib, g.mpn));
    return '<div class="page pk-wide"><div class="page-head"><div class="page-head-text"><div class="eyebrow">' + (d.source === 'kicad' ? 'KiCad netlist' : d.source === 'altium' ? (d.netlist ? 'Altium schematic and Protel2 netlist' : 'Altium schematic') : 'Schematic') + '</div><h1 class="page-title">' + esc(d.name) + '</h1>' +
      '<div class="page-sub"><span>' + d.sheets.length + ' file' + (d.sheets.length === 1 ? '' : 's') + '</span><span class="sep">·</span><span>' + d.parts.length + ' parts</span><span class="sep">·</span><span>' + (d.nets ? d.nets.length + ' nets' : 'no netlist yet') + '</span></div></div>' +
      '<div class="pk-head-actions">' + (missing.length ? '<button class="btn btn-primary" data-config="' + esc(missing[0].part.ref) + '">Configure next (' + missing.length + ' left)</button>' : '') + '</div></div>' +
      '<div class="grid grid-4 pk-stats">' + stat(known.length + ' / ' + ics.length, 'ICs and crystals in the library') + stat(missing.length, 'to configure', missing.length ? 'warn' : '') + stat(ics.filter(g => !g.mpn).length, 'without a part number') + stat(state.lib.length, 'part files in the library') + '</div>' +
      (d.notes.length ? '<div class="hint" style="margin-top:16px">' + d.notes.map(esc).join('<br>') + '</div>' : '') +
      '<div class="pk-filter"><div class="seg">' + Object.entries(FILTERS).map(([k, [l]]) => '<button data-filter="' + k + '" class="' + (state.filter === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div>' +
      '<div class="card pk-scroll"><table class="table pk-parts"><thead><tr><th>Library</th><th>Refs</th><th>Part number</th><th>Description</th><th class="pk-num">Pins</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  const stat = (n, l, tone) => '<div class="card stat' + (tone ? ' pk-stat-' + tone : '') + '"><div class="stat-num">' + n + '</div><div class="pk-muted">' + l + '</div></div>';

  function libraryPage() {
    const q = state.libQuery.trim().toUpperCase();
    const list = state.lib.filter(f => !q || (f.mpn + ' ' + (f.match || []).join(' ') + ' ' + f.manufacturer + ' ' + f.description + ' ' + f.kind).toUpperCase().includes(q)).sort((a, b) => a.mpn.localeCompare(b.mpn));
    return '<div class="page pk-wide"><div class="page-head"><div class="page-head-text"><div class="eyebrow">' + (DEMO ? 'Demo' : 'pincheck_data') + '</div><h1 class="page-title">Part library</h1><div class="page-sub">' + state.lib.length + ' part files · ' + state.lib.reduce((n, f) => n + L.stats(f).verified, 0) + ' verified values</div></div>' +
      '<div class="pk-head-actions"><button class="btn" data-act="import">Import JSON…</button><button class="btn" data-act="export-all"' + (state.lib.length ? '' : ' disabled') + '>Export all</button><button class="btn btn-primary" data-act="new-part">New part</button></div></div>' +
      '<input class="input pk-search" data-id="lib-q" placeholder="Search part numbers, makers, and descriptions" value="' + esc(state.libQuery) + '">' +
      (list.length ? '<div class="card pk-scroll"><table class="table pk-parts"><thead><tr><th>Part number</th><th>Kind</th><th>Manufacturer</th><th class="pk-num">Pins</th><th class="pk-num">Values</th><th class="pk-num">Verified</th><th>Updated</th><th></th></tr></thead><tbody>' +
        list.map(f => { const s = L.stats(f); return '<tr><td><span class="pk-mono">' + esc(f.mpn) + '</span>' + ((f.match || []).length ? '<div class="pk-sub">also ' + esc(f.match.join(', ')) + '</div>' : '') + (f.local && f.local.conflictOf ? '<div class="pk-sub pk-warn">▲ conflict copy of ' + esc(f.local.conflictOf) + '</div>' : '') + '</td><td>' + esc(P.KINDS[f.kind] || f.kind) + '</td><td>' + esc(f.manufacturer) + '</td><td class="pk-num">' + s.pins + '</td><td class="pk-num">' + s.values + '</td><td class="pk-num">' + s.verified + '</td><td class="pk-sub">' + esc((f.updated || '').slice(0, 10)) + (f.local && f.local.dirty && !DEMO ? ' · unsynced' : '') + '</td><td><button class="btn btn-sm" data-edit="' + esc(f.id) + '">Open</button></td></tr>'; }).join('') + '</tbody></table></div>'
        : '<div class="empty"><div class="empty-art">' + ICON.chip + '</div><h2>' + (state.lib.length ? 'Nothing matches' : 'No part files yet') + '</h2><p>' + (state.lib.length ? 'Try another search.' : 'Open a schematic and configure its parts, or import part files the Claude skill wrote.') + '</p></div>') + '</div>';
  }

  // ── The part window ──
  function editPart(file, part, isNew) {
    PK.editor.open({
      file, part, isNew, who,
      onSave: async f => {
        const was = state.lib.find(x => x.id === f.id);
        if (isNew && was && was !== file && !confirm('A part file named ' + f.id + ' exists. Replace it?')) return;
        f.local = was ? was.local : f.local;
        await L.save(f); toast('Saved ' + f.mpn); await reloadLib(); scheduleSync();
      },
      onDelete: async f => { try { await L.remove(f); toast('Deleted ' + f.mpn); } catch (e) { toast(e.message, 'error'); } await reloadLib(); }
    });
  }
  function configure(ref) {
    const d = active(); if (!d) return;
    const part = d.parts.find(p => p.ref === ref); if (!part) return;
    const have = L.find(state.lib, part.mpn);
    if (have) editPart(have, part, false);
    else editPart(L.fromSchematic(part, who()), part, true);
  }

  // ── Events ──
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-act],[data-design],[data-config],[data-filter],[data-edit],[data-alias],[data-tab],[data-sev],[data-sevonly],[data-fopen],[data-openfile],[data-show],[data-waive],[data-unwaive]');
    if (!t) return;
    if (t.dataset.design) { state.active = t.dataset.design; state.view = 'design'; $('#app').classList.remove('nav-open'); renderAll(); return; }
    if (t.dataset.config) { configure(t.dataset.config); return; }
    if (t.dataset.filter) { state.filter = t.dataset.filter; renderView(); return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderTabs(); renderView(); $('#main').scrollTop = 0; return; }
    if (t.dataset.sev) { state.sev = Object.assign({}, state.sev, { [t.dataset.sev]: !state.sev[t.dataset.sev] }); renderView(); return; }
    if (t.dataset.sevonly) { state.sev = { error: false, warn: false, info: false, [t.dataset.sevonly]: true }; state.tab = 'findings'; renderTabs(); renderView(); return; }
    if (t.dataset.fopen) { state.openFinding = state.openFinding === t.dataset.fopen ? null : t.dataset.fopen; renderView(); return; }
    if (t.dataset.show && PK.viewer) { const d = active(); const f = d && d.run && d.run.findings.find(x => x.id === t.dataset.show); if (f) { state.tab = 'schematic'; state.showFinding = f; renderTabs(); renderView(); } return; }
    if (t.dataset.waive) { const d = active(); const f = d && d.run.findings.find(x => x.id === t.dataset.waive); if (f) waiveSheet(d, f); return; }
    if (t.dataset.unwaive) { const d = active(); const f = d && d.run.findings.find(x => x.id === t.dataset.unwaive); if (f && f.waived) { saveWaivers(d, loadWaivers(d).filter(w => !(w.key === f.waived.key && w.at === f.waived.at))); applyWaivers(d); renderTabs(); renderView(); toast('Restored'); } return; }
    if (t.dataset.openfile) { const f = state.lib.find(x => x.id === t.dataset.openfile); const d = active(); const part = d && t.dataset.ref ? d.parts.find(p => p.ref === t.dataset.ref) : null; if (f) editPart(f, part, false); return; }
    if (t.dataset.edit) { const f = state.lib.find(x => x.id === t.dataset.edit); if (f) editPart(f, null, false); return; }
    if (t.dataset.alias) {
      const f = state.lib.find(x => x.id === t.dataset.alias);
      if (!f || !confirm('Use ' + f.mpn + '\'s file for ' + t.dataset.mpn + ' too? Only if the pinout and ratings are the same.')) return;
      f.match = [...new Set([...(f.match || []), t.dataset.mpn])];
      await L.save(f); await reloadLib(); scheduleSync(); return;
    }
    const a = t.dataset.act;
    if (a === 'nav') toggleSidebar();
    else if (a === 'home') { state.view = 'home'; renderAll(); }
    else if (a === 'open') { const i = $('#file-input'); i.value = ''; i.click(); }
    else if (a === 'library') { state.view = 'library'; $('#app').classList.remove('nav-open'); renderAll(); }
    else if (a === 'theme') { const t2 = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(t2); applyTheme(t2); }
    else if (a === 'sync') syncNow();
    else if (a === 'rerun') { const d = active(); if (d) { d.run = null; ensureRun(d); renderTabs(); renderView(); toast('Checked again: ' + d.run.findings.length + ' findings'); } }
    else if (a === 'import') PK.editor.pickJson((text, name) => importJson(text, name));
    else if (a === 'export-all') { const b = new Blob([JSON.stringify(state.lib.map(L.strip), null, 2) + '\n'], { type: 'application/json' }); const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = 'pincheck-library.json'; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1500); }
    else if (a === 'new-part') { const mpn = prompt('Part number'); if (mpn && mpn.trim()) editPart({ schema: L.SCHEMA, id: L.slug(mpn), mpn: mpn.trim(), match: [], manufacturer: '', kind: 'ic', description: '', package: '', datasheet: {}, pins: [], domains: [], values: [], made: { by: who(), at: new Date().toISOString(), how: 'by hand' } }, null, true); }
  });
  document.addEventListener('change', e => { if (e.target.dataset.id === 'fgroup') { state.check = e.target.value; renderView(); } });
  document.addEventListener('input', e => {
    if (e.target.dataset.id === 'fq') { state.q = e.target.value; const pos = e.target.selectionStart; renderView(); const n = $('[data-id="fq"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (e.target.dataset.id === 'lib-q') { state.libQuery = e.target.value; const pos = e.target.selectionStart; renderView(); const n = $('[data-id="lib-q"]'); n.focus(); n.setSelectionRange(pos, pos); } });
  $('#file-input').addEventListener('change', e => openFiles(e.target.files));
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('pk-dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('pk-dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('pk-dragging'); if (e.dataTransfer.files.length && !document.querySelector('.sheet-wrap')) openFiles(e.dataTransfer.files); });

  // ── The demo: the Smart Thermostat's Main PCBA as Altium sheets and as a KiCad netlist, and a small library ──
  async function loadDemo() {
    try {
      const idx = await (await fetch('demo/library/index.json')).json();
      if (!(await L.meta('demoLoaded'))) {
        for (const name of idx) { const f = await (await fetch('demo/library/' + name)).json(); f.local = { dirty: false }; await L.put(f); }
        await L.meta('demoLoaded', new Date().toISOString());
      }
      await reloadLib();
      const text = await (await fetch('demo/thermostat-main-pcba.xml')).text();
      await openFiles([new File([text], 'thermostat-main-pcba.xml', { type: 'text/xml' })]);
      if (active()) active().name = 'Main PCBA, KiCad netlist';
      // The same board as Altium sheets with their Protel2 netlist (tools/make_demo_altium.py), opened last so it shows first.
      const names = await (await fetch('demo/altium/index.json')).json();
      const files = await Promise.all(names.map(async n => new File([await (await fetch('demo/altium/' + encodeURIComponent(n))).arrayBuffer()], n)));
      await openFiles(files);
      if (active()) active().name = 'Main PCBA (DT-1042 rev B)';
      renderAll();
    } catch (e) { toast('Couldn\'t load the demo: ' + e.message, 'error'); }
  }

  // ── Updates: reload when the site serves a newer build (as the other tools do) ──
  const haveVersion = () => PK.VERSION || '';
  const UPDATE_KEY = 'signoff.toolUpdate.pincheck';
  function checkForUpdate() {
    const have = haveVersion();
    if (!have || !window.fetch) return;
    fetch('assets/version.js?nc=' + Date.now(), { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).then(text => {
      const m = /VERSION\s*=\s*["']([0-9a-f]+)["']/.exec(text || '');
      if (!m || m[1] === have) return;
      let tried = ''; try { tried = sessionStorage.getItem(UPDATE_KEY) || ''; } catch (e) { /* blocked */ }
      if (tried === m[1] || document.querySelector('.sheet-wrap') || state.designs.length) return;
      try { sessionStorage.setItem(UPDATE_KEY, m[1]); } catch (e) { /* blocked */ }
      location.reload();
    }).catch(() => {});
  }

  // ── Start ──
  applyTheme(readTheme());
  try { if (localStorage.getItem(SIDE_KEY) === '1') { const app = $('#app'); app.style.transition = 'none'; app.classList.add('side-collapsed'); void app.offsetWidth; app.style.transition = ''; } } catch (e) { /* storage blocked */ }
  if (DEMO) {
    const b = $('#demo-banner');
    b.hidden = false; document.body.classList.add('has-banner');
    b.innerHTML = 'Demo: the made-up Smart Thermostat for Acme Climate. The library here lives in this browser only. <a href="./">Leave the demo</a>';
    document.querySelectorAll('[data-demo-href]').forEach(a => { a.href = a.getAttribute('href') + '?demo'; });
  }
  $('#version').textContent = 'Build ' + (PK.VERSION || 'dev');
  if (window.SignoffFoot) window.SignoffFoot.mount({
    pill: '#sync-pill', settings: '[data-foot-settings]', people: '#people-link', tools: '#side-tools',
    theme: readTheme, setTheme: t => { writeTheme(t); applyTheme(t); },
    intro: 'Pincheck reads schematics without signing in. Signed in, its part library syncs with the private pincheck_data repo.',
    changed: () => { renderToolbar(); syncNow(); }
  });
  reloadLib().then(() => { if (DEMO) loadDemo(); else syncNow(); });
  setTimeout(checkForUpdate, 5000);
  setInterval(checkForUpdate, 5 * 60000);
  setInterval(renderToolbar, 60000);
})(window.PK = window.PK || {});
