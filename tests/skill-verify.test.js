'use strict';
/* ============================================================
   skill-verify.test.js — the supply-chain layer, driven black-box.

   A skill is prose the model follows as instruction, so the verifier's whole job
   is to make a change LOUD. Its --self-test drives the pure decisions with
   literals; what that cannot reach is everything that reads a tree, a lock and a
   home directory — and those wrappers are where a verifier goes vacuous: it
   returns early, prints nothing, and the silence reads as "checked and fine".

   So every case here runs the REAL scripts/harness/guards/skill-verify.cjs as a process
   against a temp directory that is a whole little repo: a harness.config.json at
   the root (which is how config.js finds ROOT from the cwd), a skills-lock.json,
   and skill directories under the two roots the agent loads from. Three reasons
   an import cannot do this:
     · the verdict is an EXIT CODE and the last line of stdout
     · ROOT is decided once, at load time, from the cwd
     · --update WRITES the lock, and must never be pointed at the real one

   The home directory is ALWAYS overridden. The plugin half reads the operator's
   own agent settings, and an assertion that depended on which plugins this box
   happens to have enabled would be a flake rather than a test.

   Every skill name in here is invented. No third-party skill is named.
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'harness', 'guards', 'skill-verify.cjs');
const SHIPPED_LOCK = path.join(ROOT, 'skills-lock.json');

// The digest functions are pure over an absolute directory, so the fixtures
// borrow them to write a lock that is TRUE — and then break the tree under it.
const { hashSkillDir, fileDigests, HASH_ALGO, GATE_NAME } = require(SCRIPT);

const GATE_LINE = /^GATE skills pass=(\d+) fail=(\d+) skipped=(\d+)$/;
const OLD_DATE = '2020-01-01';
const utcDay = () => new Date().toISOString().slice(0, 10);

/* ---------- the fixture repo ---------- */

function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-skills-')));
  fs.writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify({
    project: { name: 'example' },
    gates: [{ name: 'skills', command: 'node scripts/harness/guards/skill-verify.cjs --check' }],
  }, null, 2));
  // An EMPTY home: no agent settings, so no plugin surface unless a case adds one.
  fs.mkdirSync(path.join(dir, 'home'));
  return dir;
}
function withRepo(body) {
  const dir = makeRepo();
  try { return body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const put = (dir, rel, body) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
const VENDORED = '.agents/skills';
const LIVE = '.claude/skills';
const addSkill = (dir, root, name, extra) => {
  put(dir, root + '/' + name + '/SKILL.md', '---\nname: ' + name + '\n---\n# ' + name + '\n\nDescribes a task.\n');
  for (const rel of Object.keys(extra || {})) put(dir, root + '/' + name + '/' + rel, extra[rel]);
};
// A lock entry that truthfully describes what is on disk right now.
const pin = (dir, name, over) => {
  const abs = path.join(dir, VENDORED, name);
  return Object.assign({
    source: 'local', sourceType: 'local', skillPath: 'skills/' + name,
    skillDir: VENDORED + '/' + name, reviewedAt: OLD_DATE,
    computedHash: hashSkillDir(abs), fileDigests: fileDigests(abs), hashAlgo: HASH_ALGO,
  }, over || {});
};
const lockFile = (dir) => path.join(dir, 'skills-lock.json');
const writeLock = (dir, skills, more) => fs.writeFileSync(lockFile(dir),
  JSON.stringify(Object.assign({ version: 2, skills: skills || {} }, more || {}), null, 2) + '\n');
const readLock = (dir) => JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'));

/* ---------- running the real script ---------- */

function sv(dir, args, opts) {
  const o = opts || {};
  const env = Object.assign({}, process.env);
  // Inherited, CLAUDE_PROJECT_DIR would point every fixture at the real repo.
  delete env.CLAUDE_PROJECT_DIR;
  const home = o.home === undefined ? path.join(dir, 'home') : o.home;
  env.USERPROFILE = home;
  env.HOME = home;
  const r = spawnSync(process.execPath, [SCRIPT].concat(args || []), {
    cwd: dir, encoding: 'utf8', input: o.stdin === undefined ? '' : o.stdin, env,
  });
  r.lines = String(r.stdout).split(/\r?\n/).filter((l) => l.length);
  r.last = r.lines[r.lines.length - 1] || '';
  r.all = r.stdout + r.stderr;
  return r;
}
const json = (dir, opts) => {
  const r = sv(dir, ['--json'], opts);
  assert.notStrictEqual(r.status, 2, 'the verifier crashed: ' + r.all);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, '--json emitted non-JSON: ' + r.all);
  return { r, parsed };
};
const gateOf = (r) => {
  const m = r.last.match(GATE_LINE);
  assert.ok(m, 'the LAST stdout line is not a well-formed GATE line: ' + JSON.stringify(r.last) + '\n' + r.all);
  return { pass: Number(m[1]), fail: Number(m[2]), skipped: Number(m[3]) };
};
const errorsOf = (parsed) => parsed.findings.filter((f) => f.severity === 'error');
const tagged = (parsed, tag, name) => parsed.findings.find(
  (f) => f.name === name && f.message.startsWith(tag + ' '));
// SessionStart output is either nothing at all or one JSON object. Never prose.
const hookOf = (r) => {
  assert.strictEqual(r.status, 0, 'a SessionStart hook that exits non-zero is a broken session: ' + r.all);
  if (!r.stdout.trim()) return null;
  let j;
  assert.doesNotThrow(() => { j = JSON.parse(r.stdout); }, '--hook emitted non-JSON: ' + r.stdout);
  assert.strictEqual(j.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.strictEqual(typeof j.hookSpecificOutput.additionalContext, 'string');
  return j;
};

// A home whose agent state enables one plugin, installed at a known commit.
const PLUGIN = 'sample-plugin@example-market';
const homeWithPlugin = (dir, sha) => {
  const home = path.join(dir, 'home');
  put(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: { [PLUGIN]: true } }));
  put(home, '.claude/plugins/installed_plugins.json',
    JSON.stringify({ plugins: { [PLUGIN]: [sha ? { gitCommitSha: sha } : {}] } }));
  return home;
};

