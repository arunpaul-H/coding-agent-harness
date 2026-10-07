'use strict';
/* ============================================================
   carveouts.js — count the WAIVERS, because a waiver is how a gate stops gating.

   WHY THIS EXISTS
   The gate baseline in this tree goes red when a check VANISHES. Nothing counts the
   waivers that keep checks green while they are still there: a `figure-ok` tag over a
   number nobody re-measured, an `--allow-skip` pinned into a command line, an
   `"optional": true` on a gate, a `--clear` that waives a hygiene finding, a skipped
   test. Each is reasonable the day it is added, nobody ever counts them again, and the
   suite erodes with every figure staying green the whole way.

   Ported from UKGovernmentBEIS/inspect_ai/.github/scripts/check_suppressions.py, whose
   TWO AXES are the part worth stealing, and both are kept:
     1. an EXACT COUNT per rule. A total that differs either way fails — a new waiver
        appeared, or one was deleted/renamed and the comparison silently narrowed.
     2. a one-way RATCHET on waivers with NO STATED REASON: they may fall, never rise.
        It binds `--accept` too, because re-baselining is the exact moment growth gets
        laundered into a fixture: --accept refuses growth unless --allow-growth is also
        passed, and then names every grown rule; and it refuses to invent a FIRST
        baseline at all unless --bootstrap says so, because `rm` + `--accept` was
        otherwise a reset with no flag.
   A DESCRIBED waiver is one whose own line says why it is there, in a marker written on
   purpose (`# why: ...`, `// because ...`). That split is what keeps this gate from being
   a blanket freeze: a waiver WITH a reason only asks you to re-baseline; one without is
   what the ratchet refuses.

   Run:  node scripts/harness/carveouts.js --check         compare with the baseline; GATE line last
         node scripts/harness/carveouts.js --accept        print what WOULD be recorded, do not write
         node scripts/harness/carveouts.js --accept --i-know-the-tree-is-clean [--allow-growth]
         node scripts/harness/carveouts.js --accept --i-know-the-tree-is-clean --bootstrap
         node scripts/harness/carveouts.js --self-test
   Zero dependencies, Node built-ins only, like every other gate in this tree.

   WHAT carveouts.baseline.json IS, because this tree allows exactly one gate-figure baseline
   and that one is scripts/harness/gates.baseline.json, re-recorded only by `gates.js --accept`
   under a commit whose subject starts `gates:`.
   This file is NOT a second gate-figure baseline. It is a CENSUS: how many waivers of each
   kind this tree carries, and how many of them state a reason. It is the same kind of fixture
   as scripts/harness/context-budget.json — hand-governed, read by one script, meaningless to
   any other, and changed by a human who has looked at what changed. It holds no pass, no fail
   and no skip: the GATE line's three figures are DERIVED at run time by verdict() from the
   scan and this census, and are never stored anywhere. Separate from gates.baseline.json
   because that file records one verdict per gate and this one records a per-rule population
   that the verdict is computed FROM; folding a population into the verdict record would mean
   `gates.js --accept` silently re-recording waiver counts nobody read.
   The honest residue, since it is the one thing a census cannot excuse: `--accept` here does
   not know whether the rest of the suite is green, so unlike `gates.js --accept` (which
   refuses on red) it will record a new census while `test` or `docs` is failing. Fixing that
   needs a gates.js edit, and gates.js is frozen for this change. Until then the mitigations
   are only these: the absolute path of the census is printed on EVERY `--accept`, including
   the refusals, so a delete-then-re-record is visible in the transcript of the run that did
   it; `--bootstrap` is required to create a first census; `--allow-growth` is required to
   record growth.

   WHAT THE FIGURE IS NOT, as this script measured it on 2026-10-06 (`49` = allow-skip `33` +
   clear-waiver `16`): most of it is not a live waiver. It includes commit-hygiene.cjs's own usage
   strings (`7`), tests/guards.test.js's fixtures (`7`), tests/gates.test.js's argv arrays (`5`)
   and README.md's worked-example OUTPUT (`6`). The census is a population of MENTIONS, and
   an ordinary doc or test edit moves it and reds `--check`. That is a real cost, and the reason
   it is paid rather than heuristically shaved: every rule that would tell a mention from a
   waiver (is this string in a usage array? inside a test fixture?) fails in the dangerous
   direction, dropping a real waiver silently, and this file's whole argument is that
   under-counting a waiver is the failure that cannot be seen. The mitigation is the per-file
   map in the census (`files`) and in `--accept` output: the figure is only readable WITH it.

   WIRED IN THIS REPO since 2026-10-07: `harness.config.json` lists a `carveouts` gate running
   `--check`, and tests/mode-gates.test.js runs this file's self-test. The config `harness init`
   writes for another repo does NOT list it: a census has to be bootstrapped on that repo's own
   clean tree first, and until it is this gate would only declare a skip.
   ============================================================ */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'scripts', 'harness', 'carveouts.baseline.json');
const REL_BASELINE = 'scripts/harness/carveouts.baseline.json';
const GATE = 'carveouts';

/* Excluded from its own scan, and the exclusion is PRINTED on every run rather than left
   implicit: the pattern literals and self-test fixtures below ARE the five waiver forms, so
   scanning this file adds a dozen phantom waivers nobody can remove — and a figure nobody
   can act on is a figure that gets ignored. */
const SELF = 'scripts/harness/carveouts.js';

/* PROSE: adding a sixth waiver kind means adding it here, and nothing outside this file can
   force that — a waiver form nobody lists is a waiver form nobody counts. */
const RULES = ['allow-skip', 'clear-waiver', 'figure-ok', 'optional-gate', 'skipped-test'];

/* ---------- pure core: no git, no filesystem, driven by --self-test with literals ---------- */

/* A line STATES A REASON only through a marker someone wrote ON PURPOSE: a trailing `#`/`//`
   comment that opens with `why:`, `reason:` or `because` and then says several words.

   This used to credit ANY three-word trailing comment, and the bare word because/why/reason
   anywhere on the line, under a comment claiming over-crediting was the safe direction. That
   was backwards, and this comment exists to kill the idea: the ratchet (see `ratchet`) guards
   ONLY the undescribed count, so every over-credit is a reason-less waiver the ratchet CANNOT
   SEE — it hides growth of the exact number the ratchet exists to hold down. UNDER-crediting
   is the safe direction: its whole cost is that someone must write `why:` in front of a reason
   they had anyway. Two live over-credits this tightening removes: AGENTS.md's
   `--allow-skip reproducible-build=1    # every gate, one verdict` (a comment about the
   command, not about the waiver) and any markdown table row containing the word "reason". */
