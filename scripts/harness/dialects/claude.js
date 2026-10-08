'use strict';

/*
 * dialects/claude.js — the wire format of the `claude` dialect.
 *
 * The registry (scripts/harness/tools.json) maps three rows to it: Claude Code, Codex CLI and
 * Kimi Code. WHAT EACH RESEARCH CELL LISTS ON STDIN, which is not the same thing three times:
 *   Claude Code  `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`
 *   Codex CLI    `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `tool_name`,
 *                `tool_input`
 *   Kimi Code    `hook_event_name`, `session_id`, `session_title`, `client_type`, `cwd`, "plus
 *                event fields". NEITHER `tool_name` NOR `tool_input` IS NAMED for this one.
 * All three cells give the same two ways to deny: exit 2 with the reason on stderr, or
 * `permissionDecision: "deny"` in JSON on stdout. emit() does BOTH for a deny, because several
 * tools are documented to fail open on any exit code but 2.
 *
 * EVIDENCE: the registry says, row by row. Field names are read off vendor pages; only Claude
 * Code was run here, and what was observed is its policy route and a pre-tool deny.
 *
 * WHAT IS NOT IN THE RESEARCH CELLS, and what this file does about each:
 *   - where a payload with no `tool_input` object keeps the call's arguments (the third cell).
 *     The input is then the payload minus its envelope, so the secret-file guard still reads
 *     every string of it, and the call is OPAQUE: nothing here vouches for its shape.
 *   - an `ask` spelling, for any row but the first. No cell names one, and neither does any
 *     name the `hookSpecificOutput` nesting for the other two. An ask is therefore spelled as an
 *     ask ONLY for the row whose hook config is this dialect's permissions file, which is the
 *     one tool this spelling was ever run against; for every other row an ask is a DENY. Such a
 *     tool's calls that no guard can read (a patch tool, a server-defined tool) are refused.
 *   - how a prompt-submit hook blocks. emit() uses exit 2 with the reason on stderr and prints
 *     no JSON for that event.
 *   - the stop spelling, for any row but the first. It was MEASURED for Claude Code alone, in a
 *     headless session (the guard-hardening track's research file `2026-10-08-stop-hook.md`,
 *     under the docs root): a line for the person is `systemMessage` at exit 0, and
 *     a forced turn is `decision: "block"` with the reason. Exit 2 with stderr alone forced
 *     NOTHING there, so the JSON is what forces; the exit code stays 2 because the entry's rule
 *     is that a deny leaves with it, and the JSON was read at exit 2. The stop that follows a
 *     forced turn carries `stop_hook_active: true`, which parse() hands on as `forced`.
 *   - the session-start output shape. It is the one this repo's reporters have always printed.
 */

const { json, isObj, event, needsField, QUIET, say, sessionText } = require('./_wire.js');

const EVENT_OF = {
  PreToolUse: 'pre-tool', SessionStart: 'session-start', UserPromptSubmit: 'prompt-submit', Stop: 'stop',
};

/* THE ONLY PLACE THESE TOOL NAMES APPEAR. A name with no row here is not "some other harmless
   tool": it is a call whose input shape nothing here can vouch for, so it is OPAQUE and every
   guard is offered it. That covers a server-defined tool and a tool added after this was written
   alike. A list of names to ignore would be silent about exactly the second kind. */
const ACTION_OF = {
  Bash: 'shell', PowerShell: 'shell',
  Read: 'read',
  Grep: 'search', Glob: 'search',
  Edit: 'write', Write: 'write',
};

/* Every field the three cells name that is about the session and not the call. `tool_input` is
   NOT here on purpose: one that arrived as a string or a list stays in the input, as text. */
const ENVELOPE = ['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'model', 'tool_name', 'tool_use_id', 'session_title', 'client_type'];

function parse(stdin) {
  const p = json(stdin);
  const tool = typeof p.tool_name === 'string' ? p.tool_name : '';
  const known = Object.prototype.hasOwnProperty.call(ACTION_OF, tool);
  const action = known ? ACTION_OF[tool] : 'other';
  let input = p.tool_input;
  const shaped = isObj(input);
  if (!shaped) {
    input = {};
    for (const k of Object.keys(p)) if (!ENVELOPE.includes(k)) input[k] = p[k];
  }
  const e = event(EVENT_OF[p.hook_event_name], action, tool, input, !known || !shaped);
  // Where the tool's shell is standing, when the envelope says. All three cells name `cwd`. The
  // phase guard resolves a relative path against it; absent, a path is read from the repo root.
  e.cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : null;
  // A stop that follows a turn a stop hook forced. Only the boolean counts: see the header.
  e.forced = p.stop_hook_active === true;
  // A name this file maps is vouched for only when the field that action is decided from is there.
  if (needsField(action, e)) e.opaque = true;
  return e;
}

const decision = (how, v) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: how, permissionDecisionReason: v.reason },
  systemMessage: v.message,
});

