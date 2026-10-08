'use strict';
/* ============================================================
   worktree.js — one folder per agent, on its own branch, over one shared history.

   WHY THIS EXISTS
   Two agents in one folder trip over each other's unfinished files, and a shared dirty tree
   blocks every phase close. git already has the answer (a linked worktree), and it was being
   used here BY HAND: a hand-picked path, a hand-picked branch name, cut from whichever ref
   was nearest. The first workspace this file's own track made was cut from a local source
   branch that sat far behind the remote one. So this file decides three things a person was
   deciding from memory:

     WHERE the folder goes   decideLayout(): never inside a checkout
     WHAT it is cut from     sourceRef(): the same detection branch-sync.js reports with
     WHAT it is called       one name for the folder and the branch (and the track, if any)

   WHERE A WORKSPACE GOES, and why never inside the repo
     parent   the main checkout is a folder named `main` inside a workspace folder, or the
              repo is bare: every workspace is a sibling of `main/` in that one parent.
     sibling  a plain clone, which nothing here moves: workspaces go in `<repo>.worktrees/`
              beside it, and every --new says the parent layout works better and how to get it.
     configured  `worktrees.root` in harness.config.json, resolved against the main checkout.
   A root inside any checkout is REFUSED: a second copy of every test and every doc under the
   tree is graded by the first tree's gates and listed as a stray by its hygiene check.

   WHAT THIS DOES NOT DO, stated rather than implied. It never merges, pushes, removes a
   folder or deletes a branch: landing is a later phase and a person runs the merge. It copies
   no ignored file into the new folder and runs no setup command. It registers no hook, so the
   agent's own worktree flag still lands wherever that agent puts it.

   Run:  node scripts/harness/worktree.js                      usage
         node scripts/harness/worktree.js --new <name> [--track] [--from <ref>]
         node scripts/harness/worktree.js --list
         node scripts/harness/worktree.js --self-test
   Node >= 20, built-ins only, zero dependencies, node:path everywhere.
   ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const CONFIG = require('./config.js');
const { decideSource, CANDIDATES } = require('./branch-sync.js');

/* The folder name that marks the parent layout. It is the documented shape of a new download
   (`git clone <url> <project>/main`), not the source branch's name: a repo whose default branch
   is `trunk` still keeps its main checkout in `main/`, so one rule reads on every repo. */
const PARENT_MAIN = 'main';
const SIBLING_SUFFIX = '.worktrees';

/* One name is the folder, the branch (after the prefix) and the track id, so it obeys the
   strictest of the three: a track id is kebab-case. */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const NAME_MAX = 60;

/* ---------- pure decisions: --self-test drives every one of these with literals ---------- */

function nameProblem(name, layoutKind) {
  if (typeof name !== 'string' || !name) return 'a workspace needs a name: --new <name>';
  if (name.length > NAME_MAX) return 'the name is longer than ' + NAME_MAX + ' characters';
  if (!NAME_RE.test(name)) return 'the name `' + name + '` must be kebab-case (a-z, 0-9, hyphen): it is a folder, a branch and a track id at once';
  if (layoutKind === 'parent' && name === PARENT_MAIN) return '`' + PARENT_MAIN + '` is the main checkout\'s own folder in the parent layout';
  return null;
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/* `mainRoot` is null for a bare repo, whose common dir then sits directly in the workspace
   parent. `checkouts` is every existing worktree path: the root may be inside none of them. */
function decideLayout(i) {
  const base = i.mainRoot || path.dirname(i.commonDir);
  let out;
  if (i.configuredRoot) out = { kind: 'configured', root: path.resolve(base, i.configuredRoot) };
  else if (!i.mainRoot) out = { kind: 'parent', root: path.dirname(i.commonDir) };
  else if (path.basename(i.mainRoot).toLowerCase() === PARENT_MAIN) out = { kind: 'parent', root: path.dirname(i.mainRoot) };
  else out = { kind: 'sibling', root: path.join(path.dirname(i.mainRoot), path.basename(i.mainRoot) + SIBLING_SUFFIX) };
  const within = (i.checkouts || []).find((c) => isInside(out.root, c));
  if (within) {
    out.problem = 'the workspace root ' + out.root + ' is inside the checkout ' + within
      + ' — a workspace there is graded by that checkout\'s gates and listed as a stray by its hygiene check';
  }
  return out;
}

/* `git worktree list --porcelain`: blank-line separated records of `key value` lines, where
   `bare`, `detached`, `locked` and `prunable` may stand alone. */
function parsePorcelain(text) {
  const out = [];
  let cur = null;
  for (const line of String(text == null ? '' : text).split(/\r?\n/)) {
    if (!line.trim()) { cur = null; continue; }
    const sp = line.indexOf(' ');
    const key = sp < 0 ? line : line.slice(0, sp);
    const value = sp < 0 ? '' : line.slice(sp + 1);
    if (key === 'worktree') { cur = { path: value, branch: null, head: null, bare: false, detached: false, locked: false, prunable: false }; out.push(cur); continue; }
    if (!cur) continue;
    if (key === 'HEAD') cur.head = value;
    else if (key === 'branch') cur.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'bare' || key === 'detached' || key === 'locked' || key === 'prunable') cur[key] = true;
  }
  return out;
}

