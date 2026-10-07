'use strict';
/* ============================================================
   docs.test.js — the doc contract, driven as exit codes.

   Five scripts enforce the doc layer: docs-lint.cjs (the gate), doc-frozen.cjs (the predicates
   it shares with the write guard), docs-index.js (the generated routing table), handoff-lint.js
   (the handoff block) and split-doc.js (the lossless split). Each one DECIDES something, so each
   rule here is driven both ways: the shape that must fail, and the nearest shape that must not.
   A rule only ever seen saying NO is indistinguishable from a rule that cannot say YES.

   Everything runs the REAL scripts as processes, copied into a throwaway repo:
     · the verdict is an exit code and a last stdout line, which an import cannot observe
     · the frozen-evidence and trap-citation rules ask git, so the fixture has to BE a repo
     · HOME is redirected into the sandbox, so the auto-memory rule can never read or write the
       real index of whoever runs this suite
   ============================================================ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
// tools.js and the registry travel with the linter: it reads the instruction-file names off them.
const HARNESS = ['config.js', 'close-phase.js', 'docs-index.js', 'handoff-lint.js', 'split-doc.js', 'tools.js', 'tools.json'];
const HELPERS = ['docs-lint.cjs', 'doc-frozen.cjs'];
const LINT = 'scripts/harness/guards/docs-lint.cjs';
const INDEX = 'scripts/harness/docs-index.js';
const HANDOFF = 'scripts/harness/handoff-lint.js';
const SPLIT = 'scripts/harness/split-doc.js';

/* Every case builds its own repo and spawns the real scripts, so the cost is process start-up, not
   work. Cases inside a suite run side by side; each owns its sandbox, so they cannot interfere. */
const SUITE = { concurrency: Math.max(2, Math.min(8, os.availableParallelism ? os.availableParallelism() : 4)) };

const CAP = 40; // the fixture's default cap: small, so an over-cap doc is a short literal

const CONFIG = {
  project: { name: 'example', docsRoot: 'docs', tracksDir: 'docs/tracks' },
  gates: [{ name: 'docs', command: 'node scripts/harness/guards/docs-lint.cjs' }],
  docs: {
    caps: { 'AGENTS.md': 80, 'CLAUDE.md': 5, subtreeAgentsMd: 10, default: CAP },
    exemptDirs: ['docs/archive', 'docs/explorations'],
  },
};

/* ---------- fixture docs ---------- */
const fm = (fields) => '---\n' + Object.keys(fields).map((k) => k + ': ' + fields[k]).join('\n') + '\n---\n';
const doc = (fields, body) => fm(fields) + '\n' + body;
const ref = (id, body, extra) => doc(Object.assign(
  { id, kind: 'reference', status: 'open', read_when: '"you need ' + id + '"' }, extra || {}), body || '# ' + id + '\n\nbody\n');
/** A doc of EXACTLY `total` lines, frontmatter included, so a cap boundary can be hit on the nose. */
const sized = (fields, total) => {
  const head = fields ? fm(fields) : '';
  const have = head ? head.split('\n').length - 1 : 0;
  return head + Array.from({ length: total - have }, (_, i) => 'line ' + String.fromCharCode(97 + (i % 26))).join('\n') + '\n';
};

const HANDOFF_BLOCK = [
  '## ▶ NEXT: phase two',
  '',
  'Read, in this order:',
  '  docs/tracks/alpha/README.md  (the standing rule)',
  'SCOPE: one thing in, everything else out.',
  'Do NOT re-measure the baseline; it is already measured.',
  'Inherited state: figures come from gates.json only.',
  'First commit: `feat(alpha): the next step`.',
  'Exit: `node scripts/harness/handoff-lint.js alpha`.',
  'Follow "How to work" in the track README.',
  '',
].join('\n');
const HANDOFF_FM = { id: 'alpha-handoff', kind: 'handoff', status: 'open', read_when: '"starting the next phase of alpha"' };
const handoffDoc = (block) => doc(HANDOFF_FM, '# Handoff\n\n' + block);

const TRACK_FM = { id: 'alpha', kind: 'track', status: 'open', read_when: '"any work on alpha"', trap_prefix: 'AL' };
const TRACK_BODY = '# Alpha\n\n## How to work\n\nOne phase at a time.\n';
const TRAPS_FM = { id: 'alpha-traps', kind: 'traps', status: 'open', read_when: '"before touching alpha"', trap_prefix: 'AL' };
const trapsDoc = (lines) => doc(TRAPS_FM, '# Traps\n\n' + lines.join('\n') + '\n');
const RESEARCH = 'docs/tracks/alpha/research/2026-01-04-baseline.md';
const RESEARCH_FM = { id: 'alpha-baseline', kind: 'research', status: 'frozen', read_when: '"what the baseline measured"' };
const RESEARCH_BODY = '# Baseline\n\nMeasured once, on a date.\n';
/* The lead-only routing doc, where the generated agent registry lives. The policy file is
   AGENTS.md, and CLAUDE.md is the stub that imports it: a pointer, never a second body. */
const ROUTING = 'docs/reference/routing/README.md';
const ROUTING_MD = fm({ id: 'routing', kind: 'reference', status: 'open', read_when: '"choosing a mode or spawning"' })
  + '\n# Routing\n\nA line above the registry.\n\n<!-- agents:begin -->\n<!-- agents:end -->\n\nA line below the registry.\n';
const STUB_MD = '<!-- a pointer, not policy -->\n@AGENTS.md\n';

const BASE = {
  '.gitignore': 'out.json\n',
  'AGENTS.md': '# Fixture\n\nAlways-on context.\n',
  'CLAUDE.md': STUB_MD,
  [ROUTING]: ROUTING_MD,
  'src/real.js': '// tracked and present\n',
  'docs/reference/thing.md': ref('thing'),
  'docs/tracks/alpha/README.md': doc(TRACK_FM, TRACK_BODY),
  'docs/tracks/alpha/handoff.md': handoffDoc(HANDOFF_BLOCK),
  'docs/tracks/alpha/traps.md': trapsDoc(['- AL-01 the loader caches by path. Anchor: `src/real.js`']),
  [RESEARCH]: doc(RESEARCH_FM, RESEARCH_BODY),
};

