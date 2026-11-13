#!/usr/bin/env node
// Pincheck from the command line, for the Claude scan (docs/claude-scan.md) and its two skills: the offline
// checks run headless on a project folder, the parsed design is written out as text for Claude to read, and
// scans move to and from pincheck_data. It runs the page's own assets, so it always checks as the page does.
//
//   node tools/scan.js library [--refresh]          copy pincheck_data's parts, designs, and interfaces here
//   node tools/scan.js run <project folder or .zip> --out <dir> [--variant <name>] [--extra <dir>] [--library <dir>]
//                                                   the offline checks: offline.json, project.json, missing.json
//                                                   (a batch file for the pincheck-part skill), and design/*.md
//   node tools/scan.js check <scan dir>              validate scan.json against the design and the offline run
//   node tools/scan.js push <scan dir> --dry-run | --confirm <code>
//                                                   store a scan in pincheck_data (new files only, one commit)
//   node tools/scan.js list [<design>]              scans in pincheck_data, with their decisions
//   node tools/scan.js pull <design>/<scan id> --out <dir>
//                                                   a stored scan, its decisions, and what self-improve did
//   node tools/scan.js record <scan dir> --improved <file.json> --dry-run | --confirm <code>
//                                                   store (or replace) improved.json beside a stored scan
//
// The token comes from SIGNOFF_TOKEN, `signoff login` (~/.signoff/auth.json), ee_tools_token.txt beside the
// tool folders, or `gh auth token`. It is never printed. Nothing here writes a repo without --confirm.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), childProcess = require('child_process');
const root = path.resolve(__dirname, '..');
for (const f of ['cfb', 'schdoc', 'kicad', 'protel', 'design', 'archive', 'params', 'library', 'checks', 'mates']) require(path.join(root, 'assets', f + '.js'));
const PK = globalThis.PK, L = PK.library, D = PK.design;
const REPO = { owner: L.REPO.owner, name: L.REPO.name };
const HOME = path.join(os.homedir(), '.signoff', 'pincheck');
const DATA = path.join(HOME, 'data');
const SCAN = 'pincheck.scan/1', DECISIONS = 'pincheck.scan-decisions/1', IMPROVED = 'pincheck.scan-improved/1';
const TYPES = ['missed', 'data', 'false-alarm', 'idea'];
const SEVERITIES = ['error', 'warn', 'info'];

