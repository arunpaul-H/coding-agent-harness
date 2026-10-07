'use strict';
/* ============================================================
   lifecycle.test.js — the phase lifecycle, driven from outside.

   close-phase.js and findings-check.js each carry a --self-test, and a self-test
   can only ever prove the pure decisions. What it cannot prove is the thing a
   reader actually relies on: that the SCRIPT, started as a process in a real git
   repo, refuses for the right reason and writes the receipt only when every
   mechanism agrees. So every case below builds a real repository in a temp
   directory (git init, a commit, a verdict file) and runs the scripts as children.

   THE FIXTURE IS A COPY OF THE HARNESS, NOT THIS REPO. The verdict file lives
   beside the script that reads it (see close-phase.js on why that path is not
   configurable), so a test that drove the live scripts would have to write a
   verdict into the live tree — a test that edits the evidence it is testing
   against. Each fixture therefore gets its own scripts/harness/, its own config
   and its own track, and nothing here reads or writes this repo's state.

   Run:  node --test "tests/lifecycle.test.js"
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
const HARNESS = path.join(REPO, 'scripts', 'harness');
const HELPERS = path.join(REPO, 'scripts', 'harness', 'guards');
const closePhase = require(path.join(HARNESS, 'close-phase.js'));
const findingsCheck = require(path.join(HARNESS, 'findings-check.js'));

const TRACK = 'demo';
const PREFIX = 'DM';
const CHECK_CMD = 'node scripts/harness/gates.js --check';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ---------- the fixture ---------- */

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/* Two ambient variables change what a child does, and neither may leak in:
   NODE_TEST_CONTEXT makes a nested `node --test` run nothing and exit 0, and
   CLAUDE_PROJECT_DIR is the config seam's fallback root, so a child that inherited
   it could grade the enclosing repo instead of the fixture. The recursion stamp is
   dropped for the reason findings-check.js gives: a stamped child refuses a ledger. */
function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.HARNESS_FINDINGS_CHECK;
  return Object.assign(env, extra || {});
}

const handoffText = (scope) => [
  '---',
  'id: demo-handoff',
  'kind: handoff',
  'status: open',
  'read_when: resuming the demo track',
  'phase_next: 2',
  '---',
  '# Handoff',
  '',
  '## ▶ NEXT',
  'Read, in this order:',
  '  docs/tracks/' + TRACK + '/README.md  (the standing rules)',
  'SCOPE: ' + scope,
  'Do NOT re-measure it; it is already measured.',
  'Figures come from scripts/harness/gates.json only.',
  'First commit: `feat(demo): the next thing`.',
  'Exit: `node scripts/harness/handoff-lint.js ' + TRACK + '`.',
  'Follow "How to work" in the track README.',
  '',
].join('\n');

const README_BODY = '# Demo track\n\n## How to work\n\nstatus: this line is body text, not a field\n';

function mkRepo(opts) {
  const o = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lifecycle-'));
  made.push(dir);
  const put = (rel, text) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return abs;
  };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' failed: ' + r.stdout + r.stderr);
    return String(r.stdout).trim();
  };

  for (const f of ['config.js', 'gates.js', 'close-phase.js', 'handoff-lint.js', 'findings-check.js']) {
    fs.mkdirSync(path.join(dir, 'scripts', 'harness'), { recursive: true });
    fs.copyFileSync(path.join(HARNESS, f), path.join(dir, 'scripts', 'harness', f));
  }
  /* The hygiene gate is a fixture, on purpose. close-phase.js reaches the hygiene check
     by GATE NAME out of the registry, so what is under test is that it RUNS the declared
     command and believes its exit code — not which checker a repo happens to register. */
  put('scripts/hygiene.js', [
    "'use strict';",
    "const { spawnSync } = require('node:child_process');",
    "const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });",
    "const stray = String(r.stdout).split('\\n').filter(Boolean);",
    "for (const s of stray) console.log('  stray: ' + s);",
    "console.log('GATE hygiene pass=' + (stray.length ? 0 : 1) + ' fail=' + stray.length + ' skipped=0');",
    'process.exit(stray.length ? 1 : 0);',
    '',
  ].join('\n'));
  const gates = o.noHygieneGate
    ? [{ name: 'noop', command: 'node -e "console.log(\'GATE noop pass=1 fail=0 skipped=0\')"' }]
    : [{ name: 'hygiene', command: 'node scripts/hygiene.js' }];
  put('harness.config.json', JSON.stringify({
    project: { name: 'example' },
    gates: gates,
    commitHygiene: { workDirs: ['scripts', 'docs'] },
  }, null, 2) + '\n');
  put('.gitignore', 'scripts/harness/gates.json\nscripts/harness/gates.red.*.log\n');
  const gateName = gates[0].name;
  put('scripts/harness/gates.baseline.json', JSON.stringify({
    gates: { [gateName]: { pass: 1, fail: 0, skipped: 0, total: 1 } },
  }, null, 2) + '\n');
  if (!o.noTrack) {
    put('docs/tracks/' + TRACK + '/README.md', [
      '---', 'id: demo', 'kind: track', 'status: open', 'read_when: working on the demo track',
      'trap_prefix: ' + PREFIX, '---', README_BODY,
    ].join('\n'));
    put('docs/tracks/' + TRACK + '/handoff.md', handoffText('one thing, and nothing else.'));
  }

  git('init', '-q');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Example Dev');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  const commitAll = (msg) => { git('add', '-A'); git('commit', '-q', '--no-verify', '-m', msg); return git('rev-parse', 'HEAD'); };
  commitAll('chore: fixture');

  const gatesJson = path.join(dir, 'scripts', 'harness', 'gates.json');
  /* A whole verdict, written as the JSON file the script reads back — the shape gates.js
     emits, not an object literal the real reader would never see. `generatedAt` is a few
     seconds ahead because the files above were written this same millisecond, and the
     staleness comparison is between a sub-millisecond mtime and a millisecond timestamp.
     A key passed as `undefined` is REMOVED, which is how the absent-flag case is built. */
  const verdict = (over) => {
    const doc = {
      generatedAt: new Date(Date.now() + 5000).toISOString(),
      commit: git('rev-parse', 'HEAD'),
      dirty: false,
      node: process.version,
      gates: { [gateName]: { pass: 1, fail: 0, skipped: 0, total: 1, exit: 0 } },
    };
    for (const [k, v] of Object.entries(over || {})) { if (v === undefined) delete doc[k]; else doc[k] = v; }
    fs.writeFileSync(gatesJson, JSON.stringify(doc, null, 2) + '\n');
    return doc;
  };
  const run = (script, args, env) => {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'harness', script)].concat(args || []),
      { cwd: dir, encoding: 'utf8', env: cleanEnv(env) });
    return { status: r.status, stdout: String(r.stdout), stderr: String(r.stderr), out: String(r.stdout) + String(r.stderr) };
  };
  const readme = path.join(dir, 'docs', 'tracks', TRACK, 'README.md');
  const handoff = path.join(dir, 'docs', 'tracks', TRACK, 'handoff.md');
  return { dir, put, git, commitAll, verdict, run, readme, handoff, gatesJson,
    close: (args) => run('close-phase.js', [TRACK].concat(args || [])) };
}

