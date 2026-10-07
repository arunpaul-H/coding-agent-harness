#!/usr/bin/env node
/**
 * Commit-hygiene gate (PreToolUse on Bash|PowerShell|mcp__.*).
 *
 * Intercepts `git commit` / `git push` and refuses to let one through while the
 * working tree still carries junk: shell-mangled stray files, secrets, build
 * output that should be ignored, oversized blobs, or new clutter in the repo
 * root. A clean tree never sees this gate — it only speaks up when there is
 * something to actually clean. A MODIFIED TRACKED FILE IS NOT A FINDING: work in
 * progress is what a tree is for, and a gate that objected to it would be waived
 * on every commit, which is the same as not having one.
 *
 * One check (10) deliberately steps OUTSIDE the working tree and reads settings
 * files from disk: a gitignored file can hold a live access token, and no walk
 * of `git status` can ever see it. See the comment above that rule.
 *
 * WHY THIS EXISTS
 * The harness this is ported from carried a prose warning in its .gitignore
 * ("still read `git status` before `git add`") because the tree kept growing
 * 0-byte files named after fragments of JS — "console.log('", "h.matcher",
 * "f.level", "k!", "likely". Prose does not enforce. This does.
 * The factory, once somebody measured it, was hook commands wrapped in `cmd /c`
 * and run under Git Bash: MSYS rewrote the `/c` into a path, cmd went
 * interactive, and it executed each hook payload as a command line — so every
 * `=>` or `->` in a tool call or its output became a `>` redirect. The wrapper
 * went; this gate stays, because a mis-quoted one-liner in any shell produces
 * the same debris, and the next factory will not announce itself either.
 *
 * DECISION MODEL
 * Findings -> "deny", never a silent warning. A warning that can be scrolled
 * past is the same as no gate. Each finding names the exact remediation, and
 * anything deliberate can be waived with --clear "<reason>", which is recorded.
 *
 * THE WAIVER IS BOUND TO THE TREE STATE. It stores a hash of the tree's status
 * output AND of the scanned settings files' content, so it dies the moment
 * either changes. You cannot clear once and commit freely afterwards — which is
 * what turns a gate into a rubber stamp. Content is in that hash because check
 * 10 reads files `git status` never reports: keyed on status alone, a waiver
 * granted before a token was pasted in went on suppressing the [BLOCK]
 * afterwards. That was a shipped defect, and --self-test now reproduces it in a
 * throwaway repo on every run.
 *
 * IT NEVER QUOTES A SECRET VALUE IT FOUND — only the file. A deny reason is
 * written into the transcript permanently, so a gate that printed the token
 * would be the leak it exists to prevent. The detectors return booleans for
 * exactly that reason: nothing downstream is ABLE to print a match.
 *
 * THE PROJECT SEAM. Where working files may live (`workDirs`) and what may sit
 * at the repo root (`rootAllow`) come from `commitHygiene` in
 * harness.config.json. Nothing about any particular repo is written in here.
 *
 * MODES
 *   --gate              PreToolUse hook mode. Reads the hook JSON on stdin; the
 *                       decision rides in the JSON it prints, never the exit code.
 *   --report            a REAL VERDICT, for CI and for the gate suite: exit 0
 *                       clean, exit 1 with findings, and the last stdout line is
 *                       the GATE line. It ignores waivers on purpose — a waiver is
 *                       one person's decision about one tree on one machine.
 *   --clear "<reason>"  waive the current findings, bound to this tree state.
 *   --self-test         drives every pure decision with literals, then the whole
 *                       analysis against a throwaway git repo.
 *
 * A FILE, NEVER AN INLINE `node -e`, for the exact reason it exists: the shell
 * mangles one-liners and drops the debris this gate hunts.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load, DEFAULTS, ROOT } = require('../config.js');

// The waiver file. Under .claude/ because it is harness bookkeeping, and it must
// be gitignored: it describes one machine's tree and means nothing on another.
const CLEARANCE_REL = '.claude/.commit-hygiene-clearance.json';
const BASELINE_REL = 'scripts/harness/gates.baseline.json';
const HOOK_ENTRY_REL = 'scripts/harness/hook.js';
const LARGE_FILE_BYTES = 1024 * 1024; // 1 MB

/* ── the project seam ───────────────────────────────────────────────────── */

/**
 * Everything project-specific this file knows, read once.
 *
 * SOFT LOAD, WITH THE DOCUMENTED DEFAULTS AS THE FALLBACK. A PreToolUse hook
 * that throws takes the session down with it. Falling back to
 * `DEFAULTS.commitHygiene` is not the gate runner inventing a suite: an invented
 * suite manufactures a green verdict, while a default allow-list for the repo
 * root can only manufacture a FINDING, which is visible and arguable. And the
 * rules that matter most — strays, secrets, .gitignore gaps — need no config.
 */
function context() {
  let cfg = null;
  try { cfg = load({ soft: true }); } catch { cfg = null; }
  const h = (cfg && cfg.commitHygiene) || DEFAULTS.commitHygiene;
  const gate = ((cfg && cfg.gates) || []).find((g) => /commit-hygiene/.test(String(g.command)));
  return {
    repo: ROOT,
    workDirs: h.workDirs || DEFAULTS.commitHygiene.workDirs,
    rootAllow: h.rootAllow || DEFAULTS.commitHygiene.rootAllow,
    docsRoot: (cfg && cfg.project && cfg.project.docsRoot) || DEFAULTS.project.docsRoot,
    // The GATE line's name must be the name the suite registered this command
    // under, or the runner reads the line as belonging to somebody else.
    gateName: gate ? (gate.gateLine || gate.name) : 'hygiene',
  };
}

/* ── shell surface ──────────────────────────────────────────────────────── */

// Names that are legitimately extensionless. Without this, every one of these
// reads as a suspicious 0-byte fragment the first time it appears untracked.
const EXTENSIONLESS_OK = new Set([
  'LICENSE', 'LICENCE', 'NOTICE', 'AUTHORS', 'CONTRIBUTORS', 'COPYING',
  'Makefile', 'Dockerfile', 'Procfile', 'Justfile', 'Rakefile', 'Gemfile',
  'CODEOWNERS', 'VERSION', 'CHANGELOG', 'README', '.gitkeep', '.keep',
]);

// No path anyone means to create contains any of these. A name that does is
// shell debris, not a file.
const SHELL_DEBRIS = /[()'"{}$`+=!<>|;&*?[\]]/;

// Secrets BY NAME. Deliberately does NOT match the .template/.example twins
// that the env guard tells you to read instead — a guard that blocks its own
// recommended alternative trains people to click through it.
const SECRET_NAME =
  /(^|[\\/])(\.env(\.[\w-]+)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?|service-account.*\.json|.*secret.*\.(json|ya?ml))$/i;
const SECRET_EXEMPT = /\.(template|example|sample|dist|md)$/i;

/**
 * Secrets BY VALUE: the token shapes of the well-known issuers.
 *
 * Each one is a literal prefix followed by a body, and the body has a FLOOR
 * rather than the issuer's real length, so a rotated, shortened or half-pasted
 * token is still caught while the two things that legitimately carry a prefix
 * stay quiet — the prefix written in prose (the next character is a space) and
 * a short stub. The lookbehind keeps a prefix from matching mid-word: without
 * it, any hyphenated word ending in the two letters of the fourth row reads as
 * the start of a key.
 *
 * This is a list, and a list is silent about every issuer it does not name.
 * NAMED_CREDENTIAL below is what covers the rest.
 */
const TOKEN_SHAPES = [
  /(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{30,}/g,
  /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9_]{30,}/g,
  /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_-])xox[abprs]-[A-Za-z0-9-]{20,}/g,
  /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}(?![0-9A-Z])/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * A documented placeholder is token-SHAPED but is not a token: a prefix
 * followed by `your_access_token_here` clears any length floor comfortably.
 * Excusing it by CONTENT rather than by filename is deliberate, and is the
 * second shipped defect of this rule.
 *
 * SHIPPED DEFECT #2. The first fix excused the documentation profiles by NAME —
 * settings.{example,template,sample,dist}.json were simply not scanned. That
 * stopped the false fire and opened a worse hole: those files are TRACKED, so a
 * real token pasted into settings.example.json would be committed and pushed,
 * and the rule built to catch a token in a settings file could not see the one
 * settings file that actually publishes it. Name-based exemption asks "which
 * file is this?" when the only safe question is "is this value real?".
 */
const PLACEHOLDER = /(your[_-]|_here\b|placeholder|changeme|change_me|redacted|example|xxxx|<[^>]+>)/i;