class CliError extends Error {}
const args = process.argv.slice(2);
const cmd = args[0];
const opt = name => { const i = args.indexOf('--' + name); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const pos = n => args.filter((a, i) => i > 0 && !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'))[n];
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// ── GitHub ──
function token() {
  if (process.env.SIGNOFF_TOKEN && process.env.SIGNOFF_TOKEN.trim()) return process.env.SIGNOFF_TOKEN.trim();
  try { const a = readJson(path.join(os.homedir(), '.signoff', 'auth.json')); if (a && a.access && a.expiresAt > Date.now()) return a.access; } catch (e) { /* none */ }
  const file = path.join(root, '..', 'ee_tools_token.txt');
  if (fs.existsSync(file)) { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; }
  try { const t = childProcess.execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (t) return t; } catch (e) { /* no gh */ }
  throw new CliError('No GitHub token: run `node ee_design_review/tools/signoff.js login`, or set SIGNOFF_TOKEN.');
}
let tok = null;
async function gh(p, o = {}) {
  tok = tok || token();
  const r = await fetch('https://api.github.com' + p, Object.assign({}, o, { headers: { Authorization: 'Bearer ' + tok, Accept: o.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pincheck-scan' } }));
  if (r.status === 404 && o.allow404) return null;
  if (!r.ok) throw new CliError('GitHub ' + r.status + ' on ' + p.replace(/\?.*/, '') + ': ' + (await r.text()).slice(0, 200));
  return o.raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}
const repo = p => `/repos/${REPO.owner}/${REPO.name}` + p;
async function head() {
  const ref = await gh(repo('/git/ref/heads/main'));
  const commit = await gh(repo('/git/commits/' + ref.object.sha));
  const tree = await gh(repo('/git/trees/' + commit.tree.sha + '?recursive=1'));
  if (tree.truncated) throw new CliError('pincheck_data\'s tree is too large to list in one call');
  return { sha: ref.object.sha, tree: commit.tree.sha, files: new Map(tree.tree.filter(x => x.type === 'blob').map(x => [x.path, x.sha])) };
}
// Blobs by their sha, cached, so a second run reads nothing it already has.
async function blob(sha) {
  const f = path.join(HOME, 'blobs', sha);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const b = await gh(repo('/git/blobs/' + sha), { raw: true });
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b);
  return b;
}

// ── library: a local copy of pincheck_data's parts, designs, and interfaces ──
async function library() {
  const h = await head();
  if (opt('refresh')) fs.rmSync(DATA, { recursive: true, force: true });
  const want = [...h.files].filter(([p]) => /^(parts|designs|interfaces)\/[^/]+\.json$/.test(p));
  fs.rmSync(DATA, { recursive: true, force: true });
  for (const [p, sha] of want) { const out = path.join(DATA, p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, await blob(sha)); }
  fs.writeFileSync(path.join(DATA, 'HEAD'), h.sha + '\n');
  const n = d => want.filter(([p]) => p.startsWith(d + '/')).length;
  console.log('pincheck_data ' + h.sha.slice(0, 7) + ': ' + plural(n('parts'), 'part file') + ', ' + plural(n('designs'), 'design record') + ', ' + plural(n('interfaces'), 'mate profile') + ' in ' + DATA);
}

const jsonDir = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => /\.json$/i.test(f)).map(f => { try { return readJson(path.join(d, f)); } catch (e) { return null; } }).filter(Boolean) : [];

// ── run: the offline checks on a project ──
const WANT = /\.(schdoc|net|xml|prjpcb|prjpcbvariants)$/i;
const SKIP = /(^|[\\/])(__MACOSX|\.git|History|Project Logs for [^\\/]*|Project Outputs for [^\\/]*)([\\/]|$)/i;
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (SKIP.test(e.name + '/') ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]); }
async function projectFiles(src) {
  if (!fs.existsSync(src)) throw new CliError('No such folder or file: ' + src);
  if (fs.statSync(src).isDirectory()) {
    return walk(src).filter(p => WANT.test(p) && !SKIP.test(path.relative(src, p))).map(p => { const f = new File([fs.readFileSync(p)], path.basename(p)); f.path = path.relative(src, p).replace(/\\/g, '/'); return f; });
  }
  const f = new File([fs.readFileSync(src)], path.basename(src)); f.path = path.basename(src);
  return PK.archive.expand([f]);
}

async function load(src, variant, o = {}) {
  const libDir = o.library || opt('library') || DATA;
  const files = await projectFiles(src);
  if (!files.length) throw new CliError('No SchDoc sheets or netlist in ' + src);
  const design = await D.build(files);
  if (variant != null && variant !== true) {
    if (variant && !(design.variants || []).some(v => v.name === variant)) throw new CliError('No variant "' + variant + '". The project has: ' + ((design.variants || []).map(v => v.name).join(', ') || 'none'));
    design.variant = variant; D.applyVariant(design.parts, design.variants || [], variant);
  }
  const lib = jsonDir(path.join(libDir, 'parts')).concat(o.parts ? jsonDir(o.parts) : []).concat(opt('extra') ? jsonDir(opt('extra')) : []).filter(f => f.schema === L.SCHEMA);
  // Connector assignments and the profiles they name: pincheck_data's, then the repo's standard ones.
  const rec = jsonDir(path.join(libDir, 'designs')).find(r => r.key === L.slug(design.name) || L.slug(r.design || '') === L.slug(design.name));
  const profiles = {};
  for (const p of jsonDir(path.join(root, 'interfaces')).concat(jsonDir(path.join(libDir, 'interfaces')))) if (p.id) profiles[p.id] = p;
  const conn = rec ? { assign: rec.connectors || [], profiles } : null;
  const run = PK.checks.run(design, lib, conn);
  return { files, design, lib, run, conn };
}

const netName = n => String(n.name).replace(/^\//, '');
const SHOW = /^(value|comment|description|footprint|manufacturer( 1)?|manufacturer part number( 1)?|mpn|part number|.*(volt|rating|toler|power|current|dielectric|temp|wattage|package).*)$/i;
function partLine(p, f) {
  const params = Object.entries(p.params || {}).filter(([k, v]) => v && String(v).length <= 80 && SHOW.test(k) && !/^=/.test(v)).map(([k, v]) => k + '=' + v);
  return '### ' + p.ref + (p.mpn ? ' ' + p.mpn : '') + ' [' + p.kind + ']' + (p.dnp ? ' NOT FITTED' : '') + '\n' +
    (p.description ? p.description + '\n' : '') + (params.length ? 'Params: ' + params.join('; ') + '\n' : '') +
    (f ? 'Part file: ' + f.id + ' (' + L.status(f) + ', ' + f.values.filter(v => v.ok).length + ' of ' + f.values.length + ' values verified)\n' : (p.kind === 'ic' || p.kind === 'crystal' ? 'Part file: none\n' : ''));
}
function dump(design, lib, run, outDir) {
  const netOf = new Map();
  for (const n of design.nets || []) for (const x of n.nodes) netOf.set(x.ref + '.' + x.pin, netName(n));
  const sheetsOf = new Map(); // net → sheets
  const bySheet = new Map();
  for (const p of design.parts) {
    const ss = p.sheets && p.sheets.length ? p.sheets : ['(netlist only)'];
    for (const s of ss) { if (!bySheet.has(s)) bySheet.set(s, []); bySheet.get(s).push(p); }
    for (const pin of p.pins) { const n = netOf.get(p.ref + '.' + pin.num); if (n) { if (!sheetsOf.has(n)) sheetsOf.set(n, new Set()); ss.forEach(s => sheetsOf.get(n).add(s)); } }
  }
  const dir = path.join(outDir, 'design');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [sheet, parts] of [...bySheet].sort((a, b) => D.natural(a[0], b[0]))) {
    parts.sort((a, b) => D.natural(a.ref, b.ref));
    let md = '# Sheet ' + sheet + '\n\n' + plural(parts.length, 'part') + '. Each pin: number, name, and its net ("(open)" when on no net). Nets also on other sheets are marked ↗.\n\n';
    for (const p of parts) {
      const f = p.mpn ? L.find(lib, p.mpn) : null;
      md += partLine(p, f);
      md += 'Pins: ' + p.pins.map(pin => { const n = netOf.get(p.ref + '.' + pin.num); return pin.num + (pin.name && pin.name !== pin.num ? ' ' + pin.name : '') + ' = ' + (n ? n + (sheetsOf.get(n).size > 1 ? ' ↗' : '') : '(open)'); }).join(' · ') + '\n\n';
    }
    const file = 'sheet-' + L.slug(sheet.replace(/\.schdoc$/i, '')) + '.md';
    fs.writeFileSync(path.join(dir, file), md);
    files.push({ sheet, file, parts: parts.length, bytes: Buffer.byteLength(md) });
  }
  const shared = [...sheetsOf].filter(([, s]) => s.size > 1).sort((a, b) => D.natural(a[0], b[0]));
  let idx = '# ' + design.name + '\n\n' + 'Source: ' + design.source + (design.netlist ? ', ' + design.netlist + ' netlist' : ', no netlist') + '. ' + plural(design.parts.length, 'part') + ', ' + plural((design.nets || []).length, 'net') + '.' +
    (design.variant ? ' Build variant: ' + design.variant + '.' : '') + '\n\n' + (design.notes.length ? design.notes.map(n => '- ' + n).join('\n') + '\n\n' : '') +
    '## Sheets\n\n' + files.map(f => '- ' + f.sheet + ': ' + plural(f.parts, 'part') + ' → ' + f.file).join('\n') + '\n\n' +
    '## Rails the offline checks worked out\n\n' + (run.rails.length ? run.rails.map(r => '- ' + r.net + ': ' + r.v + ' V from ' + r.from + (r.unverified ? ' (unverified)' : '')).join('\n') : '(none)') + '\n\n' +
    '## Nets on more than one sheet\n\n' + shared.map(([n, s]) => '- ' + n + ': ' + [...s].join(', ')).join('\n') + '\n\n' +
    '## Parts and their part files\n\n' + D.groups(design, ['ic', 'crystal']).map(g => { const f = g.mpn && L.find(lib, g.mpn); return '- ' + g.refs.join(', ') + ': ' + (g.mpn || '(no part number)') + ' → ' + (f ? f.id + ' (' + L.status(f) + ')' : 'no part file'); }).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'index.md'), idx);
  return files;
}

