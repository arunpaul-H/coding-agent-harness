'use strict';
/* ============================================================
   guards.test.js — the hook guards, driven the way the runtime drives them.

   Every helper under test carries a --self-test, and a self-test can only prove
   the PURE half: decide() handed literals. What it cannot prove is the half a
   session actually depends on — that the SCRIPT, started as a process, reads a
   hook payload off stdin, finds its config, reads the disk, and prints a decision
   the runtime can parse while exiting 0. That path is the one that fails silently:
   a hook that never reaches node denies nothing and reports nothing, and a unit
   test of an un-exported function stays green throughout.

   So nothing here imports a helper. Each case spawns the real file with a payload
   on stdin and reads the decision back off stdout, in a throwaway root that has
   its own harness.config.json. The root matters: the config seam resolves the repo
   by walking up from the cwd, so a child started inside the fixture grades the
   fixture — and this repo's own config (which exempts its tracks directory from
   the figure rule, for one) is never the thing under test.

   NO GUARDED FILENAME IS SPELLED IN THIS FILE. The secret-file guard reads the
   whole tool_input of a Write as text, so a test file naming a guarded path could
   not be written by an agent in a repo where the guard is live. Every such name is
   assembled from halves (see DOTENV). The same goes for the token shapes: a
   literal specimen here would make this file the thing the scanners hunt.

   Run:  node --test "tests/guards.test.js"
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
const node = process.execPath;
const helper = (f) => path.join(REPO, 'scripts', 'harness', 'guards', f);

const ENV_GUARD = helper('env-guard.cjs');
const HYGIENE = helper('commit-hygiene.cjs');
const PHASE_GUARD = helper('phase-guard.cjs');
const STATUSLINE = path.join(REPO, '.claude', 'helpers', 'statusline.cjs');

/* ---------- names assembled, never spelled ---------- */

const DOTENV = '.' + 'env';
const envFile = (suffix) => (suffix ? DOTENV + '.' + suffix : DOTENV);
const GUARDED = [DOTENV, DOTENV + '.*'];
// The two Read denies a wildcard-free guarded path needs. Generated as literals, the
// way the helper generates them, so a near-miss spelling cannot pass for the real one.
const bothDenies = (p) => ['Read(./' + p + ')', 'Read(//**/' + p + ')'];

// Synthetic, assembled in halves, and shaped like one issuer family the scanner names.
const TOKEN = 'ghp' + '_' + 'Zq3NotARealCredential' + '0123456789' + 'fixtureQ';
const TOKEN_SHAPE = new RegExp('ghp' + '_[A-Za-z0-9]{20,}');
const carriesToken = (s) => TOKEN_SHAPE.test(String(s)) || String(s).includes(TOKEN.slice(6, 22));

// Assembled for the same reason: the phase guard reads the TEXT of every shell call, so
// a literal move-into-the-archive here would deny any heredoc that rewrites this file.
const ARCHIVE = 'docs/' + 'archive';

/* ---------- the fixture ---------- */

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/* Two ambient variables change what a child does, and neither may leak in:
   NODE_TEST_CONTEXT makes a nested `node --test` run nothing, and CLAUDE_PROJECT_DIR is
   the config seam's fallback root, so a child that inherited it could grade the
   enclosing repo instead of the fixture. */
function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_PROJECT_DIR;
  return Object.assign(env, extra || {});
}

function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

/**
 * A throwaway root with its own config. `overrides` is merged over a minimal valid
 * config; pass `null` for a root with NO config at all, which is the case every guard
 * has to survive without taking the session down.
 *
 * realpath, because the config seam compares against process.cwd(), and on a platform
 * whose temp directory is a symlink the child's cwd is the resolved path.
 */
function mkRoot(tag, overrides) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-guards-' + tag + '-')));
  made.push(dir);
  if (overrides !== null) {
    put(dir, 'harness.config.json', JSON.stringify(Object.assign({
      project: { name: 'fixture' },
      gates: [{ name: 'hygiene', command: 'node scripts/harness/guards/commit-hygiene.cjs --report' }],
      commitHygiene: {
        workDirs: ['scripts', 'tests', 'docs', '.claude'],
        rootAllow: ['README.md', 'harness.config.json', '.gitignore'],
      },
    }, overrides || {}), null, 2) + '\n');
  }
  return dir;
}

function run(root, script, args, stdin) {
  return spawnSync(node, [script].concat(args || []), {
    cwd: root, encoding: 'utf8', input: stdin === undefined ? '' : stdin,
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
  });
}

// The shape the runtime hands a PreToolUse hook. Built here rather than pasted so a
// payload change is one edit.
const hookPayload = (root, tool, input) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: root, session_id: 'test',
});

/** Drive a guard over stdin; returns hookSpecificOutput, or null when it said nothing. */
function hook(root, script, args, tool, input) {
  const r = run(root, script, args, hookPayload(root, tool, input));
  assert.strictEqual(r.status, 0, 'a guard failure must never take down the session: ' + r.stderr);
  const text = r.stdout.trim();
  return text ? JSON.parse(text).hookSpecificOutput : null;
}
const verdictOf = (h) => (h ? h.permissionDecision : null);
const reasonOf = (h) => String((h && h.permissionDecisionReason) || '');

function gitIn(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' failed: ' + r.stdout + r.stderr);
  return String(r.stdout);
}

/* ============================================================ */

describe('every guard helper ships a --self-test, and it passes', () => {
  // statusline.cjs is on this list. It decides nothing, but "one line whatever goes in"
  // is a property, and a property with no check is a hope.
  const selfTest = (script) => {
    const r = spawnSync(node, [script, '--self-test'], { cwd: REPO, encoding: 'utf8', input: '', env: cleanEnv() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS/m, r.stdout);
    assert.doesNotMatch(r.stdout, /^FAIL/m, r.stdout);
    return r.stdout;
  };
  test('statusline.cjs --self-test', () => { selfTest(STATUSLINE); });

  /* THE GUARDS DIRECTORY, READ OFF DISK, each against a FLOOR. A hard-coded list passes
     a new guard that has no self-test at all, and a bare PASS passes a self-test whose
     assertions were deleted. A floor, not an equality: adding checks is progress. */
  const FLOOR = {
    'commit-hygiene.cjs': 94, 'doc-frozen.cjs': 31, 'docs-lint.cjs': 101,
    'env-guard.cjs': 50, 'phase-guard.cjs': 71, 'skill-verify.cjs': 38,
    'spawn-guard.cjs': 31,
  };
  const guards = fs.readdirSync(helper('')).filter((f) => /\.(c|m)?js$/.test(f)).sort();
  test('every script in the guards directory has a floor recorded here', () => {
    assert.deepStrictEqual(guards, Object.keys(FLOOR).sort(), 'a guard was added or removed without its self-test floor');
  });
  for (const name of guards) {
    test(name + ' --self-test, at or above its floor', () => {
      const out = selfTest(helper(name));
      const m = out.match(/^PASS.*\((\d+) (?:checks|assertions)/m);
      assert.ok(m, 'the PASS line carries no count, so deleted assertions are invisible: ' + out);
      assert.ok(Number(m[1]) >= FLOOR[name], name + ' dropped to ' + m[1] + ' checks, below its floor of ' + FLOOR[name]);
    });
  }

  test('every harness script path a guard prints or names exists', () => {
    // A remediation line is a command somebody will paste. Read from the SHIPPED half of
    // each guard (everything above its self-test, whose fixtures name files that do not
    // exist on purpose), so a path left pointing at the old directory fails here.
    const PATHS = /(?:\.claude\/helpers|scripts\/harness)\/[\w./-]*\.(?:cjs|js)\b/g;
    let seen = 0;
    for (const name of guards) {
      const src = fs.readFileSync(helper(name), 'utf8');
      const cut = src.search(/^(?:async )?function selfTest\b/m);
      assert.ok(cut > 0, name + ' has no selfTest function to cut at');
      for (const rel of new Set(src.slice(0, cut).match(PATHS) || [])) {
        seen += 1;
        assert.ok(fs.existsSync(path.join(REPO, ...rel.split('/'))), name + ' names ' + rel + ', which does not exist');
      }
    }
    assert.ok(seen >= guards.length, 'the path scan matched almost nothing, so it proves nothing');
  });
});

/* ============================================================ */

describe('an unparseable payload never takes down the session, and is never a silent allow', () => {
  // The contract: an unreadable payload is an ASK. A guard a malformed call switches off
  // is switched off by exactly the call shape worth worrying about; a guard that exits
  // non-zero on one takes the session with it. Both halves are asserted, per guard.
  const root = mkRoot('unparseable');
  const cases = [
    ['env-guard.cjs', ENV_GUARD, []],
    ['commit-hygiene.cjs --gate', HYGIENE, ['--gate']],
    ['phase-guard.cjs', PHASE_GUARD, []],
  ];
  for (const [name, script, args] of cases) {
    test(name + ' exits 0 and asks', () => {
      for (const junk of ['}{ not json', 'not json at all', '{"tool_name":']) {
        const r = run(root, script, args, junk);
        assert.strictEqual(r.status, 0, name + ' exited ' + r.status + ' on ' + JSON.stringify(junk));
        assert.ok(r.stdout.trim(), name + ' allowed an unparseable payload in silence');
        const out = JSON.parse(r.stdout);
        assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
        assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'ask');
        assert.ok(!out.hookSpecificOutput.permissionDecisionReason.includes(junk),
          name + ' quoted the unreadable payload back into the transcript');
      }
    });
    test(name + ' says nothing about an EMPTY payload', () => {
      // No stdin at all is not a malformed call, it is no call. Asking here would put a
      // prompt in front of every tool the runtime starts without a payload.
      const r = run(root, script, args, '');
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.stdout.trim(), '');
    });
  }
});

