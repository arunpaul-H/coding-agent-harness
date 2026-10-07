'use strict';
/* ============================================================
   branch-sync.js — one harness, on every branch.

   WHY THIS EXISTS
   Long-lived branches that are never merged back (a release line, a customer
   fork, a spike kept alive for months) carry whatever harness existed the day
   they were cut. In the harness this was ported from, two such branches were
   measured years apart from the source: both were missing every file under
   scripts/harness/, the doc contract, the agents and the skills, and both still
   wired helpers the source branch had deleted. Nothing noticed, because nothing
   compared them. This is the comparison.

   THE RULE. Harness files change on the SOURCE BRANCH first (the repo's default
   branch — see "WHICH BRANCH IS THE SOURCE"). Any other branch pulls them with
   `--apply`, reviews the diff, runs its gate suite and commits. What counts as a
   harness file is scripts/harness/common.json, and a follower reads that manifest
   FROM THE SOURCE REF, never from its own tree: a branch cannot exempt itself by
   editing its own copy. That one property is load-bearing — without it the file
   that decides what is compared is itself the easiest thing to edit, and the
   first branch under deadline pressure deletes the entry that is in its way.

   TWO MODES, chosen by the checked-out branch:
     source    HEAD IS the source branch. The manifest is validated against this
               tree: every listed path exists and every probe holds. There is
               nothing to compare against; this IS what the others match.
     follower  any other branch. Every common file must be byte-identical to the
               source (hashed THROUGH GIT, so .gitattributes line endings cannot
               read as drift — this harness runs on Windows too); every common
               directory must hold exactly the source's file set; a `sections`
               file is compared with its named `## ` section masked, because one
               section of AGENTS.md is where a branch says what it is.
   Both modes run ONE check per manifest entry, plus one for the manifest itself.
   The count is STRUCTURAL, so it is the same on every branch and in CI whichever
   mode a checkout lands in, and a baseline recorded in one mode holds in the
   other. Anything that would change the count with the manifest unchanged is a
   bug: it would read as a vanished check to the gate runner.

   Per-branch by design, and never compared: `perBranch` paths (only their
   EXISTENCE is checked), every path the manifest does not list, .gitignore (its
   EFFECT is probed instead, `ignore.mustTrack` / `ignore.mustIgnore`) and
   package.json (only the listed `packageScripts` are).

   WHICH BRANCH IS THE SOURCE — detected, never assumed `main`. A public repo may
   use `master`, `trunk` or anything else, and a hard-coded name would make this
   script red on arrival in half of them. In order:
     1. `--ref <ref>` or env BRANCH_SYNC_REF   an operator trying a harness change
                                               that is still on a feature branch
     2. `project.sourceBranch` in harness.config.json   the repo states it
     3. `git symbolic-ref refs/remotes/origin/HEAD`     what the remote publishes
                                               (`git remote set-head origin -a`
                                               repairs a clone that lacks it)
     4. the first of main, master, trunk, default that exists as a ref — the
        documented fallback, reported AS a fallback so nobody reads a guess as a
        setting.
   With none of those resolvable (a clone that fetched one branch and no remote)
   every check is SKIPPED and declared. Never green: a comparison that could not
   run is not a comparison that passed.

   Run:  node scripts/harness/branch-sync.js            report; the GATE line is last
         node scripts/harness/branch-sync.js --check     the same, as a gate (exit 1 on drift)
         node scripts/harness/branch-sync.js --apply     write the source's version of every drifted path
         node scripts/harness/branch-sync.js --hook      SessionStart: silent unless drifted; always exit 0
         node scripts/harness/branch-sync.js --ref <r>   compare against <r> (or env BRANCH_SYNC_REF)
         node scripts/harness/branch-sync.js --self-test
   Zero dependencies (Node built-ins and git), like every other gate in this tree.
   ============================================================ */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { load, ROOT, resolve } = require('./config.js');

// POSIX, because this string is handed to git (`git show <ref>:<path>`) as often
// as to the filesystem. node:path turns it into a real path on the way to fs.
const MANIFEST = 'scripts/harness/common.json';
const GATE = 'branch-sync';

// The last-resort names, in preference order. A repo that uses none of them and
// publishes no origin/HEAD has to say so in harness.config.json — which is the
// honest outcome, rather than this script picking a branch and grading it.
const CANDIDATES = ['main', 'master', 'trunk', 'default'];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

const git = (args, opts) => spawnSync('git', args,
  Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts || {}));
const norm = (t) => String(t == null ? '' : t).replace(/\r\n/g, '\n');
const abs = (p) => resolve(...String(p).split('/'));
const isFile = (p) => { try { return fs.statSync(abs(p)).isFile(); } catch { return false; } };

/* ---------- pure decisions: --self-test drives every one of these with literals ---------- */

