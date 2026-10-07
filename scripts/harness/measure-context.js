'use strict';
/* ============================================================
   measure-context.js — what the harness costs a session BEFORE any work,
   measured from files and hook output (tokens ≈ bytes/4), and graded against
   HAND-WRITTEN ceilings that no script ever rewrites.

   WHY THIS EXISTS
   Always-on context is the one cost nobody is billed for and everybody pays.
   An injected instruction file grows a paragraph at a time, each paragraph
   justified on its own, and the total only ever surfaces as "the model seems
   to have less room than it used to". This script turns that into a graded
   figure: a number per file, a declared ceiling per file, and a gate that reds
   when a ceiling is crossed. The budget is a FIGURE in a review diff rather
   than a feeling in a retrospective.

   THE BUCKETS
     injected        loaded into EVERY session (and every subagent): the
                     policy files of the ENABLED tools, read off the tool
                     registry (scripts/harness/tools.json) — for a tool that
                     reaches the policy through an import stub, the stub AND
                     the file it imports — plus the user's global file and
                     auto-memory.
     nestedOnTouch   subtree instruction files: a file of the same NAME as an
                     injected one, anywhere below the root. They load only
                     when a file under that subtree is touched, so
                     `startupTokens` takes the LARGEST ONE — a task touches a
                     subtree, not all of them — and the sum is reported
                     beside it.
     policyReads     what a LEAD opens to orient itself before it knows the
                     task: the routing doc, and any root-level doc the doc
                     contract caps that no tool injects (see `policyFiles`
                     below). Nothing injects these; a leaf never pays for them.
     listing         the skill / command / agent names and descriptions the
                     system prompt enumerates. MEASURED, PRINTED, NOT GRADED.
     hookStdout      what SessionStart and UserPromptSubmit hooks print into
                     the context window.
     subagentInjected  the subset every subagent also receives.
     onDemand        measured and PRINTED and deliberately NOT charged to the
                     startup budget — a file the session opens only if the task
                     needs it. The generated doc index is the canonical case;
                     see the long note at that bucket.

   THE TWO FILES BESIDE THIS ONE, AND WHY THEY ARE TWO
     harness-baseline.json   the REPORT. An ordinary run rewrites it in full.
     context-budget.json     the CEILINGS. No script writes it, ever.
   That split is the whole mechanism. A ceiling stored in a file an ordinary
   command rewrites is a ceiling anybody lifts by running the routine command —
   no deliberate re-baseline, no refusal, no re-baseline commit subject. These
   ceilings move only when a human edits the budget file, in the SAME commit as
   the growth, so the always-on cost lands in that commit's diff.

   --check IS THE `context` GATE
   It re-measures, grades against the budget file WITHOUT WRITING ANYTHING,
   prints its detail above a `GATE context pass= fail= skipped=` verdict line,
   and exits 1 only when fail>0. SIX checks, always six, in every state
   including the no-fixture state: one per graded bucket plus shape, coverage
   and aggregate. The count is structural — a function of neither the tree nor
   the fixture — because the gate runner reds on a falling total
   (pass-by-absence), and a count that moved when a subtree instruction file was
   deleted would red the whole suite for the one action this gate exists to
   encourage.
   It grades only rows the repo itself determines AND git tracks: a row under
   `~/` is the user's own config and drifts per box, and an untracked file
   inside a walked directory has no diff behind it to fix. It skips the hook
   run and the transcript read for the same reason — both are properties of the
   machine, not of the tree. What it does NOT grade, it prints as an ungraded
   note: the listings, the gap to the measured first turn, and every untracked
   row it walked past.

   Zero dependencies, Node built-ins only. Everything project-specific comes
   from harness.config.json via config.js; this file requires nothing from the
   repo it measures.

   Run:  node scripts/harness/measure-context.js
         node scripts/harness/measure-context.js --check
         node scripts/harness/measure-context.js --harness-only --no-hooks
         node scripts/harness/measure-context.js --assert-budget 6000
         node scripts/harness/measure-context.js --self-test
   Flags: [--check] [--harness-only] [--no-hooks] [--json] [--self-test]
          [--assert-budget <tok>] [--budget <file>] [--out <file>]
          [--transcript <id|path>]
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, ROOT, resolve, fatal, DEFAULTS, routingDoc, CONFIG_NAME } = require('./config.js');
const TOOLS = require('./tools.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CHECK = args.includes('--check');
const HARNESS_ONLY = args.includes('--harness-only');
const OUT = opt('--out', path.join(__dirname, 'harness-baseline.json'));

const tok = (b) => Math.round(b / 4);
/* Bytes as the REPO holds the file, not as this checkout happens to spell its line endings: a
   CRLF pair counts as the one byte git stores for it. Measuring the raw size made the verdict a
   property of the machine. The same commit weighs one byte per line more on a checkout that
   converts line endings (the default on one major platform, wherever no .gitattributes pins the
   convention), so a file inside its ceiling in CI could be over it on a laptop, with no diff
   behind the difference — the red this gate promises never to raise. Every other reader of a
   tracked file here already normalises (the skill digests, the branch comparison, the doc
   linter's line counts); the one that grades BYTES was the one that did not.
   Measured on the buffer, never on a decoded string: an instruction file is not always ASCII,
   and a byte budget measured in characters would be a different budget. */
const lfLength = (buf) => {
  let pairs = 0;
  for (let i = buf.indexOf('\r\n'); i !== -1; i = buf.indexOf('\r\n', i + 2)) pairs++;
  return buf.length - pairs;
};
const size = (f) => { try { return fs.statSync(f).isFile() ? lfLength(fs.readFileSync(f)) : 0; } catch { return 0; } };
const slash = (p) => String(p).split(path.sep).join('/');
/* A path inside the repo prints relative, because that is what a reader can open. One OUTSIDE it
   prints absolute: `--out` and `--budget` take arbitrary paths, and a relative path that climbs out
   of the tree with a row of `..` segments is harder to read than the real one, not easier. */
const rel = (f) => {
  const r = slash(path.relative(ROOT, f));
  return !r ? String(f) : r.startsWith('../') ? slash(path.resolve(f)) : r;
};
const sum = (a, k = 'bytes') => a.reduce((s, x) => s + (x[k] || 0), 0);
/* What a hook row is CALLED in the report: the script and its flags, which is the part that tells
   two rows apart. The first sixty characters of the wired command were nearly all prefix (`node`,
   the quoted project-directory variable, the helper path) and cut the flag off mid-word, so two
   modes of one helper printed as the same row in the figure of record. */