/* ---------- the sandbox ---------- */
async function sandbox(opts) {
  const o = opts || {};
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-docs-')));
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const abs = (rel) => path.join(root, rel);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(abs(rel)), { recursive: true }); fs.writeFileSync(abs(rel), text); };
  const read = (rel) => fs.readFileSync(abs(rel), 'utf8');
  const has = (rel) => fs.existsSync(abs(rel));

  fs.mkdirSync(abs('scripts/harness'), { recursive: true });
  fs.mkdirSync(abs('scripts/harness/guards'), { recursive: true });
  for (const f of HARNESS) fs.copyFileSync(path.join(REPO, 'scripts', 'harness', f), abs('scripts/harness/' + f));
  for (const f of HELPERS) fs.copyFileSync(path.join(REPO, 'scripts', 'harness', 'guards', f), abs('scripts/harness/guards/' + f));
  if (o.config !== null) put('harness.config.json', JSON.stringify(o.config || CONFIG, null, 2));
  const files = Object.assign({}, o.bare ? {} : BASE, o.files || {});
  for (const rel of Object.keys(files)) if (files[rel] != null) put(rel, files[rel]);

  // Inherited, CLAUDE_PROJECT_DIR would point every fixture at the real repo; HOME decides where
  // the auto-memory index is looked for, and it must never be the real one.
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home });
  delete env.CLAUDE_PROJECT_DIR;
  /* Asynchronous, so the cases of a suite overlap. `status` is the exit code exactly as spawnSync
     reports it; a process that could not be started at all is -1, which no assertion here accepts. */
  const spawn = (cmd, args) => new Promise((done) => {
    execFile(cmd, args, { cwd: root, encoding: 'utf8', env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => done({ status: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr }));
  });
  const node = async (script, args) => {
    const r = await spawn(process.execPath, [abs(script)].concat(args || []));
    r.out = String(r.stdout) + String(r.stderr);
    return r;
  };
  const git = (...a) => spawn('git', a);
  const commit = async (msg) => {
    assert.strictEqual((await git('-c', 'core.autocrlf=false', 'add', '-A')).status, 0, 'the fixture could not be staged');
    const c = await git('-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
      'commit', '-q', '-m', msg || 'fixture');
    assert.strictEqual(c.status, 0, 'the fixture could not be committed: ' + c.stderr);
  };
  if (o.git !== false) {
    assert.strictEqual((await git('-c', 'init.defaultBranch=main', 'init', '-q')).status, 0, 'could not init the throwaway repo');
    await commit();
  }

  /** One lint run, with the verdict already taken apart. `last` is the LAST stdout line, which is
   *  the only place the gate protocol allows the verdict to be. */
  const lint = async (args) => {
    const r = await node(LINT, args);
    const lines = String(r.stdout).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    r.last = lines[lines.length - 1];
    const m = /^GATE docs pass=(\d+) fail=(\d+) skipped=(\d+)$/.exec(r.last || '');
    r.gate = m ? { pass: Number(m[1]), fail: Number(m[2]), skipped: Number(m[3]) } : null;
    r.fails = String(r.stderr).split('\n').filter((l) => l.startsWith('FAIL  '));
    r.warns = String(r.stdout).split('\n').filter((l) => l.startsWith('WARN  '));
    return r;
  };
  return { base, root, home, abs, put, read, has, node, git, commit, lint,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
async function withSandbox(opts, body) {
  const s = await sandbox(opts);
  try { return await body(s); } finally { s.cleanup(); }
}

/** The whole shape of a red lint: exit 1, a well-formed verdict that agrees with it, and a FAIL
 *  line that names the file and says why. */
function assertRed(r, file, why) {
  assert.strictEqual(r.status, 1, 'expected a red lint, got exit ' + r.status + ':\n' + r.out);
  assert.ok(r.gate, 'a red lint still owes a GATE line as its last stdout line:\n' + r.out);
  assert.ok(r.gate.fail >= 1, 'exit 1 with fail=0 in the verdict');
  const hit = r.fails.filter((l) => l.includes(file) && why.test(l));
  assert.ok(hit.length >= 1, 'no FAIL line for ' + file + ' matching ' + why + ':\n' + r.out);
}
function assertGreen(r) {
  assert.strictEqual(r.status, 0, 'expected a green lint, got exit ' + r.status + ':\n' + r.out);
  assert.ok(r.gate, 'no well-formed GATE line as the last stdout line:\n' + r.out);
  assert.strictEqual(r.gate.fail, 0, r.out);
  assert.deepStrictEqual(r.fails, [], r.out);
}

/* ============================================================ */
describe('docs-lint — exactly one policy body: a CLAUDE.md is a pointer and nothing else', SUITE, () => {
  /* Rule 12. The policy lives in AGENTS.md. A tool that does not load that file natively reads a
     stub that imports it, and the stub may carry the import line and comments only: a second file
     holding rules drifts from the first, silently, and each tool goes on obeying its own copy.
     Both halves of the rule get a FAILING fixture, at the root and in a subtree, and the passing
     case is pinned beside them so the rule is seen saying yes as well as no. */
  const STUB_RULE = /import stub: \d+ content line\(s\) besides the import/;
  const NO_POLICY = /import stub: no AGENTS\.md with a body beside it/;
  const NO_STUB = /policy file: no `CLAUDE\.md` stub beside it/;
  const IMPORTS = /policy file: line \d+ imports `@/;
  const only = (ids) => Object.assign({}, CONFIG, { tools: { enabled: ids } });

  test('the fixture tree, whose root CLAUDE.md is the import and a comment, is green', async () => {
    await withSandbox({}, async (s) => {
      const r = await s.lint();
      assertGreen(r);
      assert.doesNotMatch(r.out, /import stub/);
    });
  });

  test('a root CLAUDE.md that carries a rule beside the import FAILS', async () => {
    await withSandbox({ files: { 'CLAUDE.md': STUB_MD + '\n- Never push to main.\n' } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'CLAUDE.md', STUB_RULE);
      assert.ok(r.fails.some((l) => l.includes('"- Never push to main."')), 'the finding does not quote the offending line:\n' + r.out);
    });
  });

  test('a root CLAUDE.md that IS a policy body, with no import at all, FAILS on both counts', async () => {
    await withSandbox({ files: { 'CLAUDE.md': '# Project policy\n\n## Rules\n\n- Never push to main.\n' } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'CLAUDE.md', STUB_RULE);
      assertRed(r, 'CLAUDE.md', /import stub: no `@AGENTS\.md` line/);
    });
  });

  test('a NESTED CLAUDE.md with a content line FAILS, wherever in the tree it sits', async () => {
    const files = { 'src/api/AGENTS.md': '# api\n\nInvariants.\n', 'src/api/CLAUDE.md': '@AGENTS.md\n\nAlso: the api never logs a token.\n' };
    await withSandbox({ files }, async (s) => {
      assertRed(await s.lint(), 'src/api/CLAUDE.md', STUB_RULE);
    });
  });

  test('a stub with NO AGENTS.md beside it FAILS: the import points at nothing', async () => {
    await withSandbox({ files: { 'src/api/CLAUDE.md': STUB_MD } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'src/api/CLAUDE.md', NO_POLICY);
      assert.ok(!r.fails.some((l) => l.includes('src/api/CLAUDE.md') && STUB_RULE.test(l)), 'a clean pointer was also reported as carrying content:\n' + r.out);
    });
  });

  test('...and at the ROOT too: a stub left behind after the policy file is deleted', async () => {
    await withSandbox({}, async (s) => {
      fs.rmSync(s.abs('AGENTS.md'));
      assertRed(await s.lint(), 'CLAUDE.md', NO_POLICY);
    });
  });

  test('a nested stub WITH its AGENTS.md beside it passes, and a multi-line comment is still a comment', async () => {
    const files = { 'src/api/AGENTS.md': '# api\n\nInvariants.\n', 'src/api/CLAUDE.md': '<!-- a pointer\n     spread over two lines -->\n\n@AGENTS.md\n' };
    await withSandbox({ files }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  test('a stub inside a skipped directory is not swept, as nothing else there is', async () => {
    await withSandbox({ files: { 'node_modules/dep/CLAUDE.md': '# a dependency\'s own instructions\n' } }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  test('the policy file itself is NOT a stub: it may carry every rule there is', async () => {
    await withSandbox({ files: { 'AGENTS.md': '# Policy\n\n- Never push to main.\n- Never commit a secret.\n' } }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  /* The other direction. The enabled tool reaches the policy only through the stub, so a policy
     file with no stub beside it is a directory that tool loads NO policy for, and every other
     check in the suite stays green over it. */
  test('a root policy file whose stub was DELETED fails: the enabled tool now loads no policy at all', async () => {
    await withSandbox({}, async (s) => {
      fs.rmSync(s.abs('CLAUDE.md'));
      const r = await s.lint();
      assertRed(r, 'AGENTS.md', NO_STUB);
      assert.ok(r.fails.some((l) => l.includes('@AGENTS.md')), 'the finding does not say what the stub holds:\n' + r.out);
    });
  });

  test('a NESTED policy file with no stub beside it fails, and the stub clears it', async () => {
    await withSandbox({ files: { 'src/api/AGENTS.md': '# api\n\nInvariants.\n' } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'src/api/AGENTS.md', NO_STUB);
      assert.ok(!r.fails.some((l) => l.startsWith('FAIL  AGENTS.md')), 'the root, which has its stub, was failed too:\n' + r.out);
      s.put('src/api/CLAUDE.md', STUB_MD);
      assertGreen(await s.lint());
    });
  });

  test('...but only for a tool that is ENABLED: a repo wired for a tool that loads the policy file natively owes no stub', async () => {
    await withSandbox({ config: only(['codex-cli']), files: { 'src/api/AGENTS.md': '# api\n\nInvariants.\n' } }, async (s) => {
      fs.rmSync(s.abs('CLAUDE.md'));
      assertGreen(await s.lint());
      // A stub that IS there is still held to being a pointer, whichever tools are on.
      s.put('CLAUDE.md', STUB_MD + '\n- Never push to main.\n');
      assertRed(await s.lint(), 'CLAUDE.md', STUB_RULE);
    });
  });

  test('an EMPTY policy file is no policy file: the stub beside it imports nothing', async () => {
    for (const empty of ['', '\n\n', '<!-- to be written -->\n']) {
      await withSandbox({ files: { 'AGENTS.md': empty } }, async (s) => {
        assertRed(await s.lint(), 'CLAUDE.md', NO_POLICY);
      });
    }
  });

  test('the policy file imports NOTHING: an import there is an always-on file the context gate never charges', async () => {
    await withSandbox({ files: { 'AGENTS.md': '# Policy\n\n- Never push.\n@docs/reference/thing.md\n' } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'AGENTS.md', IMPORTS);
      assert.ok(r.fails.some((l) => l.includes('line 4 imports `@docs/reference/thing.md`')), 'the finding does not name the line and the path:\n' + r.out);
    });
    // Mid-line, and in a subtree file, resolved from that file's own directory.
    const nested = { 'src/api/AGENTS.md': '# api\n\nRead @notes.md first.\n', 'src/api/CLAUDE.md': STUB_MD, 'src/api/notes.md': 'notes\n' };
    await withSandbox({ files: nested }, async (s) => {
      assertRed(await s.lint(), 'src/api/AGENTS.md', IMPORTS);
    });
    await withSandbox({ files: { 'AGENTS.md': '# Policy\n\n@~/.tool/private-rules.md\n' } }, async (s) => {
      assertRed(await s.lint(), 'AGENTS.md', IMPORTS);
    });
  });

  test('...and what is NOT an import passes: a path in backticks or a fence, a name that resolves to no file, an address', async () => {
    const body = '# Policy\n\nThe stub holds `@AGENTS.md`. See `@docs/reference/thing.md`.\n\n```\n@docs/reference/thing.md\n```\n\nAsk @nobody-by-that-name, or mail team@example.com.\n';
    await withSandbox({ files: { 'AGENTS.md': body } }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  test('a stub under the DOCS root has a legal form: the import and no frontmatter', async () => {
    // Rule 2 used to demand a frontmatter block of it and rule 12 to fail the block as content.
    const files = { 'docs/reference/sub/AGENTS.md': ref('sub-policy', '# sub\n\nInvariants.\n'), 'docs/reference/sub/CLAUDE.md': STUB_MD };
    await withSandbox({ files }, async (s) => {
      assertGreen(await s.lint());
      // The policy file beside it is still a doc, and still owes its frontmatter.
      s.put('docs/reference/sub/AGENTS.md', '# sub\n\nInvariants.\n');
      assertRed(await s.lint(), 'docs/reference/sub/AGENTS.md', /no frontmatter block/);
    });
  });

  test('a registry that cannot be read is a STOP with no verdict, never a sweep that found no stub', async () => {
    for (const breakIt of [(s) => fs.rmSync(s.abs('scripts/harness/tools.json')), (s) => s.put('scripts/harness/tools.json', '{ "tools": [')]) {
      await withSandbox({ files: { 'CLAUDE.md': '# A whole second policy body\n\n- Never push.\n' } }, async (s) => {
        breakIt(s);
        const r = await s.lint();
        assert.strictEqual(r.status, 1, r.out);
        assert.match(r.stderr, /^FATAL — cannot read the tool registry at scripts\/harness\/tools\.json/);
        assert.match(r.stderr, /^ {3}fix: restore scripts\/harness\/tools\.json/m);
        assert.doesNotMatch(r.stdout, /GATE docs/, 'a verdict was printed over a rule that had no subject');
      });
    }
  });
});

/* ============================================================ */
describe('every doc script keeps a --self-test that passes', SUITE, () => {
  const real = (rel) => spawnSync(process.execPath, [path.join(REPO, rel), '--self-test'], { cwd: REPO, encoding: 'utf8' });
  for (const rel of ['scripts/harness/guards/docs-lint.cjs', 'scripts/harness/guards/doc-frozen.cjs', INDEX, HANDOFF, SPLIT]) {
    test(rel + ' --self-test', async () => {
      const r = real(rel);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      // Exit 0 alone is what a script with NO self-test also returns. The count is the proof.
      const m = /^PASS — (\S+) self-test \((\d+) checks\)$/m.exec(r.stdout);
      assert.ok(m, 'no PASS line naming a check count: ' + JSON.stringify(r.stdout));
      assert.strictEqual(m[1], path.basename(rel));
      assert.ok(Number(m[2]) >= 10, 'a self-test of ' + m[2] + ' checks is not driving the script');
    });
  }

  test('doc-frozen.cjs prints nothing when it is required, because a hook imports it', async () => {
    const r = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(REPO, 'scripts', 'harness', 'guards', 'doc-frozen.cjs')) + ')'],
      { cwd: REPO, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout + r.stderr, '');
  });

  test('doc-frozen.cjs answers without a config at all', async () => {
    // Standalone: the predicates take explicit options, and an unreadable config degrades to the
    // strict answer instead of throwing inside a hook.
    await withSandbox({ config: null, bare: true, git: false }, async (s) => {
      const script = [
        'const d = require("./scripts/harness/guards/doc-frozen.cjs");',
        'console.log(JSON.stringify({',
        '  research: d.frozenBody(d.parseFrontmatter("---\\nkind: research\\n---\\nx\\n")),',
        '  index: d.frozenBody(d.parseFrontmatter("---\\nkind: index\\n---\\nx\\n")),',
        '  noConfigExempt: d.capExempt("docs/archive/a.md"),',
        '  listed: d.capExempt("docs/archive/a.md", { dirs: ["docs/archive"] }),',
        '}));',
      ].join('\n');
      const r = spawnSync(process.execPath, ['-e', script], { cwd: s.root, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(r.stdout), { research: true, index: false, noConfigExempt: false, listed: true });
    });
  });
});

/* ============================================================ */
describe('docs-lint — the verdict', SUITE, () => {
  test('a clean tree is green and the LAST stdout line is a well-formed GATE line', async () => {
    await withSandbox({}, async (s) => {
      const r = await s.lint();
      assertGreen(r);
      assert.match(r.last, /^GATE docs pass=\d+ fail=0 skipped=\d+$/);
      assert.ok(r.gate.pass > 0, 'a green verdict that graded nothing');
      assert.ok(String(r.stdout).endsWith(r.last + '\n'), 'something was printed after the verdict');
    });
  });

  test('a red tree still ends on the GATE line, and its fail figure is the number of findings', async () => {
    await withSandbox({ files: { 'docs/reference/a.md': '# no frontmatter\n', 'docs/reference/b.md': ref('thing') } }, async (s) => {
      const r = await s.lint();
      assert.strictEqual(r.status, 1);
      assert.ok(r.gate, 'a red run printed no well-formed GATE line last:\n' + r.out);
      assert.strictEqual(r.gate.fail, r.fails.length, 'the verdict and the findings disagree');
      assert.ok(r.gate.fail >= 2);
    });
  });

  test('an absent config is a hard stop with no verdict at all', async () => {
    await withSandbox({ config: null }, async (s) => {
      const r = await s.lint();
      assert.notStrictEqual(r.status, 0);
      assert.strictEqual(r.gate, null, 'a linter with no config still printed a verdict');
      assert.doesNotMatch(r.out, /^GATE /m);
      assert.match(r.stderr, /harness\.config\.json/);
    });
  });

  test('an empty prose tree declares a skip instead of passing by absence', async () => {
    await withSandbox({ bare: true }, async (s) => {
      const r = await s.lint();
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /^SKIP {2}the whole sweep SKIPPED/m);
      assert.ok(r.gate && r.gate.skipped >= 1, r.out);
      assert.doesNotMatch(r.out, /never ran/, 'an empty tree was reported as a wall of dead rules');
    });
  });

  test('a rule whose call site is deleted is NAMED, not left to a figure comparison', async () => {
    await withSandbox({}, async (s) => {
      const src = s.read(LINT);
      const mutated = src.replace('applied(7);', '');
      assert.notStrictEqual(mutated, src, 'the mutation did not apply — this test proves nothing');
      const before = await s.lint();
      s.put(LINT, mutated);
      const after = await s.lint();
      assertRed(after, 'docs-lint', /rule 7 never ran/);
      assert.ok(after.gate.pass + after.gate.fail < before.gate.pass + before.gate.fail,
        'the total did not fall when a rule stopped running');
    });
  });
});

/* ============================================================ */
describe('docs-lint — frontmatter and ids', SUITE, () => {
  test('a doc with no frontmatter block fails', async () => {
    await withSandbox({ files: { 'docs/reference/bare.md': '# bare\n\nbody\n' } }, async (s) => {
      assertRed(await s.lint(), 'docs/reference/bare.md', /no frontmatter block/);
    });
  });

  for (const field of ['id', 'kind', 'status', 'read_when']) {
    test('a doc missing `' + field + '` fails on that field', async () => {
      const fields = { id: 'partial', kind: 'reference', status: 'open', read_when: '"x"' };
      delete fields[field];
      await withSandbox({ files: { 'docs/reference/partial.md': doc(fields, '# p\n') } }, async (s) => {
        const r = await s.lint();
        assertRed(r, 'docs/reference/partial.md', new RegExp('frontmatter missing `' + field + '`'));
        assert.strictEqual(r.fails.length, 1, 'one missing field produced more than one finding:\n' + r.out);
      });
    });
  }

  test('a kind or a status outside the enum fails', async () => {
    await withSandbox({ files: {
      'docs/reference/k.md': ref('k', null, { kind: 'essay' }),
      'docs/reference/s.md': ref('s', null, { status: 'done' }),
    } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'docs/reference/k.md', /kind: essay not one of/);
      assertRed(r, 'docs/reference/s.md', /status: done not one of/);
    });
  });

  test('a duplicate `id` is refused, and the refusal names both files', async () => {
    await withSandbox({ files: { 'docs/reference/twin.md': ref('thing') } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'docs/reference/twin.md', /duplicate id `thing` \(also docs\/reference\/thing\.md\)/);
    });
  });

  test('the archive needs no frontmatter and the human README is out of scope', async () => {
    await withSandbox({ files: { 'docs/archive/old.md': '# closed\n\nno frontmatter\n', 'README.md': sized(null, CAP * 3) } }, async (s) => {
      assertGreen(await s.lint());
    });
  });
});

/* ============================================================ */
describe('docs-lint — the line caps are hard', SUITE, () => {
  const over = { id: 'long', kind: 'reference', status: 'open', read_when: '"x"' };

  test('a doc one line over the cap fails, and one exactly at it does not', async () => {
    await withSandbox({ files: { 'docs/reference/long.md': sized(over, CAP + 1) } }, async (s) => {
      assertRed(await s.lint(), 'docs/reference/long.md', new RegExp((CAP + 1) + ' lines > cap ' + CAP));
      s.put('docs/reference/long.md', sized(over, CAP));
      assertGreen(await s.lint());
    });
  });

  test('an archive doc and an exploration at the same length do not fail', async () => {
    await withSandbox({ files: {
      'docs/archive/long.md': sized(null, CAP + 1),
      'docs/explorations/long.md': sized({ id: 'expl', kind: 'exploration', status: 'frozen', read_when: '"x"' }, CAP + 1),
    } }, async (s) => {
      const r = await s.lint();
      assertGreen(r);
      assert.doesNotMatch(r.out, /> cap/);
    });
  });

  test('a lookalike directory is NOT exempt', async () => {
    await withSandbox({ files: { 'docs/archived-notes/long.md': sized(Object.assign({}, over, { id: 'lookalike' }), CAP + 1) } }, async (s) => {
      assertRed(await s.lint(), 'docs/archived-notes/long.md', /> cap/);
    });
  });

  test('an exact path key and the subtree AGENTS.md cap both apply', async () => {
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.docs.caps['docs/reference/thing.md'] = 5;
    await withSandbox({ config, files: { 'src/AGENTS.md': sized(null, 11) } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'docs/reference/thing.md', /lines > cap 5/);
      assertRed(r, 'src/AGENTS.md', /11 lines > cap 10/);
    });
  });

  test('the root policy file and the root stub are each held to their own cap', async () => {
    await withSandbox({ files: { 'AGENTS.md': sized(null, 81), 'CLAUDE.md': '<!-- a -->\n'.repeat(5) + '@AGENTS.md\n' } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'AGENTS.md', /81 lines > cap 80/);
      assertRed(r, 'CLAUDE.md', /6 lines > cap 5/);
    });
  });

  test('--grandfather downgrades the cap to a warning and exits 0', async () => {
    await withSandbox({ files: { 'docs/reference/long.md': sized(over, CAP + 1) } }, async (s) => {
      const r = await s.lint(['--grandfather']);
      assertGreen(r);
      assert.ok(r.warns.some((w) => /long\.md.*> cap.*\[grandfathered\]/.test(w)), r.out);
    });
  });

  test('the generated index is never capped: its length is the number of docs', async () => {
    const files = {};
    for (let i = 0; i < CAP + 5; i++) files['docs/reference/ref' + String(i).padStart(2, '0') + '.md'] = ref('ref' + i);
    await withSandbox({ files, git: false }, async (s) => {
      assert.strictEqual((await s.node(INDEX)).status, 0);
      assert.ok(s.read('docs/INDEX.md').split('\n').length > CAP, 'the fixture index is not over the cap');
      const r = await s.lint();
      assertGreen(r);
      assert.doesNotMatch(r.out, /INDEX\.md/);
    });
  });
});

/* ============================================================ */
describe('docs-lint — no gate figure in prose', SUITE, () => {
  const FIG = '# Status\n\nThe suite is at 41/41 today.\n';

  test('a figure in prose fails and the finding carries the line', async () => {
    await withSandbox({ files: { 'docs/reference/fig.md': ref('fig', FIG) } }, async (s) => {
      // The line is read off the fixture, so the finding is checked against the FILE a reader opens.
      const at = s.read('docs/reference/fig.md').split('\n').findIndex((l) => l.includes('41/41')) + 1;
      assertRed(await s.lint(), 'docs/reference/fig.md', new RegExp('line ' + at + ': gate figure `41/41` in prose'));
    });
  });

  test('`figure-ok` WITH a reason passes', async () => {
    await withSandbox({ files: { 'docs/reference/fig.md': ref('fig', FIG + '\n<!-- figure-ok: a dated phase record, not a current claim -->\n') } }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  test('a bare `figure-ok` tag does not, and the finding says the tag has no reason', async () => {
    await withSandbox({ files: { 'docs/reference/fig.md': ref('fig', FIG + '\n<!-- figure-ok -->\n') } }, async (s) => {
      assertRed(await s.lint(), 'docs/reference/fig.md', /gate figure .*the tag here has no reason/);
    });
  });

  test('a one-word reason is a reflex, not a reason', async () => {
    await withSandbox({ files: { 'docs/reference/fig.md': ref('fig', FIG + '\n<!-- figure-ok: why -->\n') } }, async (s) => {
      assertRed(await s.lint(), 'docs/reference/fig.md', /gate figure/);
    });
  });

  test('a figure inside a code span or a fence is quoting, and a date is not a figure', async () => {
    const body = '# Status\n\nRun it and read `41/41` off the line. Measured 2026-01-04.\n\n```\nGATE x pass=41/41\n```\n';
    await withSandbox({ files: { 'docs/reference/fig.md': ref('fig', body) } }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  test('frozen evidence may carry its figures: they ARE the finding', async () => {
    await withSandbox({ files: {
      [RESEARCH]: doc(RESEARCH_FM, '# Baseline\n\nMeasured 41/41 on the day.\n'),
      'docs/archive/old.md': 'Closed at 41/41.\n',
    } }, async (s) => {
      assertGreen(await s.lint());
    });
  });
});

/* ============================================================ */
describe('docs-lint — exactly ONE ▶ block per track, in handoff.md', SUITE, () => {
  test('two ▶ blocks in a handoff fail', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/handoff.md': handoffDoc(HANDOFF_BLOCK + '\n## ▶ ALSO NEXT\n\nAnd this.\n') } }, async (s) => {
      assertRed(await s.lint(), 'docs/tracks/alpha/handoff.md', /2 ▶ blocks — a handoff carries exactly one/);
    });
  });

  test('a ▶ block outside handoff.md fails', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/README.md': doc(TRACK_FM, TRACK_BODY + '\n## ▶ NEXT\n\nDo the thing.\n') } }, async (s) => {
      assertRed(await s.lint(), 'docs/tracks/alpha/README.md', /▶ block outside handoff\.md/);
    });
  });

  test('exempting the tracks dir from the CAPS does not switch the ▶ rule off', async () => {
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.docs.exemptDirs.push('docs/tracks');
    await withSandbox({ config, files: { 'docs/tracks/alpha/README.md': doc(TRACK_FM, TRACK_BODY + '\n## ▶ NEXT\n\nDo the thing.\n') } }, async (s) => {
      assertRed(await s.lint(), 'docs/tracks/alpha/README.md', /▶ block outside handoff\.md/);
    });
  });

  test('prose may name the glyph: the rule is about a heading', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/README.md': doc(TRACK_FM, TRACK_BODY + '\nThe ▶ block lives in the handoff.\n') } }, async (s) => {
      assertGreen(await s.lint());
    });
  });

  test('a bare `trap #n` fails where the track declares a prefix', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/README.md': doc(TRACK_FM, TRACK_BODY + '\nSee trap #3 first.\n') } }, async (s) => {
      assertRed(await s.lint(), 'docs/tracks/alpha/README.md', /bare `trap #n` — this track's traps are `AL-nn`/);
    });
  });
});

