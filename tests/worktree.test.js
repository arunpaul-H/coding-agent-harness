'use strict';
/* ============================================================
   worktree.test.js — the workspace command, as a member of the suite.

   worktree.js keeps a --self-test that drives its decisions with literals and a throwaway repo.
   This file is what makes that verdict more than prose: the self-test is run as a process, the
   command line a person types is run against its own throwaway repo, and the config section
   the script reads is held to the loader and the schema.

   NOTHING HERE TOUCHES THIS REPO'S WORKTREES. Every `--new` runs in a repo made under the OS
   temp directory, with an identity passed on the command line because a test machine may have
   none configured.
   ============================================================ */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'harness');
const SCRIPT = path.join(SRC, 'worktree.js');
const CONFIG = require(path.join(SRC, 'config.js'));
const W = require(SCRIPT);

function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  return env;
}
const run = (cwd, args) => spawnSync(process.execPath, [SCRIPT].concat(args), { cwd, encoding: 'utf8', env: cleanEnv() });
const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'].concat(args), { cwd, encoding: 'utf8' });

describe('worktree.js keeps a passing self-test', () => {
  test('worktree.js --self-test passes', () => {
    const r = run(ROOT, ['--self-test']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS — worktree\.js self-test \(\d+ checks/);
  });
});

describe('the command line, against a throwaway repo', () => {
  let tmp; let repo;
  before(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-test-')));
    repo = path.join(tmp, 'shop');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'file.txt'), 'x\n');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    git(repo, ['add', '-A']);
    assert.strictEqual(git(repo, ['commit', '-q', '-m', 'init']).status, 0);
  });
  after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS may still hold it */ } });

  test('--new creates the folder beside the repo and says where, from what and what to do next', () => {
    const r = run(repo, ['--new', 'alpha']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const target = path.join(tmp, 'shop.worktrees', 'alpha');
    assert.ok(fs.existsSync(path.join(target, 'file.txt')), 'the new folder has no tracked file in it');
    assert.match(r.stdout, /CREATED workspace `alpha`/);
    assert.ok(r.stdout.includes(target), 'the folder is not printed');
    assert.match(r.stdout, /cut from main \(source chosen by: fallback\)/);
    assert.match(r.stdout, /start your coding agent THERE/);
    assert.match(r.stdout, /It works better as ONE\s+parent folder/, 'a plain clone is not told about the parent layout');
    assert.strictEqual(git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/alpha']).status, 0, 'no branch named for the workspace');
  });

  test('a refusal exits 1, starts REFUSED on stderr and creates nothing', () => {
    for (const [args, re] of [
      [['--new', 'alpha'], /folder already exists/],
      [['--new', 'Bad_Name'], /kebab-case/],
      [['--new'], /needs a name/],
      [['--new', 'beta', '--from', 'no-such-ref'], /no source ref/],
      [['--new', 'gamma', '--track'], /--track needs templates\/track\//],
    ]) {
      const r = run(repo, args);
      assert.strictEqual(r.status, 1, args.join(' ') + '\n' + r.stdout + r.stderr);
      assert.match(r.stderr, /^REFUSED: /);
      assert.match(r.stderr, re);
    }
    assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'shop.worktrees')), ['alpha']);
  });

  test('--list names every checkout, marks this one, and says where the next goes', () => {
    const r = run(path.join(tmp, 'shop.worktrees', 'alpha'), ['--list']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^\* alpha\s/m);
    assert.match(r.stdout, /^ {2}main\s.*\[main checkout\]$/m);
    assert.match(r.stdout, /2 checkout\(s\)/);
    assert.ok(r.stdout.includes('layout: sibling — a new workspace goes under ' + path.join(tmp, 'shop.worktrees')));
  });

  test('outside a repo both commands refuse, and a bare call prints usage', () => {
    assert.strictEqual(run(tmp, ['--list']).status, 1);
    assert.strictEqual(run(tmp, ['--new', 'x']).status, 1);
    const bare = run(tmp, []);
    assert.strictEqual(bare.status, 0);
    assert.match(bare.stdout, /--new <name> \[--track\] \[--from <ref>\]/);
    assert.strictEqual(run(tmp, ['--no-such-flag']).status, 1, 'an unknown flag must not read as success');
  });

  test('`harness worktree` spells new and list as the script\'s flags', () => {
    const cli = path.join(ROOT, 'bin', 'harness.js');
    const here = spawnSync(process.execPath, [cli, 'worktree', 'list'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(here.status, 0, here.stdout + here.stderr);
    assert.match(here.stdout, /checkout\(s\); `\*` is this one\./);
    const help = spawnSync(process.execPath, [cli, '--help'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.match(help.stdout, /harness worktree new <name> \[--track\] \[--from <ref>\]/);
  });
});

describe('a new workspace is ready to work in, by either route', () => {
  const HOOK = path.join(SRC, 'hook.js');
  let tmp; let repo;
  const cfg = (wt) => fs.writeFileSync(path.join(repo, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'shop' }, gates: [{ name: 'test', command: 'node --test' }], worktrees: wt }));
  before(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-ready-')));
    repo = path.join(tmp, 'shop');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'file.txt'), 'x\n');
    // The ignored fixture is NOT named like a guarded secret file: the secret guard refuses any
    // command that spells one, in a throwaway repo or not.
    fs.writeFileSync(path.join(repo, '.gitignore'), 'local.private\nharness.config.json\n');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    git(repo, ['add', '-A']);
    assert.strictEqual(git(repo, ['commit', '-q', '-m', 'init']).status, 0);
    fs.writeFileSync(path.join(repo, 'local.private'), 'mine\n');
  });
  after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS may still hold it */ } });

  test('--new carries the listed ignored file, runs the setup there, and keeps setup output off stdout', () => {
    cfg({ carry: ['local.private', 'file.txt', 'nope.txt'], setup: 'node -p "\'setup-\' + \'said-this\'"' });
    const r = run(repo, ['--new', 'ready']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const target = path.join(tmp, 'shop.worktrees', 'ready');
    assert.strictEqual(fs.readFileSync(path.join(target, 'local.private'), 'utf8'), 'mine\n');
    assert.match(r.stdout, /carried {2}local\.private/);
    assert.match(r.stdout, /NOT carried {2}file\.txt — git does not ignore it/);
    assert.match(r.stdout, /NOT carried {2}nope\.txt — it is not in the main checkout/);
    assert.match(r.stdout, /setup {4}`node -p .*` ran/);
    assert.match(r.stderr, /setup-said-this/, 'the setup command\'s output is not on stderr');
    assert.doesNotMatch(r.stdout, /setup-said-this/, 'the setup command\'s output reached stdout');
  });

  test('a setup command that fails exits 1, says so, and keeps the folder', () => {
    cfg({ setup: 'node no-such-script.js' });
    const r = run(repo, ['--new', 'broken']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /CREATED workspace `broken`/);
    assert.match(r.stderr, /SETUP FAILED: `node no-such-script\.js`/);
    assert.ok(fs.existsSync(path.join(tmp, 'shop.worktrees', 'broken', 'file.txt')));
  });

  test('a carried path the secret guard guards refuses the whole --new, unless a live carve-out covers it', () => {
    const write = (env) => fs.writeFileSync(path.join(repo, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'shop' }, gates: [{ name: 'test', command: 'node --test' }], env, worktrees: { carry: ['local.private'] } }));
    write({ guarded: ['local.private'] });
    const no = run(repo, ['--new', 'secret']);
    assert.strictEqual(no.status, 1, no.stdout + no.stderr);
    assert.match(no.stderr, /^REFUSED: worktrees\.carry names `local\.private`, and the secret guard guards `local\.private`/);
    assert.ok(!fs.existsSync(path.join(tmp, 'shop.worktrees', 'secret')), 'a refused --new left a folder');
    write({ guarded: ['local.private'], openCarveOuts: [{ path: 'local.private', why: 'test', until: '2020-01-01' }] });
    assert.strictEqual(run(repo, ['--new', 'secret']).status, 1, 'an EXPIRED carve-out let a guarded file through');
    write({ guarded: ['local.private'], openCarveOuts: [{ path: 'local.private', why: 'test', until: '2999-01-01' }] });
    const yes = run(repo, ['--new', 'secret']);
    assert.strictEqual(yes.status, 0, yes.stdout + yes.stderr);
    assert.ok(fs.existsSync(path.join(tmp, 'shop.worktrees', 'secret', 'local.private')));
  });

  test('the agent\'s own flag, through the hook entry: the folder path ALONE on stdout, in the same root', () => {
    cfg({ carry: ['local.private'], setup: 'node -p "\'noise-on-stdout\'"' });
    const hook = (payload, tool) => spawnSync(process.execPath, [HOOK, '--tool', tool || 'claude-code', '--event', 'worktree-create'],
      { cwd: tmp, encoding: 'utf8', env: cleanEnv(), input: JSON.stringify(payload) });
    const r = hook({ session_id: 's', hook_event_name: 'WorktreeCreate', name: 'flagged', cwd: repo });
    const target = path.join(tmp, 'shop.worktrees', 'flagged');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.stdout, target + '\n', 'stdout is read by the agent as the path: it must hold nothing else');
    assert.match(r.stderr, /CREATED workspace `flagged`/);
    assert.match(r.stderr, /noise-on-stdout/);
    assert.ok(fs.existsSync(path.join(target, 'local.private')), 'the hook route did not carry the file');
    assert.strictEqual(git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/flagged']).status, 0);

    for (const [payload, re] of [
      [{ name: 'Bad Name', cwd: repo }, /WORKSPACE REFUSED: .*kebab-case/],
      [{ name: '../escape', cwd: repo }, /WORKSPACE REFUSED: .*kebab-case/],
      [{ name: 'flagged', cwd: repo }, /WORKSPACE REFUSED: a folder already exists/],
      [{ cwd: repo }, /WORKSPACE REFUSED: the hook payload names no workspace/],
      [{ name: 'elsewhere', cwd: tmp }, /WORKSPACE REFUSED: no git repository/],
    ]) {
      const bad = hook(payload);
      assert.notStrictEqual(bad.status, 0, JSON.stringify(payload));
      assert.strictEqual(bad.stdout, '', 'a refusal printed something the agent would read as a path');
      assert.match(bad.stderr, re);
    }
    assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'shop.worktrees')).filter((n) => /bad|escape|elsewhere/i.test(n)), []);
  });

  test('the event is routed only for a registry row that establishes it', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(SRC, 'tools.json'), 'utf8'));
    const rows = reg.tools.filter((t) => t.worktreeCreate === true).map((t) => t.id);
    assert.deepStrictEqual(rows, ['claude-code'], 'a row claims a worktree-create hook nobody ran');
    const other = reg.tools.find((t) => typeof t.dialect === 'string' && t.worktreeCreate !== true);
    const r = spawnSync(process.execPath, [HOOK, '--tool', other.id, '--event', 'worktree-create'],
      { cwd: tmp, encoding: 'utf8', env: cleanEnv(), input: JSON.stringify({ name: 'unrouted', cwd: repo }) });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.match(r.stderr, /does not establish a worktree-create hook/);
    assert.ok(!fs.existsSync(path.join(tmp, 'shop.worktrees', 'unrouted')));
  });
});

