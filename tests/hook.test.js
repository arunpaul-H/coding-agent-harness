'use strict';
/* ============================================================
   hook.test.js — the one hook entry and the dialect modules, driven as the runtime drives them.

   Two halves, and they prove different things.

   THE DIALECTS, from fixtures. Each fixture payload is built from the PROTOCOL CELL of that
   tool's row in docs/archive/multi-tool/research/2026-10-05-tool-instruction-surfaces.md: the
   event names, the stdin field names and the deny spelling written there, and nothing that is
   not. Those cells were read off vendor pages and no tool but one was ever run, so what these
   fixtures pin is that the module does what the CELL says. They do not pin that the tool does.
   The registry rows stay `docs` evidence but the one that was run, and one test below holds them to that.

   THE ENTRY, as a process. scripts/harness/hook.js is started with a payload on stdin in a
   throwaway root, and its stdout and EXIT CODE are read back. A deny is both. The equivalence
   block then drives the same payloads through the three guards run directly, the way they were
   registered before the entry existed, and asserts the entry reaches the same decision with
   the same reason: one process in place of three is a change of plumbing, never of verdict.

   NO GUARDED FILENAME IS SPELLED IN THIS FILE (see tests/guards.test.js): it is assembled.

   Run:  node --test "tests/hook.test.js"
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
const node = process.execPath;
const HOOK = path.join(REPO, 'scripts', 'harness', 'hook.js');
const guard = (f) => path.join(REPO, 'scripts', 'harness', 'guards', f);
const dialect = (name) => require(path.join(REPO, 'scripts', 'harness', 'dialects', name + '.js'));
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'harness', 'tools.json'), 'utf8'));

const DOTENV = '.' + 'env';
const ARCHIVE = 'docs/' + 'archive';

/* ---------- the fixture ---------- */

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.BRANCH_SYNC_REF;
  return Object.assign(env, extra || {});
}
function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}
function mkRoot(tag, overrides) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hook-' + tag + '-')));
  made.push(dir);
  if (overrides !== null) {
    put(dir, 'harness.config.json', JSON.stringify(Object.assign({
      project: { name: 'fixture' },
      gates: [{ name: 'hygiene', command: 'node scripts/harness/guards/commit-hygiene.cjs --report' }],
      commitHygiene: { workDirs: ['scripts', 'tests', 'docs', '.claude'], rootAllow: ['README.md', 'harness.config.json', '.gitignore'] },
    }, overrides || {}), null, 2) + '\n');
  }
  return dir;
}
function gitIn(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' failed: ' + r.stdout + r.stderr);
}
function spawn(root, script, args, stdin, extraEnv) {
  return spawnSync(node, [script].concat(args || []), {
    cwd: root, encoding: 'utf8', input: stdin === undefined ? '' : stdin, env: cleanEnv(Object.assign({ CLAUDE_PROJECT_DIR: root }, extraEnv || {})),
  });
}
/** The entry, as a process. */
const entry = (root, tool, event, stdin) => spawn(root, HOOK, ['--tool', tool, '--event', event], stdin);
const claudePayload = (tool, input) => JSON.stringify({
  session_id: 'test', cwd: '/repo', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 'u1',
});
const DEFAULT_TOOL = 'claude-code';
const rowOf = (id) => REGISTRY.tools.find((r) => r.id === id);
const wire = () => require(path.join(REPO, 'scripts', 'harness', 'dialects', '_wire.js'));

/* ============================================================ */

