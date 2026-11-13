// The part window: make or change one part file by hand (Identity, Pins, Parameters, JSON tabs).
// PK.editor.open({ file, part, who, onSave(file), onDelete(file) }). `part` is the schematic part it was
// opened from, if any; its pins are compared with the file's. Works on a copy until Save.
(function (PK) {
  'use strict';
  const P = PK.params, L = PK.library;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  function open(opts) {
    const f = JSON.parse(JSON.stringify(opts.file));
    f.values = f.values || []; f.pins = f.pins || []; f.domains = f.domains || []; f.match = f.match || [];
    f.datasheet = f.datasheet || {};
    const st = { tab: opts.tab || (opts.isNew ? 'pins' : 'params'), pinFilter: '', onlyFilled: false, dirty: false };
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap pk-ed-wrap';
    wrap.innerHTML = '<div class="sheet pk-ed" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(wrap);
    const sheet = wrap.firstChild;
    const mism = opts.part ? L.pinCheck(f, opts.part) : [];

    function close(force) {
      if (!force && st.dirty && !confirm('Close without saving your changes to ' + f.mpn + '?')) return;
      wrap.remove(); document.removeEventListener('keydown', key);
    }
    function key(e) { if (e.key === 'Escape' && !document.querySelector('.pk-ed-wrap ~ .sheet-wrap')) close(); }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });

    const valueOf = (k, on) => f.values.find(v => v.k === k && (v.on || '') === (on || ''));
    function setValue(k, on, field, raw) {
      const c = P.byKey.get(k);
      let v = valueOf(k, on);
      if (!v) { v = { k, unit: c ? c.unit : '' }; if (on) v.on = on; f.values.push(v); }
      const t = String(raw).trim();
      if (['min', 'typ', 'max', 'value'].includes(field)) {
        const n = P.parseNum(t, c ? c.unit : '');
        if (t === '') delete v[field]; else v[field] = n != null ? n : t; // an expression ("VDD+0.3") stays text
      } else if (field === 'page') { if (t === '') delete v.page; else v.page = +t || t; }
      else if (field === 'list') { const lines = t.split(/\n|;\s*/).map(s => s.trim()).filter(Boolean); if (lines.length) v.list = lines; else delete v.list; }
      else if (t === '') delete v[field]; else v[field] = t;
      if (['min', 'typ', 'max', 'value', 'text', 'list'].includes(field)) { delete v.ok; if (!v.src || v.src === 'schematic parameter' || v.src === 'llm') v.src = 'hand'; }
      if (!['min', 'typ', 'max', 'value', 'text', 'list'].some(x => v[x] != null)) f.values.splice(f.values.indexOf(v), 1);
      st.dirty = true;
    }

    const stats = () => { const s = L.stats(f); return s.values + ' value' + (s.values === 1 ? '' : 's') + ', ' + s.verified + ' verified · ' + s.pins + ' pins'; };

    function render() {
      sheet.innerHTML =
        '<div class="sheet-head pk-ed-head"><div><h2>' + esc(f.mpn || 'New part') + '</h2><p>' + esc(P.KINDS[f.kind] || f.kind) + (f.manufacturer ? ' · ' + esc(f.manufacturer) : '') + ' · <span id="pk-ed-stats">' + stats() + '</span></p></div>' +
        '<div class="seg" role="tablist">' + [['identity', 'Identity'], ['pins', 'Pins'], ['params', 'Parameters'], ['json', 'JSON']].map(([k, l]) => '<button data-tab="' + k + '" class="' + (st.tab === k ? 'on' : '') + '">' + l + (k === 'pins' && mism.length ? ' <span class="dot"></span>' : '') + '</button>').join('') + '</div>' +
        '<button class="icon-btn" data-ed="close" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
        '<div class="sheet-body pk-ed-body">' + body() + '</div>' +
        '<div class="sheet-foot"><button class="btn btn-plain" data-ed="claude">Fill with Claude…</button><button class="btn btn-plain" data-ed="import">Import JSON…</button><button class="btn btn-plain" data-ed="export">Export</button>' +
        (opts.onDelete && !opts.isNew ? '<button class="btn btn-plain pk-danger-link" data-ed="delete">Delete</button>' : '') +
        '<span class="spacer"></span><button class="btn" data-ed="close">Cancel</button><button class="btn btn-primary" data-ed="save">Save</button></div>';
    }

    function body() {
      if (st.tab === 'identity') return identity();
      if (st.tab === 'pins') return pins();
      if (st.tab === 'json') return '<p class="pk-muted">The file as it will be saved. Edit it here, or paste one the Claude skill wrote, then Apply.</p><textarea class="input pk-json" id="pk-ed-json" spellcheck="false">' + esc(L.dump(f)) + '</textarea><div class="pk-btns" style="margin-top:8px"><button class="btn btn-sm" data-ed="apply-json">Apply</button><span class="pk-muted" id="pk-json-msg"></span></div>';
      return params();
    }

    const field = (label, name, val, hint, attrs) => '<div class="field"><label>' + label + '</label><input class="input" data-id="' + name + '" value="' + esc(val) + '"' + (attrs || '') + '>' + (hint ? '<div class="pk-note">' + hint + '</div>' : '') + '</div>';
    function identity() {
      return '<div class="pk-ed-grid">' +
        field('Part number', 'mpn', f.mpn) +
        '<div class="field"><label>Kind</label><select class="input" data-id="kind">' + Object.entries(P.KINDS).map(([k, l]) => '<option value="' + k + '"' + (f.kind === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select><div class="pk-note">Sets which parameters the Parameters tab offers.</div></div>' +
        field('Also matches', 'match', f.match.join(', '), 'Other part numbers this file covers, comma separated. * and ? are wildcards: STM32G071K?U6*') +
        field('Manufacturer', 'manufacturer', f.manufacturer) +
        field('Package', 'package', f.package) +
        field('Supply domains', 'domains', f.domains.join(', '), 'Supply pin groups that have their own limits: VDD, VDDA, VBAT…') +
        '</div>' + field('Description', 'description', f.description) +
        '<div class="pk-ed-grid">' + field('Datasheet title', 'ds.title', f.datasheet.title) + field('Datasheet revision', 'ds.rev', f.datasheet.rev, 'e.g. "Rev 4, 2024-03" or "DS12232 Rev 3"') + '</div>' +
        field('Datasheet link', 'ds.url', f.datasheet.url) +
        '<p class="pk-muted">Made ' + esc((f.made && f.made.how) || '') + (f.made && f.made.by ? ' by ' + esc(f.made.by) : '') + (f.made && f.made.at ? ', ' + esc(f.made.at.slice(0, 10)) : '') + '. File id <span class="pk-mono">' + esc(f.id) + '</span>.</p>';
    }

    function pins() {
      const q = st.pinFilter.trim().toUpperCase();
      const domOpts = sel => '<option value=""></option>' + f.domains.map(d => '<option' + (d === sel ? ' selected' : '') + '>' + esc(d) + '</option>').join('');
      const rows = f.pins.map((p, i) => [p, i]).filter(([p]) => !q || (p.num + ' ' + p.name + ' ' + (p.role || '') + ' ' + (p.functions || []).join(' ')).toUpperCase().includes(q));
      const bad = new Map(mism.map(m => [String(m.num), m]));
      return (mism.length ? '<div class="hint pk-warnbox"><b>▲ Pins differ from the schematic symbol (' + mism.length + ')</b>' + mism.slice(0, 8).map(m => 'Pin ' + esc(m.num) + ': schematic ' + (m.sch == null ? '(none)' : '“' + esc(m.sch) + '”') + ', file ' + (m.file == null ? '(none)' : '“' + esc(m.file) + '”')).join('<br>') + (mism.length > 8 ? '<br>…and ' + (mism.length - 8) + ' more' : '') + '</div>' : '') +
        '<div class="pk-ed-tools"><input class="input" data-id="pin-filter" placeholder="Filter pins (number, name, role, or function)" value="' + esc(st.pinFilter) + '"><span class="pk-muted">' + rows.length + ' of ' + f.pins.length + '</span><button class="btn btn-sm" data-ed="add-pin">Add pin</button></div>' +
        '<div class="pk-scroll"><table class="table pk-pins"><thead><tr><th>Pin</th><th>Name</th><th>Role</th><th>Domain</th><th title="5 V tolerant">5 V tol.</th><th>Functions (alternate functions, EXTI, ADC…)</th><th>At reset</th><th>If unused</th><th title="An external part the datasheet requires on this pin">Needs</th><th title="Voltage limits of this pin alone, where they differ from its domain: recommended maximum, then absolute maximum (numbers or expressions like VDD+0.3)">Max V (rec. / abs.)</th><th></th></tr></thead><tbody>' +
        rows.map(([p, i]) => '<tr data-pin="' + i + '"' + (bad.has(String(p.num)) ? ' class="pk-mism"' : '') + '><td><input class="input pk-in-num" data-pf="num" value="' + esc(p.num) + '"></td><td><input class="input" data-pf="name" value="' + esc(p.name) + '"></td>' +
          '<td><select class="input" data-pf="role">' + Object.entries(P.ROLES).map(([k, l]) => '<option value="' + k + '"' + (p.role === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>' +
          '<td><select class="input" data-pf="domain">' + domOpts(p.domain) + '</select></td>' +
          '<td class="pk-c"><input type="checkbox" data-pf="ft"' + (p.ft ? ' checked' : '') + '></td>' +
          '<td><input class="input" data-pf="functions" value="' + esc((p.functions || []).join(', ')) + '"' + (['io', 'input', 'output', 'open-drain', 'analog'].includes(p.role) ? ' placeholder="USART2_TX AF1, EXTI9"' : '') + '></td>' +
          '<td><select class="input" data-pf="reset">' + Object.entries(P.RESET_STATES).map(([k, l]) => '<option value="' + k + '"' + ((p.reset || '') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>' +
          '<td><select class="input" data-pf="unused">' + Object.entries(P.UNUSED).map(([k, l]) => '<option value="' + k + '"' + ((p.unused || '') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td>' +
          '<td><input class="input pk-in-ext" data-pf="ext" value="' + esc(p.ext || '') + '" placeholder="' + (p.role === 'power-out' || p.role === 'power-in' ? '4.7 µF to GND' : '') + '"></td>' +
          '<td class="pk-vmax"><input class="input" data-pf="vmax" value="' + esc(p.vmax == null ? '' : p.vmax) + '" placeholder="rec."><input class="input" data-pf="absmax" value="' + esc(p.absmax == null ? '' : p.absmax) + '" placeholder="abs."></td>' +
          '<td><button class="icon-btn" data-ed="del-pin" title="Remove this pin" aria-label="Remove pin">×</button></td></tr>').join('') +
        '</tbody></table></div>';
    }

    function params() {
      const cat = P.forKind(f.kind);
      const groups = [...new Set(cat.map(c => c.group))];
      const doms = f.domains.length ? f.domains : [''];
      const row = (c, on) => {
        const v = valueOf(c.k, on) || {};
        if (st.onlyFilled && !['min', 'typ', 'max', 'value', 'text', 'list'].some(x => v[x] != null)) return '';
        const inp = (fld, ph) => '<input class="input pk-v" data-k="' + c.k + '" data-on="' + esc(on) + '" data-f="' + fld + '" value="' + esc(v[fld] == null ? '' : (typeof v[fld] === 'number' ? P.fmt(v[fld], c.unit) : v[fld])) + '" placeholder="' + ph + '">';
        let vals;
        if (c.shape === 'range') vals = inp('min', 'min') + inp('typ', 'typ') + inp('max', 'max');
        else if (c.shape === 'value') vals = inp('value', 'value');
        else if (c.shape === 'list') vals = '<textarea class="input pk-v pk-list" rows="2" data-k="' + c.k + '" data-on="' + esc(on) + '" data-f="list" placeholder="one per line">' + esc((v.list || []).join('\n')) + '</textarea>';
        else vals = '<input class="input pk-v pk-text" data-k="' + c.k + '" data-on="' + esc(on) + '" data-f="text" value="' + esc(v.text || '') + '">';
        const filled = ['min', 'typ', 'max', 'value', 'text', 'list'].some(x => v[x] != null);
        return '<tr class="' + (filled ? 'pk-filled' : '') + '"><td><div class="pk-plabel">' + esc(c.label) + (on ? ' <span class="chip">' + esc(on) + '</span>' : '') + '</div><div class="pk-pkey">' + c.k + (c.hint ? ' · ' + esc(c.hint) : '') + '</div>' + (v.note ? '<div class="pk-vnote">' + esc(v.note) + '</div>' : '') + '</td>' +
          '<td class="pk-vals pk-shape-' + c.shape + '">' + vals + '</td><td class="pk-unit">' + esc(c.unit) + '</td>' +
          '<td><input class="input pk-page" data-k="' + c.k + '" data-on="' + esc(on) + '" data-f="page" value="' + esc(v.page == null ? '' : v.page) + '" placeholder="p."></td>' +
          '<td><input class="input pk-cond" data-k="' + c.k + '" data-on="' + esc(on) + '" data-f="cond" value="' + esc(v.cond || '') + '" placeholder="conditions"></td>' +
          '<td class="pk-c">' + (filled ? '<label class="pk-ok" title="' + esc(v.ok ? 'Verified by ' + v.ok.by + ', ' + (v.ok.at || '').slice(0, 10) : 'Checked against the datasheet? Tick to sign it') + '"><input type="checkbox" data-ok="' + c.k + '" data-on="' + esc(on) + '"' + (v.ok ? ' checked' : '') + '> ' + (v.ok ? '✓' : '') + '</label><div class="pk-src">' + esc(v.src || '') + '</div>' : '') + '</td></tr>';
      };
      const other = f.values.filter(v => !P.byKey.has(v.k));
      return '<div class="pk-ed-tools"><label class="pk-check"><input type="checkbox" data-id="only-filled"' + (st.onlyFilled ? ' checked' : '') + '> Only filled</label>' +
        '<span class="pk-muted">Numbers take SI prefixes (100n, 4.7u, 3V3). Limits may be expressions of a domain: VDD+0.3, 0.7*VDD. Editing a value clears its verification.</span></div>' +
        groups.map(g => {
          const rows = cat.filter(c => c.group === g).map(c => c.on === 'domain' ? doms.map(d => row(c, d)).join('') : row(c, '')).join('');
          return rows ? '<h3 class="pk-ed-group">' + esc(g) + '</h3><div class="pk-scroll"><table class="table pk-params"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Page</th><th>Conditions</th><th>Verified</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '';
        }).join('') +
        (other.length ? '<h3 class="pk-ed-group">Other values in the file (not checked)</h3><ul class="pk-other">' + other.map(v => '<li><span class="pk-mono">' + esc(v.k) + '</span>' + (v.on ? ' (' + esc(v.on) + ')' : '') + ': ' + esc([v.min, v.typ, v.max, v.value, v.text].filter(x => x != null).join(' / ') || (v.list || []).join('; ')) + ' ' + esc(v.unit || '') + '</li>').join('') + '</ul>' : '');
    }

    function refreshStats() { const s = sheet.querySelector('#pk-ed-stats'); if (s) s.textContent = stats(); }

    sheet.addEventListener('click', e => {
      const t = e.target.closest('[data-tab],[data-ed]');
      if (!t) return;
      if (t.dataset.tab) { st.tab = t.dataset.tab; render(); return; }
      const a = t.dataset.ed;
      if (a === 'close') close();
      else if (a === 'save') {
        const errs = L.validate(f);
        if (errs.length) { alert('Not saved:\n\n' + errs.slice(0, 12).join('\n')); return; }
        f.id = f.id || L.slug(f.mpn);
        st.dirty = false; close(true); opts.onSave(f);
      } else if (a === 'add-pin') { f.pins.push({ num: '', name: '', role: 'other' }); st.dirty = true; render(); }
      else if (a === 'del-pin') { f.pins.splice(+t.closest('tr').dataset.pin, 1); st.dirty = true; render(); }
      else if (a === 'export') { const b = new Blob([L.dump(f)], { type: 'application/json' }); const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = (f.id || 'part') + '.json'; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1500); }
      else if (a === 'import') pickJson(text => applyJson(text, true));
      else if (a === 'apply-json') applyJson(sheet.querySelector('#pk-ed-json').value, false);
      else if (a === 'claude') claudeHelp();
      else if (a === 'delete') { if (confirm('Delete ' + f.mpn + ' from the library' + (f.local && f.local.sha ? ' and from pincheck_data' : '') + '?')) { close(true); opts.onDelete(opts.file); } }
    });

    function applyJson(text, merge) {
      let g;
      try { g = JSON.parse(text); } catch (e) { msg('Not JSON: ' + e.message); return; }
      const errs = L.validate(g);
      if (errs.length) { msg(errs.slice(0, 6).join('; ')); if (!merge) return; if (!confirm('That file has problems:\n\n' + errs.slice(0, 8).join('\n') + '\n\nUse it anyway?')) return; }
      const keep = { id: f.id, local: f.local };
      for (const k of Object.keys(f)) delete f[k];
      Object.assign(f, g, keep.id ? { id: keep.id } : {}, { local: keep.local });
      f.values = f.values || []; f.pins = f.pins || []; f.domains = f.domains || []; f.match = f.match || []; f.datasheet = f.datasheet || {};
      st.dirty = true; mism.splice(0, mism.length, ...(opts.part ? L.pinCheck(f, opts.part) : []));
      render(); if (window.PK.toast) PK.toast('Loaded ' + (g.mpn || 'the file') + ': ' + L.stats(f).values + ' values. Check them, then Save.');
    }
    function msg(s) { const m = sheet.querySelector('#pk-json-msg'); if (m) m.textContent = s; else alert(s); }

    function claudeHelp() {
      const w = document.createElement('div');
      w.className = 'sheet-wrap';
      const cmd = '/pincheck-part ' + (f.mpn || '<part number>') + ' "<path to datasheet.pdf>"';
      w.innerHTML = '<div class="sheet wide"><div class="sheet-head"><h2>Fill this part with Claude</h2><p>The datasheet stays on your computer; only Claude Code reads it.</p></div><div class="sheet-body">' +
        '<ol class="pk-steps"><li>Export this file (it holds the pins from your schematic): <button class="btn btn-sm" data-c="export">Export ' + esc(f.id) + '.json</button></li>' +
        '<li>In Claude Code, started in the Dovetail tools folder, run:<pre class="pk-pre">' + esc(cmd) + '</pre>Give it the exported file too, so it keeps your pins. It reads the datasheet and writes every parameter it finds, each with its page, all unverified.</li>' +
        '<li>Back here, <b>Import JSON…</b> the file it wrote, check the values against the pages, tick Verified, and Save.</li></ol>' +
        '<p class="pk-muted">For STM32 parts the skill also reads STM32CubeMX\'s database on this computer for pins and alternate functions.</p></div>' +
        '<div class="sheet-foot"><button class="btn btn-primary" data-c="close">Done</button></div></div>';
      document.body.appendChild(w);
      w.addEventListener('click', e => {
        if (e.target === w || (e.target.dataset && e.target.dataset.c === 'close')) w.remove();
        else if (e.target.dataset && e.target.dataset.c === 'export') sheet.querySelector('[data-ed="export"]').click();
      });
    }

    sheet.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.id === 'pin-filter') { st.pinFilter = t.value; const pos = t.selectionStart; render(); const n = sheet.querySelector('[data-id="pin-filter"]'); n.focus(); n.setSelectionRange(pos, pos); return; }
      if (t.dataset.id) {
        const id = t.dataset.id;
        if (id === 'match') f.match = t.value.split(',').map(s => s.trim()).filter(Boolean);
        else if (id === 'domains') f.domains = t.value.split(',').map(s => s.trim()).filter(Boolean);
        else if (id.startsWith('ds.')) f.datasheet[id.slice(3)] = t.value.trim();
        else if (id !== 'only-filled' && id !== 'kind') f[id] = t.value.trim();
        st.dirty = true; return;
      }
      if (t.dataset.pf) {
        const p = f.pins[+t.closest('tr').dataset.pin];
        if (t.dataset.pf === 'functions') p.functions = t.value.split(',').map(s => s.trim()).filter(Boolean);
        else if (t.dataset.pf === 'ft') { if (t.checked) p.ft = true; else delete p.ft; }
        else if (['domain', 'reset', 'unused', 'ext'].includes(t.dataset.pf)) { if (t.value.trim()) p[t.dataset.pf] = t.value.trim(); else delete p[t.dataset.pf]; }
        else if (t.dataset.pf === 'vmax' || t.dataset.pf === 'absmax') { const v = t.value.trim(), n = P.parseNum(v, 'V'); if (!v) delete p[t.dataset.pf]; else p[t.dataset.pf] = n != null ? n : v; }
        else p[t.dataset.pf] = t.value;
        st.dirty = true; return;
      }
      if (t.dataset.k && t.dataset.f) { setValue(t.dataset.k, t.dataset.on, t.dataset.f, t.value); refreshStats(); }
    });
    sheet.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.id === 'kind') { f.kind = t.value; st.dirty = true; render(); }
      else if (t.dataset.id === 'only-filled') { st.onlyFilled = t.checked; render(); }
      else if (t.dataset.ok) {
        const v = valueOf(t.dataset.ok, t.dataset.on);
        if (!v) return;
        if (t.checked) v.ok = { by: (opts.who && opts.who()) || 'someone', at: now() }; else delete v.ok;
        st.dirty = true; render();
      } else if (t.dataset.k && t.dataset.f) render(); // show the value as it was read ("100n" → "100 n")
    });

    render();
  }

  function pickJson(cb) {
    const i = document.getElementById('json-input');
    i.value = '';
    i.onchange = async () => { for (const file of i.files) cb(await file.text(), file.name); };
    i.click();
  }

  PK.editor = { open, pickJson };
})(window.PK = window.PK || {});
