'use strict';
/* ============================================================
   context.test.js — the always-on context budget, driven as a script.

   measure-context.js carries its own --self-test, and that drives the pure
   comparator with literals. This file drives the SCRIPT, because a gate that
   grades correctly and then prints its verdict in the wrong place, exits the
   wrong way, or writes a tracked file on the way past is still a broken gate —
   and those three are exactly what a pure comparator test cannot see.

   A fixture is a whole little repo in a temp directory: the scripts and the tool
   registry copied in, a config, a root AGENTS.md (the policy file) with the
   CLAUDE.md stub that imports it, a routing doc with a generated registry block,
   two subtree AGENTS.md files, a doc index, and a budget WRITTEN BY THE RULE
   (measured bytes + 10%, rounded up to the next 256 B) with a total DERIVED by
   this file's own copy of the formula. So the script's derivation is checked
   against an independent one rather than against itself.

   Three things are pinned for every child process, and each is here because the
   alternative is a test that passes for the wrong reason:
     HOME / USERPROFILE   point at an empty directory OUTSIDE the fixture, so the
                          user's own config never reaches a figure under test.
     CLAUDE_PROJECT_DIR   removed — inherited, it would aim the root at the real repo.
     GIT_CEILING_DIRECTORIES  the fixture's parent, so a temp directory that
                          happens to sit inside some enclosing repository cannot
                          borrow that repository's index.
   ============================================================ */
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
const SRC = path.join(REPO, 'scripts', 'harness');
const SCRIPT_REL = path.join('scripts', 'harness', 'measure-context.js');
const BUDGET_REL = 'scripts/harness/context-budget.json';

const made = [];
const tmp = (tag) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-context-' + tag + '-')));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const EMPTY_HOME = tmp('home');

function envFor(dir, home) {
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) if (/^GIT_/i.test(k)) delete env[k];
  delete env.CLAUDE_PROJECT_DIR;
  env.HOME = home || EMPTY_HOME;
  env.USERPROFILE = home || EMPTY_HOME;
  env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  return env;
}
const run = (dir, args, home) => spawnSync(process.execPath, [path.join(dir, SCRIPT_REL)].concat(args || []),
  { cwd: dir, encoding: 'utf8', env: envFor(dir, home) });
const git = (dir, args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: envFor(dir) });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' failed: ' + r.stderr);
  return r;
};
const write = (dir, rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const bytes = (dir, rel) => fs.statSync(path.join(dir, rel)).size;

/* ---------- the rule, written out a second time on purpose ---------- */
const ceilingFor = (b) => Math.ceil((b * 1.1) / 256) * 256;
const tok = (b) => Math.round(b / 4);
/** tok(each injected + policyReads ceiling, plus its generated allowance) + the LARGEST
 *  per-directory sum of tok(nestedOnTouch ceiling): one touch loads one directory, and a stub
 *  arrives with the policy file beside it. The essay in context-budget.json, as arithmetic. */
function derive(budget) {
  const allowance = (bucket, file) => {
    const g = (budget.generated || {})[bucket + '/' + file];
    return g ? g.baseBytes + g.bytesPerRow * g.maxRows : 0;
  };
  const rowTok = (bucket, file) => tok(budget.ceilings[bucket][file] + allowance(bucket, file));
  let total = 0;
  for (const b of ['injected', 'policyReads']) {
    for (const f of Object.keys(budget.ceilings[b] || {})) total += rowTok(b, f);
  }
  const perDir = {};
  for (const f of Object.keys(budget.ceilings.nestedOnTouch || {})) {
    const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    perDir[d] = (perDir[d] || 0) + rowTok('nestedOnTouch', f);
  }
  return total + Math.max(0, ...Object.values(perDir));
}

/* ---------- the fixture repo ---------- */
/** Exactly `n` ASCII bytes, so a test can say "+40 B" and mean it. */
function exact(head, n) {
  let s = head + '\n';
  while (s.length < n) s += 'One fact per line, padded out to an exact byte count.\n';
  return s.slice(0, n - 1) + '\n';
}
const BEGIN = '<!-- agents:begin -->';
const END = '<!-- agents:end -->';
const registry = (rows) => [BEGIN, '<!-- GENERATED — DO NOT EDIT. -->', '',
  '| subagent_type | model | tools | use for |', '|---|---|---|---|']
  .concat(rows.map((r) => '| `' + r[0] + '` | small | Read | ' + r[1] + ' |'))
  .concat(['', END]).join('\n');
const agentsDoc = (rows) => exact('# AGENTS', 3000) + '\n' + registry(rows) + '\n\n## After the registry\n';
const TWO_ROWS = [['explore', 'Finds code and reports where it is.'], ['review', 'Reads a change and ranks findings.']];

const CONFIG = { project: { name: 'example' }, gates: [{ name: 'test', command: 'node --test' }] };
/* The fixture's instruction files, named for the role each plays. The POLICY file is what every
   agent holds; the STUB is the pointer a tool that does not load the policy file natively reads
   instead, and it is injected too; the ROUTING doc is the one read only a lead makes. Which of
   them is injected is decided by the tool registry copied in beside the script, never here. */
const STUB = 'CLAUDE.md';
const STUB_TEXT = '<!-- a pointer -->\n@AGENTS.md\n';
const STUB_BYTES = Buffer.byteLength(STUB_TEXT);
const TRACKED = [STUB, 'AGENTS.md', 'docs/reference/routing/README.md', 'api/AGENTS.md', 'worker/AGENTS.md'];
/* measure-context.js reads the injected set off the registry, so the registry and its script
   travel with it into every fixture. */
const HARNESS_FILES = ['config.js', 'measure-context.js', 'tools.js', 'tools.json'];
/** The injected rows the REPO owns. The runtime's own rows (the user's global file, auto-memory)
 *  live under the home directory and are not what a tool's policy route decides. */
const repoInjected = (rep) => rep.injected.filter((x) => !String(x.file).startsWith('~'));

/** The budget a human would write for this fixture, by the rule. docs/reference/routing/README.md is part generated, so
 *  its ceiling is over the AUTHORED bytes and the block gets a per-row allowance. */
function budgetFor(dir) {
  const text = fs.readFileSync(path.join(dir, 'docs/reference/routing/README.md'), 'utf8');
  const block = text.slice(text.indexOf(BEGIN), text.indexOf(END) + END.length);
  const b = {
    unit: 'bytes',
    ceilings: {
      injected: { 'AGENTS.md': ceilingFor(bytes(dir, 'AGENTS.md')), [STUB]: ceilingFor(bytes(dir, STUB)) },
      nestedOnTouch: {
        'api/AGENTS.md': ceilingFor(bytes(dir, 'api/AGENTS.md')),
        'worker/AGENTS.md': ceilingFor(bytes(dir, 'worker/AGENTS.md')),
      },
      policyReads: { 'docs/reference/routing/README.md': ceilingFor(bytes(dir, 'docs/reference/routing/README.md') - Buffer.byteLength(block)) },
    },
    generated: { 'policyReads/docs/reference/routing/README.md': { baseBytes: 256, bytesPerRow: 256, maxRows: 6 } },
  };
  b.totalTokenCeiling = derive(b);
  return b;
}
const writeBudget = (dir, budget) => write(dir, BUDGET_REL, typeof budget === 'string' ? budget : JSON.stringify(budget, null, 2) + '\n');
const readBudget = (dir) => JSON.parse(fs.readFileSync(path.join(dir, BUDGET_REL), 'utf8'));

/** opts.git: 'tracked' (default) · 'empty' (an index with nothing in it) · 'none' (no repository). */
function fixture(opts) {
  const o = opts || {};
  const dir = tmp('repo');
  for (const f of HARNESS_FILES) {
    fs.mkdirSync(path.join(dir, 'scripts', 'harness'), { recursive: true });
    fs.copyFileSync(path.join(SRC, f), path.join(dir, 'scripts', 'harness', f));
  }
  write(dir, 'harness.config.json', JSON.stringify(CONFIG, null, 2));
  write(dir, 'AGENTS.md', exact('# POLICY', 2300));
  write(dir, STUB, STUB_TEXT);
  write(dir, 'docs/reference/routing/README.md', agentsDoc(TWO_ROWS));
  write(dir, 'api/AGENTS.md', exact('# api', 1800));
  write(dir, 'worker/AGENTS.md', exact('# worker', 1200));
  write(dir, 'docs/INDEX.md', exact('# INDEX', 4000));
  if (o.agents !== false) write(dir, '.claude/agents/explore.md', '---\nname: explore\ndescription: Finds code and reports where it is.\n---\n');
  writeBudget(dir, budgetFor(dir));
  if (o.git !== 'none') {
    git(dir, ['init', '-q']);
    if (o.git !== 'empty') git(dir, ['add', '--'].concat(TRACKED, [BUDGET_REL]));
  }
  return dir;
}

const lastLine = (out) => String(out).trim().split(/\r?\n/).pop();
function verdict(r) {
  const m = /^GATE context pass=(\d+) fail=(\d+) skipped=(\d+)$/.exec(lastLine(r.stdout));
  assert.ok(m, 'the LAST stdout line is not a context verdict: ' + JSON.stringify(lastLine(r.stdout)) + '\n' + r.stdout + r.stderr);
  return { pass: Number(m[1]), fail: Number(m[2]), skipped: Number(m[3]) };
}
const check = (dir, extra) => run(dir, ['--check', '--harness-only'].concat(extra || []));
const SIX_FAILS = { pass: 0, fail: 6, skipped: 0 };
const GREEN = { pass: 6, fail: 0, skipped: 0 };
const noTrace = (r, why) => {
  assert.doesNotMatch(String(r.stderr), /EISDIR|ENOENT|^\s+at .+:\d+:\d+\)?$/m, (why || '') + ' crashed instead of reporting:\n' + r.stderr);
};
/** Every regular file under the fixture, by content — what "wrote NOTHING" has to be measured over. */
function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p).toString('base64');
    }
  })(dir);
  return out;
}

