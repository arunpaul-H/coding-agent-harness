'use strict';
/* ============================================================
   branch-sync.test.js — one harness on every branch, driven as a script.

   Every case builds a REAL multi-branch git repository in a temp directory and
   runs the real scripts/harness/branch-sync.js against it in a child process.
   Nothing here imports the module: the things under test are which REF the
   manifest is read from, which branch git says is the default, and what the last
   stdout line is — all of them properties of a process in a repo, none of them
   reachable by calling a function with literals. (The pure decisions already
   have literals: that is what `--self-test` is, and it is driven below too.)

   A fixture is a whole little repo with the script copied into its own
   scripts/harness/, which is a MIRRORED directory in the fixture's manifest. So
   the script under test is also one of the files it compares, exactly as it is
   in a real tree.

   THE CASE THAT MATTERS MOST is "a branch cannot exempt itself": a follower
   reads the manifest from the source ref. It is tested from both sides — an
   entry the branch deleted from its own copy is still graded, and an entry the
   source added after the branch was cut is graded although the branch's copy has
   never heard of it.
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', 'scripts', 'harness');
const REAL_ROOT = path.join(__dirname, '..');
const MANIFEST = 'scripts/harness/common.json';
const PULL = 'node scripts/harness/branch-sync.js --apply';

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-branch-sync-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/* THE ENVIRONMENT IS PART OF THE FIXTURE. Four things leak in from the machine
   running the suite and each would make a case pass or fail for a reason that is
   not in this file:
     - the developer's global and system git config (autocrlf, a global
       excludesFile that would answer the .gitignore probes, commit signing)
     - CLAUDE_PROJECT_DIR, which would point the script's root at the real repo
     - BRANCH_SYNC_REF, which IS the script's own override
     - the CI branch variables a detached checkout is named by, which a CI run of
       this very suite exports. */
const EMPTY_GITCONFIG = path.join(TMP, 'empty.gitconfig');
fs.writeFileSync(EMPTY_GITCONFIG, '');
fs.mkdirSync(path.join(TMP, 'xdg'), { recursive: true });
function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['CLAUDE_PROJECT_DIR', 'BRANCH_SYNC_REF', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME',
    'CI_COMMIT_REF_NAME', 'BRANCH_NAME', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return Object.assign(env, {
    GIT_CONFIG_GLOBAL: EMPTY_GITCONFIG,
    GIT_CONFIG_NOSYSTEM: '1',
    XDG_CONFIG_HOME: path.join(TMP, 'xdg'),
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  }, extra || {});
}

function g(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' failed in the fixture: ' + r.stderr);
  return r.stdout;
}
const put = (dir, rel, text) => {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const get = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
const has = (dir, rel) => fs.existsSync(path.join(dir, ...rel.split('/')));
const del = (dir, rel) => fs.rmSync(path.join(dir, ...rel.split('/')));
const commit = (dir, msg) => { g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); };

/* ---------- the fixture ---------- */

// One of every entry kind. 9 entries, so 10 checks with the manifest's own.
const BASE_MANIFEST = {
  files: ['CLAUDE.md'],
  dirs: ['.claude/helpers', 'scripts/harness'],
  perBranch: ['harness.config.json', 'scripts/harness/gates.baseline.json'],
  sections: [{ path: 'AGENTS.md', except: '## 1.' }],
  ignore: { mustTrack: [MANIFEST], mustIgnore: ['scripts/harness/gates.json'] },
  packageScripts: { test: 'node --test' },
};
const TOTAL = 10;
const CONFIG = { project: { name: 'example' }, gates: [{ name: 'test', command: 'node --test' }] };
const POLICY_MD = '# example\n\n## 1. What this is\nThe default branch.\n\n## 2. Rules\nRule one.\n';
// The second line is there so a case can drop the first and still have a file.
const GITIGNORE = 'scripts/harness/gates.json\nscratch.tmp\n';
const json = (o) => JSON.stringify(o, null, 2) + '\n';

