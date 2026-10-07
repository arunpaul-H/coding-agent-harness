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
    for (const c of ['harness init', 'harness doctor', 'harness gates', 'harness docs', 'harness reference new', 'harness selftest']) assert.ok(r.out.includes(c), c);
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
      'templates/track/handoff.md', 'templates/reference/README.md', 'schema/harness.config.schema.json', '.gitignore']) {
      assert.ok(files.includes(f), 'expected ' + f + ' to be installed');
    }
    // The reference TEMPLATE travels, byte for byte; no reference doc does. The routing doc is the
    // only file init puts under the docs root's reference folder.
    assert.strictEqual(fs.readFileSync(path.join(dir, 'templates', 'reference', 'README.md'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'templates', 'reference', 'README.md'), 'utf8'));
    assert.deepStrictEqual(files.filter((f) => f.startsWith('docs/reference/')), ['docs/reference/routing/README.md']);
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

  // A skill in the installer's list and not in the package file list reds nothing in a checkout,
  // which copies from disk, and stops a packed install dead. Nothing else compares the two.
  test('every shipped skill is in the package file list, and init installs each one', () => {
    const { SHIPPED_SKILLS } = require(BIN);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(SHIPPED_SKILLS.length > 0, 'the installer ships no skill at all');
    for (const s of SHIPPED_SKILLS) assert.ok(pkg.files.includes('.claude/skills/' + s + '/'), s + ' is shipped by init and absent from package.json files');
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }) });
    const r = run(['init', '--into', dir]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    const files = listing(dir);
    for (const s of SHIPPED_SKILLS) assert.ok(files.includes('.claude/skills/' + s + '/SKILL.md'), 'expected the ' + s + ' skill to be installed');
  });

  // The guide holds a conversation. A forked skill runs in the background and cannot ask a question.
  test('the guide skill runs inline: no context key and no agent key in its frontmatter', () => {
    const text = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guide', 'SKILL.md'), 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    assert.ok(fm, 'the guide skill has no frontmatter');
    const keys = fm[1].split(/\r?\n/).map((l) => l.split(':')[0].trim());
    assert.ok(keys.includes('name') && keys.includes('description'), 'the guide skill lost its name or description');
    for (const k of ['context', 'agent']) assert.ok(!keys.includes(k), 'the guide skill carries `' + k + ':`, which forks it');
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

describe('harness reference new (one doc for one named subsystem)', () => {
  const { REFERENCE_TEMPLATES, localDate } = require(BIN);
  const CFG = { 'harness.config.json': JSON.stringify({ project: { name: 'acme', docsRoot: 'doc' }, gates: [{ name: 'test', command: 'node --test' }] }) };
  const GOOD = ['--read-when', 'changing what the export writes', '--paths', 'src/billing/**, tests/billing/**'];
  const DOC = 'doc/reference/billing-export/README.md';
  const frontmatter = (text) => /^---\n([\s\S]*?)\n---\n/.exec(text)[1].split('\n');

  test('the template list is the files on disk, and the template holds its rule on exactly one line', () => {
    assert.deepStrictEqual(fs.readdirSync(path.join(ROOT, 'templates', 'reference')).sort(), REFERENCE_TEMPLATES.slice().sort());
    const lines = fs.readFileSync(path.join(ROOT, 'templates', 'reference', 'README.md'), 'utf8').split(/\r?\n/);
    assert.strictEqual(lines.filter((l) => /a fact an agent can get by search does not belong here/i.test(l)).length, 1);
    assert.ok(lines.length < 150, 'the template is ' + lines.length + ' lines');
    assert.ok(!lines.some((l) => l.includes('—')), 'an em-dash in the template is a doc-gate warning in every doc rendered from it');
  });

  test('each refusal is exit 1 with a fix line, and writes nothing', () => {
    const dir = tempRepo(Object.assign({ 'doc/taken.md': '---\nid: taken\nkind: reference\nstatus: open\nread_when: "x"\n---\n# taken\n' }, CFG));
    const before = listing(dir);
    const cases = [
      [[], /needs its subcommand, `new`/],
      [['list'], /unknown subcommand `reference list`/],
      [['new'], /no subsystem named/],
      [['new', 'Billing_Export'].concat(GOOD), /subsystem `Billing_Export` is not kebab-case/],
      [['new', 'billing--export'].concat(GOOD), /is not kebab-case/],
      [['new', 'billing-export', '--paths', 'src/**'], /--read-when is required/],
      [['new', 'billing-export', '--read-when', '', '--paths', 'src/**'], /--read-when is required/],
      [['new', 'billing-export', '--read-when', 'x'], /--paths is required/],
      [['new', 'billing-export', '--read-when', 'x', '--paths', ','], /--paths is required/],
      [['new', 'billing-export', '--read-when', 'say "x"', '--paths', 'src/**'], /--read-when holds a double quote/],
      [['new', 'billing-export'].concat(GOOD, '--verify', 'node --test "a b"'), /--verify holds a double quote/],
      [['new', 'billing-export'].concat(GOOD, '--force'), /unknown flag `--force`/],
      [['new', 'billing-export'].concat(GOOD, '--dryrun'), /unknown flag `--dryrun`/],
      [['new', 'taken'].concat(GOOD), /id `taken` is already used by doc\/taken\.md/],
    ];
    for (const [args, why] of cases) {
      const r = run(['reference'].concat(args, args.includes('new') && args.length > 1 ? ['--into', dir] : []), dir);
      assert.strictEqual(r.code, 1, args.join(' ') + '\n' + r.out + r.err);
      assert.match(r.err, why);
      assert.match(r.err, /^FATAL — .*\n {3}fix: \S/, 'no fix line for: ' + args.join(' '));
      assert.strictEqual(r.out, '', 'a refusal printed to stdout: ' + args.join(' '));
    }
    assert.deepStrictEqual(listing(dir), before);
  });

  test('a target with no config, or one that does not parse, is refused and nothing is written', () => {
    const bare = tempRepo({});
    const none = run(['reference', 'new', 'billing-export'].concat(GOOD, '--into', bare));
    assert.strictEqual(none.code, 1);
    assert.match(none.err, /FATAL — no harness\.config\.json in /);
    assert.match(none.err, /fix: .* init/);
    assert.deepStrictEqual(listing(bare), []);
    const broken = tempRepo({ 'harness.config.json': '{ "project": }' });
    const bad = run(['reference', 'new', 'billing-export'].concat(GOOD, '--into', broken));
    assert.strictEqual(bad.code, 1);
    assert.match(bad.err, /^FATAL — .*\n {3}fix: \S/);
    assert.deepStrictEqual(listing(broken), ['harness.config.json']);
    const nowhere = run(['reference', 'new', 'billing-export'].concat(GOOD, '--into', path.join(bare, 'no-such-dir')));
    assert.strictEqual(nowhere.code, 1);
    assert.match(nowhere.err, /FATAL — no directory at /);
  });

  test('--dry-run prints the path and writes nothing', () => {
    const dir = tempRepo(CFG);
    const before = listing(dir);
    const r = run(['reference', 'new', 'billing-export'].concat(GOOD, '--dry-run', '--into', dir));
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /DRY RUN: nothing is written/);
    assert.ok(r.out.includes('WOULD WRITE  ' + DOC), r.out);
    assert.deepStrictEqual(listing(dir), before);
  });

  test('writes exactly one file under the configured docs root, dated today, with no verify line; a second run refuses', () => {
    const dir = tempRepo(CFG);
    const before = listing(dir);
    const dayBefore = localDate(new Date());
    // From INSIDE the repo and with no --into: the root is found the way every other command finds it.
    const r = run(['reference', 'new', 'billing-export'].concat(GOOD), dir);
    const dayAfter = localDate(new Date());
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.deepStrictEqual(listing(dir).filter((f) => !before.includes(f)), [DOC], 'exactly one file is the whole write');
    assert.ok(r.out.includes('WROTE  ' + DOC), r.out);
    // It NAMES the index command as its last line and does not run it: no index was written.
    assert.strictEqual(r.out.trim().split('\n').pop().trim(), 'node scripts/harness/docs-index.js');
    assert.ok(!fs.existsSync(path.join(dir, 'doc', 'INDEX.md')));

    const text = fs.readFileSync(path.join(dir, ...DOC.split('/')), 'utf8');
    const fm = frontmatter(text);
    const date = fm.find((l) => l.startsWith('last_verified: ')).slice('last_verified: '.length);
    assert.deepStrictEqual(fm.filter((l) => !l.startsWith('last_verified: ')), ['id: billing-export', 'kind: reference', 'status: open',
      'read_when: "changing what the export writes"', 'paths: ["src/billing/**", "tests/billing/**"]', 'max_age_days: 90']);
    assert.ok([dayBefore, dayAfter].includes(date), 'last_verified is ' + date + ', not today');
    assert.ok(!Number.isNaN(Date.parse(date)), 'a date the staleness check cannot parse is silent for ever');
    assert.ok(!/^verify:/m.test(text), 'a verify line nobody asked for');
    // The body is a person's to fill: its placeholders and its guidance are still there.
    assert.match(text, /\n# <TITLE>\n/);
    assert.match(text, /<!-- THE RULE: a fact an agent can get by search does not belong here\./);

    const again = run(['reference', 'new', 'billing-export', '--read-when', 'something else', '--paths', 'lib/**'], dir);
    assert.strictEqual(again.code, 1);
    assert.match(again.err, /doc\/reference\/billing-export\/README\.md already exists, and a reference doc is never overwritten/);
    assert.match(again.err, /fix: \S/);
    assert.strictEqual(fs.readFileSync(path.join(dir, ...DOC.split('/')), 'utf8'), text, 'the refused run changed the file');
  });

  test('--verify writes the verify line, and a single quote inside a value survives', () => {
    const dir = tempRepo(CFG);
    const r = run(['reference', 'new', 'ledger', '--read-when', 'the ledger\'s totals look wrong', '--paths', 'src/ledger/**', '--verify', 'node --test tests/ledger', '--into', dir]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    const fm = frontmatter(fs.readFileSync(path.join(dir, 'doc', 'reference', 'ledger', 'README.md'), 'utf8'));
    assert.ok(fm.includes('verify: "node --test tests/ledger"'), fm.join('\n'));
    assert.ok(fm.includes('read_when: "the ledger\'s totals look wrong"'), fm.join('\n'));
    assert.ok(fm.includes('paths: ["src/ledger/**"]'), fm.join('\n'));
  });

  // Templates sit outside the doc gate's sweep, so only a RENDERED one can be graded, and only here.
  test('the rendered doc passes the real doc gate in an installed tree, and the index takes it', () => {
    const dir = tempRepo({ 'package.json': JSON.stringify({ name: 'acme-api' }) });
    assert.strictEqual(run(['init', '--into', dir]).code, 0);
    const node = (rel, args) => spawnSync(process.execPath, [path.join(dir, ...rel.split('/'))].concat(args || []), { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    const fails = (r) => Number(/^GATE docs pass=\d+ fail=(\d+) skipped=\d+$/.exec(r.stdout.trim().split('\n').pop())[1]);
    const clean = node('scripts/harness/guards/docs-lint.cjs');
    assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);

    const r = run(['reference', 'new', 'billing-export'].concat(GOOD, '--verify', 'node --test tests/billing', '--into', dir));
    assert.strictEqual(r.code, 0, r.out + r.err);
    const lint = node('scripts/harness/guards/docs-lint.cjs');
    assert.strictEqual(lint.status, 0, lint.stdout + lint.stderr);
    assert.strictEqual(fails(lint), 0);
    assert.doesNotMatch(lint.stdout + lint.stderr, /billing-export/, 'the doc gate has something to say about the rendered doc');
    // ...and it is not vacuous there: the same doc with its id taken away is caught, by name.
    const file = path.join(dir, 'docs', 'reference', 'billing-export', 'README.md');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace('id: billing-export\n', ''));
    const red = node('scripts/harness/guards/docs-lint.cjs');
    assert.strictEqual(red.status, 1, 'the doc gate does not grade the rendered doc at all');
    assert.match(red.stderr, /FAIL {2}docs\/reference\/billing-export\/README\.md/);
    fs.writeFileSync(file, text);

    // The command it names is the one that works: the index lists the doc by its read_when.
    assert.strictEqual(node('scripts/harness/docs-index.js').status, 0);
    const index = fs.readFileSync(path.join(dir, 'docs', 'INDEX.md'), 'utf8');
    assert.ok(index.includes('changing what the export writes'), 'the index has no row for the new doc');
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