describe('measure-context.js — the token budget', () => {
  test('--self-test passes, and prints the recorded total beside the derived one', () => {
    const dir = fixture();
    const r = run(dir, ['--self-test']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS — measure-context\.js self-test \(\d+ checks\)$/m);
    const b = readBudget(dir);
    assert.ok(r.stdout.includes(`recorded totalTokenCeiling ${b.totalTokenCeiling} · derived from its own per-row ceilings ${derive(b)} — agree`), r.stdout);
  });

  test('--self-test reds on a fixture whose total disagrees with its own rows, and PRINTS the disagreement', () => {
    const dir = fixture();
    const b = readBudget(dir);
    const want = b.totalTokenCeiling;
    b.totalTokenCeiling = want + 7;
    writeBudget(dir, b);
    const r = run(dir, ['--self-test']);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes(`recorded totalTokenCeiling ${want + 7} · derived from its own per-row ceilings ${want} — DISAGREE`), r.stdout);
  });

  test('--assert-budget speaks in exit codes, both ways', () => {
    const dir = fixture();
    const out = path.join(dir, 'report.json');
    const generous = run(dir, ['--assert-budget', '1000000', '--no-hooks', '--out', out]);
    assert.strictEqual(generous.status, 0, generous.stdout + generous.stderr);
    const impossible = run(dir, ['--assert-budget', '1', '--no-hooks', '--out', out]);
    assert.strictEqual(impossible.status, 1, 'a budget of 1 token was reported as met');
    assert.match(impossible.stderr, /^BUDGET FAIL startupTokens=\d+ > 1$/m);
  });

  test('the default run writes the report; --harness-only drops the rows no commit here can move', () => {
    const dir = fixture();
    const home = tmp('home-with-config');
    write(home, '.claude/CLAUDE.md', exact('# the user\'s own', 900));
    const r = run(dir, ['--json', '--no-hooks'], home);
    assert.strictEqual(r.status, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'scripts', 'harness', 'harness-baseline.json'), 'utf8'));
    assert.deepStrictEqual(written.tokens, JSON.parse(r.stdout).tokens);
    assert.strictEqual(written.project, 'example');
    assert.deepStrictEqual(written.injected.filter((x) => x.global).map((x) => x.bytes), [900]);

    const h = JSON.parse(run(dir, ['--json', '--no-hooks', '--harness-only'], home).stdout);
    assert.strictEqual(h.harnessOnly, true);
    assert.deepStrictEqual(h.injected.filter((x) => x.global), []);
    assert.strictEqual(written.tokens.injected - h.tokens.injected, tok(900 + 2300 + STUB_BYTES) - tok(2300 + STUB_BYTES));
  });

  test('the file lists come from the tree and the config, never from a list of subtrees', () => {
    const dir = fixture();
    write(dir, 'web/ui/AGENTS.md', exact('# web', 700));
    write(dir, 'node_modules/dep/AGENTS.md', exact('# a dependency', 700));
    write(dir, 'POLICY.md', exact('# POLICY', 500));
    write(dir, 'harness.config.json', JSON.stringify(Object.assign({}, CONFIG, { docs: { caps: { 'POLICY.md': 60 } } })));
    const rep = JSON.parse(run(dir, ['--json', '--no-hooks', '--harness-only', '--out', path.join(dir, 'r.json')]).stdout);
    assert.deepStrictEqual(rep.nestedOnTouch.map((x) => x.file), ['api/AGENTS.md', 'worker/AGENTS.md', 'web/ui/AGENTS.md']);
    assert.deepStrictEqual(repoInjected(rep).map((x) => x.file), [STUB, 'AGENTS.md'], 'the injected set is the enabled tool\'s policy route: the stub, then the file it imports');
    assert.deepStrictEqual(rep.policyReads.map((x) => [x.file, x.bytes]), [['POLICY.md', 500], ['docs/reference/routing/README.md', bytes(dir, 'docs/reference/routing/README.md')]]);
    assert.ok(rep.policyReads.every((x) => x.leadOnly === true) && repoInjected(rep).every((x) => x.subagent === true),
      'a lead-only read was charged to a subagent, or an injected file was not');
    assert.strictEqual(rep.tokens.nestedOnTouchWorst, tok(1800), 'the total charges the LARGEST subtree directory, not the sum');
    assert.strictEqual(rep.tokens.nestedOnTouchTotal, tok(1800 + 1200 + 700));
  });
});

