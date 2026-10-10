'use strict';
/* ============================================================
   harness-guard.test.js — the guard mod's files, held to what a test in Node can read.

   The mod relays; scripts/harness/hook.js decides. Three things tie the two together, and each
   would drift silently without a test: the command line the mod runs must be one the entry
   answers, the tool names the mod hands over must be the ones the settings matcher names, and
   the line the mod recognises a held commit by must be the one the hygiene guard writes.

   NOTHING HERE NEEDS THE `claude` PROGRAM. The mod's behaviour is graded by the `mods` gate,
   which is optional by absence; this file must pass on a machine that has never installed it.
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const MOD = path.join(ROOT, '.claude', 'plugins', 'harness-guard');
const SOURCE = fs.readFileSync(path.join(MOD, 'hooks', 'register.js'), 'utf8');
// The same text with its comments removed, so a word in the header is not read as code
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DIALECT = require(path.join(ROOT, 'scripts', 'harness', 'dialects', 'claude.js'));

function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** The argv the mod runs, read out of its source. */
function hookArgv() {
  const m = CODE.match(/const HOOK = (\[[^\]]*\])/);
  assert.ok(m, 'register.js names its command as `const HOOK = [...]`');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

/** Run the mod's command line with one payload on stdin, the way the mod does. */
function ask(payload) {
  const argv = hookArgv();
  assert.strictEqual(argv[0], 'node');
  return spawnSync(process.execPath, argv.slice(1), { cwd: ROOT, encoding: 'utf8', env: cleanEnv(), input: JSON.stringify(payload) });
}

describe('the guard mod reaches the harness through the one hook entry', () => {
  test('its command line is the pre-tool entry, and nothing else is run', () => {
    assert.deepStrictEqual(hookArgv(), ['node', 'scripts/harness/hook.js', '--tool', 'claude-code', '--event', 'pre-tool']);
    assert.strictEqual((CODE.match(/\$\.process\.run\(/g) || []).length, 1, 'one $.process.run call site');
    assert.match(CODE, /\$\.process\.run\(HOOK,/);
  });

  test('the entry passes the payload the mod spells for a harmless call', () => {
    const r = ask({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi', description: 'x' }, cwd: ROOT });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.stdout.trim(), '');
  });

  test('the entry refuses a mention of a guarded file, spelled as the mod spells it', () => {
    const r = ask({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(ROOT, '.env') } });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });

  test('the entry holds a spawn of a registered agent to the contract, spelled as the mod spells it', () => {
    const bare = ask({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'implement', prompt: 'do it', description: 'x' } });
    assert.strictEqual(bare.status, 2, bare.stdout + bare.stderr);
    assert.match(JSON.parse(bare.stdout).hookSpecificOutput.permissionDecisionReason, /SPAWN WITHOUT THE CONTRACT/);
    const other = ask({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'workflow-subagent', prompt: 'do it', description: 'x' } });
    assert.strictEqual(other.status, 0, other.stdout + other.stderr);
  });
});

describe('the guard mod and the settings hook see the same tools', () => {
  test('the mod\'s matcher names exactly what the dialect\'s matcher names', () => {
    const m = CODE.match(/on\('tool\.call', \{ tool: \/\^\(([^)]*)\)\$\/ \}/);
    assert.ok(m, 'register.js spells its tool.call matcher as one literal');
    const pre = DIALECT.wiring.entries({ id: 'claude-code' }).find((entry) => entry.event === 'pre-tool');
    assert.deepStrictEqual(m[1].split('|'), pre.entry.matcher.split('|'));
  });
});

describe('the guard mod recognises a held commit by the hygiene guard\'s own line', () => {
  test('the prefix in the mod opens the message the hygiene guard writes', () => {
    const m = CODE.match(/const HYGIENE = '([^']*)'/);
    assert.ok(m, 'register.js names the prefix as `const HYGIENE`');
    const guard = fs.readFileSync(path.join(ROOT, 'scripts', 'harness', 'guards', 'commit-hygiene.cjs'), 'utf8');
    assert.ok(guard.includes('message: `' + m[1] + ' ${'), 'commit-hygiene.cjs still opens its message with `' + m[1] + '`');
  });
});

describe('the guard mod gates and never draws', () => {
  test('every gating hook has a catch, and no hook draws', () => {
    for (const event of ['tool.call', 'agent.spawn', 'prompt.mention']) {
      assert.ok(CODE.includes("on('" + event + "'"), event + ' is hooked');
    }
    assert.strictEqual((CODE.match(/\}\)\.catch\(\w+\)/g) || []).length, 3, 'three hooks, three catches');
    assert.doesNotMatch(CODE, /ui\.render|\$\.ui\.(open|toast|invalidate|resolve)|\$\.fs\.|\$\.http\.|\$\.model\./);
  });

  test('the optional `mods` gate grades this mod too', () => {
    const CONFIG = require(path.join(ROOT, 'scripts', 'harness', 'config.js'));
    const gate = CONFIG.load({ root: ROOT, fresh: true }).gates.find((g) => g.name === 'mods');
    assert.ok(gate, 'no `mods` gate in harness.config.json');
    assert.strictEqual(gate.optional, true);
    assert.match(gate.command, / && claude plugin validate \.claude\/plugins\/harness-guard --strict && claude plugin test \.claude\/plugins\/harness-guard$/);
  });

  test('the manifest and the module list are where the tool looks for them', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(MOD, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.name, 'harness-guard');
    const hooks = JSON.parse(fs.readFileSync(path.join(MOD, 'hooks', 'hooks.json'), 'utf8'));
    assert.deepStrictEqual(hooks.modules, ['./register.js']);
  });
});
