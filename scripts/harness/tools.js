'use strict';
/* AGENT HARNESS — the tool registry, as an exit code.
   Replaces: a support table in prose. scripts/harness/tools.json holds one row per coding agent:
   how it reaches the policy file, where its pre-tool hook is registered, which wire format that
   hook speaks, and the tier of enforcement that adds up to. Every later piece of multi-tool
   wiring reads a tool fact from a row, so a wrong row is a wrong adapter, and a row nobody
   validated is a guess with a filename.

   WHAT --check REFUSES (exit 1, each finding naming the ROW and the FIELD):
     1. an empty registry, or one that is not { dialects: [...], tools: [...] }
     2. a row missing a required field. A cell nobody established is written as null, on
        purpose: an ABSENT key cannot be told from a forgotten one
     3. a field value outside its domain, and a key the registry does not define
     4. two rows with one id: the second would shadow the first at every lookup
     5. a row with evidence `ran` and no recorded `command`. "It was run" with nothing to re-run
        is `docs` evidence wearing a better label
     6. a tier the row's own cells contradict: a `full` row with no session-start event, a
        `backstop` row with a dialect, an `inherits` row with any cell of its own. A `backstop`
        row MAY record a hook file the tool documents: what makes it a backstop is that the
        harness has no dialect for it, not that the tool has no hook
     7. an id in `tools.enabled` of harness.config.json that has no row, or whose row is tier
        `inherits`: a model has nothing to wire, so the host's row is the one to enable. Also an
        enabled `native` row whose file is not the policy file: enabling it would make a second
        policy body the thing that tool loads
     9. an `import` row whose stub file carries a directory: a stub is found by its NAME,
        wherever it is planted, so a path there is a stub no sweep would recognise
     8. a dialect list with a repeated name. An EMPTY list is legal: a registry of `backstop`
        rows wires nothing and needs no wire format

   EVIDENCE IS PRINTED, NEVER UPGRADED. --list shows `docs` or `ran` as the row states it, and
   nothing here reports a `docs` row as verified.

   The registry sits BESIDE this script, not under the configured repo: it is harness data, the
   same for every repo the harness is copied into. Only `tools.enabled` is the project's.

   --check      validate every row and every enabled id; last line is the GATE line
   --list       id, tier, evidence, and whether the config enables it. Exit 1, with the table
                still printed, on a registry --check would refuse: a refused registry must not
                read as a short but successful listing
   --matrix     each hard rule of the policy file against each ENABLED tool. A cell is the
                mechanism that enforces the rule under that tool in THIS repo, worked out from
                the tool's registration, the handler table and the config's gates, or `prose`.
                Exit 1, with no table, on a registry --check would refuse. It is a report, not
                a gate: it prints no GATE line
   Exactly one mode per run: two on one command line is a usage error (exit 2), never one of
   them silently dropped.
   --self-test  drive the pure decision with literals, including the cases that must come out NO
   Zero-dep, Node built-ins only.
   Usage: node scripts/harness/tools.js --check | --list | --self-test | --matrix */
const fs = require('node:fs');
const path = require('node:path');

const { load, fatal, DEFAULTS } = require(path.join(__dirname, 'config.js'));

const REGISTRY = path.join(__dirname, 'tools.json');
const REGISTRY_REL = 'scripts/harness/tools.json';

/* ---------- the row contract ---------- */

const REQUIRED = ['id', 'policy', 'nested', 'hookConfig', 'dialect', 'sessionStart', 'projectHooks',
  'tier', 'evidence', 'asOf', 'source'];
const OPTIONAL = ['name', 'command', 'notes', 'skills'];
const POLICY_MODES = ['native', 'import', 'config'];
const POLICY_KEYS = ['mode', 'file', 'setting'];
const NESTED = ['on-touch', 'startup', 'yes', 'unknown'];
const TIERS = ['full', 'guard-only', 'backstop', 'inherits'];
const EVIDENCE = ['docs', 'ran'];
const REGISTRY_KEYS = ['_readme', 'dialects', 'tools'];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isId = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v);
const show = (v) => (v === undefined ? 'nothing' : JSON.stringify(v));
const oneOf = (list) => list.map((x) => '`' + x + '`').join(', ');

/** A date that exists. `2026-02-30` matches the pattern and is not a day. */
function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/* ---------- pure decisions (every one is exercised by --self-test) ---------- */

/** The findings for ONE row, each `{ field, why }`. `dialects` is the registry's own list: the
 *  wire formats are named in the data file, so this script names no tool. It is null when that
 *  list is itself refused: the row's dialect then cannot be judged, and the one finding is the
 *  list's. */