/* TWO further corrections, both measured on this tree:
   (a) EVERY comment opener on the line is tried, not just the first. Matching only the first
       meant the `//` inside `curl https://x/y --clear  # why: ...` won and a correctly
       documented waiver was recorded as reason-less — the ratchet then reds on a line that did
       exactly what this file asks for, which is the fastest way to teach people to ignore it.
   (b) The opener must be TRAILING: something other than whitespace precedes it. Without that,
       the markdown heading `# why: we pin --allow-skip docs=1 here` credited the waiver on its
       own line — a heading is prose about a waiver, and the "reason" it opens CONTAINS the
       waiver rather than explaining it. A comment-only line credits nothing, which is right:
       the marker has to be on the waiver's own line, after the waiver. */
function hasReasonMarker(line) {
  const s = String(line == null ? '' : line);
  const openers = /#|\/\//g;
  let m;
  while ((m = openers.exec(s)) !== null) {
    if (!/\S/.test(s.slice(0, m.index))) continue;        // (b) not a trailing comment
    const body = s.slice(m.index + m[0].length).trim();
    const intro = body.match(/^(?:why|reason)\s*:\s*(.*)$/i) || body.match(/^because\b(.*)$/i);
    if (intro && intro[1].trim().split(/\s+/).filter(Boolean).length >= 3) return true;
  }
  return false;
}

/* COPIES of the enforcer's two rules, from scripts/harness/guards/doc-frozen.cjs:158 and :175. They are
   copied, not required: a gate that died whenever the guard beside it under
   scripts/harness/guards/ was absent or mid-edit would be a gate nobody can run. The copy is held to the original by
   `enforcerDrift()`, which --self-test runs against the live file — a counter that disagrees with
   its enforcer publishes a figure for a thing nobody enforces. */
const stripCode = (text) => String(text).replace(/```[\s\S]*?```/g, '\n').replace(/`[^`\n]*`/g, '`');
const ENFORCED_FIGURE_OK = /<!--\s*figure-ok:\s*\S[^>]{7,}-->/;
/* Any ATTEMPT at the tag, over the WHOLE buffer: `[\s\S]` and no per-line scan, because the tag
   wrapped across two lines used to count ZERO times, which meant reformatting a bare tag onto two
   lines LOWERED the recorded count and read as cleanup. */
const ATTEMPTED_FIGURE_OK = /<!--\s*figure-ok\s*:?[\s\S]*?-->/g;

/* figure-ok over a whole .md buffer. Code is stripped FIRST, exactly as the enforcer strips it: a
   tag inside a span or a fence is quoting, not claiming — without this, the two `<!-- figure-ok:
   <reason> -->` examples inside backticks in DOC-STANDARD.md were counted as live waivers, so the
   published figure was 2 for a repo with ZERO of them.
   DESCRIBED means the enforcer would actually honour the tag, so a one-word reason — which
   docs-lint REFUSES — is counted as an undescribed waiver attempt rather than a described waiver.
   RESIDUAL DIFFERENCES, stated rather than left silent: (a) docs-lint asks one boolean per file
   ("does any valid tag exempt this doc"), this counts every attempt, including the attempts the
   enforcer refuses — a refused tag is still a carve-out someone reached for; (b) this normalises
   CRLF before stripping and the enforcer reads the raw body, so a `\r` inside a reason could in
   principle part them. */
function countFigureOk(text) {
  const prose = stripCode(String(text == null ? '' : text).replace(/\r\n?/g, '\n'));
  const out = [];
  for (const m of prose.matchAll(ATTEMPTED_FIGURE_OK)) {
    out.push({ rule: 'figure-ok', described: ENFORCED_FIGURE_OK.test(m[0]) });
  }
  return out;
}

/* `"optional": true` over a whole .json buffer, for the same reason figure-ok is counted that way:
   per line, a hand-wrapped or prettier-formatted `"optional":\n    true` counted ZERO, so
   reformatting an existing counted entry LOWERED the recorded total and read as cleanup.
   A text match, NOT a JSON parse, and that is the honest trade: this runs over a half-edited tree,
   where a parser would throw on the one file mid-edit and take the whole scan down with it, and a
   scan that dies is a scan that gets switched off. The `_readme` credit is therefore a heuristic
   over the 400 characters before the match, not over the enclosing object, and it is NOT budgeted:
   one `_readme` may legitimately describe a whole object. */
const OPTIONAL_GATE = /"optional"\s*:\s*true/g;
function countOptionalGate(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const out = [];
  for (const m of src.matchAll(OPTIONAL_GATE)) {
    out.push({ rule: 'optional-gate', described: /"_readme"/.test(src.slice(Math.max(0, m.index - 400), m.index)) });
  }
  return out;
}

/* --allow-skip, counted PER GATE and not per flag. gates.js:92 splits the value on commas, so
   `--allow-skip a=1,b=2` waives TWO gates; counting the list as one waiver meant the likeliest real
   mutation — appending a gate to an allow-skip already pinned in a doc, a CI file or a script —
   moved neither total nor undescribed, and axis 1's "an exact count per rule" did not see a second
   gate stop gating. Live instance: README.md:48 carries `reproducible-build=1,docs=1`.
   The separator class admits quotes and commas so the ARRAY form counts too: tests/gates.test.js:27
   is `['--allow-skip', 'reproducible-build=1']`, a pinned waiver that `[=\s]` alone could not see.
   The entry shape stays `<name>=<digits>`, which keeps that loose separator safe.

   TWO BLIND SPOTS, declared rather than papered over, because the fix for each would cost more
   false positives than the waiver it caught:
     · `--allow-skip <gate>` with NO `=n` is the STRONGEST form (gates.js:95 gives it Infinity), and
       it is not counted: the token after a bare flag is indistinguishable from prose, and this tree
       has ~12 sentences like "tolerate it visibly with `--allow-skip`, where the decision is".
     · a value from a variable — `--allow-skip "$SKIPS"` at .github/workflows/ci.yml:128 — cannot be
       counted by any text scan. That one is a real pinned waiver this census does not see.
   NOT a blind spot, though the review read it as one: `--allow-skip docs=n` (README.md:154) is not
   matched and should not be, because gates.js:97 computes `Number('n') || 0` — a non-numeric value
   tolerates ZERO skips, so the line waives nothing. It is an error message quoting the flag. */