function writeBase(dir) {
  put(dir, 'CLAUDE.md', '# agents\n\nThe shared instructions.\n');
  put(dir, 'AGENTS.md', POLICY_MD);
  put(dir, '.claude/helpers/guard.cjs', "'use strict';\n// the guard\n");
  put(dir, '.claude/helpers/retired.cjs', "'use strict';\n// a helper the source will delete\n");
  put(dir, MANIFEST, json(BASE_MANIFEST));
  put(dir, 'scripts/harness/gates.baseline.json', json({ total: 1 }));
  put(dir, 'harness.config.json', json(CONFIG));
  put(dir, 'package.json', json({ name: 'example', scripts: { test: 'node --test' } }));
  put(dir, '.gitignore', GITIGNORE);
  put(dir, '.gitattributes', '*.md text\n');
  for (const f of ['branch-sync.js', 'config.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, 'scripts', 'harness', f));
}

/* A repo whose default branch is `name`, with one commit, checked out on a
   second branch `feature` cut from it — so it starts IDENTICAL, and every case
   below is one deliberate difference. Built once per default-branch name and
   copied, .git and all, because a dozen git commands per case is most of the
   suite's wall time on Windows.

   The default branch is set with `symbolic-ref` on the unborn HEAD rather than
   `git init -b`, which older gits lack. */
let seq = 0;
const built = new Map();
function repo(name) {
  const def = name || 'main';
  if (!built.has(def)) {
    const base = path.join(TMP, 'base-' + def);
    fs.mkdirSync(base);
    g(base, 'init', '-q');
    g(base, 'symbolic-ref', 'HEAD', 'refs/heads/' + def);
    writeBase(base);
    commit(base, 'base');
    g(base, 'checkout', '-q', '-b', 'feature');
    built.set(def, base);
  }
  const dir = path.join(TMP, 'r' + (++seq));
  fs.cpSync(built.get(def), dir, { recursive: true });
  return dir;
}

// Commit one change on the default branch and come back to `feature`.
function onSource(dir, def, change, msg) {
  g(dir, 'checkout', '-q', def);
  change();
  commit(dir, msg || 'a harness change on the source');
  g(dir, 'checkout', '-q', 'feature');
}

function run(dir, args, env) {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'harness', 'branch-sync.js')].concat(args),
    { cwd: dir, encoding: 'utf8', env: cleanEnv(env) });
  const lines = String(r.stdout).replace(/\n$/, '').split('\n');
  const m = /^GATE (\S+) pass=(\d+) fail=(\d+) skipped=(\d+)$/.exec(lines[lines.length - 1]);
  return {
    status: r.status, stdout: String(r.stdout), stderr: String(r.stderr), last: lines[lines.length - 1],
    gate: m ? { name: m[1], pass: +m[2], fail: +m[3], skipped: +m[4], total: +m[2] + +m[3] + +m[4] } : null,
  };
}
const check = (dir, env) => run(dir, ['--check'], env);
const hook = (dir, env) => run(dir, ['--hook'], env);

// The red rows a case expects, and nothing else red beside them.
function assertOnlyRed(r, rows) {
  const red = r.stdout.split('\n').filter((l) => l.startsWith('  x ')).map((l) => l.slice(4).split(' — ')[0]);
  assert.deepStrictEqual(red, rows, r.stdout);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.strictEqual(r.gate.fail, rows.length, r.last);
  assert.strictEqual(r.gate.total, TOTAL, 'the count is structural: ' + r.last);
}
function assertGreen(r) {
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual([r.gate.pass, r.gate.fail, r.gate.skipped], [TOTAL, 0, 0], r.stdout);
}

/* ---------- the cases ---------- */