/** Exactly ONE precondition unmet, and it is the one named. Asserting the count is what
 *  keeps each case about its own condition: a fixture that tripped two refusals would
 *  pass a looser assertion while proving nothing about either. */
function refusesOn(r, pattern, fixPattern) {
  assert.strictEqual(r.status, 1, 'expected a refusal, got exit ' + r.status + ':\n' + r.out);
  assert.match(r.stderr, /CANNOT CLOSE demo — 1 precondition\(s\) unmet/, r.out);
  assert.match(r.stderr, pattern);
  assert.match(r.stderr, fixPattern, 'the refusal does not name the command that fixes it:\n' + r.stderr);
}
const frontmatter = (file) => closePhase.parseFrontmatter(fs.readFileSync(file, 'utf8'));
const RECEIPT_FIELDS = ['closed_phase', 'closed_at', 'gates_sha', 'block_sha', 'receipt'];
const noReceipt = (repo) => {
  const fm = frontmatter(repo.readme);
  for (const k of RECEIPT_FIELDS) assert.strictEqual(fm[k], undefined, 'a refused close wrote `' + k + '`');
};

/* ============================================================ */

describe('the lifecycle scripts check themselves', () => {
  for (const script of ['close-phase.js', 'findings-check.js']) {
    test(script + ' --self-test passes', () => {
      const r = spawnSync(process.execPath, [path.join(HARNESS, script), '--self-test'],
        { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^PASS — /m);
      assert.doesNotMatch(r.stdout, /^FAIL/m);
    });
  }

  test('close-phase with no track id is a usage error, not a close', () => {
    const repo = mkRepo();
    const r = repo.run('close-phase.js', []);
    assert.strictEqual(r.status, 2, r.out);
    assert.match(r.stderr, /usage: node scripts\/harness\/close-phase\.js <track-id>/);
  });

  test('an absent config is a hard stop with a fix, never a default suite', () => {
    const repo = mkRepo();
    fs.unlinkSync(path.join(repo.dir, 'harness.config.json'));
    // With no config above the cwd the seam falls back to two levels up from the script,
    // which is this same fixture: so the stop below is about the config, not about ROOT.
    const r = repo.close();
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /FATAL — no readable harness\.config\.json/);
    assert.match(r.stderr, /fix: /);
  });
});

