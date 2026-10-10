'use strict';
/* ============================================================
   panel.test.js — the panel's facts, as a member of the suite.

   panel.js keeps a --self-test that drives its three judgements with literals. This file is what
   makes that verdict more than prose: the self-test is run as a process, the command line the
   mod runs is run against this repo, and the mod's own files are held to the two limits a test
   in Node can read: it reaches the harness through panel.js alone, and it hooks nothing that
   can refuse a call.

   NOTHING HERE NEEDS THE `claude` PROGRAM. The mod's behaviour is graded by the `mods` gate,
   which is optional by absence; this file must pass on a machine that has never installed it.
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'harness', 'panel.js');
const MOD = path.join(ROOT, '.claude', 'plugins', 'harness');
const CONFIG = require(path.join(ROOT, 'scripts', 'harness', 'config.js'));

function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  return env;
}
const run = (args) => spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });

describe('panel.js keeps a passing self-test', () => {
  test('panel.js --self-test passes', () => {
    const r = run(['--self-test']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS — panel\.js self-test \(\d+ checks/);
  });
});

describe('panel.js prints the facts as one JSON object', () => {
  const r = run([]);
  let facts = null;
  try { facts = JSON.parse(r.stdout); } catch { /* the first test says so */ }

  test('it exits 0 with one line of JSON and nothing on stderr', () => {
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.stdout.trim().split('\n').length, 1);
    assert.ok(facts && typeof facts === 'object', 'stdout is not a JSON object: ' + r.stdout.slice(0, 200));
    assert.strictEqual(r.stderr, '');
  });

  test('the gate verdict is one of the four states, with a command to re-record it', () => {
    assert.ok(['green', 'red', 'stale', 'not-run'].includes(facts.gates.state), facts.gates.state);
    assert.deepStrictEqual(facts.gates.argv.slice(0, 3), ['node', 'scripts/harness/gates.js', '--check']);
    assert.strictEqual(facts.gates.argv.join(' '), facts.gates.command);
    assert.ok(Array.isArray(facts.gates.reasons));
  });

  test('tracks, findings and problems are lists of the documented shape', () => {
    for (const k of ['tracks', 'findings', 'problems']) assert.ok(Array.isArray(facts[k]), k + ' is not a list');
    for (const t of facts.tracks) assert.deepStrictEqual(Object.keys(t), ['id', 'phaseNext', 'doing', 'handoff', 'closes', 'lint', 'close']);
    for (const f of facts.findings) assert.deepStrictEqual(Object.keys(f), ['name', 'line']);
    assert.deepStrictEqual(facts.problems, [], 'this repo has a readable config and a claude-code row');
  });

  test('a tool id the registry does not have is a problem that is named, not a crash', () => {
    const other = run(['--tool', 'no-such-tool']);
    assert.strictEqual(other.status, 0, other.stdout + other.stderr);
    assert.match(JSON.parse(other.stdout).problems.join('\n'), /the registry row `no-such-tool` could not be read/);
  });
});

describe('the harness mod draws and relays, and nothing else', () => {
  const source = fs.readFileSync(path.join(MOD, 'hooks', 'register.js'), 'utf8');
  const hooked = Array.from(source.matchAll(/\bon\('([a-zA-Z.]+)'/g)).map((m) => m[1]);
  const called = Array.from(new Set(Array.from(source.matchAll(/\$\.([a-z]+\.[a-zA-Z]+)\(/g)).map((m) => m[1]))).sort();

  test('it hooks no event that can refuse a call or rewrite a prompt', () => {
    assert.deepStrictEqual(Array.from(new Set(hooked)).sort(), ['command.run', 'session.compact', 'session.measure', 'session.start', 'turn.complete', 'ui.render']);
  });

  test('it writes no file, opens no connection and calls no model', () => {
    assert.deepStrictEqual(called, ['clock.after', 'command.register', 'fs.read', 'process.run', 'session.usage', 'ui.ask', 'ui.invalidate', 'ui.log', 'ui.open', 'ui.resolve', 'ui.toast']);
  });

  test('the only script it names is panel.js, and that script exists', () => {
    assert.deepStrictEqual(Array.from(new Set(source.match(/scripts\/harness\/[a-z-]+\.c?js/g))), ['scripts/harness/panel.js']);
    assert.ok(fs.existsSync(SCRIPT));
  });

  test('its hooks.json names the one module, and no settings hook', () => {
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(MOD, 'hooks', 'hooks.json'), 'utf8'))).sort(), ['description', 'modules']);
  });

  test('the `mods` gate is declared optional, so an absent tool is a skip and never a fail', () => {
    const gate = CONFIG.load({ root: ROOT, fresh: true }).gates.find((g) => g.name === 'mods');
    assert.ok(gate, 'no `mods` gate in harness.config.json');
    assert.strictEqual(gate.optional, true);
    assert.strictEqual(gate.adapter, 'exit-code');
    assert.match(gate.command, /^claude plugin validate \.claude\/plugins\/harness --strict && claude plugin test \.claude\/plugins\/harness( && |$)/);
  });
});