/* ============================================================ */

describe('env-guard.cjs — the secret-file guard', () => {
  const root = mkRoot('env');
  const decide = (tool, input, at) => hook(at || root, ENV_GUARD, [], tool, input);

  test('a Read of a guarded file is intercepted, relative or absolute', () => {
    for (const p of [envFile('production'), path.join(root, envFile('production')), envFile(), envFile('local')]) {
      const out = decide('Read', { file_path: p });
      assert.ok(out, 'not intercepted: a Read of ' + path.basename(p));
      assert.strictEqual(out.permissionDecision, 'deny');
    }
  });

  test('the shell forms permissions.deny cannot see are intercepted too', () => {
    // permissions.deny blocks the Read TOOL by path. Every form below reaches the same
    // bytes without it, and that gap is the whole reason this hook exists.
    const f = envFile('production');
    const forms = [
      ['Bash', 'cat ' + f],
      ['Bash', 'grep -i key ' + f],
      ['Bash', 'head -n 5 ./' + f],
      ['Bash', 'node --env-file=' + f + ' app.js'],
      ['Bash', 'cd sub && cat ../' + f + ' | wc -l'],
      ['PowerShell', 'Get-Content .\\' + f],
      ['PowerShell', 'type ' + f],
    ];
    for (const [tool, command] of forms) {
      assert.strictEqual(verdictOf(decide(tool, { command })), 'deny', 'not intercepted: ' + tool + ' ' + command.replace(f, '<guarded>'));
    }
    assert.strictEqual(verdictOf(decide('Grep', { pattern: 'KEY', path: f })), 'deny', 'not intercepted: Grep');
    assert.strictEqual(verdictOf(decide('Edit', { file_path: f, old_string: 'a', new_string: 'b' })), 'deny', 'not intercepted: Edit');
    assert.strictEqual(verdictOf(decide('Write', { file_path: f, content: 'A=1' })), 'deny', 'not intercepted: Write');
  });

  test('a guarded name at the START OF A LINE is intercepted — the serialised-payload hole', () => {
    // The haystack was once JSON.stringify(tool_input). In that text a newline is the two
    // characters backslash-n, so a name on a line of its own was preceded by the letter `n`
    // and read as the tail of a longer word: a silent allow, in every tool, for a line
    // continuation, a here-document or a tab, while the one-line form was refused. Driven
    // through the real process and a real stdin payload, because the escaping that hid the
    // name happens on the way in.
    const f = envFile('production');
    const forms = [
      ['Bash', 'cat \\\n' + f],
      ['Bash', 'cat <<EOF\n' + f + '\nEOF'],
      ['Bash', 'grep -i key\t' + f],
      ['Bash', 'cd sub\n' + envFile()],
      ['PowerShell', 'Get-Content `\r\n' + f],
    ];
    for (const [tool, command] of forms) {
      assert.strictEqual(verdictOf(decide(tool, { command })), 'deny',
        'not intercepted: ' + tool + ' ' + JSON.stringify(command.split(f).join('<guarded>')));
    }
    assert.strictEqual(verdictOf(decide('Write', { file_path: 'notes.txt', content: 'see\n' + f + '\n' })), 'deny',
      'not intercepted: a name on a line of its own in written content');
    assert.strictEqual(verdictOf(decide('mcp__fs__batch', { [f]: { op: 'read' } })), 'deny',
      'not intercepted: a name spelled as a KEY of the payload');
    // The negative half. A fix that refused everything after a newline would pass the cases above.
    assert.strictEqual(decide('Bash', { command: 'cat \\\n' + envFile('example') }), null, 'the twin was blocked at the start of a line');
    assert.strictEqual(decide('Bash', { command: 'echo my\nenvironment' }), null, 'a longer word that starts a line was blocked');
  });

  test('it does NOT block its own recommended alternative', () => {
    // A guard that blocks the file it tells you to read instead trains people to click
    // through it. The deny message names these twins, so each one is driven here.
    for (const twin of [envFile('example'), envFile('template'), envFile('local.template'), envFile('production.sample'), envFile('dist')]) {
      assert.strictEqual(decide('Read', { file_path: twin }), null, twin + ' was blocked by Read');
      assert.strictEqual(decide('Bash', { command: 'cat ' + twin }), null, twin + ' was blocked by cat');
    }
    const reason = reasonOf(decide('Read', { file_path: envFile('production') }));
    assert.ok(reason.includes(envFile('example')), 'the refusal no longer names the alternative it leaves open');
  });

  test('ordinary work that merely looks similar is left alone', () => {
    const quiet = [
      ['Bash', { command: 'npm test' }],
      ['Bash', { command: 'echo "set the environment"' }],
      ['Read', { file_path: 'config/app.env' }],
      ['Read', { file_path: '.gitignore' }],
      ['Bash', { command: 'node -p process.env.PATH' }],
    ];
    for (const [tool, input] of quiet) assert.strictEqual(decide(tool, input), null, 'blocked: ' + JSON.stringify(input));
  });

  test('the refusal names the file and never another field of the payload', () => {
    // A tool_input may carry a credential in a field this guard has never heard of, and
    // a permissionDecisionReason is written into the transcript permanently.
    // A DISTINCTIVE name: the reason's fixed text always spells the bare name and its
    // twins, so a check for the bare name passes with the matched span dropped.
    const out = decide('mcp__vault__open', { file_path: envFile('production'), token: TOKEN });
    assert.strictEqual(verdictOf(out), 'deny');
    assert.ok(reasonOf(out).includes('This call names ' + envFile('production') + ','), 'the refusal does not say which file it refused');
    assert.ok(!carriesToken(JSON.stringify(out)), 'the refusal quoted a payload VALUE');
  });

  test('a dated carve-out opens exactly its path, and nothing beside it', () => {
    const open = mkRoot('env-carve', {
      env: { guarded: GUARDED, openCarveOuts: [{ path: envFile('local'), why: 'disposable local values', until: '2099-12-31' }] },
    });
    assert.strictEqual(decide('Bash', { command: 'cat ' + envFile('local') }, open), null, 'a live carve-out opened nothing');
    assert.strictEqual(verdictOf(decide('Bash', { command: 'cat ' + envFile() }, open)), 'deny', 'a carve-out opened the bare file too');
    assert.strictEqual(verdictOf(decide('Bash', { command: 'cat ' + envFile('production') }, open)), 'deny', 'a carve-out opened a sibling');
  });

  test('an EXPIRED carve-out re-arms the guard with nobody remembering', () => {
    // The date is the mechanism. A re-arm checklist owed at a future date is prose, and
    // prose is only acted on if somebody remembers on the day.
    const expired = mkRoot('env-expired', {
      env: { guarded: GUARDED, openCarveOuts: [{ path: envFile('local'), why: 'was disposable once', until: '2020-01-01' }] },
    });
    assert.strictEqual(verdictOf(decide('Bash', { command: 'cat ' + envFile('local') }, expired)), 'deny');
  });

  test('a repo with no config at all is guarded by the deny-all default, not left open', () => {
    const bare = mkRoot('env-bare', null);
    assert.strictEqual(verdictOf(decide('Bash', { command: 'cat ' + envFile('local') }, bare)), 'deny');
    assert.strictEqual(decide('Read', { file_path: envFile('example') }, bare), null);
  });
});