// A key whose NAME says it holds a credential, whatever issued the value.
const NAMED_CREDENTIAL = /(token|secret|passw(or)?d|api[_-]?key|private[_-]?key|credential|authorization)/i;
// A run long and mixed enough to be a value rather than a word.
const DENSE_RUN = /[A-Za-z0-9_\-+/=.]{20,}/;
// A reference, a path or a URL is where a secret LIVES, not a secret.
const POINTS_ELSEWHERE = /^(\$|%|~|\.{0,2}[\\/]|[A-Za-z]:[\\/]|https?:)/;

function looksLikeLiteralSecret(value) {
  if (typeof value !== 'string') return false;
  // `${NAME}` interpolation is the CORRECT final state of a settings file, so it
  // must never trip the rule. A guard that fires on its own recommended fix gets
  // switched off within the week.
  if (value.includes('${') || POINTS_ELSEWHERE.test(value) || PLACEHOLDER.test(value)) return false;
  const run = (value.match(DENSE_RUN) || [])[0];
  return Boolean(run && /[A-Za-z]/.test(run) && /\d/.test(run));
}

function namedCredentialIn(node, depth) {
  if (!node || typeof node !== 'object' || (depth || 0) > 12) return false;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string') {
      if (!Array.isArray(node) && NAMED_CREDENTIAL.test(k) && looksLikeLiteralSecret(v)) return true;
    } else if (namedCredentialIn(v, (depth || 0) + 1)) return true;
  }
  return false;
}

/**
 * Does this text carry a literal credential?
 *
 * RETURNS A BOOLEAN AND NEVER THE MATCH. Every match is tested inside this
 * function and discarded, so nothing downstream is able to print what it found.
 * That is the property that keeps the token out of a deny message, a
 * transcript, a CI log and a screenshot of one.
 */
function hasLiteralCredential(text) {
  if (typeof text !== 'string') return false;
  for (const re of TOKEN_SHAPES) {
    re.lastIndex = 0; // /g is stateful; a shared regex must be rewound
    for (const m of text.matchAll(re)) {
      if (!PLACEHOLDER.test(m[0])) return true;
    }
  }
  // The key-name rule needs the structure, so it only runs on text that parses.
  // Text that does not parse still went through the shape list above.
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { return false; }
  return namedCredentialIn(parsed, 0);
}

// Junk that should be ignored rather than committed. Only consulted for files
// git does NOT already ignore — a hit means .gitignore has a real gap.
const SHOULD_BE_IGNORED = [
  [/(^|[\\/])node_modules[\\/]/, 'dependency tree'],
  [/(^|[\\/])(dist|build|out|coverage|\.next|\.turbo|\.vite)[\\/]/, 'build output'],
  [/\.(log|tmp|temp|bak|orig|rej|swp|pid)$/i, 'transient file'],
  [/\.(db|sqlite3?|db-wal|db-shm|db-journal)$/i, 'local database'],
  [/(^|[\\/])(\.DS_Store|Thumbs\.db|desktop\.ini)$/i, 'OS junk'],
  [/\.(tsbuildinfo)$/i, 'compiler cache'],
  [/~$/, 'editor backup'],
];

/**
 * The finding kinds, which are also the CHECKS the GATE line reports. The list
 * is structural: it has the same length on a clean tree and a filthy one, so a
 * rule deleted from analyse() does not quietly shrink the total — the kind is
 * still listed here and still reported as passing nothing it graded.
 */
const KINDS = ['stray', 'gitignore-gap', 'large', 'secret', 'contradiction', 'root', 'orphan-helper'];

/* ── git plumbing ───────────────────────────────────────────────────────── */

function git(args, repo, input) {
  // execFileSync, never a shell string: this gate must not reproduce the
  // quoting accident it was built to catch.
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    input: input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  });
}

/**
 * `git status --porcelain=v1 -z` — NUL-terminated, so a filename containing a
 * space, quote or newline survives intact. The human-readable form quotes and
 * escapes those names, which is precisely the class of name we are hunting.
 */
function readStatus(repo) {
  // --ignored=matching: a stray that happens to match an ignore rule must still
  // be seen. In the original, one over-broad ignore pattern written to hide the
  // debris hid a third of it from the very check hunting it — and a bare
  // `git status` showed a clean tree throughout. Only ROOT-level ignored entries
  // are kept: that is where shell debris lands, and deeper ignored paths (logs,
  // caches) churn and would void waivers for nothing.
  const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], repo);
  const parts = raw.split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const x = rec[0];
    const y = rec[1];
    const file = rec.slice(3);
    // A rename/copy carries its source path in the following NUL-field.
    if (x === 'R' || x === 'C') i++;
    // The waiver file is our own bookkeeping. It must be invisible here: it is
    // written *after* the hash is taken, so including it would make every waiver
    // invalidate itself the instant it was granted.
    if (file === CLEARANCE_REL) continue;
    if (x === '!' && file.includes('/')) continue;
    entries.push({ x, y, file, staged: x !== ' ' && x !== '?' && x !== '!', ignored: x === '!' });
  }
  return entries;
}

/**
 * Everything that may legitimately name a helper: the hook wiring, the gate
 * registry, npm scripts, CI, the two doctrine files and every doc. Read only on
 * a git write (the gate self-filters), so the cost is a little text per commit.
 */
function referenceCorpus(ctx) {
  const parts = [];
  const readIf = (f) => { try { parts.push(fs.readFileSync(f, 'utf8')); } catch { /* absent is fine */ } };
  const walk = (d, re) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, re); }
      else if (re.test(e.name)) readIf(p);
    }
  };
  for (const f of [['.claude', 'settings.json'], ['harness.config.json'], ['package.json'], ['CLAUDE.md'], ['AGENTS.md']]) {
    readIf(path.join(ctx.repo, ...f));
  }
  walk(path.join(ctx.repo, '.github'), /\.(ya?ml)$/);
  walk(path.join(ctx.repo, ...String(ctx.docsRoot).split('/')), /\.md$/);
  // THE ONE HOOK ENTRY IS A ROOT TOO, once something above names it. A tool's hook config
  // registers scripts/harness/hook.js and no guard by name, and that script requires every
  // guard it runs: so what it names is wired exactly as far as it is itself. Read only when
  // it is named, so an entry nothing registers cannot vouch for anything.
  if (parts.join('\n').includes(HOOK_ENTRY_REL)) readIf(path.join(ctx.repo, ...HOOK_ENTRY_REL.split('/')));
  return parts.join('\n');
}

/**
 * Which helpers are WIRED.
 *
 * Being NAMED in the corpus is one way. Being required by something already
 * wired is the other, and this rule once could not see it: a shared predicate
 * loaded by two hooks that settings.json names outright was still called a
 * stray. A waiver was no escape, because a waiver binds to the tree state and
 * voids on the next change — one waiver per commit, which is precisely how a
 * gate becomes a rubber stamp. Naming the file in a doc is what actually cleared
 * it, and a rule you satisfy by writing prose about a file is not checking what
 * it claims to check.
 *
 * REACHABILITY FROM NAMED ROOTS, never "is required by anything". That
 * distinction is the whole rule: a dead helper required only by another dead
 * helper stays dead. Trading a false positive for a blind spot would be worse
 * than the false positive, because the blind spot is silent.
 *
 * Pure — takes the helper names, the corpus text, and a name -> required-names
 * map — so --self-test drives it with literals and no filesystem at all.
 */
function wiredHelpers(names, corpus, requiresOf) {
  const wired = new Set(names.filter((n) => String(corpus).includes(n)));
  for (let grew = true; grew;) {
    grew = false;
    for (const from of [...wired]) {
      for (const to of (requiresOf[from] || [])) {
        if (names.includes(to) && !wired.has(to)) { wired.add(to); grew = true; }
      }
    }
  }
  return wired;
}

/** The helper names a file requires. Line-scoped, so `require(path.join(__dirname, 'x.cjs'))`
 *  reads the same as `require('./x.cjs')` — both spellings turn up in real trees. */
function requiredHelpers(text, names) {
  const lines = String(text).split('\n').filter((l) => l.includes('require('));
  return names.filter((n) => lines.some((l) => l.includes(n)));
}

/**
 * The name half of scannedFiles(), kept pure so --self-test can drive it
 * without a filesystem. EVERY settings JSON is scanned, documentation twins
 * included: settings.json, settings.local.json, settings.work-profile.json and
 * settings.example.json alike.
 *
 * SHIPPED DEFECT #1, and why the fix does not live here. The rule first fired
 * on a settings.example.json carrying the DOCUMENTED placeholder, which is
 * token-shaped — and a guard that blocks its own recommended alternative trains
 * people to click through it. (SECRET_EXEMPT cannot save this case: it tests the
 * trailing extension, and that extension is `.json`.) The obvious repair was to
 * stop scanning the documentation profiles by name. That repair is wrong, and
 * PLACEHOLDER above replaced it: see SHIPPED DEFECT #2. A twin is scanned like
 * any other file, and it stays quiet because its VALUE is a placeholder, not
 * because of what it is called.
 */
