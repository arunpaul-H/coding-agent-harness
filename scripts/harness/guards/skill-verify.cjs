#!/usr/bin/env node
/**
 * skill-verify.cjs — THE SUPPLY-CHAIN LAYER FOR AGENT SKILLS.
 *
 * WHY THIS EXISTS
 * A skill is not a library. A library is code the machine executes inside a
 * sandbox you control; a skill is PROSE THE MODEL FOLLOWS AS INSTRUCTION.
 * Installing one is closer to granting edit access to your system prompt than to
 * running `npm install`, so an unreviewed change to a skill is an unreviewed
 * change to this agent's behaviour. Code scanners find nothing, because there is
 * no code to scan: the dangerous payload is a sentence.
 *
 * This file cannot make a skill safe. Nothing can — an instruction-following
 * agent reading attacker-controlled text is an unsolved problem. What it
 * guarantees is narrower and achievable: NOTHING CHANGES SILENTLY. Every skill
 * you reviewed is hash-pinned, every skill you did not review is named, and
 * everything this repo cannot secure at all is reported as uncovered rather than
 * left out of the report.
 *   The full argument and the eight-gate review checklist:
 *   docs/reference/skill-safety/
 *
 * MODES
 *   --check        the gate. A real verdict ending in a GATE line.
 *   (no flag)      the same verdict as human prose, no GATE line.
 *   --json         machine-readable. `ok` plus fully attributed findings.
 *   --hook         SessionStart. Reports into context and ALWAYS exits 0.
 *   --gate         PreToolUse. Denies a read of a drifted or unvetted skill.
 *   --update       re-baseline, AFTER reading the diff. Never wired to a hook.
 *   --self-test    drive every pure decision with literals; exit 0 on pass.
 *
 * DIGEST ALGORITHM (sha256-dir-v2) — written down because v1's was not, which is
 * why v1's digests could never be reproduced from the files on disk:
 *   - walk the skill directory recursively, skipping .git and node_modules
 *   - sort entries by POSIX-normalised relative path, so the digest is stable
 *     across Windows, macOS and Linux
 *   - fold "<relpath>\0<bytes>\0" into one running sha256, so a RENAME registers
 *     as surely as an edit
 *   - normalise CRLF to LF first: line-ending churn is not tampering, and a check
 *     that cries wolf is a check that gets switched off
 *
 * Zero dependencies, Node built-ins only.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* The repo root comes from the config seam, never from a local
   `path.resolve(__dirname, '..', '..', '..')`. Three entry points reach this file — a
   gate run, a hook whose cwd is wherever the session happened to be, and the
   test suite — and only config.js knows how to answer all three. */
const { ROOT, resolve } = require('../config.js');

const LOCK_REL = 'skills-lock.json';
const LOCK_PATH = resolve(LOCK_REL);
const HASH_ALGO = 'sha256-dir-v2';

/* The GATE line name. It must match the gate's `name` (or its `gateLine`) in
   harness.config.json, or the runner reads no verdict and reports that the gate
   died before printing one. */
const GATE_NAME = 'skills';

/* THE TWO SKILL ROOTS, and why there are two.
   A vendored third-party skill exists twice: the archival copy under
   .agents/skills/ (what the lock records, and what a clone contains) and the
   live copy under .claude/skills/ (what the agent actually loads). Hashing only
   the first would leave the bytes that matter unverified.

   These are constants rather than config, deliberately. harness.config.json has
   a closed set of top-level keys and the runtime looks for skills in fixed
   places anyway, so a configurable skill root would only ever be a way to point
   the verifier at a directory the agent does not load. */
const SKILL_ROOTS = [
  { rel: '.agents/skills', dir: resolve('.agents', 'skills'), firstParty: false },
  { rel: '.claude/skills', dir: resolve('.claude', 'skills'), firstParty: true },
];
const VENDOR_ROOT = SKILL_ROOTS[0].dir;
const LIVE_ROOT = SKILL_ROOTS[1].dir;

/* The agent runtime's own state, read and never written. It is the only place
   that says which plugins are ENABLED, and enablement is what makes a plugin
   worth reviewing: a plugin set to false injects nothing into any session.

   ⚠ Only ever REPORTED in tilde form. The resolved path contains the operator's
   username, and this tool's output lands in transcripts, logs and bug reports. */
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const AGENT_SETTINGS = HOME ? path.join(HOME, '.claude', 'settings.json') : '';
const INSTALLED_PLUGINS = HOME ? path.join(HOME, '.claude', 'plugins', 'installed_plugins.json') : '';
const SETTINGS_LABEL = '~/.claude/settings.json';
const INSTALLED_LABEL = '~/.claude/plugins/installed_plugins.json';

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist']);

// ---------------------------------------------------------------- hashing

function walkFiles(dir) {
  const out = [];
  (function rec(cur) {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return; // an unreadable subdirectory is reported by the caller as MISSING, not thrown
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) rec(path.join(cur, e.name));
      } else if (e.isFile()) {
        out.push(path.join(cur, e.name));
      }
    }
  })(dir);
  return out;
}

const relPosix = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const fromRoot = (abs) => relPosix(ROOT, abs);

/* CRLF -> LF on the bytes, not on a decoded string: a skill may bundle a binary,
   and 'binary' (latin1) round-trips every byte so the digest covers it. */
function normalise(bytes) {
  return Buffer.from(bytes.toString('binary').replace(/\r\n/g, '\n'), 'binary');
}

/** The sha256-dir-v2 fold over `{ rel: bytes }`, wherever the bytes came from. */
function hashFileMap(map) {
  const h = crypto.createHash('sha256');
  for (const rel of Object.keys(map).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    h.update(rel, 'utf8');
    h.update('\0');
    h.update(normalise(map[rel]));
    h.update('\0');
  }
  return h.digest('hex');
}

/** Fold an entire skill directory into one sha256. null if the directory is absent. */
function hashSkillDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const map = {};
  for (const abs of walkFiles(dir)) map[relPosix(dir, abs)] = fs.readFileSync(abs);
  return hashFileMap(map);
}

// ---------------------------------------------------------------- rendering

/* A RENDERED COPY: this repo's own skill, written a second time for the tools that load skills
   from the shared root and not from the live one. It is the same body with a shorter
   frontmatter, because a key only one runtime reads (a fork, a named subagent, an invocation
   switch) means nothing to the others, or something else. The two keys kept are the two every
   tool reading that root documents (the multi-tool research file, section C: `docs` evidence,
   no tool was run). Rendering is a pure function of the source, so the copy can be CHECKED
   against it instead of trusted: see verifyMirrors. */
const PORTABLE_KEYS = ['name', 'description'];
const SKILL_FILE = 'SKILL.md';

/** A skill file with only the portable frontmatter keys. A continuation line (indented, or a
 *  list item) stays with the key above it. Text with no frontmatter block is returned as is. */
