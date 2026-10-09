'use strict';
/* ============================================================
   panel.js — the facts a panel draws, as one JSON object on stdout.

   WHY THIS EXISTS
   A mod (a plugin whose handlers run inside the agent's own program) can draw, and it cannot
   decide: it has no Node built-ins and no `require`, so nothing written inside one is in reach
   of `node --test`. So every judgement a panel shows is made HERE, with a --self-test, and the
   mod runs this file and draws what it printed. .claude/plugins/harness/ is the one reader
   today; nothing in this file knows that.

   WHAT IT PRINTS
     gates     the recorded run in gates.json, judged: `green`, `red`, `stale` or `not-run`,
               with the reasons, and the command that re-records it as an argv list
     tracks    every open track, its handoff's `phase_next` and the first line of its block
     findings  one line per session-start reporter that has something to say
     problems  what this file could not read. Not read is not clean, so it is said.

   THE FOUR GATE STATES, most urgent first
     stale     a gate-relevant file is newer than the run: the run does not describe this tree,
               whatever it said. The walk is close-phase.js's, the one the stop report uses.
     red       a gate that ran breaks the baseline (gates.js `violations`, the gate's own rule).
     not-run   there is no run, no baseline to hold one to, or the run covered only some of the
               baseline's gates (`--only`). A gate that did not run is NOT RUN, never implied.
     green     every gate in the baseline ran, and none breaks it.

   WHAT IT IS NOT
   . Not a gate. It never runs the suite and it prints no GATE line.
   . Not a writer. It reads two verdict files, the track folders and the tree's mtimes.
   . Not a second comparator, walk or reporter: each is required from the file that owns it.

   USAGE
     node scripts/harness/panel.js                 the facts, one JSON object
     node scripts/harness/panel.js --tool <id>     the registry row whose reporters to run
                                                   (default: claude-code)
     node scripts/harness/panel.js --self-test
   Exit 0 whenever the facts were printed, whatever they say. Exit 1 with `{"error": ...}` when
   the file itself failed: a reader must be able to tell "nothing to report" from "did not look".
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');

const GATES_JSON = path.join(__dirname, 'gates.json');
const BASELINE_JSON = path.join(__dirname, 'gates.baseline.json');
const DEFAULT_TOOL = 'claude-code';
const LINE_MAX = 120;
const REASONS_MAX = 5;

const gatesJs = () => require('./gates.js');
const closePhase = () => require('./close-phase.js');
const worktree = () => require('./worktree.js');
const hook = () => require('./hook.js');

const clip = (s) => (s.length > LINE_MAX ? s.slice(0, LINE_MAX - 3) + '...' : s);

/* ---------- the gate verdict ----------
   Pure: the two verdict files and the staleness walk's answer in, the state out. `deps` carries
   the comparator and the skip reader so the self-test can drive this with literals. */
function verdictOf(run, baseline, stop, deps) {
  const command = deps.checkCommand(baseline);
  const out = { state: 'not-run', why: '', at: null, ran: 0, of: 0, reasons: [], changed: 0, newest: null, command, argv: command.split(' ') };
  const at = run ? Date.parse(run.generatedAt) : NaN;
  if (!run || !Number.isFinite(at) || !run.gates || typeof run.gates !== 'object') {
    out.why = 'no recorded gate run';
    return out;
  }
  out.at = new Date(at).toISOString();
  const ranNames = Object.keys(run.gates);
  out.ran = ranNames.length;
  const baseGates = baseline && baseline.gates && typeof baseline.gates === 'object' ? baseline.gates : null;
  const subjects = Array.from(new Set(Object.keys(baseGates || {}).concat(ranNames)));
  out.of = subjects.length;

  const s = stop || {};
  if (s.count > 0) {
    out.state = 'stale';
    out.changed = s.count;
    out.newest = s.newest || null;
    out.why = s.count + ' gate-relevant file' + (s.count === 1 ? '' : 's') + ' changed after the run';
    return out;
  }
  if (!baseGates) {
    out.why = 'no baseline to hold the run to';
    return out;
  }
  const allow = deps.allowedSkips(baseline, '');
  const reasons = [];
  for (const n of ranNames) reasons.push(...deps.violations(n, run.gates[n], baseGates[n], allow));
  if (reasons.length) {
    out.state = 'red';
    out.reasons = reasons.slice(0, REASONS_MAX).map(clip);
    out.why = reasons.length + ' violation' + (reasons.length === 1 ? '' : 's') + ' against the baseline';
    return out;
  }
  if (out.ran < out.of) {
    out.why = 'the run covered ' + out.ran + ' of ' + out.of + ' gates';
    return out;
  }
  out.state = 'green';
  return out;
}

