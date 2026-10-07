'use strict';
/* ============================================================
   gates.test.js — the gates that guard the gates.

   Every mechanism here DECIDES something: whether a build is red, whether a figure
   counts as a regression, whether a check has silently disappeared. A green gate
   suite proves the happy path and nothing else, so this file drives the decisions
   that must come out NO.

   Everything runs the REAL scripts/harness/gates.js as a process, in a temp
   directory that is a whole little repo: config.js and gates.js copied into
   scripts/harness/, a harness.config.json at the root, and the fixture gate
   scripts beside them. Three reasons, all of them things an import cannot reach:
     · the verdict is an EXIT CODE and two files written beside the script
     · gates.red.<name>.log is written relative to the script, so the fixture has
       to be where the script is
     · a run in the real repo would overwrite the real gates.json on its way
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', 'scripts', 'harness');
const SKIP_ARTIFACTS = ['--allow-skip', 'reproducible-build=1'];

// Inherited, CLAUDE_PROJECT_DIR would point every fixture at the real repo.
function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function fixture(config, files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gates-')));
  const here = path.join(dir, 'scripts', 'harness');
  fs.mkdirSync(here, { recursive: true });
  for (const f of ['config.js', 'gates.js']) fs.copyFileSync(path.join(SRC, f), path.join(here, f));
  if (config !== null) {
    fs.writeFileSync(path.join(dir, 'harness.config.json'),
      typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  }
  for (const rel of Object.keys(files || {})) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, files[rel]);
  }
  return dir;
}
function withFixture(config, files, body) {
  const dir = fixture(config, files);
  try { return body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const run = (dir, args) => spawnSync(process.execPath,
  [path.join(dir, 'scripts', 'harness', 'gates.js')].concat(args || []),
  { cwd: dir, encoding: 'utf8', env: cleanEnv() });
const stateFile = (dir, name) => path.join(dir, 'scripts', 'harness', name);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeBaseline = (dir, gates) => fs.writeFileSync(stateFile(dir, 'gates.baseline.json'),
  JSON.stringify({ generatedAt: null, commit: null, dirty: null, node: null, gates: gates }, null, 2));

// A fixture gate: a node script that prints what it is told and ends with its
// verdict, which is exactly the contract a real gate signs.
const gateScript = (name, before, pass, fail, skipped, after) =>
  'process.stdout.write(' + JSON.stringify(before) + ');\n'
  + 'process.stdout.write("GATE ' + name + ' pass=' + pass + ' fail=' + fail + ' skipped=' + skipped + '\\n");\n'
  + 'process.stdout.write(' + JSON.stringify(after || '') + ');\n';
const cfg = (gates, extra) => Object.assign({ project: { name: 'example' }, gates: gates }, extra || {});

describe('gates.js --self-test', () => {
  test('passes', () => {
    const r = spawnSync(process.execPath, [path.join(SRC, 'gates.js'), '--self-test'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS/m, r.stdout);
  });

  test('passes in a tree with no config at all — it tests the file, not the suite', () => {
    withFixture(null, null, (dir) => {
      const r = run(dir, ['--self-test']);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /no config in this tree/);
    });
  });
});

describe('gates.js — the GATE line protocol', () => {
  test('the verdict is read off the END of a noisy stdout', () => {
    // A real gate prints hundreds of lines before its verdict. The parser takes the
    // LAST line bearing this gate's own name, so noise above it is just noise.
    const noise = Array.from({ length: 300 }, (_, i) => 'ok ' + (i + 1) + ' - a check\n').join('')
      + '\n264/264 checks passed\n';
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', noise, 264, 0, 0) }, (dir) => {
        const r = run(dir, []);
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        const rows = readJson(stateFile(dir, 'gates.json')).gates;
        assert.deepStrictEqual(
          { pass: rows.alpha.pass, fail: rows.alpha.fail, skipped: rows.alpha.skipped, total: rows.alpha.total },
          { pass: 264, fail: 0, skipped: 0, total: 264 });
      });
  });

  test('a verdict printed for ANOTHER gate is not borrowed', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('beta', '', 9, 0, 0) }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /alpha: emitted no GATE line/);
      });
  });

  test('a gate that dies before its verdict is not silently green', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': 'console.log("starting up");\nthrow new Error("boom");\n' }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /NO VERDICT/);
        assert.match(r.stdout, /alpha: emitted no GATE line — the gate died before its verdict/);
      });
  });

  test('pass + fail + skipped is the total that gets recorded', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 10, 0, 2) }, (dir) => {
        run(dir, []);
        const row = readJson(stateFile(dir, 'gates.json')).gates.alpha;
        assert.strictEqual(row.total, 12, 'a declared skip is a check the verdict accounts for');
      });
  });
});

describe('gates.js --check — what it reds on', () => {
  test('a VANISHED check is red even though nothing failed', () => {
    // The whole reason the protocol carries a total. Deleting a check leaves fail=0
    // and a lower pass; only the total makes it legible as a deletion.
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 2, 0, 0) }, (dir) => {
        writeBaseline(dir, { alpha: { pass: 3, fail: 0, skipped: 0, total: 3 } });
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /DISAPPEARED \(pass-by-absence\)/);
        assert.doesNotMatch(r.stdout, /failing check\(s\)/, 'nothing failed; the deletion is the whole defect');
      });
  });

  test('a skip is red unless the CALLER declared it', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 4, 0, 1) }, (dir) => {
        writeBaseline(dir, {});
        const red = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(red.status, 1, red.stdout);
        assert.match(red.stdout, /alpha: skipped=1 and no --allow-skip alpha=n was given/);

        const green = run(dir, ['--check', '--allow-skip', 'alpha=1,reproducible-build=1']);
        assert.strictEqual(green.status, 0, green.stdout);
        assert.match(green.stdout, /GATES GREEN/);
        assert.match(green.stdout, /\(1 skipped, declared\)/);
      });
  });

  test('a check that VANISHES behind a tolerated skip still reds', () => {
    // The hole this closes, in the shape CI takes it: the skip is declared, and a
    // check is gone anyway. Tolerating a skip must not switch pass-by-absence off.
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 8, 0, 1) }, (dir) => {
        writeBaseline(dir, { alpha: { pass: 11, fail: 0, skipped: 1, total: 12 } });
        const r = run(dir, ['--check', '--allow-skip', 'alpha=1,reproducible-build=1']);
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /DISAPPEARED/);
        assert.doesNotMatch(r.stdout, /skipped=1 and no --allow-skip/, 'the skip itself was declared');
      });
  });

  test('a non-zero exit with no failing check is a verdict the figures cannot express', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 4, 0, 0) + 'process.exit(3);\n' }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /alpha: exit 3 with no failing check/);
      });
  });

  test('a baseline gate missing from the run reds — you cannot pass by not running one', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 4, 0, 0) }, (dir) => {
        writeBaseline(dir, { alpha: { pass: 4, fail: 0, skipped: 0, total: 4 }, beta: { pass: 7, fail: 0, skipped: 0, total: 7 } });
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /beta: did not run \(present in the baseline\)/);
      });
  });

  test('a gate with no baseline row is said out loud, because silence looks like protection', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 4, 0, 0) }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 0, r.stdout);
        assert.match(r.stdout, /alpha: ran with no baseline row — NOT protected/);
      });
  });

  test('with no readable baseline, --check refuses and names the command that records one', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 4, 0, 0) }, (dir) => {
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /no readable scripts[\\/]harness[\\/]gates\.baseline\.json/);
        assert.match(r.stdout, /--accept/);
        assert.match(r.stdout, /commit subject must start `gates:`/);
      });
  });
});

describe('gates.js — a red gate keeps its WHOLE output', () => {
  test('the red one keeps all of it and prints the path; the green one keeps none', () => {
    // The on-screen tail is 14 lines and it is the END of the output: a failing
    // check prints its name hundreds of lines above the summary, so a red that did
    // not reproduce left nothing to read.
    const FIRST = 'not ok 3 - the check that failed, far above the tail';
    const noise = FIRST + '\n' + Array.from({ length: 80 }, (_, i) => 'ok ' + (i + 4)).join('\n') + '\n';
    withFixture(cfg([
      { name: 'red', command: 'node scripts/red.js' },
      { name: 'green', command: 'node scripts/green.js' },
    ]), {
      'scripts/red.js': gateScript('red', noise, 80, 1, 0) + 'process.stderr.write("a line on stderr\\n");process.exit(1);\n',
      'scripts/green.js': gateScript('green', '', 2, 0, 0),
    }, (dir) => {
      // A file left by an earlier red run of a gate that is green now must not outlive this run.
      fs.writeFileSync(stateFile(dir, 'gates.red.green.log'), 'stale');
      const r = run(dir, []);

      const kept = stateFile(dir, 'gates.red.red.log');
      assert.ok(fs.existsSync(kept), 'the red gate kept no output file');
      const text = fs.readFileSync(kept, 'utf8');
      assert.ok(text.includes(FIRST), 'the kept output is a tail: the failing check\'s line is not in it');
      assert.ok(text.includes('ok 83'), 'the kept output is missing its end');
      assert.ok(text.includes('a line on stderr'), 'the kept output is missing stderr');
      assert.ok(!r.stdout.includes(FIRST), 'the precondition: the on-screen tail does not reach the failing check');
      assert.match(r.stdout, /whole output: scripts[\\/]harness[\\/]gates\.red\.red\.log/);

      const rows = readJson(stateFile(dir, 'gates.json')).gates;
      assert.ok(/gates\.red\.red\.log$/.test(rows.red.output), 'the gate\'s row does not carry the path');
      assert.strictEqual(rows.green.output, undefined, 'a green gate was given an output path');
      assert.ok(!fs.existsSync(stateFile(dir, 'gates.red.green.log')), 'a green gate left a stale red output behind');
    });
  });

  test('a gate red ONLY against the baseline keeps its output too', () => {
    // This gate was green to the run — exit 0, nothing failing — so the run dropped
    // any earlier output and held this one. The comparator is what reds it, and the
    // output has to survive that long.
    const FIRST = 'the line that explains the missing check, far above the verdict';
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', FIRST + '\n' + Array.from({ length: 40 }, (_, i) => 'note ' + i).join('\n') + '\n', 2, 0, 0) },
      (dir) => {
        writeBaseline(dir, { alpha: { pass: 3, fail: 0, skipped: 0, total: 3 } });
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        const kept = stateFile(dir, 'gates.red.alpha.log');
        assert.ok(fs.existsSync(kept), 'a baseline-only red kept no output');
        assert.ok(fs.readFileSync(kept, 'utf8').includes(FIRST));
        assert.match(r.stdout, /The whole output of each red gate that ran:/);
        assert.ok(/gates\.red\.alpha\.log$/.test(readJson(stateFile(dir, 'gates.json')).gates.alpha.output));
      });
  });

  test('the state files live beside the script, never at the repo root', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 1, 1, 0) + 'process.exit(1);\n' }, (dir) => {
        run(dir, []);
        for (const f of ['gates.json', 'gates.red.alpha.log']) {
          assert.ok(fs.existsSync(stateFile(dir, f)), f + ' is not beside the script');
          assert.ok(!fs.existsSync(path.join(dir, f)), f + ' landed at the repo root, where hygiene would need a waiver on every run');
        }
      });
  });
});

describe('gates.js --accept', () => {
  test('refuses on a red suite, so a regression cannot be made permanent by one command', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 3, 1, 0) + 'process.exit(1);\n' }, (dir) => {
        const r = run(dir, ['--accept'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /REFUSING TO RE-BASELINE/);
        assert.ok(!fs.existsSync(stateFile(dir, 'gates.baseline.json')), 'a red suite became the baseline');
      });
  });

  test('refuses on an undeclared skip, and keeps the output it is refusing over', () => {
    const FIRST = 'SKIP the oracle is not reachable, far above the verdict';
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', FIRST + '\n' + Array.from({ length: 40 }, (_, i) => 'note ' + i).join('\n') + '\n', 0, 0, 1) },
      (dir) => {
        fs.writeFileSync(stateFile(dir, 'gates.red.alpha.log'), 'an earlier red run');
        const r = run(dir, ['--accept'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /alpha: skipped=1 and no --allow-skip alpha=n was given/);
        const text = fs.readFileSync(stateFile(dir, 'gates.red.alpha.log'), 'utf8');
        assert.ok(text.includes(FIRST), 'the refusal kept no output for the gate it refused on');
        assert.ok(!text.includes('an earlier red run'), 'the kept output is a stale one, not this run\'s');
      });
  });

  test('writes the baseline on a green suite, and says the commit subject rule out loud', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 5, 0, 0) }, (dir) => {
        const r = run(dir, ['--accept'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 0, r.stdout);
        assert.match(r.stdout, /deliberate RE-BASELINE/);
        assert.match(r.stdout, /commit subject must start `gates:`/);
        const base = readJson(stateFile(dir, 'gates.baseline.json'));
        assert.strictEqual(base.gates.alpha.total, 5);
        assert.ok(Array.isArray(base._readme), 'the baseline does not say what wrote it');
        // And the run it just recorded is green against it.
        assert.strictEqual(run(dir, ['--check'].concat(SKIP_ARTIFACTS)).status, 0);
      });
  });
});

describe('gates.js --only', () => {
  test('a name that matches nothing is a hard failure, and nothing runs', () => {
    // A typo in a gate name used to filter everything out: no gate ran, no subject
    // was compared, and --check printed GATES GREEN with an empty summary and exit 0
    // — having overwritten the verdict of record on its way.
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 5, 0, 0) }, (dir) => {
        const r = run(dir, ['--check', '--only', 'alhpa']);
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /--only names no such gate: alhpa/);
        assert.match(r.stdout, /registered: alpha, reproducible-build/);
        assert.ok(!fs.existsSync(stateFile(dir, 'gates.json')), 'gates.json was touched by a run that could not happen');
      });
  });

  test('a registered name runs that gate alone', () => {
    withFixture(cfg([
      { name: 'alpha', command: 'node scripts/alpha.js' },
      { name: 'beta', command: 'node scripts/beta.js' },
    ]), {
      'scripts/alpha.js': gateScript('alpha', '', 5, 0, 0),
      'scripts/beta.js': gateScript('beta', '', 7, 0, 0),
    }, (dir) => {
      const r = run(dir, ['--only', 'beta']);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.deepStrictEqual(Object.keys(readJson(stateFile(dir, 'gates.json')).gates), ['beta']);
    });
  });
});

describe('gates.js — the config seam', () => {
  test('a missing config is fatal with a one-line fix, not a default suite', () => {
    withFixture(null, null, (dir) => {
      const r = run(dir, ['--check']);
      assert.strictEqual(r.status, 1, r.stdout);
      const lines = r.stderr.trim().split('\n');
      assert.strictEqual(lines.length, 2, 'a stop is two lines — the problem and the fix: ' + r.stderr);
      assert.match(lines[0], /^FATAL — no readable harness\.config\.json/);
      assert.match(lines[1], /^ {3}fix: /);
      assert.match(lines[1], /no default suite/);
      assert.ok(!fs.existsSync(stateFile(dir, 'gates.json')), 'a run with no config still wrote a verdict');
    });
  });

  test('the gate table comes from the config, in declaration order', () => {
    withFixture(cfg([
      { name: 'gamma', command: 'node scripts/g.js' },
      { name: 'alpha', command: 'node scripts/a.js' },
      { name: 'beta', command: 'node scripts/b.js' },
    ]), {
      'scripts/g.js': gateScript('gamma', '', 1, 0, 0),
      'scripts/a.js': gateScript('alpha', '', 1, 0, 0),
      'scripts/b.js': gateScript('beta', '', 1, 0, 0),
    }, (dir) => {
      run(dir, []);
      assert.deepStrictEqual(Object.keys(readJson(stateFile(dir, 'gates.json')).gates),
        ['gamma', 'alpha', 'beta', 'reproducible-build'],
        'order is the config\'s: a build gate has to run before the check that grades what it produced');
    });
  });

  test('an unknown adapter is a hard error, never a silent fallback', () => {
    // Falling back to the GATE-line parser would turn `node_test` into "this gate
    // emits no verdict", which reads as a crashing gate and sends the reader to the
    // wrong file entirely.
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js', adapter: 'node_test' }]),
      { 'scripts/alpha.js': gateScript('alpha', '', 1, 0, 0) }, (dir) => {
        const r = run(dir, ['--check']);
        assert.strictEqual(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /unknown adapter "node_test"/);
        assert.match(r.stderr, /gate `alpha`/);
        assert.match(r.stderr, /gate-line, node-test, exit-code/);
      });
  });

  test('the node-test adapter reads node:test\'s own summary, GATE line or not', () => {
    // `node --test` with NO PATH, because that is the one spelling every supported runtime
    // takes. This fixture once passed a quoted glob, which Node 20 answers with `Could not
    // find` and no summary at all: the adapter (rightly) read no verdict, and the test was
    // red on the oldest runtime `engines` promises. The assertion is unchanged; the command
    // is now one the floor version can run.
    withFixture(cfg([{ name: 'unit', command: 'node --test', adapter: 'node-test' }]), {
      't/a.test.js': 'const { test } = require("node:test");\ntest("one", () => {});\ntest("two", () => {});\ntest("three", { skip: true }, () => {});\n',
    }, (dir) => {
      const r = run(dir, []);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      const row = readJson(stateFile(dir, 'gates.json')).gates.unit;
      assert.deepStrictEqual({ pass: row.pass, fail: row.fail, skipped: row.skipped }, { pass: 2, fail: 0, skipped: 1 });
    });
  });

  test('`optional` turns an ABSENT TOOL into a skip, but not an unhappy one', () => {
    withFixture(cfg([{ name: 'lint', command: 'definitely-not-an-installed-tool --check', optional: true }]), null, (dir) => {
      writeBaseline(dir, {});
      const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
      assert.strictEqual(r.status, 1, r.stdout);
      assert.match(r.stdout, /lint: skipped=1 and no --allow-skip lint=n was given/,
        'an absent optional tool must declare a skip — and the skip is still the caller\'s to tolerate');
      assert.match(r.stdout, /note: the tool is not installed here/);
    });
  });

  test('a tool that is present and unhappy still fails, optional or not', () => {
    withFixture(cfg([{ name: 'lint', command: 'node scripts/lint.js', optional: true }]),
      { 'scripts/lint.js': gateScript('lint', '', 2, 1, 0) + 'process.exit(1);\n' }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /lint: 1 failing check\(s\)/);
      });
  });
});

describe('gates.js — the reproducible-build check', () => {
  test('an empty artifact list DECLARES ITSELF rather than passing silently', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }], { artifacts: [] }),
      { 'scripts/alpha.js': gateScript('alpha', '', 2, 0, 0) }, (dir) => {
        writeBaseline(dir, {});
        const red = run(dir, ['--check']);
        assert.strictEqual(red.status, 1, red.stdout);
        assert.match(red.stdout, /note: not applicable — 0 artifacts configured, 0 graded/);
        assert.match(red.stdout, /reproducible-build: skipped=1 and no --allow-skip/);
        const row = readJson(stateFile(dir, 'gates.json')).gates['reproducible-build'];
        assert.deepStrictEqual({ pass: row.pass, fail: row.fail, skipped: row.skipped }, { pass: 0, fail: 0, skipped: 1 });
        assert.strictEqual(row.reproducible, undefined, 'a check that graded nothing claimed a reproducible build');

        // Tolerating it is the caller's decision, and it is visible in the invocation.
        assert.strictEqual(run(dir, ['--check'].concat(SKIP_ARTIFACTS)).status, 0);
      });
  });

  test('an artifact the build moves is red, with the file named', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }],
      { artifacts: { command: 'node scripts/build.js', files: ['dist/app.js', { glob: 'dist/**/*.css' }] } }), {
      'scripts/alpha.js': gateScript('alpha', '', 1, 0, 0),
      'scripts/build.js': 'require("node:fs").writeFileSync("dist/app.js", "rebuilt\\n");\n',
      'dist/app.js': 'stale\n',
      'dist/a/theme.css': 'body{}\n',
    }, (dir) => {
      writeBaseline(dir, {});
      const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
      assert.strictEqual(r.status, 1, r.stdout);
      assert.match(r.stdout, /NOT REPRODUCIBLE/);
      assert.match(r.stdout, /reproducible-build: NOT reproducible/);
      assert.match(r.stdout, /moved: dist\/app\.js/);
      const row = readJson(stateFile(dir, 'gates.json')).gates['reproducible-build'];
      assert.strictEqual(row.fail, 1);
      assert.strictEqual(row.pass, 1, 'the globbed stylesheet was graded and did not move');
      assert.strictEqual(row.reproducible, false);
    });
  });

  test('an artifact that is configured but absent is a failing check, not a file that drops out of the total', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }], { artifacts: ['dist/never-built.js'] }),
      { 'scripts/alpha.js': gateScript('alpha', '', 1, 0, 0) }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check'].concat(SKIP_ARTIFACTS));
        assert.strictEqual(r.status, 1, r.stdout);
        assert.match(r.stdout, /reproducible-build: 1 failing check\(s\)/);
        const row = readJson(stateFile(dir, 'gates.json')).gates['reproducible-build'];
        assert.deepStrictEqual({ pass: row.pass, fail: row.fail, total: row.total }, { pass: 0, fail: 1, total: 1 });
      });
  });

  test('artifacts that survive the suite are green, and recorded by hash', () => {
    withFixture(cfg([{ name: 'alpha', command: 'node scripts/alpha.js' }], { artifacts: [{ path: 'dist/app.js' }] }),
      { 'scripts/alpha.js': gateScript('alpha', '', 1, 0, 0), 'dist/app.js': 'built\n' }, (dir) => {
        writeBaseline(dir, {});
        const r = run(dir, ['--check']);
        assert.strictEqual(r.status, 0, r.stdout);
        const row = readJson(stateFile(dir, 'gates.json')).gates['reproducible-build'];
        assert.strictEqual(row.reproducible, true);
        assert.match(row.artifacts['dist/app.js'], /^[0-9a-f]{64}$/);
      });
  });
});