const ALLOW_SKIP_ENTRY = /[A-Za-z0-9_.\/-]+=\d+/g;
const ALLOW_SKIP_LIST = /--allow-skip[=\s'",]+([A-Za-z0-9_.\/-]+=\d+(?:\s*,\s*[A-Za-z0-9_.\/-]+=\d+)*)/g;
function countAllowSkip(line) {
  let n = 0;
  for (const m of String(line == null ? '' : line).matchAll(ALLOW_SKIP_LIST)) {
    n += (m[1].match(ALLOW_SKIP_ENTRY) || []).length;
  }
  return n;
}

/* The three LINE rules, with each waiver's described flag. `opts.ext` gates the rules that only
   make sense for a file type. figure-ok and optional-gate are NOT here — both are counted per
   buffer above, because both can wrap across lines. */
function classify(line, opts) {
  const s = String(line == null ? '' : line);
  const ext = String((opts || {}).ext || '').toLowerCase();
  const out = [];
  /* ONE stated reason credits exactly ONE waiver. `x --clear y --clear z # why: a, b and c` used
     to come out fully described, so a second waiver could be parked behind the first one's reason
     and the ratchet would not move. */
  let credits = hasReasonMarker(s) ? 1 : 0;
  const hits = (count, rule) => {
    for (let i = count; i > 0; i--) {
      const d = credits > 0;
      if (d) credits--;
      out.push({ rule, described: d });
    }
  };
  // 1. allow-skip — any tracked file: it is as likely to sit in CI yaml or a doc as in a
  //    script, and a skip pinned in a workflow is the one nobody reads again.
  hits(countAllowSkip(s), 'allow-skip');
  // 2. clear-waiver — the literal that waives a hygiene finding. Literal on purpose:
  //    `--clearly` counts too, which is noise in one direction and never a missed waiver.
  hits((s.match(/--clear/g) || []).length, 'clear-waiver');
  // 3. skipped-test — a test that is present, counted by the runner, and proves nothing.
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') hits((s.match(/\b(?:it|test|describe)\.skip\s*\(/g) || []).length, 'skipped-test');
  return out;
}

/* One file's counts. Line endings are normalised FIRST — `\r\n` and a lone `\r` both — because
   this repo's primary machine is Windows: a `\r` left on a line end parks itself inside a captured
   reason, and a CR-only file folded into one giant "line" let any comment in the file credit every
   waiver in it. */
function countBuffer(text, ext) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const e = String(ext || '').toLowerCase();
  const out = {};
  const add = (hit) => {
    const slot = out[hit.rule] || (out[hit.rule] = { total: 0, undescribed: 0 });
    slot.total++;
    if (!hit.described) slot.undescribed++;
  };
  if (e === '.md') for (const hit of countFigureOk(src)) add(hit);
  if (e === '.json') for (const hit of countOptionalGate(src)) add(hit);
  for (const line of src.split('\n')) {
    /* In prose, an inline code span is a word-level QUOTATION: AGENTS.md's sentence about the
       `--clear` flag is documentation, not a waiver, and counting it made ordinary doc edits red
       this gate — which trains the --accept reflex this file exists to prevent. Fenced blocks are
       deliberately NOT stripped for these four rules: a fenced command line in AGENTS.md is the
       command people copy and run, so an `--allow-skip` pinned inside one is a live waiver. */
    const subject = e === '.md' ? line.replace(/`[^`\n]*`/g, '`') : line;
    for (const hit of classify(subject, { ext: e })) add(hit);
  }
  return out;
}

/* ---------- the described/undescribed split, printed rather than left to be inferred ---------- */

/* The exact syntax that credits a waiver, kept as DATA so --self-test can feed these very strings
   through countBuffer. A hint that no longer parses is worse than no hint: it sends people to write
   a reason the counter will not see, and the ratchet then reds a line that did what it was told. */
const CREDIT_EXAMPLES = [
  'node scripts/harness/gates.js --check --allow-skip docs=1   # why: this runner holds no index',
  'node scripts/harness/guards/commit-hygiene.cjs --clear      // because the fixture is vendored',
];
const CREDIT_FIGURE_OK = '<!-- figure-ok: measured in phase 3, not current -->';

function describedSplit(baseline) {
  const b = baseline || {};
  let total = 0; let undescribed = 0;
  for (const k of Object.keys(b)) { total += Number(b[k].total) || 0; undescribed += Number(b[k].undescribed) || 0; }
  return { total, described: total - undescribed, undescribed };
}

/* Printed on every run, because a two-axis design whose second axis credits NOTHING must not read
   like a working one. On this tree today described is 0: nobody has written a reason yet, which may
   be the correct state of the world but makes half the design inert in practice — so the run says
   so, in one line, with the syntax that would change it. */
function splitReport(baseline) {
  const s = describedSplit(baseline);
  const out = ['waivers counted: total=' + s.total + '  described=' + s.described + '  undescribed=' + s.undescribed
    + (s.total === 0 ? ' — nothing counted, so neither axis says anything about this tree' : '')];
  if (s.total > 0 && s.described === 0) {
    out.push('DESCRIBED=0 — the described axis credits NOTHING here, so one half of the two-axis design is');
    out.push('  inert in practice: the ratchet holds all ' + s.undescribed + ', and no waiver is in the "a re-baseline is');
    out.push('  enough" class. To credit one, put a reason on the waiver\'s OWN line, AFTER it:');
    for (const ex of CREDIT_EXAMPLES) out.push('    ' + ex);
    out.push('    (3+ words after `why:` / `reason:` / `because`; a figure-ok tag is credited by the');
    out.push('     enforcer\'s own rule instead: ' + CREDIT_FIGURE_OK + ')');
  }
  return out;
}

const sortKeys = (obj) => Object.keys(obj).sort().reduce((a, k) => { a[k] = obj[k]; return a; }, {});
const sortBaseline = (b) => Object.keys(b).sort().reduce((a, k) => {
  a[k] = { total: b[k].total, undescribed: b[k].undescribed, files: sortKeys(b[k].files || {}) };
  return a;
}, {});

/* Axis 1. Every difference is a finding, in both directions: a baseline rule missing from
   the scan means the comparison narrowed, which is the pass-by-absence failure this whole
   tree is built against. */
function diff(scanB, baseB) {
  const s0 = scanB || {}; const b0 = baseB || {};
  const out = [];
  for (const k of [...new Set([...Object.keys(s0), ...Object.keys(b0)])].sort()) {
    const s = s0[k]; const b = b0[k];
    if (s && !b) {
      out.push({ rule: k, reason: 'present in the scan, absent from the baseline — an uncounted waiver kind (total=' + s.total + ', undescribed=' + s.undescribed + ')' });
      continue;
    }
    if (!s && b) {
      out.push({ rule: k, reason: 'in the baseline, absent from the scan — the rule VANISHED or was renamed (baseline total=' + b.total + ')' });
      continue;
    }
    if (s.total !== b.total) out.push({ rule: k, reason: 'total ' + b.total + ' -> ' + s.total });
    if (s.undescribed !== b.undescribed) out.push({ rule: k, reason: 'undescribed ' + b.undescribed + ' -> ' + s.undescribed });
  }
  return out;
}

/* Axis 2. One-way: reason-less waivers may fall freely, and a DECREASE needs no flag or
   nobody would ever clean one up. */
function ratchet(oldB, newB) {
  const o = oldB || {}; const n = newB || {};
  const grown = [];
  for (const k of [...new Set([...Object.keys(o), ...Object.keys(n)])].sort()) {
    const from = o[k] ? o[k].undescribed : 0;
    const to = n[k] ? n[k].undescribed : 0;
    if (to > from) grown.push({ rule: k, from, to });
  }
  return { ok: grown.length === 0, grown };
}

