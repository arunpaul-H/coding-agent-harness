'use strict';
/* ============================================================
   config.js — THE CONFIG SEAM. The one place the harness learns anything
   project-specific, and the only file a new repo has to write.

   WHY THIS EXISTS
   The harness this is ported from hard-coded its own repo into the gate runner:
   the gate table was a literal in the runner, and the artifact list was pulled
   out of a build script with a `require('../build-data.js')`. Every one of those
   couplings meant "this harness grades THAT repo and no other". Deleting them is
   not a tidy-up, it is the whole point of the port.

   THE RULE THAT SHAPES THIS FILE
   An absent or malformed config is a HARD STOP with a one-line fix. It is never a
   silent default. A harness that invents its own gate list when it cannot read one
   is strictly worse than no harness: it prints a green verdict about a suite nobody
   agreed to, and the figure it prints is the figure people then trust. So there is
   no default `gates` array in here, and there never may be. Everything else gets a
   documented default, because everything else has a safe one.

   `load({ soft: true })` is the single exception, and it exists for hooks. A
   PreToolUse hook that throws takes the session down with it; a hook that cannot
   read the config must degrade (deny, or ask) rather than crash. So soft mode
   answers `null` and lets the caller decide what "no config" means for it.

   API
     load(opts)      the validated, defaults-merged config. Cached per file.
                     opts: { soft, root, file, fresh }
     ROOT            absolute repo root. Works from a hook, a test and a subdirectory.
     resolve(...p)   path.join(ROOT, ...p)
     fatal(msg, fix) two lines on stderr, exit 1

   Run:  node scripts/harness/config.js --self-test
   ============================================================ */
const path = require('node:path');
const fs = require('node:fs');

const CONFIG_NAME = 'harness.config.json';
const SCHEMA_HINT = 'see schema/harness.config.schema.json for the shape';

/* ---------- ROOT ----------
   Three strategies, in this order, because the harness is entered from three
   different places and only the first of them has a useful cwd:

     1. walk up from the cwd for harness.config.json — a gate run, a test, or a
        command typed in a subdirectory
     2. CLAUDE_PROJECT_DIR — what the agent runtime exports to a hook, whose cwd
        is whatever the session happened to be in
     3. two levels up from this file — scripts/harness/config.js, so ../.. is the
        repo. The last resort, and the one that keeps a vendored copy of the
        harness grading the tree it was vendored into.

   Deliberately NOT a walk up from __dirname: that would let a run inside an
   unconfigured directory silently climb out of it and grade the enclosing repo,
   which is how a test in a temp directory ends up asserting against the real one. */
function findUp(from) {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_NAME))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function findRoot() {
  const fromCwd = findUp(process.cwd());
  if (fromCwd) return fromCwd;
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  return path.resolve(__dirname, '..', '..');
}
const ROOT = findRoot();
const resolve = (...parts) => path.join(ROOT, ...parts);

/* ---------- fatal ----------
   Exactly two lines, and the second one is a FIX, not a restatement of the
   problem. An error that only says what is wrong makes the reader go and find
   out what to type; this file knows what to type, so it says it. */
function fatal(msg, fix) {
  process.stderr.write('FATAL — ' + msg + '\n');
  process.stderr.write('   fix: ' + (fix || SCHEMA_HINT) + '\n');
  process.exit(1);
}

/* A validation failure carries its own fix line, so every caller can turn it into
   the same two-line stop without inventing advice of its own. */
function configError(msg, fix) {
  const e = new Error(msg);
  e.name = 'HarnessConfigError';
  e.fix = fix || SCHEMA_HINT;
  return e;
}

/* ---------- the documented defaults ----------
   `gates` is absent on purpose and must stay absent. See the header. */
