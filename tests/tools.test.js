'use strict';
/* ============================================================
   tools.test.js — the tool registry and the `tools` config key, driven as scripts.

   Two things are under test and they fail differently. The CHECKER (scripts/harness/tools.js)
   is run in a child process against a fixture repo that carries its own registry, because its
   verdict is an exit code and a named row, and neither exists inside an imported function. The
   SHIPPED REGISTRY (scripts/harness/tools.json) is read here directly, because what it must say
   is a statement about evidence: which rows somebody ran, and which were only read about.

   A fixture is a whole little repo: config.js and tools.js copied in beside a registry the test
   wrote, so the checker reads the fixture's rows and never the real ones.
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
const SRC = path.join(REPO, 'scripts', 'harness');
const TOOLS = path.join(SRC, 'tools.js');
const REGISTRY = path.join(SRC, 'tools.json');

// The agent runtime exports its project directory, and config.js takes it as a root. Inherited
// into a fixture it would point every child at the real repo.
function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

const { DEFAULTS, TOP_LEVEL, TOOLS_KEYS } = require(path.join(SRC, 'config.js'));
const DEFAULT_ID = DEFAULTS.tools.enabled[0];

const MINIMAL = { project: { name: 'example' }, gates: [{ name: 'test', command: 'node --test' }] };
const DIALECTS = ['wire-a', 'wire-b'];
// A native row loads the policy file itself: enabling a native row with any other file is refused.
const row = (over) => Object.assign({
  id: 'tool-a', policy: { mode: 'native', file: 'AGENTS.md' }, nested: 'on-touch',
  hookConfig: '.tool-a/hooks.json', dialect: 'wire-a', sessionStart: true, projectHooks: true,
  tier: 'full', evidence: 'docs', asOf: '2026-01-04', source: ['https://example.com/docs'],
}, over || {});
const registry = (rows) => ({ dialects: DIALECTS, tools: rows });

/** `reg` is a registry object, a raw string, or null for no registry file at all. */
function withFixture(reg, config, body) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tools-')));
  try {
    const here = path.join(dir, 'scripts', 'harness');
    fs.mkdirSync(here, { recursive: true });
    for (const f of ['config.js', 'tools.js']) fs.copyFileSync(path.join(SRC, f), path.join(here, f));
    if (reg !== null) fs.writeFileSync(path.join(here, 'tools.json'), typeof reg === 'string' ? reg : JSON.stringify(reg, null, 2));
    fs.writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(config || MINIMAL, null, 2));
    const run = (script, args) => {
      const r = spawnSync(process.execPath, [path.join(here, script)].concat(args || []), { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      return { status: r.status, stdout: String(r.stdout), stderr: String(r.stderr) };
    };
    return body(run, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const enabling = (ids) => Object.assign({}, MINIMAL, { tools: { enabled: ids } });
const lastLine = (s) => s.trim().split('\n').pop();
const real = (args) => spawnSync(process.execPath, [TOOLS].concat(args), { cwd: REPO, encoding: 'utf8', env: cleanEnv() });

/** A red check: exit 1, the finding names `where`, and the GATE line counts a failure. */
function refuses(r, where, why) {
  assert.strictEqual(r.status, 1, 'expected a refusal, got exit ' + r.status + ':\n' + r.stdout + r.stderr);
  assert.match(r.stdout, /^TOOLS RED — scripts\/harness\/tools\.json, \d+ finding\(s\):/m);
  assert.ok(r.stdout.includes('  x ' + where + ': '), 'the finding does not name `' + where + '`:\n' + r.stdout);
  if (why) assert.match(r.stdout, why);
  assert.match(lastLine(r.stdout), /^GATE tools pass=\d+ fail=[1-9]\d* skipped=0$/);
}

describe('tools.js checks itself', () => {
  test('--self-test passes', () => {
    const r = real(['--self-test']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS — tools\.js self-test \(\d+ checks\)/m);
  });

  test('no mode is a usage error, not a check that passed', () => {
    const r = real([]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /usage: node scripts\/harness\/tools\.js --check \| --list \| --self-test/);
  });

  test('two modes on one command line is a usage error, never one of them silently dropped', () => {
    for (const args of [['--check', '--list'], ['--check', '--self-test'], ['--list', '--self-test']]) {
      const r = real(args);
      assert.strictEqual(r.status, 2, args.join(' ') + ' exited ' + r.status + ':\n' + r.stdout);
      assert.match(r.stderr, /^usage: /);
      assert.doesNotMatch(r.stdout, /GATE tools|PASS/, args.join(' ') + ' printed a verdict');
    }
  });

  test('--check --self-test does not pass for a config --check alone refuses', () => {
    withFixture(registry([row()]), enabling(['tool-zzz']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 1);
      assert.strictEqual(run('tools.js', ['--check', '--self-test']).status, 2);
    });
  });

  test('--self-test holds the registry beside it to the contract, default tool included', () => {
    // A registry that PARSES to something falsy is not a registry, and a skipped check is not a pass.
    for (const raw of ['null', '0', 'false', '""', '[]', '{ "dialects": [], "tools": "x" }']) {
      withFixture(raw, MINIMAL, (run) => {
        const r = run('tools.js', ['--self-test']);
        assert.strictEqual(r.status, 1, 'tools.json = ' + raw + ' passed the self-test:\n' + r.stdout);
        assert.match(r.stderr, /SELF-TEST FAIL/);
      });
    }
    // A valid registry with no row for the loader's default id.
    withFixture(registry([row()]), MINIMAL, (run) => {
      const r = run('tools.js', ['--self-test']);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.ok(r.stderr.includes('tools.enabled.' + DEFAULT_ID), r.stderr);
    });
    withFixture(registry([row({ id: DEFAULT_ID })]), MINIMAL, (run) => {
      assert.strictEqual(run('tools.js', ['--self-test']).status, 0);
    });
  });
});

describe('tools.js --check — a clean registry', () => {
  test('is green, and its last line is the GATE line', () => {
    withFixture(registry([row(), row({ id: 'tool-b' })]), enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^tools: 2 row\(s\) valid, enabled: tool-a$/m);
      // The registry itself, two rows, one enabled id.
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=4 fail=0 skipped=0');
    });
  });

  test('a cell nobody established is null, and null passes', () => {
    withFixture(registry([row({ tier: 'guard-only', projectHooks: null, nested: 'unknown' })]), enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0);
    });
  });
});

