'use strict';
/* ============================================================
   mode-gates.test.js — the four run-mode scripts, as members of the suite.

   mode.js, actions.js, carveouts.js and peers.js each keep a --self-test and had no entry here,
   so by this repo's own rule their verdicts were prose. This file is that entry: every one of
   the four self-tests is run as a process, and this repo's own config is held to listing a gate
   for each, with the command and the reading a reader would expect.

   What it does NOT do is re-run the carve-out comparison against the tree: that is the gate
   itself, and a second copy here would red twice for one moved figure.
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'harness');
const CONFIG = require(path.join(SRC, 'config.js'));
const GATES = CONFIG.load({ root: ROOT, fresh: true }).gates;

// gate name -> the script, and what its command line is expected to be.
const WIRED = {
  mode: { script: 'mode.js', command: 'node scripts/harness/mode.js --self-test', adapter: 'exit-code' },
  effects: { script: 'actions.js', command: 'node scripts/harness/actions.js --self-test', adapter: 'exit-code' },
  carveouts: { script: 'carveouts.js', command: 'node scripts/harness/carveouts.js --check', adapter: undefined },
  peers: { script: 'peers.js', command: 'node scripts/harness/peers.js --self-test', adapter: 'exit-code' },
};

function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  return env;
}

describe('the run-mode scripts keep a passing self-test', () => {
  for (const [gate, w] of Object.entries(WIRED)) {
    test(w.script + ' --self-test passes', () => {
      const r = spawnSync(process.execPath, [path.join(SRC, w.script), '--self-test'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
      assert.strictEqual(r.status, 0, 'gate `' + gate + '`:\n' + r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('PASS — ' + w.script.replace('.', '\\.') + ' self-test \\(\\d+ checks'));
    });
  }
});

describe('this repo\'s suite runs a gate for each of them', () => {
  for (const [gate, w] of Object.entries(WIRED)) {
    test('gate `' + gate + '` runs ' + w.script, () => {
      const g = GATES.find((x) => x.name === gate);
      assert.ok(g, 'no gate named `' + gate + '` in the config');
      assert.strictEqual(g.command, w.command);
      assert.strictEqual(g.adapter, w.adapter);
      assert.notStrictEqual(g.optional, true, 'a run-mode gate must not be able to declare itself skipped');
    });
  }
  test('the three that grade a script say so, and claim nothing about the tree', () => {
    const note = (GATES.find((x) => x.name === 'mode')._readme || []).join(' ');
    assert.match(note, /each grade the SCRIPT/);
    assert.match(note, /registered on no hook event/);
    assert.match(note, /the peers hook is not installed/);
  });
  test('the census the carve-out gate compares against is committed, and names only known kinds', () => {
    const file = path.join(SRC, 'carveouts.baseline.json');
    assert.ok(fs.existsSync(file), 'no carve-out census: the gate would declare a skip');
    const census = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [rule, row] of Object.entries(census)) {
      assert.ok(Number.isInteger(row.total) && Number.isInteger(row.undescribed), rule + ' has no integer counts');
      assert.ok(row.undescribed <= row.total, rule + ' has more reason-less waivers than waivers');
    }
  });
});