/* ============================================================ */

describe('skill-verify.cjs — the self-test', () => {
  test('--self-test passes', () => {
    const r = sv(ROOT, ['--self-test'], { home: path.join(os.tmpdir(), 'harness-no-such-home') });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.stdout, /^PASS/m, r.stdout);
    // A floor, not an equality: adding assertions is progress, DELETING them is
    // the regression this catches.
    const n = Number((r.stdout.match(/\((\d+) assertions/) || [])[1]);
    assert.ok(n >= 38, 'the self-test dropped to ' + n + ' assertions — a decision lost its driver');
  });

  test('the GATE name is the one the gate registry declares', () => {
    // If these disagree the runner reads no verdict and reports that the gate
    // died before printing one, which sends the reader to the wrong file.
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness.config.json'), 'utf8'));
    const gate = cfg.gates.find((g) => /skill-verify\.cjs/.test(g.command));
    assert.ok(gate, 'no gate in harness.config.json runs skill-verify.cjs');
    assert.match(gate.command, /--check\b/, 'the gate must run the mode that prints a GATE line');
    assert.strictEqual(gate.gateLine || gate.name, GATE_NAME);
  });
});

describe('skills-lock.json — shipped empty, on purpose', () => {
  const shipped = JSON.parse(fs.readFileSync(SHIPPED_LOCK, 'utf8'));

  test('it is exactly {"version": 2, "skills": {}} plus a _readme', () => {
    // A lock inherited from someone else's machine pins someone else's review.
    const rest = Object.assign({}, shipped);
    delete rest._readme;
    assert.deepStrictEqual(rest, { version: 2, skills: {} });
    assert.ok(Array.isArray(shipped._readme) && shipped._readme.length > 0, 'the lock explains nothing');
    for (const line of shipped._readme) assert.strictEqual(typeof line, 'string');
  });

  test('it carries no digest at all', () => {
    assert.doesNotMatch(JSON.stringify(shipped), /[0-9a-f]{40,}/, 'a hash was shipped in the empty lock');
  });

  test('the verifier is green against it', () => {
    // Driven in the real repo, with an empty home so this box's plugins are not
    // part of the answer. The repo's own skills are WARNs: reported, not blocking.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-skills-home-'));
    try {
      const r = sv(ROOT, ['--check'], { home });
      assert.strictEqual(r.status, 0, r.all);
      assert.strictEqual(gateOf(r).fail, 0, r.all);
      const { r: rj, parsed } = json(ROOT, { home });
      assert.strictEqual(parsed.ok, true, rj.stdout);
      assert.deepStrictEqual(errorsOf(parsed), []);
      assert.strictEqual(sv(ROOT, ['--hook'], { home }).status, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    // And the gate did not quietly rewrite the lock on its way through.
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(SHIPPED_LOCK, 'utf8')), shipped);
  });
});