describe('--self-test', () => {
  test('passes in the real tree, against the committed manifest', () => {
    const r = spawnSync(process.execPath, [path.join(SRC, 'branch-sync.js'), '--self-test'],
      { cwd: REAL_ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS — branch-sync\.js self-test \(\d+ checks in the live manifest\)\s*$/);
  });

  test('the committed manifest lists every numbers file as per-branch, and itself as common', () => {
    const m = JSON.parse(fs.readFileSync(path.join(SRC, 'common.json'), 'utf8'));
    // A numbers file inside a mirrored directory that is NOT per-branch makes
    // every branch that measures anything drift from the source by doing so.
    for (const f of ['context-budget.json', 'gates.baseline.json', 'harness-baseline.json']) {
      assert.ok(m.perBranch.includes('scripts/harness/' + f), f + ' must be perBranch');
    }
    assert.ok(m.perBranch.includes('harness.config.json'));
    assert.ok(m.dirs.includes('scripts/harness'), 'the manifest and this script are themselves common');
    // The policy file is common except for the one section where a branch says what it is; the
    // stub that imports it and the lead-only routing doc are common whole.
    assert.deepStrictEqual(m.sections, [{ path: 'AGENTS.md', except: '## 1.' }]);
    assert.ok(m.files.includes('CLAUDE.md'), 'the import stub must be common: a branch that edits it has a second policy body');
    assert.ok(!m.files.includes('AGENTS.md'), 'a file compared whole cannot also carry a per-branch section');
    assert.ok(m.dirs.includes('docs/reference/routing'), 'the routing doc is harness policy and must be common');
    assert.ok(m.ignore.mustTrack.includes(MANIFEST));
    assert.ok(m._readme.join('\n').includes('ADDING AN ENTRY IS ITSELF A HARNESS CHANGE'));
    // Every perBranch path must really exist here, or the source-mode check is
    // red the day this repo gets its first commit.
    for (const p of m.perBranch) assert.ok(fs.existsSync(path.join(REAL_ROOT, ...p.split('/'))), p + ' exists');
  });
});

describe('the source branch', () => {
  test('is validated against its own tree: green, and silent under --hook', () => {
    const dir = repo();
    g(dir, 'checkout', '-q', 'main');
    const r = check(dir);
    assertGreen(r);
    assert.match(r.stdout, /^branch-sync: source mode \. branch main \. source main @ [0-9a-f]+ \(fallback\)\n/);
    const h = hook(dir);
    assert.deepStrictEqual([h.status, h.stdout], [0, '']);
  });

  test('a listed path the source itself lacks is red there', () => {
    const dir = repo();
    g(dir, 'checkout', '-q', 'main');
    del(dir, 'CLAUDE.md');
    const r = check(dir);
    assertOnlyRed(r, ['file CLAUDE.md']);
    assert.match(r.stdout, /absent from the source tree/);
    assert.ok(!r.stdout.includes(PULL), 'there is nothing to pull ON the source');
  });
});

describe('a branch that matches', () => {
  test('is green under --check and silent under --hook', () => {
    const dir = repo();
    const r = check(dir);
    assertGreen(r);
    assert.match(r.stdout, /^branch-sync: follower mode \. branch feature \. source main @ /);
    const h = hook(dir);
    assert.deepStrictEqual([h.status, h.stdout, h.stderr], [0, '', '']);
  });

  test('a CRLF checkout of an LF blob is not drift (hashed through git)', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', get(dir, 'CLAUDE.md').replace(/\n/g, '\r\n'));
    put(dir, 'AGENTS.md', get(dir, 'AGENTS.md').replace(/\n/g, '\r\n'));
    assertGreen(check(dir));
  });
});