/* ============================================================ */

describe('env-guard.cjs --rearm-check — a hole is reported for as long as it exists', () => {
  // Driven as a real process against a throwaway root. --self-test covers the pure
  // decision; what it cannot cover is the half that reads the config and settings.json
  // off the disk and emits SessionStart JSON.
  const BOTH = bothDenies(DOTENV);
  const CARVE = { path: envFile('local'), why: 'disposable local values', until: '2099-12-31' };

  const scratch = (deny, carveOuts) => {
    const root = mkRoot('rearm', { env: { guarded: GUARDED, openCarveOuts: carveOuts || [] } });
    put(root, '.claude/settings.json', JSON.stringify({ permissions: { deny } }));
    return root;
  };
  const check = (root) => {
    const r = run(root, ENV_GUARD, ['--rearm-check'], '');
    assert.strictEqual(r.status, 0, 'a SessionStart hook that exits non-zero takes the session with it');
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };

  test('it says nothing at all while the stance is whole', () => {
    // A hook that talks before it has anything to say gets muted long before the one
    // session where it matters.
    assert.strictEqual(check(scratch(BOTH, [])), null, 'the report fired with both denies present and no carve-out');
  });

  test('a carve-out is reported at SessionStart while it exists, and silent once removed', () => {
    const root = scratch(BOTH, [CARVE]);
    const out = check(root);
    assert.ok(out, 'an open carve-out went unreported');
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
    const text = out.hookSpecificOutput.additionalContext;
    assert.ok(text.includes('OPEN carve-out ' + CARVE.path), 'the report does not name the open path: ' + text);
    assert.ok(text.includes('until ' + CARVE.until), 'the report does not name the expiry date');
    assert.ok(text.includes(CARVE.why), 'the report dropped the reason the carve-out gives');
    assert.ok(out.systemMessage, 'no systemMessage — the warning would be context-only');

    // Every session, not once: the second start says the same thing.
    assert.ok(check(root), 'the carve-out was reported once and then went quiet');

    const cfgFile = path.join(root, 'harness.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.env.openCarveOuts = [];
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    assert.strictEqual(check(root), null, 'the report still fires after the carve-out was removed, which trains people to ignore it');
  });

  test('an expired carve-out is named as expired, not as open', () => {
    const out = check(scratch(BOTH, [{ path: envFile('local'), why: 'was disposable once', until: '2020-01-01' }]));
    assert.ok(out, 'an expired carve-out left in the config went unreported');
    assert.match(out.hookSpecificOutput.additionalContext, /EXPIRED carve-out/);
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /OPEN carve-out/);
  });

  test('half a re-arm is not a re-arm', () => {
    // Each spelling blocks a call shape the other misses, so one entry present still
    // leaves an open path to the file. The report must name the one that is MISSING.
    const onlyDot = check(scratch([BOTH[0]], []));
    assert.ok(onlyDot, 'only the ./ deny was accepted as armed');
    assert.ok(onlyDot.hookSpecificOutput.additionalContext.includes(BOTH[1]), 'the report does not name the missing glob spelling');
    assert.ok(!onlyDot.hookSpecificOutput.additionalContext.includes(BOTH[0] + ','), 'the report lists the spelling that is present as missing');

    const onlyGlob = check(scratch([BOTH[1]], []));
    assert.ok(onlyGlob, 'only the glob deny was accepted as armed');
    assert.ok(onlyGlob.hookSpecificOutput.additionalContext.includes(BOTH[0]), 'the report does not name the missing ./ spelling');

    const neither = check(scratch(['Bash(node -e*)'], []));
    assert.ok(neither, 'a deny list with neither spelling was accepted as armed');
    assert.match(neither.hookSpecificOutput.additionalContext, /missing 2 of the 2/);
  });

  test('a settings.json it cannot parse is the unguarded case, not an excuse', () => {
    const root = scratch(BOTH, []);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), 'not json at all');
    assert.ok(check(root), 'an unreadable settings.json silenced the report');
  });

  test('a config it cannot read is itself reported', () => {
    const root = scratch(BOTH, []);
    fs.writeFileSync(path.join(root, 'harness.config.json'), '{ not json');
    const out = check(root);
    assert.ok(out, 'a guard running on its built-in default said nothing about it');
    assert.match(out.hookSpecificOutput.additionalContext, /harness\.config\.json could not be read/);
  });
});

/* ============================================================ */