function renderSkillText(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return lines.join('\n');
  const end = lines.indexOf('---', 1);
  if (end < 0) return lines.join('\n');
  const kept = [];
  let keep = false;
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+)\s*:/.exec(l);
    if (m) keep = PORTABLE_KEYS.includes(m[1]);
    if (keep) kept.push(l);
  }
  return ['---'].concat(kept, lines.slice(end)).join('\n');
}

/** What a skill directory renders to, as `{ rel: bytes }`. null if the directory is absent. */
function renderSkillFiles(dir) {
  if (!fs.existsSync(dir)) return null;
  const map = {};
  for (const abs of walkFiles(dir)) {
    const rel = relPosix(dir, abs);
    const bytes = fs.readFileSync(abs);
    map[rel] = rel === SKILL_FILE ? Buffer.from(renderSkillText(bytes.toString('utf8')), 'utf8') : bytes;
  }
  return map;
}

/** The lock entry for a rendered copy. It carries NO reviewedAt: a date there says a person read
 *  the skill that day, and an installer is not a person. What the entry pins is narrower and
 *  true: these are the bytes the source rendered to. */
function renderedLockEntry(sourceRel, destRel, map) {
  const digests = {};
  for (const rel of Object.keys(map)) digests[rel] = crypto.createHash('sha256').update(normalise(map[rel])).digest('hex');
  return {
    source: 'local', sourceType: 'rendered', renderedFrom: sourceRel, skillDir: destRel,
    computedHash: hashFileMap(map), fileDigests: digests, hashAlgo: HASH_ALGO,
  };
}

/** Per-file digests. These are what let a drift report NAME the changed file. */
function fileDigests(dir) {
  const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const abs of walkFiles(dir)) {
    map[relPosix(dir, abs)] = crypto.createHash('sha256').update(normalise(fs.readFileSync(abs))).digest('hex');
  }
  return map;
}

/** Name the specific files that differ. null when there is nothing to compare. */
function diffFiles(before, after) {
  if (!before) return null;
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after || {})])) {
    if (!(k in before)) changed.push('+ ' + k + ' (added)');
    else if (!(k in (after || {}))) changed.push('- ' + k + ' (removed)');
    else if (before[k] !== after[k]) changed.push('~ ' + k + ' (modified)');
  }
  return changed.sort();
}

// ---------------------------------------------------------------- the report object

/* Two parallel records, because they answer different questions.

   `findings` is what a human or a hook reads: one line per problem, attributed
   to a kind and a name, at error or warn severity.

   `checks` is what the GATE line counts: one row per thing actually graded, each
   landing in exactly one of pass / fail / skip. They are separate because a WARN
   is a finding that must not move the verdict — see the plugin half below — and a
   SKIP is a verdict about nothing, which must never be reported as a pass. */
function newReport() {
  return { findings: [], checks: [] };
}
const grade = (rep, subject, verdict, note) => rep.checks.push({ subject, verdict, note: note || '' });
const finding = (rep, f) => rep.findings.push(f);

/** The GATE line's three numbers. Pure, so the arithmetic is testable. */
function tally(checks) {
  const t = { pass: 0, fail: 0, skipped: 0 };
  for (const c of checks || []) {
    if (c.verdict === 'pass') t.pass++;
    else if (c.verdict === 'fail') t.fail++;
    else t.skipped++;
  }
  return t;
}

// ---------------------------------------------------------------- skills

function resolveSkillDir(name, entry) {
  // An explicit skillDir wins. Otherwise the vendored root plus the entry's own
  // name, which is the shape a hand-written entry takes before --update fills it.
  if (entry && entry.skillDir) return path.join(ROOT, entry.skillDir);
  return path.join(VENDOR_ROOT, name);
}

function verifySkills(lock, rep, only) {
  for (const [name, entry] of Object.entries((lock && lock.skills) || {})) {
    if (only && name !== only) continue;
    const dir = resolveSkillDir(name, entry);
    const actual = hashSkillDir(dir);

    if (actual === null) {
      /* MISSING is usually a pointing error, not tampering, and the commonest
         form of it is an entry whose skillDir names the gitignored live mirror
         instead of the tracked copy. That pins a digest over bytes a clone does
         not contain, so the gate fails on checkout before anyone has touched a
         skill — and the documented way to clear it is --update, the one action
         that must never be reflexive. See docs/reference/skill-safety/. */
      finding(rep, {
        kind: 'skill', name, severity: 'error',
        message: 'MISSING — no directory at ' + fromRoot(dir) +
          '; a lock entry must point at the TRACKED copy, or it fails on clone',
      });
      grade(rep, 'skill:' + name, 'fail');
      continue;
    }
    // `!entry` first: the lock is an input, and an entry hand-written as `null`
    // would otherwise throw here and take every other skill's verdict with it.
    if (!entry || !entry.computedHash) {
      finding(rep, {
        kind: 'skill', name, severity: 'error',
        message: 'UNPINNED — the entry records no computedHash, so nothing is being verified; ' +
          'review the skill, then run --update',
      });
      grade(rep, 'skill:' + name, 'fail');
      continue;
    }
    if (entry.computedHash !== actual) {
      finding(rep, {
        kind: 'skill', name, severity: 'error',
        message: 'DRIFT — expected ' + String(entry.computedHash).slice(0, 12) + '… got ' + actual.slice(0, 12) + '…',
        changed: diffFiles(entry.fileDigests, fileDigests(dir)),
      });
      grade(rep, 'skill:' + name, 'fail');
      continue;
    }
    grade(rep, 'skill:' + name, 'pass');
  }
}

/**
 * The live mirror must be byte-identical to the copy the lock records. Tampering
 * with the copy the agent actually loads would otherwise pass clean.
 *
 * Symlinked entries are skipped: same bytes by construction, and on Windows a
 * link read as a directory would be hashed twice for nothing.
 */