describe('the dialect modules — fixtures built from the research file\'s protocol cells', () => {
  const deny = { deny: true, reason: 'because', message: 'short' };
  const ask = { deny: false, ask: true, reason: 'sure?', message: 'short' };
  const allow = { deny: false, reason: '' };
  const pre = { event: 'pre-tool' };
  const start = { event: 'session-start' };

  test('every dialect the registry lists is a module exporting parse() and emit()', () => {
    assert.deepStrictEqual(REGISTRY.dialects.slice().sort(), ['antigravity', 'claude', 'cursor', 'gemini']);
    for (const name of REGISTRY.dialects) {
      const d = dialect(name);
      assert.strictEqual(typeof d.parse, 'function', name + ' exports no parse()');
      assert.strictEqual(typeof d.emit, 'function', name + ' exports no emit()');
    }
  });

  test('every dialect: an allow is silence and exit 0, and a deny is JSON on stdout AND exit 2', () => {
    for (const name of REGISTRY.dialects) {
      const d = dialect(name);
      assert.deepStrictEqual(d.emit(allow, pre), { stdout: '', stderr: '', exitCode: 0 }, name + ' said something about an allow');
      const out = d.emit(deny, pre);
      assert.strictEqual(out.exitCode, 2, name + ' denies with exit ' + out.exitCode);
      assert.doesNotThrow(() => JSON.parse(out.stdout), name + ' denies with no JSON on stdout');
      assert.strictEqual(out.stderr, 'because', name + ' drops the reason from stderr, which is where an exit-2 deny carries it');
    }
  });

  test('every dialect: a payload that is not a JSON object throws, and the message never quotes it', () => {
    for (const name of REGISTRY.dialects) {
      const d = dialect(name);
      for (const junk of ['', '   ', '}{ HIDDENVALUE', '{"tool_name":', '[1,2]', '"HIDDENVALUE"', 'null']) {
        assert.throws(() => d.parse(junk), (e) => !String(e.message).includes('HIDDENVALUE'), name + ' on ' + JSON.stringify(junk));
      }
    }
  });

  test('every dialect: session start never refuses, whatever the verdict', () => {
    for (const name of REGISTRY.dialects) {
      const d = dialect(name);
      assert.deepStrictEqual(d.emit(allow, start), { stdout: '', stderr: '', exitCode: 0 });
      for (const v of [{ deny: false, reason: '', context: 'a report' }, { deny: true, reason: 'a report' }]) {
        const out = d.emit(v, start);
        assert.strictEqual(out.exitCode, 0, name + ' stops a session start');
        assert.ok((out.stdout + out.stderr).includes('a report'), name + ' drops the session-start report');
      }
    }
  });

  describe('claude — three registry rows share it', () => {
    const d = dialect('claude');

    test('the rows the registry maps to it', () => {
      assert.deepStrictEqual(REGISTRY.tools.filter((r) => r.dialect === 'claude').map((r) => r.id).sort(), ['claude-code', 'codex-cli', 'kimi-code']);
    });

    test('parse: the cell\'s stdin fields, and the tool name mapped to a neutral action', () => {
      const shell = d.parse(claudePayload('Bash', { command: 'npm test' }));
      assert.deepStrictEqual([shell.event, shell.action, shell.command, shell.opaque, shell.tool], ['pre-tool', 'shell', 'npm test', false, 'Bash']);
      const edit = d.parse(claudePayload('Edit', { file_path: 'a.md', old_string: 'x', new_string: 'y' }));
      assert.deepStrictEqual([edit.action, edit.path, edit.content, edit.old, edit.opaque], ['write', 'a.md', 'y', 'x', false]);
      const write = d.parse(claudePayload('Write', { file_path: 'a.md', content: 'body' }));
      assert.deepStrictEqual([write.action, write.path, write.content], ['write', 'a.md', 'body']);
      assert.strictEqual(d.parse(claudePayload('Read', { file_path: 'a.md' })).action, 'read');
      for (const t of ['Grep', 'Glob']) assert.strictEqual(d.parse(claudePayload(t, { pattern: 'x' })).action, 'search');
      assert.strictEqual(d.parse(claudePayload('PowerShell', { command: 'ls' })).action, 'shell');
    });

    test('parse: a tool name with no row is OPAQUE, never a harmless other', () => {
      // A server-defined tool, and a tool added after the table was written, alike.
      for (const t of ['mcp__fs__write_file', 'apply_patch', 'SomeLaterTool', '']) {
        const e = d.parse(claudePayload(t, { anything: 1 }));
        assert.deepStrictEqual([e.action, e.opaque], ['other', true], t + ' was vouched for');
        assert.deepStrictEqual(e.input, { anything: 1 }, 'the input must reach the guards whole');
      }
    });

    test('parse: an input that is not an object is KEPT as text and never vouched for', () => {
      // Dropped, it would reach the secret-file guard as an empty object and be allowed.
      for (const odd of ['cat somewhere', ['cat', 'somewhere'], 7]) {
        for (const t of ['Bash', 'Read', 'Write']) {
          const e = d.parse(claudePayload(t, odd));
          assert.strictEqual(e.opaque, true, t + ' with a ' + typeof odd + ' input was vouched for');
          assert.deepStrictEqual(e.input.tool_input, odd, 'the input was dropped on the way to the guards');
          assert.strictEqual(e.command, null);
        }
      }
    });

    test('parse: a mapped tool whose needed field is absent is opaque, so it is asked about', () => {
      for (const [t, input] of [
        ['Bash', {}],
        ['Bash', { cmd: 'npm test' }],
        ['PowerShell', { command: ['git', 'push'] }],
        ['Write', { filePath: 'a.md', content: 'x' }],
        ['Write', { file_path: 'a.md', contents: 'x' }],
        ['Edit', { file_path: 'a.md', old_string: 'x' }],
      ]) {
        const e = d.parse(claudePayload(t, input));
        assert.strictEqual(e.opaque, true, t + ' ' + JSON.stringify(input) + ' was vouched for');
        assert.notStrictEqual(e.action, 'other', 'the action the name maps to is kept');
      }
      // A read and a search are decided from the text of the whole input, so neither needs a field.
      assert.strictEqual(d.parse(claudePayload('Read', {})).opaque, false);
      assert.strictEqual(d.parse(claudePayload('Glob', {})).opaque, false);
      // An edit that writes the empty string has its content: '' is a value, not an absence.
      assert.strictEqual(d.parse(claudePayload('Edit', { file_path: 'a.md', old_string: 'x', new_string: '' })).opaque, false);
    });

    test('parse: a payload built from the THIRD cell, which names no tool_name and no tool_input', () => {
      // Kimi Code's cell: hook_event_name, session_id, session_title, client_type, cwd, "plus
      // event fields". Where those fields sit is not established, so they are put at the top
      // level here, the one place the cell's wording allows without inventing a key.
      const e = d.parse(JSON.stringify({
        hook_event_name: 'PreToolUse', session_id: 's', session_title: 't', client_type: 'cli', cwd: '/repo',
        command: 'npm test', target: 'somewhere',
      }));
      assert.deepStrictEqual([e.event, e.action, e.opaque, e.command], ['pre-tool', 'other', true, 'npm test']);
      assert.deepStrictEqual(e.input, { command: 'npm test', target: 'somewhere' }, 'the event fields must reach the guards, and the envelope must not');
    });

    test('parse: the other three events', () => {
      const kind = (name) => d.parse(JSON.stringify({ hook_event_name: name, session_id: 's' })).event;
      assert.deepStrictEqual(['SessionStart', 'UserPromptSubmit', 'Stop'].map(kind), ['session-start', 'prompt-submit', 'stop']);
      assert.strictEqual(kind('PostToolUse'), null, 'an event the harness has no handlers for must not pass for one it has');
    });

    test('emit: the deny is the cell\'s permissionDecision JSON, and an ask is an ask for ONE row only', () => {
      const out = d.emit(deny, pre);
      assert.deepStrictEqual(JSON.parse(out.stdout), {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'because' },
        systemMessage: 'short',
      });
      const asked = d.emit(ask, pre, rowOf(DEFAULT_TOOL));
      assert.strictEqual(asked.exitCode, 0, 'an ask is not a refusal');
      assert.strictEqual(JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision, 'ask');
      // No cell names an ask spelling. It is kept for the one row it was ever run against; for
      // the two that share the wire format, and for a call with no row at all, an ask refuses.
      for (const row of [rowOf('codex-cli'), rowOf('kimi-code'), undefined]) {
        const refused = d.emit(ask, pre, row);
        assert.strictEqual(refused.exitCode, 2, 'an ask with no established spelling was passed for ' + (row ? row.id : 'no row'));
        assert.strictEqual(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, 'deny');
        assert.strictEqual(refused.stderr, 'sure?');
      }
    });

    test('emit: session start is additionalContext, and a stop or prompt deny is exit 2 with the reason', () => {
      const out = d.emit({ deny: false, reason: '', context: 'report', message: 'm' }, start);
      assert.deepStrictEqual(JSON.parse(out.stdout), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'report' }, systemMessage: 'm' });
      for (const kind of ['prompt-submit', 'stop']) {
        assert.deepStrictEqual(d.emit(deny, { event: kind }), { stdout: '', stderr: 'because', exitCode: 2 });
        assert.strictEqual(d.emit(ask, { event: kind }).exitCode, 2, 'an ask with no spelling must not become an allow');
        assert.deepStrictEqual(d.emit(allow, { event: kind }), { stdout: '', stderr: '', exitCode: 0 });
      }
    });

    test('the deny layer it names is the file the default tool registers its hooks in', () => {
      const row = REGISTRY.tools.find((r) => r.id === DEFAULT_TOOL);
      assert.strictEqual(d.permissions.file, row.hookConfig);
      assert.deepStrictEqual(d.permissions.read('{"permissions":{"deny":["a"]}}'), ['a']);
      assert.strictEqual(d.permissions.read('{}'), undefined);
      assert.throws(() => d.permissions.read('not json'));
    });
  });

  describe('gemini', () => {
    const d = dialect('gemini');
    const payload = (extra) => JSON.stringify(Object.assign({
      session_id: 's', transcript_path: '/t', cwd: '/repo', hook_event_name: 'BeforeTool', timestamp: '2026-10-05T00:00:00Z',
    }, extra));

    test('parse: BeforeTool is the pre-tool event, and every call is opaque', () => {
      const e = d.parse(payload({ tool_name: 'some_tool', tool_input: { command: 'npm test' } }));
      assert.deepStrictEqual([e.event, e.action, e.opaque, e.command, e.tool], ['pre-tool', 'other', true, 'npm test', 'some_tool']);
      assert.strictEqual(d.parse(payload({ hook_event_name: 'SessionStart' })).event, 'session-start');
    });

    test('parse: where the cell names no tool fields, the payload minus its envelope is the input', () => {
      const e = d.parse(payload({ whatever: { target: 'x' }, flag: true }));
      assert.deepStrictEqual(e.input, { whatever: { target: 'x' }, flag: true });
      assert.ok(!('session_id' in e.input) && !('cwd' in e.input), 'the envelope leaked into the input');
    });

    test('emit: the cell\'s `decision: "deny"` with `reason`, and an ask is a deny', () => {
      assert.deepStrictEqual(JSON.parse(d.emit(deny, pre).stdout), { decision: 'deny', reason: 'because' });
      const asked = d.emit(ask, pre);
      assert.deepStrictEqual([JSON.parse(asked.stdout).decision, asked.exitCode], ['deny', 2], 'no ask spelling is established, so it must refuse');
    });
  });

  describe('cursor', () => {
    const d = dialect('cursor');
    const payload = (event, extra) => JSON.stringify(Object.assign({
      conversation_id: 'c', hook_event_name: event, workspace_roots: ['/repo'], cursor_version: '1',
    }, extra));

    test('parse: the four pre-tool events of the cell, and the event name carries the action', () => {
      for (const name of ['preToolUse', 'beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile']) {
        assert.strictEqual(d.parse(payload(name, {})).event, 'pre-tool', name);
      }
      const shell = d.parse(payload('beforeShellExecution', { command: 'npm test' }));
      assert.deepStrictEqual([shell.action, shell.command, shell.opaque], ['shell', 'npm test', false]);
      const read = d.parse(payload('beforeReadFile', { file_path: 'a.md' }));
      assert.deepStrictEqual([read.action, read.path, read.opaque], ['read', 'a.md', false]);
      assert.strictEqual(d.parse(payload('sessionStart', {})).event, 'session-start');
    });

    test('parse: the general and the MCP event say nothing about shape, so both are opaque', () => {
      for (const name of ['preToolUse', 'beforeMCPExecution']) {
        const e = d.parse(payload(name, { tool_name: 'x', args: { q: 1 } }));
        assert.deepStrictEqual([e.action, e.opaque], ['other', true], name);
      }
      // A shell event that does not spell the one field a guard reads is asked about, not waved on.
      assert.strictEqual(d.parse(payload('beforeShellExecution', { cmd: 'npm test' })).opaque, true);
    });

    test('emit: the cell\'s `{"permission":"deny"}`, and an ask is a deny', () => {
      assert.deepStrictEqual(JSON.parse(d.emit(deny, pre).stdout), { permission: 'deny' });
      assert.deepStrictEqual([JSON.parse(d.emit(ask, pre).stdout).permission, d.emit(ask, pre).exitCode], ['deny', 2]);
    });
  });

  describe('antigravity', () => {
    const d = dialect('antigravity');
    const payload = (toolCall) => JSON.stringify({ conversationId: 'c', workspacePaths: ['/repo'], transcriptPath: '/t', toolCall, stepIdx: 3 });

    test('parse: `toolCall` is the input, every call is opaque, and the event comes from the flag', () => {
      const e = d.parse(payload({ name: 'run', args: { command: 'npm test' } }));
      assert.deepStrictEqual([e.event, e.action, e.opaque, e.tool], [null, 'other', true, 'run']);
      assert.strictEqual(e.command, 'npm test', 'a field one level under toolCall was not found');
      assert.strictEqual(d.parse(payload({ name: 'run', command: 'ls' })).command, 'ls');
      assert.deepStrictEqual(d.parse(payload(undefined)).input, {}, 'a payload with no toolCall must still parse, as a call nothing can read');
    });

    test('parse: a field spelled at two levels with different values is not picked between', () => {
      const one = d.parse(payload({ name: 'run', args: { command: 'git push' } }));
      assert.strictEqual(one.command, 'git push');
      // The outer one is harmless and the inner one is not: judging either alone is a guess.
      const two = d.parse(payload({ name: 'run', command: 'npm test', args: { command: 'git push' } }));
      assert.deepStrictEqual([two.command, two.path, two.content, two.opaque], [null, null, null, true]);
      assert.strictEqual(d.parse(payload({ name: 'run', command: 'ls', args: { command: 'ls' } })).command, 'ls', 'the same value twice is not a conflict');
      const inner = d.parse(payload({ name: 'run', a: { command: 'npm test' }, b: { command: 'git push' } }));
      assert.strictEqual(inner.command, null, 'two nested spellings that disagree were picked between');
    });

    test('parse: a command that is not a string is no command, and a toolCall that is not an object is kept as text', () => {
      const argv = d.parse(payload({ name: 'run', args: { command: ['git', 'push'] } }));
      assert.strictEqual(argv.command, null, 'a list was passed off as shell text, which no guard can read');
      const text = d.parse(payload('cat somewhere'));
      assert.deepStrictEqual([text.input, text.opaque, text.tool], [{ value: 'cat somewhere' }, true, '']);
    });

    test('emit: the cell\'s `decision`, with both the deny and the ask it documents', () => {
      assert.deepStrictEqual(JSON.parse(d.emit(deny, pre).stdout), { decision: 'deny', reason: 'because' });
      const asked = d.emit(ask, pre);
      assert.deepStrictEqual([JSON.parse(asked.stdout).decision, asked.exitCode], ['ask', 0]);
    });

    test('the registry says this tool has no session-start event', () => {
      assert.strictEqual(REGISTRY.tools.find((r) => r.dialect === 'antigravity').sessionStart, false);
    });
  });

  test('the shared reader: a command is a string or it is nothing, and an odd input is kept and opaque', () => {
    const w = wire();
    assert.strictEqual(w.fields({ command: 'ls' }).command, 'ls');
    for (const notText of [['git', 'push'], { run: 'git push' }, 7, true]) assert.strictEqual(w.fields({ command: notText }).command, null);
    assert.deepStrictEqual(w.event('pre-tool', 'shell', 't', ['a'], false).input, { value: ['a'] });
    assert.strictEqual(w.event('pre-tool', 'shell', 't', ['a'], false).opaque, true);
    assert.deepStrictEqual([w.event('pre-tool', 'read', 't', undefined, false).input, w.event('pre-tool', 'read', 't', undefined, false).opaque], [{}, false]);
    assert.deepStrictEqual([w.needsField('shell', { command: null }), w.needsField('shell', { command: 'x' }), w.needsField('write', { path: 'a', content: null }), w.needsField('write', { path: 'a', content: '' }), w.needsField('read', {})], [true, false, true, false, false]);
  });

  test('a registry row whose dialect refuses what it cannot read says so in its notes', () => {
    // The gemini and cursor headers say it; the row is what a person choosing a tool reads.
    assert.match(rowOf('gemini-cli').notes, /NOT USABLE AS WRITTEN/);
    assert.match(rowOf('cursor').notes, /PARTLY USABLE AS WRITTEN/);
    for (const id of ['codex-cli', 'kimi-code']) assert.match(rowOf(id).notes, /emits an ask as a deny/, id);
  });

  test('a row wired to a dialect is `docs` evidence unless it records the command it was run with: these fixtures test the cell, not the tool', () => {
    // Invariant 6. Promoting a row is running the tool and recording the command, and a fixture
    // built from a paraphrased vendor page is not that. One row was run; no fixture here did it.
    for (const row of REGISTRY.tools.filter((r) => r.dialect)) {
      if (row.evidence === 'ran') { assert.ok(String(row.command || '').trim(), row.id + ' is `ran` with no command'); continue; }
      assert.strictEqual(row.evidence, 'docs', row.id + ' is neither `docs` nor `ran`');
    }
    assert.deepStrictEqual(REGISTRY.tools.filter((r) => r.evidence === 'ran').map((r) => r.id), ['claude-code'], 'if another tool was really run, record the command and update this test');
  });
});