function isSettingsFileName(name) {
  return /^settings(?:\.[\w-]+)?\.json$/.test(String(name));
}

/**
 * Every JSON file that can carry an `env` block and that `git status` may never
 * report: the settings files under `.claude/` (the gitignored
 * settings.local.json above all), any settings.<profile>.json beside them, a
 * root settings.json, and the MCP server config. Repo-relative POSIX paths. A
 * directory that cannot be read yields nothing rather than throwing — a missing
 * .claude/ is a normal state, not a gate failure.
 */
function scannedFiles(repo) {
  const out = [];
  let list = [];
  try {
    list = fs.readdirSync(path.join(repo, '.claude'), { withFileTypes: true });
  } catch { /* no .claude/ — nothing to scan */ }
  for (const e of list) {
    if (e.isFile() && isSettingsFileName(e.name)) out.push('.claude/' + e.name);
  }
  for (const f of ['settings.json', '.mcp.json']) {
    if (fs.existsSync(path.join(repo, f))) out.push(f);
  }
  return out.sort();
}

/**
 * A sha256 over the scanned files' CONTENT, folded into treeHash by analyse().
 *
 * SHIPPED DEFECT, and the whole reason this function exists: a waiver bound to
 * a hash built ONLY from `git status` entries, while rule 10's input is BY
 * DESIGN outside git status — that is its entire justification, a gitignored
 * file no status walk can ever see. So a waiver granted for an unrelated stray,
 * BEFORE any token was pasted in, still matched afterwards: the gate found the
 * hashes equal and allowed, so --report showed the [BLOCK] while the commit
 * sailed straight through. A waiver keyed on the tree could not see a finding
 * that by definition lives outside the tree — a rule that cannot fire.
 *
 * The fix is NOT to make secret findings unwaivable; the waiver stays
 * available. It just must not survive the content changing, so pasting a token
 * into a settings file voids every outstanding waiver the moment it lands.
 *
 * Hashes the file BYTES and the path — never the matched token, never a
 * fragment of one — so nothing derived from a secret is ever printable, and the
 * per-file digests fold in sorted path order so the result is stable. A missing
 * or unreadable file folds in as a fixed marker rather than throwing: one
 * absent settings file must not fail the gate, and it must digest the same on
 * every call or a waiver would die of nothing.
 *
 * `read` is injectable so --self-test can assert on this without a disk.
 */
function contentDigest(rels, read) {
  const list = rels.slice().sort();
  const h = crypto.createHash('sha256');
  for (const rel of list) {
    let body;
    try {
      body = crypto.createHash('sha256').update(read(rel)).digest('hex');
    } catch {
      body = 'ABSENT'; // stable, and not a hex digest, so no content collides with it
    }
    h.update(rel + '\0' + body + '\n');
  }
  return h.digest('hex');
}

function sizeOf(repo, rel) {
  try {
    const st = fs.statSync(path.join(repo, rel));
    // A directory entry (a nested repository shows up as one) has no meaningful
    // size, and on some filesystems reports 0 — which would read as a stray.
    return st.isFile() ? st.size : null;
  } catch {
    return null; // deleted between status and stat — not ours to report
  }
}

/* ── the analysis ───────────────────────────────────────────────────────── */

function analyse(ctx) {
  const repo = ctx.repo;
  const entries = readStatus(repo);
  const findings = [];
  const add = (level, kind, file, why, fix) =>
    findings.push({ level, kind, file, why, fix });

  // NOTE WHAT IS NOT HERE: nothing below reads ` M` or `M ` entries as a
  // problem. A modified tracked file is work, not junk.
  const untracked = entries.filter((e) => e.x === '?');
  const staged = entries.filter((e) => e.staged);

  // Checks 1–2 also run over ignored ROOT files: a stray named "(" or "'" used
  // to vanish behind the ignore rules. Checks 3–8 stay on genuinely untracked
  // paths — an ignored file is not a .gitignore gap, a secret leak, or clutter.
  for (const e of entries.filter((e) => e.x === '?' || e.ignored)) {
    const base = path.basename(e.file);
    const size = sizeOf(repo, e.file);

    // 1. Shell debris — punctuation no real path carries.
    if (SHELL_DEBRIS.test(base)) {
      add('BLOCK', 'stray', e.file,
        'filename carries shell/JS punctuation — shell debris, not a file anyone created (a redirect target split out of a payload or a mis-quoted one-liner)',
        'delete it, then find the factory: an inline `node -e`, a hook wrapped in `cmd /c`, or an unquoted arrow in a command line');
      continue;
    }

    // 2. Any 0-byte untracked file. Punctuation-free debris ("likely", "move")
    //    is unmatchable by any safe .gitignore pattern, and an extension is no
    //    defence — a redirect target like `h.matcher`, split out of
    //    `filter(h=>h.matcher===x)`, looks like a normal filename. Emptiness is
    //    the one property every specimen shares. A deliberate empty placeholder
    //    is rare enough to be worth one waiver.
    if (size === 0 && !EXTENSIONLESS_OK.has(base)) {
      add('BLOCK', 'stray', e.file,
        '0-byte file — the signature of shell debris (an unescaped => or > in a command line or an echoed hook payload becomes a redirect)',
        'delete it; write a script file instead of an inline one-liner; waive it only if it is a deliberate empty placeholder');
      continue;
    }
    if (e.ignored) continue;

    // 3. Junk that .gitignore should have covered. Reached only when git is
    //    NOT already ignoring it, so every hit is a genuine .gitignore gap.
    const junk = SHOULD_BE_IGNORED.find(([re]) => re.test(e.file));
    if (junk) {
      add('BLOCK', 'gitignore-gap', e.file,
        `${junk[1]} is untracked but NOT ignored — .gitignore has a gap here`,
        'add a pattern to .gitignore (do not commit the file)');
      continue;
    }

    // 4. Oversized blob.
    if (size !== null && size > LARGE_FILE_BYTES) {
      add('BLOCK', 'large', e.file,
        `${(size / 1048576).toFixed(1)} MB untracked file — too large to commit without a deliberate decision`,
        'ignore it if it is generated, or clear with a reason if it is a real asset');
    }
  }

  // 6. Secrets on their way in. Staged is the dangerous case; untracked is a
  //    near miss worth naming before someone runs `git add -A`.
  for (const e of entries) {
    const base = path.basename(e.file);
    if (SECRET_EXEMPT.test(base)) continue;
    if (!SECRET_NAME.test(e.file)) continue;
    if (e.staged) {
      add('BLOCK', 'secret', e.file,
        'STAGED file looks like a credential — committing it publishes the secret and rewriting history will not un-publish it',
        'git restore --staged, then add it to .gitignore and rotate the credential if it ever left this machine');
    } else if (e.x === '?') {
      add('BLOCK', 'secret', e.file,
        'untracked file looks like a credential and is NOT ignored — one `git add -A` away from being published',
        'add it to .gitignore now');
    }
  }

  // 7. A staged path that .gitignore also matches. The contradiction means one
  //    of the two is wrong, and staging silently wins — worth surfacing.
  if (staged.length) {
    let ignoredStaged = '';
    try {
      ignoredStaged = git(['check-ignore', '--stdin', '-z'], repo, staged.map((s) => s.file).join('\0'));
    } catch {
      ignoredStaged = ''; // exit 1 simply means nothing matched
    }
    for (const f of ignoredStaged.split('\0').filter(Boolean)) {
      add('WARN', 'contradiction', f,
        'staged even though .gitignore matches it — staging silently overrides the ignore rule',
        'unstage it, or narrow the .gitignore pattern if tracking it is intended');
    }
  }

  // 8. New clutter at the top level, reported LAST and only for files nothing
  //    else already flagged — a stray or a secret is not also a filing-location
  //    problem, and saying so twice buries the finding that matters.
  //    Both lists are the repo's own, from `commitHygiene` in the config. A new
  //    top-level DIRECTORY is reported once, by name, however many files it
  //    holds: forty lines about one misplaced folder is forty lines nobody reads.
  const alreadyFlagged = new Set(findings.map((f) => f.file));
  const dirsSeen = new Set();
  for (const e of untracked) {
    if (alreadyFlagged.has(e.file)) continue;
    const slash = e.file.indexOf('/');
    if (slash === -1) {
      if (ctx.rootAllow.includes(e.file)) continue;
      add('WARN', 'root', e.file,
        'new file in the repo root, and it is not on `commitHygiene.rootAllow` — working files belong under ' + ctx.workDirs.join(', '),
        'move it; or, if it really belongs at the root, add it to commitHygiene.rootAllow in harness.config.json');
      continue;
    }
    const top = e.file.slice(0, slash);
    if (ctx.workDirs.includes(top) || dirsSeen.has(top)) continue;
    dirsSeen.add(top);
    add('WARN', 'root', top + '/',
      'new top-level directory that is not on `commitHygiene.workDirs` (' + ctx.workDirs.join(', ') + ')',
      'move its contents under a working directory, ignore it if it is generated, or add it to commitHygiene.workDirs in harness.config.json');
  }

  // 9. Orphan helper: a file under scripts/harness/guards that nothing wires. The
  //    original carried dozens of scripts from an abandoned tool here for two
  //    months, unreferenced by anything; a helper that no settings file, gate
  //    registry, package script, CI job or doc names is dead weight or a bypass.
  //    A require() edge is wiring too, from a NAMED root only.
  //    BOTH directories are watched: the guards moved, but .claude/helpers still
  //    exists, still ships, and is still where another tool drops a script.
  for (const helpersRel of ['scripts/harness/guards', '.claude/helpers']) {
    const helpersDir = path.join(repo, ...helpersRel.split('/'));
    if (!fs.existsSync(helpersDir)) continue;
    const corpus = referenceCorpus(ctx);
    const names = fs.readdirSync(helpersDir).filter((h) => !h.startsWith('.'));
    const requiresOf = {};
    for (const h of names) {
      try { requiresOf[h] = requiredHelpers(fs.readFileSync(path.join(helpersDir, h), 'utf8'), names); }
      catch { requiresOf[h] = []; }
    }
    const wired = wiredHelpers(names, corpus, requiresOf);
    for (const h of names) {
      if (wired.has(h)) continue;
      add('WARN', 'orphan-helper', `${helpersRel}/${h}`,
        'nothing wires this helper: no reference in .claude/settings.json, harness.config.json, package.json, .github/, CLAUDE.md, AGENTS.md or ' + ctx.docsRoot + '/, and nothing wired requires it',
        'wire it (a settings.json hook, a gate, or an npm script), require it from a helper that is wired, or delete it — git history keeps it');
    }
  }

  // 10. A literal credential living in a settings file. Every check above walks
  //     `git status`, which makes all of them STRUCTURALLY BLIND to this one:
  //     the case that bought this rule was an access token in the `env` block of
  //     .claude/settings.local.json, a file that is gitignored and therefore
  //     appears in no status output, so no amount of commit gating ever touched
  //     it. Being unable to COMMIT a file is not the same as the secret being
  //     safe — settings files get pasted into issues, screenshotted, copied
  //     between machines and read whole into agent transcripts. So this check
  //     reads the files straight from DISK and reports regardless of what git
  //     thinks. The token's correct home is a user environment variable that the
  //     settings file interpolates, so the fix moves the literal out and changes
  //     nothing else.
  const scanned = scannedFiles(repo);
  for (const rel of scanned) {
    let text;
    try {
      text = fs.readFileSync(path.join(repo, rel), 'utf8');
    } catch {
      continue; // unreadable or raced away — one file must never fail the gate
    }
    // The finding names the file and the fix and NOTHING of the value: a gate
    // that quotes the secret it found has published it into the transcript.
    if (!hasLiteralCredential(text)) continue;
    add('BLOCK', 'secret', rel,
      'holds a literal credential — gitignored is not safe: settings files are pasted into '
      + 'issues, screenshotted, synced between machines and read whole into agent transcripts, '
      + 'and no git-status check can see this one',
      'move the literal into a user environment variable and reference it as ${NAME}, then '
      + 'rotate it with its issuer — a credential that has sat in a settings file must be '
      + 'assumed to have leaked');
  }

  const order = { BLOCK: 0, WARN: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file));

  // Hash the state the findings were computed from, so a waiver granted now
  // cannot survive an edit made later.
  //
  // BOTH halves are load-bearing. The status entries cover checks 1-9. The
  // CONTENT digest covers check 10, which reads files git status never reports:
  // see contentDigest for what keying on status alone cost.
  const treeHash = crypto
    .createHash('sha256')
    .update(entries.map((e) => `${e.x}${e.y} ${e.file}`).join('\n'))
    .update('\nsettings:' + contentDigest(scanned, (rel) => fs.readFileSync(path.join(repo, rel))))
    .digest('hex');
  return { findings, treeHash };
}

