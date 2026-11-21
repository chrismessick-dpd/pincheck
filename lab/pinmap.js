// Pin planner lab (docs/pin-planner.md). The planner (ee_design_review/assets/pinmap.js) and the pin map
// (ee_design_review/assets/pinview.js) are Signoff's engine files, the same ones Scribe EE's MCU block uses; this
// page only supplies a part and a list of connections, and keeps the picks in memory.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pinmap.lab.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pinmap.lab.' + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
  };
  const P = window.SignoffPinmap;

  // One Scribe connection per line, "Block (label)".
  function parseConnects(text) {
    const out = [];
    text.split(/\r?\n/).forEach((line, i) => {
      line = line.replace(/^\s*(Connects:|[-*])\s*/i, '').trim();
      if (!line) return;
      const m = /^(.*?)\s*\((.*)\)\s*$/.exec(line);
      out.push({ id: 'l' + i, line: i, block: m ? m[1] : line, label: m ? m[2] : '' });
    });
    return out;
  }

  const S = { raw: null, part: null, text: '', map: {}, types: {}, result: null, real: false, view: null };
  function setPart(raw, real) { S.raw = raw; S.part = P.part(raw); S.real = real; S.map = {}; S.types = {}; replan(true); }
  function replan(fresh) {
    S.result = P.plan(S.part, parseConnects(S.text), S.map, S.types);
    $('#pm-part').innerHTML = `<div class="pm-part-name">${esc(S.part.meta.mpn)}</div><div class="pm-part-sub">${esc(S.part.meta.manufacturer || '')} · ${esc(S.part.meta.package || '')} · ${S.part.pads.length} pins${S.real ? ' · <b>opened from disk</b>' : ''}</div>`;
    if (S.view && !fresh) { S.view.update({ part: S.part, result: S.result, map: S.map }); return; }
    if (S.view) S.view.destroy();
    S.view = window.SignoffPinView.mount($('#pm-root'), {
      part: S.part, result: S.result, map: S.map, view: store.get('view', 'package'),
      onView: (v) => store.set('view', v),
      onPick: (pad, fn, req, gpio) => { S.map = P.pick(S.map, S.result, S.part, pad, fn, req, gpio); replan(); },
      onUnpick: (pad) => { S.map = P.unpick(S.map, pad); replan(); },
      onClear: (reqId) => { S.map = Object.fromEntries(Object.entries(S.map).filter(([, l]) => l.req !== reqId)); replan(); },
      onType: (reqId, keys, val) => {
        keys.forEach((k) => { if (val) S.types[k] = val; else delete S.types[k]; });
        S.map = Object.fromEntries(Object.entries(S.map).filter(([, l]) => l.req !== reqId)); replan();
      },
      onFix: (reqId) => {
        const r = S.result.reqs.find((q) => q.id === reqId), lines = S.text.split(/\r?\n/), ln = r.users[0].conn.line;
        lines[ln] = lines[ln].replace(r.fix.from, r.fix.to);
        S.text = lines.join('\n'); $('#pm-text').value = S.text; replan();
      },
    });
  }

  function readFile(file, what) {
    if (!file) return;
    file.text().then((t) => {
      if (what === 'part') {
        let j; try { j = JSON.parse(t); } catch (e) { alert('That file isn’t JSON.'); return; }
        if (!Array.isArray(j.pins)) { alert('That isn’t a Pincheck part file (no pins).'); return; }
        setPart(j, true);
      } else { S.text = t.replace(/\r\n/g, '\n').trim(); $('#pm-text').value = S.text; replan(); $('#pm-edit').open = true; }
    });
  }

  $('#pm-apply').addEventListener('click', () => { S.text = $('#pm-text').value; replan(); });
  $('#pm-clear').addEventListener('click', () => { S.map = {}; S.types = {}; replan(); });
  $('#pm-demo').addEventListener('click', () => { S.text = window.PM_DEMO.connects; $('#pm-text').value = S.text; setPart(window.PM_DEMO.part, false); });
  $('#pm-part-file').addEventListener('change', (e) => readFile(e.target.files[0], 'part'));
  $('#pm-conn-file').addEventListener('change', (e) => readFile(e.target.files[0], 'conns'));
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); [...e.dataTransfer.files].forEach((f) => readFile(f, /\.json$/i.test(f.name) ? 'part' : 'conns')); });
  $('#pm-theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', document.documentElement.dataset.theme);
  });

  const th = store.get('theme', null);
  if (th) document.documentElement.dataset.theme = th;
  S.text = window.PM_DEMO.connects;
  $('#pm-text').value = S.text;
  setPart(window.PM_DEMO.part, false);
  window.PM = { S, P, replan };   // for the console
})();
