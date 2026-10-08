#!/usr/bin/env node
'use strict';
/* ============================================================
   harness — the installer and the one CLI over the harness scripts.

   WHY THIS EXISTS
   The harness is a set of files that have to sit INSIDE the repo they grade: the
   hooks are read from .claude/settings.json, the gate runner writes its verdict
   beside itself, and a gate's baseline is committed with the code it measures.
   It cannot be a dependency you import — a harness in node_modules is one a
   fresh clone does not have until someone installs it, and a hook that points
   into node_modules is a hook that is silently absent on exactly that clone.
   So installing it is COPYING it, and this file is the copy step, plus the
   check that the copy is still whole.

   THE THREE RULES THAT SHAPE IT
     1. `init` never overwrites. A second run on a configured repo must be a
        no-op that says so, because the files it would replace are the ones a
        human has been editing since the first run: harness.config.json and
        AGENTS.md. `--force` exists, and is the only way.
     2. Every line it prints names a path and, when something is wrong, the ONE
        command that fixes it. "some files may be out of date" sends the reader
        off to find out which; this file already knows which.
     3. The config it generates comes from what it DETECTED and it says what
        that was. When it detects no test command it writes no test gate and
        says so — it never invents a suite, for the reason config.js gives:
        a green verdict about a suite nobody agreed to is worse than none.

   Zero dependencies, Node built-ins only, like everything it installs.

   Run:  harness init [--into <dir>] [--tools <id>[,<id>]] [--git-hooks] [--force] [--dry-run] [--only <path-prefix>]
         harness doctor [--root <dir>] [--no-self-tests]
         harness gates [--check] [--print-allow-skip [--with <gate>=<n>]] [...flags for gates.js]
         harness docs [--index] [...flags for the doc scripts]
         harness worktree new <name> [--track] [--from <ref>] | list | land <name> | prune [--yes]
         harness host
         harness selftest
         harness --help | --self-test
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Where the harness being INSTALLED lives: the package this file is part of.
const PKG_ROOT = path.resolve(__dirname, '..');
// The config seam. Required, never re-implemented: a CLI with its own idea of a
// valid config would pass a file the gate runner then refuses.
const CONFIG = require('../scripts/harness/config.js');
const TOOLS = require('../scripts/harness/tools.js');
const CONFIG_NAME = CONFIG.CONFIG_NAME;
/* The instruction-file names are the registry's, read the way the doc gate reads them, so this
   file and that gate cannot disagree about what a stub is. STUB_FILES is every name some row
   uses as an import stub (what doctor sweeps for, as the doc gate does). STUB_FILE is the one
   the DEFAULT tool needs: init writes no `tools.enabled`, so a fresh install runs under the
   default, and that tool's stub is the one init has to render. undefined when the default tool
   loads the policy file natively, and then init renders no stub at all. */
const REGISTRY = (() => { try { return TOOLS.readRegistry(); } catch (e) { return CONFIG.fatal(e.message, e.fix); } })();
const STUB_FILES = TOOLS.stubFiles(REGISTRY);
const DEFAULT_ENABLED = CONFIG.DEFAULTS.tools.enabled;
/* Which tools a run is FOR is the config's to say (`tools.enabled`), or `init --tools`; nothing
   probes the machine. The stub is then the one THOSE tools need, and none when every one of them
   loads the policy file itself. */
const stubFileFor = (enabled) => TOOLS.enabledStubFiles(REGISTRY, enabled || DEFAULT_ENABLED)[0];
const STUB_FILE = stubFileFor();
const stubCap = (n, stub) => (stub ? { [stub]: n } : {});
const posix = (p) => String(p).split(path.sep).join('/');
/* The merges init writes and doctor grades (hook registrations, the policy setting), and the
   skill renderer. Loaded when first needed: a package that lost a piece must still reach the
   line that names the missing piece, and a `require` up here would die before it. */
const WIRE = () => require('../scripts/harness/wire.js');
const SKILLS = () => require('../scripts/harness/guards/skill-verify.cjs');
const GITHOOKS = () => require('../scripts/harness/githooks.js');
/** A row's dialect module, or null: the row has none, or the module is not in this copy. */
const dialectOf = (row) => {
  if (!row || typeof row.dialect !== 'string' || !/^[a-z][a-z0-9-]*$/.test(row.dialect)) return null;
  try { return require(path.join(PKG_ROOT, 'scripts', 'harness', 'dialects', row.dialect + '.js')); } catch { return null; }
};

/* ---------- what an installed copy consists of ----------
   Named file by file for the agents and skills, NOT "whatever is in the
   directory". A working checkout of this package can hold a third-party skill
   someone is in the middle of vetting, and an installer that copies the
   directory would republish it into every repo it touches, with no entry in
   that repo's lock. Only the harness's own work ships; adding one is an edit
   here and in package.json `files`. */
const SHIPPED_AGENTS = ['explore.md', 'implement.md', 'research.md', 'review.md'];
const SHIPPED_SKILLS = ['plan', 'research', 'implement', 'guide'];
const TRACK_TEMPLATES = ['README.md', 'plan.md', 'traps.md', 'handoff.md'];
/* The directory the shipped skills are WRITTEN in. A tool whose registry row names this root gets
   them copied; a tool that names another root gets them rendered there (portable frontmatter
   only), once per root however many tools read it. */
const SKILL_SOURCE = '.claude/skills';
/* The one hook config this package ships whole, comments and all, and the helper directory only
   that file refers to. Both are installed when an ENABLED row keeps its hooks in that file, and
   not otherwise: a repo wired for other tools has no use for either. */
const SHIPPED_HOOK_CONFIG = { file: '.claude/settings.json', helpers: '.claude/helpers' };
const usesShippedHookConfig = (enabled) => TOOLS.enabledRows(REGISTRY, enabled || DEFAULT_ENABLED).some((r) => r.hookConfig === SHIPPED_HOOK_CONFIG.file);
// One machine's run output, never part of an install. gates.json carries a
// timestamp and a dirty flag; a red log is a transcript of someone else's tree.
const RUN_OUTPUT = [/^gates\.json$/, /^gates\.red\..*\.log$/];

/* The ignore rules an installed harness depends on, each with the path that
   proves it. `init` writes them into a new .gitignore, and `doctor` asks git
   about each probe with `check-ignore --no-index`, so it is the EFFECT that is
   checked and not the spelling: a repo is free to phrase its ignore file any way
   it likes as long as these paths come out ignored.

   The secret-file rules are NOT in this literal. They are derived from the
   config's guarded list (see requiredIgnores), so the file the guard refuses to
   open and the file git refuses to track are one list and cannot drift apart. */
const STATIC_IGNORES = [
  { pattern: 'scripts/harness/gates.json', probe: 'scripts/harness/gates.json', why: 'one run on one machine; versioned, it conflicts on every pull' },
  { pattern: 'scripts/harness/gates.red.*.log', probe: 'scripts/harness/gates.red.test.log', why: 'a red gate\'s whole output' },
  { pattern: '.claude/settings.local.json', probe: '.claude/settings.local.json', why: 'personal settings; may hold a credential' },
  { pattern: '.claude/.commit-hygiene-clearance.json', probe: '.claude/.commit-hygiene-clearance.json', why: 'a waiver bound to one tree state' },
  { pattern: 'node_modules/', probe: 'node_modules/example/index.js', why: 'dependency tree' },
  { pattern: '.phase', probe: 'docs/tracks/example/.phase', why: 'a run-mode receipt: one person\'s approval of one phase on one machine' },
];
function requiredIgnores(guarded) {
  const secrets = (guarded || []).map((p) => ({
    pattern: p,
    // A wildcard has no path of its own to ask git about, so it is probed with
    // one concrete name it must cover.
    probe: p.replace(/\*/g, 'local'),
    why: 'a guarded secret file (env.guarded in ' + CONFIG_NAME + ')',
  }));
  return STATIC_IGNORES.concat(secrets);
}
const globRe = (p) => new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
const isGuarded = (name, guarded) => (guarded || []).some((p) => globRe(p).test(name));

/* ---------- small file helpers ---------- */
const exists = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const lf = (s) => String(s).replace(/\r\n/g, '\n');
function walk(dir, skip) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, e.name);
    if (skip && skip(full, e)) continue;
    if (e.isDirectory()) out.push(...walk(full, skip));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/* ============================================================
   DETECTION — what `init` learns from the target before it writes a config.
   Every answer carries the evidence it came from, and that evidence is printed:
   a generated config whose origin is invisible is one nobody dares to edit.
   ============================================================ */
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
];
// The stub `npm init` writes. It exits 1 by design, so wiring it up as a gate
// would give a new repo a permanently red suite about a test nobody wrote.
const NPM_TEST_STUB = /no test specified/i;

