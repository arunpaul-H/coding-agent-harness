'use strict';
/* AGENT HARNESS — the doc contract, as an exit code.
   Replaces: the prose version of the house rules, the "longest doc wins" rule, and the several
   copies of the stray-file sweep ritual. A RULE THAT IS NOT CHECKED HERE IS NOT A RULE. The
   reference doc beside this file explains the shapes; this file is the contract.

   HARD (exit 1): frontmatter fields + enums + unique id · line caps · a dead relative link or a
   dead `§N` reference · one ▶ block per track, only in handoff.md · a gate figure in prose · a
   bare `trap #n` where `trap_prefix` is set · a traps line whose cited path does not resolve ·
   `status: complete` without a recomputable receipt · `source: external` without the UNTRUSTED
   banner · a frozen research or exploration BODY edited after its commit · an import stub that
   carries anything but the import, or has no policy file beside it · a policy file with no stub
   beside it for an enabled tool that needs one, or one that imports another file (rule 12) · an over-long line
   in the auto-memory index (reported, never a failure of this gate — see rule 10).
   WARN (exit 0): a stale `last_verified` · a plan whose `first_commit` never landed · slop words
   on added lines only. STALENESS NEVER BLOCKS: blocking on it is the exact mechanism behind a
   false-regression history this harness was built to end — a doc going red because a date passed
   tells you nothing about whether the code changed, and the standing fix for a red gate is to
   edit the doc, which is how a verified claim becomes a re-dated one.

   --grandfather  downgrade the caps and the link/§ checks to warnings. Use only while a split is
                  in flight; the phase that leaves it on has not finished.
   --memory-check SessionStart mode for rule 10 (see its own block below). Always exits 0.
   --self-test    drive every pure decision with literals, including the cases that must come
                  out NO. A rule only ever seen saying YES is indistinguishable from a rule that
                  cannot say NO.

   Every run ends with a `GATE docs pass= fail= skipped=` line, because this contract is a GATE in
   scripts/harness/gates.js and not a command someone remembers to type.
   Zero-dep, Node built-ins only. Usage: node scripts/harness/guards/docs-lint.cjs [--grandfather] */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { load, ROOT, resolve, fatal, DEFAULTS } = require(path.join(__dirname, '..', 'config.js'));
const {
  parseFrontmatter, capExempt, historyExempt, frozenEvidence, frozenBody, hasFigureOk, stripCode,
} = require(path.join(__dirname, 'doc-frozen.cjs'));
/* The instruction-file NAMES come from the tool registry's own script, not from literals here: the
   one policy file, and the files that are import stubs for some tool's row. The stub decision is
   that script's too (stubFindings), driven by its self-test, so the registry check and this gate
   cannot disagree about what a pointer is. */
/* --memory-check runs inside a session start and ALWAYS exits 0 (see its block at the foot). It
   reads one file outside the repo and needs neither the config nor the registry, so in that mode
   nothing below may stop the process: a missing registry, a broken config or an absent tools.js
   degrades to defaults nobody grades with, and the reminder still gets its chance to speak. */
const args = process.argv.slice(2);
/* Required as a MODULE, by scripts/harness/hook.js at session start, this file is in the same
   position: it must not stop the process that loaded it, and it exports the session-start report
   and nothing else (see the export above the entry block). The arguments are then the caller's. */
const AS_MODULE = require.main !== module;
const MEMORY_MODE = AS_MODULE || args.includes('--memory-check');
const GRANDFATHER = args.includes('--grandfather');

let TOOLS = null;
try { TOOLS = require(path.join(__dirname, '..', 'tools.js')); } catch (e) { if (!MEMORY_MODE) throw e; }
const POLICY_FILE = TOOLS ? TOOLS.POLICY_FILE : '';

/* The config is a HARD STOP here, not a soft read: this script's whole output is a verdict, and a
   verdict produced against invented limits is worse than no verdict. The hooks are the ones that
   degrade (see doc-frozen.cjs); a gate does not. */
let CFG;
try { CFG = load(); } catch (e) { if (MEMORY_MODE) CFG = DEFAULTS; else fatal(e.message, e.fix); }

/* An unreadable registry is a hard stop for the same reason: with no stub names rule 12 would
   sweep nothing and report a clean tree. NEEDED_STUBS is the narrower list, the stubs of the
   tools this repo has ENABLED: a stub of any row must stay a pointer, but only an enabled tool's
   stub has to exist. */
let STUBS = [];
let NEEDED_STUBS = [];
try {
  const registry = TOOLS.readRegistry();
  STUBS = TOOLS.stubFiles(registry);
  NEEDED_STUBS = TOOLS.enabledStubFiles(registry, CFG.tools.enabled);
} catch (e) { if (!MEMORY_MODE) fatal(e.message, e.fix); }
const INSTRUCTION_NAMES = [POLICY_FILE].concat(STUBS.filter((s) => s !== POLICY_FILE));

const DOCS = CFG.project.docsRoot;        // where the prose lives
const TRACKS = CFG.project.tracksDir;     // where a track folder goes
const CAPS = CFG.docs.caps;
/* The one directory name the doc contract fixes by CONVENTION rather than by config:
   `<docsRoot>/archive` is closed work. Two properties hang off it — nothing there needs
   frontmatter, and nothing there earns a row in the generated index — and both are properties of
   being closed rather than of being listed in a config key. A key for it would be a key a new repo
   sets wrongly once and then wonders why its archive is being graded as live context. */
const ARCHIVE = DOCS + '/archive';
const INDEX_FILE = DOCS + '/INDEX.md';

const KINDS = ['track', 'plan', 'handoff', 'traps', 'reference', 'research', 'exploration', 'index', 'design'];
const STATUSES = ['open', 'frozen', 'complete'];
/* Slop markers. The em-dash is in here with the filler words because it is the single most
   reliable tell of text a model wrote and nobody read. WARN only, and only on ADDED lines. */