describe('skill-verify.cjs --check — a real verdict, ending in a GATE line', () => {
  test('a pinned skill whose bytes match is a pass', () => withRepo((dir) => {
    // Whole directory, not just SKILL.md: bundled scripts are attack surface.
    addSkill(dir, VENDORED, 'alpha-notes', { 'scripts/run.js': 'console.log(1);\n' });
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    assert.deepStrictEqual(Object.keys(readLock(dir).skills['alpha-notes'].fileDigests).sort(),
      ['SKILL.md', 'scripts/run.js']);
    const r = sv(dir, ['--check']);
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.stdout, /skill-verify: OK — 1 skill\(s\) match their recorded digests\./);
    assert.deepStrictEqual(gateOf(r), { pass: 3, fail: 0, skipped: 0 }); // the skill + inventory + plugin-pins
  }));

  test('an empty lock over an empty tree DECLARES that it graded nothing', () => withRepo((dir) => {
    // The wrong answer is a green `pass=0 fail=0 skipped=0`: no green line may
    // stand in for a check that never ran.
    writeLock(dir, {});
    const r = sv(dir, ['--check']);
    assert.strictEqual(r.status, 0, r.all);
    const g = gateOf(r);
    assert.ok(g.skipped >= 1, 'nothing was graded and nothing was declared skipped: ' + r.last);
    assert.notDeepStrictEqual(g, { pass: 0, fail: 0, skipped: 0 });
    assert.match(r.stdout, /skipped: skill-digests — not applicable/);
  }));

  test('a byte-drifted vendored skill is DRIFT, and both the skill and the file are named', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, VENDORED, 'beta-tools');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes'), 'beta-tools': pin(dir, 'beta-tools') });
    assert.strictEqual(sv(dir, ['--check']).status, 0, 'the fixture is not clean before the drift');

    // One byte, appended. The payload of a skill is a sentence; so is this.
    fs.appendFileSync(path.join(dir, VENDORED, 'alpha-notes', 'SKILL.md'), 'x');

    const r = sv(dir, ['--check']);
    assert.strictEqual(r.status, 1, 'a drifted skill did not fail the gate: ' + r.all);
    assert.match(r.stdout, /\[ERROR\] skill "alpha-notes": DRIFT /);
    assert.match(r.stdout, /~ SKILL\.md \(modified\)/, 'the drift report did not name the changed file');
    assert.doesNotMatch(r.stdout, /"beta-tools"/, 'an untouched skill was reported');
    assert.deepStrictEqual(gateOf(r), { pass: 3, fail: 1, skipped: 0 }); // 2 skills + inventory + plugin-pins
    assert.match(r.stdout, /STOP, not a warning/);
  }));

  test('a file ADDED to a vetted skill is drift too', () => withRepo((dir) => {
    // A new file dropped into a reviewed skill is an unreviewed instruction source.
    addSkill(dir, VENDORED, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    put(dir, VENDORED + '/alpha-notes/notes/extra.md', 'unreviewed\n');
    const { r, parsed } = json(dir);
    assert.strictEqual(r.status, 1);
    const f = tagged(parsed, 'DRIFT', 'alpha-notes');
    assert.ok(f, JSON.stringify(parsed.findings));
    assert.deepStrictEqual(f.changed, ['+ notes/extra.md (added)']);
  }));

  test('a RENAME is drift; line-ending churn is not', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes', { 'guide.md': 'one\ntwo\n' });
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    const skill = path.join(dir, VENDORED, 'alpha-notes');

    // A check that cries wolf on a checkout's CRLF is a check that gets switched off.
    fs.writeFileSync(path.join(skill, 'guide.md'), 'one\r\ntwo\r\n');
    assert.strictEqual(sv(dir, ['--check']).status, 0, 'CRLF churn was reported as tampering');

    fs.renameSync(path.join(skill, 'guide.md'), path.join(skill, 'manual.md'));
    const { r, parsed } = json(dir);
    assert.strictEqual(r.status, 1, 'a rename passed clean');
    assert.deepStrictEqual(tagged(parsed, 'DRIFT', 'alpha-notes').changed,
      ['+ manual.md (added)', '- guide.md (removed)']);
  }));

  test('a vendored skill in the tree but absent from the lock is UNLOCKED, and an error', () => withRepo((dir) => {
    // This matters more than drift: nobody ever read it.
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, VENDORED, 'gamma-arrived');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    const r = sv(dir, ['--check']);
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.stdout, /\[ERROR\] skill "gamma-arrived": UNLOCKED /);
    assert.match(r.stdout, /\.agents\/skills\/gamma-arrived/);
    assert.ok(gateOf(r).fail >= 1);
    const { parsed } = json(dir);
    assert.strictEqual(tagged(parsed, 'UNLOCKED', 'gamma-arrived').severity, 'error');
    assert.strictEqual(tagged(parsed, 'UNLOCKED', 'alpha-notes'), undefined);
  }));

  test('the repo\'s OWN unpinned skill is UNLOCKED as a warn — reported, never blocking', () => withRepo((dir) => {
    // It arrived through a tracked diff. An error here would be red on a fresh
    // clone of a clean repo, and a gate red on day one is switched off on day two.
    addSkill(dir, LIVE, 'delta-local');
    writeLock(dir, {});
    const { r, parsed } = json(dir);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(tagged(parsed, 'UNLOCKED', 'delta-local').severity, 'warn');
    const c = sv(dir, ['--check']);
    assert.strictEqual(c.status, 0);
    assert.strictEqual(gateOf(c).fail, 0);
    assert.match(c.stdout, /\[WARN\] skill "delta-local": UNLOCKED /);
  }));

  test('a skill in the lock but absent from the tree is MISSING — reported, not silently ignored', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    const ghost = pin(dir, 'alpha-notes', { skillDir: VENDORED + '/epsilon-gone', skillPath: 'skills/epsilon-gone' });
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes'), 'epsilon-gone': ghost });
    const r = sv(dir, ['--check']);
    assert.strictEqual(r.status, 1, 'a lock entry describing nothing passed: ' + r.all);
    assert.match(r.stdout, /\[ERROR\] skill "epsilon-gone": MISSING /);
    assert.match(r.stdout, /\.agents\/skills\/epsilon-gone/);
    assert.deepStrictEqual(gateOf(r), { pass: 3, fail: 1, skipped: 0 });
    const { parsed } = json(dir);
    assert.strictEqual(tagged(parsed, 'MISSING', 'epsilon-gone').severity, 'error');
  }));

  test('an entry that records no digest is UNPINNED — it verifies nothing, and says so', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, VENDORED, 'beta-tools');
    writeLock(dir, {
      'alpha-notes': { skillDir: VENDORED + '/alpha-notes', reviewedAt: OLD_DATE },
      'beta-tools': null, // hand-written damage must not take the other verdicts down
    });
    const { r, parsed } = json(dir);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(tagged(parsed, 'UNPINNED', 'alpha-notes'), JSON.stringify(parsed.findings));
    assert.ok(tagged(parsed, 'UNPINNED', 'beta-tools'), JSON.stringify(parsed.findings));
  }));

  test('the LOADED copy must equal the reviewed one', () => withRepo((dir) => {
    // Tampering with the copy the agent actually loads would otherwise pass clean.
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, LIVE, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    assert.strictEqual(sv(dir, ['--check']).status, 0, 'an identical mirror was reported');

    fs.appendFileSync(path.join(dir, LIVE, 'alpha-notes', 'SKILL.md'), '\nAlso do something else.\n');
    const { r, parsed } = json(dir);
    assert.strictEqual(r.status, 1, 'a tampered live copy passed: ' + r.all);
    const f = tagged(parsed, 'MIRROR-DRIFT', 'alpha-notes');
    assert.ok(f, JSON.stringify(parsed.findings));
    assert.deepStrictEqual(f.changed, ['~ SKILL.md (modified)']);
  }));

  test('the GATE line is well-formed and LAST in every state, and its three numbers are the total', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, VENDORED, 'gamma-arrived');
    addSkill(dir, LIVE, 'delta-local');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes'), 'epsilon-gone': pin(dir, 'alpha-notes', { skillDir: VENDORED + '/epsilon-gone' }) });
    fs.appendFileSync(path.join(dir, VENDORED, 'alpha-notes', 'SKILL.md'), 'x');

    const r = sv(dir, ['--check']);
    const g = gateOf(r);
    const { parsed } = json(dir);
    // pass+fail+skipped is the TOTAL: comparing only `pass` cannot tell a green
    // run from one where checks vanished.
    assert.strictEqual(g.pass + g.fail + g.skipped, parsed.checks.length);
    assert.deepStrictEqual(g, parsed.gate);
    assert.strictEqual(r.lines.filter((l) => /^GATE /.test(l)).length, 1, 'more than one GATE line');
    // Without --check the same verdict is prose, and prints no GATE line at all.
    const plain = sv(dir, []);
    assert.strictEqual(plain.status, r.status);
    assert.doesNotMatch(plain.stdout, /^GATE /m);
  }));

  test('a lock that cannot be read is a fail WITH a GATE line, not a silent zero', () => withRepo((dir) => {
    fs.writeFileSync(lockFile(dir), '{ "version": 2, "skills": ');
    const r = sv(dir, ['--check']);
    assert.strictEqual(r.status, 1, r.all);
    assert.deepStrictEqual(gateOf(r), { pass: 0, fail: 1, skipped: 0 });
    assert.match(r.stderr, /fix: /, 'the stop carried no fix line');

    fs.unlinkSync(lockFile(dir));
    const gone = sv(dir, ['--check']);
    assert.strictEqual(gone.status, 1, gone.all);
    assert.deepStrictEqual(gateOf(gone), { pass: 0, fail: 1, skipped: 0 });
  }));
});