/* ---------- the open tracks ----------
   `io` is `{ list(dir) -> names, read(rel) -> text or null }`. A folder with no README, or a
   README that is not an open track, is not a track to draw. */
function tracksOf(tracksDir, io, deps) {
  const out = [];
  for (const id of io.list(tracksDir).slice().sort()) {
    const readme = io.read(tracksDir + '/' + id + '/README.md');
    if (readme === null) continue;
    const fm = deps.parseFrontmatter(readme) || {};
    if (fm.kind !== 'track' || fm.status !== 'open') continue;
    const handoff = io.read(tracksDir + '/' + id + '/handoff.md');
    const note = handoff === null ? { phaseNext: null, doing: null } : deps.noteSummary(handoff);
    const next = note.phaseNext === null ? NaN : Number(note.phaseNext);
    out.push({ id, phaseNext: Number.isInteger(next) && next >= 0 ? next : null, doing: note.doing || null, handoff: handoff !== null });
  }
  return out;
}

/* ---------- the session-start findings ----------
   Each reporter is run alone through the hook entry's own runReport, so a reporter that threw
   is a finding here exactly as it is at session start. The line is the first one it wrote. */
function findingsOf(handlers, runReport, event, ctx) {
  const out = [];
  for (const h of handlers || []) {
    const v = runReport([h], event, ctx) || {};
    const first = String(v.context || '').split('\n').map((l) => l.replace(/^[\s*]+|[\s*]+$/g, '')).find(Boolean);
    if (first) out.push({ name: h.name, line: clip(first) });
  }
  return out;
}