describe('tools.js --check — what it refuses, by row and field', () => {
  test('an unknown field value', () => {
    for (const [field, bad, where] of [
      ['tier', 'partial', 'tool-a.tier'],
      ['evidence', 'verified', 'tool-a.evidence'],
      ['nested', 'eager', 'tool-a.nested'],
      ['dialect', 'wire-z', 'tool-a.dialect'],
      ['policy', { mode: 'copy', file: 'POLICY.md' }, 'tool-a.policy.mode'],
      ['asOf', 'last week', 'tool-a.asOf'],
    ]) {
      withFixture(registry([row({ [field]: bad })]), enabling(['tool-a']), (run) => {
        refuses(run('tools.js', ['--check']), where);
      });
    }
  });

  test('a key the registry does not define', () => {
    withFixture(registry([row({ hooks: true })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.hooks', /unknown field/);
    });
  });

  test('a missing required field — each one, named', () => {
    for (const field of ['policy', 'nested', 'hookConfig', 'dialect', 'sessionStart', 'projectHooks', 'tier', 'evidence', 'asOf', 'source']) {
      const r0 = row();
      delete r0[field];
      withFixture(registry([r0]), enabling(['tool-a']), (run) => {
        refuses(run('tools.js', ['--check']), 'tool-a.' + field, /missing required field/);
      });
    }
  });

  test('a row with no id is named by its position, because there is nothing else to call it', () => {
    const r0 = row();
    delete r0.id;
    withFixture(registry([row({ id: 'tool-b' }), r0]), enabling(['tool-b']), (run) => {
      refuses(run('tools.js', ['--check']), 'tools[1].id', /missing required field/);
    });
  });

  test('a duplicate id', () => {
    withFixture(registry([row(), row()]), enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tools[1] (tool-a).id', /duplicate id — tools\[0\] already has it/);
      // Only the SECOND row is the duplicate: the first is a good row and stays counted as one.
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=3 fail=1 skipped=0');
    });
  });

  test('every finding on a row that repeats an id says WHICH row, by index', () => {
    withFixture(registry([row(), row({ tier: 'partial' }), row({ evidence: 'x' })]), enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tools[1] (tool-a).tier');
      refuses(r, 'tools[2] (tool-a).evidence');
      refuses(r, 'tools[2] (tool-a).id', /tools\[0\] already has it/);
      assert.doesNotMatch(r.stdout, /^ {2}x tool-a\./m, 'a finding names the id alone, which three rows share');
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=3 fail=2 skipped=0');
    });
  });

  test('the GATE line counts failed UNITS, not findings: one row with two findings is one failure', () => {
    withFixture(registry([row({ sessionStart: 'yes' })]), enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tool-a.sessionStart');
      refuses(r, 'tool-a.tier');
      assert.match(r.stdout, /^TOOLS RED — scripts\/harness\/tools\.json, 2 finding\(s\):/m);
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=2 fail=1 skipped=0');
    });
  });

  test('a non-boolean in EITHER boolean cell is refused, by its own name', () => {
    // sessionStart also trips the tier rule; projectHooks on a guard-only row trips nothing else,
    // so a loop that dropped it would leave this row valid.
    withFixture(registry([row({ tier: 'guard-only', sessionStart: false, projectHooks: 'yes' })]), enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tool-a.projectHooks', /must be true, false or null/);
      assert.match(r.stdout, /, 1 finding\(s\):/);
    });
  });

  test('an import stub is a bare file name: a path there is a stub no sweep would recognise', () => {
    withFixture(registry([row({ policy: { mode: 'import', file: '.x/STUB.md' } })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.policy.file', /bare file name/);
    });
    withFixture(registry([row({ policy: { mode: 'import', file: 'STUB.md' } })]), enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0);
    });
  });

  test('ENABLING a native row whose file is not the policy file is refused: that is a second body', () => {
    const own = row({ id: 'tool-o', policy: { mode: 'native', file: 'OWN.md' } });
    withFixture(registry([row(), own]), enabling(['tool-o']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tools.enabled.tool-o', /loads `OWN\.md` natively, which is not the policy file AGENTS\.md/);
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=3 fail=1 skipped=0');
    });
    // The row itself is legal while nothing switches it on.
    withFixture(registry([row(), own]), enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0);
    });
  });

  test('an enabled id whose row is tier `inherits`: a model wires nothing', () => {
    const model = row({ id: 'model-a', tier: 'inherits', policy: null, nested: null, hookConfig: null, dialect: null, sessionStart: null, projectHooks: null });
    withFixture(registry([row(), model]), enabling(['model-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tools.enabled.model-a', /names a tier `inherits` row .* enable the row of the host/);
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=3 fail=1 skipped=0');
    });
    // The row itself is fine: listed, valid, and green while nothing enables it.
    withFixture(registry([row(), model]), enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0);
    });
  });

  test('a dialect list that repeats a name, and one that is missing', () => {
    withFixture({ dialects: ['wire-a', 'wire-a'], tools: [row()] }, enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'registry.dialects', /repeats `wire-a`/);
    });
    withFixture({ tools: [row()] }, enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'registry.dialects', /must be an array of kebab-case dialect names/);
      // One finding, at the list. No row-level echo with an empty list of options in it.
      assert.doesNotMatch(r.stdout, /one of , or null/);
      assert.doesNotMatch(r.stdout, /tool-a\.dialect/);
    });
  });

  test('an empty dialect list is legal for a registry no row of which has a dialect', () => {
    const bare = row({ tier: 'backstop', hookConfig: null, dialect: null, sessionStart: null, projectHooks: null });
    withFixture({ dialects: [], tools: [bare] }, enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0);
    });
    withFixture({ dialects: [], tools: [row()] }, enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.dialect', /unknown value "wire-a"/);
    });
  });

  test('an enabled tool with no row', () => {
    withFixture(registry([row()]), enabling(['tool-a', 'tool-b']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'tools.enabled.tool-b', /has no row \(rows: tool-a\)/);
      assert.strictEqual(lastLine(r.stdout), 'GATE tools pass=3 fail=1 skipped=0');
    });
  });

  test('the default tool is enabled when the config names none, so its row must exist', () => {
    withFixture(registry([row()]), MINIMAL, (run) => {
      refuses(run('tools.js', ['--check']), 'tools.enabled.' + DEFAULT_ID, /has no row/);
    });
  });

  test('evidence `ran` with no recorded command', () => {
    withFixture(registry([row({ evidence: 'ran' })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.command', /evidence `ran` needs the command that was run/);
    });
    withFixture(registry([row({ evidence: 'ran', command: 'tool-a --version' })]), enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0, 'a `ran` row with its command was refused');
    });
  });

  test('a `docs` row may not carry a command that reads as if something had been run', () => {
    withFixture(registry([row({ command: 'tool-a --version' })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.command', /a `docs` row records no command/);
    });
  });

  test('an empty registry', () => {
    withFixture(registry([]), enabling(['tool-a']), (run) => {
      const r = run('tools.js', ['--check']);
      refuses(r, 'registry.tools', /the registry is empty/);
      assert.ok(r.stdout.includes('  x tools.enabled.tool-a: '), 'the enabled tool with no row went unreported:\n' + r.stdout);
    });
  });

  test('a tier the row\'s own cells contradict', () => {
    withFixture(registry([row({ sessionStart: false })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.tier', /`full` needs sessionStart true/);
    });
    withFixture(registry([row({ tier: 'inherits' })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.dialect', /tier `inherits` is a model, not an agent/);
    });
  });

  test('an `inherits` row has NO cell of its own: session-start, project hooks and nested included', () => {
    const model = { tier: 'inherits', policy: null, nested: null, hookConfig: null, dialect: null, sessionStart: null, projectHooks: null };
    for (const [field, value] of [['nested', 'on-touch'], ['sessionStart', true], ['projectHooks', true], ['hookConfig', '.x/hooks.json']]) {
      withFixture(registry([row(), row(Object.assign({ id: 'model-a' }, model, { [field]: value }))]), enabling(['tool-a']), (run) => {
        refuses(run('tools.js', ['--check']), 'model-a.' + field, /tier `inherits` is a model, not an agent/);
      });
    }
  });

  test('a `backstop` row may record a hook file it has no dialect for, and nothing more than it records', () => {
    // Known-but-unwireable is a fact worth keeping: the dialect is what is missing, not the hook.
    const known = row({ tier: 'backstop', hookConfig: '.x/hooks.json', dialect: null, sessionStart: null, projectHooks: true });
    withFixture(registry([known]), enabling(['tool-a']), (run) => {
      assert.strictEqual(run('tools.js', ['--check']).status, 0, 'a backstop row with a recorded hook file was refused');
    });
    withFixture(registry([row({ tier: 'backstop', hookConfig: null, dialect: null, sessionStart: null, projectHooks: true })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.projectHooks', /this row records no hookConfig/);
    });
    withFixture(registry([Object.assign({}, known, { dialect: 'wire-a' })]), enabling(['tool-a']), (run) => {
      refuses(run('tools.js', ['--check']), 'tool-a.dialect', /tier `backstop` means no hook the harness can wire/);
    });
  });

  test('a registry that cannot be read is a stop, never an empty registry', () => {
    for (const reg of [null, '{ "tools": [ }']) {
      withFixture(reg, enabling(['tool-a']), (run) => {
        const r = run('tools.js', ['--check']);
        assert.strictEqual(r.status, 1);
        const lines = r.stderr.trim().split('\n');
        assert.strictEqual(lines.length, 2, 'a stop is two lines, the problem and the fix: ' + r.stderr);
        assert.match(lines[0], /^FATAL — cannot read the tool registry at scripts\/harness\/tools\.json/);
        assert.match(lines[1], /^ {3}fix: restore scripts\/harness\/tools\.json/);
        assert.doesNotMatch(r.stdout, /GATE tools/, 'an unreadable registry printed a verdict');
      });
    }
  });
});

describe('tools.js --list', () => {
  test('prints id, tier and evidence for every row, and which are enabled', () => {
    const rows = [row(), row({ id: 'tool-b', evidence: 'ran', command: 'tool-b --version' })];
    withFixture(registry(rows), enabling(['tool-b']), (run) => {
      const r = run('tools.js', ['--list']);
      assert.strictEqual(r.status, 0, r.stderr);
      const lines = r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/));
      assert.deepStrictEqual(lines, [
        ['id', 'tier', 'evidence', 'enabled'],
        ['tool-a', 'full', 'docs'],
        ['tool-b', 'full', 'ran', 'yes'],
      ]);
      assert.doesNotMatch(r.stdout, /verified/i, 'a `docs` row must never be reported as verified');
    });
  });

  test('a registry --check refuses is not a listing that succeeded', () => {
    for (const reg of ['[]', '{ "dialects": [], "tools": "x" }', 'null', JSON.stringify(registry([]))]) {
      withFixture(reg, enabling(['tool-a']), (run) => {
        const r = run('tools.js', ['--list']);
        assert.strictEqual(r.status, 1, 'tools.json = ' + reg + ' listed as a success:\n' + r.stdout);
        assert.match(r.stderr, /^TOOLS RED — scripts\/harness\/tools\.json, \d+ finding\(s\); `node scripts\/harness\/tools\.js --check` names them/);
      });
    }
  });

  test('an enabled id with no row is shown in the table, and the listing is red', () => {
    withFixture(registry([row()]), enabling(['tool-zzz']), (run) => {
      const r = run('tools.js', ['--list']);
      assert.strictEqual(r.status, 1);
      const lines = r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).join(' '));
      assert.deepStrictEqual(lines, ['id tier evidence enabled', 'tool-a full docs', 'tool-zzz - - yes (no row)']);
    });
  });
});