async function runCmd() {
  const src = pos(0), out = opt('out');
  if (!src || !out || out === true) throw new CliError('Usage: scan.js run <project folder or .zip> --out <dir> [--variant <name>] [--extra <dir>] [--library <dir>]');
  if (!opt('library') && !fs.existsSync(path.join(DATA, 'parts'))) throw new CliError('No local library yet: run `node tools/scan.js library` first (or pass --library <dir>).');
  const { files, design, lib, run, conn } = await load(src, opt('variant'));
  fs.mkdirSync(out, { recursive: true });
  const version = (/VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'assets', 'version.js'), 'utf8')) || [])[1] || '';
  const libHead = fs.existsSync(path.join(DATA, 'HEAD')) ? fs.readFileSync(path.join(DATA, 'HEAD'), 'utf8').trim() : '';
  const project = { name: design.name, source: design.source, netlist: design.netlist || '', variant: design.variant || '', variants: (design.variants || []).map(v => v.name), path: path.resolve(src),
    files: await Promise.all(files.map(async f => ({ path: f.path || f.name, bytes: f.size, sha256: sha256(Buffer.from(await f.arrayBuffer())) }))) };
  writeJson(path.join(out, 'project.json'), project);
  const count = s => run.findings.filter(f => f.severity === s).length;
  writeJson(path.join(out, 'offline.json'), {
    pincheck: version, library: { head: libHead, files: lib.length, extra: opt('extra') ? jsonDir(opt('extra')).map(f => f.id) : [] }, connectors: conn ? conn.assign.length : 0,
    at: now(), design: design.name, variant: design.variant || '', parts: design.parts.length, nets: (design.nets || []).length, notes: design.notes,
    counts: { error: count('error'), warn: count('warn'), info: count('info') },
    findings: run.findings.map(f => ({ id: f.id, check: f.check, severity: f.severity, title: f.title, detail: f.detail, refs: f.refs, pins: f.pins, nets: f.nets, unverified: !!f.unverified })),
    rails: run.rails, coverage: run.coverage, checks: PK.checks.CATALOG.map(c => ({ key: c.key, group: c.group, title: c.title }))
  });
  // The parts to fill, as Pincheck's Batch configure saves them: ICs and crystals with no part file, then parts a check wanted one for.
  const want = new Set(run.needFiles || []);
  const groups = D.groups(design, ['ic', 'crystal']).filter(g => g.mpn && !L.find(lib, g.mpn));
  const have = new Set(groups.map(g => g.mpn));
  for (const g of D.groups(design, null)) if (g.mpn && !have.has(g.mpn) && g.refs.some(r => want.has(r)) && !L.find(lib, g.mpn)) { groups.push(g); have.add(g.mpn); }
  writeJson(path.join(out, 'missing.json'), groups.map(g => Object.assign(L.strip(L.fromSchematic(g.part, 'pincheck-scan skill')), { refs: g.refs })));
  const sheets = dump(design, lib, run, out);
  console.log(design.name + ': ' + plural(design.parts.length, 'part') + ', ' + plural((design.nets || []).length, 'net') + ', ' + plural(sheets.length, 'sheet') + (design.variant ? ', variant ' + design.variant : '') + '.');
  design.notes.forEach(n => console.log('  ' + n));
  console.log('Offline: ' + run.findings.length + ' findings (' + count('error') + ' errors, ' + count('warn') + ' warnings, ' + count('info') + ' notes) against ' + plural(lib.length, 'part file') + (conn ? ' and ' + plural(conn.assign.length, 'connector assignment') : '') + '.');
  console.log('Parts with no part file: ' + groups.length + (groups.length ? ' (' + groups.map(g => g.mpn).join(', ') + ')' : '') + '.');
  console.log('Wrote ' + path.resolve(out) + ': offline.json, project.json, missing.json, design/index.md and ' + plural(sheets.length, 'sheet file') + ' (' + Math.round(sheets.reduce((s, f) => s + f.bytes, 0) / 1024) + ' KB).');
}