describe('the registration this repo runs under', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const commands = [];
  (function visit(n) {
    if (Array.isArray(n)) return n.forEach(visit);
    if (n && typeof n === 'object') { if (typeof n.command === 'string') commands.push(n.command); Object.values(n).forEach(visit); }
  })([settings.hooks, settings.statusLine]);

  test('every command spells the project-directory variable with braces (PowerShell reads the bare form as nothing)', () => {
    assert.ok(commands.length >= 4, 'expected the three hook entries and the status line');
    for (const c of commands) {
      assert.match(c, /\$\{CLAUDE_PROJECT_DIR(:-[^}]*)?\}/, c);
      assert.doesNotMatch(c, /\$CLAUDE_PROJECT_DIR/, c);
    }
  });

  test('the settings file holds exactly the entries the dialect renders for the row', () => {
    const { wiring } = require(path.join(SRC, 'dialects', 'claude.js'));
    const reg = JSON.parse(fs.readFileSync(path.join(SRC, 'tools.json'), 'utf8'));
    const row = reg.tools.find((t) => t.id === 'claude-code');
    const entries = wiring.entries(row);
    assert.deepStrictEqual(entries.map((e) => e.event), ['pre-tool', 'session-start', 'worktree-create']);
    for (const e of entries) {
      const want = e.entry.hooks[0];
      const have = settings.hooks[e.at[1]].flatMap((x) => x.hooks);
      assert.ok(have.some((h) => h.command === want.command && h.timeout === want.timeout), e.event + ' is not registered as the dialect renders it: ' + want.command);
    }
    assert.deepStrictEqual(wiring.entries(Object.assign({}, row, { worktreeCreate: undefined })).map((e) => e.event), ['pre-tool', 'session-start'],
      'a row without the cell still got the workspace entry');
  });

  test('the folder the unrouted flag would make is ignored', () => {
    const r = spawnSync('git', ['check-ignore', '--no-index', '-q', '.claude/worktrees/x/file.txt'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'no ignore rule covers the agent\'s default worktree folder');
  });
});

