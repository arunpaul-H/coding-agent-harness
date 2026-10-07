'use strict';
/* ============================================================
   run.test.js — the launcher, as a PROCESS.

   scripts/harness/run.js drives its decisions with literals in its own --self-test. What that
   cannot reach is the part a user touches: the real registry and config, a command line with no
   terminal behind it, and a program actually being started with the flags the row records.

   NOTHING HERE RUNS A CODING AGENT. Where a case needs a program to start, it plants a throwaway
   one under the name the row records, on a PATH that holds nothing else, and that program only
   prints the arguments it was given. The tool id and its flags are read off the registry.
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'scripts', 'harness', 'run.js');
const BIN = path.join(ROOT, 'bin', 'harness.js');
const TOOLS = require(path.join(ROOT, 'scripts', 'harness', 'tools.js'));
const { MODE_IDS } = require(path.join(ROOT, 'scripts', 'harness', 'mode.js'));
const CONFIG = require(path.join(ROOT, 'scripts', 'harness', 'config.js'));
const REG = TOOLS.readRegistry();
const ENABLED = CONFIG.load({ root: ROOT, fresh: true }).tools.enabled;

// The row these cases launch: enabled here, with a program and at least one recorded mode.
const ROW = REG.tools.find((r) => ENABLED.includes(r.id) && typeof r.bin === 'string' && r.modes && MODE_IDS.some((m) => Array.isArray(r.modes[m])));
const SET = ROW ? MODE_IDS.find((m) => Array.isArray(ROW.modes[m]) && ROW.modes[m].length) : null;
const NULLED = ROW ? MODE_IDS.find((m) => ROW.modes[m] === null) : null;
const BARE = REG.tools.find((r) => !('modes' in r) && r.tier !== 'inherits');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** A directory holding one program under `name`, which prints its arguments and exits `code`. */
function fakeProgram(name, code) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-test-')));
  made.push(dir);
  const script = path.join(dir, 'echo-args.js');
  fs.writeFileSync(script, 'console.log("ARGS " + JSON.stringify(process.argv.slice(2)));\nprocess.exit(' + code + ');\n');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, name + '.cmd'), '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
  } else {
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n', { mode: 0o755 });
  }
  return dir;
}
function envWithPath(dir) {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_TEST_CONTEXT;
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  env.PATH = dir;
  return env;
}
const emptyDir = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-test-'))); made.push(d); return d; };
function run(args, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [o.via || RUN].concat(args), { cwd: ROOT, encoding: 'utf8', env: envWithPath(o.path || emptyDir()) });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

describe('run.js (the script)', () => {
  test('--self-test passes', () => {
    const r = run(['--self-test']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /PASS — run\.js self-test \(\d+ checks, nothing started\)/);
  });
  test('--self-test beside a mode is a usage error, never a launch that reads as tested', () => {
    assert.strictEqual(run(['hitl', '--self-test']).code, 2);
    assert.strictEqual(run(['--modes', '--self-test']).code, 2);
  });
  test('--modes prints the four, in mode.js order', () => {
    const r = run(['--modes']);
    assert.strictEqual(r.code, 0);
    assert.deepStrictEqual(r.out.trim().split('\n').map((l) => l.split(/\s+/)[0]), MODE_IDS);
  });
  test('the registry still holds the rows these tests are written against', () => {
    assert.ok(ROW, 'no enabled row with a `bin` and a recorded mode');
    assert.ok(SET, 'that row records no mode with a flag');
    assert.ok(BARE, 'no row without a `modes` cell');
  });
});