function detect(target) {
  const d = { evidence: {} };
  const pkg = readJson(path.join(target, 'package.json'));
  const guarded = CONFIG.DEFAULTS.env.guarded;

  // NAME. A scoped package name loses its scope: the name labels reports, and
  // `@acme/web` in a GATE context reads as two things.
  if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
    d.name = pkg.name.trim().replace(/^@[^/]+\//, '');
    d.evidence.name = 'package.json `name`';
  } else {
    d.name = path.basename(path.resolve(target)) || 'project';
    d.evidence.name = 'the directory name';
  }

  // PACKAGE MANAGER. The `packageManager` field outranks a lockfile because it
  // is a declaration and a lockfile is a leftover: a repo that moved from one
  // manager to another keeps the old lockfile until someone notices.
  d.packageManager = null;
  if (pkg && typeof pkg.packageManager === 'string' && /^(npm|pnpm|yarn|bun)@/.test(pkg.packageManager)) {
    d.packageManager = pkg.packageManager.split('@')[0];
    d.evidence.packageManager = 'package.json `packageManager`';
  } else {
    for (const [file, pm] of LOCKFILES) {
      if (exists(path.join(target, file))) { d.packageManager = pm; d.evidence.packageManager = file; break; }
    }
    if (!d.packageManager && pkg) { d.packageManager = 'npm'; d.evidence.packageManager = 'package.json with no lockfile'; }
  }
  if (!d.packageManager) {
    for (const [file, pm] of [['Cargo.toml', 'cargo'], ['go.mod', 'go'], ['pyproject.toml', 'python'], ['requirements.txt', 'python']]) {
      if (exists(path.join(target, file))) { d.packageManager = pm; d.evidence.packageManager = file; break; }
    }
  }
  if (!d.packageManager) d.evidence.packageManager = 'nothing recognised';

  // TEST COMMAND, and how its verdict is read. `node --test` prints its own
  // summary, which the `node-test` adapter reads into real pass/fail/skipped
  // figures. Anything else is graded on its exit status: one pass or one fail.
  // That is coarse on purpose — it is what can be claimed about a runner whose
  // output this file has never seen. Replace it with a command that prints a
  // GATE line the day the figure matters.
  d.test = null;
  const scripts = (pkg && pkg.scripts) || {};
  const run = (name) => (d.packageManager === 'npm' || !d.packageManager ? 'npm run ' + name : d.packageManager + ' run ' + name);
  if (typeof scripts.test === 'string' && scripts.test.trim() && !NPM_TEST_STUB.test(scripts.test)) {
    if (/^node\s+--test(\s|$)/.test(scripts.test.trim())) {
      d.test = { command: scripts.test.trim(), adapter: 'node-test' };
    } else {
      d.test = { command: run('test'), adapter: 'exit-code' };
    }
    d.evidence.test = 'package.json `scripts.test`';
  } else if (d.packageManager === 'cargo') {
    d.test = { command: 'cargo test', adapter: 'exit-code' }; d.evidence.test = 'Cargo.toml';
  } else if (d.packageManager === 'go') {
    d.test = { command: 'go test ./...', adapter: 'exit-code' }; d.evidence.test = 'go.mod';
  } else if (d.packageManager === 'python' && (isDir(path.join(target, 'tests')) || isDir(path.join(target, 'test')))) {
    d.test = { command: 'python -m pytest', adapter: 'exit-code' }; d.evidence.test = 'a tests directory beside ' + d.evidence.packageManager;
  } else {
    d.evidence.test = 'none found';
  }
  d.lint = typeof scripts.lint === 'string' && scripts.lint.trim()
    ? { command: run('lint'), adapter: 'exit-code' } : null;

  // DOCS DIR. An existing directory wins; `docs` is what gets created otherwise.
  d.docsRoot = 'docs';
  d.evidence.docsRoot = 'the default (no docs directory yet)';
  for (const cand of ['docs', 'doc', 'documentation']) {
    if (isDir(path.join(target, cand))) { d.docsRoot = cand; d.evidence.docsRoot = cand + '/ exists'; break; }
  }

  // DEFAULT BRANCH. origin/HEAD is the only thing that actually records it; the
  // rest are guesses in descending order of how often they are right, and the
  // evidence line says which one was used so a wrong guess is visible.
  d.defaultBranch = 'main';
  d.evidence.defaultBranch = 'the fallback (not a git repository, or no branch yet)';
  const originHead = git(target, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) {
    d.defaultBranch = originHead.replace(/^origin\//, ''); d.evidence.defaultBranch = 'origin/HEAD';
  } else {
    const branches = (git(target, ['branch', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
    const configured = git(target, ['config', '--get', 'init.defaultBranch']);
    const current = git(target, ['symbolic-ref', '--short', 'HEAD']);
    if (branches.includes('main')) { d.defaultBranch = 'main'; d.evidence.defaultBranch = 'a local `main` branch'; }
    else if (branches.includes('master')) { d.defaultBranch = 'master'; d.evidence.defaultBranch = 'a local `master` branch'; }
    // No branch exists yet, so HEAD names the branch the first commit will create (`git init -b
    // <name>`). That outranks init.defaultBranch, which is what the NEXT `git init` would pick
    // and says nothing about this repository.
    else if (!branches.length && current) { d.defaultBranch = current; d.evidence.defaultBranch = 'the unborn branch HEAD names'; }
    else if (configured) { d.defaultBranch = configured; d.evidence.defaultBranch = 'git config init.defaultBranch'; }
    else if (current) { d.defaultBranch = current; d.evidence.defaultBranch = 'the current branch'; }
  }

  // WHERE WORK LIVES. The top-level directories and root files that are already
  // TRACKED, so the first hygiene report is about new strays and not a wall of
  // findings against the repo as it stood before the harness arrived. Read from
  // git rather than the disk: an untracked scratch file at the root is the very
  // thing the check exists to refuse, and listing it here would bless it. A
  // tracked file the secret guard covers is left out for the same reason — the
  // generated config must never be the thing that allows one at the root.
  const tracked = (git(target, ['ls-files']) || '').split('\n').filter(Boolean);
  d.trackedDirs = [...new Set(tracked.filter((f) => f.includes('/')).map((f) => f.split('/')[0]))].sort();
  d.trackedRootFiles = tracked.filter((f) => !f.includes('/') && !isGuarded(f, guarded)).sort();
  return d;
}

/* The config `init` writes. Built to the shape config.js validates, and the
   self-test loads it back through config.js so the two cannot drift. */
function buildConfig(d) {
  const tracksDir = d.docsRoot + '/tracks';
  const gates = [];
  if (d.test) gates.push({ name: 'test', command: d.test.command, adapter: d.test.adapter });
  if (d.lint) gates.push({ name: 'lint', command: d.lint.command, adapter: d.lint.adapter, optional: true });
  gates.push(
    { name: 'docs', command: 'node scripts/harness/guards/docs-lint.cjs' },
    { name: 'context', command: 'node scripts/harness/measure-context.js --check' },
    { name: 'hygiene', command: 'node scripts/harness/guards/commit-hygiene.cjs --report' },
    { name: 'skills', command: 'node scripts/harness/guards/skill-verify.cjs --check' },
    // The registry and the enabled list, held to their contract on every run of the suite.
    { name: 'tools', command: 'node scripts/harness/tools.js --check' });
  const uniq = (a) => [...new Set(a)];
  const stub = stubFileFor(d.enabled);
  // Where the enabled tools keep what init writes for them: a file there is not a stray.
  const toolPaths = TOOLS.enabledRows(REGISTRY, d.enabled || DEFAULT_ENABLED).flatMap((r) => [
    r.projectHooks === true && !/[*~]/.test(String(r.hookConfig)) ? r.hookConfig : null,
    r.policy && r.policy.mode === 'config' ? r.policy.file : null,
    typeof r.skills === 'string' ? r.skills + '/' : null,
  ]).filter(Boolean);
  const toolDirs = toolPaths.filter((p) => p.includes('/')).map((p) => p.split('/')[0]);
  const toolRootFiles = toolPaths.filter((p) => !p.includes('/'));
  return {
    $schema: './schema/harness.config.schema.json',
    _readme: [
      'Generated by `harness init`. Everything project-specific the harness knows is in this file;',
      'edit it freely — init never overwrites it without --force.',
      'Detected: name from ' + d.evidence.name + '; package manager ' + (d.packageManager || 'none') + ' (' + d.evidence.packageManager + ');',
      'test command from ' + d.evidence.test + '; docs root from ' + d.evidence.docsRoot + ';',
      'default branch `' + d.defaultBranch + '` from ' + d.evidence.defaultBranch + '.',
      d.test ? 'The `test` gate is graded by the `' + d.test.adapter + '` adapter.'
        : 'NO TEST COMMAND WAS DETECTED, so there is no `test` gate. Add one: the harness will not invent a suite.',
      '`artifacts` is empty, so the reproducible-build check declares skipped=1 on every run. Tolerate it',
      'in the invocation (--allow-skip reproducible-build=1) or list the committed build outputs here.',
      'node scripts/harness/config.js prints this file with every default merged in.',
    ],
    project: { name: d.name, docsRoot: d.docsRoot, tracksDir: tracksDir },
    gates: gates,
    artifacts: [],
    // The deny-all stance, taken from the loader's own defaults and written out so
    // the reader can see the list the guard is enforcing.
    env: { guarded: CONFIG.DEFAULTS.env.guarded.slice(), openCarveOuts: [] },
    commitHygiene: {
      workDirs: uniq(['scripts', 'tests', d.docsRoot, 'templates', 'schema', '.claude', '.github'].concat(d.trackedDirs, toolDirs)),
      rootAllow: uniq(['README.md', 'LICENSE', 'package.json'].concat(stub ? [stub] : [], [TOOLS.POLICY_FILE, CONFIG_NAME,
        'skills-lock.json', '.gitignore', '.gitattributes'], d.trackedRootFiles, toolRootFiles)),
    },
    docs: {
      caps: Object.assign({ [TOOLS.POLICY_FILE]: 80 }, stubCap(5, stub), { subtreeAgentsMd: 50, default: 150 }),
      exemptDirs: [d.docsRoot + '/archive', d.docsRoot + '/explorations'],
    },
    context: { budgetFile: 'scripts/harness/context-budget.json' },
    // Written only when the caller NAMED the tools. Left out, the loader's default is in force,
    // and a default nobody chose is not written down as if somebody had.
    ...(d.enabled ? { tools: { enabled: d.enabled.slice() } } : {}),
  };
}

/* ---------- template rendering ----------
   Two token spellings: `<UPPER_SNAKE>`, which is what the shipped templates use,
   and `{{ key }}`. Keys are matched case-insensitively with separators ignored,
   so <PROJECT_NAME>, {{project.name}} and {{projectName}} are one token. Only an
   ALL-CAPS angle token is a placeholder: `<id>`, `<gate>` and `<n>` are the
   templates' own notation for "a value goes here at use time" and must survive.

   A token this file has no value for is LEFT IN PLACE and reported. Most of them
   are meant to be: what the project is and how to run it are things only its
   author knows, and a blank where that sentence should be reads as finished
   prose while a visible `<WHAT_THIS_IS>` does not. */
const tokenKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function render(text, d) {
  const values = {
    projectname: d.name, project: d.name, name: d.name,
    docsroot: d.docsRoot, docsdir: d.docsRoot, tracksdir: d.docsRoot + '/tracks',
    defaultbranch: d.defaultBranch, branch: d.defaultBranch,
    packagemanager: d.packageManager || 'none',
    // No detected test command means no value, so the token stays visible.
    testcommand: d.test ? d.test.command : undefined,
    // The whole flag or nothing, because that is how the template uses it.
    allowskip: '--allow-skip ' + skipArg(configSkips({ artifacts: [] })),
  };
  // The template's own word for "a token": it appears in the banner telling the
  // reader to fill the others in, and is not itself one.
  const META = ['placeholder'];
  const unknown = [];
  const out = String(text).replace(/\{\{\s*([A-Za-z0-9_.\- ]+?)\s*\}\}|<([A-Z][A-Z0-9_]*)>/g, (whole, braced, angled) => {
    const k = tokenKey(braced || angled);
    if (Object.prototype.hasOwnProperty.call(values, k) && values[k] !== undefined) return values[k];
    if (!META.includes(k)) unknown.push(whole);
    return whole;
  });
  return { text: out, unknown: [...new Set(unknown)] };
}

/* A baseline carries figures measured on the tree it was accepted on. Copying
   this package's into another repo would hand that repo a pass floor it never
   agreed to — or, once the figures differ, a red about checks it never had. So
   NOTHING of the package's baseline travels, and the target re-baselines itself.

   That includes its prose, which once did travel. The package's `_readme` is
   whatever `gates.js --accept` last stamped there: three lines about a RECORDED
   verdict. Carried into a file with no rows it is not false, but it says nothing
   about the one thing the reader of an empty baseline needs told — which
   comparisons are not running yet — and the paragraph that did say it lived only
   in the package's own baseline, where the first real `--accept` deleted it. So
   the explanation of the empty state lives HERE, beside the only code that
   creates one. */
const EMPTY_BASELINE_README = [
  'THE VERDICT OF RECORD — valid, and deliberately EMPTY.',
  '',
  '`gates` is {} because no figure in this file was measured here yet. `harness init` wrote it',
  'empty on purpose: the package it installed from carries figures measured on ITS tree, and a',
  'baseline that inherited them would hand this repo a pass floor it never agreed to — or, once',
  'the figures differ, a red about checks it never had.',
  '',
  'WHAT AN EMPTY BASELINE MEANS. `--check` compares every gate in this file plus every gate the',
  'run produced, so with no rows here each gate is still graded on the rules that need no',
  'baseline — a failing check, an unexplained non-zero exit, an undeclared skip, a missing GATE',
  'line, a non-reproducible artifact. What it is NOT yet protected by is the pair of',
  'baseline-relative rules: the pass floor, and pass-by-absence (a check that DISAPPEARS). `--check`',
  'says so per gate, out loud, on every run, because a gate with no baseline row is silently',
  'exempt and silence is indistinguishable from protection.',
  '',
  'RE-BASELINE IT once the suite is green, declaring exactly the skips this repo tolerates:',
  '    node scripts/harness/gates.js --accept --allow-skip <gate>=<n>',
  '`--accept` refuses while the suite is red, so a regression cannot be made permanent by one',
  'command. It is a deliberate act, so its commit subject must start `gates:` — enforced at commit',
  'time, not here — which keeps every re-baseline legible in `git log --oneline`.',
  '',
  'Nothing else writes this file. gates.json beside it is the LAST run and is git-ignored; this one',
  'is committed and is what the last run is judged against.',
];
function emptyBaseline() {
  return JSON.stringify({
    _readme: EMPTY_BASELINE_README, generatedAt: null, commit: null, dirty: null, node: null, gates: {},
  }, null, 2) + '\n';
}

/* The context REPORT is the third figure file, and the one this installer forgot: it was
   copied as it stood while it held a zeroed shape, which was harmless, and would have gone on
   being copied once the package recorded a real measurement of itself — handing every target
   another repo's byte counts and another machine's measured first turn, printed by the context
   gate on every run as though they described the tree in front of it. So it is written for
   the target like the other two: no measurement, and a note that says who writes the next one.
   Deliberately not a zeroed copy of the report's shape: that shape is measure-context.js's to
   define, and a second spelling of it here would drift. The gate reads one key out of this
   file (`groundTruth`) and treats everything else as optional. */
function emptyReport() {
  return JSON.stringify({
    _readme: [
      'THE REPORT, not a budget — and EMPTY: nothing has been measured in this repo yet.',
      '`node scripts/harness/measure-context.js` REWRITES THIS FILE IN FULL on every ordinary run,',
      'this note included, so nothing in here is a standard anything is graded against. The',
      'ceilings live in context-budget.json beside it, which no script writes.',
      '',
      'That split is the point. A ceiling kept in a file an ordinary command rewrites is a ceiling',
      'anybody lifts by running the routine command — no deliberate re-baseline, no refusal on a',
      'red, no diff a reviewer would notice.',
      '',
      'WHAT IT IS FOR: the committed figure of record. It is the before/after column when a track',
      'sets out to cut always-on cost, and it carries the two things the gate cannot grade — the',
      'listing rows and the ground-truth first turn of a real session, both properties of the box',
      'that measured them. Run it with --harness-only to leave your own user-level config out of',
      'a file you are about to commit.',
      '',
      '`node scripts/harness/measure-context.js --check` is the gate and writes NOTHING. It reads',
      'only `groundTruth` from here, to print the gap between the graded surface and a real first',
      'turn; while that is null it prints `measured first turn not recorded`.',
    ],
    measured: null,
    groundTruth: null,
  }, null, 2) + '\n';
}

/* The context budget is the same case, and it bit harder: the package's own
   fixture holds a ceiling for every always-on file THIS package has, including
   the nested instruction files under templates/ that an installed copy never
   receives. Copied as it stands, a fresh install went red on its first run — the
   coverage rule (rightly) refuses a bucket that holds a ceiling and graded
   nothing — about a file the target was never given. So the target gets a budget
   written for the files init itself puts there, by the fixture's own rule: bytes
   + 10%, rounded up to the next 256 B. Those are the policy file and the stub
   that imports it (`injected`) and the routing doc (`policyReads`, lead-only).

   It is marked `placeholder`, which the gate prints on every run, and it has to
   be: the bytes were taken before a single token in those files was filled in, so
   these are the ceilings of a starter file and not of anyone's instructions. The
   derived total is computed the way measure-context.js computes it; its `shape`
   check fails the fixture if the two ever disagree, so a slip here is red on the
   first run rather than a wrong number that stays. */
const ceilingFor = (bytes) => Math.max(256, Math.ceil((bytes * 1.1) / 256) * 256);
const GENERATED_DEFAULT = { baseBytes: 256, bytesPerRow: 256, maxRows: 6 };
/* The instruction files init renders, as { template (under templates/), dest }. The policy
   file and the routing doc are NAMED by the scripts that own those names, never respelled here:
   tools.js holds the one policy file, config.js the routing doc's place under the docs root,
   and the stub is the default tool's, read off its registry row (STUB_FILE, at the top). */
const instructionFiles = (docsRoot, enabled) => {
  const routing = CONFIG.routingDoc({ project: { docsRoot: docsRoot } });
  const stub = stubFileFor(enabled);
  return {
    policy: TOOLS.POLICY_FILE,
    stub: stub,
    routing: routing,
    render: [
      { template: TOOLS.POLICY_FILE, dest: TOOLS.POLICY_FILE },
    ].concat(stub ? [{ template: stub, dest: stub }] : [], [
      { template: 'docs/' + CONFIG.ROUTING_DOC, dest: routing },
    ]),
  };
};
function starterBudget(text, sizes, names) {
  const N = names || instructionFiles(CONFIG.DEFAULTS.project.docsRoot);
  const src = (() => { try { return JSON.parse(text) || {}; } catch { return {}; } })();
  const prose = Array.isArray(src._readme) ? src._readme.slice() : [];
  // The package's worked figures are about the package's files. Everything above
  // that paragraph is the rule and travels; the working does not.
  const cut = prose.findIndex((l) => /^THE FIGURES BELOW/.test(String(l)));
  const kept = cut >= 0 ? prose.slice(0, cut) : prose;
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  // The package's own allowance for the generated registry block, whichever file holds it there.
  const spec = Object.values(src.generated || {})[0] || GENERATED_DEFAULT;
  const gen = { baseBytes: spec.baseBytes, bytesPerRow: spec.bytesPerRow, maxRows: spec.maxRows };
  const policy = ceilingFor(sizes[N.policy] || 0);
  const stub = N.stub ? ceilingFor(sizes[N.stub] || 0) : 0;
  const routing = ceilingFor(sizes[N.routing] || 0);
  const tok = (b) => Math.round(b / 4);
  const out = {
    _readme: kept.concat(kept.length ? [''] : [], [
      'WRITTEN BY `harness init`, AND MARKED `placeholder` FOR THAT REASON. The ceilings below are the',
      'bytes of ' + N.policy + ' (' + (sizes[N.policy] || 0) + ' B), ' + (N.stub ? 'its stub ' + N.stub + ' (' + (sizes[N.stub] || 0) + ' B) ' : '') + 'and ' + N.routing,
      '(' + (sizes[N.routing] || 0) + ' B) as they stood when init ran, + 10%, rounded up to the next 256 B. That was',
      'before anyone filled in a placeholder token, so they are the ceilings of a starter file. The',
      'gate prints a `!` line on every run while the flag is set, and a pass under it means little.',
      'TO MAKE IT REAL: once the files say what this repo is, replace each figure with measured',
      'bytes + 10% rounded up, recompute totalTokenCeiling (`node scripts/harness/measure-context.js',
      '--self-test` prints the derived figure), and delete `placeholder` in the same commit.',
      'An ' + N.policy + ' in a subdirectory needs a row under `nestedOnTouch` the day it is tracked: the',
      'gate fails coverage until it has one, which is the rule working and not a fault.',
    ]),
    placeholder: true,
    unit: src.unit || 'bytes',
    ceilings: { injected: Object.assign({ [N.policy]: policy }, N.stub ? { [N.stub]: stub } : {}), nestedOnTouch: {}, policyReads: { [N.routing]: routing } },
    generated: { ['policyReads/' + N.routing]: gen },
    totalTokenCeiling: tok(policy) + tok(stub) + tok(routing + gen.baseBytes + gen.bytesPerRow * gen.maxRows),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

function gitignoreText(guarded) {
  const lines = ['# Written by `harness init`. `harness doctor` probes each of these with git check-ignore,',
    '# so rephrase them freely as long as the same paths stay ignored.'];
  // The reason goes on its OWN line. An ignore file has no trailing comments: `path  # why`
  // is a pattern containing a hash, which matches nothing and ignores nothing.
  for (const r of requiredIgnores(guarded)) lines.push('# ' + r.why, r.pattern);
  return lines.join('\n') + '\n';
}

/* ============================================================
   THE INSTALL PLAN — a list of { dest, content | from, note }.
   Built whole BEFORE anything is written, for two reasons: `--dry-run` prints
   exactly what a real run would do because it IS the same list, and a package
   that is missing a piece is refused up front rather than leaving a target
   with half a harness and hooks pointing at helpers that never arrived.
   ============================================================ */
function buildPlan(pkgRoot, target, d) {
  const items = [];
  const absent = [];
  const copy = (srcRel, destRel, note) => {
    const from = path.join(pkgRoot, ...srcRel.split('/'));
    if (!isFile(from)) { absent.push(srcRel); return; }
    items.push({ dest: destRel || srcRel, from: from, note: note });
  };
  const copyDir = (srcRel, filter) => {
    const base = path.join(pkgRoot, ...srcRel.split('/'));
    const files = walk(base).filter((f) => !filter || filter(path.basename(f), f));
    if (!files.length) { absent.push(srcRel + '/'); return; }
    for (const f of files) items.push({ dest: posix(path.relative(pkgRoot, f)), from: f });
  };

  const enabled = d.enabled || DEFAULT_ENABLED;
  const rows = TOOLS.enabledRows(REGISTRY, enabled);
  /* MERGES, keyed by destination so two of them into one file (a tool that keeps its hooks and
     its policy setting in the same settings file) are one item and one write. Each step takes the
     file's text, or null when there is none, and answers { text } or { refuse }. */
  const merges = new Map();
  const merge = (dest, step, note, seedFrom) => {
    if (!merges.has(dest)) merges.set(dest, { dest: dest, steps: [], notes: [], seedFrom: seedFrom });
    const m = merges.get(dest);
    m.steps.push(step);
    if (note && !m.notes.includes(note)) m.notes.push(note);
  };

  // THE HOOK CONFIG of each enabled tool, where the registry row and its dialect say how.
  for (const row of rows) {
    const w = WIRE().wiringFor(row, dialectOf(row));
    if (!w || WIRE().unwiredReason(row, dialectOf(row))) continue;
    let seedFrom;
    if (row.hookConfig === SHIPPED_HOOK_CONFIG.file) {
      // The shipped file is the starting text: it carries the comments, the status line and the
      // deny list no registry row describes. The merge then finds its registrations already there.
      seedFrom = path.join(pkgRoot, ...row.hookConfig.split('/'));
      if (!isFile(seedFrom)) { absent.push(row.hookConfig); continue; }
    }
    merge(row.hookConfig, (text) => WIRE().mergeHooks(text, row, w), 'registers the hook entry as `' + row.id + '` (' + w.evidence + ')', seedFrom);
  }
  // Helpers: the code, never a dotfile or a state file a hook left behind.
  if (usesShippedHookConfig(enabled)) copyDir(SHIPPED_HOOK_CONFIG.helpers, (name) => /\.(c|m)?js$/.test(name));
  for (const a of SHIPPED_AGENTS) copy('.claude/agents/' + a);

  // THE POLICY POINTER of a tool that is pointed at the policy file by a setting. A pointer and
  // never a second body: the setting gains one file name.
  for (const row of rows) {
    const p = row.policy;
    if (!p || p.mode !== 'config') continue;
    if (WIRE().isJsonFile(p.file)) merge(p.file, (text) => WIRE().mergePointer(text, row, TOOLS.POLICY_FILE), '`' + p.setting + '` names ' + TOOLS.POLICY_FILE + ' for `' + row.id + '`');
    // A settings file in a format this cannot merge is written only when there is none.
    else items.push({ dest: p.file, content: WIRE().pointerLine(row, TOOLS.POLICY_FILE) + '\n', note: 'points `' + row.id + '` at ' + TOOLS.POLICY_FILE + '; if the file exists, add that line yourself' });
  }

  // THE SKILLS, once per root an enabled tool loads from: copied to the root they are written
  // for, rendered to any other. A rendered copy is pinned in the lock so the gate can hold it to
  // its source (scripts/harness/guards/skill-verify.cjs, RENDER-DRIFT).
  const renderedLock = {};
  for (const root of TOOLS.skillRoots(REGISTRY, enabled)) {
    for (const s of SHIPPED_SKILLS) {
      if (root === SKILL_SOURCE) { copyDir(SKILL_SOURCE + '/' + s); continue; }
      const map = SKILLS().renderSkillFiles(path.join(pkgRoot, ...SKILL_SOURCE.split('/'), s));
      if (!map || !Object.keys(map).length) { absent.push(SKILL_SOURCE + '/' + s + '/'); continue; }
      for (const rel of Object.keys(map).sort()) items.push({ dest: root + '/' + s + '/' + rel, content: map[rel], note: 'rendered from ' + SKILL_SOURCE + '/' + s + ', portable frontmatter only' });
      // One name, one entry: the lock is keyed by skill name, so a second rendered root would
      // need a second key. No registry row names one today.
      if (!renderedLock[s]) renderedLock[s] = SKILLS().renderedLockEntry(SKILL_SOURCE + '/' + s, root + '/' + s, map);
    }
  }
  // The three figure files are WRITTEN for the target, never copied (see emptyBaseline,
  // emptyReport, starterBudget): each holds numbers measured on the tree it sits in.
  const FIGURES = ['gates.baseline.json', 'context-budget.json', 'harness-baseline.json'];
  // The guards are their OWN required piece, under the same code-only rule as the helpers:
  // the sibling scripts alone would satisfy the copy below, and a package with no guards
  // would install hooks pointing at files that never arrived.
  const guardsBase = path.join(pkgRoot, 'scripts', 'harness', 'guards') + path.sep;
  copyDir('scripts/harness/guards', (name) => /\.(c|m)?js$/.test(name));
  copyDir('scripts/harness', (name, full) => !full.startsWith(guardsBase) && !RUN_OUTPUT.some((re) => re.test(name)) && !FIGURES.includes(name));
  items.push({ dest: 'scripts/harness/gates.baseline.json', content: emptyBaseline(), note: 'empty — no figure is inherited; re-baseline with --accept' });
  items.push({ dest: 'scripts/harness/harness-baseline.json', content: emptyReport(), note: 'empty — no measurement is inherited; measure-context.js writes it' });
  copy('schema/harness.config.schema.json');
  for (const t of TRACK_TEMPLATES) copy('templates/track/' + t);

  const cfg = buildConfig(d);
  items.push({ dest: CONFIG_NAME, content: JSON.stringify(cfg, null, 2) + '\n', note: 'generated from what was detected' });
  if (!Object.keys(renderedLock).length) {
    items.push({ dest: 'skills-lock.json', content: JSON.stringify({ version: 2, skills: {} }, null, 2) + '\n', note: 'empty — a lock inherited from another machine pins another machine\'s review' });
  } else {
    // A lock that exists is the user's: an entry is ADDED for a rendered copy that has none, and
    // no entry already there is touched. A stale one is the gate's to report, after a read.
    merge('skills-lock.json', (text) => {
      let lock = { version: 2, skills: {} };
      if (text !== null) {
        try { lock = JSON.parse(text); } catch (e) { return { refuse: 'it is not valid JSON (' + e.message + ')' }; }
        if (!lock || Array.isArray(lock) || typeof lock !== 'object') return { refuse: 'it is not a lock: expected { "version": 2, "skills": { ... } }' };
        if (lock.skills === undefined) lock.skills = {};
        if (!lock.skills || Array.isArray(lock.skills) || typeof lock.skills !== 'object') return { refuse: '`skills` is not an object' };
      }
      const missing = Object.keys(renderedLock).filter((n) => !(n in lock.skills));
      if (text !== null && !missing.length) return { text: text, changed: false };
      for (const n of missing) lock.skills[n] = renderedLock[n];
      return { text: JSON.stringify(lock, null, 2) + '\n', changed: true };
    }, 'pins the rendered skill copies to their source; nothing else is inherited');
  }
  items.push({ dest: '.gitignore', content: gitignoreText(cfg.env.guarded), note: 'the ignore rules the harness depends on' });
  for (const m of merges.values()) {
    items.push({ dest: m.dest, seedFrom: m.seedFrom, note: m.notes.join('; '),
      merge: (text) => {
        let cur = text;
        for (const step of m.steps) {
          const r = step(cur);
          if (r.refuse) return r;
          cur = r.text;
        }
        return { text: cur };
      } });
  }

  const unrendered = [];
  const sizes = {};
  const names = instructionFiles(d.docsRoot, d.enabled);
  for (const { template, dest: name } of names.render) {
    const text = readText(path.join(pkgRoot, 'templates', ...template.split('/')));
    if (text === null) { absent.push('templates/' + template); continue; }
    const r = render(text, d);
    for (const u of r.unknown) unrendered.push(name + ': ' + u);
    items.push({ dest: name, content: r.text, note: name === names.stub ? 'a pointer: it imports ' + names.policy + ' and holds no rule' : 'rendered for `' + d.name + '`' });
    // The LARGER of what init would write and what is already there: a file a human
    // wrote is kept without --force and replaced with it, and the budget has to hold
    // either way. Line endings normalised, as the measurement does.
    const mine = readText(path.join(target, ...name.split('/')));
    sizes[name] = Math.max(Buffer.byteLength(lf(r.text), 'utf8'), mine === null ? 0 : Buffer.byteLength(lf(mine), 'utf8'));
  }
  const budget = readText(path.join(pkgRoot, 'scripts', 'harness', 'context-budget.json'));
  items.push({ dest: 'scripts/harness/context-budget.json', content: starterBudget(budget || '{}', sizes, names),
    note: 'placeholder ceilings for ' + [names.policy].concat(names.stub ? [names.stub] : []).join(', ') + ' and the routing doc as written — no figure is inherited' });
  return { items: items, absent: absent, unrendered: unrendered, target: target, config: cfg };
}

/** Apply (or, dry, only describe) a plan. Returns what happened to every item, so the
 *  caller prints from the RESULT and never from the intention. */
const inScope = (it, opts) => !opts.only || it.dest === opts.only || it.dest.startsWith(opts.only.replace(/\/?$/, '/'));
/** What a MERGE item would leave in its file: { body } or { refuse }. The text it starts from
 *  is the file as it stands; with none there, or under --force on a file the package ships, it
 *  is the package's own copy (the seed), and otherwise nothing. Reads only. */
function mergeResult(it, dest, opts) {
  const seed = () => (it.seedFrom ? readText(it.seedFrom) : null);
  const there = exists(dest);
  const start = there && !(opts.force && it.seedFrom) ? readText(dest) : seed();
  if (there && start === null && !it.seedFrom) return { refuse: 'it could not be read' };
  const r = it.merge(start);
  return r.refuse ? r : { body: Buffer.from(r.text, 'utf8') };
}
/** Every merge this run would refuse, as { dest, why }. Asked BEFORE anything is written: a
 *  config file init cannot parse stops the whole run, so a target is never left half wired. */
function planRefusals(plan, opts) {
  const out = [];
  for (const it of plan.items) {
    if (!it.merge || !inScope(it, opts)) continue;
    const r = mergeResult(it, path.join(plan.target, ...it.dest.split('/')), opts);
    if (r.refuse) out.push({ dest: it.dest, why: r.refuse });
  }
  return out;
}

function applyPlan(plan, opts) {
  const res = { wrote: [], overwrote: [], merged: [], skipped: [], kept: [], refused: [] };
  for (const it of plan.items) {
    if (!inScope(it, opts)) continue;
    const dest = path.join(plan.target, ...it.dest.split('/'));
    const there = exists(dest);
    if (it.merge) {
      // A merge is not an overwrite, so it runs without --force: it adds what is missing and
      // leaves every other byte. A file with nothing missing is reported as left alone.
      const r = mergeResult(it, dest, opts);
      if (r.refuse) { res.refused.push({ dest: it.dest, why: r.refuse }); continue; }
      if (there && Buffer.compare(fs.readFileSync(dest), r.body) === 0) { (opts.force ? res.kept : res.skipped).push(it); continue; }
      if (!opts.dry) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, r.body);
      }
      (!there ? res.wrote : opts.force && it.seedFrom ? res.overwrote : res.merged).push(it);
      continue;
    }
    if (there && !opts.force) { res.skipped.push(it); continue; }
    const body = it.content !== undefined ? (Buffer.isBuffer(it.content) ? it.content : Buffer.from(it.content, 'utf8')) : fs.readFileSync(it.from);
    // --force on a file that already holds these bytes is not a write. Saying
    // "overwrote" would send the reader to a diff that is empty.
    if (there && Buffer.compare(fs.readFileSync(dest), body) === 0) { res.kept.push(it); continue; }
    if (!opts.dry) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
    }
    (there ? res.overwrote : res.wrote).push(it);
  }
  return res;
}

// How this CLI was reached, so the commands it prints are ones that will run.
function selfInvocation(target) {
  const here = posix(path.resolve(__filename));
  if (here.includes('/node_modules/')) return 'npx harness';
  // Relative while that is short; a path that climbs out through a row of `..`
  // is harder to read and to paste than the real one.
  const rel = posix(path.relative(target, __filename));
  const shown = rel.startsWith('../../') || path.isAbsolute(rel) ? posix(path.resolve(__filename)) : rel;
  return 'node ' + (shown.includes(' ') ? '"' + shown + '"' : shown);
}

// The skips a repo's own config makes inevitable. Today that is exactly one:
// an empty `artifacts` list makes the reproducible-build check declare skipped=1.
function configSkips(cfg) {
  const a = cfg && cfg.artifacts;
  const n = Array.isArray(a) ? a.length : a && Array.isArray(a.files) ? a.files.length : 0;
  return n === 0 ? { 'reproducible-build': 1 } : {};
}
/** THE DECLARED SKIPS, and nothing else. Two sources, both committed and both a
 *  human decision: the config (see configSkips) and the baseline, where a row with
 *  skipped>0 exists only because someone ran `--accept --allow-skip` for it. What is
 *  deliberately NOT here is anything read off the environment: a skip tolerated
 *  because a tool happened to be absent on this box is the pass-by-absence the
 *  gate protocol exists to end. */
function declaredSkips(cfg, baseline) {
  const out = configSkips(cfg);
  for (const [name, row] of Object.entries((baseline && baseline.gates) || {})) {
    if (row && row.skipped > 0) out[name] = Math.max(out[name] || 0, row.skipped);
  }
  return out;
}
const skipArg = (m) => Object.keys(m).sort().map((k) => k + '=' + m[k]).join(',');

/** Why `init` will not run with these arguments, or null. Pure, so the self-test
 *  drives it with literals. */
/** Why this list of tool ids cannot be enabled, or null. Every id is held to the registry: an
 *  unknown one lists the valid ones, and the registry's own refusals (a model with nothing to
 *  wire, a tool whose native file is not the policy file) are passed on in its words. */
function toolsArgError(ids, reg) {
  const R = reg || REGISTRY;
  const valid = TOOLS.enabledRows(R, (R.tools || []).map((r) => r && r.id)).map((r) => r.id);
  if (!ids.length) return '--tools needs at least one tool id (valid: ' + valid.join(', ') + ')';
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length) return 'tool id `' + twice[0] + '` is named twice';
  const unknown = ids.filter((id) => !valid.includes(id));
  if (unknown.length) return 'unknown tool id ' + unknown.map((u) => '`' + u + '`').join(', ') + ' (valid: ' + valid.join(', ') + ')';
  const found = TOOLS.enabledFindings(R, ids);
  return found.length ? found[0] : null;
}
const INIT_USAGE = 'harness init [--into <dir>] [--tools <id>[,<id>]] [--git-hooks] [--force] [--dry-run] [--only <path-prefix>]';

/** The GIT HOOKS block init prints, from what the plan found. Pure: `p` is githooks.plan()'s answer. */
function gitHookLines(p, o) {
  const G = GITHOOKS();
  const out = [''];
  const tail = 'a backstop, not a deny: it runs after the work, at commit or push time';
  if (p.refuse) {
    out.push('GIT HOOKS — ' + (o.asked ? 'NOT WRITTEN' : 'not installed') + ': ' + p.refuse + '.');
    for (const h of G.HOOKS) out.push('  ' + h.name.padEnd(10) + '  by hand, where your hooks live:   ' + G.commandOf(h.name, o.skips || '') + ' || exit 1');
    return out;
  }
  if (!o.asked) {
    out.push('GIT HOOKS — not installed. They are opt-in: `' + o.me + ' init ' + G.FLAG + '` writes the two below and never replaces a hook that exists.');
    for (const h of p.hooks) out.push('  ' + h.name.padEnd(10) + '  ' + h.command + (h.action === 'present' || h.action === 'same' ? '   (already standing)' : ''));
    out.push('  ' + tail);
    return out;
  }
  out.push('GIT HOOKS' + (o.dry ? ' (DRY RUN)' : '') + ' — ' + tail + '.');
  const said = {
    write: o.dry ? 'WOULD WRITE' : 'WROTE',
    same: 'UNCHANGED (already identical)',
    present: 'LEFT ALONE — your hook already runs it',
    kept: 'LEFT ALONE — a hook is already there and is yours; add this line to it yourself',
  };
  for (const h of p.hooks) out.push('  ' + said[h.action] + '   .git/hooks/' + h.name + '   ' + h.command + (h.action === 'kept' ? ' || exit 1' : ''));
  return out;
}

function initArgError(argv) {
  const VALUED = ['--into', '--only', '--tools'];
  const BARE = ['--force', '--dry-run', GITHOOKS().FLAG];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (VALUED.includes(a)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) return a + ' needs a value';
      i += 1;
    } else if (!BARE.includes(a)) {
      return (a.startsWith('-') ? 'unknown flag `' : 'unexpected argument `') + a + '`';
    }
  }
  return null;
}

