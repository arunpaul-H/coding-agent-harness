#!/usr/bin/env node
/**
 * Secret-file guard: a pre-tool handler, run by scripts/harness/hook.js for every shell, read,
 * search and write call and for every call whose shape no dialect vouches for.
 *
 * TWO WAYS IN. hook.js parses the tool's own payload through a dialect module and calls
 * decide(event, state) and decideSessionStart(event, state) here; both are pure. Run directly,
 * this file reads the legacy wire format off stdin and prints it back (see gate()).
 *
 * Intercepts any tool call that names a guarded file and refuses it. A guarded file
 * holds real credentials, and READING one copies its values into the transcript
 * permanently — that cannot be undone, which is why the verdict is a refusal and not
 * a warning. There is no "after the fact" for a secret.
 *
 * THE STANCE IS DENY-ALL, AND THAT IS THE WHOLE GENERALISATION.
 * The harness this is ported from had it the other way round: one production file was
 * guarded by name and every other `.env` was open, on the reasoning that the open
 * ones held disposable values due for rotation. That reasoning was true on the day it
 * was written and silently stopped being true later, which is the failure mode of
 * every allow-list. So here `config.env.guarded` is the deny list, it defaults to
 * `.env` and `.env.*`, and an exception is an EXPLICIT, DATED entry in
 * `config.env.openCarveOuts` — not an edit to this file.
 *
 *   { "path": ".env.local", "why": "<what is in it and why that is safe>", "until": "YYYY-MM-DD" }
 *
 * THE DATE IS A MECHANISM, NOT A NOTE. Two things happen because it exists:
 *   1. `--rearm-check` reports every open carve-out at SessionStart for as long as it
 *      exists. You do not get to stop seeing the hole you opened.
 *   2. ON THE DAY IT EXPIRES THE GUARD RE-ARMS ITSELF. An expired carve-out stops
 *      suppressing anything, so the file is guarded again with nobody having
 *      remembered. The original of this file carried a prose checklist headed
 *      "RE-ARM AT CUT-OVER" and a warning that it was owed at a future date. A
 *      checklist owed at a future date is only owed if something remembers on the
 *      day; prose is what this replaces.
 *
 * TWO LAYERS, AND THEY ARE NOT INTERCHANGEABLE.
 *   · `permissions.deny` in settings.json blocks the Read tool by path, before any
 *     hook runs. It is coarse: a settings glob cannot say "but not the .example
 *     twin", so only the WILDCARD-FREE guarded paths are denied there. See the
 *     comment on that block, and on TWINS below.
 *   · This hook covers everything deny cannot see: cat, type, Get-Content, grep,
 *     head, an editor write, and an MCP server that names the file in a field nobody
 *     here has heard of.
 *
 * WHY IT TESTS THE WHOLE tool_input AS TEXT
 * The path arrives as `file_path` for one tool, `command` for another, `pattern` for a
 * third, nested inside an array of edits for a fourth, and as whatever a server
 * decided to call it for an MCP tool. Enumerating field names is a list, and a list is
 * silent about every tool added after it was written. So every string the input
 * carries, keys included and at any depth, is matched as text (see textOf for why
 * that is the decoded text and not the serialised JSON), and the mcp__.* matcher in
 * settings.json needs no special case.
 *
 * A FILE, NEVER AN INLINE `node -e`: a one-liner handed to a shell gets word-split,
 * `=>` is read as a redirect, and the guard both breaks and litters the repo with
 * 0-byte files named after fragments of its own source. Every hook here is a file.
 *
 * Run:  node scripts/harness/guards/env-guard.cjs --self-test
 *       node scripts/harness/guards/env-guard.cjs --rearm-check
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { load, DEFAULTS, ROOT } = require('../config.js');

/* ── the stance ─────────────────────────────────────────────────────────────── */

/**
 * The guarded list, from the config seam.
 *
 * SOFT LOAD, AND THEN THE STRICTEST DOCUMENTED STANCE. A PreToolUse hook that throws
 * takes the session down with it, so the config is read with `{ soft: true }`. What it
 * falls back to matters: it is NOT "allow everything" and it is NOT "ask about
 * everything" (which would fire on every tool call and get the hook deleted inside an
 * hour). It is `DEFAULTS.env` — deny-all on `.env` and `.env.*`, with no carve-outs.
 *
 * That is a different thing from the gate runner inventing a suite, which the config
 * loader refuses to do and must keep refusing. Inventing a suite manufactures a GREEN
 * VERDICT about work nobody agreed to. Falling back to a deny stance manufactures a
 * REFUSAL, which is visible, arguable and harmless — the failure direction a guard is
 * allowed to have.
 */