describe('drift', () => {
  test('a byte-drifted file is named, with the fix command, and reds --check', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', '# agents\n\nEdited in place on the branch.\n');
    const r = check(dir);
    assertOnlyRed(r, ['file CLAUDE.md']);
    assert.match(r.stdout, /x file CLAUDE\.md — differs from main/);
    assert.ok(r.stdout.includes('Harness files change on `main` first.'));
    assert.ok(r.stdout.includes('  ' + PULL), r.stdout);
  });

  test('--hook on the same branch names the path and the one command, and still exits 0', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', '# agents\n\nEdited in place on the branch.\n');
    const h = hook(dir);
    assert.strictEqual(h.status, 0);
    const out = JSON.parse(h.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
    const text = out.hookSpecificOutput.additionalContext;
    assert.match(text, /HARNESS DRIFT: branch feature vs main/);
    assert.ok(text.includes('file CLAUDE.md: differs from main'), text);
    assert.ok(text.includes(PULL), text);
    assert.match(out.systemMessage, /1 harness path\(s\) drifted from main/);
  });

  test('a committed drift reads the same as an uncommitted one', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', '# agents\n\nEdited and committed.\n');
    commit(dir, 'drift');
    assertOnlyRed(check(dir), ['file CLAUDE.md']);
  });

  test('bare, the same drift is a REPORT: the GATE line says fail, the exit code does not', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', 'x\n');
    const r = run(dir, []);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.gate.fail, 1);
  });

  test('a file missing on the branch is drift', () => {
    const dir = repo();
    del(dir, 'CLAUDE.md');
    const r = check(dir);
    assertOnlyRed(r, ['file CLAUDE.md']);
    assert.match(r.stdout, /missing on this branch/);
  });

  test('a mirrored dir: a file the source DELETED is drift while it lingers on the branch', () => {
    const dir = repo();
    onSource(dir, 'main', () => del(dir, '.claude/helpers/retired.cjs'));
    assert.ok(has(dir, '.claude/helpers/retired.cjs'), 'the branch still carries the deleted helper');
    const r = check(dir);
    assertOnlyRed(r, ['dir .claude/helpers']);
    assert.match(r.stdout, /1 extra \(\.claude\/helpers\/retired\.cjs\)/);
    assert.ok(r.stdout.includes(PULL));
    const text = JSON.parse(hook(dir).stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.includes('.claude/helpers/retired.cjs'), text);
  });

  test('a mirrored dir: an untracked file only the branch has is drift too', () => {
    const dir = repo();
    put(dir, '.claude/helpers/local-only.cjs', '// never on the source\n');
    const r = check(dir);
    assertOnlyRed(r, ['dir .claude/helpers']);
    assert.match(r.stdout, /1 extra \(\.claude\/helpers\/local-only\.cjs\)/);
  });

  test('a mirrored dir: a missing file and a changed file are both named', () => {
    const dir = repo();
    onSource(dir, 'main', () => put(dir, '.claude/helpers/added.cjs', '// new on the source\n'));
    put(dir, '.claude/helpers/guard.cjs', "'use strict';\n// weakened\n");
    const r = check(dir);
    assertOnlyRed(r, ['dir .claude/helpers']);
    assert.match(r.stdout, /1 missing \(\.claude\/helpers\/added\.cjs\); 1 differ \(\.claude\/helpers\/guard\.cjs\)/);
  });

  test('a perBranch file that differs is NOT drift, even inside a mirrored dir', () => {
    const dir = repo();
    put(dir, 'scripts/harness/gates.baseline.json', json({ total: 999, measuredOn: 'feature' }));
    put(dir, 'harness.config.json', json(Object.assign({}, CONFIG, { project: { name: 'the-feature-branch' } })));
    commit(dir, 'this branch has its own numbers');
    assertGreen(check(dir));
    assert.strictEqual(hook(dir).stdout, '');
  });

  test('...but a perBranch file that is ABSENT is: every branch carries its own', () => {
    const dir = repo();
    del(dir, 'scripts/harness/gates.baseline.json');
    const r = check(dir);
    assertOnlyRed(r, ['perBranch scripts/harness/gates.baseline.json']);
    assert.match(r.stdout, /this branch must carry its own copy/);
  });

  test('a change INSIDE the masked section is not drift', () => {
    const dir = repo();
    put(dir, 'AGENTS.md', POLICY_MD.replace('The default branch.', 'The feature branch.\nIt differs, and says so here.'));
    assertGreen(check(dir));
  });

  test('the same change OUTSIDE the masked section is', () => {
    const dir = repo();
    put(dir, 'AGENTS.md', POLICY_MD.replace('Rule one.', 'The feature branch.\nIt differs, and says so here.'));
    const r = check(dir);
    assertOnlyRed(r, ['section AGENTS.md']);
    assert.match(r.stdout, /differs from main outside its `## 1\.` section/);
  });

  test('a mustIgnore probe that fails is drift', () => {
    const dir = repo();
    put(dir, '.gitignore', 'scratch.tmp\n');
    const r = check(dir);
    assertOnlyRed(r, ['mustIgnore scripts/harness/gates.json']);
    assert.match(r.stdout, /does NOT ignore it, so it would be committed/);
  });

  test('a mustTrack probe that fails is drift, although the file is tracked', () => {
    const dir = repo();
    // --no-index is the point: the manifest IS in the index here, and the probe
    // still asks what the patterns say a fresh clone would carry.
    put(dir, '.gitignore', GITIGNORE + 'scripts/harness/common.json\n');
    const r = check(dir);
    assertOnlyRed(r, ['mustTrack ' + MANIFEST]);
    assert.match(r.stdout, /IGNORES it, so a fresh clone would not carry it/);
  });

  test('a changed package script is drift; an unlisted script is not', () => {
    const dir = repo();
    put(dir, 'package.json', json({ name: 'example', scripts: { test: 'node --test', lint: 'anything at all' } }));
    assertGreen(check(dir));
    put(dir, 'package.json', json({ name: 'example', scripts: { test: 'node --test --test-only' } }));
    const r = check(dir);
    assertOnlyRed(r, ['script package.json#test']);
    assert.match(r.stdout, /is "node --test --test-only", wants "node --test"/);
  });
});