function verifyMirrors(lock, rep, only) {
  for (const [name, entry] of Object.entries((lock && lock.skills) || {})) {
    if (only && name !== only) continue;
    const canonical = resolveSkillDir(name, entry);
    /* A RENDERED copy is never byte-identical to its source, so equality is the wrong question.
       The right one is whether the copy is still what the source renders to: an edit to either
       side that the other did not follow is two tools following two different instructions. */
    if (entry && typeof entry.renderedFrom === 'string' && entry.renderedFrom) {
      const rendered = renderSkillFiles(path.join(ROOT, entry.renderedFrom));
      if (rendered === null || !fs.existsSync(canonical)) continue; // no source here, or MISSING above
      if (hashFileMap(rendered) !== hashSkillDir(canonical)) {
        const want = {};
        for (const rel of Object.keys(rendered)) want[rel] = crypto.createHash('sha256').update(normalise(rendered[rel])).digest('hex');
        finding(rep, {
          kind: 'skill', name, severity: 'error',
          message: 'RENDER-DRIFT — ' + fromRoot(canonical) + ' is not what ' + entry.renderedFrom +
            ' renders to; two tools would follow two different skills. Re-run `harness init` after reading the diff',
          changed: diffFiles(want, fileDigests(canonical)),
        });
        grade(rep, 'mirror:' + name, 'fail');
        continue;
      }
      grade(rep, 'mirror:' + name, 'pass');
      continue;
    }
    const live = path.join(LIVE_ROOT, name);
    if (path.resolve(canonical) === path.resolve(live)) continue; // the lock points at the live copy
    let st;
    try {
      st = fs.lstatSync(live);
    } catch {
      continue; // not mirrored — nothing to compare, and nothing to claim
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;
    if (!fs.existsSync(canonical)) continue; // MISSING is already reported above

    const a = hashSkillDir(canonical);
    const b = hashSkillDir(live);
    if (a !== b) {
      finding(rep, {
        kind: 'skill', name, severity: 'error',
        message: 'MIRROR-DRIFT — ' + SKILL_ROOTS[1].rel + '/' + name + ' differs from ' + fromRoot(canonical) +
          '; the loaded copy is not the reviewed one',
        changed: diffFiles(fileDigests(canonical), fileDigests(live)),
      });
      grade(rep, 'mirror:' + name, 'fail');
      continue;
    }
    grade(rep, 'mirror:' + name, 'pass');
  }
}

/**
 * The severity of an UNLOCKED skill — one present on disk and absent from the
 * lock — depends on which root it sits in, and the distinction is load-bearing.
 *
 *   a VENDORED root (.agents/skills/) holds bytes that came from somewhere else.
 *   The lock is the ONLY record that anyone read them, so its absence is an
 *   ERROR. This matters more than drift: drift means someone edited a skill you
 *   reviewed, UNLOCKED means a skill arrived and was never reviewed at all,
 *   which is the likelier path in the field.
 *
 *   the PROJECT root (.claude/skills/) holds this repo's own skills. They arrive
 *   through the same review path as the rest of the repo — a tracked diff — so a
 *   digest over them is bookkeeping rather than integrity, and making it an
 *   error would put the gate in the red on a fresh clone of a clean repo. A gate
 *   that fails on day one is switched off on day two, and that costs you the
 *   error cases too. So: a WARN, reported every session until it is pinned or
 *   acknowledged, never a figure that blocks.
 *
 * Returns the findings so the INVENTORY check can be graded once, rather than
 * once per skill: the question being graded is "is everything on disk named in
 * the lock", and a repo with twelve unvetted skills has one problem, not twelve.
 */
function findUnlockedSkills(lock, rep, only) {
  const known = new Set(Object.keys((lock && lock.skills) || {}));
  const seen = new Set();
  let vendored = 0;
  let firstParty = 0;
  for (const root of SKILL_ROOTS) {
    let entries;
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue; // the root does not exist on this machine
    }
    for (const e of entries) {
      // A symlink resolves into the vendored root, which this loop already covers.
      if (!e.isDirectory() || known.has(e.name) || seen.has(e.name)) continue;
      if (only && e.name !== only) continue;
      if (!fs.existsSync(path.join(root.dir, e.name, 'SKILL.md'))) continue;
      seen.add(e.name);
      if (root.firstParty) {
        firstParty++;
        finding(rep, {
          kind: 'skill', name: e.name, severity: 'warn',
          message: 'UNLOCKED — this repo\'s own skill at ' + root.rel + '/' + e.name +
            ' is reviewed in git history but pinned by nothing here; add a lock entry to pin it',
        });
      } else {
        vendored++;
        finding(rep, {
          kind: 'skill', name: e.name, severity: 'error',
          message: 'UNLOCKED — vendored at ' + root.rel + '/' + e.name + ' but absent from ' + LOCK_REL +
            ' (never vetted); run the eight-gate checklist before enabling it',
        });
      }
    }
  }
  return { vendored, firstParty, total: seen.size };
}

// ---------------------------------------------------------------- plugins

/**
 * Decide every plugin finding from three plain inputs, so the decision is
 * testable without a home directory, a plugin cache or a marketplace. Pure.
 *
 *   pins        lock.pluginPins          { "<id>": { sha, reviewedAt, note } }
 *   enabledMap  settings.enabledPlugins  { "<id>": true | false }
 *   installed   installed_plugins.json   { plugins: { "<id>": [{ gitCommitSha }] } }
 *
 * THE ENABLED SET IS THE SUBJECT, not the pin table. A plugin set to false
 * contributes no instructions to any session, so no review is owed for it, and
 * pinning every disabled one would bury the handful that actually speak — a
 * report padded with irrelevance is a report people skim. Turning it around also
 * gives the check something to say when the pin table is empty, which is the
 * state this repo ships in: an ENABLED plugin nobody pinned is the whole point.
 *
 * SEVERITY, and why it differs from the digest half. A plugin's files live
 * outside the repo and are replaced wholesale on update, so this lock cannot
 * secure them at all. An ERROR would therefore claim a control that does not
 * exist, and it would land on a fresh clone of a clean repo, where the operator
 * has done nothing wrong and nothing they can do inside this repo will clear it.
 * So:
 *   - an enabled, unpinned plugin is a WARN. It is reported every session, in
 *     those words: uncovered, not clean.
 *   - a pin that no longer describes its install is an ERROR. Pinning is opt-in,
 *     and a false assertion the operator made themselves is worth stopping for.
 * Reporting what cannot be secured beats implying coverage of it.
 */
function pluginFindings(pins, enabledMap, installed) {
  const out = [];
  const isEnabled = (id) => (enabledMap || {})[id] === true;
  const records = (installed && installed.plugins) || {};

  for (const [id, pin] of Object.entries(pins || {})) {
    const rec = records[id];
    if (!rec || !rec.length) {
      out.push({ kind: 'plugin', name: id, severity: 'warn', message: 'PINNED-NOT-INSTALLED — the pin describes nothing on this machine' });
      continue;
    }
    const actual = rec[0].gitCommitSha;
    if (!actual) {
      /* Not every marketplace hands out a commit — a packaged release exposes
         none — so TODAY there is nothing to compare. "Today" is the whole of
         that claim: nothing stops a marketplace moving to a git-backed install
         tomorrow, and an earlier revision of this logic asserted "and never will
         be", which is what made the hole below look deliberate. Say the caveat
         out loud instead of `continue`-ing past it. A pin with no commit behind
         it asserts only "a human read this once", which is worth strictly less
         than a digest and must not read as though it were one. */
      if (!isEnabled(id)) continue; // disabled: injects nothing, so nothing to caveat
      const when = pin && pin.reviewedAt ? ' on ' + pin.reviewedAt : '';
      out.push({
        kind: 'plugin', name: id, severity: 'warn',
        message: 'NO-SHA — the marketplace exposes no commit for this plugin, so it cannot be verified ' +
          'by commit; the pin records only that it was reviewed' + when,
      });
      continue;
    }

    /* Past here the install DOES expose a commit. Both branches below run for
       every pin, enabled or not: a pin that no longer describes its install is
       stale bookkeeping either way.

       ⚠ The next branch was once a hole, and it shipped: a pin recording
       "sha": null against an install exposing a gitCommitSha fell through both
       `if (!actual)` and `if (pin.sha && …)` and produced NO finding at all.
       That fails in the direction nobody notices — the standing NO-SHA warn
       would DISAPPEAR on exactly the day the plugin's bytes became verifiable
       and therefore may have changed, so the report gets quieter as the risk
       goes up. Every combination must land on a finding or on an explicit
       clean; nothing here may fall off the end. */
    if (!pin || !pin.sha) {
      out.push({
        kind: 'plugin', name: id, severity: 'error',
        message: 'NOW-VERIFIABLE — the install now exposes commit ' + String(actual).slice(0, 12) + '…, but the pin ' +
          'records no sha, so it predates the plugin becoming verifiable and proves nothing about the ' +
          'bytes now installed; re-read it and re-pin at that commit',
      });
      continue;
    }
    // String(): the lock is an input, and a sha that arrived as a number would
    // otherwise throw inside startsWith and take the whole check down with it.
    const pinned = String(pin.sha);
    if (!String(actual).startsWith(pinned) && !pinned.startsWith(String(actual))) {
      out.push({
        kind: 'plugin', name: id, severity: 'error',
        message: 'MOVED — pinned ' + pinned.slice(0, 12) + '… but installed ' + String(actual).slice(0, 12) + '…',
      });
    }
  }

  for (const [id, on] of Object.entries(enabledMap || {})) {
    if (on !== true || (pins && id in pins)) continue;
    out.push({
      kind: 'plugin', name: id, severity: 'warn',
      message: 'UNPINNED — enabled, installed outside this repo, and pinned by nothing: its instructions ' +
        'are unreviewed and this lock cannot secure them. Keep the enabled set small, or pin it.',
    });
  }
  return out;
}