describe('measure-context.js — the injected set is the enabled tools\' policy routes', () => {
  /* The injected file name used to be a constant in the script. It is now read off the registry
     row of each ENABLED tool, so these drive the same fixture tree under different `tools.enabled`
     lists and assert that the buckets move with the list and with nothing else. */
  const json = (dir) => {
    const r = run(dir, ['--json', '--no-hooks', '--harness-only', '--out', path.join(dir, 'r.json')]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const enable = (dir, ids) => write(dir, 'harness.config.json', JSON.stringify(Object.assign({}, CONFIG, { tools: { enabled: ids } })));

  test('a tool that reaches the policy through an import stub injects the stub AND the file it imports', () => {
    const rep = json(fixture());
    assert.deepStrictEqual(repoInjected(rep).map((x) => [x.file, x.bytes]), [[STUB, STUB_BYTES], ['AGENTS.md', 2300]]);
    assert.deepStrictEqual(rep.policyReads.map((x) => x.file), ['docs/reference/routing/README.md'], 'the routing doc is the lead-only read');
  });

  test('a tool that loads the policy file natively injects that file alone, and the stub is no longer always-on', () => {
    const dir = fixture();
    enable(dir, ['codex-cli']);
    const rep = json(dir);
    assert.deepStrictEqual(repoInjected(rep).map((x) => x.file), ['AGENTS.md']);
    assert.ok(!rep.policyReads.some((x) => x.file === 'AGENTS.md'), 'the policy file was charged as a lead-only read');
    assert.deepStrictEqual(rep.nestedOnTouch.map((x) => x.file), ['api/AGENTS.md', 'worker/AGENTS.md']);
    // The stub is still on disk and still a default cap key. No enabled tool loads it and no lead
    // opens it, so it is in NO bucket: charged as a lead-only read it would demand a ceiling for
    // a file nobody holds.
    assert.deepStrictEqual(rep.policyReads.map((x) => x.file), ['docs/reference/routing/README.md'], 'the unused stub was charged as a lead-only read');
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), GREEN, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /carries no ceiling/);
  });

  test('a stub beside a subtree policy file is a subtree row for the tool that needs it, and is charged WITH that file', () => {
    const NESTED = 'api/' + STUB;
    const dir = fixture();
    write(dir, NESTED, STUB_TEXT);
    const rep = json(dir);
    assert.deepStrictEqual(rep.nestedOnTouch.map((x) => x.file), ['api/AGENTS.md', 'worker/AGENTS.md', NESTED]);
    assert.strictEqual(rep.tokens.nestedOnTouchWorst, tok(1800) + tok(STUB_BYTES), 'one touch of api/ loads both files, and only the larger was charged');
    // Tracked and unbudgeted, it fails coverage by name, like any other always-on file.
    git(dir, ['add', '--', NESTED]);
    const red = check(dir);
    assert.strictEqual(verdict(red).fail > 0, true, red.stdout);
    assert.ok(red.stdout.includes('nestedOnTouch: ' + NESTED), red.stdout);
    // Budgeted, the gate is green and the recorded total is the directory's two rows together.
    const b = readBudget(dir);
    b.ceilings.nestedOnTouch[NESTED] = 256;
    b.totalTokenCeiling = derive(b);
    assert.strictEqual(b.totalTokenCeiling, readBudget(dir).totalTokenCeiling + tok(256), 'this file\'s own derivation did not charge the pair');
    writeBudget(dir, b);
    const green = check(dir);
    assert.deepStrictEqual(verdict(green), GREEN, green.stdout + green.stderr);
    // A tool that loads the policy file natively never opens the stub, at the root or below it.
    enable(dir, ['codex-cli']);
    assert.deepStrictEqual(json(dir).nestedOnTouch.map((x) => x.file), ['api/AGENTS.md', 'worker/AGENTS.md']);
  });

  test('two enabled tools reaching one policy file charge it once', () => {
    const dir = fixture();
    enable(dir, ['claude-code', 'codex-cli', 'gemini-cli']);
    assert.deepStrictEqual(repoInjected(json(dir)).map((x) => x.file), [STUB, 'AGENTS.md']);
  });

  test('the routing doc follows project.docsRoot', () => {
    const dir = fixture();
    write(dir, 'handbook/reference/routing/README.md', exact('# routing', 800));
    write(dir, 'harness.config.json', JSON.stringify(Object.assign({}, CONFIG, { project: { name: 'example', docsRoot: 'handbook' } })));
    assert.deepStrictEqual(json(dir).policyReads.map((x) => [x.file, x.bytes]), [['handbook/reference/routing/README.md', 800]]);
  });

  test('an unreadable registry is six fails and a verdict under --check, never an empty injected set', () => {
    const dir = fixture();
    fs.rmSync(path.join(dir, 'scripts', 'harness', 'tools.json'));
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout + r.stderr);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /cannot read the tool registry/);
  });

  test('...and a two-line stop on the ordinary run and under --assert-budget: no trace, no report', () => {
    for (const args of [['--no-hooks', '--harness-only'], ['--assert-budget', '1000000', '--no-hooks']]) {
      const dir = fixture();
      fs.rmSync(path.join(dir, 'scripts', 'harness', 'tools.json'));
      const out = path.join(dir, 'r.json');
      const r = run(dir, args.concat(['--out', out]));
      assert.strictEqual(r.status, 1, args.join(' ') + ': ' + r.stdout + r.stderr);
      const lines = r.stderr.trim().split(/\r?\n/);
      assert.strictEqual(lines.length, 2, r.stderr);
      assert.match(lines[0], /^FATAL — cannot read the tool registry at scripts\/harness\/tools\.json/);
      assert.match(lines[1], /^ {3}fix: restore scripts\/harness\/tools\.json/);   // two lines, so no stack trace
      assert.ok(!fs.existsSync(out), 'a report was written for a measurement that never happened');
    }
  });

  test('an enabled id with no registry row is refused BY NAME, on every path, never measured as nothing injected', () => {
    const dir = fixture();
    enable(dir, ['tool-zzz']);
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout + r.stderr);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /tools\.enabled\.tool-zzz: enabled in harness\.config\.json but has no row/);
    assert.doesNotMatch(r.stdout, /the collector is blind/, 'the wrong diagnosis: the reader is sent to the budget file');
    for (const args of [['--json', '--no-hooks', '--harness-only'], ['--assert-budget', '1000000', '--no-hooks']]) {
      const out = path.join(dir, 'r.json');
      const o = run(dir, args.concat(['--out', out]));
      assert.strictEqual(o.status, 1, args.join(' ') + ' measured an unknown tool as zero bytes: ' + o.stdout);
      assert.match(o.stderr, /^FATAL — .*tools\.enabled\.tool-zzz/);
      assert.match(o.stderr, /^ {3}fix: edit tools\.enabled in harness\.config\.json/m);
      noTrace(o, args.join(' '));
      assert.ok(!fs.existsSync(out));
    }
  });

  test('enabling a tool whose row loads its OWN file natively is refused: that file would be a second policy body', () => {
    const dir = fixture();
    enable(dir, ['qwen-code']);
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout + r.stderr);
    assert.match(r.stdout, /tools\.enabled\.qwen-code: its row loads `QWEN\.md` natively, which is not the policy file AGENTS\.md/);
  });
});