const SLOP = /\b(delve|leverage|seamless|Certainly|robust solution|it'?s worth noting)\b|—/i;
/* A gate figure: a `nn/nn` pair. Gate figures belong in the two files gates.js writes and compares
   (gates.json, the last run; gates.baseline.json, the committed record) and nowhere else, because
   a figure in prose is a figure nobody re-measures and every reader believes. */
const GATE_FIGURE = /\b\d{2,4}\s*\/\s*\d{2,4}\b/;

const hard = [], warn = [];
const fail = (f, msg) => hard.push(`${f}: ${msg}`);
const soft = (f, msg) => warn.push(`${f}: ${msg}`);
/* A finding about a file OUTSIDE this repo. It is real, it is reported, and it MAY NOT touch the
   verdict. Rule 10 reads the auto-memory index, which lives in the user's profile, and its
   FAILURES used to go into `hard`, which both lowers `pass` below the baseline and raises `fail`
   above zero: the doc gate went red on one machine for a file no other machine has. So what the
   rule FINDS is weightless. These print under their own heading, and rule 10 also runs at
   SessionStart, where the file exists and where the startup context it polices is actually paid
   for. That the rule RAN is a different matter and is tallied: see THE COUNT at the bottom. */
const external = [];
const outside = (f, msg) => external.push(`${f}: ${msg}`);
/* A check that could not be made. It is never a pass. Each one prints, and each one adds 1 to
   `skipped` in the GATE line, so the suite's caller has to tolerate it explicitly with
   `--allow-skip docs=n` rather than reading a green line that stands for nothing. */
const skips = [];
const skip = (what, why) => skips.push(`${what} SKIPPED — ${why}`);
const softenable = (f, msg) => (GRANDFATHER ? soft(f, msg + '  [grandfathered]') : fail(f, msg));

/* The receipt formula is close-phase.js's, IMPORTED rather than reimplemented: two copies of a
   hash rule is two rules, and the day they disagree the receipt stops meaning anything. Its
   absence is declared as a skip, not swallowed: on a tree where the phase lifecycle is not
   installed, `status: complete` is still refused without a `receipt:` field, but whether the
   receipt RECOMPUTES cannot be answered here, and a rule that silently stops being checked is the
   failure this whole file exists to prevent. */
let receiptFor = null;
let receiptUnavailable = null;
try {
  // By __dirname, like config.js and doc-frozen.cjs above: harness code loads harness code from
  // beside itself. ROOT is the tree being GRADED, and the two differ whenever the linter is run
  // from one checkout against another.
  const cp = require(path.join(__dirname, '..', 'close-phase.js'));
  if (typeof cp.receiptFor === 'function') receiptFor = cp.receiptFor;
  else receiptUnavailable = 'scripts/harness/close-phase.js exports no `receiptFor`';
} catch (e) {
  receiptUnavailable = 'cannot load scripts/harness/close-phase.js (' + (e.code || e.message) + ')';
}

/* ---------- rule applications ----------
   The verdict used to count `files.length`, which does not move when a rule stops running: the
   same files are still walked. Deleting a rule's call site left the GATE line byte-identical —
   measured, not supposed. So every rule ANNOUNCES ITSELF where it is evaluated. Two things fall
   out of that, and they are independent: the tallied figure drops by one per file the rule would
   have swept, and the rule's number vanishes from the observed set, which is a NAMED hard failure
   rather than a figure a reader has to compare against a baseline by eye.
   `applied(n)` sits BEFORE each rule's own condition on purpose. Evaluated, not fired: rule 4
   fires only on a bare `trap #n`, and a rule that found nothing to complain about still ran.
   Rule 10 is absent from TALLIED_RULES, the list of rules that MUST have announced themselves:
   its subject lives outside the repo, so on a box without the file it cannot run and declares a
   skip instead. Where the file is there it announces itself like any other rule. Either way it
   is exactly one check in the total; THE COUNT at the bottom says why that has to hold. */
const TALLIED_RULES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12];
const seenRules = new Set();
let applications = 0;
const applied = (n) => { seenRules.add(n); applications += 1; };
const rulesNotApplied = (declared, seen) => declared.filter((n) => !seen.has(n));

/* ---------- pure decisions (each is exercised by --self-test) ----------
   parseFrontmatter, capExempt, historyExempt and the frozen predicates are IMPORTED, not defined
   here, for the reason receiptFor is imported above: the write guard asks the same questions about
   the same files, the two answers had drifted apart, and two copies of a rule is two rules. The
   self-test below still drives them, because a shared decision nobody exercises is a shared
   decision nobody notices breaking. */
const stripFrontmatter = (t) => (t.startsWith('---') && t.indexOf('\n---', 3) >= 0
  ? t.slice(t.indexOf('\n', t.indexOf('\n---', 3) + 1) + 1) : t);

/** The cap for one doc, from `config.docs.caps`. Three ways a cap is found, most specific first:
 *   - an EXACT repo-relative path key, which is how the always-on files get their tight ceilings
 *     and how a repo can raise one named doc without raising all of them;
 *   - `subtreeAgentsMd` for a per-directory instruction file, wherever in the tree it sits: a
 *     nested policy file, and the import stub beside it for a tool that needs one;
 *   - `default` for everything else.
 *  No cap is ever absent: the config validator refuses a caps table with a non-positive integer in
 *  it, and `default` is one of its documented defaults.
 *  THE ONE UNCAPPED FILE is the generated index. Its length is the number of live docs, not a doc
 *  doing two jobs, and no author can shorten it: a cap there fails the tree for having documents,
 *  and it deadlocks the very archive move that would shrink it. An explicit path key still wins,
 *  so a repo that WANTS a ceiling on its index can state one. */
const capFor = (relPath, caps, indexFile, names) => {
  const c = caps || CAPS;
  if (Object.prototype.hasOwnProperty.call(c, relPath)) return c[relPath];
  if (relPath === (indexFile || INDEX_FILE)) return Infinity;
  if (relPath.includes('/') && (names || INSTRUCTION_NAMES).includes(relPath.split('/').pop())) return c.subtreeAgentsMd;
  return c.default;
};

/** Section numbers a doc OFFERS. Docs here number sections three ways — `## 3. Buckets`,
 *  `## Step 5 — secrets`, `## Phase 6` — so every integer in a heading counts as addressable. */
const headingNums = (text) => new Set((text.match(/^#{2,4}\s+.*$/gm) || []).flatMap((h) => (h.match(/\d+/g) || [])));

/** `source: external` marks a doc whose body quotes text nobody here wrote — a fetched page, a
 *  vendor report, another model's answer. The banner is the only thing standing between the next
 *  agent and executing that text as instruction, so its absence is a HARD failure, not a note.
 *  Three things this deliberately does, each of them a lesson paid for (three rules in this file
 *  were dead for weeks because they keyed on a token an earlier pass had already eaten):
 *   - it takes the RAW body, never the stripCode()'d prose — a banner quoted inside a fence is
 *     still a banner, and the stripper would delete it;
 *   - it takes the BODY, not the whole file. Reading the whole file lets FRONTMATTER satisfy the
 *     rule: `read_when: "⚠ UNTRUSTED report"` would pass a doc whose body warns nobody, which is
 *     the one case the rule exists to catch;
 *   - it is a function, driven by --self-test with literals, because a rule you can only exercise
 *     by writing a file into the docs tree is a rule that stops being exercised.
 *  The glyph is required. The bare word in running prose is not a banner. Emphasis between the two
 *  is: `⚠ **UNTRUSTED**` is the same banner a reader sees.
 *  Two ways this rule shipped BROKEN once, both reproduced against literal fixtures, both now
 *  pinned by --self-test so neither can come back quietly:
 *   - THE INVISIBLE CODEPOINT. `⚠` is U+26A0, and every OS emoji picker — and most editors —
 *     emit it followed by U+FE0F, the emoji-presentation variation selector. The first pattern
 *     demanded the bare codepoint, so a body reading `⚠️ **UNTRUSTED**` was a HARD FAILURE while
 *     rendering to a reader as precisely the banner the rule asks for. One invisible character was
 *     deciding a gate, against the rule's own stated rationale ("the same banner a reader sees").
 *     Both selectors are now optional: U+FE0F and its text-presentation twin U+FE0E. Nothing else
 *     is loosened — the word still has to follow the glyph.
 *   - THE QUALIFIED VALUE. The test was `fm.source === 'external'`, exact equality, so
 *     `source: external (fetched 2026-01-04, vendor page)` produced NO finding at all, and nor did
 *     `source: mixed (repo measurement + one external report)` — which is the form a real research
 *     file takes. A doc that quotes a fetched page escaped the rule by qualifying its own honesty.
 *     What the rule cares about is whether the value DECLARES external content, so the word is
 *     matched anywhere in it, case-insensitively, on a word boundary. A value with no `external`
 *     in it (`repo measurement`) stays out of scope, and `externally` is not the word. */
// The two selectors are written as ESCAPES, never pasted: a variation selector is invisible in
// every editor, so a pasted one is a character no reviewer can see and no diff can explain.
const UNTRUSTED_BANNER = new RegExp('\\u26A0[\\uFE0F\\uFE0E]?[\\s*_]*UNTRUSTED');
/** Does this `source:` value declare external content? Bracketed frontmatter values parse to an
 *  ARRAY (see parseFrontmatter), so `source: [repo, external report]` is joined before matching —
 *  a rule that only understood strings would go silently quiet on the list form. */
const declaresExternal = (src) => src != null
  && /\bexternal\b/i.test(Array.isArray(src) ? src.join(' ') : String(src));
const untrustedBannerMissing = (fm, body) => Boolean(fm) && declaresExternal(fm.source) && !UNTRUSTED_BANNER.test(body);

/* ---------- rule 10: the auto-memory index ----------
   The agent runtime keeps a per-project memory index outside the repo, under the user's profile.
   It is a POINTER file: one line per memory, and a line that carries the memory instead of
   pointing at it is charged to every session's startup context on the machine that has it.

   THE PATH IS DERIVED, never written down. The runtime names a project directory after the
   project's absolute path with every character that is not a letter or a digit flattened to `-`
   — separators and the drive colon, and also a dot, an underscore or a space in a folder name —
   so `C:\\Projects\\example` becomes `C--Projects-example`. Flattening only the separators
   would leave the rule a silent no-op for every checkout whose path carries a dot. The previous
   version of this file hard-coded one such name, which made the rule a no-op on every other
   checkout and every other machine. Deriving it is also the only way the rule survives a rename
   of the repo's folder. scripts/harness/measure-context.js derives the SAME directory for its
   auto-memory row and its ground truth, and once did it with the separators-only rule this
   paragraph warns about; it cannot require this file without running a lint, so the derivation
   is written in both and tests/context.test.js drives the two scripts against one planted index.

   A function rather than an inline loop because it has three callers that must not disagree: the
   lint (which reports it without counting it), the SessionStart mode (which is where it can still
   bite), and the self-test (which drives it from literals, never from the user's real index —
   planting a bad line in a file outside the repo is outside an agent's remit).

   It takes the TEXT, not a path, so the self-test can drive it like every other decision here.
   Reading the file is the caller's job, and its absence is the clean-clone case, declared as a
   skip rather than treated as a pass. */
const MEMORY_LINE_MAX = 160;
const projectDirName = (abs) => String(abs).replace(/[^A-Za-z0-9]/g, '-');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const MEMORY_MD = path.join(HOME, '.claude', 'projects', projectDirName(ROOT), 'memory', 'MEMORY.md');
const readMemory = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
function memoryFindings(text) {
  const out = [];
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith('- ')) continue;
    if (line.length > MEMORY_LINE_MAX) {
      out.push(`line ${i + 1}: ${line.length} chars > ${MEMORY_LINE_MAX} — a pointer, not the memory`);
    }
  }
  return out;
}

/* ---------- scope ---------- */
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
/* Directories a doc sweep must never enter. node_modules and .git are obvious; a build output
   directory is here because a copied doc in `dist/` is a doc with a duplicate `id`, and the
   duplicate-id rule would then fail on a file no commit owns. */
const SKIP_DIR = /^(node_modules|\.git|dist|build|coverage|\.next|out|vendor)$/;
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, out); }
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
/* A per-directory instruction file is always-on context for work in that directory, so it is
   capped wherever it sits. The previous version listed the directories to search, which meant a
   new subtree's file was uncapped until someone remembered to add it to an array in this file.
   The whole tree is walked instead, minus SKIP_DIR. That costs one directory walk and removes a
   way for always-on context to grow unobserved. Both names are swept: the policy file, and every
   import stub, because rule 12 has to see a stub wherever one is planted. */