// ── check: a scan.json is well formed and points at things that exist ──
function validateScan(scan, offline, design) {
  const errs = [], warns = [];
  if (scan.schema !== SCAN) errs.push('schema should be "' + SCAN + '"');
  for (const k of ['id', 'design', 'at', 'by']) if (!scan[k]) errs.push(k + ' is missing');
  if (!/^\d{8}-\d{4}$/.test(scan.id || '')) errs.push('id should be the scan\'s UTC time as YYYYMMDD-HHMM');
  if (!Array.isArray(scan.reviewed) || !scan.reviewed.length) errs.push('reviewed should list each area Claude went through and what it checked there');
  if (!Array.isArray(scan.items)) errs.push('items should be a list');
  const offIds = new Set(((offline && offline.findings) || []).map(f => f.id));
  const checks = new Set(PK.checks.CATALOG.map(c => c.key));
  const refs = design ? new Set(design.parts.map(p => p.ref)) : null;
  const pins = design ? new Set(design.parts.flatMap(p => p.pins.map(x => p.ref + '.' + x.num))) : null;
  const nets = design ? new Set((design.nets || []).map(netName)) : null;
  const ids = new Set();
  (scan.items || []).forEach((it, i) => {
    const at = 'item ' + (it.id || i + 1);
    if (!it.id) errs.push(at + ': no id'); else if (ids.has(it.id)) errs.push(at + ': duplicate id'); else ids.add(it.id);
    if (!TYPES.includes(it.type)) errs.push(at + ': type should be one of ' + TYPES.join(', '));
    if (!SEVERITIES.includes(it.severity)) errs.push(at + ': severity should be one of ' + SEVERITIES.join(', '));
    if (!it.title) errs.push(at + ': no title');
    if (!it.detail) errs.push(at + ': no detail');
    if (!['high', 'medium', 'low'].includes(it.confidence)) errs.push(at + ': confidence should be high, medium, or low');
    if (it.type === 'false-alarm' && !offIds.has(it.offline)) errs.push(at + ': a false alarm names the offline finding it disputes (offline), which must be in offline.json');
    if (it.offline && !offIds.has(it.offline)) errs.push(at + ': offline "' + it.offline + '" is not in offline.json');
    if (it.type === 'data' && !checks.has(it.check)) errs.push(at + ': a data item names the offline check that would have caught it (check)');
    if (it.check && !checks.has(it.check)) errs.push(at + ': check "' + it.check + '" is not an offline check');
    if ((it.type === 'missed' || it.type === 'false-alarm') && !it.rule) errs.push(at + ': give the general rule an offline check would follow (rule)');
    if (it.type === 'data' && !it.needs) errs.push(at + ': say which part data is missing or wrong (needs)');
    if (it.type !== 'idea' && !(it.evidence || []).length) warns.push(at + ': no evidence (a datasheet page or the nets that show it)');
    if (refs) {
      for (const r of it.refs || []) if (!refs.has(r)) errs.push(at + ': ref ' + r + ' is not in the design');
      for (const p of it.pins || []) if (!pins.has(p)) errs.push(at + ': pin ' + p + ' is not in the design');
      for (const n of it.nets || []) if (!nets.has(n)) errs.push(at + ': net ' + n + ' is not in the design');
    }
  });
  for (const id of scan.agrees || []) if (!offIds.has(id)) errs.push('agrees: ' + id + ' is not in offline.json');
  return { errs, warns };
}
async function checkCmd() {
  const dir = pos(0);
  if (!dir) throw new CliError('Usage: scan.js check <scan dir>');
  const scan = readJson(path.join(dir, 'scan.json')), offline = readJson(path.join(dir, 'offline.json'));
  const project = readJson(path.join(dir, 'project.json'));
  let design = null;
  if (fs.existsSync(project.path)) { design = (await load(project.path, project.variant)).design; } else console.log('Project not found at ' + project.path + ': refs, pins, and nets not checked.');
  const { errs, warns } = validateScan(scan, offline, design);
  const parts = jsonDir(path.join(dir, 'parts'));
  for (const f of parts) for (const e of L.validate(f)) errs.push('parts/' + f.id + '.json: ' + e);
  if (warns.length) console.log('Warnings:\n  ' + warns.join('\n  '));
  if (errs.length) { console.log('Errors:\n  ' + errs.join('\n  ')); process.exitCode = 1; return; }
  const by = TYPES.map(t => [t, scan.items.filter(i => i.type === t).length]).filter(x => x[1]);
  console.log('OK: ' + plural(scan.items.length, 'item') + (by.length ? ' (' + by.map(([t, n]) => n + ' ' + t).join(', ') + ')' : '') + ', ' + (scan.agrees || []).length + ' of ' + offline.findings.length + ' offline findings agreed, ' + plural(parts.length, 'part file') + '.');
}