function checkRow(row, dialects) {
  const out = [];
  const bad = (field, why) => out.push({ field: field, why: why });
  if (!isPlain(row)) { bad('(row)', 'must be an object'); return out; }

  for (const k of REQUIRED) {
    if (!(k in row)) bad(k, 'missing required field — write null if it is not established, never leave it out');
  }
  for (const k of Object.keys(row)) {
    if (!REQUIRED.includes(k) && !OPTIONAL.includes(k)) bad(k, 'unknown field (allowed: ' + REQUIRED.concat(OPTIONAL).join(', ') + ')');
  }
  const has = (k) => k in row;

  if (has('id') && !isId(row.id)) bad('id', 'must be kebab-case (got ' + show(row.id) + ')');
  if (has('name') && !isStr(row.name)) bad('name', 'must be a non-empty string');
  if (has('notes') && !isStr(row.notes)) bad('notes', 'must be a non-empty string');

  if (has('policy') && row.policy !== null) {
    const p = row.policy;
    if (!isPlain(p)) bad('policy', 'must be { mode, file } or null (got ' + show(p) + ')');
    else {
      for (const k of Object.keys(p)) if (!POLICY_KEYS.includes(k)) bad('policy.' + k, 'unknown field (allowed: ' + POLICY_KEYS.join(', ') + ')');
      if (!POLICY_MODES.includes(p.mode)) bad('policy.mode', 'unknown value ' + show(p.mode) + ' (one of ' + oneOf(POLICY_MODES) + ')');
      if (!isStr(p.file)) bad('policy.file', 'must name the file the tool loads, or the config file that points it there');
      if (p.mode === 'config' && !isStr(p.setting)) bad('policy.setting', 'mode `config` must name the setting that points the tool at the policy file');
      if (p.mode !== 'config' && 'setting' in p) bad('policy.setting', 'only mode `config` carries a setting');
      // A stub is recognised by its basename, at the root and beside every nested policy file.
      if (p.mode === 'import' && isStr(p.file) && /[\\/]/.test(p.file)) bad('policy.file', 'an `import` stub is a bare file name, found wherever it is planted — a path (got ' + show(p.file) + ') names a file no sweep would recognise as a stub');
    }
  }
  if (has('nested') && row.nested !== null && !NESTED.includes(row.nested)) {
    bad('nested', 'unknown value ' + show(row.nested) + ' (one of ' + oneOf(NESTED) + ', or null)');
  }
  if (has('hookConfig') && row.hookConfig !== null && !isStr(row.hookConfig)) bad('hookConfig', 'must be a path or null (got ' + show(row.hookConfig) + ')');
  // The installer WRITES under this directory, so it has to stay inside the repo: no absolute
  // path, no home, no climbing out, and no trailing slash that would name it twice.
  if (has('skills') && (!isStr(row.skills) || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(row.skills) || row.skills.split('/').includes('..'))) {
    bad('skills', 'must be a repo-relative directory with forward slashes (got ' + show(row.skills) + ') — leave the key out when it is not established');
  }
  if (has('dialect') && row.dialect !== null && dialects && !dialects.includes(row.dialect)) {
    bad('dialect', 'unknown value ' + show(row.dialect) + ' (one of ' + oneOf(dialects) + ', or null)');
  }
  for (const k of ['sessionStart', 'projectHooks']) {
    if (has(k) && row[k] !== null && typeof row[k] !== 'boolean') bad(k, 'must be true, false or null (got ' + show(row[k]) + ')');
  }
  if (has('tier') && !TIERS.includes(row.tier)) bad('tier', 'unknown value ' + show(row.tier) + ' (one of ' + oneOf(TIERS) + ')');
  if (has('evidence') && !EVIDENCE.includes(row.evidence)) bad('evidence', 'unknown value ' + show(row.evidence) + ' (one of ' + oneOf(EVIDENCE) + ')');
  if (has('asOf') && !isDate(row.asOf)) bad('asOf', 'must be the YYYY-MM-DD the evidence was gathered (got ' + show(row.asOf) + ')');
  if (has('source')) {
    if (!Array.isArray(row.source) || row.source.length === 0) bad('source', 'must be a non-empty array — a row with no source cannot be re-checked');
    else row.source.forEach((s, i) => { if (!isStr(s)) bad('source[' + i + ']', 'must be a non-empty string'); });
  }

  // `ran` is a claim that somebody can repeat. Without the command it is not one.
  if (row.evidence === 'ran' && !isStr(row.command)) bad('command', 'evidence `ran` needs the command that was run — without it the row is `docs`');
  if (row.evidence === 'docs' && has('command')) bad('command', 'a `docs` row records no command — nothing was run, so nothing may read as if it had been');
  if (has('command') && row.evidence !== 'ran' && row.evidence !== 'docs' && !isStr(row.command)) bad('command', 'must be a non-empty string');

  // THE TIER IS A CONCLUSION, and the cells are its premises. A row whose cells do not add up
  // to its tier is the registry promising enforcement the tool cannot give.
  const wired = isStr(row.hookConfig) && isStr(row.dialect);
  if (row.tier === 'inherits') {
    for (const k of ['policy', 'nested', 'hookConfig', 'dialect', 'sessionStart', 'projectHooks']) {
      if (has(k) && row[k] !== null) bad(k, 'tier `inherits` is a model, not an agent: it has no ' + k + ' of its own, so this must be null');
    }
  } else if (TIERS.includes(row.tier)) {
    if (has('policy') && row.policy === null) bad('policy', 'only tier `inherits` may have no policy route');
  }
  if (row.tier === 'full') {
    if (!wired) bad('tier', '`full` needs a hookConfig and a dialect');
    if (row.sessionStart !== true) bad('tier', '`full` needs sessionStart true (got ' + show(row.sessionStart) + ') — without it the tier is `guard-only`');
    if (row.projectHooks !== true) bad('tier', '`full` needs projectHooks true (got ' + show(row.projectHooks) + ') — without it the tier is `guard-only`');
  }
  if (row.tier === 'guard-only') {
    if (!wired) bad('tier', '`guard-only` needs a hookConfig and a dialect — with neither the tier is `backstop`');
    else if (row.sessionStart === true && row.projectHooks === true) bad('tier', '`guard-only` with session-start and project hooks both true is `full`');
  }
  // A backstop row may know where the tool's hook lives: with no dialect the harness still
  // cannot wire it. What it may not do is name a dialect, or claim a checked-in hook file it
  // does not record.
  if (row.tier === 'backstop') {
    if (has('dialect') && row.dialect !== null) {
      bad('dialect', 'tier `backstop` means no hook the harness can wire, so there is no dialect — a row with one is `guard-only` or `full`');
    }
    if (row.projectHooks === true && !isStr(row.hookConfig)) {
      bad('projectHooks', 'true means hookConfig can be a checked-in project file, and this row records no hookConfig');
    }
  }
  return out;
}

/** The whole verdict: the registry document plus the config's enabled list in, findings out.
 *  Each finding is `{ unit, where, why }`; `unit` is what the GATE line counts (the registry
 *  itself, one row, one enabled id) and `where` is the `row.field` a reader has to edit. */
function validate(reg, enabled) {
  const findings = [];
  const units = ['registry'];
  const add = (unit, where, why) => findings.push({ unit: unit, where: where, why: why });

  if (!isPlain(reg)) {
    add('registry', 'registry', 'must be an object { dialects: [...], tools: [...] }');
    return { findings: findings, units: units, ids: [] };
  }
  for (const k of Object.keys(reg)) {
    if (!REGISTRY_KEYS.includes(k)) add('registry', 'registry.' + k, 'unknown key (allowed: ' + REGISTRY_KEYS.join(', ') + ')');
  }
  let dialects = null;
  if (!Array.isArray(reg.dialects) || !reg.dialects.every(isId)) add('registry', 'registry.dialects', 'must be an array of kebab-case dialect names');
  else {
    const twice = reg.dialects.filter((d, i) => reg.dialects.indexOf(d) !== i);
    if (twice.length) add('registry', 'registry.dialects', 'repeats ' + oneOf(Array.from(new Set(twice))) + ' — one name is one wire format');
    else dialects = reg.dialects;
  }

  const rows = reg.tools;
  if (!Array.isArray(rows)) add('registry', 'registry.tools', 'must be an array of rows');
  else if (rows.length === 0) add('registry', 'registry.tools', 'the registry is empty — with no rows nothing can be enabled, wired or reported');

  const ids = [];
  const firstAt = new Map();   // id -> { index, row } of the first row carrying it
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    // A row with no usable id cannot be named back, so its index stands in until it has one.
    // A row REPEATING an id is named by index too: the id alone would point at two rows.
    const hasId = isPlain(row) && isId(row.id);
    const repeat = hasId && firstAt.has(row.id);
    const label = !hasId ? 'tools[' + i + ']' : (repeat ? 'tools[' + i + '] (' + row.id + ')' : row.id);
    const unit = 'row ' + label + ' #' + i;
    units.push(unit);
    for (const f of checkRow(row, dialects)) add(unit, label + '.' + f.field, f.why);
    if (repeat) add(unit, label + '.id', 'duplicate id — tools[' + firstAt.get(row.id).index + '] already has it, and a second row would shadow the first at every lookup');
    else if (hasId) { ids.push(row.id); firstAt.set(row.id, { index: i, row: row }); }
  });

  (Array.isArray(enabled) ? enabled : []).forEach((id) => {
    const unit = 'enabled ' + id;
    units.push(unit);
    if (!ids.includes(id)) {
      add(unit, 'tools.enabled.' + id, 'enabled in harness.config.json but has no row (rows: ' + (ids.join(', ') || 'none') + ')');
    } else if (firstAt.get(id).row.tier === 'inherits') {
      add(unit, 'tools.enabled.' + id, 'names a tier `inherits` row — a model has no policy route and no hook to wire, so enable the row of the host it runs in');
    } else {
      // ONE policy body. A native row loads its own file and nothing else, so enabling one whose
      // file is not the policy file means writing the rules a second time, in a file no gate
      // holds to the first. The row may exist; switching it on is what is refused.
      const p = firstAt.get(id).row.policy;
      if (isPlain(p) && p.mode === 'native' && isStr(p.file) && p.file !== POLICY_FILE) {
        add(unit, 'tools.enabled.' + id, 'its row loads `' + p.file + '` natively, which is not the policy file ' + POLICY_FILE + ' — enabling it needs a second policy body; give the row an `import` or `config` route to ' + POLICY_FILE + ' first');
      }
    }
  });
  return { findings: findings, units: units, ids: ids };
}

/** The --list table, as lines. Evidence is printed as the row states it and nothing more. An
 *  enabled id with no row gets a line of its own: left out, the table would read as if the
 *  config had enabled nothing. */
