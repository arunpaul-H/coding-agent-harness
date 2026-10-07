'use strict';
/* AGENT HARNESS — per-tool wiring, as pure merges.
   Replaces: one hand-kept settings file that the installer copied whole, for one tool.

   The installer (bin/harness.js `init`) and the health check (`doctor`) both ask the questions
   here, so the file one writes and the file the other grades cannot be two ideas of a
   registration. Every function takes TEXT and a registry ROW and returns text or findings: the
   caller reads and writes the disk. Nothing here names a tool. A tool is a row of
   scripts/harness/tools.json; the SHAPE of its hook config is the `wiring` export of its dialect
   module, and applies only to the row whose `hookConfig` is the file that export names.

   THE THREE RULES A MERGE KEEPS.
     1. It never overwrites. An entry is ADDED to the list its event keeps, and every other key in
        the file is the user's and is returned as it was found.
     2. It is idempotent. A registration already there (the one entry, this tool's id, this
        event, in that list) is not added again, and then the TEXT COMES BACK BYTE FOR BYTE: a
        second run is not a reformat.
     3. A file that does not parse is REFUSED with the reason. Nothing is guessed about a file
        this cannot read, and the caller writes nothing.

   WHAT IS RENDERED IS `docs` EVIDENCE unless the dialect says otherwise. No tool is run here, so
   a rendered file is a file in the documented shape and never "a hook that works".

   --self-test  drive every decision with literals, including the ones that must come out NO
   Zero-dep, Node built-ins only.
   Usage: node scripts/harness/wire.js --self-test */
const path = require('node:path');

/** The one hook entry, as every registration names it. */
const HOOK_SCRIPT = 'scripts/harness/hook.js';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const pretty = (v) => JSON.stringify(v, null, 2) + '\n';

/** A shell command split the way a reader would, a quoted run kept together. */
function tokens(command) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(command))) !== null) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

/** What a command registers, or null when it does not run the hook entry at all:
 *  `{ tool, event }`, either one null when the command does not say it. The script is matched by
 *  its path TAIL, so a variable or an absolute prefix in front of it changes nothing. */
function registrationOf(command) {
  const t = tokens(command);
  const at = t.findIndex((x) => x.replace(/\\/g, '/').endsWith(HOOK_SCRIPT));
  if (at < 0) return null;
  const val = (flag) => { const i = t.indexOf(flag, at + 1); return i >= 0 && isStr(t[i + 1]) ? t[i + 1] : null; };
  return { tool: val('--tool'), event: val('--event') };
}

/** Every `command` string under a node, wherever it nests. */
function commandsIn(node) {
  const out = [];
  (function visit(n) {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!isPlain(n)) return;
    if (typeof n.command === 'string') out.push(n.command);
    for (const k of Object.keys(n)) if (k !== 'command') visit(n[k]);
  })(node);
  return out;
}

/** The dialect's wiring for THIS row, or null: none exported, or it describes another file. */
function wiringFor(row, dialect) {
  const w = dialect && dialect.wiring;
  return w && isPlain(row) && isStr(row.hookConfig) && w.file === row.hookConfig ? w : null;
}

/** Why the harness renders NO hook file for this row, as one sentence, or null when it does. */
function unwiredReason(row, dialect) {
  if (!isPlain(row)) return 'it has no registry row';
  if (!isStr(row.dialect)) return 'the registry records no wire format for it, so there is no hook the harness can wire (tier `' + row.tier + '`)';
  if (row.projectHooks !== true) return 'its hooks are registered in ' + row.hookConfig + ', and a checked-in project hook file is not established';
  if (!wiringFor(row, dialect)) return 'no shape is recorded for ' + row.hookConfig + ' (its dialect module exports no wiring for that file: the research does not establish one, or the tool\'s calls cannot be read yet), and the harness does not guess one';
  return null;
}

/** The registration a person adds by hand where the harness renders none. */
const byHand = (id, event) => 'node ' + HOOK_SCRIPT + ' --tool ' + id + ' --event ' + event;

const parseObject = (text) => {
  let v;
  try { v = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { why: 'it is not valid JSON (' + e.message + ')' }; }
  return isPlain(v) ? { value: v } : { why: 'it is not a JSON object' };
};