// `origin/main` and `refs/heads/main` both name the branch `main`.
const shortName = (ref) => String(ref || '').replace(/^refs\/(heads|remotes)\//, '').replace(/^origin\//, '');

// Source only when the checkout IS the branch the ref names. An unknown branch
// (a detached HEAD with no CI variable) is a FOLLOWER: comparing is the safe
// side, and on the source branch itself the two modes agree anyway.
const modeFor = (current, ref) => (current && current === shortName(ref) ? 'source' : 'follower');

/* Which branch to compare against, as a pure decision over three inputs, so the
   precedence can be tested without a repo. Returns `how`, and `how` is printed:
   a name that came from the fallback list is a GUESS, and a guess that looks
   like a setting is how a repo ends up grading itself against a branch nobody
   chose. `name` is null for the fallback case, which the caller resolves by
   trying each candidate — only it can ask git what exists. */
function decideSource(inputs) {
  const i = inputs || {};
  const clean = (v) => (typeof v === 'string' && v.trim() && !/\s/.test(v.trim()) ? v.trim() : null);
  const explicit = clean(i.explicit);
  if (explicit) return { name: shortName(explicit), literal: explicit, how: 'explicit' };
  const configured = clean(i.configured);
  if (configured) return { name: shortName(configured), literal: configured, how: 'config' };
  const published = clean(i.originHead);
  if (published) return { name: shortName(published), literal: published, how: 'origin-head' };
  return { name: null, literal: null, how: 'fallback' };
}

/* The ONE case where the source name is allowed to be wrong and still look
   right: harness.config.json is a tracked, per-branch file, so a branch can
   point `project.sourceBranch` at itself and go source-mode, where nothing is
   compared. The remote's own published default branch is the second opinion, and
   a disagreement between the two is reported rather than resolved — this script
   cannot know which of them is mid-rename. `--ref`/BRANCH_SYNC_REF are exempt on
   purpose: an operator typing a ref means it, and CI that pins the ref (the
   recommended shape) must not red for doing so. */
function sourceProblems(src) {
  const s = src || {};
  if (s.how !== 'config' || !s.originHead || s.originHead === s.name) return [];
  return ['project.sourceBranch in harness.config.json says `' + s.name + '`, but the remote publishes `'
    + s.originHead + '` as the default branch — one of them is wrong, and until they agree this'
    + ' branch may be comparing itself against itself'];
}

// Everything except one `## ` section, which runs from its heading to the next
// `## ` heading. `except` is a HEADING PREFIX, so `## 1.` does not match `## 10.`.
function maskSection(text, except) {
  const out = [];
  let skipping = false;
  for (const line of norm(text).split('\n')) {
    if (/^## /.test(line)) skipping = line.startsWith(except);
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

// [start, end) line indexes of the first `## ` section whose heading starts with `except`.
function sectionBounds(lines, except) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!/^## /.test(lines[i])) continue;
    if (start < 0) { if (lines[i].startsWith(except)) start = i; } else return [start, i];
  }
  return start < 0 ? null : [start, lines.length];
}

// The source's text with this branch's own section put back in its place. Where
// either side has no such section the source's text is returned whole, and the
// caller reports that as work owed — silently adopting the source's description
// of itself is how a branch ends up lying about what it is.
function spliceSection(sourceText, branchText, except) {
  const src = norm(sourceText).split('\n');
  const own = norm(branchText).split('\n');
  const a = sectionBounds(src, except);
  const b = sectionBounds(own, except);
  if (!a || !b) return src.join('\n');
  return src.slice(0, a[0]).concat(own.slice(b[0], b[1]), src.slice(a[1])).join('\n');
}

function dirDelta(sourceFiles, branchFiles) {
  const s = new Set(sourceFiles);
  const b = new Set(branchFiles);
  return {
    missing: [...s].filter((f) => !b.has(f)).sort(),
    extra: [...b].filter((f) => !s.has(f)).sort(),
    both: [...s].filter((f) => b.has(f)).sort(),
  };
}

// A manifest path: relative, POSIX, no `..`, no trailing slash, no drive letter.
// Checked rather than trusted because every path here is fed to `git show` and to
// fs, and a manifest is edited by hand far more often than this script is.
const REL = /^(?![/\\])(?![A-Za-z]:)(?!.*(^|\/)\.\.(\/|$))[^\\]*[^/\\]$/;
function manifestProblems(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['the manifest is not a JSON object'];
  const out = [];
  const list = (k) => { if (Array.isArray(m[k])) return m[k]; out.push('`' + k + '` must be an array'); return []; };
  const rel = (k, p) => { if (typeof p !== 'string' || !REL.test(p)) out.push(k + ': `' + p + '` is not a relative POSIX path'); };
  const files = list('files'), dirs = list('dirs'), per = list('perBranch'), sections = list('sections');
  files.forEach((p) => rel('files', p));
  dirs.forEach((p) => rel('dirs', p));
  per.forEach((p) => rel('perBranch', p));
  const inDir = (p) => dirs.find((d) => typeof p === 'string' && p.startsWith(d + '/'));
  // A path covered twice is not a tidiness problem: `dirs` compares a whole tree
  // and `files` compares one blob, so the same path under both would be graded
  // by two checks that can disagree, and the second verdict would overwrite the
  // reader's impression of the first.
  for (const p of files) if (inDir(p)) out.push('files: `' + p + '` is already covered by dirs `' + inDir(p) + '`');
  for (const p of per) if (files.includes(p)) out.push('perBranch: `' + p + '` is also listed as common');
  const seen = new Set();
  for (const s of sections) {
    if (!s || typeof s !== 'object') { out.push('sections: an entry is not an object'); continue; }
    rel('sections', s.path);
    if (typeof s.except !== 'string' || !/^## \S/.test(s.except)) out.push('sections: `' + s.path + '` needs `except`, a `## ` heading prefix');
    if (inDir(s.path)) out.push('sections: `' + s.path + '` is inside dirs `' + inDir(s.path) + '`, which compares it whole');
  }
  for (const p of files.concat(dirs, sections.map((s) => s && s.path))) {
    if (seen.has(p)) out.push('`' + p + '` is listed twice');
    seen.add(p);
  }
  const ig = m.ignore;
  if (!ig || typeof ig !== 'object') out.push('`ignore` must be an object');
  else for (const k of ['mustTrack', 'mustIgnore']) {
    if (!Array.isArray(ig[k])) out.push('ignore.' + k + ' must be an array');
    else ig[k].forEach((p) => rel('ignore.' + k, p));
  }
  const ps = m.packageScripts;
  if (!ps || typeof ps !== 'object' || Array.isArray(ps)) out.push('`packageScripts` must be an object');
  else for (const [k, v] of Object.entries(ps)) if (typeof v !== 'string' || !v) out.push('packageScripts.' + k + ' must be a non-empty string');
  return out;
}

// One check per entry. The order is the report's order.
function entriesOf(m) {
  const ig = m.ignore || {};
  return [].concat(
    m.files.map((p) => ({ kind: 'file', path: p })),
    m.dirs.map((p) => ({ kind: 'dir', path: p })),
    m.sections.map((s) => ({ kind: 'section', path: s.path, except: s.except })),
    m.perBranch.map((p) => ({ kind: 'perBranch', path: p })),
    (ig.mustTrack || []).map((p) => ({ kind: 'mustTrack', path: p })),
    (ig.mustIgnore || []).map((p) => ({ kind: 'mustIgnore', path: p })),
    Object.keys(m.packageScripts || {}).map((k) => ({ kind: 'script', path: 'package.json', name: k, want: m.packageScripts[k] })),
  );
}

const label = (e) => (e.kind === 'script' ? 'script package.json#' + e.name : e.kind + ' ' + e.path);
const sample = (xs) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? ', +' + (xs.length - 4) + ' more' : '');

/* ---------- git and the filesystem ---------- */

function currentBranch() {
  const r = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  // Detached, as a CI checkout of a pull request is: the variables name the
  // branch instead. Both are read because the two common CI shapes export
  // different ones, and a detached HEAD with neither is treated as a follower.
  return process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME
    || process.env.CI_COMMIT_REF_NAME || process.env.BRANCH_NAME || null;
}

const refExists = (r) => git(['rev-parse', '--verify', '--quiet', r + '^{commit}']).status === 0;

// The published default branch of the remote. Written by `git clone`, absent in a
// repo created with `git init`, and repaired by `git remote set-head origin -a`.
function originHead() {
  const r = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  return r.status === 0 && r.stdout.trim() ? shortName(r.stdout.trim()) : null;
}

/* The source branch as the repo itself states it. Read in SOFT mode: this script
   runs as a SessionStart hook, and a hook that throws over a malformed config
   takes the whole session with it. No config, or a broken one, simply means the
   name has to come from git instead. */
function configuredSource() {
  let cfg = null;
  try { cfg = load({ soft: true }); } catch { cfg = null; }
  return (cfg && cfg.project && cfg.project.sourceBranch) || null;
}

/* Local branch or remote-tracking branch, whichever is NEWER when one contains
   the other. When they have diverged the local one wins, because it is what this
   machine's next commit on the source branch will be made against. */
function pickRef(name) {
  if (!name) return null;
  const found = [name, 'origin/' + name].filter(refExists);
  if (found.length < 2) return found[0] || null;
  return git(['merge-base', '--is-ancestor', found[0], found[1]]).status === 0 ? found[1] : found[0];
}

function sourceOf(explicit) {
  const published = originHead();
  const d = decideSource({ explicit, configured: configuredSource(), originHead: published });
  const out = { name: d.name, ref: null, how: d.how, originHead: published };
  if (d.how === 'explicit') {
    // An explicit ref is used VERBATIM, not re-derived from its short name: the
    // whole point of `--ref origin/x` is to name one side of a pair.
    out.ref = refExists(d.literal) ? d.literal : null;
    return out;
  }
  if (d.how === 'fallback') {
    for (const c of CANDIDATES) {
      const r = pickRef(c);
      if (r) { out.name = c; out.ref = r; return out; }
    }
    out.name = CANDIDATES[0];
    return out;
  }
  out.ref = pickRef(d.name);
  return out;
}

const showAt = (ref, p) => { const r = git(['show', ref + ':' + p]); return r.status === 0 ? r.stdout : null; };
const bytesAt = (ref, p) => { const r = git(['show', ref + ':' + p], { encoding: 'buffer' }); return r.status === 0 ? r.stdout : null; };

// path -> blob id at the ref, for every blob under the given paths.
function treeAt(ref, paths) {
  const out = new Map();
  if (!paths.length) return out;
  const r = git(['ls-tree', '-r', '-z', ref, '--'].concat(paths));
  if (r.status !== 0) return out;
  for (const rec of r.stdout.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type, sha] = rec.slice(0, tab).split(' ');
    if (type === 'blob') out.set(rec.slice(tab + 1), sha);
  }
  return out;
}

// What a commit made now would carry under `dir`: tracked, or untracked and not
// ignored — and present on disk. Untracked-but-committable counts because an
// uncommitted harness helper is still the helper this session is running.
function filesOnDisk(dir) {
  const r = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', dir]);
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split('\0').filter(Boolean))].filter(isFile);
}

