'use strict';
/* AGENT HARNESS — the handoff block, as an exit code.
   Replaces: the prose checklist for "what a handoff must contain". A HANDOFF IS WRITTEN FOR A
   SESSION WITH NO MEMORY OF YOURS, and every rule here is a thing that session cannot re-derive.
   Six things, or the next phase re-derives everything you already knew:
     what to read, in order · the scope in one sentence · what NOT to do · inherited state ·
     the exit command verbatim and the first commit's subject · a pointer to How to work.

   HARD (exit 1), all read off the ONE ▶ block in <tracksDir>/<id>/handoff.md:
     1. exactly one ▶ block, and it is not a stub
     2. a `Read` line, and at least one path named in the block that RESOLVES on disk today
     3. a negative instruction (`do NOT re-` / `already measured`) — re-deriving is the DEFAULT
        failure of a cold session, and the negative instruction is the only thing that prevents it
     4. a provenance line citing gates.json or gates.baseline.json, so the next session knows
        where a figure may legitimately come from
     5. a `SCOPE:` line
     6. an `Exit:` line and a `First commit:` line
     7. a "How to work" pointer — the track README holds the standing rule for the track
     8. THE CLAIMS LEDGER: every standalone integer >= 10 sits on a line that also carries
        gates.json, a `path:line`, or a prefixed trap id. A number nobody can check is how a stale
        figure becomes a false regression two phases later: it is copied forward, compared against
        a fresh measurement, and the difference is read as a regression in the code.
   Dates, versions and names carrying digits are NOT claims, and rule 8 does not count them.

   --self-test  drive every pure decision with literals, including the cases that must come out NO.
   Zero-dep, Node built-ins only.
   Usage: node scripts/harness/handoff-lint.js <track-id> [--self-test] */
const fs = require('node:fs');
const path = require('node:path');

const { load, ROOT, resolve, fatal } = require(path.join(__dirname, 'config.js'));

const args = process.argv.slice(2);

/* ---------- pure decisions (every one is exercised by --self-test) ---------- */

/** The block runs from the ▶ heading to the next heading of the same or higher level. A deeper
 *  heading is part of the block: a handoff that uses `###` for its read list is still one block. */
function blocks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,4})\s*▶/);
    if (!m) continue;
    const depth = m[1].length;
    let j = i + 1;
    while (j < lines.length && !new RegExp('^#{1,' + depth + '}\\s').test(lines[j])) j++;
    out.push(lines.slice(i, j).join('\n'));
  }
  return out;
}

/** A line is CREDITED if it carries something the next session can open and check for itself:
 *  the gate state file, a `path:line`, or a prefixed trap id. */
const CREDIT = /gates(?:\.baseline)?\.json|[\w./-]+\.[a-z]{2,4}:\d+(?:-\d+)?|\b[A-Z]{2,5}-\d+\b/;

/** Dates, versions and any token mixing letters with digits (`pending-2026-01`, `8becfef`,
 *  `AH-11`) are NAMES, not claims. Masking them first is what keeps the ledger about FIGURES —
 *  without it, every commit sha and every dated folder in the block reads as an unchecked number
 *  and the rule becomes noise somebody switches off. */
const maskNames = (s) => String(s)
  .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
  .replace(/\b\d+(?:\.\d+)+\b/g, ' ')
  .replace(/[A-Za-z_][\w-]*\d[\w-]*/g, ' ')
  .replace(/\d[\w-]*[A-Za-z_][\w-]*/g, ' ');

/** Standalone integers >= 10 left after masking. These are the claims. Under 10 is left alone on
 *  purpose: `Phase 4`, `2 commits owed` and `1 file` are structure, not measurement, and a rule
 *  that flagged them would be arguing about every sentence. */
const claims = (line) => [...maskNames(line).matchAll(/(?<![\w.\-/])(\d+)(?![\w.\-/])/g)]
  .map((m) => Number(m[1])).filter((n) => n >= 10);