const DEFAULTS = {
  project: { docsRoot: 'docs', tracksDir: 'docs/tracks' },
  artifacts: [],
  env: { guarded: ['.env', '.env.*'], openCarveOuts: [] },
  commitHygiene: {
    workDirs: ['scripts', 'tests', 'docs'],
    rootAllow: ['README.md', 'LICENSE', 'package.json', 'CLAUDE.md', 'AGENTS.md',
      CONFIG_NAME, '.gitignore', '.gitattributes'],
  },
  docs: {
    // AGENTS.md is the one policy body; CLAUDE.md is the stub that imports it, so its cap is
    // the size of a pointer. `subtreeAgentsMd` caps a per-directory AGENTS.md.
    caps: { 'AGENTS.md': 80, 'CLAUDE.md': 5, subtreeAgentsMd: 50, default: 150 },
    exemptDirs: [],
  },
  context: { budgetFile: 'scripts/harness/context-budget.json' },
  // Which coding agents this repo is wired for. The ids are rows of the registry,
  // scripts/harness/tools.json. This file only checks the shape, because the seam must load
  // with no registry; what holds an id to a row is `tools.js --check`, and the context gate,
  // which refuses to measure an enabled id the registry cannot wire.
  tools: { enabled: ['claude-code'] },
  // The run mode the launcher OFFERS when it asks. null: it offers none. It is a suggestion a
  // person still has to accept at a terminal, never a mode in force: this file is one the agent
  // can edit, and a file the agent can edit cannot approve anything for the agent.
  mode: { default: null },
  // Where a workspace folder goes and what its branch is called (worktree.js). root: null means
  // DERIVED from where the main checkout sits, so a fresh clone needs no edit here; a string is
  // a path resolved against the main checkout, and it may not land inside any checkout.
  // carry: ignored paths copied from the main checkout into a new workspace; setup: one command
  // run in it. Both are empty by default: a fresh folder then holds the tracked files and no more.
  worktrees: { root: null, branchPrefix: '', carry: [], setup: null },
};

/* The run modes, most to least autonomous: the keys of MODES in mode.js. Spelled here because
   this file loads with no other harness file beside it; tests/tools.test.js holds the two lists
   to each other. */
const RUN_MODES = ['fully-auto', 'auto-edit', 'hitl', 'manual'];

/* The one doc the harness places by CONVENTION rather than by a config key: the lead-only
   routing reference, `<docsRoot>/reference/routing/README.md`. Two scripts need the path and
   must not disagree: docs-index.js writes the generated agent registry into it, and
   measure-context.js charges it as the read a lead makes before it knows the task. It is
   spelled once, here, beside the docs root it hangs off. */
const ROUTING_DOC = 'reference/routing/README.md';
const routingDoc = (cfg) => String(cfg.project.docsRoot).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + ROUTING_DOC;

// Every key the file may carry at the top level. An unknown one is an ERROR and
// not a shrug: a typo'd section name is indistinguishable from a section you
// believe you configured, and the symptom shows up as the harness quietly using
// its default instead of your setting. `_readme` is a key, not a comment, because
// JSON has no comments and the explanations have to live somewhere.
const TOP_LEVEL = ['$schema', '_readme', 'project', 'gates', 'artifacts', 'env',
  'commitHygiene', 'docs', 'context', 'tools', 'mode', 'worktrees'];
const TOOLS_KEYS = ['_readme', 'enabled'];
const MODE_KEYS = ['_readme', 'default'];
const WORKTREES_KEYS = ['_readme', 'root', 'branchPrefix', 'carry', 'setup'];
const GATE_KEYS = ['_readme', 'name', 'command', 'adapter', 'optional', 'gateLine'];