describe('commit-hygiene.cjs — the commit gate', () => {
  const COMMIT = { command: 'git commit -m "x"' };

  /** A real repository with one ignored settings file and, optionally, one stray. */
  const repo = (tag, opts) => {
    const o = opts || {};
    const root = mkRoot(tag);
    gitIn(root, '-c', 'init.defaultBranch=main', 'init', '-q');
    put(root, '.gitignore', '.claude/settings.local.json\n');
    put(root, '.claude/settings.local.json', '{"env":{}}\n');
    if (o.stray) put(root, 'h.matcher', ''); // 0-byte: what a mis-quoted arrow leaves behind
    return root;
  };
  const gate = (root, tool, input) => hook(root, HYGIENE, ['--gate'], tool, input);
  const cli = (root, args) => run(root, HYGIENE, args, '');
  const gateLine = (stdout) => String(stdout).trimEnd().split('\n').pop();
  const GATE = /^GATE hygiene pass=(\d+) fail=(\d+) skipped=(\d+)$/;
  const total = (line) => { const m = line.match(GATE); return m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : NaN; };

  test('a call that is not a commit or a push is never blocked, even over a dirty tree', () => {
    const root = repo('hygiene-quiet', { stray: true });
    // The fixture has to be DIRTY, or "not blocked" proves nothing.
    assert.strictEqual(verdictOf(gate(root, 'Bash', COMMIT)), 'deny', 'the fixture is wrong: a commit over a stray was allowed');
    for (const command of ['ls -la', 'git status', 'git diff --stat', 'git log --grep=commit', 'npm run build', 'echo commit and push']) {
      assert.strictEqual(gate(root, 'Bash', { command }), null, command + ' was decided on by the commit gate');
    }
    assert.strictEqual(gate(root, 'Read', { file_path: 'README.md' }), null);
    assert.strictEqual(verdictOf(gate(root, 'PowerShell', { command: 'git push' })), 'deny', 'a push from the other shell was allowed');
  });

  test('--report is a real verdict: exit 0 clean, exit 1 with findings, GATE line last', () => {
    const root = repo('hygiene-report');
    const clean = cli(root, ['--report']);
    assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /^Commit hygiene: clean/);
    assert.match(gateLine(clean.stdout), GATE);
    assert.match(gateLine(clean.stdout), / fail=0 skipped=0$/);

    put(root, 'h.matcher', '');
    const dirty = cli(root, ['--report']);
    assert.strictEqual(dirty.status, 1, 'a tree with a stray reported exit ' + dirty.status);
    assert.match(dirty.stdout, /h\.matcher/);
    assert.match(gateLine(dirty.stdout), / fail=1 skipped=0$/);
    // The total is structural: a finding moves a check from pass to fail, it does not
    // add one. A total that grew with the findings could not tell red from vanished.
    assert.strictEqual(total(gateLine(dirty.stdout)), total(gateLine(clean.stdout)));
    assert.ok(total(gateLine(clean.stdout)) > 0, 'the GATE line reports no checks at all');
  });

  test('--report over a tree it cannot read is skipped and red, never green', () => {
    const notARepo = mkRoot('hygiene-norepo');
    const r = cli(notARepo, ['--report']);
    assert.strictEqual(r.status, 1, 'a check that could not run exited ' + r.status);
    assert.match(gateLine(r.stdout), /^GATE hygiene pass=0 fail=0 skipped=[1-9]\d*$/);
  });

  test('--report ignores a waiver: a waiver is for a commit, not for a verdict', () => {
    const root = repo('hygiene-report-waived', { stray: true });
    assert.match(cli(root, ['--clear', 'deliberate placeholder']).stdout, /^Cleared 1 finding/);
    assert.strictEqual(gate(root, 'Bash', COMMIT), null, 'the fixture is wrong: the waiver did not take');
    assert.strictEqual(cli(root, ['--report']).status, 1, 'a waived finding read as a clean tree');
  });

  test('--clear needs a reason, and writes nothing for a tree with nothing to waive', () => {
    const root = repo('hygiene-clear');
    assert.strictEqual(cli(root, ['--clear']).status, 2, 'a waiver with no reason was accepted');
    const none = cli(root, ['--clear', 'nothing to see']);
    assert.strictEqual(none.status, 0);
    assert.match(none.stdout, /^Nothing to clear/);
    assert.ok(!fs.existsSync(path.join(root, '.claude', '.commit-hygiene-clearance.json')),
      'a waiver for nothing was left on disk, waiting to match a future tree');
  });

  describe('a waiver cannot outlive a token pasted into a settings file', () => {
    // The settings-file rule reads a file `git status` never reports, by design. A waiver
    // bound to status alone therefore survives a token being pasted in: the report shows
    // the BLOCK while the gate lets the commit through. Deleting one line of the helper
    // restores that with a green self-test, which is why it is driven here as a process.
    const status = (root) => gitIn(root, 'status', '--porcelain=v1');
    const paste = (root) => put(root, '.claude/settings.local.json', '{"env":{"SERVICE_TOKEN":"' + TOKEN + '"}}\n');

    test('pasting a token voids the outstanding waiver and the gate denies', () => {
      const root = repo('hygiene-waiver', { stray: true });
      assert.match(cli(root, ['--clear', 'deliberate stray']).stdout, /^Cleared 1 finding/);
      assert.strictEqual(gate(root, 'Bash', COMMIT), null, 'the waiver did not even cover the stray it was granted for');

      const before = status(root);
      paste(root);
      assert.strictEqual(status(root), before, 'the fixture is wrong: git status must NOT see this file, or the test proves nothing');

      const out = gate(root, 'Bash', COMMIT);
      assert.ok(out, 'a waiver granted BEFORE the paste still suppressed the token BLOCK');
      assert.strictEqual(out.permissionDecision, 'deny');
      assert.ok(reasonOf(out).includes('.claude/settings.local.json'), 'the refusal does not name the file');
      // The waiver command it prints is one somebody will paste: it has to exist.
      const cmd = reasonOf(out).match(/node (\S+\.cjs) --clear/);
      assert.ok(cmd, 'the refusal no longer prints the --clear command');
      assert.ok(fs.existsSync(path.join(REPO, ...cmd[1].split('/'))), 'the refusal prints a command that does not exist: ' + cmd[1]);
      assert.ok(!carriesToken(JSON.stringify(out)), 'the deny message quoted the value it found');
    });

    test('the finding stays waivable — the binding voids waivers, it does not ban them', () => {
      const root = repo('hygiene-waivable', { stray: true });
      paste(root);
      assert.strictEqual(verdictOf(gate(root, 'Bash', COMMIT)), 'deny', 'the token finding did not block at all');
      const cleared = cli(root, ['--clear', 'synthetic fixture token, not a credential']);
      assert.match(cleared.stdout, /^Cleared 2 finding/);
      assert.ok(!carriesToken(cleared.stdout + cleared.stderr), '--clear quoted the value');
      assert.strictEqual(gate(root, 'Bash', COMMIT), null, 'a finding that was read and waived must still be waivable');
      // ...and that waiver is bound too: a different stray voids it.
      put(root, 'another', '');
      assert.strictEqual(verdictOf(gate(root, 'Bash', COMMIT)), 'deny', 'a waiver survived a new stray');
    });

    test('--report names the file and never the value', () => {
      const root = repo('hygiene-report-secret');
      paste(root);
      const r = cli(root, ['--report']);
      assert.strictEqual(r.status, 1, 'a literal credential in a settings file went unreported');
      assert.match(r.stdout, /settings\.local\.json/);
      assert.ok(!carriesToken(r.stdout + r.stderr), 'the report quoted the value it found');
    });

    test('a documentation twin is quiet on its PLACEHOLDER, not on its name', () => {
      // Two directions. A settings.example.json holding the documented placeholder must
      // not fire — a guard firing on its own recommended alternative gets clicked
      // through. And excusing the twin BY NAME hides the worse case: that file is
      // tracked, so a real token in it is committed and pushed.
      const root = repo('hygiene-twin');
      const twin = '.claude/settings.example.json';
      put(root, twin, '{"env":{"SERVICE_TOKEN":"' + 'sk' + '-your_personal_access_token_here"}}\n');
      const clean = cli(root, ['--report']);
      assert.strictEqual(clean.status, 0, clean.stdout);
      assert.match(clean.stdout, /^Commit hygiene: clean/);

      put(root, twin, '{"env":{"SERVICE_TOKEN":"${SERVICE_TOKEN}"}}\n');
      assert.strictEqual(cli(root, ['--report']).status, 0, 'the recommended fix — an interpolated reference — tripped the rule');

      put(root, twin, '{"env":{"SERVICE_TOKEN":"' + TOKEN + '"}}\n');
      const dirty = cli(root, ['--report']);
      assert.strictEqual(dirty.status, 1, 'a real token in a TRACKED settings.example.json went unreported — the worse home');
      assert.match(dirty.stdout, /settings\.example\.json/);
      assert.ok(!carriesToken(dirty.stdout), 'the report quoted the value it found');
    });
  });
});

/* ============================================================ */