/* ── clearance ──────────────────────────────────────────────────────────── */

const clearancePath = (repo) => path.join(repo, ...CLEARANCE_REL.split('/'));

function readClearance(repo) {
  try {
    return JSON.parse(fs.readFileSync(clearancePath(repo), 'utf8'));
  } catch {
    return null;
  }
}

function writeClearance(repo, reason, treeHash) {
  const record = { reason, treeHash, clearedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(clearancePath(repo)), { recursive: true });
  fs.writeFileSync(clearancePath(repo), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/* ── output shapes ──────────────────────────────────────────────────────── */

function renderFindings(findings) {
  return findings
    .map((f) => `  [${f.level}] ${f.file}\n      ${f.why}\n      -> ${f.fix}`)
    .join('\n');
}

function denyReason(findings) {
  const blocks = findings.filter((f) => f.level === 'BLOCK').length;
  return [
    '*** COMMIT HYGIENE GATE ***',
    `${findings.length} finding(s) in the working tree${blocks ? ` (${blocks} blocking)` : ''}:`,
    '',
    renderFindings(findings),
    '',
    'Required before this commit or push:',
    '  1. Delete every stray file listed above (do NOT commit or ignore it — a',
    '     stray is a SYMPTOM; ignoring it hides the broken quoting that made it).',
    '  2. Close every .gitignore gap listed above.',
    '  3. Re-run the command. The gate re-reads the tree, so a real fix clears it.',
    '',
    'If a finding is deliberate, waive it WITH a reason (recorded, and void as',
    'soon as the tree changes):',
    '  node scripts/harness/guards/commit-hygiene.cjs --clear "why this is intentional"',
    '',
    'Read the findings before waiving. Waiving one you have not read is how a',
    'gate becomes a rubber stamp.',
  ].join('\n');
}

/** The GATE line's three numbers: one check per KIND, failed if it found anything. */
function gateCounts(findings) {
  const failed = new Set(findings.map((f) => f.kind));
  const fail = KINDS.filter((k) => failed.has(k)).length;
  return { pass: KINDS.length - fail, fail, skipped: 0 };
}

/* ── command dispatch ───────────────────────────────────────────────────── */

// Global git options that consume the NEXT token as their argument. Without
// this list, `git -C /repo commit` reads /repo as the subcommand and the gate
// silently never fires — a false negative, the only failure mode that matters.
const OPTS_WITH_ARG = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env',
]);

// Tokens that may sit in FRONT of `git` without changing what runs: shell
// keywords, process wrappers, and PowerShell cmdlets. Requiring git to be
// tokens[0] (an earlier version of this function did) turns every one of these
// into a total bypass.
const LEADING_NOISE = new Set([
  'then', 'do', 'else', 'elif', 'in',                       // shell keywords
  'exec', 'time', 'nohup', 'command', 'nice', 'env', 'xargs', 'winpty', 'sudo',
  'foreach-object', '%', 'start-process', 'invoke-expression', 'iex',
  'bash', 'sh', 'zsh', 'cmd', 'powershell', 'pwsh',         // -c / /c wrappers
]);

// Belt-and-braces backstop over the whole command. The token walk below is the
// precise path; this catches wrappers not on the list above. It accepts the
// cost of firing on a bare MENTION of `git push` (e.g. inside an echo or a
// grep pattern) — the right trade for this gate, because it only speaks when
// the tree is ALREADY dirty and a waiver is one command away. A false positive
// costs a sentence; a false negative silently ships the junk.
const BACKSTOP =
  /(^|[^\w.-])git(\.exe)?["']?\s+((-{1,2}[\w-]+(=\S+)?|-[A-Za-z]\s+\S+)\s+)*(commit|push)($|[^\w-])/i;

/**
 * True when the command plausibly runs `git commit` or `git push`.
 *
 * Segments split on shell separators AND on block punctuation, so both
 * `npm test && git push` and the PowerShell `npm test; if ($?) { git push }`
 * are caught — the latter is the idiom Windows PowerShell 5.1 needs in place of
 * `&&` (a parser error there), so missing it would leave the one conditional-
 * push form that shell has ungated.
 *
 * Leading env assignments and wrapper tokens are peeled before the command
 * word is identified. `git log --grep=commit` still stays quiet: the walk
 * compares tokens, not substrings, and stops at the first real subcommand.
 */
function isGitWrite(command) {
  if (!command || typeof command !== 'string') return false;

  for (const seg of command.split(/&&|\|\||[;|\n(){}]/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    // Peel anything that can precede the real command word.
    while (tokens.length) {
      const head = tokens[0];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) { tokens.shift(); continue; } // FOO=bar
      if (LEADING_NOISE.has(head.toLowerCase())) { tokens.shift(); continue; }
      if (/^([-/]c|-Command|-ArgumentList)$/i.test(head)) { tokens.shift(); continue; }
      break;
    }
    if (!tokens.length || !/(^|[\\/])git(\.exe)?$/i.test(tokens[0])) continue;
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === 'commit' || t === 'push') return true;
      if (OPTS_WITH_ARG.has(t)) { i++; continue; } // skip the option's argument
      if (t.startsWith('-')) continue;             // flag, incl. --opt=value
      break;                                       // a different subcommand
    }
  }

  return BACKSTOP.test(command);
}