const hookLabel = (command) => String(command)
  .replace(/"?\$\{?CLAUDE_PROJECT_DIR(?::-[^}]*)?\}?[\\/]/g, '')
  .replace(/"/g, '')
  .slice(0, 80);

/* ── the check decision, kept pure so --self-test can drive it ──────────────
   Everything down to selfTest() is a function of its arguments and touches no
   disk and no clock. That is deliberate: the grader is the part that must be
   right about shrinking rows, deleted files, untracked files and an empty git
   index, and none of those states are reachable by running the real script in
   the repo it lives in. The literals live in --self-test; the disk-reading half
   is driven by the test suite as a real process. */

// The buckets that name FILES. `listing`, `hookStdout` and `groundTruth` are properties of the
// MACHINE (which plugins are enabled, what a hook printed, which transcript was newest), so a
// check that graded them would be red on every box but the one that wrote the fixture.
//
// `onDemand` is excluded on purpose and the reasoning is the most argued-over line in this file.
// It holds the GENERATED doc index: its size moves whenever any doc is added or removed, in the
// growth direction, with no author intending it. Measured once on a real tree: two new files under
// an exempt docs directory moved the index by a few hundred bytes and exited 1 — a red with a
// correct diff behind it and nothing anyone did wrong. It is also excluded from `startupTokens`
// (nothing injects it; the lead OPENS it), so grading it defended a figure it is not part of. A
// ceiling does not rescue it, because index growth IS the failing direction — only dropping the
// bucket works. It stays measured and stays printed, and the exclusion is DRIVEN, not asserted:
// the self-test inflates every onDemand row ×10 and pins the aggregate figure unmoved, because a
// bucket-list exclusion is one edit away from a silent undo.
const GRADED_BUCKETS = ['injected', 'nestedOnTouch', 'policyReads'];
/** The two ways a graded bucket enters the aggregate, named ONCE each. Written out twice — once in
 *  the measurement, once in the derivation — they were two visually identical literals a few lines
 *  apart, and "make these two consistent" is an ordinary edit that silently widens what the
 *  aggregate sums. `nestedOnTouch` contributes its LARGEST DIRECTORY, not its sum, mirroring the
 *  measurement: a task touches one subtree, not all of them. A directory and not a row, because
 *  one touch can load two files: a tool that reaches the policy through a stub holds the stub AND
 *  the file it imports, exactly as it does at the root. The self-test pins these against
 *  GRADED_BUCKETS from both ends, so a bucket cannot be graded and left out of the aggregate, and
 *  cannot enter the aggregate without being graded. */
const SUMMED_BUCKETS = ['injected', 'policyReads'];
const WORST_BUCKET = 'nestedOnTouch';
const dirOf = (f) => { const s = String(f).replace(/\\/g, '/'); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); };
/** The cost of the worst single touch: `pairs` is [file, tokens] per row, the answer is the
 *  largest per-DIRECTORY sum. Charging the largest single row instead left the stub beside a
 *  subtree policy file out of the total, though both load together. */
function worstDirTokens(pairs) {
  const by = new Map();
  for (const [f, t] of pairs) by.set(dirOf(f), (by.get(dirOf(f)) || 0) + t);
  return by.size ? Math.max(...by.values()) : 0;
}

/* A comparator against harness-baseline.json lived here in the harness this was ported from, and
   it is GONE rather than left dormant beside its replacement. It compared a fresh measurement
   against the file an ordinary run REWRITES IN FULL, so the ceiling it enforced was one anybody
   could lift by running the routine command. Leaving a wired-up comparator next to the safe one is
   how the wrong one gets called. */

const posInt = (v) => Number.isInteger(v) && v > 0;
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isRepoRow = (r) => !String(r.file).startsWith('~');

/** The graded set is what git TRACKS. The tree walk below excludes directories only by NAME, so it
 *  descends `.claude/`, any worktree directory and any vendored bundle — and an untracked file
 *  inside a walked directory is ordinary: a skill or plugin bundle added by a package command sits
 *  there with no diff and no `git status` entry behind it. Such a bundle shipping its own instruction file
 *  would fail coverage as "carries no ceiling" on a file nobody can see in review, and the only fix
 *  would be typing a ceiling for an untracked file into a tracked fixture. `tracked` is a Set
 *  computed ONCE by the caller so this stays pure; `null` means git could not answer, and then
 *  every repo row is graded — the older behaviour, PRINTED in the output rather than assumed. */
const gradedRows = (report, bucket, tracked) =>
  (report[bucket] || []).filter(isRepoRow).filter((r) => !tracked || tracked.has(String(r.file)));
const untrackedRows = (report, bucket, tracked) =>
  !tracked ? [] : (report[bucket] || []).filter(isRepoRow).filter((r) => !tracked.has(String(r.file)));

/** A file that is PART generated carries two budgets, not one. The live case is the policy doc
 *  whose agent-registry table is rewritten from the agent definitions by the doc-index generator,
 *  at a few hundred bytes per row. One ceiling over the whole file makes the next agent — or one
 *  reworded description — breach a graded row through content no author typed there, which is the
 *  exact class the generated doc index was evicted from the budget for. So the AUTHORED bytes take
 *  the ceiling, and the block takes a per-ROW budget plus a declared `maxRows`. `maxRows` is what
 *  keeps the derived total independent of the tree: without it, adding an agent would move the
 *  derived figure and red the shape check on content no author typed. */
const generatedAllowance = (spec) => spec.baseBytes + spec.bytesPerRow * spec.maxRows;
const genKey = (bucket, file) => bucket + '/' + file;
const genSpec = (budget, bucket, file) => (budget.generated || {})[genKey(bucket, file)] || null;

/** The aggregate ceiling is DERIVED from the per-row ceilings, never typed. Typing it is how two
 *  budgets in one fixture ended up contradicting each other: a hand-written total sat BELOW the sum
 *  of the per-row ceilings it shipped with, so growing every row to exactly its pre-authorised
 *  ceiling reded the aggregate. Derived, that is arithmetically impossible.
 *  Be precise about which check does what, because it is easy to credit the wrong one: `shape`
 *  holds the both-ends binding — the recorded figure and this derivation must agree, in EITHER
 *  direction — and that is what kills the contradiction. `aggregate` compares the MEASURED figure
 *  against the recorded one; with a derived total it can no longer fail on its own, since every row
 *  passing its ceiling forces measured <= derived, and the one term the measurement can gain that
 *  the derivation lacks is an unbudgeted row — which is what `coverage` reds on. It is kept because
 *  the figure it prints is the one the whole gate is about. */
function derivedTotalTokens(budget) {
  const c = budget.ceilings || {};
  const rowTok = (bucket, file) => {
    const spec = genSpec(budget, bucket, file);
    return tok(c[bucket][file] + (spec ? generatedAllowance(spec) : 0));
  };
  let total = 0;
  for (const b of SUMMED_BUCKETS) {
    for (const f of Object.keys(c[b] || {})) total += rowTok(b, f);
  }
  total += worstDirTokens(Object.keys(c[WORST_BUCKET] || {}).map((f) => [f, rowTok(WORST_BUCKET, f)]));
  return total;
}

/** The repo-owned always-on figure the aggregate grades. NOT `startupTokens`: that also sums the
 *  listings and the hook stdout, which are properties of the box, and the `~/` rows, which are the
 *  user's own config. This is the subset a fixture in this repo can honestly hold a ceiling over,
 *  and the --check output prints the gap between the two rather than letting a green line stand in
 *  for it. */
function repoAlwaysOnTokens(report, tracked) {
  let t = 0;
  for (const b of SUMMED_BUCKETS) t += gradedRows(report, b, tracked).reduce((s, r) => s + tok(r.bytes), 0);
  t += worstDirTokens(gradedRows(report, WORST_BUCKET, tracked).map((r) => [r.file, tok(r.bytes)]));
  return t;
}

/** A typo must not silently empty the graded set, and the two budgets must not disagree. Every
 *  message names the exact fixture path that is wrong, because the reader is looking at a JSON file
 *  and needs to know which line to edit. */
function shapeFails(budget) {
  if (budget === null || budget === undefined) return ['no usable fixture — missing, unreadable, or not valid JSON'];
  if (typeof budget !== 'object' || Array.isArray(budget)) return ['the fixture is not a JSON object'];
  const out = [];
  const c = budget.ceilings;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['`ceilings` is missing or is not an object of bucket -> file -> bytes'];
  for (const b of Object.keys(c)) {
    // A MISSPELLED bucket key is the failure this branch exists for. Ignored, it would empty the
    // graded set for that bucket and print a full green line about files nobody is grading.
    if (!GRADED_BUCKETS.includes(b)) { out.push(`ceilings.${b} is not a graded bucket (${GRADED_BUCKETS.join(', ')})`); continue; }
    const rows = c[b];
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) { out.push(`ceilings.${b} is not an object of file -> bytes`); continue; }
    for (const [f, v] of Object.entries(rows)) if (!posInt(v)) out.push(`ceilings.${b}["${f}"] = ${JSON.stringify(v)} is not a positive integer`);
  }
  const g = budget.generated === undefined ? {} : budget.generated;
  if (!g || typeof g !== 'object' || Array.isArray(g)) out.push('`generated` is not an object of "bucket/file" -> budget');
  else for (const [k, spec] of Object.entries(g)) {
    const b = k.slice(0, k.indexOf('/'));
    const f = k.slice(k.indexOf('/') + 1);
    if (!GRADED_BUCKETS.includes(b) || !f) out.push(`generated["${k}"] is not "<graded bucket>/<file>"`);
    else if (!c[b] || !Object.prototype.hasOwnProperty.call(c[b], f)) out.push(`generated["${k}"] budgets a file that carries no ceiling`);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) { out.push(`generated["${k}"] is not an object`); continue; }
    for (const kk of ['baseBytes', 'bytesPerRow', 'maxRows']) {
      if (!posInt(spec[kk])) out.push(`generated["${k}"].${kk} = ${JSON.stringify(spec[kk])} is not a positive integer`);
    }
    // The markers are optional and default to the registry pair this harness's own generator
    // writes. They are here so the mechanism survives a repo whose generated block is fenced by
    // something else — a present-but-empty marker would silently match at offset 0 and charge the
    // whole file to the block budget, so a non-string is refused rather than defaulted.
    for (const kk of ['beginMarker', 'endMarker']) {
      if (spec[kk] !== undefined && !isStr(spec[kk])) out.push(`generated["${k}"].${kk} must be a non-empty string when present`);
    }
  }
  if (out.length) return out; // deriving over a broken fixture would throw, and a throw has no verdict
  if (!posInt(budget.totalTokenCeiling)) return [`totalTokenCeiling = ${JSON.stringify(budget.totalTokenCeiling)} is not a positive integer`];
  const derived = derivedTotalTokens(budget);
  if (budget.totalTokenCeiling !== derived) {
    out.push(`totalTokenCeiling ${budget.totalTokenCeiling} != ${derived} derived from this fixture's own per-row ceilings — the two budgets must not disagree`);
  }
  return out;
}

/** One graded bucket. A row grades `bytes <= ceiling`; shrinking, deletion and a `~/` row are not
 *  findings, and a row with no ceiling is coverage's business, not this check's. */