describe('close-phase.js — verdicts, not assertions', () => {
  test('it refuses a track that does not exist', () => {
    const repo = mkRepo();
    repo.verdict();
    const r = repo.run('close-phase.js', ['no-such-track']);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /CANNOT CLOSE no-such-track/);
    assert.match(r.stderr, /no docs\/tracks\/no-such-track\/README\.md — there is no such track/);
    assert.match(r.stderr, /fix: /);
  });

  test('the track location comes from the config, not from the script', () => {
    const repo = mkRepo();
    const cfgFile = path.join(repo.dir, 'harness.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.project.tracksDir = 'work/streams';
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    const r = repo.run('close-phase.js', ['no-such-track']);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /no work\/streams\/no-such-track\/README\.md/);
  });

  test('a track with no handoff refuses: a phase closes by handing off', () => {
    const repo = mkRepo();
    fs.unlinkSync(repo.handoff);
    const r = repo.close();
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /no docs\/tracks\/demo\/handoff\.md/);
    assert.match(r.stderr, /fix: /);
  });

  test('a green verdict at HEAD on a clean tree closes the phase and writes the five fields', () => {
    const repo = mkRepo();
    repo.verdict();
    const before = fs.readFileSync(repo.readme, 'utf8');
    const r = repo.close();
    assert.strictEqual(r.status, 0, 'a precondition that blocks the good case gets removed:\n' + r.out);
    assert.match(r.stdout, /^CLOSED demo phase 1$/m);

    const fm = frontmatter(repo.readme);
    for (const k of RECEIPT_FIELDS) assert.ok(fm[k], 'the close did not write `' + k + '`');
    // The phase defaults to the handoff's `phase_next` minus one.
    assert.strictEqual(fm.closed_phase, '1');
    assert.strictEqual(fm.closed_at, new Date().toISOString().slice(0, 10));
    // Each hash is recomputed here from the file it claims to be about.
    assert.strictEqual(fm.gates_sha, sha256(fs.readFileSync(repo.gatesJson, 'utf8')));
    assert.strictEqual(fm.block_sha, sha256(closePhase.blockOf(fs.readFileSync(repo.handoff, 'utf8'))));
    assert.strictEqual(fm.receipt, closePhase.receiptFor(TRACK, fm.closed_phase, fm.gates_sha, fm.block_sha));
    assert.match(fm.receipt, /^[0-9a-f]{64}$/);

    // Written IN PLACE: the fields that were there keep their order, the body is untouched,
    // and a plain close does not promote the track to `complete`.
    const afterText = fs.readFileSync(repo.readme, 'utf8');
    assert.strictEqual(fm.status, 'open');
    assert.strictEqual(fm.trap_prefix, PREFIX);
    assert.ok(afterText.endsWith(README_BODY), 'the close edited the body of the README');
    assert.ok(afterText.startsWith(before.slice(0, before.indexOf('trap_prefix'))), 'the close reshuffled the frontmatter');
    assert.strictEqual(afterText.split('\n').filter((l) => /^receipt:/.test(l)).length, 1);
  });

  test('--phase overrides the default, wherever it sits on the command line', () => {
    const a = mkRepo(); a.verdict();
    assert.strictEqual(a.close(['--phase', '7']).status, 0);
    assert.strictEqual(frontmatter(a.readme).closed_phase, '7');
    const b = mkRepo(); b.verdict();
    const r = b.run('close-phase.js', ['--phase', '7', TRACK]);
    assert.strictEqual(r.status, 0, r.out);
    assert.strictEqual(frontmatter(b.readme).closed_phase, '7');
    // Same inputs apart from the verdict's timestamp, so only gates_sha may differ.
    assert.strictEqual(frontmatter(a.readme).block_sha, frontmatter(b.readme).block_sha);
  });

  test('a verdict recorded against a DIRTY tree refuses, and blames the tree', () => {
    const repo = mkRepo();
    repo.verdict({ dirty: true });
    const r = repo.close();
    refusesOn(r, /recorded against a DIRTY tree/, new RegExp('re-run: ' + CHECK_CMD));
    assert.match(r.stderr, /Commit or stash/);
    noReceipt(repo);
  });

  test('an ABSENT clean-tree flag refuses: absent is not clean', () => {
    // A verdict written before the flag existed, or one whose `git status` failed, answers
    // the question with silence. Silence is NOT RUN, and the refusal must not send the
    // reader off to stash work they have not got.
    for (const value of [undefined, null, 'false', 0]) {
      const repo = mkRepo();
      repo.verdict({ dirty: value });
      if (value === undefined) assert.ok(!('dirty' in JSON.parse(fs.readFileSync(repo.gatesJson, 'utf8'))));
      const r = repo.close();
      refusesOn(r, /does not record whether the tree was clean/, new RegExp('Re-run a verdict that answers it: ' + CHECK_CMD));
      assert.doesNotMatch(r.stderr, /DIRTY tree/, 'an unanswered flag was reported as a dirty tree (dirty: ' + JSON.stringify(value) + ')');
      assert.match(r.stderr, /NOT RUN/);
      noReceipt(repo);
    }
  });

  test('the clean-tree decision, driven through verdict files the way the close reads them', () => {
    const { dirtyViolations } = closePhase;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lifecycle-verdict-'));
    made.push(dir);
    const verdict = (name, dirty) => {
      const doc = { generatedAt: '2000-01-01T00:00:00.000Z', commit: 'f'.repeat(40), node: 'v0.0.0', gates: {} };
      if (dirty !== undefined) doc.dirty = dirty;
      const p = path.join(dir, name + '.json');
      fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    };
    assert.deepStrictEqual(dirtyViolations(verdict('clean', false)), []);
    const dirty = dirtyViolations(verdict('dirty', true));
    assert.strictEqual(dirty.length, 1, 'a verdict recorded against a dirty tree closed a phase');
    assert.match(dirty[0], /DIRTY tree/);
    const absent = dirtyViolations(verdict('absent', undefined));
    assert.strictEqual(absent.length, 1, 'a verdict that never recorded the flag was treated as clean');
    assert.doesNotMatch(absent[0], /DIRTY tree/);
    assert.deepStrictEqual(dirtyViolations(null).length, 1, 'no verdict at all is not a clean one');
    assert.ok(dirtyViolations(verdict('dirty', true), 'THE-FIX')[0].includes('THE-FIX'));
  });

  test('a verdict recorded at another commit refuses', () => {
    const repo = mkRepo();
    repo.verdict({ commit: 'f'.repeat(40) });
    const r = repo.close();
    refusesOn(r, /recorded at ffffffff, HEAD is [0-9a-f]{8} — that verdict is about another tree/, new RegExp('fix: ' + CHECK_CMD));
    noReceipt(repo);
  });

  test('a verdict from before the last commit refuses, even though it was green then', () => {
    const repo = mkRepo();
    repo.verdict();
    repo.put('docs/note.md', 'a later change\n');
    repo.commitAll('docs: a later change');
    const r = repo.close();
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /that verdict is about another tree/);
    noReceipt(repo);
  });

  test('a RED verdict refuses, through the gate runner\'s own comparator', () => {
    const repo = mkRepo();
    repo.verdict({ gates: { hygiene: { pass: 1, fail: 1, skipped: 0, total: 2, exit: 1 } } });
    const r = repo.close();
    refusesOn(r, /gates — hygiene: 1 failing check\(s\)/, new RegExp('fix: ' + CHECK_CMD));
    noReceipt(repo);
  });

  test('a vanished check is red even with nothing failing', () => {
    const repo = mkRepo();
    repo.verdict({ gates: { hygiene: { pass: 0, fail: 0, skipped: 0, total: 0, exit: 0 } } });
    const r = repo.close();
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /a check DISAPPEARED \(pass-by-absence\)/);
    noReceipt(repo);
  });

  test('a baseline gate missing from the verdict refuses: you cannot pass by not running it', () => {
    const repo = mkRepo();
    repo.verdict({ gates: { other: { pass: 1, fail: 0, skipped: 0, total: 1, exit: 0 } } });
    const r = repo.close();
    refusesOn(r, /gates — hygiene: did not run \(present in the baseline\)/, new RegExp('fix: ' + CHECK_CMD));
  });

  test('an empty verdict is not a green one', () => {
    const repo = mkRepo();
    fs.writeFileSync(path.join(repo.dir, 'scripts', 'harness', 'gates.baseline.json'), JSON.stringify({ gates: {} }) + '\n');
    repo.commitAll('gates: an empty baseline');
    repo.verdict({ gates: {} });
    const r = repo.close();
    refusesOn(r, /records no gates at all — an empty suite is not a green one/, new RegExp('fix: ' + CHECK_CMD));
  });

  test('a skip refuses unless it is declared, and the committed baseline declares it', () => {
    const skipped = { gates: { hygiene: { pass: 0, fail: 0, skipped: 1, total: 1, exit: 0 } } };
    const undeclared = mkRepo();
    undeclared.verdict(skipped);
    refusesOn(undeclared.close(), /gates — hygiene: skipped=1 and no --allow-skip hygiene=n was given/, new RegExp('fix: ' + CHECK_CMD));

    const onCli = mkRepo();
    onCli.verdict(skipped);
    assert.strictEqual(onCli.close(['--allow-skip', 'hygiene=1']).status, 0);

    // The fix line is GENERATED from the baseline, so it carries the flags this repo needs.
    const declared = mkRepo();
    fs.writeFileSync(path.join(declared.dir, 'scripts', 'harness', 'gates.baseline.json'),
      JSON.stringify({ gates: { hygiene: { pass: 0, fail: 0, skipped: 1, total: 1 } } }) + '\n');
    declared.commitAll('gates: declare the skip');
    declared.verdict(Object.assign({ dirty: true }, skipped));
    refusesOn(declared.close(), /DIRTY tree/, new RegExp(CHECK_CMD + ' --allow-skip hygiene=1'));
    declared.verdict(skipped);
    assert.strictEqual(declared.close().status, 0, 'a skip the committed baseline declares was refused');
  });

  test('a STALE verdict refuses and names the file that moved', () => {
    const repo = mkRepo();
    repo.verdict();
    // Content unchanged, so the tree stays clean and HEAD stays put: staleness is the only
    // thing wrong, and it is a DOC that moved, because docs are a gate input.
    const later = (Date.now() + 120000) / 1000;
    fs.utimesSync(repo.readme, later, later);
    const r = repo.close();
    refusesOn(r, /STALE: docs\/tracks\/demo\/README\.md changed after the run/, new RegExp('fix: ' + CHECK_CMD));
    assert.match(r.stderr, /A gate you did not run is NOT RUN/);
    noReceipt(repo);
  });

  test('editing the suite itself makes the verdict stale too', () => {
    const repo = mkRepo();
    repo.verdict();
    const later = (Date.now() + 120000) / 1000;
    fs.utimesSync(path.join(repo.dir, 'harness.config.json'), later, later);
    refusesOn(repo.close(), /STALE: harness\.config\.json changed after the run/, new RegExp('fix: ' + CHECK_CMD));
  });

  test('a verdict with no usable timestamp cannot be judged fresh', () => {
    const repo = mkRepo();
    repo.verdict({ generatedAt: undefined });
    refusesOn(repo.close(), /no usable `generatedAt`/, new RegExp('fix: ' + CHECK_CMD));
  });

  test('the staleness walk is driven by the config\'s own trees', () => {
    const { newestSource, sourceTrees, sourceFiles } = closePhase;
    const cfg = {
      project: { docsRoot: 'docs', tracksDir: 'docs/tracks' },
      commitHygiene: { workDirs: ['scripts', 'tests'] },
      docs: { caps: { 'AGENTS.md': 80, 'CLAUDE.md': 5, default: 150 } },
    };
    const dirs = sourceTrees(cfg);
    const files = sourceFiles(cfg, '/anywhere/harness.config.json');
    assert.ok(dirs.includes('docs'), 'the docs root is not in the set the staleness check walks');
    assert.ok(files.includes('CLAUDE.md') && files.includes('AGENTS.md') && files.includes('harness.config.json'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lifecycle-stale-'));
    made.push(root);
    const put = (rel, ms) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
      fs.utimesSync(abs, ms / 1000, ms / 1000);
    };
    const OLD = Date.now() - 900000;
    put('scripts/a.js', OLD);
    put('docs/tracks/t/README.md', OLD + 2000);
    put('CLAUDE.md', OLD + 1000);
    put('scripts/harness/gates.json', OLD + 60000);
    assert.strictEqual(newestSource(dirs, files, root).file, 'docs/tracks/t/README.md',
      'the newest file was under docs/ and the walk did not reach it');
    // The load-bearing half: with docs/ dropped the SAME tree answers with the older file,
    // so the assertion above is about the walk and not about which file is newest.
    assert.strictEqual(newestSource(dirs.filter((d) => d !== 'docs'), [], root).file, 'scripts/a.js');
    assert.strictEqual(newestSource(['scripts'], files, root).file, 'CLAUDE.md',
      'a root file sits under no tree, so only the file list can reach it');
  });

  test('no verdict at all refuses: nothing has graded this commit', () => {
    const repo = mkRepo();
    refusesOn(repo.close(), /no readable scripts\/harness\/gates\.json — nothing has graded this commit/, new RegExp('fix: ' + CHECK_CMD));
  });

  test('no baseline refuses: there is no verdict of record to compare against', () => {
    const repo = mkRepo();
    repo.git('rm', '-q', 'scripts/harness/gates.baseline.json');
    repo.commitAll('gates: drop the baseline');
    repo.verdict();
    refusesOn(repo.close(), /no readable scripts\/harness\/gates\.baseline\.json/, /fix: node scripts\/harness\/gates\.js --accept/);
  });

  test('a hygiene-dirty tree refuses, re-run now rather than read off the verdict', () => {
    const repo = mkRepo();
    repo.verdict();   // says the tree WAS clean, which was true when it was recorded
    repo.put('stray.txt', 'left behind\n');
    const r = repo.close();
    refusesOn(r, /the `hygiene` gate is not clean/, /fix: node scripts\/hygiene\.js/);
    assert.match(r.stderr, /stray: \?\? stray\.txt/, 'the refusal does not carry what the hygiene check said');
    noReceipt(repo);
  });

  test('a repo that declares no hygiene gate refuses: no pass by absence', () => {
    const repo = mkRepo({ noHygieneGate: true });
    repo.verdict();
    refusesOn(repo.close(), /no gate named `hygiene` in harness\.config\.json/, /fix: add \{ "name": "hygiene"/);
  });

  test('a handoff that fails handoff-lint refuses', () => {
    const repo = mkRepo();
    fs.writeFileSync(repo.handoff, handoffText('one thing.').replace(/^SCOPE:.*\n/m, ''));
    repo.commitAll('docs: a handoff with no scope');
    repo.verdict();
    const r = repo.close();
    refusesOn(r, /handoff-lint failed:[\s\S]*no `SCOPE:` line/, /fix: node scripts\/harness\/handoff-lint\.js demo/);
    noReceipt(repo);
  });

  test('a handoff with no ▶ block refuses', () => {
    const repo = mkRepo();
    fs.writeFileSync(repo.handoff, '---\nid: demo-handoff\nphase_next: 2\n---\n# Handoff\n\nnothing yet\n');
    repo.commitAll('docs: an empty handoff');
    repo.verdict();
    const r = repo.close();
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /handoff\.md carries no ▶ block/);
    assert.match(r.stderr, /fix: write one ▶ block/);
    noReceipt(repo);
  });

  test('an UNCHANGED ▶ block refuses the next close, and a replaced one is accepted', () => {
    const repo = mkRepo();
    repo.verdict();
    assert.strictEqual(repo.close().status, 0);
    const first = frontmatter(repo.readme);

    // The receipt is committed and a fresh verdict recorded, so the block is the ONLY
    // thing that has not moved.
    repo.commitAll('docs: close phase 1');
    repo.verdict();
    const again = repo.close();
    refusesOn(again, /the ▶ block is byte-identical to the one that closed phase 1/, /fix: replace handoff\.md wholesale, then re-run this command/);
    assert.deepStrictEqual(frontmatter(repo.readme), first, 'a refused close rewrote the receipt');

    // Text outside the block is not a new handoff.
    fs.writeFileSync(repo.handoff, fs.readFileSync(repo.handoff, 'utf8').replace('# Handoff', '# Handoff, retitled'));
    repo.commitAll('docs: retitle the handoff');
    repo.verdict();
    refusesOn(repo.close(), /byte-identical/, /fix: replace handoff\.md wholesale/);

    fs.writeFileSync(repo.handoff, handoffText('the next thing, and nothing else.').replace('phase_next: 2', 'phase_next: 3'));
    repo.commitAll('docs: hand off phase 2');
    repo.verdict();
    const next = repo.close();
    assert.strictEqual(next.status, 0, next.out);
    const second = frontmatter(repo.readme);
    assert.strictEqual(second.closed_phase, '2');
    assert.notStrictEqual(second.block_sha, first.block_sha);
    assert.notStrictEqual(second.receipt, first.receipt);
    // Replaced in place: one of each field, not a second set appended.
    const text = fs.readFileSync(repo.readme, 'utf8');
    for (const k of RECEIPT_FIELDS) assert.strictEqual(text.split('\n').filter((l) => l.startsWith(k + ':')).length, 1, k);
  });

  test('every unmet precondition is reported at once, each with its own fix', () => {
    const repo = mkRepo();
    repo.verdict({ dirty: true, commit: 'f'.repeat(40), gates: { hygiene: { pass: 1, fail: 1, skipped: 0, total: 2, exit: 1 } } });
    repo.put('stray.txt', 'left behind\n');
    const r = repo.close();
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stderr, /4 precondition\(s\) unmet/);
    const findings = r.stderr.split(/\n {2}x /).slice(1);
    assert.strictEqual(findings.length, 4);
    for (const f of findings) assert.match(f, /fix: |re-run: /i, 'a refusal with no fix command:\n' + f);
    assert.match(r.stderr, /Fix the finding; do not assert past it/);
    noReceipt(repo);
  });

  test('a verdict the real gate runner recorded closes a phase', () => {
    /* The cases above write the verdict by hand, which proves the reader. This one lets
       gates.js write it, which proves the two files agree on the shape — including the
       declared skip of the artifact check, which this fixture has no artifacts for. */
    const repo = mkRepo();
    const allow = ['--allow-skip', 'reproducible-build=1'];
    const accept = repo.run('gates.js', ['--accept'].concat(allow));
    assert.strictEqual(accept.status, 0, accept.out);
    repo.commitAll('gates: baseline');
    const check = repo.run('gates.js', ['--check'].concat(allow));
    assert.strictEqual(check.status, 0, check.out);
    const recorded = JSON.parse(fs.readFileSync(repo.gatesJson, 'utf8'));
    assert.strictEqual(recorded.dirty, false, 'gates.js did not record a clean tree as the boolean false');
    assert.strictEqual(recorded.commit, repo.git('rev-parse', 'HEAD'));
    const r = repo.close();
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.stdout, /^CLOSED demo phase 1$/m);

    // And the same runner, over uncommitted work, records a verdict the close refuses.
    const dirty = mkRepo();
    assert.strictEqual(dirty.run('gates.js', ['--accept'].concat(allow)).status, 0);
    dirty.commitAll('gates: baseline');
    dirty.put('docs/wip.md', 'uncommitted\n');
    dirty.run('gates.js', ['--check'].concat(allow));
    assert.strictEqual(JSON.parse(fs.readFileSync(dirty.gatesJson, 'utf8')).dirty, true);
    const refused = dirty.close();
    assert.strictEqual(refused.status, 1, refused.out);
    assert.match(refused.stderr, /recorded against a DIRTY tree/);
    noReceipt(dirty);
  });
});

