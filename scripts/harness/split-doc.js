'use strict';
/* AGENT HARNESS — split one over-cap doc into a folder of <=cap files, LOSSLESSLY.
   `git mv` runs FIRST so history follows the largest piece, then the sections are carved out of it.

   THE SAFETY PROPERTY IS AN ASSERTION, NOT A PROMISE. The multiset of non-blank source lines is
   compared against the multiset of non-blank output lines minus the lines this script generates
   itself. A mismatch aborts BEFORE anything is written and prints the undo command. That matters
   because of what a split is: the doc being split is usually the one carrying the state of a
   track, the split happens under cap pressure mid-phase, and a line quietly dropped by a packing
   bug is a decision nobody can tell was ever made. Counting lines would not catch it — a line
   lost from one section and a heading gained in another keeps the count — so the comparison is a
   multiset, and a lost line is named in the abort message.

   --self-test  drive the plan and the multiset check with literals, including the cases that must
                come out NO. No file is touched.
   --dry        print the plan, write nothing, run no git command.
   Zero-dep, Node built-ins only.
   Usage: node scripts/harness/split-doc.js <file.md> --out <dir> [--cap N] [--prefix p]
                                            [--readme name.md] [--dry]
   --prefix / --readme let a SECOND doc land in a folder that already has a README.md. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { load, ROOT, resolve, fatal } = require(path.join(__dirname, 'config.js'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

/* ---------- pure decisions (each is exercised by --self-test) ---------- */

/** A file name from a heading. Capped at 44 characters because the resulting path is cited in
 *  frontmatter, in the index and in a handoff's read list, and a 90-character file name wraps in
 *  every one of them. */
const slug = (s) => String(s).toLowerCase()
  .replace(/`|["'’“”()]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 44) || 'section';

/** Non-blank lines as a multiset. Blank lines are excluded deliberately: packing inserts and
 *  removes blank separators by design, and counting them would make every correct split look
 *  lossy — which is the fastest way to a safety check people pass `--force` to. */
const bag = (arr) => {
  const m = new Map();
  for (const l of arr) { const k = String(l).trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

/** What the split would lose and what it would invent. Empty/empty is the only acceptable answer. */
function multisetDiff(srcLines, outLines) {
  const a = bag(srcLines), b = bag(outLines);
  const missing = [], extra = [];
  for (const [k, v] of a) { const w = b.get(k) || 0; if (w < v) missing.push(`${v - w}x ${JSON.stringify(k.slice(0, 70))}`); }
  for (const [k, v] of b) { const w = a.get(k) || 0; if (v > w) extra.push(`${v - w}x ${JSON.stringify(k.slice(0, 70))}`); }
  return { missing, extra };
}

/**
 * The plan: carve on H2, then on H3 when a single H2 still exceeds the cap, then merge tiny
 * neighbours so the folder is a handful of files and not forty. An H2 with no H3 to split on is
 * kept WHOLE and reported as still over cap: a doc with one enormous unsectioned block needs a
 * hand edit, and splitting it mid-sentence would be the tool deciding where a thought ends.
 * `cap - 8` is the working ceiling, leaving room for the generated banner and the blank lines
 * packing adds, so a file that fits the plan also fits the cap once written.
 */
function plan(lines, cap, prefix) {
  const heads = [];
  lines.forEach((l, i) => { if (/^##\s+\S/.test(l)) heads.push({ i, title: l.replace(/^#+\s*/, '') }); });
  if (!heads.length) return null;

  const preamble = lines.slice(0, heads[0].i);
  const sections = heads.map((h, n) => ({
    title: h.title,
    body: lines.slice(h.i, n + 1 < heads.length ? heads[n + 1].i : lines.length),
  }));

  const parts = [];
  for (const s of sections) {
    if (s.body.length <= cap - 8) { parts.push(s); continue; }
    const h3 = [];
    s.body.forEach((l, i) => { if (i && /^###\s+\S/.test(l)) h3.push(i); });
    if (!h3.length) { parts.push(s); continue; } // oversize and unsplittable: kept whole, reported
    parts.push({ title: s.title, body: s.body.slice(0, h3[0]) });
    h3.forEach((start, n) => parts.push({
      title: `${s.title} — ${s.body[start].replace(/^#+\s*/, '')}`,
      body: s.body.slice(start, n + 1 < h3.length ? h3[n + 1] : s.body.length),
    }));
  }

  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && last.body.length + p.body.length + 2 <= cap - 8) {
      last.body = last.body.concat([''], p.body);
      last.merged = (last.merged || 1) + 1;
    } else merged.push(Object.assign({}, p));
  }

  const files = merged.map((p, n) => Object.assign({
    name: `${prefix || ''}${String(n + 1).padStart(2, '0')}-${slug(p.title)}.md`,
  }, p));
  return { preamble, files };
}