function bucketFails(bucket, budget, report, tracked, generatedMeasured) {
  const out = [];
  const ceils = (budget.ceilings || {})[bucket] || {};
  for (const row of gradedRows(report, bucket, tracked)) {
    const file = String(row.file);
    if (!Object.prototype.hasOwnProperty.call(ceils, file)) continue;
    const spec = genSpec(budget, bucket, file);
    if (!spec) {
      if (row.bytes > ceils[file]) out.push(`${bucket}: ${file} ${row.bytes} B > ceiling ${ceils[file]} B (+${row.bytes - ceils[file]})`);
      continue;
    }
    const m = (generatedMeasured || {})[genKey(bucket, file)];
    if (!m || !m.found) {
      out.push(`${bucket}: ${file} carries a generated-block budget and the block markers were not found — the authored/generated split this ceiling depends on is gone`);
      continue;
    }
    const authored = row.bytes - m.bytes;
    if (authored > ceils[file]) out.push(`${bucket}: ${file} authored ${authored} B > ceiling ${ceils[file]} B (+${authored - ceils[file]}; ${m.bytes} B of generated block not charged here)`);
    const allowed = spec.baseBytes + spec.bytesPerRow * m.rows;
    if (m.bytes > allowed) out.push(`${bucket}: ${file} generated block ${m.bytes} B > ${allowed} B (${spec.baseBytes} + ${spec.bytesPerRow} B/row × ${m.rows} rows)`);
    if (m.rows > spec.maxRows) out.push(`${bucket}: ${file} generated block holds ${m.rows} rows > maxRows ${spec.maxRows} — raise it in the fixture, in this commit`);
  }
  return out;
}

/** An always-on file nobody has budgeted must fail rather than pass silently — and a bucket the
 *  fixture budgets that came back EMPTY is the other half of the same property. A collector that
 *  goes blind (the exclusion regex widens, a path breaks, the index is empty) otherwise grades
 *  nothing, breaches nothing, and prints a full green line: coverage that reads as coverage it no
 *  longer has. Tidying a bucket's ceilings away in the same commit that deletes its files clears
 *  it, which is the one legitimate route to an empty bucket. */
function coverageFails(budget, report, tracked) {
  const out = [];
  for (const b of GRADED_BUCKETS) {
    const ceils = (budget.ceilings || {})[b] || {};
    for (const row of gradedRows(report, b, tracked)) {
      if (!Object.prototype.hasOwnProperty.call(ceils, String(row.file))) {
        out.push(`${b}: ${row.file} (${row.bytes} B) is always-on, git tracks it, and it carries no ceiling in the fixture`);
      }
    }
    // Measured over what is actually GRADED, not over the raw measurement. Grading the raw rows
    // was a hole with a driven exploit: `git ls-files` can succeed and return NOTHING (a fresh
    // `git init` before the first commit, a rebuilt index, a tree vendored inside a parent repo
    // that ignores it), and then every row is filtered out as untracked while the raw arrays stay
    // full — six passes, exit 0, and a few hundred thousand tokens of always-on context graded as
    // nothing at all. The partial case is the same defect and needs no exotic git state: the
    // single-file buckets hold one file each, so ONE file falling out of the index silently
    // disables a whole bucket.
    const n = Object.keys(ceils).length;
    if (n && !gradedRows(report, b, tracked).length) {
      out.push(`${b}: the fixture holds ${n} ceiling(s) and NOTHING in this bucket was graded — the collector is blind, the index is empty, or a deletion left the fixture untidied`);
    }
  }
  return out;
}

function aggregateFails(budget, report, tracked) {
  const have = repoAlwaysOnTokens(report, tracked);
  return have > budget.totalTokenCeiling
    ? [`repo-owned always-on ${have} tok > totalTokenCeiling ${budget.totalTokenCeiling} tok — growth spread too thinly to breach any single row`]
    : [];
}

/** SIX checks, always six, in every state including the no-fixture state. One per graded bucket
 *  plus shape, coverage and aggregate — structural, so the count is a function of NEITHER the tree
 *  NOR the fixture. Per-row or per-fixture-entry counting was the alternative and it is a trap: the
 *  gate runner reds on `pass+fail+skipped < baseline total` (pass-by-absence), so a count that
 *  falls when a subtree instruction file is deleted, or when a dead fixture entry is tidied away, reds the
 *  whole suite for the one action this gate exists to encourage. A missing, unparseable or
 *  mis-shaped fixture returns six FAILS rather than a collapsed total: `pass=0 fail=1` against a
 *  baseline of six would print "a check DISAPPEARED" about a fixture problem, and a diagnostic that
 *  misdiagnoses its own commonest failure is worse than none. */
function contextChecks(budget, report, tracked, generatedMeasured) {
  const shape = shapeFails(budget);
  if (shape.length) {
    const dead = ['not graded — the fixture is unusable'];
    return [{ name: 'shape', fails: shape }]
      .concat(['injected', 'nestedOnTouch', 'policyReads', 'coverage', 'aggregate'].map((name) => ({ name, fails: dead })));
  }
  return [
    { name: 'shape', fails: [] },
    { name: 'injected', fails: bucketFails('injected', budget, report, tracked, generatedMeasured) },
    { name: 'nestedOnTouch', fails: bucketFails('nestedOnTouch', budget, report, tracked, generatedMeasured) },
    { name: 'policyReads', fails: bucketFails('policyReads', budget, report, tracked, generatedMeasured) },
    { name: 'coverage', fails: coverageFails(budget, report, tracked) },
    { name: 'aggregate', fails: aggregateFails(budget, report, tracked) },
  ];
}
const verdict = (checks) => ({ pass: checks.filter((c) => !c.fails.length).length, fail: checks.filter((c) => c.fails.length).length });

/* ── --self-test ────────────────────────────────────────────────────────────
   Drives the REAL grader with literals. A report is what this script builds; a
   fixture is what a human writes; `tracked` is what git answered; `gm` is the
   generated-block measurement. Nothing here asserts a spelling, and every
   figure is invented — the only disk read is the committed fixture, which is
   checked for agreeing with itself. */
