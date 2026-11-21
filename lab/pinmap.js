// Pin planner lab (docs/pin-planner.md). One planner, five views. The planner works only on the part
// file's generic function strings ("I2C1_SCL AF6", "ADC1_IN5", "USB_DM"), so nothing here is ST-specific.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pinmap.lab.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pinmap.lab.' + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
  };

  // ---------- The part ----------

  const FIXED = new Set(['power-in', 'power-out', 'ground', 'nc', 'dnc', 'pad']);

  function parseFn(s, gpio) {
    const m = /^([A-Z][A-Z0-9]*?)(\d*)_(.+?)(?:\s+AF(\d+))?$/.exec(s.trim());
    if (!m) return null;                                       // EXTI0 and the like: properties of the GPIO
    return { full: s.trim().replace(/\s+AF\d+$/, ''), fam: m[1], inst: m[1] + m[2], sig: m[3], af: m[4] == null ? null : +m[4], gpio };
  }
  const baseName = (n) => String(n).split(/[-\s[]/)[0];        // "PA14-BOOT0" → PA14, "PA11 [PA9]" → PA11
  const portOf = (n) => { const m = /^P([A-Z])(\d+)$/.exec(baseName(n)); return m ? { port: m[1], bit: +m[2] } : null; };

  function loadPart(part) {
    const pads = (part.pins || []).map((p) => {
      const names = [baseName(p.name)].concat((p.bond || []).map((b) => baseName(b.name)));
      const fns = [];
      (p.functions || []).forEach((f) => { const x = parseFn(f, names[0]); if (x) fns.push(x); });
      (p.bond || []).forEach((b) => (b.functions || []).forEach((f) => { const x = parseFn(f, baseName(b.name)); if (x) fns.push(x); }));
      const also = (p.name.split('-').slice(1).join('-') || '').replace(/\s*\(.*$/, '');
      return { num: p.num, name: p.name, names, role: p.role || 'io', fns, also, bonded: names.length > 1,
        gpio: !FIXED.has(p.role) && !!portOf(names[0]) };
    });
    const insts = new Set(part.peripherals || []);
    pads.forEach((p) => p.fns.forEach((f) => insts.add(f.inst)));
    const byName = {};
    pads.forEach((p) => p.names.forEach((n) => { byName[n] = p; }));
    return { meta: part, pads, insts: [...insts].sort(natCmp), byName, byNum: Object.fromEntries(pads.map((p) => [p.num, p])) };
  }
  function natCmp(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }

  // ---------- Reading a connection label ----------

  const TYPES = {
    I2C: { fams: ['I2C'], sigs: ['SCL', 'SDA'], bus: true, words: ['i2c', 'iic', 'smbus', 'twi'] },
    SPI: { fams: ['SPI'], sigs: ['SCK', 'MOSI', 'MISO'], bus: true, words: ['spi'] },
    UART: { fams: ['USART', 'UART', 'LPUART'], sigs: ['TX', 'RX'], bus: true, words: ['uart', 'usart', 'lpuart', 'serial'] },
    USB: { fams: ['USB'], sigs: ['DM', 'DP'], bus: true, words: ['usb'] },
    CAN: { fams: ['FDCAN', 'CAN'], sigs: ['RX', 'TX'], bus: true, words: ['can', 'fdcan'] },
    SWD: { fams: ['SYS'], sigs: ['SWDIO', 'SWCLK'], bus: true, words: ['swd'] },
    I2S: { fams: ['I2S'], sigs: ['CK', 'SD', 'WS'], bus: true, words: ['i2s'] },
    ADC: { fams: ['ADC'], pat: /^IN\d+$/, words: ['adc', 'analog'], one: 'channel' },
    DAC: { fams: ['DAC'], pat: /^OUT\d+$/, words: ['dac'], one: 'output' },
    TIM: { fams: ['TIM', 'LPTIM'], pat: /^CH\d+$/, words: ['pwm', 'tim', 'timer'], one: 'channel' },
    TSC: { fams: ['TSC'], pat: /^G\d+_IO\d+$/, words: ['touch', 'tsc', 'capsense'], one: 'touch channel' },
    PINS: { words: [] },
    GPIO: { words: ['gpio', 'drive', 'io', 'digital', 'led', 'relay', 'enable', 'irq', 'interrupt', 'input', 'output'] },
  };
  const INST_RE = /\b(I2C|SPI|LPUART|USART|UART|DAC|ADC|LPTIM|TIM|FDCAN|CAN|I2S)(\d+)\b/i;

  function parseLabel(raw) {
    const parts = raw.split(',').map((s) => s.trim());
    let main = parts.shift() || '';
    const dir = parts.find((p) => /^(in|out|both ways)$/i.test(p)) || 'out';
    const items = [];
    const pinRe = /\bP([A-Z])(\d+)\s*[–—-]\s*P?([A-Z])?(\d+)\b|\bP[A-Z]\d+\b/g;
    const pins = [];
    let m;
    while ((m = pinRe.exec(main))) {
      if (m[2] != null) { const port = m[1]; for (let b = +m[2]; b <= +m[4]; b++) pins.push('P' + port + b); }
      else pins.push(m[0]);
    }
    if (pins.length) return { dir, items: [{ type: 'PINS', pins, text: main }] };
    main.split('+').forEach((chunk) => {
      chunk = chunk.trim();
      const cm = /^(\d+)\s*[x×]?\s+(.*)$/.exec(chunk);
      const count = cm ? +cm[1] : 1;
      const body = cm ? cm[2] : chunk;
      const im = INST_RE.exec(body);
      const words = body.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      let type = null;
      if (im) type = Object.keys(TYPES).find((t) => (TYPES[t].fams || []).some((f) => f === im[1].toUpperCase()) || (t === 'UART' && /UART/i.test(im[1])));
      if (!type) type = Object.keys(TYPES).find((t) => TYPES[t].words.some((w) => words.includes(w)));
      const known = new Set([].concat(...Object.values(TYPES).map((t) => t.words)));
      const sm = /\b(OUT|CH|IN)(\d+)\b/i.exec(body);
      const extra = words.filter((w) => !known.has(w) && !(im && w === im[0].toLowerCase()) && !(sm && w === sm[0].toLowerCase()) && !/^\d+$/.test(w));
      items.push({ type: type || 'GPIO', guessed: !type, inst: im ? im[1].toUpperCase().replace(/^UART$/, 'USART') + im[2] : null,
        reqInst: im ? im[0].toUpperCase() : null, sig: sm ? sm[1].toUpperCase() + sm[2] : null, count, extra, text: chunk });
    });
    return { dir, items };
  }

  function parseConnects(text) {
    const out = [];
    text.split(/\r?\n/).forEach((line, i) => {
      line = line.replace(/^\s*(Connects:|[-*])\s*/i, '').trim();
      if (!line) return;
      const m = /^(.*?)\s*\((.*)\)\s*$/.exec(line);
      if (!m) { out.push({ line: i, block: line, label: '', parsed: { dir: 'out', items: [{ type: 'GPIO', guessed: true, count: 1, extra: [], text: '' }] } }); return; }
      out.push({ line: i, block: m[1], label: m[2], parsed: parseLabel(m[2]) });
    });
    return out;
  }

  // Requirements: one per interface a label asks for; a bus label on several blocks is one requirement.
  function requirements(conns) {
    const reqs = [];
    const byKey = {};
    conns.forEach((c, ci) => c.parsed.items.forEach((it, ii) => {
      const T = TYPES[it.type] || {};
      const key = T.bus ? it.type + '|' + (it.inst || it.text.toLowerCase()) : null;
      if (key && byKey[key]) { byKey[key].users.push({ block: c.block, ci }); return; }
      const r = { id: 'r' + ci + '.' + ii, key, type: it.type, item: it, label: c.label, dir: c.parsed.dir,
        users: [{ block: c.block, ci }], line: c.line, slots: [], problems: [], notes: [], inst: null, fix: null };
      if (key) byKey[key] = r;
      reqs.push(r);
    }));
    return reqs;
  }

  // ---------- Placing ----------

  function plan(part, conns, locks) {
    const reqs = requirements(conns);
    const used = {};                     // pad num → { req, sig, fn }
    const claimed = {};                  // instance → req (buses)
    const take = (pad, req, sig, fn, lock) => { used[pad.num] = { req, sig, fn, lock: !!lock }; req.slots.push({ pad: pad.num, sig, fn, gpio: fn ? fn.gpio : pad.names[0], lock: !!lock }); };

    // Checks against the part before placing.
    reqs.forEach((r) => {
      const T = TYPES[r.type];
      if (r.item.guessed) r.notes.push({ sev: 'warn', text: `“${r.item.text}” names no interface; planned as ${r.item.count > 1 ? r.item.count + ' GPIOs' : 'one GPIO'}.` });
      if (r.item.extra && r.item.extra.length && !r.item.guessed) r.notes.push({ sev: 'info', text: `Read past: ${r.item.extra.join(' ')}.` });
      if (r.users.length > 1) r.notes.push({ sev: 'info', text: `One bus for ${r.users.length} blocks.` });
      if (!T || !T.fams) return;
      const have = part.insts.filter((i) => T.fams.includes(i.replace(/\d+$/, '')));
      if (!have.length) {
        r.problems.push(`This part has no ${r.type === 'TSC' ? 'touch controller (TSC)' : r.type}.`);
        r.dead = true; return;
      }
      if (r.item.inst && !have.includes(r.item.inst)) {
        r.dead = true;
        const n = +r.item.inst.replace(/^\D+/, '');
        const one = have[0];
        const chans = T.pat ? [...new Set(part.pads.flatMap((p) => p.fns.filter((f) => f.inst === one && T.pat.test(f.sig)).map((f) => f.sig)))].sort(natCmp) : [];
        if (T.pat && have.length === 1 && chans[n - 1]) {
          r.problems.push(`No ${r.item.inst} on this part. It has one ${r.type}, ${one}, with ${chans.join(' and ')}: did you mean ${one}_${chans[n - 1]}?`);
          r.fix = { from: r.item.reqInst, to: one + ' ' + chans[n - 1] };
        } else r.problems.push(`No ${r.item.inst} on this part. It has ${have.join(', ')}.`);
      }
    });

    // Locks first (the person's picks), then explicit pins, then the most constrained.
    Object.entries(locks).forEach(([num, l]) => {
      const pad = part.byNum[num]; if (!pad) return;
      const r = reqs.find((q) => q.id === l.req) || null;
      const fn = l.fn ? pad.fns.find((f) => f.full === l.fn) : null;
      if (r && !r.dead) { take(pad, r, l.sig, fn, true); if (fn && TYPES[r.type].bus) { r.inst = fn.inst; claimed[fn.inst] = r; } }
      else used[num] = { req: null, sig: l.fn || 'GPIO', fn, lock: true, stray: true };
    });

    const order = reqs.filter((r) => !r.dead).map((r) => ({ r, n: r.type === 'PINS' ? -1 : r.slots.length ? 0 : options(part, r) })).sort((a, b) => a.n - b.n).map((x) => x.r);
    order.forEach((r) => place(part, r, used, claimed, take));
    const stray = Object.entries(used).filter(([, u]) => u.stray).map(([num, u]) => ({ num, fn: u.sig }));
    return { reqs, used, stray };
  }

  function options(part, r) {
    const T = TYPES[r.type];
    if (r.type === 'GPIO') return 500;
    return part.pads.reduce((n, p) => n + p.fns.filter((f) => T.fams.includes(f.fam) && (!r.item.inst || f.inst === r.item.inst) && (!r.item.sig || f.sig === r.item.sig)).length, 0);
  }
  const free = (used, pad, r) => !used[pad.num] || used[pad.num].req === r;
  const cost = (p) => p.fns.length + (p.bonded ? 3 : 0);

  function place(part, r, used, claimed, take) {
    const T = TYPES[r.type];
    if (r.type === 'PINS') {
      r.item.pins.forEach((n) => {
        const pad = part.byName[n];
        if (!pad) { r.problems.push(`${n} isn't bonded in ${part.meta.package || 'this package'}.`); return; }
        const u = used[pad.num];
        if (u && u.req !== r) { r.problems.push(`${n} is taken by ${who(u)}.`); return; }
        if (!u) take(pad, r, n, null);
        if (pad.also) r.notes.push({ sev: 'info', text: `${n} is also ${pad.also}.` });
      });
      return;
    }
    if (r.type === 'GPIO') {
      const need = r.item.count - r.slots.length;
      const pads = part.pads.filter((p) => p.gpio && p.role === 'io' && !used[p.num]).sort((a, b) => cost(a) - cost(b) || natCmp(a.num, b.num));
      pads.slice(0, need).forEach((p) => take(p, r, 'GPIO', null));
      if (pads.length < need) r.problems.push(`Only ${pads.length} free GPIO left for ${need}.`);
      return;
    }
    if (T.bus) {
      const locked = r.inst;
      const insts = part.insts.filter((i) => T.fams.includes(i.replace(/\d+$/, '')) && (!r.item.inst || i === r.item.inst) && (!locked || i === locked) && (!claimed[i] || claimed[i] === r))
        .sort((a, b) => T.fams.indexOf(a.replace(/\d+$/, '')) - T.fams.indexOf(b.replace(/\d+$/, '')) || natCmp(a, b));
      for (const inst of insts) {
        const have = Object.fromEntries(r.slots.map((s) => [s.sig, s]));
        const pick = {};
        const sigs = T.sigs.filter((s) => !have[s]);
        const cands = sigs.map((s) => part.pads.filter((p) => free(used, p, r) && !have[s] && p.fns.some((f) => f.inst === inst && f.sig === s)).sort((a, b) => cost(a) - cost(b)));
        const go = (k, taken) => {
          if (k === sigs.length) return true;
          for (const p of cands[k]) { if (taken.has(p.num)) continue; pick[sigs[k]] = p; taken.add(p.num); if (go(k + 1, taken)) return true; taken.delete(p.num); }
          return false;
        };
        if (go(0, new Set(r.slots.map((s) => s.pad)))) {
          sigs.forEach((s) => { const p = pick[s]; take(p, r, s, p.fns.find((f) => f.inst === inst && f.sig === s)); });
          r.inst = inst; claimed[inst] = r; return;
        }
      }
      // Say why: which pads it could have used, and who holds them.
      const all = part.insts.filter((i) => T.fams.includes(i.replace(/\d+$/, '')) && (!r.item.inst || i === r.item.inst));
      const held = all.filter((i) => claimed[i] && claimed[i] !== r).map((i) => `${i} (${claimed[i].users[0].block})`);
      const blockers = new Set();
      part.pads.forEach((p) => p.fns.forEach((f) => { if (all.includes(f.inst) && T.sigs.includes(f.sig) && used[p.num] && used[p.num].req !== r) blockers.add(`${p.names[0]} (${who(used[p.num])})`); }));
      r.problems.push(`No room for ${r.item.inst || r.type}.` + (held.length ? ` In use: ${held.join(', ')}.` : '') + (blockers.size ? ` Its pads are taken: ${[...blockers].slice(0, 5).join(', ')}.` : ''));
      return;
    }
    // Channels (ADC, DAC, timer, touch): any instance, distinct pads.
    const need = r.item.count - r.slots.length;
    const ok = (f) => T.fams.includes(f.fam) && T.pat.test(f.sig) && (!r.item.inst || f.inst === r.item.inst) && (!r.item.sig || f.sig === r.item.sig);
    const pads = part.pads.filter((p) => !used[p.num] && p.fns.some(ok)).sort((a, b) => cost(a) - cost(b));
    pads.slice(0, need).forEach((p) => { const f = p.fns.find(ok); take(p, r, f.sig, f); });
    if (pads.length < need) r.problems.push(`Only ${pads.length} free ${r.type} ${T.one}${pads.length === 1 ? '' : 's'} for ${need}.`);
  }
  const who = (u) => (u.req ? u.req.users[0].block : 'a pick of yours');

  // Which pads could serve a requirement (for the candidate rings), and with which function.
  function candidates(part, r, used) {
    const out = {};
    if (!r || r.dead) return out;
    const T = TYPES[r.type];
    part.pads.forEach((p) => {
      const taken = !!(used[p.num] && used[p.num].req !== r);
      if (r.type === 'PINS') { if (r.item.pins.some((n) => p.names.includes(n))) out[p.num] = { f: null, taken }; return; }
      if (r.type === 'GPIO') { if (p.gpio && !taken) out[p.num] = { f: null, taken }; return; }
      const f = p.fns.find((x) => T.fams.includes(x.fam) && (!r.item.inst || x.inst === r.item.inst) && (T.bus ? T.sigs.includes(x.sig) : T.pat.test(x.sig) && (!r.item.sig || x.sig === r.item.sig)));
      if (f) out[p.num] = { f, taken };
    });
    return out;
  }

  // ---------- State ----------

  const S = {
    part: null, text: '', view: store.get('view', 'package'), sel: null, locks: {}, result: null, real: false,
  };
  function setPart(raw, real) {
    S.part = loadPart(raw); S.real = real; S.locks = {}; S.sel = null; replan();
  }
  function replan() {
    S.conns = parseConnects(S.text);
    S.result = plan(S.part, S.conns, S.locks);
    if (S.sel && !S.result.reqs.find((r) => r.id === S.sel)) S.sel = null;
    render();
  }
  const selReq = () => (S.result.reqs.find((r) => r.id === S.sel) || null);
  function sevOf(r) { return r.problems.length ? 'issue' : r.notes.some((n) => n.sev === 'warn') ? 'warn' : 'ok'; }
  function padState(num) {
    const pad = S.part.byNum[num];
    const u = S.result.used[num];
    if (u && u.stray) return 'stray';
    if (u) return sevOf(u.req) === 'issue' ? 'issue' : sevOf(u.req) === 'warn' ? 'warn' : 'used';
    if (!pad.gpio || pad.role !== 'io') return pad.fns.length && !FIXED.has(pad.role) ? 'special' : 'fixed';
    return 'free';
  }
  function padLabel(num) {
    const u = S.result.used[num];
    if (!u) { const p = S.part.byNum[num]; return FIXED.has(p.role) || p.role === 'reset' ? '' : ''; }
    if (u.stray) return u.sig;
    if (u.fn) return u.fn.full;
    return u.req.type === 'PINS' ? 'GPIO' : u.req.type === 'GPIO' ? 'GPIO' : u.sig;
  }
  function padFor(num) { const u = S.result.used[num]; return u && u.req ? u.req.users.map((x) => x.block).join(', ') : u && u.stray ? 'not in Scribe' : ''; }

  // ---------- Rendering: the side ----------

  function render() {
    renderSide();
    renderView();
    store.set('view', S.view);
    document.querySelectorAll('#pm-views button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  }

  function renderSide() {
    const m = S.part.meta;
    $('#pm-part').innerHTML = `<div class="pm-part-name">${esc(m.mpn)}</div><div class="pm-part-sub">${esc(m.manufacturer || '')} · ${esc(m.package || '')} · ${S.part.pads.length} pads${S.real ? ' · <b>opened from disk</b>' : ''}</div>`;
    const reqs = S.result.reqs;
    const io = S.part.pads.filter((p) => p.gpio);
    const usedIo = io.filter((p) => S.result.used[p.num]).length;
    const bad = reqs.filter((r) => sevOf(r) === 'issue').length;
    const warn = reqs.filter((r) => sevOf(r) === 'warn').length;
    $('#pm-sum').innerHTML = `<span><b>${usedIo}</b> of ${io.length} I/O pads planned</span>` +
      (bad ? `<span class="pm-tag issue">✕ ${bad} problem${bad === 1 ? '' : 's'}</span>` : '') +
      (warn ? `<span class="pm-tag warn">▲ ${warn} to check</span>` : '') +
      (!bad && !warn ? '<span class="pm-tag ok">✓ All placed</span>' : '');
    const rows = reqs.map((r) => {
      const sev = sevOf(r);
      const mark = sev === 'issue' ? '✕' : sev === 'warn' ? '▲' : '✓';
      const pins = r.slots.slice().sort((a, b) => natCmp(a.sig, b.sig)).map((s) => `<span class="pm-pin${s.lock ? ' lock' : ''}">${esc(s.gpio)}${s.sig && s.sig !== s.gpio && s.sig !== 'GPIO' ? ' <i>' + esc(s.sig) + '</i>' : ''}</span>`).join('');
      const what = r.type === 'PINS' ? 'Pins' : (r.inst || r.item.inst || r.type) + (r.item.count > 1 ? ' × ' + r.item.count : '');
      const blocks = r.users.map((u) => esc(u.block)).join(', ');
      const notes = r.problems.map((t) => `<li class="issue">${esc(t)}</li>`).concat(r.notes.map((n) => `<li class="${n.sev}">${esc(n.text)}</li>`)).join('');
      return `<div class="pm-conn ${sev}${S.sel === r.id ? ' sel' : ''}" data-req="${r.id}" tabindex="0">
        <div class="pm-conn-top"><span class="pm-mark ${sev}">${mark}</span><span class="pm-what">${esc(what)}</span><span class="pm-blocks">${blocks}</span></div>
        <div class="pm-conn-label">“${esc(r.item.text || r.label)}”${r.dir !== 'out' ? ' · ' + esc(r.dir) : ''}</div>
        ${pins ? `<div class="pm-pins">${pins}</div>` : ''}
        ${notes ? `<ul class="pm-notes">${notes}</ul>` : ''}
        ${r.fix ? `<button class="btn btn-plain pm-fix" data-fix="${r.id}">Write it as ${esc(r.fix.to)}</button>` : ''}
      </div>`;
    }).join('');
    const stray = S.result.stray.map((s) => `<div class="pm-conn warn"><div class="pm-conn-top"><span class="pm-mark warn">▲</span><span class="pm-what">${esc(s.fn)}</span><span class="pm-blocks">${esc(S.part.byNum[s.num].names[0])}</span></div><div class="pm-conn-label">Set on the pad, but no connection asks for it: not in Scribe.</div></div>`).join('');
    $('#pm-conns').innerHTML = rows + stray;
  }

  // ---------- Rendering: the views ----------

  const LEGEND = [['used', 'Planned'], ['lock', 'Your pick'], ['cand', 'Could use'], ['taken', 'Could use, taken'], ['issue', 'Problem'], ['warn', 'To check'], ['special', 'Clock or boot'], ['fixed', 'Power and reset'], ['free', 'Free']];
  function renderView() {
    $('#pm-legend').innerHTML = LEGEND.map(([k, t]) => `<span class="pm-lg"><i class="pm-sw ${k}"></i>${t}</span>`).join('');
    const r = selReq();
    S.cand = candidates(S.part, r, S.result.used);
    const v = $('#pm-view');
    v.className = 'pm-view v-' + S.view;
    v.innerHTML = ({ package: viewPackage, block: viewBlock, ports: viewPorts, matrix: viewMatrix, table: viewTable }[S.view] || viewPackage)();
  }
  const isCand = (num) => Object.prototype.hasOwnProperty.call(S.cand, num);
  const isMine = (num) => { const u = S.result.used[num]; return !!(u && u.req && u.req.id === S.sel); };

  const DEFS = `<defs>
    <pattern id="pm-hi" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" class="pm-p-ibg"/><line x1="0" y1="0" x2="0" y2="5" class="pm-p-iln"/></pattern>
    <pattern id="pm-hw" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" class="pm-p-wbg"/><circle cx="2" cy="2" r="0.9" class="pm-p-wdt"/></pattern>
    <symbol id="pm-lock" viewBox="0 0 10 12"><path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="5" width="8" height="6.5" rx="1.2" fill="currentColor"/></symbol>
  </defs>`;

  function padRect(num, x, y, w, h) {
    const st = padState(num);
    const u = S.result.used[num];
    const cls = ['pm-pad', st, isCand(num) ? (S.cand[num].taken ? 'cand taken' : 'cand') : '', isMine(num) ? 'mine' : ''].join(' ');
    const lock = u && u.lock ? `<use href="#pm-lock" x="${x + w / 2 - 4}" y="${y + h / 2 - 5}" width="8" height="10" class="pm-lockg"/>` : '';
    return `<g class="pm-hit" data-pad="${num}"><rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>${lock}<title>${esc(tip(num))}</title></g>`;
  }
  function tip(num) {
    const p = S.part.byNum[num];
    const u = S.result.used[num];
    return `${p.num} · ${p.name}${p.bonded ? ' (pad shared by ' + p.names.join(' and ') + ')' : ''}` + (u ? `\n→ ${padLabel(num)} for ${padFor(num)}` : '') +
      (p.fns.length ? '\n' + p.fns.map((f) => f.full + (f.af != null ? ' AF' + f.af : '') + (p.bonded ? ' [' + f.gpio + ']' : '')).join(', ') : '');
  }

  function layoutKind() {
    const pk = String(S.part.meta.package || '').toUpperCase();
    const n = S.part.pads.length;
    if (/BGA|WLCSP|CSP/.test(pk) || S.part.pads.every((p) => /^[A-Z]+\d+$/.test(p.num))) return 'grid';
    if (/SO|SOP|SSOP|TSSOP|DIP/.test(pk) && !/QFP|QFN/.test(pk)) return 'dual';
    return n % 4 === 0 ? 'quad' : 'dual';
  }

  function viewPackage() {
    const kind = layoutKind();
    if (kind === 'grid') return viewGrid();
    const pads = S.part.pads.slice().sort((a, b) => natCmp(a.num, b.num));
    const n = pads.length;
    const per = kind === 'quad' ? n / 4 : Math.ceil(n / 2);
    const pitch = 26, padL = 22, padW = 15, lab = 118;
    const bodyW = kind === 'quad' ? pitch * (per + 4) : 220;
    const bodyH = pitch * (per + (kind === 'quad' ? 4 : 1));
    const ox = padL + lab + 8, oy = kind === 'quad' ? padL + lab + 8 : 20;
    const W = bodyW + 2 * ox, H = bodyH + 2 * oy;
    let g = '';
    pads.forEach((p, i) => {
      const side = kind === 'quad' ? Math.floor(i / per) : (i < per ? 0 : 2);
      const k = kind === 'quad' ? i % per : (i < per ? i : i - per);
      const t = pitch * (k + (kind === 'quad' ? 2.5 : 1));
      let x, y, w, h, nx, ny, lx, ly, rot = 0, anchorIn, anchorOut;
      const label = padLabel(p.num), name = p.names.join('/');
      if (side === 0) { x = ox - padL; y = oy + t - padW / 2; w = padL; h = padW; nx = ox + 6; ny = oy + t; anchorIn = 'start'; lx = x - 6; ly = ny; anchorOut = 'end'; }
      else if (side === 1) { x = ox + t - padW / 2; y = oy + bodyH; w = padW; h = padL; nx = ox + t; ny = oy + bodyH - 6; rot = -90; anchorIn = 'start'; lx = nx; ly = y + padL + 6; anchorOut = 'end'; }
      else if (side === 2) { const tt = bodyH - t; x = ox + bodyW; y = oy + tt - padW / 2; w = padL; h = padW; nx = ox + bodyW - 6; ny = oy + tt; anchorIn = 'end'; lx = x + padL + 6; ly = ny; anchorOut = 'start'; }
      else { const tt = bodyW - t; x = ox + tt - padW / 2; y = oy - padL; w = padW; h = padL; nx = ox + tt; ny = oy + 6; rot = -90; anchorIn = 'end'; lx = nx; ly = y - 6; anchorOut = 'start'; }
      g += padRect(p.num, x, y, w, h);
      const tr = (px, py) => (rot ? ` transform="rotate(${rot} ${px} ${py})"` : '');
      g += `<text class="pm-pname${p.gpio ? '' : ' dim'}" x="${nx}" y="${ny}" text-anchor="${anchorIn}" dominant-baseline="central"${tr(nx, ny)}>${esc(name)}</text>`;
      if (label) g += `<text class="pm-plab ${padState(p.num)}" x="${lx}" y="${ly}" text-anchor="${anchorOut}" dominant-baseline="central"${tr(lx, ly)}>${esc(label)}</text>`;
      const numPos = side === 0 ? [x + w / 2, y - 3] : side === 2 ? [x + w / 2, y - 3] : null;
      if (numPos && (k === 0 || (k + 1) % 4 === 0)) g += `<text class="pm-pnum" x="${numPos[0]}" y="${numPos[1]}" text-anchor="middle">${p.num}</text>`;
    });
    const m = S.part.meta;
    const r = selReq();
    const center = `<text class="pm-cname" x="${ox + bodyW / 2}" y="${oy + bodyH / 2 - 10}" text-anchor="middle">${esc(m.mpn)}</text>
      <text class="pm-csub" x="${ox + bodyW / 2}" y="${oy + bodyH / 2 + 12}" text-anchor="middle">${esc(m.package || '')}${r ? ' · ' + esc(r.inst || r.type) + ': ' + Object.values(S.cand).filter((c) => !c.taken).length + ' free pads could serve, ' + Object.values(S.cand).filter((c) => c.taken).length + ' taken' : ''}</text>`;
    return `<svg class="pm-svg" viewBox="0 0 ${W} ${H}" style="max-width:${W}px">${DEFS}<rect class="pm-body" x="${ox}" y="${oy}" width="${bodyW}" height="${bodyH}" rx="6"/><circle class="pm-dot1" cx="${ox + 14}" cy="${oy + 14}" r="4"/>${g}${center}</svg>`;
  }

  function viewGrid() {
    const balls = S.part.pads.map((p) => { const m = /^([A-Z]+)(\d+)$/.exec(p.num); return { p, row: m[1], col: +m[2] }; });
    const rows = [...new Set(balls.map((b) => b.row))].sort(natCmp), cols = Math.max(...balls.map((b) => b.col));
    const s = 34, o = 30;
    let g = '';
    rows.forEach((r, i) => { g += `<text class="pm-pnum" x="${o - 14}" y="${o + i * s + s / 2}" text-anchor="middle" dominant-baseline="central">${r}</text>`; });
    for (let c = 1; c <= cols; c++) g += `<text class="pm-pnum" x="${o + (c - 1) * s + s / 2}" y="${o - 10}" text-anchor="middle">${c}</text>`;
    balls.forEach((b) => {
      const x = o + (b.col - 1) * s + 3, y = o + rows.indexOf(b.row) * s + 3;
      g += padRect(b.p.num, x, y, s - 6, s - 6);
      g += `<text class="pm-bname" x="${x + (s - 6) / 2}" y="${y + (s - 6) / 2}" text-anchor="middle" dominant-baseline="central">${esc(b.p.names[0].slice(0, 5))}</text>`;
    });
    const W = o * 2 + cols * s, H = o * 2 + rows.length * s;
    return `<svg class="pm-svg" viewBox="0 0 ${W} ${H}" style="max-width:${W}px">${DEFS}${g}</svg>`;
  }

  function viewBlock() {
    const reqs = S.result.reqs.filter((r) => r.slots.length || r.problems.length);
    const left = reqs.filter((r) => r.dir === 'in'), right = reqs.filter((r) => r.dir !== 'in');
    const rowH = 17, gap = 16, headH = 18;
    const groupH = (r) => headH + Math.max(1, r.slots.length) * rowH;
    const colH = (list) => list.reduce((h, r) => h + Math.max(groupH(r), r.users.length * 26) + gap, gap);
    const power = S.part.pads.filter((p) => FIXED.has(p.role) && p.role !== 'nc');
    const fixed = S.part.pads.filter((p) => !p.gpio && !FIXED.has(p.role));
    const bodyH = Math.max(colH(left), colH(right), 240) + 40;
    const bx = 250, bw = 300, by = 60, W = bx * 2 + bw, H = by + bodyH + 70;
    let g = `<rect class="pm-body" x="${bx}" y="${by}" width="${bw}" height="${bodyH}" rx="8"/>
      <text class="pm-cname" x="${bx + bw / 2}" y="${by + bodyH / 2 - 6}" text-anchor="middle">MCU</text>
      <text class="pm-csub" x="${bx + bw / 2}" y="${by + bodyH / 2 + 14}" text-anchor="middle">${esc(S.part.meta.mpn)}</text>`;
    // Power along the top and bottom, as Scribe draws rails.
    const tops = power.filter((p) => p.role !== 'ground'), bots = power.filter((p) => p.role === 'ground');
    const strip = (list, y, up) => list.forEach((p, i) => {
      const x = bx + 30 + i * Math.min(60, (bw - 60) / Math.max(1, list.length - 1 || 1));
      g += `<line class="pm-wire dim" x1="${x}" y1="${y}" x2="${x}" y2="${y + (up ? -18 : 18)}"/><text class="pm-pname dim" x="${x}" y="${y + (up ? -24 : 30)}" text-anchor="middle">${esc(p.names[0])}</text>`;
    });
    strip(tops, by, true); strip(bots, by + bodyH, false);
    const drawCol = (list, isLeft) => {
      let y = by + gap + 10;
      list.forEach((r) => {
        const h = Math.max(groupH(r), r.users.length * 26);
        const sev = sevOf(r);
        const edge = isLeft ? bx : bx + bw;
        const tx = isLeft ? bx + 10 : bx + bw - 10, anchor = isLeft ? 'start' : 'end';
        g += `<g class="pm-grp${S.sel === r.id ? ' sel' : ''}" data-req="${r.id}">`;
        g += `<text class="pm-ghead ${sev}" x="${tx}" y="${y + 12}" text-anchor="${anchor}">${sev === 'issue' ? '✕ ' : sev === 'warn' ? '▲ ' : ''}${esc(r.type === 'PINS' ? 'Pins' : r.inst || r.item.inst || r.type)}</text>`;
        const slots = r.slots.length ? r.slots.slice().sort((a, b) => natCmp(a.sig, b.sig)) : [null];
        slots.forEach((s, i) => {
          const yy = y + headH + i * rowH + rowH / 2;
          const px = isLeft ? edge - 16 : edge;
          if (s) {
            g += padRect(s.pad, px, yy - 5, 16, 10);
            g += `<text class="pm-prow" x="${tx}" y="${yy}" text-anchor="${anchor}" dominant-baseline="central">${esc(s.gpio)}${s.sig !== s.gpio && s.sig !== 'GPIO' ? ' · ' + esc(s.sig) : ''}</text>`;
          } else g += `<text class="pm-prow issue" x="${tx}" y="${yy}" text-anchor="${anchor}" dominant-baseline="central">no pins</text>`;
        });
        // The blocks it connects to, outside the MCU.
        const midY = y + h / 2;
        const ux = isLeft ? 20 : bx + bw + 60, uw = 170;
        r.users.forEach((u, i) => {
          const uy = midY - (r.users.length * 26) / 2 + i * 26 + 2;
          g += `<path class="pm-wire ${sev}" d="M${isLeft ? ux + uw : ux} ${uy + 11} C ${isLeft ? edge - 40 : edge + 40} ${uy + 11}, ${isLeft ? edge - 40 : edge + 40} ${midY}, ${isLeft ? edge - 16 : edge + 16} ${midY}"/>`;
          g += `<rect class="pm-ublock" x="${ux}" y="${uy}" width="${uw}" height="22" rx="4"/><text class="pm-utext" x="${ux + 8}" y="${uy + 11}" dominant-baseline="central">${esc(trunc(u.block, 24))}</text>`;
        });
        g += '</g>';
        y += h + gap;
      });
    };
    drawCol(left, true); drawCol(right, false);
    if (fixed.length) g += `<text class="pm-csub" x="${bx + bw / 2}" y="${by + bodyH - 14}" text-anchor="middle">${esc(fixed.map((p) => p.names[0] + (p.also ? ' ' + p.also : '')).join(' · '))}</text>`;
    return `<svg class="pm-svg" viewBox="0 0 ${W} ${H}" style="max-width:${W}px">${DEFS}${g}</svg>`;
  }
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function viewPorts() {
    const ports = {};
    S.part.pads.forEach((p) => p.names.forEach((n) => { const q = portOf(n); if (q) (ports[q.port] = ports[q.port] || {})[q.bit] = p; }));
    const head = '<tr><th></th>' + Array.from({ length: 16 }, (_, b) => `<th>${b}</th>`).join('') + '</tr>';
    const body = Object.keys(ports).sort().map((port) => '<tr><th>P' + port + '</th>' + Array.from({ length: 16 }, (_, b) => {
      const p = ports[port][b];
      if (!p) return '<td class="pm-nb" title="Not bonded in this package"><span>—</span></td>';
      const st = padState(p.num);
      const u = S.result.used[p.num];
      const shared = p.bonded ? `<i class="pm-shared" title="Pad ${p.num} is shared by ${p.names.join(' and ')}">⇄</i>` : '';
      const lab = u && u.gpio !== undefined ? '' : '';
      return `<td class="pm-cell ${st}${isCand(p.num) ? ' cand' : ''}${isMine(p.num) ? ' mine' : ''}" data-pad="${p.num}" title="${esc(tip(p.num))}"><b>P${port}${b}</b><small>${esc(shortLab(p.num)) || '&nbsp;'}</small>${u && u.lock ? '<i class="pm-lk">⚿</i>' : ''}${shared}${lab}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="pm-scroll"><table class="pm-ports">${head}${body}</table></div><p class="pm-hint">A dash is a bit this package doesn't bond out. ⇄ marks a pad two GPIOs share, so using one takes the other's pad too.</p>`;
  }
  function shortLab(num) { const l = padLabel(num); return l.replace(/^(.*?)_/, '$1 '); }

  function viewMatrix() {
    const gp = S.part.pads.filter((p) => p.fns.length && !FIXED.has(p.role)).sort((a, b) => natCmp(portKey(a), portKey(b)));
    const insts = S.part.insts.filter((i) => gp.some((p) => p.fns.some((f) => f.inst === i)));
    const used = S.result.used;
    const head = '<tr><th class="pm-stick"></th>' + gp.map((p) => `<th class="pm-vert${isCand(p.num) ? ' cand' : ''}" data-pad="${p.num}"><span>${esc(p.names.join('/'))}</span></th>`).join('') + '</tr>';
    const body = insts.map((i) => {
      const owner = S.result.reqs.find((r) => r.inst === i && TYPES[r.type].bus);
      return `<tr><th class="pm-stick${owner ? ' own' : ''}" title="${owner ? 'Used by ' + esc(owner.users.map((u) => u.block).join(', ')) : ''}">${esc(i)}${owner ? ' ●' : ''}</th>` + gp.map((p) => {
        const fs = p.fns.filter((f) => f.inst === i);
        if (!fs.length) return '<td></td>';
        const u = used[p.num];
        const on = u && u.fn && u.fn.inst === i;
        const cls = on ? 'on ' + padState(p.num) : (u ? 'gone' : 'can');
        return `<td class="pm-m ${cls}${isCand(p.num) && S.cand[p.num].f && S.cand[p.num].f.inst === i ? ' cand' : ''}" data-pad="${p.num}" title="${esc(p.names[0] + ': ' + fs.map((f) => f.full).join(', '))}">${on ? '■' : u ? '·' : '•'}</td>`;
      }).join('') + '</tr>';
    }).join('');
    return `<div class="pm-scroll"><table class="pm-matrix">${head}${body}</table></div><p class="pm-hint">• the instance can use the pad · ■ planned there · · the pad is taken by something else. ● an instance a connection holds.</p>`;
  }
  const portKey = (p) => { const q = portOf(p.names[0]); return q ? q.port + String(q.bit).padStart(2, '0') : 'Z' + p.num; };

  function viewTable() {
    const rows = S.part.pads.slice().sort((a, b) => natCmp(a.num, b.num)).map((p) => {
      const st = padState(p.num), u = S.result.used[p.num];
      return `<tr class="${isCand(p.num) ? 'cand' : ''}${isMine(p.num) ? ' mine' : ''}" data-pad="${p.num}">
        <td class="num">${esc(p.num)}</td><td>${esc(p.names.join(' / '))}${p.also ? ' <span class="pm-dim">' + esc(p.also) + '</span>' : ''}</td>
        <td><span class="pm-chip ${st}">${st === 'issue' ? '✕ ' : st === 'warn' || st === 'stray' ? '▲ ' : ''}${esc(padLabel(p.num) || (st === 'fixed' ? p.role : st === 'special' ? p.role : ''))}</span>${u && u.lock ? ' ⚿' : ''}</td>
        <td>${esc(padFor(p.num))}</td>
        <td class="pm-fns">${esc(p.fns.map((f) => f.full).join(', '))}</td></tr>`;
    }).join('');
    return `<div class="pm-scroll"><table class="pm-table"><thead><tr><th>Pad</th><th>Pin</th><th>Planned</th><th>For</th><th>Other functions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------- The pad popover ----------

  function openPop(num, ev) {
    const p = S.part.byNum[num];
    const u = S.result.used[num];
    const r = selReq();
    const fits = (f) => S.result.reqs.filter((q) => !q.dead && TYPES[q.type].fams && TYPES[q.type].fams.includes(f.fam) && (!q.item.inst || q.item.inst === f.inst) && (TYPES[q.type].bus ? TYPES[q.type].sigs.includes(f.sig) : TYPES[q.type].pat.test(f.sig)));
    const groups = {};
    p.fns.forEach((f) => { (groups[f.fam] = groups[f.fam] || []).push(f); });
    const order = Object.keys(groups).sort((a, b) => {
      const fa = r && TYPES[r.type].fams && TYPES[r.type].fams.includes(a) ? 0 : 1, fb = r && TYPES[r.type].fams && TYPES[r.type].fams.includes(b) ? 0 : 1;
      return fa - fb || natCmp(a, b);
    });
    const items = order.map((fam) => `<div class="pm-pop-g">${esc(fam)}</div>` + groups[fam].map((f) => {
      const qs = fits(f);
      const q = (r && qs.includes(r)) ? r : qs[0];
      const on = u && u.fn && u.fn.full === f.full;
      return `<button class="pm-pop-i${on ? ' on' : ''}${q ? ' fit' : ''}" data-fn="${esc(f.full)}" data-req="${q ? q.id : ''}"><span>${esc(f.full)}${p.bonded ? ' <small>[' + esc(f.gpio) + ']</small>' : ''}</span><small>${f.af != null ? 'AF' + f.af : 'analog / extra'}${q ? ' · ' + esc(q.users[0].block) : ' · not in Scribe'}</small></button>`;
    }).join('')).join('');
    const gpioFor = r && (r.type === 'GPIO' || r.type === 'PINS') && p.gpio ? `<button class="pm-pop-i fit" data-fn="" data-req="${r.id}"><span>GPIO</span><small>${esc(r.users[0].block)}</small></button>` : '';
    const pop = $('#pm-pop');
    pop.innerHTML = `<div class="pm-pop-h"><b>${esc(p.num)} · ${esc(p.names.join(' / '))}</b>${p.also ? ' <span class="pm-dim">' + esc(p.also) + '</span>' : ''}<div class="pm-dim">${esc(p.role)}${u ? ' · now ' + esc(padLabel(num)) + (padFor(num) ? ' for ' + esc(padFor(num)) : '') : ''}</div></div>
      ${gpioFor}${items || '<div class="pm-dim pm-pop-none">No alternate functions.</div>'}
      ${S.locks[num] ? '<button class="pm-pop-i" data-unlock="1"><span>Let the planner choose</span><small>Remove your pick</small></button>' : ''}`;
    pop.hidden = false;
    pop.dataset.pad = num;
    const bw = window.innerWidth, bh = window.innerHeight;
    const w = Math.min(300, bw - 24);
    pop.style.width = w + 'px';
    let x = ev.clientX + 10, y = ev.clientY + 10;
    if (x + w > bw - 12) x = Math.max(12, ev.clientX - w - 10);
    pop.style.left = x + 'px'; pop.style.top = '0px';
    const h = pop.offsetHeight;
    if (y + h > bh - 12) y = Math.max(12, bh - h - 12);
    pop.style.top = y + 'px';
  }
  function closePop() { $('#pm-pop').hidden = true; }

  function pick(num, fnFull, reqId) {
    const r = S.result.reqs.find((q) => q.id === reqId);
    const p = S.part.byNum[num];
    const f = fnFull ? p.fns.find((x) => x.full === fnFull) : null;
    // A bus pick moves the whole bus onto that instance: drop the bus's locks on other instances.
    if (r && f && TYPES[r.type].bus) Object.keys(S.locks).forEach((k) => { const l = S.locks[k]; if (l.req === r.id && l.fn && !l.fn.startsWith(f.inst + '_')) delete S.locks[k]; });
    Object.keys(S.locks).forEach((k) => { const l = S.locks[k]; if (r && l.req === r.id && f && l.sig === f.sig && k !== num) delete S.locks[k]; });
    S.locks[num] = { req: r ? r.id : null, fn: f ? f.full : null, sig: f ? f.sig : (p.names[0]) };
    if (r && (r.type === 'GPIO' || r.type === 'PINS')) S.locks[num].sig = r.type === 'PINS' ? p.names[0] : 'GPIO';
    if (r) S.sel = r.id;
    closePop(); replan();
  }

  // ---------- Wiring ----------

  function wire() {
    $('#pm-views').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.view = b.dataset.view; closePop(); render(); } });
    $('#pm-conns').addEventListener('click', (e) => {
      const fx = e.target.closest('[data-fix]');
      if (fx) {
        const r = S.result.reqs.find((q) => q.id === fx.dataset.fix);
        const lines = S.text.split(/\r?\n/);
        lines[r.line] = lines[r.line].replace(r.fix.from, r.fix.to);
        S.text = lines.join('\n'); $('#pm-text').value = S.text; replan(); return;
      }
      const row = e.target.closest('[data-req]');
      if (row) { S.sel = S.sel === row.dataset.req ? null : row.dataset.req; closePop(); render(); }
    });
    $('#pm-conns').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.req) e.target.click(); });
    $('#pm-view').addEventListener('click', (e) => {
      const grp = e.target.closest('.pm-grp');
      const padEl = e.target.closest('[data-pad]');
      if (padEl) { openPop(padEl.dataset.pad, e); e.stopPropagation(); return; }
      if (grp) { S.sel = S.sel === grp.dataset.req ? null : grp.dataset.req; render(); }
    });
    $('#pm-pop').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const num = $('#pm-pop').dataset.pad;
      if (b.dataset.unlock) { delete S.locks[num]; closePop(); replan(); return; }
      pick(num, b.dataset.fn, b.dataset.req);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#pm-pop') && !e.target.closest('[data-pad]')) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); if (S.sel) { S.sel = null; render(); } } });
    $('#pm-apply').addEventListener('click', () => { S.text = $('#pm-text').value; replan(); });
    $('#pm-clear').addEventListener('click', () => { S.locks = {}; replan(); });
    $('#pm-demo').addEventListener('click', () => { S.text = window.PM_DEMO.connects; $('#pm-text').value = S.text; setPart(window.PM_DEMO.part, false); });
    $('#pm-part-file').addEventListener('change', (e) => readFile(e.target.files[0], 'part'));
    $('#pm-conn-file').addEventListener('change', (e) => readFile(e.target.files[0], 'conns'));
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { e.preventDefault(); [...e.dataTransfer.files].forEach((f) => readFile(f, /\.json$/i.test(f.name) ? 'part' : 'conns')); });
    $('#pm-theme').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', document.documentElement.dataset.theme);
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

  // ---------- Start ----------

  const th = store.get('theme', null);
  if (th) document.documentElement.dataset.theme = th;
  S.text = window.PM_DEMO.connects;
  $('#pm-text').value = S.text;
  wire();
  setPart(window.PM_DEMO.part, false);
  window.PM = { S, parseLabel, plan, loadPart, replan };   // for the console and tests
})();