/* The whole verdict, pure, so the GATE figures are testable without a repo. One check per
   rule (the union of both sides, so a tampered baseline key RAISES the total rather than
   hiding) plus one for the ratchet. pass+fail+skipped is that total and the total is
   load-bearing: comparing only `pass` cannot tell a green run from one where checks vanished. */
function verdict(scanB, baseB) {
  /* A missing baseline is a DECLARED SKIP with a total of its own (1, not the usual 6):
     nothing was compared, and a run that compared nothing must not read like a green run
     that compared everything. This is the ONLY skip this gate may ever emit — see
     blindVerdict below for why that matters. */
  if (!baseB) {
    return { skip: true, blind: false, findings: [], grown: [], tally: { pass: 0, fail: 0, skipped: 1 },
      fix: 'no ' + REL_BASELINE + ' yet — on a CLEAN tree run: node scripts/harness/carveouts.js --accept --i-know-the-tree-is-clean --bootstrap' };
  }
  const findings = diff(scanB, baseB);
  const r = ratchet(baseB, scanB);
  const bad = new Set(findings.map((f) => f.rule));
  const keys = [...new Set([...RULES, ...Object.keys(scanB || {}), ...Object.keys(baseB)])];
  let pass = 0; let fail = 0;
  for (const k of keys) { if (bad.has(k)) fail++; else pass++; }
  if (r.ok) pass++; else fail++;
  return { skip: false, blind: false, findings, grown: r.grown, tally: { pass, fail, skipped: 0 } };
}

/* A scan that COULD NOT RUN — git missing, git erroring, the checkout not a repo, an empty file
   list, every file refused — is a FAILURE, and it is a separate function from verdict() so the two
   verdicts can never collapse into one.

   THE LAUNDERING THIS PREVENTS, named because it is not obvious: a missing baseline forces the
   caller to declare `--allow-skip carveouts=1`, and nobody takes that token out again. If blindness
   also reported `skipped=1`, then the next run on a box with no git on PATH would scan ZERO files,
   count ZERO waivers, exit 0, and the suite would go GREEN under the SAME tolerance token — a
   token granted for bootstrap would also be tolerating total blindness. So: only a missing
   baseline may declare a skip. Everything that could not look is fail=1 and a non-zero exit. */
function blindVerdict(why) {
  return {
    skip: false, blind: true, grown: [],
    findings: [{ rule: GATE, reason: 'the scan could not run: ' + String(why) }],
    tally: { pass: 0, fail: 1, skipped: 0 },
  };
}

const gateLine = (t) => 'GATE ' + GATE + ' pass=' + t.pass + ' fail=' + t.fail + ' skipped=' + t.skipped;

/* ---------- the one function that touches git and the disk ---------- */

function gitFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\0').filter(Boolean);
}

/* `list` and `read` are injectable so the self-test drives the real accumulator with literals.
   Every way of seeing nothing returns ok:false, and the caller turns that into fail=1: a scan that
   could not list the index has not found zero waivers, it has found nothing.
   SCOPE, stated because the flag name gets this wrong: `git ls-files` enumerates the INDEX, not the
   worktree, so a waiver in a new unstaged file is invisible here. */
function scan(opts) {
  const o = opts || {};
  const root = o.root || ROOT;
  const list = o.list || (() => gitFiles(root));
  const read = o.read || ((rel) => fs.readFileSync(path.join(root, ...rel.split('/'))));
  const blind = (why) => ({ ok: false, why, baseline: null, scanned: 0, skipped: [] });
  let files;
  try { files = list(); } catch (e) {
    return blind('git ls-files failed: ' + String((e && e.message) || e).split('\n')[0]);
  }
  if (!Array.isArray(files)) return blind('git ls-files returned nothing usable');
  // A git checkout with an empty index is not a repo this gate can speak about.
  if (files.filter(Boolean).length === 0) return blind('git ls-files listed zero tracked files — not a repo, or an empty index');

  const acc = {};
  const skipped = [];
  let scanned = 0;
  for (const rel of files) {
    if (!rel || rel === SELF) continue;
    let buf;
    try { buf = read(rel); } catch (e) { skipped.push(rel + ' (unreadable: ' + String((e && e.code) || 'error') + ')'); continue; }
    if (Buffer.isBuffer(buf)) {
      // A NUL in the head means binary. Declared, not silently dropped, so a waiver hiding
      // in a file this scan refused to read is visible rather than absent. A UTF-16 file —
      // Notepad's old default on Windows — lands here too, by this same rule.
      if (buf.length > 4 * 1024 * 1024) { skipped.push(rel + ' (over 4MB)'); continue; }
      if (buf.subarray(0, 8192).includes(0)) { skipped.push(rel + ' (binary)'); continue; }
      buf = buf.toString('utf8');
    }
    scanned++;
    const counts = countBuffer(buf, path.extname(rel));
    for (const rule of Object.keys(counts)) {
      const slot = acc[rule] || (acc[rule] = { total: 0, undescribed: 0, files: {} });
      slot.total += counts[rule].total;
      slot.undescribed += counts[rule].undescribed;
      slot.files[rel] = (slot.files[rel] || 0) + counts[rule].total;
    }
  }
  // Listing files and then reading none of them is the same blindness as listing none.
  if (scanned === 0) return blind('every listed file was refused (' + skipped.length + ' declared) — nothing was read');
  return { ok: true, why: null, baseline: sortBaseline(acc), scanned, skipped };
}

/* A baseline that EXISTS but will not parse is a failure, never a skip: collapsing the two
   would let a corrupted fixture read as "no baseline yet" and quietly stop comparing. */
function readBaseline(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { exists: false, value: null, why: null }; }
  try { return { exists: true, value: JSON.parse(raw.replace(/^﻿/, '')), why: null }; }
  catch (e) { return { exists: true, value: null, why: String((e && e.message) || e).split('\n')[0] }; }
}

/* What --accept is allowed to do, decided purely so it is testable without a disk.
   The `no-baseline` refusal is the point: with no file on disk the ratchet has nothing to compare
   against, so `rm scripts/harness/carveouts.baseline.json && --accept` recorded ANY amount of
   reason-less growth with no flag at all. Nothing else in this tree guards that file, so the only
   guard available is this one: the FIRST record must be asked for by name. */
function acceptPlan(o) {
  const f = o || {};
  if (!f.baseExists) {
    if (!f.bootstrap) {
      return { action: 'refuse', code: 'no-baseline',
        why: 'no ' + REL_BASELINE + ' on disk, so there is nothing to ratchet against and any growth would be recorded unseen.',
        fix: 'if this really is the first baseline, say so: --accept --i-know-the-tree-is-clean --bootstrap' };
    }
    return { action: f.clean ? 'write' : 'dry-run', code: 'bootstrap' };
  }
  if (!f.ratchetOk && !f.allowGrowth) {
    return { action: 'refuse', code: 'growth',
      why: 'reason-less waivers grew against the existing baseline.',
      fix: 'state a reason on each new waiver, or re-run with --allow-growth to record the growth deliberately' };
  }
  return { action: f.clean ? 'write' : 'dry-run', code: f.ratchetOk ? 'rebaseline' : 'growth-allowed' };
}