describe('the manifest is read from the SOURCE branch', () => {
  test('a branch that deletes the entry from its own copy is still graded on it', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', '# agents\n\nRewritten here, and the manifest edited to hide it.\n');
    put(dir, MANIFEST, json(Object.assign({}, BASE_MANIFEST, { files: [] })));
    commit(dir, 'exempt myself');
    const r = check(dir);
    // The file it tried to hide is red, AND so is the edit that tried to hide it.
    assertOnlyRed(r, ['file CLAUDE.md', 'dir scripts/harness']);
    assert.match(r.stdout, /1 differ \(scripts\/harness\/common\.json\)/);
    const text = JSON.parse(hook(dir).stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.includes('file CLAUDE.md: differs from main'), text);
  });

  test('emptying the branch\'s manifest entirely changes neither the verdict nor the count', () => {
    const dir = repo();
    put(dir, '.claude/helpers/guard.cjs', '// gutted\n');
    put(dir, 'AGENTS.md', POLICY_MD.replace('Rule one.', 'No rules.'));
    put(dir, MANIFEST, json({ files: [], dirs: [], perBranch: [], sections: [], ignore: { mustTrack: [], mustIgnore: [] }, packageScripts: {} }));
    commit(dir, 'exempt myself from everything');
    assertOnlyRed(check(dir), ['dir .claude/helpers', 'dir scripts/harness', 'section AGENTS.md']);
  });

  test('a branch whose own manifest is unparsable is still compared', () => {
    const dir = repo();
    put(dir, 'CLAUDE.md', 'drifted\n');
    put(dir, MANIFEST, '{ not json');
    assertOnlyRed(check(dir), ['file CLAUDE.md', 'dir scripts/harness']);
  });

  test('an entry the source adds AFTER the branch was cut is in force on the branch', () => {
    const dir = repo();
    onSource(dir, 'main', () => {
      put(dir, 'STANDARD.md', '# a new common file\n');
      put(dir, MANIFEST, json(Object.assign({}, BASE_MANIFEST, { files: ['CLAUDE.md', 'STANDARD.md'] })));
    });
    assert.ok(!get(dir, MANIFEST).includes('STANDARD.md'), 'the branch\'s own copy has never heard of it');
    const r = check(dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /x file STANDARD\.md — missing on this branch/);
    assert.strictEqual(r.gate.total, TOTAL + 1, 'the count follows the SOURCE manifest: ' + r.last);
  });

  test('a malformed manifest ON the source reds every branch at once, and says why', () => {
    const dir = repo();
    onSource(dir, 'main', () => put(dir, MANIFEST, json(Object.assign({}, BASE_MANIFEST, { files: ['CLAUDE.md', '../outside.md'] }))));
    const r = check(dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /x manifest scripts\/harness\/common\.json — files: `\.\.\/outside\.md` is not a relative POSIX path/);
    assert.strictEqual(r.last, 'GATE branch-sync pass=0 fail=1 skipped=0');
  });

  test('a branch that points project.sourceBranch at ITSELF is caught by the remote\'s default', () => {
    const origin = repo('stable');
    g(origin, 'checkout', '-q', 'stable');
    const dir = path.join(TMP, 'clone-' + (++seq));
    g(TMP, 'clone', '-q', origin, dir);
    g(dir, 'checkout', '-q', '-b', 'feature');
    put(dir, 'CLAUDE.md', 'drifted\n');
    put(dir, 'harness.config.json', json(Object.assign({}, CONFIG, { project: { name: 'example', sourceBranch: 'feature' } })));
    const r = check(dir);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /x manifest .*says `feature`, but the remote publishes `stable`/);
  });
});