/** Repo paths named in the block, in the forms a handoff actually writes them. */
const pathsIn = (block) => [...String(block).matchAll(/(?:^|[\s`(])((?:[\w.-]+\/)+[\w.-]+\.\w{1,4})/g)].map((m) => m[1]);

const RULES = [
  { why: 'no `Read` line — say what to open, in order', test: (b) => /^\s*Read\b/im.test(b) },
  { why: 'no negative instruction (`do NOT re-...` / `already measured`) — re-deriving is the default failure', test: (b) => /(do\s+not\s+re-|already measured)/i.test(b) },
  { why: 'no line citing gates.json or gates.baseline.json — the next session cannot tell where a figure may come from', test: (b) => /gates(?:\.baseline)?\.json/.test(b) },
  { why: 'no `SCOPE:` line — one sentence naming what is in and what is out', test: (b) => /^\s*SCOPE:/im.test(b) },
  { why: 'no `Exit:` line — the command that proves the phase, verbatim', test: (b) => /^\s*Exit:/im.test(b) },
  { why: 'no `First commit:` line — the subject the phase produces', test: (b) => /First commit:/i.test(b) },
  { why: 'no "How to work" pointer — the track README holds the standing rule', test: (b) => /how to work/i.test(b) },
];

/** The whole verdict for one handoff body. PURE: it takes the text and an existence probe and
 *  returns reasons, so the self-test drives the real decision instead of a paraphrase of it. */
function lintBlock(text, exists) {
  const bs = blocks(text);
  if (bs.length !== 1) {
    return [bs.length === 0
      ? 'no ▶ block — a handoff is exactly one'
      : bs.length + ' ▶ blocks — a handoff carries exactly one, replaced wholesale, never appended'];
  }
  const b = bs[0];
  const reasons = [];
  if (b.split('\n').filter((l) => l.trim()).length < 5) reasons.push('the ▶ block is a stub — a cold session cannot start from it');
  for (const r of RULES) if (!r.test(b)) reasons.push(r.why);
  const named = pathsIn(b);
  if (!named.length) reasons.push('the block names no repo path at all');
  else if (!named.some(exists)) reasons.push('no path named in the block resolves on disk: ' + named.slice(0, 3).join(', '));
  for (const [i, line] of b.split('\n').entries()) {
    if (CREDIT.test(line)) continue;
    const c = claims(line);
    if (c.length) {
      reasons.push('line ' + (i + 1) + ': uncheckable figure(s) ' + c.join(', ')
        + ' — move them onto a line carrying gates.json, a `path:line` or a trap id, or drop them\n      '
        + line.trim().slice(0, 110));
    }
  }
  return reasons;
}

/* ---------- --self-test ---------- */
function selfTest() {
  let CHECKS = 0; const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  eq('one block found', blocks('# t\n## ▶ next\nbody\n').length, 1);
  eq('a second block is seen', blocks('## ▶ a\nx\n## ▶ b\ny\n').length, 2);
  eq('no block is zero, not a crash', blocks('# t\nno glyph here\n').length, 0);
  eq('a deeper heading does not end the block', blocks('## ▶ a\n### sub\nx\n').length, 1);
  eq('a shallower heading does end it', blocks('## ▶ a\nx\n# done\ny\n')[0].includes('done'), false);
  eq('credit: gates.json', CREDIT.test('the baseline is scripts/harness/gates.json'), true);
  eq('credit: a path:line', CREDIT.test('see scripts/harness/gates.js:288 for the retry'), true);
  eq('credit: a prefixed trap id', CREDIT.test('that is trap AH-11 in the README'), true);
  eq('NOT credit: a bare sentence', CREDIT.test('we kept the good ones'), false);
  eq('claim: a bare total', claims('103 traps were kept'), [103]);
  eq('claim: a comma-grouped figure still claims', claims('worth 2,090 tokens'), [90]);
  eq('NOT a claim: an ISO date', claims('measured 2026-01-04 and frozen'), []);
  eq('NOT a claim: a version', claims('Node 24.11.1 and the CLI at 2.1.260'), []);
  eq('NOT a claim: a name carrying digits', claims('moved to docs/archive/pending-2026-01/'), []);
  eq('NOT a claim: a short sha', claims('Phase 0 committed 8becfef'), []);
  eq('NOT a claim: single digits', claims('Phase 4 owes 1 commit'), []);
  eq('paths: found in a read list', pathsIn('  docs/tracks/x/README.md   (operating model)').length, 1);
  eq('paths: a bare word is not a path', pathsIn('read the readme').length, 0);
  const good = [
    '## ▶ NEXT',
    'Read, in this order:',
    '  package.json  (the scripts)',
    'SCOPE: one thing.',
    'Do NOT re-measure it.',
    'Figures come from gates.json only.',
    'First commit: `feat(x): y`.',
    'Exit: `node scripts/harness/handoff-lint.js x`.',
    'Follow "How to work" in the README.',
  ].join('\n');
  eq('a complete block passes', lintBlock(good, () => true), []);
  eq('a block with no SCOPE fails on exactly that', lintBlock(good.replace('SCOPE: one thing.', 'about one thing.'), () => true).length, 1);
  eq('a block with no negative instruction fails on exactly that', lintBlock(good.replace('Do NOT re-measure it.', 'It is measured.'), () => true).length, 1);
  eq('an uncheckable figure is caught', lintBlock(good + '\n42 surfaces were reached.', () => true).length, 1);
  eq('the same figure beside a trap id passes', lintBlock(good + '\n42 surfaces were reached (AH-9).', () => true), []);
  eq('a named path that does not resolve is caught', lintBlock(good, () => false).length, 1);
  eq('a stub block is refused', lintBlock('## ▶ next\ndo it\n', () => true).length > 0, true);
  eq('two blocks are refused before anything else', lintBlock(good + '\n## ▶ ALSO NEXT\n' + good, () => true).length, 1);
  eq('no block at all is refused', lintBlock('# handoff\nnothing yet\n', () => true).length, 1);
  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — handoff-lint.js self-test (' + CHECKS + ' checks)');
}

/* ---------- main ---------- */
if (args.includes('--self-test')) { selfTest(); process.exit(0); }

let CFG;
try { CFG = load(); } catch (e) { fatal(e.message, e.fix); }
const TRACKS = CFG.project.tracksDir;

const id = args.find((a) => !a.startsWith('-'));
if (!id) { console.error(`usage: node scripts/harness/handoff-lint.js <track-id> [--self-test]   (tracks live in ${TRACKS}/)`); process.exit(2); }

const file = resolve(TRACKS, id, 'handoff.md');
const relFile = path.relative(ROOT, file).replace(/\\/g, '/');
/* An ABSENT handoff is a failure, not a skip. A track with no handoff.md is a track whose next
   session starts by guessing, which is the single thing this file exists to prevent. */
if (!fs.existsSync(file)) { console.error('handoff-lint: no ' + relFile); process.exit(1); }

const reasons = lintBlock(fs.readFileSync(file, 'utf8'), (p) => fs.existsSync(resolve(p)));
if (reasons.length) {
  console.error('HANDOFF RED — ' + relFile + ', ' + reasons.length + ' finding(s):');
  for (const r of reasons) console.error('  x ' + r);
  process.exit(1);
}
console.log('handoff-lint: ' + relFile + ' — the block is self-contained for a cold session');
process.exit(0);