/** Read a JSON file. Distinguishes ABSENT from UNREADABLE, which is the whole point. */
function readJson(file) {
  if (!file) return { state: 'absent' };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', why: e.code || e.message };
  }
  try {
    return { state: 'ok', value: JSON.parse(text) };
  } catch (e) {
    return { state: 'unreadable', why: 'not valid JSON: ' + e.message };
  }
}

/**
 * Read the two inputs the plugin decision needs, then hand them to
 * pluginFindings.
 *
 * Fail-soft, deliberately: this runs at SessionStart, and a verifier that throws
 * takes the whole context injection down with it. An unreadable input therefore
 * becomes a WARN and a SKIP — never an exception, and never a silent clean bill
 * of health that would read as "checked and fine".
 *
 * ABSENT is not UNREADABLE, and conflating them is how this check went red in
 * continuous integration. A machine with no agent settings at all has no plugin
 * surface: nothing is injected, so there is nothing to pin and the check passes
 * with that said out loud. A settings file that exists and cannot be read is a
 * surface of unknown size, so it skips.
 */
function verifyPluginPins(lock, rep) {
  const settings = readJson(AGENT_SETTINGS);
  if (settings.state === 'unreadable') {
    finding(rep, {
      kind: 'plugin', name: SETTINGS_LABEL, severity: 'warn',
      message: 'unreadable (' + settings.why + ') — the enabled-plugin set is unknown, so NO plugin was checked',
    });
    grade(rep, 'plugin-pins', 'skip', SETTINGS_LABEL + ' unreadable');
    return;
  }
  if (settings.state === 'absent') {
    grade(rep, 'plugin-pins', 'pass', 'no ' + SETTINGS_LABEL + ' on this machine: no plugin instructions are injected');
    return;
  }

  const enabledMap = (settings.value && settings.value.enabledPlugins) || {};
  const anyEnabled = Object.values(enabledMap).some((v) => v === true);
  const installed = readJson(INSTALLED_PLUGINS);
  if (installed.state !== 'ok') {
    // Only a problem if something is actually enabled. Nothing enabled and no
    // install record is a machine with no plugins, which is a clean answer.
    if (!anyEnabled && !Object.keys((lock && lock.pluginPins) || {}).length) {
      grade(rep, 'plugin-pins', 'pass', 'no plugins enabled');
      return;
    }
    finding(rep, {
      kind: 'plugin', name: INSTALLED_LABEL, severity: 'warn',
      message: (installed.state === 'absent' ? 'absent' : 'unreadable (' + installed.why + ')') +
        ' — installed commits are unknown, so no pin could be compared',
    });
    grade(rep, 'plugin-pins', 'skip', INSTALLED_LABEL + ' ' + installed.state);
    return;
  }

  const found = pluginFindings((lock && lock.pluginPins) || {}, enabledMap, installed.value);
  for (const f of found) finding(rep, f);
  grade(rep, 'plugin-pins', found.some((f) => f.severity === 'error') ? 'fail' : 'pass',
    found.length ? found.length + ' plugin finding(s), ' + found.filter((f) => f.severity === 'warn').length + ' uncovered' : '');
}

// ---------------------------------------------------------------- the whole verdict

function verifyAll(lock) {
  const rep = newReport();
  const locked = Object.keys((lock && lock.skills) || {}).length;

  verifySkills(lock, rep);
  verifyMirrors(lock, rep);
  const unlocked = findUnlockedSkills(lock, rep);

  /* THE CHECK DECLARES ITSELF WHEN IT GRADED NOTHING. An empty lock and an empty
     tree is the state a fresh repo is in, and the wrong answer is a green
     `pass=0 fail=0 skipped=0`: no green line may stand in for a check that never
     ran. Pass-by-absence is the exact failure the gate protocol exists to end,
     so this skips, says why, and is red for the caller unless the caller
     declares it with --allow-skip. */
  if (locked === 0 && unlocked.total === 0) {
    grade(rep, 'skill-digests', 'skip',
      'not applicable — 0 skills in ' + LOCK_REL + ' and 0 on disk, so 0 digests were graded');
  } else {
    grade(rep, 'skill-inventory', unlocked.vendored ? 'fail' : 'pass',
      unlocked.vendored ? unlocked.vendored + ' vendored skill(s) never vetted'
        : unlocked.firstParty ? unlocked.firstParty + ' project skill(s) unpinned (reported, not blocking)' : '');
  }

  verifyPluginPins(lock, rep);
  rep.gate = tally(rep.checks);
  rep.ok = !rep.findings.some((f) => f.severity === 'error');
  return rep;
}

// ---------------------------------------------------------------- update

/**
 * The date an entry should carry after a re-baseline. Pure, and separate from
 * rebaseline() so it can be asserted without a skills tree or a clock.
 *
 * ⚠ reviewedAt is a claim about a HUMAN, not about bytes: it says a person read
 * this skill on that day. An earlier version of rebaseline() stamped today onto
 * every entry unconditionally, which rewrote every date to the day --update
 * happened to run — an assertion that somebody re-read skills nobody opened.
 * That turns the lock into a rubber stamp, which is the exact failure this whole
 * file exists to prevent: the value of a review date is that it is FALSE to move
 * it.
 *
 * So: today only when today's run actually has something to say — the digest
 * changed (reading that change IS the review), or the entry carries no date at
 * all (nothing to preserve). Otherwise the old date stands.
 */
