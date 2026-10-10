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

describe('workspaces announce themselves, and the overview is read from git', () => {
  const HOOK = path.join(SRC, 'hook.js');
  let tmp; let repo;
  const commit = (dir, msg) => { git(dir, ['add', '-A']); assert.strictEqual(git(dir, ['commit', '-q', '-m', msg]).status, 0, msg); };
  before(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-overview-')));
    repo = path.join(tmp, 'shop');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'x\n');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    commit(repo, 'init');
  });
  after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS may still hold it */ } });

  test('--new writes one note for a plain task, with frontmatter the doc contract accepts', () => {
    const r = run(repo, ['--new', 'mend-export', '--doing', 'mend the CSV export']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /note {5}docs\/workspaces\/mend-export\.md; commit it first/);
    const text = fs.readFileSync(path.join(tmp, 'shop.worktrees', 'mend-export', 'docs', 'workspaces', 'mend-export.md'), 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    assert.ok(fm, 'the note has no frontmatter block');
    for (const k of ['id', 'kind', 'status', 'read_when']) assert.match(fm[1], new RegExp('^' + k + ': \\S', 'm'), k + ' is missing');
    assert.match(fm[1], /^id: workspace-mend-export$/m);
    assert.match(text, /^mend the CSV export$/m);
    const { parseFrontmatter } = require(path.join(SRC, 'guards', 'doc-frozen.cjs'));
    assert.strictEqual(parseFrontmatter(text).kind, 'design', 'the harness\'s own frontmatter reader does not read the note');
  });

  test('the overview shows what each branch says, an uncommitted note as uncommitted, and a file two branches changed', () => {
    const a = path.join(tmp, 'shop.worktrees', 'mend-export');
    let r = run(repo, ['--list']);
    assert.match(r.stdout, /doing: mend the CSV export {3}\(docs\/workspaces\/mend-export\.md, NOT committed: other folders cannot see it\)/);
    fs.writeFileSync(path.join(a, 'shared.txt'), 'a\n');
    commit(a, 'a');
    assert.strictEqual(run(repo, ['--new', 'other-task']).status, 0);
    const b = path.join(tmp, 'shop.worktrees', 'other-task');
    fs.writeFileSync(path.join(b, 'shared.txt'), 'b\n');
    fs.writeFileSync(path.join(b, 'mine.txt'), 'b\n');
    commit(b, 'b');
    r = run(repo, ['--list']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ {2}mend-export\s.*\n {6}doing: mend the CSV export {3}\(docs\/workspaces\/mend-export\.md\)$/m);
    assert.match(r.stdout, /doing: \(the note says nothing yet\) {3}\(docs\/workspaces\/other-task\.md\)/);
    assert.match(r.stdout, /OVERLAP: 1 file\(s\) changed against main on two or more branches\. A report, not a refusal:\n {2}shared\.txt {3}<- mend-export, other-task/);
    assert.doesNotMatch(r.stdout, /mine\.txt/, 'a file one branch changed is not an overlap');
    assert.match(r.stdout, /3 checkout\(s\)/);
  });

  test('a branch whose folder is gone from this computer is still in the overview, read from git', () => {
    const b = path.join(tmp, 'shop.worktrees', 'other-task');
    fs.writeFileSync(path.join(b, 'docs', 'workspaces', 'other-task.md'), W.noteText('other-task', 'rework the importer', '2026-01-02'));
    commit(b, 'say what it is');
    assert.strictEqual(git(repo, ['worktree', 'remove', '--force', b]).status, 0);
    const r = run(repo, ['--list']);
    assert.match(r.stdout, /Announced on a branch with NO folder on this computer:\n {2}other-task {2}[0-9a-f]{7}\n {6}doing: rework the importer/);
    assert.match(r.stdout, /shared\.txt {3}<- mend-export, other-task/, 'the overlap report forgot the branch with no folder');
    assert.match(r.stdout, /2 checkout\(s\)/);
  });

  test('the session-start reporter names sibling workspaces on one line, and is silent with none', () => {
    const start = (root) => spawnSync(process.execPath, [HOOK, '--tool', 'claude-code', '--event', 'session-start'],
      { cwd: root, encoding: 'utf8', env: Object.assign(cleanEnv(), { CLAUDE_PROJECT_DIR: root }), input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: root }) });
    const lone = path.join(tmp, 'lone');
    fs.mkdirSync(lone);
    fs.writeFileSync(path.join(lone, 'f.txt'), 'x\n');
    git(lone, ['init', '-q', '-b', 'main', '.']);
    commit(lone, 'init');
    const quiet = start(lone);
    assert.strictEqual(quiet.status, 0, quiet.stdout + quiet.stderr);
    assert.doesNotMatch(quiet.stdout, /WORKSPACES:/, 'a repo with one checkout was told about workspaces');
    const r = start(repo);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    const line = ctx.split('\n').filter((l) => l.startsWith('WORKSPACES: '));
    assert.strictEqual(line.length, 1, ctx);
    assert.match(line[0], /^WORKSPACES: 1 other checkout\(s\) of this repo on this computer/);
    assert.ok(line[0].includes('mend-export in ' + path.join(tmp, 'shop.worktrees', 'mend-export')), line[0]);
    assert.match(line[0], /worktree\.js --list$/);
  });

  test('the docs index does not route a workspace note, so a plain task never rewrites it', () => {
    const idx = spawnSync(process.execPath, [path.join(SRC, 'docs-index.js'), '--self-test'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(idx.status, 0, idx.stdout + idx.stderr);
    assert.match(fs.readFileSync(path.join(SRC, 'docs-index.js'), 'utf8'), new RegExp("norm\\(DOCS\\) \\+ '/" + W.NOTES_DIR + "'"));
  });
});

