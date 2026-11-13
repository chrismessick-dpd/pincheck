#!/usr/bin/env node
// Pincheck part files from the command line (for people and for the pincheck-part Claude skill).
// It runs the page's own assets/params.js and assets/library.js, so it always matches the tool.
//
//   node tools/part.js catalog [kind]        the parameters a part file may hold (all, or for one kind), as Markdown
//   node tools/part.js kinds                 the part kinds and pin roles
//   node tools/part.js check <file.json> [--pins <schematic export.json>]
//                                            validate a part file; with --pins, compare its pins with
//                                            another file's (the one exported from the schematic)
//   node tools/part.js summary <file.json>   what the file holds, by catalog group, and what it lacks
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
for (const f of ['params', 'library']) require(path.join(root, 'assets', f + '.js'));
const P = globalThis.PK.params, L = globalThis.PK.library;

const [cmd, arg, ...rest] = process.argv.slice(2);
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function catalog(kind) {
  const list = kind ? P.forKind(kind) : P.CATALOG;
  let out = '', group = '';
  for (const c of list) {
    if (c.group !== group) { group = c.group; out += '\n## ' + group + '\n\n| key | label | unit | shape | on | kinds |\n|---|---|---|---|---|---|\n'; }
    out += `| \`${c.k}\` | ${c.label}${c.hint ? ' (' + c.hint.replace(/\|/g, '/') + ')' : ''} | ${c.unit || ''} | ${c.shape} | ${c.on} | ${c.kinds.join(', ')} |\n`;
  }
  return out;
}

if (cmd === 'catalog') {
  if (arg && !P.KINDS[arg]) { console.error('Unknown kind ' + arg + '. Kinds: ' + Object.keys(P.KINDS).join(', ')); process.exit(1); }
  process.stdout.write('# Pincheck parameter catalog' + (arg ? ' for ' + arg : '') + ' (' + (arg ? P.forKind(arg) : P.CATALOG).length + ' keys)\n' + catalog(arg));
} else if (cmd === 'kinds') {
  console.log('Kinds:\n' + Object.entries(P.KINDS).map(([k, v]) => '  ' + k.padEnd(12) + v).join('\n'));
  console.log('\nPin roles:\n' + Object.entries(P.ROLES).map(([k, v]) => '  ' + k.padEnd(12) + v).join('\n'));
  console.log('\nPin reset states: ' + Object.keys(P.RESET_STATES).filter(Boolean).join(', '));
  console.log('Pin "unused" rules: ' + Object.keys(P.UNUSED).filter(Boolean).join(', '));
} else if (cmd === 'check') {
  const f = read(arg);
  const errs = L.validate(f);
  const unknown = (f.values || []).filter(v => !P.byKey.has(v.k)).map(v => v.k);
  const domains = new Set(f.domains || []);
  const badOn = (f.values || []).filter(v => { const c = P.byKey.get(v.k); return c && c.on === 'domain' && v.on && !domains.has(v.on); }).map(v => v.k + ' on ' + v.on);
  const noOn = (f.values || []).filter(v => { const c = P.byKey.get(v.k); return c && c.on === 'domain' && !v.on; }).map(v => v.k);
  const noPage = (f.values || []).filter(v => v.page == null && v.src !== 'import:cubemx' && v.src !== 'schematic parameter').map(v => v.k);
  const wrongOk = (f.values || []).filter(v => v.ok && v.src === 'llm').map(v => v.k);
  const report = [];
  if (errs.length) report.push('Errors:\n  ' + errs.join('\n  '));
  if (unknown.length) report.push('Keys not in the catalog (kept, never checked):\n  ' + unknown.join(', '));
  if (badOn.length) report.push('Values on a domain the file doesn\'t list:\n  ' + badOn.join(', '));
  if (noOn.length) report.push('Per-domain values with no "on":\n  ' + noOn.join(', '));
  if (noPage.length) report.push('Values without a datasheet page:\n  ' + noPage.join(', '));
  if (wrongOk.length) report.push('Marked verified though an LLM wrote them (only a person verifies):\n  ' + wrongOk.join(', '));
  const flag = rest.indexOf('--pins');
  if (flag >= 0) {
    const sch = read(rest[flag + 1]);
    const mism = L.pinCheck(f, { pins: sch.pins || [] });
    if (mism.length) report.push('Pins that differ from the schematic export:\n  ' + mism.map(m => 'pin ' + m.num + ': schematic ' + (m.sch == null ? '(none)' : m.sch) + ', file ' + (m.file == null ? '(none)' : m.file)).join('\n  '));
  }
  console.log(report.length ? report.join('\n\n') : 'OK: ' + f.mpn + ', ' + f.pins.length + ' pins, ' + f.values.length + ' values');
  process.exit(errs.length ? 1 : 0);
} else if (cmd === 'summary') {
  const f = read(arg);
  const have = new Set((f.values || []).map(v => v.k));
  const cat = P.forKind(f.kind);
  const groups = [...new Set(cat.map(c => c.group))];
  console.log(f.mpn + ' (' + f.kind + '): ' + f.pins.length + ' pins, ' + f.values.length + ' values, ' + f.values.filter(v => v.ok).length + ' verified');
  for (const g of groups) {
    const keys = cat.filter(c => c.group === g);
    console.log('  ' + g + ': ' + keys.filter(c => have.has(c.k)).length + ' of ' + keys.length + (keys.some(c => !have.has(c.k)) ? '; missing ' + keys.filter(c => !have.has(c.k)).map(c => c.k).join(', ') : ''));
  }
  const roles = {}; f.pins.forEach(p => { roles[p.role || 'none'] = (roles[p.role || 'none'] || 0) + 1; });
  console.log('  Pin roles: ' + Object.entries(roles).map(([k, n]) => k + ' ' + n).join(', '));
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 11).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