function stanceOf(cfg) {
  const env = (cfg && cfg.env) || DEFAULTS.env;
  return {
    guarded: Array.isArray(env.guarded) ? env.guarded : DEFAULTS.env.guarded,
    openCarveOuts: Array.isArray(env.openCarveOuts) ? env.openCarveOuts : [],
    fromConfig: Boolean(cfg),
  };
}
/** The disk half of the above, for this file's own CLI. scripts/harness/hook.js loads the
 *  config once for every guard and calls stanceOf() with it. */
function stance() {
  let cfg = null;
  try { cfg = load({ soft: true }); } catch { cfg = null; }
  return stanceOf(cfg);
}

/* ── pattern matching ───────────────────────────────────────────────────────── */

/**
 * SCAFFOLDING TWINS, which a guarded pattern must never match.
 *
 * `.env.example` and `.env.local.template` are the files the deny message itself tells
 * you to read instead. The original deny pattern here was a bare `.env.*`, and it
 * blocked exactly those — a guard that blocks its own recommended alternative trains
 * people to click through it, and a guard people click through is off. It also masked
 * a live breakage for weeks, because every check that someone ran against it was a
 * by-name probe that reported the key as present.
 *
 * So the twin suffixes are carved out of the WILDCARD itself, below, and the self-test
 * pins every one of them as a NON-match. A guard is only as good as its negative
 * cases, and nothing in the original caught this because nothing tested one.
 */
const TWINS = ['template', 'example', 'sample', 'dist', 'md'];
// Read as: from here, the rest of this filename is not <anything>.<twin>.
const TWIN_AHEAD = '(?!(?:[\\w.-]*\\.)?(?:' + TWINS.join('|') + ')(?![\\w-]))';

// The characters a path token may contain, as seen inside the text of a tool_input:
// everything except whitespace, quoting, separators and shell punctuation. `/` and `\`
// are excluded so a `*` cannot swallow a directory boundary.
const TOKEN_CHAR = '[^\\s"\'`\\\\/=,;:()\\[\\]{}<>|&]';

/**
 * A glob-ish pattern from the config, compiled to an UNANCHORED, global, case-
 * insensitive regex. Unanchored because the haystack is every string of a payload, not
 * a clean path — the file may be mentioned mid-command, inside a quoted argument, or behind
 * a `--env-file=` flag.
 *
 * The lookbehind is what stops `myenv` and `app.env` from reading as `.env`; the
 * trailing lookahead is what stops `.env` from reading as `.env.local` (which
 * matters, because `.env.local` may be carved out while `.env` is not).
 *
 * `twinGuard` is on for GUARDED patterns and off for CARVE-OUTS: the twin exemption
 * exists to prevent a false refusal, and a carve-out can only ever permit.
 */
function compile(pattern, twinGuard) {
  const src = String(pattern);
  let out = '(?<![\\w.$-])';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*') {
      // Only a TRAILING wildcard gets the twin guard: that is the position where a
      // `*` would otherwise swallow `.example` and refuse the documented alternative.
      const trailing = i === src.length - 1;
      out += (trailing && twinGuard ? TWIN_AHEAD : '') + TOKEN_CHAR + '*';
    } else if (c === '?') {
      out += TOKEN_CHAR;
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  // A pattern with no trailing wildcard must not match a longer filename.
  if (!src.endsWith('*')) out += '(?![\\w.-])';
  return new RegExp(out, 'gi');
}

/** Every span in `hay` that any of `patterns` matches: { start, end, text, pattern }. */
function spans(patterns, hay, twinGuard) {
  const out = [];
  for (const p of patterns || []) {
    const re = compile(p, twinGuard);
    for (const m of String(hay).matchAll(re)) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], pattern: p });
    }
  }
  return out;
}

/** A carve-out is live while it has not expired. `today` is injected so this is pure. */
const isLive = (c, today) => Boolean(c && typeof c.until === 'string' && c.until >= today);

/* ── the decision ───────────────────────────────────────────────────────────── */

