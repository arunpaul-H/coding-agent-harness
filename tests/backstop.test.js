'use strict';
/* ============================================================
   backstop.test.js — the git-hook backstop and the enforcement matrix, as PROCESSES.

   scripts/harness/githooks.js and the matrix half of scripts/harness/tools.js drive their
   decisions with literals in their own --self-test. What that cannot reach is the part a user
   touches: a real git repository with a real hook directory, the installed copy of the harness
   printing its own matrix, and the two things the matrix must never do, which are to call a
   backstop a deny and to give a mechanism to a tool the harness does not wire.

   Tool ids appear here as DATA, read off the registry by the property a case needs, exactly as
   tests/wire.test.js does. NOTHING HERE RUNS A CODING AGENT, and no git hook is ever fired by a
   real commit: a hook is checked for what it holds and for what the matrix then says.
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'harness.js');
const WIRE = require(path.join(ROOT, 'scripts', 'harness', 'wire.js'));
const TOOLS = require(path.join(ROOT, 'scripts', 'harness', 'tools.js'));
const GIT = require(path.join(ROOT, 'scripts', 'harness', 'githooks.js'));
const HOOK = require(path.join(ROOT, 'scripts', 'harness', 'hook.js'));
const CONFIG = require(path.join(ROOT, 'scripts', 'harness', 'config.js'));
const REG = TOOLS.readRegistry();
const DEFAULT = CONFIG.DEFAULTS.tools.enabled;

const dialectOf = (row) => (typeof row.dialect === 'string' ? require(path.join(ROOT, 'scripts', 'harness', 'dialects', row.dialect + '.js')) : null);
const wiringOf = (row) => (WIRE.unwiredReason(row, dialectOf(row)) ? null : WIRE.wiringFor(row, dialectOf(row)));
const ROWS = REG.tools.filter((r) => r.tier !== 'inherits' && !(r.policy.mode === 'native' && r.policy.file !== TOOLS.POLICY_FILE));
// A wired row whose registration carries no write, and a row with a dialect the harness cannot wire.
const PARTIAL = ROWS.find((r) => wiringOf(r) && !wiringOf(r).actions.includes('write'));
const UNWIRED = ROWS.find((r) => typeof r.dialect === 'string' && r.projectHooks === true && !wiringOf(r) && r.policy.mode === 'native');

function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_TEST_CONTEXT;
  return env;
}
const run = (args, cwd) => {
  const r = spawnSync(process.execPath, [BIN].concat(args), { cwd: cwd || ROOT, encoding: 'utf8', env: cleanEnv() });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
};
const made = [];
function tempRepo(files, opts) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-backstop-test-')));
  made.push(dir);
  if (!(opts && opts.noGit)) spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(Object.assign({ 'package.json': JSON.stringify({ name: 'acme-api' }) }, files || {}))) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return dir;
}
const at = (dir, rel) => path.join(dir, ...rel.split('/'));
const hookFile = (dir, name) => path.join(dir, '.git', 'hooks', name);
const readHook = (dir, name) => { try { return fs.readFileSync(hookFile(dir, name), 'utf8'); } catch { return null; } };
const matrix = (dir) => {
  const r = spawnSync(process.execPath, [at(dir, 'scripts/harness/tools.js'), '--matrix'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
};
/** The cells of one tool's block, as { ruleId: cell }. */
function cellsOf(out, id) {
  const lines = out.split('\n');
  const start = lines.findIndex((l) => l.startsWith(id + '   tier '));
  assert.ok(start >= 0, 'no block for ' + id + ':\n' + out);
  const cells = {};
  for (let i = start + 1; i < lines.length && lines[i].trim(); i += 1) {
    const m = /^ {2}([a-z][a-z0-9-]*) {2,}(.+)$/.exec(lines[i]);
    if (m && TOOLS.RULES.some((r) => r.id === m[1])) cells[m[1]] = m[2];
  }
  return cells;
}
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

describe('githooks.js (the script)', () => {
  test('--self-test passes', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'harness', 'githooks.js'), '--self-test'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS — githooks\.js self-test \(\d+ checks\)/);
  });
  test('any other command line is a usage error, not a silent pass', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'harness', 'githooks.js')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 2);
  });
  test('the registry still holds the two kinds of row these tests are written against', () => {
    assert.ok(PARTIAL, 'no wired row whose registration carries no write');
    assert.ok(UNWIRED, 'no row with a dialect that the harness does not wire');
  });
});