describe('the default branch is detected, not assumed to be `main`', () => {
  test('a repo whose default branch is `trunk`: source mode there, and the branch is compared against it', () => {
    const dir = repo('trunk');
    assert.notStrictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'main'], { cwd: dir, env: cleanEnv() }).status, 0,
      'the fixture has no `main` at all');
    put(dir, 'CLAUDE.md', 'drifted from trunk\n');
    const r = check(dir);
    assertOnlyRed(r, ['file CLAUDE.md']);
    assert.match(r.stdout, /^branch-sync: follower mode \. branch feature \. source trunk @ [0-9a-f]+ \(fallback\)\n/);
    assert.match(r.stdout, /x file CLAUDE\.md — differs from trunk/);
    assert.ok(r.stdout.includes('Harness files change on `trunk` first.'));
    assert.match(JSON.parse(hook(dir).stdout).hookSpecificOutput.additionalContext, /vs trunk/);

    g(dir, 'checkout', '-q', '--force', 'trunk');
    const s = check(dir);
    assertGreen(s);
    assert.match(s.stdout, /^branch-sync: source mode \. branch trunk \. source trunk @ /);
    assert.strictEqual(hook(dir).stdout, '');
  });

  test('`master` likewise', () => {
    const dir = repo('master');
    put(dir, 'CLAUDE.md', 'drifted\n');
    assert.match(check(dir).stdout, /x file CLAUDE\.md — differs from master/);
  });

  test('the remote\'s published default wins, whatever it is called (origin/HEAD)', () => {
    const origin = repo('stable');
    g(origin, 'checkout', '-q', 'stable');
    const dir = path.join(TMP, 'clone-' + (++seq));
    g(TMP, 'clone', '-q', origin, dir);
    const s = check(dir);
    assertGreen(s);
    assert.match(s.stdout, /^branch-sync: source mode \. branch stable \. source (origin\/)?stable @ [0-9a-f]+ \(origin-head\)\n/);

    g(dir, 'checkout', '-q', '-b', 'topic');
    assertGreen(check(dir));
    put(dir, 'CLAUDE.md', 'drifted\n');
    const r = check(dir);
    assertOnlyRed(r, ['file CLAUDE.md']);
    assert.match(r.stdout, /follower mode \. branch topic \. source (origin\/)?stable @ [0-9a-f]+ \(origin-head\)/);
    assert.ok(r.stdout.includes('Harness files change on `stable` first.'));
  });

  test('a name nothing can detect is SKIPPED and declared, never green', () => {
    const dir = repo('develop');
    put(dir, 'CLAUDE.md', 'drifted, but there is nothing to compare against\n');
    const r = check(dir);
    assert.match(r.stdout, /source NOT FOUND \(fallback\)/);
    assert.strictEqual(r.last, 'GATE branch-sync pass=1 fail=0 skipped=' + (TOTAL - 1));
    assert.match(r.stdout, /- file CLAUDE\.md — skipped: no source ref to compare against/);
  });

  test('...until the config override names it (project.sourceBranch)', () => {
    const dir = repo('develop');
    put(dir, 'CLAUDE.md', 'drifted\n');
    put(dir, 'harness.config.json', json(Object.assign({}, CONFIG, { project: { name: 'example', sourceBranch: 'develop' } })));
    const r = check(dir);
    assertOnlyRed(r, ['file CLAUDE.md']);
    assert.match(r.stdout, /follower mode \. branch feature \. source develop @ [0-9a-f]+ \(config\)/);
  });

  test('--ref and BRANCH_SYNC_REF compare against a named ref instead', () => {
    const dir = repo();
    g(dir, 'checkout', '-q', '-b', 'spike');
    put(dir, 'CLAUDE.md', '# agents\n\nA harness change still on a spike.\n');
    commit(dir, 'spike');
    g(dir, 'checkout', '-q', 'feature');
    assertGreen(check(dir));
    const byFlag = run(dir, ['--check', '--ref', 'spike']);
    assertOnlyRed(byFlag, ['file CLAUDE.md']);
    assert.match(byFlag.stdout, /source spike @ [0-9a-f]+ \(explicit\)/);
    assert.match(byFlag.stdout, /differs from spike/);
    assertOnlyRed(check(dir, { BRANCH_SYNC_REF: 'spike' }), ['file CLAUDE.md']);
  });
});