function listLines(reg, enabled) {
  const rows = (isPlain(reg) && Array.isArray(reg.tools) ? reg.tools : []).filter(isPlain);
  const on = Array.isArray(enabled) ? enabled : [];
  const orphans = on.filter((id) => !rows.some((r) => r.id === id));
  const cell = (v) => (typeof v === 'string' && v ? v : '?');
  const w = (k, head) => Math.max(head.length, ...rows.map((r) => cell(r[k]).length));
  const wi = Math.max(w('id', 'id'), ...orphans.map((id) => String(id).length));
  const wt = w('tier', 'tier'); const we = w('evidence', 'evidence');
  const line = (a, b, c, d) => (a.padEnd(wi) + '  ' + b.padEnd(wt) + '  ' + c.padEnd(we) + '  ' + d).trimEnd();
  return [line('id', 'tier', 'evidence', 'enabled')]
    .concat(rows.map((r) => line(cell(r.id), cell(r.tier), cell(r.evidence), on.includes(r.id) ? 'yes' : '')))
    .concat(orphans.map((id) => line(String(id), '-', '-', 'yes (no row)')));
}

/* ---------- the policy route: which files a tool holds at session start ----------
   ONE policy body exists, and this is its name. Every row reaches it one of three ways, and the
   row says which: `native` loads `file` itself, `import` loads `file` as a stub whose only content
   is the import line below, `config` is pointed at the policy file by a setting. Nothing else in
   the harness spells a tool's instruction file: the context measurement asks injectedFiles() what
   an enabled tool holds, and the doc gate asks stubFiles() which names must stay a pointer. */
const POLICY_FILE = 'AGENTS.md';
const IMPORT_LINE = '@' + POLICY_FILE;

const rowsOf = (reg) => (isPlain(reg) && Array.isArray(reg.tools) ? reg.tools : []).filter(isPlain);

/** The repo-relative files ONE row puts in context at session start, in load order. A `config`
 *  row's `file` is a settings file, not context: what it loads is the policy file. A row with no
 *  policy route (tier `inherits`) holds nothing of its own. */
function policyFilesOf(row) {
  const p = isPlain(row) ? row.policy : null;
  if (!isPlain(p) || !isStr(p.file)) return [];
  if (p.mode === 'native') return [p.file];
  if (p.mode === 'import') return [p.file, POLICY_FILE];
  if (p.mode === 'config') return [POLICY_FILE];
  return [];
}

/** Every file the ENABLED tools inject, once each, in first-seen order. An enabled id with no
 *  row contributes nothing here: enabledFindings() is what refuses it, by name, for --check and
 *  for the context measurement, which stops on it instead of grading an empty set. */
function injectedFiles(reg, enabled) {
  const out = [];
  for (const id of Array.isArray(enabled) ? enabled : []) {
    const row = rowsOf(reg).find((r) => r.id === id);
    for (const f of policyFilesOf(row)) if (!out.includes(f)) out.push(f);
  }
  return out;
}

/** The file names that are import stubs for SOME row, enabled or not. A stub is a pointer whether
 *  or not this repo has switched its tool on: a second policy body in a file a tool would load
 *  the day it is enabled is the drift the one-body rule exists to prevent. */
function stubFiles(reg) {
  const out = [];
  for (const r of rowsOf(reg)) {
    if (isPlain(r.policy) && r.policy.mode === 'import' && isStr(r.policy.file) && !out.includes(r.policy.file)) out.push(r.policy.file);
  }
  return out;
}

/** The stubs the ENABLED tools need: where one of these is missing, at the root or beside a
 *  nested policy file, that tool loads no policy for the directory. Unlike stubFiles() this is
 *  about what must EXIST, so a tool that is switched off demands nothing. */
function enabledStubFiles(reg, enabled) {
  const out = [];
  for (const id of Array.isArray(enabled) ? enabled : []) {
    const row = rowsOf(reg).find((r) => r.id === id);
    const p = isPlain(row) ? row.policy : null;
    if (isPlain(p) && p.mode === 'import' && isStr(p.file) && !out.includes(p.file)) out.push(p.file);
  }
  return out;
}

/** The rows the config enables, in the config's order. An id with no row is left out here and
 *  refused by enabledFindings(), so a caller that checked that first holds every row. */
function enabledRows(reg, enabled) {
  const rows = rowsOf(reg);
  return (Array.isArray(enabled) ? enabled : []).map((id) => rows.find((r) => r.id === id)).filter(Boolean);
}

/** The skill directories the ENABLED tools load from, once each, in first-seen order. A row with
 *  no `skills` cell adds nothing: where a tool looks was not established, so nothing is put there. */
function skillRoots(reg, enabled) {
  const out = [];
  for (const row of enabledRows(reg, enabled)) if (isStr(row.skills) && !out.includes(row.skills)) out.push(row.skills);
  return out;
}

/** What validate() found against the ENABLED list alone, as messages. The context measurement
 *  asks this before it measures: an id with no row injects nothing, and "nothing graded" is a
 *  diagnosis that sends the reader to the wrong file. */
function enabledFindings(reg, enabled) {
  return validate(reg, enabled).findings.filter((x) => /^enabled /.test(x.unit)).map((x) => x.where + ': ' + x.why);
}

/** Is there a policy BODY in this text? An empty file, or one holding only comments, exists on
 *  disk and gives its tools nothing: it is absent for every purpose a stub cares about. */
function hasPolicyBody(text) {
  return String(text == null ? '' : text).replace(/<!--[\s\S]*?-->/g, '').trim().length > 0;
}

/** The import tokens in PROSE (code spans and fences already blanked by the caller), as
 *  `{ line, path }` with a 1-based line. An import is `@` at the start of a line or after
 *  whitespace, followed by a path: a tool that resolves imports pulls that file into every
 *  session, and nothing that measures the importing file's own bytes sees it. */
function importTokens(prose) {
  const out = [];
  String(prose == null ? '' : prose).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').forEach((l, i) => {
    const re = /(?:^|\s)@((?:~\/|\.{0,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g;
    let m;
    while ((m = re.exec(l)) !== null) {
      const p = m[1].replace(/[.,;:]+$/, '');
      if (p) out.push({ line: i + 1, path: p });
    }
  });
  return out;
}

/** What is wrong with ONE stub, as messages; empty means it is a pointer and nothing else. A
 *  content line is anything that is not blank, not inside an HTML comment, and not the import
 *  line. `hasPolicyBeside` is whether the policy file sits in the stub's own directory, which is
 *  where a relative import resolves. Pure: the caller reads the disk. */
function stubFindings(text, hasPolicyBeside) {
  const out = [];
  const bare = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const lines = bare.split('\n').map((l) => l.trim()).filter(Boolean);
  const extra = lines.filter((l) => l !== IMPORT_LINE);
  if (extra.length) {
    out.push(extra.length + ' content line(s) besides the import, e.g. ' + JSON.stringify(extra[0].slice(0, 60))
      + ' — a stub carries `' + IMPORT_LINE + '` and comments only; the rule belongs in ' + POLICY_FILE);
  }
  if (!lines.includes(IMPORT_LINE)) out.push('no `' + IMPORT_LINE + '` line — a stub that imports nothing leaves its tool with no policy');
  if (!hasPolicyBeside) out.push('no ' + POLICY_FILE + ' with a body beside it — the import resolves from the stub\'s own directory, so it points at nothing');
  return out;
}

/** The registry, parsed. Throws with the reason: an unreadable registry is never an empty one. */
function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch (e) {
    const err = new Error('cannot read the tool registry at ' + REGISTRY_REL + ' (' + (e.code || e.message) + ')');
    err.fix = 'restore ' + REGISTRY_REL + ' from the harness source — it is harness data, not project config.';
    throw err;
  }
}

