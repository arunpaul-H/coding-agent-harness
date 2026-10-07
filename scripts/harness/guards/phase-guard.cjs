#!/usr/bin/env node
/**
 * Phase guard: a pre-tool handler, run by scripts/harness/hook.js for every shell call, every
 * write, and every call whose shape no dialect vouches for.
 *
 * TWO WAYS IN. hook.js parses the tool's own payload through a dialect module, gathers the
 * state with gather() and calls decide(event, state), which is pure: no stdin, no disk. Run
 * directly, this file reads the legacy wire format off stdin and prints it back (see gate()).
 * The rules below speak of `command`, `file_path` and `content` because those are the spellings
 * a payload carries; the decision reads the neutral event's command, path and content.
 *
 * Three things a phase close is allowed to do, and nobody else:
 *
 *   D1  MOVE A TRACK INTO THE ARCHIVE DIRECTORY. Archiving is a close, not a tidy-up:
 *       it must carry a receipt and regenerate the generated doc index.
 *       `close-phase.js <id> --archive` does both.
 *   D2  FLIP `status:` IN A TRACK DOC, or write a receipt field by hand.
 *       `status: complete` without a receipt is completion-by-assertion, which is the
 *       thing this whole mechanism exists to end. Only close-phase.js writes
 *       closed_phase / closed_at / gates_sha / block_sha / receipt.
 *   D3  WRITE A GATE FIGURE INTO A GOVERNED DOC. `gates.js --check` is the only way to
 *       read one, and the two files it writes and compares are the only places one
 *       lives: gates.json (the last run) and gates.baseline.json (the committed record).
 *       EXCEPT in FROZEN EVIDENCE, which the doc linter has always exempted and this
 *       guard once did not: a research or exploration doc is a dated measurement whose
 *       figures ARE the finding, and it may not be edited to keep them current. The
 *       predicate is IMPORTED from doc-frozen.cjs so the two mechanisms cannot answer
 *       the same question differently again. Two copies of that condition is what let
 *       the guard deny what the linter accepts, and the escape people then reached for
 *       was the tag below, which grants itself.
 *
 * D3 deliberately denies a figure EVEN WHEN gates.json currently carries it — the
 * message says which case it is. The linter refuses both, and a hook that waves through
 * what the lint then reds costs a whole cycle to learn nothing. The escape hatch is the
 * linter's own: `<!-- figure-ok: why -->`, WITH a reason, because a bare tag is a reflex
 * and a reason is a decision.
 *
 * EVERYTHING IS DECIDED AGAINST WHAT IS ON DISK, never against a pattern alone.
 * Rewriting a doc wholesale with its status unchanged is normal work and must not be
 * denied, while a `sed -i` from open to complete is the thing being caught. The prior
 * status is READ OFF DISK for exactly that reason, and that difference is the whole
 * design.
 *
 * And two more, which are NOT phase-close rules and do not pretend to be:
 *
 *   D4  A CALL NOTHING HERE CAN READ IS ASKED, NEVER ALLOWED IN SILENCE. It began as the rule
 *       for an MCP payload, which is the history below, and it now covers every OPAQUE call:
 *       one whose shape the wire format's dialect cannot vouch for, whatever tool sent it. Its
 *       reason therefore names no tool, no event and no protocol.
 *       There was a period when no matcher named an mcp__ tool, so a call that can read
 *       files, write files and execute code fired no hook at all. Widening the matcher
 *       is one line and is NOT the fix: D1 to D3 read `command`, `file_path` and
 *       `content`, and an MCP tool_input carries whatever its server defines instead, so
 *       a widened matcher alone would hand this guard a shape it silently allows — the
 *       same nothing, arrived at more expensively.
 *
 *       So an MCP payload is offered to BOTH native shapes first, because two of the
 *       three fields do turn up in real servers: a shell server spells `command`, a
 *       filesystem one spells `file_path` and `content`. A payload that spells them gets
 *       the REAL rule and its real message. Only a payload carrying none of them reaches
 *       D4, and D4 ASKS, because the alternative to asking is the silent allow.
 *
 *       The ask names the payload's KEYS and never its values: a server-defined field may
 *       hold a credential, and permissionDecisionReason is written into the transcript
 *       permanently, so a guard that quoted one would be the leak it exists to prevent.
 *
 *       Scope is EVERY mcp__ call, and deliberately not a verb list or a named set of
 *       servers: both are lists, and a list is silent about every server added after it
 *       was written.
 *
 *   D5  A MISSING SHARED PREDICATE IS ASKED, NEVER ASSUMED. D3's frozen-evidence
 *       exemption lives in doc-frozen.cjs. If that file cannot be loaded, this guard
 *       cannot tell a dated measurement from a figure smuggled into a plan — so it asks
 *       rather than guessing in either direction. Guessing "allow" reopens the hole;
 *       guessing "deny" denies frozen evidence a legal move, which is what sends people
 *       to the self-granting tag. --self-test FAILS outright when the file is absent,
 *       because a check that cannot run must not read green.
 *
 * A FILE, NEVER AN INLINE `node -e`: a one-liner handed to a shell gets word-split and
 * its arrows become redirects. The decision rides in the JSON, never in the exit code.
 *
 * Run:  node scripts/harness/guards/phase-guard.cjs --self-test
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { load, DEFAULTS, ROOT, resolve } = require('../config.js');

/* ── the project seam ───────────────────────────────────────────────────────── */

/**
 * Where the docs are, from the config. Soft-loaded with the documented defaults as the
 * fallback, for the reason every hook here soft-loads: a PreToolUse hook that throws
 * takes the session down with it. The fallback is a LOCATION, not a verdict — the worst
 * it can do is guard the conventional paths in a repo that renamed them, which is a
 * visible, arguable refusal rather than a silent green.
 */
