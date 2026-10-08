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

   WHAT THIS DOES NOT DO, stated rather than implied. It never merges, pushes, force-removes
   a dirty folder or deletes an unmerged branch. --land verifies (clean, green, merged) and
   prints the merge command; a person runs it, and only then does --land remove anything.
   --prune lists by default and removes only with --yes. A LOCKED entry is named with the
   command that unlocks it, never skipped silently and never unlocked here: a lock is how a
   running session says the folder is in use.

   WHAT A NEW FOLDER HOLDS. git puts the tracked files there and nothing else, so two config
   keys make it ready to work in:
     worktrees.carry   paths copied from the MAIN CHECKOUT, each only if it exists there and git
                       ignores it. A path the secret guard's patterns match is refused unless a
                       live dated carve-out covers it, and the refusal comes before anything is
                       made: a config that names a secret is a config to fix, not a path to skip.
     worktrees.setup   one command run in the new folder afterwards. Its output goes to STDERR.
                       A setup that fails is said, and the folder is kept: the work of making
                       it is done and a second --new would only refuse the name.
   Both default to nothing.

   THE AGENT'S OWN WORKTREE FLAG lands in the same root. scripts/harness/hook.js hands a
   worktree-create hook payload to fromHook() here, which runs the same create() and answers
   with the folder path ALONE on stdout: the agent reads every byte of stdout as the path, so
   every other line this file would print goes to stderr on that route.

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
const ENV = require('./guards/env-guard.cjs');

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

/* ONE CARRIED PATH. `exists` and `ignored` are read off the main checkout by the caller;
   `guarded` and `openCarveOuts` are the secret guard's own stance and `compile` is its own
   matcher, so a path that guard would refuse to open is one this refuses to copy. The three
   answers: `copy`, `skip` (nothing to do, said) and `refuse` (the whole --new stops). */
function decideCarry(i) {
  const rel = String(i.path == null ? '' : i.path).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const out = (action, why) => ({ path: rel || String(i.path), action, why });
  if (!rel || /^([A-Za-z]:|\/)/.test(rel) || rel.split('/').includes('..')) {
    return out('refuse', 'it must be a path inside the checkout, with no `..` and no leading slash or drive');
  }
  const spans = (patterns, twinGuard) => {
    const found = [];
    for (const p of patterns || []) for (const m of rel.matchAll(ENV.compile(p, twinGuard))) found.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    return found;
  };
  // Exactly the guard's rule: an expired carve-out opens nothing, and with no date none is live.
  const live = (i.today ? i.openCarveOuts || [] : []).filter((c) => c && typeof c.until === 'string' && c.until >= i.today).map((c) => c.path);
  const open = spans(live, false);
  const hit = spans(i.guarded, true).find((h) => !open.some((o) => o.start <= h.start && o.end >= h.end));
  if (hit) return out('refuse', 'the secret guard guards `' + hit.text + '` — a copy needs a live dated entry in env.openCarveOuts, the same one a read would need');
  if (!i.hasMain) return out('skip', 'this repo has no main checkout to carry it from');
  if (!i.exists) return out('skip', 'it is not in the main checkout');
  if (!i.ignored) return out('skip', 'git does not ignore it, so it is tracked or should be: a tracked file is already in the new folder');
  if (i.inTarget) return out('skip', 'the new folder already has it');
  return out('copy', null);
}

/* A worktree-create hook payload: the agent's own flag, handed here. It carries the name the
   person typed and the folder the session was started in. */
function hookPayload(text) {
  let p;
  try { p = JSON.parse(String(text == null ? '' : text)); } catch { return { ok: false, why: 'the hook payload is not JSON' }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, why: 'the hook payload is not an object' };
  if (typeof p.name !== 'string' || !p.name) return { ok: false, why: 'the hook payload names no workspace (`name`)' };
  return { ok: true, name: p.name, cwd: typeof p.cwd === 'string' && p.cwd ? p.cwd : null };
}

/* ---------- the announce note, the overview and the overlap report: pure halves ---------- */

/* WHO IS WORKING WHERE is answered by a COMMITTED file each branch owns alone: a track's
   handoff.md, or for a plain task one note under `<docsRoot>/workspaces/`, named for the task.
   No file that two branches write: one shared list conflicts at every merge and leaves a stale
   line on the source branch. The overview below is generated from those files and never kept. */
const NOTES_DIR = 'workspaces';
const notePath = (docsRoot, name) => String(docsRoot).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + NOTES_DIR + '/' + name + '.md';
const DOING_BLANK = '(say in one line what this workspace is for)';

function noteText(name, doing, today) {
  return ['---', 'id: workspace-' + name, 'kind: design', 'status: open',
    'read_when: "checking what the `' + name + '` workspace is doing before changing the same files"',
    'last_verified: ' + today, '---', '', '# Workspace `' + name + '`', '',
    String(doing || '').replace(/\s+/g, ' ').trim() || DOING_BLANK, '',
    'This file is the workspace\'s announce note: `node scripts/harness/worktree.js --list` reads its',
    'first line from every branch. Commit it first; landing the workspace removes it.', ''].join('\n');
}

/* Which of a branch's changed files is its note: the handoff of a track it touched (the one
   named for the branch first), else its plain-task note. `changed` is null when the source ref
   is unknown, and the two paths named for the branch are then the only candidates. */
function noteCandidates(name, changed, docsRoot, tracksDir) {
  const t = String(tracksDir).replace(/\\/g, '/').replace(/\/+$/, '');
  const own = [t + '/' + name + '/handoff.md', notePath(docsRoot, name)];
  if (!Array.isArray(changed)) return own;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const handoff = new RegExp('^' + esc(t) + '/[^/]+/handoff\\.md$');
  const note = new RegExp('^' + esc(notePath(docsRoot, 'X').slice(0, -'X.md'.length)) + '[^/]+\\.md$');
  const found = changed.filter((f) => handoff.test(f)).concat(changed.filter((f) => note.test(f)));
  return own.filter((p) => found.includes(p)).concat(found.filter((p) => !own.includes(p)));
}

/* What a note says, in the two fields the overview prints. A handoff's line is the first line
   of its fenced block; any other note's is its first line of body prose. */