/* ============================================================ */
describe('docs-lint — every traps line cites a path that resolves today', SUITE, () => {
  test('a line citing a path that does not exist fails and names what it tried', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/traps.md': trapsDoc([
      '- AL-01 the loader caches by path. Anchor: `src/real.js`',
      '- AL-02 the writer is not atomic. Anchor: `src/no-such-file.js`',
    ]) } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'docs/tracks/alpha/traps.md', /no cited path resolves \(tried `src\/no-such-file\.js`\)/);
      assert.strictEqual(r.fails.length, 1, 'the line that DOES resolve was failed too:\n' + r.out);
    });
  });

  test('a line citing nothing at all fails', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/traps.md': trapsDoc(['- AL-01 a rumour with no anchor']) } }, async (s) => {
      assertRed(await s.lint(), 'docs/tracks/alpha/traps.md', /no cited path resolves — the trap cites none/);
    });
  });

  test('a table row is a trap line too, and a path:line citation resolves by its path', async () => {
    await withSandbox({ files: { 'docs/tracks/alpha/traps.md': trapsDoc([
      '| id | hazard | anchor |', '|---|---|---|',
      '| AL-01 | caches by path | `src/real.js:1` |',
      '| AL-02 | nothing behind it | `src/ghost.js:7` |',
    ]) } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'docs/tracks/alpha/traps.md', /src\/ghost\.js/);
      assert.strictEqual(r.fails.length, 1, r.out);
    });
  });

  test('a deliberately ignored artefact and a tracked-but-deleted file both resolve', async () => {
    await withSandbox({ files: {
      'src/deleted.js': '// tracked, then removed from this checkout\n',
      'docs/tracks/alpha/traps.md': trapsDoc([
        '- AL-01 cites an artefact the repo ignores. Anchor: `out.json`',
        '- AL-02 cites a tracked file this checkout deleted. Anchor: `src/deleted.js`',
      ]),
    } }, async (s) => {
      fs.rmSync(s.abs('src/deleted.js'));
      assert.ok(!s.has('out.json'), 'the fixture is wrong: out.json must NOT exist');
      assertGreen(await s.lint());
    });
  });
});