describe('--apply', () => {
  test('makes a drifted branch match, keeps what is the branch\'s own, and commits nothing', () => {
    const dir = repo();
    onSource(dir, 'main', () => {
      del(dir, '.claude/helpers/retired.cjs');
      put(dir, '.claude/helpers/added.cjs', '// new on the source\n');
      put(dir, 'AGENTS.md', POLICY_MD.replace('Rule one.', 'Rule one.\nRule two, added on the source.'));
    });
    put(dir, 'CLAUDE.md', 'edited in place\n');
    put(dir, '.claude/helpers/guard.cjs', '// weakened\n');
    put(dir, 'AGENTS.md', POLICY_MD.replace('The default branch.', 'The feature branch.'));
    put(dir, 'package.json', json({ name: 'feature-pkg', scripts: { test: 'true', lint: 'own' } }));
    put(dir, 'scripts/harness/gates.baseline.json', json({ total: 42 }));
    commit(dir, 'drift, every way at once');
    const head = g(dir, 'rev-parse', 'HEAD');
    assertOnlyRed(check(dir), ['file CLAUDE.md', 'dir .claude/helpers', 'section AGENTS.md', 'script package.json#test']);

    const a = run(dir, ['--apply']);
    assert.strictEqual(a.status, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /^branch-sync --apply: from main onto feature\n/);
    assert.match(a.stdout, /wrote {3}CLAUDE\.md/);
    assert.match(a.stdout, /removed \.claude\/helpers\/retired\.cjs/);
    assert.ok(!a.stdout.includes('OWED'), a.stdout);

    assertGreen(check(dir));
    assert.strictEqual(hook(dir).stdout, '');
    assert.strictEqual(get(dir, 'CLAUDE.md'), g(dir, 'show', 'main:CLAUDE.md'));
    assert.ok(!has(dir, '.claude/helpers/retired.cjs'));
    assert.ok(has(dir, '.claude/helpers/added.cjs'));
    const claude = get(dir, 'AGENTS.md');
    assert.ok(claude.includes('The feature branch.'), 'the branch keeps its own masked section');
    assert.ok(claude.includes('Rule two, added on the source.'), '...and takes the rest from the source');
    const pkg = JSON.parse(get(dir, 'package.json'));
    assert.deepStrictEqual(pkg, { name: 'feature-pkg', scripts: { test: 'node --test', lint: 'own' } });
    assert.deepStrictEqual(JSON.parse(get(dir, 'scripts/harness/gates.baseline.json')), { total: 42 }, 'perBranch is left alone');
    // It writes; it does not stage and does not commit. Reading the diff is the step.
    assert.strictEqual(g(dir, 'rev-parse', 'HEAD'), head);
    assert.strictEqual(g(dir, 'diff', '--cached', '--name-only'), '');
    assert.notStrictEqual(g(dir, 'status', '--porcelain'), '');
  });

  test('never rewrites .gitignore: a failing probe is OWED, and the exit code says so', () => {
    const dir = repo();
    put(dir, '.gitignore', 'scratch.tmp\n');
    const a = run(dir, ['--apply']);
    assert.strictEqual(a.status, 1);
    assert.match(a.stdout, /OWED {4}mustIgnore scripts\/harness\/gates\.json: .*port the matching stanza from main:\.gitignore by hand/);
    assert.strictEqual(get(dir, '.gitignore'), 'scratch.tmp\n');
  });

  test('on the source branch there is nothing to apply', () => {
    const dir = repo();
    g(dir, 'checkout', '-q', 'main');
    const a = run(dir, ['--apply']);
    assert.strictEqual(a.status, 0);
    assert.match(a.stdout, /this checkout IS the source \(main\)/);
  });
});