function noteSummary(text) {
  const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const field = (k) => { const m = fm && new RegExp('^' + k + ':[ \\t]*(.*)$', 'm').exec(fm[1]); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
  const body = fm ? src.slice(fm[0].length) : src;
  const kind = field('kind');
  let doing = null;
  if (kind === 'handoff') {
    const block = /```[^\n]*\n([\s\S]*?)```/.exec(body);
    doing = block ? (block[1].split('\n').map((l) => l.trim()).find(Boolean) || null) : null;
  }
  if (!doing) doing = body.split('\n').map((l) => l.trim()).find((l) => l && !/^(#|>|```|\||<!--|---)/.test(l)) || null;
  if (doing && doing.length > 110) doing = doing.slice(0, 107) + '...';
  const next = field('phase_next');
  return { kind, phaseNext: next === null || next === '' ? null : next, doing: doing === DOING_BLANK ? null : doing };
}

/* `changed` is { branch: [files] }, each list being what that branch changed against the source
   branch. A file on two or more lists is where a merge will collide. Reported, never refused. */
function overlapsOf(changed) {
  const by = new Map();
  for (const b of Object.keys(changed || {}).sort()) {
    for (const f of new Set(changed[b] || [])) { if (!by.has(f)) by.set(f, []); by.get(f).push(b); }
  }
  return Array.from(by.entries()).filter(([, bs]) => bs.length > 1).map(([file, branches]) => ({ file, branches })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/* The session-start line: who else has a folder on this computer. `state.others` is every
   checkout but the session's own. Silent with none; it never denies. */
function decideSessionStart(event, state) {
  const others = (state && Array.isArray(state.others)) ? state.others : [];
  if (!others.length) return { deny: false, reason: '' };
  const shown = others.slice(0, 6).map((o) => (o.branch || '(detached)') + ' in ' + o.path);
  return {
    deny: false,
    reason: '',
    context: 'WORKSPACES: ' + others.length + ' other checkout(s) of this repo on this computer, each another session\'s folder: '
      + shown.join('; ') + (others.length > shown.length ? '; and ' + (others.length - shown.length) + ' more' : '')
      + '. Edit only this one. What each is doing, and files changed on two branches: node scripts/harness/worktree.js --list',
  };
}

/* ---------- landing and pruning: pure halves ---------- */

/* IS THE RECORDED GATE VERDICT A GREEN ONE ABOUT THIS COMMIT. `gates` is a folder's gates.json,
   `baseline` its committed gates.baseline.json, `head` the commit the branch is on. The rules
   are gates.js's own (a failing check, a non-zero exit, an undeclared skip, a pass or a total
   below the baseline), restated here because that file reads its config as it loads and this
   one must answer about ANOTHER folder. It is the stricter of the two where they could differ:
   it only ever withholds a merge command. Returns the reasons; none means green. */
function verdictProblems(gates, baseline, head) {
  if (!gates || typeof gates !== 'object') return ['no gate verdict is recorded there (scripts/harness/gates.json): nothing has graded this commit'];
  const out = [];
  if (gates.commit !== head) out.push('the gate verdict was recorded at ' + String(gates.commit).slice(0, 8) + ' and the branch is at ' + String(head).slice(0, 8));
  if (gates.dirty !== false) out.push('the gate verdict was not recorded on a clean tree');
  const base = (baseline && baseline.gates) || {};
  const cur = gates.gates || {};
  const names = Array.from(new Set(Object.keys(base).concat(Object.keys(cur))));
  if (!names.length) out.push('the gate verdict records no gates at all');
  const total = (r) => (typeof r.total === 'number' ? r.total : (r.pass || 0) + (r.fail || 0) + (r.skipped || 0));
  for (const n of names) {
    const c = cur[n]; const b = base[n];
    if (!c) { out.push(n + ': did not run'); continue; }
    if (c.missingVerdict || c.fail > 0 || c.exit !== 0) out.push(n + ': red');
    else if ((c.skipped || 0) > ((b && b.skipped) || 0)) out.push(n + ': skipped more than the baseline declares');
    else if (b && ((c.skipped === 0 && c.pass < b.pass) || total(c) < total(b))) out.push(n + ': fewer checks than the baseline');
    else if (Object.prototype.hasOwnProperty.call(c, 'reproducible') && c.reproducible !== true) out.push(n + ': not reproducible');
  }
  return out;
}

/* LANDING ONE WORKSPACE. Everything is a fact gathered by the caller. The order is the order
   of what would be LOST: a folder that cannot be found or must not be touched, then
   uncommitted work, then unmerged work. `remove` is reached only when the branch's commits
   are already in the source ref; `ready` prints a merge command and removes nothing. */
function decideLand(i) {
  const no = (why) => ({ action: 'refuse', why });
  if (!i.found) return no('no workspace named `' + i.name + '` — see --list');
  if (i.main) return no('`' + i.name + '` is the main checkout, not a workspace');
  if (i.here) return no('you are standing in ' + i.path + ' — run --land from another checkout: a folder cannot be removed from inside it');
  if (i.locked) return no('the entry for ' + i.path + ' is LOCKED, so git will not remove it. If no session is using it: git worktree unlock "' + i.path + '"   then run --land again');
  if (i.gone) return no('the folder ' + i.path + ' is gone already — --prune clears the entry');
  if (!i.branch) return no(i.path + ' is on no branch (detached), so there is nothing to compare with the source branch');
  if (!i.source) return no('no source ref to compare with — fetch, or set project.sourceBranch');
  const dirty = i.dirty || [];
  if (dirty.length) {
    return no(dirty.length + ' uncommitted or untracked path(s) in ' + i.path + ' would be lost: ' + dirty.slice(0, 5).join(', ')
      + (dirty.length > 5 ? ', and ' + (dirty.length - 5) + ' more' : '') + ' — commit them, or delete them yourself');
  }
  if (i.merged) return { action: 'remove', why: '`' + i.branch + '` is merged into ' + i.source };
  const red = i.verdict || [];
  if (red.length) return no('`' + i.branch + '` is not merged into ' + i.source + ', and it is not shown green: ' + red.slice(0, 3).join('; ') + ' — run the gates in ' + i.path + ' at this commit first');
  return { action: 'ready', why: '`' + i.branch + '` is clean and green, and not yet merged into ' + i.source };
}

/* PRUNING, one entry. `forget` clears an entry whose folder is gone; `remove` takes a folder
   whose branch is merged and which holds no uncommitted work; `named` is said and left alone.
   A workspace with no commits of its own is merged by definition and is NOT removed: it is
   the one somebody made a minute ago. null: nothing to say about this entry. */
function decidePrune(e) {
  if (e.main || e.here) return null;
  const say = (action, why) => ({ action, why });
  if (e.gone) return e.locked ? say('named', 'its folder is gone and the entry is LOCKED: git worktree unlock "' + e.path + '"   then --prune again') : say('forget', 'its folder is gone');
  if (!e.branch || !e.merged) return null;
  if (e.fresh) return say('named', 'new: no commits of its own yet, so it is kept');
  if (e.locked) return say('named', 'merged, and the entry is LOCKED: git worktree unlock "' + e.path + '"   then --prune again');
  if ((e.dirty || []).length) return say('named', 'merged, but ' + e.dirty.length + ' uncommitted or untracked path(s) would be lost, so it is kept');
  return say('remove', 'merged into ' + e.source + ' and clean');
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

/* Every carried path decided against the main checkout, before anything is made. `target` is
   null on the first pass (nothing exists yet) and the new folder on the second. */
function carryPlan(facts, conf, target) {
  const w = (conf.cfg && conf.cfg.worktrees) || CONFIG.DEFAULTS.worktrees;
  const stance = ENV.stanceOf(conf.absent ? null : conf.cfg);
  const main = facts.mainRoot;
  return (Array.isArray(w.carry) ? w.carry : []).map((p) => {
    const rel = String(p).replace(/\\/g, '/');
    const safe = !/^([A-Za-z]:|\/)/.test(rel) && !rel.split('/').includes('..');
    const src = main && safe ? path.join(main, ...rel.split('/')) : null;
    return decideCarry({
      path: p, guarded: stance.guarded, openCarveOuts: stance.openCarveOuts, today: new Date().toISOString().slice(0, 10),
      hasMain: !!main,
      exists: !!src && fs.existsSync(src),
      ignored: !!src && git(main, ['check-ignore', '-q', '--', rel]).status === 0,
      inTarget: !!target && safe && fs.existsSync(path.join(target, ...rel.split('/'))),
    });
  });
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
  const barred = carryPlan(facts, conf, null).find((c) => c.action === 'refuse');
  if (barred) return refuse('worktrees.carry names `' + barred.path + '`, and ' + barred.why + ' — nothing was created');

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
  } else if (o.note !== false) {
    // A plain task announces itself in one file of its own. A track's handoff already does.
    const inner = readConfig(target);
    const rel = notePath((inner.ok ? inner.cfg : CONFIG.DEFAULTS).project.docsRoot, o.name);
    const file = path.join(target, ...rel.split('/'));
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, noteText(o.name, o.doing, new Date().toISOString().slice(0, 10)));
      res.note = { rel, doing: String(o.doing || '').trim() || null };
    }
  }

  // Carried files, then the setup command: the command may need what was carried.
  res.carry = carryPlan(facts, conf, target);
  for (const c of res.carry) {
    if (c.action !== 'copy') continue;
    const parts = c.path.split('/');
    try {
      fs.mkdirSync(path.dirname(path.join(target, ...parts)), { recursive: true });
      fs.cpSync(path.join(facts.mainRoot, ...parts), path.join(target, ...parts), { recursive: true, force: false, errorOnExist: false });
    } catch (e) { c.action = 'failed'; c.why = 'the copy failed: ' + ((e && e.message) || e); }
  }
  const w = (conf.cfg && conf.cfg.worktrees) || CONFIG.DEFAULTS.worktrees;
  res.setup = null;
  if (typeof w.setup === 'string' && w.setup.trim()) {
    // Never stdout: on the hook route the agent reads every byte of stdout as the folder path.
    const run = spawnSync(w.setup, { cwd: target, shell: true, windowsHide: true, stdio: o.quiet ? 'ignore' : ['ignore', 2, 2] });
    res.setup = { command: w.setup, status: run.status, ok: run.status === 0, why: run.error ? String(run.error.message || run.error) : null };
  }
  return res;
}

function createdLines(r) {
  const out = [];
  out.push('CREATED workspace `' + r.name + '`');
  out.push('  folder   ' + r.target);
  out.push('  branch   ' + r.branch + '   cut from ' + r.source.ref + ' (source chosen by: ' + r.source.how + ')');
  if (r.source.how !== 'explicit') out.push('           a ref is only as new as the last fetch: `git fetch` first if the remote may have moved');
  if (r.track) out.push('  track    ' + r.track.rel + '/ (' + r.track.files.join(', ') + ') — fill every <PLACEHOLDER>; the doc gate is red until you do');
  if (r.note) out.push('  note     ' + r.note.rel + (r.note.doing ? '' : ' — write in one line what this workspace is for') + '; commit it first, so --list shows it from any folder');
  const carry = r.carry || [];
  for (const c of carry) out.push('  ' + (c.action === 'copy' ? 'carried  ' : 'NOT carried  ') + c.path + (c.why ? ' — ' + c.why : ''));
  if (!carry.length) out.push('  nothing was copied in: a file git ignores (local settings, installed packages) is absent from the new folder; list it in worktrees.carry');
  if (r.setup) out.push('  setup    `' + r.setup.command + '` ' + (r.setup.ok ? 'ran' : 'FAILED (exit ' + r.setup.status + (r.setup.why ? ', ' + r.setup.why : '') + ') — the folder is kept; run it there by hand'));
  out.push('  next     cd "' + r.target + '"   then start your coding agent THERE, so its guards check this folder');
  if (r.layout.kind === 'sibling') { out.push(''); for (const l of ADVICE) out.push(l); }
  return out;
}

function printCreated(r) { for (const l of createdLines(r)) console.log(l); }

/* ---------- the agent's own flag, by hook ---------- */

/* `{ stdout, stderr, exitCode }`, the shape hook.js writes. stdout is the folder path and
   nothing else, or empty on a refusal; the exit is non-zero on a refusal so the agent does not
   start a session in a folder that is not there. A setup command that failed is NOT a refusal:
   the folder exists, and the reason is on stderr. */
function fromHook(text, opts) {
  const o = opts || {};
  const no = (why) => ({ stdout: '', stderr: 'WORKSPACE REFUSED: ' + why + '\n', exitCode: 2 });
  const p = hookPayload(text);
  if (!p.ok) return no(p.why);
  // No note on this route: the flag carries no description, and an uncommitted file would make
  // a throwaway folder dirty, which changes what the agent does with it at exit.
  const r = create(p.cwd || o.cwd || process.cwd(), { name: p.name, quiet: o.quiet, note: false });
  if (!r.ok) return no(r.why);
  return { stdout: r.target + '\n', stderr: createdLines(r).join('\n') + '\n', exitCode: 0 };
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
  const res = { ok: true, rows, layout, configProblem: conf.ok ? null : conf.why, source: null, elsewhere: [], overlap: [] };
  if (!conf.ok) return res;

  /* THE OVERVIEW. Every branch's note is read out of git (`git show <ref>:<path>`), so a
     branch nobody has a folder for on this computer is covered too; a note not committed yet
     is read off its folder and said to be uncommitted. */
  const proj = conf.cfg.project || CONFIG.DEFAULTS.project;
  const src = sourceRef(cwd, null, proj.sourceBranch);
  const srcName = src.ref ? src.ref.replace(/^origin\//, '') : null;
  res.source = src.ref;
  const prefix = (layout && layout.branchPrefix) || '';
  const nameOf = (branch) => (prefix && branch.startsWith(prefix) ? branch.slice(prefix.length) : branch);
  const refs = (git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).stdout || '').split(/\r?\n/).filter(Boolean);
  const local = refs.filter((r) => r.startsWith('refs/heads/')).map((r) => r.slice('refs/heads/'.length));
  const remote = refs.filter((r) => r.startsWith('refs/remotes/')).map((r) => r.slice('refs/remotes/'.length))
    .filter((r) => !/\/HEAD$/.test(r) && !local.includes(r.slice(r.indexOf('/') + 1)));
  const changedOf = (ref) => {
    if (!src.ref) return null;
    const d = git(cwd, ['diff', '--name-only', src.ref + '...' + ref]);
    return d.status === 0 ? d.stdout.split(/\r?\n/).filter(Boolean) : null;
  };
  const noteOf = (ref, name, changed, folder) => {
    for (const p of noteCandidates(name, changed, proj.docsRoot, proj.tracksDir)) {
      const show = git(cwd, ['show', ref + ':' + p]);
      if (show.status === 0) return Object.assign(noteSummary(show.stdout), { path: p, committed: true });
    }
    if (folder) {
      for (const p of noteCandidates(name, null, proj.docsRoot, proj.tracksDir)) {
        const file = path.join(folder, ...p.split('/'));
        if (fs.existsSync(file)) return Object.assign(noteSummary(fs.readFileSync(file, 'utf8')), { path: p, committed: false });
      }
    }
    return null;
  };
  const changed = {};
  const isSource = (short) => !!srcName && short === srcName;
  for (const row of rows) {
    const e = facts.entries.find((x) => x.path === row.path);
    if (!e || !e.branch || isSource(e.branch)) continue;
    const ch = changedOf('refs/heads/' + e.branch);
    if (ch) changed[e.branch] = ch;
    row.note = noteOf('refs/heads/' + e.branch, nameOf(e.branch), ch, fs.existsSync(row.path) ? row.path : null);
  }
  const held = facts.entries.map((e) => e.branch).filter(Boolean);
  for (const b of local.filter((x) => !held.includes(x) && !isSource(x)).map((x) => ({ ref: 'refs/heads/' + x, branch: x, short: x }))
    .concat(remote.filter((r) => !isSource(r.slice(r.indexOf('/') + 1))).map((r) => ({ ref: 'refs/remotes/' + r, branch: r, short: r.slice(r.indexOf('/') + 1) })))) {
    const ch = changedOf(b.ref);
    const note = noteOf(b.ref, nameOf(b.short), ch, null);
    if (!note) continue; // a branch that announces nothing is not a workspace anyone can be told about
    if (ch) changed[b.branch] = ch;
    const head = out1(git(cwd, ['rev-parse', '--short=7', b.ref]));
    res.elsewhere.push({ branch: b.branch, head: head || '-', note });
  }
  res.overlap = overlapsOf(changed);
  return res;
}

/* Every checkout but the one at `cwd`: what the session-start line names. One git call. */
function others(cwd) {
  const facts = repoFacts(cwd);
  if (!facts.ok) return [];
  return facts.entries.filter((e) => !e.bare && e.path !== facts.top).map((e) => ({ branch: e.branch, path: e.path }));
}

const OVERLAP_SHOWN = 20;
const noteLine = (n) => 'doing: ' + (n.doing || '(the note says nothing yet)') + (n.phaseNext ? '   [next phase ' + n.phaseNext + ']' : '')
  + '   (' + n.path + (n.committed ? '' : ', NOT committed: other folders cannot see it') + ')';

function printList(r) {
  const w = Math.max(6, ...r.rows.map((x) => String(x.branch).length));
  for (const x of r.rows) {
    console.log((x.here ? '* ' : '  ') + String(x.branch).padEnd(w) + '  ' + x.head + '  ' + x.path
      + (x.main ? '   [main checkout]' : '') + (x.flags.length ? '   [' + x.flags.join(', ') + ']' : ''));
    if (x.note) console.log('      ' + noteLine(x.note));
  }
  console.log('');
  console.log(r.rows.length + ' checkout(s); `*` is this one.');
  if (r.elsewhere && r.elsewhere.length) {
    console.log('');
    console.log('Announced on a branch with NO folder on this computer:');
    for (const e of r.elsewhere) { console.log('  ' + e.branch + '  ' + e.head); console.log('      ' + noteLine(e.note)); }
  }
  if (r.overlap && r.overlap.length) {
    console.log('');
    console.log('OVERLAP: ' + r.overlap.length + ' file(s) changed against ' + r.source + ' on two or more branches. A report, not a refusal:');
    for (const o of r.overlap.slice(0, OVERLAP_SHOWN)) console.log('  ' + o.file + '   <- ' + o.branches.join(', '));
    if (r.overlap.length > OVERLAP_SHOWN) console.log('  ... and ' + (r.overlap.length - OVERLAP_SHOWN) + ' more');
    console.log('  whoever merges second resolves these; say so to the other session now, not at the merge.');
  }
  if (r.configProblem) console.log('layout: unknown — ' + r.configProblem);
  else if (r.layout.problem) console.log('layout: ' + r.layout.kind + ' — ' + r.layout.problem);
  else console.log('layout: ' + r.layout.kind + ' — a new workspace goes under ' + r.layout.root);
}

/* ---------- --land and --prune ---------- */

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const statusOf = (folder) => (git(folder, ['status', '--porcelain']).stdout || '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3));
// A branch nobody has committed on has one reflog line, its creation. A repo that keeps no
// reflog answers nothing, which reads as fresh: the direction that keeps a folder.
const isFresh = (cwd, branch) => (git(cwd, ['reflog', 'show', '--format=%H', 'refs/heads/' + branch]).stdout || '').split(/\r?\n/).filter(Boolean).length <= 1;

/* What both commands need to know about every entry, gathered once. */
function entryFacts(cwd) {
  const facts = repoFacts(cwd);
  if (!facts.ok) return { ok: false, why: facts.why };
  const conf = readConfig(facts.top || facts.mainRoot);
  if (!conf.ok) return { ok: false, why: conf.why };
  const layout = layoutOf(facts, conf.cfg);
  const proj = conf.cfg.project || CONFIG.DEFAULTS.project;
  const src = sourceRef(cwd, null, proj.sourceBranch);
  const entries = facts.entries.filter((e) => !e.bare).map((e) => {
    const gone = e.prunable || !fs.existsSync(e.path);
    const onSource = !!src.ref && !!e.branch && e.branch === src.ref.replace(/^origin\//, '');
    return {
      path: e.path, branch: e.branch, head: e.head, locked: e.locked, gone,
      main: (!!facts.mainRoot && e.path === facts.mainRoot) || onSource,
      here: !!facts.top && e.path === facts.top,
      source: src.ref,
      merged: !!src.ref && !!e.branch && git(cwd, ['merge-base', '--is-ancestor', 'refs/heads/' + e.branch, src.ref]).status === 0,
      fresh: !!e.branch && isFresh(cwd, e.branch),
      dirty: gone ? [] : statusOf(e.path),
    };
  });
  return { ok: true, facts, conf, layout, proj, src, entries };
}

/* The folder, then the branch. Neither is forced: git's own refusal of a dirty folder or an
   unmerged branch stands, and is reported as what it is. */
function removeEntry(cwd, e) {
  const said = [];
  const rm = git(cwd, ['worktree', 'remove', e.path]);
  if (rm.status !== 0) return { ok: false, said: ['git would not remove ' + e.path + ': ' + (rm.stderr || rm.stdout).trim()] };
  said.push('removed the folder ' + e.path);
  const del = git(cwd, ['branch', '-d', e.branch]);
  if (del.status === 0) said.push('deleted the branch `' + e.branch + '`');
  else said.push('KEPT the branch `' + e.branch + '`: git\'s own check refused from this checkout (' + (del.stderr || del.stdout).trim().split(/\r?\n/)[0] + '). It is merged into ' + e.source + '; delete it from a checkout of that branch: git branch -d ' + e.branch);
  return { ok: true, said };
}

function land(cwd, name) {
  const f = entryFacts(cwd);
  if (!f.ok) return { ok: false, lines: [f.why] };
  if (typeof name !== 'string' || !name) return { ok: false, lines: ['--land needs the workspace name: --land <name>'] };
  const branch = f.layout.branchPrefix + name;
  const e = f.entries.find((x) => x.branch === branch) || f.entries.find((x) => path.basename(x.path) === name);
  const head = e && e.head;
  const d = decideLand(Object.assign({ name, found: !!e }, e || {}, {
    verdict: e && !e.gone && !e.merged ? verdictProblems(readJson(path.join(e.path, 'scripts', 'harness', 'gates.json')), readJson(path.join(e.path, 'scripts', 'harness', 'gates.baseline.json')), head) : [],
  }));
  if (d.action === 'refuse') return { ok: false, action: d.action, lines: [d.why] };

  const noteRel = notePath(f.proj.docsRoot, name);
  const srcShort = f.src.ref.replace(/^origin\//, '');
  const srcHome = f.entries.find((x) => x.branch === srcShort && !x.gone);
  if (d.action === 'ready') {
    const lines = ['READY TO MERGE: ' + d.why + '. Nothing was removed. A person runs the merge:'];
    lines.push('  ' + (srcHome ? 'cd "' + srcHome.path + '"' : 'git switch ' + srcShort + '   (in a checkout of the source branch)'));
    lines.push('  git merge --no-ff ' + e.branch);
    if (git(cwd, ['cat-file', '-e', 'refs/heads/' + e.branch + ':' + noteRel]).status === 0) lines.push('  git rm ' + noteRel + '   and commit: the announce note is done once the work is in');
    lines.push('then run --land ' + name + ' again: it removes the folder and the branch only once the merge exists.');
    return { ok: false, action: 'ready', lines };
  }

  const lines = ['LANDING `' + name + '`: ' + d.why + '.'];
  const rm = removeEntry(cwd, e);
  for (const s of rm.said) lines.push('  ' + s);
  if (!rm.ok) return { ok: false, action: 'refuse', lines };
  // The plain-task note went in with the merge. Its removal is STAGED where the source branch
  // is checked out, never committed: a commit is a person's, and this machine may have no identity.
  if (git(cwd, ['cat-file', '-e', f.src.ref + ':' + noteRel]).status === 0) {
    const file = srcHome ? path.join(srcHome.path, ...noteRel.split('/')) : null;
    const clean = !!file && fs.existsSync(file) && !(git(srcHome.path, ['status', '--porcelain', '--', noteRel]).stdout || '').trim();
    if (clean && git(srcHome.path, ['rm', '-q', '--', noteRel]).status === 0) lines.push('  staged the removal of ' + noteRel + ' in ' + srcHome.path + ' — commit it there');
    else lines.push('  the announce note ' + noteRel + ' is still on ' + srcShort + ': git rm ' + noteRel + '   and commit, in a checkout of that branch');
  }
  return { ok: true, action: 'remove', lines };
}

function prune(cwd, yes) {
  const f = entryFacts(cwd);
  if (!f.ok) return { ok: false, lines: [f.why] };
  const found = f.entries.map((e) => ({ e, d: decidePrune(e) })).filter((x) => x.d);
  const lines = [];
  const label = (e) => (e.branch || '(detached)') + '  ' + e.path;
  for (const x of found.filter((y) => y.d.action === 'named')) lines.push('KEPT    ' + label(x.e) + ' — ' + x.d.why);
  const acts = found.filter((y) => y.d.action !== 'named');
  if (!yes) {
    for (const x of acts) lines.push((x.d.action === 'forget' ? 'STALE   ' : 'MERGED  ') + label(x.e) + ' — ' + x.d.why);
    lines.push(acts.length ? acts.length + ' entry(ies) can go. Nothing was removed: run --prune --yes to remove exactly these.' : 'Nothing to prune.');
    return { ok: true, lines, removed: 0, candidates: acts.length };
  }
  let removed = 0; let failed = 0;
  // `git worktree prune` clears every entry whose folder is gone and leaves a locked one alone.
  if (acts.some((x) => x.d.action === 'forget')) {
    const p = git(cwd, ['worktree', 'prune']);
    for (const x of acts.filter((y) => y.d.action === 'forget')) {
      if (p.status !== 0) { failed++; lines.push('FAILED  ' + label(x.e) + ' — git worktree prune: ' + (p.stderr || '').trim()); continue; }
      removed++;
      let tail = '';
      if (x.e.branch && x.e.merged && !x.e.fresh) tail = git(cwd, ['branch', '-d', x.e.branch]).status === 0 ? '; deleted the merged branch `' + x.e.branch + '`' : '; the branch `' + x.e.branch + '` is kept';
      else if (x.e.branch) tail = '; the branch `' + x.e.branch + '` is kept: it is not merged into ' + (x.e.source || 'the source branch');
      lines.push('FORGOT  ' + label(x.e) + ' — the entry is cleared' + tail);
    }
  }
  for (const x of acts.filter((y) => y.d.action === 'remove')) {
    const rm = removeEntry(cwd, x.e);
    if (rm.ok) removed++; else failed++;
    lines.push((rm.ok ? 'REMOVED ' : 'FAILED  ') + label(x.e) + ' — ' + rm.said.join('; '));
  }
  lines.push(removed + ' removed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  return { ok: failed === 0, lines, removed, candidates: acts.length };
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

  // one carried path. The guarded pattern here is a made-up name, not a real secret file's: the
  // secret guard refuses any call that spells one, and the matcher under test is the same.
  const G = { guarded: ['vault.key', 'vault.key.*'], openCarveOuts: [], today: '2026-01-01', hasMain: true, exists: true, ignored: true, inTarget: false };
  const carry = (over) => decideCarry(Object.assign({}, G, over));
  eq('an ignored path that exists is copied', carry({ path: 'local.private' }), { path: 'local.private', action: 'copy', why: null });
  eq('a leading ./ and a backslash are normalised', carry({ path: '.\\sub\\x.private' }).path, 'sub/x.private');
  for (const bad of ['/etc/x', 'C:\\x', 'C:/x', '../x', 'a/../../x', '']) eq('`' + bad + '` is refused as outside the checkout', carry({ path: bad }).action, 'refuse');
  eq('a guarded secret file is refused, at any depth', [carry({ path: 'vault.key' }).action, carry({ path: 'app/vault.key.local' }).action], ['refuse', 'refuse']);
  eq('its scaffolding twin is not', carry({ path: 'vault.key.example' }).action, 'copy');
  eq('a name that only contains the guarded one is not', carry({ path: 'myvault.key' }).action, 'copy');
  const carved = [{ path: 'vault.key.local', until: '2026-06-01' }];
  eq('a live carve-out opens exactly its own path', [carry({ path: 'vault.key.local', openCarveOuts: carved }).action, carry({ path: 'vault.key', openCarveOuts: carved }).action], ['copy', 'refuse']);
  eq('an expired carve-out opens nothing', carry({ path: 'vault.key.local', openCarveOuts: [{ path: 'vault.key.local', until: '2025-12-31' }] }).action, 'refuse');
  eq('with no date, no carve-out is live', carry({ path: 'vault.key.local', today: '', openCarveOuts: carved }).action, 'refuse');
  eq('a guarded path is refused even when it does not exist', carry({ path: 'vault.key', exists: false }).action, 'refuse');
  eq('absent, tracked, already there and no main checkout are each a skip',
    [carry({ path: 'a', exists: false }).action, carry({ path: 'a', ignored: false }).action, carry({ path: 'a', inTarget: true }).action, carry({ path: 'a', hasMain: false }).action], ['skip', 'skip', 'skip', 'skip']);

  // the hook payload
  eq('a payload names the workspace and the folder', hookPayload('{"name":"fix-a","cwd":"/r"}'), { ok: true, name: 'fix-a', cwd: '/r' });
  eq('a payload with no cwd leaves it to the caller', hookPayload('{"name":"fix-a"}').cwd, null);
  eq('junk, a list, and a payload with no name are each refused', [hookPayload('junk').ok, hookPayload('[]').ok, hookPayload('{"cwd":"/r"}').ok, hookPayload('{"name":7}').ok], [false, false, false, false]);

  // the announce note, its summary, and the overlap report
  const nt = noteText('fix-a', '  mend the  export ', '2026-01-02');
  ok('a note opens with the four required frontmatter fields', /^---\nid: workspace-fix-a\nkind: design\nstatus: open\nread_when: ".*"\n/.test(nt));
  eq('a note\'s summary is its one line, whitespace folded', noteSummary(nt), { kind: 'design', phaseNext: null, doing: 'mend the export' });
  eq('a note nobody filled in says nothing', noteSummary(noteText('fix-a', '', '2026-01-02')).doing, null);
  eq('a handoff\'s summary is the first line of its block, and its next phase',
    noteSummary('---\r\nid: x-handoff\r\nkind: handoff\r\nphase_next: 3\r\n---\r\n\r\n# T\r\n\r\n## ▶ NEXT\r\n\r\n```\r\nPHASE 3: do the thing\r\nmore\r\n```\r\n'), { kind: 'handoff', phaseNext: '3', doing: 'PHASE 3: do the thing' });
  eq('a long line is cut', noteSummary('---\nkind: design\n---\n' + 'x'.repeat(200) + '\n').doing.length, 110);
  eq('no frontmatter and no body is an empty summary', noteSummary(''), { kind: null, phaseNext: null, doing: null });
  eq('the note path hangs off the docs root', notePath('prose\\', 'fix-a'), 'prose/workspaces/fix-a.md');
  eq('with no diff, the candidates are the two paths named for the branch', noteCandidates('pay', null, 'docs', 'docs/tracks'), ['docs/tracks/pay/handoff.md', 'docs/workspaces/pay.md']);
  eq('a branch that changed a track under another name still has a note',
    noteCandidates('pay-phases', ['src/a.js', 'docs/tracks/pay/handoff.md', 'docs/tracks/pay/plan.md'], 'docs', 'docs/tracks'), ['docs/tracks/pay/handoff.md']);
  eq('the track named for the branch comes first, then the plain note',
    noteCandidates('pay', ['docs/workspaces/pay.md', 'docs/tracks/other/handoff.md', 'docs/tracks/pay/handoff.md'], 'docs', 'docs/tracks'),
    ['docs/tracks/pay/handoff.md', 'docs/workspaces/pay.md', 'docs/tracks/other/handoff.md']);
  eq('a branch that changed no note has none', noteCandidates('pay', ['src/a.js', 'docs/tracks/pay/deep/handoff.md'], 'docs', 'docs/tracks'), []);
  eq('a file on two lists overlaps; one on a single list does not',
    overlapsOf({ b: ['x.js', 'y.js'], a: ['y.js', 'z.js', 'y.js'], c: ['y.js', 'x.js'] }), [{ file: 'x.js', branches: ['b', 'c'] }, { file: 'y.js', branches: ['a', 'b', 'c'] }]);
  eq('one branch, or none, overlaps nothing', [overlapsOf({ a: ['x'] }), overlapsOf({}), overlapsOf(null)], [[], [], []]);
  eq('session start: alone, nothing is said', decideSessionStart(null, { others: [] }), { deny: false, reason: '' });
  const ss = decideSessionStart(null, { others: [{ branch: 'fix-a', path: P('w', 'fix-a') }, { branch: null, path: P('w', 'd') }] });
  ok('session start: each other checkout is named on one line, and it never denies', ss.deny === false && !/\n/.test(ss.context) && ss.context.includes('fix-a in ' + P('w', 'fix-a')) && /\(detached\) in /.test(ss.context) && /--list/.test(ss.context));
  ok('session start: a long list is cut with a count', /and 3 more/.test(decideSessionStart(null, { others: Array.from({ length: 9 }, (_, i) => ({ branch: 'b' + i, path: 'p' })) }).context));

  // the recorded verdict, landing and pruning
  const row = (o) => Object.assign({ pass: 5, fail: 0, skipped: 0, total: 5, exit: 0 }, o);
  const V = (o) => Object.assign({ commit: 'abc', dirty: false, gates: { test: row() } }, o);
  const B = { gates: { test: row() } };
  eq('a verdict at this commit, clean and no worse than the baseline is green', verdictProblems(V(), B, 'abc'), []);
  ok('no verdict at all is not green', /nothing has graded/.test(verdictProblems(null, B, 'abc')[0]));
  ok('a verdict about another commit is not green', /recorded at/.test(verdictProblems(V(), B, 'def')[0]));
  eq('a dirty verdict, and one that does not say, are not green', [verdictProblems(V({ dirty: true }), B, 'abc').length, verdictProblems(V({ dirty: undefined }), B, 'abc').length], [1, 1]);
  eq('a failing check, a bad exit, a vanished check, an undeclared skip and a gate that did not run are each red',
    [{ fail: 1 }, { exit: 1 }, { pass: 4, total: 4 }, { skipped: 1 }].map((o) => verdictProblems(V({ gates: { test: row(o) } }), B, 'abc').length).concat(verdictProblems(V({ gates: {} }), B, 'abc').length), [1, 1, 1, 1, 1]);
  eq('a skip the baseline declares is green; more checks than the baseline is green',
    [verdictProblems(V({ gates: { test: row({ pass: 4, skipped: 1 }) } }), { gates: { test: row({ pass: 4, skipped: 1 }) } }, 'abc'), verdictProblems(V({ gates: { test: row({ pass: 9, total: 9 }) } }), B, 'abc')], [[], []]);
  eq('an empty suite is not a green one', verdictProblems(V({ gates: {} }), { gates: {} }, 'abc').length, 1);

  const L = { name: 'fix-a', found: true, path: P('w', 'fix-a'), branch: 'fix-a', source: 'origin/main', dirty: [], merged: false, verdict: [] };
  const landing = (o) => decideLand(Object.assign({}, L, o));
  eq('clean, green and unmerged is READY: a merge command, nothing removed', landing({}).action, 'ready');
  eq('clean and merged is removed, whatever the verdict says', landing({ merged: true, verdict: ['x'] }).action, 'remove');
  ok('uncommitted work refuses, and names it', landing({ merged: true, dirty: ['a.js', 'b.js'] }).action === 'refuse' && /2 uncommitted or untracked path\(s\).*a\.js, b\.js/.test(landing({ merged: true, dirty: ['a.js', 'b.js'] }).why));
  ok('a locked entry refuses with the unlock command', /LOCKED.*git worktree unlock/.test(landing({ merged: true, locked: true }).why));
  ok('unmerged and not shown green refuses', /not shown green: no verdict/.test(landing({ verdict: ['no verdict'] }).why));
  eq('unknown, the main checkout, the one you stand in, a gone folder, a detached one and no source ref each refuse',
    [{ found: false }, { main: true }, { here: true }, { gone: true }, { branch: null }, { source: null }].map((o) => landing(Object.assign({ merged: true }, o)).action), Array(6).fill('refuse'));
  ok('a lock is said before dirt, and dirt before unmerged', /LOCKED/.test(landing({ locked: true, dirty: ['a'] }).why) && /would be lost/.test(landing({ dirty: ['a'], verdict: ['x'] }).why));

  const E = { path: P('w', 'x'), branch: 'x', source: 'main', merged: true, fresh: false, dirty: [] };
  const pr = (o) => { const d = decidePrune(Object.assign({}, E, o)); return d && d.action; };
  eq('merged, clean and worked on is removed', pr({}), 'remove');
  eq('a gone folder is forgotten, unless locked', [pr({ gone: true }), pr({ gone: true, locked: true })], ['forget', 'named']);
  eq('merged but locked, dirty or brand new is named and kept', [pr({ locked: true }), pr({ dirty: ['a'] }), pr({ fresh: true })], ['named', 'named', 'named']);
  eq('unmerged, detached, the main checkout and this one are not mentioned', [pr({ merged: false }), pr({ branch: null }), pr({ main: true }), pr({ here: true })], [null, null, null, null]);
  ok('a locked entry is told how to unlock', /git worktree unlock/.test(decidePrune(Object.assign({}, E, { locked: true })).why));

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

    // the overview, in a repo with a remote: notes read from git, and the overlap report
    const hub = path.join(tmp, 'hub.git');
    const one = path.join(tmp, 'ov', 'main');
    fs.mkdirSync(one, { recursive: true });
    ok('the overview fixture commits', mk(one, 'main'));
    const gi = (dir, args) => git(dir, ['-c', 'user.name=self-test', '-c', 'user.email=self-test@example.invalid', '-c', 'commit.gpgsign=false'].concat(args));
    gi(tmp, ['init', '-q', '--bare', hub]);
    gi(one, ['remote', 'add', 'origin', hub]); gi(one, ['push', '-q', 'origin', 'main']);
    const na = create(one, { name: 'task-a', doing: 'mend the export' });
    eq('a plain task gets one note named for it, under the docs root', [na.ok, na.note && na.note.rel, fs.existsSync(path.join(tmp, 'ov', 'task-a', 'docs', 'workspaces', 'task-a.md'))], [true, 'docs/workspaces/task-a.md', true]);
    const before = list(one).rows.find((x) => x.branch === 'task-a').note;
    eq('an uncommitted note is read off its folder and said to be uncommitted', [before && before.doing, before && before.committed], ['mend the export', false]);
    fs.writeFileSync(path.join(na.target, 'file.txt'), 'a\n');
    gi(na.target, ['add', '-A']); gi(na.target, ['commit', '-q', '-m', 'a']);
    const nb = create(one, { name: 'task-b', track: true });
    eq('a track gets no plain note: its handoff is the note', [nb.ok, nb.note === undefined, fs.existsSync(path.join(nb.target, 'docs', 'workspaces'))], [true, true, false]);
    fs.writeFileSync(path.join(nb.target, 'docs', 'tracks', 'task-b', 'handoff.md'), '---\nid: task-b-handoff\nkind: handoff\nstatus: open\nread_when: "x"\nphase_next: 1\n---\n\n## ▶ NEXT\n\n```\nPHASE 1: split the importer\n```\n');
    fs.writeFileSync(path.join(nb.target, 'file.txt'), 'b\n'); fs.writeFileSync(path.join(nb.target, 'only-b.txt'), 'b\n');
    gi(nb.target, ['add', '-A']); gi(nb.target, ['commit', '-q', '-m', 'b']);
    // a third branch that exists only on the remote: pushed from a folder, then folder and branch removed
    const nc = create(one, { name: 'task-c', doing: 'far away work' });
    fs.writeFileSync(path.join(nc.target, 'only-b.txt'), 'c\n');
    gi(nc.target, ['add', '-A']); gi(nc.target, ['commit', '-q', '-m', 'c']); gi(nc.target, ['push', '-q', 'origin', 'task-c']);
    gi(one, ['worktree', 'remove', '--force', nc.target]); gi(one, ['branch', '-D', 'task-c']);
    const ov = list(na.target);
    const rowOf = (b) => ov.rows.find((x) => x.branch === b) || {};
    eq('the overview reads each branch\'s committed note out of git', [rowOf('task-a').note, rowOf('task-b').note].map((n) => n && [n.doing, n.phaseNext, n.committed, n.path]),
      [['mend the export', null, true, 'docs/workspaces/task-a.md'], ['PHASE 1: split the importer', '1', true, 'docs/tracks/task-b/handoff.md']]);
    eq('the source branch\'s own checkout carries no note', rowOf('main').note, undefined);
    eq('a branch with a note and NO folder here is listed from the remote', ov.elsewhere.map((e) => [e.branch, e.note.doing]), [['origin/task-c', 'far away work']]);
    eq('a file two branches changed is reported, with a branch that has no folder here', ov.overlap, [{ file: 'file.txt', branches: ['task-a', 'task-b'] }, { file: 'only-b.txt', branches: ['origin/task-c', 'task-b'] }]);
    eq('the overview says what it compared against: the remote ref when it is not behind', ov.source, 'origin/main');
    eq('every checkout but this one is what the session-start line names', others(na.target).map((o) => o.branch).sort(), ['main', 'task-b']);
    eq('outside a repo there are no others', others(tmp), []);

    // landing and pruning, in the overview repo: task-a and task-b each hold one commit
    eq('an unmerged branch with no verdict is refused', [land(one, 'task-a').ok, /not shown green/.test(land(one, 'task-a').lines[0])], [false, true]);
    const headA = out1(gi(na.target, ['rev-parse', 'HEAD']));
    const vdir = path.join(na.target, 'scripts', 'harness');
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, 'gates.json'), JSON.stringify(V({ commit: headA })));
    fs.writeFileSync(path.join(vdir, 'gates.baseline.json'), JSON.stringify(B));
    const ta = na.target; const tb = nb.target;
    ok('uncommitted files refuse the landing, named', /would be lost: .*scripts\//.test(land(one, 'task-a').lines[0]));
    const exclude = out1(gi(one, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']));
    fs.appendFileSync(exclude, '\nscripts/harness/gates.json\nscripts/harness/gates.baseline.json\n');
    const ready = land(one, 'task-a');
    eq('clean, green and unmerged: READY, with the merge command and the note\'s removal, and nothing removed',
      [ready.ok, ready.action, ready.lines.some((l) => /git merge --no-ff task-a/.test(l)), ready.lines.some((l) => /git rm docs\/workspaces\/task-a\.md/.test(l)), fs.existsSync(ta)], [false, 'ready', true, true, true]);
    eq('--prune lists nothing while nothing is merged', [prune(one, false).candidates, prune(one, true).removed], [0, 0]);
    ok('standing in the folder refuses', /standing in/.test(land(ta, 'task-a').lines[0]));
    ok('an unknown name refuses', /no workspace named `nope`/.test(land(one, 'nope').lines[0]));
    // a person merges
    eq('the fixture merges', [gi(one, ['merge', '-q', '--no-ff', '-m', 'merge a', 'task-a']).status, gi(one, ['merge', '-q', '--no-ff', '-m', 'merge b', '-X', 'ours', 'task-b']).status], [0, 0]);
    gi(one, ['update-ref', 'refs/remotes/origin/main', 'refs/heads/main']);
    gi(ta, ['worktree', 'lock', ta]);
    ok('a locked entry is refused by name, with the unlock command', /LOCKED.*git worktree unlock/.test(land(one, 'task-a').lines[0]) && fs.existsSync(ta));
    fs.writeFileSync(path.join(tb, 'scratch.txt'), 'unsaved\n');
    const pl = prune(one, true);
    ok('--prune --yes names the locked one and keeps it', pl.lines.some((l) => /^KEPT .*task-a.*LOCKED/.test(l)) && fs.existsSync(ta));
    ok('...and the dirty one, with what would be lost', pl.lines.some((l) => /^KEPT .*task-b.*would be lost/.test(l)) && fs.existsSync(tb) && pl.removed === 0);
    gi(ta, ['worktree', 'unlock', ta]);
    const dry = prune(one, false);
    eq('--prune lists the merged clean one, names the dirty one, and removes nothing', [dry.candidates, dry.lines.some((l) => /^MERGED .*task-a/.test(l)), dry.lines.some((l) => /^KEPT .*task-b.*would be lost/.test(l)), fs.existsSync(ta)], [1, true, true, true]);
    const landed = land(one, 'task-a');
    eq('merged and clean: the folder and the branch go', [landed.ok, fs.existsSync(ta), refExists(one, 'refs/heads/task-a')], [true, false, false]);
    ok('...and the note\'s removal is staged where the source branch is checked out, not committed',
      landed.lines.some((l) => /staged the removal of docs\/workspaces\/task-a\.md/.test(l)) && /^D {2}docs\/workspaces\/task-a\.md/m.test(gi(one, ['status', '--porcelain']).stdout));
    ok('a dirty merged workspace is refused by --land too', /scratch\.txt/.test(land(one, 'task-b').lines[0]) && fs.existsSync(tb));
    fs.rmSync(path.join(tb, 'scratch.txt'));
    fs.rmSync(tb, { recursive: true, force: true });
    ok('a folder deleted by hand is refused by --land, which points at --prune', /gone already/.test(land(one, 'task-b').lines[0]));
    const fresh = create(one, { name: 'task-new', note: false });
    const swept = prune(one, true);
    eq('--prune --yes forgets the gone entry and deletes its merged branch; a brand-new workspace is kept',
      [swept.removed, refExists(one, 'refs/heads/task-b'), swept.lines.some((l) => /^KEPT .*task-new.*no commits of its own/.test(l)), fs.existsSync(fresh.target)], [1, false, true, true]);
    eq('the main checkout is never a candidate', list(one).rows.some((x) => x.main), true);
    // carry and setup, in a repo of their own. The fixture's ignored files are NOT named like a
    // guarded secret file: the secret guard refuses any command that spells one, fixture or not.
    const kit = path.join(tmp, 'kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, '.gitignore'), 'local.private\ncache/\n');
    ok('the carry fixture commits', mk(kit, 'dev'));
    fs.writeFileSync(path.join(kit, 'local.private'), 'mine\n');
    fs.mkdirSync(path.join(kit, 'cache', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(kit, 'cache', 'deep', 'a.bin'), 'a');
    const kitCfg = (wt) => fs.writeFileSync(path.join(kit, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'kit' }, gates: [{ name: 'test', command: 'node --test' }], worktrees: wt }));
    kitCfg({ carry: ['local.private', 'cache', 'file.txt', 'absent.txt'], setup: 'node -p 1 > setup-ran.txt' });
    const k = create(kit, { name: 'one', from: 'dev', quiet: true });
    const kt = path.join(tmp, 'kit.worktrees', 'one');
    eq('an ignored file and an ignored folder are carried into the new workspace',
      [k.ok, fs.existsSync(path.join(kt, 'local.private')) && fs.readFileSync(path.join(kt, 'local.private'), 'utf8'), fs.existsSync(path.join(kt, 'cache', 'deep', 'a.bin'))], [true, 'mine\n', true]);
    eq('each carried path is answered: copied, tracked, or absent', (k.carry || []).map((c) => c.action), ['copy', 'copy', 'skip', 'skip']);
    ok('a tracked path is said to be already there', /does not ignore it/.test(((k.carry || [])[2] || {}).why || ''));
    eq('the setup command ran IN the new folder', [k.setup && k.setup.ok, fs.existsSync(path.join(kt, 'setup-ran.txt')), fs.existsSync(path.join(kit, 'setup-ran.txt'))], [true, true, false]);
    kitCfg({ setup: 'node no-such-script.js' });
    const kf = create(kit, { name: 'two', from: 'dev', quiet: true });
    eq('a failing setup is reported and the folder is kept', [kf.ok, kf.setup && kf.setup.ok, fs.existsSync(path.join(tmp, 'kit.worktrees', 'two', 'file.txt'))], [true, false, true]);
    ok('...and the summary says FAILED', createdLines(kf).some((l) => /setup .*FAILED/.test(l)));
    fs.writeFileSync(path.join(kit, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'kit' }, gates: [{ name: 'test', command: 'node --test' }], env: { guarded: ['local.private'] }, worktrees: { carry: ['local.private'] } }));
    const kg = create(kit, { name: 'three', from: 'dev', quiet: true });
    ok('a carried path the secret guard guards refuses the whole --new', kg.ok === false && /secret guard guards `local\.private`/.test(kg.why) && /nothing was created/.test(kg.why));
    ok('...and nothing was made', !fs.existsSync(path.join(tmp, 'kit.worktrees', 'three')) && !refExists(kit, 'refs/heads/three'));
    fs.writeFileSync(path.join(kit, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'kit' }, gates: [{ name: 'test', command: 'node --test' }],
      env: { guarded: ['local.private'], openCarveOuts: [{ path: 'local.private', why: 'self-test', until: '2999-01-01' }] }, worktrees: { carry: ['local.private'] } }));
    const kc = create(kit, { name: 'three', from: 'dev', quiet: true });
    eq('a live dated carve-out lets the same path through', [kc.ok, kc.ok && fs.existsSync(path.join(kc.target, 'local.private'))], [true, true]);

    // the agent's own flag, by hook: the path alone on stdout
    // No --from on this route, and the fixture sits on none of the fallback names: say the source.
    fs.writeFileSync(path.join(kit, CONFIG.CONFIG_NAME), JSON.stringify({ project: { name: 'kit', sourceBranch: 'dev' }, gates: [{ name: 'test', command: 'node --test' }], worktrees: { carry: ['local.private'], setup: 'node -p 42' } }));
    const h =fromHook(JSON.stringify({ hook_event_name: 'WorktreeCreate', name: 'viahook', cwd: kit }), { quiet: true });
    eq('the hook route answers with the folder path ALONE on stdout', [h.exitCode, h.stdout], [0, path.join(tmp, 'kit.worktrees', 'viahook') + '\n']);
    ok('...lands in the same root as --new, with the carried file', fs.existsSync(path.join(tmp, 'kit.worktrees', 'viahook', 'local.private')));
    ok('...and says the rest on stderr', /CREATED workspace `viahook`/.test(h.stderr) && /carried {2}local\.private/.test(h.stderr));
    const hb = fromHook(JSON.stringify({ name: 'Bad Name', cwd: kit }), { quiet: true });
    eq('a bad name from the hook is a non-zero exit with nothing on stdout', [hb.exitCode !== 0, hb.stdout, /^WORKSPACE REFUSED: .*kebab-case/.test(hb.stderr)], [true, '', true]);
    eq('the same name twice is refused the second time', fromHook(JSON.stringify({ name: 'viahook', cwd: kit }), { quiet: true }).exitCode !== 0, true);
  } catch (e) {
    fails.push('the self-test threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* a temp dir the OS still holds is not a verdict */ }
  }

  for (const f of fails) console.log('FAIL  ' + f);
  console.log(fails.length ? '\nFAIL — worktree.js self-test: ' + fails.length + ' of ' + n + ' checks'
    : 'PASS — worktree.js self-test (' + n + ' checks: names, layout, porcelain, --new, --track, --list, config, carry, setup, hook, note, overview, overlap, land, prune)');
  return fails.length ? 1 : 0;
}

/* ---------- cli ---------- */

const USAGE = [
  'worktree.js — one folder per agent, on its own branch, over one shared history.',
  '',
  '  --new <name> [--track] [--from <ref>] [--doing "<one line>"]',
  '        Create a workspace folder and a branch of the same name, cut from the source branch',
  '        (the newer of the local and the remote one). --track also copies templates/track/ into',
  '        the tracks directory. --from names the ref to cut from instead. Never inside a checkout.',
  '        Then copies in each ignored path `worktrees.carry` lists and runs `worktrees.setup`.',
  '        Without --track it writes one announce note for the task (--doing is its first line).',
  '  --list',
  '        The overview: every checkout of this repo and what its branch says it is doing, read',
  '        from git; announced branches with no folder here; files changed on two or more branches.',
  '  --land <name>',
  '        Finish a workspace. Refuses a dirty folder, a locked entry and a branch not shown green.',
  '        Unmerged: prints the merge command for a person to run, and removes nothing (exit 1).',
  '        Merged: removes the folder and the branch, and stages the removal of the task\'s note.',
  '  --prune [--yes]',
  '        List entries whose folder is gone or whose branch is merged. Removes them only with',
  '        --yes; a locked, dirty or brand-new one is named and kept.',
  '  --self-test',
  '        Check this file against literals and a throwaway repo. Touches no real repo.',
  '',
  'It never merges, pushes, force-removes a dirty folder or deletes an unmerged branch.',
].join('\n');

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  if (has('--self-test')) return process.exit(selfTest());
  if (has('--new')) {
    const r = create(process.cwd(), { name: valueOf('--new'), track: has('--track'), from: valueOf('--from'), doing: valueOf('--doing') });
    if (!r.ok) { console.error('REFUSED: ' + r.why); return process.exit(1); }
    printCreated(r);
    if (r.setup && !r.setup.ok) { console.error('SETUP FAILED: `' + r.setup.command + '` in ' + r.target + ' — the workspace exists; fix the command and run it there'); return process.exit(1); }
    return process.exit(0);
  }
  if (has('--land') || has('--prune')) {
    const r = has('--land') ? land(process.cwd(), valueOf('--land')) : prune(process.cwd(), has('--yes'));
    // A refusal goes to stderr. A merge command or a list of what was kept is the answer, on stdout.
    if (!r.ok && r.action !== 'ready' && !has('--prune')) console.error('REFUSED: ' + r.lines.join('\n'));
    else for (const l of r.lines) console.log(l);
    return process.exit(r.ok ? 0 : 1);
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

module.exports = {
  nameProblem, decideLayout, decideCarry, hookPayload, parsePorcelain, fillTemplate, isInside, create, fromHook, list, sourceRef,
  noteText, notePath, noteCandidates, noteSummary, overlapsOf, others, decideSessionStart,
  verdictProblems, decideLand, decidePrune, land, prune,
  PARENT_MAIN, SIBLING_SUFFIX, NAME_RE, NOTES_DIR,
};

if (require.main === module) main();
