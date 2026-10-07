'use strict';
/* ============================================================
   cli.test.js — bin/harness.js, driven as a PROCESS.

   The CLI's own `--self-test` drives its decisions as functions, against a fake
   package. What that cannot reach is the part a user actually touches: the exit
   code, the text on stdout, and an install FROM THE REAL PACKAGE into a real
   directory. So this file runs the real binary, into a throwaway repo, and reads
   what it printed and what it left on disk.

   Never against this repo: `init` refuses the package as its own target, and that
   refusal is one of the things tested here.
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'harness.js');

// Inherited, CLAUDE_PROJECT_DIR would point config.js at the real repo, and
// NODE_TEST_CONTEXT would switch any nested `node --test` to the child reporter.
function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_TEST_CONTEXT;
  return env;
}
function run(args, cwd) {
  const r = spawnSync(process.execPath, [BIN].concat(args), { cwd: cwd || ROOT, encoding: 'utf8', env: cleanEnv() });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}
const made = [];
function tempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-test-'));
  made.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(files || {})) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return dir;
}
function listing(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full); else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

describe('harness (the binary)', () => {
  test('--self-test passes and says what it checked', () => {
    const r = run(['--self-test']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /PASS — harness\.js self-test \(\d+ assertions/);
  });

  test('--help names every command', () => {
    const r = run(['--help']);
    assert.strictEqual(r.code, 0);
    for (const c of ['harness init', 'harness doctor', 'harness gates', 'harness docs', 'harness selftest']) assert.ok(r.out.includes(c), c);
  });

  test('an unknown command is exit 1 with a fix line, not a silent help screen', () => {
    const r = run(['frobnicate']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /FATAL — unknown command `frobnicate`/);
    assert.match(r.err, /fix: harness --help/);
  });

  test('package.json: zero dependencies, public, and the bin it names exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.deepStrictEqual(pkg.dependencies, {});
    assert.deepStrictEqual(pkg.devDependencies, {});
    assert.notStrictEqual(pkg.private, true);
    assert.strictEqual(pkg.name, 'agent-harness');
    assert.ok(fs.existsSync(path.join(ROOT, pkg.bin.harness)));
    for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f + ' must not exist');
  });
});

describe('harness init (from the real package)', () => {
  test('refuses the package itself as a target', () => {
    const r = run(['init', '--into', ROOT, '--dry-run']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /the target is the harness package itself/);
  });

  test('a package that lost its guards is FATAL, and nothing is written', () => {
    // The sibling scripts are all still there, so only the guards' own plan entry can
    // notice. Without it this installs seven hook commands pointing at nothing, exit 0.
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-pkg-'));
    made.push(pkg);
    for (const piece of ['bin', '.claude', 'scripts', 'schema', 'templates', 'package.json']) {
      fs.cpSync(path.join(ROOT, piece), path.join(pkg, piece), { recursive: true });
    }
    fs.rmSync(path.join(pkg, 'scripts', 'harness', 'guards'), { recursive: true, force: true });
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }) });
    const before = listing(dir);
    const r = spawnSync(process.execPath, [path.join(pkg, 'bin', 'harness.js'), 'init', '--into', dir], { cwd: pkg, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /ABSENT FROM PACKAGE {2}scripts\/harness\/guards\//);
    assert.match(r.stderr, /FATAL — this copy of agent-harness is incomplete \(1 piece/);
    assert.deepStrictEqual(listing(dir), before, 'an incomplete package still wrote into the target');
  });

  test('--dry-run prints the plan and writes nothing', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api', scripts: { test: 'node --test' } }) });
    const before = listing(dir);
    const r = run(['init', '--into', dir, '--dry-run']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /DRY RUN: nothing is written/);
    assert.match(r.out, /WOULD WRITE \(\d+\)/);
    assert.deepStrictEqual(listing(dir), before);
  });

  test('a repo with no commit yet reports the branch HEAD names, not init.defaultBranch', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api', scripts: { test: 'node --test' } }) });
    // An unborn branch with its own name, and a repo-level setting that says otherwise.
    spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/trunk'], { cwd: dir });
    spawnSync('git', ['config', 'init.defaultBranch', 'elsewhere'], { cwd: dir });
    const r = run(['init', '--into', dir, '--dry-run']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /default branch\s+trunk\s+<- the unborn branch HEAD names/);
  });

  test('installs, reports what it detected, and ends with the four next commands', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api', scripts: { test: 'node --test' } }) });
    const r = run(['init', '--into', dir]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /project name\s+acme-api/);
    assert.match(r.out, /test command\s+node --test\s+\[node-test\]/);
    assert.match(r.out, /NEXT — four commands/);
    assert.match(r.out, /1\. .* doctor/);
    // init writes neither the doc index nor the registry block, so the step that does is named.
    assert.match(r.out, /2\. node scripts\/harness\/docs-index\.js && node scripts\/harness\/docs-index\.js --agents/);
    assert.match(r.out, /3\. node scripts\/harness\/gates\.js --check --allow-skip reproducible-build=1/);
    assert.match(r.out, /4\. node scripts\/harness\/gates\.js --accept --allow-skip reproducible-build=1/);
    assert.match(r.out, /here AND in step 4/);

    const files = listing(dir);
    for (const f of ['.claude/settings.json', 'scripts/harness/guards/env-guard.cjs', 'scripts/harness/gates.js',
      'scripts/harness/config.js', 'scripts/harness/tools.js', 'scripts/harness/tools.json', 'harness.config.json', 'skills-lock.json',
      'CLAUDE.md', 'AGENTS.md', 'docs/reference/routing/README.md',
      'templates/track/handoff.md', 'schema/harness.config.schema.json', '.gitignore']) {
      assert.ok(files.includes(f), 'expected ' + f + ' to be installed');
    }
    assert.ok(!files.includes('scripts/harness/gates.json'), 'run output must not be installed');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'skills-lock.json'), 'utf8')), { version: 2, skills: {} });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scripts', 'harness', 'gates.baseline.json'), 'utf8')).gates, {});
    // ONE policy body: AGENTS.md carries the rendered policy, CLAUDE.md is the stub importing it.
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /^# acme-api/);
    const stub = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    assert.strictEqual(stub, '@AGENTS.md', 'the installed CLAUDE.md is not a bare import of the policy file');
    const routing = fs.readFileSync(path.join(dir, 'docs', 'reference', 'routing', 'README.md'), 'utf8');
    assert.match(routing, /^---\nid: routing\n/, 'the routing doc was installed without its frontmatter');
    assert.ok(routing.includes('<!-- agents:begin -->') && routing.includes('<!-- agents:end -->'), 'the routing doc lost the registry markers');

    // The config it generated is one the INSTALLED loader accepts, from the installed tree.
    const cfg = spawnSync(process.execPath, [path.join(dir, 'scripts', 'harness', 'config.js')], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(cfg.status, 0, cfg.stderr);
    assert.strictEqual(JSON.parse(cfg.stdout).project.name, 'acme-api');
  });

  test('a second run overwrites nothing, and --force --only replaces exactly one file', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }) });
    assert.strictEqual(run(['init', '--into', dir]).code, 0);
    const claude = path.join(dir, 'AGENTS.md');
    const config = path.join(dir, 'harness.config.json');
    fs.writeFileSync(claude, '# mine now\n');
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('"acme-api"', '"renamed"'));

    const again = run(['init', '--into', dir]);
    assert.strictEqual(again.code, 0);
    assert.match(again.out, /Nothing to write/);
    assert.match(again.out, /SKIPPED — exists, not overwritten/);
    assert.strictEqual(fs.readFileSync(claude, 'utf8'), '# mine now\n');

    const forced = run(['init', '--into', dir, '--force', '--only', 'AGENTS.md']);
    assert.strictEqual(forced.code, 0);
    assert.match(forced.out, /OVERWROTE \(--force\) \(1\)/);
    assert.match(fs.readFileSync(claude, 'utf8'), /^# acme-api/);
    assert.match(fs.readFileSync(config, 'utf8'), /"renamed"/, '--only must leave every other file alone');
  });

  test('a flag it does not know is refused and nothing is written', () => {
    // `--dryrun` read as nothing would be a real install the caller believed was a rehearsal.
    const dir = tempRepo({});
    const before = listing(dir);
    const typo = run(['init', '--into', dir, '--dryrun']);
    assert.strictEqual(typo.code, 1);
    assert.match(typo.err, /FATAL — unknown flag `--dryrun`/);
    const noValue = run(['init', '--into'], dir);
    assert.strictEqual(noValue.code, 1);
    assert.match(noValue.err, /--into needs a value/);
    assert.deepStrictEqual(listing(dir), before);
  });

  test('a fresh install is HEALTHY, and its context and doc gates grade its own instruction files', () => {
    // No figure inherited, and the one doc init writes (the routing reference) carries its
    // frontmatter: the things that used to leave a new install unhealthy and red before its
    // owner had typed anything.
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }) });
    assert.strictEqual(run(['init', '--into', dir]).code, 0);
    const healthy = run(['doctor', '--root', dir, '--no-self-tests']);
    assert.strictEqual(healthy.code, 0, healthy.out);
    assert.match(healthy.out, /1 doc\(s\) under docs\/, each opens with a frontmatter block/);

    const budget = JSON.parse(fs.readFileSync(path.join(dir, 'scripts', 'harness', 'context-budget.json'), 'utf8'));
    assert.strictEqual(budget.placeholder, true);
    assert.deepStrictEqual(Object.keys(budget.ceilings.nestedOnTouch), [], 'the package\'s own nested row must not travel');
    assert.deepStrictEqual(Object.keys(budget.ceilings.injected), ['AGENTS.md', 'CLAUDE.md'], 'the policy file and its stub are what every agent holds');
    assert.deepStrictEqual(Object.keys(budget.ceilings.policyReads), ['docs/reference/routing/README.md'], 'the routing doc is the lead-only read');

    spawnSync('git', ['add', '-A'], { cwd: dir });
    const gate = spawnSync(process.execPath, [path.join(dir, 'scripts', 'harness', 'measure-context.js'), '--check'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(gate.status, 0, gate.stdout + gate.stderr);
    assert.match(gate.stdout.trim().split('\n').pop(), /^GATE context pass=\d+ fail=0 skipped=0$/);
    assert.match(gate.stdout, /placeholder/);

    // The REAL doc gate, on the files init rendered: the shipped stub is a pointer by rule 12's
    // own decision and inside its line cap, and the policy file has its stub beside it.
    const node = (rel, args) => spawnSync(process.execPath, [path.join(dir, ...rel.split('/'))].concat(args || []), { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    const lint = node('scripts/harness/guards/docs-lint.cjs');
    assert.strictEqual(lint.status, 0, lint.stdout + lint.stderr);
    assert.match(lint.stdout.trim().split('\n').pop(), /^GATE docs pass=\d+ fail=0 skipped=\d+$/);
    assert.doesNotMatch(lint.stdout + lint.stderr, /import stub:|policy file:|lines > cap/);
    // ...and it is not vacuous there: a rule typed into the installed stub is caught.
    const stubPath = path.join(dir, 'CLAUDE.md');
    const stubText = fs.readFileSync(stubPath, 'utf8');
    fs.writeFileSync(stubPath, stubText + '- Never push to main.\n');
    assert.match(node('scripts/harness/guards/docs-lint.cjs').stderr, /FAIL {2}CLAUDE\.md: import stub: 1 content line/);
    fs.writeFileSync(stubPath, stubText);

    // Step 2 of NEXT. Before it the index check is red; after it the map exists and the registry
    // block holds a row per installed agent file, inside the budget init wrote for it.
    assert.strictEqual(node('scripts/harness/docs-index.js', ['--check']).status, 1, 'a fresh install has no doc index yet');
    assert.strictEqual(node('scripts/harness/docs-index.js').status, 0);
    assert.strictEqual(node('scripts/harness/docs-index.js', ['--agents']).status, 0);
    const checked = node('scripts/harness/docs-index.js', ['--check']);
    assert.strictEqual(checked.status, 0, checked.stdout + checked.stderr);
    const block = fs.readFileSync(path.join(dir, 'docs', 'reference', 'routing', 'README.md'), 'utf8');
    for (const a of ['explore', 'implement', 'research', 'review']) assert.ok(block.includes('| `' + a + '` |'), 'no registry row for ' + a);
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const after = node('scripts/harness/measure-context.js', ['--check']);
    assert.strictEqual(after.status, 0, after.stdout + after.stderr);
    assert.strictEqual(node('scripts/harness/guards/docs-lint.cjs').status, 0);
  });

  test('the rendered policy points at the docs root init DETECTED, not at a literal one', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }), 'doc/notes.md': '---\nid: notes\nkind: reference\nstatus: open\nread_when: "x"\n---\n# notes\n' });
    const r = run(['init', '--into', dir]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /docs root\s+doc\s/);
    const policy = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(policy.includes('`doc/INDEX.md` is the map'), 'the policy names a map that is not where the index is written');
    assert.ok(policy.includes('`doc/tracks/<id>/handoff.md`'), 'the policy names a tracks dir the config does not');
    assert.ok(policy.includes('`doc/reference/routing/README.md`'));
    assert.doesNotMatch(policy, /docs\/(INDEX|tracks|reference)/);
    // The generator writes the index exactly where the policy says the map is.
    const gen = spawnSync(process.execPath, [path.join(dir, 'scripts', 'harness', 'docs-index.js')], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(gen.status, 0, gen.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'doc', 'INDEX.md')));
  });

  test('with no test command it writes no test gate and says so', () => {
    const dir = tempRepo({});
    const r = run(['init', '--into', dir]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /NO TEST GATE/);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'harness.config.json'), 'utf8'));
    assert.ok(!cfg.gates.some((g) => g.name === 'test'));
  });
});

describe('harness doctor (on an installed tree)', () => {
  test('the exit code is the verdict, and every finding carries a fix', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }), 'docs/a.md': '---\nid: a\n---\n# a\n' });
    assert.strictEqual(run(['init', '--into', dir]).code, 0);

    const healthy = run(['doctor', '--root', dir, '--no-self-tests']);
    assert.strictEqual(healthy.code, 0, healthy.out);
    assert.match(healthy.out, /\nHEALTHY — ok=\d+ missing=0 drifted=0/);
    assert.match(healthy.out.trim().split('\n').pop(), /^GATE doctor pass=\d+ fail=0 skipped=0$/);

    // DRIFTED: a helper edited in place. MISSING: a hook script deleted.
    fs.appendFileSync(path.join(dir, '.claude', 'helpers', 'statusline.cjs'), '\n// edited\n');
    fs.unlinkSync(path.join(dir, 'scripts', 'harness', 'guards', 'phase-guard.cjs'));
    const sick = run(['doctor', '--root', dir, '--no-self-tests']);
    assert.strictEqual(sick.code, 1);
    assert.match(sick.out, /DRIFTED \.claude\/helpers\/statusline\.cjs/);
    assert.match(sick.out, /fix: .* init --force --only \.claude\/helpers\/statusline\.cjs/);
    assert.match(sick.out, /MISSING hook scripts\/harness\/guards\/phase-guard\.cjs/);
    assert.match(sick.out, /NOT HEALTHY/);
    const lines = sick.out.split('\n');
    lines.forEach((line, i) => {
      if (/^(MISSING|DRIFTED)\s/.test(line)) assert.match(lines[i + 1] || '', /^\s+fix: \S/, 'no fix line under: ' + line);
    });

    // And the fix it names is the fix: init puts the missing piece back.
    assert.strictEqual(run(['init', '--into', dir]).code, 0);
    assert.ok(fs.existsSync(path.join(dir, 'scripts', 'harness', 'guards', 'phase-guard.cjs')));
  });

  test('a tree with no config is MISSING, exit 1, and points at init', () => {
    const dir = tempRepo({});
    const r = run(['doctor', '--root', dir, '--no-self-tests']);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /MISSING harness\.config\.json/);
    assert.match(r.out, /fix: .* init/);
  });
});

describe('harness gates / host', () => {
  test('--print-allow-skip prints the declared skips and runs nothing', () => {
    const dir = tempRepo({ 'harness.config.json': JSON.stringify({ project: { name: 'acme' }, gates: [{ name: 'test', command: 'node --test' }] }) });
    const r = run(['gates', '--print-allow-skip'], dir);
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.out.trim(), 'reproducible-build=1');

    fs.writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify({ project: { name: 'acme' }, gates: [{ name: 'test', command: 'node --test' }], artifacts: ['dist/app.js'] }));
    assert.strictEqual(run(['gates', '--print-allow-skip'], dir).out.trim(), '', 'a configured artifact list declares no skip');
    // A skip the CALLER declares for its own host (what CI does for the doc gate's memory index).
    assert.strictEqual(run(['gates', '--print-allow-skip', '--with', 'docs=1'], dir).out.trim(), 'docs=1');
    const bad = run(['gates', '--print-allow-skip', '--with', 'docs'], dir);
    assert.strictEqual(bad.code, 1, 'a mistyped tolerance stops the run');
    assert.strictEqual(bad.out.trim(), '', 'and prints no value a workflow could go on to use');
  });

  test('gates without an installed runner stops with the fix, not a stack trace', () => {
    const dir = tempRepo({ 'harness.config.json': JSON.stringify({ project: { name: 'acme' }, gates: [{ name: 'test', command: 'node --test' }] }) });
    const r = run(['gates', '--check'], dir);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /FATAL — no scripts\/harness\/gates\.js/);
    assert.match(r.err, /fix: .* init/);
  });

  test('host is a report: it prints the runtime and always exits 0', () => {
    const r = run(['host'], tempRepo({}));
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /^node v\d+/);
  });
});