describe('the GATE line', () => {
  test('is the last line of --check in every state, and the count never moves', () => {
    const states = {
      'source branch': () => { const d = repo(); g(d, 'checkout', '-q', 'main'); return d; },
      'matching follower': () => repo(),
      'drifted follower': () => { const d = repo(); put(d, 'CLAUDE.md', 'x\n'); put(d, '.gitignore', ''); return d; },
      'no source ref': () => repo('develop'),
      'detached HEAD': () => { const d = repo(); g(d, 'checkout', '-q', '--detach', 'feature'); return d; },
    };
    for (const [name, make] of Object.entries(states)) {
      const r = check(make());
      assert.ok(r.gate, name + ': the last line is not a GATE line: ' + JSON.stringify(r.last));
      assert.strictEqual(r.gate.name, 'branch-sync', name);
      assert.strictEqual(r.gate.total, TOTAL, name + ': ' + r.last);
      assert.ok(r.stdout.endsWith(r.last + '\n'), name + ': nothing follows the GATE line');
      assert.strictEqual(r.stdout.split('\n').filter((l) => l.startsWith('GATE ')).length, 1, name + ': exactly one GATE line');
      assert.strictEqual(r.status, r.gate.fail ? 1 : 0, name + ': the exit code is the verdict');
    }
  });

  test('a detached HEAD with no CI variable is a follower, and a CI variable names it', () => {
    const dir = repo();
    g(dir, 'checkout', '-q', '--detach', 'main');
    assert.match(check(dir).stdout, /^branch-sync: follower mode \. branch \(detached\) /);
    assert.match(check(dir, { GITHUB_REF_NAME: 'main' }).stdout, /^branch-sync: source mode \. branch main /);
  });
});