describe('run.js refuses, and starts nothing', () => {
  const planted = () => fakeProgram(ROW.bin, 0);
  const refused = (r, why) => {
    assert.strictEqual(r.code, 1, r.out + r.err);
    assert.match(r.err, /^RUN REFUSED — /);
    assert.match(r.err, why);
    assert.match(r.err, /\n {3}fix: /);
    assert.doesNotMatch(r.out, /ARGS/, 'the program was started');
  };

  test('no mode and no terminal: an answer down a pipe is not the owner\'s', () => {
    refused(run(['--tool', ROW.id], { path: planted() }), /no mode given and no terminal to ask on/);
  });
  test('a mode that is not one of the four', () => {
    refused(run(['yolo', '--tool', ROW.id], { path: planted() }), /`yolo` is not a run mode/);
  });
  test('a tool with no row', () => {
    refused(run([SET, '--tool', 'no-such-tool'], { path: planted() }), /no row `no-such-tool`/);
  });
  test('a row the config has not enabled', () => {
    const off = REG.tools.find((r) => !ENABLED.includes(r.id));
    refused(run([SET, '--tool', off.id], { path: planted() }), /is not in tools\.enabled/);
  });
  test('a mode whose cell is null is named, not launched bare', { skip: !NULLED && 'the row leaves no mode null' }, () => {
    refused(run([NULLED, '--tool', ROW.id], { path: planted() }), new RegExp('mode `' + NULLED + '` is null in the `modes` cell of row `' + ROW.id + '`'));
  });
  test('a program that is not on PATH', () => {
    refused(run([SET, '--tool', ROW.id]), /is not on PATH, so there is no tool to start/);
  });
  test('an unknown flag is a usage error', () => {
    const r = run([SET, '--tool', ROW.id, '--force'], { path: planted() });
    assert.strictEqual(r.code, 2);
    assert.doesNotMatch(r.out, /ARGS/);
  });
});

describe('run.js starts the tool with the flags its row records', () => {
  test('--dry-run prints the command line and starts nothing', () => {
    const r = run([SET, '--tool', ROW.id, '--dry-run'], { path: fakeProgram(ROW.bin, 0) });
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.ok(r.out.includes('`' + ROW.id + '` in mode ' + SET + ' -> ' + [ROW.bin].concat(ROW.modes[SET]).join(' ')), r.out);
    assert.match(r.out, /--dry-run: nothing started\. Would start /);
    assert.doesNotMatch(r.out, /ARGS/);
  });
  test('--dry-run says so when the program is not on PATH', () => {
    const r = run([SET, '--tool', ROW.id, '--dry-run']);
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /is NOT on PATH, so a real run would be refused/);
  });
  test('a real start passes exactly the row\'s arguments, and the tool\'s exit status comes back', () => {
    const r = run([SET, '--tool', ROW.id], { path: fakeProgram(ROW.bin, 7) });
    assert.strictEqual(r.code, 7, r.out + r.err);
    const m = /ARGS (\[.*\])/.exec(r.out);
    assert.ok(m, 'the program did not run:\n' + r.out + r.err);
    assert.deepStrictEqual(JSON.parse(m[1]), ROW.modes[SET]);
  });
  test('with one tool enabled, --tool may be left out', { skip: ENABLED.length !== 1 && 'this repo enables more than one tool' }, () => {
    const r = run([SET, '--dry-run']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.ok(r.out.includes('`' + ENABLED[0] + '` in mode ' + SET));
  });
  test('it says the flags are recorded, not granted', () => {
    const r = run([SET, '--tool', ROW.id, '--dry-run']);
    assert.match(r.out, /the tool grants the permission, not the harness/);
    assert.ok(r.out.includes('(evidence: ' + ROW.evidence + ')'));
  });
});