/* ============================================================ */
describe('docs-lint — a § reference and a relative link must resolve', SUITE, () => {
  test('an unresolvable `§N` fails, and one that names a real heading does not', async () => {
    const body = (n) => '# Sections\n\n## 2. The second part\n\nAs §' + n + ' says.\n';
    await withSandbox({ files: { 'docs/reference/sec.md': ref('sec', body(9)) } }, async (s) => {
      assertRed(await s.lint(), 'docs/reference/sec.md', /`§9` resolves to no heading in this doc or its folder/);
      s.put('docs/reference/sec.md', ref('sec', body(2)));
      assertGreen(await s.lint());
    });
  });

  test('a `§N` aimed at a NAMED doc resolves against that doc, not this one', async () => {
    const target = ref('target', '# Target\n\n## 3. Third\n\nbody\n');
    const body = (n) => '# Pointer\n\n## 7. Own heading\n\nSee target.md §' + n + ' for it.\n';
    await withSandbox({ files: { 'docs/reference/target.md': target, 'docs/reference/sub/pointer.md': ref('pointer', body(7)) } }, async (s) => {
      // §7 exists in the POINTER, but the reference names target.md, which has no 7.
      assertRed(await s.lint(), 'docs/reference/sub/pointer.md', /`target\.md §7` resolves to no heading/);
      s.put('docs/reference/sub/pointer.md', ref('pointer', body(3)));
      assertGreen(await s.lint());
    });
  });

  test('a dead relative link fails and a live one does not', async () => {
    await withSandbox({ files: { 'docs/reference/links.md': ref('links', '# Links\n\n[gone](gone.md) and [here](thing.md).\n') } }, async (s) => {
      const r = await s.lint();
      assertRed(r, 'docs/reference/links.md', /dead link gone\.md/);
      assert.strictEqual(r.fails.length, 1, r.out);
    });
  });
});

/* ============================================================ */
describe('docs-lint — frozen evidence is frozen', SUITE, () => {
  const SIGNAL = /frozen evidence edited — findings are dated, not maintained/;

  test('a research BODY edited after its commit fails', async () => {
    await withSandbox({}, async (s) => {
      assertGreen(await s.lint());
      s.put(RESEARCH, doc(RESEARCH_FM, '# Baseline\n\nQuietly changed after the fact.\n'));
      assertRed(await s.lint(), RESEARCH, SIGNAL);
    });
  });

  test('a frontmatter-only edit passes, so the index can carry the doc', async () => {
    await withSandbox({}, async (s) => {
      s.put(RESEARCH, doc(Object.assign({}, RESEARCH_FM, { read_when: '"reworded, and the body untouched"' }), RESEARCH_BODY));
      const r = await s.lint();
      assertGreen(r);
      assert.doesNotMatch(r.out, SIGNAL);
    });
  });

  test('a research file that was never committed is not an edit', async () => {
    await withSandbox({}, async (s) => {
      s.put('docs/tracks/alpha/research/2026-02-01-second.md',
        doc(Object.assign({}, RESEARCH_FM, { id: 'alpha-second' }), '# Second\n\nNew today.\n'));
      assertGreen(await s.lint());
    });
  });

  test('the rule keys on KIND: the index OF the evidence stays writable, a finding beside it does not', async () => {
    const index = (rows) => doc({ id: 'expl-index', kind: 'index', status: 'open', read_when: '"which exploration answers what"' },
      '# Explorations\n\n| doc | what it found |\n|---|---|\n' + rows.join('\n') + '\n');
    const finding = (text) => doc({ id: 'a-finding', kind: 'exploration', status: 'frozen', read_when: '"the thing that was measured"' },
      '# A finding\n\n' + text + '\n');
    await withSandbox({ files: {
      'docs/explorations/README.md': index(['| A-FINDING.md | a thing |']),
      'docs/explorations/A-FINDING.md': finding('Measured once.'),
    } }, async (s) => {
      s.put('docs/explorations/README.md', index(['| A-FINDING.md | a thing |', '| B-FINDING.md | another |']));
      assertGreen(await s.lint());
      s.put('docs/explorations/A-FINDING.md', finding('Measured twice, apparently.'));
      assertRed(await s.lint(), 'docs/explorations/A-FINDING.md', SIGNAL);
    });
  });
});

