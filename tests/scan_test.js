#!/usr/bin/env node
// Tests for tools/scan.js (docs/claude-scan.md): the headless run on the demo project, and scan validation.
//   node tests/scan_test.js
'use strict';
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '..');
const S = require(path.join(root, 'tools', 'scan.js'));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.log('✕ ' + name + '\n   ' + e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };

(async () => {
  const { design, run } = await S.load(path.join(root, 'demo', 'altium'), null, { library: path.join(root, 'demo', 'no-such-dir'), parts: path.join(root, 'demo', 'library') });
  const offline = { findings: run.findings.map(f => ({ id: f.id })) };
  const scan = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'claude-scan.json'), 'utf8'));

  await t('headless run: the demo project parses with its nets and variant', () => {
    eq(design.parts.length, 40); eq(design.nets.length > 30, true); eq(design.variant, 'Development');
    eq(design.parts.find(p => p.ref === 'U7').sheets, ['Power.SchDoc']);
  });
  await t('the demo scan is valid against the demo design', () => {
    const r = S.validateScan(scan, offline, design);
    eq(r.errs, []);
  });
  await t('validation names what is wrong', () => {
    const bad = JSON.parse(JSON.stringify(scan));
    bad.items[0].refs.push('U999'); bad.items[0].type = 'oops'; delete bad.items[0].rule;
    bad.items.push({ id: 'c9', type: 'false-alarm', severity: 'warn', title: 't', detail: 'd', confidence: 'high', offline: 'nope:1', rule: 'r', evidence: [{ says: 'x' }] });
    bad.items.push(Object.assign({}, bad.items[1], { id: 'c2' }));
    const e = S.validateScan(bad, offline, design).errs.join('\n');
    for (const want of ['ref U999 is not in the design', 'type should be one of', 'offline "nope:1" is not in offline.json', 'duplicate id']) if (!e.includes(want)) throw new Error('missing: ' + want + '\n' + e);
  });
  await t('a data item needs its check and what it needs', () => {
    const bad = JSON.parse(JSON.stringify(scan));
    delete bad.items[1].check; delete bad.items[1].needs;
    const e = S.validateScan(bad, offline, design).errs.join('\n');
    if (!/names the offline check/.test(e) || !/needs/.test(e)) throw new Error(e);
  });
  await t('the skills zip unzips to .claude/skills with each SKILL.md intact', async () => {
    globalThis.window = undefined; require(path.join(root, 'assets', 'claude.js'));
    const C = globalThis.PK.claude;
    const files = C.SKILLS.map(([name, src]) => ['.claude/skills/' + name + '/SKILL.md', new Uint8Array(fs.readFileSync(path.join(root, src)))]);
    const tmp = path.join(require('os').tmpdir(), 'pk-skills-' + process.pid);
    fs.mkdirSync(tmp, { recursive: true });
    const z = path.join(tmp, 'skills.zip');
    fs.writeFileSync(z, Buffer.from(await C.zip(files).arrayBuffer()));
    require('child_process').execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'unzip', process.platform === 'win32' ? ['-xf', 'skills.zip'] : ['-q', 'skills.zip'], { cwd: tmp });
    for (const [name, src] of C.SKILLS) eq(fs.readFileSync(path.join(tmp, '.claude', 'skills', name, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(root, src), 'utf8'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