describe('the receipt — one function, exported, never copied', () => {
  test('the receipt is a function of all four inputs and of nothing else', () => {
    const { receiptFor } = closePhase;
    assert.strictEqual(typeof receiptFor, 'function');
    // The linter reads the phase back out of frontmatter as a STRING; the close passes a number.
    assert.strictEqual(receiptFor('t', '4', 'g', 'b'), receiptFor('t', 4, 'g', 'b'));
    assert.notStrictEqual(receiptFor('t', '4', 'g', 'b'), receiptFor('t', '5', 'g', 'b'));
    assert.notStrictEqual(receiptFor('t', '4', 'g', 'b'), receiptFor('u', '4', 'g', 'b'));
    assert.notStrictEqual(receiptFor('t', '4', 'g', 'b'), receiptFor('t', '4', 'h', 'b'));
    assert.notStrictEqual(receiptFor('t', '4', 'g', 'b'), receiptFor('t', '4', 'g', 'c'));
    assert.notStrictEqual(receiptFor('t', 45, 'a', 'b'), receiptFor('t', 4, '5a', 'b'));
  });

  test('the doc linter holds no copy of the formula: it imports close-phase.js', () => {
    const src = fs.readFileSync(path.join(HELPERS, 'docs-lint.cjs'), 'utf8');
    // `assert.ok` on a boolean, not `assert.match` on the source: a failure here should
    // print one sentence, not the whole linter.
    assert.ok(/require\([^;\n]*'close-phase\.js'\)\)/.test(src), 'the doc linter does not require close-phase.js');
    assert.ok(/receiptFor = cp\.receiptFor/.test(src), 'the doc linter does not take `receiptFor` from close-phase.js');
    assert.ok(!/createHash|node:crypto/.test(src), 'the doc linter can hash, so it can hold a second copy of the receipt');
  });

  test('the receipt the doc linter recomputes is whatever close-phase.js exports', () => {
    /* Driven, not read. The linter runs as a process in a fixture that has just been closed
       for real, and then against a close-phase.js swapped for a stub with a DIFFERENT
       formula. A linter holding a private copy would go on accepting the real receipt and
       reject the stub's; one that imports the function does the opposite. */
    const repo = mkRepo();
    for (const f of ['docs-lint.cjs', 'doc-frozen.cjs']) {
      fs.mkdirSync(path.join(repo.dir, 'scripts', 'harness', 'guards'), { recursive: true });
      fs.copyFileSync(path.join(HELPERS, f), path.join(repo.dir, 'scripts', 'harness', 'guards', f));
    }
    // The linter reads the instruction-file names off the tool registry, so both travel with it.
    for (const f of ['tools.js', 'tools.json']) fs.copyFileSync(path.join(HARNESS, f), path.join(repo.dir, 'scripts', 'harness', f));
    repo.commitAll('chore: add the doc linter');
    repo.verdict();
    assert.strictEqual(repo.close().status, 0);
    const lint = () => {
      const r = spawnSync(process.execPath, [path.join(repo.dir, 'scripts', 'harness', 'guards', 'docs-lint.cjs')],
        { cwd: repo.dir, encoding: 'utf8', env: cleanEnv() });
      return String(r.stdout) + String(r.stderr);
    };
    const REJECTED = /docs\/tracks\/demo\/README\.md: `receipt:` does not recompute/;
    const setField = (k, v) => fs.writeFileSync(repo.readme,
      closePhase.setFrontmatter(fs.readFileSync(repo.readme, 'utf8'), { [k]: v }));
    const honest = frontmatter(repo.readme);

    const clean = lint();
    assert.match(clean, /GATE docs pass=\d+ fail=\d+ skipped=\d+\s*$/, 'the linter did not reach its verdict:\n' + clean);
    assert.doesNotMatch(clean, REJECTED, 'the linter rejected a receipt close-phase.js had just written:\n' + clean);
    assert.doesNotMatch(clean, /receipt.*SKIPPED|SKIPPED.*receipt/i, 'the receipt check was skipped, so nothing was recomputed');

    // A typed receipt, and a receipt whose inputs were edited under it, do not survive.
    setField('receipt', 'f'.repeat(64));
    assert.match(lint(), REJECTED, 'a typed receipt verified');
    setField('receipt', honest.receipt);
    setField('closed_phase', '9');
    assert.match(lint(), REJECTED, 'a receipt verified for a phase it was not written for');
    setField('closed_phase', honest.closed_phase);
    assert.doesNotMatch(lint(), REJECTED);

    // The swap.
    fs.writeFileSync(path.join(repo.dir, 'scripts', 'harness', 'close-phase.js'),
      "'use strict';\nmodule.exports = { receiptFor: (id, phase) => 'stub.' + id + '.' + phase };\n");
    assert.match(lint(), REJECTED, 'the linter accepted the real receipt after the exported formula changed — it is using a copy');
    setField('receipt', 'stub.' + TRACK + '.' + honest.closed_phase);
    assert.doesNotMatch(lint(), REJECTED, 'the linter rejected the receipt the exported function produces — it is using a copy');
  });
});