function cmdInit(argv) {
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  // A flag this command does not know is REFUSED, not ignored. `--dryrun` read as
  // nothing is a real install the caller believed was a rehearsal, and `--into`
  // with its value missing falls back to the current directory — the one place
  // the caller just said they did not mean.
  const bad = initArgError(argv);
  if (bad) return stop(bad, INIT_USAGE);
  const target = path.resolve(val('--into') || process.cwd());
  const opts = { force: argv.includes('--force'), dry: argv.includes('--dry-run'), only: val('--only') };
  if (!isDir(target)) return stop('no directory at ' + target, 'mkdir it first, or pass --into <an existing repo>');
  if (path.resolve(target) === PKG_ROOT) {
    return stop('the target is the harness package itself', 'run it from the repo you are installing into, or pass --into <dir>');
  }

  /* WHICH TOOLS. `--tools` names them; with no flag, a config already in the target does; with
     neither, the loader's default is in force and is not written down. The machine is never
     asked what is installed on it: a repo is wired for the tools its config names. */
  const d = detect(target);
  const asked = argv.includes('--tools') ? String(val('--tools')).split(',').map((x) => x.trim()).filter(Boolean) : null;
  const had = readJson(path.join(target, CONFIG_NAME));
  const stated = had && had.tools && Array.isArray(had.tools.enabled) ? had.tools.enabled.map(String) : null;
  if (asked) {
    const why = toolsArgError(asked);
    if (why) return stop(why, '`node scripts/harness/tools.js --list` prints every id with its tier and evidence');
    const now = stated || DEFAULT_ENABLED;
    if (isFile(path.join(target, CONFIG_NAME)) && !opts.force && JSON.stringify(now) !== JSON.stringify(asked)) {
      return stop(CONFIG_NAME + ' is already there and enables ' + now.join(', ') + ', not ' + asked.join(', '),
        'init never rewrites your config: set "tools": { "enabled": ' + JSON.stringify(asked) + ' } in ' + CONFIG_NAME + ', then run init again with no --tools');
    }
    d.enabled = asked;
  } else if (stated) {
    const why = toolsArgError(stated);
    if (why) return stop('tools.enabled in ' + CONFIG_NAME + ': ' + why, 'node scripts/harness/tools.js --check');
    d.enabled = stated;
  }

  const plan = buildPlan(PKG_ROOT, target, d);
  if (plan.absent.length) {
    for (const a of plan.absent) console.error('ABSENT FROM PACKAGE  ' + a);
    return stop('this copy of agent-harness is incomplete (' + plan.absent.length + ' piece(s) above), so nothing was written',
      'reinstall the package — a half-installed harness has hooks pointing at helpers that never arrived');
  }
  const refused = planRefusals(plan, opts);
  if (refused.length) {
    for (const r of refused) console.error('CANNOT MERGE INTO  ' + r.dest + '   — ' + r.why);
    return stop('init merges into a config file and never overwrites one, and ' + refused.length + ' file(s) above cannot be read as one, so nothing was written',
      'repair ' + refused.map((r) => r.dest).join(', ') + ' (or move it aside), then run init again');
  }

  console.log('harness init -> ' + target + (opts.dry ? '   (DRY RUN: nothing is written)' : ''));
  console.log('\nDETECTED');
  console.log('  project name      ' + d.name + '   <- ' + d.evidence.name);
  console.log('  package manager   ' + (d.packageManager || 'none') + '   <- ' + d.evidence.packageManager);
  console.log('  test command      ' + (d.test ? d.test.command + '   [' + d.test.adapter + ']' : 'NONE') + '   <- ' + d.evidence.test);
  console.log('  docs root         ' + d.docsRoot + '   <- ' + d.evidence.docsRoot);
  console.log('  default branch    ' + d.defaultBranch + '   <- ' + d.evidence.defaultBranch);

  // What each enabled tool gets, and what it does not. Evidence is printed as the row states it.
  const on = d.enabled || DEFAULT_ENABLED;
  console.log('\nTOOLS   <- ' + (asked ? '--tools' : stated ? 'tools.enabled in ' + CONFIG_NAME : 'the default (no --tools, no config yet)'));
  for (const line of toolLines(on)) console.log('  ' + line);

  const res = applyPlan(plan, opts);
  const show = (label, list) => {
    if (!list.length) return;
    console.log('\n' + label + ' (' + list.length + ')');
    for (const it of list) console.log('  ' + it.dest + (it.note ? '   — ' + it.note : ''));
  };
  show(opts.dry ? 'WOULD WRITE' : 'WROTE', res.wrote);
  show(opts.dry ? 'WOULD OVERWRITE (--force)' : 'OVERWROTE (--force)', res.overwrote);
  show(opts.dry ? 'WOULD MERGE INTO — adds what is missing, every other key is left as it is' : 'MERGED INTO — added what was missing, every other key is as it was', res.merged);
  show('UNCHANGED (already identical)', res.kept);
  show('SKIPPED — exists, not overwritten (pass --force, or --force --only <path> for one)', res.skipped);
  if (!res.wrote.length && !res.overwrote.length && !res.merged.length) console.log('\nNothing to write: every file is already there.');

  /* THE GIT-HOOK BACKSTOP. The hook directory is the user's, so nothing is written there unless
     the caller asked, a hook that exists is never replaced, and a repo that keeps its hooks
     somewhere of its own is left alone and told why. Asked or not, the commands are printed. */
  const hookSkips = skipArg(configSkips(had || plan.config));
  const hooks = GITHOOKS().install(target, { dry: opts.dry || !argv.includes(GITHOOKS().FLAG), skips: hookSkips });
  for (const line of gitHookLines(hooks, { asked: argv.includes(GITHOOKS().FLAG), dry: opts.dry, me: selfInvocation(target), skips: hookSkips })) console.log(line);

  // Only for a file this run actually (or, dry, would have) produced: a skipped
  // AGENTS.md is the human's own, and its contents are not this plan's to describe.
  const produced = new Set(res.wrote.concat(res.overwrote).map((it) => it.dest));
  const toFill = plan.unrendered.filter((u) => produced.has(u.split(': ')[0]));
  if (toFill.length) {
    console.log('\nLEFT FOR YOU TO FILL (' + toFill.length + ') — init cannot detect these, so the token stays visible:');
    for (const u of toFill) console.log('  ' + u);
  }
  if (!d.test) {
    console.log('\n! NO TEST GATE. No test command was detected, and the harness will not invent one.');
    console.log('  fix: add { "name": "test", "command": "<your test command>", "adapter": "exit-code" } to ' + CONFIG_NAME);
  }

  // An existing .gitignore is never edited, so its gaps are named instead.
  if (res.skipped.some((it) => it.dest === '.gitignore')) {
    const missing = ignoreGaps(target, plan.config.env.guarded);
    if (missing === null) console.log('\n! .gitignore exists and was left alone; `doctor` will probe it once this is a git repository.');
    else for (const r of missing) console.log('\n! NOT IGNORED  ' + r.probe + ' (' + r.why + ')\n  fix: echo "' + r.pattern + '" >> .gitignore');
  }

  const me = selfInvocation(target);
  const skips = skipArg(configSkips(plan.config));
  const names = instructionFiles(d.docsRoot, d.enabled);
  console.log('\nNEXT — four commands, in this order:');
  console.log('  1. ' + me + ' doctor');
  console.log('       every installed piece, OK / MISSING / DRIFTED, each with its fix');
  console.log('  2. node scripts/harness/docs-index.js && node scripts/harness/docs-index.js --agents');
  console.log('       writes ' + d.docsRoot + '/INDEX.md, the map ' + names.policy + ' points at, and fills the agent registry in');
  console.log('       ' + names.routing + ' from .claude/agents/ — init writes neither, and');
  console.log('       `node scripts/harness/docs-index.js --check` is red until both have run');
  console.log('  3. node scripts/harness/gates.js --check --allow-skip ' + skips);
  console.log('       the suite as configured; fix what is red before the next step');
  console.log('       `git add` what init wrote BEFORE this: the context gate grades only what git tracks,');
  console.log('       and reds on coverage for a budgeted file it was never shown (that is the rule working)');
  console.log('       a gate that could not make one of its checks reports skipped>0 and prints why (the doc');
  console.log('       gate does, on a machine that holds no memory index for this repo). Read the reason, then');
  console.log('       tolerate it by name: add ,<gate>=<n> to --allow-skip here AND in step 4');
  console.log('  4. node scripts/harness/gates.js --accept --allow-skip ' + skips);
  console.log('       record the baseline, then commit it with a subject starting `gates:`');
  return 0;
}