describe('phase-guard.cjs — the close-phase gate', () => {
  const FM = (kind, status) => '---\nid: fixture\nkind: ' + kind + '\nstatus: ' + status + '\n---\n# fixture\n';
  const decideIn = (root, tool, input, bin) => hook(root, bin || PHASE_GUARD, [], tool, input);
  const denied = (h) => (verdictOf(h) === 'deny' ? reasonOf(h) : '');

  test('a bare mv into the archive directory is denied', () => {
    const root = mkRoot('phase-d1');
    const moves = [
      ['Bash', 'git mv docs/tracks/fixture ' + ARCHIVE + '/fixture'],
      ['Bash', 'mv docs/tracks/fixture ' + ARCHIVE],
      ['Bash', 'mv docs/tracks/fixture ' + ARCHIVE + '/'],
      ['PowerShell', 'Move-Item docs\\tracks\\fixture ' + ARCHIVE.replace('/', '\\')],
    ];
    for (const [tool, command] of moves) {
      assert.match(denied(decideIn(root, tool, { command })), /^D1/, 'allowed: ' + tool + ' ' + command);
    }
    // The negative half: reading the archive, the sanctioned close, and a sibling
    // directory that merely shares a prefix are none of them a move into it.
    for (const command of ['ls ' + ARCHIVE, 'node scripts/harness/close-phase.js fixture --archive',
      'mv docs/tracks/fixture ' + ARCHIVE + 's/fixture', 'mv notes/a.txt notes/b.txt']) {
      assert.strictEqual(decideIn(root, 'Bash', { command }), null, 'decided on: ' + command);
    }
  });

  test('a status: flip in a track doc is denied, and the prior status comes off the disk', () => {
    // A WRITE is the shape that reads: with no old_string the prior status can only come
    // from the file, and where there is no file there is no prior status and so no flip.
    const root = mkRoot('phase-d2');
    const rel = 'docs/tracks/fixture/README.md';
    put(root, rel, FM('track', 'open'));
    const flipped = FM('track', 'complete');
    const out = decideIn(root, 'Write', { file_path: rel, content: flipped });
    assert.match(denied(out), /^D2/);
    assert.match(reasonOf(out), /open -> complete/, 'the refusal does not say what the status was — it did not read the disk');
    // The absolute spelling a real tool call carries reaches the same file.
    assert.match(denied(decideIn(root, 'Write', { file_path: path.join(root, ...rel.split('/')), content: flipped })), /^D2/,
      'an absolute path to the same doc got past the rule');
    assert.match(denied(decideIn(root, 'Edit', { file_path: rel, old_string: 'status: open', new_string: 'status: complete' })), /^D2/);
    assert.match(denied(decideIn(root, 'Bash', { command: "sed -i 's/status: open/status: complete/' " + rel })), /^D2/);

    fs.rmSync(path.join(root, ...rel.split('/')));
    assert.strictEqual(decideIn(root, 'Write', { file_path: rel, content: flipped }), null,
      'with nothing on disk there is no status to flip, so the same write must be allowed');
  });

  test('rewriting a track doc with its status unchanged is NOT denied', () => {
    // The negative case is the one that matters: a guard that blocks ordinary work gets
    // removed. The doc is a real one on disk, carrying the status the write repeats —
    // the only shape in which a guard that pattern-matched instead of reading the disk
    // would deny.
    const root = mkRoot('phase-keep');
    const rel = 'docs/tracks/fixture/handoff.md';
    put(root, rel, FM('handoff', 'open') + '\nbody\n');
    assert.strictEqual(decideIn(root, 'Write', { file_path: rel, content: FM('handoff', 'open') + '\na wholly new body\n' }), null);
    assert.strictEqual(decideIn(root, 'Edit', { file_path: rel, old_string: 'body', new_string: 'a new body' }), null);
    assert.strictEqual(decideIn(root, 'Bash', { command: 'grep -n "status: open" ' + rel }), null, 'reading a status was taken for writing one');
  });

  test('a hand-typed receipt is denied', () => {
    const root = mkRoot('phase-receipt');
    const rel = 'docs/tracks/fixture/README.md';
    put(root, rel, FM('track', 'open'));
    assert.match(denied(decideIn(root, 'Write', { file_path: rel, content: '---\nid: fixture\nkind: track\nstatus: open\nreceipt: deadbeef\n---\n# fixture\n' })), /^D2/);
  });

  describe('a gate figure in a governed doc', () => {
    // Synthetic figures: `42/42` stands in for one the current verdict carries and
    // `999/999` for one it never did. Neither is a measurement of any tree.
    const REAL_TAG = '<!-- figure-ok: dated phase record, not a current figure -->';
    const withDocs = (overrides) => {
      const root = mkRoot('phase-figure', overrides);
      put(root, 'scripts/harness/gates.json', JSON.stringify({ gates: { test: { pass: 42, total: 42 } } }));
      put(root, 'docs/tracks/fixture/plan.md', FM('plan', 'open'));
      put(root, 'docs/tracks/fixture/tagged.md', FM('track', 'open') + REAL_TAG + '\n');
      put(root, 'docs/tracks/fixture/bare.md', FM('track', 'open') + '<!-- figure-ok -->\n');
      put(root, 'docs/tracks/fixture/short.md', FM('track', 'open') + '<!-- figure-ok: why -->\n');
      put(root, 'docs/tracks/fixture/quoted.md', FM('track', 'open') + 'tag it `' + REAL_TAG + '` like so\n');
      return root;
    };
    const add = (root, doc, figure, bin) => decideIn(root, 'Edit',
      { file_path: 'docs/tracks/fixture/' + doc, old_string: 'a', new_string: 'smoke ' + figure + ' green' }, bin);

    test('is denied, sourced or not — and the message says which', () => {
      // What D3 reads is gates.json, and that read is what "sourced or not" means. Both
      // are denied; asserting WHICH message came back is what keeps the sourced branch
      // from being coverage on paper.
      const root = withDocs();
      assert.match(denied(add(root, 'plan.md', '42/42')), /^D3[\s\S]*a real figure from the current gates\.json/, 'a sourced figure was allowed into a doc');
      assert.match(denied(add(root, 'plan.md', '999/999')), /^D3[\s\S]*in no gates\.json row at all/, 'an invented figure was allowed into a doc');
      assert.match(denied(decideIn(root, 'Write', { file_path: 'CLAUDE.md', content: 'gates 999/999' })), /^D3/, 'a figure reached an always-on file');
      assert.match(denied(decideIn(root, 'Bash', { command: 'echo "smoke 999/999" >> docs/tracks/fixture/plan.md' })), /^D3/, 'a shell redirect carried a figure in');
    });

    test('is not denied where it is not a gate figure, or not a governed doc', () => {
      const root = withDocs();
      assert.strictEqual(add(root, 'plan.md', 'step 1/3'), null, 'a one-digit ratio was read as a gate figure');
      assert.strictEqual(add(root, 'plan.md', 'quoted `999/999` in a span'), null, 'a figure QUOTED in a code span was read as asserted');
      assert.strictEqual(decideIn(root, 'Write', { file_path: 'src/report.js', content: '// 999/999' }), null, 'a source file is not a governed doc');
      assert.strictEqual(decideIn(root, 'Write', { file_path: 'docs/tracks/fixture/research/2026-01-01-x.md', content: '---\nid: r\nkind: research\nstatus: frozen\n---\nmeasured 999/999\n' }), null,
        'frozen evidence was denied the figures that ARE its finding');
    });

    test('is denied unless figure-ok carries a reason', () => {
      const root = withDocs();
      assert.strictEqual(add(root, 'tagged.md', '999/999'), null,
        'a doc carrying a real reasoned tag was denied — every tagged doc in a tree just became illegal');
      assert.match(denied(add(root, 'bare.md', '999/999')), /^D3/, 'a bare tag granted the exemption: a reflex, not a decision');
      assert.match(denied(add(root, 'short.md', '999/999')), /^D3/, 'a one-word reason granted the exemption');
      assert.match(denied(add(root, 'quoted.md', '999/999')), /^D3/, 'a tag SHOWN in a code span granted a real exemption');
      // The tag may arrive in the same write as the figure it excuses.
      assert.strictEqual(decideIn(root, 'Write', { file_path: 'docs/tracks/fixture/plan.md', content: FM('plan', 'open') + REAL_TAG + '\nsmoke 999/999\n' }), null);
    });

    test('the refusal tells the reader the reason is required', () => {
      const reason = denied(add(withDocs(), 'plan.md', '999/999'));
      assert.match(reason, /figure-ok/);
      assert.match(reason, /reason is required/);
    });

    test('the guard never denies what the linter exempts: the exempt list is the config\'s', () => {
      // One predicate, two configs. A repo that exempts its tracks directory from the doc
      // rules exempts it here too, because the linter does — a hook that denies what the
      // lint accepts leaves a rule with no legal move.
      const strict = withDocs();
      const exempting = withDocs({ docs: { exemptDirs: ['docs/tracks'] } });
      assert.match(denied(add(strict, 'plan.md', '999/999')), /^D3/);
      assert.strictEqual(add(exempting, 'plan.md', '999/999'), null);
    });

    test('the guard reads the tag from the shared file, not from a copy of the pattern', () => {
      // Driven, not grepped: a mutated shared predicate must change the guard's verdict,
      // which it cannot do if the guard carries its own spelling. The guard is COPIED
      // beside a mutated doc-frozen.cjs and run from there as a process.
      const root = withDocs();
      const copy = (from, rel) => put(root, rel, fs.readFileSync(from, 'utf8'));
      copy(path.join(REPO, 'scripts', 'harness', 'config.js'), 'scripts/harness/config.js');
      const bin = copy(PHASE_GUARD, 'scripts/harness/guards/phase-guard.cjs');
      const src = fs.readFileSync(helper('doc-frozen.cjs'), 'utf8');

      put(root, 'scripts/harness/guards/doc-frozen.cjs', src);
      assert.strictEqual(add(root, 'tagged.md', '999/999', bin), null, 'the fixture is wrong: the unmutated copy denies a tagged doc');

      const mutated = src.replace(/^const hasFigureOk = .*$/m, 'const hasFigureOk = () => false;');
      assert.notStrictEqual(mutated, src, 'the mutation did not apply — this test proves nothing');
      put(root, 'scripts/harness/guards/doc-frozen.cjs', mutated);
      assert.match(denied(add(root, 'tagged.md', '999/999', bin)), /^D3/,
        'neutering the SHARED predicate did not change the guard: it carries its own copy');

      // And with the shared file gone the guard asks rather than guessing either way.
      fs.rmSync(path.join(root, 'scripts', 'harness', 'guards', 'doc-frozen.cjs'));
      const missing = add(root, 'plan.md', '999/999', bin);
      assert.strictEqual(verdictOf(missing), 'ask', 'a missing shared predicate was resolved by a guess');
      assert.match(reasonOf(missing), /^D5/);
    });
  });

  test('an unrelated call is left alone', () => {
    const root = mkRoot('phase-quiet');
    assert.strictEqual(decideIn(root, 'Bash', { command: 'npm run build' }), null);
    assert.strictEqual(decideIn(root, 'Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' }), null);
    assert.strictEqual(decideIn(root, 'Write', { file_path: 'docs/reference/x.md', content: '---\nid: x\nstatus: complete\n---\n' }), null,
      'a reference doc is not a track doc');
  });

  test('a repo with no config is guarded at the conventional paths, not left open', () => {
    const bare = mkRoot('phase-bare', null);
    assert.match(denied(decideIn(bare, 'Bash', { command: 'mv docs/tracks/fixture ' + ARCHIVE + '/fixture' })), /^D1/);
  });
});