describe('findings-check.js — a finding is closed when a command says so', () => {
  const GATE_LINE = /^GATE ([a-z][a-z0-9-]*) pass=(\d+) fail=(\d+) skipped=(\d+)$/;
  const row = (n, over) => Object.assign({
    id: PREFIX + '-F0' + n, status: 'open', claim: 'a thing that is wrong',
    evidence: 'docs/anchor.md:2', proof: "sh -c 'exit 1'", proofMeans: 'exits 0 once the thing is fixed',
  }, over || {});
  /** One fixture repo with a ledger in the track folder, graded through `--track`. */
  const grade = (findings, o) => {
    const opt = o || {};
    const repo = opt.repo || mkRepo();
    repo.put('docs/anchor.md', 'one\ntwo\nthree\n');
    const doc = Object.assign({ schema: 1, track: TRACK, findings: findings }, opt.doc || {});
    const ledger = repo.put('docs/tracks/' + TRACK + '/findings.json', JSON.stringify(doc, null, 2) + '\n');
    const before = fs.readFileSync(ledger, 'utf8');
    const r = repo.run('findings-check.js', opt.args || ['--track', TRACK], opt.env);
    assert.strictEqual(fs.readFileSync(ledger, 'utf8'), before, 'the checker edited the ledger it was grading');
    const lines = r.stdout.trimEnd().split('\n');
    const m = lines[lines.length - 1].match(GATE_LINE);
    assert.ok(m, 'the last stdout line is not a well-formed GATE line: ' + JSON.stringify(lines[lines.length - 1]) + '\n' + r.out);
    return Object.assign(r, { repo, gate: { name: m[1], pass: Number(m[2]), fail: Number(m[3]), skipped: Number(m[4]) } });
  };

  test('a ledger that agrees with its proofs is green and ends in a GATE line', () => {
    const r = grade([
      row(1, { status: 'closed', proof: "sh -c 'exit 0'" }),
      row(2),
      row(3, { status: 'deferred', evidence: 'docs/anchor.md' }),
      row(4, { proof: null, proofMeans: 'needs a person to look at it' }),
    ]);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.stdout, /LEDGER GREEN/);
    // Open is the NORMAL state of a backlog and is not red. Uncheckable is neither.
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 3, fail: 0, skipped: 1 });
    assert.strictEqual(r.gate.pass + r.gate.fail + r.gate.skipped, 4, 'the figures do not add up to the rows in the ledger');
  });

  test('a finding marked closed with no evidence is refused, even when its proof passes', () => {
    const noField = row(1, { status: 'closed', proof: "sh -c 'exit 0'" });
    delete noField.evidence;
    for (const bad of [noField, row(1, { status: 'closed', proof: "sh -c 'exit 0'", evidence: '   ' })]) {
      const r = grade([bad, row(2)]);
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stdout, /LEDGER RED/);
      assert.match(r.stdout, /DM-F01: recorded closed with no `evidence`/);
      assert.deepStrictEqual(r.gate, { name: 'findings', pass: 1, fail: 1, skipped: 0 });
    }
    // The same absence on an OPEN row is not charged: there is nothing closed to read.
    const open = row(1);
    delete open.evidence;
    assert.strictEqual(grade([open]).status, 0);
  });

  test('a finding marked closed that nothing can check is refused', () => {
    const r = grade([row(1, { status: 'closed', proof: null, proofMeans: 'trust me' })]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /DM-F01: recorded closed with proof null — a closure nothing can check/);
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 0, fail: 1, skipped: 0 });
  });

  test('a false closure is refused, and so is a ledger lagging the tree', () => {
    const r = grade([
      row(1, { status: 'closed', proof: "sh -c 'exit 3'" }),
      row(2, { status: 'open', proof: "sh -c 'exit 0'" }),
    ]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /DM-F01: recorded closed, but its proof exits 3 — NOT a closure/);
    assert.match(r.stdout, /DM-F02: recorded open, but its proof already passes — the ledger lags the tree/);
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 0, fail: 2, skipped: 0 });
  });

  test('evidence that does not resolve in the tree is refused, whatever the status', () => {
    const r = grade([
      row(1, { status: 'closed', proof: "sh -c 'exit 0'", evidence: 'docs/gone.md:4' }),
      row(2, { evidence: 'docs/anchor.md:99' }),
      row(3, { evidence: '../outside/x.md' }),
      row(4, { evidence: 'docs' }),
      row(5),
    ]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /DM-F01: evidence `docs\/gone\.md` does not resolve in this tree/);
    assert.match(r.stdout, /DM-F02: evidence `docs\/anchor\.md:99` is past the end of the file/);
    assert.match(r.stdout, /DM-F03: evidence `\.\.\/outside\/x\.md` points outside the repo/);
    assert.match(r.stdout, /DM-F04: evidence `docs` is not a file/);
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 1, fail: 4, skipped: 0 });
  });

  test('an id that does not resolve to this track is refused and its proof never runs', () => {
    const marker = 'ran.marker';
    const r = grade([
      row(1, { id: 'ZZ-F01', proof: 'touch ' + marker }),
      row(2, { id: 'DMX-F02' }),
      row(3, { id: 'F03' }),
      row(4),
    ]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /ZZ-F01: id is outside this track's namespace — `trap_prefix` is `DM`/);
    assert.match(r.stdout, /DMX-F02: id is outside this track's namespace/);
    assert.match(r.stdout, /F03: id is outside this track's namespace/);
    assert.match(r.stdout, /MALFORMED/);
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 1, fail: 3, skipped: 0 });
    assert.ok(!fs.existsSync(path.join(r.repo.dir, marker)), 'a malformed row had its proof run anyway');
  });

  test('the id namespace comes from the track README, and a drifted second copy is an error', () => {
    // No prefix anywhere: nothing can be validated, so the ledger is refused rather than waved through.
    const bare = mkRepo();
    fs.writeFileSync(bare.readme, fs.readFileSync(bare.readme, 'utf8').replace(/^trap_prefix:.*\n/m, ''));
    const none = grade([row(1)], { repo: bare });
    assert.strictEqual(none.status, 1, none.out);
    assert.match(none.stdout, /no `trap_prefix` for this ledger/);
    assert.deepStrictEqual(none.gate, { name: 'findings', pass: 0, fail: 1, skipped: 0 });
    // ...where the ledger may carry it instead.
    assert.strictEqual(grade([row(1)], { repo: bare, doc: { trap_prefix: PREFIX } }).status, 0);

    const drift = grade([row(1)], { doc: { trap_prefix: 'ZZ' } });
    assert.strictEqual(drift.status, 1, drift.out);
    assert.match(drift.stdout, /two copies that have drifted/);

    // A ledger named by PATH picks up the prefix of the track folder it sits in.
    const byPath = grade([row(1), row(2, { id: 'ZZ-F02' })], { args: ['docs/tracks/' + TRACK + '/findings.json'] });
    assert.match(byPath.stdout, /ZZ-F02: id is outside this track's namespace — `trap_prefix` is `DM`/);
    assert.deepStrictEqual(byPath.gate, { name: 'findings', pass: 1, fail: 1, skipped: 0 });
  });

  test('a malformed row is a failing row, named', () => {
    const r = grade([
      row(1, { status: 'done' }),
      row(2),
      row(2),
      row(3, { proof: null, proofMeans: '' }),
      row(4, { proof: 7 }),
    ]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /DM-F01: status "done" is not one of open, closed, deferred, wontfix/);
    assert.match(r.stdout, /DM-F02: duplicate id/);
    assert.match(r.stdout, /DM-F03: proof is null and proofMeans does not say why/);
    assert.match(r.stdout, /DM-F04: proof must be a non-empty command string, or null/);
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 1, fail: 4, skipped: 0 });
  });

  test('a proof that cannot run is an ERROR and reds the ledger, never a silent "still open"', () => {
    const r = grade([row(1, { proof: 'harness-no-such-command-anywhere' }), row(2)]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /DM-F01\s+ERROR/);
    assert.match(r.stdout, /DM-F01: its proof DID NOT RUN — command not found/);
    assert.deepStrictEqual(r.gate, { name: 'findings', pass: 1, fail: 1, skipped: 0 });
  });

  test('proofs run from the repo root', () => {
    const r = grade([row(1, { status: 'closed', proof: 'test -f harness.config.json && test -f docs/anchor.md' })]);
    assert.strictEqual(r.status, 0, r.out);
  });

  test('every way out still ends in a well-formed GATE line', () => {
    // A check that dies before its verdict is indistinguishable from a crash, and the gate
    // runner treats a missing GATE line as a hard failure. `grade` asserts the line itself.
    const usage = grade([row(1)], { args: [] });
    assert.strictEqual(usage.status, 1);
    assert.match(usage.stdout, /usage: node scripts\/harness\/findings-check\.js/);
    assert.deepStrictEqual(usage.gate, { name: 'findings', pass: 0, fail: 1, skipped: 0 });

    const missing = grade([row(1)], { args: ['--track', 'no-such-track'] });
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stdout, /FAIL — cannot read /);
    assert.strictEqual(missing.gate.fail, 1);

    const repo = mkRepo();
    repo.put('docs/tracks/' + TRACK + '/broken.json', '{ not json');
    const broken = repo.run('findings-check.js', ['docs/tracks/' + TRACK + '/broken.json']);
    assert.strictEqual(broken.status, 1);
    assert.match(broken.stdout.trimEnd().split('\n').pop(), GATE_LINE);

    const shapeless = grade([], { doc: { findings: 'none' } });
    assert.strictEqual(shapeless.status, 1);
    assert.match(shapeless.stdout, /no findings array/);

    // The recursion guard: a proof that invoked the checker would run its own proof.
    const nested = grade([row(1)], { env: { HARNESS_FINDINGS_CHECK: '1' } });
    assert.strictEqual(nested.status, 1);
    assert.match(nested.stdout, /refusing to check a ledger from inside a proof command/);
    assert.match(nested.stdout, /fix: /);
    assert.strictEqual(nested.gate.fail, 1);

    // --gate renames the line, which is how one ledger per track can each be a gate.
    const named = grade([row(1)], { args: ['--track', TRACK, '--gate', 'findings-demo'] });
    assert.strictEqual(named.status, 0, named.out);
    assert.deepStrictEqual(named.gate, { name: 'findings-demo', pass: 1, fail: 0, skipped: 0 });
  });

  test('a proof child is stamped, so a ledger cannot check itself into a fork bomb', () => {
    const r = grade([row(1, {
      status: 'closed',
      proof: 'node scripts/harness/findings-check.js --track ' + TRACK,
      proofMeans: 'a row that grades its own ledger',
    })]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.stdout, /DM-F01: recorded closed, but its proof exits 1/);
  });

  test('the GATE line is one exported function, and it counts rows', () => {
    assert.strictEqual(findingsCheck.gateLine('findings', { pass: 3, fail: 1, skipped: 2 }), 'GATE findings pass=3 fail=1 skipped=2');
    assert.match(findingsCheck.gateLine(findingsCheck.DEFAULT_GATE, { pass: 0, fail: 0, skipped: 0 }), GATE_LINE);
  });

  describe('a proof that passes for nothing is caught, not trusted', () => {
    /* `node --test --test-name-pattern <p>` exits 0 when p matches NOTHING, so a proof
       written as a filtered run keeps passing after the block it names is renamed or
       deleted. The guard is DRIVEN: the checker re-runs the proof with the pattern broken
       and reds a proof that still exits 0. */
    const mini = (repo) => {
      repo.put('docs/mini.test.js', "const { test } = require('node:test');\ntest('alpha bravo', () => {});\n");
      return 'docs/mini.test.js';
    };

    test('a filtered run that reads only the exit code is reported as vacuous', () => {
      const repo = mkRepo();
      const t = mini(repo);
      // Names a test that EXISTS, so it passes — and would go on passing if the test vanished.
      const r = grade([row(1, { status: 'closed', proof: 'node --test --test-name-pattern "alpha bravo" ' + t })], { repo });
      assert.match(r.stdout, /VACUOUS/, 'a proof that passes with a pattern matching nothing was trusted');
      assert.strictEqual(r.status, 1, 'a vacuous proof left the ledger green');
      assert.deepStrictEqual(r.gate, { name: 'findings', pass: 0, fail: 1, skipped: 0 });
    });

    test('a filtered run that reads the TAP lines is not', () => {
      // The half that decides whether the mechanism is usable at all: a guard that reds a
      // sound proof is removed within the day.
      const repo = mkRepo();
      const t = mini(repo);
      // `# SKIP` is refused first, and that is measured: Node 20 still PRINTS a test the pattern
      // filtered out, as `ok 1 - alpha bravo # SKIP test name does not match pattern` (Node 22
      // omits it), so a proof that looks only for the `ok` line is vacuous there after all.
      const proof = 'sh -c \'o=$(node --test --test-reporter=tap --test-name-pattern "alpha bravo" '
        + t + ' 2>&1); case "$o" in *"# SKIP"*) exit 1;; *"ok 1 - alpha bravo"*) exit 0;; esac; exit 1\'';
      const r = grade([row(1, { status: 'closed', proof })], { repo });
      assert.doesNotMatch(r.stdout, /VACUOUS/, 'a proof that reads its TAP lines was called vacuous');
      assert.strictEqual(r.status, 0, 'a sound proof reds the ledger: ' + r.out);
    });

    test('a proof with no pattern at all is never probed', () => {
      const r = grade([row(1, { status: 'closed', proof: "sh -c 'exit 0'" })]);
      assert.doesNotMatch(r.stdout, /VACUOUS/);
      assert.strictEqual(r.status, 0, r.out);
    });
  });
});