/** The neutral verdict. See scripts/harness/dialects/_wire.js for the contract. */
const ALLOW = Object.freeze({ deny: false, reason: '' });

/* THIS FILE'S OWN CLI still prints the one wire format it always printed, and exits 0: the
   gates, the tests and a session started before scripts/harness/hook.js was registered all run
   it that way. The registered path is hook.js, where the wire format is a dialect module's and
   a deny is also exit 2. Nothing below this line decides anything. */
function legacyOutput(decision, reason, message) {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
    systemMessage: message,
  };
}

const UNPARSEABLE = [
  '*** SECRET FILE GUARD — THE PAYLOAD DID NOT PARSE ***',
  'This guard reads the tool input as JSON and could not. So it cannot tell whether this',
  'call names a guarded credential file or not.',
  '',
  'An unreadable payload is an ASK, never a silent allow. The alternative is a guard that',
  'is switched off by a malformed call, which is the one call shape worth worrying about.',
  'Approve it only if you know what this tool is about to open.',
].join('\n');

/**
 * Every string a tool_input carries — KEYS as well as values, at any depth — one per
 * line. This is the haystack, and it is the DECODED text on purpose.
 *
 * ⚠ The haystack used to be `JSON.stringify(tool_input)`, and that shipped a hole. In
 * serialised JSON a newline is the two characters backslash-n and a tab is backslash-t,
 * so a guarded name at the START OF A LINE was preceded by the letter `n`. The
 * lookbehind in compile() exists to stop `myenv` reading as a guarded name, and it
 * read that `n` the same way: part of a longer word, no match, silent allow. A line
 * continuation, a here-document and a tab-separated argument all walked through, in
 * every tool, while `cat <name>` on one line was refused — which is the shape of hole
 * nobody finds by trying the obvious command. It was found by a write that should have
 * been refused and was not.
 *
 * Decoded leaves have no escape sequences to hide behind: the character in front of a
 * name is the character the shell will see. Keys are kept because a server-defined
 * payload may spell the file as a KEY, and a guard that reads only values is a guard
 * with a list of shapes again. Iterative, not recursive: a hook that overflows its
 * stack on a deep payload has thrown, and a guard that throws has allowed.
 */
function textOf(input) {
  const parts = [];
  const stack = [input];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') { parts.push(v); continue; }
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) { for (const x of v) stack.push(x); continue; }
    for (const k of Object.keys(v)) { parts.push(k); stack.push(v[k]); }
  }
  return parts.join('\n');
}

/**
 * The whole pre-tool decision: decide(event, state), pure. No stdin, no disk, no clock.
 *
 *   event   the neutral event. Only `event.input` is read, and it is read as TEXT (see textOf),
 *           so this guard has no tool name and no field name to get wrong.
 *   state   { guarded, openCarveOuts, today }: the stance from the config and today's date,
 *           gathered by the caller. A state with no guarded list is NOT "nothing is guarded":
 *           it falls back to the deny-all default, the one failure direction a guard may have.
 *
 * Pure so --self-test can drive it with literals. An assertion that read the real
 * config and the real tree could only ever test today's configuration, and would go
 * quietly green the moment somebody edited it.
 */
function decide(event, state) {
  const st = state || {};
  const guarded = Array.isArray(st.guarded) ? st.guarded : DEFAULTS.env.guarded;
  const today = String(st.today || '');

  const hay = textOf((event && event.input) || {});
  const hits = spans(guarded, hay, true);
  if (!hits.length) return ALLOW;

  // An EXPIRED carve-out suppresses nothing, so the guard re-arms itself on the day.
  // With no date in the state nothing can be shown to be live, so no carve-out opens anything.
  const open = spans((today ? st.openCarveOuts || [] : []).filter((c) => isLive(c, today)).map((c) => c.path), hay, false);
  const live = hits.filter((h) => !open.some((o) => o.start <= h.start && o.end >= h.end));
  if (!live.length) return ALLOW;

  // The matched SPAN is named — a filename, which is the thing the reader has to
  // recognise. Nothing else from the payload is quoted: a tool_input may carry a
  // credential in a field this guard has never heard of, and a permissionDecisionReason
  // is written into the transcript permanently.
  const named = [...new Set(live.map((h) => h.text))].join(', ');
  const reason = [
    '*** SECRET FILE GUARD ***',
    '(1) This call names ' + named + ', which the deny stance in harness.config.json guards.',
    '(2) Reading it copies the secret VALUES into this transcript permanently — they cannot be un-read.',
    '(3) Committing it, or pasting it into an issue, publishes them. Neither can be undone by a revert.',
    '',
    'To learn the SHAPE of the configuration instead, read the scaffolding twin: .env.example,',
    '.env.template or the .sample beside it. Those are deliberately NOT guarded, and the',
    'self-test pins them as non-matches so this guard can never block its own alternative.',
    '',
    'If this access is genuinely needed and genuinely safe, it is a DATED carve-out in',
    'harness.config.json, not an approval here and not an edit to this file:',
    '  "env": { "openCarveOuts": [ { "path": "' + (live[0].pattern || '.env.x') + '", "why": "...", "until": "YYYY-MM-DD" } ] }',
    'It is reported at every session start while it is open, and the guard re-arms itself',
    'on the expiry date.',
  ].join('\n');

  return { deny: true, reason, message: 'Secret-file guard: refused a call naming ' + named + '.' };
}