describe('the config section the script reads', () => {
  const minimal = { project: { name: 'x' }, gates: [{ name: 'test', command: 'node --test' }] };
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-config-')); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  const load = (extra) => {
    fs.writeFileSync(path.join(dir, CONFIG.CONFIG_NAME), JSON.stringify(Object.assign({}, minimal, extra)));
    return CONFIG.load({ root: dir, fresh: true });
  };

  test('absent, every key is derived: a fresh clone edits nothing', () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(load({}).worktrees)), { root: null, branchPrefix: '', carry: [], setup: null });
  });
  test('a stated root and prefix are kept', () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(load({ worktrees: { root: '../trees', branchPrefix: 'wt/' } }).worktrees)), { root: '../trees', branchPrefix: 'wt/', carry: [], setup: null });
  });
  test('carry and setup are kept, and a carried path that leaves the checkout is a hard stop', () => {
    const w = load({ worktrees: { carry: ['node_modules', '.claude/settings.local.json'], setup: 'npm ci' } }).worktrees;
    assert.deepStrictEqual([Array.from(w.carry), w.setup], [['node_modules', '.claude/settings.local.json'], 'npm ci']);
    for (const bad of ['../x', 'a/../../x', '/etc/x', 'C:\\x', 'C:/x']) {
      assert.throws(() => load({ worktrees: { carry: [bad] } }), /worktrees\.carry: .* must be a path inside the checkout/, bad);
    }
    assert.throws(() => load({ worktrees: { carry: 'node_modules' } }), /worktrees\.carry must be a list of paths/);
    assert.throws(() => load({ worktrees: { carry: [''] } }), /worktrees\.carry must be a list of paths/);
    assert.throws(() => load({ worktrees: { setup: ['npm', 'ci'] } }), /worktrees\.setup must be one command line, or null/);
    assert.throws(() => load({ worktrees: { setup: '' } }), /worktrees\.setup must be one command line, or null/);
  });
  test('a misspelled key, a non-string root and a prefix git would refuse are each a hard stop', () => {
    assert.throws(() => load({ worktrees: { rooot: 'x' } }), /worktrees: unknown key `rooot`/);
    assert.throws(() => load({ worktrees: { root: 7 } }), /worktrees\.root must be a path, or null/);
    assert.throws(() => load({ worktrees: { root: '' } }), /worktrees\.root must be a path, or null/);
    assert.throws(() => load({ worktrees: { branchPrefix: 'a b' } }), /worktrees\.branchPrefix must be a string/);
    assert.throws(() => load({ worktrees: 'beside' }), /`worktrees` must be an object/);
  });
  test('the schema documents exactly the keys the loader allows', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'harness.config.schema.json'), 'utf8'));
    const section = schema.properties.worktrees;
    assert.ok(section, 'the schema has no worktrees section');
    assert.strictEqual(section.additionalProperties, false);
    assert.deepStrictEqual(Object.keys(section.properties).sort(), CONFIG.WORKTREES_KEYS.slice().sort());
    assert.ok(CONFIG.TOP_LEVEL.includes('worktrees'));
  });
  test('the marker folder and the sibling suffix are the ones the help text and docs name', () => {
    assert.strictEqual(W.PARENT_MAIN, 'main');
    assert.strictEqual(W.SIBLING_SUFFIX, '.worktrees');
  });
});