describe('skill-verify.cjs --hook — SessionStart exits 0 WHATEVER it finds', () => {
  // A hook that exits non-zero is a broken session, so drift has to be reported
  // in the output and never in the status.
  test('clean and quiet: nothing to say is nothing printed', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    assert.strictEqual(hookOf(sv(dir, ['--hook'])), null);
  }));

  test('drift, an unvetted skill and a missing one all exit 0 — and all are named in context', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, VENDORED, 'gamma-arrived');
    writeLock(dir, {
      'alpha-notes': pin(dir, 'alpha-notes'),
      'epsilon-gone': pin(dir, 'alpha-notes', { skillDir: VENDORED + '/epsilon-gone' }),
    });
    fs.appendFileSync(path.join(dir, VENDORED, 'alpha-notes', 'SKILL.md'), 'x');

    // The same tree is a hard NO for the gate...
    assert.strictEqual(sv(dir, ['--check']).status, 1);
    // ...and a started session for the hook.
    const j = hookOf(sv(dir, ['--hook']));
    assert.ok(j, 'the hook exited 0 AND said nothing about three integrity errors');
    const ctx = j.hookSpecificOutput.additionalContext;
    assert.match(ctx, /SKILL INTEGRITY CHECK FAILED/);
    assert.match(ctx, /skill "alpha-notes": DRIFT/);
    assert.match(ctx, /~ SKILL\.md \(modified\)/);
    assert.match(ctx, /skill "gamma-arrived": UNLOCKED/);
    assert.match(ctx, /skill "epsilon-gone": MISSING/);
    assert.match(j.systemMessage, /3 skill integrity problem/);
  }));

  test('a warn alone is one summary line, not a wall', () => withRepo((dir) => {
    addSkill(dir, LIVE, 'delta-local');
    writeLock(dir, {});
    const j = hookOf(sv(dir, ['--hook']));
    assert.ok(j, 'a standing exception was not reported at all');
    assert.doesNotMatch(j.hookSpecificOutput.additionalContext, /CHECK FAILED/);
    assert.match(j.hookSpecificOutput.additionalContext, /delta-local/);
    assert.match(j.hookSpecificOutput.additionalContext, /Uncovered, not clean/);
  }));

  test('no lock file at all is silent; a lock that EXISTS and cannot be parsed is not', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    // Absent: the repo predates the lock. Nothing to enforce, nothing to claim.
    assert.strictEqual(hookOf(sv(dir, ['--hook'])), null);
    // Unreadable: every pin switched off at once. Still exit 0 — and said out loud.
    fs.writeFileSync(lockFile(dir), 'not json at all');
    const j = hookOf(sv(dir, ['--hook']));
    assert.ok(j, 'a corrupt lock silenced the whole SessionStart control');
    assert.match(j.hookSpecificOutput.additionalContext, /DID NOT RUN/);
    assert.match(j.hookSpecificOutput.additionalContext, /NO skill was\s+verified/);
  }));

  test('it exits 0 on junk stdin, an unreadable home and no home at all', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'gamma-arrived');
    writeLock(dir, {});
    put(dir, 'home/.claude/settings.json', '{ broken');
    assert.strictEqual(sv(dir, ['--hook']).status, 0);
    assert.strictEqual(sv(dir, ['--hook'], { stdin: 'garbage on stdin' }).status, 0);
    assert.strictEqual(sv(dir, ['--hook'], { home: '' }).status, 0);
  }));
});