describe('landing and pruning refuse whatever would lose work', () => {
  let tmp; let repo; let root;
  const commit = (dir, msg) => { git(dir, ['add', '-A']); assert.strictEqual(git(dir, ['commit', '-q', '-m', msg]).status, 0, msg); };
  const make = (name) => {
    assert.strictEqual(run(repo, ['--new', name, '--doing', 'work on ' + name]).status, 0, name);
    const dir = path.join(root, name);
    fs.writeFileSync(path.join(dir, name + '.txt'), name + '\n');
    commit(dir, name);
    return dir;
  };
  // A verdict the folder's own gate run would have written: green, clean, at the branch's commit.
  const green = (dir, over) => {
    const head = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
    const rowOf = { pass: 3, fail: 0, skipped: 0, total: 3, exit: 0 };
    fs.mkdirSync(path.join(dir, 'scripts', 'harness'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'harness', 'gates.json'), JSON.stringify(Object.assign({ commit: head, dirty: false, gates: { test: rowOf } }, over || {})));
    fs.writeFileSync(path.join(dir, 'scripts', 'harness', 'gates.baseline.json'), JSON.stringify({ gates: { test: rowOf } }));
  };
  before(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-land-')));
    repo = path.join(tmp, 'shop');
    root = path.join(tmp, 'shop.worktrees');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'file.txt'), 'x\n');
    // The verdict files are run output: ignored, as they are in a real checkout.
    fs.writeFileSync(path.join(repo, '.gitignore'), 'scripts/harness/gates.json\nscripts/harness/gates.baseline.json\n');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    commit(repo, 'init');
  });
  after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS may still hold it */ } });

  test('--land walks the three refusals in order, then prints the merge command and removes nothing', () => {
    const dir = make('alpha');
    let r = run(repo, ['--land', 'alpha']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /^REFUSED: `alpha` is not merged into main, and it is not shown green: no gate verdict is recorded there/);
    green(dir, { commit: '0'.repeat(40) });
    assert.match(run(repo, ['--land', 'alpha']).stderr, /not shown green: the gate verdict was recorded at 00000000/);
    green(dir, { dirty: true });
    assert.match(run(repo, ['--land', 'alpha']).stderr, /not recorded on a clean tree/);
    green(dir);
    fs.writeFileSync(path.join(dir, 'unsaved.txt'), 'x\n');
    r = run(repo, ['--land', 'alpha']);
    assert.match(r.stderr, /^REFUSED: 1 uncommitted or untracked path\(s\) in .* would be lost: unsaved\.txt/);
    fs.rmSync(path.join(dir, 'unsaved.txt'));
    r = run(repo, ['--land', 'alpha']);
    assert.strictEqual(r.status, 1, 'READY is not landed: the exit says so');
    assert.match(r.stdout, /^READY TO MERGE: `alpha` is clean and green, and not yet merged into main\. Nothing was removed\./);
    assert.match(r.stdout, /^ {2}git merge --no-ff alpha$/m);
    assert.match(r.stdout, /^ {2}git rm docs\/workspaces\/alpha\.md {3}and commit/m);
    assert.ok(fs.existsSync(dir), 'an unmerged workspace was removed');
    assert.strictEqual(git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/alpha']).status, 0);
    assert.strictEqual(git(repo, ['log', '--oneline', 'main']).stdout.trim().split('\n').length, 1, '--land merged something');
  });

  test('once a person has merged, --land removes the folder and the branch and stages the note\'s removal', () => {
    const dir = path.join(root, 'alpha');
    assert.strictEqual(git(repo, ['merge', '-q', '--no-ff', '-m', 'merge alpha', 'alpha']).status, 0);
    assert.match(run(dir, ['--land', 'alpha']).stderr, /^REFUSED: you are standing in /);
    assert.strictEqual(git(repo, ['worktree', 'lock', dir]).status, 0);
    const locked = run(repo, ['--land', 'alpha']);
    assert.strictEqual(locked.status, 1);
    assert.match(locked.stderr, /^REFUSED: the entry for .* is LOCKED.*git worktree unlock "/);
    assert.ok(fs.existsSync(dir), 'a locked workspace was removed');
    git(repo, ['worktree', 'unlock', dir]);
    const r = run(repo, ['--land', 'alpha']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^LANDING `alpha`: `alpha` is merged into main\./);
    assert.ok(!fs.existsSync(dir), 'the folder is still there');
    assert.notStrictEqual(git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/alpha']).status, 0, 'the branch is still there');
    assert.match(r.stdout, /staged the removal of docs\/workspaces\/alpha\.md in .* — commit it there/);
    assert.match(git(repo, ['status', '--porcelain']).stdout, /^D {2}docs\/workspaces\/alpha\.md$/m);
    assert.ok(fs.existsSync(path.join(repo, 'alpha.txt')), 'the merged work is not in the source branch');
    commit(repo, 'drop the note');
    assert.match(run(repo, ['--land', 'alpha']).stderr, /^REFUSED: no workspace named `alpha`/);
    assert.match(run(repo, ['--land']).stderr, /^REFUSED: --land needs the workspace name/);
    assert.match(run(repo, ['--land', 'main']).stderr, /REFUSED: `main` is the main checkout/);
  });

  test('--prune lists by default, removes only with --yes, and names a locked, dirty or brand-new entry', () => {
    const merged = make('merged-one');
    const dirty = make('dirty-one');
    const lockedDir = make('locked-one');
    const gone = make('gone-one');
    const unmerged = make('unmerged-one');
    for (const b of ['merged-one', 'dirty-one', 'locked-one', 'gone-one']) assert.strictEqual(git(repo, ['merge', '-q', '--no-ff', '-m', 'merge ' + b, b]).status, 0, b);
    assert.strictEqual(run(repo, ['--new', 'brand-new', '--track']).status, 1, 'no track template in this fixture');
    assert.strictEqual(git(repo, ['worktree', 'add', '-q', '-b', 'brand-new', path.join(root, 'brand-new'), 'main']).status, 0);
    fs.writeFileSync(path.join(dirty, 'unsaved.txt'), 'x\n');
    git(repo, ['worktree', 'lock', lockedDir]);
    fs.rmSync(gone, { recursive: true, force: true });

    const dry = run(repo, ['--prune']);
    assert.strictEqual(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /^MERGED {2}merged-one {2}.* — merged into main and clean$/m);
    assert.match(dry.stdout, /^STALE {3}gone-one {2}.* — its folder is gone$/m);
    assert.match(dry.stdout, /^KEPT {4}dirty-one {2}.* — merged, but 1 uncommitted or untracked path\(s\) would be lost, so it is kept$/m);
    assert.match(dry.stdout, /^KEPT {4}locked-one {2}.* — merged, and the entry is LOCKED: git worktree unlock "/m);
    assert.match(dry.stdout, /^KEPT {4}brand-new {2}.* — new: no commits of its own yet, so it is kept$/m);
    assert.doesNotMatch(dry.stdout, /unmerged-one|^\S+ +main {2}/m, 'an unmerged workspace or the main checkout was offered up');
    assert.match(dry.stdout, /2 entry\(ies\) can go\. Nothing was removed: run --prune --yes/);
    assert.ok(fs.existsSync(merged), 'a listing removed a folder');

    const wet = run(repo, ['--prune', '--yes']);
    assert.strictEqual(wet.status, 0, wet.stdout + wet.stderr);
    assert.match(wet.stdout, /^REMOVED merged-one /m);
    assert.match(wet.stdout, /^FORGOT {2}gone-one .* the entry is cleared; deleted the merged branch `gone-one`/m);
    assert.match(wet.stdout, /^2 removed\.$/m);
    assert.deepStrictEqual(fs.readdirSync(root).sort(), ['brand-new', 'dirty-one', 'locked-one', 'unmerged-one']);
    const branches = git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout.trim().split(/\r?\n/).sort();
    assert.deepStrictEqual(branches, ['brand-new', 'dirty-one', 'locked-one', 'main', 'unmerged-one']);
    assert.ok(fs.existsSync(path.join(unmerged, 'unmerged-one.txt')), 'unmerged work was touched');
    assert.ok(fs.existsSync(path.join(dirty, 'unsaved.txt')), 'uncommitted work was lost');
    assert.match(run(repo, ['--prune', '--yes']).stdout, /^0 removed\.$/m);
    git(repo, ['worktree', 'unlock', lockedDir]);
  });

  test('`harness worktree` spells land and prune too', () => {
    const cli = path.join(ROOT, 'bin', 'harness.js');
    const r = spawnSync(process.execPath, [cli, 'worktree', 'land', 'no-such-workspace-name'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /REFUSED: no workspace named `no-such-workspace-name`/);
    const help = spawnSync(process.execPath, [cli, '--help'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.match(help.stdout, /harness worktree land <name>/);
    assert.match(help.stdout, /harness worktree prune \[--yes\]/);
  });
});

describe('anyone who installs the harness gets workspaces', () => {
  const cli = path.join(ROOT, 'bin', 'harness.js');
  const harness = (args, cwd) => spawnSync(process.execPath, [cli].concat(args), { cwd: cwd || ROOT, encoding: 'utf8', env: cleanEnv() });
  let tmp; let target;
  before(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-install-')));
    // The documented shape of a new download: the project cloned as <project>/main.
    target = path.join(tmp, 'proj', 'main');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }));
    git(target, ['init', '-q', '-b', 'main', '.']);
    const r = harness(['init', '--into', target]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    git(target, ['add', '-A']);
    assert.strictEqual(git(target, ['commit', '-q', '-m', 'init']).status, 0);
  });
  after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS may still hold it */ } });

  test('init copies the script, registers the routed hook entry and writes the ignore rule', () => {
    assert.ok(fs.existsSync(path.join(target, 'scripts', 'harness', 'worktree.js')), 'the workspace script was not installed');
    const s = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));
    const cmds = (s.hooks.WorktreeCreate || []).flatMap((x) => x.hooks).map((h) => h.command);
    assert.deepStrictEqual(cmds, ['node "${CLAUDE_PROJECT_DIR}/scripts/harness/hook.js" --tool claude-code --event worktree-create']);
    assert.strictEqual(spawnSync('git', ['check-ignore', '--no-index', '-q', '.claude/worktrees/x/f.txt'], { cwd: target }).status, 0, 'the installed ignore file does not cover the unrouted flag\'s folder');
    assert.match(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /A second agent gets its own folder, never this one: `node scripts\/harness\/worktree\.js --new <name>`/);
  });

  test('the installed copy creates a workspace beside main/, and doctor reports the parent layout with no advice', () => {
    const installed = path.join(target, 'scripts', 'harness', 'worktree.js');
    const r = spawnSync(process.execPath, [installed, '--new', 'first-task', '--doing', 'try it'], { cwd: target, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(tmp, 'proj', 'first-task', 'package.json')), 'the workspace is not a sibling of main/');
    assert.doesNotMatch(r.stdout, /It works better as ONE/, 'the parent layout was told to adopt the parent layout');
    const d = harness(['doctor', '--root', target, '--no-self-tests']);
    assert.match(d.stdout, /workspace layout\s+— parent: a new workspace goes under .*proj \(2 checkout\(s\) today\)/);
    assert.doesNotMatch(d.stdout, /git worktree repair/);
  });

  test('in a plain clone, doctor names the sibling layout and prints the steps to adopt the parent one, and moves nothing', () => {
    const d = harness(['doctor', '--no-self-tests']);
    assert.match(d.stdout, /OK\s+workspace layout\s+— (sibling|parent|configured): a new workspace goes under /);
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    fs.writeFileSync(path.join(plain, 'f.txt'), 'x\n');
    git(plain, ['init', '-q', '-b', 'main', '.']);
    git(plain, ['add', '-A']); git(plain, ['commit', '-q', '-m', 'init']);
    const p = harness(['doctor', '--root', plain, '--no-self-tests']);
    assert.match(p.stdout, /workspace layout\s+— sibling: a new workspace goes under .*plain\.worktrees/);
    assert.match(p.stdout, /2\. make a parent folder and move this checkout into it as `main\/`/);
    assert.match(p.stdout, /3\. from `main\/`, run: git worktree repair/);
    assert.ok(fs.existsSync(path.join(plain, 'f.txt')) && !fs.existsSync(path.join(tmp, 'plain.worktrees')), 'the health check moved or made a folder');
  });

  test('the ignore rule is one the health check and the branch manifest both probe', () => {
    const common = JSON.parse(fs.readFileSync(path.join(SRC, 'common.json'), 'utf8'));
    assert.ok(common.ignore.mustIgnore.includes('.claude/worktrees/example/file.txt'));
    assert.match(fs.readFileSync(cli, 'utf8'), /pattern: '\.claude\/worktrees\/', probe: '\.claude\/worktrees\/example\/file\.txt'/);
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
    assert.deepStrictEqual(entries.map((e) => e.event), ['pre-tool', 'session-start', 'stop', 'worktree-create']);
    for (const e of entries) {
      const want = e.entry.hooks[0];
      const have = settings.hooks[e.at[1]].flatMap((x) => x.hooks);
      assert.ok(have.some((h) => h.command === want.command && h.timeout === want.timeout && h.onFailure === want.onFailure), e.event + ' is not registered as the dialect renders it: ' + want.command);
      // The pre-tool entry alone fails closed: an event that must never refuse does not carry the key.
      assert.strictEqual(want.onFailure, e.event === 'pre-tool' ? 'block' : undefined, e.event);
      if (e.entry.matcher) assert.ok(settings.hooks[e.at[1]].some((x) => x.matcher === e.entry.matcher), e.event + ' is registered under another matcher than ' + e.entry.matcher);
    }
    assert.deepStrictEqual(wiring.entries(Object.assign({}, row, { worktreeCreate: undefined })).map((e) => e.event), ['pre-tool', 'session-start', 'stop'],
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