function nextReviewedAt(entry, digest, stamp) {
  if (!entry || !entry.reviewedAt) return stamp;   // never dated: record when it entered the lock
  if (entry.computedHash !== digest) return stamp; // bytes changed: this run is the real review
  return entry.reviewedAt;                         // unchanged: keep the date it was really read
}

function rebaseline(lock) {
  const skills = lock.skills || {};
  const stamp = new Date().toISOString().slice(0, 10);
  let changed = 0;
  let stamped = 0;
  let missing = 0;
  for (const [name, entry] of Object.entries(skills)) {
    const dir = resolveSkillDir(name, entry);
    const h = hashSkillDir(dir);
    if (h === null) {
      console.error('  skip ' + name + ' — no directory at ' + fromRoot(dir));
      missing++;
      continue;
    }
    const reviewedAt = nextReviewedAt(entry, h, stamp);
    if (entry.computedHash !== h) changed++;
    if (reviewedAt !== entry.reviewedAt) stamped++;
    entry.computedHash = h;
    entry.fileDigests = fileDigests(dir);
    entry.reviewedAt = reviewedAt;
    entry.hashAlgo = HASH_ALGO;
  }
  lock.version = 2;
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  return { total: Object.keys(skills).length, changed, stamped, missing, stamp };
}

/* --update NEVER ADOPTS a skill it finds on disk. Adding an entry is the act of
   saying "I read this", and a tool that did it for you would make the lock
   record whatever happened rather than what was reviewed. So the stub is
   PRINTED, for the operator to paste in once the checklist is done. */
function adoptionStub(name) {
  return JSON.stringify({
    [name]: {
      source: 'https://example.com/owner/repo',
      sourceType: 'git',
      skillPath: 'skills/' + name,
      skillDir: SKILL_ROOTS[0].rel + '/' + name,
      reviewedAt: new Date().toISOString().slice(0, 10),
    },
  }, null, 2).replace(/^\{\n|\n\}$/g, '');
}

// ---------------------------------------------------------------- PreToolUse gate

/**
 * True for tools that fire on ordinary files throughout the repo, and for MCP
 * tools, which cannot invoke a skill at all. For these, failing to find a skill
 * in the payload means the call is simply NOT ABOUT A SKILL, so it must be
 * allowed rather than swept into a whole-tree check.
 *
 * ⚠ `Skill` is deliberately NOT here, and neither is it blockable: see
 * docs/reference/skill-safety/02-enforcement.md. Invoking a skill injects its
 * body into the conversation without issuing a tool call, so there is no
 * PreToolUse event to intercept. The SessionStart report is the real control on
 * that path, and pretending otherwise would be the dangerous half of that
 * finding.
 */
function isPathTool(raw) {
  try {
    const name = JSON.parse(raw || '{}').tool_name || '';
    return /^(Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit)$/.test(name) || /^mcp__/.test(name);
  } catch {
    return false;
  }
}

/** The skill name a payload is about, or null. */
function targetSkill(raw) {
  const j = JSON.parse(raw || '{}');
  const ti = j.tool_input || j.toolInput || {};
  for (const v of [ti.skill, ti.skill_name, ti.skillName, ti.name, ti.command]) {
    if (typeof v !== 'string' || !v.trim()) continue;
    // Plugin skills arrive namespaced ("plugin:skill"); take the last segment.
    return v.split(':').pop().replace(/^\//, '').trim();
  }
  /* Read/Grep fallback: derive the skill from a path under a skills root. This
     does NOT cover skill invocation (see isPathTool); it covers the narrower
     case of something reading a skill file directly, which is where a tampered
     skill would otherwise be read in full. */
  for (const v of [ti.file_path, ti.filePath, ti.path, ti.pattern]) {
    if (typeof v !== 'string') continue;
    const m = v.replace(/\\/g, '/').match(/(?:\.claude|\.agents)\/skills\/([^/]+)/);
    if (m) return m[1];
  }
  return null;
}

function runGate(raw) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    process.exit(0); // no lock file — nothing to enforce, and nothing to claim
  }

  let target = null;
  let parsed = true;
  try {
    target = targetSkill(raw);
  } catch {
    parsed = false;
  }

  /* AN UNPARSEABLE PAYLOAD IS AN ASK, NEVER A SILENT ALLOW. A guard that cannot
     read its input has learned nothing about the call, and "I could not tell"
     must not render as "fine". Measured once across a whole guard set: an
     MCP-shaped payload was waved through by every guard, because none of them
     could read it and all of them defaulted to allow. */
  if (!parsed) {
    return emitDecision('ask',
      'skill-verify could not parse this PreToolUse payload, so it does not know whether the call ' +
      'touches a skill. An unreadable payload is not evidence of safety.',
      'ASK: unreadable hook payload.');
  }

  const rep = newReport();
  if (target) {
    if ((lock.skills || {})[target]) {
      verifySkills(lock, rep, target);
      verifyMirrors(lock, rep, target);
    }
    /* Fires only if a directory by this name exists under one of the two skill
       roots and is absent from the lock. Plugin-cache skills live outside the
       repo, so they resolve to nothing here and are correctly out of scope — the
       lock covers what this repo holds, pruning covers what it cannot. */
    findUnlockedSkills(lock, rep, target);
  } else if (!isPathTool(raw)) {
    /* Name unresolvable on a skill-shaped call: fall back to a drift check
       across every locked skill. Deliberately NOT the UNLOCKED check — denying
       skill A because unrelated skill B was never vetted is disproportionate.

       This branch must never be reached for Read/Grep/Glob or an mcp__ tool:
       those fire on every file in the repo, so "no skill in the payload" means
       "not a skill file", and blanket-checking would deny every unrelated read
       the moment any one skill drifted. A gate that blocks ordinary work gets
       switched off within a day, and that costs you the real gate. */
    verifySkills(lock, rep);
  }

  const errors = rep.findings.filter((f) => f.severity === 'error');
  if (!errors.length) process.exit(0);

  const detail = errors.map((f) => {
    const c = (f.changed || []).map((x) => '\n      ' + x).join('');
    return '  - "' + f.name + '": ' + f.message + c;
  }).join('\n');

  emitDecision('deny',
    '*** SKILL INTEGRITY FAILURE ***\n' +
    'A skill is prompt text the model follows as instruction. This one does not match\n' +
    LOCK_REL + ', so its instructions are not the ones that were reviewed.\n\n' +
    detail +
    '\n\nInspect the diff before trusting it:\n' +
    '  node scripts/harness/guards/skill-verify.cjs --check\n' +
    'Do NOT run --update to clear this. Re-baselining an unread change turns the check\n' +
    'into a rubber stamp in one keystroke.',
    'BLOCKED: ' + errors.length + ' skill integrity problem(s).');
}

function emitDecision(decision, reason, systemMessage) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
    systemMessage,
  }));
  process.exit(0); // the decision is carried in the JSON, not in the exit code
}

