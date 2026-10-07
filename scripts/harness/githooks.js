'use strict';
/* AGENT HARNESS — the git-hook backstop.
   Replaces: nothing standing between an agent with no wired hook and a commit.

   A tool the harness cannot wire (scripts/harness/wire.js says which, and why) is refused nothing
   at the tool call. What is left is the tree it leaves behind, and git is the one place every
   tool's work passes through. Two hooks, and what each runs:
     pre-commit   the commit gate's report: strays, secrets, ignore gaps, root clutter
     pre-push     the gate suite, with the skips the repo's own config declares

   THIS IS A BACKSTOP AND NEVER A DENY. It runs after the work, at commit or push time, and a
   person can pass `--no-verify`. Nothing here may be reported as a refusal at the tool call.

   THE HOOK DIRECTORY IS THE USER'S, so three rules:
     1. OPT-IN. Nothing is written unless the caller asked (`harness init --git-hooks`).
     2. A hook that exists is NEVER replaced, not even one this file wrote earlier and would now
        write differently. It is named, with the lines to add by hand.
     3. A repo with `core.hooksPath` set keeps its hooks somewhere it chose, usually a directory
        it commits. It is left alone and told why.

   WHAT COUNTS AS INSTALLED is the effect, not the author: the file git would run for that hook
   holds the command, and (where the platform has the bit) is executable.

   --self-test  drive every decision with literals, including the ones that must come out NO
   Zero-dep, Node built-ins only.
   Usage: node scripts/harness/githooks.js --self-test */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MARK = 'agent-harness backstop';
const REPORT = 'node scripts/harness/guards/commit-hygiene.cjs --report';
const SUITE = 'node scripts/harness/gates.js --check';
const FLAG = '--git-hooks';
/** Each hook, when git runs it, and what it runs there. */
const HOOKS = [
  { name: 'pre-commit', when: 'commit', runs: 'the commit gate\'s report' },
  { name: 'pre-push', when: 'push', runs: 'the gate suite' },
];

const lf = (s) => String(s).replace(/\r\n/g, '\n');

/** The one command a hook runs. `skips` is the `--allow-skip` value the config declares, or ''. */
function commandOf(name, skips) {
  if (name === 'pre-commit') return REPORT;
  if (name === 'pre-push') return SUITE + (skips ? ' --allow-skip ' + skips : '');
  return null;
}

/** The hook file, whole. POSIX sh: git runs a hook through sh on every platform it ships for. */
function hookText(name, skips) {
  const h = HOOKS.find((x) => x.name === name);
  return [
    '#!/bin/sh',
    '# ' + MARK + ': ' + name + '. Written by `harness init ' + FLAG + '`, because it was asked for.',
    '# It runs ' + h.runs + ' at ' + h.when + ' time and stops the ' + h.when + ' on a red result.',
    '# It is a backstop, not a deny: it runs after the work, and `--no-verify` passes it.',
    '# This file is yours. Edit it, or delete it to remove the backstop.',
    commandOf(name, skips) + ' || exit 1',
    '',
  ].join('\n');
}