/* ============================================================
   DOCTOR — is the installed harness whole, and is it still the harness?
   Three verdicts per item, and they mean different things to the reader:
     OK        present and behaving
     MISSING   not there at all            -> usually `harness init` puts it back
     DRIFTED   there, but not what the harness requires: a helper whose
               self-test fails, a doc over its cap, a copy that differs from
               the package it was installed from
   The exit code is the verdict. A doctor that prints findings and exits 0 is a
   doctor nobody can put in a script.
   ============================================================ */
function ignoreGaps(root, guarded) {
  if (git(root, ['rev-parse', '--git-dir']) === null) return null;
  return requiredIgnores(guarded).filter((r) => {
    // --no-index: ask about the PATTERNS, not the index, so a path that is already
    // tracked (and therefore not ignored in effect) still reports the rule that covers it.
    const res = spawnSync('git', ['check-ignore', '--no-index', '-q', r.probe], { cwd: root, windowsHide: true });
    return res.status !== 0;
  });
}

/** Split a shell command the way a reader would: on whitespace, keeping a quoted
 *  run together. Good enough to find the program and the script it names; it is not
 *  a shell and does not pretend to expand anything. */
function tokens(command) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(command))) !== null) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}
function onPath(bin, env) {
  const e = env || process.env;
  const dirs = String(e.PATH || e.Path || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? [''].concat(String(e.PATHEXT || '.EXE;.CMD;.BAT').split(';')) : [''];
  return dirs.some((dir) => exts.some((x) => isFile(path.join(dir, bin + x)) || isFile(path.join(dir, bin + x.toLowerCase()))));
}
const PM_BUILTINS = ['start', 'install', 'ci', 'exec', 'dlx', 'x'];

/** Can this gate's command even start? Answers { ok, why }. This is the check that
 *  turns "the gate printed no GATE line" — which sends the reader into the gate's
 *  source — into "the file the gate names is not there". */
function gateResolvable(gate, root, pkgScripts, has) {
  const t = tokens(gate.command);
  const present = has || onPath;
  if (!t.length) return { ok: false, why: 'an empty command' };
  const prog = t[0];
  if (prog === 'node') {
    const script = t.slice(1).find((x) => !x.startsWith('-'));
    if (!script || /[*?[\]{}]/.test(script)) return { ok: true, why: 'node' + (script ? ' over a glob' : '') };
    return isFile(path.resolve(root, script)) ? { ok: true, why: script } : { ok: false, why: 'no file at ' + script };
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) {
    if (!present(prog)) return { ok: false, why: '`' + prog + '` is not on PATH', absentTool: true };
    const isRunForm = t[1] === 'run' || t[1] === 'run-script';
    const name = isRunForm ? t[2] : t[1];
    if (!name || name.startsWith('-')) return { ok: true, why: prog };
    if (pkgScripts && Object.prototype.hasOwnProperty.call(pkgScripts, name)) return { ok: true, why: prog + ' script `' + name + '`' };
    if (!isRunForm && PM_BUILTINS.includes(name)) return { ok: true, why: prog + ' ' + name };
    return { ok: false, why: 'package.json has no `' + name + '` script' };
  }
  if (prog.includes('/') || prog.includes('\\') || prog.startsWith('.')) {
    return isFile(path.resolve(root, prog)) ? { ok: true, why: prog } : { ok: false, why: 'no file at ' + prog };
  }
  return present(prog) ? { ok: true, why: prog + ' on PATH' } : { ok: false, why: '`' + prog + '` is not on PATH', absentTool: true };
}

/** Every script a hook command names, as absolute paths. The runtime exports the
 *  repo as CLAUDE_PROJECT_DIR, and a hook is written against that variable because
 *  its cwd is wherever the session happens to be — so the variable is resolved here
 *  the way the runtime would. */
function hookScripts(command, root) {
  const expanded = String(command)
    .replace(/\$\{CLAUDE_PROJECT_DIR(?::-[^}]*)?\}/g, root)
    .replace(/\$CLAUDE_PROJECT_DIR\b/g, root)
    .replace(/%CLAUDE_PROJECT_DIR%/g, root);
  return tokens(expanded)
    .filter((x) => /\.(c|m)?js$|\.sh$|\.py$|\.ps1$/.test(x))
    .map((x) => (path.isAbsolute(x) ? path.normalize(x) : path.resolve(root, x)));
}
/** The files a hook script loads by a literal relative path, as absolute paths. */
function hookLoads(text, from) {
  const out = [];
  for (const m of String(text || '').matchAll(/\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) {
    const abs = path.resolve(path.dirname(from), ...m[2].split('/'));
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}
function hookCommands(settings) {
  const out = [];
  const visit = (node, where) => {
    if (Array.isArray(node)) { node.forEach((n, i) => visit(n, where + '[' + i + ']')); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.command === 'string') out.push({ where: where, command: node.command });
    for (const k of Object.keys(node)) if (k !== 'command') visit(node[k], where ? where + '.' + k : k);
  };
  visit({ hooks: (settings || {}).hooks, statusLine: (settings || {}).statusLine }, '');
  return out;
}

const hasFrontmatter = (text) => {
  const t = lf(text).replace(/^﻿/, '');
  return t.startsWith('---\n') && t.indexOf('\n---', 3) > 0;
};
// A trailing newline ends the last line; it does not start another one.
const lineCount = (text) => { const t = lf(text); return t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0); };

function selfTestable(root, dirs) {
  const out = [];
  for (const dir of dirs) {
    for (const f of walk(path.join(root, ...dir.split('/')), (full, e) => e.isDirectory() && e.name === 'node_modules')) {
      if (!/\.(c|m)?js$/.test(f)) continue;
      // The flag has to be HANDLED, not merely mentioned in a comment about some
      // other file, so the match is on the quoted literal a script compares against.
      if (/['"`]--self-test['"`]/.test(readText(f) || '')) out.push(f);
    }
  }
  return out;
}
function runSelfTest(file, cwd) {
  // NODE_TEST_CONTEXT is scrubbed for the reason gates.js gives: under `node --test`
  // a child inherits it and a script that spawns its own runner prints no summary.
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [file, '--self-test'], { cwd: cwd, encoding: 'utf8', env: env, windowsHide: true, timeout: 300000 });
  const tail = String((r.stdout || '') + (r.stderr || '')).trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  return { ok: r.status === 0, status: r.status, tail: tail.trim() };
}

const evidenceText = (row) => (row.evidence === 'ran' ? 'ran (' + row.command + ')' : 'docs (NOT verified: read from vendor pages; the registry row says what, if anything, was run)');
/** What the harness wires for one row: `{ wiring }` when it renders a hook config for it, or
 *  `{ why }`, the one sentence saying why it does not. Read off the row and its dialect. */
function toolWiring(row) {
  const dialect = dialectOf(row);
  const why = WIRE().unwiredReason(row, dialect);
  return why ? { wiring: null, why: why } : { wiring: WIRE().wiringFor(row, dialect), why: null };
}
/** The TOOLS block init prints: one line per enabled tool, then what it does not get. */
function toolLines(enabled) {
  const out = [];
  for (const row of TOOLS.enabledRows(REGISTRY, enabled)) {
    out.push(row.id + '   tier ' + row.tier + ', evidence ' + evidenceText(row));
    const t = toolWiring(row);
    if (t.wiring) {
      out.push('    hooks: ' + row.hookConfig + ' registers the one hook entry as `' + row.id + '`');
      for (const g of t.wiring.gaps || []) out.push('    ! ' + g);
    } else {
      out.push('    ! NO HOOK IS WIRED: ' + t.why + '. Every rule is prose under this tool.');
    }
    if (row.sessionStart !== true && typeof row.dialect === 'string') out.push('    ! no session-start event: the session reports never run under it');
  }
  out.push('`doctor` repeats this for each tool, with every wire that is missing.');
  return out;
}

function doctor(root, opts) {
  const o = opts || {};
  const pkgRoot = o.pkgRoot || PKG_ROOT;
  const rows = [];
  const add = (status, item, detail, fix) => rows.push({ status: status, item: item, detail: detail || '', fix: fix || '' });
  const rel = (f) => posix(path.relative(root, f));
  const me = o.invocation || selfInvocation(root);
  const samePkg = path.resolve(root) === path.resolve(pkgRoot);

  // 1. THE CONFIG. Through config.js and nothing else.
  let cfg = null;
  if (!isFile(path.join(root, CONFIG_NAME))) add('MISSING', CONFIG_NAME, 'the harness has no default suite and stops without it', me + ' init');
  else {
    try {
      cfg = CONFIG.load({ root: root, fresh: true });
      add('OK', CONFIG_NAME, cfg.gates.length + ' gate(s): ' + cfg.gates.map((g) => g.name).join(' '));
    } catch (e) {
      add('DRIFTED', CONFIG_NAME, e.message, e.fix || 'node scripts/harness/config.js');
    }
  }

  // 2. EVERY GATE COMMAND RESOLVABLE.
  if (cfg) {
    const scripts = (readJson(path.join(root, 'package.json')) || {}).scripts || {};
    for (const g of cfg.gates) {
      const r = gateResolvable(g, root, scripts, o.has);
      if (r.ok) add('OK', 'gate ' + g.name, r.why);
      // `optional` covers an ABSENT TOOL and only that. A missing script file is
      // a broken install whatever the flag says.
      else if (g.optional && r.absentTool) add('OK', 'gate ' + g.name, r.why + ' — declared optional, so it will report skipped=1 (tolerate with --allow-skip ' + g.name + '=1)');
      else add('MISSING', 'gate ' + g.name, r.why + '   [' + g.command + ']',
        /^no file at (\.claude|scripts\/harness)\//.test(r.why) ? me + ' init' : 'edit gates.' + g.name + '.command in ' + CONFIG_NAME);
    }
  }

  // 3. EVERY HOOK PATH EXISTING, in the hook config of EVERY ENABLED TOOL the harness wires. A
  //    hook whose script is gone does not fail loudly — the guard it was simply stops guarding,
  //    which is the worst way for a guard to break.
  const enabled = cfg ? cfg.tools.enabled : DEFAULT_ENABLED;
  const toolRows = TOOLS.enabledRows(REGISTRY, enabled);
  const hookFiles = [...new Set(toolRows.filter((r) => toolWiring(r).wiring).map((r) => r.hookConfig))];
  const seen = new Set();
  for (const hookFile of hookFiles) {
    const settingsFile = path.join(root, ...hookFile.split('/'));
    const settings = readJson(settingsFile);
    const shipped = hookFile === SHIPPED_HOOK_CONFIG.file;
    if (!isFile(settingsFile)) { add('MISSING', hookFile, 'no hooks are registered, so no guard runs', me + ' init'); continue; }
    if (!settings) { add('DRIFTED', hookFile, 'not valid JSON, so the runtime loads no hook from it', shipped ? me + ' init --force --only ' + hookFile : 'repair the JSON in ' + hookFile + ', then ' + me + ' init'); continue; }
    const cmds = hookCommands(settings);
    if (!cmds.length) add('DRIFTED', hookFile, 'it registers no hook command at all', shipped ? me + ' init --force --only ' + hookFile : me + ' init');
    for (const c of cmds) {
      for (const s of hookScripts(c.command, root)) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (isFile(s)) add('OK', 'hook ' + rel(s), c.where);
        else add('MISSING', 'hook ' + rel(s), 'registered at ' + c.where + ' and not on disk',
          rel(s).startsWith('..') ? 'edit ' + c.where + ' in ' + hookFile : me + ' init');
        // A REGISTERED SCRIPT IS A ROOT. One entry may be all a tool registers, and the guards
        // are then the files that entry loads: a guard that is gone is still a hook that is gone.
        // One level, and only a relative path written as a literal, which is how an entry names
        // what it runs.
        for (const dep of hookLoads(readText(s), s)) {
          if (seen.has(dep)) continue;
          seen.add(dep);
          if (isFile(dep)) add('OK', 'hook ' + rel(dep), 'loaded by ' + rel(s));
          else add('MISSING', 'hook ' + rel(dep), 'loaded by ' + rel(s) + ' and not on disk', me + ' init');
        }
      }
    }
  }

  // 3b. EACH ENABLED TOOL: its tier, its evidence, and every wire it is missing. A wire init can
  //     put back is MISSING. A wire the tool cannot have, or that nobody has established how to
  //     write, is a NOTE: it is said every run and never counted, because no command fixes it
  //     and a doctor that is red forever is one nobody reads.
  for (const id of enabled) {
    if (!toolRows.some((r) => r.id === id)) add('DRIFTED', 'tool ' + id, 'enabled in ' + CONFIG_NAME + ' and has no row in the tool registry', 'node scripts/harness/tools.js --check');
  }
  for (const row of toolRows) {
    const T = 'tool ' + row.id;
    add('OK', T, 'tier ' + row.tier + ', evidence ' + evidenceText(row));

    const p = row.policy;
    const abs = (r) => path.join(root, ...r.split('/'));
    if (p && p.mode === 'native') {
      if (isFile(abs(p.file))) add('OK', T + ' policy', 'it loads ' + p.file + ' itself');
      else add('MISSING', T + ' policy', 'no ' + p.file + ', the file it loads', me + ' init');
    } else if (p && p.mode === 'import') {
      if (isFile(abs(p.file))) add('OK', T + ' policy', p.file + ' is the pointer to ' + TOOLS.POLICY_FILE);
      else add('MISSING', T + ' policy', 'no ' + p.file + ', the stub that imports ' + TOOLS.POLICY_FILE + ', so it loads no policy', me + ' init');
    } else if (p && p.mode === 'config') {
      const text = readText(abs(p.file));
      const line = WIRE().pointerLine(row, TOOLS.POLICY_FILE);
      if (text === null) add('MISSING', T + ' policy', 'no ' + p.file + ', so nothing points it at ' + TOOLS.POLICY_FILE, me + ' init');
      else if (WIRE().isJsonFile(p.file)) {
        const st = WIRE().pointerState(text, row, TOOLS.POLICY_FILE);
        if (st.why) add('DRIFTED', T + ' policy', p.file + ': ' + st.why, 'repair ' + p.file + ', then ' + me + ' init');
        else if (st.ok) add('OK', T + ' policy', '`' + p.setting + '` in ' + p.file + ' names ' + TOOLS.POLICY_FILE);
        else add('MISSING', T + ' policy', '`' + p.setting + '` in ' + p.file + ' does not name ' + TOOLS.POLICY_FILE, me + ' init');
      } else if (lf(text).split('\n').some((l) => l.trim() === line)) add('OK', T + ' policy', p.file + ' holds `' + line + '`');
      else add('MISSING', T + ' policy', p.file + ' does not hold the line `' + line + '`', 'add that line to ' + p.file + ' — init does not edit a settings file in this format');
    }

    const t = toolWiring(row);
    if (!t.wiring) {
      add('NOTE', T + ' hooks', 'NOT WIRED — ' + t.why + '. Every rule is prose under this tool'
        + (typeof row.dialect === 'string' ? '; the registration, if you add it by hand: ' + WIRE().byHand(row.id, 'pre-tool') : ''));
      if (typeof row.notes === 'string') add('NOTE', T + ' registry notes', row.notes);
    } else {
      const text = readText(abs(row.hookConfig));
      const st = text === null ? null : WIRE().hookState(text, row, t.wiring);
      // A file that is absent or does not parse is already a finding above, under its own name.
      if (st && !st.why) {
        for (const w of st.wanted) {
          if (w.ok) add('OK', T + ' ' + w.where, row.hookConfig + ' registers the hook entry as `' + row.id + '` for ' + w.event + ' (' + t.wiring.evidence + ')');
          else add('MISSING', T + ' ' + w.where, row.hookConfig + ' does not register the hook entry as `' + row.id + '` for ' + w.event, me + ' init');
        }
        const others = toolRows.filter((r) => r.id !== row.id && r.hookConfig === row.hookConfig).map((r) => r.id);
        for (const f of st.foreign.filter((x) => !others.includes(x))) {
          add('DRIFTED', T + ' foreign registration', row.hookConfig + ' runs the hook entry as `' + f + '`, so this tool\'s calls would be read in another tool\'s wire format',
            'edit ' + row.hookConfig + ': the registration must say --tool ' + row.id);
        }
      }
      for (const g of t.wiring.gaps || []) add('NOTE', T + ' gap', g);
    }
    if (row.sessionStart !== true && typeof row.dialect === 'string') {
      add('NOTE', T + ' session-start', 'the tool has no session-start event, so the session reports (skill drift, open carve-outs, the memory index, branch drift) never run under it');
    }

    if (typeof row.skills === 'string') {
      const gone = SHIPPED_SKILLS.filter((s) => !isFile(path.join(abs(row.skills), s, 'SKILL.md')));
      if (!gone.length) add('OK', T + ' skills', SHIPPED_SKILLS.length + ' skill(s) under ' + row.skills + '/');
      for (const s of gone) add('MISSING', T + ' skill ' + s, 'no ' + row.skills + '/' + s + '/SKILL.md', me + ' init');
    } else {
      add('NOTE', T + ' skills', 'where it loads skills from is not established, so none is installed for it');
    }
  }

  // 4. EVERY PIECE OF THE HARNESS PRESENT, AND STILL THE BYTES THAT SHIPPED.
  //    Compared with line endings normalised: a checkout that converts to CRLF
  //    has not edited anything. Skipped when the tree under inspection IS the
  //    package — a file cannot drift from itself.
  if (!samePkg) {
    const shipped = (usesShippedHookConfig(enabled) ? walk(path.join(pkgRoot, ...SHIPPED_HOOK_CONFIG.helpers.split('/'))).filter((f) => /\.(c|m)?js$/.test(f)) : [])
      .concat(walk(path.join(pkgRoot, 'scripts', 'harness')).filter((f) => /\.(c|m)?js$/.test(f)));
    for (const src of shipped) {
      const r = posix(path.relative(pkgRoot, src));
      const mine = readText(path.join(root, ...r.split('/')));
      if (mine === null) add('MISSING', r, 'part of the harness, not installed', me + ' init');
      else if (lf(mine) !== lf(readText(src))) add('DRIFTED', r, 'differs from the installed package\'s copy', me + ' init --force --only ' + r);
      else add('OK', r, 'matches the package');
    }
  }

  // 5. EVERY --self-test PASSING. The self-tests are where each guard's
  //    decisions are driven with literals; a helper that is present and whose
  //    self-test fails is a guard that has changed its mind about something.
  if (!o.noSelfTests) {
    const files = selfTestable(root, ['.claude/helpers', 'scripts/harness']);
    if (!files.length) add('MISSING', 'self-tests', 'no helper under .claude/helpers or scripts/harness answers --self-test', me + ' init');
    for (const f of files) {
      const r = runSelfTest(f, root);
      if (r.ok) add('OK', 'self-test ' + rel(f), r.tail);
      else add('DRIFTED', 'self-test ' + rel(f), 'exit ' + r.status + (r.tail ? ' — ' + r.tail : ''), 'node ' + rel(f) + ' --self-test');
    }
  }

  // 6 + 7. DOCS: frontmatter present, caps obeyed. A PRESENCE probe only — the
  //    doc gate owns the rules (fields, enums, links, frozen evidence), so the
  //    fix line points at it instead of restating a subset here that would then
  //    disagree with it.
  if (cfg) {
    const docsRoot = cfg.project.docsRoot;
    const tracks = cfg.project.tracksDir;
    const exempt = (cfg.docs.exemptDirs || []).map((x) => posix(x).replace(/\/$/, ''));
    const isExempt = (r) => exempt.some((x) => r === x || r.startsWith(x + '/'));
    const caps = cfg.docs.caps;
    const docFiles = [...new Set(walk(path.join(root, ...docsRoot.split('/'))).concat(walk(path.join(root, ...tracks.split('/')))))]
      .filter((f) => f.endsWith('.md'));
    {
      // A docs root that does not exist YET is not a broken install: it is a repo
      // with no doc, and git cannot even hold the empty directory a `mkdir` would
      // make, so calling it MISSING left every fresh install — and every fresh
      // clone of one — unhealthy with a fix that does not survive a commit. It is
      // said out loud instead, and the caps below are graded all the same.
      const noRoot = !isDir(path.join(root, ...docsRoot.split('/')));
      const index = docsRoot + '/INDEX.md';
      const graded = docFiles.map(rel).filter((r) => r !== index && !isExempt(r));
      // A stub under the docs root carries the import line and nothing else, by the doc gate's
      // own rule 12, so it is not a doc that owes a frontmatter block.
      const bare = graded.filter((r) => !STUB_FILES.includes(r.split('/').pop()) && !hasFrontmatter(readText(path.join(root, ...r.split('/'))) || ''));
      if (noRoot) add('OK', 'docs frontmatter', 'no ' + docsRoot + '/ yet, so 0 doc(s) to grade — the first doc creates it (templates/track/ is the shape)');
      else if (!bare.length) add('OK', 'docs frontmatter', graded.length + ' doc(s) under ' + docsRoot + '/, each opens with a frontmatter block');
      for (const r of bare) add('DRIFTED', 'docs frontmatter ' + r, 'no frontmatter block, so it has no row in the generated index', 'node scripts/harness/guards/docs-lint.cjs');

      const over = [];
      const cap = (r, n) => { const t = readText(path.join(root, ...r.split('/'))); if (t !== null && lineCount(t) > n) over.push({ r: r, lines: lineCount(t), cap: n }); };
      for (const name of Object.keys(caps)) if (/\.md$/.test(name) && !name.includes('/')) cap(name, caps[name]);
      // EVERY nested instruction file (the policy file's name, or its stub's), a template's
      // included, over the same directories the doc gate walks. A tool that loads nested
      // files loads one by that name when anything under its directory is touched, whatever
      // the file was written for, and the doc gate caps it and the context gate budgets it
      // for that reason. This probe once left `templates/` out as "not an
      // instruction file this repo loads", which was untrue and made doctor call a tree healthy
      // that the doc gate then reds.
      const subtree = walk(root, (full, e) => e.isDirectory() && /^(node_modules|\.git|dist|build|coverage|\.next|out|vendor)$/.test(e.name))
        .filter((f) => [TOOLS.POLICY_FILE].concat(STUB_FILES).includes(path.basename(f)) && path.dirname(f) !== root).map(rel);
      if (caps.subtreeAgentsMd) for (const r of subtree) cap(r, caps[r] || caps.subtreeAgentsMd);
      if (caps.default) for (const r of graded) cap(r, caps[r] || caps.default);
      if (!over.length) add('OK', 'line caps', [TOOLS.POLICY_FILE].concat(STUB_FILES).join(', ') + ', ' + subtree.length + ' subtree instruction file(s), ' + graded.length + ' doc(s)');
      for (const x of over) {
        add('DRIFTED', 'line cap ' + x.r, x.lines + ' lines, cap ' + x.cap,
          x.r.startsWith(docsRoot + '/') ? 'node scripts/harness/split-doc.js ' + x.r + ' --out ' + x.r.replace(/\.md$/, '')
            : 'cut ' + x.r + ' to ' + x.cap + ' lines — it is loaded on every session, so the cap is the budget');
      }
    }
  }

  // 8. THE SKILL LOCK, present and parseable. Its CONTENTS are the skills gate's.
  const lock = readJson(path.join(root, 'skills-lock.json'));
  if (!isFile(path.join(root, 'skills-lock.json'))) add('MISSING', 'skills-lock.json', 'nothing records which skills were read', me + ' init');
  else if (!lock || Array.isArray(lock) || !lock.skills || typeof lock.skills !== 'object') add('DRIFTED', 'skills-lock.json', 'not a lock: expected { "version": 2, "skills": { ... } }', 'node scripts/harness/guards/skill-verify.cjs --check');
  else add('OK', 'skills-lock.json', Object.keys(lock.skills).length + ' skill(s) pinned');

  // 9. THE IGNORE RULES. Probed through git, so it is the effect that is graded.
  const guarded = cfg ? cfg.env.guarded : CONFIG.DEFAULTS.env.guarded;
  const gaps = ignoreGaps(root, guarded);
  if (gaps === null) add('MISSING', 'git repository', 'the gates read git history and the ignore rules cannot be probed without one', 'git init');
  else {
    if (!gaps.length) add('OK', '.gitignore', requiredIgnores(guarded).length + ' required path(s) ignored');
    for (const g of gaps) add('MISSING', '.gitignore ' + g.pattern, g.probe + ' is not ignored (' + g.why + ')', 'echo "' + g.pattern + '" >> .gitignore');
  }
  return rows;
}

function cmdDoctor(argv) {
  const i = argv.indexOf('--root');
  const root = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : findRoot(process.cwd()));
  const rows = doctor(root, { noSelfTests: argv.includes('--no-self-tests') });
  console.log('harness doctor -> ' + root + '\n');
  for (const r of rows) {
    console.log(r.status.padEnd(8) + r.item + (r.detail ? '   — ' + r.detail : ''));
    // A NOTE is a gap no command closes, so it carries no fix line and moves no count.
    if (r.status !== 'OK' && r.status !== 'NOTE') console.log('         fix: ' + r.fix);
  }
  const n = (s) => rows.filter((r) => r.status === s).length;
  console.log('\n' + (n('MISSING') + n('DRIFTED') ? 'NOT HEALTHY' : 'HEALTHY') + ' — ok=' + n('OK') + ' missing=' + n('MISSING') + ' drifted=' + n('DRIFTED')
    + (n('NOTE') ? ' notes=' + n('NOTE') + ' (gaps no command closes; read them above)' : ''));
  // The gate line, last, so a repo can register `harness doctor` as a gate.
  console.log('GATE doctor pass=' + n('OK') + ' fail=' + (n('MISSING') + n('DRIFTED')) + ' skipped=0');
  return n('MISSING') + n('DRIFTED') ? 1 : 0;
}

/* ---------- thin wrappers ----------
   They add exactly one thing each and print the command they run, so the wrapper
   is never the only place a flag is written down. */
function findRoot(from) {
  let dir = path.resolve(from);
  for (;;) {
    if (exists(path.join(dir, CONFIG_NAME))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
}
function stop(msg, fix) {
  console.error('FATAL — ' + msg);
  console.error('   fix: ' + fix);
  return 1;
}
function runScript(root, relScript, args) {
  const script = path.join(root, ...relScript.split('/'));
  if (!isFile(script)) return stop('no ' + relScript + ' under ' + root, selfInvocation(root) + ' init');
  console.log('> node ' + relScript + (args.length ? ' ' + args.join(' ') : ''));
  const r = spawnSync(process.execPath, [script].concat(args), { cwd: root, stdio: 'inherit', windowsHide: true });
  return r.status === null ? 1 : r.status;
}
/** `a=1,b=2` -> { a: 1, b: 2 }, or null when any entry is not <gate>=<positive integer>.
 *  Null rather than a best effort: a mistyped tolerance must stop the run, not shrink to
 *  whatever part of it parsed. */
function parseSkips(s) {
  const out = {};
  for (const part of String(s || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9-]*)=([1-9][0-9]*)$/.exec(part);
    if (!m) return null;
    out[m[1]] = Number(m[2]);
  }
  return out;
}
/** The declared skips plus the ones a caller names for ITS host, taking the LARGER
 *  count per gate and never the sum: when the baseline was accepted on a box with the
 *  same shortfall, both sources are describing the one skip, and adding them would
 *  tolerate a second that nobody declared. */
function mergeSkips(a, b) {
  const out = Object.assign({}, a);
  for (const k of Object.keys(b || {})) out[k] = Math.max(out[k] || 0, b[k]);
  return out;
}

function cmdGates(argv) {
  const root = findRoot(process.cwd());
  // --with <gate>=<n>[,...] belongs to --print-allow-skip and is not a gates.js flag.
  const wi = argv.indexOf('--with');
  let extra = {};
  if (wi >= 0) {
    if (!argv.includes('--print-allow-skip')) return stop('--with only means something beside --print-allow-skip', 'pass the tolerance to the run itself: --allow-skip <gate>=<n>');
    extra = parseSkips(argv[wi + 1] && !argv[wi + 1].startsWith('--') ? argv[wi + 1] : '');
    if (!extra || !Object.keys(extra).length) return stop('--with needs <gate>=<n>[,<gate>=<n>], n a positive integer', 'e.g. --print-allow-skip --with docs=1');
    argv = argv.filter((a, i) => i !== wi && i !== wi + 1);
  }
  const args = argv.filter((a) => a !== '--print-allow-skip');
  const needsSkips = argv.includes('--print-allow-skip') || ((args.includes('--check') || args.includes('--accept')) && !args.includes('--allow-skip'));
  let skips = '';
  if (needsSkips) {
    let cfg;
    try { cfg = CONFIG.load({ root: root, fresh: true }); } catch (e) { return stop(e.message, e.fix || 'node scripts/harness/config.js'); }
    skips = skipArg(mergeSkips(declaredSkips(cfg, readJson(path.join(root, 'scripts', 'harness', 'gates.baseline.json'))), extra));
  }
  // For CI: the value alone on stdout, so a workflow can hold it in a variable and
  // ECHO it before using it. The decision to tolerate a skip stays in the log.
  if (argv.includes('--print-allow-skip')) { process.stdout.write(skips + '\n'); return 0; }
  if (skips) args.push('--allow-skip', skips);
  return runScript(root, 'scripts/harness/gates.js', args);
}
function cmdDocs(argv) {
  const root = findRoot(process.cwd());
  if (argv.includes('--index')) return runScript(root, 'scripts/harness/docs-index.js', argv.filter((a) => a !== '--index'));
  return runScript(root, 'scripts/harness/guards/docs-lint.cjs', argv);
}
/** The launcher. It owns the terminal and its own refusals; this only finds it. No `> node` echo
 *  line: what it prints is a question to a person, and then the tool's own screen. */
function cmdRun(argv) {
  const root = findRoot(process.cwd());
  const script = path.join(root, 'scripts', 'harness', 'run.js');
  if (!isFile(script)) return stop('no scripts/harness/run.js under ' + root, selfInvocation(root) + ' init');
  const r = spawnSync(process.execPath, [script].concat(argv), { cwd: root, stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}

/** Workspaces: one folder per agent. The script owns every decision and refusal; this only
 *  finds it and spells `new`, `list`, `land` and `prune` as its flags. It runs in the CALLER'S directory, not
 *  the root, because which checkout the caller stands in is one of its inputs. */
function cmdWorktree(argv) {
  const root = findRoot(process.cwd());
  const script = path.join(root, 'scripts', 'harness', 'worktree.js');
  if (!isFile(script)) return stop('no scripts/harness/worktree.js under ' + root, selfInvocation(root) + ' init');
  const verbs = { new: '--new', list: '--list', land: '--land', prune: '--prune' };
  const args = argv.length && verbs[argv[0]] ? [verbs[argv[0]]].concat(argv.slice(1)) : argv;
  const r = spawnSync(process.execPath, [script].concat(args), { cwd: process.cwd(), stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}

/** THE INPUTS A GATE'S VERDICT DEPENDS ON THAT THE REPO DOES NOT CONTAIN. Each one
 *  is supplied implicitly by a developer's machine and each can move a figure, so
 *  they are printed rather than assumed: a run whose environment drifted is then
 *  legible from its own log instead of from someone's memory of what the runner is
 *  like. A report, never a verdict — it always exits 0. */
function hostReport(root, has) {
  const present = has || onPath;
  const lines = ['node ' + process.version + ' on ' + process.platform + ' ' + process.arch];
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']);
  if (shallow === null) lines.push('absent: a git repository          -> every history-reading rule checks nothing');
  else if (shallow === 'true') lines.push('UNEXPECTED: a SHALLOW clone       -> `git log -- <file>` sees one commit, so the frozen-evidence and first-commit rules answer "fine" while checking nothing (CI: fetch-depth: 0)');
  else lines.push('present: full git history');
  let cfg = null;
  try { cfg = CONFIG.load({ root: root, fresh: true }); } catch (e) { lines.push('absent: a valid ' + CONFIG_NAME + '  -> ' + e.message); }
  const guarded = cfg ? cfg.env.guarded : CONFIG.DEFAULTS.env.guarded;
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => isGuarded(n, guarded)); } catch { names = []; }
  lines.push(names.length ? 'PRESENT: ' + names.length + ' guarded secret file(s) at the root (' + names.join(', ') + ') -> expected on a developer machine, UNEXPECTED on a CI runner'
    : 'absent: guarded secret files       -> a gate with live checks must declare them skipped');
  lines.push(isFile(path.join(root, '.claude', 'settings.local.json')) ? 'present: .claude/settings.local.json (personal settings)' : 'absent: .claude/settings.local.json');
  if (cfg) {
    const scripts = (readJson(path.join(root, 'package.json')) || {}).scripts || {};
    for (const g of cfg.gates) {
      const r = gateResolvable(g, root, scripts, present);
      if (!r.ok) lines.push('absent: what gate `' + g.name + '` runs  -> ' + r.why + (g.optional && r.absentTool ? ' (optional: it will declare skipped=1)' : ' (it will fail)'));
    }
    lines.push('declared skips: ' + (skipArg(declaredSkips(cfg, readJson(path.join(root, 'scripts', 'harness', 'gates.baseline.json')))) || 'none'));
  }
  return lines;
}

/** Every `--self-test` in the repo, all of them run even after one fails so a single
 *  log lists every broken helper, and red if any is. */
function cmdSelftest() {
  const root = findRoot(process.cwd());
  const files = selfTestable(root, ['bin', '.claude/helpers', 'scripts/harness']);
  if (!files.length) return stop('no script under bin, .claude/helpers or scripts/harness answers --self-test', selfInvocation(root) + ' init');
  let bad = 0;
  for (const f of files) {
    const r = runSelfTest(f, root);
    if (!r.ok) bad += 1;
    console.log((r.ok ? 'PASS  ' : 'FAIL  ') + posix(path.relative(root, f)) + (r.ok ? '' : '   exit ' + r.status + ' — fix: node ' + posix(path.relative(root, f)) + ' --self-test'));
  }
  console.log('\n' + (bad ? 'FAIL' : 'PASS') + ' — ' + (files.length - bad) + '/' + files.length + ' self-tests passed');
  console.log('GATE selftest pass=' + (files.length - bad) + ' fail=' + bad + ' skipped=0');
  return bad ? 1 : 0;
}

const HELP = [
  'harness — install and check the agent harness. Zero dependencies.',
  '',
  '  ' + INIT_USAGE,
  '      --tools names the coding agents to wire, by registry id (`node scripts/harness/tools.js --list`).',
  '      It writes tools.enabled, and per tool: the hook config its registry row and dialect describe,',
  '      MERGED into a file that exists and never overwriting one; the policy pointer; and the skills,',
  '      rendered once to each skill root an enabled tool reads. A tool the harness cannot wire is named,',
  '      with the reason. With no --tools the config already in the repo says which, else the default.',
  '      Copy the harness into a repo: .claude/{settings.json,helpers,agents,skills}, scripts/harness/,',
  '      schema/, templates/track/, a ' + CONFIG_NAME + ' generated from what it detects (package manager,',
  '      test command, docs dir, default branch), AGENTS.md (the policy), its CLAUDE.md stub and the routing doc,',
  '      an empty skills-lock.json, an empty gate baseline, an empty context report and a context',
  '      budget marked `placeholder`: no figure measured on another tree is inherited.',
  '      Never overwrites an existing file without --force. --dry-run prints the plan and writes nothing.',
  '      --only limits the run to one path or directory, e.g. --force --only .claude/helpers',
  '      --git-hooks writes a git pre-commit (the commit gate report) and pre-push (the gate suite).',
  '      Opt-in: without it init only prints what they would run. A hook that exists is never replaced,',
  '      and a repo with core.hooksPath set is left alone. A backstop at commit or push time, not a deny.',
  '',
  '  harness doctor [--root <dir>] [--no-self-tests]',
  '      Report every installed piece as OK / MISSING / DRIFTED, each with the one command that fixes it.',
  '      Per enabled tool: its tier, its evidence, and each missing wire. A NOTE is a gap no command',
  '      closes (a tool with no session-start event, a hook file nobody established the shape of).',
  '      Exit 0 only when nothing is MISSING or DRIFTED. Its last line is a GATE line.',
  '',
  '  harness gates [--check] [--accept] [--only a,b] [--allow-skip g=n]',
  '      Run scripts/harness/gates.js. With --check or --accept and no --allow-skip, the skips the',
  '      repo has DECLARED (an empty `artifacts` list; a baseline row with skipped>0) are passed for you.',
  '      --print-allow-skip prints that list and runs nothing. --print-allow-skip --with <gate>=<n>',
  '      merges in a skip the CALLER declares for its own host (a CI runner), larger count winning.',
  '',
  '  harness docs [--index] [--check]',
  '      Run the doc gate (scripts/harness/guards/docs-lint.cjs), or with --index the index generator.',
  '',
  '  harness run [<mode>] [--tool <id>] [--track <id>] [--dry-run]',
  '      Start a coding agent in a run mode (fully-auto, auto-edit, hitl, manual). The mode is chosen',
  '      here, by a person, before the agent exists: with no mode it asks on the terminal, and with no',
  '      terminal it refuses. The flags and the program come from the tool\'s registry row; a mode or',
  '      a tool with nothing recorded is refused, never started bare. --dry-run starts nothing.',
  '      --track records which phase of that track was approved, in a receipt beside its handoff.',
  '      A receipt is an approval, so it is written only from a terminal.',
  '',
  '  harness worktree new <name> [--track] [--from <ref>]',
  '  harness worktree list',
  '  harness worktree land <name>',
  '  harness worktree prune [--yes]',
  '      One folder per agent, each on its own branch over one shared history, so several agents',
  '      can work in one project on one computer. `new` makes the folder and a branch of the same',
  '      name, cut from the source branch, OUTSIDE every checkout; --track also scaffolds a track.',
  '      `list` prints every checkout and where the next one would go. Start the agent inside the',
  '      new folder. It never merges, pushes, removes a folder or deletes a branch.',
  '',
  '  harness host           Print the host-dependent inputs a gate verdict rests on. Always exits 0.',
  '  harness selftest       Run every --self-test in the repo; exit 1 if any fails.',
  '  harness --self-test    Check this file. Runs no gate and touches no repo.',
].join('\n');

/* ---------- --self-test ----------
   Drives every decision above against throwaway directories: a fake package to
   install FROM and fake targets to install INTO, so the test depends on neither
   this checkout's contents nor the repo it happens to be run in. The cases that
   must come out NO are the point — an installer that overwrites, a doctor that
   passes a broken tree, a detector that invents a test command. */
function selfTest() {
  const os = require('node:os');
  const fails = [];
  let n = 0;
  const eq = (what, got, want) => { n += 1; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); };
  const ok = (what, cond) => eq(what, Boolean(cond), true);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-self-test-'));
  const put = (root, relPath, text) => { const f = path.join(root, ...relPath.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  const guarded = CONFIG.DEFAULTS.env.guarded;

  try {
    // ----- pure pieces
    eq('tokens keep a quoted run together', tokens('node --test "tests/**/*.test.js"'), ['node', '--test', 'tests/**/*.test.js']);
    eq('render: one token, three spellings', render('{{PROJECT_NAME}} {{project.name}} {{ projectName }}', { name: 'acme', docsRoot: 'docs' }).text, 'acme acme acme');
    eq('render: an unknown token is left visible', render('{{nope}}', { name: 'acme', docsRoot: 'docs' }), { text: '{{nope}}', unknown: ['{{nope}}'] });
    eq('render: the angle spelling the templates use', render('# <PROJECT_NAME> in <TRACKS_DIR>/', { name: 'acme', docsRoot: 'docs' }).text, '# acme in docs/tracks/');
    eq('render: a lower-case angle token is notation, not a placeholder', render('<id> <gate>=<n>', { name: 'acme', docsRoot: 'docs' }), { text: '<id> <gate>=<n>', unknown: [] });
    eq('render: what only the author knows is reported, once', render('<WHAT_THIS_IS> <WHAT_THIS_IS> <PLACEHOLDER>', { name: 'acme', docsRoot: 'docs' }).unknown, ['<WHAT_THIS_IS>']);
    eq('render: no test command leaves the token visible', render('<TEST_COMMAND>', { name: 'acme', docsRoot: 'docs', test: null }).unknown, ['<TEST_COMMAND>']);
    eq('render: the skip flag arrives whole', render('gates.js --check <ALLOW_SKIP>', { name: 'acme', docsRoot: 'docs' }).text, 'gates.js --check --allow-skip reproducible-build=1');
    eq('frontmatter: present', hasFrontmatter('---\nid: a\n---\n# t\n'), true);
    eq('frontmatter: CRLF is still present', hasFrontmatter('---\r\nid: a\r\n---\r\n# t\r\n'), true);
    eq('frontmatter: a heading is not one', hasFrontmatter('# t\n\n---\n'), false);
    eq('frontmatter: an unclosed block is not one', hasFrontmatter('---\nid: a\n# t\n'), false);
    eq('lines: a trailing newline does not add one', lineCount('a\nb\n'), 2);
    eq('lines: none', lineCount(''), 0);
    eq('skips: an empty artifact list declares one', configSkips({ artifacts: [] }), { 'reproducible-build': 1 });
    eq('skips: a configured artifact declares none', configSkips({ artifacts: ['dist/app.js'] }), {});
    eq('skips: the { command, files } shape is read too', configSkips({ artifacts: { command: 'x', files: ['a'] } }), {});
    eq('skips: a baseline row with skipped>0 is declared', skipArg(declaredSkips({ artifacts: ['a'] }, { gates: { lint: { skipped: 1 }, test: { skipped: 0 } } })), 'lint=1');
    eq('skips: sorted and joined for the flag', skipArg(declaredSkips({ artifacts: [] }, { gates: { docs: { skipped: 2 } } })), 'docs=2,reproducible-build=1');
    eq('skips: a caller\'s host skip is merged in', skipArg(mergeSkips({ 'reproducible-build': 1 }, parseSkips('docs=1'))), 'docs=1,reproducible-build=1');
    eq('skips: merged by the LARGER count, never the sum', mergeSkips({ docs: 1 }, { docs: 1 }), { docs: 1 });
    eq('skips: a mistyped tolerance parses to nothing at all', parseSkips('docs=1,lint'), null);
    eq('skips: zero is not a tolerance', parseSkips('docs=0'), null);
    eq('init args: the documented flags pass', initArgError(['--into', 'x', '--force', '--dry-run', '--only', '.claude']), null);
    eq('init args: the git-hook backstop is a bare flag, and takes no value', [initArgError(['--git-hooks']), initArgError(['--git-hooks', 'pre-commit'])], [null, 'unexpected argument `pre-commit`']);
    eq('init args: a misspelt --dry-run is REFUSED, not a real install', initArgError(['--dryrun']), 'unknown flag `--dryrun`');
    eq('init args: --into with no value does not fall back to the cwd', initArgError(['--into']), '--into needs a value');
    eq('init args: nor with a flag where its value should be', initArgError(['--into', '--force']), '--into needs a value');
    eq('init args: a bare word is not a target', initArgError(['somewhere']), 'unexpected argument `somewhere`');
    eq('init args: --tools takes a value', [initArgError(['--tools', 'tool-a']), initArgError(['--tools'])], [null, '--tools needs a value']);
    // Which tools: every id is held to the registry, here a literal one.
    const row = (over) => Object.assign({ id: 'tool-a', policy: { mode: 'native', file: TOOLS.POLICY_FILE }, nested: 'yes', hookConfig: null, dialect: null,
      sessionStart: null, projectHooks: null, tier: 'backstop', evidence: 'docs', asOf: '2026-01-04', source: ['https://example.com'] }, over);
    const REG = { dialects: [], tools: [row({}), row({ id: 'tool-b' }), row({ id: 'model-a', policy: null, nested: null, tier: 'inherits' }), row({ id: 'tool-o', policy: { mode: 'native', file: 'OWN.md' } })] };
    eq('tools: ids the registry has are accepted', toolsArgError(['tool-b', 'tool-a'], REG), null);
    eq('tools: an unknown id is refused, and the valid ones are listed', toolsArgError(['tool-a', 'tool-z'], REG), 'unknown tool id `tool-z` (valid: tool-a, tool-b, model-a, tool-o)');
    eq('tools: an id named twice is refused', toolsArgError(['tool-a', 'tool-a'], REG), 'tool id `tool-a` is named twice');
    ok('tools: an empty list is refused', /needs at least one tool id/.test(toolsArgError([], REG)));
    ok('tools: a model is refused in the registry\'s own words', /enable the row of the host/.test(toolsArgError(['model-a'], REG)));
    ok('tools: so is a tool whose own file is not the policy file', /second policy body/.test(toolsArgError(['tool-o'], REG)));
    ok('tools: the shipped registry accepts its own default', toolsArgError(DEFAULT_ENABLED) === null);
    eq('config: no tools key unless the caller named them', 'tools' in buildConfig({ evidence: {}, docsRoot: 'docs', trackedDirs: [], trackedRootFiles: [] }), false);
    eq('config: named tools are written as named', buildConfig({ evidence: {}, docsRoot: 'docs', trackedDirs: [], trackedRootFiles: [], enabled: DEFAULT_ENABLED.slice() }).tools, { enabled: DEFAULT_ENABLED });
    eq('budget: bytes + 10%, rounded up to 256', [ceilingFor(3938), ceilingFor(6994), ceilingFor(0)], [4352, 7936, 256]);
    const ROUTE = 'docs/reference/routing/README.md';
    eq('names: the routing doc follows the docs root', instructionFiles('doc').routing, 'doc/reference/routing/README.md');
    eq('names: three files are rendered, the routing doc from its template under templates/docs',
      instructionFiles('doc').render, [{ template: 'AGENTS.md', dest: 'AGENTS.md' }, { template: 'CLAUDE.md', dest: 'CLAUDE.md' }, { template: 'docs/reference/routing/README.md', dest: 'doc/reference/routing/README.md' }]);
    const sb = JSON.parse(starterBudget(JSON.stringify({ _readme: ['the rule', '', 'THE FIGURES BELOW were measured', '  AGENTS.md 1 B'], ceilings: { injected: { 'AGENTS.md': 9999 }, nestedOnTouch: { 'templates/AGENTS.md': 4096 } }, generated: { ['policyReads/' + ROUTE]: { baseBytes: 256, bytesPerRow: 256, maxRows: 6 } }, totalTokenCeiling: 1 }), { 'AGENTS.md': 3938, 'CLAUDE.md': 145, [ROUTE]: 6994 }));
    eq('budget: the package\'s nested row does not travel', sb.ceilings, { injected: { 'AGENTS.md': 4352, 'CLAUDE.md': 256 }, nestedOnTouch: {}, policyReads: { [ROUTE]: 7936 } });
    eq('budget: the policy file and its stub are INJECTED, the routing doc is the lead-only read', [Object.keys(sb.ceilings.injected), Object.keys(sb.ceilings.policyReads)], [['AGENTS.md', 'CLAUDE.md'], [ROUTE]]);
    eq('budget: the generated block is budgeted on the routing doc', Object.keys(sb.generated), ['policyReads/' + ROUTE]);
    eq('budget: it is marked placeholder', sb.placeholder, true);
    eq('budget: the total is derived from its own rows', sb.totalTokenCeiling, 4352 / 4 + 256 / 4 + (7936 + 256 + 256 * 6) / 4);
    eq('budget: a non-default docs root moves the routing row with it',
      Object.keys(JSON.parse(starterBudget('{}', {}, instructionFiles('doc'))).ceilings.policyReads), ['doc/reference/routing/README.md']);
    ok('budget: the rule travels, the package\'s working does not', sb._readme[0] === 'the rule' && !sb._readme.some((l) => /THE FIGURES BELOW|1 B$/.test(l)));
    const eb = JSON.parse(emptyBaseline());
    eq('baseline: every figure is null and no gate has a row', [eb.generatedAt, eb.commit, eb.dirty, eb.node, eb.gates], [null, null, null, null, {}]);
    ok('baseline: its prose describes the EMPTY state and names the way out of it',
      eb._readme.some((l) => /deliberately EMPTY/.test(l)) && eb._readme.some((l) => /NOT yet protected/.test(l)) && eb._readme.some((l) => /gates\.js --accept/.test(l)));
    eq('hook scripts: the runtime variable is resolved', hookScripts('node "$CLAUDE_PROJECT_DIR/scripts/harness/guards/a.cjs" --gate', path.join(tmp, 'r')), [path.join(tmp, 'r', 'scripts', 'harness', 'guards', 'a.cjs')]);
    eq('hook scripts: and its defaulted form', hookScripts('node "${CLAUDE_PROJECT_DIR:-.}/scripts/harness/guards/b.cjs"', path.join(tmp, 'r')), [path.join(tmp, 'r', 'scripts', 'harness', 'guards', 'b.cjs')]);
    eq('hook loads: a literal relative require is followed, a built-in and a computed one are not',
      hookLoads("const a = () => require('./guards/a.cjs');\nrequire(\"../b.js\");\nrequire('node:fs');\nrequire(path.join(d, 'c.js'));\nrequire('./guards/a.cjs');", path.join(tmp, 'r', 'scripts', 'harness', 'entry.js')),
      [path.join(tmp, 'r', 'scripts', 'harness', 'guards', 'a.cjs'), path.join(tmp, 'r', 'scripts', 'b.js')]);
    eq('hook loads: a script that could not be read loads nothing', hookLoads(null, path.join(tmp, 'x.js')), []);
    eq('hook commands: found wherever they nest', hookCommands({ hooks: { PreToolUse: [{ matcher: 'Bash|mcp__.*', hooks: [{ type: 'command', command: 'x' }] }] }, statusLine: { type: 'command', command: 'y' } }).map((c) => c.command), ['x', 'y']);
    eq('ignores: one rule per guarded pattern, after the fixed ones', requiredIgnores(['secrets.*']).slice(-1)[0].probe, 'secrets.local');
    eq('guarded: a wildcard pattern covers a concrete name', isGuarded('secrets.prod', ['secrets.*']), true);
    eq('guarded: and not a lookalike', isGuarded('mysecrets.prod', ['secrets.*']), false);

    // ----- gate resolvability
    const g = path.join(tmp, 'gates');
    put(g, 'scripts/harness/a.js', '');
    const none = () => false;
    const all = () => true;
    eq('gate: a node script that exists', gateResolvable({ command: 'node scripts/harness/a.js --check' }, g, {}, none).ok, true);
    eq('gate: a node script that does not', gateResolvable({ command: 'node scripts/harness/zz.js' }, g, {}, none), { ok: false, why: 'no file at scripts/harness/zz.js' });
    eq('gate: node over a glob needs no file', gateResolvable({ command: 'node --test "tests/**/*.test.js"' }, g, {}, none).ok, true);
    eq('gate: an npm script that is declared', gateResolvable({ command: 'npm run lint' }, g, { lint: 'x' }, all).ok, true);
    eq('gate: an npm script that is not', gateResolvable({ command: 'npm run lint' }, g, {}, all).why, 'package.json has no `lint` script');
    eq('gate: `npm test` needs a test script too', gateResolvable({ command: 'npm test' }, g, {}, all).ok, false);
    eq('gate: a tool that is not on PATH is an absent tool', gateResolvable({ command: 'cargo test' }, g, {}, none).absentTool, true);

    // ----- detection
    const bare = path.join(tmp, 'bare-repo');
    fs.mkdirSync(bare);
    const dBare = detect(bare);
    eq('detect: the directory names a repo with no package.json', dBare.name, 'bare-repo');
    eq('detect: NO test command is invented', dBare.test, null);
    eq('detect: so the generated config has no test gate', buildConfig(dBare).gates.map((x) => x.name), ['docs', 'context', 'hygiene', 'skills', 'tools']);
    eq('detect: docs defaults to docs/', dBare.docsRoot, 'docs');

    const t = path.join(tmp, 'target');
    put(t, 'package.json', JSON.stringify({ name: '@acme/web', scripts: { test: 'vitest run', lint: 'eslint .' } }));
    put(t, 'pnpm-lock.yaml', '');
    put(t, 'doc/a.md', '# a\n');
    const d = detect(t);
    eq('detect: a scoped name loses its scope', d.name, 'web');
    eq('detect: the lockfile names the package manager', d.packageManager, 'pnpm');
    eq('detect: a test script runs through that manager, graded on exit status', d.test, { command: 'pnpm run test', adapter: 'exit-code' });
    eq('detect: an existing doc/ is the docs root', d.docsRoot, 'doc');
    eq('detect: lint is optional', buildConfig(d).gates[1], { name: 'lint', command: 'pnpm run lint', adapter: 'exit-code', optional: true });
    put(t, 'package.json', JSON.stringify({ name: 'web', packageManager: 'yarn@4.0.0', scripts: { test: 'node --test "tests/**/*.test.js"' } }));
    eq('detect: `packageManager` outranks a stale lockfile', detect(t).packageManager, 'yarn');
    eq('detect: node --test is read by its own adapter', detect(t).test.adapter, 'node-test');
    put(t, 'package.json', JSON.stringify({ name: 'web', scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    eq('detect: the npm init stub is not a test command', detect(t).test, null);
    put(t, 'package.json', JSON.stringify({ name: '@acme/web', scripts: { test: 'vitest run' } }));

    // ----- the generated config is one config.js accepts
    put(t, CONFIG_NAME, JSON.stringify(buildConfig(detect(t))));
    let loaded = null;
    try { loaded = CONFIG.load({ root: t, fresh: true }); } catch (e) { fails.push('the generated config is rejected by config.js: ' + e.message); }
    ok('the generated config loads through config.js', loaded && loaded.project.tracksDir === 'doc/tracks');
    put(bare, CONFIG_NAME, JSON.stringify(buildConfig(dBare)));
    try { CONFIG.load({ root: bare, fresh: true }); n += 1; } catch (e) { fails.push('the no-test-gate config is rejected by config.js: ' + e.message); }
    fs.unlinkSync(path.join(t, CONFIG_NAME));

    // ----- install: a fake package, so this never depends on the checkout's contents
    const pkg = path.join(tmp, 'pkg');
    put(pkg, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|mcp__.*', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/harness/guards/guard.cjs"' }] }] } }));
    put(pkg, 'scripts/harness/guards/guard.cjs', 'if (process.argv.includes(\'--self-test\')) { console.log(\'PASS\'); process.exit(0); }\n');
    put(pkg, '.claude/helpers/statusline.cjs', '// the status line\n');
    put(pkg, '.claude/helpers/.state.json', '{}');
    put(pkg, 'scripts/harness/guards/.state.json', '{}');
    for (const a of SHIPPED_AGENTS) put(pkg, '.claude/agents/' + a, '# ' + a + '\n');
    put(pkg, '.claude/agents/someone-elses.md', '# not ours\n');
    for (const s of SHIPPED_SKILLS) put(pkg, '.claude/skills/' + s + '/SKILL.md', '# ' + s + '\n');
    put(pkg, '.claude/skills/vendored/SKILL.md', '# third party\n');
    fs.copyFileSync(path.join(PKG_ROOT, 'scripts', 'harness', 'config.js'), put(pkg, 'scripts/harness/config.js', ''));
    put(pkg, 'scripts/harness/gates.json', '{"run":"output"}');
    put(pkg, 'scripts/harness/gates.red.test.log', 'red');
    put(pkg, 'scripts/harness/gates.baseline.json', JSON.stringify({ _readme: ['why'], commit: 'abc', gates: { test: { pass: 40, fail: 0, skipped: 0 } } }));
    // A package that has MEASURED ITSELF, which is the state the real one is in.
    put(pkg, 'scripts/harness/harness-baseline.json', JSON.stringify({ measured: '2020-01-01T00:00:00.000Z', project: 'the-package', groundTruth: { transcript: 'aaaaaaaa', firstTurnTokens: 99999 } }));
    put(pkg, 'schema/harness.config.schema.json', '{}');
    for (const x of TRACK_TEMPLATES) put(pkg, 'templates/track/' + x, '---\nid: x\n---\n');
    put(pkg, 'templates/AGENTS.md', '# {{PROJECT_NAME}}\n');
    put(pkg, 'templates/CLAUDE.md', '@AGENTS.md\n');
    put(pkg, 'templates/docs/reference/routing/README.md', '---\nid: routing\n---\n# Routing for {{project.name}} ({{mystery}})\n');

    const snapshot = (root) => walk(root, (full, e) => e.isDirectory() && e.name === '.git').map((f) => posix(path.relative(root, f))).sort();
    const before = snapshot(t);
    const plan = buildPlan(pkg, t, detect(t));
    eq('plan: a complete package has nothing absent', plan.absent, []);
    eq('plan: the unknown placeholder is reported', plan.unrendered, ['doc/reference/routing/README.md: {{mystery}}']);
    ok('plan: the routing doc lands under the target\'s OWN docs root', plan.items.some((it) => it.dest === 'doc/reference/routing/README.md'));
    const dests = plan.items.map((it) => it.dest);
    ok('plan: run output is not installed', !dests.includes('scripts/harness/gates.json') && !dests.includes('scripts/harness/gates.red.test.log'));
    ok('plan: a helper\'s state file is not installed', !dests.includes('.claude/helpers/.state.json'));
    ok('plan: nor a guard\'s, and the guard itself is', !dests.includes('scripts/harness/guards/.state.json') && dests.includes('scripts/harness/guards/guard.cjs'));
    ok('plan: a skill that is not the harness\'s own is not installed', !dests.some((x) => x.includes('vendored')));
    ok('plan: nor an agent that is not', !dests.includes('.claude/agents/someone-elses.md'));
    eq('plan: every destination appears once', dests.length, new Set(dests).size);

    const dry = applyPlan(plan, { dry: true });
    eq('dry run: reports every file as a write', dry.wrote.length, plan.items.length);
    eq('dry run: and writes NOTHING', snapshot(t), before);

    const first = applyPlan(plan, {});
    eq('init: writes the whole plan into a fresh target', first.wrote.length, plan.items.length);
    eq('init: AGENTS.md is rendered with the target\'s name', readText(path.join(t, 'AGENTS.md')), '# web\n');
    eq('init: CLAUDE.md is the stub, byte for byte', readText(path.join(t, 'CLAUDE.md')), '@AGENTS.md\n');
    eq('init: the routing doc is rendered into the docs root', readText(path.join(t, 'doc', 'reference', 'routing', 'README.md')), '---\nid: routing\n---\n# Routing for web ({{mystery}})\n');
    eq('init: the skill lock is empty', readJson(path.join(t, 'skills-lock.json')), { version: 2, skills: {} });
    eq('init: the baseline carries no inherited figure', readJson(path.join(t, 'scripts', 'harness', 'gates.baseline.json')).gates, {});
    // The fake package's baseline is a RECORDED one (`_readme: ['why']`, a commit, a row). None
    // of it may arrive: prose about a recorded verdict does not describe a file with no rows.
    eq('init: nor the package\'s prose about its own recorded verdict', readJson(path.join(t, 'scripts', 'harness', 'gates.baseline.json'))._readme, EMPTY_BASELINE_README);
    // The third figure file. Copied as it stood, a target would print another machine's
    // measured first turn from its own context gate on every run.
    const rep = readJson(path.join(t, 'scripts', 'harness', 'harness-baseline.json'));
    eq('init: the context report carries no inherited measurement', [rep.measured, rep.groundTruth, rep.project], [null, null, undefined]);
    eq('init: the context budget is written for the target, flagged', readJson(path.join(t, 'scripts', 'harness', 'context-budget.json')).placeholder, true);
    ok('init: the written config loads', (() => { try { return CONFIG.load({ root: t, fresh: true }).project.name === 'web'; } catch { return false; } })());

    put(t, 'AGENTS.md', '# edited by a human\n');
    const second = applyPlan(buildPlan(pkg, t, detect(t)), {});
    eq('init again: writes nothing', second.wrote.length + second.overwrote.length, 0);
    eq('init again: skips every file', second.skipped.length, plan.items.length);
    eq('init again: the human\'s edit SURVIVES', readText(path.join(t, 'AGENTS.md')), '# edited by a human\n');

    const only = applyPlan(buildPlan(pkg, t, detect(t)), { force: true, only: 'AGENTS.md' });
    eq('--force --only: overwrites exactly the named file', only.overwrote.map((it) => it.dest), ['AGENTS.md']);
    eq('--force --only: touches nothing else', only.wrote.length + only.kept.length + only.skipped.length, 0);
    const forced = applyPlan(buildPlan(pkg, t, detect(t)), { force: true });
    eq('--force: a file already holding the same bytes is not reported as overwritten', forced.overwrote.length, 0);

    // A MERGE item: it adds to a file that exists without --force, leaves the rest of it, is a
    // no-op the second time, and a file it cannot read is reported before anything is written.
    const mt = path.join(tmp, 'merge-target');
    fs.mkdirSync(mt);
    const addKey = (text) => {
      let v = {};
      if (text !== null) { try { v = JSON.parse(text); } catch { return { refuse: 'it is not valid JSON' }; } }
      if (v.ours === 1) return { text: text };
      return { text: JSON.stringify(Object.assign(v, { ours: 1 })) };
    };
    const mplan = { target: mt, items: [{ dest: 'a/cfg.json', merge: addKey }, { dest: 'plain.txt', content: 'x' }] };
    eq('merge: nothing to refuse on a fresh target', planRefusals(mplan, {}), []);
    eq('merge: a file that is not there is written', applyPlan(mplan, {}).wrote.map((it) => it.dest), ['a/cfg.json', 'plain.txt']);
    eq('merge: a second run changes nothing', (() => { const r = applyPlan(mplan, {}); return [r.wrote.length, r.merged.length, r.skipped.length]; })(), [0, 0, 2]);
    put(mt, 'a/cfg.json', '{"theirs":true}');
    eq('merge: an existing file is merged into WITHOUT --force', applyPlan(mplan, {}).merged.map((it) => it.dest), ['a/cfg.json']);
    eq('merge: and the key that was there survives', readJson(path.join(mt, 'a', 'cfg.json')), { theirs: true, ours: 1 });
    put(mt, 'a/cfg.json', '{ not json');
    eq('merge: a file it cannot read is named before anything is written', planRefusals(mplan, {}), [{ dest: 'a/cfg.json', why: 'it is not valid JSON' }]);
    eq('merge: --only another path does not ask about it', planRefusals(mplan, { only: 'plain.txt' }), []);
    eq('merge: applied anyway, it is refused and the file is left as it was', [applyPlan(mplan, {}).refused.length, readText(path.join(mt, 'a', 'cfg.json'))], [1, '{ not json']);

    const broken = buildPlan(path.join(tmp, 'no-such-package'), t, detect(t));
    ok('plan: an incomplete package names what is absent', broken.absent.includes('.claude/settings.json') && broken.absent.includes('templates/CLAUDE.md') && broken.absent.includes('templates/AGENTS.md') && broken.absent.includes('templates/docs/reference/routing/README.md'));

    // A package that lost ONLY its guards: every sibling script is still there, so nothing
    // but the guards' own entry can notice. Run before doctor, restored after.
    const guardsDir = path.join(pkg, 'scripts', 'harness', 'guards');
    const guardsAside = path.join(tmp, 'guards-aside');
    fs.renameSync(guardsDir, guardsAside);
    eq('plan: a package with no guards is incomplete, and says which piece', buildPlan(pkg, t, detect(t)).absent, ['scripts/harness/guards/']);
    fs.renameSync(guardsAside, guardsDir);

    // ----- doctor, on the tree that was just installed
    const status = (rows, item) => (rows.find((r) => r.item === item) || {}).status;
    const opts = { pkgRoot: pkg, invocation: 'harness', has: all };
    put(t, 'doc/a.md', '---\nid: a\n---\n# a\n');
    let rows = doctor(t, opts);
    eq('doctor: the config is OK', status(rows, CONFIG_NAME), 'OK');
    eq('doctor: the hook script is found', status(rows, 'hook scripts/harness/guards/guard.cjs'), 'OK');
    eq('doctor: an installed helper matches the package', status(rows, 'scripts/harness/guards/guard.cjs'), 'OK');
    eq('doctor: its self-test passes', status(rows, 'self-test scripts/harness/guards/guard.cjs'), 'OK');
    eq('doctor: a gate naming a script that was never installed is MISSING', status(rows, 'gate docs'), 'MISSING');
    eq('doctor: frontmatter is present', status(rows, 'docs frontmatter'), 'OK');
    eq('doctor: caps are obeyed', status(rows, 'line caps'), 'OK');
    // `bare` got a config and nothing else: no docs directory exists there.
    const bareRows = doctor(bare, opts);
    eq('doctor: a docs root that does not exist yet is not a broken install', status(bareRows, 'docs frontmatter'), 'OK');
    eq('doctor: ...and the caps are still graded without it', status(bareRows, 'line caps'), 'OK');
    eq('doctor: the lock is OK', status(rows, 'skills-lock.json'), 'OK');
    ok('doctor: every row that is not OK carries a fix', rows.every((r) => r.status === 'OK' || r.fix));

    put(t, 'doc/b.md', '# no frontmatter\n');
    put(t, 'AGENTS.md', 'line\n'.repeat(81));
    put(t, 'scripts/harness/guards/guard.cjs', 'process.exit(1);\n');
    put(t, 'skills-lock.json', '[]');
    put(t, 'templates/AGENTS.md', 'line\n'.repeat(51));
    put(t, 'templates/CLAUDE.md', 'line\n'.repeat(51));
    put(t, 'dist/AGENTS.md', 'line\n'.repeat(51));
    rows = doctor(t, opts);
    eq('doctor: a doc with no frontmatter is DRIFTED', status(rows, 'docs frontmatter doc/b.md'), 'DRIFTED');
    eq('doctor: a file over its cap is DRIFTED', status(rows, 'line cap AGENTS.md'), 'DRIFTED');
    eq('doctor: an AGENTS.md under templates/ is capped like any other, because a tool loads it on touch',
      status(rows, 'line cap templates/AGENTS.md'), 'DRIFTED');
    eq('doctor: ...and so is a stub beside it that grew a body',
      status(rows, 'line cap templates/CLAUDE.md'), 'DRIFTED');
    eq('doctor: ...and one inside build output is not swept, as the doc gate does not sweep it',
      status(rows, 'line cap dist/AGENTS.md'), undefined);
    eq('doctor: an edited helper is DRIFTED from the package', status(rows, 'scripts/harness/guards/guard.cjs'), 'DRIFTED');
    eq('doctor: ...and names the one command that restores it', rows.find((r) => r.item === 'scripts/harness/guards/guard.cjs').fix, 'harness init --force --only scripts/harness/guards/guard.cjs');
    eq('doctor: a lock that is not a lock is DRIFTED', status(rows, 'skills-lock.json'), 'DRIFTED');

    fs.unlinkSync(path.join(t, 'scripts', 'harness', 'guards', 'guard.cjs'));
    put(t, CONFIG_NAME, '{ "project": }');
    rows = doctor(t, opts);
    eq('doctor: a deleted hook script is MISSING', status(rows, 'hook scripts/harness/guards/guard.cjs'), 'MISSING');
    eq('doctor: an unparseable config is DRIFTED, not a crash', status(rows, CONFIG_NAME), 'DRIFTED');
    fs.unlinkSync(path.join(t, CONFIG_NAME));
    eq('doctor: no config at all is MISSING', status(doctor(t, opts), CONFIG_NAME), 'MISSING');

    // ----- the host report never throws, with or without a config
    ok('host: reports on a tree with no config', hostReport(t, all).some((l) => l.startsWith('absent: a valid ' + CONFIG_NAME)));
    ok('host: names the runtime', hostReport(bare, all)[0].startsWith('node v'));

    // ----- this package states what it claims
    const own = readJson(path.join(PKG_ROOT, 'package.json'));
    if (own) {
      eq('package.json: zero dependencies', Object.keys(own.dependencies || {}).length, 0);
      eq('package.json: zero devDependencies', Object.keys(own.devDependencies || {}).length, 0);
      ok('package.json: the bin entry is this file', own.bin && path.resolve(PKG_ROOT, own.bin.harness) === path.resolve(__filename));
    }
    // The ignore rules are graded by EFFECT, so check the text init writes really has it.
    const ig = path.join(tmp, 'ignore-probe');
    fs.mkdirSync(ig);
    if (spawnSync('git', ['init', '-q'], { cwd: ig, windowsHide: true }).status === 0) {
      // Not "every gap": a machine-wide excludes file may already cover some of them.
      ok('ignore: a repo with no .gitignore has gaps', ignoreGaps(ig, guarded).some((r) => r.probe === 'scripts/harness/gates.json'));
      put(ig, '.gitignore', gitignoreText(guarded));
      eq('ignore: the file init writes closes all of them', ignoreGaps(ig, guarded), []);
    }
  } catch (e) {
    fails.push('the self-test threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? '\nFAIL — harness.js self-test: ' + fails.length + ' of ' + n + ' assertion(s)'
    : 'PASS — harness.js self-test (' + n + ' assertions: detect, plan, dry-run, no-overwrite, --force, doctor OK/MISSING/DRIFTED, declared skips)');
  return fails.length ? 1 : 0;
}

module.exports = { detect, buildConfig, buildPlan, applyPlan, planRefusals, toolsArgError, render, doctor, gateResolvable, hookScripts,
  hookCommands, declaredSkips, configSkips, hostReport, requiredIgnores, SHIPPED_AGENTS, SHIPPED_SKILLS, TRACK_TEMPLATES };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  let code;
  if (argv.includes('--self-test') && (!cmd || cmd.startsWith('--'))) code = selfTest();
  else if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(HELP); code = 0; }
  else if (cmd === 'init') code = cmdInit(rest);
  else if (cmd === 'doctor') code = cmdDoctor(rest);
  else if (cmd === 'gates') code = cmdGates(rest);
  else if (cmd === 'docs') code = cmdDocs(rest);
  else if (cmd === 'run') code = cmdRun(rest);
  else if (cmd === 'worktree') code = cmdWorktree(rest);
  else if (cmd === 'host') { for (const l of hostReport(findRoot(process.cwd()))) console.log(l); code = 0; }
  else if (cmd === 'selftest' || cmd === 'self-test') code = cmdSelftest();
  else code = stop('unknown command `' + cmd + '`', 'harness --help');
  process.exit(code);
}