describe('the per-project directory under the user profile — one rule, read by two scripts', () => {
  /* The agent runtime names a project's state directory after its absolute path with EVERY
     character that is not a letter or a digit flattened to a dash. measure-context.js reads the
     auto-memory index and the newest transcript out of it; the doc gate's rule 10 reads the same
     index. Each script spells the derivation itself, because neither can require the other, and
     measure-context once spelled it wrong: the separators and the drive colon only. On a checkout
     whose path carries a dot, an underscore or a space it then measured a directory the runtime
     never wrote and reported 0 bytes, without a word.
     So the name is derived HERE a third time, a file is planted where the runtime would put it,
     and both real scripts are run against it. The folder name is awkward on purpose. */
  const HELPERS = path.join(REPO, 'scripts', 'harness', 'guards');
  const runtimeName = (abs) => abs.replace(/[^A-Za-z0-9]/g, '-');
  const separatorsOnly = (abs) => abs.replace(/[\\/:]/g, '-');
  const MEMORY = '# Memory\n\n- [a](a.md) a short hook\n';

  function awkward() {
    const dir = path.join(tmp('awkward'), 'my.repo_v2 x');
    for (const [from, rel] of [
      [path.join(SRC, 'config.js'), 'scripts/harness/config.js'],
      [path.join(SRC, 'measure-context.js'), 'scripts/harness/measure-context.js'],
      [path.join(SRC, 'tools.js'), 'scripts/harness/tools.js'],
      [path.join(SRC, 'tools.json'), 'scripts/harness/tools.json'],
      [path.join(HELPERS, 'docs-lint.cjs'), 'scripts/harness/guards/docs-lint.cjs'],
      [path.join(HELPERS, 'doc-frozen.cjs'), 'scripts/harness/guards/doc-frozen.cjs'],
    ]) write(dir, rel, fs.readFileSync(from));
    write(dir, 'harness.config.json', JSON.stringify(CONFIG, null, 2));
    write(dir, 'AGENTS.md', exact('# CLAUDE', 600));
    write(dir, 'docs/reference/routing/README.md', exact('# AGENTS', 600));
    return fs.realpathSync(dir);
  }
  const memoryRow = (dir, home) => {
    const r = run(dir, ['--json', '--no-hooks', '--harness-only', '--out', path.join(tmp('report'), 'r.json')], home);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const row = JSON.parse(r.stdout).injected.find((x) => /\/memory\/MEMORY\.md$/.test(String(x.file)));
    assert.ok(row, 'the measurement carries no auto-memory row at all:\n' + r.stdout);
    return row;
  };
  const lintSkipsRule10 = (dir, home) => {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'harness', 'guards', 'docs-lint.cjs')],
      { cwd: dir, encoding: 'utf8', env: envFor(dir, home) });
    assert.match(lastLine(r.stdout), /^GATE docs pass=\d+ fail=\d+ skipped=\d+$/, 'the doc gate did not reach its verdict:\n' + r.stdout + r.stderr);
    return /rule 10 \(auto-memory\) SKIPPED/.test(r.stdout);
  };

  test('both scripts find an index planted where the runtime writes it, on a path with a dot, an underscore and a space', () => {
    const dir = awkward();
    assert.notStrictEqual(runtimeName(dir), separatorsOnly(dir), 'the fixture is wrong: this path does not tell the two rules apart');
    const home = tmp('home-runtime-rule');
    write(home, path.join('.claude', 'projects', runtimeName(dir), 'memory', 'MEMORY.md'), MEMORY);
    assert.strictEqual(memoryRow(dir, home).bytes, Buffer.byteLength(MEMORY), 'measure-context looked in a directory the runtime never wrote');
    assert.strictEqual(lintSkipsRule10(dir, home), false, 'the doc gate looked in a directory the runtime never wrote');
  });

  test('neither script finds one planted under the separators-only name, so the two cannot drift apart unseen', () => {
    // The negative half, and the mutation the first test exists to catch. An index sitting at the
    // name the OLD rule derived must be invisible to both scripts: one that still finds it is back
    // on the old rule while the other is not.
    const dir = awkward();
    const home = tmp('home-old-rule');
    write(home, path.join('.claude', 'projects', separatorsOnly(dir), 'memory', 'MEMORY.md'), MEMORY);
    assert.strictEqual(memoryRow(dir, home).bytes, 0, 'measure-context found an index under the separators-only name');
    assert.strictEqual(lintSkipsRule10(dir, home), true, 'the doc gate found an index under the separators-only name');
  });
});