function fillTemplate(text, name, tracksDir, today) {
  return String(text).split('<TRACK_ID>').join(name).split('<TRACKS_DIR>').join(tracksDir).split('<YYYY-MM-DD>').join(today);
}

const ADVICE = [
  'This checkout is a plain clone, so workspaces go in a sibling folder. It works better as ONE',
  'parent folder holding the project as `' + PARENT_MAIN + '/` with every workspace beside it. To adopt that:',
  '  1. close every agent session in this project',
  '  2. make a parent folder and move this checkout into it as `' + PARENT_MAIN + '/`',
  '  3. from `' + PARENT_MAIN + '/`, run: git worktree repair <each existing workspace folder>',
];

/* ---------- git and the filesystem ---------- */

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const out1 = (r) => (r.status === 0 ? r.stdout.trim() : null);
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

function repoFacts(cwd) {
  const top = out1(git(cwd, ['rev-parse', '--show-toplevel']));
  const common = out1(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  if (!common) return { ok: false, why: 'no git repository at or above ' + path.resolve(cwd) };
  const commonDir = real(common);
  const entries = parsePorcelain(git(cwd, ['worktree', 'list', '--porcelain']).stdout).map((e) => Object.assign(e, { path: real(e.path) }));
  const mainRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : null;
  return { ok: true, top: top ? real(top) : null, commonDir, mainRoot, entries };
}

/* A config that is PRESENT and wrong stops the command: a typo'd `worktrees.root` read as "not
   set" would put the folder somewhere the file never named. An absent config is the default. */
function readConfig(root) {
  if (!root || !fs.existsSync(path.join(root, CONFIG.CONFIG_NAME))) return { ok: true, cfg: CONFIG.DEFAULTS, absent: true };
  try { return { ok: true, cfg: CONFIG.load({ root, fresh: true }) }; } catch (e) { return { ok: false, why: e.message }; }
}

const refExists = (cwd, r) => git(cwd, ['rev-parse', '--verify', '--quiet', r + '^{commit}']).status === 0;

/* The same precedence and the same local-or-remote choice branch-sync.js makes, asked of the
   repo at `cwd`: whichever of `<name>` and `origin/<name>` contains the other is the newer,
   and the local one wins when they have diverged. A workspace cut from the older of the two
   starts on a stale harness. */
function sourceRef(cwd, explicit, configured) {
  const head = out1(git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']));
  const d = decideSource({ explicit, configured, originHead: head });
  if (d.how === 'explicit') return { ref: refExists(cwd, d.literal) ? d.literal : null, how: d.how, asked: d.literal };
  const pick = (name) => {
    const found = [name, 'origin/' + name].filter((r) => refExists(cwd, r));
    if (found.length < 2) return found[0] || null;
    return git(cwd, ['merge-base', '--is-ancestor', found[0], found[1]]).status === 0 ? found[1] : found[0];
  };
  if (d.how !== 'fallback') return { ref: pick(d.name), how: d.how, asked: d.name };
  for (const c of CANDIDATES) { const r = pick(c); if (r) return { ref: r, how: d.how, asked: c }; }
  return { ref: null, how: d.how, asked: CANDIDATES.join(', ') };
}

function layoutOf(facts, cfg) {
  const w = (cfg && cfg.worktrees) || CONFIG.DEFAULTS.worktrees;
  const layout = decideLayout({
    mainRoot: facts.mainRoot, commonDir: facts.commonDir, configuredRoot: w.root,
    checkouts: facts.entries.filter((e) => !e.bare).map((e) => e.path),
  });
  layout.branchPrefix = w.branchPrefix || '';
  return layout;
}

/* ---------- --new ---------- */

function create(cwd, opts) {
  const o = opts || {};
  const refuse = (why) => ({ ok: false, why });
  const facts = repoFacts(cwd);
  if (!facts.ok) return refuse(facts.why);
  const conf = readConfig(facts.top || facts.mainRoot);
  if (!conf.ok) return refuse(conf.why);
  const layout = layoutOf(facts, conf.cfg);
  if (layout.problem) return refuse(layout.problem);
  const bad = nameProblem(o.name, layout.kind);
  if (bad) return refuse(bad);

  const target = path.join(layout.root, o.name);
  const branch = layout.branchPrefix + o.name;
  if (fs.existsSync(target)) return refuse('a folder already exists at ' + target + ' — pick another name, or see --list');
  if (refExists(cwd, 'refs/heads/' + branch)) return refuse('a branch named `' + branch + '` already exists — pick another name, or see --list');
  if (git(cwd, ['check-ref-format', '--branch', branch]).status !== 0) return refuse('`' + branch + '` is not a branch name git accepts (worktrees.branchPrefix + name)');

  const src = sourceRef(cwd, o.from, conf.cfg.project && conf.cfg.project.sourceBranch);
  if (!src.ref) return refuse('no source ref to cut from (looked for: ' + src.asked + ') — commit something, fetch, or pass --from <ref>');
  if (o.track && git(cwd, ['cat-file', '-e', src.ref + ':templates/track/README.md']).status !== 0) {
    return refuse('--track needs templates/track/ at ' + src.ref + ', and it is not there — create the workspace without --track');
  }

  fs.mkdirSync(layout.root, { recursive: true });
  const add = git(cwd, ['worktree', 'add', '-b', branch, target, src.ref]);
  if (add.status !== 0) return refuse('git worktree add failed: ' + (add.stderr || add.stdout).trim());

  const res = { ok: true, name: o.name, target, branch, source: src, layout, track: null };
  if (o.track) {
    const inner = readConfig(target);
    const tracksDir = String((inner.ok ? inner.cfg : CONFIG.DEFAULTS).project.tracksDir).replace(/\\/g, '/');
    const from = path.join(target, 'templates', 'track');
    const to = path.join(target, ...tracksDir.split('/'), o.name);
    fs.mkdirSync(to, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const files = fs.readdirSync(from).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) fs.writeFileSync(path.join(to, f), fillTemplate(fs.readFileSync(path.join(from, f), 'utf8'), o.name, tracksDir, today));
    res.track = { dir: to, rel: tracksDir + '/' + o.name, files };
  }
  return res;
}

function printCreated(r) {
  console.log('CREATED workspace `' + r.name + '`');
  console.log('  folder   ' + r.target);
  console.log('  branch   ' + r.branch + '   cut from ' + r.source.ref + ' (source chosen by: ' + r.source.how + ')');
  if (r.source.how !== 'explicit') console.log('           a ref is only as new as the last fetch: `git fetch` first if the remote may have moved');
  if (r.track) console.log('  track    ' + r.track.rel + '/ (' + r.track.files.join(', ') + ') — fill every <PLACEHOLDER>; the doc gate is red until you do');
  console.log('  next     cd "' + r.target + '"   then start your coding agent THERE, so its guards check this folder');
  console.log('  nothing was copied in: a file git ignores (local settings, installed packages) is absent from the new folder');
  if (r.layout.kind === 'sibling') { console.log(''); for (const l of ADVICE) console.log(l); }
}

/* ---------- --list ---------- */

function list(cwd) {
  const facts = repoFacts(cwd);
  if (!facts.ok) return { ok: false, why: facts.why };
  const conf = readConfig(facts.top || facts.mainRoot);
  const layout = conf.ok ? layoutOf(facts, conf.cfg) : null;
  const rows = facts.entries.map((e) => ({
    path: e.path,
    branch: e.bare ? '(bare)' : e.detached ? '(detached)' : e.branch,
    head: e.head ? e.head.slice(0, 7) : '-',
    here: !!facts.top && e.path === facts.top,
    main: !!facts.mainRoot && e.path === facts.mainRoot,
    flags: [e.locked && 'locked', e.prunable && 'prunable (its folder is gone)'].filter(Boolean),
  }));
  return { ok: true, rows, layout, configProblem: conf.ok ? null : conf.why };
}

function printList(r) {
  const w = Math.max(6, ...r.rows.map((x) => String(x.branch).length));
  for (const x of r.rows) {
    console.log((x.here ? '* ' : '  ') + String(x.branch).padEnd(w) + '  ' + x.head + '  ' + x.path
      + (x.main ? '   [main checkout]' : '') + (x.flags.length ? '   [' + x.flags.join(', ') + ']' : ''));
  }
  console.log('');
  console.log(r.rows.length + ' checkout(s); `*` is this one.');
  if (r.configProblem) console.log('layout: unknown — ' + r.configProblem);
  else if (r.layout.problem) console.log('layout: ' + r.layout.kind + ' — ' + r.layout.problem);
  else console.log('layout: ' + r.layout.kind + ' — a new workspace goes under ' + r.layout.root);
}

/* ---------- --self-test ---------- */

function selfTest() {
  const fails = [];
  let n = 0;
  const ok = (name, cond) => { n++; if (!cond) fails.push(name); };
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(name + ' — got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); };
  const P = (...s) => path.join(path.sep === '\\' ? 'C:\\' : '/', ...s);

  // names
  eq('a kebab-case name is accepted', nameProblem('billing-export', 'sibling'), null);
  ok('an empty name is refused', /needs a name/.test(nameProblem('', 'sibling')));
  ok('a name with a slash is refused', /kebab-case/.test(nameProblem('a/b', 'sibling')));
  ok('a name with a capital is refused', /kebab-case/.test(nameProblem('Fix', 'sibling')));
  ok('a name that escapes upward is refused', /kebab-case/.test(nameProblem('..', 'sibling')));
  ok('an over-long name is refused', /longer than/.test(nameProblem('a'.repeat(NAME_MAX + 1), 'sibling')));
  ok('`main` is refused in the parent layout', /main checkout/.test(nameProblem('main', 'parent')));
  eq('`main` is an ordinary name in the sibling layout', nameProblem('main', 'sibling'), null);

  // layout
  const sib = decideLayout({ mainRoot: P('code', 'shop'), commonDir: P('code', 'shop', '.git'), checkouts: [P('code', 'shop')] });
  eq('a plain clone is the sibling layout', [sib.kind, sib.root, sib.problem], ['sibling', P('code', 'shop.worktrees'), undefined]);
  const par = decideLayout({ mainRoot: P('code', 'shop', 'main'), commonDir: P('code', 'shop', 'main', '.git'), checkouts: [P('code', 'shop', 'main')] });
  eq('a checkout named main is the parent layout', [par.kind, par.root, par.problem], ['parent', P('code', 'shop'), undefined]);
  eq('the marker folder name is case-folded', decideLayout({ mainRoot: P('code', 'shop', 'Main'), commonDir: P('x') }).kind, 'parent');
  const bare = decideLayout({ mainRoot: null, commonDir: P('code', 'shop', '.bare'), checkouts: [] });
  eq('a bare repo is the parent layout', [bare.kind, bare.root], ['parent', P('code', 'shop')]);
  const conf = decideLayout({ mainRoot: P('code', 'shop'), commonDir: P('code', 'shop', '.git'), configuredRoot: '../trees', checkouts: [P('code', 'shop')] });
  eq('a configured root resolves against the main checkout', [conf.kind, conf.root, conf.problem], ['configured', P('code', 'trees'), undefined]);
  const inside = decideLayout({ mainRoot: P('code', 'shop'), commonDir: P('code', 'shop', '.git'), configuredRoot: '.trees', checkouts: [P('code', 'shop')] });
  ok('a root inside a checkout is a problem', /inside the checkout/.test(inside.problem || ''));
  const nested = decideLayout({ mainRoot: P('code', 'shop'), commonDir: P('code', 'shop', '.git'), configuredRoot: P('code', 'other', 'sub'), checkouts: [P('code', 'shop'), P('code', 'other')] });
  ok('a root inside ANOTHER workspace is a problem too', /inside the checkout/.test(nested.problem || ''));
  ok('a sibling whose name only starts the same is not inside', !isInside(P('code', 'shop.worktrees'), P('code', 'shop')));

  // porcelain
  const parsed = parsePorcelain(['worktree /r/main', 'HEAD 1234567890', 'branch refs/heads/main', '',
    'worktree /r/a b', 'HEAD abcdef0123', 'branch refs/heads/feat/x', 'locked', '',
    'worktree /r/d', 'HEAD 0000000000', 'detached', 'prunable gitdir file points to non-existent location', ''].join('\r\n'));
  eq('three records are read', parsed.length, 3);
  eq('a path with a space survives', parsed[1].path, '/r/a b');
  eq('a branch keeps its slash and loses its ref prefix', parsed[1].branch, 'feat/x');
  eq('a bare `locked` line is a flag', [parsed[0].locked, parsed[1].locked], [false, true]);
  eq('detached and prunable are flags', [parsed[2].detached, parsed[2].prunable, parsed[2].branch], [true, true, null]);
  eq('an empty listing is no records', parsePorcelain(''), []);

  eq('the template fills its three mechanical placeholders and no other',
    fillTemplate('id: <TRACK_ID>\n<TRACKS_DIR>/<TRACK_ID>/x <YYYY-MM-DD> <PREFIX>', 'pay', 'docs/tracks', '2026-01-02'),
    'id: pay\ndocs/tracks/pay/x 2026-01-02 <PREFIX>');

  // a throwaway repo: the real git, never this repo
  const tmp = real(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-worktree-self-test-')));
  try {
    const mk = (dir, branch) => {
      fs.mkdirSync(path.join(dir, 'templates', 'track'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'templates', 'track', 'README.md'), 'id: <TRACK_ID>\nlast_verified: <YYYY-MM-DD>\n# <TRACK_TITLE>\n');
      fs.writeFileSync(path.join(dir, 'file.txt'), 'x\n');
      const g = (args) => git(dir, ['-c', 'user.name=self-test', '-c', 'user.email=self-test@example.invalid', '-c', 'commit.gpgsign=false'].concat(args));
      g(['init', '-q', '-b', branch, '.']); g(['add', '-A']);
      return g(['commit', '-q', '-m', 'init']).status === 0;
    };
    const plain = path.join(tmp, 'shop');
    ok('the fixture repo commits', mk(plain, 'dev'));
    eq('with no remote and no usual name, there is no source ref', create(plain, { name: 'a' }).ok, false);
    ok('and the refusal says to pass --from', /--from <ref>/.test(create(plain, { name: 'a' }).why));
    ok('nothing was created by a refused --new', !fs.existsSync(path.join(tmp, 'shop.worktrees', 'a')));

    const a = create(plain, { name: 'a', from: 'dev' });
    eq('--new lands in the sibling root on a branch of its name', [a.ok, a.target, a.branch, a.layout.kind], [true, path.join(tmp, 'shop.worktrees', 'a'), 'a', 'sibling']);
    ok('the new folder carries the tracked files', fs.existsSync(path.join(tmp, 'shop.worktrees', 'a', 'file.txt')));
    eq('an explicit ref is reported as explicit', a.source.how, 'explicit');
    ok('the same name again is refused by its folder', /folder already exists/.test(create(plain, { name: 'a', from: 'dev' }).why));
    git(plain, ['branch', 'taken', 'dev']);
    ok('a name whose branch exists is refused', /branch named `taken` already exists/.test(create(plain, { name: 'taken', from: 'dev' }).why));
    ok('a ref that does not exist is refused', /no source ref/.test(create(plain, { name: 'b', from: 'nope' }).why));
    ok('a bad name is refused before anything is made', /kebab-case/.test(create(plain, { name: 'B', from: 'dev' }).why));

    const fromInside = create(a.target, { name: 'c', from: 'dev' });
    eq('--new from INSIDE a workspace lands beside it, not under it', [fromInside.ok, fromInside.target], [true, path.join(tmp, 'shop.worktrees', 'c')]);

    const t = create(plain, { name: 'pay', from: 'dev', track: true });
    const filled = t.ok ? fs.readFileSync(path.join(t.target, 'docs', 'tracks', 'pay', 'README.md'), 'utf8') : '';
    ok('--track copies the template into the default tracks dir with the id filled', /^id: pay\r?\n/.test(filled) && /<TRACK_TITLE>/.test(filled) && !/<YYYY-MM-DD>/.test(filled));

    const l = list(a.target);
    eq('--list reads every checkout', l.rows.map((x) => x.branch).sort(), ['a', 'c', 'dev', 'pay']);
    eq('--list marks the one it ran in and the main checkout', [l.rows.find((x) => x.here).branch, l.rows.find((x) => x.main).branch], ['a', 'dev']);
    eq('--list reports where the next one goes', [l.layout.kind, l.layout.root], ['sibling', path.join(tmp, 'shop.worktrees')]);

    fs.writeFileSync(path.join(plain, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'shop' }, gates: [{ name: 'test', command: 'node --test' }], worktrees: { root: '../elsewhere', branchPrefix: 'wt/' } }));
    const cfgd = create(plain, { name: 'd', from: 'dev' });
    eq('worktrees.root and worktrees.branchPrefix are honoured', [cfgd.ok, cfgd.target, cfgd.branch], [true, path.join(tmp, 'elsewhere', 'd'), 'wt/d']);
    fs.writeFileSync(path.join(plain, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'shop' }, gates: [{ name: 'test', command: 'node --test' }], worktrees: { root: 'inside' } }));
    ok('a configured root inside the checkout is refused', /inside the checkout/.test(create(plain, { name: 'e', from: 'dev' }).why));
    fs.writeFileSync(path.join(plain, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'shop' }, gates: [{ name: 'test', command: 'node --test' }], worktrees: { rooot: 'x' } }));
    ok('a present, malformed config stops --new rather than falling back', /unknown key `rooot`/.test(create(plain, { name: 'f', from: 'dev' }).why));

    const ws = path.join(tmp, 'proj', 'main');
    fs.mkdirSync(ws, { recursive: true });
    ok('the parent-layout fixture commits', mk(ws, 'trunk'));
    const p = create(ws, { name: 'feature' });
    eq('under the parent layout a workspace is a sibling of main/', [p.ok, p.target, p.layout.kind], [true, path.join(tmp, 'proj', 'feature'), 'parent']);
    eq('with no --from the source branch is found, and said to be a fallback guess', [p.source.ref, p.source.how], ['trunk', 'fallback']);
    ok('`main` cannot be taken there', /main checkout/.test(create(ws, { name: 'main', from: 'trunk' }).why));

    eq('outside any repo, both commands say so', [create(tmp, { name: 'x' }).ok, list(tmp).ok], [false, false]);
  } catch (e) {
    fails.push('the self-test threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* a temp dir the OS still holds is not a verdict */ }
  }

  for (const f of fails) console.log('FAIL  ' + f);
  console.log(fails.length ? '\nFAIL — worktree.js self-test: ' + fails.length + ' of ' + n + ' checks'
    : 'PASS — worktree.js self-test (' + n + ' checks: names, layout, porcelain, --new, --track, --list, config)');
  return fails.length ? 1 : 0;
}