/* ---------- the enforcement matrix: each hard rule against each enabled tool ----------
   THE RULES are the hard rules of the policy file, section 3, in its order, each with the
   mechanisms that file names for it. A mechanism is one of:
     guard     a pre-tool handler of scripts/harness/hook.js, and the neutral actions the rule is
               about. It refuses a call, so it holds only where the tool's hook is registered AND
               that registration carries the action
     report    a session-start reporter. It says, it refuses nothing
     denyList  an entry of the tool's own declarative deny list, where its dialect names one
     always    true under every tool: it is in the harness, not in a hook
     gate      a gate of the config's suite, by its conventional name. Red when somebody runs the
               suite; with the git hook standing, run at commit or push time
   THE CELLS ARE NEVER TYPED. cellFor() works one out from what the tool's row is wired for in
   this repo, the handler table and the config's gates. Nothing left standing is `prose`. */
const RULES = [
  { id: 'gate-figure', rule: 'a gate figure comes from the gate run and lives in the baseline, not prose',
    by: [{ guard: 'phase-guard', on: ['write'] }, { gate: 'docs' }] },
  { id: 'suite-is-config', rule: 'the suite is the gates array of the config; nothing invents one',
    by: [{ always: 'the config loader stops on an absent or malformed config' }] },
  { id: 'no-secrets', rule: 'no secret, credential or guarded env file is committed, read or printed',
    by: [{ guard: 'env-guard', on: ['shell', 'read', 'search', 'write'] }, { guard: 'commit-hygiene', on: ['shell'] }, { gate: 'hygiene' }] },
  { id: 'clean-commit', rule: 'no strays, secrets, ignore gaps or root clutter in a commit or push',
    by: [{ guard: 'commit-hygiene', on: ['shell'] }, { gate: 'hygiene' }] },
  { id: 'phase-close', rule: 'a phase closes through the close script, never by assertion',
    by: [{ guard: 'phase-guard', on: ['shell', 'write'] }] },
  { id: 'skill-install', rule: 'no skill or plugin is installed, vendored or updated unread',
    by: [{ report: 'skill-verify' }, { gate: 'skills' }] },
  { id: 'docs-contract', rule: 'docs obey the contract: frontmatter, caps, trap paths, one handoff',
    by: [{ gate: 'docs' }] },
  { id: 'one-policy-body', rule: 'the policy file is the only policy body; a stub is a pointer',
    by: [{ gate: 'docs' }] },
  { id: 'context-ceiling', rule: 'always-on context has a ceiling',
    by: [{ gate: 'context' }] },
  { id: 'source-branch-first', rule: 'harness files change on the source branch first',
    by: [{ report: 'branch-sync' }] },
  { id: 'self-test', rule: 'every deciding script keeps its self-test',
    by: [{ gate: 'test' }] },
  { id: 'no-inline-node', rule: 'no inline `node -e`',
    by: [{ denyList: 'node -e' }] },
];

/**
 * ONE CELL. Pure.
 *   T  what this repo holds for one tool: { wired, actions, sessionStart, denyList }
 *   G  what is the same for every tool: { handlers: { name: actions | null }, reporters: [name],
 *      gates: [{ name, command }], report: the command the pre-commit hook runs,
 *      hooks: { commit, push } }
 * A guard the handler table does not hold, a gate the config does not run and a reporter nobody
 * registered each add nothing: the cell says what stands, not what the rule table hoped for.
 */
function cellFor(rule, T, G) {
  const parts = [];
  for (const m of rule.by) {
    if (m.guard) {
      if (!T.wired || !Object.prototype.hasOwnProperty.call(G.handlers, m.guard)) continue;
      const offered = G.handlers[m.guard];
      const wanted = m.on.filter((a) => !Array.isArray(offered) || offered.includes(a));
      const on = wanted.filter((a) => T.actions.includes(a));
      if (!on.length) continue;
      const missed = wanted.filter((a) => !on.includes(a));
      parts.push('deny ' + m.guard + ' [' + on.join(',') + ']' + (missed.length ? ' (NOT ' + missed.join(',') + ')' : ''));
    } else if (m.report) {
      if (T.wired && T.sessionStart && G.reporters.includes(m.report)) parts.push('report ' + m.report + ' at session start');
    } else if (m.denyList) {
      if (Array.isArray(T.denyList) && T.denyList.some((d) => typeof d === 'string' && d.includes(m.denyList))) parts.push('the tool\'s own deny list');
    } else if (m.always) {
      parts.push(m.always);
    } else if (m.gate) {
      const g = G.gates.find((x) => x.name === m.gate);
      if (!g) continue;
      const when = g.command === G.report && G.hooks.commit ? 'commit' : G.hooks.push ? 'push' : null;
      parts.push(when ? 'backstop: gate ' + g.name + ' at ' + when : 'gate ' + g.name + ' when run');
    }
  }
  return parts.length ? parts.join(' + ') : 'prose';
}

const MATRIX_LEGEND = [
  'deny      refused at the tool call, for the calls in [brackets]. (NOT x): calls of kind x reach no guard under this tool.',
  'report    said at session start. It refuses nothing.',
  'gate      red when somebody runs the suite. Nothing runs it for you.',
  'backstop  the git hook runs it at commit or push time: after the work, not a deny, and `--no-verify` passes it.',
  'prose     nothing enforces the rule under this tool. The policy file asks; that is all.',
  'A cell under a tool whose evidence is `docs` is the documented shape. No tool was run to produce this table.',
];

/** The --matrix output, as lines. `tools` is one `{ row, facts }` per enabled row. Pure. */
function matrixLines(tools, G) {
  const out = ['THE ENFORCEMENT MATRIX: each hard rule against each enabled tool, read off the registry and the wiring.'];
  const hook = (on, name) => name + ' ' + (on ? 'standing' : 'not installed');
  out.push('git hooks: ' + hook(G.hooks.commit, 'pre-commit') + ', ' + hook(G.hooks.push, 'pre-push')
    + (G.hooks.commit && G.hooks.push ? '' : '   (opt-in: harness init --git-hooks)'));
  const w = Math.max(...RULES.map((r) => r.id.length));
  for (const t of tools) {
    const row = t.row; const T = t.facts;
    out.push('');
    out.push(row.id + '   tier ' + row.tier + ', evidence ' + (row.evidence === 'ran' ? 'ran (' + row.command + ')' : 'docs (NOT run here: read from vendor pages)'));
    if (T.wired) out.push('  hooks: ' + row.hookConfig + ' registers the hook entry for ' + T.actions.join(', ') + (T.sessionStart ? '; and for session start' : '; NO session start'));
    else out.push('  NO HOOK IS WIRED: ' + T.why + '. No guard and no reporter runs under this tool.');
    for (const r of RULES) out.push('  ' + r.id.padEnd(w) + '  ' + cellFor(r, T, G));
  }
  out.push('');
  out.push('the rules, in the policy file\'s order:');
  for (const r of RULES) out.push('  ' + r.id.padEnd(w) + '  ' + r.rule);
  out.push('');
  for (const l of MATRIX_LEGEND) out.push(l);
  return out;
}

/* The disk half of the matrix. Loaded only by --matrix: the modules below are not beside this
   script in every place it is copied to (a fixture carries this file and the config loader). */