/**
 * This file's own CLI: raw stdin in the legacy wire format, a hook output or null out.
 * An unreadable payload is an ASK here. Under hook.js the dialect owns the parse and an
 * unreadable payload is a deny; a guard run directly behaves as it always has.
 */
function gate(raw, st, today) {
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return legacyOutput('ask', UNPARSEABLE, 'WARNING: a tool payload the secret-file guard could not parse requires your decision.');
  }
  const v = decide({ input: (payload && payload.tool_input) || {} }, Object.assign({}, st, { today }));
  return v.deny ? legacyOutput('deny', v.reason, v.message) : null;
}

/* ── the re-arm check (SessionStart) ───────────────────────────────────────── */

/**
 * The two deny spellings a guarded path needs in `permissions.deny`.
 *
 * BOTH FORMS ARE LOAD-BEARING. The `./` form matches a Read of the path as the repo
 * writes it; the double-star glob form matches the absolute path a tool call usually
 * carries (it is spelled out in the code two lines down — a block comment cannot hold
 * that glob, because its own characters close the comment).
 * Either one alone leaves the other call shape open — half a re-arm is not a re-arm —
 * and this is generated as LITERALS rather than compared as a pattern, because a
 * near-miss spelling reads as "guarded" while blocking nothing.
 */
const denySpellings = (p) => ['Read(./' + p + ')', 'Read(//**/' + p + ')'];

/**
 * Which guarded patterns are expected in `permissions.deny`: the ones with NO wildcard.
 *
 * A wildcard pattern is deliberately left to this hook alone. `Read(./.env.*)` cannot
 * express "but not the .example twin" — a settings glob has no negative lookahead — so
 * putting one there would block the documented alternative at the layer that has no way
 * to make an exception. That is the mistake the original made, and the cost was a guard
 * people learned to click through. The hook has the lookahead; the coarse layer gets the
 * paths it can state exactly.
 */
const literalGuards = (guarded) => (guarded || []).filter((p) => !/[*?]/.test(String(p)));

/**
 * The entire SessionStart decision as a pure function.
 *
 * Reports three things, all of which are "a hole exists" rather than "a hole appeared":
 *   1. EVERY OPEN CARVE-OUT, for as long as it exists. Not once, not on a change —
 *      every session. A carve-out you have stopped seeing is a permanent one.
 *   2. An EXPIRED carve-out, named as expired. The guard has already re-armed itself at
 *      this point, so this line explains the refusals rather than warning about them.
 *   3. A guarded path missing either of its two deny spellings. A missing or non-array
 *      deny list counts as BOTH absent: a settings file with no deny block is the
 *      unguarded case in its worst form, and reading "no list" as "nothing to report" is
 *      exactly how a truncated or hand-edited settings.json passes for guarded.
 */