/** Does this hook text run the command? A commented-out line does not. */
function runsCommand(text, command) {
  if (text === null || text === undefined) return false;
  return lf(text).split('\n').some((l) => !/^\s*#/.test(l) && l.includes(command));
}

/**
 * What to do about ONE hook, given the file as it stands (null: there is none).
 *   write    there is none
 *   same     it is byte for byte what would be written
 *   present  somebody's hook already runs the command: nothing to add
 *   kept     a hook is there and does not run it: left alone, the line to add is named
 */
function decide(existing, name, skips) {
  if (existing === null || existing === undefined) return 'write';
  if (lf(existing) === hookText(name, skips)) return 'same';
  // The stem, so a hook that tolerates other skips than the config declares still counts.
  if (runsCommand(existing, commandOf(name, ''))) return 'present';
  return 'kept';
}

/**
 * The whole plan, pure. `facts` is what git said (see gitFacts); `read(name)` gives a hook's
 * text or null. Returns `{ refuse }` with the one sentence saying why nothing is written, or
 * `{ hooks: [{ name, when, runs, action, command, text }] }`.
 */
function plan(facts, read, skips) {
  if (!facts || facts.repo !== true) return { refuse: 'this is not a git repository, so there is no hook directory to write to' };
  if (facts.top !== true) return { refuse: 'the harness is not at the top of this git repository, and a git hook runs from the top: the commands would not resolve' };
  if (facts.hooksPath) {
    return { refuse: '`core.hooksPath` is set to `' + facts.hooksPath + '`: this repository keeps its hooks in a directory it chose, and the harness does not write there' };
  }
  return { hooks: HOOKS.map((h) => ({
    name: h.name, when: h.when, runs: h.runs, command: commandOf(h.name, skips),
    action: decide(read(h.name), h.name, skips), text: hookText(h.name, skips),
  })) };
}

/* ---------- the disk and git: everything above is pure ---------- */

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? String(r.stdout).replace(/\r?\n$/, '') : null;
}

/** What git says about this directory: `{ repo: false }`, or the top-level flag, the configured
 *  hooks path (null when unset) and the directory git runs hooks from. */
function gitFacts(root) {
  const cdup = git(root, ['rev-parse', '--show-cdup']);
  if (cdup === null) return { repo: false };
  const hooksPath = git(root, ['config', '--get', 'core.hooksPath']);
  const dir = git(root, ['rev-parse', '--git-path', 'hooks']);
  return { repo: true, top: cdup === '', hooksPath: hooksPath || null, dir: dir === null ? null : path.resolve(root, dir) };
}

const readHook = (facts) => (name) => {
  if (!facts.dir) return null;
  try { return fs.readFileSync(path.join(facts.dir, name), 'utf8'); } catch { return null; }
};

/** Plan against the real repo and, unless `dry`, write the hooks whose action is `write`. */
function install(root, opts) {
  const o = opts || {};
  const facts = gitFacts(root);
  const p = plan(facts, readHook(facts), o.skips || '');
  if (p.refuse || o.dry) return p;
  for (const h of p.hooks) {
    if (h.action !== 'write') continue;
    fs.mkdirSync(facts.dir, { recursive: true });
    fs.writeFileSync(path.join(facts.dir, h.name), h.text, { mode: 0o755 });
  }
  return p;
}

/**
 * Which backstops are STANDING in this repo, by effect: `{ commit, push }`, each true when the
 * file git would run for that hook runs the command. Whoever wrote it, and wherever
 * `core.hooksPath` points: this reads, it never writes. Off the top of the repository the
 * commands would not resolve, so nothing stands.
 */
function standing(root) {
  const out = { commit: false, push: false };
  const facts = gitFacts(root);
  if (facts.repo !== true || facts.top !== true || !facts.dir) return out;
  for (const h of HOOKS) {
    const file = path.join(facts.dir, h.name);
    let text = null;
    let runnable = false;
    try {
      text = fs.readFileSync(file, 'utf8');
      // The executable bit is the platform's to have: where it has none, git runs the file anyway.
      runnable = process.platform === 'win32' || (fs.statSync(file).mode & 0o111) !== 0;
    } catch { text = null; }
    out[h.when] = runnable && runsCommand(text, commandOf(h.name, ''));
  }
  return out;
}