// Blob ids for working-tree files, computed BY GIT so .gitattributes applies: a
// CRLF checkout of an LF blob hashes to the same id, and only a real content
// change reads as drift. Hashing the bytes ourselves would make every file on a
// Windows checkout look drifted, which is a report nobody reads twice.
function hashLocal(files) {
  const present = [...new Set(files)].filter(isFile);
  const out = new Map();
  if (!present.length) return out;
  const r = git(['hash-object', '--stdin-paths'], { input: present.join('\n') + '\n' });
  if (r.status !== 0) return out;
  r.stdout.trim().split('\n').forEach((id, i) => out.set(present[i], id.trim()));
  return out;
}

// check-ignore: 0 ignored, 1 not ignored, 128 an error. --no-index so a TRACKED
// file is still judged by the patterns — the probe asks what the rules say, not
// what the index happens to hold, because the question is what a FRESH CLONE of
// this branch would carry.
const ignored = (p) => git(['check-ignore', '--no-index', '-q', '--', p]).status;

function readPackageScripts() {
  try { return JSON.parse(fs.readFileSync(abs('package.json'), 'utf8')).scripts || {}; } catch { return null; }
}

/* ---------- the checks ---------- */

// The entry kinds that are graded the same way in both modes, because they probe
// an EFFECT in this tree rather than compare against another tree.
function probeChecks(e) {
  if (e.kind === 'perBranch') return isFile(e.path) ? null : 'missing — this branch must carry its own copy';
  if (e.kind === 'mustTrack') {
    const s = ignored(e.path);
    return s === 1 ? null : s === 0 ? '.gitignore IGNORES it, so a fresh clone would not carry it' : 'git check-ignore failed';
  }
  if (e.kind === 'mustIgnore') {
    const s = ignored(e.path);
    return s === 0 ? null : s === 1 ? '.gitignore does NOT ignore it, so it would be committed' : 'git check-ignore failed';
  }
  if (e.kind === 'script') {
    const scripts = readPackageScripts();
    if (!scripts) return 'package.json is unreadable';
    return scripts[e.name] === e.want ? null : 'is ' + JSON.stringify(scripts[e.name] || null) + ', wants ' + JSON.stringify(e.want);
  }
  return undefined;
}