/** What THIS REPO holds for one row: is its hook registered, for which actions, and its deny list. */
function toolFacts(row, root) {
  const WIRE = require(path.join(__dirname, 'wire.js'));
  let dialect = null;
  if (isId(row.dialect)) { try { dialect = require(path.join(__dirname, 'dialects', row.dialect + '.js')); } catch { dialect = null; } }
  const at = (rel) => path.join(root, ...String(rel).split('/'));
  const read = (rel) => { try { return fs.readFileSync(at(rel), 'utf8'); } catch { return null; } };
  const facts = { wired: false, why: null, actions: [], sessionStart: false, denyList: null };

  const perms = dialect && dialect.permissions;
  if (perms && row.hookConfig === perms.file) { try { facts.denyList = perms.read(read(perms.file)) || null; } catch { facts.denyList = null; } }

  facts.why = WIRE.unwiredReason(row, dialect);
  if (facts.why) return facts;
  const w = WIRE.wiringFor(row, dialect);
  const text = read(row.hookConfig);
  const st = text === null ? { why: 'it is not there' } : WIRE.hookState(text, row, w);
  const pre = st.why ? [] : st.wanted.filter((x) => x.event === 'pre-tool');
  // A wiring the harness COULD render is not a hook: the registration has to be in the file.
  if (st.why || !pre.length || !pre.every((x) => x.ok)) {
    facts.why = row.hookConfig + ' does not register the hook entry as `' + row.id + '`' + (st.why ? ' (' + st.why + ')' : '') + ': `harness init` puts it back';
    return facts;
  }
  facts.wired = true;
  facts.actions = Array.isArray(w.actions) ? w.actions.slice() : [];
  facts.sessionStart = st.wanted.some((x) => x.event === 'session-start' && x.ok);
  return facts;
}

/** What is the same for every tool: the handler table, the config's gates, the git hooks. */
function matrixContext(cfg) {
  const HOOK = require(path.join(__dirname, 'hook.js'));
  const GIT = require(path.join(__dirname, 'githooks.js'));
  const handlers = {};
  for (const h of HOOK.HANDLERS['pre-tool']) handlers[h.name] = Array.isArray(h.actions) ? h.actions.slice() : null;
  return {
    handlers: handlers,
    reporters: HOOK.HANDLERS['session-start'].map((h) => h.name),
    gates: cfg.gates.map((g) => ({ name: g.name, command: g.command })),
    report: GIT.REPORT,
    hooks: GIT.standing(cfg.root),
  };
}