/* ---------- --self-test ---------- */
function selfTest() {
  let CHECKS = 0; const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  const SK = 'reproducible-build=1';
  const TOP = { repo: true, top: true, hooksPath: null, dir: '/r/.git/hooks' };
  const none = () => null;

  eq('pre-commit runs the report', commandOf('pre-commit', SK), REPORT);
  eq('pre-push runs the suite with the declared skips', commandOf('pre-push', SK), SUITE + ' --allow-skip ' + SK);
  eq('...and with none declared, no flag', commandOf('pre-push', ''), SUITE);
  eq('an unknown hook runs nothing', commandOf('post-merge', SK), null);

  const text = hookText('pre-push', SK);
  eq('a hook is a sh script', text.split('\n')[0], '#!/bin/sh');
  eq('...that stops on a red result', text.includes(SUITE + ' --allow-skip ' + SK + ' || exit 1\n'), true);
  eq('...ends in one newline', /[^\n]\n$/.test(text), true);
  eq('...and says what it is NOT', /a backstop, not a deny/.test(text), true);
  eq('...and that it is the user\'s to remove', /delete it to remove/.test(text), true);

  eq('runs: the command on a line of its own', runsCommand('#!/bin/sh\n' + REPORT + '\n', REPORT), true);
  eq('runs: inside a longer line', runsCommand('npx lint && ' + REPORT + ' || exit 1', REPORT), true);
  eq('runs: a COMMENTED line does not run', runsCommand('#!/bin/sh\n  # ' + REPORT + '\n', REPORT), false);
  eq('runs: no file runs nothing', runsCommand(null, REPORT), false);

  eq('decide: no hook is a write', decide(null, 'pre-commit', SK), 'write');
  eq('decide: our own text is the same', decide(hookText('pre-commit', SK), 'pre-commit', SK), 'same');
  eq('decide: CRLF does not make it another file', decide(hookText('pre-commit', SK).replace(/\n/g, '\r\n'), 'pre-commit', SK), 'same');
  eq('decide: a user hook that already runs the command has nothing to add', decide('#!/bin/sh\nnpx lint\n' + REPORT + '\n', 'pre-commit', SK), 'present');
  eq('decide: a pre-push tolerating OTHER skips still runs the suite', decide(hookText('pre-push', SK + ',docs=1'), 'pre-push', SK), 'present');
  eq('decide: a user hook that does not run it is KEPT, never replaced', decide('#!/bin/sh\nnpx lint\n', 'pre-commit', SK), 'kept');
  eq('decide: an empty hook file is still a hook that exists', decide('', 'pre-commit', SK), 'kept');
  eq('decide: our marker with the command removed is the user\'s edit, and kept', decide('#!/bin/sh\n# ' + MARK + '\n', 'pre-commit', SK), 'kept');

  eq('plan: not a repository is refused', /not a git repository/.test(plan({ repo: false }, none, SK).refuse), true);
  eq('plan: no facts at all is refused', Object.keys(plan(null, none, SK)), ['refuse']);
  eq('plan: below the top of the repository is refused', /not at the top/.test(plan(Object.assign({}, TOP, { top: false }), none, SK).refuse), true);
  eq('plan: core.hooksPath is left alone, and named', /`core\.hooksPath` is set to `\.husky`/.test(plan(Object.assign({}, TOP, { hooksPath: '.husky' }), none, SK).refuse), true);
  const fresh = plan(TOP, none, SK);
  eq('plan: a fresh repository gets both hooks', fresh.hooks.map((h) => h.name + ':' + h.action), ['pre-commit:write', 'pre-push:write']);
  eq('plan: each says when it runs', fresh.hooks.map((h) => h.when), ['commit', 'push']);
  const mixed = plan(TOP, (n) => (n === 'pre-commit' ? '#!/bin/sh\nnpx lint\n' : null), SK);
  eq('plan: one hook kept does not stop the other being written', mixed.hooks.map((h) => h.action), ['kept', 'write']);
  eq('plan: a kept hook still carries the line to add by hand', mixed.hooks[0].command, REPORT);
  const again = plan(TOP, (n) => hookText(n, SK), SK);
  eq('plan: a second run writes nothing', again.hooks.map((h) => h.action), ['same', 'same']);

  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — githooks.js self-test (' + CHECKS + ' checks)');
}

module.exports = { MARK, REPORT, SUITE, FLAG, HOOKS, commandOf, hookText, runsCommand, decide, plan, gitFacts, install, standing };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--self-test') {
    console.error('usage: node scripts/harness/githooks.js --self-test');
    process.exit(2);
  }
  selfTest();
}