/* ============================================================ */
describe('docs-lint — `status: complete` needs a receipt only close-phase.js can write', SUITE, () => {
  const closed = (extra) => doc(Object.assign({}, TRACK_FM, { status: 'complete' }, extra || {}), TRACK_BODY);
  const README = 'docs/tracks/alpha/README.md';
  const receiptOf = (s, id) => {
    const r = spawnSync(process.execPath, ['-e',
      'process.stdout.write(require("./scripts/harness/close-phase.js").receiptFor(' + JSON.stringify(id) + ', "4", "gsha", "bsha"))'],
    { cwd: s.root, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.length > 8, 'the fixture could not compute a receipt');
    return r.stdout;
  };
  const parts = { closed_phase: '4', gates_sha: 'gsha', block_sha: 'bsha' };

  test('complete without a receipt fails', async () => {
    await withSandbox({ files: { [README]: closed() } }, async (s) => {
      assertRed(await s.lint(), README, /status: complete without a `receipt:` — only close-phase\.js may write one/);
    });
  });

  test('a typed receipt does not recompute', async () => {
    await withSandbox({ files: { [README]: closed(Object.assign({ receipt: 'deadbeefdeadbeef' }, parts)) } }, async (s) => {
      assertRed(await s.lint(), README, /`receipt:` does not recompute/);
    });
  });

  test('a receipt without the fields it is computed from proves nothing', async () => {
    await withSandbox({ files: { [README]: closed({ receipt: 'deadbeefdeadbeef', closed_phase: '4' }) } }, async (s) => {
      assertRed(await s.lint(), README, /`receipt:` without `gates_sha`, `block_sha`/);
    });
  });

  test('the receipt close-phase.js computes for THIS track passes, and another track\'s does not', async () => {
    await withSandbox({}, async (s) => {
      s.put(README, closed(Object.assign({ receipt: receiptOf(s, 'alpha') }, parts)));
      assertGreen(await s.lint());
      s.put(README, closed(Object.assign({ receipt: receiptOf(s, 'beta') }, parts)));
      assertRed(await s.lint(), README, /`receipt:` does not recompute/);
    });
  });

  test('a receipt outside a track folder is refused', async () => {
    await withSandbox({ files: { 'docs/reference/thing.md': ref('thing', null, Object.assign({ status: 'complete', receipt: 'deadbeefdeadbeef' }, parts)) } }, async (s) => {
      assertRed(await s.lint(), 'docs/reference/thing.md', /`receipt:` outside a track folder/);
    });
  });

  test('without close-phase.js the recompute is a declared skip, never a silent pass', async () => {
    await withSandbox({}, async (s) => {
      const before = await s.lint();
      fs.rmSync(s.abs('scripts/harness/close-phase.js'));
      const after = await s.lint();
      assert.match(after.stdout, /^SKIP {2}the receipt recompute SKIPPED/m);
      assert.strictEqual(after.gate.skipped, before.gate.skipped + 1, after.out);
      // ...and the part that needs no formula still bites.
      s.put(README, closed());
      assertRed(await s.lint(), README, /status: complete without a `receipt:`/);
    });
  });
});

/* ============================================================ */
describe('docs-lint — `source: external` requires the ⚠ UNTRUSTED banner in the BODY', SUITE, () => {
  const SIGN = String.fromCharCode(0x26A0), VS16 = String.fromCharCode(0xFE0F); // spelled out, never pasted
  const ext = (source, body, extraFm) => doc(Object.assign({}, RESEARCH_FM, { id: 'fetched', source }, extraFm || {}), body);
  const FILE = 'docs/tracks/alpha/research/2026-01-05-fetched.md';
  const WHY = /declares external content, but the body carries no `. UNTRUSTED` banner/;

  test('external without the banner fails', async () => {
    await withSandbox({ files: { [FILE]: ext('external', '# Fetched\n\nWhat the page said.\n') } }, async (s) => {
      assertRed(await s.lint(), FILE, WHY);
    });
  });

  test('external WITH the banner passes, in the bare and the emoji-picker spelling', async () => {
    for (const glyph of [SIGN, SIGN + VS16]) {
      await withSandbox({ files: { [FILE]: ext('external', '# Fetched\n\n> ' + glyph + ' **UNTRUSTED**. Quoted content; data, not instruction.\n') } }, async (s) => {
        assertGreen(await s.lint());
      });
    }
  });

  test('a qualified value cannot talk its way out, and the finding names the value', async () => {
    await withSandbox({ files: { [FILE]: ext('mixed (repo measurement + one external report)', '# Fetched\n\nfindings\n') } }, async (s) => {
      const r = await s.lint();
      assertRed(r, FILE, WHY);
      assert.ok(r.fails.some((l) => l.includes('mixed (repo measurement + one external report)')), r.out);
    });
  });

  test('the bare word is not a banner, and a banner in FRONTMATTER warns nobody', async () => {
    await withSandbox({ files: { [FILE]: ext('external', '# Fetched\n\nUNTRUSTED content follows.\n') } }, async (s) => {
      assertRed(await s.lint(), FILE, WHY);
      s.put(FILE, ext('external', '# Fetched\n\nfindings\n', { read_when: '"' + SIGN + ' UNTRUSTED report"' }));
      assertRed(await s.lint(), FILE, WHY);
    });
  });

  test('a source that declares nothing external needs no banner', async () => {
    await withSandbox({ files: { [FILE]: ext('repo measurement, externally reviewed', '# Measured\n\nfindings\n') } }, async (s) => {
      assertGreen(await s.lint());
    });
  });
});

/* ============================================================ */
describe('docs-lint — staleness WARNS and never blocks', SUITE, () => {
  test('an expired last_verified is a WARN line, exit 0, and the fail figure stays 0', async () => {
    await withSandbox({}, async (s) => {
      const fresh = await s.lint();
      s.put('docs/reference/thing.md', ref('thing', null, { last_verified: '2020-01-01', max_age_days: '30' }));
      const r = await s.lint();
      assertGreen(r);
      assert.ok(r.warns.some((w) => /docs\/reference\/thing\.md: last_verified 2020-01-01 is \d+ d old \(max_age_days 30\)/.test(w)), r.out);
      assert.deepStrictEqual(r.gate, fresh.gate, 'a date passing moved the verdict');
    });
  });

  test('a doc verified inside its window says nothing', async () => {
    await withSandbox({ files: { 'docs/reference/thing.md': ref('thing', null, { last_verified: new Date().toISOString().slice(0, 10), max_age_days: '30' }) } }, async (s) => {
      const r = await s.lint();
      assertGreen(r);
      assert.deepStrictEqual(r.warns, []);
    });
  });

  test('a plan whose first_commit never landed warns, and one that did does not', async () => {
    const plan = (subject) => doc({ id: 'alpha-plan', kind: 'plan', status: 'open', read_when: '"planning alpha"', first_commit: '"' + subject + '"' }, '# Plan\n\nOne phase.\n');
    await withSandbox({ files: { 'docs/tracks/alpha/plan.md': plan('feat(alpha): never landed') } }, async (s) => {
      const r = await s.lint();
      assertGreen(r);
      assert.ok(r.warns.some((w) => /first_commit "feat\(alpha\): never landed" is not in git log yet/.test(w)), r.out);
      s.put('docs/tracks/alpha/plan.md', plan('fixture'));
      assert.deepStrictEqual((await s.lint()).warns, []);
    });
  });

  test('slop on an ADDED line warns only', async () => {
    await withSandbox({}, async (s) => {
      s.put('docs/reference/thing.md', ref('thing', '# thing\n\nHere we delve into the loader.\n'));
      const r = await s.lint();
      assertGreen(r);
      assert.ok(r.warns.some((w) => /git diff: 1 added line\(s\) carry slop markers/.test(w)), r.out);
    });
  });
});

/* ============================================================ */
describe('docs-lint — the auto-memory index: reported, never in the verdict, enforced at SessionStart', SUITE, () => {
  const CLEAN = '# Memory\n\n- [a](a.md) a short hook\n';
  const BAD = CLEAN + '- [b](b.md) ' + 'y'.repeat(200) + '\n';
  /** The path is DERIVED from the repo's own location, so the test reads it off the linter's
   *  declared skip rather than restating the derivation and agreeing with itself. */
  const memoryPath = async (s) => {
    const m = /rule 10 \(auto-memory\) SKIPPED — no index at (.+)$/m.exec((await s.lint()).stdout);
    assert.ok(m, 'an absent index was not declared as a skip');
    return m[1].trim();
  };
  const plant = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const check = async (s) => {
    const r = await s.node(LINT, ['--memory-check']);
    assert.strictEqual(r.status, 0, 'a SessionStart hook that exits non-zero is a broken session: ' + r.stderr);
    return String(r.stdout).trim();
  };

  test('the index path is derived from this checkout, under the user profile, as one flat directory name', async () => {
    await withSandbox({}, async (s) => {
      const p = await memoryPath(s);
      const projects = path.join(s.home, '.claude', 'projects');
      assert.ok(p.startsWith(projects + path.sep), p + ' is not under ' + projects);
      const [dir, ...rest] = path.relative(projects, p).split(path.sep);
      assert.deepStrictEqual(rest, ['memory', 'MEMORY.md']);
      assert.match(dir, /^[A-Za-z0-9-]+$/, 'the project directory name still carries a separator');
      assert.ok(dir.endsWith('-repo'), 'the name does not follow the checkout: ' + dir);
    });
  });

  test('an absent index is a declared skip, a present one is a made check, and the TOTAL is the same either way', async () => {
    await withSandbox({}, async (s) => {
      const absent = await s.lint();
      plant(await memoryPath(s), CLEAN);
      const present = await s.lint();
      assert.strictEqual(present.gate.skipped, absent.gate.skipped - 1, present.out);
      assert.doesNotMatch(present.out, /OUTSIDE|rule 10/);
      // The file is outside the repo, so its PRESENCE may not fail anything.
      assert.strictEqual(present.gate.fail, absent.gate.fail);
      // And it may not move the TOTAL, which is the figure the gate runner compares. It once did:
      // the sweep was untallied where the file existed and skipped=1 where it did not, so a
      // baseline accepted on a clean clone was one check LARGER than any run on a machine holding
      // an index, and that run read as "a check DISAPPEARED". A clean clone grows an index the day
      // the runtime first writes a memory, so every adopter met that red, on a delay. The skip
      // that went away has to come back as exactly one made check, and nothing else may move.
      const total = (g) => g.pass + g.fail + g.skipped;
      assert.strictEqual(total(present.gate), total(absent.gate), 'a file outside the repo moved the total:\n' + present.out);
      assert.strictEqual(present.gate.pass, absent.gate.pass + 1, present.out);
    });
  });

  test('an index that is there and cannot be read is a declared skip too, never a hole in the total', async () => {
    // The skip once asked the filesystem a second time (existsSync) while the sweep asked whether
    // the file could be READ. Something present and unreadable then landed in neither bucket.
    await withSandbox({}, async (s) => {
      const absent = await s.lint();
      fs.mkdirSync(await memoryPath(s), { recursive: true }); // a directory where the file belongs
      const unreadable = await s.lint();
      assert.deepStrictEqual(unreadable.gate, absent.gate, unreadable.out);
      assert.match(unreadable.stdout, /rule 10 \(auto-memory\) SKIPPED — the index at .+ could not be read/);
    });
  });

  test('an over-long line outside the repo is reported, and the verdict does not move', async () => {
    await withSandbox({}, async (s) => {
      const file = await memoryPath(s);
      plant(file, CLEAN);
      const clean = await s.lint();
      plant(file, BAD);
      const bad = await s.lint();
      assert.strictEqual(bad.last, clean.last, 'a file outside the repo moved the verdict');
      assert.strictEqual(bad.status, 0);
      assert.match(bad.stderr, /^OUTSIDE {2}MEMORY\.md: line 4: \d+ chars > 160/m);
    });
  });

  test('--memory-check is silent while clean, speaks as a SessionStart payload when not, and always exits 0', async () => {
    await withSandbox({}, async (s) => {
      assert.strictEqual(await check(s), '', 'the hook spoke with no index at all');
      const file = await memoryPath(s);
      plant(file, CLEAN);
      assert.strictEqual(await check(s), '', 'the hook spoke about a healthy index');
      plant(file, BAD);
      const out = await check(s);
      const j = JSON.parse(out);
      assert.strictEqual(j.hookSpecificOutput.hookEventName, 'SessionStart');
      assert.match(j.hookSpecificOutput.additionalContext, /chars > 160/);
      assert.match(j.systemMessage, /1 over-long line/);
      assert.doesNotMatch(out, /GATE docs/, 'the SessionStart mode ran the lint');
    });
  });

  test('--memory-check exits 0 even with no config, because it runs inside a session start', async () => {
    // The sandbox writes a config unless told otherwise, and `bare` only drops the docs: the
    // path is learned while the config is there, and the config is then REMOVED.
    await withSandbox({ bare: true, git: false }, async (s) => {
      const file = await memoryPath(s);
      fs.rmSync(s.abs('harness.config.json'));
      assert.ok(!s.has('harness.config.json'), 'the fixture has a config, so this case proves nothing');
      plant(file, BAD);
      assert.ok((await check(s)).length > 0);
      // The lint proper is a hard stop on the same tree: the soft path is this mode's alone.
      assert.strictEqual((await s.lint()).status, 1);
    });
  });

  test('--memory-check exits 0 and still speaks with the tool registry missing, unparseable, or its script gone', async () => {
    for (const breakIt of [
      (s) => fs.rmSync(s.abs('scripts/harness/tools.json')),
      (s) => s.put('scripts/harness/tools.json', 'not json'),
      (s) => fs.rmSync(s.abs('scripts/harness/tools.js')),
      (s) => s.put('harness.config.json', '{ "project": '),
    ]) {
      await withSandbox({ git: false }, async (s) => {
        const file = await memoryPath(s);
        breakIt(s);
        plant(file, BAD);
        const r = await s.node(LINT, ['--memory-check']);
        assert.strictEqual(r.status, 0, 'a SessionStart hook exited non-zero:\n' + r.out);
        assert.strictEqual(r.stderr, '', r.stderr);
        assert.match(JSON.parse(r.stdout).systemMessage, /1 over-long line/);
      });
    }
  });

  test('routing the finding back into the repo failures brings the false red back', async () => {
    // The mutation that proves the stable verdict above is not vacuous.
    await withSandbox({}, async (s) => {
      const src = s.read(LINT);
      const mutated = src.replace("outside('MEMORY.md', m);", "fail('MEMORY.md', m);");
      assert.notStrictEqual(mutated, src, 'the mutation did not apply — this test proves nothing');
      const file = await memoryPath(s);
      s.put(LINT, mutated);
      plant(file, BAD);
      assert.strictEqual((await s.lint()).status, 1);
    });
  });
});

/* ============================================================ */
describe('docs-index — the generated routing table', SUITE, () => {
  const EXTRA = {
    'docs/archive/old.md': '# closed\n',
    'docs/tracks/alpha/01-split-residue.md': ref('residue'),
    'docs/reference/blocked.md': ref('blocked', null, { blocked_on: '"a decision from the owner"', verify: 'node x.js' }),
  };
  const open = (files) => ({ files: Object.assign({}, EXTRA, files || {}), git: false });

  test('it generates one row per live doc from `read_when`, under the DO NOT EDIT banner', async () => {
    await withSandbox(open(), async (s) => {
      const r = await s.node(INDEX);
      assert.strictEqual(r.status, 0, r.out);
      const text = s.read('docs/INDEX.md');
      assert.match(text.split('\n')[0], /^<!-- GENERATED by scripts\/harness\/docs-index\.js\. DO NOT EDIT\./);
      assert.ok(text.includes('| [thing](reference/thing.md) | you need thing | open |'), text);
      assert.ok(text.includes('| [alpha](tracks/alpha/README.md) | any work on alpha | open |'), text);
      assert.ok(text.indexOf('## Tracks') < text.indexOf('## Reference'), 'open work is not listed first');
      assert.doesNotMatch(text, /archive\/old\.md/, 'closed work earned a row');
      assert.doesNotMatch(text, /01-split-residue/, 'split residue earned a row');
      assert.ok(text.includes('| [blocked](reference/blocked.md) | a decision from the owner | you need blocked |'), text);
      assert.ok(text.includes('| [blocked](reference/blocked.md) | `node x.js` | - |'), text);
      assert.match(text, /<!-- 7 live docs -->\n$/);
    });
  });

  test('the blocked section is present and says so when nothing is blocked', async () => {
    await withSandbox({ git: false }, async (s) => {
      await s.node(INDEX);
      assert.match(s.read('docs/INDEX.md'), /## Blocked: waiting on someone outside the code\n\nNothing is blocked\.\n/);
    });
  });

  test('--check is green on a fresh index and regenerating is a no-op', async () => {
    await withSandbox(open(), async (s) => {
      await s.node(INDEX);
      await s.node(INDEX, ['--agents']);
      const first = s.read('docs/INDEX.md');
      const r = await s.node(INDEX, ['--check']);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /docs-index --check: docs\/INDEX\.md matches \(7 live docs\)/);
      await s.node(INDEX);
      assert.strictEqual(s.read('docs/INDEX.md'), first);
    });
  });

  test('--check exit-codes a STALE index, names the first difference, and writes nothing', async () => {
    await withSandbox(open(), async (s) => {
      await s.node(INDEX);
      const committed = s.read('docs/INDEX.md');
      s.put('docs/reference/newer.md', ref('newer'));
      const r = await s.node(INDEX, ['--check']);
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, /INDEX DRIFT docs\/INDEX\.md differs from the generated index/);
      assert.match(r.stderr, /first difference at line \d+:/);
      assert.match(r.stderr, /generated: .*newer/);
      assert.strictEqual(s.read('docs/INDEX.md'), committed, '--check rewrote the file it was asked to judge');
    });
  });

  test('--check exit-codes a HAND EDIT and a missing index', async () => {
    await withSandbox(open(), async (s) => {
      assert.strictEqual((await s.node(INDEX, ['--check'])).status, 1, 'a missing index passed the check');
      assert.ok(!s.has('docs/INDEX.md'), '--check created the index');
      await s.node(INDEX);
      s.put('docs/INDEX.md', s.read('docs/INDEX.md').replace('you need thing', 'whenever you like'));
      const r = await s.node(INDEX, ['--check']);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /committed: .*whenever you like/);
    });
  });

  const AGENT = (name, extra) => '---\nname: ' + name + '\ndescription: read-only search of the tree\n' + (extra == null ? 'model: small\ntools: [Read, Grep]\n' : extra) + '---\n\nA brief.\n';

  test('--agents rewrites ONLY between the markers', async () => {
    await withSandbox({ git: false, files: { '.claude/agents/explore.md': AGENT('explore'), '.claude/agents/review.md': AGENT('review') } }, async (s) => {
      const before = s.read(ROUTING);
      const r = await s.node(INDEX, ['--agents']);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /docs\/reference\/routing\/README\.md registry block rewritten/);
      const after = s.read(ROUTING);
      const B = '<!-- agents:begin -->', E = '<!-- agents:end -->';
      assert.strictEqual(after.slice(0, after.indexOf(B)), before.slice(0, before.indexOf(B)), 'the text above the block changed');
      assert.strictEqual(after.slice(after.indexOf(E)), before.slice(before.indexOf(E)), 'the text below the block changed');
      const block = after.slice(after.indexOf(B), after.indexOf(E));
      assert.match(block, /GENERATED by `node scripts\/harness\/docs-index\.js --agents`\. DO NOT EDIT\./);
      assert.ok(block.includes('| `explore` | small | Read, Grep | read-only search of the tree |'), block);
      assert.ok(block.indexOf('`explore`') < block.indexOf('`review`'));
      assert.ok(!s.has('docs/INDEX.md'), '--agents wrote the index as a side effect');
      // Idempotent: a second run finds nothing to do and leaves the bytes alone.
      const again = await s.node(INDEX, ['--agents']);
      assert.match(again.stdout, /already current/);
      assert.strictEqual(s.read(ROUTING), after);
    });
  });

  test('--check exit-codes a registry block that DRIFTED from the agent files, both ways, and writes nothing', async () => {
    await withSandbox({ git: false, files: { '.claude/agents/explore.md': AGENT('explore') } }, async (s) => {
      await s.node(INDEX);
      // Never generated: the template's empty marker pair, with an agent file on disk.
      const empty = await s.node(INDEX, ['--check']);
      assert.strictEqual(empty.status, 1, empty.out);
      assert.match(empty.stderr, /REGISTRY DRIFT docs\/reference\/routing\/README\.md .* run `node scripts\/harness\/docs-index\.js --agents`/);
      assert.strictEqual(s.read(ROUTING), ROUTING_MD, '--check filled the block it was asked to judge');
      await s.node(INDEX, ['--agents']);
      const current = s.read(ROUTING);
      assert.strictEqual((await s.node(INDEX, ['--check'])).status, 0);
      // An agent added without regenerating.
      s.put('.claude/agents/zeta.md', AGENT('zeta'));
      const added = await s.node(INDEX, ['--check']);
      assert.strictEqual(added.status, 1, added.out);
      assert.match(added.stderr, /REGISTRY DRIFT/);
      assert.match(added.stderr, /generated: \| `zeta` \|/);
      assert.strictEqual(s.read(ROUTING), current);
      // A hand edit inside the block.
      fs.rmSync(s.abs('.claude/agents/zeta.md'));
      s.put(ROUTING, current.replace('| small |', '| huge |'));
      const edited = await s.node(INDEX, ['--check']);
      assert.strictEqual(edited.status, 1, edited.out);
      assert.match(edited.stderr, /committed: \| `explore` \| huge \|/);
      s.put(ROUTING, current);
      assert.strictEqual((await s.node(INDEX, ['--check'])).status, 0, 'restoring the generated block did not clear the drift');
    });
  });

  test('--agents --check is a verdict: it reports the stale block and rewrites nothing', async () => {
    await withSandbox({ git: false, files: { '.claude/agents/explore.md': AGENT('explore') } }, async (s) => {
      await s.node(INDEX);
      const r = await s.node(INDEX, ['--agents', '--check']);
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, /REGISTRY DRIFT/);
      assert.doesNotMatch(r.stdout, /registry block rewritten/);
      assert.strictEqual(s.read(ROUTING), ROUTING_MD, 'the routing doc was rewritten under --check');
    });
  });

  test('the routing doc follows project.docsRoot: --agents writes there, and stops when it is absent', async () => {
    const config = Object.assign({}, CONFIG, { project: { name: 'example', docsRoot: 'handbook', tracksDir: 'handbook/tracks' }, docs: { caps: CONFIG.docs.caps, exemptDirs: [] } });
    const MOVED = 'handbook/reference/routing/README.md';
    await withSandbox({ git: false, bare: true, config, files: { [MOVED]: ROUTING_MD, '.claude/agents/explore.md': AGENT('explore') } }, async (s) => {
      const r = await s.node(INDEX, ['--agents']);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /^handbook\/reference\/routing\/README\.md registry block rewritten$/m);
      assert.ok(s.read(MOVED).includes('| `explore` | small | Read, Grep |'), s.read(MOVED));
      assert.ok(!s.has(ROUTING), 'a routing doc was written under the DEFAULT docs root');
    });
    // The default-root path existing does not stand in for the configured one.
    await withSandbox({ git: false, bare: true, config, files: { [ROUTING]: ROUTING_MD, '.claude/agents/explore.md': AGENT('explore') } }, async (s) => {
      const r = await s.node(INDEX, ['--agents']);
      assert.strictEqual(r.status, 1, r.out);
      const lines = r.stderr.trim().split(/\r?\n/);
      assert.strictEqual(lines[0], 'FATAL — no routing doc at handbook/reference/routing/README.md');
      assert.match(lines[1], /^ {3}fix: create handbook\/reference\/routing\/README\.md .*agents:begin/);
      assert.strictEqual(s.read(ROUTING), ROUTING_MD);
    });
  });

  test('--agents replaces a stale block instead of appending to it', async () => {
    const stale = ROUTING_MD.replace('<!-- agents:begin -->\n', '<!-- agents:begin -->\n| `long-gone` | x | y | z |\n');
    await withSandbox({ git: false, files: { [ROUTING]: stale, '.claude/agents/explore.md': AGENT('explore') } }, async (s) => {
      assert.strictEqual((await s.node(INDEX, ['--agents'])).status, 0);
      const after = s.read(ROUTING);
      assert.doesNotMatch(after, /long-gone/);
      assert.strictEqual(after.split('<!-- agents:begin -->').length, 2, 'the block was duplicated');
      assert.ok(after.endsWith('\nA line below the registry.\n'));
    });
  });

  test('--agents refuses a routing doc with no markers and leaves it untouched', async () => {
    const plain = '# Agents\n\nNo registry here.\n';
    await withSandbox({ git: false, files: { [ROUTING]: plain, '.claude/agents/explore.md': AGENT('explore') } }, async (s) => {
      const r = await s.node(INDEX, ['--agents']);
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /no <!-- agents:begin --> \/ <!-- agents:end --> markers/);
      assert.strictEqual(s.read(ROUTING), plain);
    });
  });

  test('--check fails an agent file with no `model:` or no `tools:`, even with a fresh index', async () => {
    await withSandbox({ git: false, files: { '.claude/agents/loose.md': AGENT('loose', '') } }, async (s) => {
      await s.node(INDEX);
      const r = await s.node(INDEX, ['--check']);
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, /AGENT FILE \.claude\/agents\/loose\.md: missing `model:`/);
      assert.match(r.stderr, /AGENT FILE \.claude\/agents\/loose\.md: missing `tools:`/);
    });
  });
});