describe('run.js --track: the receipt is an approval, so it needs a terminal', () => {
  const R = require(RUN);
  const MODE = require(path.join(ROOT, 'scripts', 'harness', 'mode.js'));
  /** A throwaway repo with one open track whose handoff asks for phase 3. */
  function repoWithTrack() {
    const dir = emptyDir();
    fs.writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify({ project: { name: 'acme' }, gates: [{ name: 'test', command: 'node --test' }], tools: { enabled: ENABLED } }));
    fs.mkdirSync(path.join(dir, 'docs', 'tracks', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'tracks', 'fixture', 'handoff.md'), '---\nid: fixture-handoff\nkind: handoff\nstatus: open\nphase_next: 3\n---\n# next\n');
    return dir;
  }
  const receipt = (dir) => path.join(dir, 'docs', 'tracks', 'fixture', R.RECEIPT);
  const runIn = (dir, args, bin) => {
    const r = spawnSync(process.execPath, [RUN].concat(args), { cwd: dir, encoding: 'utf8', env: envWithPath(bin || emptyDir()) });
    return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
  };

  test('with no terminal it is refused, nothing is written and nothing starts, even with the mode named', () => {
    const dir = repoWithTrack();
    const r = runIn(dir, [SET, '--tool', ROW.id, '--track', 'fixture'], fakeProgram(ROW.bin, 0));
    assert.strictEqual(r.code, 1, r.out + r.err);
    assert.match(r.err, /--track writes an approval receipt, and there is no terminal here/);
    assert.doesNotMatch(r.out, /ARGS/);
    assert.strictEqual(fs.existsSync(receipt(dir)), false, 'a receipt was written with nobody at a terminal');
  });
  test('--dry-run says what it would approve and writes nothing', () => {
    const dir = repoWithTrack();
    const r = runIn(dir, [SET, '--tool', ROW.id, '--track', 'fixture', '--dry-run']);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.ok(r.out.includes('receipt: docs/tracks/fixture/' + R.RECEIPT + ' approves phase 3 of `fixture` in mode ' + SET), r.out);
    assert.match(r.out, /nothing started, no receipt written/);
    assert.strictEqual(fs.existsSync(receipt(dir)), false);
  });
  test('a track that is not there, and an id that is a path, are refused before anything is asked', () => {
    const dir = repoWithTrack();
    for (const [id, why] of [['gone', /no docs\/tracks\/gone\/handoff\.md/], ['../fixture', /is not a track id/]]) {
      const r = runIn(dir, ['--tool', ROW.id, '--track', id, '--dry-run']);
      assert.strictEqual(r.code, 1, r.out + r.err);
      assert.match(r.err, why);
    }
  });
  test('what the launcher writes is what mode.js reads, and it approves that phase only', () => {
    const dir = repoWithTrack();
    const tp = R.trackPlan('fixture', 'docs/tracks', (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } });
    assert.deepStrictEqual(tp, { ok: true, file: 'docs/tracks/fixture/' + R.RECEIPT, phase: 3 });
    fs.writeFileSync(receipt(dir), JSON.stringify(R.receiptFor('fixture', tp.phase, 'hitl', ROW.id, 'abc', '2026-10-07T00:00:00.000Z')));
    const state = MODE.readReceipt(dir, 'docs/tracks', 'fixture');
    assert.strictEqual(state.receipt.mode, 'hitl');
    assert.strictEqual(MODE.decide({ event: 'prompt-submit' }, Object.assign({}, state, { phaseNext: 3 })).deny, false);
    assert.strictEqual(MODE.decide({ event: 'prompt-submit' }, Object.assign({}, state, { phaseNext: 4 })).deny, true);
  });
  test('this repo ignores a receipt, and the installer writes the rule', () => {
    const r = spawnSync('git', ['check-ignore', '--no-index', '-q', 'docs/tracks/example/' + R.RECEIPT], { cwd: ROOT });
    assert.strictEqual(r.status, 0, 'a receipt in a track folder is not ignored here');
    assert.ok(require(BIN).requiredIgnores([]).some((x) => x.pattern === R.RECEIPT));
  });
});

describe('harness run (the CLI surface)', () => {
  test('`harness run` reaches the launcher', () => {
    const r = run(['run', SET, '--tool', ROW.id, '--dry-run'], { via: BIN });
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /--dry-run: nothing started/);
  });
  test('a refusal keeps its exit status through the CLI', () => {
    const r = run(['run', 'yolo', '--tool', ROW.id], { via: BIN });
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /RUN REFUSED/);
  });
  test('the help names it', () => {
    const r = run(['--help'], { via: BIN });
    assert.match(r.out, /harness run \[<mode>\] \[--tool <id>\] \[--track <id>\] \[--dry-run\]/);
  });
});