function pathsOf(cfg) {
  const p = (cfg && cfg.project) || {};
  const slash = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
  const docsRoot = slash(p.docsRoot || DEFAULTS.project.docsRoot);
  const tracksDir = slash(p.tracksDir || DEFAULTS.project.tracksDir);
  return { docsRoot, tracksDir, archiveDir: docsRoot + '/archive' };
}
const softConfig = () => { try { return load({ soft: true }); } catch { return null; } };
const paths = () => pathsOf(softConfig());

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A path in a payload may be spelled with either separator, and PowerShell writes the
// other one, so every path built into a pattern accepts both.
const anySep = (s) => esc(s).replace(/\//g, '[\\\\/]');

/**
 * The receipt fields only close-phase.js may write. Listed as literals because a
 * pattern that nearly matched would read as "guarded" while allowing the real thing.
 */
const RECEIPT_FIELDS = ['closed_phase', 'closed_at', 'gates_sha', 'block_sha', 'receipt'];

/**
 * The same figure shape the doc linter bans, so the two mechanisms cannot disagree
 * about what a figure is. Two to four digits each side: `1/1` is a sentence, a date is
 * not a ratio, and a five-digit figure is not a gate total.
 */
const GATE_FIGURE = /\b\d{2,4}\s*\/\s*\d{2,4}\b/;

/**
 * The frozen-evidence predicate and its helpers, IMPORTED rather than copied. See D3.
 * Loaded softly so a repo mid-port does not take its sessions down; D5 is what the
 * absence then costs, and it costs it loudly rather than quietly.
 */
function loadFrozen() {
  try { return require('./doc-frozen.cjs'); } catch { return null; }
}
const FROZEN = loadFrozen();

/* ── pure decisions (every one is exercised by --self-test) ─────────────────── */

/** A payload path, reduced to a repo-relative POSIX path. */
function norm(p, root) {
  const r = String(root || ROOT).replace(/\\/g, '/');
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(new RegExp('^' + esc(r) + '/?', 'i'), '')
    .replace(/^\.\//, '');
}

/** The `status:` a DOC asserts: frontmatter only, on a line of its own. */
const statusOf = (text) => {
  const m = String(text).match(/^---\r?\n[\s\S]*?^status:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
};

/**
 * Every `status: <enum>` a piece of text asserts. A rewrite that keeps the value
 * asserts it too, which is why this returns a list and the caller compares.
 * A doc asserts one only on a line of its own; a SHELL COMMAND asserts one wherever it
 * appears, because `sed -i 's/status: open/status: complete/'` is a flip written
 * sideways and never sits on a line of its own.
 */
const statusesIn = (text, loose) => [...String(text).matchAll(
  loose ? /status:\s*(open|frozen|complete)\b/g : /^\s*status:\s*(open|frozen|complete)\s*$/gm,
)].map((m) => m[1]);

const receiptFieldsIn = (text) => RECEIPT_FIELDS.filter((k) => new RegExp('^\\s*' + k + ':\\s*\\S', 'm').test(String(text)));

/** Paths a shell command names that look like repo docs. */
const pathsIn = (cmd) => [...String(cmd).matchAll(/(?:^|[\s'"`(=])((?:[\w.-]+\/)+[\w.-]+\.md)/g)].map((m) => m[1]);

/**
 * A move into the archive directory.
 *
 * ⚠ The trailing separator used to be REQUIRED, so the documented form that relocates a
 * directory INTO another — destination named as the bare directory, nothing after it —
 * sailed straight through, while the same command naming its destination explicitly was
 * denied. The lookahead keeps a sibling like `<docs>/archives/` or `<docs>/archive-old/`
 * out, which are not the archive.
 */
const movesToArchive = (cmd, P) => new RegExp(
  '\\b(?:git\\s+mv|mv|Move-Item|move)\\b[\\s\\S]*?' + anySep(P.archiveDir) + '(?![\\w.-])', 'i',
).test(String(cmd));

/** A track doc: anything under a track folder. */
const isTrackDoc = (p, P) => new RegExp('^' + esc(P.tracksDir) + '/[^/]+/.+\\.md$').test(String(p));

/**
 * What the doc linter governs. The guard must never deny something the lint would
 * accept, so this list is the lint's, not a second opinion about it.
 */
const isGoverned = (p, P) => new RegExp('^' + esc(P.docsRoot) + '/.+\\.md$').test(String(p))
  || p === 'CLAUDE.md' || p === 'AGENTS.md' || /(^|\/)CLAUDE\.md$/.test(String(p))
  // A subtree's policy lives in its own AGENTS.md, and the doc linter grades that file. A
  // figure typed into one used to get past this rule and red the doc gate a cycle later.
  || /(^|\/)AGENTS\.md$/.test(String(p));

/** A command that WRITES rather than reads. The figure rule only applies to writes. */
const writesAFile = (cmd) => /(^|[^>])>>?\s*[\w./-]|\btee\b|\bsed\b[^|]*-i|\bSet-Content\b|\bOut-File\b|\bAdd-Content\b/.test(String(cmd));

/**
 * The path a command actually WRITES, as opposed to every path it happens to mention.
 *
 * ⚠ REGRESSION, met in anger: a heredoc body routinely names other docs and carries
 * frontmatter of its own, and attributing that to those docs denied a legitimate write —
 * a new research file whose body quoted a plan and carried `status: frozen` read as a
 * status flip on the plan. The redirect target is the write. Everything else in the
 * payload is content.
 */
function writeTargets(cmd) {
  const s = String(cmd);
  const out = [...s.matchAll(/(?:>>?|\btee\b|\bOut-File\b|\bSet-Content\b|\bAdd-Content\b)\s+(?:-\w+\s+)*['"]?((?:[\w.-]+\/)*[\w.-]+\.md)/g)].map((m) => m[1]);
  // `sed -i <script> <file>`: the file is the last path on the line, not the one in the script.
  if (/\bsed\b[^|]*\s-i/.test(s)) { const all = pathsIn(s); if (all.length) out.push(all[all.length - 1]); }
  return [...new Set(out)];
}

/**
 * A compound command, cut into the commands it chains. D2 and D3 pair "the file this writes"
 * with "the text it writes", and over a whole line that pairing is wrong: when one command puts
 * a figure into an ungoverned file and the next edits a governed doc, judging the line as one
 * command denied an edit that put no figure anywhere it is refused. So each chained command is
 * judged on its own.
 *
 * Cut only at `&&`, `||` and `;` OUTSIDE quotes. Never at a single `|`: a figure echoed into
 * `tee <doc>` sits on the other side of the pipe from its target. And never when the line
 * carries a heredoc: its body is unquoted text that may hold any of the three, and cutting there
 * would part a target from the body written into it. The uncut line is the strict reading, so
 * that is what an unsure case gets.
 */
function shellSegments(cmd) {
  const s = String(cmd);
  if (s.includes('<<')) return [s];
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && q !== "'" && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push(cur); cur = ''; i++; continue; }
    if (c === ';') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  // An unclosed quote means the cut points cannot be trusted: judge the line whole.
  return q ? [s] : out.filter((x) => x.trim());
}

/** Gate figures actually present in gates.json, as "pass/total" — used only to sharpen the message. */
function knownFigures(gatesJson) {
  const out = new Set();
  for (const row of Object.values((gatesJson && gatesJson.gates) || {})) {
    if (typeof row.pass === 'number' && typeof row.total === 'number') out.add(row.pass + '/' + row.total);
  }
  return out;
}

/**
 * D1 to D3 and D5, for ONE reading of a call. Pure: takes the neutral action, the neutral
 * event, a probe over the gathered disk state, the known figures, the resolved doc paths and
 * the frozen-evidence module, and returns a reason string or null. A reason beginning `D4`
 * or `D5` is an ASK; every other code is a DENY.
 *
 * `action` is 'shell' or 'write'. It is a parameter and not read off the event because an
 * opaque call is offered to BOTH readings (see decideMcp). No tool name reaches this function:
 * which of a tool's own tools is a shell and which a write is the dialect's to say.
 *
 * `read(p)` returns the on-disk text of a repo-relative path, or null.
 */
function rules(action, e, read, known, P, fz, root) {
  const cmd = e.command || '';
  const file = norm(e.path || '', root);
  const written = e.content != null ? String(e.content) : null;
  const shell = action === 'shell';
  const write = action === 'write';

  /* D1 — archiving is a close */
  if (shell && movesToArchive(cmd, P)) {
    return 'D1 ARCHIVING IS A CLOSE, NOT A MOVE.\n'
      + 'A track reaches ' + P.archiveDir + '/ through `node scripts/harness/close-phase.js <track-id> --archive`, '
      + 'which requires a green gates.json recorded at HEAD, a clean tree and a lint-clean handoff, writes the '
      + 'receipt, and regenerates the generated doc index.\n'
      + 'A bare mv leaves a track archived with no receipt and an index that still routes to it.';
  }

  /* D2 — a status flip or a hand-written receipt, in a track doc */
  const targets = [];
  if (write && isTrackDoc(file, P)) {
    targets.push({ file, text: written == null ? '' : written, old: e.old || null, loose: false });
  }
  const segments = shell ? shellSegments(cmd).filter(writesAFile) : [];
  for (const seg of segments) {
    for (const p of writeTargets(seg)) if (isTrackDoc(p, P)) targets.push({ file: p, text: seg, old: null, loose: true });
  }
  for (const t of targets) {
    const onDisk = read(t.file);
    // THE PRIOR STATUS COMES OFF DISK. That is what makes a wholesale rewrite with the
    // status unchanged legal and a one-word flip illegal.
    const current = t.old ? (statusOf(t.old) || statusesIn(t.old, true)[0] || null)
      : (onDisk == null ? null : statusOf(onDisk));
    // A NEW doc asserts its own status; only a CHANGE to an existing one is a flip.
    if (onDisk != null || t.old) {
      const flip = statusesIn(t.text, t.loose).find((s) => current && s !== current);
      if (flip) {
        return 'D2 A `status:` FLIP IS NOT AN EDIT.\n' + t.file + ': ' + current + ' -> ' + flip + '.\n'
          + 'A phase closes when the mechanisms say so: `node scripts/harness/close-phase.js <track-id>` requires a '
          + 'green gates.json recorded at HEAD, a clean tree, and a handoff that lints and has actually been '
          + 'replaced — then it writes the receipt.\n'
          + 'The doc linter refuses `status: complete` without one, so a hand-flipped status reds the doc gate anyway.';
      }
    }
    const hand = receiptFieldsIn(t.text).filter((k) => {
      const line = new RegExp('^\\s*' + k + ':\\s*(.*)$', 'm');
      const now = (t.text.match(line) || [])[1];
      const was = onDisk == null ? null : (onDisk.match(line) || [])[1];
      return String(now).trim() !== String(was).trim();
    });
    if (hand.length) {
      return 'D2 THE RECEIPT IS WRITTEN BY close-phase.js, NEVER BY HAND.\n' + t.file + ': ' + hand.join(', ') + '.\n'
        + 'The doc linter recomputes receipt = sha256(id|phase|gates_sha|block_sha) with close-phase.js\'s own '
        + 'function, so a typed one fails the doc gate.';
    }
  }

  /* D3 — a gate figure into a governed doc */
  const figureTargets = [];
  if (write && isGoverned(file, P) && written != null) figureTargets.push({ file, text: written });
  for (const seg of segments) {
    for (const p of writeTargets(seg)) if (isGoverned(p, P)) figureTargets.push({ file: p, text: seg });
  }
  for (const t of figureTargets) {
    const onDisk = read(t.file) || '';

    // D5 — the shared predicate is missing, so the exemption cannot be evaluated.
    if (!fz) {
      if (!GATE_FIGURE.test(t.text)) continue;
      return 'D5 THE FROZEN-EVIDENCE PREDICATE IS MISSING, SO YOU DECIDE.\n'
        + t.file + ' would gain a gate figure, and scripts/harness/guards/doc-frozen.cjs could not be loaded — '
        + 'so nothing here can tell a dated measurement (which the doc linter exempts, and must) from a '
        + 'figure smuggled into a plan (which it reds).\n'
        + 'Approve it only if this file is frozen evidence. Then fix the cause: the linter and this guard '
        + 'share ONE predicate on purpose, and a second copy of it is how they came to disagree.';
    }

    // The frozen-evidence exemption, from the shared predicate rather than a second copy
    // of the condition. The PAYLOAD is asked first: a new research file declares its own
    // kind in its frontmatter and has nothing on disk to declare it from.
    if (fz.frozenEvidence(t.file, fz.declaredFrontmatter(t.text) || fz.parseFrontmatter(onDisk))) continue;
    if (fz.hasFigureOk(onDisk) || fz.hasFigureOk(t.text)) continue;
    const hit = (fz.stripCode(t.text).match(GATE_FIGURE) || [])[0];
    if (!hit) continue;
    const sourced = known.has(hit.replace(/\s+/g, ''));
    return 'D3 NO GATE FIGURE IN PROSE.\n' + t.file + ' would gain `' + hit + '`, which is '
      + (sourced ? 'a real figure from the current gates.json — and it will be wrong the next time a gate moves.'
        : 'in no gates.json row at all, so nothing can check it.') + '\n'
      + 'Read it with `node scripts/harness/gates.js --check`. A figure lives in the two files that command '
      + 'writes and compares, scripts/harness/gates.json and gates.baseline.json, and nowhere else.\n'
      + 'If it is genuinely historical or genuinely not a gate figure, tag the file '
      + '`<!-- figure-ok: <why> -->` — the reason is required.';
  }

  return null;
}

/* ── D4: the MCP half ──────────────────────────────────────────────────────── */

/**
 * An opaque payload, offered to both readings. Neither branch can fire on a field that
 * is absent — movesToArchive('') and writesAFile('') are both false, and norm('')
 * matches neither a track doc nor a governed one — so running both is EXACT rather than
 * a widening.
 */
const decideMcp = (e, read, known, P, fz, root) =>
  rules('shell', e, read, known, P, fz, root) || rules('write', e, read, known, P, fz, root);

/**
 * Did decide() have enough to DECIDE, or merely enough to shrug?
 *
 * A command is readable on its own; a write needs BOTH a target and the content going
 * into it, because a payload spelling `path` and `contents` gives this guard a file name
 * and then hides the bytes — which would read as "the rules did not apply" when the truth
 * is "nothing looked at the part that matters". That distinction is the whole of D4: a
 * silent allow because a rule did not apply is fine, and a silent allow because nothing
 * could look is the finding.
 */
const readableToGuards = (e) => !!e && (e.command != null || (e.path != null && e.content != null));

/** Keys only, never values. See D4 in the header: the reason outlives the call. */
function unreadable(tool, input) {
  const keys = Object.keys(input || {});
  return 'D4 NOTHING HERE CAN READ THIS CALL, SO IT IS NOT WAVED THROUGH.\n'
    + (tool || 'This call') + ' carries ' + (keys.length ? 'field(s): ' + keys.join(', ') : 'no fields at all')
    + ' — none of `command`, `file_path` + `content`, which are the only shapes the guards decide '
    + 'from. So nothing can tell a read-only query here from a file write, a code execution or an '
    + 'outbound send.\n'
    + 'It is a call whose shape nothing here can vouch for: a server-defined tool, a tool the wire '
    + 'format has no row for, or a call missing the field its kind is decided from.\n'
    + 'Where the tool can put a question to a person, this is one: approve it if you know what the '
    + 'call does with these fields. Where it cannot, the call is refused. The alternative to both '
    + 'is a silent allow.\n'
    + 'Values are deliberately not quoted: a field nothing here knows may hold a credential, and '
    + 'this reason is written into the transcript permanently.';
}

/** A reason string's decision. D4 and D5 are asks; everything else is a refusal. */
const ASK_CODES = new Set(['D4', 'D5']);
const decisionFor = (reason) => (ASK_CODES.has(String(reason).slice(0, 2)) ? 'ask' : 'deny');

/* ── the handler: decide(event, state), and the state it needs ─────────────── */

/** The neutral verdict. See scripts/harness/dialects/_wire.js for the contract. */
const ALLOW = Object.freeze({ deny: false, reason: '' });
/** The actions this guard looks at. A read or a search writes nothing, so it is never asked
 *  about; an OPAQUE call is always looked at, whatever action the dialect gave it. */
const SEEN = ['shell', 'write'];
const looksAt = (e) => !!e && (e.opaque === true || SEEN.includes(e.action));

function verdictFor(reason) {
  const message = 'Phase guard: ' + String(reason).split('\n')[0];
  return decisionFor(reason) === 'ask' ? { deny: false, ask: true, reason, message } : { deny: true, reason, message };
}

/**
 * Every repo-relative path decide() may ask the disk about for this event: the file a write
 * targets, and the redirect targets of each command a shell line chains. Pure, and a
 * superset on purpose, so the caller can read them all up front and decide() needs no disk.
 */
function wants(event, root) {
  const e = event || {};
  const out = new Set();
  const file = norm(e.path || '', root);
  if (file) out.add(file);
  for (const seg of shellSegments(e.command || '').filter(writesAFile)) for (const p of writeTargets(seg)) out.add(p);
  return [...out];
}

/**
 * THE DISK HALF, and the only one. scripts/harness/hook.js calls this and hands the result to
 * decide(); so does this file's own CLI. It reads the prior text of every path wants() names
 * (the prior STATUS is what makes a rewrite legal and a flip not), the figures the last gate
 * run recorded, and the frozen-evidence predicate with its directory list pinned from the
 * config, so that decide() never loads a config behind the caller's back.
 */
function gather(event, cfg) {
  if (!looksAt(event)) return {};
  const disk = {};
  for (const p of wants(event, ROOT)) {
    try { disk[p] = fs.readFileSync(resolve(p), 'utf8'); } catch { disk[p] = null; }
  }
  let known = new Set();
  try { known = knownFigures(JSON.parse(fs.readFileSync(resolve('scripts', 'harness', 'gates.json'), 'utf8'))); }
  catch { /* no verdict yet is not a reason to allow */ }
  const dirs = {
    dirs: (cfg && cfg.docs && Array.isArray(cfg.docs.exemptDirs)) ? cfg.docs.exemptDirs : [],
    tracksDir: (cfg && cfg.project && cfg.project.tracksDir) || '',
  };
  const frozen = FROZEN && Object.assign({}, FROZEN, { frozenEvidence: (p, fm) => FROZEN.frozenEvidence(p, fm, dirs) });
  return { root: ROOT, paths: pathsOf(cfg), disk, known, frozen };
}

/**
 * The whole decision: decide(event, state), pure. No stdin, no disk.
 *
 *   event   the neutral event: action, command, path, content, old, and for an opaque call
 *           its tool label and input, which D4 names the KEYS of and never the values.
 *   state   what gather() returns: { root, paths, disk, known, frozen }. `disk` maps a
 *           repo-relative path to its text, or to null where there is no such file.
 *
 * A state nobody gathered THROWS for an event this guard looks at. With an empty disk every
 * doc reads as new, and a new doc may declare any status: the flip rule would go quiet and
 * say nothing about it. The one entry turns a throw into a deny.
 */
function decide(event, state) {
  const e = event || {};
  if (!looksAt(e)) return ALLOW;
  const s = state || {};
  if (!s.disk || typeof s.disk !== 'object') throw new Error('phase-guard: no state was gathered for this event');
  const read = (p) => (Object.prototype.hasOwnProperty.call(s.disk, p) && s.disk[p] != null ? String(s.disk[p]) : null);
  const known = s.known instanceof Set ? s.known : new Set(s.known || []);
  const P = s.paths || pathsOf(null);
  const fz = Object.prototype.hasOwnProperty.call(s, 'frozen') ? s.frozen : FROZEN;

  const reason = e.opaque
    ? decideMcp(e, read, known, P, fz, s.root)
    : rules(e.action, e, read, known, P, fz, s.root);
  if (reason) return verdictFor(reason);
  // D4 — the rules did not apply, but for an opaque payload that is only news if something read it.
  if (e.opaque && !readableToGuards(e)) return verdictFor(unreadable(e.tool, e.input));
  return ALLOW;
}

/* ── self-test ─────────────────────────────────────────────────────────────── */

function selfTest() {
  let CHECKS = 0;
  const f = [];
  const P = { docsRoot: 'docs', tracksDir: 'docs/tracks', archiveDir: 'docs/archive' };
  const disk = {
    'docs/tracks/t/README.md': '---\nid: t\nkind: track\nstatus: open\n---\n# t\n',
    'docs/tracks/t/plan.md': '---\nid: p\nkind: plan\nstatus: open\n---\n# p\n',
    'docs/reference/x.md': '---\nid: x\n---\n# x\n',
    'docs/tracks/t/tagged.md': '---\nid: tg\nstatus: open\n---\n<!-- figure-ok: inherited board, dated and not current -->\n',
    'docs/tracks/t/quoted.md': '---\nid: q\nstatus: open\n---\ntag it `<!-- figure-ok: dated phase record -->` like so\n',
    'docs/tracks/t/research/r.md': '---\nid: r\nkind: research\nstatus: frozen\n---\n# r\n',
    'docs/explorations/e.md': '---\nid: e\nkind: exploration\nstatus: frozen\n---\n# e\n',
  };
  const read = (p) => (Object.prototype.hasOwnProperty.call(disk, p) ? disk[p] : null);
  // Synthetic figures. Nothing here is a measurement of any repo: `42/42` stands in for
  // "a figure gates.json currently carries" and `999/999` for one it never did.
  const known = new Set(['42/42']);
  /**
   * The shared predicate, with its DIRECTORY LIST PINNED to fixture values.
   *
   * doc-frozen.cjs takes those directories from `docs.exemptDirs`, and it accepts an
   * `opts` override for exactly this: a repo that exempts its tracks directory from the
   * line caps also exempts it from the figure rule, so an assertion written against the
   * live config would assert whatever today's config happens to say. This is the SAME
   * predicate, not a second copy of it — a second copy is the defect the file exists to
   * close — with its one project-specific input supplied by the test.
   */
  const FIXTURE_DIRS = { dirs: ['docs/archive', 'docs/explorations'], tracksDir: 'docs/tracks' };
  const pin = (dirs) => (FROZEN && Object.assign({}, FROZEN, {
    frozenEvidence: (p, fm) => FROZEN.frozenEvidence(p, fm, dirs),
  }));
  const FZ = pin(FIXTURE_DIRS);
  const d = (action, e, fz) => rules(action, e, read, known, P, fz === undefined ? FZ : fz);
  const eq = (l, got, want) => { CHECKS++; if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); };
  const denied = (l, tool, input, code) => eq(l, String(d(tool, input) || '').slice(0, 2), code);
  const allowed = (l, tool, input) => { CHECKS++; const r = d(tool, input); if (r) f.push(l + ': DECIDED with ' + JSON.stringify(String(r).slice(0, 60))); };

  /* D1 */
  denied('a bare git mv into the archive', 'shell', { command: 'git mv docs/tracks/t docs/archive/t' }, 'D1');
  denied('Move-Item into the archive', 'shell', { command: 'Move-Item docs/tracks/t docs/archive/t' }, 'D1');
  // ⚠ The form git itself documents for relocating a directory INTO another. It names the
  // destination directory with nothing after it, and it was the one form that got past.
  denied('a git mv INTO the archive directory', 'shell', { command: 'git mv docs/tracks/t docs/archive' }, 'D1');
  denied('...with a trailing separator and nothing after it', 'shell', { command: 'git mv docs/tracks/t docs/archive/' }, 'D1');
  denied('...spelled with a backslash, as PowerShell would', 'shell', { command: 'Move-Item docs/tracks/t docs\\archive' }, 'D1');
  allowed('close-phase --archive is the sanctioned path', 'shell', { command: 'node scripts/harness/close-phase.js t --archive' });
  allowed('reading the archive is not moving into it', 'shell', { command: 'cat docs/archive/traps.md' });
  // The lookahead earns its keep here: neither of these is the archive.
  allowed('a move into a similarly named directory is not archiving', 'shell', { command: 'mv docs/tracks/t docs/archives/t' });
  allowed('nor is one into an archive-old sibling', 'shell', { command: 'mv docs/tracks/t docs/archive-old/t' });

  /* D2 */
  denied('an Edit that flips status', 'write', { path: 'docs/tracks/t/README.md', old: 'status: open', content: 'status: complete' }, 'D2');
  denied('a Write that flips status', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: complete\n---\n# p\n' }, 'D2');
  denied('a sed -i flip', 'shell', { command: "sed -i 's/status: open/status: complete/' docs/tracks/t/plan.md" }, 'D2');
  // ⚠ The prior status is read off DISK, which is the only reason these three are legal.
  allowed('a wholesale rewrite that KEEPS the status', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\n# p\nnew body\n' });
  allowed('a heredoc rewrite that keeps the status', 'shell', { command: "cat > docs/tracks/t/plan.md <<'EOF'\n---\nid: p\nstatus: open\n---\nbody\nEOF" });
  allowed('a NEW track doc declares its own status', 'write', { path: 'docs/tracks/t/traps.md', content: '---\nid: tr\nstatus: open\n---\n' });
  allowed('a reference doc is not a track doc', 'write', { path: 'docs/reference/x.md', content: '---\nid: x\nstatus: complete\n---\n' });
  denied('a hand-typed receipt', 'write', { path: 'docs/tracks/t/README.md', old: 'status: open', content: 'status: open\nreceipt: deadbeef' }, 'D2');
  // A chain is judged command by command: what one command writes is not charged to its neighbour's file.
  allowed('a figure bound for an ungoverned file, chained before an edit to a governed one', 'shell',
    { command: "sed -i 's|a|smoke 42/42|' notes.txt && sed -i 's/Five/Six/' docs/tracks/t/plan.md" });
  allowed('a status word in one command, a track doc in the next', 'shell',
    { command: "echo 'status: complete' > out.txt; sed -i 's/a/b/' docs/tracks/t/plan.md" });
  denied('the same chain with the flip aimed at the track doc', 'shell',
    { command: "echo hi > out.txt && sed -i 's/status: open/status: complete/' docs/tracks/t/plan.md" }, 'D2');
  denied('a figure piped into a governed doc is one command, not two', 'shell',
    { command: 'echo "smoke 42/42" | tee docs/tracks/t/plan.md' }, 'D3');
  denied('a separator inside quotes does not cut the command', 'shell',
    { command: "sed -i 's|a|x; smoke 42/42 && y|' docs/tracks/t/plan.md" }, 'D3');
  denied('a heredoc line is never cut', 'shell',
    { command: "cat > docs/tracks/t/plan.md <<'EOF'\n---\nid: p\nstatus: open\n---\nok; smoke 42/42\nEOF" }, 'D3');
  eq('shellSegments cuts at && || ; outside quotes only', shellSegments("a 'x && y' && b || c; d"), ["a 'x && y' ", ' b ', ' c', ' d']);
  eq('shellSegments keeps an unclosed quote whole', shellSegments("a 'x && b"), ["a 'x && b"]);
  allowed('grepping for a status is not writing one', 'shell', { command: 'grep -n "status: open" docs/tracks/t/plan.md' });
  // ⚠ REGRESSION, met in anger: a research fork's heredoc named a plan in its BODY and
  // carried its own `status: frozen`, and the guard read that as a flip on the plan.
  allowed('a heredoc that MENTIONS another track doc is not a write to it', 'shell', {
    command: "cat > docs/tracks/t/research/a.md <<'EOF'\n---\nstatus: frozen\n---\nsee docs/tracks/t/plan.md and docs/tracks/t/README.md\nEOF",
  });
  eq('writeTargets: only the redirect target', writeTargets("cat > docs/tracks/t/a.md <<'EOF'\nsee docs/tracks/t/plan.md\nEOF"), ['docs/tracks/t/a.md']);
  eq('writeTargets: sed -i takes the trailing file, not the script', writeTargets("sed -i 's/status: open/x/' docs/tracks/t/plan.md"), ['docs/tracks/t/plan.md']);
  eq('writeTargets: a plain read has none', writeTargets('cat docs/tracks/t/plan.md'), []);

  /* D4 — the MCP half. Pure decisions, asserted here because the readable/unreadable
     split is the one place where getting it wrong turns a deny into a shrug with no
     assertion going red. */
  const mcpD = (input) => String(decideMcp(input, read, known, P, FZ) || '').slice(0, 2);
  eq('an MCP shell server spelling command gets D1, not a generic ask', mcpD({ command: 'git mv docs/tracks/t docs/archive/t' }), 'D1');
  eq('an MCP write that flips a status gets D2', mcpD({ path: 'docs/tracks/t/plan.md', content: '---\nstatus: complete\n---\n' }), 'D2');
  eq('an ordinary MCP write is still allowed', mcpD({ path: 'src/app.js', content: 'x' }), '');
  eq('a command is readable', readableToGuards({ command: 'ls' }), true);
  eq('a target plus its content is readable', readableToGuards({ path: 'a.md', content: 'b' }), true);
  eq('a server-defined shape is not', readableToGuards({ query: 'select 1' }), false);
  // ⚠ The case that LOOKS readable and is not: the guard is handed a file name and the
  // bytes are hidden behind a field name it does not know. Treating that as read is how
  // D4 would go blind.
  eq('a target whose CONTENT field is server-defined is not readable', readableToGuards({ path: 'docs/x.md', contents: 'smoke 999/999' }), false);
  eq('an empty payload is not readable', readableToGuards({}), false);
  eq('the ask names the keys', unreadable('mcp__s__f', { token: 'x', scope: 'all' }).includes('token, scope'), true);
  eq('the ask never quotes a value', unreadable('mcp__s__f', { token: 'NOTAREALCREDENTIAL' }).includes('NOTAREALCREDENTIAL'), false);
  // The direct CLI: no stdin is no call, junk is an ask, and with no dialect module beside it
  // (a guard copied alone) every call is offered to both readings, never guessed at by name.
  eq('the direct CLI says nothing about an empty payload', [gate(''), gate('  \n')], [null, null]);
  eq('the direct CLI asks about a payload that is not JSON', gate('}{').hookSpecificOutput.permissionDecision, 'ask');
  const alone = legacyEvent('', { tool_name: 'any-name', tool_input: { file_path: 'a.md', new_string: 'b' } }, null);
  eq('with no dialect the direct CLI reads the fields and vouches for no shape',
    [alone.opaque, alone.action, alone.path, alone.content], [true, 'other', 'a.md', 'b']);
  eq('D4 and D5 are asks, every other code is a refusal',
    ['D1', 'D2', 'D3', 'D4', 'D5'].map(decisionFor), ['deny', 'deny', 'deny', 'ask', 'ask']);

  /* D5 — the degradation, driven with fz = null. Runs whether or not doc-frozen.cjs is
     on disk, because this is the branch that fires when it is not. */
  eq('with no shared predicate, a figure into a governed doc is an ASK',
    String(d('write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\nsmoke 999/999\n' }, null) || '').slice(0, 2), 'D5');
  eq('...and a write with no figure in it is still allowed',
    d('write', { path: 'docs/reference/x.md', content: '---\nid: x\n---\nprose only\n' }, null), null);
  eq('...and D1 does not need the predicate at all',
    String(d('shell', { command: 'git mv docs/tracks/t docs/archive/t' }, null) || '').slice(0, 2), 'D1');

  /* D3 — needs the shared predicate. A check that cannot run must not read green, so an
     absent doc-frozen.cjs FAILS this self-test rather than skipping these quietly. */
  if (!FROZEN) {
    f.push('doc-frozen.cjs could not be loaded, so D3 cannot be exercised at all — '
      + '15 assertions not run. fix: scripts/harness/guards/doc-frozen.cjs must export '
      + 'frozenEvidence, parseFrontmatter, declaredFrontmatter, hasFigureOk and stripCode. '
      + 'D3 degrades to the D5 ask until it does.');
  } else {
    denied('an invented figure', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\nsmoke 999/999 green\n' }, 'D3');
    denied('a REAL figure is denied too', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\nsmoke 42/42 green\n' }, 'D3');
    denied('a figure into AGENTS.md', 'write', { path: 'AGENTS.md', old: 'a', content: 'suite 42/42' }, 'D3');
    // A subtree's policy file is governed wherever it sits, under either name (trap MT-12).
    denied('a figure into a NESTED AGENTS.md', 'write', { path: 'packages/api/AGENTS.md', content: 'suite 42/42' }, 'D3');
    denied('...and into a nested CLAUDE.md, as before', 'write', { path: 'packages/api/CLAUDE.md', content: 'suite 42/42' }, 'D3');
    allowed('a file whose name merely ENDS in that one is not an instruction file', 'write', { path: 'packages/api/NOT-AGENTS.md', content: 'suite 42/42' });
    allowed('nor is a directory of that name', 'write', { path: 'packages/AGENTS.md/notes.txt', content: 'suite 42/42' });
    allowed('a figure inside a code span is quoting', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\nrun it: `smoke 42/42`\n' });
    allowed('a reasoned figure-ok tag on disk', 'write', { path: 'docs/tracks/t/tagged.md', old: 'a', content: 'inherited 48/48' });
    // The tag is the shared predicate's, and it strips code first. A tag SHOWN in a code
    // span is a doc explaining the hatch, not a doc claiming it — and the linter reads it
    // the same way, which is the point of there being one predicate rather than two.
    denied('a figure-ok tag quoted in a code span does not exempt', 'write', { path: 'docs/tracks/t/quoted.md', old: 'a', content: 'inherited 48/48' }, 'D3');
    allowed('a date is not a figure', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\nmeasured 2026-01-14\n' });
    allowed('single digits are not a figure', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\n1/1 done\n' });
    allowed('a figure in a file nothing governs', 'write', { path: 'scripts/harness/notes.txt', content: 'smoke 42/42' });
    // The exemption the linter has always had, and the refusals that are its whole point.
    // These must be ALLOWED with no tag at all: needing one was the finding.
    allowed('a figure in a research doc, by kind on disk', 'write', { path: 'docs/tracks/t/research/r.md', old: 'a', content: 'smoke 42/42' });
    allowed('a figure in an exploration, frozen by path', 'write', { path: 'docs/explorations/e.md', content: '---\nid: e\nkind: exploration\n---\nsmoke 42/42\n' });
    allowed('a figure into a NEW research doc, declared by the payload', 'write', { path: 'docs/tracks/t/research/new.md', content: '---\nid: n\nkind: research\nstatus: frozen\n---\nsmoke 42/42\n' });
    // ⚠ The heredoc form: the payload is a COMMAND, so the frontmatter is not at the front
    // of it. Reading only a leading block would deny this and leave the two mechanisms
    // disagreeing exactly where they were.
    allowed('...and the same file written by a heredoc', 'shell', {
      command: "cat > docs/tracks/t/research/new.md <<'EOF'\n---\nid: n\nkind: research\nstatus: frozen\n---\nsmoke 42/42\nEOF",
    });
    denied('a figure in a PLAN is still denied, tag or no tag', 'write', { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nkind: plan\nstatus: open\n---\nsmoke 42/42\n' }, 'D3');
    // A doc cannot buy the exemption by CLAIMING a kind it does not have: the linter reds
    // it for the same figure one step later.
    denied('a track README claiming to be research is still a track README on disk', 'write', { path: 'docs/tracks/t/README.md', old: 'a', content: 'smoke 42/42' }, 'D3');
    eq('an MCP write spelling file_path and content gets D3', mcpD({ path: 'docs/tracks/t/plan.md', content: 'smoke 999/999' }), 'D3');
  }

  allowed('reading a doc that CONTAINS a figure', 'shell', { command: 'cat docs/tracks/t/plan.md' });
  allowed('an unrelated shell call', 'shell', { command: 'npm run build' });
  allowed('an unrelated edit', 'write', { path: 'src/app.js', old: 'a', content: 'b' });

  /* The project seam: a repo that renamed its docs tree is guarded in the new place and
     not in the old one. This is what "generalised" has to mean to be worth anything. */
  const Q = { docsRoot: 'documentation', tracksDir: 'documentation/work', archiveDir: 'documentation/archive' };
  const dq = (tool, input) => String(rules(tool, input, () => null, known, Q, FZ) || '').slice(0, 2);
  eq('a renamed archive is guarded', dq('shell', { command: 'mv documentation/work/t documentation/archive/t' }), 'D1');
  eq('...and the conventional one is not, in that repo', dq('shell', { command: 'mv docs/tracks/t docs/archive/t' }), '');
  // A flip needs a PRIOR status, and that comes off disk: with a reader that finds nothing
  // this case decides nothing whether or not the renamed directory is honoured.
  const openOnDisk = () => '---\nid: p\nstatus: open\n---\n';
  const flipQ = (file) => String(rules('write', { path: file, content: '---\nid: p\nstatus: complete\n---\n' }, openOnDisk, known, Q, FZ) || '').slice(0, 2);
  eq('a renamed track dir still catches a flip', flipQ('documentation/work/t/plan.md'), 'D2');
  eq('...and the conventional track dir is not a track dir, in that repo', flipQ('docs/tracks/t/plan.md'), '');
  eq('a NEW doc in the renamed track dir asserts its own status', dq('write', { path: 'documentation/work/t/plan.md', content: '---\nstatus: complete\n---\n' }), '');

  // ⚠ THE GUARD MUST NEVER DENY WHAT THE LINT ACCEPTS, and the exempt-directory list is a
  // CONFIG value. So the same figure into the same plan is denied in a repo that does not
  // exempt its tracks directory, and allowed in one that does — because the linter exempts
  // it there too. One predicate, two configs, no disagreement. This pair is what makes the
  // generalisation safe: the rule moved with the config rather than being pinned to the
  // directory names one repo happened to use.
  if (FROZEN) {
    const intoPlan = { path: 'docs/tracks/t/plan.md', content: '---\nid: p\nkind: plan\nstatus: open\n---\nsmoke 999/999\n' };
    eq('a figure into a plan is denied where tracks are NOT exempt',
      String(rules('write', intoPlan, read, known, P, pin({ dirs: ['docs/archive'], tracksDir: 'docs/tracks' })) || '').slice(0, 2), 'D3');
    eq('...and allowed where the config exempts the tracks directory, as the linter does',
      rules('write', intoPlan, read, known, P, pin({ dirs: ['docs/tracks'], tracksDir: 'docs/tracks' })), null);
  }

  /* THE NEUTRAL DECISION, which is what scripts/harness/hook.js calls: an event and a gathered
     state in, a verdict out. Everything above drove one reading of the rules; this drives the
     handler around them, where the action is the dialect's and the disk is the caller's. */
  const state = (extra) => Object.assign({ root: '/repo', paths: P, disk, known, frozen: FZ }, extra || {});
  const code = (v) => [v.deny === true, v.ask === true, String(v.reason).slice(0, 2)];
  const flipped = '---\nid: p\nstatus: complete\n---\n# p\n';
  eq('a neutral shell event that archives is a DENY verdict', code(decide({ action: 'shell', command: 'git mv docs/tracks/t docs/archive/t' }, state())), [true, false, 'D1']);
  eq('a neutral write that flips a status is a DENY verdict', code(decide({ action: 'write', path: 'docs/tracks/t/plan.md', content: flipped }, state())), [true, false, 'D2']);
  eq('...and the prior status came from the state, not the disk', decide({ action: 'write', path: 'docs/tracks/t/plan.md', content: flipped }, state({ disk: {} })), { deny: false, reason: '' });
  eq('an absolute path is reduced against the state root', code(decide({ action: 'write', path: '/repo/docs/tracks/t/plan.md', content: flipped }, state())), [true, false, 'D2']);
  eq('a verdict carries one line for the person at the keyboard',
    decide({ action: 'shell', command: 'git mv docs/tracks/t docs/archive/t' }, state()).message, 'Phase guard: D1 ARCHIVING IS A CLOSE, NOT A MOVE.');
  // The actions this guard does not look at are allowed WITHOUT a state: nothing was read.
  eq('a read is not looked at', decide({ action: 'read', path: 'docs/tracks/t/plan.md' }, {}), { deny: false, reason: '' });
  eq('a search is not looked at', decide({ action: 'search', path: 'docs' }, {}), { deny: false, reason: '' });
  eq('a call that is neither, and not opaque, is not looked at', decide({ action: 'other', opaque: false }, {}), { deny: false, reason: '' });
  // OPAQUE is the dialect saying it cannot vouch for the shape. Both readings, then D4.
  eq('an opaque call spelling a command gets the real rule', code(decide({ action: 'other', opaque: true, command: 'git mv docs/tracks/t docs/archive/t' }, state())), [true, false, 'D1']);
  eq('an opaque call spelling a path and content gets the real rule', code(decide({ action: 'other', opaque: true, path: 'docs/tracks/t/plan.md', content: flipped }, state())), [true, false, 'D2']);
  eq('an opaque call nothing can read is an ASK verdict, never an allow',
    code(decide({ action: 'other', opaque: true, tool: 'srv.query', input: { query: 'select 1' } }, state())), [false, true, 'D4']);
  eq('...and it is opaque whatever action it was given', code(decide({ action: 'shell', opaque: true, tool: 'x', input: {} }, state())), [false, true, 'D4']);
  const asked = decide({ action: 'other', opaque: true, tool: 'srv.fetch', input: { token: 'NOTAREALCREDENTIAL', scope: 'all' } }, state());
  eq('the ask names the tool label and the keys, never a value',
    [asked.reason.includes('srv.fetch'), asked.reason.includes('token, scope'), asked.reason.includes('NOTAREALCREDENTIAL')], [true, true, false]);
  eq('a readable opaque call that breaks no rule is allowed', decide({ action: 'other', opaque: true, command: 'npm test' }, state()), { deny: false, reason: '' });
  eq('D5 through the handler is an ASK verdict',
    code(decide({ action: 'write', path: 'docs/tracks/t/plan.md', content: '---\nid: p\nstatus: open\n---\nsmoke 999/999\n' }, state({ frozen: null }))), [false, true, 'D5']);
  // ⚠ A state nobody gathered must not read as "every doc is new, so nothing is a flip".
  let threw = false;
  try { decide({ action: 'write', path: 'docs/tracks/t/plan.md', content: flipped }, {}); } catch { threw = true; }
  eq('a looked-at event with no gathered state throws, so the one entry denies', threw, true);
  eq('wants: the file a write targets, reduced to the repo', wants({ action: 'write', path: '/repo/docs/tracks/t/plan.md' }, '/repo'), ['docs/tracks/t/plan.md']);
  eq('wants: a redirect target, and not a path the body merely mentions',
    wants({ action: 'shell', command: "cat > docs/tracks/t/a.md <<'EOF'\nsee docs/tracks/t/plan.md\nEOF" }, '/repo'), ['docs/tracks/t/a.md']);
  eq('wants: every chained command that writes', wants({ command: "echo a > docs/x.md && sed -i 's/a/b/' docs/tracks/t/plan.md" }, '/repo'), ['docs/x.md', 'docs/tracks/t/plan.md']);
  eq('wants: a command that only reads wants nothing', wants({ action: 'shell', command: 'cat docs/tracks/t/plan.md' }, '/repo'), []);
  eq('pathsOf: the doc tree comes from the config it is handed',
    pathsOf({ project: { docsRoot: 'documentation\\', tracksDir: 'documentation/work/' } }), Q);
  eq('gather reads nothing for an event this guard does not look at', gather({ action: 'read', path: 'README.md' }, null), {});

  for (const x of f) console.log('  x ' + x);
  console.log(f.length ? 'FAIL - phase-guard self-test: ' + f.length + ' assertion(s)'
    : 'PASS - phase-guard.cjs self-test (' + CHECKS + ' checks)');
  process.exit(f.length ? 1 : 0);
}

/* ── entry ─────────────────────────────────────────────────────────────────── */

const UNPARSEABLE = 'D4 THE TOOL PAYLOAD DID NOT PARSE, SO YOU DECIDE.\n'
  + 'This guard reads the tool input as JSON and could not, so none of D1 to D3 looked at anything.\n'
  + 'An unreadable payload is an ASK, never a silent allow: a guard that is switched off by a '
  + 'malformed call is switched off by exactly the call shape worth worrying about.';

/* THIS FILE'S OWN CLI. The registered path is scripts/harness/hook.js, where a dialect module
   owns the wire format and nothing below is reached. Run directly, this file still reads and
   prints the one format it always did, and exits 0: the tests drive it that way, and a session
   started before hook.js was registered still calls it that way.

   WHICH OF A TOOL'S OWN TOOLS IS A SHELL AND WHICH A WRITE IS NOT WRITTEN HERE. This CLI asks
   the dialect module that owns that wire format, so the table exists once. One fixture copies
   this file beside config.js and doc-frozen.cjs ALONE and runs it, so the dialect is loaded
   softly: without it nothing here can tell a shell from a write, and the call is offered to
   BOTH readings as an opaque one. That is the strict reading, never a guess at a name.

   THE ONE WIRE FORMAT NAMED IN A GUARD, and a stated exception (scripts/harness/tools.json
   `_readme`). It is not looked up in the registry, because it is not a fact about whichever
   tool is enabled: it is the format this CLI has always read and out() below always prints, and
   a registry lookup would have it parse one format and print another. */
const LEGACY_DIALECT = 'claude';
function legacyDialect() {
  try { return require(path.join(__dirname, '..', 'dialects', LEGACY_DIALECT + '.js')); } catch { return null; }
}

function legacyEvent(raw, payload, dialect) {
  if (dialect) return dialect.parse(raw);
  const i = (payload && payload.tool_input) || {};
  return {
    event: 'pre-tool',
    action: 'other',
    command: i.command != null ? i.command : null,
    path: (i.file_path != null || i.path != null) ? (i.file_path || i.path || '') : null,
    content: i.content != null ? String(i.content) : (i.new_string != null ? String(i.new_string) : null),
    old: i.old_string != null ? i.old_string : null,
    tool: String((payload && payload.tool_name) || ''),
    input: i,
    opaque: true,
  };
}

function gate(raw) {
  // No stdin at all is not a malformed call, it is no call.
  if (!String(raw || '').trim()) return null;
  let payload;
  let event;
  try {
    payload = JSON.parse(raw);
    event = legacyEvent(raw, payload, legacyDialect());
  } catch {
    return out('ask', UNPARSEABLE);
  }
  if (!looksAt(event)) return null;
  const v = decide(event, gather(event, softConfig()));
  return (v.deny || v.ask) ? out(v.ask ? 'ask' : 'deny', v.reason) : null;
}

function out(decision, reason) {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
    systemMessage: 'Phase guard: ' + String(reason).split('\n')[0],
  };
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  let data = '';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    let o = null;
    try { o = gate(data); } catch { o = null; }
    if (o) process.stdout.write(JSON.stringify(o));
    process.exit(0); // the decision rides in the JSON, never in the exit code
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { data += c; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(() => { try { process.stdin.destroy(); } catch {} finish(); }, 2000).unref();
}

module.exports = { decide, gather, wants, rules, decideMcp, readableToGuards, unreadable, writeTargets, decisionFor, paths, pathsOf };

if (require.main === module) {
  try { main(); } catch { process.exit(0); } // a guard failure must not take down the session
}