/* ============================================================ */
describe('handoff-lint — the handoff block, as an exit code', SUITE, () => {
  const run = (block, body) => withSandbox({ git: false, files: { 'docs/tracks/alpha/handoff.md': handoffDoc(block) } },
    async (s) => body(await s.node(HANDOFF, ['alpha']), s));
  const findings = (r) => Number((/(\d+) finding\(s\):/.exec(r.stderr) || [])[1]);
  const swap = (from, to) => {
    assert.ok(HANDOFF_BLOCK.includes(from), 'the fixture block has no line: ' + from);
    return HANDOFF_BLOCK.replace(from, to);
  };

  test('a complete block passes', async () => {
    await run(HANDOFF_BLOCK, (r) => {
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /handoff-lint: docs\/tracks\/alpha\/handoff\.md — the block is self-contained/);
    });
  });

  // The six things a handoff must contain. The fifth is two lines — the exit command and the
  // first commit's subject — and each is removed on its own.
  const ELEMENTS = [
    ['what to read, in order', 'Read, in this order:', 'Open these:', /no `Read` line/],
    ['the scope in one sentence', 'SCOPE: one thing in, everything else out.', 'It is about one thing.', /no `SCOPE:` line/],
    ['what NOT to do', 'Do NOT re-measure the baseline; it is already measured.', 'The baseline is in place.', /no negative instruction/],
    ['inherited state', 'Inherited state: figures come from gates.json only.', 'Inherited state: nothing special.', /no line citing gates\.json or gates\.baseline\.json/],
    ['the exit command', 'Exit: `node scripts/harness/handoff-lint.js alpha`.', 'Finish with `node scripts/harness/handoff-lint.js alpha`.', /no `Exit:` line/],
    ['the first commit subject', 'First commit: `feat(alpha): the next step`.', 'Then commit it.', /no `First commit:` line/],
    ['the How-to-work pointer', 'Follow "How to work" in the track README.', 'Follow the track README.', /no "How to work" pointer/],
  ];
  for (const [what, from, to, why] of ELEMENTS) {
    test('a block missing ' + what + ' fails on exactly that', async () => {
      await run(swap(from, to), (r) => {
        assert.strictEqual(r.status, 1, r.out);
        assert.match(r.stderr, /^HANDOFF RED — docs\/tracks\/alpha\/handoff\.md/);
        assert.match(r.stderr, why);
        assert.strictEqual(findings(r), 1, 'removing one element produced more than one finding:\n' + r.stderr);
      });
    });
  }

  test('a block whose only named path does not resolve fails', async () => {
    await run(swap('docs/tracks/alpha/README.md', 'docs/tracks/alpha/NOWHERE.md').replace('scripts/harness/handoff-lint.js', 'tools/gone.js'), (r) => {
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, /no path named in the block resolves on disk: docs\/tracks\/alpha\/NOWHERE\.md/);
    });
  });

  test('an unchecked integer >= 10 is flagged with its line', async () => {
    const block = HANDOFF_BLOCK + '42 surfaces were reached.\n';
    const at = block.split('\n').findIndex((l) => l.startsWith('42 ')) + 1; // a line of the BLOCK
    await run(block, (r) => {
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, new RegExp('line ' + at + ': uncheckable figure\\(s\\) 42'));
      assert.match(r.stderr, /42 surfaces were reached\./);
      assert.strictEqual(findings(r), 1);
    });
  });

  test('a date, a version, a sha, a digit-bearing name and a single digit are not claims', async () => {
    const lines = [
      'Measured 2026-01-04 and frozen.',
      'The runtime is at 24.11.1 here.',
      'Phase 0 landed as 8becfef in the alpha2 folder, pending-2026-01.',
      'Phase 4 owes 2 commits and 1 file.',
    ].join('\n') + '\n';
    await run(HANDOFF_BLOCK + lines, (r) => { assert.strictEqual(r.status, 0, r.out); });
  });

  for (const [what, credit] of [
    ['a path:line', '42 surfaces were reached, see scripts/harness/handoff-lint.js:88.'],
    ['a prefixed trap id', '42 surfaces were reached (AL-09).'],
    ['gates.json', '42 surfaces were reached per gates.json.'],
  ]) {
    test('the same integer on a line carrying ' + what + ' passes', async () => {
      await run(HANDOFF_BLOCK + credit + '\n', (r) => { assert.strictEqual(r.status, 0, r.out); });
    });
  }

  test('credit is per LINE: a figure is not checked by a citation one line away', async () => {
    await run(HANDOFF_BLOCK + 'See gates.json.\n42 surfaces were reached.\n', (r) => {
      assert.strictEqual(r.status, 1, r.out);
      assert.strictEqual(findings(r), 1);
    });
  });

  test('two ▶ blocks, no block, and a stub are each refused', async () => {
    await run(HANDOFF_BLOCK + '\n## ▶ ALSO NEXT\n' + HANDOFF_BLOCK.split('\n').slice(1).join('\n'), (r) => {
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /2 ▶ blocks — a handoff carries exactly one/);
    });
    await run('## Next\n\nnothing marked\n', (r) => {
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /no ▶ block/);
    });
    await run('## ▶ NEXT\n\ndo it\n', (r) => {
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /the ▶ block is a stub/);
    });
  });

  test('text outside the block is not graded: the block ends at the next heading of its level', async () => {
    await run(HANDOFF_BLOCK + '\n## History\n\n42 surfaces were reached last phase.\n', (r) => {
      assert.strictEqual(r.status, 0, r.out);
    });
  });

  test('an absent handoff is a failure, an absent track id is a usage error, an absent config is a hard stop', async () => {
    await withSandbox({ git: false }, async (s) => {
      const missing = await s.node(HANDOFF, ['no-such-track']);
      assert.strictEqual(missing.status, 1);
      assert.match(missing.stderr, /handoff-lint: no docs\/tracks\/no-such-track\/handoff\.md/);
      assert.strictEqual((await s.node(HANDOFF, [])).status, 2);
    });
    await withSandbox({ git: false, config: null }, async (s) => {
      const r = await s.node(HANDOFF, ['alpha']);
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /harness\.config\.json/);
    });
  });

  test('the tracks dir comes from the config', async () => {
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.project.tracksDir = 'work';
    const block = HANDOFF_BLOCK.replace('docs/tracks/alpha/README.md', 'work/alpha/README.md');
    await withSandbox({ git: false, config, bare: true, files: { 'work/alpha/README.md': doc(TRACK_FM, TRACK_BODY), 'work/alpha/handoff.md': handoffDoc(block) } }, async (s) => {
      const r = await s.node(HANDOFF, ['alpha']);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /work\/alpha\/handoff\.md/);
    });
  });
});