/* Returns { text, certain } when this command commits a STAGED gate baseline,
   and null otherwise. `certain` is false when the subject could not be read from
   the command line — an editor commit, or a quoting form this does not parse — in
   which case the caller asks rather than denies. Guessing a subject and denying on
   the guess is how a gate gets disabled. */
function baselineCommitSubject(cmd, repo) {
  if (!/\bcommit\b/.test(String(cmd || ''))) return null;
  let staged = '';
  try { staged = git(['diff', '--cached', '--name-only'], repo); } catch { return null; }
  if (!staged.split(/\r?\n/).includes(BASELINE_REL)) return null;
  return subjectFromCommand(cmd, repo);
}

/* The subject-extraction half of the above, kept pure so --self-test can drive it.
   Reads -m "subject" / -m 'subject' / -m subject, the PowerShell here-string form
   `-m @'…'@` (a bare -m with a multi-line string breaks in that shell), and
   -F <file> by reading that file's first line. */
function subjectFromCommand(cmd, repo) {
  const m = String(cmd).match(/-m\s*(?:@'\s*\n)?(['"]?)([^'"\n]{1,200})\1/);
  if (m) return { text: m[2].trim(), certain: true };
  const f = String(cmd).match(/-F\s+(\S+)/);
  if (f) {
    try {
      const first = fs.readFileSync(path.resolve(repo || ROOT, f[1].replace(/^['"]|['"]$/g, '')), 'utf8').split('\n')[0];
      return { text: first.trim(), certain: true };
    } catch { /* fall through to uncertain */ }
  }
  return { text: '(no -m or readable -F on the command line)', certain: false };
}

const hookOut = (decision, reason, message) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  systemMessage: message,
});

const UNPARSEABLE = [
  '*** COMMIT HYGIENE GATE — THE PAYLOAD DID NOT PARSE ***',
  'This gate reads the tool input as JSON to learn whether the call is a git commit or',
  'push, and could not. So it cannot tell whether this call publishes the working tree.',
  '',
  'An unreadable payload is an ASK, never a silent allow: a gate that a malformed call',
  'switches off is switched off by exactly the call shape worth worrying about.',
  'Approve it only if you know this call does not commit or push.',
].join('\n');

/**
 * --gate, this file's own CLI: raw stdin in the legacy wire format, a hook output or null
 * out. The registered path is scripts/harness/hook.js, where a dialect module owns the wire
 * format and calls gatherGate() and decide() below directly; this wrapper decides nothing.
 *
 * Reads `tool_input.command` and NEVER `tool_name`: that is
 * what lets the `mcp__.*` matcher work with no special case. An MCP shell
 * server that spells `command` gets exactly the verdict Bash gets, and one that
 * spells it some other way is the phase guard's D4 ask, not a hole here.
 */
function gate(raw, ctx) {
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return hookOut('ask', UNPARSEABLE, 'WARNING: a tool payload the commit-hygiene gate could not parse requires your decision.');
  }
  const cmd = ((payload && payload.tool_input) || {}).command;
  const v = decide({ command: cmd }, isGitWrite(cmd) ? gatherGate(cmd, ctx) : {});
  return (v.deny || v.ask) ? hookOut(v.ask ? 'ask' : 'deny', v.reason, v.message) : null;
}

/** The neutral verdict. See scripts/harness/dialects/_wire.js for the contract. */
const ALLOW = Object.freeze({ deny: false, reason: '' });
const subjectIsLegible = (subject) => !subject || /^gates:/.test(subject.text);

/**
 * THE DISK HALF of the commit gate, and the only one: everything decide() needs to know about
 * the tree, read once. scripts/harness/hook.js calls this ONLY for a command isGitWrite()
 * accepts, which is what keeps the gate free for every other call; `gate()` above does the
 * same for this file's own CLI.
 *
 *   subject   the subject a commit that STAGES the gate baseline is being made under, or null
 *   result    { findings, treeHash }, or null where the tree could not be analysed at all
 *   cleared   the waiver on disk, or null
 *
 * It stops at the first thing that settles the verdict, in decide()'s own order, so a commit
 * refused for its subject never pays for the tree walk.
 */
function gatherGate(cmd, ctx) {
  const state = { subject: baselineCommitSubject(cmd, ctx.repo), result: null, cleared: null };
  if (!subjectIsLegible(state.subject)) return state;
  try {
    state.result = analyse(ctx);
  } catch {
    // Not a git repository, or git is not installed. In either case the commit
    // this gate would have judged cannot happen, so there is nothing to allow
    // in silence — and blocking on our own failure would make the gate the
    // thing people remove.
    return state;
  }
  if (state.result.findings.length) state.cleared = readClearance(ctx.repo);
  return state;
}

/**
 * The whole commit-gate decision: decide(event, state), pure. No stdin, no git, no disk.
 *
 * Reads `event.command` and NEVER the action or the tool: a command is a command whichever
 * tool carries it, which is what lets an opaque call from a shell server get exactly the
 * verdict a native shell gets. `state` is what gatherGate() returns.
 *
 * A git write with a state nobody gathered THROWS: "no findings were looked for" must not
 * read as "no findings". The one entry turns a throw into a deny.
 */
function decide(event, state) {
  const cmd = event && event.command;
  if (!isGitWrite(cmd)) return ALLOW;
  const s = state || {};
  if (!Object.prototype.hasOwnProperty.call(s, 'result')) throw new Error('commit-hygiene: no state was gathered for this git write');

  // A RE-BASELINE MUST BE LEGIBLE IN `git log --oneline`.
  // gates.baseline.json is the agreed figure every later run is measured
  // against, so moving it is the one change that can make a regression permanent
  // without any gate going red. It is allowed — that is what `gates.js --accept`
  // is for — but it may not be smuggled in under an unrelated subject. Fires
  // ONLY when that file is staged, so it costs every other commit nothing.
  const subject = s.subject;
  if (!subjectIsLegible(subject)) {
    const reason = '*** GATE BASELINE RE-BASELINE ***\n'
      + 'This commit stages gates.baseline.json — the figure every later gate run is\n'
      + 'compared against. Moving it is how a regression becomes permanent, so the\n'
      + 'subject must start `gates:` to make it legible in `git log --oneline`.\n\n'
      + (subject.certain ? 'Subject read: ' + subject.text : 'Could not read the subject with confidence: ' + subject.text);
    const message = 'Commit hygiene gate: gates.baseline.json is staged and the subject does not start `gates:`.';
    // Guessing a subject and denying on the guess is how a gate gets disabled: unsure is an ask.
    return subject.certain ? { deny: true, reason, message } : { deny: false, ask: true, reason, message };
  }

  const result = s.result;
  if (!result || !result.findings.length) return ALLOW;
  if (s.cleared && s.cleared.treeHash === result.treeHash) return ALLOW;

  return {
    deny: true,
    reason: denyReason(result.findings),
    message: `Commit hygiene gate: ${result.findings.length} finding(s) — commit/push blocked until the tree is clean.`,
  };
}

/**
 * --report. A REAL VERDICT: exit 0 clean, exit 1 with findings, GATE line last.
 *
 * A tree that could not be analysed at all is SKIPPED and exits 1 — never
 * green. A check that could not run is not a check that passed, and the caller
 * who wants to tolerate that says so with --allow-skip, where it is visible.
 */
function report(ctx) {
  let findings;
  try {
    findings = analyse(ctx).findings;
  } catch (e) {
    process.stdout.write('Commit hygiene: NOT RUN — the working tree could not be read (' + (e.code || 'git failed')
      + '). Is this a git repository, and is git on PATH?\n');
    process.stdout.write('GATE ' + ctx.gateName + ' pass=0 fail=0 skipped=' + KINDS.length + '\n');
    return 1;
  }
  const c = gateCounts(findings);
  process.stdout.write(findings.length
    ? `Commit hygiene: ${findings.length} finding(s)\n\n${renderFindings(findings)}\n`
    : 'Commit hygiene: clean — no stray files, no secrets, no .gitignore gaps, no root clutter.\n');
  process.stdout.write('GATE ' + ctx.gateName + ' pass=' + c.pass + ' fail=' + c.fail + ' skipped=' + c.skipped + '\n');
  return findings.length ? 1 : 0;
}

