// Send to Signoff EE: write Pincheck's errors and warnings (and, when ticked, its notes and waived findings)
// into a board's Signoff review as issues on the Schematic Review checklist, the way Fabcheck's Send
// writes its findings onto Fabrication & Release (../pcb_dfm/assets/signoff.js). Signoff keeps its working
// copy in localStorage (same origin when the tools folder is served whole); writing there in Signoff's own
// format, stamped and marked dirty, lets Signoff's normal Sync push the issues. docs/send-to-signoff-ee.md.
//
// Format (ee_design_review/assets/model.js and app.js):
//   signoff.v1.projects  slug -> project { id, meta, items, sections, comments, custom }
//   signoff.v1.dirty     project id -> ISO time of the last unsynced edit
//   custom[id]   { id, checklist, section, text, hint, severity, source, createdAt, updatedAt, updatedBy }
//   items[id]    { status: 'issue', severity, resolution: '', ref, text, checklist, updatedAt, updatedBy }
//   comments[id] { id, item, author, at, text, updatedAt, updatedBy }
(function (PK) {
  'use strict';
  // Signoff EE's working copy; tests set PK.SIGNOFF_NS to keep off the real one.
  const NS = () => PK.SIGNOFF_NS || (PK.DEMO ? 'signoff.demo.' : 'signoff.v1.');
  const CHECKLIST = 'schematic';
  const now = () => new Date().toISOString();
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function load(key, fallback) { try { const v = localStorage.getItem(NS() + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, value) { localStorage.setItem(NS() + key, JSON.stringify(value)); }
  function user() { return (load('settings', {}) || {}).user || 'Pincheck'; }
  function stamp(rec, who) { rec.updatedAt = now(); rec.updatedBy = who; return rec; }

  // Stable id per board + check + severity, so re-sending updates the same Signoff issue. Fabcheck's are xfc….
  function stableId(projectId, check, severity) {
    let h = 2166136261;
    for (const c of projectId + '|pincheck|' + check + '|' + severity) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'xpk' + (h >>> 0).toString(36);
  }
  const groupId = (projectId, g) => g.waived ? stableId(projectId, 'waived:' + g.check, g.severity) : stableId(projectId, g.check, g.severity);

  // The Schematic Review checklist's sections (ee_design_review/templates/schematic.json).
  const SECTIONS = { 's-pwr': 'Power Architecture & Budget', 's-gnd': 'Grounding', 's-reg': 'Regulators & Converters', 's-dec': 'Decoupling & Bulk Capacitance',
    's-net': 'Connectivity & Net Integrity', 's-clk': 'Clocks, Reset & Power Sequencing', 's-dig': 'Digital Interfaces & High-Speed', 's-mcu': 'Processor, MCU & FPGA',
    's-cmp': 'Component Selection, Ratings & Derating' };
  const BY_CHECK = { 'supply.range': 's-pwr', 'supply.absmax': 's-pwr', 'supply.unpowered': 's-pwr', 'supply.tied': 's-pwr', 'supply.ground': 's-gnd',
    'supply.switchnode': 's-reg', 'supply.rails': 's-reg', 'parts.regulator': 's-reg', 'parts.decoupling': 's-dec', 'parts.ext': 's-dec',
    'io.contention': 's-net', 'pins.dnc': 's-net', 'pins.unused': 's-net', 'pins.float': 's-clk', 'parts.crystal': 's-clk',
    'io.absmax': 's-dig', 'io.recommended': 's-dig', 'io.vih': 's-dig', 'straps.i2c': 's-dig' };
  function sectionFor(check) { return BY_CHECK[check] || (/^func\./.test(check) ? 's-mcu' : 's-cmp'); }

  function projects() {
    const all = load('projects', {});
    return Object.keys(all).map(slug => Object.assign({ slug }, all[slug])).filter(p => p && p.meta && !p.meta.archived)
      .sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
  }

  // Group findings by check and severity (`key`, check|severity, names a group across re-runs). Notes (Info)
  // make groups too; the app leaves them unticked. Waived findings make groups of their own (`waived: true`,
  // key waived|check|severity), which Signoff keeps as reference rows, counted nowhere; also unticked.
  function plan(findings) {
    const groups = new Map();
    for (const f of findings) {
      const k = (f.waived ? 'waived|' : '') + f.check + '|' + f.severity;
      if (!groups.has(k)) groups.set(k, Object.assign({ key: k, check: f.check, severity: f.severity, group: f.group, list: [] }, f.waived ? { waived: true } : {}));
      groups.get(k).list.push(f);
    }
    const rank = g => (g.waived ? 3 : g.severity === 'error' ? 0 : g.severity === 'warn' ? 1 : 2);
    return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.list.length - a.list.length || a.check.localeCompare(b.check));
  }
  // Which "all of this kind" box a group belongs to on Send's list.
  const kindOf = g => (g.waived ? 'waived' : g.severity === 'info' ? 'notes' : g.severity);
  const reasonsOf = list => [...new Set(list.map(f => f.waived && f.waived.reason).filter(Boolean))].map(r => `"${r}"`).join('; ');
  const checkTitle = c => ((PK.checks && PK.checks.byKey && PK.checks.byKey.get(c)) || {}).title || c;

  function issueText(g) {
    const n = g.list.length;
    return `${g.waived ? 'Waived in Pincheck' : 'Pincheck'}: ${g.list[0].title}${n > 1 ? ` (+${n - 1} more)` : ''}`;
  }
  const severityOf = g => (g.severity === 'error' ? 'major' : 'minor');

  // What sending would do in a project, without writing: per group, whether its issue is new, updates one
  // sent before (keeping the reviewer's resolution), or re-raises a deleted one; and the earlier Pincheck
  // issues that would be noted as no longer found. Groups left out still count as found.
  function preview(slug, groups) {
    const p = load('projects', {})[slug];
    if (!p) return null;
    const custom = p.custom || {}, items = p.items || {};
    const rows = groups.map(g => {
      const id = groupId(p.id, g), c = custom[id];
      return { group: g, id, text: issueText(g), section: SECTIONS[sectionFor(g.check)], severity: g.waived ? 'reference' : severityOf(g),
        state: !c ? 'new' : c.deleted ? 'deleted' : 'update', resolution: c && !c.deleted && !g.waived ? (items[id] || {}).resolution || '' : '' };
    });
    const seen = new Set(rows.map(r => r.id));
    return { rows, gone: goneIds(p, seen).map(id => custom[id].text), dropped: droppedRefs(p, seen).map(id => custom[id].text) };
  }
  // Earlier Pincheck issues, still open, that this run didn't find (`seen` holds the ids it did).
  function goneIds(p, seen) {
    const custom = p.custom || {}, items = p.items || {};
    return Object.keys(custom).filter(id => {
      const c = custom[id], st = items[id] || {};
      return c.source && c.source.tool === 'pincheck' && !c.deleted && !c.reference && !seen.has(id) && st.status === 'issue' && !st.resolution && !c.source.gone;
    });
  }
  // Reference rows whose findings this run no longer has waived: removed (tombstoned).
  function droppedRefs(p, seen) {
    const custom = p.custom || {};
    return Object.keys(custom).filter(id => { const c = custom[id]; return c.reference === true && c.source && c.source.tool === 'pincheck' && !c.deleted && !seen.has(id); });
  }

  const where = f => [f.refs.slice(0, 4).join(', '), f.nets.slice(0, 3).join(', ')].filter(Boolean).join(' · ');

  // Write the groups into the project, except those whose key is in `skip`: they are left as they are in
  // Signoff and still count as found. source: { label, run }. Returns { created, updated, resolvedNotes, … }.
  function send(slug, groups, source, skip) {
    const all = load('projects', {});
    const p = all[slug];
    if (!p) throw new Error('That Signoff project is no longer in this browser.');
    const dirty = load('dirty', {});
    const who = user(), t = now(), on = source.label;
    p.custom = p.custom || {}; p.items = p.items || {}; p.comments = p.comments || {};
    const seen = new Set(groups.map(g => groupId(p.id, g)));
    const picked = groups.filter(g => !(skip && skip.has(g.key)));
    let created = 0, updated = 0, resolvedNotes = 0;
    const comment = (item, text) => { const id = uid('c'); p.comments[id] = stamp({ id, item, author: who, at: t, text }, who); };
    for (const g of picked) {
      const id = groupId(p.id, g), first = g.list[0], n = g.list.length, text = issueText(g);
      const word = g.severity === 'error' ? 'error' : g.severity === 'warn' ? 'warning' : 'note';
      const lines = g.list.slice(0, 25).map(f => `• ${f.title}${where(f) ? ' (' + where(f) + ')' : ''}${f.unverified ? ' [unverified value]' : ''}`);
      if (n > 25) lines.push(`• … ${n - 25} more`);
      const hint = `${n} ${word}${n === 1 ? '' : 's'} from Pincheck check "${checkTitle(g.check)}" (${g.check}) on ${on}` +
        (g.waived ? `, waived in Pincheck (${reasonsOf(g.list)}). Kept for reference: not an issue, and not counted` : '') +
        `.\n${first.detail || ''}\n\n${lines.join('\n')}`;
      const refs = [...new Set(g.list.flatMap(f => f.refs || []))].slice(0, 40).join(', ');
      const severity = severityOf(g);
      const existing = p.custom[id];
      p.custom[id] = stamp(Object.assign({}, existing || { id, createdAt: t }, { id, checklist: CHECKLIST, section: sectionFor(g.check), text, hint, severity, deleted: false,
        ...(g.waived ? { reference: true } : {}), source: {
          tool: 'pincheck', check: g.check, gone: false, run: source.run || null,
          // Up to 50 findings, each opening Pincheck at that finding (docs/send-to-signoff-ee.md).
          locations: g.list.slice(0, 50).map(f => ({ finding: f.id, label: f.title, refs: f.refs.slice(0, 8), nets: f.nets.slice(0, 4) })),
        } }), who);
      const prev = p.items[id] || {};
      if (g.waived) {
        p.items[id] = stamp(Object.assign({}, prev, { status: 'issue', severity, resolution: 'waived', ref: refs || prev.ref || '', text, checklist: CHECKLIST }), who);
        comment(id, `${!existing || existing.deleted ? 'Waived in Pincheck' : 'Still waived in Pincheck'} on ${on}: ${n} finding${n === 1 ? '' : 's'} (${reasonsOf(g.list)}). Kept for reference.`);
        if (!existing || existing.deleted) created++; else updated++;
      } else if (!existing || existing.deleted) {
        p.items[id] = stamp(Object.assign({}, prev, { status: 'issue', severity, resolution: '', ref: refs, text, checklist: CHECKLIST }), who);
        comment(id, `Raised by Pincheck from ${on}: ${n} finding${n === 1 ? '' : 's'}.`);
        created++;
      } else {
        // Keep the reviewer's status and resolution; refresh the wording and say what the new run saw.
        p.items[id] = stamp(Object.assign({}, prev, { text, ref: refs || prev.ref, checklist: CHECKLIST }), who);
        comment(id, `Pincheck re-run on ${on}: still ${n} finding${n === 1 ? '' : 's'}.`);
        updated++;
      }
    }
    // Issues Pincheck raised before that this run no longer finds open.
    const waivedNow = new Map(groups.filter(g => g.waived).map(g => [g.check, g]));
    for (const id of goneIds(p, seen)) {
      const c = p.custom[id], wg = waivedNow.get(c.source.check);
      comment(id, wg ? `Pincheck re-run on ${on}: no longer open there; ${wg.list.length} finding${wg.list.length === 1 ? ' is' : 's are'} waived in Pincheck (${reasonsOf(wg.list)}). Mark it Waived if that is expected.`
        : `Pincheck re-run on ${on}: no longer found. Mark it Fixed if that is expected.`);
      p.custom[id] = stamp(Object.assign({}, c, { source: Object.assign({}, c.source, { gone: true }) }), who);
      resolvedNotes++;
    }
    let dropped = 0;
    for (const id of droppedRefs(p, seen)) { p.custom[id] = stamp(Object.assign({}, p.custom[id], { deleted: true }), who); dropped++; }
    all[slug] = p;
    dirty[p.id] = t;
    save('projects', all);
    save('dirty', dirty);
    return { created, updated, resolvedNotes, dropped, skipped: groups.length - picked.length, projectId: p.id, slug, name: (p.meta || {}).name };
  }

  // Show a project's Findings in Signoff EE, in this tab, after a Send or from "Back to Signoff EE". Open in
  // Pincheck left a return point (EE's fabReturn, shared with Fabcheck), which goes back to that tab.
  function openFindings(projectId) {
    const all = load('projects', {});
    const slug = Object.keys(all).find(k => all[k].id === projectId);
    if (!slug) return false;
    const ret = load('fabReturn', null);
    const view = ret && ret.project === projectId && typeof ret.view === 'string' && ret.view ? ret.view : 'findings';
    if (view === 'findings') try { localStorage.removeItem(NS() + 'fabReturn'); } catch (e) { /* storage blocked */ }
    save('ui', Object.assign(load('ui', {}) || {}, { slug, view, home: false }));
    location.href = '../ee_design_review/index.html' + (PK.DEMO ? '?demo' : '');
    return true;
  }
  function projectById(id) { const all = load('projects', {}); const slug = Object.keys(all).find(k => all[k].id === id); return slug ? Object.assign({ slug }, all[slug]) : null; }

  PK.signoff = { projects, plan, preview, send, kindOf, sectionFor, SECTIONS, stableId, openFindings, projectById, CHECKLIST };
})(window.PK = window.PK || {});