describe('measure-context does not charge on-demand reads to the startup budget', () => {
  // The generated doc index is opened by a lead when it needs to find a doc; nothing injects it.
  // These assertions are what stops it drifting back into the always tier.
  const runJson = (dir) => {
    const r = run(dir, ['--json', '--no-hooks', '--harness-only', '--out', path.join(dir, 'report.json')]);
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };

  test('the doc index sits in onDemand, never in the always-tier policy reads', () => {
    const rep = runJson(fixture());
    assert.deepStrictEqual(rep.policyReads.map((x) => x.file), ['docs/reference/routing/README.md']);
    assert.deepStrictEqual(rep.onDemand.map((x) => x.file), ['docs/INDEX.md']);
    assert.strictEqual(rep.onDemand[0].bytes, 4000, 'the index measured wrong — the path is wrong');
    assert.ok(!rep.injected.concat(rep.nestedOnTouch).some((x) => /INDEX\.md$/.test(x.file)));
  });

  test('the index follows project.docsRoot rather than a literal directory', () => {
    const dir = fixture();
    write(dir, 'handbook/INDEX.md', exact('# INDEX', 1200));
    write(dir, 'harness.config.json', JSON.stringify(Object.assign({}, CONFIG, { project: { name: 'example', docsRoot: 'handbook' } })));
    assert.deepStrictEqual(runJson(dir).onDemand.map((x) => [x.file, x.bytes]), [['handbook/INDEX.md', 1200]]);
  });

  test('startupTokens is the sum of the always-on buckets and EXCLUDES onDemand', () => {
    const t = runJson(fixture()).tokens;
    assert.strictEqual(t.startupTokens, t.injected + t.nestedOnTouchWorst + t.policyReads + t.listing + t.hookStdout);
    assert.strictEqual(t.onDemand, tok(4000), 'onDemand must still be measured, not dropped');
    assert.ok(t.listing > 0, 'the fixture ships an agent definition, so the listing bucket must hold something');
    for (const k of ['injected', 'nestedOnTouchWorst', 'nestedOnTouchTotal', 'subagentInjected', 'policyReads', 'listing', 'hookStdout', 'onDemand', 'startupTokens']) {
      assert.strictEqual(typeof t[k], 'number', `tokens.${k} went missing`);
    }
  });

  test('growing the index tenfold moves onDemand and nothing else', () => {
    const dir = fixture();
    const before = runJson(dir).tokens;
    write(dir, 'docs/INDEX.md', exact('# INDEX', 40000));
    const afterT = runJson(dir).tokens;
    assert.strictEqual(afterT.onDemand, tok(40000));
    assert.strictEqual(afterT.startupTokens, before.startupTokens);
    assert.deepStrictEqual(verdict(check(dir)), GREEN, 'a doc commit that grows the generated index must be a non-event for the gate');
  });

  test('the human-readable output shows the on-demand figure AND marks it uncharged', () => {
    const dir = fixture();
    const r = run(dir, ['--no-hooks', '--harness-only', '--out', path.join(dir, 'report.json')]);
    assert.strictEqual(r.status, 0, r.stderr);
    const line = r.stdout.split('\n').find((l) => l.includes('docs/INDEX.md'));
    assert.ok(line, 'the index is not printed at all — hiding the number is the dishonest fix');
    assert.match(line, /on demand/);
    assert.ok(line.includes(`(${tok(4000)})`), 'the figure itself is missing from the line: ' + line);
    assert.match(r.stdout, /EXCLUDED from startupTokens/);
    assert.match(r.stdout, /onDemand {2}\[not in startupTokens\]/);
  });
});

