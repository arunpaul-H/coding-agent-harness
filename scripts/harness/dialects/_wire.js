'use strict';

/*
 * _wire.js — what the dialect modules share. Not a dialect: the registry never names it.
 *
 * THE NEUTRAL EVENT every dialect's parse() returns, and every guard's decide() reads:
 *
 *   event    'pre-tool' | 'session-start' | 'prompt-submit' | 'stop', or null when the payload
 *            does not say (hook.js then takes it from its --event flag, which is authoritative)
 *   action   'shell' | 'read' | 'search' | 'write' | 'spawn' | 'other'
 *   spawn    OPTIONAL, a `spawn` call only: `{ agent, prompt }`, the subagent's type and the
 *            text it is handed, each a string or null. A dialect sets it after event(); only
 *            the spawn guard reads it
 *   command  the shell text, or null. A STRING or nothing: a `command` spelled as a list or an
 *            object is not text a guard can judge, so it is null and the call is not readable
 *   path     the file the call targets, or null
 *   content  the text a write puts there, or null
 *   old      the text an in-place edit replaces, or null
 *   tool     the tool's OWN name for the call. A label for a message, never a thing to branch on
 *   input    the call's whole input object, undecoded. Two guards need it and neither reads a
 *            field name out of it: the secret-file guard matches every string it carries as
 *            text, and the phase guard names its KEYS when it has to ask. An input that arrived
 *            as a string or a list is KEPT, under the one key `value`, so the text guard still
 *            reads it; it is never replaced by an empty object
 *   cwd      OPTIONAL: the directory the tool's shell is standing in, where the envelope names
 *            one. A dialect sets it after event(); absent or null, a relative path is read from
 *            the repo root. Only the phase guard reads it
 *   forced   OPTIONAL, stop only: true when this stop follows a turn a stop hook forced, where
 *            the tool's payload says so. A dialect sets it after event(); absent, a handler
 *            reads every stop as a first one
 *   opaque   true when the dialect cannot vouch for the input's shape: a server-defined tool, a
 *            tool name the dialect has no row for, an input that is not an object, or a known
 *            action whose needed field is absent (a shell call with no string `command`, a write
 *            with no path or no content: needsField() below, which every dialect that maps a
 *            name to shell or write applies). An opaque call is offered to every guard, and a
 *            guard that can read nothing in it ASKS. False only for a call the dialect mapped by
 *            name AND whose needed fields are there
 *
 * THE NEUTRAL VERDICT every decide() returns, and every dialect's emit() spells:
 *
 *   { deny: boolean, reason: string }      the whole contract; `{ deny: false, reason: '' }` allows
 *   ask: true        with deny false: a human decides. A dialect with no spelling for it denies
 *   message          one line for the person at the keyboard, where the dialect has a place for it.
 *                    At `stop` a verdict that does not deny may carry one: the turn ends and
 *                    the person is told. A deny at `stop` is a forced turn, not a refusal
 *   context          session-start only: text for the model's context
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** stdin as an object. Throws, and the message never quotes the payload: a reason outlives
 *  the call, and an unreadable payload may be unreadable because of what is in it. */
function json(stdin) {
  const raw = String(stdin == null ? '' : stdin);
  if (!raw.trim()) throw new Error('the payload is empty');
  let p;
  try { p = JSON.parse(raw); } catch { throw new Error('the payload is not JSON'); }
  if (!isObj(p)) throw new Error('the payload is JSON but not an object');
  return p;
}

/**
 * The four neutral fields, read off an input object by the spellings the guards have always
 * decided from. A tool that spells them some other way yields nulls here, and that is the
 * point: null is "nothing could look", which the phase guard turns into an ask, where a
 * guessed synonym would turn it into a silent allow of whatever the guess missed.
 */
function fields(input) {
  const i = isObj(input) ? input : {};
  const hasPath = i.file_path != null || i.path != null;
  return {
    command: typeof i.command === 'string' ? i.command : null,
    path: hasPath ? (i.file_path || i.path || '') : null,
    content: i.content != null ? String(i.content) : (i.new_string != null ? String(i.new_string) : null),
    old: i.old_string != null ? i.old_string : null,
  };
}

/** fields(), then one level down: for a wire format that nests the arguments under a key the
 *  evidence does not name. A field spelled once, at either level, is that field. A field
 *  spelled at two places with DIFFERENT values is nobody's to pick: which one the tool will act
 *  on is not known, and judging the harmless one allows the other. Then nothing is vouched for,
 *  all four come back null, and the call is one the guards cannot read (an ask). */
function fieldsDeep(input) {
  const out = fields(input);
  if (!isObj(input)) return out;
  for (const k of Object.keys(input)) {
    if (!isObj(input[k])) continue;
    const inner = fields(input[k]);
    for (const f of Object.keys(out)) {
      if (inner[f] == null) continue;
      if (out[f] == null) out[f] = inner[f];
      else if (out[f] !== inner[f]) return { command: null, path: null, content: null, old: null };
    }
  }
  return out;
}

/** True when a call mapped to `shell` or `write` lacks the field that action is decided from.
 *  The dialect then marks it opaque: a shell call with no command is not a clean shell call. */
const needsField = (action, e) => (action === 'shell' && e.command == null)
  || (action === 'write' && (e.path == null || e.content == null));

function event(kind, action, tool, input, opaque, read) {
  // Present and not an object: kept for the text guard, and never vouched for.
  const odd = input != null && !isObj(input);
  const f = (read || fields)(input);
  return {
    event: kind || null,
    action,
    command: f.command,
    path: f.path,
    content: f.content,
    old: f.old,
    tool: typeof tool === 'string' ? tool : '',
    input: isObj(input) ? input : (odd ? { value: input } : {}),
    opaque: opaque === true || odd,
  };
}

const QUIET = Object.freeze({ stdout: '', stderr: '', exitCode: 0 });
const say = (obj, stderr, exitCode) => ({ stdout: obj == null ? '' : JSON.stringify(obj), stderr: stderr || '', exitCode });
/** What a verdict has to say at session start, whichever field it arrived in. */
const sessionText = (v) => String((v && (v.context || ((v.deny || v.ask) ? v.reason : ''))) || '');

module.exports = { isObj, json, fields, fieldsDeep, needsField, event, QUIET, say, sessionText };
