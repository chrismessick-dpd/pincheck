// Pincheck tests: open tests/test.html over http. The page title becomes PASS, FAIL, or ERROR.
(async function () {
  'use strict';
  const PK = window.PK, P = PK.params, L = PK.library, D = PK.design;
  const out = [], fails = [], tests = [];
  const t = (name, fn) => tests.push([name, fn]);
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
  const ok = (c, msg) => { if (!c) throw new Error(msg || 'not true'); };

  const xml = await (await fetch('../demo/thermostat-main-pcba.xml', { cache: 'no-store' })).text();
  const lib = await Promise.all(['stm32g071kbu6', 'tps562201ddcr'].map(async n => (await fetch('../demo/library/' + n + '.json', { cache: 'no-store' })).json()));
  const design = await D.build([new File([xml], 'thermostat-main-pcba.xml')]);

  t('numbers: SI prefixes, units, and R/V notation', () => {
    eq(P.parseNum('100n'), 1e-7); eq(P.parseNum('4.7 µF', 'F'), 4.7e-6); eq(P.parseNum('3V3'), 3.3); eq(P.parseNum('4k7'), 4700);
    eq(P.parseNum('500 nA/V', 'A/V'), 5e-7); eq(P.parseNum('48 MHz', 'Hz'), 48e6); eq(P.parseNum('VDD+0.3'), null); eq(P.parseNum(''), null);
  });
  t('numbers: shown with prefixes', () => { eq(P.fmt(1e-7, 'F'), '100 nF'); eq(P.fmt(48e6, 'Hz'), '48 MHz'); eq(P.fmt(-40, '°C'), '-40 °C'); eq(P.fmt(3.6, 'V'), '3.6 V'); });
  t('catalog: unique keys, units, and shapes', () => {
    const ks = P.CATALOG.map(c => c.k);
    eq(ks.filter((k, i) => ks.indexOf(k) !== i), []);
    ok(ks.length >= 190, 'catalog has ' + ks.length + ' keys');
    for (const c of P.CATALOG) { ok(['range', 'value', 'text', 'list'].includes(c.shape), c.k + ' shape'); ok(['part', 'domain', 'pin'].includes(c.on), c.k + ' on'); }
    ok(P.forKind('regulator').some(c => c.k === 'reg.vref') && !P.forKind('resistor').some(c => c.k === 'reg.vref'));
  });
  t('KiCad netlist: parts, pins, and nets', () => {
    eq(design.source, 'kicad'); eq(design.parts.length, 39); eq(design.nets.length, 32);
    const u4 = design.parts.find(p => p.ref === 'U4');
    eq(u4.pins.length, 33); eq(u4.pins.find(p => p.num === '4').name, 'VDD/VDDA'); eq(u4.pins.find(p => p.num === '4').type, 'power');
    eq(design.nets.find(n => n.name === '3V3').nodes.some(n => n.ref === 'U4' && n.pin === '4'), true);
  });
  t('part numbers and kinds', () => {
    const u7 = design.parts.find(p => p.ref === 'U7');
    eq([u7.mpn, u7.mpnFrom, u7.kind], ['TPS562201DDCR', 'MPN', 'ic']);
    eq(design.parts.find(p => p.ref === 'C41').mpn, '', 'C41 has no part number');
    eq(design.parts.find(p => p.ref === 'R5').kind, 'resistor');
    eq(D.groups(design, ['ic', 'crystal']).map(g => g.mpn).sort(), ['ESP32-C3-MINI-1-N4', 'RAC02-05SK', 'STM32G071KBU6', 'TPS562201DDCR']);
  });
  t('identify: Comment and library reference, as Altium vault parts carry them', () => {
    eq(D.identify({ params: { Comment: 'TPS54331DR' }, libRef: '0f3a9c1d2e4b5a6978c0d1e2f3a4b5c' }).mpn, 'TPS54331DR');
    eq(D.identify({ params: { Comment: '=Value' }, libRef: 'TPS25947xxRPW-Symbol-1' }).mpn, 'TPS25947xxRPW');
    eq(D.identify({ params: { 'Manufacturer Part Number': 'X1', Comment: 'ABC123' }, libRef: '' }).mpn, 'X1');
    eq(D.identify({ params: { Comment: '10k' }, libRef: '9d8c7b6a5f4e3d2c1b0a99887766554' }).mpn, '');
  });
  t('library: files match by part number and pattern', () => {
    eq(L.find(lib, 'STM32G071KBU6').id, 'stm32g071kbu6');
    eq(L.find(lib, 'stm32g071k8u6').id, 'stm32g071kbu6', 'match list, any case');
    eq(L.find(lib, 'TPS562201DDCT').id, 'tps562201ddcr');
    eq(L.find(lib, 'TPS562208DDCR'), null);
    eq(L.near(lib, 'TPS562201DDCRX').map(f => f.id), ['tps562201ddcr']);
    ok(L.glob('STM32G071K?U6*').test('STM32G071KBU6TR'));
  });
  t('library: demo files are valid and agree with the schematic pins', () => {
    for (const f of lib) { eq(L.validate(f), [], f.id); eq(L.pinCheck(f, design.parts.find(p => p.mpn === f.mpn)), [], f.id + ' pins'); }
  });
  t('library: pin check names differing pins', () => {
    const f = JSON.parse(JSON.stringify(lib[1])); f.pins[3].name = 'EN'; f.pins.push({ num: '7', name: 'PAD' });
    eq(L.pinCheck(f, design.parts.find(p => p.ref === 'U7')).map(m => m.num), ['4', '7']);
  });
  t('new file from the schematic: roles and domains guessed', () => {
    const f = L.fromSchematic(design.parts.find(p => p.ref === 'U7'), 'test');
    eq(f.kind, 'regulator');
    eq(f.pins.map(p => p.role), ['ground', 'switch', 'power-in', 'feedback', 'enable', 'bootstrap']);
    eq(f.domains, ['VIN']);
    const m = L.fromSchematic(design.parts.find(p => p.ref === 'U4'), 'test');
    eq(m.kind, 'mcu'); eq(m.pins.find(p => p.num === '6').role, 'reset'); eq(m.pins.find(p => p.num === '25').role, 'boot');
    eq(m.pins.find(p => p.num === '7').domain, 'VDD');
    eq(L.validate(m), []);
    const e = L.fromSchematic(design.parts.find(p => p.ref === 'U1'), 'test');
    eq(e.kind, 'module'); eq(e.domains, ['3V3']); eq(e.pins.find(p => p.num === '4').role, 'nc');
  });
  t('roles: regulator and op-amp outputs, grounds, and pads', () => {
    eq(L.guessRole({ name: 'VOUT', type: 'power' }, 'regulator'), 'power-out');
    eq(L.guessRole({ name: 'OUT', type: 'passive' }, 'analog'), 'analog');
    eq(L.guessRole({ name: 'GNDISO', type: 'power' }, 'interface'), 'ground');
    eq(L.guessRole({ name: 'EP', type: 'passive' }, 'regulator'), 'pad');
    eq(L.guessRole({ name: 'BOOT', type: 'passive' }, 'regulator'), 'bootstrap');
    eq(L.guessRole({ name: 'PA14-BOOT0', type: 'io' }, 'mcu'), 'boot');
  });
  t('validate: catches bad files', () => {
    ok(L.validate({}).length > 0);
    ok(L.validate(Object.assign({}, lib[0], { values: [{ k: 'supply.range', min: 1, unit: 'A' }] })).some(e => /unit/.test(e)));
    ok(L.validate(Object.assign({}, lib[0], { pins: [{ num: '1', role: 'banana' }] })).some(e => /role/.test(e)));
  });
  // A made-up Protel2 netlist in Altium's shape: a repeated channel (U2.1, U2.2), a part type with a dash,
  // a pin name with a dash, Windows-1252 text, and a pin on no net (U1 pin 3).
  const PROTEL = ['PROTEL NETLIST 2.0', '[', 'DESIGNATOR', 'U1', 'FOOTPRINT', 'SOT-23-5', 'PARTTYPE', 'TPS7A02-33', 'DESCRIPTION', 'LDO 3.3 V',
    'Comment', 'TPS7A0233PDBVR', 'Max Operating Temperature', '125°C', 'PCB3D', '', '*', ']',
    '[', 'DESIGNATOR', 'U2.1', 'FOOTPRINT', 'SOIC-8', 'PARTTYPE', 'TCAN1042', 'DESCRIPTION', 'CAN transceiver', ']',
    '[', 'DESIGNATOR', 'U2.2', 'FOOTPRINT', 'SOIC-8', 'PARTTYPE', 'TCAN1042', 'DESCRIPTION', 'CAN transceiver', ']',
    '(', '3V3', 'U1-5 TPS7A02-33-OUT Output      ', 'U2.1-3 TCAN1042-VCC Power   ', 'U2.2-3 TCAN1042-VCC Power', ')',
    '(', 'CAN_H.1', 'U2.1-7 TCAN1042-CANH Passive', ')', '(', 'IN', 'U1-1 TPS7A02-33-IN-A Power', ')'].join('\r\n') + '\r\n';
  t('Protel2 netlist: parts, channels, pin names, and types', () => {
    eq(PK.protel.sniff(PROTEL), 2); eq(PK.protel.sniff('[\r\nC1\r\n0603\r\n'), 1);
    const r = PK.protel.parse(PROTEL, 'x.NET');
    eq(r.parts.map(p => p.ref), ['U1', 'U2.1', 'U2.2']); eq(r.nets.length, 3);
    const u1 = r.parts[0];
    eq(u1.params.Comment, 'TPS7A0233PDBVR'); eq(u1.params['Max Operating Temperature'], '125°C');
    eq(u1.pins.map(p => [p.num, p.name, p.type]), [['5', 'OUT', 'output'], ['1', 'IN-A', 'power']]);
    eq(r.nets[0].nodes, [{ ref: 'U1', pin: '5' }, { ref: 'U2.1', pin: '3' }, { ref: 'U2.2', pin: '3' }]);
    const bytes = new Uint8Array([...'PROTEL NETLIST 2.0\r\n'].map(c => c.charCodeAt(0)).concat([0xB0]));
    eq(PK.protel.decode(bytes).slice(-1), '°', 'Windows-1252');
  });
  t('Protel2 with sheets: board designators joined to schematic parts', async () => {
    const sheetPart = { ref: 'U1', libRef: 'TPS7A02', description: '', params: { Comment: 'TPS7A0233PDBVR' }, sheets: ['a.SchDoc'],
      pins: [{ num: '1', name: 'IN', type: 'power' }, { num: '3', name: 'EN', type: 'input' }, { num: '5', name: 'OUT', type: 'output' }] };
    const real = PK.schdoc.parse;
    PK.schdoc.parse = () => ({ sheet: 'a.SchDoc', parts: [sheetPart, Object.assign({}, sheetPart, { ref: 'U2', params: { Comment: 'TCAN1042VDRQ1' }, pins: [{ num: '8', name: 'S', type: 'input' }] })] });
    try {
      const d = await D.build([new File(['x'], 'a.SchDoc'), new File([PROTEL], 'x.NET')]);
      eq([d.source, d.netlist, d.parts.length, d.nets.length], ['altium', 'Protel2', 3, 3]);
      const u1 = d.parts.find(p => p.ref === 'U1');
      eq(u1.pins.map(p => p.num + (p.unconnected ? '*' : '')), ['1', '3*', '5']);
      eq(d.parts.find(p => p.ref === 'U2.2').schRef, 'U2');
      eq(d.parts.find(p => p.ref === 'U2.2').pins.some(p => p.num === '8' && p.unconnected), true);
      eq(D.groups(d, ['ic']).map(g => g.refs), [['U1'], ['U2.1', 'U2.2']]);
    } finally { PK.schdoc.parse = real; }
  });
  // ── Checks ──
  const CK = PK.checks;
  t('checks: expressions, net-name voltages, and passive values', () => {
    eq(CK.evalExpr('min(VDD+0.4, 4.0)', { VDD: 3.3 }), 3.7); eq(+CK.evalExpr('0.7*VDD', { VDD: 3.3 }).toFixed(2), 2.31); eq(CK.evalExpr('(V+)+0.3', { 'V+': 5 }), 5.3);
    eq(CK.evalExpr('VDD+0.3', {}), null); eq(CK.evalExpr(5.5, {}), 5.5);
    eq(['3V3', '+5V0', 'VCC_1V8', '+12V', '5V0_ISO', '+3V3_AUX.1', '12V_SENSE0', 'PG_+3V3', '5V_MON', 'SDA'].map(CK.voltageFromName), [3.3, 5, 1.8, 12, 5, 3.3, null, null, null, null]);
    const pv = (v, u, kind) => (CK.passiveValue({ kind, params: { Value: v } }, u) || {}).v;
    eq([pv('10k', 'Ω', 'resistor'), pv('4K99', 'Ω', 'resistor'), pv('0R', 'Ω', 'resistor'), pv('33.2k', 'Ω', 'resistor'), pv('R_10k_0402', 'Ω', 'resistor')], [10000, 4990, 0, 33200, 10000]);
    eq([pv('100nF', 'F', 'capacitor'), pv('C_100nF_0603_50V', 'F', 'capacitor'), pv('4u7', 'F', 'capacitor'), pv('2.2uH', 'H', 'inductor')], [1e-7, 4.7e-6, 4.7e-6, 2.2e-6].map((x, i) => i === 1 ? 1e-7 : x));
  });
  t('checks: the demo finds its planted errors and works out 3V3 from the divider', () => {
    const r = CK.run(design, lib);
    ok(r.findings.some(f => f.check === 'func.exti' && /DISP_INT/.test(f.title)), 'EXTI line 4 shared');
    ok(r.findings.some(f => f.check === 'func.uart' && /TX\) meets U1 TXD0/.test(f.title)), 'TX to TX');
    eq(r.findings.filter(f => f.severity === 'error').length, 0, 'no errors on the demo');
    const v3 = r.rails.find(x => x.net === '3V3');
    eq(+v3.v.toFixed(3), 3.318); ok(/R5, R6/.test(v3.from));
    ok(!r.rails.some(x => x.net === 'SW'), 'the switch node has no DC voltage');
  });
  // A made-up board: a logic gate with its supply pins reversed, an LDO, and an MCU input pulled to 5 V.
  const mini = (() => {
    const pin = (num, name, type) => ({ num, name, type });
    const parts = [
      { ref: 'U1', mpn: 'GATE1', kind: 'ic', params: {}, pins: [pin('1', 'A', 'input'), pin('2', 'GND', 'power'), pin('3', 'Y', 'output'), pin('4', 'VCC', 'power')] },
      { ref: 'U2', mpn: 'LDO33', kind: 'ic', params: {}, pins: [pin('1', 'IN', 'power'), pin('2', 'GND', 'power'), pin('3', 'OUT', 'power')] },
      { ref: 'U3', mpn: 'MCU1', kind: 'ic', params: {}, pins: [pin('1', 'VDD', 'power'), pin('2', 'VSS', 'power'), pin('3', 'PA0', 'io'), pin('4', 'VBAT', 'power')] },
      { ref: 'R1', mpn: '', kind: 'resistor', params: { Value: '10k' }, pins: [pin('1', '1', 'passive'), pin('2', '2', 'passive')] },
      { ref: 'C1', mpn: '', kind: 'capacitor', params: { Value: '100nF' }, pins: [pin('1', '1', 'passive'), pin('2', '2', 'passive')] },
    ];
    const nets = [
      { name: '+5V', nodes: [{ ref: 'U2', pin: '1' }, { ref: 'U1', pin: '2' }, { ref: 'R1', pin: '1' }] },
      { name: 'GND', nodes: [{ ref: 'U2', pin: '2' }, { ref: 'U1', pin: '4' }, { ref: 'U3', pin: '2' }, { ref: 'C1', pin: '2' }] },
      { name: 'NetU2_3', nodes: [{ ref: 'U2', pin: '3' }, { ref: 'U3', pin: '1' }, { ref: 'C1', pin: '1' }] },
      { name: 'BTN', nodes: [{ ref: 'R1', pin: '2' }, { ref: 'U3', pin: '3' }] },
    ];
    const file = (mpn, kind, pins, values, domains) => ({ schema: 'pincheck.part/1', id: mpn.toLowerCase(), mpn, kind, match: [], pins, values, domains, datasheet: {} });
    const lib2 = [
      file('GATE1', 'logic', [{ num: '1', name: 'A', role: 'input', domain: 'VCC' }, { num: '2', name: 'GND', role: 'ground' }, { num: '3', name: 'Y', role: 'output', domain: 'VCC' }, { num: '4', name: 'VCC', role: 'power-in', domain: 'VCC' }],
        [{ k: 'supply.range', on: 'VCC', min: 1.65, max: 5.5, unit: 'V', ok: { by: 't' } }], ['VCC']),
      file('LDO33', 'regulator', [{ num: '1', name: 'IN', role: 'power-in', domain: 'IN' }, { num: '2', name: 'GND', role: 'ground' }, { num: '3', name: 'OUT', role: 'power-out' }],
        [{ k: 'reg.vout', min: 3.25, typ: 3.3, max: 3.35, unit: 'V', ok: { by: 't' } }, { k: 'reg.cout', min: 1e-6, unit: 'F' }], ['IN']),
      file('MCU1', 'mcu', [{ num: '1', name: 'VDD', role: 'power-in', domain: 'VDD' }, { num: '2', name: 'VSS', role: 'ground' }, { num: '3', name: 'PA0', role: 'io', domain: 'VDD' }, { num: '4', name: 'VBAT', role: 'power-in', domain: 'VBAT' }],
        [{ k: 'supply.range', on: 'VDD', min: 1.7, max: 3.6, unit: 'V', ok: { by: 't' } }, { k: 'io.absmax', on: 'VDD', value: 'VDD+0.3', unit: 'V', ok: { by: 't' } }], ['VDD', 'VBAT']),
    ];
    return { design: { parts, nets, sheets: [], notes: [] }, lib: lib2 };
  })();
  t('checks: a made-up board with planted faults', () => {
    const r = CK.run(mini.design, mini.lib);
    const has = (check, re, sev) => r.findings.some(f => f.check === check && re.test(f.title) && (!sev || f.severity === sev));
    ok(has('supply.ground', /U1 GND .* is on \+5V, not ground/, 'error'), 'reversed gate supply: GND on +5V');
    ok(has('supply.range', /U1 VCC .* at 0 V/, 'error'), 'reversed gate supply: VCC on ground');
    ok(has('supply.unpowered', /U3 VBAT .* not connected/, 'error'), 'VBAT open');
    ok(has('io.absmax', /U3 PA0 .* sees 5 V, above its 3\.6 V/, 'error'), 'PA0 pulled to 5 V');
    ok(has('parts.regulator', /U2 output has 100 nF, below the 1 µF minimum/, 'warn'), 'output capacitor below the minimum');
    eq(+r.rails.find(x => x.net === 'NetU2_3').v.toFixed(2), 3.3, 'the LDO output net');
    ok(!r.findings.some(f => f.check === 'supply.range' && /U3 VDD/.test(f.title)), 'U3 VDD at 3.3 V is fine');
  });
  t('checks: an unverified value turns an error into a warning that names it', () => {
    const lib2 = JSON.parse(JSON.stringify(mini.lib));
    delete lib2[2].values.find(v => v.k === 'io.absmax').ok;
    const f = CK.run(mini.design, lib2).findings.find(x => x.check === 'io.absmax');
    eq([f.severity, f.unverified], ['warn', true]); ok(/unverified MCU1 io\.absmax \(VDD\)/.test(f.detail));
  });
  t('XML reader: entities and CDATA', () => {
    const d = PK.kicad.xml('<a x="1 &amp; 2"><b>&lt;3</b><![CDATA[<raw>]]></a>');
    eq(d.kids[0].attrs.x, '1 & 2'); eq(d.kids[0].kids[0].text, '<3'); eq(d.kids[0].text, '<raw>');
  });

  for (const [name, fn] of tests) {
    try { await fn(); out.push('✓ ' + name); } catch (e) { fails.push(name); out.push('✕ ' + name + '\n    ' + e.message); }
  }
  document.getElementById('out').textContent = out.join('\n') + '\n\n' + (tests.length - fails.length) + ' of ' + tests.length + ' passed';
  document.title = fails.length ? 'FAIL' : 'PASS';
})().catch(e => { document.getElementById('out').textContent = 'ERROR ' + e.stack; document.title = 'ERROR'; });