describe('the `context` gate — the verdict, driven through the script', () => {
  test('a budget written by the rule grades its tree green, with the GATE line LAST', () => {
    const dir = fixture();
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), GREEN, r.stdout);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    for (const f of TRACKED) assert.ok(r.stdout.includes('     ' + f + '  '), f + ' was not graded at all:\n' + r.stdout);
    assert.doesNotMatch(r.stdout, /untracked, NOT graded/);
  });

  test('the COMMITTED fixture grades this repo\'s own always-on files green, GATE line last', () => {
    /* Driven in a replica rather than in place, and the reason is the gate's own rule: it grades
       only what git TRACKS, so in a checkout whose index is empty (before the first commit) the
       honest verdict on the real tree is red-on-coverage, and that is not what this test is about.
       The replica holds this repo's real always-on files, real config and real budget, all tracked.
       Once the real index holds anything, only the rows git tracks here are replicated — the same
       set the gate would grade in place. */
    const listing = spawnSync(process.execPath,
      [path.join(SRC, 'measure-context.js'), '--json', '--no-hooks', '--harness-only', '--out', path.join(tmp('report'), 'r.json')],
      { cwd: REPO, encoding: 'utf8', env: envFor(REPO) });
    assert.strictEqual(listing.status, 0, listing.stdout + listing.stderr);
    const rep = JSON.parse(listing.stdout);
    const ls = spawnSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const tracked = ls.status === 0 ? new Set(ls.stdout.split('\0').filter(Boolean)) : new Set();
    const rows = [].concat(rep.injected, rep.nestedOnTouch, rep.policyReads, rep.onDemand)
      .map((x) => String(x.file))
      .filter((f) => !f.startsWith('~') && fs.existsSync(path.join(REPO, f)))
      .filter((f) => !tracked.size || tracked.has(f));
    assert.ok(rows.includes('AGENTS.md'), 'this repo has no graded root AGENTS.md to replicate: ' + JSON.stringify(rows));

    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'harness.config.json'), 'utf8'));
    const budgetRel = (cfg.context && cfg.context.budgetFile) || BUDGET_REL;
    const committed = JSON.parse(fs.readFileSync(path.join(REPO, budgetRel), 'utf8'));
    assert.notStrictEqual(committed.placeholder, true, budgetRel + ' is still marked placeholder although the files it budgets exist');
    assert.strictEqual(committed.totalTokenCeiling, derive(committed), 'the committed total is not the one its own rows derive');

    const dir = tmp('replica');
    const files = rows.concat(['harness.config.json', budgetRel].concat(HARNESS_FILES.map((f) => 'scripts/harness/' + f)));
    for (const f of new Set(files)) write(dir, f, fs.readFileSync(path.join(REPO, f)));
    git(dir, ['init', '-q']);
    git(dir, ['add', '--'].concat([...new Set(files)]));
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), GREEN, r.stdout + r.stderr);
    assert.strictEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /untracked, NOT graded|marked placeholder/);
  });

  test('a MISSING fixture is a full fail set and exit 1 — never a collapsed total', () => {
    // pass=0 fail=1 against a baseline of six would have the gate runner print "a check
    // DISAPPEARED" about a fixture nobody deleted a check for.
    const dir = fixture();
    const r = check(dir, ['--budget', path.join(dir, 'absent-on-purpose.json')]);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /absent-on-purpose\.json unreadable/);
    noTrace(r, 'a missing fixture');
  });

  test('an UNPARSEABLE fixture is a full fail set too — a JSON typo must not disable the gate', () => {
    const dir = fixture();
    writeBudget(dir, '{"ceilings": ');
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout);
    assert.strictEqual(r.status, 1);
    noTrace(r, 'an unparseable fixture');
    for (const odd of ['[]', '"a string"', 'null', '{}']) {
      writeBudget(dir, odd);
      const o = check(dir);
      assert.deepStrictEqual(verdict(o), SIX_FAILS, odd + '\n' + o.stdout);
      assert.strictEqual(o.status, 1, odd);
    }
  });

  test('a MISSPELLED bucket key is a full fail set, and the SHAPE rule is what names it', () => {
    // Asserting only the counts would be tautological: a misspelled bucket also empties the graded
    // set, so other checks could red and the test would pass with the rule it is named for
    // deleted. The message pins the rule to its own call site.
    const dir = fixture();
    const b = readBudget(dir);
    b.ceilings.injcted = b.ceilings.injected;
    delete b.ceilings.injected;
    writeBudget(dir, b);
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout);
    assert.match(r.stdout, /^ {2}x shape {2}ceilings\.injcted is not a graded bucket/m);
    assert.strictEqual(r.status, 1);
  });

  test('a ceiling that is not a positive integer is refused rather than read as "no ceiling"', () => {
    const dir = fixture();
    for (const bad of ['2560', 0, null, 12.5]) {
      const b = readBudget(dir);
      b.ceilings.injected['AGENTS.md'] = bad;
      writeBudget(dir, b);
      const r = check(dir);
      assert.deepStrictEqual(verdict(r), SIX_FAILS, JSON.stringify(bad) + '\n' + r.stdout);
      assert.match(r.stdout, /ceilings\.injected\["AGENTS\.md"\] = .+ is not a positive integer/);
      writeBudget(dir, budgetFor(dir));
    }
  });

  test('a `generated` key naming a DIRECTORY still reaches a verdict — no stack trace', () => {
    // The generated block is measured before the grading runs, so an unguarded read of a directory
    // threw out of the whole script and printed no GATE line at all. The identical typo pointing
    // at a path that does not exist always reached the shape check; that asymmetry was the defect.
    const dir = fixture();
    for (const key of ['policyReads/scripts', 'nestedOnTouch/api', 'policyReads/', 'policyReads/no-such-file.md']) {
      const b = budgetFor(dir);
      b.generated[key] = { baseBytes: 256, bytesPerRow: 256, maxRows: 6 };
      writeBudget(dir, b);
      const r = check(dir);
      assert.deepStrictEqual(verdict(r), SIX_FAILS, key + '\n' + r.stdout + r.stderr);
      assert.strictEqual(r.status, 1, key);
      assert.ok(r.stdout.includes(`generated["${key}"]`), key + ' is not named in the output:\n' + r.stdout);
      noTrace(r, key);
    }
  });

  test('an EMPTY git index does not read as coverage — a bucket that grades nothing reds', () => {
    // `git ls-files` can SUCCEED and return nothing: a fresh `git init` before the first commit, a
    // rebuilt index. Every row is then filtered out as untracked while the raw measurement stays
    // full, which without the guard is six green checks over a tree where nothing was graded.
    const dir = fixture({ git: 'empty' });
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), { pass: 5, fail: 1, skipped: 0 }, r.stdout);
    assert.strictEqual(r.status, 1);
    const cov = r.stdout.split('\n').filter((l) => /^ {2}x coverage /.test(l));
    assert.strictEqual(cov.length, 3, 'every bucket that graded nothing must be named:\n' + r.stdout);
    for (const b of ['injected', 'nestedOnTouch', 'policyReads']) assert.ok(cov.some((l) => l.includes(b + ': the fixture holds')), b);
    assert.match(r.stdout, /AGENTS\.md {2}2300 B — untracked, NOT graded/);
  });

  test('ONE file out of the index disables a single-file bucket, and that reds too', () => {
    // The lead-only bucket is the single-file one: `injected` holds the policy file AND its stub.
    const dir = fixture();
    git(dir, ['rm', '-q', '--cached', '--', 'docs/reference/routing/README.md']);
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), { pass: 5, fail: 1, skipped: 0 }, r.stdout);
    assert.match(r.stdout, /x coverage {2}policyReads: the fixture holds 1 ceiling\(s\) and NOTHING in this bucket was graded/);
  });

  test('with no git answer at all, every repo row is graded and the output SAYS so', () => {
    const dir = fixture({ git: 'none' });
    const r = check(dir);
    assert.match(r.stdout, /! git ls-files did not answer — EVERY repo row is graded/);
    assert.deepStrictEqual(verdict(r), GREEN, r.stdout);
  });

  test('an UNTRACKED always-on file is never graded; the same file TRACKED with no ceiling fails coverage', () => {
    const dir = fixture();
    // Smaller than the largest budgeted subtree file on purpose, so tracking it cannot move the
    // aggregate and coverage is the ONLY check with anything to say.
    write(dir, 'vendored/bundle/AGENTS.md', exact('# arrived through a package command', 500));
    const untracked = check(dir);
    assert.deepStrictEqual(verdict(untracked), GREEN, 'a red with no diff behind it cannot be fixed:\n' + untracked.stdout);
    assert.match(untracked.stdout, /vendored\/bundle\/AGENTS\.md {2}500 B — untracked, NOT graded/);

    git(dir, ['add', '--', 'vendored/bundle/AGENTS.md']);
    const tracked = check(dir);
    assert.deepStrictEqual(verdict(tracked), { pass: 5, fail: 1, skipped: 0 }, tracked.stdout);
    assert.ok(tracked.stdout.includes('x coverage  nestedOnTouch: vendored/bundle/AGENTS.md (500 B) is always-on, git tracks it, and it carries no ceiling in the fixture'), tracked.stdout);
    assert.strictEqual(tracked.status, 1);
  });

  test('it is a CEILING, one-sided: a row that shrank passes and prints its slack, a deleted file passes', () => {
    const dir = fixture();
    const ceil = readBudget(dir).ceilings;
    write(dir, 'AGENTS.md', exact('# CLAUDE', 400));
    fs.rmSync(path.join(dir, 'worker', 'AGENTS.md'));
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), GREEN, r.stdout);
    assert.ok(r.stdout.includes(`     AGENTS.md  400/${ceil.injected['AGENTS.md']} B`), r.stdout);
    assert.ok(!r.stdout.includes('worker/AGENTS.md'), 'a file gone from the tree is not a row');
  });

  test('a CRLF checkout of the same tree grades exactly as the LF one does', () => {
    // The default on one major platform, wherever no .gitattributes pins the convention: git hands
    // back every line ending as two bytes. The measurement once took the raw size on disk, so the
    // same commit weighed a byte per line more there, and a file just inside its ceiling in CI was
    // over it on a laptop with no diff behind the difference. Every ceiling is set to EXACTLY the
    // LF size first, so there is no headroom for a second convention to hide in.
    const dir = fixture();
    const b = readBudget(dir);
    const text = fs.readFileSync(path.join(dir, 'docs/reference/routing/README.md'), 'utf8');
    const block = text.slice(text.indexOf(BEGIN), text.indexOf(END) + END.length);
    b.ceilings.injected['AGENTS.md'] = bytes(dir, 'AGENTS.md');
    b.ceilings.injected[STUB] = bytes(dir, STUB);
    b.ceilings.nestedOnTouch['api/AGENTS.md'] = bytes(dir, 'api/AGENTS.md');
    b.ceilings.nestedOnTouch['worker/AGENTS.md'] = bytes(dir, 'worker/AGENTS.md');
    b.ceilings.policyReads['docs/reference/routing/README.md'] = bytes(dir, 'docs/reference/routing/README.md') - Buffer.byteLength(block);
    b.totalTokenCeiling = derive(b);
    writeBudget(dir, b);
    const lf = check(dir);
    assert.deepStrictEqual(verdict(lf), GREEN, 'the fixture is wrong: a row AT its ceiling must pass:\n' + lf.stdout);

    const before = bytes(dir, 'AGENTS.md');
    for (const f of TRACKED) {
      const p = path.join(dir, f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    assert.ok(bytes(dir, 'AGENTS.md') > before, 'the fixture is wrong: the CRLF copy is no larger on disk');
    const crlf = check(dir);
    assert.deepStrictEqual(verdict(crlf), GREEN, 'a line-ending convention moved the verdict:\n' + crlf.stdout);
    // And not merely green: every graded figure it prints is the LF figure, byte for byte.
    const graded = (out) => out.split('\n').filter((l) => /^ {5}\S.* B\b/.test(l));
    assert.ok(graded(lf.stdout).length >= TRACKED.length, 'no graded rows were printed:\n' + lf.stdout);
    assert.deepStrictEqual(graded(crlf.stdout), graded(lf.stdout));
  });

  test('the headroom separates an ordinary prose edit from a pasted block', () => {
    const dir = fixture();
    const ceil = readBudget(dir).ceilings.injected['AGENTS.md'];
    write(dir, 'AGENTS.md', exact('# CLAUDE', 2300 + 40));
    assert.deepStrictEqual(verdict(check(dir)), GREEN, 'a 40-byte prose edit reded the suite');
    write(dir, 'AGENTS.md', exact('# CLAUDE', 2300 + 600));
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), { pass: 5, fail: 1, skipped: 0 }, r.stdout);
    assert.ok(r.stdout.includes(`x injected  injected: AGENTS.md 2900 B > ceiling ${ceil} B (+${2900 - ceil})`), r.stdout);
    assert.strictEqual(r.status, 1);
  });

  test('a ceiling below the real file REDS exactly one check, exits 1, and the count is unchanged', () => {
    // The row lowered is a subtree file that is NOT the largest, so its ceiling is no part of the
    // derived total: one failing check, named, with both figures in it, and five still passing.
    const dir = fixture();
    const green = verdict(check(dir));
    const b = readBudget(dir);
    b.ceilings.nestedOnTouch['worker/AGENTS.md'] = 1;
    assert.strictEqual(derive(b), b.totalTokenCeiling, 'the row picked moved the derived total — pick a smaller one');
    writeBudget(dir, b);
    const r = check(dir);
    const red = verdict(r);
    assert.deepStrictEqual(red, { pass: 5, fail: 1, skipped: 0 }, r.stdout);
    assert.strictEqual(red.pass + red.fail + red.skipped, green.pass + green.fail + green.skipped);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /x nestedOnTouch {2}nestedOnTouch: worker\/AGENTS\.md 1200 B > ceiling 1 B \(\+1199\)/);
  });

  test('a totalTokenCeiling that contradicts its own per-row ceilings fails, in EITHER direction', () => {
    // The defect the shape check exists for: an aggregate that sat BELOW the sum of the per-row
    // ceilings it shipped with, so growing every row to its pre-authorised ceiling reded the
    // aggregate. Above is refused as well — slack is not smuggled in through the total.
    const dir = fixture();
    const want = readBudget(dir).totalTokenCeiling;
    for (const delta of [-80, 1]) {
      const b = budgetFor(dir);
      b.totalTokenCeiling = want + delta;
      writeBudget(dir, b);
      const r = check(dir);
      assert.deepStrictEqual(verdict(r), SIX_FAILS, delta + '\n' + r.stdout);
      assert.ok(r.stdout.includes(`totalTokenCeiling ${want + delta} != ${want} derived`), r.stdout);
      assert.strictEqual(r.status, 1);
    }
    // The same disagreement from the other side: a row ceiling edited, the total left alone.
    const b = budgetFor(dir);
    b.ceilings.injected['AGENTS.md'] = 1;
    writeBudget(dir, b);
    const r = check(dir);
    assert.deepStrictEqual(verdict(r), SIX_FAILS, r.stdout);
    assert.match(r.stdout, /totalTokenCeiling \d+ != \d+ derived/);
  });

  test('`generated`: a new registry row is free, a bloated description is not, the markers must exist', () => {
    const dir = fixture();
    write(dir, 'docs/reference/routing/README.md', agentsDoc(TWO_ROWS.concat([['implement', 'Does one task and runs the gate.']])));
    const three = check(dir);
    assert.deepStrictEqual(verdict(three), GREEN, 'adding a registry row must not need a budget edit:\n' + three.stdout);
    assert.match(three.stdout, /docs\/reference\/routing\/README\.md {2}authored \d+\/\d+ B · generated block \d+\/1024 B over 3\/6 rows/);

    write(dir, 'docs/reference/routing/README.md', agentsDoc([TWO_ROWS[0], ['review', 'x'.repeat(900)]]));
    const bloated = check(dir);
    assert.deepStrictEqual(verdict(bloated), { pass: 5, fail: 1, skipped: 0 }, bloated.stdout);
    assert.match(bloated.stdout, /x policyReads {2}policyReads: docs\/reference\/routing\/README\.md generated block \d+ B > 768 B \(256 \+ 256 B\/row × 2 rows\)/);

    const many = Array.from({ length: 7 }, (_, i) => ['agent-' + i, 'Short.']);
    write(dir, 'docs/reference/routing/README.md', agentsDoc(many));
    const over = check(dir);
    assert.match(over.stdout, /generated block holds 7 rows > maxRows 6/);
    assert.strictEqual(over.status, 1);

    write(dir, 'docs/reference/routing/README.md', exact('# AGENTS, registry removed', 3000));
    const gone = check(dir);
    assert.match(gone.stdout, /block markers were not found/);
    assert.strictEqual(gone.status, 1);
  });

  test('--check writes NOTHING — not the report an ordinary run writes, not the fixture it reads', () => {
    const dir = fixture();
    const fresh = snapshot(dir);
    for (const args of [[], ['--budget', path.join(dir, 'absent-on-purpose.json')]]) check(dir, args);
    assert.deepStrictEqual(snapshot(dir), fresh, '--check created or changed a file in a tree with no report yet');
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'harness', 'harness-baseline.json')));

    // ...and with a report already on disk, which is the state a real repo is in.
    assert.strictEqual(run(dir, ['--no-hooks']).status, 0);
    const withReport = snapshot(dir);
    assert.ok(withReport[path.join('scripts', 'harness', 'harness-baseline.json')], 'the ordinary run did not write its report');
    write(dir, 'AGENTS.md', exact('# CLAUDE', 9000));
    const grown = snapshot(dir);
    const r = check(dir);
    assert.strictEqual(r.status, 1, 'the breach this half depends on did not happen');
    assert.deepStrictEqual(snapshot(dir), grown, 'a RED --check wrote a file');
  });

  test('the gate names what it does NOT grade, on every run — green, red and fixture-less', () => {
    // A green `GATE context pass=6` must not be readable as "context is under control".
    const dir = fixture();
    const green = check(dir);
    const b = readBudget(dir);
    b.ceilings.nestedOnTouch['worker/AGENTS.md'] = 1;
    writeBudget(dir, b);
    const red = check(dir);
    const none = check(dir, ['--budget', path.join(dir, 'absent-on-purpose.json')]);
    assert.deepStrictEqual([green.status, red.status, none.status], [0, 1, 1]);
    for (const r of [green, red, none]) {
      assert.match(r.stdout, /note: NOT GRADED, repo-owned — listing \.claude\/agents \(repo\) \d+ tok/);
      assert.match(r.stdout, /repo-owned always-on \d+ tok/);
      assert.match(r.stdout, /measured first turn not recorded/);
      assert.match(r.stdout, /third-party skill and agent listings, hook stdout, MCP tool definitions and the per-subagent floor NOT measured/);
    }
    // The empty case is printed too: "every run" has to be literally true.
    const bare = check(fixture({ agents: false }));
    assert.match(bare.stdout, /note: NOT GRADED, repo-owned — listing none enumerated on this box \(0 tok\)/);
  });

  test('an absent config is a two-line stop with a fix, not a stack trace', () => {
    const dir = fixture();
    fs.rmSync(path.join(dir, 'harness.config.json'));
    const r = check(dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /^FATAL — /);
    assert.match(r.stderr, /^ {3}fix: /m);
    assert.strictEqual(r.stderr.trim().split(/\r?\n/).length, 2, 'more than the two lines:\n' + r.stderr);
  });
});