/* ---------- drift: the copy above, held to the live enforcer ---------- */

/* Loaded ONLY by --self-test. Returns 'agrees' or a sentence naming the disagreement, and the
   self-test treats anything else as a FAILURE — including "could not load", because a counter that
   cannot demonstrate it matches its enforcer is publishing a figure for a thing nobody enforces. */
function enforcerDrift() {
  const where = path.join(ROOT, 'scripts', 'harness', 'guards', 'doc-frozen.cjs');
  let dl;
  try { dl = require(where); } catch (e) { return 'enforcer not loadable (' + where + '): ' + String((e && e.message) || e).split('\n')[0]; }
  if (typeof dl.hasFigureOk !== 'function') return 'enforcer exports no hasFigureOk';
  const fixtures = [
    '<!-- figure-ok: dated phase record, not current -->',
    '<!-- figure-ok -->',
    '<!-- figure-ok: why -->',
    'tag it `<!-- figure-ok: dated phase record, not current -->` like so',
    '```\n<!-- figure-ok: dated phase record, not current -->\n```',
    '<!-- figure-ok:\n     dated phase record, not current -->',
    '<!-- figure-ok: -->\n<!-- figure-ok: dated phase record, not current -->',
    'no tag here at all',
  ];
  for (const t of fixtures) {
    const mine = countFigureOk(t).some((h) => h.described);
    if (mine !== dl.hasFigureOk(t)) return 'disagrees with the enforcer on ' + JSON.stringify(t) + ': counter=' + mine + ' enforcer=' + dl.hasFigureOk(t);
  }
  return 'agrees';
}