function selfTest() {
  let CHECKS = 0;
  const f = [];
  const eq = (l, got, want) => { CHECKS++; if (JSON.stringify(got) !== JSON.stringify(want)) f.push(`${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

  const R = (o) => Object.assign({ injected: [], nestedOnTouch: [], policyReads: [], onDemand: [], listing: [], hooks: [] }, o);
  const BASE = () => ({
    ceilings: {
      injected: { 'AGENTS.md': 4096 },
      nestedOnTouch: { 'api/AGENTS.md': 3328, 'worker/AGENTS.md': 3072 },
      policyReads: { 'docs/reference/routing/README.md': 7680 },
    },
    generated: { 'policyReads/docs/reference/routing/README.md': { baseBytes: 256, bytesPerRow: 256, maxRows: 6 } },
  });
  /** A fixture whose recorded total is DERIVED, which is the only shape shapeFails accepts. */
  const fix = (over) => { const b = Object.assign(BASE(), over || {}); b.totalTokenCeiling = derivedTotalTokens(b); return b; };
  const OK = R({
    injected: [{ file: 'AGENTS.md', bytes: 3900 }, { file: '~/.claude/projects/x/memory/MEMORY.md', bytes: 2000 }],
    nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }, { file: 'worker/AGENTS.md', bytes: 2800 }],
    policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    onDemand: [{ file: 'docs/INDEX.md', bytes: 6000 }],
  });
  const TR = new Set(['AGENTS.md', 'api/AGENTS.md', 'worker/AGENTS.md', 'docs/reference/routing/README.md']);
  const GM = { 'policyReads/docs/reference/routing/README.md': { found: true, bytes: 900, rows: 4 } };
  const ck = (b, rep, tracked, gm) => contextChecks(
    b === undefined ? fix() : b,
    rep === undefined ? OK : rep,
    tracked === undefined ? TR : tracked,
    gm === undefined ? GM : gm);
  const named = (checks, n) => checks.find((c) => c.name === n).fails;

  eq('a clean measurement is six checks and no fails', verdict(ck()), { pass: 6, fail: 0 });

  /* ONE TOUCH, ONE DIRECTORY. The worst case is the largest directory's files together, not the
     largest file: a stub and the policy file it imports load as a pair. */
  eq('worst touch: no subtree file is zero', worstDirTokens([]), 0);
  eq('worst touch: lone files, the largest wins', worstDirTokens([['api/AGENTS.md', 750], ['worker/AGENTS.md', 700]]), 750);
  eq('worst touch: a stub beside a policy file is charged WITH it', worstDirTokens([['api/AGENTS.md', 750], ['api/CLAUDE.md', 40], ['worker/AGENTS.md', 760]]), 790);
  eq('worst touch: a deeper directory is its own touch', worstDirTokens([['a/AGENTS.md', 10], ['a/b/AGENTS.md', 20], ['a/b/CLAUDE.md', 5]]), 25);
  {
    const paired = fix({ ceilings: Object.assign({}, BASE().ceilings, { nestedOnTouch: { 'api/AGENTS.md': 3328, 'api/CLAUDE.md': 256, 'worker/AGENTS.md': 3072 } }) });
    eq('the derived ceiling charges the pair', paired.totalTokenCeiling - fix().totalTokenCeiling, tok(256));
    const rep = Object.assign({}, OK, { nestedOnTouch: OK.nestedOnTouch.concat([{ file: 'api/CLAUDE.md', bytes: 160 }]) });
    eq('...and so does the measured figure', repoAlwaysOnTokens(rep, null) - repoAlwaysOnTokens(OK, null), tok(160));
  }

  /* LINE ENDINGS. What is graded has to be a property of the tree, not of how this checkout
     spells a newline: the same commit must weigh the same on every machine. */
  eq('a CRLF pair counts as the one byte git stores', lfLength(Buffer.from('a\r\nb\r\n')), 4);
  eq('...so a CRLF checkout weighs what the LF one does', lfLength(Buffer.from('a\r\nb\r\n')), lfLength(Buffer.from('a\nb\n')));
  eq('a lone CR is content, not a line ending', lfLength(Buffer.from('a\rb\n')), 4);
  eq('a CR CR LF run loses exactly one byte', lfLength(Buffer.from('a\r\r\n')), 3);
  eq('text that is not ASCII is measured in BYTES, not characters', lfLength(Buffer.from('é\r\n', 'utf8')), 3);
  eq('an empty file is zero', lfLength(Buffer.alloc(0)), 0);

  /* A HOOK ROW'S NAME. Two modes of one helper must not print as one row. */
  eq('a hook row is named by its script and its flags',
    hookLabel('node "$CLAUDE_PROJECT_DIR/scripts/harness/guards/docs-lint.cjs" --memory-check'), 'node scripts/harness/guards/docs-lint.cjs --memory-check');
  eq('...whichever way the project directory is spelled',
    hookLabel('node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/statusline.cjs"'), 'node .claude/helpers/statusline.cjs');
  eq('...so two modes of one helper are two different rows',
    hookLabel('node "$CLAUDE_PROJECT_DIR/scripts/harness/guards/x.cjs" --hook') === hookLabel('node "$CLAUDE_PROJECT_DIR/scripts/harness/guards/x.cjs" --gate'), false);

  /* COUNT STABILITY. The gate runner reds on `pass+fail+skipped < baseline total`, so a count that
     moves with the tree or with the fixture trips pass-by-absence for a reason nobody caused.
     Three states, all six. */
  eq('COUNT: a clean run is six rows', ck().length, 6);
  eq('COUNT: two breaches and a deleted row is still six rows',
    ck(undefined, R({
      injected: [{ file: 'AGENTS.md', bytes: 99999 }],
      nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 99999 }],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    })).length, 6);
  eq('COUNT: no fixture at all is still six rows', ck(null).length, 6);

  /* A missing / unparseable / mis-shaped fixture is six FAILS, never a collapsed total. */
  eq('no fixture is pass=0 fail=6', verdict(ck(null)), { pass: 0, fail: 6 });
  eq('a fixture that is not an object is pass=0 fail=6', verdict(ck('{"ceilings":')), { pass: 0, fail: 6 });
  eq('a quoted ceiling disables nothing silently', verdict(ck({ ceilings: { injected: { 'AGENTS.md': '4096' } }, totalTokenCeiling: 1024 })), { pass: 0, fail: 6 });
  eq('a zero ceiling is not a ceiling', verdict(ck({ ceilings: { injected: { 'AGENTS.md': 0 } }, totalTokenCeiling: 1 })), { pass: 0, fail: 6 });
  eq('a null ceiling is not a ceiling', verdict(ck({ ceilings: { injected: { 'AGENTS.md': null } }, totalTokenCeiling: 1 })), { pass: 0, fail: 6 });
  eq('an unknown bucket key fails shape', shapeFails({ ceilings: { onDemand: { 'docs/INDEX.md': 9999 } }, totalTokenCeiling: 1 }).length > 0, true);
  eq('a MISSPELLED bucket does not become an empty graded set', shapeFails({ ceilings: { injcted: { 'AGENTS.md': 4096 } }, totalTokenCeiling: 1 }).length > 0, true);
  eq('a generated budget for a file with no ceiling fails shape',
    shapeFails({ ceilings: { injected: { 'AGENTS.md': 4096 } }, generated: { 'injected/nope.md': { baseBytes: 1, bytesPerRow: 1, maxRows: 1 } }, totalTokenCeiling: 1024 }).length > 0, true);
  eq('an empty marker override is refused rather than matched at offset 0',
    shapeFails(Object.assign(BASE(), {
      generated: { 'policyReads/docs/reference/routing/README.md': { baseBytes: 256, bytesPerRow: 256, maxRows: 6, beginMarker: '' } },
      totalTokenCeiling: 1,
    })).some((m) => /beginMarker must be a non-empty string/.test(m)), true);

  /* CEILING, not equality. The four cases a byte-equality comparator gets wrong. */
  eq('a row exactly AT its ceiling passes',
    named(ck(undefined, R({ injected: [{ file: 'AGENTS.md', bytes: 4096 }] })), 'injected'), []);
  eq('one byte over fails, and the message carries both figures',
    named(ck(undefined, R({ injected: [{ file: 'AGENTS.md', bytes: 4097 }] })), 'injected'),
    ['injected: AGENTS.md 4097 B > ceiling 4096 B (+1)']);
  eq('a row that SHRANK passes, because this is a ceiling and not a record',
    named(ck(undefined, R({ injected: [{ file: 'AGENTS.md', bytes: 12 }] })), 'injected'), []);
  eq('a graded file GONE from the tree is not a finding',
    verdict(ck(undefined, R({
      injected: [{ file: 'AGENTS.md', bytes: 3900 }],
      nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    }))), { pass: 6, fail: 0 });
  eq('a ~/ row that exploded is neither graded nor demanded a ceiling',
    verdict(ck(undefined, R({
      injected: [{ file: 'AGENTS.md', bytes: 3900 }, { file: '~/.claude/CLAUDE.md', bytes: 999999 }],
      nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    }))), { pass: 6, fail: 0 });

  /* THE UNTRACKED-FILE SCAR. A vendored bundle shipping an AGENTS.md lands inside a walked directory
     with no diff behind it; it must not be gradeable and must not be demanded. */
  const VENDORED = R({
    injected: [{ file: 'AGENTS.md', bytes: 3900 }],
    nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }, { file: '.claude/skills/vendored/AGENTS.md', bytes: 9999 }],
    policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
  });
  eq('an UNTRACKED always-on file is neither graded nor demanded', verdict(ck(undefined, VENDORED)), { pass: 6, fail: 0 });
  eq('...and it is reported as untracked rather than hidden',
    untrackedRows(VENDORED, 'nestedOnTouch', TR).map((r) => r.file), ['.claude/skills/vendored/AGENTS.md']);
  eq('with no git answer, every repo row is graded again — the fallback is loud, not silent',
    named(ck(undefined, VENDORED, null), 'coverage').length, 1);

  /* COVERAGE: an unmeasured always-on file fails rather than passing silently. */
  eq('a tracked file with no ceiling fails coverage, and names it',
    named(ck(undefined, R({
      injected: [{ file: 'AGENTS.md', bytes: 3900 }, { file: 'NEW.md', bytes: 2000 }],
      nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    }), new Set([...TR, 'NEW.md'])), 'coverage'),
    ['injected: NEW.md (2000 B) is always-on, git tracks it, and it carries no ceiling in the fixture']);
  eq('a bucket the fixture budgets that came back EMPTY fails — a blind collector must not read as coverage',
    named(ck(undefined, R({
      injected: [{ file: 'AGENTS.md', bytes: 3900 }],
      nestedOnTouch: [],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    })), 'coverage').length, 1);
  /* THE EMPTY INDEX. `git ls-files` can SUCCEED and return nothing — a fresh `git init` before the
     first commit, a rebuilt index, a tree vendored inside a parent repo that ignores it. Before
     this was pinned the blindness guard measured the raw rows instead of the graded ones, and the
     result was six green checks and exit 0 over a tree where nothing was graded at all. The partial
     case needs no exotic git state: the single-file buckets hold one file each, so ONE file out of
     the index disables a whole bucket. */
  eq('an EMPTY git index reds coverage instead of grading nothing greenly',
    verdict(ck(undefined, OK, new Set())), { pass: 5, fail: 1 });
  eq('...and it names every bucket that graded nothing', named(ck(undefined, OK, new Set()), 'coverage').length, 3);
  eq('ONE file out of the index disables a single-file bucket, and that reds too',
    named(ck(undefined, OK, new Set(['api/AGENTS.md', 'worker/AGENTS.md', 'docs/reference/routing/README.md'])), 'coverage').length, 1);
  eq('...and tidying that bucket\'s ceilings away in the same commit clears it, still six checks',
    verdict(ck(fix({ ceilings: { injected: { 'AGENTS.md': 4096 }, policyReads: { 'docs/reference/routing/README.md': 7680 } } }), R({
      injected: [{ file: 'AGENTS.md', bytes: 3900 }],
      nestedOnTouch: [],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    }))), { pass: 6, fail: 0 });

  /* THE PART-GENERATED FILE. The registry block is written by the doc-index generator at a few
     hundred bytes a row, so the next row must be free and a bloated row must not be. */
  eq('a FIFTH registry row is free — the block budget is per row',
    named(ck(undefined, undefined, undefined, { 'policyReads/docs/reference/routing/README.md': { found: true, bytes: 1150, rows: 5 } }), 'policyReads'), []);
  eq('a bloated block fails against base + per-row × rows',
    named(ck(undefined, undefined, undefined, { 'policyReads/docs/reference/routing/README.md': { found: true, bytes: 1600, rows: 4 } }), 'policyReads'),
    ['policyReads: docs/reference/routing/README.md generated block 1600 B > 1280 B (256 + 256 B/row × 4 rows)']);
  eq('more rows than maxRows fails on its own, and names the number to raise',
    named(ck(undefined, undefined, undefined, { 'policyReads/docs/reference/routing/README.md': { found: true, bytes: 1800, rows: 7 } }), 'policyReads'),
    ['policyReads: docs/reference/routing/README.md generated block holds 7 rows > maxRows 6 — raise it in the fixture, in this commit']);
  eq('markers gone is a finding, not a silent whole-file grading',
    named(ck(undefined, undefined, undefined, { 'policyReads/docs/reference/routing/README.md': { found: false, bytes: 0, rows: 0 } }), 'policyReads').length, 1);
  eq('authored growth past the ceiling fails, and the block is not charged to it',
    named(ck(undefined, R({
      injected: [{ file: 'AGENTS.md', bytes: 3900 }],
      nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }],
      policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8581 }],
    })), 'policyReads'),
    ['policyReads: docs/reference/routing/README.md authored 7681 B > ceiling 7680 B (+1; 900 B of generated block not charged here)']);

  /* THE TWO BUDGETS CANNOT DISAGREE. A hand-typed total that sat below the sum of the per-row
     ceilings it shipped with meant growing every row to its pre-authorised ceiling reded the
     aggregate. Derived, that is impossible; this pins the derivation from both ends. */
  const derived = derivedTotalTokens(BASE());
  eq('the recorded total must equal the derived one', shapeFails(Object.assign(BASE(), { totalTokenCeiling: derived })), []);
  eq('a total 80 tokens BELOW its own per-row ceilings fails shape',
    shapeFails(Object.assign(BASE(), { totalTokenCeiling: derived - 80 })).length, 1);
  eq('a total ABOVE its own per-row ceilings fails shape too — slack is not smuggled in here',
    shapeFails(Object.assign(BASE(), { totalTokenCeiling: derived + 1 })).length, 1);
  eq('the aggregate fires on growth spread too thinly to breach any single row',
    aggregateFails({ totalTokenCeiling: 4400 }, R({ injected: [{ file: 'AGENTS.md', bytes: 18000 }] }), new Set(['AGENTS.md'])).length, 1);

  /* DRIVEN IMMUNITY. The exclusions are executed, not asserted: inflate every ungraded bucket and
     pin the verdict AND the aggregate figure unmoved. A bucket-list exclusion is one edit from a
     silent undo, and a negative nobody runs is a negative nobody notices breaking.
     ⚠ These probes pass `tracked` as NULL on purpose, so NOTHING is filtered out and the BUCKET
     LIST is the only thing that can decide the answer. With a tracked Set they are vacuous: the
     set holds no onDemand file, so gradedRows() drops the inflated row before the bucket list is
     ever consulted, and adding `onDemand` to the summed buckets leaves every assertion green — a
     negative that cannot fail the one mutation it exists to catch. */
  eq('the aggregate sums exactly the graded buckets — none enters it unnamed, none is graded and unsummed',
    SUMMED_BUCKETS.concat(WORST_BUCKET).slice().sort(), GRADED_BUCKETS.slice().sort());
  const inflate = (rep, bucket) => Object.assign({}, rep, { [bucket]: (rep[bucket] || []).map((r) => Object.assign({}, r, { bytes: r.bytes * 10 })) });
  eq('onDemand ×10 does not move the aggregate figure',
    repoAlwaysOnTokens(inflate(OK, 'onDemand'), null), repoAlwaysOnTokens(OK, null));
  eq('onDemand ×10 does not move the verdict', verdict(ck(undefined, inflate(OK, 'onDemand'), null)), { pass: 6, fail: 0 });
  const docCommit = (bytes) => JSON.stringify(ck(undefined, R({
    injected: [{ file: 'AGENTS.md', bytes: 3900 }],
    nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }],
    policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    onDemand: [{ file: 'docs/INDEX.md', bytes }],
  })));
  eq('a doc commit that grows the generated index is a non-event: it grades identically',
    docCommit(6000), docCommit(6344));
  eq('the SAME +344 B in a graded bucket IS a finding — the exclusion is about the bucket, not the size',
    named(ck(undefined, R({ injected: [{ file: 'AGENTS.md', bytes: 4096 + 344 }] })), 'injected').length, 1);
  const WITH_LISTING = R({
    injected: [{ file: 'AGENTS.md', bytes: 3900 }],
    nestedOnTouch: [{ file: 'api/AGENTS.md', bytes: 3000 }],
    policyReads: [{ file: 'docs/reference/routing/README.md', bytes: 8000 }],
    listing: [{ set: '.claude/skills (repo)', bytes: 2500 }],
  });
  eq('listing ×10 does not move the aggregate figure either',
    repoAlwaysOnTokens(inflate(WITH_LISTING, 'listing'), null), repoAlwaysOnTokens(WITH_LISTING, null));
  eq('listing ×10 does not move the verdict', verdict(ck(undefined, inflate(WITH_LISTING, 'listing'), null)), { pass: 6, fail: 0 });

  /* THE COMMITTED FIXTURE. The one disk read in here, and the one assertion that is about THIS
     repo: the ceilings people actually ship must agree with themselves. A fixture whose recorded
     total has drifted from its own per-row ceilings reds all six checks on the next run, so it is
     worth knowing at self-test time, with the disagreement printed rather than described. */
  const cfg = load({ soft: true });
  const budgetPath = path.isAbsolute(opt('--budget', ''))
    ? opt('--budget', '')
    : resolve(opt('--budget', (cfg && cfg.context.budgetFile) || DEFAULTS.context.budgetFile));
  let committed = null;
  try { committed = JSON.parse(fs.readFileSync(budgetPath, 'utf8')); } catch (e) { f.push(`the committed fixture ${rel(budgetPath)} is unreadable: ${e.message}`); CHECKS++; }
  if (committed) {
    eq('the committed fixture is well-shaped, and its recorded total is its own derived one', shapeFails(committed), []);
    if (committed.ceilings && !Array.isArray(committed.ceilings)) {
      let d = null;
      try { d = derivedTotalTokens(committed); } catch { d = null; }
      if (d !== null) {
        console.log(`  fixture ${rel(budgetPath)}: recorded totalTokenCeiling ${committed.totalTokenCeiling} · derived from its own per-row ceilings ${d}`
          + (committed.totalTokenCeiling === d ? ' — agree' : ' — DISAGREE, fix the recorded figure'));
      }
    }
    if (committed.placeholder === true) {
      console.log(`  note: ${rel(budgetPath)} is marked placeholder — its ceilings have NOT been measured against this tree`);
    }
  }

  for (const x of f) console.log('  x ' + x);
  console.log(f.length ? `FAIL — measure-context self-test: ${f.length} assertion(s)`
    : `PASS — measure-context.js self-test (${CHECKS} checks)`);
  process.exit(f.length ? 1 : 0);
}
if (args.includes('--self-test')) selfTest();

/* ── the measurement ────────────────────────────────────────────────────────
   Everything below reads the disk. The file LISTS come from the config and from
   the tree, never from a literal list of this repo's subdirectories — that
   coupling is what made the harness this was ported from one repo's harness. */

const cfg = (() => { try { return load(); } catch (e) { return fatal(e.message, e.fix); } })();
const HOME = process.env.USERPROFILE || process.env.HOME || null;
/* The agent runtime keeps per-project state under a directory named after the project's absolute
   path with EVERY character that is not a letter or a digit flattened to a dash: the separators
   and the drive colon, and also a dot, an underscore or a space in a folder name. Derived from
   ROOT, so it follows the repo instead of naming one, and absent HOME degrades to "no host rows"
   rather than throwing.
   ⚠ This once flattened only the separators and the colon, which is the rule as it LOOKS from a
   checkout whose path has nothing else in it. On any other path (`my.app`, `code_v2`, a temp
   directory with an underscore in it) it named a directory the runtime never wrote, so the
   auto-memory row measured 0 bytes and the ground truth read no transcript, both silently — a
   measurement that understates is worse than none, because the low figure is the one that gets
   believed. The doc gate's rule 10 derives the same directory (`projectDirName` in
   scripts/harness/guards/docs-lint.cjs). That file cannot be required from here without running a lint,
   so the rule is written twice and tests/context.test.js drives BOTH scripts against one planted
   index: change one spelling without the other and that test is red. */
const projectDirName = (abs) => String(abs).replace(/[^A-Za-z0-9]/g, '-');
const PROJ = HOME ? path.join(HOME, '.claude', 'projects', projectDirName(ROOT)) : null;
const homePath = (f) => (HOME ? slash(f).replace(slash(HOME), '~') : slash(f));
const mdFiles = (d) => { try { return fs.readdirSync(d).filter((x) => x.endsWith('.md')).map((x) => path.join(d, x)); } catch { return []; } };
const fm = (f, k) => { try { return ((fs.readFileSync(f, 'utf8').match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '').trim(); } catch { return ''; } };

/* Excluded by directory NAME only, and that is a deliberate limit rather than an oversight: the
   walk descends `.claude/` and any vendored bundle, because a bundle that ships its own
   instruction file really is loaded on touch and hiding it would understate the cost. What keeps those files from
   being graded is the git-tracked filter, not this regex — a red with no diff behind it cannot be
   fixed, so it is reported as untracked instead of demanded. */
const SKIP_DIRS = /^(node_modules|\.git|dist|build|coverage|\.next|out)$/;
function walkFind(dir, name, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) walkFind(p, name, out); }
    else if (e.name === name) out.push(p);
  }
  return out;
}

/* 1. injected into every session. WHICH repo files those are is not written here: it is read off
   the tool registry, one policy route per ENABLED tool (`tools.enabled` in the config). A tool
   that loads the policy file natively contributes that file; one that reaches it through an
   import stub contributes the stub AND the file the stub imports, because both are in its
   context. The name used to be a constant in this script, which is how a file every OTHER tool
   injects came to be budgeted as a read only a lead makes.
   The registry is read once and an unreadable one THROWS: under --check the safety net below
   turns that into six fails and a verdict, never into an empty injected set that grades nothing.
   The other two rows are one runtime's own always-on locations, not this project's. `global:
   true` marks what lives in the USER'S config, which no commit in this repo can change — the
   user-run setup steps are what move those rows, so --harness-only drops them. Auto-memory is NOT
   global: the project writes it. */
let REGISTRY = null;
const registry = () => { if (REGISTRY === null) REGISTRY = TOOLS.readRegistry(); return REGISTRY; };
let INJECTED = null;
function injectedNames() {
  if (INJECTED === null) {
    /* An enabled id the registry cannot honour is refused HERE, by name, before anything is
       measured. Left alone it injects nothing, the policy file falls into the lead-only bucket,
       and the gate reds with "nothing graded: the collector is blind", which names the wrong
       file. `tools.js --check` says the same thing, and no gate runs that one yet. */
    const bad = TOOLS.enabledFindings(registry(), cfg.tools.enabled);
    if (bad.length) {
      const e = new Error('`tools.enabled` names a tool the registry cannot wire — ' + bad.join('; '));
      e.fix = 'edit tools.enabled in ' + CONFIG_NAME + ' — `node scripts/harness/tools.js --list` prints the ids ' + TOOLS.REGISTRY_REL + ' has a row for.';
      throw e;
    }
    INJECTED = TOOLS.injectedFiles(registry(), cfg.tools.enabled);
  }
  return INJECTED;
}
const MEMORY_CAP = 25 * 1024; // the loader stops reading auto-memory at its own limit, so measuring past it overstates the cost
function injectedRows() {
  const rows = [];
  if (HOME) rows.push({ file: homePath(path.join(HOME, '.claude', 'CLAUDE.md')), bytes: size(path.join(HOME, '.claude', 'CLAUDE.md')), subagent: true, global: true });
  for (const f of injectedNames()) rows.push({ file: f, bytes: size(resolve(...f.split('/'))), subagent: true });
  if (PROJ) rows.push({ file: homePath(path.join(PROJ, 'memory', 'MEMORY.md')), bytes: Math.min(size(path.join(PROJ, 'memory', 'MEMORY.md')), MEMORY_CAP), subagent: false });
  return HARNESS_ONLY ? rows.filter((r) => !r.global) : rows;
}

/* 2. subtree instruction files, FOUND BY WALKING, so a new subdirectory with its own instructions
   is measured the day it appears and fails coverage until someone budgets it. The names walked for
   are the basenames of the injected set: a subtree's own policy file, and the stub beside it for a
   tool that needs one. Grading all of them in the total would measure a session that does not
   exist; grading none would hide a real cost. Take the largest DIRECTORY, report the sum. */
function nestedRows() {
  const names = [...new Set(injectedNames().map((f) => f.split('/').pop()))];
  const roots = new Set(injectedNames().map((f) => resolve(...f.split('/'))));
  return names.flatMap((n) => walkFind(ROOT, n))
    .filter((f) => !roots.has(f))
    .map((f) => ({ file: rel(f), bytes: size(f), subagent: true }))
    .sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
}

/* 3. what a LEAD reads before it knows the task. Two sources, neither a list of names in here.
   The routing doc, at the one path config.js spells for it: routing, the spawn contract and the
   agent registry are read by the agent that spawns and by nobody else. And every root-level `.md`
   cap key that no enabled tool injects: a cap is exactly the declaration that a file is read often
   enough to be worth a ceiling, so a repo that adds a second policy doc gets it measured by
   writing its cap. A file a tool INJECTS is never here, whatever its name: it is charged above,
   to every agent, which is the correction this bucket's old definition needed. Nor is an import
   STUB, of any row: the default caps carry the default tool's stub, and with that tool switched
   off the stub is a file no enabled tool loads and no lead opens, not a lead-only read. */
function policyFiles() {
  const injected = injectedNames();
  const stubs = TOOLS.stubFiles(registry());
  const capped = Object.keys(cfg.docs.caps).filter((k) => k.endsWith('.md') && !/[\\/]/.test(k));
  return [...new Set(capped.concat([routingDoc(cfg)]))].filter((k) => !injected.includes(k) && !stubs.includes(k)).sort();
}

/* 4. NOT always-on, and this bucket exists to keep it out of the total WITHOUT hiding it. Nothing
   injects the generated doc index. It is a map the lead OPENS when it needs to find a doc —
   exactly like every doc it points at, none of which are charged either. Putting it in the
   always-on tier is the tempting conservative choice and it is wrong: it made the single largest
   harness-owned line a cost the session often never pays. It stays measured and printed, so the
   figure is visible and arguable; it is simply not summed into startupTokens. Before moving it
   back, produce a session that reads it EVERY time. */
function onDemandRows() {
  const f = slash(path.join(cfg.project.docsRoot, 'INDEX.md'));
  return [{ file: f, bytes: size(resolve(f)), openedWhenNeeded: true }];
}

/* 5. listings: the name and description of every skill / command / agent the system prompt
   enumerates. Measured, printed, and NOT graded — see the note the gate prints every run. */
function enabledPluginDirs() {
  // The user settings file is a host file like every other read here, and it is absent on CI and on
  // a fresh box; with no settings there are no enabled plugins to enumerate. GUARDED, and the guard
  // is the point: a half-written or hand-edited settings file threw out of a measurement, and a
  // version cache directory that exists but holds no version directory made the join below
  // `undefined`. Either one killed the whole run, which for a would-be gate is the worst shape of
  // failure — no verdict line at all rather than a verdict. A machine-local file nobody here
  // controls degrades to "no plugins enumerated".
  if (!HOME) return [];
  const cfgFile = path.join(HOME, '.claude', 'settings.json');
  let s;
  try { s = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { return []; }
  const dirs = [];
  for (const [id, on] of Object.entries((s && s.enabledPlugins) || {})) {
    if (!on) continue;
    const [name, market] = id.split('@');
    if (!name || !market) continue;
    const vdir = path.join(HOME, '.claude', 'plugins', 'cache', market, name);
    let versions = [];
    try { versions = fs.readdirSync(vdir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { continue; }
    if (!versions.length) continue;
    dirs.push({ id, dir: path.join(vdir, versions[versions.length - 1]) });
  }
  return dirs;
}
// name + frontmatter name + description, plus a few bytes of separators per entry. An estimate of
// what the system prompt spends listing a thing, which is why it is reported and never graded.
const descBytes = (files) => files.reduce((s, f) => s + path.basename(f, '.md').length + fm(f, 'name').length + fm(f, 'description').length + 6, 0);
function listingRows() {
  const skillFiles = (d) => walkFind(d, 'SKILL.md');
  // The commands pack is every .md under the tree, not one filename, so it gets its own walk.
  const commandFiles = (d) => {
    const out = [];
    (function w(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) w(p); }
        else if (e.name.endsWith('.md')) out.push(p);
      }
    })(d);
    return out;
  };
  // `global: true` is what --harness-only drops and what the gate's not-graded note excludes from
  // its repo-owned figure. An ENABLED PLUGIN is global even though its name carries no `~/`: it is
  // installed in the user's config, no commit here changes it, and labelling it repo-owned would
  // put somebody else's descriptions in this repo's ungraded total.
  const sets = [
    { set: '.claude/commands (repo)', files: commandFiles(resolve('.claude', 'commands')) },
    { set: '.claude/skills (repo)', files: skillFiles(resolve('.claude', 'skills')) },
    { set: '.claude/agents (repo)', files: mdFiles(resolve('.claude', 'agents')) },
  ];
  if (HOME) {
    sets.push({ set: '~/.claude/skills (global)', files: skillFiles(path.join(HOME, '.claude', 'skills')), global: true });
    sets.push({ set: '~/.claude/agents (global)', files: mdFiles(path.join(HOME, '.claude', 'agents')), global: true });
    for (const p of enabledPluginDirs()) {
      sets.push({
        set: `plugin ${p.id}`,
        files: [...skillFiles(path.join(p.dir, 'skills')), ...mdFiles(path.join(p.dir, 'commands')), ...mdFiles(path.join(p.dir, 'agents'))],
        global: true,
      });
    }
  }
  return sets
    .map((l) => ({ set: l.set, count: l.files.length, bytes: descBytes(l.files), global: l.global === true }))
    .filter((l) => l.count && !(HARNESS_ONLY && l.global));
}

/* 6. hook stdout: run the SessionStart and UserPromptSubmit commands exactly as the project
   settings wire them, because what a hook PRINTS lands in the context window and is therefore part
   of the startup cost. Hooks run under a POSIX shell even on Windows, so they are measured the way
   the runtime runs them. Skipped under --check: a hook run is a property of the machine, it has
   side effects, and a gate must not have any. */
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'Git', 'bin', 'bash.exe');
    if (fs.existsSync(p)) return p;
  }
  return 'bash';
}
function hookRows() {
  if (args.includes('--no-hooks') || CHECK) return [];
  // The project settings file may be absent (a repo that wires no hooks) or hand-edited. Same
  // disease, same cure as the user settings read above: a verdict beats a stack trace.
  let s;
  try { s = JSON.parse(fs.readFileSync(resolve('.claude', 'settings.json'), 'utf8')); } catch { return []; }
  const shell = findBash();
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: ROOT });
  const payload = (ev) => JSON.stringify({
    session_id: 'measure', transcript_path: 'x', cwd: ROOT, hook_event_name: ev,
    source: 'startup', prompt: 'add one smoke check for GET /api/health',
  });
  const rows = [];
  for (const ev of ['SessionStart', 'UserPromptSubmit']) {
    for (const group of ((s.hooks || {})[ev] || [])) {
      for (const h of (group.hooks || [])) {
        if (!isStr(h && h.command)) continue;
        const r = spawnSync(shell, ['-c', h.command], { env, input: payload(ev), timeout: 20000, encoding: 'utf8' });
        rows.push({ event: ev, command: hookLabel(h.command), bytes: Buffer.byteLength(r.stdout || ''), exit: r.status });
      }
    }
  }
  return rows;
}

/* 7. ground truth: the first main-chain assistant turn of a real session, which is the only figure
   here that is not an estimate. It is a property of the BOX — which transcript was newest, which
   model answered — so --check never reads it and no ceiling is ever held over it. It is reported so
   the graded surface can be compared against the real first turn, which is always far larger: the
   gap is the honest part of this script. */
function groundTruth() {
  let f = opt('--transcript', null);
  if (!f) {
    let all = [];
    try { all = fs.readdirSync(PROJ).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(PROJ, x)); } catch { all = []; }
    const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
    all.sort((a, b) => mtime(b) - mtime(a));
    f = all[0];
  } else if (!/[\\/]/.test(f) && !f.endsWith('.jsonl') && PROJ) {
    f = path.join(PROJ, f + '.jsonl');
  }
  if (!f || !fs.existsSync(f)) return null;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && o.type === 'assistant' && !o.isSidechain && o.message && o.message.usage) {
      const u = o.message.usage;
      return {
        transcript: path.basename(f, '.jsonl').slice(0, 8), at: o.timestamp, model: o.message.model,
        input: u.input_tokens, cacheCreate: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens,
        firstTurnTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      };
    }
  }
  return null;
}

const METHOD = 'bytes/4, with a CRLF pair taken as the one byte git stores; the injected files are the policy routes of the enabled tools; auto-memory clipped at the loader limit; subtree instruction files are taken as the '
  + 'largest single directory of them, since one touch loads one directory; hook stdout measured by running the wired commands; '
  + 'the generated doc index sits under onDemand and is excluded from startupTokens, because nothing injects it';

function measure() {
  const injected = injectedRows();
  const nestedOnTouch = nestedRows();
  const policyReads = policyFiles().map((f) => ({ file: f, bytes: size(resolve(...f.split('/'))), leadOnly: true }));
  const onDemand = onDemandRows();
  const listing = listingRows();
  const hooks = hookRows();
  const worstTouch = worstDirTokens(nestedOnTouch.map((r) => [r.file, tok(r.bytes)]));
  const t = {
    injected: tok(sum(injected)),
    nestedOnTouchWorst: worstTouch,
    nestedOnTouchTotal: tok(sum(nestedOnTouch)),
    subagentInjected: tok(sum(injected.filter((x) => x.subagent))) + worstTouch,
    policyReads: tok(sum(policyReads)),
    listing: tok(sum(listing)),
    hookStdout: tok(sum(hooks)),
    // Reported alongside the rest and absent from the sum on the next line, on purpose.
    onDemand: tok(sum(onDemand)),
  };
  t.startupTokens = t.injected + t.nestedOnTouchWorst + t.policyReads + t.listing + t.hookStdout;
  return {
    measured: new Date().toISOString(), project: cfg.project.name, harnessOnly: HARNESS_ONLY, method: METHOD,
    tokens: t, injected, nestedOnTouch, policyReads, onDemand, listing, hooks,
    groundTruth: CHECK ? null : groundTruth(),
  };
}

/* ── --check: the `context` gate ─────────────────────────────────────────────
   It writes NOTHING. A proof that rewrites a tracked file on every run is not a
   proof, and the ceilings deliberately do not live in harness-baseline.json,
   which an ordinary run rewrites in full.
   Detail lines go to stdout ABOVE the verdict so a red gate explains itself
   inside the suite output; the GATE line stays last, which is the only line the
   gate runner reads. Exit 0 when fail=0. */
const BUDGET_FILE = path.isAbsolute(opt('--budget', '')) ? opt('--budget', '') : resolve(opt('--budget', cfg.context.budgetFile));
const CHECK_NAMES = ['shape', 'injected', 'nestedOnTouch', 'policyReads', 'coverage', 'aggregate'];

/** git asked ONCE, here, so the comparator stays pure and testable. `null` means git could not
 *  answer, and the check says so in its own output rather than quietly changing what it grades. */
function trackedFiles() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!r || r.status !== 0 || typeof r.stdout !== 'string') return null;
  return new Set(r.stdout.split('\0').filter(Boolean));
}

/** The generated block inside a part-generated graded file, measured in BYTES (indexOf gives
 *  character offsets and a policy doc is not necessarily ASCII, so the slice is re-measured with
 *  Buffer). The default markers are the pair this harness's doc-index generator writes, and a
 *  fixture row may override them. Nothing asserts the spelling: if it ever stops matching, `found`
 *  is false and the bucket check fails saying exactly that. A row is a table line whose first cell
 *  is a backticked name, which is the registry's shape. */
const GEN_BEGIN = '<!-- agents:begin -->';
const GEN_END = '<!-- agents:end -->';
function measureGenerated(budget) {
  const out = {};
  for (const [k, spec] of Object.entries((budget && typeof budget === 'object' && budget.generated) || {})) {
    const abs = resolve(k.slice(k.indexOf('/') + 1));
    const blank = { found: false, bytes: 0, rows: 0 };
    // The read is GUARDED, and the guard is the point. Unguarded, a `generated` key whose file part
    // names a DIRECTORY — or the empty path, which resolves to the repo root — threw EISDIR out of
    // the top-level script BEFORE the grading ran, so the run printed no GATE line at all. The gate
    // runner reads that as "the gate died before its verdict" and, once baselined, adds "a check
    // DISAPPEARED (pass-by-absence)" about a fixture typo nobody deleted a check for. Falling
    // through to `blank` hands the same input to the shape check, which already names it precisely.
    let text = null;
    // Line endings normalised for the reason `size` gives: the block is subtracted from a row
    // measured that way, and two conventions in one subtraction is an error of a byte per row.
    try { if (fs.statSync(abs).isFile()) text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'); } catch { text = null; }
    if (text === null) { out[k] = blank; continue; }
    const begin = isStr(spec && spec.beginMarker) ? spec.beginMarker : GEN_BEGIN;
    const end = isStr(spec && spec.endMarker) ? spec.endMarker : GEN_END;
    const i = text.indexOf(begin);
    const j = text.indexOf(end, i < 0 ? 0 : i + begin.length);
    if (i < 0 || j < i) { out[k] = blank; continue; }
    const block = text.slice(i, j + end.length);
    out[k] = { found: true, bytes: Buffer.byteLength(block, 'utf8'), rows: (block.match(/^\| `/gm) || []).length };
  }
  return out;
}