// ── push, list, pull, record: scans in pincheck_data ──
const scanBase = scan => 'scans/' + L.slug(scan.design) + '/' + scan.id + '/';
async function commitFiles(files, message, allowReplace) {
  const h = await head();
  const plan = [];
  for (const [p, buf] of files) {
    const sha = crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
    const was = h.files.get(p);
    if (was && !allowReplace.has(p)) throw new CliError(p + ' is already in pincheck_data; a scan is only ever added. Pick a new scan id.');
    if (was === sha) continue;
    plan.push({ p, buf, sha, was });
  }
  const code = crypto.createHash('sha1').update(h.sha + plan.map(x => x.p + x.sha).join()).digest('hex').slice(0, 6);
  console.log('pincheck_data main at ' + h.sha.slice(0, 7) + '. ' + (plan.length ? 'Would ' : 'Nothing to write.') + (plan.length ? 'commit "' + message + '":' : ''));
  for (const x of plan) console.log('  ' + (x.was ? 'replace ' : 'add     ') + x.p + ' (' + x.buf.length + ' bytes)');
  if (!plan.length) return;
  console.log('Every other file stays as it is (' + h.files.size + ' files).');
  if (opt('dry-run')) { console.log('Dry run. To write it: --confirm ' + code); return; }
  if (opt('confirm') !== code) throw new CliError('Give --confirm ' + code + ' (from a dry run against this head) to write.');
  const tree = [];
  for (const x of plan) {
    const b = await gh(repo('/git/blobs'), { method: 'POST', body: JSON.stringify({ content: x.buf.toString('base64'), encoding: 'base64' }) });
    if (b.sha !== x.sha) throw new CliError('GitHub stored ' + x.p + ' as ' + b.sha + ', expected ' + x.sha);
    tree.push({ path: x.p, mode: '100644', type: 'blob', sha: b.sha });
  }
  const t = await gh(repo('/git/trees'), { method: 'POST', body: JSON.stringify({ base_tree: h.tree, tree }) });
  const c = await gh(repo('/git/commits'), { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [h.sha] }) });
  await gh(repo('/git/refs/heads/main'), { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
  // Read back: every file written, byte for byte, and nothing else changed.
  const after = await head();
  for (const x of plan) if (!(await gh(repo('/contents/' + x.p.split('/').map(encodeURIComponent).join('/') + '?ref=' + c.sha), { raw: true })).equals(x.buf)) throw new CliError('Read back: ' + x.p + ' differs');
  const changed = [...after.files].filter(([p, s]) => h.files.get(p) !== s && !plan.some(x => x.p === p)).map(([p]) => p);
  const gone = [...h.files.keys()].filter(p => !after.files.has(p));
  if (changed.length || gone.length) throw new CliError('Read back: other files changed: ' + changed.concat(gone).join(', '));
  console.log('Committed ' + c.sha.slice(0, 7) + ' and read back: ' + plural(plan.length, 'file') + ', nothing else changed.');
}
async function pushCmd() {
  const dir = pos(0);
  if (!dir) throw new CliError('Usage: scan.js push <scan dir> --dry-run | --confirm <code>');
  const scan = readJson(path.join(dir, 'scan.json')), offline = readJson(path.join(dir, 'offline.json'));
  const { errs } = validateScan(scan, offline, null);
  if (errs.length) throw new CliError('scan.json has errors; run `scan.js check` first:\n  ' + errs.join('\n  '));
  const base = scanBase(scan), files = [];
  for (const f of ['scan.json', 'offline.json', 'project.json']) files.push([base + f, fs.readFileSync(path.join(dir, f))]);
  const pd = path.join(dir, 'parts');
  if (fs.existsSync(pd)) for (const f of fs.readdirSync(pd).filter(f => /\.json$/.test(f))) files.push([base + 'parts/' + f, fs.readFileSync(path.join(pd, f))]);
  await commitFiles(files, 'Pincheck: Claude scan of ' + scan.design + ' (' + scan.id + ')', new Set());
}
async function listCmd() {
  const h = await head(), want = pos(0) ? L.slug(pos(0)) : null;
  const scans = new Map();
  for (const p of h.files.keys()) { const m = /^scans\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(p); if (m && (!want || m[1] === want)) { const k = m[1] + '/' + m[2]; if (!scans.has(k)) scans.set(k, new Set()); scans.get(k).add(m[3]); } }
  if (!scans.size) { console.log('No scans' + (want ? ' of ' + want : '') + ' in pincheck_data.'); return; }
  for (const [k, fs2] of [...scans].sort()) {
    const scan = JSON.parse(await blob(h.files.get('scans/' + k + '/scan.json')));
    const dec = fs2.has('decisions.json') ? JSON.parse(await blob(h.files.get('scans/' + k + '/decisions.json'))) : null;
    const states = dec ? Object.values(dec.items || {}).map(d => d.state) : [];
    console.log(k + ': ' + plural(scan.items.length, 'item') + ', ' + (dec ? states.filter(s => s === 'confirmed').length + ' confirmed, ' + states.filter(s => s === 'rejected').length + ' rejected' : 'not reviewed yet') + (fs2.has('improved.json') ? ', improved' : ''));
  }
}
async function pullCmd() {
  const which = pos(0), out = opt('out');
  if (!which || !out || out === true) throw new CliError('Usage: scan.js pull <design>/<scan id> --out <dir>');
  const [d, id] = which.split('/');
  const base = 'scans/' + L.slug(d) + '/' + id + '/';
  const h = await head();
  const files = [...h.files].filter(([p]) => p.startsWith(base));
  if (!files.length) throw new CliError('No scan ' + base + ' in pincheck_data. `scan.js list` shows them.');
  for (const [p, sha] of files) { const o = path.join(out, p.slice(base.length)); fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, await blob(sha)); }
  console.log('Wrote ' + plural(files.length, 'file') + ' to ' + path.resolve(out) + ' (pincheck_data ' + h.sha.slice(0, 7) + ')' + (files.some(([p]) => p.endsWith('decisions.json')) ? '' : '. No decisions yet: Chris reviews the scan in Pincheck first.'));
}
async function recordCmd() {
  const dir = pos(0), file = opt('improved');
  if (!dir || !file || file === true) throw new CliError('Usage: scan.js record <scan dir> --improved <file.json> --dry-run | --confirm <code>');
  const scan = readJson(path.join(dir, 'scan.json')), imp = readJson(file);
  if (imp.schema !== IMPROVED || imp.scan !== scan.id) throw new CliError('improved file should have schema "' + IMPROVED + '" and scan "' + scan.id + '"');
  const p = scanBase(scan) + 'improved.json';
  await commitFiles([[p, fs.readFileSync(file)]], 'Pincheck: what self-improve did with the scan of ' + scan.design + ' (' + scan.id + ')', new Set([p]));
}

const CMDS = { library, run: runCmd, check: checkCmd, push: pushCmd, list: listCmd, pull: pullCmd, record: recordCmd };
module.exports = { validateScan, load, SCAN, DECISIONS, IMPROVED, TYPES };
if (require.main === module) {
  if (!CMDS[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
  CMDS[cmd]().catch(e => { console.error(e instanceof CliError ? e.message : e.stack); process.exit(1); });
}