describe('skill-verify.cjs --json — well-formed, every finding fully attributed', () => {
  const attributed = (parsed) => {
    assert.strictEqual(typeof parsed.ok, 'boolean');
    assert.ok(Array.isArray(parsed.findings));
    for (const f of parsed.findings) {
      for (const field of ['kind', 'name', 'severity', 'message']) {
        assert.strictEqual(typeof f[field], 'string', 'finding missing ' + field + ': ' + JSON.stringify(f));
        assert.ok(f[field].length > 0, 'finding has an empty ' + field + ': ' + JSON.stringify(f));
      }
      assert.match(f.severity, /^(error|warn)$/);
      assert.match(f.kind, /^(skill|plugin|lock)$/);
      if (f.changed !== undefined && f.changed !== null) assert.ok(Array.isArray(f.changed));
    }
    for (const k of ['pass', 'fail', 'skipped']) assert.ok(Number.isInteger(parsed.gate[k]), 'gate.' + k);
  };

  test('across every kind of finding at once', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    addSkill(dir, VENDORED, 'beta-tools');
    addSkill(dir, VENDORED, 'gamma-arrived');
    addSkill(dir, LIVE, 'delta-local');
    writeLock(dir, {
      'alpha-notes': pin(dir, 'alpha-notes'),
      'beta-tools': { skillDir: VENDORED + '/beta-tools' },
      'epsilon-gone': pin(dir, 'alpha-notes', { skillDir: VENDORED + '/epsilon-gone' }),
    });
    fs.appendFileSync(path.join(dir, VENDORED, 'alpha-notes', 'SKILL.md'), 'x');
    const home = homeWithPlugin(dir, 'abc123def456');

    const { r, parsed } = json(dir, { home });
    attributed(parsed);
    const seen = parsed.findings.map((f) => f.severity + ':' + f.kind + ':' + f.name + ':' + f.message.split(' ')[0]).sort();
    assert.deepStrictEqual(seen, [
      'error:skill:alpha-notes:DRIFT',
      'error:skill:beta-tools:UNPINNED',
      'error:skill:epsilon-gone:MISSING',
      'error:skill:gamma-arrived:UNLOCKED',
      'warn:plugin:' + PLUGIN + ':UNPINNED',
      'warn:skill:delta-local:UNLOCKED',
    ]);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(parsed.gate.pass + parsed.gate.fail + parsed.gate.skipped, parsed.checks.length);
  }));

  test('a lock that cannot be read is still well-formed JSON with an attributed finding', () => withRepo((dir) => {
    fs.writeFileSync(lockFile(dir), '[');
    const { r, parsed } = json(dir);
    attributed(parsed);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(parsed.findings.length, 1);
  }));

  test('the exit code agrees with ok, in both directions', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    const clean = json(dir);
    attributed(clean.parsed);
    assert.strictEqual(clean.parsed.ok, true);
    assert.strictEqual(clean.r.status, 0);
    assert.deepStrictEqual(clean.parsed.findings, []);

    fs.appendFileSync(path.join(dir, VENDORED, 'alpha-notes', 'SKILL.md'), 'x');
    const dirty = json(dir);
    assert.strictEqual(dirty.parsed.ok, false);
    assert.strictEqual(dirty.r.status, 1);
    assert.strictEqual(dirty.parsed.ok, errorsOf(dirty.parsed).length === 0);
  }));
});