function sourceCheck(e) {
  const probe = probeChecks(e);
  if (probe !== undefined) return probe;
  if (e.kind === 'file') return isFile(e.path) ? null : 'listed as common, but absent from the source tree';
  if (e.kind === 'dir') return filesOnDisk(e.path).length ? null : 'listed as common, but holds nothing in the source tree';
  if (e.kind === 'section') {
    if (!isFile(e.path)) return 'listed as common, but absent from the source tree';
    return sectionBounds(norm(fs.readFileSync(abs(e.path), 'utf8')).split('\n'), e.except) ? null : 'has no `' + e.except + '` section to mask';
  }
  return 'unknown entry kind ' + e.kind;
}

function followerChecks(m, entries, ref) {
  const per = new Set(m.perBranch);
  const srcTree = treeAt(ref, m.files.concat(m.dirs));
  const mine = new Map(m.dirs.map((d) => [d, filesOnDisk(d).filter((f) => !per.has(f))]));
  const local = hashLocal(m.files.concat(...mine.values()));
  return entries.map((e) => {
    const probe = probeChecks(e);
    if (probe !== undefined) return { e, why: probe };
    if (e.kind === 'file') {
      const want = srcTree.get(e.path);
      const got = local.get(e.path);
      if (!want) return { e, why: 'the source carries no such file — the manifest names a path ' + shortName(ref) + ' does not have' };
      if (!got) return { e, why: 'missing on this branch' };
      return { e, why: want === got ? null : 'differs from ' + ref, drift: { write: want === got ? [] : [e.path] } };
    }
    if (e.kind === 'dir') {
      const src = [...srcTree.keys()].filter((f) => f.startsWith(e.path + '/') && !per.has(f));
      if (!src.length) return { e, why: 'the source holds nothing under it' };
      const d = dirDelta(src, mine.get(e.path));
      const changed = d.both.filter((f) => local.get(f) !== srcTree.get(f));
      const parts = [];
      if (d.missing.length) parts.push(d.missing.length + ' missing (' + sample(d.missing) + ')');
      if (changed.length) parts.push(changed.length + ' differ (' + sample(changed) + ')');
      // EXTRA is drift too. A directory is mirrored, not merely covered: a helper
      // the source deleted goes on being loaded here until something says so.
      if (d.extra.length) parts.push(d.extra.length + ' extra (' + sample(d.extra) + ')');
      return { e, why: parts.length ? parts.join('; ') : null, drift: { write: d.missing.concat(changed), remove: d.extra } };
    }
    if (e.kind === 'section') {
      const src = showAt(ref, e.path);
      if (src == null) return { e, why: 'the source carries no such file' };
      if (!isFile(e.path)) return { e, why: 'missing on this branch' };
      const own = fs.readFileSync(abs(e.path), 'utf8');
      const same = maskSection(src, e.except) === maskSection(own, e.except);
      return { e, why: same ? null : 'differs from ' + ref + ' outside its `' + e.except + '` section' };
    }
    return { e, why: 'unknown entry kind ' + e.kind };
  });
}

