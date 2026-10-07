'use strict';

/*
 * dialects/gemini.js — the wire format of the `gemini` dialect (one registry row: Gemini CLI).
 *
 * FROM THE RESEARCH CELL, and nothing else: the pre-tool event is `BeforeTool`; stdin is JSON
 * carrying `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`, "plus tool
 * fields"; a deny is exit 2 with the reason on stderr, or stdout JSON `decision: "deny"` with
 * `reason`; a `SessionStart` event exists.
 *
 * EVIDENCE: `docs`. This tool was never run here.
 *
 * WHAT THE CELL DOES NOT ESTABLISH, and what this file does about each:
 *   - the names of the "tool fields". `tool_name` and `tool_input` are read IF PRESENT, and when
 *     they are absent the whole payload minus its envelope is the input.
 *   - this tool's own tool names. So there is no name-to-action table, and EVERY call is opaque:
 *     the secret-file guard still reads all of it as text, a `command` field still gets the git
 *     and archive rules, and a call nothing can read gets the phase guard's ask.
 *   - an `ask` spelling. An ask is emitted as a deny.
 *   - the session-start output shape. The report goes to stderr and the exit is 0.
 *
 * WHAT THE SECOND AND THIRD ADD UP TO, said plainly: AS WRITTEN THIS DIALECT REFUSES EVERY CALL
 * IT CANNOT READ, with exit 2. That is every call spelling neither `command` nor a path plus
 * `content`, which includes every plain file read, listing and search. Nobody is asked. It is
 * strict on purpose and it is NOT USABLE FOR ORDINARY WORK: registering it as it stands blocks
 * the tool. Wiring this tool for real needs the name-to-action table, and the table needs the
 * tool run. The registry row's notes say the same.
 */

const { json, isObj, event, QUIET, say, sessionText } = require('./_wire.js');

const EVENT_OF = { BeforeTool: 'pre-tool', SessionStart: 'session-start' };
const ENVELOPE = ['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'timestamp', 'tool_name'];

function parse(stdin) {
  const p = json(stdin);
  let input = p.tool_input;
  if (!isObj(input)) {
    input = {};
    for (const k of Object.keys(p)) if (!ENVELOPE.includes(k)) input[k] = p[k];
  }
  return event(EVENT_OF[p.hook_event_name], 'other', p.tool_name, input, true);
}

function emit(verdict, ev) {
  const v = verdict || {};
  if (ev && ev.event === 'session-start') {
    const text = sessionText(v);
    return text ? { stdout: '', stderr: text, exitCode: 0 } : QUIET;
  }
  if (v.deny || v.ask) return say({ decision: 'deny', reason: v.reason }, v.reason, 2);
  return QUIET;
}

module.exports = { parse, emit };
