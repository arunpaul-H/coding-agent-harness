'use strict';

/*
 * dialects/cursor.js — the wire format of the `cursor` dialect (one registry row: Cursor).
 *
 * FROM THE RESEARCH CELL, and nothing else: four pre-tool events, `preToolUse`,
 * `beforeShellExecution`, `beforeMCPExecution` and `beforeReadFile`, and a `sessionStart`; stdin
 * is JSON carrying `conversation_id`, `hook_event_name`, `workspace_roots`, `cursor_version`,
 * "plus event fields"; a deny is stdout `{"permission":"deny"}` or exit 2, and any other
 * non-zero exit FAILS OPEN unless the registration says `failClosed: true`.
 *
 * EVIDENCE: `docs`. This tool was never run here.
 *
 * Here the EVENT NAME carries the action, which is the one mapping the cell does give:
 * a shell execution is a shell call and a file read is a read. The general pre-tool event and
 * the MCP one say nothing about shape, so both are opaque.
 *
 * WHAT THAT ADDS UP TO, with no ask spelling (below): AS WRITTEN, EVERY `preToolUse` AND
 * `beforeMCPExecution` CALL THAT NO GUARD CAN READ IS REFUSED with exit 2. That is every such
 * call not spelling `command`, or a path plus `content`, AT THE TOP LEVEL of the payload; a
 * call that nests its arguments under a key is one of them. Nobody is asked. Registering those
 * two events as this file stands blocks ordinary work; `beforeShellExecution` and
 * `beforeReadFile` are the two that can be registered. The registry row's notes say the same.
 *
 * WHAT THE CELL DOES NOT ESTABLISH, and what this file does about each:
 *   - the names of the "event fields". The input is the payload minus its envelope, and the
 *     neutral fields are read from it by the spellings the guards have always used. A shell
 *     event that does not spell `command` is marked opaque, so it is asked about, not waved on.
 *   - where a deny's reason goes in the JSON. It goes to stderr, with exit 2.
 *   - an `ask` spelling. An ask is emitted as a deny.
 *   - the session-start output shape. The report goes to stderr and the exit is 0.
 */

const { json, event, needsField, QUIET, say, sessionText } = require('./_wire.js');

const EVENT_OF = {
  preToolUse: 'pre-tool', beforeShellExecution: 'pre-tool', beforeMCPExecution: 'pre-tool', beforeReadFile: 'pre-tool',
  sessionStart: 'session-start',
};
const ACTION_OF = { beforeShellExecution: 'shell', beforeReadFile: 'read' };
const ENVELOPE = ['conversation_id', 'hook_event_name', 'workspace_roots', 'cursor_version'];

function parse(stdin) {
  const p = json(stdin);
  const name = typeof p.hook_event_name === 'string' ? p.hook_event_name : '';
  const input = {};
  for (const k of Object.keys(p)) if (!ENVELOPE.includes(k)) input[k] = p[k];
  const action = ACTION_OF[name] || 'other';
  const e = event(EVENT_OF[name], action, typeof p.tool_name === 'string' ? p.tool_name : name, input, action === 'other');
  // A shell event with no `command` that is a string: not vouched for (see _wire.js).
  if (needsField(action, e)) e.opaque = true;
  return e;
}

function emit(verdict, ev) {
  const v = verdict || {};
  if (ev && ev.event === 'session-start') {
    const text = sessionText(v);
    return text ? { stdout: '', stderr: text, exitCode: 0 } : QUIET;
  }
  if (v.deny || v.ask) return say({ permission: 'deny' }, v.reason, 2);
  return QUIET;
}

module.exports = { parse, emit };