/** `row` is the registry row this call is for. Only its hook config is read, never its id. */
function emit(verdict, ev, row) {
  const v = verdict || {};
  const kind = ev && ev.event;
  if (kind === 'session-start') {
    // A session must start whatever was found: the report rides in the JSON, the exit is 0.
    const text = sessionText(v);
    return text ? say({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text }, systemMessage: v.message }, '', 0) : QUIET;
  }
  if (kind === 'pre-tool') {
    if (v.deny) return say(decision('deny', v), v.reason, 2);
    if (v.ask) {
      // See the header: an ask spelling is established for one row. Elsewhere it must refuse.
      const canAsk = !!row && row.hookConfig === permissions.file;
      return canAsk ? say(decision('ask', v), '', 0) : say(decision('deny', v), v.reason, 2);
    }
    return QUIET;
  }
  if (kind === 'stop') {
    // A deny is a forced turn; no ask spelling is established, so an ask is one too. Anything
    // else ends the turn, with the handler's line for the person when it has one.
    if (v.deny || v.ask) return say({ decision: 'block', reason: v.reason, systemMessage: v.message }, v.reason, 2);
    return v.message ? say({ systemMessage: v.message }, '', 0) : QUIET;
  }
  // prompt-submit: no ask spelling is established, so an ask is a deny.
  return (v.deny || v.ask) ? say(null, v.reason, 2) : QUIET;
}

/**
 * The declarative deny layer that sits in front of the hooks, for the one tool whose hook
 * config file is also its permissions file. The secret-file guard's session-start report reads
 * it to say whether both Read denies of a guarded path are present (trap MT-06). `read` throws
 * on a file that does not parse, and the caller treats that as no list at all.
 */
const permissions = {
  file: '.claude/settings.json',
  read(text) {
    const s = JSON.parse(text);
    return isObj(s) && isObj(s.permissions) ? s.permissions.deny : undefined;
  },
};

/**
 * THE SHAPE OF THE HOOK CONFIG FILE, for the one row whose hook config is the file named here.
 * It is the same rule as `permissions` above: two rows share this wire format, and the shape of
 * the files the other two keep their hooks in is NOT in the research cells (one is named with no
 * shape, one lives in the user's home in another format). The installer renders nothing for a row
 * this does not cover, and says so.
 *
 * EVIDENCE: this shape is the registration this repo has run under since phase 3. The matcher is
 * the union of the names ACTION_OF maps, plus the server-defined tools: a name outside it never
 * reaches the entry, and a match-all would turn every other call into an ask (trap MT-17).
 * `entries` takes the row's id and never spells one.
 *
 * THE PROJECT-DIRECTORY VARIABLE IS SPELLED WITH BRACES. The tool launches hook commands under
 * a POSIX shell or under PowerShell, and the bare dollar form is an undefined PowerShell
 * variable: the command then runs `/scripts/harness/hook.js` off the drive root, fails with a
 * module-not-found, and every guard is absent with no refusal anywhere. Measured 2026-10-08 in
 * a throwaway repo: one session, both spellings registered side by side, the brace form ran
 * and the bare form died (trap WT-01 of the workspaces track).
 *
 * THE WORKSPACE ENTRY is added only for a row whose `worktreeCreate` cell is true. It answers
 * the tool's own worktree flag with a folder path, so its timeout is the setup command's, not
 * a guard's.
 *
 * THE STOP ENTRY has no matcher and the guard timeout: its one handler walks the tree and reads
 * two files, and never runs the suite.
 */
const HOOK = (id, ev) => 'node "${CLAUDE_PROJECT_DIR}/scripts/harness/hook.js" --tool ' + id + ' --event ' + ev;
const wiring = {
  file: '.claude/settings.json',
  evidence: 'the registration this repo\'s own sessions start under; the registry row says what was and was not observed',
  // The neutral actions the matcher's names carry: what a guard can be said to see here.
  actions: Array.from(new Set(Object.values(ACTION_OF))),
  gaps: [],
  entries(row) {
    const one = (ev) => ({ type: 'command', command: HOOK(row.id, ev), timeout: 30 });
    const out = [{ at: ['hooks', 'PreToolUse'], event: 'pre-tool', entry: { matcher: Object.keys(ACTION_OF).concat('mcp__.*').join('|'), hooks: [one('pre-tool')] } }];
    if (row.sessionStart === true) out.push({ at: ['hooks', 'SessionStart'], event: 'session-start', entry: { hooks: [one('session-start')] } });
    out.push({ at: ['hooks', 'Stop'], event: 'stop', entry: { hooks: [one('stop')] } });
    if (row.worktreeCreate === true) out.push({ at: ['hooks', 'WorktreeCreate'], event: 'worktree-create', entry: { hooks: [Object.assign(one('worktree-create'), { timeout: 600 })] } });
    return out;
  },
};

module.exports = { parse, emit, permissions, wiring };