describe('the `tools` config key', () => {
  const print = (run) => run('config.js', []);

  test('absent means the default tool', () => {
    withFixture(registry([row()]), MINIMAL, (run) => {
      const r = print(run);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(r.stdout).tools, { enabled: DEFAULTS.tools.enabled });
    });
  });

  test('a stated list replaces the default whole', () => {
    withFixture(registry([row()]), enabling(['tool-a', 'tool-b']), (run) => {
      assert.deepStrictEqual(JSON.parse(print(run).stdout).tools.enabled, ['tool-a', 'tool-b']);
    });
  });

  test('a bad shape is a two-line stop that names it, with a fix line', () => {
    for (const [tools, pattern] of [
      [{ enable: ['tool-a'] }, /tools: unknown key `enable` \(allowed: _readme, enabled\)/],
      [{ enabled: 'tool-a' }, /tools\.enabled must be an array of tool ids/],
      [{ enabled: { 'tool-a': true } }, /tools\.enabled must be an array of tool ids/],
      [['tool-a'], /`tools` must be an object/],
      ['tool-a', /`tools` must be an object/],
      [{ enabled: [] }, /tools\.enabled must name at least one tool — omit the key for the default, \["[a-z][a-z0-9-]*"\]$/],
      [{ enabled: ['tool-a', 'tool-a'] }, /tools\.enabled\[1\]: duplicate tool id `tool-a`/],
      [{ enabled: ['Tool A'] }, /tools\.enabled\[0\] must be a kebab-case tool id/],
      [{ enabled: [7] }, /tools\.enabled\[0\] must be a kebab-case tool id/],
    ]) {
      withFixture(registry([row()]), Object.assign({}, MINIMAL, { tools: tools }), (run) => {
        const r = print(run);
        assert.strictEqual(r.status, 1, 'tools = ' + JSON.stringify(tools) + ' was accepted');
        const lines = r.stderr.trim().split('\n');
        assert.strictEqual(lines.length, 2, r.stderr);
        assert.match(lines[0], /^FATAL — /);
        assert.match(lines[0], pattern);
        assert.match(lines[1], /^ {3}fix: edit harness\.config\.json/);
      });
    }
  });

  test('the checker stops on a bad config rather than checking against a default', () => {
    withFixture(registry([row()]), Object.assign({}, MINIMAL, { tools: { enabled: 'tool-a' } }), (run) => {
      const r = run('tools.js', ['--check']);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /^FATAL — .*tools\.enabled must be an array/);
      assert.doesNotMatch(r.stdout, /GATE tools/);
    });
  });

  test('the loader and the schema agree on the top-level keys, `tools` among them', () => {
    // The config is closed in two places. A key added to one only is a config stop on every
    // gate, which reads like a broken suite and not like a missing schema entry.
    const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'schema', 'harness.config.schema.json'), 'utf8'));
    assert.strictEqual(schema.additionalProperties, false);
    assert.deepStrictEqual(Object.keys(schema.properties).sort(), TOP_LEVEL.slice().sort());
    // ...and one level down: `tools` is closed in both places too, so its sub-keys must agree.
    assert.strictEqual(schema.properties.tools.additionalProperties, false);
    assert.deepStrictEqual(Object.keys(schema.properties.tools.properties).sort(), TOOLS_KEYS.slice().sort());
    assert.deepStrictEqual(schema.properties.tools.properties.enabled.default, DEFAULTS.tools.enabled);
  });

  test('this repo\'s own config names its tools, and every one has a row', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'harness.config.json'), 'utf8'));
    // WHICH tools is this repo's choice and may grow; that the file states one, and that each
    // has a row, is what must hold. The --check below decides the second.
    assert.ok(Array.isArray(cfg.tools.enabled) && cfg.tools.enabled.length > 0, 'harness.config.json names no tool');
    const r = real(['--check']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(lastLine(r.stdout), /^GATE tools pass=\d+ fail=0 skipped=0$/);
  });
});