// ---------------------------------------------------------------- SessionStart

/**
 * SessionStart output. ALWAYS exits 0 — a hook that exits non-zero is a broken
 * session, so drift has to be reported in the output and never in the status.
 *
 * Errors print in full. Warns print as ONE summary line, because they are
 * permanent by nature (an enabled plugin this repo cannot secure does not stop
 * being unsecured) and a wall of text every session is a wall nobody reads. One
 * line every session is the right weight for a standing exception: something you
 * keep seeing rather than something you forget.
 */
const ALLOW = Object.freeze({ deny: false, reason: '' });

/**
 * THE DISK HALF of the session-start report: the lock, and the whole verification against it.
 * scripts/harness/hook.js calls this and hands the result to decideSessionStart().
 * ABSENT is not UNREADABLE (see main): no lock at all is a repo that predates the lock, and a
 * lock that exists and cannot be parsed is every pin switched off at once.
 */
function gatherSessionStart() {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? { lock: 'absent' } : { lock: 'unreadable', code: e.code || 'not valid JSON' };
  }
  return { lock: 'read', rep: verifyAll(lock) };
}

/**
 * The session-start report: decideSessionStart(event, state), pure. The event is not read.
 * `state` is what gatherSessionStart() returns. It NEVER denies: a session must start
 * whatever was found, so drift is reported as context and never as a refusal.
 */
function decideSessionStart(event, state) {
  const s = state || {};
  if (s.lock === 'absent') return ALLOW;
  if (s.lock === 'unreadable') {
    return {
      deny: false,
      reason: '',
      context: '*** SKILL INTEGRITY CHECK DID NOT RUN ***\n' +
        LOCK_REL + ' exists but cannot be read (' + s.code + '), so NO skill was\n' +
        'verified this session. Unverified, not clean. Repair the lock from git history —\n' +
        'do not regenerate it — then: node scripts/harness/guards/skill-verify.cjs --check\n',
      message: 'WARNING: ' + LOCK_REL + ' is unreadable — no skill was verified.',
    };
  }
  const rep = s.rep;
  if (!rep || !Array.isArray(rep.findings)) throw new Error('skill-verify: no report was gathered for this session start');
  const errors = rep.findings.filter((f) => f.severity === 'error');
  const warns = rep.findings.filter((f) => f.severity === 'warn');
  if (!errors.length && !warns.length) return ALLOW;

  let text = '';
  if (errors.length) {
    text += '*** SKILL INTEGRITY CHECK FAILED ***\n' +
      'A skill or a pinned plugin changed without being reviewed. Skills are instructions\n' +
      'this agent follows, so treat these as untrusted until read.\n\n' +
      errors.map((f) => {
        const c = (f.changed || []).map((x) => '\n      ' + x).join('');
        return '  - ' + f.kind + ' "' + f.name + '": ' + f.message + c;
      }).join('\n') +
      '\n\nDo not re-baseline to silence this. Review the diff, then:\n' +
      '  node scripts/harness/guards/skill-verify.cjs --update\n';
  }
  if (warns.length) {
    const names = warns.map((f) => f.name).slice(0, 6).join(', ');
    text += (errors.length ? '\n' : '') +
      'skill-safety: ' + warns.length + ' instruction source(s) this repo does not secure — ' +
      names + (warns.length > 6 ? ', …' : '') + '.\n' +
      'Uncovered, not clean. Details: node scripts/harness/guards/skill-verify.cjs --check\n';
  }

  return {
    deny: false,
    reason: '',
    context: text,
    message: errors.length
      ? 'WARNING: ' + errors.length + ' skill integrity problem(s) — see context.'
      : 'skill-safety: ' + warns.length + ' unsecured instruction source(s).',
  };
}

/** --hook, this file's own CLI: the same report in the one wire format it always printed.
 *  The registered path is scripts/harness/hook.js, where a dialect module spells it. */
function printSessionStart(v) {
  if (!v.context) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: v.context },
    systemMessage: v.message,
  }));
}
function emitHook(rep) {
  printSessionStart(decideSessionStart(null, { lock: 'read', rep }));
}

// ---------------------------------------------------------------- human report

function report(rep, lock, withGateLine) {
  const locked = Object.keys((lock && lock.skills) || {}).length;
  if (!rep.findings.length) {
    console.log('skill-verify: OK — ' + locked + ' skill(s) match their recorded digests.');
  } else {
    console.log('skill-verify: ' + (rep.ok ? 'FINDINGS (no errors)' : 'PROBLEMS FOUND') + '\n');
    for (const f of rep.findings) {
      console.log('  [' + f.severity.toUpperCase() + '] ' + f.kind + ' "' + f.name + '": ' + f.message);
      for (const c of f.changed || []) console.log('        ' + c);
    }
    console.log('');
  }
  for (const c of rep.checks) {
    if (c.verdict === 'skip') console.log('  skipped: ' + c.subject + ' — ' + (c.note || 'nothing graded'));
  }
  if (!rep.ok) {
    console.log('A hash mismatch is a STOP, not a warning. Read the diff before you trust it.');
    console.log('Re-baseline only after review:  node scripts/harness/guards/skill-verify.cjs --update');
  }
  // The GATE line is LAST on stdout, always, because that is where the runner
  // reads it from. Printing anything after it makes the gate look like it died
  // before reaching a verdict.
  if (withGateLine) {
    console.log('GATE ' + GATE_NAME + ' pass=' + rep.gate.pass + ' fail=' + rep.gate.fail + ' skipped=' + rep.gate.skipped);
  }
}

function readStdin(cb) {
  let d = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { d += c; });
  process.stdin.on('end', () => cb(d));
  // Nothing piped in must not hang the tool call that is waiting on this hook.
  setTimeout(() => { try { process.stdin.destroy(); } catch { /* already gone */ } cb(d); }, 2000).unref();
}

// ---------------------------------------------------------------- --self-test

/* Drives every PURE decision in this file with literals: the drift diff, the
   tool classification, the whole plugin verdict, the review-date rule and the
   GATE arithmetic. Everything else reads a skills tree and a lock file whose
   contents differ per machine, so a tree-dependent assertion here would be a
   flake rather than a test — the hook and --check paths are covered black-box in
   the test suite instead. */