describe('skill-verify.cjs — the plugin half: report what cannot be secured', () => {
  test('a warn alone never fails the run', () => withRepo((dir) => {
    // An enabled plugin lives outside the repo and is replaced wholesale on
    // update. The lock cannot secure it, so an ERROR would claim a control that
    // does not exist. Uncovered, not clean — and not red either.
    addSkill(dir, VENDORED, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    const home = homeWithPlugin(dir, 'abc123def456');

    const { r, parsed } = json(dir, { home });
    assert.deepStrictEqual(parsed.findings.map((f) => f.severity), ['warn']);
    assert.strictEqual(parsed.findings[0].name, PLUGIN);
    assert.match(parsed.findings[0].message, /^UNPINNED /);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(r.status, 0, 'a warn failed the run: ' + r.all);

    const c = sv(dir, ['--check'], { home });
    assert.strictEqual(c.status, 0, c.all);
    assert.deepStrictEqual(gateOf(c), { pass: 3, fail: 0, skipped: 0 });
    assert.match(c.stdout, /FINDINGS \(no errors\)/);
    assert.doesNotMatch(c.stdout, /skill-verify: OK/, 'an uncovered plugin was reported as a clean bill of health');
  }));

  test('a pin at the installed commit is clean; a pin the install has moved past is an error', () => withRepo((dir) => {
    // Pinning is opt-in, and a false assertion the operator made is worth stopping for.
    const home = homeWithPlugin(dir, 'abc123def456');
    writeLock(dir, {}, { pluginPins: { [PLUGIN]: { sha: 'abc123', reviewedAt: OLD_DATE } } });
    const held = json(dir, { home });
    assert.deepStrictEqual(held.parsed.findings, []);
    assert.strictEqual(held.r.status, 0);

    writeLock(dir, {}, { pluginPins: { [PLUGIN]: { sha: 'ffff0000', reviewedAt: OLD_DATE } } });
    const moved = json(dir, { home });
    assert.strictEqual(moved.r.status, 1);
    assert.strictEqual(tagged(moved.parsed, 'MOVED', PLUGIN).severity, 'error');
    assert.ok(gateOf(sv(dir, ['--check'], { home })).fail >= 1);
  }));

  test('an unreadable home WARNS instead of throwing — and skips rather than passing', () => withRepo((dir) => {
    // Fail-soft is load-bearing: this runs at SessionStart, so a verifier that
    // dies takes the session's context injection with it. But "could not read"
    // must not render as "checked and fine" either.
    addSkill(dir, VENDORED, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    const home = path.join(dir, 'home');
    const expectWarn = (why) => {
      const { r, parsed } = json(dir, { home });
      assert.strictEqual(r.status, 0, why + ' must not fail the run: ' + r.all);
      assert.strictEqual(parsed.ok, true);
      const w = parsed.findings.find((f) => f.kind === 'plugin' && f.severity === 'warn' && /settings\.json/.test(f.name));
      assert.ok(w, why + ': expected a warn naming settings.json, got ' + JSON.stringify(parsed.findings));
      assert.match(w.message, /NO plugin was checked/);
      const row = parsed.checks.find((c) => c.subject === 'plugin-pins');
      assert.strictEqual(row.verdict, 'skip', why + ' was graded ' + row.verdict);
      // Only ever reported in tilde form: the resolved path names the operator.
      assert.ok(!r.stdout.includes(home), 'the report leaked the resolved home path');
      assert.strictEqual(sv(dir, ['--hook'], { home }).status, 0);
      assert.strictEqual(sv(dir, ['--check'], { home }).status, 0);
    };

    put(dir, 'home/.claude/settings.json', 'not json at all');
    expectWarn('a settings file that is not JSON');

    fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
    fs.mkdirSync(path.join(home, '.claude', 'settings.json'), { recursive: true });
    expectWarn('a settings path that cannot be read as a file');
  }));

  test('a home that does not exist, or is not set, is a declared answer — never a crash', () => withRepo((dir) => {
    // ABSENT is not UNREADABLE. A machine with no agent settings has no plugin
    // surface, so the check passes and SAYS why; it does not skip, and it does
    // not throw.
    addSkill(dir, VENDORED, 'alpha-notes');
    writeLock(dir, { 'alpha-notes': pin(dir, 'alpha-notes') });
    for (const home of [path.join(dir, 'no-such-home'), '', put(dir, 'a-file-not-a-dir', 'x')]) {
      const { r, parsed } = json(dir, { home });
      assert.strictEqual(r.status, 0, 'home=' + JSON.stringify(home) + ': ' + r.all);
      assert.deepStrictEqual(errorsOf(parsed), []);
      const row = parsed.checks.find((c) => c.subject === 'plugin-pins');
      assert.ok(row, 'the plugin half vanished from the tally');
      assert.ok(row.verdict === 'pass' ? row.note.length > 0 : row.verdict === 'skip',
        'the plugin half passed without saying what it found: ' + JSON.stringify(row));
      assert.strictEqual(sv(dir, ['--hook'], { home }).status, 0);
    }
  }));

  test('something enabled with no install record cannot be compared — a warn and a skip', () => withRepo((dir) => {
    writeLock(dir, {});
    put(dir, 'home/.claude/settings.json', JSON.stringify({ enabledPlugins: { [PLUGIN]: true } }));
    const { r, parsed } = json(dir);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(parsed.findings.some((f) => f.severity === 'warn' && /installed_plugins\.json/.test(f.name)),
      JSON.stringify(parsed.findings));
    assert.strictEqual(parsed.checks.find((c) => c.subject === 'plugin-pins').verdict, 'skip');
  }));
});

describe('skill-verify.cjs --update — it must not forge a review date', () => {
  /* reviewedAt is a claim about a HUMAN: a person read this skill on that day. A
     re-baseline that stamps today onto every entry asserts that somebody re-read
     skills nobody opened, and a lock whose dates move on their own is the rubber
     stamp this whole mechanism exists to prevent. Driven end to end because the
     defect lives in the loop that WRITES the lock — the self-test can only reach
     the decision. */
  const todayIs = (got, before, what) =>
    assert.ok(got === before || got === utcDay(), what + ': got ' + got);

  test('an unchanged skill keeps its date; a changed one takes today', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'steady');
    addSkill(dir, VENDORED, 'touched');
    writeLock(dir, { steady: pin(dir, 'steady'), touched: pin(dir, 'touched') });
    const steadyHash = readLock(dir).skills.steady.computedHash;

    // The real scenario: bytes moved under one of two entries dated in the past.
    fs.appendFileSync(path.join(dir, VENDORED, 'touched', 'SKILL.md'), '\nA new instruction.\n');
    assert.strictEqual(sv(dir, ['--check']).status, 1, 'the fixture did not drift');

    const before = utcDay();
    const r = sv(dir, ['--update']);
    assert.strictEqual(r.status, 0, r.all);
    const after = readLock(dir).skills;

    assert.strictEqual(after.steady.reviewedAt, OLD_DATE, 'a skill nobody re-read was re-dated: ' + r.stdout);
    assert.strictEqual(after.steady.computedHash, steadyHash);
    assert.notStrictEqual(after.touched.reviewedAt, OLD_DATE, 'a skill whose bytes changed kept a stale date: ' + r.stdout);
    todayIs(after.touched.reviewedAt, before, 'the changed skill');
    assert.strictEqual(after.touched.computedHash, hashSkillDir(path.join(dir, VENDORED, 'touched')));
    assert.strictEqual(after.touched.hashAlgo, 'sha256-dir-v2');

    // The operator must be able to see what was ASSERTED, not only what changed:
    // one number is a fact about bytes, the other a claim about a person.
    assert.match(r.stdout, /re-baselined 2 skill\(s\); 1 digest\(s\) changed/);
    assert.match(r.stdout, /1 review date\(s\) stamped/);
    assert.match(r.stdout, /READ the diff/);

    // The re-baselined lock is green, and a second --update asserts nothing new.
    assert.strictEqual(sv(dir, ['--check']).status, 0);
    const again = sv(dir, ['--update']);
    assert.match(again.stdout, /0 digest\(s\) changed/);
    assert.match(again.stdout, /0 review date\(s\) stamped/);
    assert.deepStrictEqual(readLock(dir).skills, after);
  }));

  test('a stale digest over unchanged bytes still takes today; an undated entry gets a date', () => withRepo((dir) => {
    addSkill(dir, VENDORED, 'steady');
    addSkill(dir, VENDORED, 'stale');
    addSkill(dir, VENDORED, 'undated');
    const undated = pin(dir, 'undated');
    delete undated.reviewedAt;
    writeLock(dir, { steady: pin(dir, 'steady'), stale: pin(dir, 'stale', { computedHash: 'deadbeef' }), undated });

    const before = utcDay();
    const r = sv(dir, ['--update']);
    assert.strictEqual(r.status, 0, r.all);
    const after = readLock(dir).skills;
    assert.strictEqual(after.steady.reviewedAt, OLD_DATE);
    todayIs(after.stale.reviewedAt, before, 'the entry whose digest did not describe its bytes');
    todayIs(after.undated.reviewedAt, before, 'the entry that never carried a date');
    assert.match(r.stdout, /2 review date\(s\) stamped/);
  }));

  test('it never ADOPTS a skill it finds on disk, and keeps what it does not own', () => withRepo((dir) => {
    // Adding an entry is the act of saying "I read this". A tool that did it for
    // you would make the lock record whatever happened.
    addSkill(dir, VENDORED, 'steady');
    addSkill(dir, VENDORED, 'gamma-arrived');
    writeLock(dir, { steady: pin(dir, 'steady'), 'epsilon-gone': pin(dir, 'steady', { skillDir: VENDORED + '/epsilon-gone' }) },
      { _readme: ['kept'], pluginPins: { [PLUGIN]: { sha: 'abc123' } } });
    const goneBefore = readLock(dir).skills['epsilon-gone'];

    const r = sv(dir, ['--update']);
    assert.strictEqual(r.status, 0, r.all);
    const lock = readLock(dir);
    assert.deepStrictEqual(Object.keys(lock.skills).sort(), ['epsilon-gone', 'steady']);
    assert.match(r.stdout, /absent from the lock\. --update does not adopt them/);
    assert.deepStrictEqual(lock._readme, ['kept']);
    assert.deepStrictEqual(lock.pluginPins, { [PLUGIN]: { sha: 'abc123' } });
    // An entry with no directory is skipped and SAID to be — not re-dated, not dropped.
    assert.deepStrictEqual(lock.skills['epsilon-gone'], goneBefore);
    assert.match(r.all, /skip epsilon-gone/);
    assert.match(r.stdout, /1 skipped \(no directory\)/);
    // And it is still a red gate afterwards: --update cannot bless what it did not read.
    assert.strictEqual(sv(dir, ['--check']).status, 1);
  }));

  test('it can never be reached from a hook', () => withRepo((dir) => {
    // An auto-updating lockfile is not a lockfile: it records whatever happened.
    addSkill(dir, VENDORED, 'steady');
    writeLock(dir, { steady: pin(dir, 'steady') });
    fs.appendFileSync(path.join(dir, VENDORED, 'steady', 'SKILL.md'), 'x');
    const lockBefore = fs.readFileSync(lockFile(dir), 'utf8');
    for (const flag of ['--hook', '--gate']) {
      const r = sv(dir, ['--update', flag]);
      assert.strictEqual(r.status, 1, flag + ': ' + r.all);
      assert.match(r.stderr, /cannot be combined/);
    }
    assert.strictEqual(fs.readFileSync(lockFile(dir), 'utf8'), lockBefore, 'a hook re-baselined the lock');
  }));
});