/* ============================================================ */

describe('hook.js — the one entry, as a process', () => {
  test('--self-test passes and carries a count', () => {
    const r = spawnSync(node, [HOOK, '--self-test'], { cwd: REPO, encoding: 'utf8', input: '', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const m = r.stdout.match(/^PASS.*\((\d+) checks\)/m);
    assert.ok(m, 'the PASS line carries no count: ' + r.stdout);
    assert.ok(Number(m[1]) >= 70, 'hook.js dropped to ' + m[1] + ' checks');
  });

  test('a deny is the dialect\'s JSON on stdout AND exit code 2', () => {
    const root = mkRoot('deny');
    const r = entry(root, DEFAULT_TOOL, 'pre-tool', claudePayload('Bash', { command: 'cat ' + DOTENV }));
    assert.strictEqual(r.status, 2, 'a deny that exits ' + r.status + ' is a pass on a tool that fails open: ' + r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.strictEqual(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /SECRET FILE GUARD/);
    assert.strictEqual(r.stderr, out.permissionDecisionReason, 'stderr and the JSON disagree about why');
  });

  test('an allow is silence and exit 0; an ask is JSON and exit 0', () => {
    const root = mkRoot('allow');
    const quiet = entry(root, DEFAULT_TOOL, 'pre-tool', claudePayload('Bash', { command: 'npm run build' }));
    assert.deepStrictEqual([quiet.status, quiet.stdout, quiet.stderr], [0, '', '']);
    const asked = entry(root, DEFAULT_TOOL, 'pre-tool', claudePayload('mcp__db__execute_sql', { query: 'select 1' }));
    assert.strictEqual(asked.status, 0);
    assert.strictEqual(JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision, 'ask');
  });

  test('a payload that does not parse is a deny with a reason, and the reason never quotes it', () => {
    const root = mkRoot('junk');
    for (const junk of ['}{ HIDDENVALUE', 'HIDDENVALUE not json', '{"tool_name":', '', '[]']) {
      const r = entry(root, DEFAULT_TOOL, 'pre-tool', junk);
      assert.strictEqual(r.status, 2, 'exit ' + r.status + ' on ' + JSON.stringify(junk));
      const out = JSON.parse(r.stdout).hookSpecificOutput;
      assert.strictEqual(out.permissionDecision, 'deny');
      assert.match(out.permissionDecisionReason, /could not be read/);
      assert.ok(!(r.stdout + r.stderr).includes('HIDDENVALUE'), 'the unreadable payload was quoted back');
    }
  });

  test('an unknown tool id, a tool with no dialect and a bad event are each refused with a reason', () => {
    const root = mkRoot('misregistered');
    const call = claudePayload('Bash', { command: 'npm test' });
    const noDialect = REGISTRY.tools.find((r) => r.dialect === null).id;
    for (const [tool, event, why] of [
      ['no-such-tool', 'pre-tool', /is not a tool id in the registry/],
      [noDialect, 'pre-tool', /has no dialect/],
      [DEFAULT_TOOL, 'post-tool', /is not one of pre-tool, session-start, prompt-submit, stop/],
    ]) {
      const r = entry(root, tool, event, call);
      assert.strictEqual(r.status, 2, tool + ' / ' + event + ' exited ' + r.status);
      assert.match(r.stderr, /^HOOK ENTRY REFUSED: /);
      assert.match(r.stderr, why);
    }
    const bare = spawn(root, HOOK, ['--event', 'pre-tool'], call);
    assert.strictEqual(bare.status, 2, 'a registration with no --tool passed a call');
  });

  test('a registration that lost its flags, or gained --help or --self-test, does not pass the call', () => {
    // Each of these used to print usage (or run the self-test) and exit 0 without reading stdin.
    const root = mkRoot('lost-flags');
    const worthDenying = claudePayload('Bash', { command: 'cat ' + DOTENV + '.production' });
    const none = spawn(root, HOOK, [], worthDenying);
    assert.strictEqual(none.status, 2, 'bare `node hook.js` passed a call: ' + none.stdout);
    assert.match(none.stderr, /^HOOK ENTRY REFUSED: /);
    assert.strictEqual(none.stdout, '');
    const real = ['--tool', DEFAULT_TOOL, '--event', 'pre-tool'];
    for (const extra of ['--help', '--self-test']) {
      for (const argv of [real.concat([extra]), [extra].concat(real)]) {
        const r = spawn(root, HOOK, argv, worthDenying);
        assert.strictEqual(r.status, 2, argv.join(' ') + ' passed the call');
        assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', argv.join(' ') + ' did not run the guards');
      }
      assert.strictEqual(spawn(root, HOOK, [extra, extra], worthDenying).status, 2, extra + ' twice is not the whole command line it is honoured as');
    }
    const help = spawn(root, HOOK, ['--help'], '');
    assert.deepStrictEqual([help.status, /--tool <id> --event/.test(help.stdout)], [0, true], '--help alone is still help');
  });

  test('a handler that ends the process has not decided: the entry leaves with exit 2', () => {
    // The harness scripts, copied, with one guard replaced by one that exits 0 mid-decision.
    const root = mkRoot('exits');
    fs.cpSync(path.join(REPO, 'scripts', 'harness'), path.join(root, 'scripts', 'harness'), { recursive: true });
    put(root, 'scripts/harness/guards/env-guard.cjs', "'use strict';\nmodule.exports = { stanceOf: () => ({}), decide: () => process.exit(0), decideSessionStart: () => process.exit(0) };\n");
    const copy = path.join(root, 'scripts', 'harness', 'hook.js');
    const r = spawn(root, copy, ['--tool', DEFAULT_TOOL, '--event', 'pre-tool'], claudePayload('Bash', { command: 'npm test' }));
    assert.strictEqual(r.status, 2, 'a guard that called process.exit(0) passed the call');
    assert.match(r.stderr, /^HOOK ENTRY REFUSED: the process ended before the handlers reached a verdict/);
    // At session start nothing can be refused, so the same exit there is left alone.
    const start = spawn(root, copy, ['--tool', DEFAULT_TOOL, '--event', 'session-start'], JSON.stringify({ hook_event_name: 'SessionStart' }));
    assert.strictEqual(start.status, 0);
  });

  test('a call missing the field its kind is decided from is never a silent allow', () => {
    const root = mkRoot('no-field');
    for (const [tool, input] of [['Bash', {}], ['Bash', { cmd: 'git mv docs/tracks/t ' + ARCHIVE + '/t' }], ['Write', { filePath: 'AGENTS.md', content: 'x' }], ['Bash', { command: ['git', 'push'] }]]) {
      const asked = entry(root, DEFAULT_TOOL, 'pre-tool', claudePayload(tool, input));
      assert.strictEqual(asked.status, 0, tool + ': ' + asked.stderr);
      const out = JSON.parse(asked.stdout || '{"hookSpecificOutput":{}}').hookSpecificOutput;
      assert.strictEqual(out.permissionDecision, 'ask', tool + ' ' + JSON.stringify(input) + ' was allowed in silence');
      assert.match(out.permissionDecisionReason, /^D4 NOTHING HERE CAN READ THIS CALL/);
      assert.doesNotMatch(out.permissionDecisionReason, /MCP|PreToolUse|mcp__/, 'the reason names a tool\'s own protocol for a call that is not one');
      // The two rows with no ask spelling refuse the same call.
      for (const other of ['codex-cli', 'kimi-code']) {
        const r = entry(root, other, 'pre-tool', claudePayload(tool, input));
        assert.strictEqual(r.status, 2, other + ' passed ' + tool + ' ' + JSON.stringify(input));
        assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
      }
    }
    const patch = entry(root, 'codex-cli', 'pre-tool', claudePayload('apply_patch', { patch: '*** Begin Patch' }));
    assert.strictEqual(patch.status, 2, 'an ask on a row with no ask spelling must refuse');
  });

  test('a registration for one event handed another event\'s payload: each direction, with its exit code', () => {
    const root = mkRoot('directions');
    const withEnvelope = (name) => JSON.stringify({ hook_event_name: name, session_id: 's', tool_name: 'Bash', tool_input: { command: 'cat ' + DOTENV + '.production' } });
    // A session-start envelope on a pre-tool registration: session start cannot refuse, so the
    // refusal is spelled under the flag's event. Exit 0 here would pass a call worth denying.
    const start = entry(root, DEFAULT_TOOL, 'pre-tool', withEnvelope('SessionStart'));
    assert.strictEqual(start.status, 2, 'a wrong envelope turned a pre-tool registration into a pass');
    assert.strictEqual(JSON.parse(start.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(start.stderr, /registered with --event pre-tool and was handed a session-start payload/);
    for (const other of ['gemini-cli', 'cursor']) {
      const name = other === 'cursor' ? 'sessionStart' : 'SessionStart';
      assert.strictEqual(entry(root, other, 'pre-tool', JSON.stringify({ hook_event_name: name, command: 'x' })).status, 2, other);
    }
    // A pre-tool payload on a stop registration: a call no guard looked at.
    assert.strictEqual(entry(root, DEFAULT_TOOL, 'stop', withEnvelope('PreToolUse')).status, 2);
    // A stop payload on a pre-tool registration: refusing it forces a turn on every stop.
    const stop = entry(root, DEFAULT_TOOL, 'pre-tool', JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }));
    assert.deepStrictEqual([stop.status, stop.stdout], [0, '']);
    assert.match(stop.stderr, /registered with --event pre-tool and was handed a stop payload[\s\S]*The turn ends/);
  });

  test('every file the entry can load is shipped by a `files` pattern of the package (MT-13)', () => {
    // The patterns are one level deep and one extension wide, so a new directory of modules is
    // absent from a packed install until it has its own entry, and nothing else goes red.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const esc = (t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const hit = (pattern, rel) => {
      if (pattern.endsWith('/')) return rel.startsWith(pattern);
      return new RegExp('^' + pattern.split('*').map(esc).join('[^/]*') + '$').test(rel);
    };
    const shipped = (rel) => pkg.files.some((p) => !p.startsWith('!') && hit(p, rel)) && !pkg.files.some((p) => p.startsWith('!') && hit(p.slice(1), rel));
    assert.ok(shipped('scripts/harness/x.js') && !shipped('scripts/harness/sub/x.js') && !shipped('scripts/harness/gates.json'), 'the matcher in this test is wrong');
    const literal = (rel) => [...fs.readFileSync(path.join(REPO, ...rel.split('/')), 'utf8').matchAll(/\brequire\(\s*'(\.\/[^']+)'\s*\)/g)]
      .map((m) => path.posix.join(path.posix.dirname(rel), m[1]));
    const needs = ['scripts/harness/hook.js', 'scripts/harness/tools.json', 'scripts/harness/dialects/_wire.js']
      .concat(literal('scripts/harness/hook.js'))
      .concat(REGISTRY.dialects.map((n) => 'scripts/harness/dialects/' + n + '.js'));
    for (const n of REGISTRY.dialects) needs.push(...literal('scripts/harness/dialects/' + n + '.js'));
    assert.ok(needs.some((n) => /\/guards\/[a-z-]+\.cjs$/.test(n)) && needs.length >= 12, 'the entry\'s own requires were not found: ' + needs.join(', '));
    for (const rel of [...new Set(needs)]) {
      assert.ok(fs.existsSync(path.join(REPO, ...rel.split('/'))), rel + ' is loaded by the entry and is not on disk');
      assert.ok(shipped(rel), rel + ' is loaded by the entry and no `files` pattern in package.json ships it');
    }
  });

  test('a registration that names the wrong event refuses the call it was handed', () => {
    // A pre-tool hook registered with --event session-start would run reporters and no guard.
    const root = mkRoot('wrong-event');
    const r = entry(root, DEFAULT_TOOL, 'session-start', claudePayload('Bash', { command: 'npm test' }));
    assert.strictEqual(r.status, 2);
    assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.stderr, /registered with --event session-start and was handed a pre-tool payload/);
  });

  test('prompt-submit and stop are wired end to end and carry no handler yet', () => {
    // The seam a later track adds a handler to. With an empty list a readable payload allows.
    const root = mkRoot('seam');
    for (const [event, name] of [['prompt-submit', 'UserPromptSubmit'], ['stop', 'Stop']]) {
      const r = entry(root, DEFAULT_TOOL, event, JSON.stringify({ hook_event_name: name, session_id: 's' }));
      assert.deepStrictEqual([r.status, r.stdout, r.stderr], [0, '', ''], event);
    }
    assert.strictEqual(entry(root, DEFAULT_TOOL, 'prompt-submit', 'junk').status, 2, 'an unreadable prompt payload was passed');
    const stop = entry(root, DEFAULT_TOOL, 'stop', 'junk');
    assert.strictEqual(stop.status, 0, 'an unreadable stop payload must end the turn, not loop it');
    assert.match(stop.stderr, /could not be read/);
  });

  test('the other wire formats reach the same guards and deny in their own spelling', () => {
    const root = mkRoot('wires');
    const guarded = DOTENV + '.production';
    const cases = [
      ['codex-cli', claudePayload('Bash', { command: 'cat ' + guarded }), (o) => o.hookSpecificOutput.permissionDecision === 'deny'],
      ['kimi-code', claudePayload('Read', { file_path: guarded }), (o) => o.hookSpecificOutput.permissionDecision === 'deny'],
      ['gemini-cli', JSON.stringify({ session_id: 's', cwd: '/r', hook_event_name: 'BeforeTool', timestamp: 't', tool_name: 'x', tool_input: { target: guarded } }), (o) => o.decision === 'deny' && /SECRET FILE GUARD/.test(o.reason)],
      ['cursor', JSON.stringify({ conversation_id: 'c', hook_event_name: 'beforeShellExecution', workspace_roots: [], cursor_version: '1', command: 'cat ' + guarded }), (o) => o.permission === 'deny'],
      ['antigravity', JSON.stringify({ conversationId: 'c', workspacePaths: [], transcriptPath: '/t', stepIdx: 1, toolCall: { name: 'read', args: { where: guarded } } }), (o) => o.decision === 'deny'],
    ];
    for (const [tool, stdin, denied] of cases) {
      const r = entry(root, tool, 'pre-tool', stdin);
      assert.strictEqual(r.status, 2, tool + ' exited ' + r.status + ': ' + r.stderr);
      assert.ok(denied(JSON.parse(r.stdout)), tool + ' did not deny in its own spelling: ' + r.stdout);
      assert.match(r.stderr, /SECRET FILE GUARD/, tool + ' gave no reason on stderr');
    }
    // And the same wire formats let ordinary work through.
    const fine = entry(root, 'cursor', 'pre-tool', JSON.stringify({ conversation_id: 'c', hook_event_name: 'beforeShellExecution', workspace_roots: [], cursor_version: '1', command: 'npm test' }));
    assert.deepStrictEqual([fine.status, fine.stdout], [0, '']);
  });

  test('a payload from the third cell, with its event fields at the top level, still reaches the secret-file guard', () => {
    const root = mkRoot('third-cell');
    const r = entry(root, 'kimi-code', 'pre-tool', JSON.stringify({
      hook_event_name: 'PreToolUse', session_id: 's', session_title: 't', client_type: 'cli', cwd: '/repo', file_path: '/repo/' + DOTENV + '.production',
    }));
    assert.strictEqual(r.status, 2, 'a payload with no tool_input was handed to the guard as nothing: ' + r.stdout);
    assert.match(r.stderr, /SECRET FILE GUARD/);
  });

  test('AS WRITTEN, the two dialects with no name table and no ask spelling refuse a call they cannot read', () => {
    // Pinned because both headers and both registry rows say so: this is what registering
    // either tool does today, and a change to it should be a decision, not a side effect.
    const root = mkRoot('strict');
    const read = entry(root, 'gemini-cli', 'pre-tool', JSON.stringify({ session_id: 's', cwd: '/r', hook_event_name: 'BeforeTool', timestamp: 't', tool_name: 'read_file', tool_input: { file_path: 'README.md' } }));
    assert.strictEqual(read.status, 2);
    assert.doesNotMatch(read.stderr, /MCP|PreToolUse|mcp__/, 'a native call was described as another tool\'s protocol');
    const general = entry(root, 'cursor', 'pre-tool', JSON.stringify({ conversation_id: 'c', hook_event_name: 'preToolUse', workspace_roots: [], cursor_version: '1', tool_name: 'Read', tool_input: { file_path: 'README.md' } }));
    assert.strictEqual(general.status, 2);
    // The antigravity cell documents an ask, so there the same call is a question.
    const asked = entry(root, 'antigravity', 'pre-tool', JSON.stringify({ conversationId: 'c', workspacePaths: [], transcriptPath: '/t', stepIdx: 1, toolCall: { name: 'read', args: { file: 'README.md' } } }));
    assert.deepStrictEqual([asked.status, JSON.parse(asked.stdout).decision], [0, 'ask']);
    // ...and a command spelled twice, differently, is a question and not the harmless one's allow.
    const twice = entry(root, 'antigravity', 'pre-tool', JSON.stringify({ conversationId: 'c', workspacePaths: [], transcriptPath: '/t', stepIdx: 1, toolCall: { name: 'run', command: 'npm test', args: { command: 'git mv docs/tracks/t ' + ARCHIVE + '/t' } } }));
    assert.deepStrictEqual([twice.status, JSON.parse(twice.stdout || '{}').decision], [0, 'ask']);
    const argv = entry(root, 'antigravity', 'pre-tool', JSON.stringify({ conversationId: 'c', workspacePaths: [], transcriptPath: '/t', stepIdx: 1, toolCall: { name: 'run', args: { command: ['git', 'push'] } } }));
    assert.strictEqual(JSON.parse(argv.stdout || '{}').decision, 'ask', 'a command no guard can read as text was allowed in silence');
  });
});

/* ============================================================ */

describe('one process in place of three: the entry reaches the verdict the guards reached apart', () => {
  /* THE HISTORICAL RECORD. Before the entry existed each guard had its own registration and its
     own matcher; these are those three, kept here as the thing to be equal to. A guard whose
     matcher did not match a tool never saw the call. */
  const BEFORE = [
    { script: guard('env-guard.cjs'), args: [], matcher: 'Bash|PowerShell|Read|Grep|Glob|Edit|Write|mcp__.*' },
    { script: guard('commit-hygiene.cjs'), args: ['--gate'], matcher: 'Bash|PowerShell|mcp__.*' },
    { script: guard('phase-guard.cjs'), args: [], matcher: 'Bash|PowerShell|Edit|Write|mcp__.*' },
  ];
  const RANK = { deny: 2, ask: 1 };
  /** What the runtime made of three hooks: a deny from any refuses, else an ask from any asks. */
  function apart(root, tool, input) {
    let best = null;
    for (const g of BEFORE) {
      if (!new RegExp('^(?:' + g.matcher + ')$').test(tool)) continue;
      const r = spawn(root, g.script, g.args, claudePayload(tool, input));
      assert.strictEqual(r.status, 0, 'a guard run directly must exit 0: ' + r.stderr);
      const out = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
      if (out && (!best || RANK[out.permissionDecision] > RANK[best.permissionDecision])) best = out;
    }
    return best ? [best.permissionDecision, best.permissionDecisionReason] : [null, ''];
  }
  function together(root, tool, input) {
    const r = entry(root, DEFAULT_TOOL, 'pre-tool', claudePayload(tool, input));
    const out = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
    const decision = out ? out.permissionDecision : null;
    assert.strictEqual(r.status, decision === 'deny' ? 2 : 0, 'the exit code and the decision disagree for ' + tool);
    return [decision, out ? out.permissionDecisionReason : ''];
  }

  const plan = 'docs/tracks/fixture/plan.md';
  const docs = () => {
    const root = mkRoot('same');
    put(root, plan, '---\nid: fixture\nkind: plan\nstatus: open\n---\n# fixture\n');
    return root;
  };
  const staged = () => {
    const root = mkRoot('same-git');
    gitIn(root, '-c', 'init.defaultBranch=main', 'init', '-q');
    put(root, 'scripts/harness/gates.baseline.json', '{}\n');
    gitIn(root, 'add', 'scripts/harness/gates.baseline.json');
    return root;
  };
  const flipped = '---\nid: fixture\nkind: plan\nstatus: complete\n---\n# fixture\n';

  const CASES = [
    // [what, root factory, tool, input, the decision both must reach]
    ['a shell call naming a guarded file', docs, 'Bash', { command: 'cat ' + DOTENV + '.local' }, 'deny'],
    ['a read of a guarded file', docs, 'Read', { file_path: '/repo/' + DOTENV }, 'deny'],
    ['a search that names one', docs, 'Grep', { pattern: 'KEY', path: DOTENV + '.production' }, 'deny'],
    ['a scaffolding twin, which is not guarded', docs, 'Read', { file_path: DOTENV + '.example' }, null],
    ['an MCP call naming one in a server-defined field', docs, 'mcp__fs__read', { target: '/repo/' + DOTENV + '.production' }, 'deny'],
    ['a shell move into the archive', docs, 'Bash', { command: 'git mv docs/tracks/fixture ' + ARCHIVE + '/fixture' }, 'deny'],
    ['a PowerShell move into the archive', docs, 'PowerShell', { command: 'Move-Item docs/tracks/fixture ' + ARCHIVE }, 'deny'],
    ['a write that flips a status', docs, 'Write', { file_path: plan, content: flipped }, 'deny'],
    ['an edit that flips a status', docs, 'Edit', { file_path: plan, old_string: 'status: open', new_string: 'status: complete' }, 'deny'],
    ['a write that keeps the status', docs, 'Write', { file_path: plan, content: '---\nid: fixture\nkind: plan\nstatus: open\n---\n# rewritten\n' }, null],
    ['a gate figure into a governed doc', docs, 'Edit', { file_path: plan, old_string: '# fixture', new_string: 'smoke 999/999 green' }, 'deny'],
    ['an MCP write of a gate figure', docs, 'mcp__fs__write_file', { file_path: plan, content: 'smoke 999/999 green' }, 'deny'],
    ['an MCP shell call that archives', docs, 'mcp__shell__exec', { command: 'git mv docs/tracks/fixture ' + ARCHIVE + '/fixture' }, 'deny'],
    ['an MCP payload nothing can read', docs, 'mcp__db__execute_sql', { query: 'drop table widgets;' }, 'ask'],
    ['an MCP payload with no fields', docs, 'mcp__ping__ping', {}, 'ask'],
    ['a readable MCP call that breaks no rule', docs, 'mcp__shell__exec', { command: 'npm test' }, null],
    ['ordinary shell work', docs, 'Bash', { command: 'npm run build' }, null],
    ['an ordinary edit', docs, 'Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' }, null],
    ['a read of a track doc', docs, 'Read', { file_path: plan }, null],
    ['a glob', docs, 'Glob', { pattern: 'docs/**/*.md' }, null],
    ['a re-baseline smuggled under another subject', staged, 'Bash', { command: 'git commit -m "chore: sneak a re-baseline"' }, 'deny'],
    ['...the same through an MCP git server', staged, 'mcp__git__run', { command: 'git commit -m "chore: sneak a re-baseline"' }, 'deny'],
    ['a legible re-baseline', staged, 'Bash', { command: 'git commit -m "gates: re-baseline after the new suite"' }, null],
    ['a read-only git call', staged, 'Bash', { command: 'git status' }, null],
    // An input that is not an object. The guards run apart read it as text and denied; the
    // entry once replaced it with an empty object on the way in and allowed.
    ['a read whose input is a bare string naming a guarded file', docs, 'Read', '/repo/' + DOTENV, 'deny'],
    ['a read whose input is a list naming one', docs, 'Read', ['/repo/' + DOTENV + '.production'], 'deny'],
    ['a shell call whose input is a bare string naming one', docs, 'Bash', 'cat ' + DOTENV + '.local', 'deny'],
    ['a shell call whose input is a list naming one', docs, 'Bash', ['cat ' + DOTENV + '.production'], 'deny'],
    ['a search whose input is a list naming one', docs, 'Grep', ['KEY', DOTENV + '.production'], 'deny'],
  ];

  for (const [what, mk, tool, input, want] of CASES) {
    test(what + ' -> ' + (want || 'allow'), () => {
      const root = mk();
      const was = apart(root, tool, input);
      assert.strictEqual(was[0], want, 'the fixture is wrong: the guards run apart gave ' + was[0]);
      assert.deepStrictEqual(together(root, tool, input), was, 'the entry disagrees with the guards it runs');
    });
  }
});

/* ============================================================ */

describe('session start through the entry — the reports say what the separate ones said', () => {
  const settingsWith = (deny) => JSON.stringify({ permissions: { deny } }, null, 2) + '\n';
  const bothDenies = (p) => ['Read(./' + p + ')', 'Read(//**/' + p + ')'];
  const start = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: '/repo', source: 'startup' });
  const contextOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '');
  /** The secret-file guard's own report for this root, from its own CLI: the thing to be equal to. */
  const rearm = (root) => contextOf(spawn(root, guard('env-guard.cjs'), ['--rearm-check'], ''));

  /** The arguments the session-start hook is REGISTERED with, read out of the settings file. */
  const registeredStart = () => {
    const settings = JSON.parse(fs.readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8'));
    const commands = (settings.hooks.SessionStart || []).flatMap((e) => (e.hooks || []).map((h) => String(h.command)));
    assert.strictEqual(commands.length, 1, 'one session-start entry is registered, not ' + commands.length);
    const m = /hook\.js" (.+)$/.exec(commands[0]);
    assert.ok(m, 'the session-start command is not the one entry: ' + commands[0]);
    return m[1].split(' ');
  };

  test('the session-start command AS REGISTERED reports a half-armed deny list', () => {
    // Registered with another row's id the deny layer goes unread; registered with the
    // pre-tool event no reporter runs. Either leaves this report silent, so it is run as written.
    const root = mkRoot('registered', { env: { guarded: [DOTENV], openCarveOuts: [] } });
    put(root, '.claude/settings.json', settingsWith([bothDenies(DOTENV)[0]]));
    const r = spawn(root, HOOK, registeredStart(), start);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(contextOf(r), /permissions\.deny is missing 1 of the 2 Read denies/, 'the registered session-start command does not run the re-arm report');
  });

  test('on a clean fixture every reporter RUNS: none is reported as not having run', () => {
    const root = mkRoot('all-ran', { env: { guarded: [DOTENV], openCarveOuts: [] } });
    put(root, '.claude/settings.json', settingsWith(bothDenies(DOTENV)));
    const r = spawn(root, HOOK, registeredStart(), start, { HOME: root, USERPROFILE: root });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /DID NOT RUN|did not run/, 'a reporter threw on a clean tree, which reads as a clean report to anything that only greps for its findings');
  });

  test('an over-long auto-memory index is reported through the entry in the linter\'s own words', () => {
    const root = mkRoot('memory');
    const home = mkRoot('memory-home', null);
    const env = { HOME: home, USERPROFILE: home };
    const lint = (args) => spawn(root, guard('docs-lint.cjs'), args, '', env);
    assert.strictEqual(contextOf(lint(['--memory-check'])), '', 'the fixture is wrong: the linter spoke with no index');
    // The path is the linter's to derive: read off the skip it declares, never restated here.
    const m = /rule 10 \(auto-memory\) SKIPPED — no index at (.+)$/m.exec(lint([]).stdout);
    assert.ok(m, 'an absent index was not declared as a skip');
    fs.mkdirSync(path.dirname(m[1].trim()), { recursive: true });
    fs.writeFileSync(m[1].trim(), '# Memory\n\n- [a](a.md) a short hook\n- [b](b.md) ' + 'y'.repeat(200) + '\n');
    const own = contextOf(lint(['--memory-check']));
    assert.match(own, /chars > 160/, 'the fixture is wrong: the linter\'s own report is silent');
    const r = spawn(root, HOOK, ['--tool', DEFAULT_TOOL, '--event', 'session-start'], start, env);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(contextOf(r).includes(own.trim()), 'the entry dropped the auto-memory report');
    assert.match(JSON.parse(r.stdout).systemMessage, /1 over-long line/, 'the reporter\'s line for the person at the keyboard was dropped');
  });

  test('harness drift on a follower branch is reported through the entry in branch-sync\'s own words', () => {
    const root = mkRoot('drift');
    const sync = path.join(REPO, 'scripts', 'harness', 'branch-sync.js');
    // No CI branch variable may name the branch for a detached checkout this is not.
    const env = { GITHUB_HEAD_REF: '', GITHUB_REF_NAME: '', CI_COMMIT_REF_NAME: '', BRANCH_NAME: '' };
    gitIn(root, 'init', '-q');
    gitIn(root, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    put(root, 'CLAUDE.md', '# shared\n');
    put(root, 'scripts/harness/common.json', JSON.stringify({
      files: ['CLAUDE.md'], dirs: [], perBranch: ['harness.config.json'], sections: [], ignore: { mustTrack: [], mustIgnore: [] }, packageScripts: {},
    }, null, 2) + '\n');
    gitIn(root, 'add', '-A');
    gitIn(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
    gitIn(root, 'checkout', '-q', '-b', 'feature');
    assert.strictEqual(contextOf(spawn(root, sync, ['--hook'], '', env)), '', 'the fixture is wrong: an identical branch reads as drifted');
    put(root, 'CLAUDE.md', '# shared\n\nEdited in place on the branch.\n');
    const own = contextOf(spawn(root, sync, ['--hook'], '', env));
    assert.match(own, /HARNESS DRIFT: branch feature vs main/, 'the fixture is wrong: branch-sync\'s own report is silent');
    const r = spawn(root, HOOK, ['--tool', DEFAULT_TOOL, '--event', 'session-start'], start, env);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(contextOf(r).includes(own.trim()), 'the entry dropped the drift report');
    assert.match(JSON.parse(r.stdout).systemMessage, /1 harness path\(s\) drifted from main/);
  });

  test('the re-arm report reads the deny list out of the tool\'s settings file, as it did (MT-06)', () => {
    // Half-armed: one of the two spellings. Then armed. Then no settings file at all.
    const root = mkRoot('rearm', { env: { guarded: [DOTENV, DOTENV + '.*'], openCarveOuts: [] } });
    put(root, '.claude/settings.json', settingsWith([bothDenies(DOTENV)[0]]));
    const half = rearm(root);
    assert.match(half, /permissions\.deny is missing 1 of the 2 Read denies/, 'the fixture is wrong: the guard\'s own report is silent');
    const viaEntry = entry(root, DEFAULT_TOOL, 'session-start', start);
    assert.strictEqual(viaEntry.status, 0, 'a session start must exit 0: ' + viaEntry.stderr);
    assert.strictEqual(JSON.parse(viaEntry.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
    assert.ok(contextOf(viaEntry).includes(half), 'the entry\'s report is not the guard\'s own report for the same file');

    put(root, '.claude/settings.json', settingsWith(bothDenies(DOTENV)));
    assert.strictEqual(rearm(root), '');
    assert.doesNotMatch(contextOf(entry(root, DEFAULT_TOOL, 'session-start', start)), /permissions\.deny|SECRET-FILE GUARD/, 'a false alarm on an armed file');

    fs.rmSync(path.join(root, '.claude', 'settings.json'));
    const gone = rearm(root);
    assert.match(gone, /missing 2 of the 2/, 'the fixture is wrong: no settings file read as armed');
    assert.ok(contextOf(entry(root, DEFAULT_TOOL, 'session-start', start)).includes(gone), 'no settings file read as a false all-clear through the entry');
  });

  test('an open carve-out is reported through the entry in the guard\'s own words', () => {
    const root = mkRoot('carve', { env: { guarded: [DOTENV + '.*'], openCarveOuts: [{ path: DOTENV + '.local', why: 'a fixture', until: '2999-01-01' }] } });
    const own = rearm(root);
    assert.match(own, /OPEN carve-out/);
    assert.ok(contextOf(entry(root, DEFAULT_TOOL, 'session-start', start)).includes(own));
  });

  test('a tool that shares the wire format but keeps its hooks elsewhere is not graded on that file', () => {
    // The deny list belongs to the row whose hook config IS the file. Another row on the same
    // dialect has no deny file the harness can read, and must not be told one is half-armed.
    const root = mkRoot('other-row', { env: { guarded: [DOTENV], openCarveOuts: [] } });
    put(root, '.claude/settings.json', settingsWith([]));
    assert.match(contextOf(entry(root, DEFAULT_TOOL, 'session-start', start)), /permissions\.deny is missing/);
    assert.doesNotMatch(contextOf(entry(root, 'codex-cli', 'session-start', start)), /permissions\.deny is missing/);
  });

  test('a skill that drifted is reported through the entry, and the session still starts', () => {
    const root = mkRoot('skills');
    put(root, '.claude/settings.json', settingsWith(bothDenies(DOTENV)));
    put(root, 'skills-lock.json', '{ not json');
    const own = contextOf(spawn(root, guard('skill-verify.cjs'), ['--hook'], ''));
    assert.match(own, /SKILL INTEGRITY CHECK DID NOT RUN/, 'the fixture is wrong: the verifier\'s own report is silent');
    const r = entry(root, DEFAULT_TOOL, 'session-start', start);
    assert.strictEqual(r.status, 0);
    assert.ok(contextOf(r).includes(own.trim()), 'the entry dropped the skill report');
  });

  test('an unreadable session-start payload is reported, and the reports still run', () => {
    const root = mkRoot('blind-start', { env: { guarded: [DOTENV], openCarveOuts: [] } });
    put(root, '.claude/settings.json', settingsWith([]));
    const r = entry(root, DEFAULT_TOOL, 'session-start', '');
    assert.strictEqual(r.status, 0, 'a session start must exit 0 whatever it was handed');
    assert.match(contextOf(r), /payload of this session-start hook could not be read/);
    assert.match(contextOf(r), /permissions\.deny is missing/, 'the reports did not run');
  });
});
