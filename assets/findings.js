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
      '<div class="pk-head-actions"><button class="btn" data-act="rerun" title="Run the checks again with the library as it is now">Run checks again</button></div></div>';
  }

  // ── Overview ──
  function overview(d, run, ctx) {
    const live = run.findings.filter(f => !f.waived), waived = run.findings.length - live.length;
    const cc = counts(live);
    const ics = PK.design.groups(d, ['ic', 'crystal']);
    const known = ics.filter(g => PK.library.find(ctx.lib, g.mpn)).length;
    const unv = live.filter(f => f.unverified).length;
    const sub = '<span>' + d.sheets.length + ' file' + (d.sheets.length === 1 ? '' : 's') + '</span><span class="sep">·</span><span>' + d.parts.length + ' parts</span><span class="sep">·</span><span>' + (d.nets ? d.nets.length + ' nets' : 'no netlist') + '</span><span class="sep">·</span><span>checked in ' + run.ms + ' ms</span>';
    let h = '<div class="page pk-wide">' + head(d, sub);
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
    return h + '</div>';
  }
  const statCard = (n, label, sev, filter, busy) => busy
    ? '<div class="card stat pk-statbtn pk-stat-' + sev + '"><div class="stat-num">–</div><div class="pk-muted">' + label + '</div></div>'
    : '<button class="card stat pk-statbtn pk-stat-' + sev + (n ? ' has' : '') + '" data-sevonly="' + filter + '"><div class="stat-num">' + (n ? '<span aria-hidden="true">' + SEV[sev][0] + '</span> ' : '') + n + '</div><div class="pk-muted">' + label + '</div></button>';

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
    let h = '<div class="page pk-wide">' + head(d, sub);
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

  function row(f, open, ctx) {
    const chips = f.refs.slice(0, 8).map(r => '<span class="tag pk-mono">' + esc(r) + '</span>').join('') + (f.refs.length > 8 ? '<span class="tag">+' + (f.refs.length - 8) + '</span>' : '') +
      f.nets.slice(0, 4).map(n => '<span class="tag pk-mono pk-tag-net">' + esc(n) + '</span>').join('');
    let h = '<div class="pk-frow' + (open ? ' open' : '') + '"><button class="pk-fhead" data-fopen="' + esc(f.id) + '">' + sevPill(f.severity) + '<span class="pk-ftitle">' + esc(f.title) + (f.unverified ? ' <span class="pk-tag-unv" title="Rests on a part-file value nobody has verified">unverified</span>' : '') + (f.waived ? ' <span class="pk-tag-waived">waived</span>' : '') + '</span></button>' +
      '<div class="pk-fchips">' + chips + '</div>';
    if (open) {
      h += '<div class="pk-fbody"><p>' + esc(f.detail) + '</p>';
      if (f.waived) h += '<p class="pk-wnote"><b>Waived</b> by ' + esc(f.waived.by) + ', ' + esc((f.waived.at || '').slice(0, 10)) + (f.waived.scope === 'similar' ? ' (with every finding like it)' : '') + ': ' + esc(f.waived.reason) + '</p>';
      if (f.basis.length) h += '<div class="pk-basis"><b>Rests on</b><ul>' + f.basis.map(b => '<li><span class="pk-mono">' + esc(b.mpn) + '</span> ' + esc(b.k) + (b.on ? ' (' + esc(b.on) + ')' : '') + (b.page ? ', datasheet p.' + esc(b.page) : '') + ' — ' + (b.verified ? '✓ verified' : '<span class="pk-tag-unv">unverified</span>') + ' <button class="pk-link" data-openfile="' + esc(b.file) + '" data-ref="' + esc(f.refs[0] || '') + '">Open part file</button></li>').join('') + '</ul></div>';
      h += '<div class="pk-btns">' + (window.PK.viewer && ctx.hasSheets ? '<button class="btn btn-sm" data-show="' + esc(f.id) + '">Show on schematic</button>' : '') +
        (f.refs[0] ? '<button class="btn btn-sm" data-config="' + esc(f.refs[0]) + '">Open ' + esc(f.refs[0]) + '\'s part</button>' : '') + (f.waived ? '<button class="btn btn-sm" data-unwaive="' + esc(f.id) + '">Restore</button>' : '<button class="btn btn-sm" data-waive="' + esc(f.id) + '">Waive…</button>') + '<span class="pk-muted pk-mono">' + esc(f.check) + '</span></div></div>';
    }
    return h + '</div>';
  }

  PK.pages = { overview, findings, counts };
})(window.PK = window.PK || {});