describe('skill-verify.cjs --gate — the PreToolUse decision, as a process', () => {
  // The self-test drives isPathTool and targetSkill; the DECISION built from them is only
  // reachable by starting the script with a payload on stdin, which is how a session does.
  const drifted = (dir) => {
    addSkill(dir, VENDORED, 'steady');
    writeLock(dir, { steady: pin(dir, 'steady') });
    fs.appendFileSync(path.join(dir, VENDORED, 'steady', 'SKILL.md'), 'an instruction nobody reviewed\n');
  };
  const gate = (dir, stdin) => {
    const r = sv(dir, ['--gate'], { stdin });
    assert.strictEqual(r.status, 0, 'the decision is carried in the JSON, never the exit code: ' + r.all);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  const payload = (tool, input) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });

  test('a read of a drifted locked skill is denied, by name, with a command that exists', () => withRepo((dir) => {
    drifted(dir);
    const out = gate(dir, payload('Read', { file_path: path.join(dir, VENDORED, 'steady', 'SKILL.md') }));
    assert.ok(out, 'a drifted skill was read with no decision at all');
    assert.strictEqual(out.hookEventName, 'PreToolUse');
    assert.strictEqual(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /"steady"/);
    const cmd = out.permissionDecisionReason.match(/node (\S+\.cjs) --check/);
    assert.ok(cmd, 'the refusal no longer prints the command that shows the diff');
    assert.ok(fs.existsSync(path.join(ROOT, ...cmd[1].split('/'))), 'the refusal prints a command that does not exist: ' + cmd[1]);
  }));

  test('an unparseable payload is an ask, never a silent allow', () => withRepo((dir) => {
    drifted(dir);
    const out = gate(dir, 'not json');
    assert.ok(out, 'an unreadable payload was waved through');
    assert.strictEqual(out.permissionDecision, 'ask');
  }));

  test('a read of an ordinary file says nothing, even while a skill is drifted', () => withRepo((dir) => {
    // The blanket check must not be reached from a path tool: it would deny every
    // unrelated read the moment one skill drifted.
    drifted(dir);
    put(dir, 'README.md', '# fixture\n');
    assert.strictEqual(gate(dir, payload('Read', { file_path: path.join(dir, 'README.md') })), null);
  }));
});