/* Everything --check, --apply and --hook need, decided once. Never throws for a
   git problem: a missing ref is reported as skipped checks, so the count stays
   structural even then. */
function evaluate(explicitRef) {
  const src = sourceOf(explicitRef);
  const ref = src.ref;
  const current = currentBranch();
  const mode = modeFor(current, ref || src.name);
  /* THE SELF-EXEMPTION GUARD. A follower reads the manifest from the SOURCE REF.
     Reading its own copy would mean the one file that decides what is compared is
     the one file a branch can edit to be compared less. With no source ref there
     is nothing to read from, so the local copy is read for its WELL-FORMEDNESS
     only and every entry is skipped below — a self-edited manifest still buys
     nothing, because no comparison happens at all. */
  const raw = mode === 'source' || !ref
    ? (isFile(MANIFEST) ? fs.readFileSync(abs(MANIFEST), 'utf8') : null)
    : showAt(ref, MANIFEST);
  let m = null;
  let parseError = null;
  try { m = raw == null ? null : JSON.parse(raw); } catch (err) { parseError = err.message; }
  const problems = (raw == null ? ['no ' + MANIFEST + (mode === 'follower' && ref ? ' at ' + ref : '') + ' to read']
    : parseError ? ['unparsable: ' + parseError] : manifestProblems(m)).concat(sourceProblems(src));
  const out = { ref, current, mode, source: src, manifest: problems.length ? null : m, results: [] };
  out.results.push({ e: { kind: 'manifest', path: MANIFEST }, why: problems.length ? problems.join('; ') : null });
  if (problems.length) return out;
  const entries = entriesOf(m);
  if (mode === 'follower' && !ref) {
    // No source to compare with (a clone that fetched only this branch, or a repo
    // with no commits yet). Declared, never green.
    out.results.push(...entries.map((e) => ({ e, skipped: true })));
    return out;
  }
  out.results.push(...(mode === 'source'
    ? entries.map((e) => ({ e, why: sourceCheck(e) }))
    : followerChecks(m, entries, ref)));
  return out;
}

/* ---------- --apply ---------- */

function writeFrom(ref, p) {
  const buf = bytesAt(ref, p);
  if (buf == null) return false;
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), buf);
  return true;
}

/* Writes the source's version of every drifted path, and says OWED for each
   thing it will not do. It does not commit, does not stage and does not run the
   gates: the point of pulling a harness change is that a human reads the diff it
   makes, and a script that commits for you removes the only step where that
   happens. */