/* ============================================================ */

describe('an mcp__ tool call reaches every PreToolUse guard', () => {
  /* Widening a matcher is one line and is NOT the fix: a widened matcher hands each guard
     a shape it may not be able to read. The three read differently, and asserting one
     verdict for all three would be the pattern match this block exists to stop:
       env-guard       serialises the whole tool_input, so it decides on any shape.
       commit-hygiene  reads tool_input.command and never tool_name.
       phase-guard     offers the payload to both native shapes, and ASKS when it carries
                       nothing either can read. */
  const settings = JSON.parse(fs.readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8'));
  const pre = (settings.hooks && settings.hooks.PreToolUse) || [];
  // What each guard decides from, which is what the registration has to hand it.
  const NATIVE = {
    'env-guard.cjs': ['Bash', 'PowerShell', 'Read', 'Grep', 'Glob', 'Edit', 'Write'],
    'commit-hygiene.cjs': ['Bash', 'PowerShell'],
    'phase-guard.cjs': ['Bash', 'PowerShell', 'Edit', 'Write'],
  };
  const commandsOf = (entry) => (entry.hooks || []).map((h) => String(h.command));
  const matches = (matcher, tool) => new RegExp('^(?:' + matcher + ')$').test(tool);

  /* THE REGISTERED COMMAND, RUN. How many registrations there are is plumbing, and this block
     once pinned that there were three. The property is that a call REACHES a guard, so every
     case below starts the command the settings file actually names, for a tool its matcher
     actually matches, and reads the decision and the exit code back. A registration that
     stopped handing a guard its calls fails here whatever shape the file has. */
  const registered = (tool) => {
    const hit = pre.filter((e) => matches(String(e.matcher), tool));
    assert.ok(hit.length > 0, 'no PreToolUse registration matches ' + tool + ', so no guard sees that call');
    return hit.flatMap(commandsOf).map((c) => {
      const rel = (c.match(/CLAUDE_PROJECT_DIR(?::-\.)?\}?\/([^"\s]+)/) || [])[1];
      assert.ok(rel, 'cannot read the script path out of: ' + c);
      return { script: path.join(REPO, ...rel.split('/')), args: c.slice(c.indexOf(rel) + rel.length).replace(/^"/, '').trim().split(/\s+/).filter(Boolean) };
    });
  };
  /** Every registered command for this tool, run on one payload. Returns the strongest decision. */
  const reach = (root, tool, input) => {
    let best = null;
    for (const { script, args } of registered(tool)) {
      const r = run(root, script, args, hookPayload(root, tool, input));
      const out = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
      const decision = out ? out.permissionDecision : null;
      // A deny is the JSON AND exit code 2; anything else exits 0.
      assert.strictEqual(r.status, decision === 'deny' ? 2 : 0, 'exit ' + r.status + ' with decision ' + decision + ' for ' + tool + ': ' + r.stderr);
      if (decision === 'deny' || (decision === 'ask' && !best)) best = out;
    }
    return best;
  };

  test('the registration hands over every tool a guard decides on, and mcp__ as well', () => {
    assert.ok(pre.length >= 1, 'no PreToolUse registration at all');
    const everyNative = [...new Set(Object.values(NATIVE).flat())];
    // Named is not the same as matched: the matcher is a pattern, so it is RUN.
    for (const tool of everyNative.concat(['mcp__fs__write_file', 'mcp__shell__exec', 'mcp__some-server__any_tool'])) {
      assert.ok(pre.some((e) => matches(String(e.matcher), tool)), 'no PreToolUse matcher hands over ' + tool);
    }
    for (const entry of pre) {
      for (const c of commandsOf(entry)) assert.match(c, /scripts\/harness\/hook\.js" --tool \S+ --event pre-tool$/, 'a PreToolUse command that is not the one entry: ' + c);
    }
    // BOTH registrations, each held to its own event and to the row whose hook config IS this
    // file. A session-start line naming the pre-tool event runs no reporter, and one naming
    // another row's id leaves the deny list below unread; both exit 0 and say nothing.
    const starts = (settings.hooks && settings.hooks.SessionStart) || [];
    assert.ok(starts.length >= 1, 'no SessionStart registration at all');
    const rows = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'harness', 'tools.json'), 'utf8')).tools;
    for (const [list, event] of [[pre, 'pre-tool'], [starts, 'session-start']]) {
      for (const entry of list) {
        for (const c of commandsOf(entry)) {
          const m = /scripts\/harness\/hook\.js" --tool (\S+) --event (\S+)$/.exec(c);
          assert.ok(m, 'a registered command that is not the one entry: ' + c);
          assert.strictEqual(m[2], event, 'registered under the wrong event: ' + c);
          const row = rows.find((r) => r.id === m[1]);
          assert.ok(row, '--tool names no registry row: ' + c);
          assert.strictEqual(row.hookConfig, '.claude/settings.json', '--tool names a row that keeps its hooks in another file: ' + c);
        }
      }
    }
    // ...and the entry names every guard, which is what makes each of them wired at all.
    const entrySrc = fs.readFileSync(path.join(REPO, 'scripts', 'harness', 'hook.js'), 'utf8');
    for (const g of Object.keys(NATIVE)) assert.ok(entrySrc.includes('./guards/' + g), 'the hook entry does not load ' + g);
  });

  describe('every guard runs for a shell call, a file call and an MCP call', () => {
    /* One payload per guard per kind of call, each chosen so that ONLY that guard refuses it:
       the decision and the first words of the reason say which guard spoke. The commit gate
       has no file case because it decides from a command and nothing else; a file call carries
       none, and that guard never was handed one. Its two kinds are both here. */
    const docs = () => {
      const root = mkRoot('reach');
      put(root, 'docs/tracks/fixture/plan.md', '---\nid: fixture\nkind: plan\nstatus: open\n---\n# fixture\n');
      return root;
    };
    const staged = () => {
      const root = mkRoot('reach-git');
      gitIn(root, '-c', 'init.defaultBranch=main', 'init', '-q');
      put(root, 'scripts/harness/gates.baseline.json', '{}\n');
      gitIn(root, 'add', 'scripts/harness/gates.baseline.json');
      return root;
    };
    const sneak = { command: 'git commit -m "chore: sneak a re-baseline"' };
    const plan = 'docs/tracks/fixture/plan.md';
    const CASES = [
      ['env-guard', 'a shell call', docs, 'Bash', { command: 'cat ' + envFile('local') }, 'deny', /SECRET FILE GUARD/],
      ['env-guard', 'a file call', docs, 'Read', { file_path: '/repo/' + envFile() }, 'deny', /SECRET FILE GUARD/],
      ['env-guard', 'a search call', docs, 'Grep', { pattern: 'KEY', path: envFile('production') }, 'deny', /SECRET FILE GUARD/],
      ['env-guard', 'an MCP call', docs, 'mcp__fs__read', { target: '/repo/' + envFile('production') }, 'deny', /SECRET FILE GUARD/],
      ['commit-hygiene', 'a shell call', staged, 'Bash', sneak, 'deny', /GATE BASELINE RE-BASELINE/],
      ['commit-hygiene', 'an MCP call', staged, 'mcp__git__run', sneak, 'deny', /GATE BASELINE RE-BASELINE/],
      ['phase-guard', 'a shell call', docs, 'Bash', { command: 'git mv docs/tracks/fixture ' + ARCHIVE + '/fixture' }, 'deny', /^D1/],
      ['phase-guard', 'a file call', docs, 'Write', { file_path: plan, content: '---\nid: fixture\nkind: plan\nstatus: complete\n---\n' }, 'deny', /^D2/],
      ['phase-guard', 'a write of the run-mode receipt', docs, 'Write', { file_path: 'docs/tracks/fixture/.phase', content: '{"track":"fixture","phase":1,"mode":"fully-auto"}' }, 'deny', /^D6/],
      ['phase-guard', 'an MCP call it can read', docs, 'mcp__fs__write_file', { file_path: plan, content: 'smoke 999/999 green' }, 'deny', /^D3/],
      ['phase-guard', 'an MCP call it cannot', docs, 'mcp__db__execute_sql', { query: 'drop table widgets;' }, 'ask', /^D4/],
    ];
    for (const [who, kind, mk, tool, input, want, why] of CASES) {
      test(who + ' decides ' + kind + ' (' + tool + ')', () => {
        const out = reach(mk(), tool, input);
        assert.ok(out, who + ' never saw ' + kind + ': the call was allowed in silence');
        assert.strictEqual(out.permissionDecision, want);
        assert.match(out.permissionDecisionReason, why, 'another guard answered, or none did');
      });
    }

    test('and ordinary work of each kind reaches all three and is left alone', () => {
      const root = docs();
      assert.strictEqual(reach(root, 'Bash', { command: 'npm run build' }), null);
      assert.strictEqual(reach(root, 'Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' }), null);
      assert.strictEqual(reach(root, 'Read', { file_path: plan }), null);
      assert.strictEqual(reach(root, 'mcp__shell__exec', { command: 'npm test' }), null);
    });
  });

  test('every hook command is a file that exists, run bare by node', () => {
    // A hook that names a file that is not there fails on every call and says so
    // nowhere. And no hook is wrapped: see the settings file's own comment on what a
    // wrapper does to the payload on one platform.
    const all = [];
    for (const event of Object.keys(settings.hooks || {})) {
      for (const entry of settings.hooks[event]) for (const c of commandsOf(entry)) all.push(c);
    }
    if (settings.statusLine) all.push(String(settings.statusLine.command));
    // One entry for the pre-tool event, one for session start, and the status line.
    assert.ok(all.length >= 3, 'the settings file wires almost nothing: ' + all.length + ' command(s)');
    for (const c of all) {
      assert.match(c, /^node "/, 'not a bare `node <file>`: ' + c);
      assert.doesNotMatch(c, /\bcmd\b|\bnode\s+(-e|--eval)\b/, 'a wrapped or inline hook: ' + c);
      const rel = (c.match(/CLAUDE_PROJECT_DIR(?::-\.)?\}?\/([^"\s]+)/) || [])[1];
      assert.ok(rel, 'cannot read the script path out of: ' + c);
      assert.ok(fs.existsSync(path.join(REPO, ...rel.split('/'))), 'the hook names a file that does not exist: ' + rel);
    }
  });

  test('permissions.deny carries BOTH spellings of every wildcard-free guarded path', () => {
    // Read off the two JSON files, then asked of the helper itself: the session-start
    // report must have nothing to say about the deny list this repo ships.
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'harness.config.json'), 'utf8'));
    const deny = (settings.permissions && settings.permissions.deny) || [];
    const literal = cfg.env.guarded.filter((p) => !/[*?]/.test(p));
    assert.ok(literal.length > 0, 'the fixture is wrong: this repo guards no wildcard-free path');
    for (const p of literal) {
      for (const spelling of bothDenies(p)) assert.ok(deny.includes(spelling), 'permissions.deny is missing ' + spelling.replace(p, '<guarded>'));
    }
    const r = spawnSync(node, [ENV_GUARD, '--rearm-check'], { cwd: REPO, encoding: 'utf8', input: '', env: cleanEnv() });
    assert.strictEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /permissions\.deny is missing/, 'the shipped settings file is half-armed');
  });

  test('this repo\'s own .gitignore ignores every pattern the secret guard refuses to open', () => {
    // The guard list and the ignore file are one list kept in two places: a file the guard will
    // not let an agent READ has to be a file git will not let anyone COMMIT. This repo once
    // carried the section header in its ignore file and no rule under it, and every test stayed
    // green, because nothing asked git. Probed by EFFECT, the way `harness doctor` does: a
    // wildcard has no path of its own, so git is asked about one concrete name it must cover.
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'harness.config.json'), 'utf8'));
    assert.ok(cfg.env.guarded.length > 0, 'the fixture is wrong: this repo guards nothing');
    for (const pattern of cfg.env.guarded) {
      const probe = pattern.replace(/\*/g, 'local');
      const asked = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', probe], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
      assert.strictEqual(asked.status, 0,
        'the ignore file does not cover guarded pattern #' + cfg.env.guarded.indexOf(pattern) + ' (git check-ignore exit ' + asked.status + ')');
    }
  });

  describe('env-guard — shape-blind, and that is deliberate', () => {
    const root = mkRoot('mcp-env');
    test('a SERVER-DEFINED field naming a guarded file is still intercepted', () => {
      // No field this guard knows appears in that payload, and it still decides: it tests
      // the whole tool_input as text. That is why the matcher is the entire fix for it.
      const out = hook(root, ENV_GUARD, [], 'mcp__fs__read', { target: '/repo/' + envFile('production') });
      assert.strictEqual(verdictOf(out), 'deny', 'an MCP call naming a guarded file was not intercepted');
      assert.strictEqual(verdictOf(hook(root, ENV_GUARD, [], 'mcp__fs__batch', { ops: [{ kind: 'read', where: { doc: envFile('local') } }] })), 'deny',
        'a guarded file nested inside a server-defined structure got through');
    });
    test('an MCP call that names no secret is left alone', () => {
      // The negative half. A guard that asks about everything is a guard people click through.
      assert.strictEqual(hook(root, ENV_GUARD, [], 'mcp__db__list_tables', { schemas: ['public'] }), null);
    });
  });

  describe('commit-hygiene — it decides from the payload, never from the tool name', () => {
    // A throwaway repo with the gate baseline staged, so the verdict is the subject rule
    // and cannot depend on what else the tree holds.
    const scratch = () => {
      const root = mkRoot('mcp-hygiene');
      gitIn(root, '-c', 'init.defaultBranch=main', 'init', '-q');
      put(root, 'scripts/harness/gates.baseline.json', '{}\n');
      gitIn(root, 'add', 'scripts/harness/gates.baseline.json');
      return root;
    };
    const gate = (root, tool, input) => verdictOf(hook(root, HYGIENE, ['--gate'], tool, input));

    test('an MCP payload spelling `command` gets the same verdict as native Bash', () => {
      const root = scratch();
      const sneak = { command: 'git commit -m "chore: sneak a re-baseline"' };
      assert.strictEqual(gate(root, 'Bash', sneak), 'deny', 'the fixture is wrong: native Bash was not denied');
      assert.strictEqual(gate(root, 'mcp__git__run', sneak), 'deny',
        'an MCP git server committing a re-baseline under an unrelated subject was allowed');
      const legible = { command: 'git commit -m "gates: re-baseline after the new suite"' };
      assert.strictEqual(gate(root, 'Bash', legible), gate(root, 'mcp__git__run', legible), 'the two tools disagree about a legible re-baseline');
      assert.strictEqual(gate(root, 'mcp__git__run', { command: 'git status' }), null, 'an MCP read-only git call was decided on');
    });

    test('a server-defined field is NOT a command, and this guard says nothing about it', () => {
      // Deliberate, and the reason the phase guard has to own the unreadable case: this
      // guard's rule is about git, and inventing a git write out of a field it cannot
      // read would be a guess.
      assert.strictEqual(gate(scratch(), 'mcp__git__run', { cmdline: 'git commit -m "x"' }), null);
    });
  });

  describe('phase-guard — its rules apply to an MCP payload, and an unreadable one asks', () => {
    const decideIn = (root, tool, input) => hook(root, PHASE_GUARD, [], tool, input);

    test('an MCP payload that DOES spell the fields gets the real rule, not a generic ask', () => {
      const root = mkRoot('mcp-phase');
      const rel = 'docs/tracks/fixture/plan.md';
      put(root, rel, '---\nid: fixture\nkind: plan\nstatus: open\n---\n# fixture\n');
      const d3 = decideIn(root, 'mcp__fs__write_file', { file_path: rel, content: 'smoke 999/999 green' });
      assert.ok(d3, 'an MCP file write put a gate figure into a governed doc and no guard saw it');
      assert.strictEqual(d3.permissionDecision, 'deny');
      assert.match(d3.permissionDecisionReason, /^D3/, 'a readable MCP payload got a generic ask instead of its rule');
      const d2 = decideIn(root, 'mcp__fs__write_file', { path: rel, content: '---\nid: fixture\nkind: plan\nstatus: complete\n---\n' });
      assert.match(reasonOf(d2), /^D2/, 'an MCP file write flipped a status');
      // D1 too: an MCP shell server spelling `command` is a shell call under another name.
      const d1 = decideIn(root, 'mcp__shell__exec', { command: 'git mv docs/tracks/fixture ' + ARCHIVE + '/fixture' });
      assert.strictEqual(verdictOf(d1), 'deny');
      assert.match(reasonOf(d1), /^D1/, 'an MCP shell call archived a track with no receipt');
    });

    test('an MCP payload carrying nothing a guard can read is asked, not allowed', () => {
      const root = mkRoot('mcp-phase-ask');
      const d = decideIn(root, 'mcp__db__execute_sql', { query: 'drop table widgets;' });
      assert.ok(d, 'an MCP payload no guard can read was allowed in silence');
      assert.strictEqual(d.permissionDecision, 'ask', 'an unreadable payload must be decided by a human');
      assert.match(d.permissionDecisionReason, /^D4/);
      // A file name with the bytes hidden is not readable either: the part that matters
      // is the part nothing looked at.
      assert.strictEqual(verdictOf(decideIn(root, 'mcp__fs__put', { path: 'docs/tracks/fixture/plan.md', contents: 'smoke 999/999' })), 'ask');
      assert.strictEqual(verdictOf(decideIn(root, 'mcp__ping__ping', {})), 'ask', 'a payload with no fields at all was allowed in silence');
    });

    test('the ask names the payload\'s FIELDS and never its values', () => {
      // A server-defined field can hold a credential, and a hook reason is written into
      // the transcript permanently. Naming the keys is what makes the ask answerable;
      // quoting the values would make the guard itself the leak.
      const d = decideIn(mkRoot('mcp-phase-keys'), 'mcp__vault__fetch', { token: TOKEN, scope: 'all-of-it' });
      assert.strictEqual(verdictOf(d), 'ask');
      assert.match(reasonOf(d), /token/, 'the ask does not say what the payload carried');
      assert.match(reasonOf(d), /scope/);
      assert.ok(!carriesToken(JSON.stringify(d)), 'the ask quoted a payload VALUE into the transcript');
      assert.ok(!reasonOf(d).includes('all-of-it'), 'the ask quoted a payload VALUE into the transcript');
    });

    test('widening the guard does not turn ordinary native work into an ask', () => {
      // The half that matters most: a guard that asks about `npm run build` gets clicked
      // through, and then it guards nothing. A native READ is the shape that carries this
      // assertion — it holds a path and no content, so it is the one that WOULD start
      // asking if the mcp__ test ever stopped discriminating.
      const root = mkRoot('mcp-phase-native');
      assert.strictEqual(decideIn(root, 'Bash', { command: 'npm run build' }), null);
      assert.strictEqual(decideIn(root, 'Edit', { file_path: 'src/server.js', old_string: 'a', new_string: 'b' }), null);
      assert.strictEqual(decideIn(root, 'Read', { file_path: 'docs/tracks/fixture/plan.md' }), null);
      assert.strictEqual(decideIn(root, 'Grep', { pattern: 'status:', path: 'docs' }), null);
      assert.strictEqual(decideIn(root, 'Glob', { pattern: 'docs/**/*.md' }), null);
      // ...and a readable MCP call that breaks no rule is not asked about either.
      assert.strictEqual(decideIn(root, 'mcp__shell__exec', { command: 'npm test' }), null);
      assert.strictEqual(decideIn(root, 'mcp__fs__write_file', { file_path: 'src/a.js', content: 'x' }), null);
    });
  });
});