function runCheck() {
  const report = measure();
  let budget = null;
  let readErr = null;
  try { budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')); } catch (e) { readErr = e.message; }
  const tracked = trackedFiles();
  const gm = measureGenerated(budget);
  const checks = contextChecks(budget, report, tracked, gm);
  const v = verdict(checks);

  console.log(`always-on context — graded against ${rel(BUDGET_FILE)}, hand-written, rewritten by no script`);
  if (readErr) console.log(`  ! ${rel(BUDGET_FILE)} unreadable: ${readErr}`);
  if (!tracked) console.log('  ! git ls-files did not answer — EVERY repo row is graded, tracked or not');
  if (budget && budget.placeholder === true) {
    console.log(`  ! ${rel(BUDGET_FILE)} is marked placeholder — its ceilings were never measured against this tree, so a pass here means little`);
  }
  for (const c of checks) {
    if (c.fails.length) for (const m of c.fails) console.log(`  x ${c.name}  ${m}`);
    else console.log(`  ok ${c.name}`);
  }
  // Slack, printed rather than left implicit: a ceiling nobody can see the distance to is a ceiling
  // that quietly becomes the last measurement.
  if (budget && !shapeFails(budget).length) {
    for (const b of GRADED_BUCKETS) {
      const ceils = (budget.ceilings || {})[b] || {};
      const rows = gradedRows(report, b, tracked).filter((r) => Object.prototype.hasOwnProperty.call(ceils, String(r.file)));
      for (const r of rows) {
        const spec = genSpec(budget, b, String(r.file));
        const m = spec && gm[genKey(b, String(r.file))];
        if (spec && m && m.found) {
          console.log(`     ${r.file}  authored ${r.bytes - m.bytes}/${ceils[r.file]} B · generated block ${m.bytes}/${spec.baseBytes + spec.bytesPerRow * m.rows} B over ${m.rows}/${spec.maxRows} rows`);
        } else {
          console.log(`     ${r.file}  ${r.bytes}/${ceils[r.file]} B`);
        }
      }
    }
  }
  for (const b of GRADED_BUCKETS) {
    for (const r of untrackedRows(report, b, tracked)) console.log(`     ${r.file}  ${r.bytes} B — untracked, NOT graded`);
  }
  // The gap, ungraded, every run. `GATE context pass=6 fail=0` says six declared numbers were not
  // crossed; it does not say context is under control, and these two lines are what stops it being
  // read that way. The listings are repo-owned and ungraded on purpose: skill bundles arrive
  // untracked through an ordinary package command, so a ceiling there would red on a file nobody's
  // diff would show — the untracked-file scar again. Printed unconditionally, INCLUDING the empty
  // case, because "on every run" has to be literally true or the disclosure is one enumeration
  // failure away from silence.
  const repoListing = (report.listing || []).filter((l) => l.global !== true && !String(l.set).startsWith('~/'));
  console.log('  note: NOT GRADED, repo-owned — listing '
    + (repoListing.length
      ? `${repoListing.map((l) => `${l.set} ${tok(l.bytes)} tok`).join(' + ')} = ${tok(sum(repoListing))} tok`
      : 'none enumerated on this box (0 tok)'));
  let firstTurn = 'not recorded';
  try { const g = JSON.parse(fs.readFileSync(OUT, 'utf8')).groundTruth; if (g && g.firstTurnTokens) firstTurn = `${g.firstTurnTokens} tok (${g.transcript})`; } catch { /* the report is optional here */ }
  console.log(`  note: repo-owned always-on ${repoAlwaysOnTokens(report, tracked)} tok`
    + (budget && posInt(budget.totalTokenCeiling) ? ` · ceiling ${budget.totalTokenCeiling} tok` : '')
    + ` · startupTokens ${report.tokens.startupTokens} tok · measured first turn ${firstTurn}`
    + ' · third-party skill and agent listings, hook stdout, MCP tool definitions and the per-subagent floor NOT measured');
  console.log(`GATE context pass=${v.pass} fail=${v.fail} skipped=0`);
  return v.fail ? 1 : 0;
}

if (CHECK) {
  // The safety net, and it is here for one reason: a gate that dies without printing a verdict is
  // reported by the runner as a VANISHED CHECK, which sends the reader hunting for a deleted test
  // instead of the exception they actually have. Six fails and a verdict is the honest shape of
  // "this gate could not grade anything", and the message is still on the line above it.
  let code = 1;
  try {
    code = runCheck();
  } catch (e) {
    console.log(`  ! the measurement failed before grading: ${e && e.message ? e.message : e}`);
    for (const n of CHECK_NAMES) console.log(`  x ${n}  not graded — the measurement failed before the comparison`);
    console.log('GATE context pass=0 fail=6 skipped=0');
    code = 1;
  }
  process.exit(code);
}

/* ── the ordinary run: measure, print, write the report ───────────────────
   A measurement that cannot be made is the same two-line stop every other script gives, and it
   writes no report: an unreadable registry or an enabled id with no row used to surface here as
   a stack trace, which reads as a broken script instead of the fix it has. */
const report = (() => { try { return measure(); } catch (e) { return fatal(e && e.message ? e.message : String(e), e && e.fix ? e.fix : 'run `node scripts/harness/measure-context.js --check` for the graded form of the same failure.'); } })();
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const row = (a, b) => console.log('  ' + String(a).padEnd(58) + String(b).padStart(8));
  console.log(`always-on context for ${cfg.project.name} (tokens ≈ bytes/4)`);
  console.log('injected every session:');
  report.injected.forEach((x) => row(x.file + (x.subagent ? '  [+subagent]' : ''), tok(x.bytes)));
  if (report.nestedOnTouch.length) {
    console.log('subtree instruction files (load on touch; the largest DIRECTORY of them is what the total charges):');
    const dirTok = new Map();
    report.nestedOnTouch.forEach((x) => dirTok.set(dirOf(x.file), (dirTok.get(dirOf(x.file)) || 0) + tok(x.bytes)));
    const worstDir = [...dirTok.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    report.nestedOnTouch.forEach((x) => row((dirOf(x.file) === worstDir ? '> ' : '  ') + x.file, tok(x.bytes)));
  }
  console.log('policy reads a lead opens before it knows the task:');
  report.policyReads.forEach((x) => row(x.file + (x.leadOnly ? '  [lead only]' : ''), tok(x.bytes)));
  // Printed under its own banner, indented off the always-on columns and with the figure in
  // parentheses, so this line cannot be skimmed as one more row of the total above it.
  console.log('NOT always-on — opened only when the task needs it, EXCLUDED from startupTokens:');
  report.onDemand.forEach((x) => console.log('    ~ ' + (x.file + '  [on demand]').padEnd(54) + `(${tok(x.bytes)})`.padStart(10)));
  console.log('listings (name+description), measured and NOT graded:');
  report.listing.forEach((x) => row(`${x.set} ×${x.count}`, tok(x.bytes)));
  if (report.hooks.length) {
    console.log('hook stdout per session start + one prompt:');
    report.hooks.forEach((x) => row(`${x.event} ${x.command}`, tok(x.bytes)));
  }
  console.log('totals:');
  Object.entries(report.tokens).forEach(([k, v]) => row(k === 'onDemand' ? 'onDemand  [not in startupTokens]' : k, v));
  if (report.groundTruth) row(`ground truth: first-turn input (${report.groundTruth.transcript}, ${report.groundTruth.model})`, report.groundTruth.firstTurnTokens);
  console.log(`written ${rel(OUT)}`);
}

/* --assert-budget speaks in exit codes both ways: a generous budget is met and exits 0, an
   impossible one is not and exits 1. It is the one-liner form of this script for a pre-commit hook
   or a CI step that wants a number rather than the gate's six checks. */
const assertBudget = Number(opt('--assert-budget', 0));
if (assertBudget && report.tokens.startupTokens > assertBudget) {
  console.error(`BUDGET FAIL startupTokens=${report.tokens.startupTokens} > ${assertBudget}`);
  process.exit(1);
}