/* ---------- --self-test ---------- */
function selfTest() {
  let CHECKS = 0; const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  const DIALECTS = ['wire-a', 'wire-b'];
  const good = (over) => Object.assign({
    id: 'tool-a', policy: { mode: 'native', file: POLICY_FILE }, nested: 'on-touch',
    hookConfig: '.tool-a/hooks.json', dialect: 'wire-a', sessionStart: true, projectHooks: true,
    tier: 'full', evidence: 'docs', asOf: '2026-01-04', source: ['https://example.com/docs'],
  }, over || {});
  const without = (k) => { const r = good(); delete r[k]; return r; };
  const reg = (rows) => ({ dialects: DIALECTS, tools: rows });
  const wheres = (r, enabled) => validate(r, enabled || []).findings.map((x) => x.where);
  const rowFields = (row) => checkRow(row, DIALECTS).map((x) => x.field);

  eq('a complete row is clean', rowFields(good()), []);
  eq('a clean registry has no findings', wheres(reg([good()]), ['tool-a']), []);
  eq('units: the registry, one row, one enabled id', validate(reg([good()]), ['tool-a']).units.length, 3);

  // An empty registry, and the shapes that are not a registry at all.
  eq('an empty registry is refused', wheres(reg([])), ['registry.tools']);
  eq('a registry with no tools key is refused', wheres({ dialects: DIALECTS }), ['registry.tools']);
  eq('a registry that is an array is refused', wheres([good()]), ['registry']);
  eq('an unknown registry key is refused', wheres(Object.assign(reg([good()]), { tool: [] })), ['registry.tool']);
  eq('a registry with no dialect list is refused once, at the list, not again at every row',
    wheres({ tools: [good()] }), ['registry.dialects']);
  eq('a dialect list that is not kebab-case names is refused', wheres({ dialects: ['Wire A'], tools: [good()] }), ['registry.dialects']);
  eq('a repeated dialect name is refused', wheres({ dialects: ['wire-a', 'wire-a'], tools: [good()] }), ['registry.dialects']);
  eq('...and the message names the repeat',
    /repeats `wire-a`/.test(validate({ dialects: ['wire-a', 'wire-a'], tools: [good()] }, []).findings[0].why), true);

  // A missing required field: every one of them, named.
  for (const k of REQUIRED.filter((x) => x !== 'id')) {
    eq('a row with no `' + k + '` names it', rowFields(without(k)).includes(k), true);
  }
  eq('a row with no id is named by its index', wheres(reg([without('id')])), ['tools[0].id']);
  eq('null is a value, not an absence', rowFields(good({ nested: null })), []);

  // Unknown values and unknown keys.
  eq('an unknown tier', rowFields(good({ tier: 'partial' })), ['tier']);
  eq('an unknown evidence value', rowFields(good({ evidence: 'verified' })), ['evidence']);
  eq('an unknown nested value', rowFields(good({ nested: 'eager' })), ['nested']);
  eq('a dialect the registry does not list', rowFields(good({ dialect: 'wire-z' })), ['dialect']);
  eq('an unknown policy mode', rowFields(good({ policy: { mode: 'copy', file: 'POLICY.md' } })), ['policy.mode']);
  eq('a policy with no file', rowFields(good({ policy: { mode: 'native' } })), ['policy.file']);
  eq('a config policy with no setting', rowFields(good({ policy: { mode: 'config', file: 'settings.json' } })), ['policy.setting']);
  eq('a config policy with a setting is clean', rowFields(good({ policy: { mode: 'config', file: 'settings.json', setting: 'context.file' } })), []);
  eq('a setting on a native policy', rowFields(good({ policy: { mode: 'native', file: 'POLICY.md', setting: 'x' } })), ['policy.setting']);
  eq('an unknown policy key', rowFields(good({ policy: { mode: 'native', file: 'POLICY.md', path: 'x' } })), ['policy.path']);
  eq('an unknown row key', rowFields(good({ hooks: true })), ['hooks']);
  eq('a string where a boolean belongs', rowFields(good({ sessionStart: 'yes' })), ['sessionStart', 'tier']);
  eq('...and in the other boolean cell too', rowFields(good({ tier: 'guard-only', sessionStart: false, projectHooks: 'yes' })), ['projectHooks']);
  eq('an import stub with a directory in its name', rowFields(good({ policy: { mode: 'import', file: '.x/STUB.md' } })), ['policy.file']);
  eq('...a backslash is a directory too', rowFields(good({ policy: { mode: 'import', file: 'x\\STUB.md' } })), ['policy.file']);
  eq('...a config row MAY carry a path: its file is a settings file', rowFields(good({ policy: { mode: 'config', file: '.x/settings.json', setting: 's' } })), []);
  eq('an id that is not kebab-case', rowFields(good({ id: 'Tool A' })), ['id']);
  eq('a date that is not a day', rowFields(good({ asOf: '2026-02-30' })), ['asOf']);
  eq('a date in another format', rowFields(good({ asOf: '04/01/2026' })), ['asOf']);
  eq('an empty source list', rowFields(good({ source: [] })), ['source']);
  eq('a blank source entry', rowFields(good({ source: ['https://example.com', ''] })), ['source[1]']);
  eq('a source that is not a list', rowFields(good({ source: 'https://example.com/docs' })), ['source']);
  eq('a blank name', rowFields(good({ name: '' })), ['name']);
  eq('notes that are not text', rowFields(good({ notes: 7 })), ['notes']);
  eq('a policy that is a bare filename', rowFields(good({ policy: 'POLICY.md' })), ['policy']);
  eq('a hook config that is not a path', rowFields(good({ hookConfig: 7 })), ['hookConfig', 'tier']);
  eq('a blank command is refused even when the evidence value is itself unknown',
    rowFields(good({ evidence: 'verified', command: '' })), ['evidence', 'command']);
  eq('a row that is not an object', rowFields('tool-a'), ['(row)']);

  // Evidence. `ran` without the command is the one upgrade nobody may make by typing.
  eq('`ran` with no command is refused', rowFields(good({ evidence: 'ran' })), ['command']);
  eq('`ran` with a blank command is refused', rowFields(good({ evidence: 'ran', command: '  ' })), ['command']);
  eq('`ran` with its command is clean', rowFields(good({ evidence: 'ran', command: 'tool-a --version' })), []);
  eq('a `docs` row carrying a command is refused', rowFields(good({ command: 'tool-a --version' })), ['command']);

  // The tier against its own cells.
  eq('`full` with no session-start is refused', rowFields(good({ sessionStart: false })), ['tier']);
  eq('`full` with project hooks not established is refused', rowFields(good({ projectHooks: null })), ['tier']);
  eq('`full` with no hook config is refused', rowFields(good({ hookConfig: null })), ['tier']);
  eq('`guard-only` with no session-start is clean', rowFields(good({ tier: 'guard-only', sessionStart: false })), []);
  eq('`guard-only` with project hooks unknown is clean', rowFields(good({ tier: 'guard-only', projectHooks: null })), []);
  eq('`guard-only` that has everything is `full`', rowFields(good({ tier: 'guard-only' })), ['tier']);
  eq('`guard-only` with no dialect is `backstop`', rowFields(good({ tier: 'guard-only', dialect: null, sessionStart: false })), ['tier']);
  const backstop = { tier: 'backstop', hookConfig: null, dialect: null, sessionStart: null, projectHooks: null };
  eq('a `backstop` row with nothing wired is clean', rowFields(good(backstop)), []);
  eq('a `backstop` row with a dialect is refused', rowFields(good(Object.assign({}, backstop, { dialect: 'wire-a' }))), ['dialect']);
  eq('a `backstop` row with no policy route is refused', rowFields(good(Object.assign({}, backstop, { policy: null }))), ['policy']);
  // A backstop row may record the hook file the tool documents: with no dialect it is still
  // not wireable. An empty dialect list is legal for a registry of such rows.
  eq('a `backstop` row that records a known hook file, with no dialect, is clean',
    rowFields(good({ tier: 'backstop', dialect: null, sessionStart: null })), []);
  eq('a `backstop` row claiming a checked-in hook file it does not record is refused',
    rowFields(good(Object.assign({}, backstop, { projectHooks: true }))), ['projectHooks']);
  eq('an empty dialect list is legal when no row needs a dialect', wheres({ dialects: [], tools: [good(backstop)] }), []);
  eq('...and refuses a row that names one', wheres({ dialects: [], tools: [good()] }), ['tool-a.dialect']);
  const inherits = Object.assign({}, backstop, { tier: 'inherits', policy: null, nested: null });
  eq('an `inherits` row with no dialect and no policy is clean', rowFields(good(inherits)), []);
  eq('an `inherits` row with a dialect is refused', rowFields(good(Object.assign({}, inherits, { dialect: 'wire-a' }))), ['dialect']);
  eq('an `inherits` row with a policy is refused', rowFields(good(Object.assign({}, inherits, { policy: { mode: 'native', file: 'POLICY.md' } }))), ['policy']);
  eq('an `inherits` row with a session-start event, project hooks or nested loading is refused',
    rowFields(good(Object.assign({}, inherits, { nested: 'on-touch', sessionStart: true, projectHooks: false }))),
    ['nested', 'sessionStart', 'projectHooks']);

  // Across rows, and against the config.
  eq('a duplicate id names the second row, by its index', wheres(reg([good(), good()])), ['tools[1] (tool-a).id']);
  eq('...and every finding on a repeated row carries that index, and says which row had the id first',
    validate(reg([good(), good({ tier: 'partial' }), good({ evidence: 'x' })]), []).findings.map((x) => x.where + (/tools\[0\] already has it/.test(x.why) ? ' <0' : '')),
    ['tools[1] (tool-a).tier', 'tools[1] (tool-a).id <0', 'tools[2] (tool-a).evidence', 'tools[2] (tool-a).id <0']);
  eq('...and counts both rows as units', validate(reg([good(), good()]), []).units.length, 3);
  eq('an enabled tool with no row is refused', wheres(reg([good()]), ['tool-b']), ['tools.enabled.tool-b']);
  eq('...and the message lists the rows there are',
    /has no row \(rows: tool-a\)/.test(validate(reg([good()]), ['tool-b']).findings[0].why), true);
  eq('an enabled tool whose row is broken is still found', wheres(reg([good({ tier: 'partial' })]), ['tool-a']), ['tool-a.tier']);
  eq('nothing enabled is not this script\'s finding — the config loader refuses it', wheres(reg([good()]), []), []);
  eq('enabling an `inherits` row is refused: a model wires nothing', wheres(reg([good(), good(Object.assign({ id: 'model-a' }, inherits))]), ['model-a']), ['tools.enabled.model-a']);
  eq('...and the message points at the host\'s row',
    /enable the row of the host/.test(validate(reg([good(Object.assign({ id: 'model-a' }, inherits))]), ['model-a']).findings[0].why), true);

  // --list prints evidence as stated and never a stronger word.
  const lines = listLines(reg([good(), good({ id: 'tool-b', evidence: 'ran', command: 'x' })]), ['tool-b']);
  eq('list: a header and one line per row', lines.length, 3);
  eq('list: id, tier, evidence, in that order', lines[1].split(/\s+/), ['tool-a', 'full', 'docs']);
  eq('list: an enabled row says so', lines[2].split(/\s+/), ['tool-b', 'full', 'ran', 'yes']);
  eq('list: a `docs` row is never called verified', /verified/i.test(lines.join('\n')), false);
  eq('list: an enabled id with no row is shown, and said to have none',
    listLines(reg([good()]), ['tool-z']).map((l) => l.split(/\s+/).join(' ')), ['id tier evidence enabled', 'tool-a full docs', 'tool-z - - yes (no row)']);
  eq('list: a registry that is not one yields the header alone — main() is what turns that red', listLines([], []).length, 1);

  // The policy route. What a tool holds at session start is read off its row, never listed.
  const viaImport = good({ id: 'tool-i', policy: { mode: 'import', file: 'STUB.md' } });
  const viaConfig = good({ id: 'tool-c', policy: { mode: 'config', file: '.tool-c/settings.json', setting: 'context.file' } });
  eq('route: a native row holds its own file', policyFilesOf(good()), [POLICY_FILE]);
  eq('route: an import row holds the stub AND the policy file it imports', policyFilesOf(viaImport), ['STUB.md', POLICY_FILE]);
  eq('route: a config row holds the policy file, not its settings file', policyFilesOf(viaConfig), [POLICY_FILE]);
  eq('route: a row with no policy route holds nothing', policyFilesOf(good({ policy: null })), []);
  eq('route: a row that is not one holds nothing', policyFilesOf('tool-a'), []);
  eq('injected: only the ENABLED rows count', injectedFiles(reg([good(), viaImport]), ['tool-i']), ['STUB.md', POLICY_FILE]);
  eq('injected: two tools reaching one file list it once', injectedFiles(reg([viaImport, viaConfig]), ['tool-i', 'tool-c']), ['STUB.md', POLICY_FILE]);
  eq('injected: an enabled id with no row adds nothing', injectedFiles(reg([good()]), ['tool-z']), []);
  eq('injected: nothing enabled is nothing injected', injectedFiles(reg([good()]), []), []);
  eq('stubs: every import row names one, enabled or not', stubFiles(reg([good(), viaImport, viaConfig])), ['STUB.md']);
  eq('stubs: a registry with no import row has none', stubFiles(reg([good()])), []);
  eq('needed stubs: only an ENABLED import row demands one', [enabledStubFiles(reg([good(), viaImport]), ['tool-a']), enabledStubFiles(reg([good(), viaImport]), ['tool-i', 'tool-a'])], [[], ['STUB.md']]);
  eq('needed stubs: an enabled id with no row demands nothing', enabledStubFiles(reg([viaImport]), ['tool-z']), []);
  // ONE body. A native row whose file is not the policy file may sit in the registry; enabling it is refused.
  const ownFile = good({ id: 'tool-o', policy: { mode: 'native', file: 'OWN.md' } });
  const nativePolicy = good({ id: 'tool-n', policy: { mode: 'native', file: POLICY_FILE } });
  eq('a native row with its own file is a legal ROW', wheres(reg([ownFile]), []), []);
  eq('...enabling it is refused, by id', wheres(reg([ownFile]), ['tool-o']), ['tools.enabled.tool-o']);
  eq('...and the message names both files', /`OWN\.md` natively.*second policy body/.test(validate(reg([ownFile]), ['tool-o']).findings[0].why), true);
  eq('a native row that loads the policy file is enabled clean', wheres(reg([nativePolicy]), ['tool-n']), []);
  eq('enabled findings: clean is empty', enabledFindings(reg([nativePolicy]), ['tool-n']), []);
  eq('enabled findings: an id with no row, named', enabledFindings(reg([nativePolicy]), ['tool-z']).map((m) => m.split(':')[0]), ['tools.enabled.tool-z']);
  eq('enabled findings: a broken ROW is not one of them', enabledFindings(reg([good({ id: 'tool-n', policy: { mode: 'native', file: POLICY_FILE }, tier: 'partial' })]), ['tool-n']), []);
  // Where a tool loads skills from. Optional: absent is "not established", and writes nothing.
  eq('skills: a repo-relative directory is clean', rowFields(good({ skills: '.shared/skills' })), []);
  for (const v of ['/abs/skills', '~/.tool/skills', '../skills', 'a/../b', 'a\\b', 'skills/', '', null, 7]) {
    eq('skills: ' + show(v) + ' is refused', rowFields(good({ skills: v })), ['skills']);
  }
  const sharedA = good({ id: 'tool-s', skills: '.shared/skills' });
  const sharedB = good({ id: 'tool-t', skills: '.shared/skills' });
  const ownRoot = good({ id: 'tool-u', skills: '.tool-u/skills' });
  eq('skill roots: only the ENABLED rows, once each, in the config\'s order',
    skillRoots(reg([sharedA, sharedB, ownRoot, good()]), ['tool-u', 'tool-t', 'tool-s', 'tool-a']), ['.tool-u/skills', '.shared/skills']);
  eq('skill roots: a row with no cell adds nothing', skillRoots(reg([good()]), ['tool-a']), []);
  eq('enabled rows: in the config\'s order, an id with no row left out',
    enabledRows(reg([sharedA, ownRoot]), ['tool-u', 'tool-z', 'tool-s']).map((r) => r.id), ['tool-u', 'tool-s']);
  eq('body: text is a body', hasPolicyBody('# Policy\n'), true);
  eq('body: an empty file is not', hasPolicyBody(''), false);
  eq('body: whitespace and comments are not', hasPolicyBody('\n<!-- soon -->\n  \n'), false);
  eq('body: a missing file is not', hasPolicyBody(null), false);
  eq('imports: a line-leading import', importTokens('rule\n@docs/x.md\n'), [{ line: 2, path: 'docs/x.md' }]);
  eq('imports: one after whitespace, trailing stop dropped', importTokens('see @./a/b.md.').map((x) => x.path), ['./a/b.md']);
  eq('imports: a home path', importTokens('@~/.tool/x.md').map((x) => x.path), ['~/.tool/x.md']);
  eq('imports: an address is not one', importTokens('mail a@b.example now'), []);
  eq('imports: one inside a comment is not one', importTokens('<!-- @x.md -->\nrule'), []);
  eq('imports: a bare @ is not one', importTokens('a @ b'), []);
  const STUB = '<!-- a pointer -->\n' + IMPORT_LINE + '\n';
  eq('stub: the import line and a comment is a pointer', stubFindings(STUB, true), []);
  eq('stub: a multi-line comment is still a comment', stubFindings('<!-- a\npointer\n-->\n\n' + IMPORT_LINE + '\n', true), []);
  eq('stub: CRLF line endings change nothing', stubFindings(STUB.replace(/\n/g, '\r\n'), true), []);
  eq('stub: one rule beside the import is a second policy body', stubFindings(STUB + '- Never push.\n', true).length, 1);
  eq('stub: ...and the finding quotes the line', /"- Never push\."/.test(stubFindings(STUB + '- Never push.\n', true)[0]), true);
  eq('stub: a heading is content too', stubFindings('# Policy\n' + IMPORT_LINE + '\n', true).length, 1);
  eq('stub: a whole policy body with no import is two findings', stubFindings('# Policy\n\n- Never push.\n', true).length, 2);
  eq('stub: an empty file imports nothing', stubFindings('', true).length, 1);
  eq('stub: an import of some other file is content, and no import', stubFindings('@OTHER.md\n', true).length, 2);
  eq('stub: a pointer with no policy file beside it points at nothing', stubFindings(STUB, false).length, 1);
  eq('stub: ...and says so', /beside it/.test(stubFindings(STUB, false)[0]), true);

  // The matrix. A cell is worked out, and the ones that must come out `prose` do.
  const G = { handlers: { 'guard-a': ['shell', 'write'], 'guard-b': null }, reporters: ['rep-a'],
    gates: [{ name: 'gate-a', command: 'node a.js' }, { name: 'gate-r', command: 'node report.js' }], report: 'node report.js', hooks: { commit: false, push: false } };
  const withHooks = (h) => Object.assign({}, G, { hooks: h });
  const FULL = { wired: true, actions: ['shell', 'read', 'write'], sessionStart: true, denyList: ['Shell(tool -x*)'] };
  const PART = { wired: true, actions: ['shell', 'read'], sessionStart: false, denyList: null };
  const NONE = { wired: false, actions: [], sessionStart: false, denyList: null };
  const one = (by) => ({ id: 'r', rule: 'r', by: by });
  eq('cell: a guard on a registered action denies', cellFor(one([{ guard: 'guard-a', on: ['write'] }]), FULL, G), 'deny guard-a [write]');
  eq('cell: THE SAME RULE IS PROSE where the write is not registered', cellFor(one([{ guard: 'guard-a', on: ['write'] }]), PART, G), 'prose');
  eq('cell: a rule over two actions names the one that reaches no guard', cellFor(one([{ guard: 'guard-a', on: ['shell', 'write'] }]), PART, G), 'deny guard-a [shell] (NOT write)');
  eq('cell: an action the handler is not offered is not claimed, nor called missing', cellFor(one([{ guard: 'guard-a', on: ['shell', 'read'] }]), FULL, G), 'deny guard-a [shell]');
  eq('cell: a handler offered every call takes the rule\'s actions as they are', cellFor(one([{ guard: 'guard-b', on: ['read'] }]), PART, G), 'deny guard-b [read]');
  eq('cell: a guard under a tool with no hook is prose', cellFor(one([{ guard: 'guard-a', on: ['shell'] }]), NONE, G), 'prose');
  eq('cell: a guard the handler table does not hold is prose', cellFor(one([{ guard: 'guard-z', on: ['shell'] }]), FULL, G), 'prose');
  eq('cell: a reporter needs the session-start registration', [cellFor(one([{ report: 'rep-a' }]), FULL, G), cellFor(one([{ report: 'rep-a' }]), PART, G), cellFor(one([{ report: 'rep-a' }]), NONE, G)],
    ['report rep-a at session start', 'prose', 'prose']);
  eq('cell: a reporter nobody registered is prose', cellFor(one([{ report: 'rep-z' }]), FULL, G), 'prose');
  eq('cell: a deny-list entry counts only where the list holds it', [cellFor(one([{ denyList: 'tool -x' }]), FULL, G), cellFor(one([{ denyList: 'tool -y' }]), FULL, G), cellFor(one([{ denyList: 'tool -x' }]), PART, G)],
    ['the tool\'s own deny list', 'prose', 'prose']);
  eq('cell: a gate is a gate under every tool, and says nobody runs it', cellFor(one([{ gate: 'gate-a' }]), NONE, G), 'gate gate-a when run');
  eq('cell: a gate the config does not run is prose', cellFor(one([{ gate: 'gate-z' }]), FULL, G), 'prose');
  eq('cell: with the push hook standing a gate is a BACKSTOP, at push', cellFor(one([{ gate: 'gate-a' }]), NONE, withHooks({ commit: false, push: true })), 'backstop: gate gate-a at push');
  eq('cell: the commit hook covers only the gate it runs', [cellFor(one([{ gate: 'gate-r' }]), NONE, withHooks({ commit: true, push: false })), cellFor(one([{ gate: 'gate-a' }]), NONE, withHooks({ commit: true, push: false }))],
    ['backstop: gate gate-r at commit', 'gate gate-a when run']);
  eq('cell: A BACKSTOP IS NEVER SPELLED AS A DENY', /deny/.test(cellFor(one([{ guard: 'guard-a', on: ['shell'] }, { gate: 'gate-r' }]), NONE, withHooks({ commit: true, push: true }))), false);
  eq('cell: mechanisms are listed together, in the rule\'s order', cellFor(one([{ guard: 'guard-a', on: ['shell'] }, { gate: 'gate-a' }]), FULL, G), 'deny guard-a [shell] + gate gate-a when run');
  eq('cell: what holds under every tool holds under an unwired one', cellFor(one([{ always: 'the loader stops' }]), NONE, G), 'the loader stops');
  eq('cell: a rule with no mechanism is prose', cellFor(one([]), FULL, G), 'prose');
  eq('rules: ids are kebab-case and unique', [RULES.every((r) => isId(r.id)), new Set(RULES.map((r) => r.id)).size], [true, RULES.length]);
  eq('rules: every mechanism is one of the five kinds', RULES.flatMap((r) => r.by).filter((m) => Object.keys(m).filter((k) => ['guard', 'report', 'denyList', 'always', 'gate'].includes(k)).length !== 1), []);
  eq('rules: a guard mechanism names its actions', RULES.flatMap((r) => r.by).filter((m) => m.guard && !(Array.isArray(m.on) && m.on.length)), []);
  const mx = matrixLines([{ row: good(), facts: FULL }, { row: good({ id: 'tool-n' }), facts: Object.assign({}, NONE, { why: 'no shape is recorded' }) }], G);
  eq('matrix: one line per rule per tool', mx.filter((l) => l.startsWith('  ' + RULES[0].id.padEnd(4))).length, 3);
  eq('matrix: an unwired tool is said to be unwired, with the reason', mx.some((l) => /NO HOOK IS WIRED: no shape is recorded\./.test(l)), true);
  eq('matrix: a `docs` row is never called verified', /\bverified\b/i.test(mx.join('\n')), false);
  eq('matrix: it says the git hooks are not installed, and how to get them', mx[1], 'git hooks: pre-commit not installed, pre-push not installed   (opt-in: harness init --git-hooks)');

  // The registry this script ships with has to pass its own contract, with the default tool
  // enabled. Whatever it parses to goes through validate(): `null` parses, and is not a registry.
  let shipped; let parsed = false;
  try { shipped = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); parsed = true; } catch (e) { f.push('the shipped registry does not parse: ' + e.message); }
  if (parsed) {
    const v = validate(shipped, DEFAULTS.tools.enabled);
    eq('the shipped registry is clean, and the default tool has a row', v.findings.map((x) => x.where + ': ' + x.why), []);
    const shippedRows = (isPlain(shipped) && Array.isArray(shipped.tools) ? shipped.tools : []).filter(isPlain);
    eq('every `ran` row in the shipped registry records its command',
      shippedRows.filter((r) => r.evidence === 'ran' && !isStr(r.command)).map((r) => r.id), []);
  }

  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — tools.js self-test (' + CHECKS + ' checks)');
}

