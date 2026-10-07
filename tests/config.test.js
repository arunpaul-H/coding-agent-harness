'use strict';
/* ============================================================
   config.test.js — the config seam, driven as a script.

   Everything here runs the REAL scripts/harness/config.js in a child process with
   a temp directory as the repo, because the two things this file decides are
   process-level: "where is the repo root" (settled once, at load, from the cwd)
   and "is this config usable" (a two-line stop and a non-zero exit). Importing the
   module and calling load() would test neither path.

   A fixture is a whole little repo: scripts/harness/config.js copied in, so the
   `../..` root fallback resolves to the fixture and never climbs out into the real
   tree. A test that asserted against the enclosing repo would pass for the wrong
   reason, which is the one failure a test suite cannot report.
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', 'scripts', 'harness');
const CONFIG = path.join(SRC, 'config.js');

// CLAUDE_PROJECT_DIR is the second root strategy, and the agent runtime exports it.
// Inherited into a fixture it would point every child at the real repo, so it is
// removed for every call and set back only by the test that is about it.
function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  if (!extra || !('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function fixture(config, extraFiles) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-config-')));
  const here = path.join(dir, 'scripts', 'harness');
  fs.mkdirSync(here, { recursive: true });
  fs.copyFileSync(CONFIG, path.join(here, 'config.js'));
  if (config !== null) {
    fs.writeFileSync(path.join(dir, 'harness.config.json'),
      typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  }
  for (const rel of Object.keys(extraFiles || {})) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, extraFiles[rel]);
  }
  return dir;
}
function withFixture(config, extraFiles, body) {
  const dir = fixture(config, extraFiles);
  try { return body(dir, path.join(dir, 'scripts', 'harness', 'config.js')); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// `node config.js` with no flags prints the resolved config, which is how a human
// finds out what the harness thinks it is grading. It is also the only path that
// turns a validation error into the two-line stop, so it is what these tests drive.
const printConfig = (dir, script, cwd, env) =>
  spawnSync(process.execPath, [script], { cwd: cwd || dir, encoding: 'utf8', env: env || cleanEnv() });

const MINIMAL = { project: { name: 'example' }, gates: [{ name: 'test', command: 'node --test' }] };

describe('config.js --self-test', () => {
  test('passes', () => {
    const r = spawnSync(process.execPath, [CONFIG, '--self-test'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS/m, r.stdout);
  });
});

describe('config.js — the documented defaults', () => {
  test('a config that says only what differs gets the rest', () => {
    withFixture(MINIMAL, null, (dir, script) => {
      const r = printConfig(dir, script);
      assert.strictEqual(r.status, 0, r.stderr);
      const cfg = JSON.parse(r.stdout);
      assert.strictEqual(cfg.project.docsRoot, 'docs');
      assert.strictEqual(cfg.project.tracksDir, 'docs/tracks');
      assert.strictEqual(cfg.docs.caps['AGENTS.md'], 80);
      assert.strictEqual(cfg.docs.caps['CLAUDE.md'], 5, 'the stub is capped at the size of a pointer');
      assert.strictEqual(cfg.docs.caps.subtreeAgentsMd, 50);
      assert.strictEqual(cfg.docs.caps.default, 150);
      assert.deepStrictEqual(cfg.env.guarded, ['.env', '.env.*']);
      assert.deepStrictEqual(cfg.artifacts, []);
      assert.strictEqual(cfg.context.budgetFile, 'scripts/harness/context-budget.json');
    });
  });

  test('an array in the file REPLACES the default rather than growing it', () => {
    // Concatenation would make a default impossible to remove: a repo that wants
    // one guarded pattern could never say so, it could only ever add to ours.
    withFixture(Object.assign({}, MINIMAL, { env: { guarded: ['secrets.json'] } }), null, (dir, script) => {
      const cfg = JSON.parse(printConfig(dir, script).stdout);
      assert.deepStrictEqual(cfg.env.guarded, ['secrets.json']);
      assert.deepStrictEqual(cfg.env.openCarveOuts, [], 'the sibling default was lost with it');
    });
  });

  test('there is no default gate list, and an empty one is refused', () => {
    // The whole reason this seam exists. A harness that invents a suite when it
    // cannot read one prints a green verdict about checks nobody agreed to.
    withFixture({ project: { name: 'example' }, gates: [] }, null, (dir, script) => {
      const r = printConfig(dir, script);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /`gates` must be a non-empty array/);
      assert.match(r.stderr, /will not invent one/);
    });
  });
});

describe('config.js — a bad config is a two-line stop, and it names what is wrong', () => {
  test('a missing config is fatal with a fix line', () => {
    withFixture(null, null, (dir, script) => {
      const r = printConfig(dir, script);
      assert.strictEqual(r.status, 1);
      const lines = r.stderr.trim().split('\n');
      assert.strictEqual(lines.length, 2, 'a stop is two lines — the problem and the fix: ' + r.stderr);
      assert.match(lines[0], /^FATAL — no readable harness\.config\.json/);
      assert.match(lines[1], /^ {3}fix: write harness\.config\.json at the repo root/);
      assert.match(lines[1], /no default suite/);
    });
  });

  test('a gate with no command is rejected BY NAME, not by index', () => {
    // The reader is looking at a list of gates. "gates[1] is invalid" makes them
    // count; the name is already on the line they have to edit.
    withFixture({ project: { name: 'example' }, gates: [{ name: 'test', command: 'x' }, { name: 'docs' }] }, null, (dir, script) => {
      const r = printConfig(dir, script);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /gates\.docs has no `command`/);
      assert.doesNotMatch(r.stderr, /gates\[1\]/);
    });
  });

  test('a gate with no name falls back to its index, because there is nothing else to call it', () => {
    withFixture({ project: { name: 'example' }, gates: [{ command: 'x' }] }, null, (dir, script) => {
      assert.match(printConfig(dir, script).stderr, /gates\[0\] has no `name`/);
    });
  });

  test('an unknown TOP-LEVEL key is a named error, not a shrug', () => {
    // A typo'd section name is indistinguishable from a section you believe you
    // configured: the symptom is the harness quietly using its default instead.
    withFixture(Object.assign({ gate: [] }, MINIMAL), null, (dir, script) => {
      const r = printConfig(dir, script);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /unknown top-level key\(s\) `gate`/);
      assert.match(r.stderr, /a setting that is not in force/);
    });
  });

  test('a misspelled key inside a gate is rejected too', () => {
    withFixture({ project: { name: 'example' }, gates: [{ name: 'test', command: 'x', adaptor: 'node-test' }] }, null, (dir, script) => {
      assert.match(printConfig(dir, script).stderr, /gates\.test: unknown key `adaptor`/);
    });
  });

  test('a cap must be a positive integer — 0 and a float are typos, not policies', () => {
    for (const bad of [0, -1, 12.5, '80']) {
      withFixture(Object.assign({}, MINIMAL, { docs: { caps: { default: bad } } }), null, (dir, script) => {
        const r = printConfig(dir, script);
        assert.strictEqual(r.status, 1, 'a cap of ' + JSON.stringify(bad) + ' was accepted');
        assert.match(r.stderr, /docs\.caps\.default must be a positive integer/);
      });
    }
  });

  test('a stated source branch must be one name git can be handed; unset, it stays unset', () => {
    // The one optional key with no default. branch-sync.js reads it through a SOFT load and
    // treats an unusable value as "not set", so before this was validated a two-word value fell
    // through to detection without a word: a typo read as a setting, in the key that decides
    // what a branch is compared against.
    withFixture(MINIMAL, null, (dir, script) => {
      assert.strictEqual(JSON.parse(printConfig(dir, script).stdout).project.sourceBranch, undefined, 'a default source branch was invented');
    });
    withFixture(Object.assign({}, MINIMAL, { project: { name: 'example', sourceBranch: 'trunk' } }), null, (dir, script) => {
      assert.strictEqual(JSON.parse(printConfig(dir, script).stdout).project.sourceBranch, 'trunk');
    });
    for (const bad of ['my branch', '', '   ', 7]) {
      withFixture(Object.assign({}, MINIMAL, { project: { name: 'example', sourceBranch: bad } }), null, (dir, script) => {
        const r = printConfig(dir, script);
        assert.strictEqual(r.status, 1, 'a source branch of ' + JSON.stringify(bad) + ' was accepted');
        assert.match(r.stderr, /project\.sourceBranch must be one branch name with no whitespace/);
      });
    }
  });

  test('unparseable JSON says so, and says where prose belongs', () => {
    withFixture('{ "project": { "name": "example" }, }', null, (dir, script) => {
      const r = printConfig(dir, script);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /is not valid JSON/);
      assert.match(r.stderr, /`_readme` array/);
    });
  });
});

describe('config.js — soft mode, for hooks', () => {
  // An exception out of a PreToolUse hook takes the session down with it. A hook
  // that cannot read the config must be able to decide what "no config" means for
  // it — deny, or ask — which it can only do if load() hands it a value.
  const ask = (dir, script, cwd) => spawnSync(process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require(' + JSON.stringify(script) + ').load({ soft: true })))'],
    { cwd: cwd || dir, encoding: 'utf8', env: cleanEnv() });

  test('a missing config answers null instead of throwing', () => {
    withFixture(null, null, (dir, script) => {
      const r = ask(dir, script);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout, 'null');
    });
  });

  test('an invalid config answers null too — a hook must not die on a typo', () => {
    withFixture({ project: { name: 'example' } }, null, (dir, script) => {
      assert.strictEqual(ask(dir, script).stdout, 'null');
    });
  });

  test('a good config in soft mode is the same config', () => {
    withFixture(MINIMAL, null, (dir, script) => {
      const cfg = JSON.parse(ask(dir, script).stdout);
      assert.strictEqual(cfg.project.name, 'example');
      assert.strictEqual(cfg.docs.caps.default, 150);
    });
  });
});

describe('config.js — ROOT', () => {
  const askRoot = (script, cwd, env) => spawnSync(process.execPath,
    ['-e', 'process.stdout.write(require(' + JSON.stringify(script) + ').ROOT)'],
    { cwd: cwd, encoding: 'utf8', env: env || cleanEnv() });

  test('is found by walking up from a nested cwd', () => {
    withFixture(MINIMAL, { 'a/b/c/.keep': '' }, (dir, script) => {
      const r = askRoot(script, path.join(dir, 'a', 'b', 'c'));
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(fs.realpathSync(r.stdout.trim()), dir);
    });
  });

  test('is CLAUDE_PROJECT_DIR when the cwd is outside the repo, which is what a hook gets', () => {
    withFixture(MINIMAL, null, (dir, script) => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outside-')));
      try {
        const r = askRoot(script, outside, cleanEnv({ CLAUDE_PROJECT_DIR: dir }));
        assert.strictEqual(fs.realpathSync(r.stdout.trim()), dir);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    });
  });

  test('is two levels up from the script when there is neither — the vendored-copy case', () => {
    withFixture(MINIMAL, null, (dir, script) => {
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outside-')));
      try {
        const r = askRoot(script, outside);
        assert.strictEqual(fs.realpathSync(r.stdout.trim()), dir,
          'scripts/harness/config.js must fall back to ../.., so a vendored harness grades the tree it was vendored into');
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    });
  });

  test('a cwd inside an unconfigured directory does NOT climb out into an enclosing repo', () => {
    // Deliberately not a walk up from __dirname. If it were, a run in a temp
    // directory would silently grade whatever repo happened to be above it — and
    // a test that asserts against the wrong tree passes for the wrong reason.
    withFixture(MINIMAL, null, (dir, script) => {
      const r = askRoot(script, dir);
      assert.strictEqual(fs.realpathSync(r.stdout.trim()), dir);
      assert.notStrictEqual(fs.realpathSync(r.stdout.trim()), fs.realpathSync(path.join(__dirname, '..')));
    });
  });
});
