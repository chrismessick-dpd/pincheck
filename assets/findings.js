// Pincheck's Overview and Findings pages, laid out as Fabcheck's are: counts, the most serious
// findings, the rails, and a filterable findings list (no check matrix: Chris, 2026-11-13). The app owns state
// and events; these only draw. Severities are never color alone: errors striped with ✕, warnings
// dotted with ▲ (the suite's colorblind-safe tokens).
(function (PK) {
  'use strict';
  const C = PK.checks, P = PK.params;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEV = { error: ['✕', 'Error', 'Errors'], warn: ['▲', 'Warning', 'Warnings'], info: ['i', 'Note', 'Notes'] };
  const sevPill = s => '<span class="pk-sev pk-sev-' + s + '"><span aria-hidden="true">' + SEV[s][0] + '</span>' + SEV[s][1] + '</span>';
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b || a + 's');
  const groups = () => [...new Set(C.CATALOG.map(c => c.group))];

  function counts(fs) { const c = { error: 0, warn: 0, info: 0 }; for (const f of fs) c[f.severity]++; return c; }

  function head(d, sub) {
    const src = d.source === 'kicad' ? 'KiCad netlist' : d.netlist ? 'Altium schematic and Protel2 netlist' : d.source === 'altium' ? 'Altium schematic' : 'Schematic';
    return '<div class="page-head"><div class="page-head-text"><div class="eyebrow">' + esc(src) + '</div><h1 class="page-title">' + esc(d.name) + '</h1><div class="page-sub">' + sub + '</div></div>' +
      '<div class="pk-head-actions"><button class="btn" data-act="rerun" title="Run the checks again with the library as it is now">Run checks again</button></div></div>' + storedNote(d);
  }
  // A run reopened from Signoff EE (docs/send-to-signoff-ee.md): its findings as sent, not checked again.
  function storedNote(d) {
    const s = d.fromRun;
    if (!s) return '';
    const r = s.run, when = r.at ? new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return '<div class="hint pk-stored"><b>A run sent to Signoff EE</b>Checked ' + esc(when) + (r.by ? ' by ' + esc(r.by) : '') + ' with Pincheck ' + esc((r.tool && r.tool.version) || '') +
      ' and the ' + plural((r.library && r.library.files) || 0, 'part file') + ' it used then. These are its findings as sent; “Run checks again” checks it against the library as it is now.' +
      (s.projectId ? ' <button class="pk-link" data-act="so-back" data-project="' + esc(s.projectId) + '">Back to Signoff EE</button>' : '') + '</div>';
  }

  // The build variant being checked (Chris, 2026-11-13): Altium's variants from the .PrjPcb, a picker when there are
  // any, and how many parts it leaves unfitted. Changing it reruns the checks (app.js, data-id="variant").
  function variantBar(d) {
    const vs = d.variants || [];
    const off = d.parts.filter(p => p.dnp);
    const own = off.filter(p => !vs.some(v => v.name === d.variant && v.notFitted.some(r => r.toUpperCase() === String(p.ref).toUpperCase())));
    const count = off.length ? plural(off.length, 'part') + ' not fitted' + (own.length && own.length < off.length ? ' (' + own.length + ' by their own DNP)' : own.length ? ' (by their own DNP)' : '') : 'every part fitted';
    const pick = vs.length
      ? '<select class="input pk-variant-sel" data-id="variant" aria-label="Build variant">' + vs.map(v => '<option value="' + esc(v.name) + '"' + (v.name === d.variant ? ' selected' : '') + '>' + esc(v.name) + ' (' + v.notFitted.length + ' not fitted)</option>').join('') + '<option value=""' + (!d.variant ? ' selected' : '') + '>No variant: every part fitted</option></select>'
      : '<b class="pk-variant-name">' + (d.source === 'altium' ? 'None in the project' : 'No variants') + '</b>';
    const hint = vs.length ? '' : d.source === 'altium' ? '<span class="pk-muted">Drop the project\'s folder or .zip (with its .PrjPcb) to check its variants.</span>' : '';
    return '<div class="pk-variant"><span class="pk-variant-label">Build variant</span>' + pick + '<span class="pk-variant-count' + (off.length ? '' : ' pk-muted') + '"' + (off.length ? ' title="' + esc(off.map(p => p.ref).join(', ')) + '"' : '') + '>' + count + (off.length ? ', left out of the checks' : '') + '</span>' + hint + '</div>';
  }

  // ── Overview ──
  function overview(d, run, ctx) {
    const live = run.findings.filter(f => !f.waived), waived = run.findings.length - live.length;
    const cc = counts(live);
    const ics = PK.design.groups(d, ['ic', 'crystal']);
    const known = ics.filter(g => PK.library.find(ctx.lib, g.mpn)).length;
    const unv = live.filter(f => f.unverified).length;
    const sub = '<span>' + d.sheets.length + ' file' + (d.sheets.length === 1 ? '' : 's') + '</span><span class="sep">·</span><span>' + d.parts.length + ' parts</span><span class="sep">·</span><span>' + (d.nets ? d.nets.length + ' nets' : 'no netlist') + '</span><span class="sep">·</span><span>checked in ' + run.ms + ' ms</span>';
    let h = '<div class="page pk-wide">' + head(d, sub) + variantBar(d);
    // The scan panel leads the page when the design has sheet drawings (assets/scan.js); while it plays, the
    // totals wait for it, as Fabcheck's do for its stage.
    if (ctx.scan) h += '<div id="pk-scan-host"></div>';
    const busy = !!ctx.scanning;
    if (!run.hasNets) h += '<div class="hint"><b>Only the library checks ran</b>There are no nets: drop the project\'s Protel2 netlist (Altium: Design › Netlist For Project › Protel2) with the sheets, or a KiCad XML netlist.</div>';
    h += '<div class="grid grid-4 pk-stats">' +
      statCard(cc.error, 'errors', 'error', 'error', busy) + statCard(cc.warn, 'warnings', 'warn', 'warn', busy) + statCard(cc.info, 'notes', 'info', 'info', busy) +
      '<button class="card stat pk-statbtn" data-tab="parts"><div class="stat-num">' + known + ' / ' + ics.length + '</div><div class="pk-muted">ICs and crystals with a part file</div></button></div>';
    if (unv) h += '<p class="pk-muted" style="margin-top:10px">' + plural(unv, 'finding rests', 'findings rest') + ' on part-file values nobody has verified, so ' + (unv === 1 ? 'it is' : 'they are') + ' warnings at most. Verify the values (each finding names them) to make them count.</p>';
    const top = busy ? [] : live.filter(f => f.severity !== 'info').slice(0, 8);
    if (waived) h += '<p class="pk-muted" style="margin-top:10px">' + plural(waived, 'finding is', 'findings are') + ' waived: <button class="pk-link" data-tab="findings">see them under Waived</button>.</p>';
    if (top.length) {
      h += '<div class="section-title pk-sect">Most serious <span class="pk-muted">' + (live.length > top.length ? top.length + ' of ' + live.length + ' · <button class="pk-link" data-tab="findings">All findings</button>' : '') + '</span></div><div class="card pk-flist">';
      for (const f of top) h += row(f, ctx.state.openFinding === f.id, ctx);
      h += '</div>';
    }
    h += '<div class="section-title pk-sect">Rails <span class="pk-muted">Net voltages the checks worked out, and where each came from.</span></div>';
    const rails = run.rails.filter(r => r.v > 0.01);
    h += rails.length ? '<div class="card pk-scroll"><table class="table pk-rails"><thead><tr><th>Net</th><th class="pk-num">Voltage</th><th>From</th></tr></thead><tbody>' +
      rails.map(r => '<tr><td class="pk-mono">' + esc(r.net) + '</td><td class="pk-num">' + (+r.v.toFixed(3)) + ' V</td><td class="pk-desc">' + esc(r.from) + (r.unverified ? ' <span class="pk-tag-unv">unverified</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="pk-muted">No rail voltages could be worked out: no regulator in the library sets one, and no net name states one.</p>';
    return h + (ctx.after || '') + '</div>';
  }
  const statCard = (n, label, sev, filter, busy) => busy
    ? '<div class="card stat pk-statbtn pk-stat-' + sev + '"><div class="stat-num">–</div><div class="pk-muted">' + label + '</div></div>'
    : '<button class="card stat pk-statbtn pk-stat-' + sev + (n ? ' has' : '') + '" data-sevonly="' + filter + '"><div class="stat-num">' + (n ? (sev === 'info' ? '<span class="pk-info-ico" aria-hidden="true">i</span>' : '<span aria-hidden="true">' + SEV[sev][0] + '</span> ') : '') + n + '</div><div class="pk-muted">' + label + '</div></button>';

  // ── Findings ──
  function findings(d, run, ctx) {
    const st = ctx.state;
    const q = (st.q || '').trim().toLowerCase();
    const sevOn = st.sev || { error: true, warn: true, info: true };
    const inCheck = f => !st.check || (st.check.startsWith('group:') ? f.group === st.check.slice(6) : f.check === st.check);
    const base = run.findings.filter(f => !f.waived && inCheck(f));
    const waivedList = run.findings.filter(f => f.waived && inCheck(f));
    const shown = base.filter(f => sevOn[f.severity] && (!q || (f.title + ' ' + f.detail + ' ' + f.refs.join(' ') + ' ' + f.nets.join(' ')).toLowerCase().includes(q)));
    const cc = counts(base);
    const sub = '<span>' + plural(cc.error, 'error') + '</span><span class="sep">·</span><span>' + plural(cc.warn, 'warning') + '</span><span class="sep">·</span><span>' + plural(cc.info, 'note') + '</span>';
    let h = '<div class="page pk-wide">' + head(d, sub) + variantBar(d);
    h += '<div class="pk-ftools"><input class="input pk-fq" data-id="fq" placeholder="Filter findings (part, net, or words)" value="' + esc(st.q || '') + '">' +
      '<div class="seg sev-seg">' + ['error', 'warn', 'info'].map(s => '<button data-sev="' + s + '" class="' + (sevOn[s] ? 'on' : '') + '"><span class="pk-sevdot pk-sev-' + s + '" aria-hidden="true">' + SEV[s][0] + '</span>' + SEV[s][2] + ' <span class="count">' + cc[s] + '</span></button>').join('') + '</div>' +
      '<select class="input pk-fgroup" data-id="fgroup"><option value="">Every check</option>' + groups().map(g => '<optgroup label="' + esc(g) + '"><option value="group:' + esc(g) + '"' + (st.check === 'group:' + g ? ' selected' : '') + '>All ' + esc(g.toLowerCase()) + '</option>' + C.CATALOG.filter(c => c.group === g).map(c => '<option value="' + c.key + '"' + (st.check === c.key ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('') + '</optgroup>').join('') + '</select></div>';
    if (!shown.length && !waivedList.length) return h + '<div class="empty"><h2>' + (run.findings.length ? 'Nothing matches' : 'No findings') + '</h2><p>' + (run.findings.length ? 'Change the filter or the severities.' : 'Every check that had the data it needs passed.') + '</p></div></div>';
    for (const g of groups()) {
      const list = shown.filter(f => f.group === g);
      if (!list.length) continue;
      h += '<div class="section-title pk-sect">' + esc(g) + ' <span class="pk-muted">' + list.length + ' shown</span></div><div class="card pk-flist">';
      for (const f of list) h += row(f, st.openFinding === f.id, ctx);
      h += '</div>';
    }
    if (waivedList.length) {
      h += '<details class="pk-waived"><summary class="section-title pk-sect">Waived <span class="pk-muted">' + waivedList.length + '</span></summary><div class="card pk-flist">';
      for (const f of waivedList) h += row(f, st.openFinding === f.id, ctx);
      h += '</div></details>';
    }
    return h + '</div>';
  }

  // One line per finding; a click selects it and opens the detail panel (inspector, below) on the right
  // (Chris, 2026-11-13: rows stay collapsed, as Fabcheck's do).
  function row(f, open, ctx) {
    const chips = f.refs.slice(0, 8).map(r => '<span class="tag pk-mono">' + esc(r) + '</span>').join('') + (f.refs.length > 8 ? '<span class="tag">+' + (f.refs.length - 8) + '</span>' : '') +
      f.nets.slice(0, 4).map(n => '<span class="tag pk-mono pk-tag-net">' + esc(n) + '</span>').join('');
    return '<div class="pk-frow' + (open ? ' open' : '') + '" data-id="' + esc(f.id) + '" data-fopen="' + esc(f.id) + '"><button class="pk-fhead" data-fopen="' + esc(f.id) + '" aria-pressed="' + open + '">' + sevPill(f.severity) + '<span class="pk-ftitle">' + esc(f.title) + (f.unverified ? ' <span class="pk-tag-unv" title="Rests on a part-file value nobody has verified">unverified</span>' : '') + (f.waived ? ' <span class="pk-tag-waived">waived</span>' : '') + '</span></button>' +
      '<div class="pk-fchips">' + chips + '</div></div>';
  }

  // The detail panel: the finding, a thumbnail of it on the schematic (filled by PK.viewer.preview into
  // .insp-prev-slot; a click zooms into the Schematic tab), Open in schematic under it, then what it rests on.
  const X = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  function inspector(d, f, ctx) {
    const c = C.byKey.get(f.check);
    const onSheet = ctx.hasSheets && window.PK.viewer && PK.viewer.hitsOf(d, f).length > 0;
    let h = '<div class="insp-head"><span class="insp-crumb">' + esc(f.group) + ' · ' + esc(c ? c.title : f.check) + '</span><button class="icon-btn" data-act="close-insp" aria-label="Close" title="Close (Esc)">' + X + '</button></div>' +
      '<div class="insp-body">' + sevPill(f.severity) + (f.unverified ? ' <span class="pk-tag-unv" title="Rests on a part-file value nobody has verified">unverified</span>' : '') + (f.waived ? ' <span class="pk-tag-waived">waived</span>' : '') +
      '<div class="insp-title">' + esc(f.title) + '</div>' + (f.detail ? '<div class="insp-detail">' + esc(f.detail) + '</div>' : '');
    if (f.waived) h += '<p class="pk-wnote"><b>Waived</b> by ' + esc(f.waived.by) + ', ' + esc((f.waived.at || '').slice(0, 10)) + (f.waived.scope === 'similar' ? ' (with every finding like it)' : '') + ': ' + esc(f.waived.reason) + '</p>';
    if (onSheet) h += '<button class="insp-preview" data-show="' + esc(f.id) + '" aria-label="Open in the schematic"><span class="insp-prev-slot"></span><span class="insp-prev-go">Open in schematic →</span></button>';
    h += '<div class="pk-btns pk-insp-btns">' + (onSheet ? '<button class="btn btn-primary btn-sm" data-show="' + esc(f.id) + '">Open in schematic</button>' : '') +
      (f.refs[0] ? '<button class="btn btn-sm" data-config="' + esc(f.refs[0]) + '">Open ' + esc(f.refs[0]) + '\'s part</button>' : '') +
      (f.waived ? '<button class="btn btn-sm" data-unwaive="' + esc(f.id) + '">Restore</button>' : '<button class="btn btn-sm" data-waive="' + esc(f.id) + '">Waive…</button>') + '</div>';
    const kv = [];
    if (f.refs.length) kv.push(['Parts', f.refs.slice(0, 40).join(', ') + (f.refs.length > 40 ? ' …' : '')]);
    if (f.nets.length) kv.push(['Nets', f.nets.slice(0, 20).join(', ') + (f.nets.length > 20 ? ' …' : '')]);
    kv.push(['Check', f.check]);
    h += '<dl class="kv">' + kv.map(([k, v]) => '<dt>' + k + '</dt><dd' + (k === 'Check' || k === 'Nets' ? ' class="pk-mono"' : '') + '>' + esc(v) + '</dd>').join('') + '</dl>';
    if (f.basis.length) h += '<div class="pk-basis"><b>Rests on</b><ul>' + f.basis.map(b => '<li><span class="pk-mono">' + esc(b.mpn) + '</span> ' + esc(b.k) + (b.on ? ' (' + esc(b.on) + ')' : '') + (b.page ? ', datasheet p.' + esc(b.page) : '') + ' — ' + (b.verified ? '✓ verified' : '<span class="pk-tag-unv">unverified</span>') + ' <button class="pk-link" data-openfile="' + esc(b.file) + '" data-ref="' + esc(f.refs[0] || '') + '">Open part file</button></li>').join('') + '</ul></div>';
    return h + '</div>';
  }

  // ── The report (as Signoff EE's): one printable page of the run's status and findings, drawn into the
  // #report overlay, whose print styles (suite.css) show only it. It counts what Overview counts: waived
  // findings leave the totals and get their own section with the reasons.
  const BRAND = '<svg width="10" height="16" viewBox="0 0 59.21 98.68"><path d="M0 0h18.19v41.88H0zM0 56.79h18.19v41.88H0zM18.2 41.89h1.59v14.91H18.2zM19.79 0v41.89l24.96-6.63v28.16L19.79 56.79v41.89l39.42-10.47V10.47z" fill="#004952"/></svg>';
  const SEV_ORDER = { error: 0, warn: 1, info: 2 };
  const fmtDate = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function report(d, run, ctx) {
    const live = run.findings.filter(f => !f.waived), waived = run.findings.filter(f => f.waived);
    const cc = counts(live), issues = cc.error + cc.warn;
    const L = PK.library, lib = ctx.lib || [];
    const ics = PK.design.groups(d, ['ic', 'crystal']);
    const files = [], missing = [];
    for (const g of ics) { const f = L.find(lib, g.mpn); if (f) { if (files.indexOf(f) < 0) files.push(f); } else missing.push(g); }
    const vals = files.reduce((a, f) => { const s = L.stats(f); a.v += s.verified; a.n += s.values; return a; }, { v: 0, n: 0 });
    const stored = d.fromRun && d.fromRun.run;
    const checkedAt = stored && stored.at ? stored.at : Date.now();
    const src = d.source === 'kicad' ? 'KiCad netlist' : d.netlist ? 'Altium schematic and Protel2 netlist' : d.source === 'altium' ? 'Altium schematic' : 'Schematic';
    const cov = run.coverage || {};
    const hasCov = Object.keys(cov).length > 0;
    const pill = s => '<span class="pk-sev pk-sev-' + s + '"><span aria-hidden="true">' + SEV[s][0] + '</span>' + SEV[s][1] + '</span>';
    const cell = (n, b) => '<td class="num">' + (b ? '<b>' + n + '</b>' : n) + '</td>';
    const findingCell = f => {
      const c = C.byKey.get(f.check);
      return '<td><b style="font-weight:500">' + esc(f.title) + '</b>' + (f.unverified ? ' <span class="pk-tag-unv">unverified</span>' : '') +
        (f.detail ? '<div class="r-cmt">' + esc(f.detail) + '</div>' : '') +
        '<div class="r-cmt">' + esc(f.group + ' › ' + (c ? c.title : f.check)) + '</div>' +
        (f.refs.length ? '<div class="r-cmt">Parts: <span class="pk-mono">' + esc(f.refs.slice(0, 40).join(', ') + (f.refs.length > 40 ? ' …' : '')) + '</span></div>' : '') +
        (f.nets.length ? '<div class="r-cmt">Nets: <span class="pk-mono">' + esc(f.nets.slice(0, 20).join(', ') + (f.nets.length > 20 ? ' …' : '')) + '</span></div>' : '') +
        (f.basis.length ? '<div class="r-cmt">Rests on: ' + f.basis.map(b => esc(b.mpn + ' ' + b.k + (b.on ? ' (' + b.on + ')' : '') + (b.page ? ', p.' + b.page : '')) + (b.verified ? ' ✓' : ' (unverified)')).join('; ') + '</div>' : '') + '</td>';
    };
    const sorted = list => list.slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

    let h = '<div class="report-bar"><b>Schematic check report</b><div style="display:flex;gap:8px"><button class="btn" data-act="close-report">Close</button><button class="btn btn-primary" data-act="print">Print / Save PDF</button></div></div>' +
      '<div class="paper pk-paper">' +
      '<div class="r-head"><div><div class="r-brand">' + BRAND + 'DOVETAIL · PINCHECK · SCHEMATIC CHECK</div>' +
      '<h1 style="margin-top:14px">' + esc(d.name) + '</h1><div style="color:#515154">' + esc([src, plural(d.sheets.length, 'file'), plural(d.parts.length, 'part'), d.nets ? plural(d.nets.length, 'net') : 'no netlist'].join(' · ')) + '</div></div>' +
      '<div style="text-align:right"><div style="font:600 30px var(--display);color:#004952">' + (issues ? issues : '✓') + '</div><div style="color:#86868b;font-size:11px">' + (issues ? (issues === 1 ? 'open issue' : 'open issues') : 'no open issues') + '</div></div></div>' +
      '<div class="r-meta"><div><span>Checked</span>' + esc(fmtDate(checkedAt)) + '</div>' +
      '<div><span>Findings</span>' + esc(plural(cc.error, 'error') + ', ' + plural(cc.warn, 'warning') + ', and ' + plural(cc.info, 'note')) + '</div>' +
      '<div><span>Part files</span>' + (ics.length - missing.length) + ' of ' + plural(ics.length, 'IC and crystal', 'ICs and crystals') + '</div>' +
      '<div><span>Values verified</span>' + vals.v + ' of ' + vals.n + '</div></div>';
    if (stored) h += '<p class="r-cmt">A run sent to Signoff EE' + (stored.by ? ' by ' + esc(stored.by) : '') + ', with Pincheck ' + esc((stored.tool && stored.tool.version) || '') + ' and the ' + plural((stored.library && stored.library.files) || 0, 'part file') + ' it used then. These are its findings as sent.</p>';
    if (!run.hasNets) h += '<p class="r-cmt"><b>Only the library checks ran:</b> the design has no nets (no Protel2 or KiCad netlist).</p>';
    const unv = live.filter(f => f.unverified).length;
    if (unv) h += '<p class="r-cmt">' + plural(unv, 'finding rests', 'findings rest') + ' on part-file values nobody has verified, so ' + (unv === 1 ? 'it is' : 'they are') + ' a warning at most.</p>';

    // Summary by check group.
    h += '<h2>Summary</h2><table><thead><tr><th>Checks</th>' + (hasCov ? '<th class="num">Checked</th><th class="num">Skipped</th>' : '') + '<th class="num">Errors</th><th class="num">Warnings</th><th class="num">Notes</th><th class="num">Waived</th></tr></thead><tbody>';
    const tot = { checked: 0, skipped: 0, error: 0, warn: 0, info: 0, waived: 0 };
    for (const g of groups()) {
      const keys = C.CATALOG.filter(c => c.group === g).map(c => c.key);
      const gc = counts(live.filter(f => f.group === g)), gw = waived.filter(f => f.group === g).length;
      const k = keys.reduce((a, key) => { const x = cov[key] || {}; a.c += x.checked || 0; a.s += x.skipped || 0; return a; }, { c: 0, s: 0 });
      tot.checked += k.c; tot.skipped += k.s; tot.error += gc.error; tot.warn += gc.warn; tot.info += gc.info; tot.waived += gw;
      h += '<tr><td>' + esc(g) + ' <span class="r-cmt">(' + plural(keys.length, 'check') + ')</span></td>' + (hasCov ? cell(k.c) + cell(k.s) : '') + cell(gc.error) + cell(gc.warn) + cell(gc.info) + cell(gw) + '</tr>';
    }
    h += '<tr><td><b>Total</b></td>' + (hasCov ? cell(tot.checked, 1) + cell(tot.skipped, 1) : '') + cell(tot.error, 1) + cell(tot.warn, 1) + cell(tot.info, 1) + cell(tot.waived, 1) + '</tr></tbody></table>';
    if (hasCov && tot.skipped) h += '<p class="r-cmt">Skipped: places a check couldn\'t look at for want of a part file, a value, or a net.</p>';

    // Issues (errors and warnings), then notes, then waived.
    const iss = sorted(live.filter(f => f.severity !== 'info'));
    h += '<h2>Issues</h2>' + (iss.length ? '<table><thead><tr><th>#</th><th>Severity</th><th>Finding</th></tr></thead><tbody>' +
      iss.map((f, i) => '<tr><td>' + (i + 1) + '</td><td>' + pill(f.severity) + '</td>' + findingCell(f) + '</tr>').join('') + '</tbody></table>'
      : '<p>No errors or warnings.</p>');
    const notes = live.filter(f => f.severity === 'info');
    if (notes.length) h += '<h2>Notes</h2><table><thead><tr><th>#</th><th>Severity</th><th>Finding</th></tr></thead><tbody>' +
      notes.map((f, i) => '<tr><td>' + (i + 1) + '</td><td>' + pill('info') + '</td>' + findingCell(f) + '</tr>').join('') + '</tbody></table>';
    if (waived.length) h += '<h2>Waived</h2><table><thead><tr><th>#</th><th>Severity</th><th>Finding</th><th>Waiver</th></tr></thead><tbody>' +
      sorted(waived).map((f, i) => '<tr><td>' + (i + 1) + '</td><td>' + pill(f.severity) + '</td>' + findingCell(f) +
        '<td>' + esc(f.waived.reason || '') + '<div class="r-cmt">' + esc([f.waived.by, (f.waived.at || '').slice(0, 10)].filter(Boolean).join(', ')) + (f.waived.scope === 'similar' ? ' (with every finding like it)' : '') + '</div></td></tr>').join('') + '</tbody></table>';

    // Rails, and the parts the checks couldn't look into.
    const rails = (run.rails || []).filter(r => r.v > 0.01);
    if (rails.length) h += '<h2>Rails</h2><table><thead><tr><th>Net</th><th class="num">Voltage</th><th>From</th></tr></thead><tbody>' +
      rails.map(r => '<tr><td class="pk-mono">' + esc(r.net) + '</td><td class="num">' + (+r.v.toFixed(3)) + ' V</td><td>' + esc(r.from) + (r.unverified ? ' <span class="pk-tag-unv">unverified</span>' : '') + '</td></tr>').join('') + '</tbody></table>';
    if (missing.length) h += '<h2>Not in the library</h2><p class="r-cmt">These parts have no part file, so the checks didn\'t look at their pins.</p><table><thead><tr><th>Part number</th><th>Refs</th></tr></thead><tbody>' +
      missing.map(g => '<tr><td class="pk-mono">' + esc(g.mpn || 'No part number') + '</td><td class="pk-mono">' + esc(g.refs.join(', ')) + '</td></tr>').join('') + '</tbody></table>';

    return h + '<div class="sign"><div>Reviewed by</div><div>Approved by</div></div>' +
      '<div class="r-foot"><span>Generated by Pincheck ' + esc(PK.VERSION || '') + ' on ' + esc(fmtDate(Date.now())) + '</span><span>' + esc(d.name) + '</span></div></div>';
  }

  PK.pages = { overview, findings, counts, inspector, report };
})(window.PK = window.PK || {});
