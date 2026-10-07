'use strict';

/*
 * dialects/antigravity.js — the wire format of the `antigravity` dialect (one registry row).
 *
 * FROM THE RESEARCH CELL, and nothing else: the pre-tool event is `PreToolUse`, beside
 * `PostToolUse`, `PreInvocation`, `PostInvocation` and `Stop`; stdin is JSON in camelCase,
 * carrying `conversationId`, `workspacePaths`, `transcriptPath`, `toolCall`, `stepIdx`; a deny
 * is stdout JSON `decision: "deny"`, and `allow`, `ask`, `force_ask` and
 * `deny_unless_prior_grant` are also decisions. NO SESSION-START EVENT IS DOCUMENTED.
 *
 * EVIDENCE: `docs`. This tool was never run here.
 *
 * WHAT THE CELL DOES NOT ESTABLISH, and what this file does about each:
 *   - the payload's event-name field. parse() returns no event kind, so hook.js takes it from
 *     its --event flag, which is what the registration states anyway.
 *   - the shape of `toolCall`. It is the input, whole, and every call is opaque. The neutral
 *     fields are looked for on it and one level below it; a field spelled at both levels with
 *     different values is not picked between, and the call is then one nothing can read. A
 *     `toolCall` that is a string or a list is kept as text for the secret-file guard.
 *   - an exit-code deny. emit() prints the JSON AND exits 2, since the JSON is the documented
 *     half and exit 2 is what the other tools treat as a deny.
 *   - the key a reason travels under. `reason` is sent, and also written to stderr.
 *   - any session-start output. A report has nowhere to go but stderr; the registry row says
 *     `sessionStart: false`, so nothing should register this event for this tool.
 */

const { json, isObj, event, fieldsDeep, QUIET, say, sessionText } = require('./_wire.js');

function parse(stdin) {
  const p = json(stdin);
  const call = p.toolCall;
  return event(null, 'other', isObj(call) ? call.name : '', call, true, fieldsDeep);
}

function emit(verdict, ev) {
  const v = verdict || {};
  if (ev && ev.event === 'session-start') {
    const text = sessionText(v);
    return text ? { stdout: '', stderr: text, exitCode: 0 } : QUIET;
  }
  if (v.deny) return say({ decision: 'deny', reason: v.reason }, v.reason, 2);
  if (v.ask) return say({ decision: 'ask', reason: v.reason }, '', 0);
  return QUIET;
}

module.exports = { parse, emit };