/** The list an entry belongs in, as `{ list }`, or `{ why }` when the path to it is taken by
 *  something that is not an object or a list. `make` creates what is missing on the way. */
function listAt(root, at, make) {
  let node = root;
  for (let i = 0; i < at.length; i += 1) {
    const k = at[i];
    const last = i === at.length - 1;
    if (node[k] === undefined) {
      if (!make) return { list: [] };
      node[k] = last ? [] : {};
    }
    if (last ? !Array.isArray(node[k]) : !isPlain(node[k])) return { why: '`' + at.slice(0, i + 1).join('.') + '` is not ' + (last ? 'a list' : 'an object') };
    node = node[k];
  }
  return { list: node };
}

const registersIn = (list, id, event) => list.some((el) => commandsIn(el).some((c) => {
  const r = registrationOf(c);
  return r && r.tool === id && r.event === event;
}));

/**
 * The hook config for one row, merged. `text` is the file as it stands, or null when there is
 * none. Returns `{ text, changed, added }`, or `{ refuse }` with the reason and nothing to write.
 */
function mergeHooks(text, row, wiring) {
  const fresh = text === null || text === undefined;
  let root;
  if (fresh) root = JSON.parse(JSON.stringify(wiring.base || {}));
  else {
    const p = parseObject(text);
    if (p.why) return { refuse: p.why };
    root = p.value;
  }
  const added = [];
  for (const e of wiring.entries(row)) {
    const where = listAt(root, e.at, true);
    if (where.why) return { refuse: where.why };
    if (registersIn(where.list, row.id, e.event)) continue;
    where.list.push(e.entry);
    added.push(e.at.join('.'));
  }
  // Nothing added to a file that exists: the bytes are the user's, and they go back untouched.
  if (!fresh && !added.length) return { text: String(text), changed: false, added: added };
  return { text: pretty(root), changed: true, added: added };
}

/**
 * What a hook config holds against what the row needs, for the health check. Each row is
 * `{ where, event, ok }`; `foreign` lists the registrations of the hook entry in this file that
 * name ANOTHER tool, which would have that tool's payloads parsed in the wrong wire format.
 */
function hookState(text, row, wiring) {
  const p = parseObject(text);
  if (p.why) return { why: p.why };
  const wanted = wiring.entries(row).map((e) => {
    const where = listAt(p.value, e.at, false);
    return { where: e.at.join('.'), event: e.event, ok: !where.why && registersIn(where.list, row.id, e.event) };
  });
  const foreign = [];
  for (const c of commandsIn(p.value)) {
    const r = registrationOf(c);
    if (r && r.tool !== row.id && !foreign.includes(String(r.tool))) foreign.push(String(r.tool));
  }
  return { wanted: wanted, foreign: foreign };
}

/* ---------- the policy pointer: a `config` row is pointed at the policy file by one setting ---------- */

const isJsonFile = (file) => /\.json$/i.test(String(file));

/** Does the setting already name the policy file? It may be one name or a list of them. */
const namesPolicy = (value, policyFile) => value === policyFile || (Array.isArray(value) && value.includes(policyFile));

/**
 * The settings file of a `config` row with the setting pointing at the policy file. A name that
 * is already there is kept and the policy file is added beside it: the setting is the user's,
 * and a pointer is one more name in it, never a replacement. Same three rules as mergeHooks.
 */
function mergePointer(text, row, policyFile) {
  const keys = String(row.policy.setting).split('.');
  const fresh = text === null || text === undefined;
  let root = {};
  if (!fresh) {
    const p = parseObject(text);
    if (p.why) return { refuse: p.why };
    root = p.value;
  }
  let node = root;
  for (const k of keys.slice(0, -1)) {
    if (node[k] === undefined) node[k] = {};
    if (!isPlain(node[k])) return { refuse: '`' + k + '` is not an object, so `' + row.policy.setting + '` cannot be set under it' };
    node = node[k];
  }
  const leaf = keys[keys.length - 1];
  const cur = node[leaf];
  if (namesPolicy(cur, policyFile)) return { text: fresh ? pretty(root) : String(text), changed: fresh };
  if (cur === undefined) node[leaf] = policyFile;
  else if (typeof cur === 'string') node[leaf] = [cur, policyFile];
  else if (Array.isArray(cur)) node[leaf] = cur.concat(policyFile);
  else return { refuse: '`' + row.policy.setting + '` holds ' + JSON.stringify(cur) + ', which is neither a file name nor a list of them' };
  return { text: pretty(root), changed: true };
}