/* ============================================================ */
describe('split-doc — a split cannot lose a line', SUITE, () => {
  const BIG = 'docs/reference/big.md';
  const OUT = 'docs/reference/big';
  const section = (title, n) => ['## ' + title, '', '- a line every section shares', ...Array.from({ length: n }, (_, i) => title + ' detail ' + i), ''];
  const SOURCE = [
    ...fm({ id: 'big', kind: 'reference', status: 'open', read_when: '"x"' }).trimEnd().split('\n'),
    '', '# Big', '', 'An introduction.', '',
    ...section('First part', 12),
    ...section('Second part', 12),
    '## Fat part', '', 'lead-in', '',
    '### Fat one', ...Array.from({ length: 14 }, (_, i) => 'fat one ' + i), '',
    '### Fat two', ...Array.from({ length: 14 }, (_, i) => 'fat two ' + i), '',
    ...section('Last part', 6),
  ].join('\n');
  const SPLIT_CAP = 30;

  /** Non-blank trimmed lines as a multiset: the exact property the script asserts. */
  const bag = (text) => {
    const m = new Map();
    for (const l of String(text).replace(/\r\n/g, '\n').split('\n')) { const k = l.trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  };
  /** Everything the split wrote, with the lines the SCRIPT generated taken back out. */
  const written = (s) => {
    const names = fs.readdirSync(s.abs(OUT)).sort();
    const kept = [];
    for (const name of names) {
      for (const line of s.read(OUT + '/' + name).split('\n')) {
        if (/^<!-- split from .* by scripts\/harness\/split-doc\.js — content is verbatim -->$/.test(line)) continue;
        if (name === 'README.md' && (line === '## Sections' || /^- \[.*\]\(\d\d-.*\.md\)$/.test(line))) continue;
        kept.push(line);
      }
    }
    return { names, text: kept.join('\n') };
  };
  const split = (s, args) => s.node(SPLIT, [BIG, '--out', OUT, '--cap', String(SPLIT_CAP)].concat(args || []));

  test('the fixture is what it claims: over the cap, with a repeated line', async () => {
    assert.ok(SOURCE.split('\n').length > CAP);
    assert.ok(bag(SOURCE).some(([k, v]) => k === '- a line every section shares' && v === 3));
  });

  test('a real split preserves the multiset of non-blank lines, under the cap, with git mv done first', async () => {
    await withSandbox({ files: { [BIG]: SOURCE } }, async (s) => {
      const r = await split(s);
      assert.strictEqual(r.status, 0, r.out);
      assert.ok(!s.has(BIG), 'the source is still where it was');
      const { names, text } = written(s);
      assert.ok(names.includes('README.md') && names.length >= 4, 'not split into a folder: ' + names);
      assert.deepStrictEqual(bag(text), bag(SOURCE), 'the split changed the multiset of non-blank lines');
      for (const name of names) {
        const n = s.read(OUT + '/' + name).replace(/\n$/, '').split('\n').length;
        assert.ok(n <= SPLIT_CAP, name + ' is ' + n + ' lines, over the cap it was split to fit');
      }
      assert.ok(names.some((n) => /^\d\d-fat-part-fat-two\.md$/.test(n)), 'the fat section was not carved on its H3s: ' + names);
      // History follows the source: git sees a RENAME onto the folder README, not a delete.
      assert.match((await s.git('status', '--porcelain')).stdout, /^R. docs\/reference\/big\.md -> docs\/reference\/big\/README\.md$/m);
      assert.match(r.stdout, /Undo: git mv docs\/reference\/big\/README\.md docs\/reference\/big\.md/);
      // The frontmatter rides with the README, so the folder is still one doc with one id.
      assert.ok(s.read(OUT + '/README.md').startsWith('---\nid: big\n'));
    });
  });

  test('the cap defaults to the config\'s, the one the linter fails on', async () => {
    await withSandbox({ files: { [BIG]: SOURCE } }, async (s) => {
      const r = await s.node(SPLIT, [BIG, '--out', OUT, '--dry']);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, new RegExp('cap ' + CAP + '\\)'));
    });
  });

  test('--dry plans and writes nothing', async () => {
    await withSandbox({ files: { [BIG]: SOURCE } }, async (s) => {
      const r = await split(s, ['--dry']);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /--dry: nothing written/);
      assert.strictEqual(s.read(BIG), SOURCE);
      assert.ok(!s.has(OUT));
      assert.strictEqual((await s.git('status', '--porcelain')).stdout, '');
    });
  });

  test('it REFUSES rather than lose a line: a packing bug aborts before anything is written', async () => {
    // The plan preserves every line by construction, so the refusal is driven the only honest
    // way: break the packing in the sandbox's own copy and watch the assertion catch it.
    await withSandbox({ files: { [BIG]: SOURCE } }, async (s) => {
      const src = s.read(SPLIT);
      const mutated = src.replace('body: lines.slice(h.i, n + 1', 'body: lines.slice(h.i + 1, n + 1');
      assert.notStrictEqual(mutated, src, 'the mutation did not apply — this test proves nothing');
      s.put(SPLIT, mutated);
      const status = (await s.git('status', '--porcelain')).stdout;
      const r = await split(s);
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, /LINE MULTISET CHANGED — refusing to split docs\/reference\/big\.md/);
      assert.match(r.stderr, /lost: {2}1x "## First part"/);
      assert.strictEqual(s.read(BIG), SOURCE, 'the source was touched by a split that refused');
      assert.ok(!s.has(OUT), 'a refused split left files behind');
      assert.strictEqual((await s.git('status', '--porcelain')).stdout, status, 'a refused split ran a git command');
    });
  });

  test('and with the assertion removed, the same bug loses the line silently', async () => {
    // The other half of the mutation: proof that the assertion, not luck, is what refused.
    await withSandbox({ files: { [BIG]: SOURCE } }, async (s) => {
      const src = s.read(SPLIT);
      const mutated = src
        .replace('body: lines.slice(h.i, n + 1', 'body: lines.slice(h.i + 1, n + 1')
        .replace('if (missing.length || extra.length) {', 'if (false) {');
      assert.strictEqual(mutated.split('h.i + 1').length, 2);
      assert.ok(mutated.includes('if (false) {'), 'the mutation did not apply — this test proves nothing');
      s.put(SPLIT, mutated);
      assert.strictEqual((await split(s)).status, 0);
      assert.notDeepStrictEqual(bag(written(s).text), bag(SOURCE));
    });
  });

  test('a source git cannot move is refused with the doc intact', async () => {
    await withSandbox({}, async (s) => {
      s.put(BIG, SOURCE); // written AFTER the fixture commit, so git does not track it
      const r = await split(s);
      assert.strictEqual(r.status, 1, r.out);
      assert.match(r.stderr, /git mv failed/);
      assert.strictEqual(s.read(BIG), SOURCE);
      assert.deepStrictEqual(s.has(OUT) ? fs.readdirSync(s.abs(OUT)) : [], [], 'section files were written without the move');
    });
  });

  test('a doc with nothing to split on, a missing doc and a missing --out are refused', async () => {
    await withSandbox({ files: { [BIG]: '# Big\n\n' + 'one unsectioned line\n'.repeat(60) } }, async (s) => {
      const before = s.read(BIG);
      const r = await split(s);
      assert.strictEqual(r.status, 2, r.out);
      assert.match(r.stderr, /no `## ` headings — nothing to split on/);
      assert.strictEqual(s.read(BIG), before);
      assert.notStrictEqual((await s.node(SPLIT, ['docs/reference/absent.md', '--out', OUT])).status, 0);
      assert.strictEqual((await s.node(SPLIT, [BIG])).status, 2);
    });
  });

  test('a section with no H3 to carve on is kept WHOLE and reported, never cut mid-thought', async () => {
    const fat = ['# Big', '', '## Small', 'a', '', '## Unsplittable', ...Array.from({ length: 50 }, (_, i) => 'row ' + i), ''].join('\n');
    await withSandbox({ files: { [BIG]: fat } }, async (s) => {
      const r = await split(s);
      assert.strictEqual(r.status, 0, r.out);
      assert.match(r.stdout, /STILL OVER CAP — has no H3 to split on/);
      assert.match(r.stdout, /1 file\(s\) still over the cap — they need a hand edit/);
      assert.deepStrictEqual(bag(written(s).text), bag(fat));
    });
  });
});