describe('harness init: the git hooks are opt-in', () => {
  test('WITHOUT the flag nothing is written to the hook directory, and the commands are printed', () => {
    const dir = tempRepo();
    const before = fs.readdirSync(path.join(dir, '.git', 'hooks')).sort();
    const r = run(['init', '--into', dir]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.git', 'hooks')).sort(), before);
    assert.match(r.out, /\nGIT HOOKS — not installed\. They are opt-in: `.* init --git-hooks` writes the two below and never replaces a hook that exists\./);
    for (const h of GIT.HOOKS) assert.ok(r.out.includes('  ' + h.name.padEnd(10) + '  ' + GIT.commandOf(h.name, 'reproducible-build=1')), h.name + ' is not offered with its command');
    assert.match(r.out, /a backstop, not a deny/);
  });

  test('WITH the flag it writes both, each running its one command, and a second run changes neither', () => {
    const dir = tempRepo();
    const r = run(['init', '--into', dir, '--git-hooks']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    for (const h of GIT.HOOKS) {
      const text = readHook(dir, h.name);
      assert.ok(text, h.name + ' was not written');
      assert.strictEqual(text, GIT.hookText(h.name, 'reproducible-build=1'));
      assert.ok(GIT.runsCommand(text, GIT.commandOf(h.name, '')));
      assert.match(r.out, new RegExp('\\n {2}WROTE {3}\\.git/hooks/' + h.name + ' {3}node '));
      if (process.platform !== 'win32') assert.ok((fs.statSync(hookFile(dir, h.name)).mode & 0o111) !== 0, h.name + ' is not executable');
    }
    assert.deepStrictEqual(GIT.standing(dir), { commit: true, push: true });
    const again = run(['init', '--into', dir, '--git-hooks']);
    assert.strictEqual(again.code, 0, again.out + again.err);
    assert.match(again.out, /UNCHANGED \(already identical\) {3}\.git\/hooks\/pre-commit/);
    assert.doesNotMatch(again.out, /\n {2}WROTE {3}\.git\/hooks\//);
    for (const h of GIT.HOOKS) assert.strictEqual(readHook(dir, h.name), GIT.hookText(h.name, 'reproducible-build=1'));
  });

  test('--dry-run with the flag says what it would write and writes nothing', () => {
    const dir = tempRepo();
    const r = run(['init', '--into', dir, '--git-hooks', '--dry-run']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /WOULD WRITE {3}\.git\/hooks\/pre-push/);
    for (const h of GIT.HOOKS) assert.strictEqual(readHook(dir, h.name), null);
  });

  test('a hook that EXISTS is never replaced, not even with --force: it is named, with the line to add', () => {
    const mine = '#!/bin/sh\nnpx lint-staged\n';
    const dir = tempRepo();
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(hookFile(dir, 'pre-commit'), mine);
    const r = run(['init', '--into', dir, '--git-hooks', '--force']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.strictEqual(readHook(dir, 'pre-commit'), mine);
    assert.ok(r.out.includes('LEFT ALONE — a hook is already there and is yours; add this line to it yourself   .git/hooks/pre-commit   ' + GIT.REPORT + ' || exit 1'), r.out);
    // The other hook is still written, and only that one stands.
    assert.ok(readHook(dir, 'pre-push'));
    assert.deepStrictEqual(GIT.standing(dir), { commit: false, push: true });
  });

  test('a user hook that already runs the command has nothing added, and counts as standing', () => {
    const mine = '#!/bin/sh\nnpx lint-staged\n' + GIT.REPORT + ' || exit 1\n';
    const dir = tempRepo();
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(hookFile(dir, 'pre-commit'), mine, { mode: 0o755 });
    const r = run(['init', '--into', dir, '--git-hooks']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.strictEqual(readHook(dir, 'pre-commit'), mine);
    assert.match(r.out, /LEFT ALONE — your hook already runs it {3}\.git\/hooks\/pre-commit/);
    assert.strictEqual(GIT.standing(dir).commit, true);
  });

  test('a repo with core.hooksPath set is LEFT ALONE and told why, flag or no flag', () => {
    const dir = tempRepo();
    spawnSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: dir });
    const r = run(['init', '--into', dir, '--git-hooks']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /\nGIT HOOKS — NOT WRITTEN: `core\.hooksPath` is set to `\.husky`/);
    assert.ok(r.out.includes('by hand, where your hooks live:   ' + GIT.REPORT + ' || exit 1'));
    assert.ok(!fs.existsSync(at(dir, '.husky')), 'a hook was written into the directory the repo chose for itself');
    for (const h of GIT.HOOKS) assert.strictEqual(readHook(dir, h.name), null);
  });

  test('a directory that is not a git repository gets no hook and is told so', () => {
    const dir = tempRepo({}, { noGit: true });
    // A temp directory can sit inside somebody's repository; only a bare one proves the case.
    if (GIT.gitFacts(dir).repo) return;
    const r = run(['init', '--into', dir, '--git-hooks']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /GIT HOOKS — NOT WRITTEN: this is not a git repository/);
    assert.ok(!fs.existsSync(at(dir, '.git')));
  });
});

describe('the `tools` gate', () => {
  test('this repo\'s suite and the config init writes both run the registry check', () => {
    const cmd = 'node scripts/harness/tools.js --check';
    assert.deepStrictEqual(CONFIG.load({ root: ROOT, fresh: true }).gates.filter((g) => g.name === 'tools').map((g) => g.command), [cmd]);
    const dir = tempRepo();
    assert.strictEqual(run(['init', '--into', dir]).code, 0);
    const gates = JSON.parse(fs.readFileSync(at(dir, 'harness.config.json'), 'utf8')).gates;
    assert.deepStrictEqual(gates.filter((g) => g.name === 'tools'), [{ name: 'tools', command: cmd }]);
    // ...and in the installed copy that command ends in the GATE line the runner parses.
    const r = spawnSync(process.execPath, [at(dir, 'scripts/harness/tools.js'), '--check'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout.trim().split('\n').pop(), /^GATE tools pass=\d+ fail=0 skipped=0$/);
  });
});

describe('tools.js --matrix', () => {
  test('the rule table has one row per hard rule of the policy file, and names only handlers that exist', () => {
    const policy = fs.readFileSync(path.join(ROOT, TOOLS.POLICY_FILE), 'utf8').replace(/\r\n/g, '\n');
    const section = policy.slice(policy.indexOf('\n## 3. '), policy.indexOf('\n## 4. '));
    const bullets = section.split('\n').filter((l) => /^- \*\*/.test(l));
    assert.ok(bullets.length > 0, 'section 3 of the policy file was not found');
    assert.strictEqual(TOOLS.RULES.length, bullets.length, 'the policy file has ' + bullets.length + ' hard rules and the matrix has ' + TOOLS.RULES.length + ' rows');
    const guards = HOOK.HANDLERS['pre-tool'].map((h) => h.name);
    const reporters = HOOK.HANDLERS['session-start'].map((h) => h.name);
    const gates = CONFIG.load({ root: ROOT, fresh: true }).gates.map((g) => g.name);
    for (const r of TOOLS.RULES) {
      for (const m of r.by) {
        if (m.guard) assert.ok(guards.includes(m.guard), r.id + ' names a pre-tool handler that is not in the table: ' + m.guard);
        if (m.report) assert.ok(reporters.includes(m.report), r.id + ' names a reporter that is not in the table: ' + m.report);
        if (m.gate) assert.ok(gates.includes(m.gate), r.id + ' names a gate this repo does not run: ' + m.gate);
      }
    }
  });

  test('on this repo it is green, covers every enabled tool and every rule, and is not a gate', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'harness', 'tools.js'), '--matrix'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    for (const id of CONFIG.load({ root: ROOT, fresh: true }).tools.enabled) {
      assert.deepStrictEqual(Object.keys(cellsOf(r.stdout, id)), TOOLS.RULES.map((x) => x.id));
    }
    assert.doesNotMatch(r.stdout, /^GATE /m);
    assert.doesNotMatch(r.stdout, /\bverified\b/i);
  });

  test('a mode beside it is a usage error', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'harness', 'tools.js'), '--matrix', '--check'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 2);
    assert.doesNotMatch(r.stdout, /ENFORCEMENT MATRIX|GATE tools/);
  });

  test('a tool the harness does NOT wire gets no deny and no report in any cell', () => {
    const dir = tempRepo();
    assert.strictEqual(run(['init', '--into', dir, '--tools', [DEFAULT[0], UNWIRED.id].join(',')]).code, 0);
    const m = matrix(dir);
    assert.strictEqual(m.code, 0, m.out + m.err);
    assert.match(m.out, new RegExp('\\n' + UNWIRED.id + ' {3}tier ' + UNWIRED.tier + ', evidence docs \\(NOT run here'));
    assert.match(m.out, /\n {2}NO HOOK IS WIRED: no shape is recorded for /);
    const cells = cellsOf(m.out, UNWIRED.id);
    for (const [rule, cell] of Object.entries(cells)) assert.doesNotMatch(cell, /\bdeny\b|\breport\b|deny list/, rule + ' claims a mechanism for a tool with no hook: ' + cell);
    // A rule only a guard enforces is prose there, and is a deny under the tool that IS wired.
    const guardOnly = TOOLS.RULES.find((r) => r.by.every((x) => x.guard));
    assert.strictEqual(cells[guardOnly.id], 'prose');
    assert.match(cellsOf(m.out, DEFAULT[0])[guardOnly.id], /^deny /);
  });

  test('a wired tool whose registration carries no write: a rule about a written file is not a deny there', () => {
    const dir = tempRepo();
    assert.strictEqual(run(['init', '--into', dir, '--tools', [DEFAULT[0], PARTIAL.id].join(',')]).code, 0);
    const m = matrix(dir);
    assert.strictEqual(m.code, 0, m.out + m.err);
    const cells = cellsOf(m.out, PARTIAL.id);
    const full = cellsOf(m.out, DEFAULT[0]);
    const writeOnly = TOOLS.RULES.find((r) => r.by.some((x) => x.guard && x.on.join() === 'write'));
    assert.match(full[writeOnly.id], /^deny \S+ \[write\]/);
    assert.doesNotMatch(cells[writeOnly.id], /\bdeny\b/, cells[writeOnly.id]);
    // A rule over a shell call AND a write names the half that reaches no guard.
    const both = TOOLS.RULES.find((r) => r.by.length === 1 && r.by[0].guard && r.by[0].on.includes('shell') && r.by[0].on.includes('write'));
    assert.match(cells[both.id], /^deny \S+ \[shell\] \(NOT write\)$/);
    // No cell under it claims an action its registration does not carry.
    const carried = wiringOf(PARTIAL).actions;
    for (const cell of Object.values(cells)) {
      for (const m2 of cell.matchAll(/deny \S+ \[([a-z,]+)\]/g)) assert.deepStrictEqual(m2[1].split(',').filter((a) => !carried.includes(a)), []);
    }
  });

  test('a registration that was REMOVED is no longer a mechanism: the matrix reads the file, not the registry', () => {
    const dir = tempRepo();
    assert.strictEqual(run(['init', '--into', dir]).code, 0);
    const row = TOOLS.enabledRows(REG, DEFAULT)[0];
    assert.match(Object.values(cellsOf(matrix(dir).out, row.id)).join('\n'), /\bdeny\b/);
    fs.writeFileSync(at(dir, row.hookConfig), '{}\n');
    const m = matrix(dir);
    assert.strictEqual(m.code, 0, m.out + m.err);
    assert.match(m.out, /NO HOOK IS WIRED: .* does not register the hook entry as `/);
    for (const cell of Object.values(cellsOf(m.out, row.id))) assert.doesNotMatch(cell, /\bdeny \S+ \[|\breport\b/, cell);
  });

  test('with the git hooks standing a gate becomes a BACKSTOP, at commit or at push, and is never spelled as a deny', () => {
    const dir = tempRepo();
    assert.strictEqual(run(['init', '--into', dir, '--tools', UNWIRED.id]).code, 0);
    const before = matrix(dir);
    assert.match(before.out, /\ngit hooks: pre-commit not installed, pre-push not installed {3}\(opt-in: harness init --git-hooks\)/);
    assert.doesNotMatch(Object.values(cellsOf(before.out, UNWIRED.id)).join('\n'), /backstop/);

    assert.strictEqual(run(['init', '--into', dir, '--git-hooks']).code, 0);
    const m = matrix(dir);
    assert.strictEqual(m.code, 0, m.out + m.err);
    assert.match(m.out, /\ngit hooks: pre-commit standing, pre-push standing\n/);
    const cells = cellsOf(m.out, UNWIRED.id);
    const gateRule = (name) => TOOLS.RULES.find((r) => r.by.length === 1 && r.by[0].gate === name);
    const commitRule = TOOLS.RULES.find((r) => r.by.some((x) => x.gate === 'hygiene'));
    assert.strictEqual(cells[commitRule.id], 'backstop: gate hygiene at commit');
    assert.strictEqual(cells[gateRule('context').id], 'backstop: gate context at push');
    for (const [rule, cell] of Object.entries(cells)) assert.doesNotMatch(cell, /\bdeny\b/, rule + ' turns a backstop into a deny: ' + cell);
    // A rule no gate and no hook reaches is still prose, hooks or not.
    const guardOnly = TOOLS.RULES.find((r) => r.by.every((x) => x.guard));
    assert.strictEqual(cells[guardOnly.id], 'prose');
  });
});