function apply(ev) {
  const name = ev.source.name;
  if (ev.mode === 'source') {
    console.log('branch-sync: this checkout IS the source (' + ev.current + '), so there is nothing to apply.');
    return 0;
  }
  if (!ev.ref) { console.log('branch-sync: no source ref (`' + name + '` or `origin/' + name + '`) to apply from.'); return 1; }
  const wrote = [], removed = [], owed = [];
  for (const r of ev.results.filter((x) => x.why)) {
    const { e } = r;
    if (e.kind === 'manifest') { owed.push('the manifest itself: ' + r.why); continue; }
    if (e.kind === 'file' || e.kind === 'dir') {
      for (const p of ((r.drift && r.drift.write) || (e.kind === 'file' ? [e.path] : []))) if (writeFrom(ev.ref, p)) wrote.push(p);
      for (const p of (r.drift && r.drift.remove) || []) { fs.unlinkSync(abs(p)); removed.push(p); }
      continue;
    }
    if (e.kind === 'section') {
      const src = showAt(ev.ref, e.path);
      const own = isFile(e.path) ? fs.readFileSync(abs(e.path), 'utf8') : '';
      if (src == null) { owed.push(label(e) + ': ' + r.why); continue; }
      fs.writeFileSync(abs(e.path), spliceSection(src, own, e.except));
      wrote.push(e.path + ' (all but its `' + e.except + '` section)');
      if (!sectionBounds(norm(own).split('\n'), e.except)) owed.push(e.path + ': this branch had no `' + e.except + '` section, so the source\'s was copied — rewrite it to say what THIS branch is');
      continue;
    }
    if (e.kind === 'perBranch') {
      if (writeFrom(ev.ref, e.path)) { wrote.push(e.path + ' (seeded from ' + ev.ref + ')'); owed.push(e.path + ': seeded from the source — edit it for this branch before it means anything'); }
      else owed.push(e.path + ': missing, and the source has none to seed from');
      continue;
    }
    if (e.kind === 'script') {
      const pkg = JSON.parse(fs.readFileSync(abs('package.json'), 'utf8'));
      pkg.scripts = Object.assign({}, pkg.scripts, { [e.name]: e.want });
      fs.writeFileSync(abs('package.json'), JSON.stringify(pkg, null, 2) + '\n');
      wrote.push('package.json#scripts.' + e.name);
      continue;
    }
    // mustTrack / mustIgnore: .gitignore is per-branch and its ORDER matters (the
    // last matching pattern wins, and an excluded directory hides every negation
    // under it), so it is never rewritten by a script. Say what the rule has to
    // achieve instead, and let the person who knows the file edit it.
    owed.push(label(e) + ': ' + r.why + ' — port the matching stanza from ' + ev.ref + ':.gitignore by hand');
  }
  console.log('branch-sync --apply: from ' + ev.ref + ' onto ' + (ev.current || 'a detached HEAD'));
  for (const p of wrote) console.log('  wrote   ' + p);
  for (const p of removed) console.log('  removed ' + p);
  for (const o of owed) console.log('  OWED    ' + o);
  if (!wrote.length && !removed.length && !owed.length) console.log('  nothing drifted');
  console.log('\nNext: review `git status` and `git diff`, run the gate suite, and commit with explicit paths.');
  return owed.length ? 1 : 0;
}

/* ---------- report, --check, --hook ---------- */

const PULL = 'node scripts/harness/branch-sync.js --apply';

function report(ev) {
  const pass = ev.results.filter((r) => !r.skipped && !r.why).length;
  const fail = ev.results.filter((r) => !r.skipped && r.why).length;
  const skipped = ev.results.filter((r) => r.skipped).length;
  const at = ev.ref ? ev.ref + ' @ ' + String(git(['rev-parse', '--short', ev.ref]).stdout).trim() : 'NOT FOUND';
  console.log('branch-sync: ' + ev.mode + ' mode . branch ' + (ev.current || '(detached)')
    + ' . source ' + at + ' (' + ev.source.how + ')');
  for (const r of ev.results) {
    const mark = r.skipped ? '  - ' : r.why ? '  x ' : '  ok ';
    console.log(mark + label(r.e) + (r.why ? ' — ' + r.why : r.skipped ? ' — skipped: no source ref to compare against' : ''));
  }
  if (fail && ev.mode === 'follower') {
    console.log('\nHarness files change on `' + ev.source.name + '` first. Pull them here with:');
    console.log('  ' + PULL + '    then review the diff, run the gates, commit');
  }
  // The GATE line is LAST, always, in every mode and whether or not a source ref
  // was found: the gate runner reads the last stdout line, and a report that
  // skips the line because it had nothing to compare is read as a gate that died.
  console.log('GATE ' + GATE + ' pass=' + pass + ' fail=' + fail + ' skipped=' + skipped);
  return fail ? 1 : 0;
}

/* The SessionStart hook. Silent on the source branch and on any branch that
   matches — a hook that prints on a good day is a hook people learn to scroll
   past. On a drifted branch it NAMES the paths and the ONE command that fixes
   them, because a warning without the command is a warning that gets deferred. */
const ALLOW = Object.freeze({ deny: false, reason: '' });

/* decideSessionStart(event, state): the report as a neutral verdict, pure. `state.ev` is what
   evaluate() returned, gathered by the caller: scripts/harness/hook.js on the registered path,
   hook() below for this file's own --hook. The event is not read. It never denies. */
function decideSessionStart(event, state) {
  const ev = state && state.ev;
  if (!ev || ev.mode !== 'follower') return ALLOW;
  const bad = ev.results.filter((r) => r.why);
  if (!bad.length) return ALLOW;
  const text = [
    '*** HARNESS DRIFT: branch ' + (ev.current || '(detached)') + ' vs ' + (ev.ref || ev.source.name) + ' ***',
    'These harness paths differ from the source. The guards, gates and doc contract on this branch',
    'are therefore not the ones every other branch runs:',
    '',
    ...bad.slice(0, 12).map((r) => '  - ' + label(r.e) + ': ' + r.why),
    ...(bad.length > 12 ? ['  - … and ' + (bad.length - 12) + ' more'] : []),
    '',
    'Harness files change on `' + ev.source.name + '` first. To pull them here:',
    '  ' + PULL + '   then review the diff, run the gates, commit.',
  ].join('\n');
  return {
    deny: false,
    reason: '',
    context: text,
    message: 'WARNING: ' + bad.length + ' harness path(s) drifted from ' + (ev.ref || ev.source.name) + ' — see context.',
  };
}