module.exports = { validate, checkRow, listLines, REQUIRED, TIERS, EVIDENCE, NESTED, POLICY_MODES,
  POLICY_FILE, IMPORT_LINE, policyFilesOf, injectedFiles, stubFiles, enabledStubFiles, enabledFindings,
  hasPolicyBody, importTokens, stubFindings, readRegistry, REGISTRY_REL, enabledRows, skillRoots,
  RULES, cellFor, matrixLines, toolFacts, matrixContext };

/* ---------- main ---------- */
if (require.main === module) {
  const args = process.argv.slice(2);
  // --self-test is a mode like the others. Tested first and alone, it would turn
  // `--check --self-test` into a green run that never checked.
  const mode = ['--check', '--list', '--self-test', '--matrix'].filter((m) => args.includes(m));
  if (mode.length !== 1) {
    console.error('usage: node scripts/harness/tools.js --check | --list | --self-test | --matrix');
    process.exit(2);
  }
  if (mode[0] === '--self-test') { selfTest(); process.exit(0); }

  let CFG;
  try { CFG = load(); } catch (e) { fatal(e.message, e.fix); }
  const enabled = CFG.tools.enabled;

  /* An unreadable registry is a failure, not an empty one: "no rows" and "could not read the
     rows" call for different fixes, and the second must never be reported as the first. */
  let reg;
  try { reg = readRegistry(); } catch (e) { fatal(e.message, e.fix); }

  const v = validate(reg, enabled);

  if (mode[0] === '--list') {
    for (const l of listLines(reg, enabled)) console.log(l);
    // A registry --check refuses is not a listing that succeeded: a header over no rows would
    // read as an empty registry, which is the one thing a malformed one must never look like.
    if (v.findings.length) {
      console.error('TOOLS RED — ' + REGISTRY_REL + ', ' + v.findings.length + ' finding(s); `node scripts/harness/tools.js --check` names them');
      process.exit(1);
    }
    process.exit(0);
  }

  if (mode[0] === '--matrix') {
    // A matrix over a registry --check refuses would be cells worked out from rows nobody can
    // trust: it is not printed at all.
    if (v.findings.length) {
      console.error('TOOLS RED — ' + REGISTRY_REL + ', ' + v.findings.length + ' finding(s); `node scripts/harness/tools.js --check` names them');
      process.exit(1);
    }
    const tools = enabledRows(reg, enabled).map((row) => ({ row: row, facts: toolFacts(row, CFG.root) }));
    for (const l of matrixLines(tools, matrixContext(CFG))) console.log(l);
    process.exit(0);
  }

  const failed = new Set(v.findings.map((x) => x.unit));
  const fail = failed.size; const pass = v.units.length - fail;
  if (v.findings.length) {
    console.log('TOOLS RED — ' + REGISTRY_REL + ', ' + v.findings.length + ' finding(s):');
    for (const x of v.findings) console.log('  x ' + x.where + ': ' + x.why);
  } else {
    console.log('tools: ' + v.ids.length + ' row(s) valid, enabled: ' + enabled.join(', '));
  }
  console.log('GATE tools pass=' + pass + ' fail=' + fail + ' skipped=0');
  process.exit(fail ? 1 : 0);
}