/* ---------- --self-test: literals only, no disk (bar the enforcer drift check) ---------- */
function selfTest() {
  let n = 0; const fails = [];
  const eq = (what, got, want) => {
    n++;
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  const one = (line, ext) => classify(line, { ext })[0] || null;

  /* hasReasonMarker: only a deliberate TRAILING marker credits a waiver. Every case here moves
     against the code as it stood before it was written — the four negatives were live over-credits,
     and an over-credit is a reason-less waiver the ratchet cannot see. */
  eq('a plain three-word comment is NOT a reason', hasReasonMarker('--allow-skip reproducible-build=1    # every gate, one verdict'), false);
  eq('the bare word reason in prose is NOT a reason', hasReasonMarker('| --clear | waives a hygiene finding | reason |'), false);
  eq('the bare word because in prose is NOT a reason', hasReasonMarker('we skip it because docker is absent'), false);
  eq('a why: with only two words is too short', hasReasonMarker('x --clear # why: no network'), false);
  // (a) an earlier // must not eat the line: this was a correct waiver recorded as reason-less.
  eq('a // in a URL does not defeat a real trailing reason', hasReasonMarker('curl https://x/y --clear  # why: the finding is a vendored fixture'), true);
  // (b) a heading is prose ABOUT a waiver, and its "reason" contains the waiver rather than explaining it.
  eq('a markdown heading is not a trailing comment', hasReasonMarker('# why: we pin --allow-skip docs=1 here'), false);
  eq('so a heading does not credit the waiver on its own line',
    countBuffer('# why: we pin --allow-skip docs=1 here\n', '.md'), { 'allow-skip': { total: 1, undescribed: 1 } });

  /* The printed credit hint, fed through the counter. splitReport prints these exact strings when
     nothing in the tree is described, so a hint the parser would NOT credit sends people to write a
     reason this script cannot see — and the ratchet then reds a line that did as it was told. */
  eq('the printed allow-skip credit example really credits', countBuffer(CREDIT_EXAMPLES[0] + '\n', '.sh'), { 'allow-skip': { total: 1, undescribed: 0 } });
  eq('the printed --clear credit example really credits', countBuffer(CREDIT_EXAMPLES[1] + '\n', '.sh'), { 'clear-waiver': { total: 1, undescribed: 0 } });
  eq('the printed figure-ok example is one the enforcer honours', countFigureOk(CREDIT_FIGURE_OK), [{ rule: 'figure-ok', described: true }]);

  // Rule: allow-skip — counted PER GATE WAIVED, not per flag.
  eq('allow-skip with a bare command is UNdescribed', one('node gates.js --check --allow-skip build=1', '.sh'), { rule: 'allow-skip', described: false });
  eq('allow-skip is NOT credited by an undirected comment', one('gates --allow-skip a=1 # no network on this runner', '.sh').described, false);
  eq('a comma list waives one gate per ENTRY', classify('gates.js --allow-skip reproducible-build=1,docs=1', { ext: '.md' }).length, 2);
  eq('spaces inside a comma list do not hide an entry', countBuffer('gates.js --allow-skip a=1, b=2,c=3\n', '.sh'), { 'allow-skip': { total: 3, undescribed: 3 } });
  eq('the quoted ARRAY form is a pinned waiver too', countBuffer("const S = ['--allow-skip', 'alpha=1,reproducible-build=1'];\n", '.js'),
    { 'allow-skip': { total: 2, undescribed: 2 } });
  eq('a NON-NUMERIC value tolerates zero skips (gates.js: Number(v)||0), so it waives nothing',
    countBuffer('  x docs: skipped=1 and no --allow-skip docs=n was given\n', '.md'), {});
  // Rule: optional-gate — counted per BUFFER, because it wraps.
  eq('an optional gate near a _readme is described', countOptionalGate('{ "_readme": "x", "optional": true }'), [{ rule: 'optional-gate', described: true }]);
  eq('an optional gate alone is UNdescribed', countOptionalGate('{ "name": "x", "optional": true }'), [{ rule: 'optional-gate', described: false }]);
  eq('an optional gate WRAPPED across lines still counts', countBuffer('{\n  "name": "x",\n  "optional":\n    true\n}\n', '.json'),
    { 'optional-gate': { total: 1, undescribed: 1 } });
  eq('optional gate outside .json is not counted', countBuffer('"optional": true\n', '.md'), {});
  // Rule: clear-waiver.
  eq('bare clear is UNdescribed', one('node scripts/harness/guards/commit-hygiene.cjs --clear', '.cjs'), { rule: 'clear-waiver', described: false });
  // Rule: skipped-test.
  eq('a skipped test with a reason is described', one('it.skip("x", () => {}); // because the upstream API is down', '.js'), { rule: 'skipped-test', described: true });
  eq('bare skipped test is UNdescribed', one('  test.skip("flaky", fn)', '.js'), { rule: 'skipped-test', described: false });
  eq('describe.skip counts too', one('describe.skip("suite", fn)', '.js').rule, 'skipped-test');
  eq('skipped test outside .js is not counted', classify('it.skip("x")', { ext: '.md' }).length, 0);
  // One reason credits ONE waiver, so a second cannot ride along behind the first.
  eq('one reason does not describe two waivers on a line',
    classify('x --clear y --clear z  # why: both are vendored fixtures here', { ext: '.sh' }),
    [{ rule: 'clear-waiver', described: true }, { rule: 'clear-waiver', described: false }]);

  // figure-ok: counted per BUFFER, held to the enforcer's own rule.
  eq('figure-ok with a real reason is described', countFigureOk('<!-- figure-ok: measured in phase 3 -->'), [{ rule: 'figure-ok', described: true }]);
  eq('a bare tag and a bare tag with a colon are both UNdescribed ATTEMPTS',
    countFigureOk('<!-- figure-ok -->\n<!-- figure-ok: -->'), [{ rule: 'figure-ok', described: false }, { rule: 'figure-ok', described: false }]);
  eq('a one-word reason is what docs-lint REFUSES, so it is undescribed', countFigureOk('<!-- figure-ok: why -->'), [{ rule: 'figure-ok', described: false }]);
  eq('a tag inside a code span is quoting, not waiving', countFigureOk('tag it `<!-- figure-ok: measured in phase 3 -->` like so'), []);
  eq('a tag inside a fence is quoting too', countFigureOk('```\n<!-- figure-ok: measured in phase 3 -->\n```\n'), []);
  eq('a tag wrapped across two lines still counts once', countFigureOk('<!-- figure-ok:\n     measured in phase 3 -->\n'), [{ rule: 'figure-ok', described: true }]);
  eq('a bare tag wrapped across two lines counts as undescribed', countFigureOk('<!-- figure-ok\n-->\n'), [{ rule: 'figure-ok', described: false }]);
  // The buffer-wide match must stay LAZY: greedy, these two tags fold into one hit and the
  // described one swallows the bare one.
  eq('two tags on one line stay two hits, each with its own flag',
    countFigureOk('<!-- figure-ok: -->  <!-- figure-ok: measured in phase 3 -->'),
    [{ rule: 'figure-ok', described: false }, { rule: 'figure-ok', described: true }]);
  eq('classify no longer emits figure-ok at all', classify('<!-- figure-ok: measured in phase 3 -->', { ext: '.md' }), []);
  eq('the figure-ok rule agrees with the live enforcer', enforcerDrift(), 'agrees');

  // countBuffer: line endings, the .md span rule, multiple hits, the 400-char _readme window.
  eq('CRLF does not hide a waiver', countBuffer('# t\r\n<!-- figure-ok: measured in phase 3 -->\r\n', '.md'), { 'figure-ok': { total: 1, undescribed: 0 } });
  eq('a lone CR is a line break, not part of a line',
    countBuffer('node gates.js --allow-skip docs=1\r# why: an unrelated comment elsewhere\r', '.sh'),
    { 'allow-skip': { total: 1, undescribed: 1 } });
  eq('figure-ok is only counted in .md', countBuffer('<!-- figure-ok: measured in phase 3 -->\n', '.js'), {});
  eq('a code span in prose is not a waiver', countBuffer('the `--clear` flag waives a hygiene finding\n', '.md'), {});
  /* The boundary of the span-stripping rule, kept because the next person to meet a doc-edit red
     will reach for stripping fences too: a fenced command is the command people copy and run. */
  eq('a fenced command in a doc IS a pinned waiver', countBuffer('```bash\nnode gates.js --check --allow-skip docs=1\n```\n', '.md'),
    { 'allow-skip': { total: 1, undescribed: 1 } });
  eq('two waivers on one line both count', countBuffer('x --clear y --clear z\n', '.sh'), { 'clear-waiver': { total: 2, undescribed: 2 } });
  eq('a _readme further than 400 chars does not describe', countBuffer('{"_readme":"r",' + ' '.repeat(420) + '\n"optional": true}\n', '.json'),
    { 'optional-gate': { total: 1, undescribed: 1 } });
  eq('a clean buffer counts nothing', countBuffer('nothing waived here\n', '.js'), {});

  // diff, both directions.
  const B = (total, undescribed, files) => ({ total, undescribed, files: files || {} });
  eq('an identical scan is clean', diff({ 'clear-waiver': B(2, 1) }, { 'clear-waiver': B(2, 1) }), []);
  eq('a grown total fails', diff({ 'clear-waiver': B(3, 1) }, { 'clear-waiver': B(2, 1) }).length, 1);
  eq('a shrunk total fails too', diff({ 'clear-waiver': B(1, 1) }, { 'clear-waiver': B(2, 1) }).length, 1);
  eq('an undescribed change fails on its own', diff({ 'clear-waiver': B(2, 2) }, { 'clear-waiver': B(2, 1) })[0].reason, 'undescribed 1 -> 2');
  eq('a rule in the scan and not the baseline fails', diff({ 'skipped-test': B(1, 1) }, {}).length, 1);
  eq('a rule in the baseline and not the scan fails', diff({}, { 'skipped-test': B(1, 1) }).length, 1);

  // ratchet.
  eq('the ratchet refuses growth', ratchet({ 'figure-ok': B(3, 1) }, { 'figure-ok': B(3, 2) }), { ok: false, grown: [{ rule: 'figure-ok', from: 1, to: 2 }] });
  eq('the ratchet permits a decrease with no flag', ratchet({ 'figure-ok': B(3, 2) }, { 'figure-ok': B(3, 1) }), { ok: true, grown: [] });
  eq('the ratchet permits equal', ratchet({ 'figure-ok': B(3, 2) }, { 'figure-ok': B(4, 2) }), { ok: true, grown: [] });
  eq('a brand-new rule with no reasons is growth', ratchet({}, { 'allow-skip': B(1, 1) }).ok, false);

  // verdict, blindVerdict and the GATE line.
  const green = verdict({ 'clear-waiver': B(2, 1) }, { 'clear-waiver': B(2, 1) });
  eq('a green verdict is 5 rules + the ratchet', green.tally, { pass: 6, fail: 0, skipped: 0 });
  eq('one broken rule costs exactly one pass', verdict({ 'clear-waiver': B(3, 1) }, { 'clear-waiver': B(2, 1) }).tally, { pass: 5, fail: 1, skipped: 0 });
  eq('growth fails the rule AND the ratchet', verdict({ 'figure-ok': B(3, 2) }, { 'figure-ok': B(3, 1) }).tally, { pass: 4, fail: 2, skipped: 0 });
  const miss = verdict({ 'clear-waiver': B(2, 1) }, null);
  eq('a missing baseline SKIPS, it does not pass', [miss.skip, miss.tally], [true, { pass: 0, fail: 0, skipped: 1 }]);
  eq('a missing baseline hands over a fix line', typeof miss.fix, 'string');
  // The one that matters: blindness must not be able to borrow the bootstrap skip's tolerance.
  const blind = blindVerdict('git: not found');
  eq('a scan that could not run FAILS, it does not skip', [blind.skip, blind.blind, blind.tally], [false, true, { pass: 0, fail: 1, skipped: 0 }]);
  eq('blindness names itself in a finding', blind.findings.length, 1);
  eq('the blind GATE line is NOT the missing-baseline GATE line', gateLine(blind.tally) === gateLine(miss.tally), false);
  eq('the blind GATE line declares no skip at all', gateLine(blind.tally), 'GATE carveouts pass=0 fail=1 skipped=0');
  /* The GATE line's figures ARE the contract, so read them back OFF the printed line, slot for
     slot. The old version re-SUMMED the three numbers, which a swapped pass/fail survives, and it
     indexed the match directly — so a formatter that dropped `skipped=` CRASHED the suite instead
     of failing a check. parseGate returns null on a malformed line, which is a reported failure. */
  const parseGate = (line) => {
    const m = String(line).match(/^GATE (\S+) pass=(\d+) fail=(\d+) skipped=(\d+)$/);
    return m ? { gate: m[1], pass: Number(m[2]), fail: Number(m[3]), skipped: Number(m[4]) } : null;
  };
  eq('the green GATE line is exact', gateLine(green.tally), 'GATE carveouts pass=6 fail=0 skipped=0');
  eq('every GATE line round-trips to the tally it was handed, slot for slot',
    [green.tally, miss.tally, blind.tally].map((t) => parseGate(gateLine(t))),
    [green.tally, miss.tally, blind.tally].map((t) => ({ gate: GATE, pass: t.pass, fail: t.fail, skipped: t.skipped })));

  /* The described axis: it must SAY when it credits nothing, or a dead half of the design reads as
     a working one. On this tree described is 0 today. */
  eq('the split sums across every rule', describedSplit({ a: B(3, 1), b: B(2, 2) }), { total: 5, described: 2, undescribed: 3 });
  eq('with nothing counted, the report says neither axis speaks',
    [splitReport({}).length, /nothing counted/.test(splitReport({})[0])], [1, true]);
  eq('with nothing DESCRIBED, the report says the axis is inert', /DESCRIBED=0/.test(splitReport({ 'allow-skip': B(21, 21) }).join('\n')), true);
  eq('with one described waiver it does NOT claim the axis is inert', /DESCRIBED=0/.test(splitReport({ 'allow-skip': B(21, 20) }).join('\n')), false);
  eq('the inert disclosure carries the exact syntax that would credit one',
    splitReport({ 'allow-skip': B(2, 2) }).join('\n').includes(CREDIT_EXAMPLES[0]), true);

  // acceptPlan: the rm-the-baseline reset, and the growth refusal.
  eq('accept with no baseline and no --bootstrap REFUSES', acceptPlan({ baseExists: false, clean: true, ratchetOk: true }).code, 'no-baseline');
  eq('the refusal hands over the exact flag', typeof acceptPlan({ baseExists: false, clean: true }).fix, 'string');
  eq('accept with --bootstrap records the first baseline', acceptPlan({ baseExists: false, bootstrap: true, clean: true }), { action: 'write', code: 'bootstrap' });
  eq('--bootstrap without --i-know-the-tree-is-clean still writes nothing', acceptPlan({ baseExists: false, bootstrap: true, clean: false }).action, 'dry-run');
  eq('--bootstrap is ignored once a baseline exists', acceptPlan({ baseExists: true, bootstrap: true, clean: true, ratchetOk: false }).code, 'growth');
  eq('growth refuses without --allow-growth', acceptPlan({ baseExists: true, clean: true, ratchetOk: false }).action, 'refuse');
  eq('growth is recorded with --allow-growth', acceptPlan({ baseExists: true, clean: true, ratchetOk: false, allowGrowth: true }), { action: 'write', code: 'growth-allowed' });
  eq('a clean ratchet on an existing baseline writes', acceptPlan({ baseExists: true, clean: true, ratchetOk: true }), { action: 'write', code: 'rebaseline' });
  eq('nothing is written without --i-know-the-tree-is-clean', acceptPlan({ baseExists: true, clean: false, ratchetOk: true }).action, 'dry-run');

  // scan, end to end, with the index injected: no git, no disk.
  const files = { 'a.md': '<!-- figure-ok: measured in phase 3 -->\n<!-- figure-ok: -->\n', 'b/c.js': 'it.skip("x", fn)\n', 'd.png': Buffer.from([0x89, 0x50, 0, 0]) };
  const got = scan({ list: () => Object.keys(files), read: (rel) => (Buffer.isBuffer(files[rel]) ? files[rel] : Buffer.from(files[rel], 'utf8')) });
  eq('scan accumulates per rule and per file', [got.ok, got.scanned, got.baseline],
    [true, 2, { 'figure-ok': { total: 2, undescribed: 1, files: { 'a.md': 2 } }, 'skipped-test': { total: 1, undescribed: 1, files: { 'b/c.js': 1 } } }]);
  eq('a binary file is declared, not silently dropped', got.skipped, ['d.png (binary)']);
  eq('rule keys come out sorted', Object.keys(scan({ list: () => ['z.js', 'a.md'], read: (r) => Buffer.from(r === 'a.md' ? '<!-- figure-ok: measured in phase 3 -->' : 'test.skip(', 'utf8') }).baseline),
    ['figure-ok', 'skipped-test']);
  const dead = scan({ list: () => { throw new Error('git: not found') } });
  eq('git failing is not ok, and hands over a reason', [dead.ok, dead.baseline, typeof dead.why], [false, null, 'string']);
  eq('an empty index is blindness, not a clean tree', scan({ list: () => [] }).ok, false);
  eq('a non-array file list is blindness', scan({ list: () => null }).ok, false);
  eq('listing files and reading none of them is blindness',
    scan({ list: () => ['x.png'], read: () => Buffer.from([0, 1, 2, 3]) }).ok, false);

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? 'FAIL — carveouts.js self-test (' + fails.length + ' of ' + n + ')'
    : 'PASS — carveouts.js self-test (' + n + ' checks)');
  process.exit(fails.length ? 1 : 0);
}