function rearmFindings({ guarded, openCarveOuts, denyList, denyLayer, today, fromConfig } = {}) {
  const out = [];

  if (fromConfig === false) {
    out.push('harness.config.json could not be read, so this guard is running on its built-in '
      + 'deny-all default (' + DEFAULTS.env.guarded.join(', ') + ') and NO carve-outs. A stance '
      + 'nobody wrote down is a stance nobody agreed to: run `node scripts/harness/config.js` to see why.');
  }

  const g = Array.isArray(guarded) ? guarded : [];
  const carves = Array.isArray(openCarveOuts) ? openCarveOuts : [];

  for (const c of carves) {
    const where = String((c && c.path) || '(no path)');
    const why = String((c && c.why) || '(no reason given)');
    if (!isLive(c, today)) {
      out.push('EXPIRED carve-out ' + where + ' (until ' + String((c || {}).until) + ', today is ' + today
        + '): the guard has re-armed itself and is refusing this path again. Remove the entry, or '
        + 'renew it with a new date and a reason that is true now.');
      continue;
    }
    out.push('OPEN carve-out ' + where + ' until ' + c.until + ' — "' + why + '". While this entry '
      + 'exists the guard does not refuse that path, to any tool.');
    // A carve-out for a path nothing guards reads as protection and is not any.
    if (!g.some((p) => compile(p, true).test(where))) {
      out.push('  ...and no pattern in env.guarded matches ' + where + ', so this carve-out opens '
        + 'nothing and hides a typo. Fix the path or delete the entry.');
    }
  }

  // `denyLayer: false` is the caller saying this tool HAS no declarative deny file the harness
  // knows how to read, which is a different fact from a file that is there with no list in
  // it. Only an explicit false skips the check: absent, it runs, and no list is a finding.
  const deny = Array.isArray(denyList) ? denyList : [];
  for (const p of (denyLayer === false ? [] : literalGuards(g))) {
    const missing = denySpellings(p).filter((e) => !deny.includes(e));
    if (missing.length) {
      out.push('permissions.deny is missing ' + missing.length + ' of the 2 Read denies for the '
        + 'guarded path ' + p + ': ' + missing.join(', ') + '. Each spelling blocks a call shape the '
        + 'other misses, so one present is still an open path to the file.');
    }
  }

  return out;
}

/**
 * The session-start report: decideSessionStart(event, state), pure. The event is not read.
 *
 *   state   { guarded, openCarveOuts, fromConfig, denyList, denyLayer, today }. The deny list
 *           is READ BY THE CALLER, out of whichever file the tool keeps it in (trap MT-06):
 *           scripts/harness/hook.js takes that file from the registry row and the dialect, and
 *           this file's own --rearm-check reads the one it always read.
 *
 * Silence is the normal state: a hook that talks when there is nothing to say gets muted
 * long before the one session where it matters.
 */
function decideSessionStart(event, state) {
  const findings = rearmFindings(state || {});
  if (!findings.length) return ALLOW;

  const text = [
    '*** THE SECRET-FILE GUARD HAS AN OPEN HOLE ***',
    'Every line below is a path a credential can leave this machine through, or a layer',
    'that is not actually holding the line it claims to.',
    '',
    ...findings.map((f) => '  - ' + f),
    '',
    'The stance lives in harness.config.json under `env`, and nowhere else. Do not edit',
    'scripts/harness/guards/env-guard.cjs to open a path: a carve-out in the config is dated, is',
    'reported here for as long as it exists, and expires on its own.',
  ].join('\n');

  return {
    deny: false,
    reason: '',
    context: text,
    message: 'WARNING: the secret-file guard reports ' + findings.length + ' open hole(s) — see context.',
  };
}

/**
 * --rearm-check, this file's own CLI. Always exits 0 and never throws: a reminder that takes
 * the session with it is worse than one that stays quiet.
 */
function rearmCheck() {
  try {
    const st = stance();
    let denyList;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
      denyList = (settings.permissions || {}).deny;
    } catch {
      // Unreadable settings proves no deny entry either way, so leave this undefined and
      // let rearmFindings treat it as both spellings absent.
    }

    const v = decideSessionStart(null, {
      guarded: st.guarded,
      openCarveOuts: st.openCarveOuts,
      denyList,
      today: new Date().toISOString().slice(0, 10),
      fromConfig: st.fromConfig,
    });
    if (!v.context) return;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: v.context },
      systemMessage: v.message,
    }));
  } catch {
    // A reminder that throws is worse than one that stays quiet.
  }
}

/* ── self-test ──────────────────────────────────────────────────────────────── */

