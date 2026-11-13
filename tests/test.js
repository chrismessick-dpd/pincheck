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
    eq(design.source, 'kicad'); eq(design.parts.length, 40); eq(design.nets.length, 34);
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
  t('connectors: the demo\'s STDC14 header has its VCP crossed, and its USB-C input has no protection', async () => {
    const conn = await (await fetch('../demo/connectors.json')).json();
    const prof = await (await fetch('../interfaces/st-stdc14.json')).json();
    const r = CK.run(design, lib, { assign: conn.connectors, profiles: { 'st-stdc14': prof } });
    const m = r.findings.filter(f => f.check === 'conn.mate');
    eq(m.map(f => f.pins[0]), ['J5.13', 'J5.14'], 'pins 13 and 14, nothing else');
    ok(m.every(f => f.severity === 'warn' && f.unverified && /likely swapped/.test(f.detail)), 'warnings while the profile is unverified, naming the swap');
    ok(CK.run(design, lib, { assign: conn.connectors, profiles: { 'st-stdc14': Object.assign({}, prof, { ok: { by: 't' } }) } }).findings.filter(f => f.check === 'conn.mate').every(f => f.severity === 'error'), 'errors once verified');
    ok(r.findings.some(f => f.check === 'power.protection' && /^J3's 4\.75 to 5\.25 V input has no fuse, TVS, or reverse-polarity protection/.test(f.title)), 'J3 unprotected');
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
    ok(has('supply.unpowered', /U3 VBAT .* not connected/, 'error'), 'VBAT open is an error, waivable (Chris)');
    ok(has('io.absmax', /U3 PA0 .* sees 5 V, above its 3\.6 V/, 'error'), 'PA0 pulled to 5 V');
    ok(has('parts.regulator', /U2 output has 100 nF, below the 1 µF minimum/, 'warn'), 'output capacitor below the minimum');
    eq(+r.rails.find(x => x.net === 'NetU2_3').v.toFixed(2), 3.3, 'the LDO output net');
    ok(!r.findings.some(f => f.check === 'supply.range' && /U3 VDD/.test(f.title)), 'U3 VDD at 3.3 V is fine');
  });
  t('checks: an MCU with its SMPS input and switch pins swapped', () => {
    const pin = (num, name, type) => ({ num, name, type });
    const design2 = { sheets: [], notes: [], parts: [
      { ref: 'U1', mpn: 'MCU2', kind: 'ic', params: {}, pins: [pin('1', 'VDD', 'power'), pin('2', 'VSS', 'power'), pin('3', 'VLXSMPS', 'power'), pin('4', 'VDDSMPS', 'power'), pin('5', 'VCAP', 'power'), pin('6', 'VBAT', 'power')] },
      { ref: 'L1', mpn: '', kind: 'inductor', params: { Value: '2.2uH' }, pins: [pin('1', '1', 'passive'), pin('2', '2', 'passive')] },
      { ref: 'C1', mpn: '', kind: 'capacitor', params: { Value: '220pF' }, pins: [pin('1', '1', 'passive'), pin('2', '2', 'passive')] },
    ], nets: [
      { name: '+3V3', nodes: [{ ref: 'U1', pin: '1' }, { ref: 'U1', pin: '3' }] },  // VLXSMPS on the rail: swapped
      { name: 'GND', nodes: [{ ref: 'U1', pin: '2' }, { ref: 'C1', pin: '2' }] },
      { name: 'NetC1_1', nodes: [{ ref: 'U1', pin: '4' }, { ref: 'C1', pin: '1' }, { ref: 'L1', pin: '1' }] }, // VDDSMPS between L1 and C1
      { name: 'VCAP', nodes: [{ ref: 'L1', pin: '2' }, { ref: 'U1', pin: '5' }] },
    ] };
    const lib2 = [{ schema: 'pincheck.part/1', id: 'mcu2', mpn: 'MCU2', kind: 'mcu', match: [], datasheet: {}, domains: ['VDD', 'VDDSMPS', 'VBAT'], values: [], pins: [
      { num: '1', name: 'VDD', role: 'power-in', domain: 'VDD' }, { num: '2', name: 'VSS', role: 'ground' }, { num: '3', name: 'VLXSMPS', role: 'switch', ext: '2.2 µH inductor to VCAP' },
      { num: '4', name: 'VDDSMPS', role: 'power-in', domain: 'VDDSMPS', ext: '4.7 µF to GND' }, { num: '5', name: 'VCAP', role: 'power-out' }, { num: '6', name: 'VBAT', role: 'power-in', domain: 'VBAT' }] }];
    const r = CK.run(design2, lib2);
    const has = (check, re, sev) => r.findings.some(f => f.check === check && re.test(f.title) && f.severity === sev);
    ok(has('supply.switchnode', /U1 VLXSMPS .*switch node, is on the rail \+3V3/, 'error'), 'VLXSMPS on a rail');
    ok(has('supply.unpowered', /U1 VDDSMPS .* is not on a supply rail/, 'error'), 'VDDSMPS not on a rail (its own VCAP through L1 doesn\'t count)');
    ok(has('supply.unpowered', /U1 VBAT .* not connected \(backup supply\)/, 'error'), 'VBAT open is an error');
    ok(!r.findings.some(f => f.check === 'parts.ext' && /VLXSMPS wants/.test(f.title)), 'no inductor-value noise on a switch pin already on a rail');
  });
  t('checks: an unverified value turns an error into a warning that names it', () => {
    const lib2 = JSON.parse(JSON.stringify(mini.lib));
    delete lib2[2].values.find(v => v.k === 'io.absmax').ok;
    const f = CK.run(mini.design, lib2).findings.find(x => x.check === 'io.absmax');
    eq([f.severity, f.unverified], ['warn', true]); ok(/unverified MCU1 io\.absmax \(VDD\)/.test(f.detail));
  });
  // A made-up board for the false alarms a real board turned up (2026-11-13): rails named V1.8CORE, a fixed
  // regulator sensing its output on FB, a pad numbered PAD in the file and 9 on the symbol, a gauge fed through a
  // 10 Ω filter from a connector classed an IC by its name, caps past a 0 Ω link, notes with limits and options, and a USB supply with USB unused.
  const quirks = () => {
    const pin = (num, name, type) => ({ num, name, type });
    const two = (ref, kind, value) => ({ ref, mpn: '', kind, params: { Value: value }, pins: [pin('1', '1', 'passive'), pin('2', '2', 'passive')] });
    const parts = [
      { ref: 'U1', mpn: 'FIXREG', kind: 'ic', params: {}, pins: [pin('1', 'VIN', 'power'), pin('2', 'GND', 'power'), pin('3', 'SW', 'output'), pin('4', 'FB', 'input'), pin('9', 'EXP', 'passive')] },
      { ref: 'U2', mpn: 'GAUGE', kind: 'ic', params: {}, pins: [pin('1', 'BATT', 'power'), pin('2', 'CP', 'passive'), pin('3', 'CFG', 'input'), pin('4', 'GND', 'power'), pin('5', 'DVDT', 'passive')] },
      { ref: 'U3', mpn: 'MCU2', kind: 'ic', params: {}, pins: [pin('1', 'VDD', 'power'), pin('2', 'VDDUSB', 'power'), pin('3', 'PA11', 'io'), pin('4', 'VSS', 'power')] },
      { ref: 'JUSB1', mpn: 'HDR2', kind: 'ic', params: {}, pins: [pin('1', '1', 'passive'), pin('2', '2', 'passive')] },
      two('L1', 'inductor', '2.2uH'), two('R1', 'resistor', '0'), two('R2', 'resistor', '10 Ohms'), two('C1', 'capacitor', '10uF'),
      two('C2', 'capacitor', '0.1uF'), two('C3', 'capacitor', '1uF'), two('R3', 'resistor', '10k'),
    ];
    const nets = [
      { name: 'VBAT_WIRE', nodes: [{ ref: 'JUSB1', pin: '1' }, { ref: 'R2', pin: '1' }, { ref: 'U1', pin: '1' }] },
      { name: 'GND', nodes: [{ ref: 'JUSB1', pin: '2' }, { ref: 'U1', pin: '2' }, { ref: 'U1', pin: '9' }, { ref: 'U2', pin: '4' }, { ref: 'U3', pin: '4' }, { ref: 'C1', pin: '2' }, { ref: 'C3', pin: '2' }, { ref: 'R3', pin: '2' }] },
      { name: 'SW1', nodes: [{ ref: 'U1', pin: '3' }, { ref: 'L1', pin: '1' }] },
      { name: 'NetFB', nodes: [{ ref: 'U1', pin: '4' }, { ref: 'L1', pin: '2' }, { ref: 'C1', pin: '1' }, { ref: 'R1', pin: '1' }] },
      { name: 'V1.8CORE', nodes: [{ ref: 'R1', pin: '2' }, { ref: 'U3', pin: '1' }, { ref: 'U3', pin: '2' }] },
      { name: 'VBAT_CHG', nodes: [{ ref: 'R2', pin: '2' }, { ref: 'U2', pin: '1' }, { ref: 'C2', pin: '2' }, { ref: 'C3', pin: '1' }] },
      { name: 'CP_CHG', nodes: [{ ref: 'U2', pin: '2' }, { ref: 'C2', pin: '1' }] },
      { name: 'CFG', nodes: [{ ref: 'U2', pin: '3' }, { ref: 'R3', pin: '1' }] },
      { name: 'AMISO', nodes: [{ ref: 'U3', pin: '3' }] },
    ];
    const ok_ = { by: 't' };
    const file = (mpn, kind, pins, values, domains) => ({ schema: 'pincheck.part/1', id: mpn.toLowerCase(), mpn, kind, match: [], pins, values, domains, datasheet: {} });
    const lib2 = [
      file('FIXREG', 'regulator', [{ num: '1', name: 'VIN', role: 'power-in', domain: 'VIN' }, { num: '2', name: 'GND', role: 'ground' }, { num: '3', name: 'SW', role: 'switch', ext: 'Inductor to VOUT, 1 µH or 2.2 µH (effective 0.7 µH to 4.3 µH)' }, { num: '4', name: 'FB', role: 'feedback' }, { num: 'PAD', name: 'Thermal Pad', role: 'pad' }],
        [{ k: 'reg.vout', typ: 1.8, unit: 'V', ok: ok_ }], ['VIN']),
      file('GAUGE', 'ic', [{ num: '1', name: 'BATT', role: 'power-in', domain: 'BATT' }, { num: '2', name: 'CP', role: 'other', ext: '0.1 µF between CP and BATT, 10 V rating minimum' }, { num: '3', name: 'CFG', role: 'input', domain: 'BATT', ext: 'Resistor to GND, ≤ 10 pF on the pin' }, { num: '4', name: 'GND', role: 'ground' }, { num: '5', name: 'DVDT', role: 'other', ext: 'Optional CdVdt to GND; add 100 Ω in series above 10 nF' }],
        [], ['BATT']),
      file('MCU2', 'mcu', [{ num: '1', name: 'VDD', role: 'power-in', domain: 'VDD' }, { num: '2', name: 'VDDUSB', role: 'power-in', domain: 'VDDUSB' }, { num: '3', name: 'PA11', role: 'io', domain: 'VDD', functions: ['USB_DM', 'SPI1_MISO'] }, { num: '4', name: 'VSS', role: 'ground' }],
        [{ k: 'supply.range', on: 'VDDUSB', min: 3, max: 3.6, unit: 'V', cond: 'USB used', ok: ok_ }, { k: 'supply.tied', list: ['VDDUSB to VDD (or VSS) when USB is unused'], ok: ok_ }, { k: 'dec.c', on: 'VDD', value: 1e-6, unit: 'F', ok: ok_ }], ['VDD', 'VDDUSB']),
      // A connector named JUSB1 is classed an IC by its designator; its part file says connector, so it still feeds a rail.
      file('HDR2', 'connector', [{ num: '1', name: '1', role: 'other' }, { num: '2', name: '2', role: 'other' }], [], []),
    ];
    return { design: { parts, nets, sheets: [], notes: [] }, lib: lib2 };
  };
  t('checks: rail names, a fixed output on FB, pads, series feeds, 0 Ω links, and notes read as written', () => {
    const q = quirks(), r = CK.run(q.design, q.lib);
    const v = n => (r.rails.find(x => x.net === n) || {}).v;
    eq([v('V1.8CORE'), v('NetFB')], [1.8, 1.8], 'V1.8CORE by name, NetFB from FIXREG on its FB pin');
    eq(['V3.3IO', 'V1.8MCU', '+V1.8_INT', 'V5USB', 'SMPS1.8'].map(CK.voltageFromName), [3.3, 1.8, 1.8, null, null]);
    // Its connector feeding a regulator directly is a power.protection note since 2026-11-13, not what this board tests.
    const left = r.findings.filter(f => !/^library\./.test(f.check) && f.check !== 'power.protection').map(f => f.check + ': ' + f.title);
    eq(left, [], 'nothing to report');
    // Take C2 away and the CP note is checked between CP and BATT, not to ground.
    q.design.nets.find(n => n.name === 'CP_CHG').nodes.pop(); q.design.nets.find(n => n.name === 'VBAT_CHG').nodes.splice(2, 1);
    ok(CK.run(q.design, q.lib).findings.some(f => f.check === 'parts.ext' && /U2 CP needs 100 nF to BATT; there is none/.test(f.title)), 'missing CP capacitor');
    // USB wired: PA11 meets a USB_DM pin, so VDDUSB at 1.8 V is out of range.
    const q2 = quirks(); q2.design.nets.find(n => n.name === 'AMISO').name = 'USB_DM';
    ok(CK.run(q2.design, q2.lib).findings.some(f => f.check === 'supply.range' && /VDDUSB/.test(f.title)), 'VDDUSB checked when USB is wired');
  });
  // Checks a Claude scan of a real board taught the offline check (docs/learned.md, scan 20261113-2223). Every board
  // here is made up; each test fails without its check.
  const sb = (() => {
    const pin = (num, name, type) => ({ num: String(num), name, type: type || 'passive' });
    const part = (ref, mpn, kind, names, params) => ({ ref, mpn, kind, params: params || {}, pins: names.map((n, i) => pin(i + 1, n)) });
    const two = (ref, kind, value, params) => ({ ref, mpn: '', kind, params: Object.assign({ Value: value }, params || {}), pins: [pin(1, '1'), pin(2, '2')] });
    const file = (mpn, kind, pins, values, extra) => Object.assign({ schema: 'pincheck.part/1', id: mpn.toLowerCase(), mpn, kind, match: [], datasheet: {}, domains: [...new Set(pins.filter(p => p.domain).map(p => p.domain))], pins, values: values || [] }, extra || {});
    const fp = (num, name, role, domain, extra) => Object.assign({ num: String(num), name, role }, domain ? { domain } : {}, extra || {});
    const nets = obj => Object.entries(obj).map(([name, nodes]) => ({ name, nodes: nodes.map(s => { const [ref, p] = s.split('.'); return { ref, pin: p }; }) }));
    const design = (parts, n, extra) => Object.assign({ parts, nets: nets(n), sheets: [], notes: [] }, extra || {});
    const okv = { by: 't' };
    const has = (r, check, re, sev) => r.findings.find(f => f.check === check && re.test(f.title) && (!sev || f.severity === sev));
    return { pin, part, two, file, fp, nets, design, okv, has };
  })();

  t('scan: a 0 Ω jumper is a link, and a regulator it holds off makes no rail and only notes', () => {
    const { part, two, file, fp, design, okv, has } = sb;
    const build = desc => design([
      part('U1', 'REG1', 'ic', ['VIN', 'GND', 'EN', 'VOUT']),
      Object.assign(part('Y1', '', 'crystal', ['1', '2', '3'], { Comment: '0', Description: desc })),
      two('C1', 'capacitor', '1uF'),
    ], { '+5V': ['U1.1', 'Y1.3'], GND: ['U1.2', 'Y1.2', 'C1.2'], EN_X: ['U1.3', 'Y1.1'], OUT_X: ['U1.4', 'C1.1'] });
    const lib = [file('REG1', 'regulator', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground'), fp(3, 'EN', 'enable', 'VIN'), fp(4, 'VOUT', 'power-out')],
      [{ k: 'reg.vout', typ: 3.3, unit: 'V', ok: okv }, { k: 'reg.cout', min: 10e-6, unit: 'F', ok: okv }])];
    const off = CK.run(build('3pin 0402 with 1-2 connected with 0 ohm'), lib);
    ok(!off.findings.some(f => f.check === 'library.coverage' && f.refs.includes('Y1')), 'a jumper needs no part file');
    ok(has(off, 'parts.regulator', /U1 is fitted but held off: its EN is on EN_X/, 'warn'), 'held off');
    eq(has(off, 'parts.regulator', /U1 output has 1 µF/).severity, 'info', 'its capacitor finding is a note');
    ok(!off.rails.some(r => r.net === 'OUT_X'), 'no rail from a regulator held off');
    const on = CK.run(build('3pin 0402 with 1-3 connected with 0 ohm'), lib);
    ok(!has(on, 'parts.regulator', /held off/) && on.rails.some(r => r.net === 'OUT_X' && r.v === 3.3), 'jumped 1-3: EN on +5V, running');
    eq(has(on, 'parts.regulator', /U1 output has 1 µF/).severity, 'warn');
    eq(D.classify({ ref: 'Y3', pins: [{}, {}, {}], params: { Comment: '0' } }), 'other', 'a zero-valued Y is not a crystal');
  });

  t('scan: two names on one wire, and an unpowered supply pin names its power port and its tie', () => {
    const { part, two, file, fp, design, okv, has } = sb;
    const d = design([part('U1', 'MCU9', 'ic', ['VDD', 'VSS', 'VDDSMPS']), two('C1', 'capacitor', '10uF')],
      { '+3V3': ['U1.1'], GND: ['U1.2', 'C1.2'], VSMPS_IN: ['U1.3', 'C1.1'] },
      { drawings: [{ name: 'MCU.SchDoc', pins: [{ ref: 'U1', num: '3', x: 100, y: 0 }, { ref: 'C1', num: '1', x: 200, y: 0 }], wires: [[100, 0, 200, 0]], junctions: [], labels: [{ x: 120, y: 0, text: 'VSMPS_IN' }], powers: [{ x: 160, y: 0, text: 'VDD_CORE' }], ports: [], sheets: [] }] });
    const lib = [file('MCU9', 'mcu', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'VSS', 'ground'), fp(3, 'VDDSMPS', 'power-in', 'VDDSMPS')], [{ k: 'supply.tied', list: ['VDDSMPS to VDD (SMPS used)'], ok: okv }])];
    const r = CK.run(d, lib);
    ok(has(r, 'nets.names', /VSMPS_IN also carries VDD_CORE/, 'warn'), 'two names');
    const u = has(r, 'supply.unpowered', /U1 VDDSMPS .* not on a supply rail: tie it to VDD \(\+3V3\)/, 'error');
    ok(u && /power port VDD_CORE, which nothing else in the design is on/.test(u.detail), 'names the lonely power port');
  });

  t('scan: nets that reach nothing, two pull-ups, and BOM fields that disagree', () => {
    const { part, two, file, fp, design, has } = sb;
    const tp = { ref: 'TP1', mpn: '', kind: 'other', params: { Footprint: 'TP_1P0MM' }, pins: [{ num: '1', name: '1' }] };
    const d = design([part('J1', 'HDR4', 'connector', ['1', '2', '3', '4']), tp, part('U9', 'ESD4', 'ic', ['IO1', 'GND', 'NC6']),
      two('R1', 'resistor', '100k'), two('R2', 'resistor', '200k'), part('U2', 'LOGIC1', 'ic', ['A', 'VCC', 'GND']),
      two('C5', 'capacitor', '470nF', { Comment: '0.1uF 6.3V' }), two('R5', 'resistor', '?'), part('U3', 'ABC1234', 'ic', ['1', '2', '3', '4', '5'], { Value: 'XYZ9876' })],
      { MIC_DATA: ['J1.1', 'TP1.1'], UNUSED_IN: ['U9.1', 'U9.3'], GND: ['U9.2', 'U2.3', 'J1.4'], INT_N: ['U2.1', 'R1.1', 'R2.1'], '+3V3': ['R1.2', 'R2.2', 'U2.2'] });
    const lib = [file('ESD4', 'protection', [fp(1, 'IO1', 'io'), fp(2, 'GND', 'ground'), fp(3, 'NC6', 'nc')])];
    const r = CK.run(d, lib);
    ok(has(r, 'nets.dangling', /MIC_DATA reaches only J1 pin 1 and test points/, 'warn'), 'connector and a test point');
    ok(has(r, 'nets.dangling', /UNUSED_IN reaches only U9, a protection part/, 'info'), 'an ESD channel to nothing');
    ok(has(r, 'nets.pulls', /INT_N has 2 pull resistors to \+3V3/, 'info'), 'two pull-ups');
    ok(has(r, 'parts.fields', /C5: its Value says 470 nF and its Comment 100 nF/, 'warn'), 'capacitor fields');
    ok(has(r, 'parts.fields', /R5: its value is "\?"/, 'warn'), 'no value');
    ok(has(r, 'parts.fields', /U3: its Value says XYZ9876 but its part number is ABC1234/, 'warn'), 'IC value names another part');
  });

  t('scan: I2C pull-ups, off the board with the voltage window, or missing', () => {
    const { part, two, file, fp, design, has } = sb;
    const lib = [file('SENS1', 'sensor', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'GND', 'ground'), fp(3, 'SDA', 'open-drain', 'VDD', { absmax: 2.2 }), fp(4, 'SCL', 'input', 'VDD', { absmax: 2.2 })], [{ k: 'io.vih', on: 'VDD', value: 1.05, unit: 'V', ok: { by: 't' } }])];
    const off = CK.run(design([part('U1', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL']), part('J1', 'HDR4', 'connector', ['1', '2', '3', '4'])],
      { '+1V8': ['U1.1', 'J1.1'], GND: ['U1.2', 'J1.4'], SDA_A: ['U1.3', 'J1.2'], SCL_A: ['U1.4', 'J1.3'] }), lib);
    const f = has(off, 'func.i2cpull', /SDA_A and SCL_A have no pull-ups on this board/, 'warn');
    ok(f && /between 1\.05 V .* and 2\.2 V/.test(f.detail), 'the window: highest VIH to lowest maximum');
    const none = CK.run(design([part('U1', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL']), part('U2', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL'])],
      { '+1V8': ['U1.1', 'U2.1'], GND: ['U1.2', 'U2.2'], SDA_B: ['U1.3', 'U2.3'], SCL_B: ['U1.4', 'U2.4'] }), lib);
    ok(has(none, 'func.i2cpull', /SDA_B and SCL_B have no pull-ups$/, 'error'), 'no pull-ups at all');
    // A resistor array, and a pull-up past a 22 Ω series resistor, are pull-ups.
    const arr = CK.run(design([part('U1', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL']), part('U2', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL']), part('RN1', '', 'resistor', ['1', '2', '3', '4'], { Value: '4.7k' })],
      { '+1V8': ['U1.1', 'U2.1', 'RN1.2', 'RN1.4'], GND: ['U1.2', 'U2.2'], SDA_C: ['U1.3', 'U2.3', 'RN1.1'], SCL_C: ['U1.4', 'U2.4', 'RN1.3'] }), lib);
    ok(!arr.findings.some(f => f.check === 'func.i2cpull'), 'a resistor array pulls up');
    const ser = CK.run(design([part('U1', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL']), part('U2', 'SENS1', 'ic', ['VDD', 'GND', 'SDA', 'SCL']), two('R1', 'resistor', '22'), two('R2', 'resistor', '22'), two('R3', 'resistor', '4.7k'), two('R4', 'resistor', '4.7k')],
      { '+1V8': ['U1.1', 'U2.1', 'R3.2', 'R4.2'], GND: ['U1.2', 'U2.2'], SDA_D: ['U1.3', 'R1.1'], SDA_E: ['R1.2', 'U2.3', 'R3.1'], SCL_D: ['U1.4', 'R2.1'], SCL_E: ['R2.2', 'U2.4', 'R4.1'] }), lib);
    ok(!ser.findings.some(f => f.check === 'func.i2cpull'), 'pull-ups past 22 Ω series resistors');
  });

  t('scan: debug header without reset, unprotected power into an eFuse, limits above contacts, and load lines', () => {
    const { part, two, file, fp, design, has } = sb;
    const d = design([
      part('J2', 'TAG4', 'connector', ['VREF', 'SWDIO', 'SWCLK', 'GND']), part('J3', 'PWR2', 'connector', ['1', '2']), part('U5', 'EFUSE1', 'ic', ['IN', 'OUT', 'ILM', 'GND']),
      two('R9', 'resistor', '1k'), part('U6', 'LDO1', 'ic', ['IN', 'GND', 'OUT']), part('J4', 'FLEX4', 'connector', ['1', '2', '3', '4']), two('C6', 'capacitor', '1uF')],
      { '+3V3': ['J2.1'], AR_SWDIO: ['J2.2'], AR_SWCLK: ['J2.3'], GND: ['J2.4', 'J3.2', 'U5.4', 'R9.2', 'U6.2', 'J4.4', 'C6.2'], VIN_RAW: ['J3.1', 'U5.1'], VOUT_F: ['U5.2'], ILM_N: ['U5.3', 'R9.1'],
        CAM_IN: ['J4.1', 'U6.1'], CAM_OUT: ['U6.3', 'C6.1'], SPK_OUTP: ['J4.2'] });
    const lib = [
      file('EFUSE1', 'switch', [fp(1, 'IN', 'power-in', 'IN'), fp(2, 'OUT', 'power-out'), fp(3, 'ILM', 'analog'), fp(4, 'GND', 'ground')], [{ k: 'sw.ilim', min: 0.5, max: 6, unit: 'A', note: 'RILM (Ω) = 3334 / ILIM (A)' }]),
      file('LDO1', 'regulator', [fp(1, 'IN', 'power-in', 'IN'), fp(2, 'GND', 'ground'), fp(3, 'OUT', 'power-out')], [{ k: 'reg.iout', value: 0.4, unit: 'A' }, { k: 'reg.vout', typ: 0.9, unit: 'V' }]),
      file('PWR2', 'connector', [fp(1, '1', 'other'), fp(2, '2', 'other')], [{ k: 'rate.i', value: 2, unit: 'A' }]),
      file('FLEX4', 'connector', [1, 2, 3, 4].map(n => fp(n, String(n), 'other')), [{ k: 'rate.i', value: 0.3, unit: 'A' }]),
    ];
    const r = CK.run(d, lib);
    ok(has(r, 'conn.mate', /J2 carries AR_SWDIO and AR_SWCLK but no reset/, 'warn'), 'debug header without reset');
    ok(has(r, 'power.protection', /J3 brings VIN_RAW into U5 with no TVS or input capacitor/, 'warn'), 'unprotected power into an eFuse');
    ok(has(r, 'power.contacts', /U5's current limit \(about 3\.334 A, up to 3\.667 A\) is above J3's 2 A/, 'warn'), 'limit above the contacts');
    ok(has(r, 'power.contacts', /U6 can draw 400 mA on CAM_IN through 1 of J4's 300 mA contacts/, 'warn'), 'LDO input on one contact');
    ok(has(r, 'power.contacts', /SPK_OUTP crosses J4 on one 300 mA contact/, 'warn'), 'a speaker line');
    ok(!r.findings.some(f => f.check === 'power.protection' && /CAM_IN/.test(f.title) && f.severity === 'warn'), 'a regulator fed from a flex is a note, not a warning');
  });

  t('scan: strapped outputs, an overvoltage trip above the loads, a programmable maximum, a charger, a sense range, and a battery rail', () => {
    const { part, two, file, fp, design, okv, has } = sb;
    const d = design([
      part('U7', 'STRAPREG', 'ic', ['VIN', 'GND', 'SEL', 'CFG1', 'CFG2', 'VOUT']), two('R1', 'resistor', '36.5k'),
      part('U5', 'EFUSE2', 'ic', ['IN', 'OUT', 'OVLO', 'GND']), two('R10', 'resistor', '383k'), two('R11', 'resistor', '100k'),
      part('U8', 'PROGREG', 'ic', ['VIN', 'GND', 'VOUT']), part('U9', 'LOAD5', 'ic', ['VDD', 'GND']),
      part('U10', 'CHG1', 'ic', ['BATT', 'PCKP', 'CSP', 'CSN', 'GND']), two('R12', 'resistor', '0.05'), two('R13', 'resistor', '1k'),
      part('J5', 'BAT2', 'connector', ['1', '2']), { ref: 'D1', mpn: '', kind: 'diode', params: { Value: 'BAT54' }, pins: [sb.pin(1, 'A'), sb.pin(2, 'K')] }],
      { '+5V': ['U7.1', 'U7.3'], GND: ['U7.2', 'R1.2', 'U7.5', 'U5.4', 'R11.2', 'U8.2', 'U9.2', 'U10.5', 'J5.2'], CFG1_N: ['U7.4', 'R1.1'], NODE_OUT: ['U7.6'],
        VBUS_IN: ['U5.1', 'R10.1'], OVLO_N: ['U5.3', 'R10.2', 'R11.1'], VBUS_P: ['U5.2', 'U8.1'],
        SYS: ['U8.3', 'U9.1', 'R13.1', 'D1.2'], PCKP_N: ['U10.2', 'R13.2'], BAT_P: ['J5.1', 'D1.1', 'R12.1', 'U10.3'], CELL: ['R12.2', 'U10.4', 'U10.1'] });
    const lib = [
      file('STRAPREG', 'regulator', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground'), fp(3, 'SEL', 'input', 'VIN'), fp(4, 'CFG1', 'boot'), fp(5, 'CFG2', 'boot'), fp(6, 'VOUT', 'power-out')],
        [{ k: 'reg.vout.strap', list: ['SEL = high, CFG1 = 30.1 kΩ, CFG2 = 0 Ω | 511 Ω: 3.2 V', 'SEL = high, CFG1 = 36.5 kΩ, CFG2 = 0 Ω | 511 Ω: 3.3 V', 'SEL = low, CFG3 = 0 Ω: 1.8 V'], ok: okv }]),
      file('EFUSE2', 'switch', [fp(1, 'IN', 'power-in', 'IN'), fp(2, 'OUT', 'power-out'), fp(3, 'OVLO', 'analog'), fp(4, 'GND', 'ground')], [{ k: 'sw.ovlo', min: 1.183, typ: 1.2, max: 1.223, unit: 'V', ok: okv }]),
      file('PROGREG', 'regulator', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground'), fp(3, 'VOUT', 'power-out')], [{ k: 'reg.vout', typ: 3.3, unit: 'V', cond: 'Power-up default; set by I2C', ok: okv }, { k: 'reg.vout.range', min: 1, max: 5.5, unit: 'V', ok: okv }, { k: 'supply.range', on: 'VIN', min: 1.6, max: 5.5, unit: 'V', ok: okv }]),
      file('LOAD5', 'ic', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'GND', 'ground')], [{ k: 'supply.range', on: 'VDD', min: 2.7, max: 5, unit: 'V', ok: okv }]),
      file('CHG1', 'power', [fp(1, 'BATT', 'power-in', 'BATT'), fp(2, 'PCKP', 'power-in', 'PCKP'), fp(3, 'CSP', 'analog'), fp(4, 'CSN', 'analog'), fp(5, 'GND', 'ground')], [{ k: 'reg.vout.range', min: 3.56, max: 4.835, unit: 'V', ok: okv }, { k: 'sense.vfs', value: 0.0512, unit: 'V', ok: okv }]),
    ];
    const conn = { assign: [{ ref: 'J5', power: { pins: ['1'], return: ['2'], v: { min: 3, max: 4.4 }, i: 1 } }], profiles: {} };
    const r = CK.run(d, lib, conn);
    const rail = n => r.rails.find(x => x.net === n) || {};
    eq(rail('NODE_OUT').v, 3.3, 'the strap line the board matches');
    ok(/strapped SEL high, CFG1 36\.5 kΩ, CFG2 0 Ω/.test(rail('NODE_OUT').from), 'says which straps');
    ok(has(r, 'supply.range', /U5's overvoltage cutoff lets VBUS_P reach 5\.907 V, above U8 VIN's 5\.5 V/, 'warn'), 'OVLO trip above the load');
    ok(has(r, 'supply.range', /U9 VDD .* would be at 5\.5 V if U8 is set to its maximum/, 'warn'), 'programmable maximum');
    ok(has(r, 'supply.charge', /U10 PCKP is fed from U8, which starts at 3\.3 V, below the 3\.56 V charge voltage/, 'warn'), 'charger below its charge voltage');
    ok(has(r, 'parts.sense', /U10 measures and protects up to about 1\.024 A through R12/, 'info'), 'sense range');
    ok(/also J5 power input/.test(rail('SYS').from), 'the battery joins SYS beside U8');
  });

  t('scan: false alarms gone: VOL into CMOS inputs, capacitors that add up, conditional bulk, pin aliases, and default addresses', () => {
    const { part, two, file, fp, design, okv, has } = sb;
    eq(L.pinCheck({ pins: [{ num: '2', name: 'SYNC', aliases: ['MODE'] }, { num: '3', name: 'SW1' }, { num: '5', name: 'PH0-OSC_IN' }, { num: '6', name: 'PGND' }, { num: '7', name: 'SDA' }] },
      { pins: [{ num: '2', name: 'MODE' }, { num: '3', name: 'LX1' }, { num: '5', name: 'PH0 / UNUSED' }, { num: '6', name: 'GND' }, { num: '7', name: 'SCL' }] }).map(m => m.num), ['7'], 'only the real mismatch');
    const mk = withPull => design([part('U1', 'MCU7', 'ic', ['VDD', 'VSS', 'PA2']), part('U2', 'LSW1', 'ic', ['VIN', 'GND', 'ON', 'VOUT']), two('R1', 'resistor', '1k')],
      Object.assign({ '+1V8': ['U1.1'], '+3V3': ['U2.1'], GND: ['U1.2', 'U2.2'], ON_X: ['U1.3', 'U2.3'].concat(withPull ? ['R1.1'] : []), OUT_X: ['U2.4'] }, withPull ? { '+3V3': ['U2.1', 'R1.2'] } : {}));
    const lib = [file('MCU7', 'mcu', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'VSS', 'ground'), fp(3, 'PA2', 'io', 'VDD')], [{ k: 'io.vol', on: 'VDD', value: 0.4, unit: 'V', cond: '|IIO| = 4 mA', ok: okv }]),
      file('LSW1', 'switch', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground'), fp(3, 'ON', 'enable', 'VIN'), fp(4, 'VOUT', 'power-out')], [{ k: 'io.vil', on: 'VIN', value: 0.35, unit: 'V', ok: okv }])];
    ok(!CK.run(mk(false), lib).findings.some(f => f.check === 'io.vil'), 'nanoamps into ON: no VOL worry');
    ok(CK.run(mk(true), lib).findings.some(f => f.check === 'io.vil'), 'a 1 kΩ pull-up sinks 3.3 mA: VOL matters');
    const dc = (bulkCond) => CK.run(design([part('U3', 'BB1', 'ic', ['VIN', 'GND']), two('C1', 'capacitor', '10uF'), two('C2', 'capacitor', '10uF')], { '+5V': ['U3.1', 'C1.1', 'C2.1'], GND: ['U3.2', 'C1.2', 'C2.2'] }),
      [file('BB1', 'ic', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground')], [{ k: 'dec.c', on: 'VIN', value: 22e-6, unit: 'F', ok: okv }, { k: 'dec.bulk', on: 'VIN', value: 47e-6, unit: 'F', cond: bulkCond, ok: okv }])]);
    ok(!dc('').findings.some(f => / wanting /.test(f.title)), 'two 10 µF make up 22 µF');
    eq(has(dc('If the input supply is more than a few centimeters away'), 'parts.decoupling', /less than 47 µF bulk/).severity, 'info', 'conditional bulk is a note');
    eq(has(dc(''), 'parts.decoupling', /less than 47 µF bulk/).severity, 'warn');
    const ad = CK.run(design([part('U4', 'GAUGE2', 'ic', ['SDA', 'GND']), part('U5', 'TYPEC1', 'ic', ['SDA', 'ADR', 'GND']), two('R2', 'resistor', '4.7k')],
      { BUS_SDA: ['U4.1', 'U5.1', 'R2.1'], '+1V8': ['R2.2'], GND: ['U4.2', 'U5.2', 'U5.3'] }),
      [file('GAUGE2', 'power', [fp(1, 'SDA', 'open-drain'), fp(2, 'GND', 'ground')], [{ k: 'i2c.addr', list: ['I2CSid 0b00 (default, nPackCfg 0x2000): primary 0x36, secondary 0x0B', 'I2CSid 0b01: primary 0x76'], ok: okv }]),
        file('TYPEC1', 'interface', [fp(1, 'SDA', 'open-drain'), fp(2, 'ADR', 'boot'), fp(3, 'GND', 'ground')], [{ k: 'i2c.addr', list: ['ADR = 10 kΩ to VDD: 0x3D', 'ADR = 10 kΩ to GND: 0x1D'], ok: okv }])]);
    ok(!ad.findings.some(f => f.check === 'straps.i2c'), 'both addresses worked out, and they differ');
  });

  t('scan: resets and enables nothing here holds, a strap that becomes an output, a reset held by another board, and a reset-time pull-up', () => {
    const { part, two, file, fp, design, okv, has } = sb;
    const d = design([
      part('U1', 'MCU8', 'ic', ['VDD', 'VSS', 'NRST', 'PA2', 'PB4']), part('U2', 'AMP1', 'ic', ['VDD', 'GND', 'RESET']), part('U3', 'LSW2', 'ic', ['VIN', 'GND', 'ON', 'VOUT']),
      part('U4', 'TYPEC2', 'ic', ['VDD', 'ADR', 'GND']), part('U5', 'BUF1', 'ic', ['VCC', 'A', 'Y', 'GND']), two('R1', 'resistor', '100k'),
      part('U6', 'REG18', 'ic', ['VIN', 'GND', 'VOUT']), part('J1', 'FLEX6', 'connector', ['1', '2', '3', '4', '5', '6']), part('J9', 'PWR2', 'connector', ['1', '2'])],
      { '+5V': ['U6.1', 'J9.1'], '+1V8': ['U6.3', 'U1.1', 'U2.1', 'U3.1', 'U4.1', 'U5.1'], GND: ['U1.2', 'U2.2', 'U3.2', 'U4.3', 'U5.4', 'U6.2', 'J1.5', 'U4.2', 'J9.2'],
        RST_X: ['U2.3', 'J1.1'], ON_X: ['U1.4', 'U3.3'], NRST: ['U1.3', 'U5.3'], BUF_A: ['U5.2', 'R1.1'], '1V8_EXT': ['R1.2', 'J1.2'],
        SENS_RST: ['U1.5', 'J1.3'], V1V8_SW: ['U3.4', 'J1.4'] });
    const lib = [
      file('MCU8', 'mcu', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'VSS', 'ground'), fp(3, 'NRST', 'reset', 'VDD'), fp(4, 'PA2', 'io', 'VDD'), fp(5, 'PB4', 'io', 'VDD', { reset: 'pull-up', functions: ['NJTRST'] })]),
      file('AMP1', 'ic', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'GND', 'ground'), fp(3, 'RESET', 'reset', 'VDD')]),
      file('LSW2', 'switch', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground'), fp(3, 'ON', 'enable', 'VIN'), fp(4, 'VOUT', 'power-out')], [{ k: 'en.default', text: 'Smart pull-down holds ON low until driven high, then released', ok: okv }]),
      file('TYPEC2', 'interface', [fp(1, 'VDD', 'power-in', 'VDD'), fp(2, 'ADR', 'boot', 'VDD', { functions: ['ADR strap at power-up', 'CON_DET output after the strap is latched'] }), fp(3, 'GND', 'ground')]),
      file('BUF1', 'logic', [fp(1, 'VCC', 'power-in', 'VCC'), fp(2, 'A', 'input', 'VCC'), fp(3, 'Y', 'open-drain', 'VCC'), fp(4, 'GND', 'ground')]),
      file('REG18', 'regulator', [fp(1, 'VIN', 'power-in', 'VIN'), fp(2, 'GND', 'ground'), fp(3, 'VOUT', 'power-out')], [{ k: 'reg.vout', typ: 1.8, unit: 'V', ok: okv }]),
      file('FLEX6', 'connector', [1, 2, 3, 4, 5, 6].map(n => fp(n, String(n), 'other'))),
    ];
    const r = CK.run(d, lib);
    ok(has(r, 'pins.float', /U2 RESET \(pin 3\) is driven only through J1/, 'warn'), 'reset only from the other board');
    ok(has(r, 'pins.float', /U3 ON \(pin 3\) floats while U1 is in reset/, 'warn'), 'enable only from an MCU pin, smart pull-down');
    ok(has(r, 'straps.output', /U4 ADR is tied straight to GND/, 'warn'), 'strap that becomes an output');
    ok(has(r, 'io.unpowered', /U1 is held in reset whenever 1V8_EXT is off: U5's input is pulled up only to it/, 'warn'), 'reset held by another board\'s rail');
    ok(has(r, 'io.unpowered', /U1 PB4 pulls up from reset into J1, whose rail V1V8_SW is switched/, 'info'), 'reset-time pull-up into a switched rail');
  });

  // Connectors (docs/connectors.md): a made-up 14-pin debug header with its VCP crossed, and a 20–28 V input.
  const connBoard = () => {
    const pin = (num, name, type) => ({ num, name, type: type || 'passive' });
    const two = (ref, kind, value, mpn) => ({ ref, mpn: mpn || '', kind, params: { Value: value }, pins: [pin('1', '1'), pin('2', '2')] });
    const parts = [
      { ref: 'U1', mpn: 'MCU9', kind: 'ic', params: {}, pins: [pin('1', 'VDD', 'power'), pin('2', 'VSS', 'power'), pin('3', 'PA13'), pin('4', 'PA14'), pin('5', 'PA2'), pin('6', 'PA3'), pin('7', 'NRST'), pin('8', 'PB7')] },
      { ref: 'U2', mpn: 'BUCK', kind: 'ic', params: {}, pins: [pin('1', 'VIN', 'power'), pin('2', 'GND', 'power')] },
      { ref: 'J5', mpn: 'HDR14', kind: 'connector', params: {}, pins: Array.from({ length: 14 }, (_, i) => pin(String(i + 1), String(i + 1))) },
      { ref: 'J1', mpn: 'BARREL', kind: 'connector', params: {}, pins: [pin('1', '1'), pin('2', '2')] },
      two('F1', 'other', '2A', 'FUSE2A'), two('R9', 'resistor', '22R'), two('D1', 'diode', 'SMAJ24A', 'SMAJ24A'),
      { ref: 'Q1', mpn: 'PFET', kind: 'transistor', params: {}, pins: [pin('1', 'G'), pin('2', 'S'), pin('3', 'D')] },
    ];
    const N = (name, ...nodes) => ({ name, nodes: nodes.map(s => { const [ref, p] = s.split('.'); return { ref, pin: p }; }) });
    const nets = [
      N('3V3', 'U1.1', 'J5.3'), N('GND', 'U1.2', 'U2.2', 'J5.5', 'J5.7', 'J5.11', 'J1.2', 'D1.2', 'Q1.1'),
      N('SWDIO', 'U1.3', 'J5.4'), N('SWCLK', 'U1.4', 'J5.6'),
      N('VCP_A', 'U1.5', 'R9.1'), N('VCP_A2', 'R9.2', 'J5.14'), N('VCP_B', 'U1.6', 'J5.13'), N('NRST', 'U1.7', 'J5.12'),
      N('VIN_RAW', 'J1.1', 'F1.1'), N('VIN_F', 'F1.2', 'D1.1', 'Q1.2'), N('24V', 'Q1.3', 'U2.1'),
    ];
    const ok_ = { by: 't' };
    const file = (mpn, kind, pins, values) => ({ schema: 'pincheck.part/1', id: mpn.toLowerCase(), mpn, kind, match: [], pins, values: values || [], domains: ['VDD'], datasheet: {} });
    const lib2 = [
      file('MCU9', 'mcu', [{ num: '1', name: 'VDD', role: 'power-in', domain: 'VDD' }, { num: '2', name: 'VSS', role: 'ground' },
        { num: '3', name: 'PA13', role: 'io', domain: 'VDD', functions: ['SWDIO AF0'] }, { num: '4', name: 'PA14', role: 'io', domain: 'VDD', functions: ['SWCLK AF0'] },
        { num: '5', name: 'PA2', role: 'io', domain: 'VDD', functions: ['USART2_TX AF1'] }, { num: '6', name: 'PA3', role: 'io', domain: 'VDD', functions: ['USART2_RX AF1'] },
        { num: '7', name: 'NRST', role: 'reset', domain: 'VDD' }, { num: '8', name: 'PB7', role: 'io', domain: 'VDD', functions: ['USART1_RX AF0'] }]),
      file('BUCK', 'regulator', [{ num: '1', name: 'VIN', role: 'power-in', domain: 'VIN' }, { num: '2', name: 'GND', role: 'ground' }], [{ k: 'supply.range', on: 'VIN', min: 4.5, max: 26, unit: 'V', ok: ok_ }]),
      file('BARREL', 'connector', [{ num: '1', name: '1', role: 'other' }, { num: '2', name: '2', role: 'other' }], [{ k: 'rate.i', value: 1.5, unit: 'A', ok: ok_ }]),
      file('SMAJ24A', 'protection', [{ num: '1', name: 'K', role: 'other' }, { num: '2', name: 'A', role: 'other' }], [{ k: 'tvs.vrwm', value: 24, unit: 'V', ok: ok_ }]),
    ];
    const prof = { schema: 'pincheck.mate/1', id: 'test14', name: 'Test 14-pin', ok: ok_, pins: [
      { num: '1', expect: 'nc' }, { num: '2', expect: 'nc' }, { num: '3', expect: 'vref', required: true }, { num: '4', expect: ['swdio', 'tms'], required: true },
      { num: '5', expect: 'gnd' }, { num: '6', expect: ['swclk', 'tck'], required: true }, { num: '7', expect: 'gnd' }, { num: '8', expect: ['swo', 'tdo'] },
      { num: '9', expect: 'key' }, { num: '10', expect: 'tdi' }, { num: '11', expect: 'gnd' }, { num: '12', expect: 'nrst' },
      { num: '13', signal: 'T_VCP_RX', expect: 'uart-tx' }, { num: '14', signal: 'T_VCP_TX', expect: 'uart-rx' }] };
    const conn = { assign: [{ ref: 'J5', mate: 'test14' }, { ref: 'J1', power: { pins: ['1'], return: ['2'], v: { min: 20, typ: 24, max: 28 }, i: 2 } }], profiles: { test14: prof } };
    return { design: { parts, nets, sheets: [], notes: [] }, lib: lib2, conn, N };
  };
  t('connectors: a debug header\'s crossed VCP, and a power input\'s rail, contacts, TVS, and unrated parts', () => {
    const b = connBoard(), r = CK.run(b.design, b.lib, b.conn);
    const got = r.findings.filter(f => /^(conn|power)\./.test(f.check) || f.check === 'supply.range').map(f => f.severity + ' ' + f.check + ': ' + f.title);
    eq(got, [
      'error supply.range: U2 VIN (pin 1) at 28 V is outside 4.5 V to 26 V',
      'error conn.mate: J5 pin 13 (T_VCP_RX on Test 14-pin) reaches U1 PA3, which has no UART TX function',
      'error conn.mate: J5 pin 14 (T_VCP_TX on Test 14-pin) reaches U1 PA2 (through R9), which has no UART RX function',
      'error power.contacts: J1\'s 20 to 28 V input carries 2 A; J1\'s contacts are rated 1.5 A',
      'error power.ratings: D1\'s 24 V working voltage is below J1\'s 20 to 28 V input\'s 28 V maximum',
      'info power.ratings: J1\'s 20 to 28 V input: 2 parts in its path without a rating to check',
    ]);
    ok(/likely swapped/.test(r.findings.find(f => f.pins[0] === 'J5.13').detail), 'names the swap');
    eq(r.needFiles, ['F1', 'Q1'], 'the fuse and FET want part files');
    eq((r.rails.find(x => x.net === '24V') || {}).from, 'J1 power input (20 to 28 V), through F1, Q1');
    // Uncrossed, on two USARTs: one finding for the pair.
    const b2 = connBoard();
    b2.design.nets.find(n => n.name === 'VCP_B').nodes = [{ ref: 'U1', pin: '5' }, { ref: 'J5', pin: '13' }];
    b2.design.nets.find(n => n.name === 'VCP_A').nodes = [{ ref: 'U1', pin: '8' }, { ref: 'R9', pin: '1' }];
    const m2 = CK.run(b2.design, b2.lib, b2.conn).findings.filter(f => f.check === 'conn.mate').map(f => f.title);
    eq(m2, ['J5\'s UART TX and RX are on different peripherals']);
    // An unverified profile only warns; a header with fewer pins points at its numbering.
    const b3 = connBoard(); delete b3.conn.profiles.test14.ok;
    b3.design.parts.find(p => p.ref === 'J5').pins.splice(12);
    const r3 = CK.run(b3.design, b3.lib, b3.conn).findings.filter(f => f.check === 'conn.mate');
    ok(r3.every(f => f.severity !== 'error'), 'unverified: warnings');
    ok(r3.some(f => /J5 has no pin 13, 14 for Test 14-pin/.test(f.title) && f.unverified), 'missing pins');
    // No assignments: no connector findings, and the input's net keeps its name's voltage.
    const r4 = CK.run(b.design, b.lib);
    eq(r4.findings.filter(f => /^(conn|power)\./.test(f.check)).length, 0);
    eq((r4.rails.find(x => x.net === '24V') || {}).v, 24);
  });
  // Logic levels (Chris, 2026-11-13): a made-up isolated transceiver with its logic side on a 5 V rail, talking through 22 Ω
  // resistors to a 3.3 V MCU on a USB-powered rail; a DNP alternate on the same nets; a 1 kΩ into 10 kΩ divider.
  const levelBoard = () => {
    const pin = (num, name, type) => ({ num, name, type: type || 'passive' });
    const two = (ref, kind, value) => ({ ref, mpn: '', kind, params: { Value: value }, pins: [pin('1', '1'), pin('2', '2')] });
    const parts = [
      { ref: 'U1', mpn: 'MCU7', kind: 'ic', params: {}, pins: [pin('1', 'VDD', 'power'), pin('2', 'VSS', 'power'), pin('3', 'PA1'), pin('4', 'PA2'), pin('5', 'PA3')] },
      { ref: 'U2', mpn: 'XCVR5', kind: 'ic', params: {}, pins: [pin('1', 'VCC1', 'power'), pin('2', 'TXD'), pin('3', 'RXD'), pin('4', 'GND1', 'power')] },
      { ref: 'U9', mpn: 'XCVR5ALT', kind: 'ic', params: {}, pins: [pin('1', 'VCC1', 'power'), pin('2', 'TXD'), pin('3', 'RXD'), pin('4', 'GND1', 'power')], dnp: true },
      { ref: 'U3', mpn: 'LDO33', kind: 'ic', params: {}, pins: [pin('1', 'VIN', 'power'), pin('2', 'VOUT', 'power'), pin('3', 'GND', 'power')] },
      { ref: 'U4', mpn: 'BUCK5', kind: 'ic', params: {}, pins: [pin('1', 'VIN', 'power'), pin('2', 'VOUT', 'power'), pin('3', 'GND', 'power')] },
      { ref: 'J1', mpn: 'USBC', kind: 'connector', params: {}, pins: [pin('1', 'VBUS'), pin('2', 'GND')] },
      { ref: 'J2', mpn: 'BARREL', kind: 'connector', params: {}, pins: [pin('1', '1'), pin('2', '2')] },
      two('R1', 'resistor', '22R'), two('R2', 'resistor', '22R'), two('R3', 'resistor', '1k'), two('R4', 'resistor', '10k'), two('R5', 'resistor', '4.7k'),
    ];
    const N = (name, ...nodes) => ({ name, nodes: nodes.map(s => { const [ref, p] = s.split('.'); return { ref, pin: p }; }) });
    const nets = [
      N('VBUS', 'J1.1', 'U3.1'), N('VIN_24', 'J2.1', 'U4.1'), N('V3V3_USB', 'U3.2', 'U1.1', 'R5.1'), N('+5V0', 'U4.2', 'U2.1', 'U9.1'),
      N('GND', 'J1.2', 'J2.2', 'U1.2', 'U2.4', 'U9.4', 'U3.3', 'U4.3', 'R4.2'),
      N('TX_MCU', 'U1.3', 'R1.1'), N('CAN_TXD', 'R1.2', 'U2.2', 'U9.2'), N('RX_MCU', 'U1.4', 'R2.1'), N('CAN_RXD', 'R2.2', 'U2.3', 'U9.3'),
      N('SENSE', 'U1.5', 'R3.1', 'R5.2'), N('SENSE_DIV', 'R3.2', 'R4.1'),
    ];
    const ok_ = { by: 't' };
    const file = (mpn, kind, pins, values, domains) => ({ schema: 'pincheck.part/1', id: mpn.toLowerCase(), mpn, kind, match: [], pins, values: values || [], domains, datasheet: {} });
    const lib2 = [
      file('MCU7', 'mcu', [{ num: '1', name: 'VDD', role: 'power-in', domain: 'VDD' }, { num: '2', name: 'VSS', role: 'ground' },
        { num: '3', name: 'PA1', role: 'io', domain: 'VDD', ft: true }, { num: '4', name: 'PA2', role: 'io', domain: 'VDD', ft: true }, { num: '5', name: 'PA3', role: 'io', domain: 'VDD' }],
        [{ k: 'io.voh', on: 'VDD', value: 'VDD-0.4', unit: 'V', ok: ok_ }, { k: 'io.vih', on: 'VDD', value: '0.7*VDD', unit: 'V', ok: ok_ }, { k: 'io.absmax', on: 'VDD', value: 'VDD+0.3', unit: 'V', ok: ok_ }, { k: 'io.ft.absmax', value: 'VDD+4.0', unit: 'V', ok: ok_ }], ['VDD']),
      file('XCVR5', 'interface', [{ num: '1', name: 'VCC1', role: 'power-in', domain: 'VCC1' }, { num: '2', name: 'TXD', role: 'input', domain: 'VCC1' }, { num: '3', name: 'RXD', role: 'output', domain: 'VCC1' }, { num: '4', name: 'GND1', role: 'ground' }],
        [{ k: 'io.vih', on: 'VCC1', value: '0.7*VCC1', unit: 'V', ok: ok_ }, { k: 'io.voh', on: 'VCC1', value: 'VCC1-0.2', unit: 'V', ok: ok_ }, { k: 'io.absmax', on: 'VCC1', value: 'VCC1+0.5', unit: 'V', ok: ok_ }], ['VCC1']),
      file('LDO33', 'regulator', [{ num: '1', name: 'VIN', role: 'power-in', domain: 'VIN' }, { num: '2', name: 'VOUT', role: 'power-out' }, { num: '3', name: 'GND', role: 'ground' }], [{ k: 'reg.vout', typ: 3.3, unit: 'V', ok: ok_ }], ['VIN']),
      file('BUCK5', 'regulator', [{ num: '1', name: 'VIN', role: 'power-in', domain: 'VIN' }, { num: '2', name: 'VOUT', role: 'power-out' }, { num: '3', name: 'GND', role: 'ground' }], [{ k: 'reg.vout', typ: 5, unit: 'V', ok: ok_ }], ['VIN']),
    ];
    return { design: { parts, nets, sheets: [], notes: [] }, lib: lib2 };
  };
  t('logic levels: across series resistors, thresholds on the receiver\'s own supply, unpowered receivers, and DNP alternates', () => {
    const b = levelBoard(), r = CK.run(b.design, b.lib);
    const got = r.findings.filter(f => /^io\./.test(f.check)).map(f => f.severity + ' ' + f.check + ': ' + f.title);
    eq(got, [
      'error io.vih: U2 TXD (pin 2) needs 3.5 V to read high; U1.3 (PA1, VDD) (through R1) drives at least 2.9 V',
      'error io.unpowered: U1 PA2 (pin 4) sees 5 V from U2 while U1 can be unpowered (limit 4 V)',
      'error io.unpowered: U2 TXD (pin 2) sees 3.3 V from U1 while U2 can be unpowered (limit 0.5 V)',
    ]);
    ok(/from J2 through U4.*from J1 through U3|from J1 through U3.*from J2 through U4/.test(r.findings.find(f => f.check === 'io.unpowered').detail), 'names both rails\' sources');
    // One rail from the other: not independent, so no unpowered finding.
    const b2 = levelBoard();
    b2.design.nets.find(n => n.name === 'VBUS').nodes = [{ ref: 'J1', pin: '1' }];
    b2.design.nets.find(n => n.name === '+5V0').nodes.push({ ref: 'U3', pin: '1' });
    eq(CK.run(b2.design, b2.lib).findings.filter(f => f.check === 'io.unpowered').length, 0, 'co-derived rails');
    // With U2 not fitted and U9 fitted (no part file), nothing to compare: no findings and no contention.
    const b3 = levelBoard(); b3.design.parts.find(p => p.ref === 'U2').dnp = true; delete b3.design.parts.find(p => p.ref === 'U9').dnp;
    eq(CK.run(b3.design, b3.lib).findings.filter(f => /^io\./.test(f.check)).length, 0, 'DNP left out');
    // Altium's variants: Kind=1 is not fitted.
    const v = PK.design.parseVariants('CurrentVariant=Build\r\n[ProjectVariant1]\r\nDescription=Build\r\nVariation1=Designator=U9|UniqueId=\\X|Kind=1|AlternatePart=\r\nVariation2=Designator=R7|UniqueId=\\Y|Kind=0|AlternatePart=\r\n');
    eq([v.current, v.variants[0].name, v.variants[0].notFitted], ['Build', 'Build', ['U9']]);
  });
  t('connectors: the shipped mate profiles are valid and cover the pins they say', async () => {
    const names = await (await fetch('../interfaces/index.json')).json();
    ok(names.length >= 5, 'five or more profiles');
    for (const n of names) {
      const p = await (await fetch('../interfaces/' + n)).json();
      eq(PK.mates.validate(p), [], n);
      eq(new Set(p.pins.map(x => String(x.num))).size, p.pins.length, n + ': pin numbers unique');
      ok(p.source && p.source.url && p.source.doc, n + ': its source document and link');
    }
  });
  t('XML reader: entities and CDATA', () => {
    const d = PK.kicad.xml('<a x="1 &amp; 2"><b>&lt;3</b><![CDATA[<raw>]]></a>');
    eq(d.kids[0].attrs.x, '1 & 2'); eq(d.kids[0].kids[0].text, '<3'); eq(d.kids[0].text, '<raw>');
  });

  // ── Sheet graphics and the schematic viewer (assets/schdoc.js graphics and connect, assets/viewer.js) ──
  // Records are made up here; the Altium demo's sheets come from tools/make_demo_altium.py.
  const G = (recs, name) => PK.schdoc.graphics(recs, {}, name || 't.SchDoc');
  t('sheet graphics: missing keys are 0, FRAC parts, and the sheet size', () => {
    const d = G([{ RECORD: '31', SHEETSTYLE: '12' }, { RECORD: '27', LOCATIONCOUNT: '2', X1: '10', X1_FRAC: '50000', Y1: '20', Y2: '20', X2_FRAC: '25000' }]);
    eq([d.w, d.h], [1700, 1100], 'Tabloid'); eq(d.wires[0], [10.5, 20, 0.25, 20]);
    eq([G([{ RECORD: '31' }]).w, G([{ RECORD: '31' }]).h], [1150, 760], 'no style is A4');
    eq([G([{ RECORD: '31', USECUSTOMSHEET: 'T', CUSTOMX: '1500', CUSTOMY: '950' }]).w], [1500], 'custom size');
    const far = G([{ RECORD: '31' }, { RECORD: '13', 'LOCATION.X': '1200', 'LOCATION.Y': '10', 'CORNER.X': '1300', 'CORNER.Y': '800' }]);
    eq(far.bounds, [0, 0, 1300, 800], 'bounds grow to what is drawn');
  });
  t('sheet graphics: only the placed unit and display mode are drawn', () => {
    const recs = [{ RECORD: '31' },
      { RECORD: '1', CURRENTPARTID: '2', PARTCOUNT: '3', LIBREFERENCE: 'DUAL' },
      { RECORD: '34', OWNERINDEX: '1', TEXT: 'U5', 'LOCATION.X': '100', 'LOCATION.Y': '120' },
      { RECORD: '14', OWNERINDEX: '1', OWNERPARTID: '1', 'LOCATION.X': '0', 'CORNER.X': '10', 'CORNER.Y': '10' },
      { RECORD: '14', OWNERINDEX: '1', OWNERPARTID: '2', 'LOCATION.X': '100', 'LOCATION.Y': '100', 'CORNER.X': '140', 'CORNER.Y': '130' },
      { RECORD: '14', OWNERINDEX: '1', OWNERPARTID: '2', OWNERPARTDISPLAYMODE: '1', 'CORNER.X': '5', 'CORNER.Y': '5' },
      { RECORD: '6', OWNERINDEX: '1', OWNERPARTID: '-1', LOCATIONCOUNT: '2', X1: '100', Y1: '100', X2: '140', Y2: '100' },
      { RECORD: '2', OWNERINDEX: '1', OWNERPARTID: '1', DESIGNATOR: '1', 'LOCATION.X': '90', 'LOCATION.Y': '110', PINLENGTH: '20' },
      { RECORD: '2', OWNERINDEX: '1', OWNERPARTID: '2', DESIGNATOR: '7', NAME: 'OUTB', PINCONGLOMERATE: '27', 'LOCATION.X': '140', 'LOCATION.Y': '110', PINLENGTH: '20' }];
    const d = G(recs);
    eq(d.shapes.map(s => s.t), ['rect', 'line'], 'unit 2 in mode 0, plus the shared line');
    eq(d.pins.map(p => p.num), ['7']);
    const p = d.pins[0];
    eq([p.bx, p.by, p.x, p.y, p.orient, p.showName, p.showNum, p.hidden], [140, 110, 140, 90, 3, true, true, false], 'turned down, name and number shown');
    eq(d.texts.find(x => x.kind === 'designator').s, 'U5B', 'a multi-unit part shows its unit letter');
    eq(d.comps[0].ref, 'U5'); eq(d.comps[0].bbox, [100, 90, 140, 130]);
  });
  t('sheet graphics: title block texts from the document parameters', () => {
    const d = G([{ RECORD: '31' }, { RECORD: '41', NAME: 'Title', TEXT: 'Power' }, { RECORD: '41', NAME: 'Revision', TEXT: '*' },
      { RECORD: '4', TEXT: '=Title' }, { RECORD: '4', TEXT: '=Revision' }, { RECORD: '4', TEXT: 'plain' }]);
    eq(d.texts.map(x => x.s), ['Power', 'plain']);
  });
  t('connectivity: shared ends, T joins, junctions, crossings, and points on wires', () => {
    const d = G([{ RECORD: '31' },
      { RECORD: '27', LOCATIONCOUNT: '2', X1: '0', Y1: '0', X2: '100', Y2: '0' },
      { RECORD: '27', LOCATIONCOUNT: '2', X1: '50', Y1: '0', X2: '50', Y2: '50' },
      { RECORD: '27', LOCATIONCOUNT: '2', X1: '0', Y1: '100', X2: '100', Y2: '100' },
      { RECORD: '27', LOCATIONCOUNT: '2', X1: '30', Y1: '60', X2: '30', Y2: '140' },
      { RECORD: '27', LOCATIONCOUNT: '2', X1: '70', Y1: '60', X2: '70', Y2: '140' },
      { RECORD: '29', 'LOCATION.X': '70', 'LOCATION.Y': '100' },
      { RECORD: '25', 'LOCATION.X': '80', 'LOCATION.Y': '0', TEXT: 'A' },
      { RECORD: '17', 'LOCATION.X': '30', 'LOCATION.Y': '140', TEXT: 'GND' }]);
    const c = PK.schdoc.connect(d);
    eq(c.wire[1], c.wire[0], 'a T joins'); eq(c.label[0], c.wire[0], 'a label on a wire');
    ok(c.wire[3] !== c.wire[2], 'a crossing does not join'); eq(c.wire[4], c.wire[2], 'a junction joins');
    eq(c.power[0], c.wire[3], 'a power port at a wire end');
  });

  const alt = await (async () => {
    const names = await (await fetch('../demo/altium/index.json', { cache: 'no-store' })).json();
    const files = await Promise.all(names.map(async n => new File([await (await fetch('../demo/altium/' + encodeURIComponent(n), { cache: 'no-store' })).arrayBuffer()], n)));
    return D.build(files);
  })();
  t('Altium demo: three drawn sheets joined to the Protel2 netlist', () => {
    eq(alt.source, 'altium'); eq(alt.sheetsDrawn, true); eq(alt.drawings.map(x => x.name), ['Power.SchDoc', 'MCU.SchDoc', 'IO.SchDoc']);
    eq(alt.parts.length, design.parts.length); eq(alt.nets.length, design.nets.length);
    const mcu = alt.drawings[1];
    eq([mcu.w, mcu.h], [1550, 1110]);
    ok(mcu.texts.some(x => x.s === 'MCU, status LEDs, and I2C'), 'the title from the sheet parameters');
    const vdd = mcu.pins.find(p => p.ref === 'U4' && p.num === '4');
    eq([vdd.name, vdd.orient, vdd.type], ['VDD/VDDA', 1, 'power']);
  });
  t('Altium demo: every netlist pin is drawn onto its net, and no group mixes two nets', () => {
    const m = PK.viewer.model(alt);
    let pins = 0, placed = 0;
    // The drawing alone must name each pin's net: a label or power port on the wires its end touches.
    m.sheets.forEach(s => s.dr.pins.forEach((p, i) => {
      const net = alt.nets.find(n => n.nodes.some(x => x.ref === p.ref && x.pin === p.num));
      if (!net) return;
      pins++;
      const names = s.namesOf(s.conn.pin[i]);
      if (names.length === 1 && names[0] === net.name) placed++; else throw new Error(p.ref + '.' + p.num + ' on ' + net.name + ' is drawn on ' + (names.join(', ') || 'nothing'));
    }));
    eq(placed, pins); ok(pins > 120, pins + ' pins');
    m.sheets.forEach(s => { for (let g = 0; g < s.conn.groups; g++) ok(s.netsOf(g).length <= 1, s.dr.name + ' group ' + g + ': ' + s.netsOf(g).join(', ')); });
    const pw = m.sheets[0];
    eq(pw.netsOf(pw.conn.label[pw.dr.labels.findIndex(l => l.text === 'FB')]), ['FB'], 'the divider: a T and a junction');
  });
  t('Altium demo: the same findings as the KiCad netlist', () => {
    const k = PK.checks.run(design, lib).findings.map(f => f.id).sort(), a = PK.checks.run(alt, lib).findings.map(f => f.id).sort();
    eq(a, k);
  });
  t('viewer: a finding opens the sheet with its pins, and channel copies map to their sheet part', () => {
    const run = PK.checks.run(alt, lib);
    const f = run.findings.find(x => x.check === 'func.uart');
    const hits = PK.viewer.hitsOf(alt, f);
    eq(hits[0].si, 1, 'the MCU sheet first'); ok(hits.some(h => h.si === 2), 'and the Wi-Fi sheet');
    ok(hits[0].pins.length >= 1, 'with its pins');
    // A channel copy, U4.2, is drawn as U4.
    const copy = Object.assign({}, alt, { parts: alt.parts.concat([Object.assign({}, alt.parts.find(p => p.ref === 'U4'), { ref: 'U4.2', schRef: 'U4' })]), _sch: null });
    const h2 = PK.viewer.hitsOf(copy, { id: 'x', refs: ['U4.2'], pins: ['U4.2.6'], nets: [] });
    eq([h2[0].si, h2[0].comps, copy._sch.sheets[1].dr.pins[h2[0].pins[0]].num], [1, ['U4'], '6']);
  });
  t('viewer: a finding about a part shows only where the part is drawn, not wherever its net is', () => {
    const onPart = PK.viewer.hitsOf(alt, { id: 'hx1', refs: ['U4'], pins: ['U4.4'], nets: ['3V3'] });
    eq(onPart.map(h => h.si), [1], 'U4 is on the MCU sheet only');
    const onNet = PK.viewer.hitsOf(alt, { id: 'hx2', refs: [], pins: [], nets: ['3V3'] });
    ok(onNet.length > 1, 'a net finding goes wherever the net is: ' + onNet.map(h => h.si));
  });
  t('viewer: a KiCad netlist has nothing to draw, and says so', () => {
    const el = document.createElement('div');
    PK.viewer.render(el, design, {});
    ok(/No drawing in a KiCad netlist/.test(el.textContent));
  });

  t('scan panel: a step per check, about 8 s, every located finding on its sheet', () => {
    const run = PK.checks.run(alt, lib);
    const G = PK.scan.geometry(alt), P = PK.scan.plan(alt, run, lib, G);
    eq(G.sheets.length, 3);
    eq(P.steps.map(s => s.key), PK.checks.CATALOG.map(c => c.key));
    ok(Math.abs(P.total - PK.scan.TOTAL) < 1, 'total ' + P.total);
    ok(P.steps.every(s => s.lanes.every(l => l.beats.length <= 8)), 'at most 8 beats per sheet');
    ok(G.pinAt.get('U4.4') && G.pinAt.get('U4.4')[0].sheet === 1, 'U4 VDD on the MCU sheet');
    const placed = P.steps.flatMap(s => [...s.at.values()]).filter(Boolean).length;
    eq(placed, run.findings.filter(f => !f.waived).length, 'every finding has a place');
    // The run as a whole: done at the end, every finding shown; a picked check shows its own from the start.
    const end = PK.scan.stateAt(P, P.total);
    eq([end.done, end.findings.length], [true, run.findings.length]);
    const uart = P.steps.findIndex(s => s.key === 'func.uart');
    const S = PK.scan.pickAt(P, uart, 0);
    ok(P.steps[uart].findings.every(f => S.findings.includes(f)) && S.lanes.length > 0, 'a replayed check');
  });
  t('scan panel: none for a design without sheets', () => {
    const host = document.createElement('div'), wrap = document.createElement('div');
    wrap.appendChild(host);
    eq(PK.scan.attach(host, design, PK.checks.run(design, lib), { lib }), null);
    eq(wrap.children.length, 0);
  });

  // A zip made here: some entries deflated (CompressionStream), some stored, one zip inside another.
  async function makeZip(list) {
    const enc = new TextEncoder(), parts = [], dir = [];
    let off = 0;
    const le = (n, w) => { const b = new Uint8Array(w); for (let i = 0; i < w; i++) b[i] = (n / 2 ** (8 * i)) & 255; return b; };
    const crc = d => { let c, t = crc.t || (crc.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); c = 0xFFFFFFFF; for (const x of d) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    for (const [name, data, deflate] of list) {
      const raw = typeof data === 'string' ? enc.encode(data) : data, nm = enc.encode(name);
      const body = deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()) : raw;
      const head = [le(0x04034b50, 4), le(20, 2), le(0, 2), le(deflate ? 8 : 0, 2), le(0, 4), le(crc(raw), 4), le(body.length, 4), le(raw.length, 4), le(nm.length, 2), le(0, 2), nm];
      dir.push([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(deflate ? 8 : 0, 2), le(0, 4), le(crc(raw), 4), le(body.length, 4), le(raw.length, 4), le(nm.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(off, 4), nm]);
      for (const h of head) { parts.push(h); off += h.length; }
      parts.push(body); off += body.length;
    }
    const cd = dir.flat(), cdLen = cd.reduce((a, b) => a + b.length, 0);
    return new Blob([...parts, ...cd, le(0x06054b50, 4), le(0, 4), le(list.length, 2), le(list.length, 2), le(cdLen, 4), le(off, 4), le(0, 2)]);
  }
  t('zip: only the files Pincheck reads come out, from zips inside zips too', async () => {
    const inner = await makeZip([['Inner.SchDoc', 'inner sheet', true]]);
    const z = await makeZip([['Proj/A.SchDoc', 'sheet a'.repeat(50), true], ['Proj/Proj.PrjPcb', '[Design]', false], ['Proj/Proj.NET', 'PROTEL NETLIST 2.0', true],
      ['Proj/Board.PcbDoc', 'big board', true], ['Proj/History/Old.SchDoc', 'old', false], ['__MACOSX/Proj/._A.SchDoc', 'x', false], ['Proj/more.zip', new Uint8Array(await inner.arrayBuffer()), false]]);
    const out = await PK.archive.expand([new File([z], 'Proj.zip')]);
    eq(out.map(f => f.path), ['Proj/A.SchDoc', 'Proj/Proj.PrjPcb', 'Proj/Proj.NET', 'Proj/more.zip/Inner.SchDoc']);
    eq(await out[0].text(), 'sheet a'.repeat(50)); eq(await out[3].text(), 'inner sheet');
    eq(out.map(f => f.name), ['A.SchDoc', 'Proj.PrjPcb', 'Proj.NET', 'Inner.SchDoc']);
  });
  t('zip: the Altium demo zipped opens as the same design', async () => {
    const names = await (await fetch('../demo/altium/index.json', { cache: 'no-store' })).json();
    const list = await Promise.all(names.map(async n => ['Main PCBA/' + n, new Uint8Array(await (await fetch('../demo/altium/' + encodeURIComponent(n), { cache: 'no-store' })).arrayBuffer()), true]));
    const d = await D.build(await PK.archive.expand([new File([await makeZip(list)], 'Main PCBA.zip')]));
    eq([d.parts.length, d.nets.length, d.drawings.length], [alt.parts.length, alt.nets.length, alt.drawings.length]);
  });

  // ── Send to Signoff EE and stored runs (docs/send-to-signoff-ee.md). The send writes a made-up board under its
  // own localStorage namespace, never Signoff's real working copy. ──
  const SO = PK.signoff, RU = PK.runs;
  const altRun = () => { alt.run = PK.checks.run(alt, lib); return alt.run; };
  const schem = await (await fetch('../../ee_design_review/templates/schematic.json', { cache: 'no-store' })).json();
  function fakeBoard() {
    PK.SIGNOFF_NS = 'signoff.pktest.';
    localStorage.setItem('signoff.pktest.projects', JSON.stringify({ 'main-pcba': { id: 'ptest1', meta: { name: 'Main PCBA', checklists: ['schematic', 'fab'], updatedAt: '2026-11-13' }, items: {}, custom: {}, comments: {}, sections: {} } }));
    localStorage.removeItem('signoff.pktest.dirty');
  }
  const board = () => JSON.parse(localStorage.getItem('signoff.pktest.projects'))['main-pcba'];
  const clearBoard = () => { for (const k of ['projects', 'dirty', 'ui', 'settings']) localStorage.removeItem('signoff.pktest.' + k); delete PK.SIGNOFF_NS; };

  t('send: every check maps to a Schematic Review section that exists', () => {
    const ids = new Set(schem.sections.map(s => s.id));
    for (const c of PK.checks.CATALOG) ok(ids.has(SO.sectionFor(c.key)), c.key + ' → ' + SO.sectionFor(c.key));
    for (const [id, title] of Object.entries(SO.SECTIONS)) eq(schem.sections.find(s => s.id === id).title, title);
  });
  t('send: one issue per check and severity on the Schematic checklist; notes and waived left out when skipped', () => {
    fakeBoard();
    try {
      const fs = altRun().findings.map(f => Object.assign({}, f, { waived: null }));
      fs[0] = Object.assign({}, fs[0], { waived: { reason: 'variant', by: 'tester', at: '2026-11-13', scope: 'one' } });
      // The demo has no errors, so one made up here: errors go as Major.
      fs.push({ id: 'supply.range:U4.4', check: 'supply.range', group: 'Supply', severity: 'error', title: 'U4 VDD at 5 V is above its 3.6 V maximum', detail: '', refs: ['U4'], pins: ['U4.4'], nets: ['5V'], basis: [], unverified: false, waived: null });
      const plan = SO.plan(fs);
      ok(plan.some(g => g.waived), 'a waived group');
      const skip = new Set(plan.filter(g => g.waived || g.severity === 'info').map(g => g.key));
      const pv = SO.preview('main-pcba', plan);
      ok(pv.rows.every(r => r.state === 'new'));
      const r = SO.send('main-pcba', plan, { label: 'Main PCBA', run: { id: 'pktest0001' } }, skip);
      const p = board(), sent = plan.filter(g => !skip.has(g.key));
      eq(r.created, sent.length); eq(Object.keys(p.custom).length, sent.length);
      for (const c of Object.values(p.custom)) {
        ok(/^xpk/.test(c.id), c.id); eq(c.checklist, 'schematic'); eq(c.source.tool, 'pincheck'); eq(c.source.run.id, 'pktest0001');
        ok(c.source.locations.length && c.source.locations.every(l => l.finding), 'locations name findings');
        eq(p.items[c.id].status, 'issue'); ok(c.severity === 'major' || c.severity === 'minor');
      }
      ok(Object.values(p.custom).some(c => c.severity === 'major' && /^Pincheck: /.test(c.text)), 'errors are Major');
      ok(JSON.parse(localStorage.getItem('signoff.pktest.dirty')).ptest1, 'marked dirty for Signoff\'s sync');
      // Sending again updates the same issues and keeps the reviewer's resolution; a finding gone gets a note.
      const first = Object.keys(p.custom)[0];
      const all = JSON.parse(localStorage.getItem('signoff.pktest.projects')); all['main-pcba'].items[first].resolution = 'fixed';
      localStorage.setItem('signoff.pktest.projects', JSON.stringify(all));
      const fewer = SO.plan(fs.filter(f => SO.stableId('ptest1', f.check, f.severity) !== first || f.waived || f.severity === 'info'));
      const r2 = SO.send('main-pcba', fewer, { label: 'Main PCBA', run: { id: 'pktest0002' } }, skip);
      eq(r2.created, 0); eq(board().items[first].resolution, 'fixed');
      // The gone one was Fixed, so it gets no "no longer found" note; an open one would.
      eq(r2.resolvedNotes, 0);
      // Ticking the waived group sends a reference row, counted nowhere.
      const r3 = SO.send('main-pcba', plan, { label: 'Main PCBA', run: { id: 'pktest0003' } }, new Set());
      const ref = Object.values(board().custom).find(c => c.reference === true);
      ok(ref && /^Waived in Pincheck/.test(ref.text) && board().items[ref.id].resolution === 'waived', 'reference row');
      ok(r3.created >= 1);
    } finally { clearBoard(); }
  });
  t('stored run: the bundle reopens as the same design, with the same findings from its own part files', async () => {
    altRun();
    const made = await RU.make(alt, lib, 'tester');
    ok(RU.RUN_ID.test(made.run.id), made.run.id);
    eq(made.run.design.parts, alt.parts.length); eq(made.run.library.files, 2);
    eq(made.run.design.sha256, await RU.sha256(made.bundle));
    const again = await RU.make(alt, lib, 'tester');
    eq(again.run.design.key, made.run.design.key, 'same design and part files, same key');
    const b = await RU.open(made.bundle);
    eq(b.library.map(f => f.id), ['stm32g071kbu6', 'tps562201ddcr']);
    const re = PK.checks.run(b.design, b.library);
    eq(re.findings.map(f => f.id + f.severity), alt.run.findings.map(f => f.id + f.severity));
    eq(b.design.drawings.length, alt.drawings.length);
    eq(made.findings.map(f => f.id), alt.run.findings.map(f => f.id));
  });
  t('stored run: stored in one commit beside the board, and a re-send uploads only the new run file', async () => {
    const gh = window.FakeGitHub();
    RU.setFetch(gh.fetch); RU.setToken('test-token');
    try {
      altRun();
      const made = await RU.make(alt, lib, 'tester');
      const got = await RU.store(made, 'ptest1');
      ok(got.ok, got.why);
      const dir = RU.home('ptest1').dir;
      eq(got.run.design.path, dir + 'designs/' + made.run.design.key + '.json.gz');
      eq(got.run.stored.dir, dir);
      const tree = [...gh.trees.get(gh.commits.get(gh.head).tree).keys()].sort();
      eq(tree, [dir + 'designs/' + made.run.design.key + '.json.gz', dir + 'runs/' + made.run.id + '.json'].sort());
      eq(gh.stats.commits, 1);
      // Read it back as Signoff EE does (app.js handOffPincheck, cleanPincheckRun): the run file, the bundle's
      // place relative to the run's folder, and the bundle checked against its SHA-256.
      const ee = new window.Signoff.GitHubStore({ owner: 'o', repo: 'r', branch: 'main', token: 'test-token' }, gh.fetch);
      const entries = await ee.listTree(dir);
      const file = JSON.parse(new TextDecoder().decode(await ee.readBytes(dir + 'runs/' + made.run.id + '.json', entries)));
      const m = /(?:^|\/)designs\/([0-9a-f]{16})\.json\.gz$/.exec(file.run.design.path);
      ok(m && m[1] === file.run.design.key, 'EE finds the bundle');
      eq(file.findings.length, alt.run.findings.length);
      const bytes = await ee.readVerified(dir + 'designs/' + m[1] + '.json.gz', file.run.design.sha256, entries);
      ok(bytes instanceof Uint8Array, 'bytes as the hand-off wants them');
      eq((await RU.open(bytes)).design.parts.length, alt.parts.length);
      const posts = gh.stats.blobPosts;
      const second = await RU.make(alt, lib, 'tester');
      ok((await RU.store(second, 'ptest1')).ok);
      eq(gh.stats.blobPosts - posts, 1, 'only the run file is new');
      gh.deny = true; RU.clearProbes();
      const third = await RU.store(await RU.make(alt, lib, 'tester'), 'ptest1');
      ok(!third.ok && /can't write/.test(third.why), third.why);
    } finally { RU.setFetch(null); RU.setToken(null); RU.clearProbes(); }
  });
  t('stored run: Signoff EE\'s hand-off is taken once, checked, and kept here', async () => {
    altRun();
    const made = await RU.make(alt, lib, 'tester');
    const put = (db, entry) => new Promise((res, rej) => {
      const r = indexedDB.open(db, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('runs', { keyPath: 'id' });
      r.onsuccess = () => { const t2 = r.result.transaction('runs', 'readwrite'); t2.objectStore('runs').put(entry); t2.oncomplete = () => { r.result.close(); res(); }; t2.onerror = () => rej(t2.error); };
      r.onerror = () => rej(r.error);
    });
    const del = id => new Promise(res => { const r = indexedDB.open('pincheck-runs', 1); r.onupgradeneeded = () => r.result.createObjectStore('runs', { keyPath: 'id' }); r.onsuccess = () => { const t2 = r.result.transaction('runs', 'readwrite'); t2.objectStore('runs').delete(id); t2.oncomplete = () => { r.result.close(); res(); }; }; });
    try {
      // A tampered bundle is refused.
      await put('dovetail-handoff', { id: made.run.id, tool: 'pincheck', run: made.run, findings: made.findings, bundle: made.bundle.slice(0, -1), at: '' });
      eq(await RU.find(made.run.id), null);
      await put('dovetail-handoff', { id: made.run.id, tool: 'pincheck', run: made.run, findings: made.findings, bundle: made.bundle, at: '' });
      const e = await RU.find(made.run.id);
      ok(e && e.run.id === made.run.id, 'found');
      ok(await RU.kept(made.run.id), 'kept here');
      eq(await RU.takeHandoff(made.run.id), null, 'taken once');
      eq(await RU.find('not-a-run'), null);
    } finally { await del(made.run.id); }
  });

  t('report: counts what Overview counts, lists waived findings apart, and escapes names', () => {
    const run = altRun();
    const fs = run.findings.map(f => Object.assign({}, f, { waived: null }));
    const iss = fs.filter(f => f.severity !== 'info');
    ok(iss.length > 1, 'the demo has issues');
    iss[0].waived = { reason: 'Checked on the bench', by: 'tester', at: '2026-11-13T00:00:00Z', scope: 'one' };
    const html = PK.pages.report(Object.assign({}, alt, { name: 'Board <b>' }), Object.assign({}, run, { findings: fs }), { lib });
    const box = document.createElement('div'); box.innerHTML = html;
    const sec = name => [...box.querySelectorAll('h2')].find(h => h.textContent === name);
    const rows = name => { const h = sec(name); return h ? h.nextElementSibling.querySelectorAll('tbody tr').length : 0; };
    eq(rows('Issues'), iss.length - 1);
    eq(rows('Waived'), 1);
    ok(box.textContent.includes('Checked on the bench'), 'waiver reason shown');
    ok(html.includes('Board &lt;b&gt;') && !box.querySelector('h1 b'), 'name escaped');
  });

  for (const [name, fn] of tests) {
    try { await fn(); out.push('✓ ' + name); } catch (e) { fails.push(name); out.push('✕ ' + name + '\n    ' + e.message); }
  }
  document.getElementById('out').textContent = out.join('\n') + '\n\n' + (tests.length - fails.length) + ' of ' + tests.length + ' passed';
  document.title = fails.length ? 'FAIL' : 'PASS';
})().catch(e => { document.getElementById('out').textContent = 'ERROR ' + e.stack; document.title = 'ERROR'; });