/* ---------- main ---------- */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

function usage() {
  console.log([
    'carveouts.js — count the waivers that keep this suite green, and ratchet the ones with no reason.',
    '',
    '  --check      compare the git INDEX against ' + REL_BASELINE + '. Red on: any rule whose total',
    '               or undescribed count differs, a rule the baseline never counted, or REASON-LESS',
    '               waivers growing anywhere. A missing baseline is a declared SKIP. A scan that could',
    '               not run — no git, not a repo, nothing readable — is a FAILURE, never a skip.',
    '  --accept     print the CENSUS this index would record (' + REL_BASELINE + ', a',
    '               hand-governed per-rule population, NOT a stored pass/fail figure — see the file',
    '               header), plus the ratchet verdict, and the census file\'s absolute path every time.',
    '               Writes NOTHING without --i-know-the-tree-is-clean; refuses growth without',
    '               --allow-growth; refuses to create a FIRST census without --bootstrap.',
    '  --self-test  every pure decision, driven by literals, plus the figure-ok drift check.',
    '',
    'Counted: figure-ok tags (.md, code stripped, the enforcer\'s own rule), --allow-skip <gate>=<n>',
    '         (ONE PER GATE: a comma list waives several), "optional": true (.json, may wrap),',
    '         --clear, it/test/describe.skip( (.js). DESCRIBED = the waiver\'s OWN line carries a',
    '         deliberate TRAILING marker: `# why: ...` / `// because ...` of three or more words.',
    '         Every run prints the described/undescribed split, and says so when described is zero.',
  ].join('\n'));
  process.exit(0);
}