function selfTest() {
  const fails = [];
  let n = 0;
  const must = (what, got, want) => {
    n++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
    }
  };

  /* the drift diff */
  must('no drift on identical digests', diffFiles({ 'a.md': 'h1' }, { 'a.md': 'h1' }), []);
  must('a MODIFIED file is drift', diffFiles({ 'a.md': 'h1' }, { 'a.md': 'h2' }), ['~ a.md (modified)']);
  /* ⚠ An ADDED file is drift too. A skill is prose the model follows as an
     instruction, so a new file dropped into a vetted skill is an unvetted
     instruction source — comparing only the files already known would miss the
     easiest way to smuggle one in. */
  must('an ADDED file is drift', diffFiles({}, { 'unreviewed.md': 'h' }), ['+ unreviewed.md (added)']);
  must('a REMOVED file is drift', diffFiles({ 'a.md': 'h' }, {}), ['- a.md (removed)']);
  must('an unlocked skill has nothing to diff against', diffFiles(null, { 'a.md': 'h' }), null);

  /* the tool classification that keeps the gate proportionate */
  const tool = (name) => isPathTool(JSON.stringify({ tool_name: name }));
  must('Read is a path tool', tool('Read'), true);
  must('Write is a path tool', tool('Write'), true);
  must('Bash is not', tool('Bash'), false);
  // Every PreToolUse matcher in this harness names mcp__ as well as its native
  // tools, so an MCP payload reaches this guard. It cannot invoke a skill, so it
  // must not trigger the whole-tree fallback on every call.
  must('an mcp__ tool is treated as a path tool, not a skill-shaped call', tool('mcp__server__do_thing'), true);
  // ⚠ Skill is NOT a path tool and is NOT blockable: the matcher does not fire,
  // so invocation cannot be intercepted. Claiming otherwise would be worse than
  // claiming nothing.
  must('Skill is not a path tool', tool('Skill'), false);
  must('an unparseable payload is not a path tool', isPathTool('nonsense'), false);
  must('an empty payload is not a path tool', isPathTool(''), false);

  /* targetSkill: which field carries the name */
  must('a namespaced plugin skill reduces to its last segment',
    targetSkill(JSON.stringify({ tool_input: { skill: 'vendor:some-skill' } })), 'some-skill');
  must('a read of a skill file resolves the skill',
    targetSkill(JSON.stringify({ tool_input: { file_path: 'C:\\repo\\.claude\\skills\\some-skill\\SKILL.md' } })), 'some-skill');
  must('an ordinary file resolves to no skill',
    targetSkill(JSON.stringify({ tool_input: { file_path: 'scripts/harness/gates.js' } })), null);

  /* pluginFindings: the plugin half's whole decision, with no plugin cache in
     sight. Compared as "<severity>:<id>:<leading tag>" so an assertion pins the
     VERDICT and not the wording of the sentence explaining it. */
  const tags = (out) => out.map((f) => f.severity + ':' + f.name + ':' + f.message.split(' ')[0]);
  const inst = (sha) => ({ plugins: { 'p@m': [sha ? { gitCommitSha: sha } : {}] } });

  // ⚠ warn, not error: a plugin's files live outside this repo and are replaced
  // wholesale on update, so the lock cannot secure them. An error here would
  // claim a control that does not exist, and it would be red on a clean clone.
  must('an ENABLED plugin absent from the pins is reported as uncovered',
    tags(pluginFindings({}, { 'p@m': true }, inst('abc123'))), ['warn:p@m:UNPINNED']);
  must('an enabled plugin pinned at the installed commit is clean',
    tags(pluginFindings({ 'p@m': { sha: 'abc123' } }, { 'p@m': true }, inst('abc123'))), []);
  must('a short pin that prefixes the installed commit is clean',
    tags(pluginFindings({ 'p@m': { sha: 'abc' } }, { 'p@m': true }, inst('abc123'))), []);
  // An error, because the operator asserted this pin themselves and it is false.
  must('an enabled plugin whose commit moved is an error',
    tags(pluginFindings({ 'p@m': { sha: 'abc123' } }, { 'p@m': true }, inst('def456'))), ['error:p@m:MOVED']);
  must('an enabled plugin the marketplace exposes no commit for is a warn',
    tags(pluginFindings({ 'p@m': { sha: null } }, { 'p@m': true }, inst(null))), ['warn:p@m:NO-SHA']);
  must('a DISABLED plugin absent from the pins is clean — it injects nothing',
    tags(pluginFindings({}, { 'p@m': false }, inst('abc123'))), []);
  must('a pinned plugin that is not installed is a warn',
    tags(pluginFindings({ 'p@m': { sha: 'abc123' } }, { 'p@m': true }, { plugins: {} })), ['warn:p@m:PINNED-NOT-INSTALLED']);
  must('an empty pin table with nothing enabled is clean',
    tags(pluginFindings({}, {}, inst('abc123'))), []);
  /* ⚠ The regression that made this logic report LESS as the risk went UP: a
     null-sha pin against an install that now DOES expose a commit matched
     neither the NO-SHA branch nor the MOVED branch, so the standing warn simply
     vanished the day the plugin became verifiable. Error, not warn: unlike the
     NO-SHA case there is now something to compare, and the pin does not compare. */
  must('a null-sha pin against an install that NOW exposes a commit is an error',
    tags(pluginFindings({ 'p@m': { sha: null } }, { 'p@m': true }, inst('abc123'))), ['error:p@m:NOW-VERIFIABLE']);
  must('a pin with no sha key at all is the same error',
    tags(pluginFindings({ 'p@m': { reviewedAt: '2020-01-01' } }, { 'p@m': true }, inst('abc123'))), ['error:p@m:NOW-VERIFIABLE']);
  must('a disabled null-sha pin against a commit-bearing install is still an error',
    tags(pluginFindings({ 'p@m': { sha: null } }, { 'p@m': false }, inst('abc123'))), ['error:p@m:NOW-VERIFIABLE']);

  /* nextReviewedAt: whether --update may assert that a human read a skill today.
     Pure, so this asserts the decision and not the clock. */
  const OLD = '2020-01-01';
  const TODAY = '2020-06-01';
  must('an unchanged digest keeps the date it was really reviewed on',
    nextReviewedAt({ computedHash: 'h1', reviewedAt: OLD }, 'h1', TODAY), OLD);
  must('a changed digest takes today, because reading that change IS the review',
    nextReviewedAt({ computedHash: 'h1', reviewedAt: OLD }, 'h2', TODAY), TODAY);
  must('an entry that never carried a date gets one',
    nextReviewedAt({ computedHash: 'h1' }, 'h1', TODAY), TODAY);
  must('a brand-new entry gets one', nextReviewedAt({}, 'h1', TODAY), TODAY);

  /* the GATE arithmetic. pass+fail+skipped must be the TOTAL, because comparing
     only `pass` cannot tell a green run from a run where checks VANISHED. */
  const t = tally([{ verdict: 'pass' }, { verdict: 'pass' }, { verdict: 'fail' }, { verdict: 'skip' }]);
  must('every check lands in exactly one bucket', t, { pass: 2, fail: 1, skipped: 1 });
  must('...and the three sum to the total', t.pass + t.fail + t.skipped, 4);
  must('an unknown verdict counts as skipped rather than vanishing',
    tally([{ verdict: 'mystery' }]), { pass: 0, fail: 0, skipped: 1 });
  must('no checks at all is three zeros, which is why the empty case must SKIP explicitly',
    tally([]), { pass: 0, fail: 0, skipped: 0 });

  /* the digest, end to end on a throwaway directory: the one impure thing worth
     asserting here, because the rename rule is easy to lose in a refactor. */
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-verify-self-test-'));
  try {
    const f = (name, body) => fs.writeFileSync(path.join(dir, name), body);
    f('SKILL.md', '# a\n');
    const base = hashSkillDir(dir);
    must('a digest is a sha256 hex string', /^[0-9a-f]{64}$/.test(base), true);
    f('SKILL.md', '# a\r\n');
    must('CRLF churn is not tampering', hashSkillDir(dir), base);
    fs.renameSync(path.join(dir, 'SKILL.md'), path.join(dir, 'RENAMED.md'));
    must('a RENAME changes the digest as surely as an edit', hashSkillDir(dir) !== base, true);
    must('a missing directory digests to null', hashSkillDir(path.join(dir, 'nope')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* rendering: the portable frontmatter, and nothing a single runtime reads */
  const SRC = '---\nname: a\ndescription: Does a.\n  Over two lines.\ncontext: fork\nagent: a\nargument-hint: <x>\n---\n# a\n\ncontext: stays in the body\n';
  must('render: only the portable keys survive, a continuation line with its key',
    renderSkillText(SRC), '---\nname: a\ndescription: Does a.\n  Over two lines.\n---\n# a\n\ncontext: stays in the body\n');
  must('render: rendering twice changes nothing', renderSkillText(renderSkillText(SRC)), renderSkillText(SRC));
  must('render: CRLF in, LF out', renderSkillText(SRC.replace(/\n/g, '\r\n')), renderSkillText(SRC));
  must('render: a file with no frontmatter is left alone', renderSkillText('# a\n\nbody\n'), '# a\n\nbody\n');
  must('render: an unclosed block is not a frontmatter', renderSkillText('---\nname: a\n# a\n'), '---\nname: a\n# a\n');
  const entry = renderedLockEntry('.live/a', '.shared/a', { 'SKILL.md': Buffer.from('# a\n') });
  must('a rendered entry names its source and its copy, and claims no review',
    [entry.sourceType, entry.renderedFrom, entry.skillDir, 'reviewedAt' in entry], ['rendered', '.live/a', '.shared/a', false]);
  must('...and its digest is the directory digest of the same bytes', entry.computedHash, hashFileMap({ 'SKILL.md': Buffer.from('# a\r\n') }));

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length
    ? 'FAIL — skill-verify self-test: ' + fails.length + ' of ' + n + ' assertion(s)'
    : 'PASS — skill-verify self-test (' + n + ' assertions: drift diff, tool scope, payload parsing, ' +
      'plugin verdicts, review dates, GATE arithmetic, directory digest, rendering)');
  process.exit(fails.length ? 1 : 0);
}

// ---------------------------------------------------------------- main

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const mode = {
    update: args.includes('--update'),
    hook: args.includes('--hook'),
    gate: args.includes('--gate'),
    json: args.includes('--json'),
    check: args.includes('--check'),
  };

  /* --update is a deliberate human act and may never be reached from a hook. An
     auto-updating lockfile is not a lockfile: it records whatever happened. */
  if (mode.update && (mode.hook || mode.gate)) {
    console.error('skill-verify: --update cannot be combined with --hook or --gate.');
    console.error('   fix: run --update by hand, after reading the diff. An auto-baselining lock is a rubber stamp.');
    process.exit(1);
  }

  if (mode.gate) return readStdin((raw) => runGate(raw));

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch (e) {
    /* In hook mode a session must start, so the exit is 0 either way — but ABSENT
       is not UNREADABLE here any more than it is for the plugin inputs. No lock
       file at all is a repo that predates the lock: nothing to enforce, nothing
       to claim. A lock that EXISTS and cannot be parsed is every pin switched
       off at once, and staying silent about it would make a single stray byte
       the cheapest way to disable the whole control. Say it in context. */
    if (mode.hook) {
      if (e.code === 'ENOENT') return;
      printSessionStart(decideSessionStart(null, { lock: 'unreadable', code: e.code || 'not valid JSON' }));
      return;
    }
    const msg = 'skill-verify: cannot read ' + LOCK_REL + ': ' + e.message;
    if (mode.json) {
      console.log(JSON.stringify({ ok: false, findings: [{ kind: 'lock', name: LOCK_REL, severity: 'error', message: msg }], gate: { pass: 0, fail: 1, skipped: 0 } }, null, 2));
      process.exit(1);
    }
    console.error(msg);
    console.error('   fix: write ' + LOCK_REL + ' at the repo root as {"version": 2, "skills": {}} and lock what you vendor.');
    if (mode.check) console.log('GATE ' + GATE_NAME + ' pass=0 fail=1 skipped=0');
    process.exit(1);
  }

  if (mode.update) {
    const { total, changed, stamped, missing, stamp } = rebaseline(lock);
    /* The two counts are printed separately on purpose. "digest(s) changed" is a
       fact about bytes; "review date(s) stamped" is an assertion about a person,
       and the operator is the only one who can say whether that assertion is
       true. Folding them into one number is how unread skills get dated. */
    console.log('skill-verify: re-baselined ' + total + ' skill(s); ' + changed + ' digest(s) changed' +
      (missing ? ', ' + missing + ' skipped (no directory)' : '') + '.');
    console.log('  ' + stamped + ' review date(s) stamped ' + stamp + ' — the rest keep the date they were really reviewed on.');
    const unlocked = findUnlockedSkills(lock, newReport());
    if (unlocked.total) {
      console.log('\n' + unlocked.total + ' skill(s) on disk are absent from the lock. --update does not adopt them:');
      console.log('adding an entry is the act of saying you read it. Run the eight-gate checklist');
      console.log('(docs/reference/skill-safety/), then paste an entry like this into `skills` and re-run --update:\n');
      console.log(adoptionStub('<skill-name>'));
    }
    console.log('\nOnly commit this if you have READ the diff you just blessed.');
    return;
  }

  const rep = verifyAll(lock);

  if (mode.json) {
    console.log(JSON.stringify({ ok: rep.ok, findings: rep.findings, checks: rep.checks, gate: rep.gate }, null, 2));
  } else if (mode.hook) {
    emitHook(rep);
    return; // ALWAYS exit 0: a session must start whatever this found
  } else {
    report(rep, lock, mode.check);
  }

  // The exit code agrees with `ok`, so a WARN alone never fails the run. A
  // verifier that goes red on something unverifiable by design is a verifier
  // people switch off, and switching it off costs the error cases too.
  process.exit(rep.ok ? 0 : 1);
}

module.exports = {
  hashSkillDir, fileDigests, diffFiles, tally, isPathTool, targetSkill,
  pluginFindings, nextReviewedAt, verifyAll, GATE_NAME, HASH_ALGO,
  decideSessionStart, gatherSessionStart,
  renderSkillText, renderSkillFiles, renderedLockEntry, hashFileMap, PORTABLE_KEYS,
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    // Never let a verifier failure take down a session.
    if (process.argv.includes('--hook')) process.exit(0);
    console.error('skill-verify: ' + (e && e.stack ? e.stack : e));
    process.exit(2);
  }
}