/* ---------- the disk half ---------- */

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function facts(tool) {
  const { load, ROOT, resolve } = require('./config.js');
  const problems = [];
  let cfg = null;
  try { cfg = load({ soft: true }); } catch { cfg = null; }
  if (!cfg) problems.push('harness.config.json could not be read, so no track and no staleness was looked at');

  const cp = closePhase();
  const baseline = readJson(BASELINE_JSON);
  const gates = verdictOf(readJson(GATES_JSON), baseline, cp.gatherStop(cfg, ROOT),
    { violations: gatesJs().violations, allowedSkips: cp.allowedSkips, checkCommand: cp.checkCommand });

  let tracks = [];
  if (cfg) {
    const io = {
      list: (dir) => { try { return fs.readdirSync(resolve(...dir.split('/')), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } },
      read: (rel) => { try { return fs.readFileSync(resolve(...rel.split('/')), 'utf8'); } catch { return null; } },
    };
    tracks = tracksOf(String(cfg.project.tracksDir).split(/[\\/]/).filter(Boolean).join('/'), io,
      { parseFrontmatter: cp.parseFrontmatter, noteSummary: worktree().noteSummary });
  }

  // What a session-start reporter's gather() may use: the same five things the hook entry
  // hands it. A row that cannot be found leaves the deny-layer report out, and says so.
  const h = hook();
  let row;
  let dialect;
  try {
    const found = h.dialectFor(require('./tools.js').readRegistry(), tool, (name) => require(path.join(__dirname, 'dialects', name + '.js')));
    row = found.row;
    dialect = found.dialect;
  } catch (e) {
    problems.push('the registry row `' + tool + '` could not be read (' + clip(String((e && e.message) || e).split('\n')[0]) + ')');
  }
  const ctx = {
    row,
    dialect,
    root: ROOT,
    today: new Date().toISOString().slice(0, 10),
    cfg: () => cfg,
    readText: (rel) => fs.readFileSync(resolve(...String(rel).split('/')), 'utf8'),
  };
  const event = { event: 'session-start', action: 'other', command: null, path: null, content: null, old: null, tool: '', input: {}, opaque: false };
  const findings = findingsOf(h.HANDLERS['session-start'], h.runReport, event, ctx);

  return { at: new Date().toISOString(), gates, tracks, findings, problems };
}

/* ---------- self-test ---------- */

function selfTest() {
  let CHECKS = 0;
  const f = [];
  const eq = (label, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };

  /* The verdict, on the real comparator and the real skip reader. */
  const cp = closePhase();
  const deps = { violations: gatesJs().violations, allowedSkips: cp.allowedSkips, checkCommand: cp.checkCommand };
  const row = (pass, skipped) => ({ pass, fail: 0, skipped: skipped || 0, total: pass + (skipped || 0), exit: 0 });
  const base = { gates: { test: row(10), docs: row(4, 1) } };
  const T = '2026-01-01T00:00:00.000Z';
  const full = { generatedAt: T, gates: { test: row(10), docs: row(4, 1) } };
  const state = (run, baseline, stop) => verdictOf(run, baseline, stop, deps).state;

  eq('no run file is not-run', [state(null, base, {}), verdictOf(null, base, {}, deps).why], ['not-run', 'no recorded gate run']);
  eq('a run with no usable date is not-run', state({ generatedAt: 'yesterday', gates: {} }, base, {}), 'not-run');
  eq('a run with no gates object is not-run', state({ generatedAt: T }, base, {}), 'not-run');
  eq('every baseline gate ran and none breaks it: green', state(full, base, {}), 'green');
  eq('green carries the date, the counts and no reason', (({ at, ran, of, reasons }) => [at, ran, of, reasons])(verdictOf(full, base, {}, deps)), [T, 2, 2, []]);
  eq('a declared skip in the baseline is allowed, so it is not red', state(full, base, { count: 0 }), 'green');
  const failing = { generatedAt: T, gates: { test: Object.assign(row(9), { fail: 1, exit: 1 }), docs: row(4, 1) } };
  eq('a failing check is red', state(failing, base, {}), 'red');
  eq('red names the reason the gate runner would', verdictOf(failing, base, {}, deps).reasons, ['test: 1 failing check(s)', 'test: pass 9 < baseline 10']);
  eq('a vanished check is red', state({ generatedAt: T, gates: { test: row(9), docs: row(4, 1) } }, base, {}), 'red');
  eq('a skip the baseline never declared is red', state({ generatedAt: T, gates: { test: row(9, 1), docs: row(4, 1) } }, base, {}), 'red');
  const many = { generatedAt: T, gates: {} };
  for (let i = 0; i < 8; i++) many.gates['g' + i] = Object.assign(row(0), { fail: 1, exit: 1 });
  eq('red keeps the count and caps the list', [verdictOf(many, { gates: {} }, {}, deps).reasons.length, verdictOf(many, { gates: {} }, {}, deps).why], [REASONS_MAX, '8 violations against the baseline']);
  const partial = { generatedAt: T, gates: { docs: row(4, 1) } };
  eq('a run of some gates is not-run, never green', [state(partial, base, {}), verdictOf(partial, base, {}, deps).why], ['not-run', 'the run covered 1 of 2 gates']);
  eq('a partial run with a failing gate is red', state({ generatedAt: T, gates: { docs: Object.assign(row(3, 1), { fail: 1, exit: 1 }) } }, base, {}), 'red');
  eq('no baseline is not-run', [state(full, null, {}), verdictOf(full, null, {}, deps).why], ['not-run', 'no baseline to hold the run to']);
  const stale = verdictOf(full, base, { count: 2, newest: 'docs/x.md' }, deps);
  eq('a file newer than the run is stale', [stale.state, stale.changed, stale.newest, stale.why], ['stale', 2, 'docs/x.md', '2 gate-relevant files changed after the run']);
  eq('stale outranks red: the run no longer describes the tree', state(failing, base, { count: 1, newest: 'a' }), 'stale');
  eq('one changed file is singular', verdictOf(full, base, { count: 1, newest: 'a' }, deps).why, '1 gate-relevant file changed after the run');
  eq('the command carries the skips the baseline declares, as an argv list',
    verdictOf(full, base, {}, deps).argv, ['node', 'scripts/harness/gates.js', '--check', '--allow-skip', 'docs=1']);
  eq('with no baseline the command carries no flags', verdictOf(null, null, {}, deps).argv, ['node', 'scripts/harness/gates.js', '--check']);

  /* The tracks, on the real frontmatter and handoff readers. */
  const tdeps = { parseFrontmatter: cp.parseFrontmatter, noteSummary: worktree().noteSummary };
  const README = (status, kind) => '---\nid: x\nkind: ' + (kind || 'track') + '\nstatus: ' + status + '\n---\n# T\n';
  const HANDOFF = (n) => '---\nid: x-handoff\nkind: handoff\nphase_next: ' + n + '\n---\n\n## NEXT\n\n```\nPHASE ' + n + ': do the thing\nmore\n```\n';
  const disk = (files) => ({
    list: (dir) => Array.from(new Set(Object.keys(files).filter((p) => p.startsWith(dir + '/')).map((p) => p.slice(dir.length + 1).split('/')[0]))),
    read: (rel) => (Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null),
  });
  eq('an open track is listed with its next phase and the first line of its block',
    tracksOf('docs/tracks', disk({ 'docs/tracks/b/README.md': README('open'), 'docs/tracks/b/handoff.md': HANDOFF(3) }), tdeps),
    [{ id: 'b', phaseNext: 3, doing: 'PHASE 3: do the thing', handoff: true }]);
  eq('tracks come out in name order, closed ones left out',
    tracksOf('docs/tracks', disk({
      'docs/tracks/z/README.md': README('open'), 'docs/tracks/a/README.md': README('open'), 'docs/tracks/m/README.md': README('closed'),
    }), tdeps).map((t) => t.id), ['a', 'z']);
  eq('an open track with no handoff says so', tracksOf('docs/tracks', disk({ 'docs/tracks/a/README.md': README('open') }), tdeps),
    [{ id: 'a', phaseNext: null, doing: null, handoff: false }]);
  eq('a folder with no README is not a track', tracksOf('docs/tracks', disk({ 'docs/tracks/a/handoff.md': HANDOFF(1) }), tdeps), []);
  eq('a README that is not a track is not a track', tracksOf('docs/tracks', disk({ 'docs/tracks/a/README.md': README('open', 'plan') }), tdeps), []);
  eq('a README with no frontmatter is not a track', tracksOf('docs/tracks', disk({ 'docs/tracks/a/README.md': '# T\n' }), tdeps), []);
  eq('a next phase that is not a whole number is null',
    tracksOf('docs/tracks', disk({ 'docs/tracks/a/README.md': README('open'), 'docs/tracks/a/handoff.md': HANDOFF('soon') }), tdeps)[0].phaseNext, null);
  eq('no track folder at all is an empty list', tracksOf('docs/tracks', disk({}), tdeps), []);

  /* The findings, through the hook entry's own runReport. */
  const rr = hook().runReport;
  const ev = { event: 'session-start', action: 'other' };
  const says = (name, context) => ({ name, decide: () => ({ deny: false, reason: '', context }) });
  eq('a silent reporter is no finding', findingsOf([says('quiet', '')], rr, ev, {}), []);
  eq('a reporter\'s first line is its finding, without the banner stars',
    findingsOf([says('drift', '*** HARNESS DRIFT: branch a vs main ***\nmore\n')], rr, ev, {}), [{ name: 'drift', line: 'HARNESS DRIFT: branch a vs main' }]);
  eq('findings keep the reporters\' order', findingsOf([says('a', 'one'), says('q', ''), says('b', '\n\ntwo')], rr, ev, {}).map((x) => x.name + '=' + x.line), ['a=one', 'b=two']);
  const threw = findingsOf([{ name: 'boom', decide: () => { throw new Error('x'); } }], rr, ev, {});
  eq('a reporter that threw is a finding, not a clean report', [threw.length, threw[0].name, threw[0].line], [1, 'boom', 'A SESSION-START REPORT DID NOT RUN']);
  eq('a long line is cut to the panel\'s width', findingsOf([says('long', 'x'.repeat(300))], rr, ev, {})[0].line.length, LINE_MAX);
  eq('no handler list is no finding', findingsOf(undefined, rr, ev, {}), []);

  for (const x of f) console.log('  x ' + x);
  console.log(f.length ? 'FAIL — panel.js self-test: ' + f.length + ' assertion(s)' : 'PASS — panel.js self-test (' + CHECKS + ' checks: verdict, tracks, findings)');
  return f.length ? 1 : 0;
}

/* ---------- main ---------- */

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return process.exit(selfTest());
  const i = argv.indexOf('--tool');
  const tool = i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : DEFAULT_TOOL;
  let out;
  let code = 0;
  try { out = facts(tool); } catch (e) {
    out = { error: clip(String((e && e.message) || e).split('\n')[0]) };
    code = 1;
  }
  process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(code));
}

module.exports = { verdictOf, tracksOf, findingsOf, facts, LINE_MAX, REASONS_MAX, DEFAULT_TOOL };

if (require.main === module) main();