function selfTest() {
  const fails = [];
  let checks = 0;
  const must = (what, got, want) => {
    checks += 1;
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  };
  const DENY_ALL = { guarded: ['.env', '.env.*'], openCarveOuts: [], fromConfig: true };
  const verdict = (input, st, today) => {
    const out = gate(JSON.stringify({ tool_name: 'X', tool_input: input }), st || DENY_ALL, today || '2026-01-01');
    return out ? out.hookSpecificOutput.permissionDecision : null;
  };

  /* The deny-all stance, over every field shape a path arrives in. */
  must('a Read of .env is refused', verdict({ file_path: '/repo/.env' }), 'deny');
  must('a Read of .env.local is refused', verdict({ file_path: '/repo/.env.local' }), 'deny');
  must('cat is refused', verdict({ command: 'cat .env' }), 'deny');
  must('Get-Content with a backslash path is refused', verdict({ command: 'Get-Content .\\.env.local' }), 'deny');
  must('a --env-file flag is refused', verdict({ command: 'node --env-file=.env app.js' }), 'deny');
  must('a nested edits array is scanned', verdict({ edits: [{ file_path: '.env.production' }] }), 'deny');
  must('a grep pattern naming the file is refused', verdict({ pattern: 'KEY', path: '.env' }), 'deny');
  // The mcp__.* matcher needs no special case BECAUSE of this: a field name nobody here
  // has heard of is still inside the serialised tool_input.
  must('a server-defined field naming the file is refused', verdict({ target_document: '.env.local' }), 'deny');

  /* THE NEGATIVE CASES. This half is the point: the guard must not block its own
     recommended alternative, and nothing in the original caught that it did. */
  must('.env.example is NOT blocked', verdict({ file_path: '.env.example' }), null);
  must('.env.template is NOT blocked', verdict({ file_path: '.env.template' }), null);
  must('.env.local.template is NOT blocked', verdict({ file_path: '.env.local.template' }), null);
  must('.env.production.sample is NOT blocked', verdict({ file_path: '.env.production.sample' }), null);
  must('a doc ABOUT the file is NOT blocked', verdict({ file_path: 'docs/reference/.env.md' }), null);
  must('a filename that merely ends in env is NOT blocked', verdict({ file_path: 'config/app.env' }), null);
  must('an unrelated dotfile is NOT blocked', verdict({ file_path: '.gitignore' }), null);
  must('an ordinary command is NOT blocked', verdict({ command: 'npm test' }), null);
  must('the word environment is NOT a guarded path', verdict({ command: 'echo "set the environment"' }), null);

  /* A NAME AT THE START OF A LINE, the hole the serialised haystack left open (see
     textOf). Each of these was a silent allow: in serialised JSON the character in
     front of the name is the `n` of an escaped newline or the `t` of an escaped tab,
     and the lookbehind took it for the tail of a longer word. The fixtures are written
     with escapes so the decoded command is what a shell would be handed. */
  const BARE = DENY_ALL.guarded[0];
  must('a name after a line continuation is refused', verdict({ command: 'cat \\\n' + BARE }), 'deny');
  must('a name on a line of its own is refused', verdict({ command: 'cd repo\n' + BARE + '.local' }), 'deny');
  must('a name after a tab is refused', verdict({ command: 'type\t' + BARE }), 'deny');
  must('a name after a CRLF is refused', verdict({ command: 'type notes.txt\r\n' + BARE + '.production' }), 'deny');
  must('a name that is a KEY is refused', verdict({ files: { [BARE]: true } }), 'deny');
  must('a name deep inside nested arrays is refused', verdict({ a: [[{ b: ['x\n' + BARE + '.local'] }]] }), 'deny');
  must('...and a twin on a line of its own is still NOT', verdict({ command: 'cat \\\n' + BARE + '.example' }), null);
  must('...nor is a longer word that merely starts a line', verdict({ command: 'echo my\nenvironment' }), null);
  // Iterative on purpose: a recursive walk overflows here, a hook that overflows has
  // thrown, and a guard that throws has allowed.
  must('a payload fifty thousand levels deep is read, not overflowed',
    (() => { let deep = BARE; for (let i = 0; i < 50000; i++) deep = [deep]; return textOf(deep); })(), BARE);

  /* A guarded list that names one file does not guard the others. */
  const ONE = { guarded: ['.env.production'], openCarveOuts: [], fromConfig: true };
  must('a narrow stance refuses the named file', verdict({ command: 'cat .env.production' }, ONE), 'deny');
  must('...and nothing else', verdict({ command: 'cat .env.local' }, ONE), null);

  /* CARVE-OUTS, and the expiry that re-arms the guard with nobody remembering. */
  const carve = (until) => ({ guarded: ['.env', '.env.*'], fromConfig: true, openCarveOuts: [{ path: '.env.local', why: 'disposable local values', until }] });
  must('a live carve-out opens exactly its path', verdict({ command: 'cat .env.local' }, carve('2026-12-31'), '2026-01-01'), null);
  must('...and opens nothing else', verdict({ command: 'cat .env' }, carve('2026-12-31'), '2026-01-01'), 'deny');
  must('...nor a sibling', verdict({ command: 'cat .env.production' }, carve('2026-12-31'), '2026-01-01'), 'deny');
  // ⚠ THE MECHANISM THAT REPLACES THE PROSE CHECKLIST. The original carried a written
  // "re-arm at cut-over" note and nothing that read it. This is the assertion that the
  // date does the work: one day later, the same call is refused again.
  must('an EXPIRED carve-out re-arms the guard', verdict({ command: 'cat .env.local' }, carve('2025-12-31'), '2026-01-01'), 'deny');
  must('a carve-out expires ON the day after, not on it', verdict({ command: 'cat .env.local' }, carve('2026-01-01'), '2026-01-01'), null);
  must('an undated carve-out opens nothing', verdict({ command: 'cat .env.local' }, { guarded: ['.env.*'], fromConfig: true, openCarveOuts: [{ path: '.env.local', why: 'x' }] }), 'deny');

  /* An unreadable payload is an ASK, never a silent allow. */
  must('an unparseable payload asks', verdict_raw('not json'), 'ask');
  must('an empty payload decides nothing', verdict_raw(''), null);
  must('a payload with no tool_input decides nothing', verdict_raw('{"tool_name":"Bash"}'), null);
  function verdict_raw(raw) {
    const out = gate(raw, DENY_ALL, '2026-01-01');
    return out ? out.hookSpecificOutput.permissionDecision : null;
  }

  /* The deny message must never quote the payload beyond the matched filename. */
  // A DISTINCTIVE name: the reason's fixed text always spells the bare name and its twins,
  // so a check for the bare name passes with the matched span dropped from the message.
  const leak = gate(JSON.stringify({ tool_input: { file_path: '.env.production', token: 'NOTAREALCREDENTIAL' } }), DENY_ALL, '2026-01-01');
  must('the refusal names the file', leak.hookSpecificOutput.permissionDecisionReason.includes('This call names .env.production,'), true);
  must('the refusal never quotes another field', leak.hookSpecificOutput.permissionDecisionReason.includes('NOTAREALCREDENTIAL'), false);

  /* The re-arm check, driven with literals for the same reason decide() is. */
  const BOTH = ['Read(./.env)', 'Read(//**/.env)'];
  const rearm = (o) => rearmFindings(Object.assign({ guarded: ['.env', '.env.*'], openCarveOuts: [], denyList: BOTH, today: '2026-01-01', fromConfig: true }, o));
  must('a properly wired deny-all stance is silent', rearm({}).length, 0);
  must('an open carve-out is reported for as long as it exists',
    rearm({ openCarveOuts: [{ path: '.env.local', why: 'x', until: '2026-12-31' }] }).length, 1);
  must('...and the report names its expiry date',
    /until 2026-12-31/.test(rearm({ openCarveOuts: [{ path: '.env.local', why: 'x', until: '2026-12-31' }] })[0]), true);
  must('an expired carve-out is reported as expired, not as open',
    /EXPIRED/.test(rearm({ openCarveOuts: [{ path: '.env.local', why: 'x', until: '2025-01-01' }] })[0]), true);
  must('a carve-out for a path nothing guards is reported as a typo',
    rearm({ openCarveOuts: [{ path: 'config/app.env', why: 'x', until: '2026-12-31' }] }).length, 2);
  // Half a re-arm is not a re-arm: each spelling blocks a call shape the other misses.
  must('only the ./ deny is a finding', rearm({ denyList: [BOTH[0]] }).length, 1);
  must('only the glob deny is a finding', rearm({ denyList: [BOTH[1]] }).length, 1);
  must('neither deny is a finding', rearm({ denyList: ['Read(./.env.other)'] }).length, 1);
  // ⚠ No deny list at all is the unguarded case, not an exemption from it.
  must('no deny list at all is a finding', rearm({ denyList: undefined }).length, 1);
  // A wildcard pattern is NOT expected in permissions.deny — see literalGuards.
  must('a wildcard guard is not expected in permissions.deny', literalGuards(['.env', '.env.*', 'secrets/*.key']), ['.env']);
  must('an unreadable config is itself a finding', rearm({ fromConfig: false }).length, 1);
  // A tool with no deny file the harness can read is not a tool with a half-armed one.
  must('a tool with no declarative deny layer is not told its list is missing', rearm({ denyList: undefined, denyLayer: false }).length, 0);
  must('...and it is still told about an open carve-out',
    rearm({ denyLayer: false, openCarveOuts: [{ path: BARE + '.local', why: 'x', until: '2026-12-31' }] }).length, 1);

  /* THE NEUTRAL DECISION, which is what scripts/harness/hook.js calls. No wire format, no tool
     name: an event carrying an input, and a state carrying the stance and the date. */
  const NOW = { guarded: DENY_ALL.guarded, openCarveOuts: [], today: '2026-01-01' };
  const refused = decide({ event: 'pre-tool', action: 'shell', input: { command: 'cat ' + BARE } }, NOW);
  must('a neutral event naming a guarded file is a deny verdict', [refused.deny, typeof refused.reason, typeof refused.message], [true, 'string', 'string']);
  must('...and one that names none is the allow verdict', decide({ event: 'pre-tool', action: 'read', input: { path: 'README.md' } }, NOW), { deny: false, reason: '' });
  must('an event with no input at all decides nothing', decide({ event: 'pre-tool', action: 'other' }, NOW), { deny: false, reason: '' });
  // ⚠ A state nobody gathered must not read as "nothing is guarded".
  must('a state with no guarded list falls back to deny-all, not to allow', decide({ input: { command: 'cat ' + BARE } }, {}).deny, true);
  must('a carve-out with no date in the state opens nothing', decide({ input: { command: 'cat ' + BARE + '.local' } },
    { guarded: DENY_ALL.guarded, openCarveOuts: [{ path: BARE + '.local', why: 'x', until: '2026-12-31' }] }).deny, true);
  const report = decideSessionStart(null, { guarded: DENY_ALL.guarded, openCarveOuts: [], denyList: [], today: '2026-01-01', fromConfig: true });
  must('the session-start verdict never denies, and carries its report as context',
    [report.deny, /missing 2 of the 2/.test(report.context), typeof report.message], [false, true, 'string']);
  must('...and a whole stance says nothing at all',
    decideSessionStart(null, { guarded: DENY_ALL.guarded, openCarveOuts: [], denyList: BOTH, today: '2026-01-01', fromConfig: true }), { deny: false, reason: '' });
  must('stanceOf with no config is the deny-all default, said to be a default', stanceOf(null), { guarded: DEFAULTS.env.guarded, openCarveOuts: [], fromConfig: false });

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? 'FAIL - env-guard self-test: ' + fails.length + ' assertion(s)'
    : 'PASS - env-guard self-test (' + checks + ' checks: deny-all stance, ' + TWINS.length + ' twin suffixes, expiry re-arm)');
  process.exit(fails.length ? 1 : 0);
}

/* ── entry ──────────────────────────────────────────────────────────────────── */

let done = false;
function finish(data) {
  if (done) return;
  done = true;
  let out = null;
  try { out = gate(data, stance(), new Date().toISOString().slice(0, 10)); } catch { out = null; }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0); // the decision rides in the JSON, never in the exit code
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  // Returns before the stdin wiring: SessionStart hands this mode a payload it has no
  // use for, and waiting on stdin would add a stall to every session start.
  if (process.argv.includes('--rearm-check')) return rearmCheck();
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { data += c; });
  process.stdin.on('end', () => finish(data));
  process.stdin.on('error', () => finish(data));
  // Never hang a tool call waiting on stdin that is not coming.
  setTimeout(() => { try { process.stdin.destroy(); } catch {} finish(data); }, 2000).unref();
}

module.exports = { decide, decideSessionStart, stanceOf, gate, textOf, rearmFindings, compile, literalGuards, denySpellings };

if (require.main === module) {
  try { main(); } catch { process.exit(0); } // a guard failure must not take down the session
}