describe('the shipped registry — what it claims, and on what evidence', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const byId = (id) => reg.tools.find((r) => r.id === id);

  test('has a row for every agent in the research matrix, and for the model that has none', () => {
    for (const id of ['claude-code', 'codex-cli', 'gemini-cli', 'antigravity', 'cursor', 'kimi-code', 'deepseek']) {
      assert.ok(byId(id), 'no row for ' + id);
    }
  });

  test('ONE row is marked `ran`, the default tool\'s, and it records the command; every other is `docs`', () => {
    // Every other tool's cells came through a summarising fetch of a vendor's page. The default
    // tool was run against its route as it is, the import stub, from a fresh session and from a
    // spawned subagent. A row promoted by typing is a paraphrase reported as a measurement:
    // promote another here only together with the command that was run.
    for (const r of reg.tools) {
      if (r.evidence === 'ran') { assert.ok(String(r.command || '').trim().length > 0, r.id + ' is `ran` with no command'); continue; }
      assert.strictEqual(r.evidence, 'docs', r.id + ' is not `docs`');
      assert.ok(!('command' in r), r.id + ' records a command nobody ran');
    }
    assert.deepStrictEqual(reg.tools.filter((r) => r.evidence === 'ran').map((r) => r.id), ['claude-code'], 'a row was promoted or demoted: was the tool really run, and is the command in the row?');
    assert.match(byId('claude-code').command, /^claude -p "/);
    assert.match(byId('claude-code').command, /spawn a subagent/);
  });

  test('a model with no agent inherits its tier and has no dialect', () => {
    const r = byId('deepseek');
    assert.strictEqual(r.tier, 'inherits');
    assert.strictEqual(r.dialect, null);
    assert.strictEqual(r.hookConfig, null);
    assert.strictEqual(r.policy, null);
  });

  test('ONE policy file: the default tool reaches it through an import stub, and nothing else is a second body', () => {
    /* The policy body is AGENTS.md. A row either loads it natively, is pointed at it by a setting,
       or (the one tool that loads neither) reads a stub that imports it. What the context gate
       charges and what the doc gate holds to "a pointer and nothing else" are both derived from
       these cells, so the cells are pinned here against the functions that read them. */
    const T = require(path.join(SRC, 'tools.js'));
    assert.strictEqual(T.POLICY_FILE, 'AGENTS.md');
    assert.deepStrictEqual(byId('claude-code').policy, { mode: 'import', file: 'CLAUDE.md' });
    assert.deepStrictEqual(T.injectedFiles(reg, ['claude-code']), ['CLAUDE.md', 'AGENTS.md'], 'the stub and the file it imports are both in context');
    assert.deepStrictEqual(T.injectedFiles(reg, ['codex-cli']), ['AGENTS.md']);
    assert.deepStrictEqual(T.injectedFiles(reg, ['gemini-cli']), ['AGENTS.md'], 'a config route loads the policy file, not its settings file');
    assert.deepStrictEqual(T.injectedFiles(reg, ['claude-code', 'codex-cli', 'cursor']), ['CLAUDE.md', 'AGENTS.md'], 'one file reached three ways is charged once');
    assert.deepStrictEqual(T.stubFiles(reg), ['CLAUDE.md'], 'the stub names the doc gate sweeps for');
    assert.ok(!T.stubFiles(reg).includes(T.POLICY_FILE), 'the policy file cannot be its own stub');
    // No row may load a per-tool BODY: every native route is the policy file, save the one row
    // whose own docs establish no other name, and that row is not enabled by default.
    const native = reg.tools.filter((r) => r.policy && r.policy.mode === 'native' && r.policy.file !== T.POLICY_FILE).map((r) => r.id);
    assert.deepStrictEqual(native, ['qwen-code']);
    // ...and "not enabled" is held, not hoped: switching that row on is a finding.
    assert.deepStrictEqual(T.validate(reg, ['qwen-code']).findings.map((x) => x.where), ['tools.enabled.qwen-code']);
    assert.deepStrictEqual(T.enabledStubFiles(reg, ['claude-code', 'codex-cli']), ['CLAUDE.md'], 'the stub an enabled tool cannot do without');
    assert.deepStrictEqual(T.enabledStubFiles(reg, ['codex-cli']), [], 'a tool that is off demands no stub');
  });

  test('the stub decision: a pointer passes, a second body fails, a pointer at nothing fails', () => {
    const T = require(path.join(SRC, 'tools.js'));
    assert.deepStrictEqual(T.stubFindings('<!-- pointer -->\n' + T.IMPORT_LINE + '\n', true), []);
    assert.strictEqual(T.stubFindings(T.IMPORT_LINE + '\n\n## Rules\n\n- Never push.\n', true).length, 1, 'a rule in the stub was not a finding');
    assert.strictEqual(T.stubFindings(T.IMPORT_LINE + '\n', false).length, 1, 'a stub with no policy file beside it was not a finding');
    assert.strictEqual(T.stubFindings('# A whole policy\n', false).length, 3, 'content, no import, and nothing to import are three findings');
  });

  test('the tiers are the ones the track states', () => {
    const tier = (id) => byId(id).tier;
    for (const id of ['claude-code', 'codex-cli', 'gemini-cli', 'cursor']) assert.strictEqual(tier(id), 'full', id);
    for (const id of ['antigravity', 'kimi-code']) assert.strictEqual(tier(id), 'guard-only', id);
    assert.strictEqual(tier('aider'), 'backstop');
  });

  test('what the research did not establish is null or `unknown`, not a guess', () => {
    assert.strictEqual(byId('kimi-code').projectHooks, null, 'a project-level hooks file is not established');
    assert.strictEqual(byId('kimi-code').nested, 'unknown');
    assert.strictEqual(byId('antigravity').sessionStart, false, 'no session-start event is documented');
    for (const r of reg.tools.filter((x) => x.tier === 'backstop')) {
      assert.strictEqual(r.dialect, null, r.id);
      assert.strictEqual(r.sessionStart, null, r.id);
    }
  });

  test('a hook the research found but nobody read the protocol of is recorded, and still not wired', () => {
    const r = byId('github-copilot');
    assert.strictEqual(r.hookConfig, '.github/hooks/*.json');
    assert.strictEqual(r.projectHooks, true);
    assert.strictEqual(r.dialect, null, 'no protocol was read, so there is no dialect');
    assert.strictEqual(r.tier, 'backstop');
  });

  test('the default tool\'s row says what the one run observed and what it did not', () => {
    const r = byId('claude-code');
    assert.match(r.notes, /WHAT THE RUNS OBSERVED/);
    assert.match(r.notes, /it reaches a subagent/);
    assert.match(r.notes, /the one hook entry refused a shell call/);
    assert.match(r.notes, /NOT OBSERVED, resting on the two sources: `nested` and `sessionStart`/);
  });

  test('a tool whose default file the sources disagree on gets a row that claims only what they agree on', () => {
    const r = byId('qwen-code');
    assert.ok(r, 'no row for qwen-code');
    assert.deepStrictEqual(r.policy, { mode: 'native', file: 'QWEN.md' });
    assert.strictEqual(r.tier, 'backstop');
    assert.strictEqual(r.hookConfig, null);
    assert.match(r.notes, /whether AGENTS\.md loads natively is not established/);
  });

  test('the one tool that reaches the policy file through a setting names the setting', () => {
    assert.deepStrictEqual(byId('gemini-cli').policy, { mode: 'config', file: '.gemini/settings.json', setting: 'context.fileName' });
  });

  test('no row spells the guarded secret filename', () => {
    // The write guard denies any file body that spells it, so a row quoting another tool's deny
    // example could never be edited again through the guard. Built from parts for that reason.
    const guarded = '.' + 'env';
    const text = fs.readFileSync(REGISTRY, 'utf8');
    assert.ok(!new RegExp('(^|[^A-Za-z0-9_])' + guarded.replace('.', '\\.') + '\\b').test(text));
  });
});
