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
  // Findings: Esc closes the detail panel; up and down step through the rows shown, opening each.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.sheet-wrap')) return;
    if (e.key === 'Escape' && state.openFinding && $('#inspector').classList.contains('open')) { e.preventDefault(); closeInspector(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && state.view === 'design' && (state.tab === 'findings' || state.tab === 'overview')) {
      const rows = [...document.querySelectorAll('#view .pk-frow')].filter(r => r.offsetParent);
      if (!rows.length) return;
      e.preventDefault();
      const i = rows.findIndex(r => r.dataset.id === state.openFinding), down = e.key === 'ArrowDown';
      const next = rows[i < 0 ? (down ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + (down ? 1 : -1)))];
      if (next.dataset.id !== state.openFinding) { state.openFinding = next.dataset.id; renderView(); const r = document.querySelector('#view .pk-frow[data-id="' + CSS.escape(next.dataset.id) + '"]'); if (r) r.scrollIntoView({ block: 'nearest' }); }
    }
  });
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
    // A project as a .zip or a folder: only the sheets, netlists, .PrjPcb, and part files come out (assets/archive.js).
    if (PK.archive && files.some(f => /\.zip$/i.test(f.name) || f.webkitRelativePath)) {
      state.busy = 'Opening ' + (files.length === 1 ? files[0].name : files.length + ' files'); state.view = 'design'; renderAll();
      try { files = await PK.archive.expand(files); } catch (e) { toast(e.message, 'error'); files = []; }
      state.busy = null;
      if (!files.length) { toast('No schematic sheets or netlist in what was dropped', 'error'); state.view = active() ? 'design' : 'home'; renderAll(); return; }
    }
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
      d.scanPlay = true; // its Overview plays the scan panel once (assets/scan.js)
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
    // A run reopened from Signoff EE keeps its findings as sent until "Run checks again".
    if (d.fromRun && d.run) return d.run;
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
    // A stored run's findings keep the waivers they were sent with; this browser's add to them.
    for (const f of d.run.findings) f.waived = list.find(w => (w.scope === 'one' ? w.key === f.id : w.key === similarKey(f))) || f.sentWaived || null;
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

  // ── Send to Signoff EE (docs/send-to-signoff-ee.md), laid out as Fabcheck's Send ──
  // One issue per check and severity. Details lists them, each with a box; the keys left out (check|severity,
  // so they survive a re-run) are in d.soSkip. Notes and waived findings start unticked: a group's key goes
  // into the skip set the first time it shows (d.soSeen), and from then on follows its box.
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b || a + 's');
  const S = () => PK.signoff, R = () => PK.runs;
  const repoProbe = new Map();   // board id -> { busy } | readiness
  const sendPlan = d => S().plan(ensureRun(d).findings);
  function sendSkip(d, groups) {
    const skip = d.soSkip || (d.soSkip = new Set()), seen = d.soSeen || (d.soSeen = new Set());
    for (const g of groups) if ((g.waived || g.severity === 'info') && !seen.has(g.key)) { seen.add(g.key); skip.add(g.key); }
    return skip;
  }
  const storing = () => !DEMO && !!R();
  function sendHtml(d) {
    // A run reopened from Signoff EE was sent already; sending it again would bundle today's library with
    // its old findings. After "Run checks again" it is a current run, and Send comes back.
    if (scanning(d) || d.fromRun) return '';
    const groups = sendPlan(d), skip = sendSkip(d, groups);
    let h = '<div class="section-title pk-sect">Send to Signoff EE</div><div class="card pk-send">';
    const projects = S().projects();
    const signedIn = !storing() || R().signedIn();
    if (!projects.length) {
      if (DEMO) return h + '<p class="pk-send-p">No Signoff EE demo boards in this browser yet. Open the <a href="../ee_design_review/index.html?demo">Signoff EE demo</a> once (it sets up its sample boards in this browser), then come back.</p></div>';
      return h + '<p class="pk-send-p">For design reviews in Signoff EE: send this run\'s errors and warnings to a board\'s Schematic Review, with the run, stored in the board\'s private repository. ' +
        (signedIn ? 'Open <a href="../ee_design_review/index.html">Signoff EE</a> once at this same address (it keeps its boards in this browser), then come back.' : 'Sign in with GitHub (Settings, at the foot of the sidebar), then open Signoff EE once at this same address.') + '</p></div>';
    }
    // The board: the one this run was sent to or opened from, else a guess from the design's name.
    if (!d.soSlug || !projects.some(p => p.slug === d.soSlug)) {
      const pid = (d.fromRun && d.fromRun.projectId) || (d.sentTo && d.sentTo.projectId), lab = d.name.toLowerCase().replace(/\s+/g, '');
      const guess = (pid && projects.find(p => p.id === pid)) || projects.find(p => [p.meta.board, p.meta.name].some(x => x && lab.includes(String(x).toLowerCase().replace(/\s+/g, '')))) ||
        projects.find(p => (p.meta.checklists || []).includes(S().CHECKLIST)) || projects[0];
      d.soSlug = guess.slug;
    }
    const target = projects.find(p => p.slug === d.soSlug);
    const pv = S().preview(d.soSlug, groups);
    const kind = S().kindOf;
    const pickedAll = pv.rows.filter(r => !skip.has(r.group.key)), nRef = pickedAll.filter(r => r.group.waived).length;
    const picked = pickedAll.filter(r => !r.group.waived), nIssues = pv.rows.filter(r => !r.group.waived).length;
    const major = picked.filter(r => r.severity === 'major').length, fresh = picked.filter(r => r.state !== 'update').length;
    const notes = picked.some(r => r.group.severity === 'info');
    const sevs = [major && `${major} Major from errors`, picked.length - major && `${picked.length - major} Minor from warnings${notes ? ' and notes' : ''}`].filter(Boolean).join(', ');
    const news = [fresh && `${fresh} new`, picked.length - fresh && `${picked.length - fresh} updating ${picked.length - fresh === 1 ? 'an issue' : 'issues'} sent before`].filter(Boolean).join(', ');
    const issues = !nIssues ? 'No findings to send; earlier Pincheck issues get a "no longer found" note.'
      : picked.length ? `Sends ${picked.length < nIssues ? picked.length + ' of ' : ''}${plural(nIssues, 'issue')} to the Schematic Review checklist (${sevs}; ${news}).`
      : `No issues picked, so none are sent (${plural(nIssues, 'issue')} available); sending still stores the run, and earlier issues for these checks stay as they are.`;
    const left = [pv.rows.some(r => kind(r.group) === 'notes' && skip.has(r.group.key)) && 'notes', pv.rows.some(r => r.group.waived && skip.has(r.group.key)) && 'waived findings'].filter(Boolean);
    const refNote = nRef ? ` Also sends ${plural(nRef, 'group')} of waived findings, kept in Signoff for reference and counted nowhere.` : '';
    const leftNote = left.length ? ` ${left.join(' and ').replace(/^./, c => c.toUpperCase())} stay in Pincheck (tick them under Details to send them).` : '';
    h += `<p class="pk-send-p">${issues}${refNote}${leftNote} Sending again updates the same issues and keeps the reviewer's status. ${DEMO ? 'In this demo they go to the Signoff EE demo in this browser, and the run is kept in this browser.' : "Signoff's Sync then pushes the issues, and each one opens this run in Pincheck."}</p>` +
      `<div class="filters" style="margin:0"><label class="tb-field" style="font-size:13px">Board <select data-id="so-project">${projects.map(p => `<option value="${esc(p.slug)}"${p.slug === d.soSlug ? ' selected' : ''}>${esc(p.meta.name)}${p.meta.board ? ' · ' + esc(p.meta.board) : ''}${(p.meta.checklists || []).includes(S().CHECKLIST) ? '' : ' (no Schematic checklist)'}</option>`).join('')}</select></label>` +
      `<button class="btn btn-primary" data-act="so-send"${d.soBusy ? ' disabled' : ''}>${d.soBusy ? 'Storing…' : 'Send to Signoff EE'}</button><button class="btn so-toggle${d.soOpen ? ' open' : ''}" data-act="so-details" aria-expanded="${!!d.soOpen}">Details <span class="sec-chev" aria-hidden="true">▾</span></button>${d.soResult ? '<button class="btn btn-plain" data-act="so-back" data-project="' + esc(target.id) + '">Open Signoff EE</button>' : ''}</div>`;
    if (d.soOpen && groups.length) h += sendListHtml(d, pv, skip);
    if (!(target.meta.checklists || []).includes(S().CHECKLIST)) h += '<p class="note">This board doesn\'t use the Schematic Review checklist, so the issues won\'t show until you add it in the board\'s details in Signoff EE.</p>';
    h += storageHtml(target.id);
    if (d.soBlocked) h += `<div class="note pk-warn">Not sent: the run couldn't be stored (${esc(d.soBlocked)}). Without it, Signoff's issues can't open the run in Pincheck.<div style="margin-top:8px"><button class="btn" data-act="so-send">Try again</button> <button class="btn btn-plain" data-act="so-anyway">Send without storing</button></div></div>`;
    if (d.soResult) h += `<p class="note pk-ok">${esc(d.soResult)}</p>`;
    return h + '</div>';
  }
  // Where Send will store the run, or why it can't, from a cached check of the board's repo.
  function storageHtml(projectId) {
    if (!storing()) return '';
    const repo = R().home(projectId).repo;
    if (!R().signedIn()) return `<p class="note">Sending stores the run in ${esc(repo)}, the board's private repository, and asks you to sign in to GitHub first.</p>`;
    const pr = repoProbe.get(projectId);
    if (!pr) { repoProbe.set(projectId, { busy: true }); R().probe(projectId).then(r => { repoProbe.set(projectId, r); if (state.tab === 'overview') renderView(); }); }
    if (!pr || pr.busy) return `<p class="note">Checking access to ${esc(repo)}…</p>`;
    if (!pr.ok) return `<p class="note pk-warn">Can't store the run in ${esc(pr.repo)}: ${esc(pr.text)}.</p>`;
    return `<p class="note">Sending stores this run (the design as read, the part files it used, and its findings) in ${esc(pr.repo)}, the board's private repository, where anyone with access to the board can open it from Signoff EE.</p>`;
  }
  function sendListHtml(d, pv, skip) {
    const says = { new: 'New issue', deleted: 'Re-raises a deleted issue', update: 'Updates the issue sent before' };
    const saysRef = { new: 'New reference row', deleted: 'Brings back a removed reference row', update: 'Updates the reference row sent before' };
    const kind = S().kindOf;
    const box = (k, label) => {
      const rows = pv.rows.filter(r => kind(r.group) === k);
      return rows.length ? `<label class="so-all"><input type="checkbox" data-id="so-kind" data-kind="${k}"${rows.every(r => !skip.has(r.group.key)) ? ' checked' : ''}> ${label} (${rows.length})</label>` : '';
    };
    const all = pv.rows.filter(r => kind(r.group) === 'error' || kind(r.group) === 'warn').every(r => !skip.has(r.group.key));
    let h = `<div class="so-list"><div class="so-alls"><label class="so-all"><input type="checkbox" data-id="so-all"${all ? ' checked' : ''}> All errors and warnings</label>${box('error', 'Errors')}${box('warn', 'Warnings')}${box('notes', 'Notes')}${box('waived', 'Waived, for reference')}</div>`;
    pv.rows.forEach((r, i) => {
      const g = r.group, n = g.list.length, on = !skip.has(g.key);
      h += `<div class="so-row${on ? '' : ' off'}"><input type="checkbox" id="so-${i}" data-id="so-pick" data-key="${esc(g.key)}"${on ? ' checked' : ''}>` +
        `<div><label class="item-text" for="so-${i}">${esc(r.text)}</label>` +
        `<div class="item-sub">${g.waived ? '<span class="res waived">Waived · reference</span>' : `<span class="sev ${r.severity}">${r.severity === 'major' ? 'Major' : 'Minor'}</span>`}<span class="tag pk-mono">${esc(g.check)}</span><span>${esc(r.section)}</span><span>${(g.waived ? saysRef : says)[r.state]}${r.resolution ? ` <span class="res ${r.resolution}">${r.resolution === 'fixed' ? 'Fixed' : 'Waived'}</span>` : ''}</span></div>` +
        `<details class="so-locs"><summary>${plural(n, (g.waived ? 'waived ' : '') + (g.severity === 'error' ? 'error' : g.severity === 'warn' ? 'warning' : 'note'))}</summary><ul>` +
        g.list.slice(0, 25).map(f => `<li>${esc(f.title)}${f.refs.length || f.nets.length ? `<span class="pk-muted"> · ${esc([f.refs.slice(0, 4).join(', '), f.nets.slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</span>` : ''}</li>`).join('') +
        (n > 25 ? `<li class="pk-muted">… ${n - 25} more</li>` : '') + '</ul></details></div></div>';
    });
    if (pv.gone.length) h += `<div class="so-gone">Sent before and not found by this run, so each gets a "no longer found" note: ${pv.gone.map(t => `<b>${esc(t)}</b>`).join(', ')}.</div>`;
    if (pv.dropped.length) h += `<div class="so-gone">Reference rows sent before whose findings aren't waived any more, so they are removed: ${pv.dropped.map(t => `<b>${esc(t)}</b>`).join(', ')}.</div>`;
    return h + '</div>';
  }

  // A wait that says what it is doing: a card over the page with a spinner, a step line, and a bar (.busy in
  // suite.css, from Signoff EE; the same card as Fabcheck's). Actions are [label, fn, primary].
  function busyCard(title) {
    const old = $('#busy-wrap'); if (old) old.remove();
    const w = document.createElement('div');
    w.className = 'sheet-wrap'; w.id = 'busy-wrap';
    w.innerHTML = '<div class="sheet busy" role="status" aria-live="polite"><div class="busy-row"><span class="busy-spin" aria-hidden="true"></span><div style="flex:1;min-width:0">' +
      '<div class="busy-title">' + esc(title) + '</div><div class="busy-step"></div><div class="busy-bar"><i></i></div></div></div><div class="busy-acts"></div></div>';
    document.body.appendChild(w);
    const card = w.firstChild, stepEl = w.querySelector('.busy-step'), bar = w.querySelector('.busy-bar i'), acts = w.querySelector('.busy-acts');
    const close = () => w.remove();
    return {
      step(text, frac) { stepEl.textContent = text; if (frac != null) bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; },
      stop(text, actions, newTitle) {
        card.classList.add('done'); stepEl.textContent = text;
        if (newTitle) w.querySelector('.busy-title').textContent = newTitle;
        acts.innerHTML = '';
        for (const [label, fn, primary] of actions || [['Close', null, true]]) {
          const b = document.createElement('button');
          b.className = 'btn' + (primary ? ' btn-primary' : ''); b.textContent = label;
          b.addEventListener('click', () => { close(); if (fn) fn(); }); acts.appendChild(b);
        }
        const p = acts.querySelector('.btn-primary'); if (p) p.focus();
      },
      close,
    };
  }
  const paint = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
  window.addEventListener('pageshow', ev => { if (ev.persisted) { const b = $('#busy-wrap'); if (b) b.remove(); } });

  // Nothing leaves the browser without saying where it goes; Cancel keeps it all here.
  function confirmStore(repo, made) {
    const r = made.run;
    return confirm(`This run, its findings, and the design as Pincheck read it (${r.design.name}: ${plural(r.design.parts, 'part')}, ${plural(r.design.nets, 'net')}, ${plural(r.design.sheets, 'file')}), with the ${plural(r.library.files, 'part file')} it was checked against (${(made.bundle.length / 1024).toFixed(0)} KB in all), will be stored in the private repository ${repo}, where everyone with access to the board can open them.\n\nOK to store them and send the issues. Cancel to keep everything in this browser.`);
  }

  // Send: make the run, store it with the board (asked first), then write the issues, so every issue carries
  // where the run is. If it can't be stored, nothing is sent until "Send without storing".
  async function sendToSignoff(d, anyway) {
    if (d.soBusy) return;
    const target = S().projects().find(p => p.slug === d.soSlug);
    if (!target) { toast('That Signoff board is no longer in this browser', 'error'); return; }
    if (storing() && !anyway && !R().signedIn()) { toast('Sign in to GitHub first, then send again'); if (window.SignoffFoot) window.SignoffFoot.settings(); return; }
    d.soBlocked = null; d.soResult = null;
    repoProbe.delete(target.id);
    let card = busyCard('Sending to Signoff EE');
    card.step('Packing the run…', 0.05);
    await paint();
    let made;
    try { made = await R().make(d, state.lib, who()); } catch (err) { card.stop('Could not pack the run: ' + (err.message || err), null, 'Not sent'); return; }
    if (storing() && !anyway) {
      // The confirm names the run's size, so the card steps aside for it.
      card.close();
      if (!confirmStore(R().home(target.id).repo, made)) return;
      d.soBusy = true; renderView();
      card = busyCard('Sending to Signoff EE');
      const got = await R().store(made, target.id, (t, f) => card.step(t, f));
      d.soBusy = false;
      if (!got.ok) { d.soBlocked = got.why; renderView(); card.stop(`The run couldn't be stored (${got.why}). Nothing was sent; the Send panel offers to send without storing.`, null, 'Not sent'); return; }
    } else if (DEMO) made.run.stored = { repo: 'demo', dir: 'pincheck/' + target.id + '/' };   // the demo keeps it in this browser
    card.step('Writing the issues into Signoff EE…', 0.95);
    await paint();
    try {
      const plan = sendPlan(d);
      sendSkip(d, plan);
      const r = S().send(d.soSlug, plan, { label: d.name, run: made.run }, d.soSkip);
      await R().keep(Object.assign({ projectId: r.projectId }, made)).catch(() => {});
      d.sentTo = { projectId: r.projectId, name: r.name, runId: made.run.id };
      d.soResult = `Sent to "${r.name}": ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} left out` : ''}${r.resolvedNotes ? `, ${r.resolvedNotes} earlier issue(s) noted as no longer found` : ''}${r.dropped ? `, ${r.dropped} reference row(s) removed` : ''}. ${DEMO ? 'Open Signoff EE to see them.' : 'Sync in Signoff EE to push them.'}`;
      if (anyway) d.soResult += ' Sent without storing: Signoff can\'t open this run until it is sent again and stored.';
      card.stop(d.soResult, [['Stay in Pincheck', null], ['Open in Signoff EE', () => S().openFindings(r.projectId), true]], 'Sent to Signoff EE');
    } catch (err) { card.stop('Could not send: ' + err.message, null, 'Not sent'); }
    renderView();
  }

  // ── Opening a run from Signoff EE: #/findings?run=<id>&project=<board id>&check=<check>&finding=<finding id> ──
  // The run is one this browser kept, or the one Signoff EE handed over (PK.runs.find). Its design opens with
  // its findings as sent; the finding opens on the Schematic tab (or in Findings when there are no drawings).
  function linkParams() {
    const m = /^#\/(\w+)\?(.*)$/.exec(location.hash || '');
    if (!m) return null;
    const q = new URLSearchParams(m[2]);
    return { view: m[1], run: q.get('run') || '', project: q.get('project') || '', check: q.get('check') || '', finding: q.get('finding') || '' };
  }
  async function openLink() {
    const l = linkParams();
    if (!l || !l.run || !R()) return;
    let d = state.designs.find(x => x.fromRun && x.fromRun.run.id === l.run);
    if (!d) {
      state.busy = 'Opening the run from Signoff EE'; state.view = 'design'; renderAll();
      const e = await R().find(l.run).catch(() => null);
      state.busy = null;
      if (!e) { state.view = active() ? 'design' : 'home'; renderAll(); toast(DEMO ? 'That run isn\'t in this browser. In the demo, send from Pincheck first, then open it from Signoff EE.' : 'That run isn\'t in this browser, and Signoff EE didn\'t hand it over. Open it again from Signoff EE.', 'error'); return; }
      try { d = await openStored(e, l.project); } catch (err) { state.view = active() ? 'design' : 'home'; renderAll(); toast('Couldn\'t open the run: ' + err.message, 'error'); return; }
    }
    state.active = d.id; state.view = 'design'; state.q = ''; state.sev = { error: true, warn: true, info: true };
    const f = l.finding && d.run.findings.find(x => x.id === l.finding);
    if (f && PK.viewer && d.sheetsDrawn) { state.tab = 'schematic'; state.showFinding = f; state.check = ''; }
    else { state.tab = 'findings'; state.check = f ? '' : (PK.checks.byKey.get(l.check) ? l.check : ''); state.openFinding = f ? f.id : null; }
    renderAll();
    if (l.finding && !f) toast('That finding isn\'t in this run');
  }
  async function openStored(e, projectId) {
    const b = await R().open(e.bundle);
    const d = Object.assign(b.design, { id: 'r' + e.run.id, drawings: b.design.drawings || [], nets: b.design.nets || null, notes: b.design.notes || [], sheets: b.design.sheets || [] });
    d.sheetsDrawn = d.drawings.length > 0;
    d.fromRun = { run: e.run, projectId: projectId || e.projectId || '', library: b.library };
    // The rails, coverage, and parts from the part files it used then; the findings as sent.
    let run;
    try { run = PK.checks.run(d, b.library); } catch (err) { run = { rails: [], coverage: {}, parts: {}, ms: 0, hasNets: !!d.nets }; }
    run.findings = (e.findings || []).map(f => Object.assign({}, f, { refs: f.refs || [], pins: f.pins || [], nets: f.nets || [], basis: f.basis || [], sentWaived: f.waived || null }));
    d.run = run; d.runGen = state.libGen;
    applyWaivers(d);
    state.designs.unshift(d);
    return d;
  }
  window.addEventListener('hashchange', () => { if (linkParams()) openLink(); });

  // ── Rendering ──
  function renderAll() { renderSide(); renderToolbar(); renderTabs(); renderView(); }

  // Overview, Findings, Schematic, and Parts, as Fabcheck's toolbar tabs. The Schematic tab shows for every
  // design; a KiCad netlist's says it has no drawing (assets/viewer.js).
  function renderTabs() {
    const seg = $('#view-seg'), d = active();
    if (state.view !== 'design' || !d || state.busy) { seg.hidden = true; return; }
    const run = ensureRun(d), c = PK.pages.counts(run.findings.filter(f => !f.waived)), playing = scanning(d);
    const tabs = [['overview', 'Overview', ''], ['findings', 'Findings', !playing && (c.error || c.warn) ? '<span class="count">' + (c.error ? '✕ ' + c.error + ' ' : '') + (c.warn ? '▲ ' + c.warn : '') + '</span>' : ''], ['parts', 'Parts', '']];
    if (PK.viewer) tabs.splice(2, 0, ['schematic', 'Schematic', '']);
    seg.hidden = false;
    seg.innerHTML = tabs.map(([k, l, x]) => '<button role="tab" data-tab="' + k + '" class="' + (state.tab === k ? 'on' : '') + '">' + l + x + '</button>').join('');
  }

  function renderSide() {
    $('#design-list').innerHTML = state.designs.length ? state.designs.map(d => {
      const g = D.groups(d, ['ic', 'crystal']);
      const miss = g.filter(x => !L.find(state.lib, x.mpn)).length;
      return '<button class="proj' + (d.id === state.active && state.view === 'design' ? ' active' : '') + '" data-design="' + d.id + '"><span class="pk-ico">' + ICON.chip + '</span><span class="proj-body"><span class="proj-name">' + esc(d.name) + '</span><span class="proj-sub">' + (d.fromRun ? 'Run sent ' + esc(new Date(d.fromRun.run.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })) + ' · ' + d.run.findings.filter(f => !f.waived && f.severity !== 'info').length + ' issues' : d.parts.length + ' parts · ' + (miss ? miss + ' not in library' : 'all ICs in library')) + '</span></span></button>';
    }).join('') : '<div class="side-empty">Drop an Altium project (its folder or .zip), its sheets, or a netlist to start.</div>';
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

  function renderView() { drawView(); syncInspector(); }

  // A selected finding's detail panel on Overview and Findings (findings.js inspector), with its thumbnail
  // on the schematic (viewer.js preview). Redrawn only when the finding or its run changes.
  let inspShown = null;
  function syncInspector() {
    const el = $('#inspector'), d = active();
    const f = state.view === 'design' && d && d.run && (state.tab === 'findings' || state.tab === 'overview') && state.openFinding
      ? d.run.findings.find(x => x.id === state.openFinding) : null;
    if (!f) { el.classList.remove('open'); inspShown = null; return; }
    if (inspShown !== f || !el.classList.contains('open')) {
      el.innerHTML = PK.pages.inspector(d, f, { hasSheets: !!d.sheetsDrawn });
      el.classList.add('open');
      if (PK.viewer && !PK.viewer.preview(el.querySelector('.insp-prev-slot'), d, f)) { const b = el.querySelector('.insp-preview'); if (b) b.remove(); }
      inspShown = f;
    }
  }
  function closeInspector() { if (!state.openFinding) return; state.openFinding = null; renderView(); }

  function drawView() {
    const v = $('#view');
    if (state.busy) { v.innerHTML = '<div class="page"><div class="card pk-busy"><div class="pk-spin"></div><div>' + esc(state.busy) + '</div></div></div>'; return; }
    if (state.view === 'library') { v.innerHTML = libraryPage(); return; }
    const d = active();
    if (state.view === 'design' && d) {
      const ctx = { lib: state.lib, state, hasSheets: !!d.sheetsDrawn };
      if (state.tab === 'findings') v.innerHTML = PK.pages.findings(d, ensureRun(d), ctx);
      else if (state.tab === 'parts') v.innerHTML = designPage(d);
      else if (state.tab === 'schematic' && PK.viewer) { ensureRun(d); PK.viewer.render(v, d, state); }
      else {
        const run = ensureRun(d);
        ctx.scan = !!(PK.scan && d.sheetsDrawn);
        ctx.scanning = ctx.scan && scanning(d);
        ctx.after = PK.signoff ? sendHtml(d) : '';
        v.innerHTML = PK.pages.overview(d, run, ctx);
        const host = $('#pk-scan-host');
        if (host) {
          const play = !!d.scanPlay; d.scanPlay = false;
          PK.scan.attach(host, d, run, { lib: state.lib, play, onDone: () => { renderTabs(); if (state.view === 'design' && active() === d && state.tab === 'overview') renderView(); } });
        }
      }
      return;
    }
    v.innerHTML = homePage();
  }

  // A design's scan panel is playing, or about to (its Overview hasn't drawn yet).
  const scanning = d => !!(PK.scan && d && d.sheetsDrawn && (d.scanPlay || PK.scan.running(d)));

  function homePage() {
    return '<div class="page"><div class="eyebrow">Prototype</div><h1 class="page-title">Pincheck</h1>' +
      '<p class="pk-lede">Checks a schematic against what each part allows: supply ranges, I/O levels, pin functions, and more. It starts by finding the ICs and looking each one up in the part library. Parts it doesn\'t know yet get a part file, which you fill in by hand or with Claude from the datasheet.</p>' +
      (PK.scan ? PK.scan.emptyHtml('Altium: the project folder or its .zip, or every .SchDoc with its Protel2 netlist (Design › Netlist For Project › Protel2) for the nets. KiCad: the XML netlist. Drop them anywhere on this window. Read in this tab and never uploaded.')
        : '<button class="card pk-drop" data-act="open"><span class="pk-drop-ico">' + ICON.drop + '</span><b>Drop schematic sheets or a netlist</b><span class="pk-muted">Altium: every .SchDoc of the project, with its Protel2 netlist (Design › Netlist For Project › Protel2) for the nets. KiCad: the XML netlist. Read in this tab and never uploaded.</span></button>') +
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
      '<div class="pk-head-actions">' + (missing.length > 1 ? '<button class="btn" data-act="batch">Batch configure (' + missing.length + ')…</button>' : '') + (missing.length ? '<button class="btn btn-primary" data-config="' + esc(missing[0].part.ref) + '">Configure next (' + missing.length + ' left)</button>' : '') + '</div></div>' +
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

  // ── Batch configure (Chris, 2026-11-13): every part still to configure through the pincheck-part skill at
  // once. One file holds a starter part file per part (its pins from the schematic); the prompt asks Claude Code
  // to fill each from its datasheet into a folder beside it, and the part files it writes come back with Import.
  const DS_KEY = 'pincheck.v1.datasheetDir';
  function batchConfigure(d) {
    const missing = D.groups(d, ['ic', 'crystal']).filter(g => g.mpn && !L.find(state.lib, g.mpn));
    if (!missing.length) return;
    const on = new Set(missing.map(g => g.mpn));
    const slug = L.slug(d.name).slice(0, 40) || 'design';
    const file = 'pincheck-batch-' + slug + '.json', out = 'pincheck-batch-' + slug;
    let dir = ''; try { dir = localStorage.getItem(DS_KEY) || ''; } catch (e) { /* storage blocked */ }
    const w = document.createElement('div');
    w.className = 'sheet-wrap';
    const chosen = () => missing.filter(g => on.has(g.mpn));
    const prompt = () => {
      const list = chosen();
      return 'Use the pincheck-part skill to fill every part in the Pincheck batch file ' + file + ' (in my Downloads folder): ' +
        plural(list.length, 'part') + ', one starter part file each, with its pins from the schematic.\n\n' +
        'For each part, take its entry as the exported file and ' + (dir ? 'find its datasheet in ' + dir : 'ask me where its datasheet is') +
        '. Write each finished part file as <id>.json in a new folder ' + out + ' beside the batch file.\n' +
        'Run the parts in parallel subagents, a few at a time. At the end, list the parts you filled, how many values each has, and any whose datasheet you could not find; ask me before downloading a datasheet (makers\' sites only).\n\n' +
        'Parts: ' + list.map(g => g.mpn + ' (' + g.refs.slice(0, 4).join(', ') + (g.refs.length > 4 ? ', …' : '') + ')').join(', ') + '.';
    };
    const draw = () => {
      const list = chosen();
      w.innerHTML = '<div class="sheet wide"><div class="sheet-head"><h2>Batch configure with Claude</h2><p>Fill every part still to configure in one Claude Code run. The datasheets stay on your computer; only Claude Code reads them.</p></div><div class="sheet-body">' +
        '<div class="card pk-scroll pk-batch"><table class="table"><thead><tr><th><input type="checkbox" data-b="all"' + (list.length === missing.length ? ' checked' : '') + ' aria-label="All parts"></th><th>Part number</th><th>Refs</th><th>Description</th><th class="pk-num">Pins</th></tr></thead><tbody>' +
        missing.map(g => '<tr><td><input type="checkbox" data-b="one" data-mpn="' + esc(g.mpn) + '"' + (on.has(g.mpn) ? ' checked' : '') + ' aria-label="' + esc(g.mpn) + '"></td><td class="pk-mono">' + esc(g.mpn) + '</td><td class="pk-refs">' + esc(g.refs.slice(0, 6).join(', ') + (g.refs.length > 6 ? ', …' : '')) + '</td><td class="pk-desc">' + esc(g.part.description || g.part.params.Value || '') + '</td><td class="pk-num">' + g.part.pins.length + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<ol class="pk-steps"><li>Save the batch file (' + plural(list.length, 'part') + ', each with its pins from the schematic): <button class="btn btn-sm" data-b="export"' + (list.length ? '' : ' disabled') + '>Save ' + esc(file) + '</button></li>' +
        '<li>Datasheets folder, for the prompt: <input class="input pk-dsdir" data-b="dir" placeholder="Leave empty and Claude asks for each datasheet" value="' + esc(dir) + '"></li>' +
        '<li>In Claude Code, started in the Dovetail tools folder, paste this: <button class="btn btn-sm" data-b="copy"' + (list.length ? '' : ' disabled') + '>Copy</button><pre class="pk-pre">' + esc(prompt()) + '</pre>Claude fills each part from its datasheet, every value with its page, all unverified. STM32s also come from STM32CubeMX’s database on this computer.</li>' +
        '<li>Back here, import the part files it wrote (select them all in <span class="pk-mono">' + esc(out) + '</span>), then check each part’s values against the pages and tick Verified: <button class="btn btn-sm" data-b="import">Import part files…</button></li></ol></div>' +
        '<div class="sheet-foot"><span class="spacer"></span><button class="btn btn-primary" data-b="close">Done</button></div></div>';
    };
    draw();
    document.body.appendChild(w);
    w.addEventListener('click', async e => {
      const b = e.target.closest('[data-b]');
      if (e.target === w || (b && b.dataset.b === 'close')) { w.remove(); return; }
      if (!b) return;
      const a = b.dataset.b;
      if (a === 'export') {
        const list = chosen().map(g => L.strip(L.fromSchematic(g.part, who())));
        const blob = new Blob([JSON.stringify(list, null, 2) + '\n'], { type: 'application/json' });
        const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = file; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1500);
      } else if (a === 'copy') {
        try { await navigator.clipboard.writeText(prompt()); toast('Prompt copied'); } catch (err) { toast('Copy blocked: select the text instead', 'error'); }
      } else if (a === 'import') PK.editor.pickJson((text, name) => importJson(text, name));
    });
    w.addEventListener('change', e => {
      const b = e.target.dataset.b;
      if (b === 'all') { if (e.target.checked) missing.forEach(g => on.add(g.mpn)); else on.clear(); draw(); }
      else if (b === 'one') { if (e.target.checked) on.add(e.target.dataset.mpn); else on.delete(e.target.dataset.mpn); draw(); }
    });
    w.addEventListener('input', e => {
      if (e.target.dataset.b !== 'dir') return;
      dir = e.target.value.trim();
      try { localStorage.setItem(DS_KEY, dir); } catch (err) { /* storage blocked */ }
      const pre = w.querySelector('.pk-pre'); if (pre) pre.textContent = prompt();
    });
  }

  // ── Events ──
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-act],[data-design],[data-config],[data-filter],[data-edit],[data-alias],[data-tab],[data-sev],[data-sevonly],[data-fopen],[data-openfile],[data-show],[data-waive],[data-unwaive]');
    if (!t) {
      // A click on blank space in the page (nothing to click or type in, no text selected) closes the detail panel.
      if (state.openFinding && e.target.closest('#main') && !e.target.closest('a, button, input, select, textarea, label, summary, [contenteditable], [tabindex], canvas, .sheet-wrap') && !String(window.getSelection())) closeInspector();
      return;
    }
    if (t.dataset.design) { state.active = t.dataset.design; state.view = 'design'; $('#app').classList.remove('nav-open'); renderAll(); return; }
    if (t.dataset.config) { configure(t.dataset.config); return; }
    if (t.dataset.filter) { state.filter = t.dataset.filter; renderView(); return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderTabs(); renderView(); $('#main').scrollTop = 0; return; }
    if (t.dataset.sev) { state.sev = Object.assign({}, state.sev, { [t.dataset.sev]: !state.sev[t.dataset.sev] }); renderView(); return; }
    if (t.dataset.sevonly) { state.sev = { error: false, warn: false, info: false, [t.dataset.sevonly]: true }; state.tab = 'findings'; renderTabs(); renderView(); return; }
    if (t.dataset.fopen) { state.openFinding = state.openFinding === t.dataset.fopen ? null : t.dataset.fopen; renderView(); return; }
    if (t.dataset.show && PK.viewer) {
      const d = active(); const f = d && d.run && d.run.findings.find(x => x.id === t.dataset.show);
      if (f) {
        // From the detail panel, the thumbnail grows into the Schematic tab's view of the finding.
        const zoom = t.closest('#inspector') ? PK.viewer.zoomFromPreview() : null;
        state.tab = 'schematic'; state.showFinding = f; renderTabs(); renderView(); $('#main').scrollTop = 0;
        if (zoom) zoom();
      }
      return;
    }
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
    if (a === 'close-insp') closeInspector();
    else if (a === 'batch') { const d = active(); if (d) batchConfigure(d); }
    else if (a === 'nav') toggleSidebar();
    else if (a === 'home') { state.view = 'home'; renderAll(); }
    else if (a === 'open') { const i = $('#file-input'); i.value = ''; i.click(); }
    else if (a === 'open-dir') { const i = $('#dir-input'); i.value = ''; i.click(); }
    else if (a === 'library') { state.view = 'library'; $('#app').classList.remove('nav-open'); renderAll(); }
    else if (a === 'theme') { const t2 = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(t2); applyTheme(t2); }
    else if (a === 'sync') syncNow();
    else if (a === 'so-send' || a === 'so-anyway') { const d = active(); if (d) sendToSignoff(d, a === 'so-anyway'); }
    else if (a === 'so-details') { const d = active(); if (d) { d.soOpen = !d.soOpen; renderView(); } }
    else if (a === 'so-back') { if (!PK.signoff.openFindings(t.dataset.project)) toast('That board is not in Signoff EE in this browser', 'error'); }
    else if (a === 'rerun') { const d = active(); if (d) { d.fromRun = null; d.run = null; ensureRun(d); if (PK.scan && d.sheetsDrawn && state.tab === 'overview') d.scanPlay = true; else toast('Checked again: ' + d.run.findings.length + ' findings'); renderTabs(); renderView(); } }
    else if (a === 'import') PK.editor.pickJson((text, name) => importJson(text, name));
    else if (a === 'export-all') { const b = new Blob([JSON.stringify(state.lib.map(L.strip), null, 2) + '\n'], { type: 'application/json' }); const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = 'pincheck-library.json'; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1500); }
    else if (a === 'new-part') { const mpn = prompt('Part number'); if (mpn && mpn.trim()) editPart({ schema: L.SCHEMA, id: L.slug(mpn), mpn: mpn.trim(), match: [], manufacturer: '', kind: 'ic', description: '', package: '', datasheet: {}, pins: [], domains: [], values: [], made: { by: who(), at: new Date().toISOString(), how: 'by hand' } }, null, true); }
  });
  document.addEventListener('change', e => {
    const id = e.target.dataset.id, d = active();
    if (id === 'fgroup') { state.check = e.target.value; renderView(); return; }
    if (!d || !/^so-/.test(id || '')) return;
    // Send's board and its boxes (all errors and warnings, one kind, or one issue).
    if (id === 'so-project') { d.soSlug = e.target.value; d.soResult = null; d.soBlocked = null; renderView(); return; }
    const plan = sendPlan(d), skip = sendSkip(d, plan), on = e.target.checked, k = PK.signoff.kindOf;
    const pick = g => skip[on ? 'delete' : 'add'](g.key);
    if (id === 'so-pick') pick({ key: e.target.dataset.key });
    else if (id === 'so-all') plan.filter(g => k(g) === 'error' || k(g) === 'warn').forEach(pick);
    else if (id === 'so-kind') plan.filter(g => k(g) === e.target.dataset.kind).forEach(pick);
    renderView();
  });
  document.addEventListener('input', e => {
    if (e.target.dataset.id === 'fq') { state.q = e.target.value; const pos = e.target.selectionStart; renderView(); const n = $('[data-id="fq"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (e.target.dataset.id === 'lib-q') { state.libQuery = e.target.value; const pos = e.target.selectionStart; renderView(); const n = $('[data-id="lib-q"]'); n.focus(); n.setSelectionRange(pos, pos); } });
  $('#file-input').addEventListener('change', e => openFiles(e.target.files));
  $('#dir-input').addEventListener('change', e => openFiles(e.target.files));
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('pk-dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('pk-dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  // A dropped folder is walked (its entries are only readable during the event, so they're captured first).
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('pk-dragging');
    if (!e.dataTransfer.files.length || document.querySelector('.sheet-wrap')) return;
    if (!PK.archive) { openFiles(e.dataTransfer.files); return; }
    const drop = PK.archive.captureDrop(e.dataTransfer);
    if (drop.entries.some(x => x.isDirectory)) { state.busy = 'Reading the folder'; state.view = 'design'; renderAll(); }
    PK.archive.fromDrop(drop).then(files => { state.busy = null; return openFiles(files.map(f => { if (f.path && f.path.includes('/') && !f.webkitRelativePath) Object.defineProperty(f, 'webkitRelativePath', { value: f.path }); return f; })); })
      .catch(err => { state.busy = null; toast(err.message, 'error'); state.view = active() ? 'design' : 'home'; renderAll(); });
  });

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
      await openLink();   // a link from Signoff EE's demo opens over the demo's designs
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
  reloadLib().then(() => { if (DEMO) loadDemo(); else { syncNow(); openLink(); } });
  setTimeout(checkForUpdate, 5000);
  setInterval(checkForUpdate, 5 * 60000);
  setInterval(renderToolbar, 60000);
})(window.PK = window.PK || {});