/* The lines this script WRITES. They are subtracted from the output side of the multiset check,
   because a generated banner is not a source line and must not read as one. */
const banner = (src) => `<!-- split from ${src} by scripts/harness/split-doc.js — content is verbatim -->`;
const genFor = (src) => [banner(src), ''];
const readmeGen = (src, files) => [banner(src), '', '## Sections', '', ...files.map((f) => `- [${f.title}](${f.name})`), ''];

/* ---------- --self-test ---------- */
function selfTest() {
  let CHECKS = 0; const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  eq('slug: a plain heading', slug('What this is'), 'what-this-is');
  eq('slug: punctuation and code spans go', slug('`gates.js` — the (runner)'), 'gates-js-the-runner');
  eq('slug: an unsluggable heading still yields a name', slug('***'), 'section');
  eq('slug: it is capped', slug('x'.repeat(80)).length, 44);
  // THE SAFETY PROPERTY, driven both ways. A check only ever seen agreeing is a check that cannot
  // disagree, and this one is the whole reason the tool is allowed to touch a doc at all.
  eq('multiset: identical content is clean', multisetDiff(['a', 'b'], ['a', 'b']), { missing: [], extra: [] });
  eq('multiset: blank lines do not count', multisetDiff(['a', '', 'b'], ['a', 'b', '', '']), { missing: [], extra: [] });
  eq('multiset: a reordered split is still clean', multisetDiff(['a', 'b'], ['b', 'a']), { missing: [], extra: [] });
  eq('multiset: a LOST line is named', multisetDiff(['a', 'b'], ['a']).missing.length, 1);
  eq('multiset: an INVENTED line is named', multisetDiff(['a'], ['a', 'b']).extra.length, 1);
  // The case a line COUNT would miss: one line lost, one line gained, totals unchanged.
  eq('multiset: a swap that keeps the count is still caught', multisetDiff(['a', 'b'], ['a', 'c']), { missing: ['1x "b"'], extra: ['1x "c"'] });
  eq('multiset: a duplicated line is caught', multisetDiff(['a'], ['a', 'a']).extra.length, 1);
  // The plan.
  const doc = ['# title', '', 'intro', '', '## One', 'a', '', '## Two', 'b'];
  const p = plan(doc, 150, '');
  eq('plan: the preamble stops at the first H2', p.preamble, ['# title', '', 'intro', '']);
  eq('plan: small sections merge into one file', p.files.length, 1);
  eq('plan: the file is named from the first heading it carries', p.files[0].name, '01-one.md');
  eq('plan: no H2 means no plan at all', plan(['# t', 'body'], 150, ''), null);
  // Over cap: a small cap forces one file per section, then H3 carving inside a fat one.
  const fat = ['# t', '## One', ...Array(20).fill('a'), '## Two', ...Array(4).fill('b'), '### Deep', ...Array(20).fill('c')];
  const q = plan(fat, 12, '');
  eq('plan: a fat section is not merged with its neighbour', q.files.length > 1, true);
  eq('plan: an H3 inside a fat section becomes its own file', q.files.some((x) => x.name.endsWith('-deep.md')), true);
  eq('plan: the prefix lands on every name', plan(doc, 150, 'qa-').files[0].name, 'qa-01-one.md');
  // And the plan preserves the lines it was given, which is the property the main path asserts.
  const out = [...q.preamble, ...q.files.flatMap((x) => x.body)];
  eq('plan: the plan itself loses nothing', multisetDiff(fat, out), { missing: [], extra: [] });
  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — split-doc.js self-test (' + CHECKS + ' checks)');
}