/* ── self-test ──────────────────────────────────────────────────────────── */

/* Two halves.
   THE PURE HALF drives every decision that is a function of its input — "is this
   a git write?", "what subject is it committing under?", "does this text carry a
   credential?", "which helpers are wired?" — with literals.
   THE TREE HALF builds a throwaway git repository in the OS temp directory and
   runs the whole analysis against it. It never reads THIS repo's working tree,
   for two reasons: that tree is shared with whoever else is working in it, so an
   assertion about it would be a flake rather than a test; and a developer's real
   settings.local.json may hold a real token, which a self-test that read it could
   print on failure. Every credential in here is synthetic and assembled from
   halves, so this file never itself contains a contiguous token-shaped string — a
   repo-wide sweep for the shape should return the rule, never a specimen. */
function selfTest() {
  const os = require('node:os');
  const fails = [];
  let checks = 0;
  const must = (what, got, want) => {
    checks++;
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  };

  must('a plain commit is a git write', isGitWrite('git commit -m "x"'), true);
  must('a push is a git write', isGitWrite('git push origin main'), true);
  must('an env prefix does not hide it', isGitWrite('GIT_AUTHOR_NAME=x git commit -m "y"'), true);
  // ⚠ `git -C <dir> commit` was a real bypass: the gate matched on the command
  // word and -C sat where the subcommand was expected.
  must('-C does not hide it', isGitWrite('git -C . commit -m "x"'), true);
  must('a chained push is caught', isGitWrite('npm test && git push'), true);
  must('the PowerShell conditional-push idiom is caught', isGitWrite('npm test; if ($?) { git push }'), true);
  must('ls is not a git write', isGitWrite('ls -la'), false);
  must('git status is not a git write', isGitWrite('git status'), false);
  must('git log --grep=commit is not a git write', isGitWrite('git log --grep=commit'), false);
  // ⚠ DELIBERATE OVER-FIRE, pinned so nobody "fixes" it. `echo git commit`
  // writes nothing, and the BACKSTOP regex matches it anyway. That is the stated
  // trade for this gate: it only speaks when the tree is ALREADY dirty and a
  // waiver is one command away, so a false positive costs a sentence while a
  // false negative silently ships the junk. Narrowing this to satisfy a tidier
  // test would trade the safe failure direction for the unsafe one.
  must('a bare MENTION still fires — the safe direction', isGitWrite('echo git commit'), true);
  must('an empty command is not a git write', isGitWrite(''), false);
  must('a non-string is not a git write', isGitWrite(null), false);

  must('reads a double-quoted subject', subjectFromCommand('git commit -m "gates: re-baseline"').text, 'gates: re-baseline');
  must('reads a single-quoted subject', subjectFromCommand("git commit -m 'feat: x'").text, 'feat: x');
  must('reads a here-string subject', subjectFromCommand("git commit -m @'\ngates: re-baseline\n'@").text, 'gates: re-baseline');
  must('is honest when it cannot read one', subjectFromCommand('git commit').certain, false);

  /* Rule 10's detector. */
  const synthetic = 'sk' + '-' + 'notarealcredential0123456789'; // obviously fake, and split
  must('a token-shaped literal matches', hasLiteralCredential(synthetic), true);
  must('the same token embedded in JSON matches', hasLiteralCredential('{"env":{"T":"' + synthetic + '"}}'), true);
  must('a second issuer family matches', hasLiteralCredential('gh' + 'p_' + 'notarealcredential0123456789abcdef'), true);
  must('a private key header matches', hasLiteralCredential('-----BEGIN ' + 'RSA PRIVATE KEY-----'), true);
  // The key-NAME rule: an issuer nobody listed, caught by what the key is called.
  must('an unlisted issuer is caught by its key name',
    hasLiteralCredential('{"env":{"SERVICE_API_KEY":"' + 'q7' + 'Zp4mW9xK2vB8nL5tR3yH6' + '"}}'), true);
  // ⚠ The correct final state of a settings file must NOT trip the rule.
  must('the ${NAME} reference does not match', hasLiteralCredential('{"env":{"SERVICE_TOKEN":"${SERVICE_TOKEN}"}}'), false);
  // The documented placeholder is token-SHAPED and must stay quiet ON VALUE.
  must('the documented placeholder does not match',
    hasLiteralCredential('{"env":{"SERVICE_TOKEN":"' + 'sk' + '-your_access_token_here_0000' + '"}}'), false);
  must('a REAL token beside a placeholder still matches — the hole a name exemption opened',
    hasLiteralCredential('{"note":"your_token_here","env":{"T":"' + synthetic + '"}}'), true);
  must('other placeholder spellings stay quiet',
    hasLiteralCredential('{"API_KEY":"CHANGEME_replace_this_value_now_1"}') || hasLiteralCredential('{"API_KEY":"xxxxxxxxxxxxxxxxxxxxxxxx1"}'), false);
  must('a path to a key file is where a secret lives, not a secret',
    hasLiteralCredential('{"env":{"TOKEN_FILE":"/home/user/.config/app/token-v2.json"}}'), false);
  must('a prefix mid-word is not a token', hasLiteralCredential('see the ta' + 'sk-list-of-everything-we-did-2024 doc'), false);
  must('the bare prefix in prose does not match', hasLiteralCredential('the key starts with sk- and runs long'), false);
  must('an ordinary settings file is quiet',
    hasLiteralCredential('{"permissions":{"deny":["Bash(node -e*)"]},"hooks":{"PreToolUse":[{"matcher":"Bash"}]}}'), false);
  must('a non-string does not throw', hasLiteralCredential(null), false);
  must('undefined does not throw', hasLiteralCredential(undefined), false);
  must('an object does not throw', hasLiteralCredential({ toString: () => synthetic }), false);

  /* Rule 10's file-name filter. */
  must('settings.json is scanned', isSettingsFileName('settings.json'), true);
  must('settings.local.json is scanned', isSettingsFileName('settings.local.json'), true);
  must('a hyphenated profile is scanned', isSettingsFileName('settings.work-profile.json'), true);
  // ⚠ The documentation twins ARE scanned. They are TRACKED, so a real token in
  // one gets committed and pushed — the worst home of all, and the one a
  // name-based exemption made invisible. PLACEHOLDER keeps them quiet by value
  // instead. Pinned here so nobody "fixes" the false fire by name again.
  must('settings.example.json IS scanned', isSettingsFileName('settings.example.json'), true);
  must('settings.template.json IS scanned', isSettingsFileName('settings.template.json'), true);
  must('an unrelated json is not a settings file', isSettingsFileName('package.json'), false);
  must('a settings file of another type is not one', isSettingsFileName('settings.local.yaml'), false);

  /* The content digest folded into treeHash, through an injected reader. */
  const reader = (map) => (rel) => {
    if (!Object.prototype.hasOwnProperty.call(map, rel)) throw new Error('ENOENT (synthetic)');
    return Buffer.from(map[rel], 'utf8');
  };
  const L = ['.claude/settings.local.json'];
  const clean = contentDigest(L, reader({ '.claude/settings.local.json': '{"env":{}}' }));
  must('identical content gives the same digest', clean === contentDigest(L, reader({ '.claude/settings.local.json': '{"env":{}}' })), true);
  must('different content gives a different digest', clean === contentDigest(L, reader({ '.claude/settings.local.json': '{"env":{"X":"1"}}' })), false);
  must('the path is part of the digest', clean === contentDigest(['.claude/settings.json'], reader({ '.claude/settings.json': '{"env":{}}' })), false);
  // Folded in sorted path order, so readdir order cannot void a waiver by itself.
  const two = { '.claude/settings.json': '{"a":1}', '.claude/settings.local.json': '{"b":2}' };
  must('fold order does not matter',
    contentDigest(['.claude/settings.json', '.claude/settings.local.json'], reader(two))
    === contentDigest(['.claude/settings.local.json', '.claude/settings.json'], reader(two)), true);
  // A file that is gone must fold in as a stable marker, not throw and not drift.
  must('a missing file digests stably', contentDigest(L, reader({})) === contentDigest(L, reader({})), true);
  must('a missing file is not an empty file', contentDigest(L, reader({})) === contentDigest(L, reader({ '.claude/settings.local.json': '' })), false);
  must('no files at all still digests', typeof contentDigest([], reader({})), 'string');

  /* The orphan-helper rule, driven with literals. The NEGATIVE cases are the
     point: counting a require() edge loosened the rule, so what proves it still
     works is what it still refuses. */
  const HN = ['hook.cjs', 'shared.cjs', 'deep.cjs', 'dead.cjs', 'dead-friend.cjs'];
  const REQ = {
    'hook.cjs': ['shared.cjs'],          // a named root requires the shared predicate
    'shared.cjs': ['deep.cjs'],          // which requires another: reachability, not one hop
    'dead.cjs': ['dead-friend.cjs'],     // a dead pair that require each other and nothing else
    'dead-friend.cjs': ['dead.cjs'],     // ...and cycle, which must not become a proof of life
    'deep.cjs': [],
  };
  const W = wiredHelpers(HN, 'settings.json names hook.cjs and nothing else', REQ);
  must('a NAMED helper is wired', W.has('hook.cjs'), true);
  must('a helper required by a named one is wired', W.has('shared.cjs'), true);
  must('reachability is transitive, not one hop', W.has('deep.cjs'), true);
  // ⚠ The blind spot this must never open: required-by-anything would light both up.
  must('a dead helper is still a stray', W.has('dead.cjs'), false);
  must('...and so is the dead helper it requires', W.has('dead-friend.cjs'), false);
  must('a cycle among dead helpers is not wiring', W.size, 3);
  must('nothing named at all wires nothing', wiredHelpers(HN, '', REQ).size, 0);
  must('require edges are read line-scoped, both spellings',
    requiredHelpers("const a = require('./shared.cjs');\nconst b = require(path.join(__dirname, 'deep.cjs'));", HN).join(','),
    'shared.cjs,deep.cjs');
  must('a bare mention is not a require', requiredHelpers('// see shared.cjs for why', HN).length, 0);

  /* The GATE arithmetic. pass+fail+skipped is the TOTAL, and the total is what
     tells a green run from a run where a check vanished. */
  const g0 = gateCounts([]);
  must('a clean tree passes every kind', [g0.pass, g0.fail, g0.skipped], [KINDS.length, 0, 0]);
  const g2 = gateCounts([{ kind: 'stray' }, { kind: 'stray' }, { kind: 'secret' }]);
  must('a kind fails once however many files it found', [g2.pass, g2.fail], [KINDS.length - 2, 2]);
  must('the total does not move with the findings', g2.pass + g2.fail + g2.skipped, KINDS.length);

  /* An unreadable payload is an ASK, never a silent allow. */
  const none = { repo: os.tmpdir(), workDirs: [], rootAllow: [], docsRoot: 'docs', gateName: 'hygiene' };
  must('an unparseable payload asks', (gate('not json', none) || { hookSpecificOutput: {} }).hookSpecificOutput.permissionDecision, 'ask');
  must('an empty payload decides nothing', gate('', none), null);
  must('a call that is not a git write decides nothing', gate(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), none), null);
  must('the neutral decision allows a call that is not a git write, with no state at all', decide({ command: 'npm test' }, {}), { deny: false, reason: '' });
  must('...and a call that carries no command', decide({ action: 'write', path: 'a.md' }, {}), { deny: false, reason: '' });
  // ⚠ "No findings were looked for" must not read as "no findings".
  must('a git write with a state nobody gathered throws, so the one entry denies',
    (() => { try { decide({ command: 'git push' }, {}); return 'returned'; } catch { return 'threw'; } })(), 'threw');
  must('a tree that could not be analysed is not a refusal', decide({ command: 'git push' }, { subject: null, result: null, cleared: null }), { deny: false, reason: '' });
  must('findings with no waiver deny', decide({ command: 'git push' },
    { subject: null, result: { findings: [{ severity: 'BLOCK', kind: 'stray', file: 'x', why: 'w', fix: 'f' }], treeHash: 'a' }, cleared: null }).deny, true);
  must('...a waiver for another tree state does not help', decide({ command: 'git push' },
    { subject: null, result: { findings: [{ severity: 'BLOCK', kind: 'stray', file: 'x', why: 'w', fix: 'f' }], treeHash: 'a' }, cleared: { treeHash: 'b' } }).deny, true);
  must('...and one for THIS tree state allows', decide({ command: 'git push' },
    { subject: null, result: { findings: [{ severity: 'BLOCK', kind: 'stray', file: 'x', why: 'w', fix: 'f' }], treeHash: 'a' }, cleared: { treeHash: 'a' } }), { deny: false, reason: '' });

  /* ── THE TREE HALF ── */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hygiene-self-test-'));
  const ctx = { repo: dir, workDirs: ['src', '.claude', 'scripts'], rootAllow: ['README.md', '.gitignore'], docsRoot: 'docs', gateName: 'hygiene' };
  const put = (rel, body) => {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const del = (rel) => fs.rmSync(path.join(dir, ...rel.split('/')), { recursive: true, force: true });
  const kinds = () => analyse(ctx).findings.map((f) => f.kind + ' ' + f.file);
  const verdict = (cmd, tool) => {
    const o = gate(JSON.stringify({ tool_name: tool || 'Bash', tool_input: { command: cmd } }), ctx);
    return o ? o.hookSpecificOutput.permissionDecision : null;
  };
  try {
    let gitOk = true;
    try {
      git(['init', '-q'], dir);
      put('README.md', '# fixture\n');
      put('src/a.js', 'module.exports = 1;\n');
      put('.gitignore', 'hidden*\n.claude/settings.local.json\n' + CLEARANCE_REL + '\n');
      git(['add', '-A'], dir);
      git(['-c', 'user.name=self-test', '-c', 'user.email=self-test@example.com', '-c', 'commit.gpgsign=false',
        'commit', '-q', '--no-verify', '-m', 'fixture'], dir);
    } catch (e) {
      gitOk = false;
      // A check that cannot run must not read green.
      fails.push('the tree half could not run: git failed in a fresh temp repository (' + (e.code || e.message)
        + '). fix: install git and put it on PATH.');
    }
    if (gitOk) {
      must('a clean committed tree has no findings', kinds(), []);
      must('...and a commit against it is allowed', verdict('git commit -m "x"'), null);

      // ⚠ MODIFIED TRACKED FILES ARE NOT A FINDING.
      put('README.md', '# fixture, edited\n');
      put('src/a.js', 'module.exports = 2;\n');
      must('a modified tracked file is not a finding', kinds(), []);
      git(['add', 'src/a.js'], dir);
      must('...staged or not', kinds(), []);

      put('h.matcher', '');
      must('a 0-byte file with a plausible name is a stray', kinds(), ['stray h.matcher']);
      del('h.matcher');
      put('k!', 'x');
      must('shell punctuation in a name is a stray even with content', kinds(), ['stray k!']);
      del('k!');
      // ⚠ WHAT A BARE `git status` HIDES. This file matches an ignore rule, so
      // plain status shows a clean tree. --ignored=matching is why it is seen.
      put('hidden1', '');
      must('a stray that an ignore rule hides is still seen', kinds(), ['stray hidden1']);
      del('hidden1');
      put('hidden2', 'not empty');
      must('...but an ignored file with content is not a stray', kinds(), []);
      del('hidden2');

      put('src/debug.log', 'x');
      must('junk that is not ignored is a .gitignore gap', kinds(), ['gitignore-gap src/debug.log']);
      del('src/debug.log');

      put('.env', 'A=1\n');
      put('.env.example', 'A=\n');
      must('an untracked credential file is a secret, and its twin is not', kinds().filter((k) => /^secret/.test(k)), ['secret .env']);
      del('.env');
      del('.env.example');

      // ⚠ STAGED IS THE DANGEROUS CASE, and it is a separate branch from the untracked
      // one above. A key file by another name, staged past the ignore rules; its
      // documentation twin beside it is exempt by extension.
      put('src/server.pem', 'x\n');
      put('src/server.pem.md', 'about the key\n');
      git(['add', '-f', 'src/server.pem', 'src/server.pem.md'], dir);
      must('a STAGED credential file is a secret, and a doc about it is not', kinds(), ['secret src/server.pem']);
      git(['rm', '-q', '--cached', 'src/server.pem', 'src/server.pem.md'], dir);
      must('...and the same file untracked is the near miss', kinds(), ['secret src/server.pem']);
      del('src/server.pem');
      del('src/server.pem.md');

      put('src/big.bin', Buffer.alloc(LARGE_FILE_BYTES + 1, 1));
      must('an untracked file over the size line is large', kinds(), ['large src/big.bin']);
      put('src/big.bin', Buffer.alloc(LARGE_FILE_BYTES, 1));
      must('...and one exactly on the line is not', kinds(), []);
      del('src/big.bin');

      // ⚠ `contradiction` IS NOT DRIVEN HERE, AND CANNOT BE. Rule 7 asks `git check-ignore`
      // about STAGED paths, and without --no-index that command never reports a path
      // the index holds: measured 2026-10-06, a force-added file matching `hidden*`
      // yields no finding. The repair is a change of verdict, so it is owed, not made
      // in a path-only move; the PASS line below says six of seven for that reason.

      put('notes.txt', 'x');
      must('a root file off the allow-list is root clutter', kinds(), ['root notes.txt']);
      del('notes.txt');
      put('scratch/a.txt', 'x');
      put('scratch/b.txt', 'x');
      must('a new top-level directory is reported once, by name', kinds(), ['root scratch/']);
      del('scratch');
      put('src/b.js', 'x');
      must('a new file under a working directory is not clutter', kinds(), []);
      del('src/b.js');

      put('scripts/harness/guards/wired.cjs', "require('./shared.cjs');\n");
      put('scripts/harness/guards/shared.cjs', 'x\n');
      put('scripts/harness/guards/orphan.cjs', 'x\n');
      put('.claude/settings.json', '{"hooks":{"note":"runs wired.cjs"}}\n');
      must('an unwired helper is an orphan, and a required one is not', kinds(), ['orphan-helper scripts/harness/guards/orphan.cjs']);
      // The one hook entry: a settings file names it and no guard, and it requires the guards.
      put(HOOK_ENTRY_REL, "require('./guards/wired.cjs');\nrequire('./guards/orphan.cjs');\n");
      must('an entry NOTHING registers vouches for nothing', kinds(), ['orphan-helper scripts/harness/guards/orphan.cjs']);
      put('.claude/settings.json', '{"hooks":{"note":"runs ' + HOOK_ENTRY_REL + '"}}\n');
      must('a guard the registered hook entry requires is wired, and so is what that guard requires', kinds(), []);
      del('scripts');
      // The directory the guards LEFT is still watched: it still ships, and a script
      // dropped there is as dead as one dropped beside the guards.
      put('.claude/helpers/statusline.cjs', 'x\n');
      put('.claude/helpers/abandoned.cjs', 'x\n');
      put('.claude/settings.json', '{"statusLine":{"command":"node .claude/helpers/statusline.cjs"}}\n');
      must('an unwired script under .claude/helpers is an orphan too, and the wired one is not', kinds(), ['orphan-helper .claude/helpers/abandoned.cjs']);
      del('.claude/helpers');
      del('.claude/settings.json');

      /* THE WAIVER, BOUND TO THE TREE STATE. */
      put('likely', '');
      must('a dirty tree denies a commit', verdict('git commit -m "x"'), 'deny');
      must('...and a push', verdict('git push'), 'deny');
      must('...and the same command from an MCP shell server', verdict('git commit -m "x"', 'mcp__shell__run'), 'deny');
      must('...but not a command that is not a git write', verdict('git status'), null);
      const first = analyse(ctx);
      writeClearance(dir, 'self-test: a deliberate placeholder', first.treeHash);
      must('a waiver for THIS tree state allows the commit', verdict('git commit -m "x"'), null);
      must('the waiver file is invisible to the hash it is bound to', analyse(ctx).treeHash, first.treeHash);

      // ⚠ THE DEFECT THIS CLOSES. Pasting a token into a gitignored settings
      // file changes NO git status entry. Bound to status alone, the waiver
      // above would still match and the [BLOCK] would be suppressed.
      put('.claude/settings.local.json', '{"env":{"SERVICE_TOKEN":"' + synthetic + '"}}\n');
      const after = gate(JSON.stringify({ tool_input: { command: 'git commit -m "x"' } }), ctx);
      must('pasting a token voids the outstanding waiver', after ? after.hookSpecificOutput.permissionDecision : null, 'deny');
      const reason = after ? after.hookSpecificOutput.permissionDecisionReason : '';
      must('the refusal names the file', reason.includes('.claude/settings.local.json'), true);
      // ⚠ IT NEVER QUOTES THE VALUE.
      must('the refusal never quotes the secret', reason.includes(synthetic) || reason.includes(synthetic.slice(3, 15)), false);
      del('.claude/settings.local.json');
      must('removing the token restores the waiver it voided', verdict('git commit -m "x"'), null);
      put('another', '');
      must('a NEW stray voids the waiver too', verdict('git commit -m "x"'), 'deny');
      del('another');
      del('likely');

      /* A re-baseline must be legible in the log. */
      put(BASELINE_REL, '{}\n');
      put('.gitignore', 'hidden*\n.claude/\n');
      git(['add', '-f', BASELINE_REL, '.gitignore'], dir);
      // The baseline is STAGED, and a staged file is not untracked clutter whatever
      // directory it sits in, so the only thing in play is the subject rule.
      must('a staged baseline under an unrelated subject is denied', verdict('git commit -m "chore: tidy"'), 'deny');
      must('...and allowed under a gates: subject', verdict('git commit -m "gates: re-baseline"'), null);
      must('...and ASKED when the subject cannot be read', verdict('git commit'), 'ask');

      /* THE NEUTRAL DECISION, which is what scripts/harness/hook.js calls: gatherGate() reads
         the tree, decide() is handed what it read. Same repo, same state, no wire format. */
      const neutral = (cmd) => { const v = decide({ command: cmd }, isGitWrite(cmd) ? gatherGate(cmd, ctx) : {}); return [v.deny === true, v.ask === true]; };
      must('the neutral decision denies the same sneaked re-baseline', neutral('git commit -m "chore: tidy"'), [true, false]);
      must('...asks where the subject cannot be read', neutral('git commit'), [false, true]);
      must('...and allows the legible one', neutral('git commit -m "gates: re-baseline"'), [false, false]);
      must('a refused subject never paid for the tree walk', gatherGate('git commit -m "chore: tidy"', ctx).result, null);
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir is not worth a red test */ }
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? 'FAIL - commit-hygiene self-test: ' + fails.length + ' assertion(s)'
    : 'PASS - commit-hygiene self-test (' + checks + ' checks: git-write detection, credential detection, '
      + 'waiver binding, ' + (KINDS.length - 1) + ' of ' + KINDS.length + ' finding kinds against a throwaway repo; contradiction undriven)');
  process.exit(fails.length ? 1 : 0);
}