function printScan(res) {
  console.log('scanned ' + res.scanned + ' file(s) tracked in the git INDEX (not the worktree: an unstaged file is invisible here); self-excluded ' + SELF + ' (its literals ARE the patterns)');
  if (res.skipped.length) {
    console.log('NOT scanned, declared (' + res.skipped.length + '): ' + res.skipped.slice(0, 6).join(', ') + (res.skipped.length > 6 ? ', ...' : ''));
  }
  for (const line of splitReport(res.baseline)) console.log(line);
}

function main() {
  if (has('--self-test')) return selfTest();
  if (!has('--check') && !has('--accept')) return usage();

  const res = scan({ root: ROOT });
  /* A scan that could not run is fail=1 in BOTH modes — see blindVerdict for the laundering that
     a skip here would allow. */
  if (!res.ok) {
    const v = blindVerdict(res.why);
    console.log('FAIL — ' + v.findings[0].reason);
    console.log('   fix: run this from a git checkout with git on PATH; a scan that cannot list the index has not counted zero waivers');
    if (has('--check')) console.log(gateLine(v.tally));
    process.exit(1);
  }
  printScan(res);
  const read = readBaseline(BASELINE);
  if (read.exists && !read.value) {
    console.log('FAIL — ' + REL_BASELINE + ' will not parse: ' + read.why);
    console.log('   fix: repair the file or delete it; a baseline nothing can read must not be mistaken for no baseline at all');
    if (has('--check')) console.log(gateLine({ pass: 0, fail: 1, skipped: 0 }));
    process.exit(1);
  }
  const base = read.value;

  if (has('--accept')) {
    /* The absolute path is printed on every --accept — before the refusals too, so a
       delete-then-re-record is visible in the transcript of the run that did it. This file is a
       hand-governed CENSUS of waivers per rule, not a gate-figure baseline: see the header. */
    console.log('census file (hand-governed, absolute path): ' + BASELINE);
    console.log('the GATE line\'s pass/fail/skipped are derived at run time and are NOT stored in it');
    console.log('\nwould be written to ' + REL_BASELINE + ':');
    console.log(JSON.stringify(res.baseline, null, 2));
    const r = base ? ratchet(base, res.baseline) : { ok: true, grown: [] };
    if (r.grown.length) {
      console.log('\nRATCHET REFUSES — reason-less waivers grew:');
      for (const g of r.grown) console.log('  x ' + g.rule + ': undescribed ' + g.from + ' -> ' + g.to);
    } else if (base) {
      console.log('\nratchet ok — no rule grew a reason-less waiver');
    }
    const plan = acceptPlan({
      baseExists: Boolean(base), bootstrap: has('--bootstrap'), allowGrowth: has('--allow-growth'),
      clean: has('--i-know-the-tree-is-clean'), ratchetOk: r.ok,
    });
    if (plan.action === 'refuse') {
      console.log('\nREFUSED (' + plan.code + ') — ' + plan.why);
      console.log('   fix: ' + plan.fix);
      process.exit(1);
    }
    if (plan.code === 'bootstrap') {
      console.log('\n--bootstrap given: this records a FIRST baseline with NO RATCHET APPLIED — every reason-less waiver above is being frozen in as the starting count.');
    }
    if (plan.code === 'growth-allowed') console.log('   --allow-growth given: the growth above is being recorded on purpose');
    if (plan.action === 'dry-run') {
      console.log('NOT WRITTEN — a baseline recorded against a half-edited tree is a fixture that lies; pass --i-know-the-tree-is-clean once the index is clean');
      process.exit(0);
    }
    fs.writeFileSync(BASELINE, JSON.stringify(res.baseline, null, 2) + '\n');
    console.log('wrote ' + BASELINE + ' — commit it with a subject starting `gates:`');
    process.exit(0);
  }

  const v = verdict(res.baseline, base);
  if (v.skip) {
    console.log('\nSKIP — no baseline to compare against (the ONLY skip this gate emits; blindness fails instead)');
    console.log('   fix: ' + v.fix);
    console.log(gateLine(v.tally));
    process.exit(0);
  }
  for (const rule of [...new Set([...RULES, ...Object.keys(res.baseline), ...Object.keys(base)])].sort()) {
    const s = res.baseline[rule]; const b = base[rule];
    console.log('  ' + rule.padEnd(14) + ' now total=' + (s ? s.total : 0) + ' undescribed=' + (s ? s.undescribed : 0)
      + '   baseline total=' + (b ? b.total : 0) + ' undescribed=' + (b ? b.undescribed : 0));
  }
  /* The split on BOTH sides, so "described is zero" is visible as a fact about the recorded census
     too, not only about today's scan. */
  const nowSplit = describedSplit(res.baseline); const baseSplit = describedSplit(base);
  console.log('  ' + 'SPLIT'.padEnd(14) + ' now described=' + nowSplit.described + '/' + nowSplit.total
    + '   baseline described=' + baseSplit.described + '/' + baseSplit.total);
  if (v.findings.length) {
    console.log('\nCARVEOUTS RED — ' + v.findings.length + ' difference(s) against ' + REL_BASELINE + ':');
    for (const f of v.findings) console.log('  x ' + f.rule + ': ' + f.reason);
    for (const g of v.grown) console.log('  ! ratchet: ' + g.rule + ' reason-less waivers ' + g.from + ' -> ' + g.to + ' — state a reason instead');
    console.log('   fix: remove the waiver, or state why it is there, or re-baseline deliberately:');
    console.log('        node scripts/harness/carveouts.js --accept --i-know-the-tree-is-clean');
    console.log(gateLine(v.tally));
    process.exit(1);
  }
  console.log('\nCARVEOUTS GREEN — every waiver count matches the baseline and no reason-less waiver grew');
  console.log(gateLine(v.tally));
  process.exit(0);
}

module.exports = {
  scan, countBuffer, countFigureOk, countOptionalGate, countAllowSkip, classify, hasReasonMarker,
  stripCode, diff, ratchet, verdict, blindVerdict, acceptPlan, enforcerDrift, gateLine,
  sortBaseline, describedSplit, splitReport, selfTest,
  RULES, GATE, BASELINE, CREDIT_EXAMPLES, CREDIT_FIGURE_OK,
};

if (require.main === module) main();