if (args.includes('--self-test')) { selfTest(); process.exit(0); }

/* ---------- main ---------- */
let CFG;
try { CFG = load(); } catch (e) { fatal(e.message, e.fix); }

const SRC = args.find((a) => !a.startsWith('--') && a.endsWith('.md'));
const OUT = opt('--out', null);
/* The cap comes from the config, so the tool that FIXES an over-cap doc and the gate that FAILS it
   read the same number. A default of its own here would be a second opinion about the limit. */
const CAP = Number(opt('--cap', CFG.docs.caps.default));
const PREFIX = opt('--prefix', '');
const README = opt('--readme', 'README.md');
const DRY = args.includes('--dry');
if (!SRC || !OUT) {
  console.error('usage: split-doc.js <file.md> --out <dir> [--cap ' + CFG.docs.caps.default + '] [--prefix p] [--readme name.md] [--dry]');
  process.exit(2);
}
if (!Number.isInteger(CAP) || CAP < 20) fatal('--cap must be an integer of at least 20 (got ' + opt('--cap', '') + ')', 'omit --cap to use docs.caps.default from harness.config.json.');

const srcAbs = resolve(SRC);
const outAbs = resolve(OUT);
if (!fs.existsSync(srcAbs)) fatal('no such doc: ' + SRC, 'pass a path relative to the repo root.');

const text = fs.readFileSync(srcAbs, 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');

const planned = plan(lines, CAP, PREFIX);
if (!planned) { console.error('no `## ` headings — nothing to split on'); process.exit(2); }
const { preamble, files } = planned;

/* ---------- assert the multiset BEFORE writing anything ---------- */
const outLines = [...preamble, ...files.flatMap((f) => f.body)];
const { missing, extra } = multisetDiff(lines, outLines);
if (missing.length || extra.length) {
  console.error(`LINE MULTISET CHANGED — refusing to split ${SRC}`);
  missing.slice(0, 8).forEach((m) => console.error('  lost:  ' + m));
  extra.slice(0, 8).forEach((m) => console.error('  gained:' + m));
  process.exit(1);
}

const over = files.filter((f) => f.body.length + genFor(SRC).length > CAP);
console.log(`${SRC} → ${OUT}/  (${lines.length} lines → ${files.length + 1} files, cap ${CAP})`);
console.log(`  ${README}  ${preamble.length + readmeGen(SRC, files).length} lines (preamble + section index)`);
files.forEach((f) => console.log(`  ${f.name}  ${f.body.length + 2} lines${f.merged ? `  [${f.merged} sections]` : ''}${f.body.length + 2 > CAP ? '  ⚠ STILL OVER CAP — has no H3 to split on' : ''}`));
if (DRY) { console.log('  --dry: nothing written'); process.exit(0); }

/* ---------- git mv FIRST, so history follows the largest piece ----------
   A split that wrote new files and deleted the old one would look to git like one deletion and six
   additions, and `git log --follow` on any of them would stop at the split. The README keeps the
   original path's history; the section files are new by definition. */
fs.mkdirSync(outAbs, { recursive: true });
const dest = path.posix.join(OUT.replace(/\\/g, '/'), README);
const mv = spawnSync('git', ['mv', SRC, dest], { cwd: ROOT, encoding: 'utf8' });
if (mv.status !== 0) { console.error(`git mv failed: ${String(mv.stderr || '').trim()}`); process.exit(1); }

fs.writeFileSync(path.join(outAbs, README), [...preamble, ...readmeGen(SRC, files)].join('\n').replace(/\n{3,}/g, '\n\n'));
for (const f of files) fs.writeFileSync(path.join(outAbs, f.name), [...genFor(SRC), ...f.body].join('\n').replace(/\n{3,}$/, '\n'));
console.log(`  git mv ${SRC} ${dest} done; ${files.length} section file(s) written.`);
console.log(`  Undo: git mv ${dest} ${SRC} && rm ${OUT}/${PREFIX}[0-9]*-*.md`);
if (over.length) console.log(`  ⚠ ${over.length} file(s) still over the cap — they need a hand edit, not another split`);