function instructionFiles() {
  return walk(ROOT).filter((f) => INSTRUCTION_NAMES.includes(path.basename(f)));
}
const isStub = (relPath) => STUBS.includes(String(relPath).split('/').pop());
const isPolicy = (relPath) => String(relPath).split('/').pop() === POLICY_FILE;
const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
/** Does an import token name a file a tool would actually pull in? One that resolves from the
 *  importing file's own directory, an absolute one that exists, or anything under the home
 *  directory: that last one is flagged unresolved, because whether it exists differs per machine
 *  and a verdict must not. A token that resolves to nothing loads nothing (`@someone` in prose). */
const importResolves = (token, fromDirAbs) => {
  if (token.startsWith('~/')) return true;
  const target = path.resolve(fromDirAbs, token);
  try { return fs.statSync(target).isFile(); } catch { return false; }
};
/** A README.md outside the docs tree is the HUMAN front door, never agent context — it is
 *  deliberately outside every rule here, caps included. The repo's own README is the one file in
 *  this port written for a person. */
const HUMAN = (f, docsRoot) => /(^|\/)README\.md$/.test(f) && !f.startsWith((docsRoot || DOCS) + '/');

function inScope() {
  const files = [
    ...walk(resolve(DOCS)).map(rel),
    ...walk(resolve(TRACKS)).map(rel),   // a tracks dir configured outside the docs root
    ...INSTRUCTION_NAMES,
    ...instructionFiles().map(rel),
  ];
  return [...new Set(files)]
    .filter((f) => fs.existsSync(resolve(f)) && !HUMAN(f))
    .sort();
}

const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });

/**
 * Is a cited path REAL? `fs.existsSync` alone cannot tell a trap that cites nothing from one that
 * cites a file this repo deliberately gitignores, and the difference is a whole class of false
 * regression: a generated state file is present on the dev box and absent on every clean clone, so
 * the doc contract was green on one and red on the other for a citation that was correct both
 * times. Asking the FILESYSTEM answers "is it here"; the rule means "can a reader follow it".
 *
 * So ask git as well, in the order that costs least:
 *   on disk              → real
 *   tracked by git       → real, even where this checkout has deleted it
 *   deliberately ignored → real, and its absence is precisely what .gitignore promised
 *
 * THE COST, stated rather than discovered later: a typo under an ignored directory now resolves,
 * because `node_modules/nope.js` matches an ignore rule as readily as a real artefact does. That
 * is the price of being able to answer at all on a machine where the file cannot exist, and it is
 * narrower than it sounds — an unresolvable citation is almost always a bare BASENAME
 * (`store.js`, `routes.js`), which no ignore rule matches and which still fails.
 *
 * Memoised, and `ls-files` is read once: rule 7 runs per trap line and each git call is a process.
 */
const realPath = new Map();
let tracked = null;
function pathIsReal(p) {
  if (realPath.has(p)) return realPath.get(p);
  let real = fs.existsSync(resolve(p));
  if (!real) {
    if (tracked === null) {
      const ls = git('ls-files', '-z');
      tracked = new Set(ls.status === 0 ? ls.stdout.split('\0').filter(Boolean) : []);
    }
    // check-ignore: 0 ignored, 1 not ignored, 128 not a repo. Only 0 counts as an answer.
    real = tracked.has(p) || git('check-ignore', '-q', '--', p).status === 0;
  }
  realPath.set(p, real);
  return real;
}