/* --hook: the same report in the one wire format this file has always printed. */
function hook(ev) {
  const v = decideSessionStart(null, { ev });
  if (!v.context) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: v.context },
    systemMessage: v.message,
  }));
}

/* ---------- --self-test ---------- */

function selfTest() {
  const fails = [];
  const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); };
  const DOC = '# t\n\n## 0. zero\na\n\n## 1. What this is\nmine\n\n## 2. two\nb\n';

  eq('shortName: a local branch', shortName('main'), 'main');
  eq('shortName: the remote-tracking ref', shortName('origin/trunk'), 'trunk');
  eq('shortName: a full ref', shortName('refs/heads/master'), 'master');
  eq('shortName: a remote full ref', shortName('refs/remotes/origin/main'), 'main');

  eq('modeFor: on the source branch', modeFor('main', 'origin/main'), 'source');
  eq('modeFor: on a long-lived feature branch', modeFor('release/2.x', 'main'), 'follower');
  eq('modeFor: detached with no CI name is a follower, never a silent source', modeFor(null, 'main'), 'follower');
  eq('modeFor: a branch whose name merely ENDS in the source name is a follower', modeFor('not-main', 'main'), 'follower');
  eq('modeFor: a repo whose default is `trunk`', modeFor('trunk', 'origin/trunk'), 'source');

  // The source-branch decision, by precedence. This is the part a hard-coded
  // `main` got wrong, so every rung of the ladder is driven with literals.
  const decide = (i) => { const d = decideSource(i); return [d.name, d.how]; };
  eq('source: an explicit ref wins over everything',
    decide({ explicit: 'origin/spike', configured: 'master', originHead: 'main' }), ['spike', 'explicit']);
  eq('source: the config wins over the remote',
    decide({ configured: 'trunk', originHead: 'main' }), ['trunk', 'config']);
  eq('source: the remote\'s published default is used when the config is silent',
    decide({ originHead: 'master' }), ['master', 'origin-head']);
  eq('source: with nothing stated it falls back, and SAYS it fell back',
    decide({}), [null, 'fallback']);
  eq('source: a blank or whitespace setting is not a setting',
    decide({ configured: '   ', originHead: 'main' }), ['main', 'origin-head']);
  eq('source: a value with a space in it is refused rather than passed to git',
    decide({ configured: 'my branch', originHead: 'main' }), ['main', 'origin-head']);
  eq('source: `main` is the first fallback candidate', CANDIDATES[0], 'main');
  eq('source: the fallback list covers the common public defaults',
    CANDIDATES.includes('master') && CANDIDATES.includes('trunk'), true);

  eq('source: a config override that disagrees with the remote is reported',
    sourceProblems({ how: 'config', name: 'release/2.x', originHead: 'main' }).length, 1);
  eq('source: ...and agreement is silent',
    sourceProblems({ how: 'config', name: 'main', originHead: 'main' }), []);
  eq('source: ...and an explicit --ref is never second-guessed',
    sourceProblems({ how: 'explicit', name: 'spike', originHead: 'main' }), []);
  eq('source: ...nor is the remote disagreeing with itself',
    sourceProblems({ how: 'origin-head', name: 'main', originHead: 'main' }), []);

  eq('maskSection drops exactly the named section', maskSection(DOC, '## 1.'), '# t\n\n## 0. zero\na\n\n## 2. two\nb\n');
  eq('maskSection: CRLF and LF mask to the same text', maskSection(DOC.replace(/\n/g, '\r\n'), '## 1.'), maskSection(DOC, '## 1.'));
  eq('maskSection: a §1 edit is invisible', maskSection(DOC.replace('mine', 'yours'), '## 1.'), maskSection(DOC, '## 1.'));
  eq('maskSection: a §2 edit is NOT', maskSection(DOC.replace('\nb\n', '\nB\n'), '## 1.') === maskSection(DOC, '## 1.'), false);
  eq('maskSection: `## 10.` is not `## 1.` when the prefix carries the dot',
    maskSection('## 10. ten\nx\n', '## 1.'), '## 10. ten\nx\n');

  const BRANCH = DOC.replace('mine', 'what this branch is\nsecond line');
  eq('spliceSection keeps the branch\'s own section and takes everything else from the source',
    spliceSection(DOC.replace('\na\n', '\nA\n'), BRANCH, '## 1.'),
    DOC.replace('\na\n', '\nA\n').replace('mine', 'what this branch is\nsecond line'));
  eq('spliceSection: a branch with no §1 gets the source whole', spliceSection(DOC, '# nothing here\n', '## 1.'), DOC);
  eq('spliceSection: §1 as the LAST section still splices', spliceSection('## 0. a\nx\n## 1. b\nsrc\n', '## 0. a\ny\n## 1. b\nown\n', '## 1.'), '## 0. a\nx\n## 1. b\nown\n');

  eq('dirDelta', dirDelta(['d/a', 'd/b'], ['d/b', 'd/c']), { missing: ['d/a'], extra: ['d/c'], both: ['d/b'] });

  const GOOD = { files: ['CLAUDE.md'], dirs: ['scripts/harness'], perBranch: ['harness.config.json'],
    sections: [{ path: 'AGENTS.md', except: '## 1.' }], ignore: { mustTrack: ['.claude/settings.json'], mustIgnore: ['scripts/harness/gates.json'] },
    packageScripts: { test: 'node --test' } };
  eq('manifest: a well-formed one has no problems', manifestProblems(GOOD), []);
  eq('manifest: one check per entry, structurally', entriesOf(GOOD).length, 7);
  const bad = (patch) => manifestProblems(Object.assign({}, GOOD, patch)).length > 0;
  eq('manifest: an absolute path is refused', bad({ files: ['/etc/passwd'] }), true);
  eq('manifest: a `..` escape is refused', bad({ files: ['../outside.md'] }), true);
  eq('manifest: a drive letter is refused', bad({ files: ['C:/x.md'] }), true);
  eq('manifest: a backslash path is refused', bad({ files: ['docs\\x.md'] }), true);
  eq('manifest: a trailing slash is refused', bad({ dirs: ['scripts/harness/'] }), true);
  eq('manifest: a file already inside a common dir is refused', bad({ files: ['scripts/harness/gates.js'] }), true);
  // A path that is in NO other list, and the finding matched by its own words: with a path that
  // GOOD already carries as a section, the "listed twice" rule answers instead and this case
  // stays green with the per-branch rule deleted.
  eq('manifest: a path both common and per-branch is refused',
    manifestProblems(Object.assign({}, GOOD, { files: ['X.md'], perBranch: ['X.md'] })), ['perBranch: `X.md` is also listed as common']);
  eq('manifest: a section with no heading prefix is refused', bad({ sections: [{ path: 'AGENTS.md', except: '1.' }] }), true);
  eq('manifest: a section inside a mirrored dir is refused', bad({ sections: [{ path: 'scripts/harness/x.md', except: '## 1.' }] }), true);
  eq('manifest: a missing ignore block is refused', bad({ ignore: undefined }), true);
  eq('manifest: an empty package script is refused', bad({ packageScripts: { test: '' } }), true);
  eq('manifest: a duplicate is refused', bad({ files: ['AGENTS.md', 'AGENTS.md'] }), true);
  eq('manifest: not an object', manifestProblems([]).length > 0, true);

  // The live manifest, in whichever tree this runs: it must be well-formed
  // wherever it is read, because a follower reads it from a ref and a malformed
  // one there would stop every comparison on every branch at once.
  let live = null;
  try { live = JSON.parse(fs.readFileSync(abs(MANIFEST), 'utf8')); } catch { /* reported below */ }
  eq('the committed manifest parses', Boolean(live), true);
  if (live) eq('the committed manifest has no problems', manifestProblems(live), []);
  if (live) eq('the committed manifest never lists a per-branch path as common',
    live.perBranch.filter((p) => live.files.includes(p)), []);
  if (live) eq('the committed manifest covers this script itself',
    live.dirs.some((d) => 'scripts/harness/branch-sync.js'.startsWith(d + '/')), true);

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? '\nFAIL — branch-sync.js self-test: ' + fails.length + ' assertion(s)'
    : 'PASS — branch-sync.js self-test (' + (live ? entriesOf(live).length + 1 : 0) + ' checks in the live manifest)');
  return fails.length ? 1 : 0;
}

/* ---------- main ---------- */

function main() {
  if (has('--self-test')) return process.exit(selfTest());
  const explicit = valueOf('--ref') || process.env.BRANCH_SYNC_REF || null;
  if (has('--hook')) {
    // A SessionStart hook that throws takes the session with it; no reminder is
    // worth that. Exit 0 whatever happened, and say nothing when there is
    // nothing to say.
    try { hook(evaluate(explicit)); } catch { /* stay quiet */ }
    return process.exit(0);
  }
  const ev = evaluate(explicit);
  if (has('--apply')) return process.exit(apply(ev));
  const code = report(ev);
  // Bare, this is a REPORT: it prints the GATE line and exits 0, so reading the
  // state of a branch is not an error. `--check` is the same condition as a
  // GATE, and a gate's verdict is its exit code as well as its line.
  return process.exit(has('--check') ? code : 0);
}

module.exports = {
  shortName, modeFor, decideSource, sourceProblems, maskSection, sectionBounds,
  spliceSection, dirDelta, manifestProblems, entriesOf, evaluate, decideSessionStart, CANDIDATES,
};

if (require.main === module) main();