/* ── entry ──────────────────────────────────────────────────────────────── */

function readStdin() {
  return new Promise((done) => {
    let data = '';
    let settled = false;
    const finish = () => { if (!settled) { settled = true; done(data); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    // Never hang a tool call waiting on stdin that is not coming.
    setTimeout(() => { try { process.stdin.destroy(); } catch {} finish(); }, 2000).unref();
  });
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '--self-test') return selfTest();

  if (argv[0] === '--clear') {
    const reason = argv.slice(1).join(' ').trim();
    if (!reason) {
      process.stderr.write('--clear requires a reason: --clear "why this is intentional"\n');
      process.exit(2);
    }
    const ctx = context();
    const { findings, treeHash } = analyse(ctx);
    if (!findings.length) {
      // A waiver for nothing would sit on disk waiting to match a future tree
      // that happens to hash the same, so none is written.
      process.stdout.write('Nothing to clear — the tree has no findings.\n');
      process.exit(0);
    }
    const rec = writeClearance(ctx.repo, reason, treeHash);
    process.stdout.write(
      `Cleared ${findings.length} finding(s) for the current tree state.\n` +
      `Reason: ${rec.reason}\n` +
      `Void as soon as the tree changes (bound to ${treeHash.slice(0, 12)}).\n`,
    );
    process.exit(0);
  }

  if (argv[0] === '--report') process.exit(report(context()));

  if (argv[0] === '--gate') {
    let out = null;
    const raw = await readStdin();
    try { out = gate(raw, context()); } catch { out = null; }
    if (out) process.stdout.write(JSON.stringify(out));
    process.exit(0); // the decision rides in the JSON, never in the exit code
  }

  process.stdout.write(
    'commit-hygiene — stray-file, secret and .gitignore gate for git commit / push\n\n' +
    '  --report            analyse the tree, print findings and a GATE line (exit 1 if any)\n' +
    '  --clear "<reason>"  waive current findings, bound to this tree state\n' +
    '  --gate              PreToolUse hook mode (reads hook JSON on stdin)\n' +
    '  --self-test         drive every decision, including a throwaway repo\n',
  );
  process.exit(0);
}

module.exports = { isGitWrite, subjectFromCommand, hasLiteralCredential, isSettingsFileName,
  contentDigest, wiredHelpers, requiredHelpers, gateCounts, analyse, gate, decide, gatherGate, context, KINDS };

if (require.main === module) {
  main().catch(() => process.exit(0)); // a guard failure must not take down the session
}
