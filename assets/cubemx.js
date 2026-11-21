// Import from CubeMX, in the browser: reads an MCU's file from STM32CubeMX's database on this computer
// (db/mcu/<RefName>.xml, and db/mcu/IP/GPIO-<version>_Modes.xml for the AF numbers) the way
// tools/import_cubemx.py does, and fills a part file. Nothing is uploaded: the files are read in the
// page. ST's data goes only to pincheck_data and review repos, never a public repo.
(function (PK) {
  'use strict';

  const NOT_PERIPHERALS = new Set(['FATFS', 'FREERTOS', 'GUI_INTERFACE', 'TRACER_EMB', 'USB_DEVICE', 'USB_HOST', 'USBPD', 'NVIC',
    'DMA', 'GPIO', 'LWIP', 'MBEDTLS', 'PDM2PCM', 'TOUCHSENSING', 'GRAPHICS', 'LIBJPEG', 'STM32_WPAN', 'THREADX', 'FILEX', 'USBX',
    'NETXDUO', 'LEVELX', 'CORTEX_M0+', 'CORTEX_M4', 'CORTEX_M7', 'CORTEX_M33', 'MEMORYMAP', 'PWR', 'BSP', 'X-CUBE', 'OPENAMP',
    'RESMGR_UTILITY', 'MDMA', 'BDMA', 'GPDMA1', 'LPDMA1']);
  // Core, cache, security, and DMA blocks: on the chip, but not peripherals a connection uses.
  const CORE_BLOCK = /^(CORTEX_M|NVIC\d*$|GTZC|SAU$|LINKEDLIST$|FLASH$|DEBUG$|BOOTPATH$|RAMCFG$|[ID]CACHE\d*$|SYS_S$|\w*DMA\d*$)/;
  const kids = (el, name) => [...el.children].filter(c => c.localName === name);
  const nat = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  function xml(text) {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('That isn’t an XML file');
    return d.documentElement;
  }

  const cleanPin = n => n.replace(/\s*\([^)]*\)$/, '').replace(/\s*-\s*/g, '-').trim();
  function roleOf(name, type) {
    const n = name.toUpperCase();
    if (type === 'Power') {
      if (/^(VSS|VREF-|GND)/.test(n)) return 'ground';
      if (/^(VCAP|VDD11|VLXSMPS|VDDCORE)/.test(n)) return 'power-out';
      return 'power-in';
    }
    if (type === 'Reset' || n.includes('NRST')) return 'reset';
    if (type === 'Boot' || n.includes('BOOT')) return 'boot';
    if (/OSC(32)?_IN|OSC_IN/.test(n)) return 'clock-in';
    if (/OSC(32)?_OUT|OSC_OUT/.test(n)) return 'clock-out';
    if (type === 'NC') return 'nc';
    return 'io';
  }
  function domainOf(name) {
    const n = name.toUpperCase().split('/')[0];
    if (n.startsWith('VSS')) return null;
    return /^VDDIO\d/.test(n) ? n : n.replace(/_?\d+$/, '');
  }

  // The GPIO modes file: (pin name, signal) → AF number.
  function afTable(root) {
    const out = new Map();
    if (!root) return out;
    for (const gp of root.getElementsByTagName('*')) {
      if (gp.localName !== 'GPIO_Pin') continue;
      const pin = gp.getAttribute('Name');
      for (const ps of kids(gp, 'PinSignal')) {
        for (const pv of ps.getElementsByTagName('*')) {
          if (pv.localName !== 'PossibleValue') continue;
          const m = /GPIO_AF(\d+)_/.exec(pv.textContent || '');
          if (m) out.set(pin + '|' + ps.getAttribute('Name'), +m[1]);
        }
      }
    }
    return out;
  }
  const gpioVersion = root => { const ip = kids(root, 'IP').find(i => i.getAttribute('Name') === 'GPIO'); return ip ? ip.getAttribute('Version') : null; };
  const modesName = root => { const v = gpioVersion(root); return v ? 'GPIO-' + v + '_Modes.xml' : null; };

  function signals(p, afs, raw, port) {
    const out = [];
    for (const s of kids(p, 'Signal')) {
      const sig = s.getAttribute('Name');
      if (!sig || sig === 'GPIO') continue;
      let af = afs.get(raw + '|' + sig);
      if (af == null && port) af = afs.get(port + '|' + sig);
      out.push(sig + (af != null ? ' AF' + af : ''));
    }
    return out;
  }

  // Build a part file from the MCU's XML (text) and, optionally, its GPIO modes file (text).
  function build(mcuText, modesText, mpn) {
    const root = xml(mcuText);
    if (root.localName !== 'Mcu') throw new Error('That isn’t an MCU file from STM32CubeMX’s db/mcu folder');
    const afs = afTable(modesText ? xml(modesText) : null);
    const pins = [], domains = [], byPos = new Map(), remaps = [];
    for (const p of kids(root, 'Pin')) {
      if (p.getAttribute('Variant')) { remaps.push(p); continue; }
      const raw = p.getAttribute('Name');
      const nm = cleanPin(raw);
      const role = roleOf(nm, p.getAttribute('Type'));
      const pin = { num: p.getAttribute('Position'), name: nm, role };
      const port = /^(P[A-K]\d{1,2})/.exec(nm);
      if (role === 'power-in') { const d = domainOf(nm); if (d) { pin.domain = d; if (!domains.includes(d)) domains.push(d); } }
      else if (['io', 'reset', 'boot', 'clock-in', 'clock-out'].includes(role)) pin.domain = 'VDD';
      const fns = signals(p, afs, raw, port && port[1]);
      if (port) fns.push('EXTI' + port[1].replace(/^P[A-K]/, ''));
      if (fns.length) pin.functions = fns;
      pins.push(pin);
      if (!byPos.has(pin.num)) byPos.set(pin.num, pin);
    }
    for (const p of remaps) {
      const pad = byPos.get(p.getAttribute('Position'));
      if (!pad) continue;
      const raw = p.getAttribute('Name');
      const port = /^(P[A-K]\d{1,2})(?![0-9])/.exec(raw);
      if (port) {
        (pad.bond = pad.bond || []).push({ name: port[1], functions: signals(p, afs, raw, port[1]).concat('EXTI' + port[1].replace(/^P[A-K]/, '')), remap: p.getAttribute('Variant') });
      } else {
        const have = new Set((pad.functions || []).map(f => f.split(' ')[0]));
        const fs = signals(p, afs, raw, null);
        (fs.length ? fs : [cleanPin(raw)]).forEach(f => { if (!have.has(f.split(' ')[0])) (pad.functions = pad.functions || []).push(f); });
      }
    }
    pins.sort((a, b) => a.num.length - b.num.length || (a.num < b.num ? -1 : a.num > b.num ? 1 : 0));
    const values = [];
    const v = kids(root, 'Voltage')[0], t = kids(root, 'Temperature')[0], fq = kids(root, 'Frequency')[0];
    if (v) values.push({ k: 'supply.range', on: 'VDD', min: +v.getAttribute('Min'), max: +v.getAttribute('Max'), unit: 'V', src: 'import:cubemx', note: 'CubeMX lists one range for the part; check each domain in the datasheet' });
    if (t) values.push({ k: 'temp.range', min: +t.getAttribute('Min'), max: +t.getAttribute('Max'), unit: '°C', src: 'import:cubemx', note: 'The widest range in the family; the part number\'s temperature digit sets yours' });
    if (fq) values.push({ k: 'clk.fmax', value: +fq.textContent * 1e6, unit: 'Hz', src: 'import:cubemx' });
    if (!domains.includes('VDD')) domains.unshift('VDD');
    const ref = root.getAttribute('RefName') || '';
    const peripherals = [...new Set(kids(root, 'IP').map(i => i.getAttribute('InstanceName')).filter(n => n && !NOT_PERIPHERALS.has(n) && !CORE_BLOCK.test(n)))].sort(nat);
    const name = mpn || ref;
    return {
      schema: 'pincheck.part/1', id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), mpn: name, match: [],
      manufacturer: 'STMicroelectronics', kind: 'mcu',
      description: [(kids(root, 'Core')[0] || {}).textContent, root.getAttribute('Line')].filter(Boolean).join(' ') + ', ' + (root.getAttribute('Package') || ''),
      package: root.getAttribute('Package') || '', datasheet: { title: '', rev: '', url: '', sha256: '' },
      peripherals, pins, domains, values,
      made: { by: '', at: now(), how: 'import:cubemx (' + ref + ')' }, updated: now(),
      _ref: ref, _afs: afs.size > 0, _modes: modesName(root),
    };
  }

  // Does this CubeMX RefName ("STM32G071K(6-8-B)Ux") cover the part number?
  function covers(ref, mpn) {
    if (!ref || !mpn) return true;
    const r = ref.replace(/\(([^)]*)\)/g, (_, g) => '(?:' + g.split('-').map(x => x.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')').replace(/x/g, '[0-9A-Z]');
    return new RegExp('^' + r, 'i').test(mpn.toUpperCase().replace(/\s+/g, ''));
  }

  function mergeFunctions(old, add) {
    const out = old.slice();
    const idx = new Map(out.map((f, i) => [f.split(' ')[0], i]));
    for (const f of add) {
      const s = f.split(' ')[0];
      if (!idx.has(s)) { idx.set(s, out.length); out.push(f); }
      else if (f.includes(' AF') && !out[idx.get(s)].includes(' AF')) out[idx.get(s)] = f;
    }
    return out;
  }

  // Fill an existing file from a built one, as import_cubemx.py --merge does: the file's own values and
  // pin fields stay; what's missing is added (pins, pin fields, signals, AF numbers, bond, peripherals,
  // values not already there). Returns what it added, counted.
  function merge(f, n) {
    const add = { pins: 0, fields: 0, signals: 0, values: 0 };
    f.pins = f.pins || [];
    const by = new Map(f.pins.map(p => [String(p.num), p]));
    for (const p of n.pins) {
      const q = by.get(String(p.num));
      if (!q) { f.pins.push(JSON.parse(JSON.stringify(p))); add.pins++; continue; }
      for (const [k, v] of Object.entries(p)) {
        if (k === 'functions' && Array.isArray(q.functions) && q.functions.length) {
          const before = q.functions.join('\n');
          q.functions = mergeFunctions(q.functions, v);
          if (q.functions.join('\n') !== before) add.signals++;
        } else if (!(k in q) || q[k] === '' || q[k] == null || (k === 'role' && (q.role === 'other'))) {
          q[k] = JSON.parse(JSON.stringify(v)); add.fields++;
        }
      }
    }
    f.pins.sort((a, b) => String(a.num).length - String(b.num).length || nat(a.num, b.num));
    f.values = f.values || [];
    const have = new Set(f.values.map(x => x.k + '|' + (x.on || '')));
    n.values.forEach(x => { if (!have.has(x.k + '|' + (x.on || ''))) { f.values.push(x); add.values++; } });
    f.domains = [...new Set((f.domains || []).concat(n.domains))];
    for (const k of ['manufacturer', 'package', 'description', 'peripherals']) if (!f[k] || (Array.isArray(f[k]) && !f[k].length)) f[k] = n[k];
    if (!f.mpn) { f.mpn = n.mpn; f.id = f.id || n.id; }
    if (!f.made) f.made = n.made;
    f.kind = 'mcu';
    f.updated = n.updated;
    return add;
  }

  // Ask for the files. A temporary input, so any page can use it (Pincheck, and later Signoff EE).
  function pickFiles(cb) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.xml,text/xml,application/xml'; i.multiple = true;
    i.onchange = async () => cb(await Promise.all([...i.files].map(async f => ({ name: f.name, text: await f.text() }))));
    i.click();
  }

  // From picked files: the MCU file (root <Mcu>) and, if there, the GPIO modes file (root <IP>).
  function fromFiles(files, mpn) {
    let mcu = null, modes = null;
    for (const f of files) { if (/<Mcu[\s>]/.test(f.text.slice(0, 4000))) mcu = f; else if (/GPIO_Pin/.test(f.text)) modes = f; }
    if (!mcu) throw new Error('None of those is an MCU file. Pick the MCU’s file in STM32CubeMX’s db/mcu folder (named like STM32G0B1C(B-C-E)Tx.xml).');
    return build(mcu.text, modes && modes.text, mpn);
  }

  PK.cubemx = { build, merge, covers, fromFiles, pickFiles, modesName: text => modesName(xml(text)) };
})(window.PK = window.PK || {});