/* ---------- deep merge ----------
   Plain objects merge key by key; ARRAYS AND SCALARS ARE REPLACED WHOLE. An array
   that merged by concatenation would make a default impossible to remove: a repo
   that wants no guarded env files could never say so, and `workDirs` would only
   ever grow. Replacement means the config file says exactly what holds. */
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, over) {
  if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
  const out = Object.assign({}, base);
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/* ---------- validation ----------
   Every message names the exact path that is wrong (`gates[2].command`,
   `docs.caps.default`) because the reader is looking at a JSON file and needs to
   know which line to edit. "invalid config" is not a diagnosis. */
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isPosInt = (v) => Number.isInteger(v) && v > 0;

function requireStrArray(v, where, errs) {
  if (!Array.isArray(v)) { errs.push(where + ' must be an array of strings'); return; }
  v.forEach((s, i) => { if (!isStr(s)) errs.push(where + '[' + i + '] must be a non-empty string'); });
}

function validateGates(gates, errs) {
  if (!Array.isArray(gates) || gates.length === 0) {
    errs.push('`gates` must be a non-empty array — the harness has no default gate list and will not invent one');
    return;
  }
  const seen = new Set();
  gates.forEach((g, i) => {
    // A gate with no name cannot be referred to in an error, in --only or in the
    // baseline, so the name is checked before anything else and the index stands
    // in for it until it exists.
    const label = isStr(g && g.name) ? 'gates.' + g.name : 'gates[' + i + ']';
    if (!isPlain(g)) { errs.push(label + ' must be an object { name, command }'); return; }
    if (!isStr(g.name)) errs.push(label + ' has no `name` — every gate needs one to appear in the baseline');
    else if (!/^[a-z][a-z0-9-]*$/.test(g.name)) errs.push(label + ': `name` must be kebab-case (it is a filename stem and a GATE line token)');
    else if (seen.has(g.name)) errs.push(label + ': duplicate gate name — a second row would shadow the first in the baseline');
    else seen.add(g.name);
    if (!isStr(g.command)) errs.push(label + ' has no `command` — a gate with nothing to run grades nothing');
    if (g.adapter !== undefined && !isStr(g.adapter)) errs.push(label + '.adapter must be a string naming an adapter');
    if (g.optional !== undefined && typeof g.optional !== 'boolean') errs.push(label + '.optional must be true or false');
    if (g.gateLine !== undefined && !isStr(g.gateLine)) errs.push(label + '.gateLine must be the name the command actually prints');
    for (const k of Object.keys(g)) {
      if (!GATE_KEYS.includes(k)) errs.push(label + ': unknown key `' + k + '` (allowed: ' + GATE_KEYS.join(', ') + ')');
    }
  });
}

function validateArtifacts(a, errs) {
  // Two shapes. A bare ARRAY lists files and leaves the rebuilding to whichever
  // declared gate does it; an OBJECT adds the command that rebuilds them, for a
  // repo whose build is not already a gate. Both grade the same thing: whether
  // the committed artifact is byte-identical to what this source produces.
  const entries = Array.isArray(a) ? a : isPlain(a) ? a.files : null;
  if (entries === null || entries === undefined) {
    errs.push('`artifacts` must be an array of entries, or { command, files: [...] }');
    return;
  }
  if (isPlain(a)) {
    for (const k of Object.keys(a)) {
      if (!['_readme', 'command', 'files'].includes(k)) errs.push('artifacts: unknown key `' + k + '` (allowed: command, files)');
    }
    if (a.command !== undefined && !isStr(a.command)) errs.push('artifacts.command must be a non-empty string');
  }
  if (!Array.isArray(entries)) { errs.push('artifacts.files must be an array'); return; }
  entries.forEach((e, i) => {
    const where = 'artifacts' + (isPlain(a) ? '.files' : '') + '[' + i + ']';
    if (isStr(e)) return;
    if (isPlain(e) && (isStr(e.path) || isStr(e.glob))) return;
    errs.push(where + ' must be a path string, { path } or { glob }');
  });
}

function validate(cfg) {
  const errs = [];

  if (!isPlain(cfg.project)) errs.push('`project` must be an object');
  else {
    if (!isStr(cfg.project.name)) errs.push('project.name must be a non-empty string — it labels this repo in every report');
    for (const k of ['docsRoot', 'tracksDir']) {
      if (!isStr(cfg.project[k])) errs.push('project.' + k + ' must be a non-empty relative path');
      else if (path.isAbsolute(cfg.project[k]) || cfg.project[k].split(/[\\/]/).includes('..')) {
        errs.push('project.' + k + ' must stay inside the repo (no absolute path, no `..`)');
      }
    }
    // OPTIONAL, and the one key in this section with no default: the branch every other
    // branch's harness is compared against (branch-sync.js). Absent, that script detects it
    // and says how. Present, it has to be something git can be handed: one name, no
    // whitespace. It is checked HERE because the reader of it loads this config softly and
    // treats an unusable value as "not set", falling through to detection without a word —
    // a typo read as a setting, in the one key whose wrong value decides what a branch is
    // compared against. Every hard-loading script now stops on it and names it.
    const sb = cfg.project.sourceBranch;
    if (sb !== undefined && (!isStr(sb) || /\s/.test(sb.trim()))) {
      errs.push('project.sourceBranch must be one branch name with no whitespace (got ' + JSON.stringify(sb)
        + ') — omit the key to let branch-sync.js detect the default branch');
    }
  }

  validateGates(cfg.gates, errs);
  validateArtifacts(cfg.artifacts, errs);

  if (!isPlain(cfg.env)) errs.push('`env` must be an object');
  else {
    requireStrArray(cfg.env.guarded, 'env.guarded', errs);
    if (!Array.isArray(cfg.env.openCarveOuts)) errs.push('env.openCarveOuts must be an array');
    else cfg.env.openCarveOuts.forEach((c, i) => {
      // A carve-out in the deny-all stance is a decision someone made on a date and
      // meant to revisit. Undated, it is permanent by accident, so the date is
      // required and the shape is checked here rather than wherever it is read.
      const where = 'env.openCarveOuts[' + i + ']';
      if (!isPlain(c)) { errs.push(where + ' must be { path, why, until }'); return; }
      if (!isStr(c.path)) errs.push(where + '.path must name the file being opened');
      if (!isStr(c.why)) errs.push(where + '.why must say why — an unexplained carve-out is never removed');
      if (!isStr(c.until) || !/^\d{4}-\d{2}-\d{2}$/.test(c.until)) errs.push(where + '.until must be a YYYY-MM-DD expiry');
    });
  }

  if (!isPlain(cfg.commitHygiene)) errs.push('`commitHygiene` must be an object');
  else {
    requireStrArray(cfg.commitHygiene.workDirs, 'commitHygiene.workDirs', errs);
    requireStrArray(cfg.commitHygiene.rootAllow, 'commitHygiene.rootAllow', errs);
  }

  if (!isPlain(cfg.docs)) errs.push('`docs` must be an object');
  else {
    if (!isPlain(cfg.docs.caps)) errs.push('docs.caps must be an object of line ceilings');
    else for (const k of Object.keys(cfg.docs.caps)) {
      // A cap of 0 or -1 is not "no cap", it is a cap nothing can satisfy, and a
      // float is a cap that compares strangely. Both are typos; neither is a policy.
      if (!isPosInt(cfg.docs.caps[k])) errs.push('docs.caps.' + k + ' must be a positive integer number of lines (got ' + JSON.stringify(cfg.docs.caps[k]) + ')');
    }
    requireStrArray(cfg.docs.exemptDirs, 'docs.exemptDirs', errs);
  }

  if (!isPlain(cfg.context)) errs.push('`context` must be an object');
  else if (!isStr(cfg.context.budgetFile)) errs.push('context.budgetFile must be a path to the hand-written ceiling fixture');

  if (!isPlain(cfg.tools)) errs.push('`tools` must be an object { enabled: [...] } — omit the key for the default, ' + JSON.stringify(DEFAULTS.tools.enabled));
  else {
    // A misspelled sub-key (`enable`, `tool`) would otherwise leave the default in force
    // while the file reads as if it had named its tools: the same typo-read-as-a-setting
    // the top-level check exists for, one level down.
    for (const k of Object.keys(cfg.tools)) {
      if (!TOOLS_KEYS.includes(k)) errs.push('tools: unknown key `' + k + '` (allowed: ' + TOOLS_KEYS.join(', ') + ')');
    }
    const en = cfg.tools.enabled;
    if (!Array.isArray(en)) errs.push('tools.enabled must be an array of tool ids (got ' + JSON.stringify(en) + ') — e.g. ' + JSON.stringify(DEFAULTS.tools.enabled));
    else if (en.length === 0) errs.push('tools.enabled must name at least one tool — omit the key for the default, ' + JSON.stringify(DEFAULTS.tools.enabled));
    else {
      const seenTools = new Set();
      en.forEach((id, i) => {
        if (!isStr(id) || !/^[a-z][a-z0-9-]*$/.test(id)) errs.push('tools.enabled[' + i + '] must be a kebab-case tool id from scripts/harness/tools.json (got ' + JSON.stringify(id) + ')');
        else if (seenTools.has(id)) errs.push('tools.enabled[' + i + ']: duplicate tool id `' + id + '`');
        else seenTools.add(id);
      });
    }
  }

  if (!isPlain(cfg.mode)) errs.push('`mode` must be an object { default } — omit the key and the launcher offers no mode');
  else {
    // Closed like `tools`: `defualt` would otherwise leave no suggestion in force while the
    // file reads as if it had made one.
    for (const k of Object.keys(cfg.mode)) {
      if (!MODE_KEYS.includes(k)) errs.push('mode: unknown key `' + k + '` (allowed: ' + MODE_KEYS.join(', ') + ')');
    }
    const d = cfg.mode.default;
    if (d !== null && !RUN_MODES.includes(d)) {
      errs.push('mode.default must be one of ' + RUN_MODES.join(', ') + ', or null (got ' + JSON.stringify(d) + ')');
    }
  }

  if (!isPlain(cfg.worktrees)) errs.push('`worktrees` must be an object { root, branchPrefix, carry, setup } — omit the key and every one is derived');
  else {
    // Closed like `tools`: `rooot` would otherwise leave the derived root in force while the
    // file reads as if it had named one.
    for (const k of Object.keys(cfg.worktrees)) {
      if (!WORKTREES_KEYS.includes(k)) errs.push('worktrees: unknown key `' + k + '` (allowed: ' + WORKTREES_KEYS.join(', ') + ')');
    }
    const r = cfg.worktrees.root;
    if (r !== null && !isStr(r)) errs.push('worktrees.root must be a path, or null to derive it (got ' + JSON.stringify(r) + ')');
    const bp = cfg.worktrees.branchPrefix;
    if (typeof bp !== 'string' || !/^[A-Za-z0-9._/-]*$/.test(bp)) {
      errs.push('worktrees.branchPrefix must be a string of letters, digits, dot, underscore, hyphen and slash (got ' + JSON.stringify(bp) + ')');
    }
    // A carried path is read against the MAIN CHECKOUT and written into a new folder, so one
    // that is absolute or climbs out names a file no checkout owns. Refused here, at the seam,
    // and again by worktree.js, whose self-test hands it a list this loader never saw.
    const ca = cfg.worktrees.carry;
    if (!Array.isArray(ca) || !ca.every(isStr)) errs.push('worktrees.carry must be a list of paths, or [] to carry nothing (got ' + JSON.stringify(ca) + ')');
    else {
      for (const p of ca) {
        const n = String(p).replace(/\\/g, '/');
        if (/^([A-Za-z]:|\/)/.test(n) || n.split('/').includes('..')) errs.push('worktrees.carry: `' + p + '` must be a path inside the checkout, with no `..` and no leading slash or drive');
      }
    }
    const su = cfg.worktrees.setup;
    if (su !== null && !isStr(su)) errs.push('worktrees.setup must be one command line, or null to run nothing (got ' + JSON.stringify(su) + ')');
  }

  return errs;
}

/* ---------- load ----------
   Cached per resolved file path. The cache is what lets a hook, a gate and a test
   in one process share a single reading; `{ fresh: true }` is for the self-test,
   which writes several configs in a row and must see each of them. */
const CACHE = new Map();

function load(opts) {
  const o = opts || {};
  const root = o.root ? path.resolve(o.root) : ROOT;
  const file = o.file ? path.resolve(o.file) : path.join(root, CONFIG_NAME);
  if (!o.fresh && CACHE.has(file)) return CACHE.get(file);

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (o.soft) return null;
    throw configError('no readable ' + CONFIG_NAME + ' at ' + file + ' (' + (e.code || e.message) + ')',
      'write ' + CONFIG_NAME + ' at the repo root — ' + SCHEMA_HINT + '. The harness has no default suite.');
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    if (o.soft) return null;
    throw configError(CONFIG_NAME + ' is not valid JSON: ' + e.message,
      'JSON has no comments and no trailing commas — put prose in a `_readme` array instead.');
  }
  if (!isPlain(raw)) {
    if (o.soft) return null;
    throw configError(CONFIG_NAME + ' must contain a JSON object', 'the top level is `{ ... }`, not an array or a string.');
  }

  // Unknown TOP-LEVEL keys are read off the raw file, before the merge, because
  // after the merge a typo'd section is indistinguishable from a default.
  const unknown = Object.keys(raw).filter((k) => !TOP_LEVEL.includes(k));
  if (unknown.length) {
    if (o.soft) return null;
    throw configError(CONFIG_NAME + ': unknown top-level key(s) ' + unknown.map((k) => '`' + k + '`').join(', '),
      'the top level holds exactly: ' + TOP_LEVEL.join(', ') + '. A key the harness does not read is a setting that is not in force.');
  }

  const cfg = deepMerge(DEFAULTS, raw);
  const errs = validate(cfg);
  if (errs.length) {
    if (o.soft) return null;
    throw configError(CONFIG_NAME + ': ' + errs.length + ' problem(s) — ' + errs.join('; '),
      'edit ' + path.relative(root, file).split(path.sep).join('/') + ' — ' + SCHEMA_HINT + '.');
  }

  // Where the config came from, without putting either value in the validated
  // shape (a key the schema does not document would fail its own validator).
  Object.defineProperty(cfg, 'configFile', { value: file, enumerable: false });
  Object.defineProperty(cfg, 'root', { value: root, enumerable: false });
  deepFreeze(cfg);
  CACHE.set(file, cfg);
  return cfg;
}

