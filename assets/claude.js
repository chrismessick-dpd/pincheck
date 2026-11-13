// Check with Claude (docs/claude-scan.md, Chris 2026-11-13): a design's Claude scans, read from pincheck_data
// (scans/<design>/<scan id>/), shown on the Findings page beside the offline findings, each with Confirm, Not a
// problem, and a reply, and Accept all. Answers are kept in this browser until saved to the scan's
// decisions.json; the pincheck-improve skill builds only what was confirmed. The app owns events; this draws
// and keeps the scans.
(function (PK) {
  'use strict';
  const L = PK.library;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b || a + 's');
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const SEV = { error: ['✕', 'Error'], warn: ['▲', 'Warning'], info: ['i', 'Note'] };
  const sevPill = s => '<span class="pk-sev pk-sev-' + s + '"><span aria-hidden="true">' + SEV[s][0] + '</span>' + SEV[s][1] + '</span>';
  const TYPES = {
    missed: ['Missed by the offline checks', 'No offline check looks for this. Confirmed, self-improve adds one.'],
    data: ['Missing part data', 'An offline check covers this, but the part file lacks the value or has it wrong. Confirmed, self-improve fixes the part file.'],
    'false-alarm': ['Offline false alarms', 'Claude thinks this offline finding is wrong. Confirmed, self-improve fixes the check.'],
    idea: ['Ideas', 'Worth a look, but not something a netlist check can decide. Becomes a check only if your reply says so.']
  };
  const ORDER = Object.keys(TYPES);
  const SEV_ORDER = { error: 0, warn: 1, info: 2 };
  const DEC = 'pincheck.scan-decisions/1';
  const NS = () => (PK.DEMO ? 'pincheck.demo.' : 'pincheck.v1.');
  const ICON = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor"/></svg>';
  const tag = () => '<span class="pk-tag-claude" title="From Claude\'s scan">' + ICON + 'Claude</span>';

  // ── Scans ──
  const scans = new Map(); // design slug → { ids, id, scan, decisions: {sha, data}, parts: [names], loading, error, local }
  const key = d => L.slug(d.name);
  const base = (k, id) => 'scans/' + k + '/' + id + '/';
  const repo = p => '/repos/' + L.REPO.owner + '/' + L.REPO.name + '/contents/' + p.split('/').map(encodeURIComponent).join('/');
  function get(d) { return scans.get(key(d)) || null; }

  async function load(d, opts = {}) {
    const k = key(d);
    const was = scans.get(k);
    if (was && (was.loading || (was.loaded && !opts.force && opts.id == null))) return was;
    const s = { loading: true, ids: [], id: opts.id || (was && was.id) || null };
    scans.set(k, s);
    try {
      if (PK.DEMO) {
        const scan = await (await fetch('demo/claude-scan.json', { cache: 'no-cache' })).json();
        if (L.slug(scan.design) === k) Object.assign(s, { ids: [scan.id], id: scan.id, scan, decisions: { sha: null, data: null }, parts: [] });
      } else if (await L.token()) {
        const dirs = ((await L.gh(repo('scans/' + k), { allow404: true })) || []).filter(x => x.type === 'dir').map(x => x.name).sort().reverse();
        s.ids = dirs;
        if (!dirs.includes(s.id)) s.id = dirs[0] || null;
        if (s.id) {
          const files = (await L.gh(repo(base(k, s.id)), { allow404: true })) || [];
          s.scan = JSON.parse(await L.gh(repo(base(k, s.id) + 'scan.json'), { headers: { Accept: 'application/vnd.github.raw' }, raw: true }));
          const dec = files.find(f => f.name === 'decisions.json');
          s.decisions = { sha: dec ? dec.sha : null, data: dec ? JSON.parse(await L.gh(repo(base(k, s.id) + 'decisions.json'), { headers: { Accept: 'application/vnd.github.raw' }, raw: true })) : null };
          s.improved = files.some(f => f.name === 'improved.json');
          const pd = files.find(f => f.name === 'parts' && f.type === 'dir');
          s.parts = pd ? ((await L.gh(repo(base(k, s.id) + 'parts'), { allow404: true })) || []).filter(f => /\.json$/.test(f.name)).map(f => f.name) : [];
        }
      } else s.signedOut = true;
    } catch (e) { s.error = e.status === 404 ? 'pincheck_data not found (or no access)' : e.message; }
    s.loading = false; s.loaded = true;
    return s;
  }
  // A scan.json opened from a file (not stored yet, or for a look): answers stay in this browser.
  function fromFile(d, text) {
    const scan = JSON.parse(text);
    if (scan.schema !== 'pincheck.scan/1' || !Array.isArray(scan.items)) throw new Error('not a Claude scan (pincheck.scan/1)');
    if (L.slug(scan.design) !== key(d)) throw new Error('this scan is of ' + scan.design + ', not ' + d.name);
    scans.set(key(d), { loaded: true, ids: [scan.id], id: scan.id, scan, decisions: { sha: null, data: null }, parts: [], local: true });
  }

  // ── Answers: pincheck_data's decisions.json, then this browser's (newer wins per item) ──
  const LKEY = (d, id) => NS() + 'claude.' + key(d) + '.' + id;
  function localAnswers(d, id) { try { return JSON.parse(localStorage.getItem(LKEY(d, id)) || 'null') || { items: {} }; } catch (e) { return { items: {} }; } }
  function answers(d) {
    const s = get(d); if (!s || !s.scan) return {};
    const out = Object.assign({}, (s.decisions && s.decisions.data && s.decisions.data.items) || {});
    const loc = localAnswers(d, s.id).items;
    for (const [id, a] of Object.entries(loc)) if (!out[id] || (a.at || '') >= (out[id].at || '')) out[id] = a;
    for (const id of Object.keys(out)) if (!out[id] || !out[id].state && !out[id].reply) delete out[id];
    return out;
  }
  // Answers here that pincheck_data doesn't have yet.
  function unsaved(d) {
    const s = get(d); if (!s || !s.scan) return 0;
    const remote = (s.decisions && s.decisions.data && s.decisions.data.items) || {};
    return Object.entries(localAnswers(d, s.id).items).filter(([id, a]) => !remote[id] || remote[id].state !== a.state || (remote[id].reply || '') !== (a.reply || '')).length;
  }
  function answer(d, id, patch, by) {
    const s = get(d); if (!s || !s.scan) return;
    const loc = localAnswers(d, s.id);
    const cur = Object.assign({}, answers(d)[id] || {});
    if ('state' in patch) cur.state = patch.state === cur.state ? null : patch.state; // a second click takes it back
    if ('reply' in patch) cur.reply = patch.reply;
    cur.by = by; cur.at = now();
    loc.items[id] = cur;
    try { localStorage.setItem(LKEY(d, s.id), JSON.stringify(loc)); } catch (e) { throw new Error('Couldn\'t keep the answer in this browser'); }
  }
  function acceptAll(d, by) {
    const s = get(d); if (!s || !s.scan) return 0;
    const a = answers(d); let n = 0;
    for (const it of s.scan.items) if (!a[it.id] || !a[it.id].state) { answer(d, it.id, { state: 'confirmed', reply: (a[it.id] && a[it.id].reply) || '' }, by); n++; }
    return n;
  }
  async function save(d) {
    const s = get(d); if (!s || !s.scan) return 0;
    if (s.local || PK.DEMO) throw new Error(PK.DEMO ? 'The demo keeps answers in this browser' : 'This scan isn\'t in pincheck_data yet: store it with scan.js push first');
    const n = unsaved(d);
    if (!n) return 0;
    const data = { schema: DEC, scan: s.id, design: s.scan.design, updated: now(), items: answers(d) };
    const body = { message: 'Pincheck: answers to Claude\'s scan of ' + s.scan.design + ' (' + s.id + ')', content: L.b64(JSON.stringify(data, null, 2) + '\n') };
    if (s.decisions && s.decisions.sha) body.sha = s.decisions.sha;
    const r = await L.gh(repo(base(key(d), s.id) + 'decisions.json'), { method: 'PUT', body: JSON.stringify(body) });
    s.decisions = { sha: r.content.sha, data };
    try { localStorage.removeItem(LKEY(d, s.id)); } catch (e) { /* storage blocked */ }
    return n;
  }
  async function partFiles(d) {
    const s = get(d); if (!s || !s.parts || !s.parts.length) return [];
    const out = [];
    for (const n of s.parts) out.push(await L.gh(repo(base(key(d), s.id) + 'parts/' + n), { headers: { Accept: 'application/vnd.github.raw' }, raw: true }));
    return out;
  }

  // ── Drawing ──
  const fid = id => 'claude:' + id;
  const items = d => { const s = get(d); return s && s.scan ? s.scan.items.slice().sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) : []; };
  const item = (d, f) => { const s = get(d); return s && s.scan ? s.scan.items.find(i => fid(i.id) === f) || null : null; };
  // What the schematic viewer and its thumbnail need to frame an item.
  const findingLike = (d, f) => { const it = item(d, f); return it ? { id: f, check: 'claude', severity: it.severity, title: it.title, refs: it.refs || [], pins: it.pins || [], nets: it.nets || [] } : null; };
  const stateTag = a => !a || !a.state ? '<span class="pk-ck-state">Not answered</span>'
    : a.state === 'confirmed' ? '<span class="pk-ck-state on"><span aria-hidden="true">✓</span> Confirmed</span>' : '<span class="pk-ck-state off"><span aria-hidden="true">✕</span> Not a problem</span>';
  const when = t => t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  // The section at the top of Findings. `match(it)` applies the page's filter and severities.
  function section(d, st, match, ctx) {
    const s = get(d);
    const head = (sub, btns) => '<div class="section-title pk-sect pk-ck-head"><span>' + tag() + ' Claude\'s scan</span> <span class="pk-muted">' + sub + '</span><span class="spacer"></span>' + (btns || '') + '</div>';
    const ask = '<button class="btn btn-sm" data-ck="ask">Check with Claude…</button>';
    if (!s || s.loading) return head('Looking in pincheck_data…', '');
    if (s.error) return head('Couldn\'t read scans: ' + esc(s.error), '<button class="btn btn-sm" data-ck="reload">Try again</button>' + ask);
    if (!s.scan) return head(s.signedOut ? 'Sign in to see this design\'s scans.' : 'No scan of this design yet.', '<button class="btn btn-sm" data-ck="open-file">Open a scan file…</button>' + ask);
    const sc = s.scan, a = answers(d), list = items(d).filter(match);
    const answered = sc.items.filter(i => a[i.id] && a[i.id].state).length, left = sc.items.length - answered, n = unsaved(d);
    const pick = s.ids.length > 1 ? '<select class="input pk-ck-pick" data-id="ck-pick" aria-label="Scan">' + s.ids.map(id => '<option value="' + esc(id) + '"' + (id === s.id ? ' selected' : '') + '>' + esc(id) + '</option>').join('') + '</select>' : '';
    const btns = pick + (left ? '<button class="btn btn-sm" data-ck="accept-all">Accept all (' + left + ')</button>' : '') +
      (s.local || PK.DEMO ? '' : '<button class="btn btn-sm' + (n ? ' btn-primary' : '') + '" data-ck="save"' + (n ? '' : ' disabled') + '>' + (n ? 'Save answers (' + n + ')' : 'Answers saved') + '</button>') +
      (s.parts && s.parts.length ? '<button class="btn btn-sm" data-ck="parts">Import ' + plural(s.parts.length, 'part file') + '</button>' : '');
    let h = head(esc(when(sc.at)) + (sc.model ? ' · ' + esc(sc.model) : '') + ' · ' + plural(sc.items.length, 'item') + ', ' + answered + ' answered', btns);
    h += '<p class="pk-muted pk-ck-sum">' + 'Claude agreed with ' + (sc.agrees || []).length + ' of the offline findings and reviewed ' + plural((sc.reviewed || []).length, 'area') + '. ' +
      (s.improved ? 'Self-improve has worked through this scan. ' : '') + (s.local ? 'Opened from a file, so answers stay in this browser. ' : '') +
      'Confirm what\'s real; the pincheck-improve skill turns confirmed items into offline checks or part-file fixes.' + '</p>';
    if (!list.length) return h + '<p class="pk-muted">' + (sc.items.length ? 'No item matches the filter.' : 'Claude found nothing the offline checks didn\'t.') + '</p>';
    for (const t of ORDER) {
      const g = list.filter(i => i.type === t);
      if (!g.length) continue;
      h += '<div class="pk-ck-type">' + esc(TYPES[t][0]) + ' <span class="pk-muted">' + g.length + '</span></div><div class="card pk-flist pk-ck-list">';
      for (const it of g) h += row(it, a[it.id], st.openFinding === fid(it.id));
      h += '</div>';
    }
    return h;
  }
  function row(it, a, open) {
    const chips = (it.refs || []).slice(0, 6).map(r => '<span class="tag pk-mono">' + esc(r) + '</span>').join('') + ((it.nets || []).slice(0, 3).map(n => '<span class="tag pk-mono pk-tag-net">' + esc(n) + '</span>').join(''));
    return '<div class="pk-frow pk-ck-row' + (open ? ' open' : '') + (a && a.state ? ' answered' : '') + '" data-fopen="' + esc(fid(it.id)) + '"><button class="pk-fhead" data-fopen="' + esc(fid(it.id)) + '" aria-pressed="' + open + '">' + sevPill(it.severity) +
      '<span class="pk-ftitle">' + esc(it.title) + ' ' + tag() + (it.confidence && it.confidence !== 'high' ? ' <span class="pk-tag-unv" title="Claude\'s confidence">' + esc(it.confidence) + ' confidence</span>' : '') + '</span>' + stateTag(a) + '</button><div class="pk-fchips">' + chips + '</div></div>';
  }

  const X = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  function inspector(d, f, ctx) {
    const it = item(d, f); if (!it) return '';
    const a = answers(d)[it.id] || {};
    const onSheet = ctx.hasSheets && window.PK.viewer && PK.viewer.hitsOf(d, findingLike(d, f)).length > 0;
    let h = '<div class="insp-head"><span class="insp-crumb">Claude\'s scan · ' + esc(TYPES[it.type][0]) + '</span><button class="icon-btn" data-act="close-insp" aria-label="Close" title="Close (Esc)">' + X + '</button></div>' +
      '<div class="insp-body">' + sevPill(it.severity) + ' ' + tag() + ' <span class="pk-tag-unv">' + esc(it.confidence || '') + ' confidence</span>' +
      '<div class="insp-title">' + esc(it.title) + '</div>' + (it.detail ? '<div class="insp-detail">' + esc(it.detail) + '</div>' : '') +
      '<p class="pk-muted pk-ck-what">' + esc(TYPES[it.type][1]) + '</p>';
    h += '<div class="pk-ck-answer"><div class="pk-btns"><button class="btn btn-sm' + (a.state === 'confirmed' ? ' btn-primary' : '') + '" data-ck="confirm" data-item="' + esc(it.id) + '" aria-pressed="' + (a.state === 'confirmed') + '"><span aria-hidden="true">✓</span> Confirm</button>' +
      '<button class="btn btn-sm' + (a.state === 'rejected' ? ' btn-primary' : '') + '" data-ck="reject" data-item="' + esc(it.id) + '" aria-pressed="' + (a.state === 'rejected') + '"><span aria-hidden="true">✕</span> Not a problem</button></div>' +
      '<textarea class="input pk-ck-reply" data-ck-reply="' + esc(it.id) + '" rows="2" placeholder="Reply (optional): why, or what self-improve should do">' + esc(a.reply || '') + '</textarea>' +
      (a.by ? '<div class="pk-sub">' + esc(a.state === 'confirmed' ? 'Confirmed' : a.state === 'rejected' ? 'Turned down' : 'Replied') + ' by ' + esc(a.by) + ', ' + esc(when(a.at)) + '</div>' : '') + '</div>';
    if (onSheet) h += '<button class="insp-preview" data-show="' + esc(f) + '" aria-label="Open in the schematic"><span class="insp-prev-slot"></span><span class="insp-prev-go">Open in schematic →</span></button>';
    const kv = [];
    if ((it.refs || []).length) kv.push(['Parts', it.refs.join(', ')]);
    if ((it.pins || []).length) kv.push(['Pins', it.pins.join(', ')]);
    if ((it.nets || []).length) kv.push(['Nets', it.nets.join(', ')]);
    if (it.check) kv.push(['Offline check', it.check]);
    if (it.ee) kv.push(['Signoff EE item', it.ee]);
    h += '<dl class="kv">' + kv.map(([k, v]) => '<dt>' + k + '</dt><dd' + (k === 'Parts' ? '' : ' class="pk-mono"') + '>' + esc(v) + '</dd>').join('') + '</dl>';
    if (it.offline) h += '<p class="pk-ck-off">' + (it.type === 'false-alarm' ? 'Disputes the offline finding' : 'Offline finding') + ': <button class="pk-link" data-fopen="' + esc(it.offline) + '">' + esc(it.offline) + '</button></p>';
    if (it.needs) h += '<div class="pk-basis"><b>Part data</b>' + esc(it.needs) + '</div>';
    if (it.rule) h += '<div class="pk-basis"><b>Rule for an offline check</b>' + esc(it.rule) + '</div>';
    if ((it.evidence || []).length) h += '<div class="pk-basis"><b>Evidence</b><ul>' + it.evidence.map(e => '<li>' + (e.mpn ? '<span class="pk-mono">' + esc(e.mpn) + '</span>' + (e.page ? ', datasheet p.' + esc(e.page) : '') + ': ' : '') + esc(e.says || '') + '</li>').join('') + '</ul></div>';
    return h + '</div>';
  }

  // The Check with Claude sheet: the prompt for Claude Code, with the project's folder remembered per design.
  const DIR_KEY = d => NS() + 'projectDir.' + key(d);
  function prompt(d, dir) {
    return 'Use the pincheck-scan skill to check the project ' + (dir ? 'in ' + dir : '"' + d.name + '" (ask me for its folder)') + ' with Claude' + (d.variant ? ', build variant ' + d.variant : '') + '.\n\n' +
      'Run Pincheck\'s offline checks as the baseline, fill the parts the library lacks (datasheets from the makers\' sites), review every sheet, and list what the offline checks missed, got wrong, or lacked data for. Show me the dry run before storing the scan in pincheck_data.';
  }
  function sheet(d) {
    let dir = ''; try { dir = localStorage.getItem(DIR_KEY(d)) || ''; } catch (e) { /* storage blocked */ }
    const w = document.createElement('div');
    w.className = 'sheet-wrap';
    const draw = () => {
      w.innerHTML = '<div class="sheet wide"><div class="sheet-head"><h2>Check with Claude</h2><p>The offline checks take under a second and need no connection. Claude takes longer and reads every datasheet: it runs the offline checks first, then reviews the whole project and writes down what they missed, got wrong, or lacked the data for. You confirm each item here, and the pincheck-improve skill makes the offline checks catch it next time.</p></div><div class="sheet-body">' +
        '<ol class="pk-steps"><li>' + SKILLS_STEP + '</li><li>The project\'s folder on this computer (with its Protel2 netlist, or a KiCad XML netlist): <input class="input pk-dsdir" data-ck-dir placeholder="Leave empty and Claude asks for it" value="' + esc(dir) + '"></li>' +
        '<li>In Claude Code, started in the Dovetail tools folder, paste this: <button class="btn btn-sm" data-ck="copy">Copy</button><pre class="pk-pre">' + esc(prompt(d, dir)) + '</pre>Claude downloads missing datasheets from the makers\' sites and fills their part files (unverified), reviews every sheet, and asks before storing the scan in pincheck_data.</li>' +
        '<li>Back here, on Findings, <b>Look again</b> shows the scan beside the offline findings. Confirm each item or mark it Not a problem (or Accept all), reply where it helps, and Save answers. Import the scan\'s part files from there too.</li>' +
        '<li>Then, in Claude Code: <span class="pk-mono">Use the pincheck-improve skill on the latest scan of ' + esc(d.name) + '</span>. It builds what you confirmed and stops at a diff for you.</li></ol></div>' +
        '<div class="sheet-foot"><button class="btn" data-ck="reload">Look again</button><span class="spacer"></span><button class="btn btn-primary" data-ck="close">Done</button></div></div>';
    };
    draw();
    document.body.appendChild(w);
    w.addEventListener('click', async e => {
      const b = e.target.closest('[data-ck]');
      if (e.target === w || (b && b.dataset.ck === 'close')) { w.remove(); return; }
      if (b && b.dataset.ck === 'copy') { try { await navigator.clipboard.writeText(prompt(d, dir)); b.textContent = 'Copied'; } catch (err) { b.textContent = 'Copy blocked: select the text'; } }
      if (b && b.dataset.ck === 'reload') w.remove(); // the app's own handler loads again
    });
    w.addEventListener('input', e => {
      if (!e.target.hasAttribute('data-ck-dir')) return;
      dir = e.target.value.trim();
      try { localStorage.setItem(DIR_KEY(d), dir); } catch (err) { /* storage blocked */ }
      const pre = w.querySelector('.pk-pre'); if (pre) pre.textContent = prompt(d, dir);
    });
  }

  // ── The Claude skills, downloaded from Pincheck itself (Chris, 2026-11-13) ──
  // A zip of skill/ as .claude/skills/<name>/SKILL.md: unzipped in the folder Claude Code starts in, it installs
  // all three. Stored (no compression), written here since the page loads no libraries.
  const SKILLS = [['pincheck-part', 'skill/SKILL.md'], ['pincheck-scan', 'skill/scan/SKILL.md'], ['pincheck-improve', 'skill/improve/SKILL.md']];
  let crcT = null;
  function crc32(b) {
    if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
    let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) { // [[path, Uint8Array]] → Blob
    const enc = new TextEncoder(), parts = [], dir = [];
    let off = 0;
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, data] of files) {
      const n = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, n.length, 2], [28, 0, 2]].forEach(([o, v, s]) => s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, s]) => s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(h, n, data); dir.push(c, n);
      off += 30 + n.length + data.length;
    }
    const size = dir.reduce((s, x) => s + x.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, off, 4]].forEach(([o, v, s]) => s === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    return new Blob(parts.concat(dir, [e]), { type: 'application/zip' });
  }
  async function skillsZip() {
    const files = [];
    for (const [name, src] of SKILLS) {
      const r = await fetch(src, { cache: 'no-cache' });
      if (!r.ok) throw new Error('Couldn\'t read ' + src);
      files.push(['.claude/skills/' + name + '/SKILL.md', new Uint8Array(await r.arrayBuffer())]);
    }
    return zip(files);
  }
  async function downloadSkills() {
    const b = await skillsZip();
    const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = 'pincheck-skills.zip'; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1500);
  }
  const SKILLS_STEP = 'The Claude skills, if Claude Code on this computer doesn\'t have them yet: <button class="btn btn-sm" data-skills>Download the skills</button> ' +
    '<span class="pk-sub">Unzip pincheck-skills.zip in the folder you start Claude Code in (the Dovetail tools folder); it adds .claude/skills/pincheck-part, pincheck-scan, and pincheck-improve. They use the Pincheck repo checked out in that folder.</span>';

  PK.claude = { SKILLS, crc32, zip, skillsZip, downloadSkills, SKILLS_STEP, load, get, fromFile, answers, unsaved, answer, acceptAll, save, partFiles, section, inspector, item, findingLike, sheet, prompt, TYPES };
})(typeof window !== 'undefined' ? (window.PK = window.PK || {}) : (globalThis.PK = globalThis.PK || {}));