/* ============================================================ */

describe('statusline.cjs — exactly one line, whatever goes in', () => {
  // The runtime renders this into a fixed-height strip: two lines corrupt the frame, a
  // throw blanks it, and a hang holds every prompt. So the property is asserted over the
  // PROCESS — stdout bytes and exit code — and not over the pure function.
  const root = mkRoot('statusline', null); // not a repository: no branch is a normal state
  const emit = (payload, cwd) => {
    const r = spawnSync(node, [STATUSLINE], { cwd: cwd || root, encoding: 'utf8', input: payload, env: cleanEnv() });
    assert.strictEqual(r.status, 0, 'exit ' + r.status + ' on ' + JSON.stringify(payload) + ': ' + r.stderr);
    return r.stdout;
  };
  const ONE_LINE = /^[^\r\n]+\n$/;
  const LINE_SEP = String.fromCharCode(0x2028); // by code point: a literal one would break this file's own lines

  test('one line out for any input', () => {
    const payloads = [
      '', '{}', 'not json', '}{', 'null', '[]', '42', '"a string"', 'true', '{"model":null}',
      JSON.stringify({ model: { display_name: 'Model X' }, workspace: { current_dir: REPO } }),
      JSON.stringify({ model: 7, workspace: 'nowhere', context_window: 'full' }),
      JSON.stringify({ model: { display_name: '' }, cwd: '' }),
      JSON.stringify({ cwd: path.join(root, 'does', 'not', 'exist') }),
      JSON.stringify({ model: { display_name: 'Model X' }, context_window: { used_percentage: null } }),
      JSON.stringify({ model: { display_name: 'Model X' }, context_window: { used_percentage: 1e308 * 10 } }),
      '{"model":{"display_name":"Model X"}}\n{"second":"document"}',
      '\n\n\n',
    ];
    for (const p of payloads) assert.match(emit(p), ONE_LINE, 'payload ' + JSON.stringify(p) + ' gave ' + JSON.stringify(emit(p)));
  });

  test('a field that CARRIES a line break cannot break the line', () => {
    // The fields are somebody else's strings. A model name or a directory with a newline
    // or a carriage return in it must not become a second line in the strip.
    const hostile = [
      { model: { display_name: 'Model\nX' }, cwd: root },
      { model: { display_name: 'Model\r\nX' }, cwd: root },
      { model: { id: 'm-1\n\n' }, cwd: root },
      { model: { display_name: 'Model X' }, workspace: { current_dir: root + '\nsecond' } },
      { model: { display_name: 'Model X' }, cwd: 'a' + LINE_SEP + 'b' },
    ];
    for (const p of hostile) {
      const out = emit(JSON.stringify(p));
      assert.match(out, ONE_LINE, JSON.stringify(p) + ' gave ' + JSON.stringify(out));
      assert.ok(!out.includes(LINE_SEP), 'a line-separator character survived into the strip');
    }
  });

  test('it reports the model and the context percentage it was handed', () => {
    const out = emit(JSON.stringify({
      model: { display_name: 'Model X' }, workspace: { current_dir: root }, context_window: { used_percentage: 42.4 },
    }));
    assert.match(out, /^Model X · /);
    assert.match(out, /ctx 42%\n$/);
    assert.ok(out.includes(path.basename(root)), 'the directory is missing from the line');
    assert.doesNotMatch(emit(JSON.stringify({ model: { display_name: 'Model X' }, context_window: { used_percentage: 'lots' } })), /ctx|NaN/);
  });

  test('inside a repository it names the branch, and still prints one line', () => {
    const repo = mkRoot('statusline-git', null);
    gitIn(repo, '-c', 'init.defaultBranch=trunk', 'init', '-q');
    gitIn(repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    const out = emit(JSON.stringify({ model: { display_name: 'Model X' }, workspace: { current_dir: repo } }));
    assert.match(out, ONE_LINE);
    assert.match(out, /^Model X · trunk · /);
  });
});