/* ---------- --self-test ----------
   Drives the two decisions everything downstream trusts — "is this config usable"
   and "where is the repo" — with literals and with a real nested cwd. A green gate
   suite can only ever prove that the happy path works. */
function selfTest() {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const fails = [];
  const eq = (what, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  };
  const ok = (what, cond) => eq(what, Boolean(cond), true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-config-self-test-'));
  const write = (obj) => { fs.writeFileSync(path.join(dir, CONFIG_NAME), JSON.stringify(obj, null, 2)); };
  const minimal = { project: { name: 'example' }, gates: [{ name: 'test', command: 'node --test' }] };
  const fresh = () => load({ root: dir, fresh: true });
  const err = () => { try { fresh(); return null; } catch (e) { return e; } };

  try {
    // Defaults are applied, and the file only has to say what differs from them.
    write(minimal);
    const cfg = fresh();
    eq('a default is applied', cfg.project.docsRoot, 'docs');
    eq('a nested default is applied', cfg.docs.caps['AGENTS.md'], 80);
    eq('the routing doc follows the docs root', routingDoc({ project: { docsRoot: 'prose' } }), 'prose/reference/routing/README.md');
    eq('...and survives a trailing separator on it', routingDoc({ project: { docsRoot: 'docs/' } }), 'docs/reference/routing/README.md');
    // The budget file keys this path with forward slashes on every platform, so a docs root typed
    // the Windows way has to come out the same or two scripts name one doc two ways.
    eq('...and a docs root spelled with backslashes', routingDoc({ project: { docsRoot: 'a\\b\\' } }), 'a/b/reference/routing/README.md');
    eq('an empty artifact list is the default', cfg.artifacts, []);
    eq('the deny-all env stance is the default', cfg.env.guarded, ['.env', '.env.*']);
    eq('what the file says wins over the default', cfg.gates.length, 1);
    ok('the config is frozen, so one reader cannot edit another\'s', Object.isFrozen(cfg) && Object.isFrozen(cfg.docs.caps));
    ok('it remembers where it came from', String(cfg.configFile).endsWith(CONFIG_NAME));
    eq('a second load is the cached object', load({ root: dir }) === cfg, true);

    // A gate is rejected BY NAME, not by index: the reader is looking at a list.
    write({ project: { name: 'example' }, gates: [{ name: 'test', command: 'node --test' }, { name: 'docs' }] });
    const noCommand = err();
    ok('a gate with no command is rejected', noCommand);
    ok('...and the gate is named back', noCommand && /gates\.docs has no `command`/.test(noCommand.message));
    ok('...with a fix line', noCommand && isStr(noCommand.fix));

    write({ project: { name: 'example' }, gates: [{ name: 'test', command: 'x' }, { name: 'test', command: 'y' }] });
    ok('a duplicate gate name is rejected', /duplicate gate name/.test(String((err() || {}).message)));

    write({ project: { name: 'example' }, gates: [{ name: 'test', command: 'x', adaptor: 'node-test' }] });
    ok('a misspelled gate key is rejected rather than ignored', /unknown key `adaptor`/.test(String((err() || {}).message)));

    write({ project: { name: 'example' }, gates: [] });
    ok('an empty gate list is rejected — there is no default suite', /non-empty array/.test(String((err() || {}).message)));

    // An unknown TOP-LEVEL key, which is the shape a typo'd section takes.
    write(Object.assign({ gate: [{ name: 'test', command: 'x' }] }, minimal));
    const unknownKey = err();
    ok('an unknown top-level key is rejected', unknownKey);
    ok('...and named', unknownKey && /unknown top-level key\(s\) `gate`/.test(unknownKey.message));

    write(Object.assign({}, minimal, { docs: { caps: { default: 0 } } }));
    ok('a cap of 0 is rejected', /docs\.caps\.default must be a positive integer/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { docs: { caps: { default: 12.5 } } }));
    ok('a fractional cap is rejected', /docs\.caps\.default must be a positive integer/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { docs: { caps: { default: 150 } } }));
    eq('a positive cap is accepted', fresh().docs.caps.default, 150);

    write(Object.assign({}, minimal, { env: { openCarveOuts: [{ path: '.env.local', why: 'local run' }] } }));
    ok('an undated carve-out is rejected', /\.until must be a YYYY-MM-DD expiry/.test(String((err() || {}).message)));

    write(Object.assign({}, minimal, { artifacts: [{ nope: 1 }] }));
    ok('an artifact entry that is neither a path nor a glob is rejected', /must be a path string, \{ path \} or \{ glob \}/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { artifacts: { command: 'npm run build', files: ['dist/app.js', { glob: 'dist/**/*.css' }] } }));
    eq('the { command, files } artifact shape is accepted', fresh().artifacts.files.length, 2);

    write(Object.assign({}, minimal, { project: { name: 'example', docsRoot: '../elsewhere' } }));
    ok('a docs root outside the repo is rejected', /must stay inside the repo/.test(String((err() || {}).message)));

    // The one optional key with no default. Unset stays unset: a default here would be
    // this file choosing which branch a repo's harness is graded against.
    write(minimal);
    eq('an unset source branch stays unset — there is no default to invent', fresh().project.sourceBranch, undefined);
    write(Object.assign({}, minimal, { project: { name: 'example', sourceBranch: 'trunk' } }));
    eq('a stated source branch is carried through', fresh().project.sourceBranch, 'trunk');
    write(Object.assign({}, minimal, { project: { name: 'example', sourceBranch: 'my branch' } }));
    ok('a source branch with whitespace in it is rejected, not passed to git',
      /project\.sourceBranch must be one branch name/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { project: { name: 'example', sourceBranch: '' } }));
    ok('an empty source branch is rejected rather than read as unset',
      /project\.sourceBranch must be one branch name/.test(String((err() || {}).message)));

    // The tools key. Absent means the one tool the harness has always been wired for;
    // a wrong shape is a stop, because a list that silently fell back to the default
    // would report a tool as enabled that the file never named.
    write(minimal);
    eq('an absent tools key means the default tool', fresh().tools.enabled, ['claude-code']);
    write(Object.assign({}, minimal, { tools: {} }));
    eq('an empty tools section still gets the default list', fresh().tools.enabled, ['claude-code']);
    write(Object.assign({}, minimal, { tools: { enabled: ['tool-a', 'tool-b'] } }));
    eq('a stated tool list replaces the default whole', fresh().tools.enabled, ['tool-a', 'tool-b']);
    write(Object.assign({}, minimal, { tools: { enabled: 'tool-a' } }));
    ok('a tool list that is not an array is rejected', /tools\.enabled must be an array/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { tools: ['tool-a'] }));
    ok('a tools section that is not an object is rejected', /`tools` must be an object/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { tools: { enable: ['tool-a'] } }));
    const badToolsKey = err();
    ok('a misspelled tools sub-key is rejected rather than ignored', badToolsKey && /tools: unknown key `enable`/.test(badToolsKey.message));
    ok('...with a fix line', badToolsKey && isStr(badToolsKey.fix));
    write(Object.assign({}, minimal, { tools: { enabled: [] } }));
    ok('an empty tool list is rejected', /tools\.enabled must name at least one tool/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { tools: { enabled: ['tool-a', 'tool-a'] } }));
    ok('a tool named twice is rejected', /duplicate tool id `tool-a`/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { tools: { enabled: ['Tool A'] } }));
    ok('a tool id that is not kebab-case is rejected', /tools\.enabled\[0\] must be a kebab-case tool id/.test(String((err() || {}).message)));

    // The mode section. Absent means the launcher suggests nothing; a wrong shape is a stop.
    write(minimal);
    eq('an absent mode key means no suggested mode', fresh().mode.default, null);
    write(Object.assign({}, minimal, { mode: {} }));
    eq('an empty mode section suggests nothing either', fresh().mode.default, null);
    for (const m of RUN_MODES) {
      write(Object.assign({}, minimal, { mode: { default: m } }));
      eq('mode.default `' + m + '` is carried through', fresh().mode.default, m);
    }
    write(Object.assign({}, minimal, { mode: { default: 'yolo' } }));
    ok('a mode that is not one is rejected', /mode\.default must be one of fully-auto, auto-edit, hitl, manual, or null/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { mode: { default: '' } }));
    ok('an empty mode is rejected rather than read as unset', /mode\.default must be one of/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { mode: 'hitl' }));
    ok('a mode section that is not an object is rejected', /`mode` must be an object/.test(String((err() || {}).message)));
    write(Object.assign({}, minimal, { mode: { defualt: 'hitl' } }));
    const badModeKey = err();
    ok('a misspelled mode sub-key is rejected rather than ignored', badModeKey && /mode: unknown key `defualt`/.test(badModeKey.message));
    ok('...with a fix line', badModeKey && isStr(badModeKey.fix));
    write(Object.assign({ modes: { default: 'hitl' } }, minimal));
    ok('the section misspelled at the top level is rejected too', /unknown top-level key\(s\) `modes`/.test(String((err() || {}).message)));

    // SOFT MODE. A hook that cannot read the config must degrade, not throw: an
    // exception out of a PreToolUse hook takes the whole session with it.
    fs.unlinkSync(path.join(dir, CONFIG_NAME));
    eq('soft mode answers null for a missing config', load({ root: dir, soft: true, fresh: true }), null);
    const missing = err();
    ok('...and hard mode does not', missing && /no readable/.test(missing.message));
    ok('...with a one-line fix', missing && /^write harness\.config\.json at the repo root/.test(missing.fix));
    fs.writeFileSync(path.join(dir, CONFIG_NAME), '{ "project": }');
    eq('soft mode answers null for unparseable JSON', load({ root: dir, soft: true, fresh: true }), null);
    ok('...and hard mode names the parse error', /is not valid JSON/.test(String((err() || {}).message)));
    write({ project: { name: 'example' } });
    eq('soft mode answers null for a config with no gates', load({ root: dir, soft: true, fresh: true }), null);

    // ROOT FROM A NESTED CWD, in a child process because ROOT is decided once at
    // load time — which is exactly the thing that has to be right for a gate run
    // started three directories down.
    write(minimal);
    const here = path.join(dir, 'scripts', 'harness');
    fs.mkdirSync(here, { recursive: true });
    fs.copyFileSync(__filename, path.join(here, 'config.js'));
    const nested = path.join(dir, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    const env = Object.assign({}, process.env);
    delete env.CLAUDE_PROJECT_DIR;
    const askRoot = (cwd, e) => {
      const r = spawnSync(process.execPath,
        ['-e', 'process.stdout.write(require(' + JSON.stringify(path.join(here, 'config.js')) + ').ROOT)'],
        { cwd: cwd, encoding: 'utf8', env: e || env });
      return r.status === 0 ? fs.realpathSync(String(r.stdout).trim()) : 'EXIT ' + r.status + ' ' + r.stderr;
    };
    const real = fs.realpathSync(dir);
    eq('ROOT is found by walking up from a nested cwd', askRoot(nested), real);
    eq('ROOT is the repo when the cwd IS the repo', askRoot(dir), real);
    // No config above the cwd: CLAUDE_PROJECT_DIR is what a hook has instead.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-config-bare-'));
    try {
      eq('CLAUDE_PROJECT_DIR is the fallback a hook gets',
        askRoot(bare, Object.assign({}, env, { CLAUDE_PROJECT_DIR: dir })), real);
      // And with neither, two levels up from the script — the vendored-copy case.
      eq('two levels up from the script is the last resort', askRoot(bare), real);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? '\nFAIL — config.js self-test: ' + fails.length + ' assertion(s)'
    : 'PASS — config.js self-test (' + TOP_LEVEL.length + ' top-level keys, ' + Object.keys(DEFAULTS).length + ' defaulted sections)');
  process.exit(fails.length ? 1 : 0);
}

module.exports = { load, ROOT, resolve, fatal, CONFIG_NAME, DEFAULTS, TOP_LEVEL, TOOLS_KEYS, MODE_KEYS, WORKTREES_KEYS, RUN_MODES, ROUTING_DOC, routingDoc };

if (require.main === module) {
  if (process.argv.slice(2).includes('--self-test')) selfTest();
  else {
    // Printing the resolved config is the only other thing this file does: it is
    // how you find out what the harness thinks it is grading before it grades it.
    let cfg;
    try { cfg = load(); } catch (e) { fatal(e.message, e.fix); }
    console.log(JSON.stringify(cfg, null, 2));
  }
}