/** Is the pointer in force in this settings text? `{ ok }`, or `{ why }` for a file that cannot say. */
function pointerState(text, row, policyFile) {
  const p = parseObject(text);
  if (p.why) return { why: p.why };
  let node = p.value;
  for (const k of String(row.policy.setting).split('.')) node = isPlain(node) ? node[k] : undefined;
  return { ok: namesPolicy(node, policyFile) };
}

/** The one line a settings file this cannot merge (it is not JSON) needs, for a person to add. */
const pointerLine = (row, policyFile) => row.policy.setting + ': ' + policyFile;

/* ---------- --self-test ---------- */
function selfTest() {
  let CHECKS = 0; const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  const cmd = (id, ev) => 'node "$ROOT_VAR/' + HOOK_SCRIPT + '" --tool ' + id + ' --event ' + ev;
  const WIRING = {
    file: '.tool-a/hooks.json',
    base: { version: 1 },
    entries: (row) => [{ at: ['hooks', 'Before'], event: 'pre-tool', entry: { matcher: 'X', run: [{ command: cmd(row.id, 'pre-tool') }] } }]
      .concat(row.sessionStart === true ? [{ at: ['hooks', 'Start'], event: 'session-start', entry: { command: cmd(row.id, 'session-start') } }] : []),
  };
  const ROW = { id: 'tool-a', dialect: 'wire-a', hookConfig: '.tool-a/hooks.json', projectHooks: true, sessionStart: true, tier: 'full' };
  const DIALECT = { wiring: WIRING };

  // What a command registers.
  eq('a registration names its tool and its event', registrationOf(cmd('tool-a', 'pre-tool')), { tool: 'tool-a', event: 'pre-tool' });
  eq('a bare relative path is the same entry', registrationOf(byHand('tool-a', 'stop')), { tool: 'tool-a', event: 'stop' });
  eq('a backslashed path is the same entry', registrationOf('node C:\\repo\\scripts\\harness\\hook.js --tool tool-a --event pre-tool'), { tool: 'tool-a', event: 'pre-tool' });
  eq('a command that runs something else registers nothing', registrationOf('node scripts/harness/guards/a.cjs --tool tool-a --event pre-tool'), null);
  eq('the entry with no flags registers no tool', registrationOf('node ' + HOOK_SCRIPT), { tool: null, event: null });
  eq('a flag BEFORE the script is not the entry\'s', registrationOf('env --tool x node ' + HOOK_SCRIPT + ' --event stop'), { tool: null, event: 'stop' });
  eq('commands are found wherever they nest', commandsIn({ a: [{ b: { command: 'x' } }, { command: 'y' }], command: 'z' }), ['z', 'x', 'y']);

  // Which row a dialect's wiring covers.
  eq('wiring applies to the row whose hook config is its file', wiringFor(ROW, DIALECT) === WIRING, true);
  eq('...and not to a row that shares the dialect and keeps its hooks elsewhere', wiringFor(Object.assign({}, ROW, { hookConfig: '.tool-b/hooks.json' }), DIALECT), null);
  eq('...nor when the dialect exports none', wiringFor(ROW, {}), null);
  eq('wired: no reason not to', unwiredReason(ROW, DIALECT), null);
  eq('unwired: no dialect', /no hook the harness can wire \(tier `backstop`\)/.test(unwiredReason({ id: 'x', dialect: null, tier: 'backstop' }, null)), true);
  eq('unwired: hooks outside the repo', /a checked-in project hook file is not established/.test(unwiredReason(Object.assign({}, ROW, { projectHooks: null }), DIALECT)), true);
  eq('unwired: a shape nobody recorded', /does not guess one/.test(unwiredReason(Object.assign({}, ROW, { hookConfig: '.tool-b/hooks.json' }), DIALECT)), true);

  // The merge. A fresh file is the base plus the entries.
  const first = mergeHooks(null, ROW, WIRING);
  eq('fresh: both entries are added', first.added, ['hooks.Before', 'hooks.Start']);
  eq('fresh: the dialect\'s base keys come first', Object.keys(JSON.parse(first.text)), ['version', 'hooks']);
  eq('fresh: it ends in one newline', /[^\n]\n$/.test(first.text), true);
  const second = mergeHooks(first.text, ROW, WIRING);
  eq('again: nothing is added', [second.changed, second.added], [false, []]);
  eq('again: THE TEXT IS BYTE FOR BYTE WHAT IT WAS', second.text === first.text, true);
  const odd = '{"hooks":{"Before":[{"run":[{"command":"' + cmd('tool-a', 'pre-tool').replace(/"/g, '\\"') + '"}]}],\n  "Start":[{"command":"' + cmd('tool-a', 'session-start').replace(/"/g, '\\"') + '"}]},   "mine": 1}';
  eq('a file in the user\'s own layout is not reformatted when nothing is missing', mergeHooks(odd, ROW, WIRING).text === odd, true);
  // The user's keys and the user's entries survive an addition.
  const theirs = pretty({ theme: 'dark', hooks: { Before: [{ matcher: 'Y', run: [{ command: 'node mine.js' }] }], After: [{ command: 'node after.js' }] } });
  const merged = JSON.parse(mergeHooks(theirs, ROW, WIRING).text);
  eq('merge: a key the harness does not know is kept', merged.theme, 'dark');
  eq('merge: the user\'s entry in the same list is kept, ours comes after it', merged.hooks.Before.map((e) => e.matcher), ['Y', 'X']);
  eq('merge: a list the harness does not use is kept', merged.hooks.After, [{ command: 'node after.js' }]);
  eq('merge: the base is NOT forced onto a file that exists', 'version' in merged, false);
  // One tool's registration is not another's, and one event's is not another's.
  const other = mergeHooks(pretty({ hooks: { Before: [{ command: cmd('tool-b', 'pre-tool') }] } }), ROW, WIRING);
  eq('another tool\'s registration in the list does not count as ours', other.added, ['hooks.Before', 'hooks.Start']);
  const wrongList = mergeHooks(pretty({ hooks: { Start: [{ command: cmd('tool-a', 'pre-tool') }] } }), ROW, WIRING);
  eq('our pre-tool command filed under session-start satisfies neither list', wrongList.added, ['hooks.Before', 'hooks.Start']);
  eq('a row with no session-start gets no session-start entry', mergeHooks(null, Object.assign({}, ROW, { sessionStart: false }), WIRING).added, ['hooks.Before']);
  // Refusals: the reason, and nothing to write.
  eq('a file that does not parse is refused', Object.keys(mergeHooks('{ "hooks": ', ROW, WIRING)), ['refuse']);
  eq('...and JSON that is not an object', mergeHooks('[]', ROW, WIRING).refuse, 'it is not a JSON object');
  eq('...and a list where an object belongs', mergeHooks('{"hooks":[]}', ROW, WIRING).refuse, '`hooks` is not an object');
  eq('...and an object where the list belongs', mergeHooks('{"hooks":{"Before":{}}}', ROW, WIRING).refuse, '`hooks.Before` is not a list');
  eq('an EMPTY file is not an empty config: it does not parse', Object.keys(mergeHooks('', ROW, WIRING)), ['refuse']);

  // The health check reads the same registrations the merge writes.
  eq('state: a merged file has everything', hookState(first.text, ROW, WIRING), { wanted: [{ where: 'hooks.Before', event: 'pre-tool', ok: true }, { where: 'hooks.Start', event: 'session-start', ok: true }], foreign: [] });
  eq('state: an empty object has nothing', hookState('{}', ROW, WIRING).wanted.map((w) => w.ok), [false, false]);
  eq('state: a registration under another tool\'s id is named', hookState(other.text, ROW, WIRING).foreign, ['tool-b']);
  eq('state: a registration with no id is foreign too', hookState(pretty({ x: [{ command: 'node ' + HOOK_SCRIPT + ' --event stop' }] }), ROW, WIRING).foreign, ['null']);
  eq('state: a file that does not parse says why', Object.keys(hookState('nope', ROW, WIRING)), ['why']);

  // The policy pointer.
  const CFG = { id: 'tool-c', policy: { mode: 'config', file: '.tool-c/settings.json', setting: 'context.file' } };
  const made = mergePointer(null, CFG, 'POLICY.md');
  eq('pointer: a fresh settings file holds the one setting', JSON.parse(made.text), { context: { file: 'POLICY.md' } });
  eq('pointer: again is byte for byte', [mergePointer(made.text, CFG, 'POLICY.md').changed, mergePointer(made.text, CFG, 'POLICY.md').text === made.text], [false, true]);
  eq('pointer: a name already there is kept, the policy file added beside it',
    JSON.parse(mergePointer('{"context":{"file":"OWN.md"},"x":1}', CFG, 'POLICY.md').text), { context: { file: ['OWN.md', 'POLICY.md'] }, x: 1 });
  eq('pointer: a list gains one name', JSON.parse(mergePointer('{"context":{"file":["A.md"]}}', CFG, 'POLICY.md').text).context.file, ['A.md', 'POLICY.md']);
  eq('pointer: a list that already has it is left alone', mergePointer('{"context":{"file":["A.md","POLICY.md"]}}', CFG, 'POLICY.md').changed, false);
  eq('pointer: a setting of another type is refused', Object.keys(mergePointer('{"context":{"file":7}}', CFG, 'POLICY.md')), ['refuse']);
  eq('pointer: a parent that is not an object is refused', Object.keys(mergePointer('{"context":"x"}', CFG, 'POLICY.md')), ['refuse']);
  eq('pointer: a file that does not parse is refused', Object.keys(mergePointer('// a comment\n{}', CFG, 'POLICY.md')), ['refuse']);
  eq('pointer state: in force', pointerState(made.text, CFG, 'POLICY.md'), { ok: true });
  eq('pointer state: not there', pointerState('{"context":{}}', CFG, 'POLICY.md'), { ok: false });
  eq('pointer state: another name only', pointerState('{"context":{"file":"OWN.md"}}', CFG, 'POLICY.md'), { ok: false });
  eq('pointer line: what a person types into a file this cannot merge', pointerLine({ policy: { setting: 'read' } }, 'POLICY.md'), 'read: POLICY.md');
  eq('json: by extension', [isJsonFile('.a/settings.json'), isJsonFile('.a.conf.yml')], [true, false]);

  // The shipped dialects: each wiring renders a file its own state check calls complete, and
  // every command in it is a registration of the one entry under the row's id.
  const fs = require('node:fs');
  const dir = path.join(__dirname, 'dialects');
  let shipped = 0;
  for (const name of fs.readdirSync(dir).filter((n) => /^[a-z].*\.js$/.test(n)).sort()) {
    const d = require(path.join(dir, name));
    if (!d.wiring) continue;
    shipped += 1;
    const row = { id: 'tool-x', hookConfig: d.wiring.file, projectHooks: true, sessionStart: true, dialect: name.replace(/\.js$/, ''), tier: 'full' };
    const out = mergeHooks(null, row, d.wiring);
    eq(name + ': a fresh render is complete by its own state check', hookState(out.text, row, d.wiring).wanted.every((w) => w.ok), true);
    eq(name + ': every command it writes registers the entry under the row\'s id',
      commandsIn(JSON.parse(out.text)).map((c) => (registrationOf(c) || {}).tool), commandsIn(JSON.parse(out.text)).map(() => 'tool-x'));
    eq(name + ': a second render changes nothing', mergeHooks(out.text, row, d.wiring).changed, false);
    eq(name + ': it names its gaps as a list', Array.isArray(d.wiring.gaps), true);
  }
  eq('at least one shipped dialect has a wiring', shipped > 0, true);

  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — wire.js self-test (' + CHECKS + ' checks)');
}

module.exports = { HOOK_SCRIPT, registrationOf, commandsIn, wiringFor, unwiredReason, byHand, mergeHooks, hookState,
  mergePointer, pointerState, pointerLine, isJsonFile };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--self-test') {
    console.error('usage: node scripts/harness/wire.js --self-test');
    process.exit(2);
  }
  selfTest();
}