/* ---------- the sweep ---------- */
function lint() {
  const files = inScope();
  const allDocs = walk(resolve(DOCS)).map(rel).concat(INSTRUCTION_NAMES);
  const ids = new Map();
  /* Frontmatter is required of every doc in the prose tree except closed work and the GENERATED
     index. Closed work predates the contract by definition, and a generated file carries whatever
     its generator writes. */
  const needFrontmatter = (f) => (f.startsWith(DOCS + '/') || f.startsWith(TRACKS + '/'))
    && !f.startsWith(ARCHIVE + '/') && f !== INDEX_FILE
    // A stub's only legal content is the import line (rule 12), so a frontmatter block in one
    // is a second finding there: demanding it here would leave a stub under the docs root with
    // no form that passes both rules.
    && !isStub(f);

  for (const f of files) {
    const abs = resolve(f);
    const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(text);
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    // Prose, line-aligned with the FILE so a reported line number can be opened. stripCode() is
    // kept for whole-text tests; per-line work uses proseLines + fmOffset.
    const body = stripFrontmatter(text);
    const fmOffset = text.split('\n').length - body.split('\n').length;
    let inFence = false;
    const proseLines = body.split('\n').map((l) => {
      if (/^\s*```/.test(l)) { inFence = !inFence; return ''; }
      return inFence ? '' : l.replace(/`[^`\n]*`/g, '`');
    });
    const prose = proseLines.join('\n');

    applied(1);
    /* 1. THE CAPS, and they are hard failures rather than guidance because the prose versions of
          the same limits were violated over and over: a limit nobody enforces is a limit that
          records what happened. Over the cap is a signal the doc is doing two jobs — split it
          with scripts/harness/split-doc.js, which cannot lose a line. */
    const cap = capFor(f);
    if (!frozenEvidence(f, fm) && lines > cap) softenable(f, `${lines} lines > cap ${cap}`);

    applied(2);
    // 2. frontmatter: fields, enums, unique id, the receipt
    if (needFrontmatter(f)) {
      if (!fm) { fail(f, 'no frontmatter block'); continue; }
      for (const k of ['id', 'kind', 'status', 'read_when']) if (!fm[k]) fail(f, `frontmatter missing \`${k}\``);
      if (fm.kind && !KINDS.includes(fm.kind)) fail(f, `kind: ${fm.kind} not one of ${KINDS.join('|')}`);
      if (fm.status && !STATUSES.includes(fm.status)) fail(f, `status: ${fm.status} not one of ${STATUSES.join('|')}`);
      /* A DUPLICATE id is refused, not warned. The generated index is keyed by id and a handoff
         cites one; two docs answering to the same id means a pointer that resolves to whichever
         the walk reached first. */
      if (fm.id) {
        if (ids.has(fm.id)) fail(f, `duplicate id \`${fm.id}\` (also ${ids.get(fm.id)})`);
        else ids.set(fm.id, f);
      }
      if (fm.status === 'complete' && !fm.receipt) fail(f, 'status: complete without a `receipt:` — only close-phase.js may write one');
      /* The receipt lives in frontmatter and is RECOMPUTED here with close-phase.js's own
         function rather than a second copy of the formula. The track id comes from the FOLDER,
         which is what close-phase was invoked with. A typed receipt cannot survive this. */
      if (fm.receipt) {
        const trackId = (f.match(new RegExp('^' + TRACKS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/([^/]+)/')) || [])[1];
        const missing = ['closed_phase', 'gates_sha', 'block_sha'].filter((k) => !fm[k]);
        if (!trackId) fail(f, `\`receipt:\` outside a track folder — close-phase.js writes one only into ${TRACKS}/<id>/`);
        else if (missing.length) fail(f, `\`receipt:\` without ${missing.map((k) => '`' + k + '`').join(', ')} — the receipt cannot be recomputed, so it proves nothing`);
        else if (!receiptFor) { /* declared once, below the loop: an unanswerable check is a skip */ }
        else if (receiptFor(trackId, fm.closed_phase, fm.gates_sha, fm.block_sha) !== fm.receipt) {
          fail(f, '`receipt:` does not recompute from closed_phase + gates_sha + block_sha — only close-phase.js writes a valid one');
        }
      }
      /* Name the offending VALUE: now that the match is on the word rather than the whole string,
         a `mixed (… one external report)` doc can trip this, and "source: external" as a message
         would send the author looking for a field that does not say that. */
      if (untrustedBannerMissing(fm, body)) fail(f, `source: \`${fm.source}\` declares external content, but the body carries no \`⚠ UNTRUSTED\` banner`);
    }

    applied(3);
    /* 3. A GATE FIGURE belongs in gates.json or the baseline, never in PROSE. The escape hatch
          must SAY WHY: a bare tag is a reflex, a reason is a decision. hasFigureOk, not a second copy of
          the pattern — the write guard decides the same question, and the two had each spelled it
          themselves. It strips code first, so a tag QUOTED in prose is quoting rather than
          claiming. */
    if (!frozenEvidence(f, fm) && !hasFigureOk(text)) {
      const bare = /^<!--\s*figure-ok\s*-->\s*$/m.test(stripCode(text))
        ? '  (the tag here has no reason; a bare one does not count)' : '';
      for (const [i, line] of prose.split('\n').entries()) {
        if (GATE_FIGURE.test(line) && !/^\s*(\||\d+\.\s)?\s*(https?:|\/\/)/.test(line)) {
          fail(f, `line ${fmOffset + i + 1}: gate figure \`${(line.match(GATE_FIGURE) || [])[0]}\` in prose — read it from gates.json, or tag the file \`<!-- figure-ok: <why> -->\`${bare}`);
          break;
        }
      }
    }

    applied(4);
    /* 4. A bare `trap #n` where the doc declares a prefix. Traps are cited across docs and across
          sessions; `#3` is ambiguous the moment a second track exists. */
    if (!historyExempt(f) && fm && fm.trap_prefix && /trap\s+#\d+/i.test(prose)) {
      fail(f, `bare \`trap #n\` — this track's traps are \`${fm.trap_prefix}-nn\``);
    }

    applied(5);
    /* 5. A ▶ BLOCK (a ▶ heading) may exist only in handoff.md, at most ONE. "What next" living in
          two places is how a session picks up the wrong one, and a handoff that is appended to
          rather than replaced is a stack of stale instructions with the oldest on top. Prose may
          name the glyph — the rule is about where "what next" lives, not about the character. */
    const blocks = (prose.match(/^#{1,4}\s*▶/gm) || []).length;
    if (blocks && !historyExempt(f) && !/\/handoff\.md$/.test(f)) fail(f, '▶ block outside handoff.md — "what next" lives in exactly one place');
    if (blocks > 1) fail(f, `${blocks} ▶ blocks — a handoff carries exactly one`);

    applied(6);
    // 6. dead relative links and dead §N references
    if (!historyExempt(f)) {
      for (const m of body.matchAll(/\]\((?!https?:|#)([^)#\s]+\.md)(#[^)\s]*)?\)/g)) {
        const target = path.resolve(path.dirname(abs), m[1]);
        if (!fs.existsSync(target)) softenable(f, `dead link ${m[1]}`);
      }
    }
    const own = headingNums(text);
    /* Resolve a named doc from the referring folder, then from the repo root (`AGENTS.md §0`
       written inside a track folder means the ROOT AGENTS.md), and finally anywhere in the tree
       whose path ends with the token, so `DOC-STANDARD.md` written without its folder still
       resolves. */
    const findDoc = (tok) => {
      const direct = [path.resolve(path.dirname(abs), tok), resolve(tok)].find(fs.existsSync);
      if (direct) return direct;
      const hit = allDocs.find((d) => d === tok || d.endsWith('/' + tok));
      return hit ? resolve(hit) : null;
    };
    const folderHas = (dir, n) => fs.readdirSync(dir).filter((x) => x.endsWith('.md'))
      .some((x) => headingNums(fs.readFileSync(path.join(dir, x), 'utf8')).has(n));
    /* Both § loops read the RAW body: stripCode() eats the `path.md` span they key on.
       A reference names either a file (`X.md §3`) or, since the splits, a FOLDER (`docs/x/ §3`).
       Either way the § resolves against the whole folder, because that is where a split § now
       lives — this rule is what stops a split from silently orphaning a pointer. */
    if (!frozenEvidence(f, fm)) {
      for (const m of body.matchAll(/([A-Za-z0-9_\-./]+\.md|[A-Za-z0-9_\-.]+\/[A-Za-z0-9_\-./]*\/)[^\n§]{0,20}§\s*(\d+)/g)) {
        const named = m[1];
        const dir = named.endsWith('/')
          ? (fs.existsSync(resolve(named)) ? resolve(named) : null)
          : (findDoc(named) ? path.dirname(findDoc(named)) : null);
        if (!dir || !folderHas(dir, m[2])) softenable(f, `\`${named} §${m[2]}\` resolves to no heading`);
      }
      for (const m of body.matchAll(/(^|[^.\w/])§\s*(\d+)/g)) {
        const before = body.slice(0, m.index);
        if (/(?:[A-Za-z0-9_\-./]+\.md|[A-Za-z0-9_\-.]+\/[A-Za-z0-9_\-./]*\/)[^\n§]{0,20}$/.test(before)) continue; // checked above
        if (!own.has(m[2]) && !folderHas(path.dirname(abs), m[2])) softenable(f, `\`§${m[2]}\` resolves to no heading in this doc or its folder`);
      }
    }

    applied(7);
    /* 7. EVERY traps line must cite a path that resolves TODAY. A trap you cannot check is a
          rumour, and a rumour in a traps file is read as a constraint by every session after. */
    if (/\/traps\.md$/.test(f) || (fm && fm.kind === 'traps')) {
      // Read the RAW line: stripCode() removes the very code span this check looks for. ANY cited
      // path that resolves anchors the trap — the first one cited need not be the anchor.
      for (const [i, line] of stripFrontmatter(text).split('\n').entries()) {
        if (!/^[-*]\s|^\|\s*[A-Z]+-\d+/.test(line)) continue;
        const cites = [...line.matchAll(/`([A-Za-z0-9_\-./]+\.(?:js|jsx|cjs|mjs|ts|tsx|json|sql|md|html|css|yml|yaml|sh))(?::\d+(?:-\d+)?)?`/g)].map((m) => m[1]);
        // pathIsReal, not existsSync: a path this repo deliberately gitignores is real and absent,
        // and telling that apart from a citation nobody can follow is the whole point.
        if (!cites.some(pathIsReal)) {
          fail(f, `line ${fmOffset + i + 1}: no cited path resolves${cites.length ? ` (tried ${cites.slice(0, 3).map((c) => '`' + c + '`').join(', ')})` : ' — the trap cites none'}`);
        }
      }
    }

    applied(8);
    /* 8. FROZEN EVIDENCE: the BODY may not change after it is committed; the FRONTMATTER may, so
          the index can carry a doc's status without the finding being reopened. Findings are
          dated, not maintained — a measurement edited to stay current is no longer a measurement
          of anything, and the date on it then lies.
          Keyed on what the file IS, never on where it sits: the evidence folder's own README lives
          among the evidence and is `kind: index`, so a path rule made adding a row to the index OF
          explorations read as editing a frozen finding, which left adding an exploration an
          illegal move. The predicate is doc-frozen.cjs's, shared with the write guard, so the two
          cannot answer this differently again. */
    if (frozenBody(fm)) {
      const head = git('show', `HEAD:${f}`);
      if (head.status === 0 && stripFrontmatter(head.stdout.replace(/\r\n/g, '\n')).trim() !== stripFrontmatter(text).trim()) {
        fail(f, 'frozen evidence edited — findings are dated, not maintained');
      }
      const log = git('log', '--oneline', '--', f);
      if (log.status === 0 && log.stdout.trim().split('\n').filter(Boolean).length > 1) soft(f, 'frozen evidence has more than one commit');
    }

    applied(12);
    /* 12. EXACTLY ONE POLICY BODY. A tool that does not load the policy file natively reaches it
           through a stub, and the stub is a POINTER: the import line and comments, nothing a rule
           lives in. A second file carrying rules is the failure, because two bodies drift and the
           drift is silent: each tool goes on obeying its own copy. Root or nested, the same
           rule, and a stub with no policy file beside it imports nothing at all, which leaves
           its tool with no policy while every other tool has one. An EMPTY policy file is no
           policy file: it exists, and every tool that loads it holds nothing.
           The other direction is held too. A tool that reaches the policy through a stub loads
           NOTHING for a directory whose policy file has no stub beside it, so for every ENABLED
           tool of that kind a policy file without its stub fails, root or nested. And the policy
           file imports nothing: a tool that resolves imports would pull the imported file into
           every session, while the context gate charges the policy file's own bytes and no more.
           Announced for every file and decided only for a stub or a policy file, like rule 4:
           evaluated is not the same as fired. */
    if (isStub(f)) {
      const beside = TOOLS.hasPolicyBody(readOrNull(path.join(path.dirname(abs), POLICY_FILE)));
      for (const m of TOOLS.stubFindings(text, beside)) fail(f, 'import stub: ' + m);
    }
    if (isPolicy(f)) {
      for (const s of NEEDED_STUBS) {
        if (!fs.existsSync(path.join(path.dirname(abs), s))) {
          fail(f, 'policy file: no `' + s + '` stub beside it — an enabled tool reaches ' + POLICY_FILE + ' only through that stub, so it loads no policy for this directory (the stub holds the one line `' + TOOLS.IMPORT_LINE + '`)');
        }
      }
      for (const t of TOOLS.importTokens(prose)) {
        if (!importResolves(t.path, path.dirname(abs))) continue;
        fail(f, 'policy file: line ' + (t.line + fmOffset) + ' imports `@' + t.path + '` — a tool that resolves imports loads that file into every session and the context gate charges only this file\'s own bytes; cite the path in backticks instead');
      }
    }

    applied(9);
    /* 9. STALENESS — WARN only, deliberately and permanently. See the header: a doc going red
          because a date passed says nothing about whether what it describes changed, and the
          cheapest way to clear that red is to re-date the doc, which converts a verified claim
          into an unverified one while the gate turns green. */
    if (fm && fm.last_verified && fm.max_age_days) {
      const age = (Date.now() - Date.parse(fm.last_verified)) / 86400000;
      if (age > Number(fm.max_age_days)) soft(f, `last_verified ${fm.last_verified} is ${Math.round(age)} d old (max_age_days ${fm.max_age_days})`);
    }
    if (fm && fm.kind === 'plan' && fm.first_commit) {
      // -F: --grep is a BASIC regex, so escaping `(` to `\(` turns a commit subject like
      // `chore(harness): …` INTO a group and the match silently fails. Fixed-string, not escaped.
      const found = git('log', '--oneline', '-F', '--grep', fm.first_commit, '-i');
      if (found.status === 0 && !found.stdout.trim()) soft(f, `first_commit "${fm.first_commit}" is not in git log yet`);
    }
  }

  // 10. the auto-memory index: one line per memory. OUTSIDE the repo, so `outside`, never `fail`.
  //     The sweep itself is one application; a box that cannot make it declares one skip below.
  const memory = readMemory(MEMORY_MD);
  if (memory != null) {
    applied(10);
    for (const m of memoryFindings(memory)) outside('MEMORY.md', m);
  }

  applied(11);
  // 11. slop, on ADDED lines only, warn. The diff is the scope on purpose: sweeping the whole tree
  //     would make every pre-existing em-dash a standing warning nobody reads.
  const diff = git('diff', '--unified=0', '--', DOCS, ...INSTRUCTION_NAMES);
  if (diff.status === 0) {
    const hits = diff.stdout.split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++') && SLOP.test(stripCode(l.slice(1))));
    if (hits.length) soft('git diff', `${hits.length} added line(s) carry slop markers (em-dash / delve / leverage / seamless), e.g. ${JSON.stringify(hits[0].slice(1, 90))}`);
  }
  // `memorySwept` is the ONE answer to "did rule 10 run", read by the skip below. Asking the
  // filesystem a second time there (it once did, with existsSync) let a file that exists and
  // cannot be read land in neither bucket: not applied, not skipped, and the total one short.
  return { files, memorySwept: memory != null };
}

/* ---------- --self-test ---------- */
function selfTest() {
  let CHECKS = 0;
  const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(`${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };
  // The caps, driven against a LITERAL table rather than the live config: the decision under test
  // is "which cap applies to this path", and feeding it the repo's own numbers would make the test
  // restate the config instead of exercising the rule.
  const caps = { 'POLICY.md': 80, 'STUB.md': 5, 'docs/reference/long.md': 400, subtreeAgentsMd: 50, default: 150 };
  const NAMES = ['POLICY.md', 'STUB.md'];
  const cap = (p) => capFor(p, caps, undefined, NAMES);
  eq('cap: the root policy file', cap('POLICY.md'), 80);
  eq('cap: the root stub', cap('STUB.md'), 5);
  eq('cap: a subtree policy file', cap('scripts/POLICY.md'), 50);
  eq('cap: a deep subtree policy file', cap('a/b/c/POLICY.md'), 50);
  eq('cap: a subtree stub is capped as its subtree is', cap('scripts/STUB.md'), 50);
  eq('cap: a lookalike name is any other doc', cap('scripts/MY-POLICY.md'), 150);
  eq('cap: a root instruction file with no key of its own is NOT a subtree file', capFor('POLICY.md', { subtreeAgentsMd: 50, default: 150 }, undefined, NAMES), 150);
  // The names this gate sweeps for come from the registry. Pinned against the shipped one, because
  // a registry that stopped naming a stub would turn rule 12 into a rule with no subject.
  eq('names: the policy file is swept, first', INSTRUCTION_NAMES[0], POLICY_FILE);
  eq('names: the shipped registry names at least one import stub', STUBS.length > 0, true);
  eq('names: no stub is the policy file itself', STUBS.includes(POLICY_FILE), false);
  eq('stub: a nested stub is one', STUBS.every((s) => isStub('a/b/' + s) && isStub(s)), true);
  eq('stub: the policy file is not one', isStub(POLICY_FILE) || isStub('a/' + POLICY_FILE), false);
  eq('stub: a pointer and nothing else passes', TOOLS.stubFindings('<!-- pointer -->\n' + TOOLS.IMPORT_LINE + '\n', true), []);
  eq('stub: a rule in the stub is a second policy body', TOOLS.stubFindings(TOOLS.IMPORT_LINE + '\n\n- Never push.\n', true).length, 1);
  eq('stub: a stub with no policy file beside it fails', TOOLS.stubFindings(TOOLS.IMPORT_LINE + '\n', false).length, 1);
  eq('policy: the policy file is one, root or nested, and a stub is not', [isPolicy(POLICY_FILE), isPolicy('a/b/' + POLICY_FILE), STUBS.some(isPolicy), isPolicy('a/MY-' + POLICY_FILE)], [true, true, false, false]);
  eq('policy: an empty policy file is no policy file', [TOOLS.hasPolicyBody(''), TOOLS.hasPolicyBody('<!-- todo -->\n'), TOOLS.hasPolicyBody('# Rules\n')], [false, false, true]);
  eq('needed stubs: every one is a stub name', NEEDED_STUBS.every((s) => STUBS.includes(s)), true);
  eq('import: a token under the home directory is flagged without touching the disk', importResolves('~/.x/rules.md', ROOT), true);
  eq('import: a token that names no file loads nothing', importResolves('no-such-file-here.md', ROOT), false);
  eq('import: a token that names this script resolves', importResolves(path.basename(__filename), __dirname), true);
  eq('import: prose in backticks is not an import', TOOLS.importTokens('the line `` and nothing else'), []);
  eq('cap: any other doc', capFor('docs/reference/routes.md', caps), 150);
  eq('cap: an exact path key beats the default', capFor('docs/reference/long.md', caps), 400);
  // Compared with ===: JSON.stringify turns Infinity into null, which would equal a missing cap.
  eq('no cap: the generated index', capFor('docs/INDEX.md', caps, 'docs/INDEX.md') === Infinity, true);
  eq('no cap: the index follows the configured docs root', capFor('prose/INDEX.md', caps, 'prose/INDEX.md') === Infinity, true);
  eq('capped: an INDEX.md that is not THE index', capFor('docs/reference/INDEX.md', caps, 'docs/INDEX.md'), 150);
  eq('cap: an explicit key on the index still wins', capFor('docs/INDEX.md', Object.assign({ 'docs/INDEX.md': 300 }, caps), 'docs/INDEX.md'), 300);
  // The exempt-dir predicates, driven with an explicit list for the same reason.
  const dirs = { dirs: ['docs/archive', 'docs/explorations', 'docs/tracks'], tracksDir: 'docs/tracks' };
  eq('exempt: archive', capExempt('docs/archive/x.md', dirs), true);
  eq('exempt: explorations', capExempt('docs/explorations/x.md', dirs), true);
  eq('NOT exempt: reference', capExempt('docs/reference/x.md', dirs), false);
  eq('NOT exempt: a lookalike prefix', capExempt('docs/archived-notes/x.md', dirs), false);
  // THE HAZARD a configurable list introduced: a repo may exempt its tracks dir from the CAPS,
  // and that must not switch off the ▶-block rule, which exists for tracks and nowhere else.
  eq('caps: an exempted tracks dir is exempt', capExempt('docs/tracks/x/README.md', dirs), true);
  eq('structure: an exempted tracks dir is NOT exempt', historyExempt('docs/tracks/x/README.md', dirs), false);
  eq('structure: the archive still is', historyExempt('docs/archive/x.md', dirs), true);
  eq('frozen evidence: a research file', frozenEvidence('docs/tracks/x/research/a.md', { kind: 'research' }, dirs), true);
  eq('frozen BODY: an exploration', frozenBody({ kind: 'exploration' }), true);
  eq('frozen BODY: a research file, wherever it now sits', frozenBody({ kind: 'research' }), true);
  eq('NOT a frozen body: the index OF the evidence', frozenBody({ kind: 'index' }), false);
  eq('NOT a frozen body: a track README', frozenBody({ kind: 'track' }), false);
  eq('NOT a frozen body: no frontmatter at all', frozenBody(null), false);
  // The escape hatch. The FIRST case is the load-bearing one: a tag that stopped working would
  // make every doc carrying one illegal, which is a far worse outcome than the tightening below.
  eq('figure-ok: a reasoned tag exempts', hasFigureOk('<!-- figure-ok: dated phase record, not current -->'), true);
  eq('figure-ok: a bare tag does not', hasFigureOk('<!-- figure-ok -->'), false);
  eq('figure-ok: a one-word reason is too short to count', hasFigureOk('<!-- figure-ok: why -->'), false);
  eq('figure-ok: a tag quoted in a code span is quoting, not claiming', hasFigureOk('tag it `<!-- figure-ok: dated phase record, not current -->` like so'), false);
  eq('figure-ok: and in a fence too', hasFigureOk('```\n<!-- figure-ok: dated phase record, not current -->\n```'), false);
  // Rule 10's decision, driven with literals because its real input lives outside the repo and a
  // test must never write to it.
  const long = '- [x](x.md) ' + 'y'.repeat(200);
  eq('auto-memory: an over-long pointer is a finding', memoryFindings(long).length, 1);
  eq('auto-memory: a short pointer is not', memoryFindings('- [x](x.md) hook'), []);
  eq('auto-memory: only pointer lines are judged', memoryFindings('# ' + 'y'.repeat(200)), []);
  eq('auto-memory: an absent index decides nothing', memoryFindings(null), []);
  eq('auto-memory: the finding names the line and the length', /^line 1: \d+ chars > 160/.test(memoryFindings(long)[0]), true);
  // The DERIVED project directory name. This is the generalisation that turned rule 10 from a
  // no-op on every machine but one into a rule that runs everywhere, so both platform spellings
  // are pinned.
  eq('memory path: a Windows root flattens drive and separators', projectDirName('C:\\Projects\\example'), 'C--Projects-example');
  eq('memory path: a POSIX root flattens separators', projectDirName('/home/u/code/example'), '-home-u-code-example');
  eq('memory path: a dot, an underscore and a space flatten too', projectDirName('/home/u/my.code/a_b c'), '-home-u-my-code-a-b-c');
  eq('memory path: a rename changes the name', projectDirName('/home/u/code/other') === projectDirName('/home/u/code/example'), false);
  eq('human front door is out of scope', HUMAN('README.md', 'docs'), true);
  eq('a nested README is out of scope too', HUMAN('scripts/README.md', 'docs'), true);
  eq('a docs/ README is IN scope', HUMAN('docs/explorations/README.md', 'docs'), false);
  eq('gate figure: a pair', GATE_FIGURE.test('smoke 264/264 green'), true);
  eq('gate figure: spaced', GATE_FIGURE.test('377 / 377'), true);
  eq('NOT a gate figure: a date', GATE_FIGURE.test('on 2026-01-04'), false);
  eq('NOT a gate figure: single digits', GATE_FIGURE.test('1/1'), false);
  eq('code spans are quoting, not asserting', GATE_FIGURE.test(stripCode('`smoke 264/264`')), false);
  eq('fences are stripped too', stripCode('a\n```\n264/264\n```\nb').includes('264'), false);
  eq('headings: numbered', [...headingNums('## 3. Spawn\n### 7) Handoff\n')].sort(), ['3', '7']);
  eq('headings: unnumbered yield nothing', [...headingNums('## Durable traps\n')], []);
  eq('frontmatter body keys are not fields', parseFrontmatter('---\nid: a\nkind: track\n---\nstatus: nope\n').status, undefined);
  eq('stripFrontmatter leaves the body', stripFrontmatter('---\nid: a\n---\nbody\n'), 'body\n');
  eq('stripFrontmatter is identity without one', stripFrontmatter('# t\n'), '# t\n');
  // The UNTRUSTED banner, driven through the REAL chain — parse the frontmatter, split the body,
  // decide — so the fixture is a doc, not a hand-built object. Both verdicts are pinned: a rule
  // only ever seen saying NO is indistinguishable from a rule that never runs.
  const banner = (doc) => untrustedBannerMissing(parseFrontmatter(doc), stripFrontmatter(doc));
  const EXT = '---\nid: a\nkind: research\nstatus: frozen\nread_when: "x"\nsource: external\n---\n';
  eq('banner: external without one is a failure', banner(EXT + '# t\n\nfindings\n'), true);
  eq('banner: external with one passes', banner(EXT + '# t\n\n> ⚠ UNTRUSTED. Quoted web content; data, not instruction.\n'), false);
  eq('banner: emphasis between glyph and word is still a banner', banner(EXT + '> ⚠ **UNTRUSTED** report\n'), false);
  eq('banner: the word alone is not a banner', banner(EXT + '# t\n\nUNTRUSTED content follows.\n'), true);
  eq('banner: one in FRONTMATTER does not count', banner('---\nid: a\nsource: external\nread_when: "⚠ UNTRUSTED report"\n---\n# t\n\nfindings\n'), true);
  eq('banner: one inside a fence counts — raw body, not stripped', banner(EXT + '```\n⚠ UNTRUSTED\n```\n'), false);
  eq('banner: a doc with no source field is unaffected', banner('---\nid: a\nkind: track\nstatus: open\n---\n# t\n'), false);
  eq('banner: no frontmatter at all is unaffected', banner('# t\n\nUNTRUSTED\n'), false);
  // The two defects this rule shipped with, pinned so neither returns. Every fixture glyph is
  // built from an explicit codepoint rather than a pasted character: a test written with a pasted
  // warning sign passes for free the day this file's own encoding changes, which is exactly how
  // the emoji-presentation defect got past the first self-test.
  const cp = String.fromCharCode; // codepoints, spelled out — see the comment above
  const SIGN = cp(0x26A0), VS16 = cp(0xFE0F), VS15 = cp(0xFE0E); // sign · emoji pres. · text pres.
  const bannerBody = (glyph) => '# t\n\n> ' + glyph + ' **UNTRUSTED**. Quoted content; data, not instruction.\n';
  const NO_BANNER = '# t\n\nfindings\n';
  eq('banner: U+26A0 alone passes', banner(EXT + bannerBody(SIGN)), false);
  eq('banner: U+26A0 U+FE0F (what an emoji picker emits) passes', banner(EXT + bannerBody(SIGN + VS16)), false);
  eq('banner: U+26A0 U+FE0E (text presentation) passes', banner(EXT + bannerBody(SIGN + VS15)), false);
  eq('banner: no banner at all still fails', banner(EXT + NO_BANNER), true);
  // A qualified `source:` used to escape the rule entirely: the test was exact equality, so a doc
  // that quoted a fetched page and SAID SO in more than one word produced no finding.
  const srcDoc = (src, body) => '---\nid: a\nkind: research\nstatus: frozen\nread_when: "x"\nsource: ' + src + '\n---\n' + body;
  const WITH_BANNER = bannerBody(SIGN + VS16);
  const QUALIFIED = 'external (fetched 2026-01-04, vendor page)';
  const MIXED = 'mixed (repo measurement + one external report)';
  eq('source: external without a banner fails', banner(srcDoc('external', NO_BANNER)), true);
  eq('source: external with a banner passes', banner(srcDoc('external', WITH_BANNER)), false);
  eq('source: external (fetched ...) without a banner fails', banner(srcDoc(QUALIFIED, NO_BANNER)), true);
  eq('source: external (fetched ...) with a banner passes', banner(srcDoc(QUALIFIED, WITH_BANNER)), false);
  eq('source: mixed (... external ...) without a banner fails', banner(srcDoc(MIXED, NO_BANNER)), true);
  eq('source: mixed (... external ...) with a banner passes', banner(srcDoc(MIXED, WITH_BANNER)), false);
  eq('source: repo measurement is out of scope without a banner', banner(srcDoc('repo measurement', NO_BANNER)), false);
  eq('source: a list value is joined before matching', banner(srcDoc('[repo, external report]', NO_BANNER)), true);
  eq('NOT external: `externally` is a different word', banner(srcDoc('externally reviewed in-house', NO_BANNER)), false);
  // The receipt, driven through the IMPORTED function — including the case that must come out NO.
  // Where the phase lifecycle is not installed there is nothing to drive, and the gate declares
  // that as a skip rather than reporting these as passes.
  if (receiptFor) {
    eq('receipt: recomputes from its own parts', receiptFor('t', '4', 'g', 'b'), receiptFor('t', '4', 'g', 'b'));
    eq('receipt: a different track does not verify', receiptFor('a', '4', 'g', 'b') === receiptFor('b', '4', 'g', 'b'), false);
    eq('receipt: a different phase does not verify', receiptFor('t', '4', 'g', 'b') === receiptFor('t', '5', 'g', 'b'), false);
    eq('receipt: a typed hex string does not verify', receiptFor('t', '4', 'g', 'b') === 'deadbeef', false);
  }
  eq('slop: em-dash', SLOP.test('a — b'), true);
  eq('slop: delve', SLOP.test('we delve into'), true);
  eq('NOT slop: an ASCII hyphen', SLOP.test('a - b'), false);
  eq('NOT slop: "leveraging" is not "leverage"', SLOP.test('leveraging'), false);
  // The decision that turns a deleted call site into a NAMED failure. Literals, because the live
  // sweep is what drives the real one and a self-test that drove it too would be asserting its own
  // conclusion.
  eq('rules: a full sweep leaves nothing unapplied', rulesNotApplied([1, 2, 3], new Set([1, 2, 3])), []);
  eq('rules: a deleted call site is named', rulesNotApplied([1, 2, 3], new Set([1, 3])), [2]);
  eq('rules: an untallied rule that ran is not a finding', rulesNotApplied([1, 2], new Set([1, 2, 10])), []);
  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — docs-lint.cjs self-test (' + CHECKS + ' checks)');
  return CHECKS; // half the gate verdict below; the count is the point, see THE COUNT
}

/* THE SESSION-START REPORT, as the handler every guard exposes: gatherSessionStart() is the disk
   half (one file, outside the repo), decideSessionStart(event, state) is pure and never denies.
   scripts/harness/hook.js calls the pair; --memory-check below is this file's own CLI for it and
   prints the one wire format it always printed. The event is not read. */
function gatherSessionStart() {
  return { file: MEMORY_MD, text: readMemory(MEMORY_MD) };
}
function decideSessionStart(event, state) {
  const s = state || {};
  const findings = s.text == null ? [] : memoryFindings(s.text);
  if (!findings.length) return { deny: false, reason: '' };
  return {
    deny: false,
    reason: '',
    context: [
      '*** THE AUTO-MEMORY INDEX IS CARRYING MEMORIES, NOT POINTERS ***',
      s.file,
      '',
      'Every line here is read into context at the start of every session on this machine,',
      'so a line that carries the memory instead of pointing at it is paid for again and',
      'again. One line per memory: a title, a link, and a hook short enough to scan.',
      '',
      ...findings.map((x) => '  - ' + x),
      '',
      'The doc gate does not go red for anything in this file: it is outside the repo, and a',
      'gate figure that moves with its content would mean something different on every',
      'machine. That is why this arrives here instead.',
    ].join('\n'),
    message: 'Auto-memory index: ' + findings.length + ' over-long line(s) — see context.',
  };
}

/* Loaded by another script: export the report and STOP. Everything below this line is the CLI,
   and it lints, prints and exits. `return` at the top level of a CommonJS module ends the load. */
if (AS_MODULE) { module.exports = { decideSessionStart, gatherSessionStart, memoryFindings }; return; }

if (args.includes('--self-test')) { selfTest(); process.exit(0); }

/* --memory-check: rule 10, at SessionStart, where it can still bite.
   The doc gate deliberately does not fail on what this file CONTAINS, because it lives outside
   the repo and a verdict that moves with it is a verdict that means something different on every
   box. That leaves the rule real and unenforced, which is half a fix. This is the other half: the
   index is on THIS machine, the startup context it protects is paid on THIS machine, and a
   SessionStart hook is the one place both of those are true.

   WHY ITS FINDINGS ARE NOT IN THE GATE, stated once so nobody moves them back: a gate figure
   derived from the content of a file outside the repo cannot be compared against a baseline. The
   same commit would grade differently on a laptop, on a teammate's clone and in CI, and the first
   time that happened the conclusion drawn would be that the harness is flaky rather than that
   its input is not in the tree.

   Shaped after the env guard's re-arm check rather than invented: silent while clean, wrapped
   whole, and ALWAYS exit 0. A SessionStart hook that throws takes the session with it, and no
   reminder is worth a dead session. Returns before the lint below, which must not run here. */
if (args.includes('--memory-check')) {
  try {
    const v = decideSessionStart(null, gatherSessionStart());
    if (v.context) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: v.context },
        systemMessage: v.message,
      }));
    }
  } catch { /* a reminder that throws is worse than one that stays quiet */ }
  process.exit(0);
}

/* The self-test runs on EVERY invocation: its count is half the verdict below, and a linter whose
   own decisions have regressed has no business reporting a clean sweep. It exits 1 by itself if it
   fails, which reaches gates.js as NO VERDICT rather than as green. */
const decisions = selfTest();
const { files, memorySwept } = lint();

/* An EMPTY prose tree is a skip, not a wall of failures. With no doc in scope, every per-file rule
   is correctly reported as never applied, and ten "rule N never ran" lines bury the one fact that
   explains them all. The rule-application check is therefore suppressed in that one case and the
   shortfall is declared instead — which is still not a pass: `skipped=1` is red unless the caller
   tolerates it with `--allow-skip docs=n`. */
if (files.length === 0) {
  skip('the whole sweep', `no documents in scope under ${DOCS}/ or ${TRACKS}/ — nothing was graded`);
} else {
  // A rule that never announced itself did not run. Named, not left to a figure comparison.
  for (const n of rulesNotApplied(TALLIED_RULES, seenRules)) {
    fail('docs-lint', `rule ${n} never ran — its call site is gone, or nothing reached it`);
  }
}
if (receiptUnavailable) skip('the receipt recompute', receiptUnavailable + ' — `status: complete` still needs a `receipt:`, but whether it recomputes cannot be answered here');
/* THE SKIP. Where the memory index is absent — a clean clone, and CI — rule 10 sweeps nothing,
   and a verdict that still said `skipped=0` would be asserting a check it had not made:
   pass-by-absence, in the gate whose whole job is to catch it. Both verdicts are observed rather
   than assumed: 0 where the index was read, 1 where it was not. The wording differs for a file
   that is there and unreadable, because "no index" would send the reader to create one. */
if (!memorySwept) {
  skip('rule 10 (auto-memory)', fs.existsSync(MEMORY_MD)
    ? 'the index at ' + MEMORY_MD + ' could not be read'
    : 'no index at ' + MEMORY_MD);
}

for (const w of warn) console.log(`WARN  ${w}`);
for (const h of hard) console.error(`FAIL  ${h}`);
for (const s of skips) console.log(`SKIP  ${s}`);
/* Printed apart from all three, because it is none of them: real, outside the repo, and weightless
   in the verdict by design. SessionStart is where this one is enforced. */
for (const e of external) console.error(`OUTSIDE  ${e}  (not tallied: outside the repo — see the SessionStart report)`);
console.log(`docs-lint: ${files.length} files checked, ${applications} rule applications across ${seenRules.size} rules, ${hard.length} failure(s), ${warn.length} warning(s)${GRANDFATHER ? ' [--grandfather]' : ''}`);
/* ---------- the verdict, and it is the LAST stdout line ----------
   THE COUNT. gates.js reds when pass+fail+skipped drops below the baseline total, which is how a
   DELETED check is caught, so the count has to be one that actually falls when a rule stops
   running. Files swept alone would not: delete a rule outright and the same files are still
   walked, and that was measured rather than supposed — removing one rule's call site left this
   GATE line byte-identical. The self-test's decisions do fall, because a rule removed takes its
   literal cases with it and a rule half-removed reds the self-test outright, but a call site can
   be deleted with every literal case left standing, which is exactly what was measured.
   So the tallied unit is the RULE APPLICATION: decisions exercised plus rules applied, one tick
   per rule per file it was evaluated against. A hard finding is a failed check.
   RULE 10 IS EXACTLY ONE CHECK ON EVERY BOX, and that took two tries. Its subject is outside the
   repo, so what it FINDS never enters `hard` (see `outside` above): the file's CONTENT cannot
   move pass or fail. But the first version also left the sweep itself untallied while declaring
   skipped=1 where the file was absent, which made the TOTAL one higher on a box without the index
   than on a box with one. gates.js compares totals, so a baseline accepted on a fresh clone read
   as "a check DISAPPEARED" on the first machine that had an index — and a fresh clone grows one
   the day the runtime first writes a memory, so that was every adopter's false red, on a delay.
   Now the sweep ticks once where the file was read and skips once where it was not: the same
   total everywhere, and only the pass/skipped split moves, which the gate runner already
   stands down for (a declared skip excuses the PASS comparison and nothing else). */
const checks = decisions + applications;
console.log(`GATE docs pass=${Math.max(0, checks - hard.length)} fail=${hard.length} skipped=${skips.length}`);
process.exit(hard.length ? 1 : 0);