/* ---------- cli ---------- */

const USAGE = [
  'worktree.js — one folder per agent, on its own branch, over one shared history.',
  '',
  '  --new <name> [--track] [--from <ref>]',
  '        Create a workspace folder and a branch of the same name, cut from the source branch',
  '        (the newer of the local and the remote one). --track also copies templates/track/ into',
  '        the tracks directory. --from names the ref to cut from instead. Never inside a checkout.',
  '  --list',
  '        Every checkout of this repo: branch, commit, folder, and where the next one would go.',
  '  --self-test',
  '        Check this file against literals and a throwaway repo. Touches no real repo.',
  '',
  'It never merges, pushes, removes a folder or deletes a branch.',
].join('\n');

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  if (has('--self-test')) return process.exit(selfTest());
  if (has('--new')) {
    const r = create(process.cwd(), { name: valueOf('--new'), track: has('--track'), from: valueOf('--from') });
    if (!r.ok) { console.error('REFUSED: ' + r.why); return process.exit(1); }
    printCreated(r);
    return process.exit(0);
  }
  if (has('--list')) {
    const r = list(process.cwd());
    if (!r.ok) { console.error('REFUSED: ' + r.why); return process.exit(1); }
    printList(r);
    return process.exit(0);
  }
  console.log(USAGE);
  return process.exit(argv.length && !has('--help') && !has('-h') ? 1 : 0);
}

module.exports = { nameProblem, decideLayout, parsePorcelain, fillTemplate, isInside, create, list, sourceRef, PARENT_MAIN, SIBLING_SUFFIX, NAME_RE };

if (require.main === module) main();
