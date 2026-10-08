#!/usr/bin/env node
'use strict';

/*
 * hook.js — THE ONE HOOK ENTRY. Every coding agent's hook config registers this file, and
 * nothing else:
 *
 *   node scripts/harness/hook.js --tool <id> --event <pre-tool|session-start|prompt-submit|stop>
 *   node scripts/harness/hook.js --tool <id> --event worktree-create
 *   node scripts/harness/hook.js --self-test
 *
 * THE FIFTH EVENT IS NOT A VERDICT. `worktree-create` is the agent's own worktree flag asking
 * WHERE its folder is: the answer is a path on stdout, alone, and no guard has anything to
 * decide. So it runs no handler list and no dialect emit(): the payload goes to
 * scripts/harness/worktree.js, which creates the workspace exactly as `--new` does and returns
 * the path. It is here, and not a second registered script, because the installer recognises
 * its own registrations by a command that runs THIS file. It is honoured only for a registry
 * row whose `worktreeCreate` cell is true; for any other row it is a refusal, exit 2.
 *
 * WHAT IT DOES, in order: looks `<id>` up in the tool registry (scripts/harness/tools.json),
 * loads that row's dialect module from scripts/harness/dialects/, has the dialect parse stdin
 * into the neutral event, runs that event's ORDERED HANDLER LIST, and has the dialect spell
 * the verdict back. It decides nothing itself and knows no tool: a tool is a registry row, a
 * wire format is a dialect module, and a decision is a guard's.
 *
 * A HANDLER is `{ name, actions, gather(event, ctx), decide(event, state) }`.
 *   decide   is pure: no stdin, no disk, no clock. It returns the neutral verdict
 *            `{ deny, reason }`, optionally with `ask`, `message` and `context` (the contract is
 *            written out in scripts/harness/dialects/_wire.js).
 *   gather   is the disk half, and runs here: the config, the tool's own deny list, a doc's
 *            prior text, today's date. What it returns is the `state` decide() is handed.
 *   actions  which neutral actions the handler is offered. Absent, it is offered every call.
 *            An OPAQUE call (one whose shape no dialect vouches for) is offered to every handler
 *            whatever its action, because nothing can say which of them it concerns.
 *
 * ADDING A HANDLER IS ONE EDIT, IN ONE PLACE: the HANDLERS table below. That table is the seam
 * for a later track. `prompt-submit` and `stop` are wired end to end (flag, parse, run, emit)
 * and carry no handler yet; whoever owns one appends an entry to that event's list and changes
 * nothing else in this file.
 *
 * THE RULES OF REFUSAL.
 *   A deny is the dialect's JSON on stdout AND exit code 2. Several tools are documented to
 *   fail OPEN on any other exit code, so the JSON alone is not a refusal everywhere. THE EXIT
 *   CODE IS THIS FILE'S, not the dialect's: whatever emit() returns for a deny, the exit is 2,
 *   and an emit() that returns nothing for a deny or an ask is a refusal on stderr.
 *   A handler that THROWS is a deny, with the handler named. A guard that could not look has
 *   not found the call clean. A handler that ENDS THE PROCESS has not decided either: exit 2.
 *   A payload the dialect cannot parse is a deny. So is a payload that says it is a different
 *   event from the one this registration names: the handlers for the real event did not run.
 *   It is spelled under the payload's event, the one the tool is waiting on; where that event
 *   is session-start, which cannot refuse, and the flag names one that can, under the flag's.
 *   An unknown tool id, a row with no dialect, a missing --event, NO ARGUMENTS AT ALL: exit 2
 *   with the reason on stderr. There is no dialect to spell it in, and a misregistered hook
 *   must not pass calls. `--help` and `--self-test` are honoured only as the whole command
 *   line, so neither can be appended to a registration to switch it off.
 *   An ASK (a human decides) is carried through; a dialect with no spelling for it denies.
 *
 * TWO EVENTS CANNOT REFUSE, and are not pretended to. A session starts whatever was found, so
 * at session-start a thrown reporter, an unreadable payload and a context that could not be
 * set up are REPORTED in the session's context, beside the reports that did run.
 * And a refusal at `stop` does not refuse anything: it FORCES ANOTHER TURN. So one rule covers
 * every failure of the entry itself at `stop`, and it is that THE TURN ENDS, with the failure
 * on stderr: an unreadable payload, a stop handler that threw (it is skipped, and the handlers
 * after it still run), a context that could not be set up, and a stop payload handed to a
 * registration for another event. Forcing a turn because the entry failed is a loop, on every
 * stop, until somebody fixes a hook. Only a stop handler that RETURNS a deny forces a turn.
 *
 * Each guard keeps its own CLI (--self-test, --gate, --report, --check, --clear,
 * --rearm-check, --memory-check, --hook) and the gates call those directly. Run that way a
 * guard prints the one wire format it always did and exits 0; exit 2 is this file's.
 */

const fs = require('node:fs');
const path = require('node:path');

const EVENTS = ['pre-tool', 'session-start', 'prompt-submit', 'stop'];
/** The one event whose verdict cannot refuse anything: a session starts whatever was found. */
const REPORT_ONLY = 'session-start';
/** The one event that answers with a path instead of a verdict. It has no handler list. */
const WORKSPACE = 'worktree-create';

/* ── the guards, loaded when first needed ───────────────────────────────────── */

/* Lazily, so a pre-tool call never pays for a session-start reporter and a broken reporter
   cannot stop a pre-tool guard from loading. Each is named on its own line on purpose: the
   orphan-helper rule in the commit gate reads this file to learn which guards are wired. */
const envGuard = () => require('./guards/env-guard.cjs');
const commitHygiene = () => require('./guards/commit-hygiene.cjs');
const phaseGuard = () => require('./guards/phase-guard.cjs');
const skillVerify = () => require('./guards/skill-verify.cjs');
const docsLint = () => require('./guards/docs-lint.cjs');
const branchSync = () => require('./branch-sync.js');
const worktree = () => require('./worktree.js');

/**
 * The declarative deny list that sits in front of the hooks, for the secret-file guard's
 * re-arm report (trap MT-06). Which file holds it is the DIALECT's to say, and it applies only
 * to the registry row whose hook config IS that file: two tools may share a wire format and
 * keep their permissions in different places.
 *
 *   { denyLayer: false }      this tool has no deny file the harness knows how to read
 *   { denyList: [...] }       the list, as the file gives it
 *   { denyList: undefined }   the file is there to be read and could not be: both spellings
 *                             of every guarded path are then reported missing, as they must be
 */
function denyLayerOf(ctx) {
  const p = ctx.dialect && ctx.dialect.permissions;
  if (!p || !ctx.row || ctx.row.hookConfig !== p.file) return { denyLayer: false };
  try { return { denyList: p.read(ctx.readText(p.file)) }; } catch { return { denyList: undefined }; }
}

/* ── THE HANDLER TABLE: one ordered list per event. THIS IS THE SEAM. ──────── */

const HANDLERS = {
  /* The order the three were registered in before this file existed. The first deny ends the
     run; an ask from an earlier handler does not stop a later one from denying. */
  'pre-tool': [
    {
      name: 'env-guard',
      actions: ['shell', 'read', 'search', 'write'],
      gather: (event, ctx) => Object.assign({}, envGuard().stanceOf(ctx.cfg()), { today: ctx.today }),
      decide: (event, state) => envGuard().decide(event, state),
    },
    {
      name: 'commit-hygiene',
      actions: ['shell'],
      // The tree is read ONLY for a command that commits or pushes, which is what keeps this
      // gate free for every other call.
      gather: (event) => {
        const g = commitHygiene();
        return g.isGitWrite(event.command) ? g.gatherGate(event.command, g.context()) : {};
      },
      decide: (event, state) => commitHygiene().decide(event, state),
    },
    {
      name: 'phase-guard',
      actions: ['shell', 'write'],
      gather: (event, ctx) => phaseGuard().gather(event, ctx.cfg()),
      decide: (event, state) => phaseGuard().decide(event, state),
    },
  ],

  /* Reporters. None can deny; each is silent when it has nothing to say. Same order as the
     four separate registrations they replace; the fifth, the workspace line, came later. */
  'session-start': [
    {
      name: 'skill-verify',
      gather: () => skillVerify().gatherSessionStart(),
      decide: (event, state) => skillVerify().decideSessionStart(event, state),
    },
    {
      name: 'env-guard',
      gather: (event, ctx) => Object.assign({}, envGuard().stanceOf(ctx.cfg()), { today: ctx.today }, denyLayerOf(ctx)),
      decide: (event, state) => envGuard().decideSessionStart(event, state),
    },
    {
      name: 'docs-lint',
      gather: () => docsLint().gatherSessionStart(),
      decide: (event, state) => docsLint().decideSessionStart(event, state),
    },
    {
      name: 'branch-sync',
      gather: () => ({ ev: branchSync().evaluate(process.env.BRANCH_SYNC_REF || null) }),
      decide: (event, state) => branchSync().decideSessionStart(event, state),
    },
    {
      // Who else has a folder of this repo on this computer. One line, silent with none.
      name: 'worktree',
      gather: (event, ctx) => ({ others: worktree().others(ctx.root) }),
      decide: (event, state) => worktree().decideSessionStart(event, state),
    },
  ],

  /* THE SEAM, EMPTY ON PURPOSE. Append `{ name, gather, decide }` here; nothing else moves. */
  'prompt-submit': [],
  stop: [],
};

/* ── running a list ─────────────────────────────────────────────────────────── */

const ALLOW = Object.freeze({ deny: false, reason: '' });
const isVerdict = (v) => !!v && typeof v === 'object' && typeof v.deny === 'boolean';
const oneLine = (e) => String((e && e.message) || e || 'no message').split('\n')[0].slice(0, 200);
const offered = (h, event) => event.opaque === true || !Array.isArray(h.actions) || h.actions.includes(event.action);

/** One handler, start to finish. Never throws: a throw comes back as `{ threw }`. */
function runOne(h, event, ctx) {
  try {
    const v = h.decide(event, h.gather ? h.gather(event, ctx) : {});
    if (!isVerdict(v)) return { threw: 'it returned no verdict' };
    return { verdict: v };
  } catch (e) {
    return { threw: 'it threw (' + oneLine(e) + ')' };
  }
}

/**
 * An event that can refuse: the list in order, the first DENY ends it, and otherwise the first
 * ASK stands. A handler that threw, or returned something that is not a verdict, is a deny.
 * EXCEPT AT `stop` (see the header): there it is skipped and named in `said`, the lines the
 * entry writes to stderr, because a deny at stop is a forced turn and not a refusal.
 */
function runGate(list, event, ctx, said) {
  let ask = null;
  for (const h of list) {
    if (!offered(h, event)) continue;
    const r = runOne(h, event, ctx);
    if (r.threw && event.event === 'stop') {
      if (Array.isArray(said)) {
        said.push('HOOK ENTRY: the `' + h.name + '` stop handler could not decide: ' + r.threw
          + '. It was skipped. A handler that failed is not a reason to force another turn.');
      }
      continue;
    }
    if (r.threw) {
      const reason = 'HOOK ENTRY: the `' + h.name + '` handler could not decide this ' + event.event + ' call: ' + r.threw + '.\n'
        + 'A guard that could not look has not found the call clean, so this is a refusal and not a pass.\n'
        + 'Run `node scripts/harness/hook.js --self-test` and that guard\'s own --self-test to find out why.';
      return { deny: true, reason, message: 'Hook entry: the ' + h.name + ' handler failed, so the call was refused.' };
    }
    if (r.verdict.deny) return r.verdict;
    if (r.verdict.ask && !ask) ask = r.verdict;
  }
  return ask || ALLOW;
}

/**
 * Session start: every reporter runs, and what each has to say is joined in list order. It
 * never denies. A reporter that threw is named in the context, because a report that silently
 * did not run reads exactly like a clean one. `notes` are things the entry itself has to say.
 */
function runReport(list, event, ctx, notes) {
  const texts = (notes || []).slice();
  const messages = [];
  for (const h of list) {
    if (!offered(h, event)) continue;
    const r = runOne(h, event, ctx);
    if (r.threw) {
      texts.push('*** A SESSION-START REPORT DID NOT RUN ***\nThe `' + h.name + '` reporter could not report: ' + r.threw
        + '.\nNot run is not clean. Its own CLI will say why.');
      messages.push('WARNING: the ' + h.name + ' session-start report did not run.');
      continue;
    }
    const v = r.verdict;
    const text = String(v.context || ((v.deny || v.ask) ? v.reason : '') || '');
    if (text) texts.push(text);
    if (v.message) messages.push(String(v.message));
  }
  if (!texts.length) return ALLOW;
  return { deny: false, reason: '', context: texts.join('\n\n'), message: messages.join(' ') || undefined };
}

/* ── the entry ──────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { tool: null, event: null, problems: [] };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tool' || a[i] === '--event') {
      const v = a[i + 1];
      if (typeof v !== 'string' || v.startsWith('--')) out.problems.push(a[i] + ' needs a value');
      else { out[a[i].slice(2)] = v; i++; }
    }
  }
  if (!out.tool && !out.problems.some((p) => p.startsWith('--tool'))) out.problems.push('--tool <id> is missing');
  if (!out.event && !out.problems.some((p) => p.startsWith('--event'))) out.problems.push('--event is missing');
  else if (out.event && out.event !== WORKSPACE && !EVENTS.includes(out.event)) out.problems.push('--event `' + out.event + '` is not one of ' + EVENTS.join(', '));
  return out;
}

/** No dialect to spell it in: the reason on stderr, and the one exit code every tool refuses on. */
const refuse = (why) => ({
  stdout: '',
  stderr: 'HOOK ENTRY REFUSED: ' + why + '\n'
    + 'A hook that is registered wrongly must not pass calls, so this is a refusal. '
    + 'Usage: node scripts/harness/hook.js --tool <id> --event <' + EVENTS.join('|') + '>\n',
  exitCode: 2,
});

const SAFE_NAME = /^[a-z][a-z0-9-]*$/;

/** The dialect module of a registry row, or a thrown reason. */
function dialectFor(registry, id, loadDialect) {
  const rows = (registry && Array.isArray(registry.tools)) ? registry.tools : [];
  const row = rows.find((r) => r && r.id === id);
  if (!row) {
    throw new Error('`' + id + '` is not a tool id in the registry (scripts/harness/tools.json). Known ids: '
      + (rows.map((r) => r && r.id).filter(Boolean).join(', ') || 'none') + '.');
  }
  const name = row.dialect;
  if (typeof name !== 'string' || !name) {
    throw new Error('the registry row `' + id + '` has no dialect, so the harness has no hook it can wire for that tool.');
  }
  const listed = Array.isArray(registry.dialects) ? registry.dialects : [];
  if (!SAFE_NAME.test(name) || !listed.includes(name)) {
    throw new Error('the registry row `' + id + '` names the dialect `' + name + '`, which the registry does not list.');
  }
  let dialect;
  try { dialect = loadDialect(name); } catch (e) {
    throw new Error('the dialect module for `' + name + '` could not be loaded (' + oneLine(e) + ').');
  }
  if (!dialect || typeof dialect.parse !== 'function' || typeof dialect.emit !== 'function') {
    throw new Error('the dialect module for `' + name + '` does not export parse() and emit().');
  }
  return { row, dialect };
}

/**
 * The whole run, with every outside thing injected: `{ argv, stdin, readRegistry, loadDialect,
 * handlers, context }` in, `{ stdout, stderr, exitCode }` out. Never throws.
 */
function execute(o) {
  const args = parseArgs(o.argv);
  if (args.problems.length) return refuse(args.problems.join('; ') + '.');

  let found;
  try { found = dialectFor(o.readRegistry(), args.tool, o.loadDialect); } catch (e) { return refuse(oneLine(e)); }
  const { row, dialect } = found;
  const kind = args.event;
  /* A PATH, NOT A VERDICT: see the header. Decided before the payload is parsed as a tool
     call, because it is not one. Whatever goes wrong is a refusal with nothing on stdout: the
     agent reads stdout as the folder to start in, and half a path is a folder. */
  if (kind === WORKSPACE) {
    if (row.worktreeCreate !== true) return refuse('the registry row `' + row.id + '` does not establish a worktree-create hook (`worktreeCreate` is not true), so nothing is routed for it.');
    let out;
    try { out = o.workspace(o.stdin, row); } catch (e) { return refuse('the workspace could not be created (' + oneLine(e) + ').'); }
    if (!out || typeof out !== 'object') return refuse('the workspace script returned nothing.');
    const code = Number.isInteger(out.exitCode) ? out.exitCode : 2;
    return { stdout: code === 0 ? String(out.stdout || '') : '', stderr: String(out.stderr || ''), exitCode: code === 0 ? 0 : 2 };
  }
  const list =(o.handlers && o.handlers[kind]) || [];
  /* THE DIALECT SPELLS, THIS FILE ENFORCES. A deny is exit 2 whatever emit() returned, and a
     deny or an ask that emit() threw on, returned nothing for, or spelled as silence is a
     refusal on stderr. Only a verdict that refuses nothing takes the dialect's exit code, and
     at session-start the exit is 0 whatever the dialect returned. */
  const spell = (verdict, event) => {
    const refusing = !!verdict && (verdict.deny === true || verdict.ask === true) && event.event !== REPORT_ONLY;
    const mute = (why) => (refusing
      ? refuse('the dialect could not spell a refusal (' + why + '). The refusal: ' + oneLine({ message: verdict.reason }))
      : { stdout: '', stderr: '', exitCode: 0 });
    let out;
    try { out = dialect.emit(verdict, event, row); } catch (e) { return mute(oneLine(e)); }
    if (!out || typeof out !== 'object') return mute('its emit() returned nothing');
    const res = { stdout: String(out.stdout || ''), stderr: String(out.stderr || ''), exitCode: Number.isInteger(out.exitCode) ? out.exitCode : 0 };
    // A session starts whatever was found, and whatever the dialect returned.
    if (event.event === REPORT_ONLY) res.exitCode = 0;
    if (!refusing) return res;
    if (verdict.deny) {
      res.exitCode = 2;
      if (!res.stderr) res.stderr = String(verdict.reason || '');
      return res;
    }
    // An ask. Exit 0 with something on stdout is the one way to spell it as an ask; an exit
    // code the dialect did not give, or silence, is an ask nobody will be asked.
    if (!Number.isInteger(out.exitCode) || (res.exitCode === 0 && !res.stdout.trim())) return mute('its emit() spelled an ask as silence');
    if (res.exitCode !== 0) res.exitCode = 2;
    return res;
  };
  /** At `stop` a failure of the entry itself ends the turn, and says why. See the header. */
  const endTurn = (why) => ({ stdout: '', stderr: why + '\nThe turn ends: a refusal here would force another turn, on every stop.\n', exitCode: 0 });

  const notes = [];
  let event;
  try {
    event = dialect.parse(o.stdin);
    if (!event || typeof event !== 'object') throw new Error('the dialect returned no event');
  } catch {
    // The dialect's own message is NOT repeated: a parser's error text routinely quotes what
    // it choked on, and a reason outlives the call.
    const why = 'HOOK ENTRY: the payload of this ' + kind + ' hook could not be read ('
      + (String(o.stdin == null ? '' : o.stdin).trim() ? 'it is not a payload this tool\'s dialect can parse' : 'it is empty') + ').';
    if (kind === 'stop') return endTurn(why + ' No stop handler looked at it.');
    if (kind !== REPORT_ONLY) {
      return spell({
        deny: true,
        reason: why + '\nSo no guard could look at the call, and a call nothing looked at is refused, never waved through.\n'
          + 'The payload is deliberately not quoted: what made it unreadable may be what is in it.',
        message: 'Hook entry: an unreadable ' + kind + ' payload was refused.',
      }, { event: kind });
    }
    notes.push(why + '\nThe session-start reports below ran without it.');
    event = { event: kind, action: 'other', command: null, path: null, content: null, old: null, tool: '', input: {}, opaque: false };
  }

  // The flag says which event this registration is for, and it is authoritative where the
  // payload is silent. Where the payload DISAGREES, the handlers for the event that is really
  // happening are not the ones this run would call, so the run is refused under the payload's
  // own event, which is the one the tool is waiting on an answer for. Two exceptions, both in
  // the header: a stop payload ends the turn, and a session-start payload, whose event cannot
  // refuse, is refused under the FLAG's event when that one can. If the envelope is what is
  // wrong, that is exit 2 on a tool call; if the registration is, exit 2 stops no session.
  if (event.event && event.event !== kind) {
    const real = event.event;
    const reason = 'HOOK ENTRY: this hook is registered with --event ' + kind + ' and was handed a ' + real + ' payload.\n'
      + 'The ' + real + ' handlers therefore did not run, and a call no guard looked at is refused.\n'
      + 'Fix the registration in ' + (row.hookConfig || 'the tool\'s hook config') + '.';
    if (real === 'stop') return endTurn(reason);
    const under = (real === REPORT_ONLY && kind !== 'stop') ? kind : real;
    return spell({ deny: true, reason, message: 'Hook entry: registered for ' + kind + ', called for ' + real + '.' },
      Object.assign({}, event, { event: under }));
  }
  event.event = kind;

  let ctx;
  try { ctx = o.context(row, dialect); } catch (e) {
    const why = 'HOOK ENTRY: what the ' + kind + ' handlers read (the config, the date) could not be set up (' + oneLine(e) + ').';
    if (kind === 'stop') return endTurn(why + ' No stop handler ran.');
    if (kind !== REPORT_ONLY) {
      return spell({
        deny: true,
        reason: why + '\nSo no guard could look at the call, and a call nothing looked at is refused, never waved through.',
        message: 'Hook entry: the handlers could not be set up, so the call was refused.',
      }, event);
    }
    // A session starts regardless. Each reporter that needed what is missing says so itself.
    notes.push(why + '\nThe session-start reports below ran without it.');
    ctx = { row, dialect };
  }
  if (kind === REPORT_ONLY) return spell(runReport(list, event, ctx, notes), event);
  const said = [];
  const res = spell(runGate(list, event, ctx, said), event);
  if (said.length) res.stderr = said.join('\n') + '\n' + res.stderr;
  return res;
}

/** What a handler's gather() may use. Each read is done once, and only when asked for. */
function liveContext(row, dialect) {
  const { load, resolve, ROOT } = require('./config.js');
  let cfg;
  return {
    row,
    dialect,
    root: ROOT,
    today: new Date().toISOString().slice(0, 10),
    // SOFT, like every hook's read of the config: an unreadable config is null, and each guard
    // then falls back to its strictest documented stance rather than to no stance.
    cfg: () => {
      if (cfg === undefined) { try { cfg = load({ soft: true }); } catch { cfg = null; } }
      return cfg;
    },
    readText: (rel) => fs.readFileSync(resolve(...String(rel).split('/')), 'utf8'),
  };
}

const liveRegistry = () => require('./tools.js').readRegistry();
const liveDialect = (name) => require(path.join(__dirname, 'dialects', name + '.js'));
// Loaded when the event arrives: a pre-tool call never pays for the workspace script.
const liveWorkspace = (stdin) => require('./worktree.js').fromHook(stdin);

/* ── self-test ──────────────────────────────────────────────────────────────── */

function selfTest() {
  let CHECKS = 0;
  const f = [];
  const eq = (label, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };

  /* A wire format and a registry that exist only here, so no assertion depends on a real tool. */
  const wire = {
    parse(stdin) {
      const p = JSON.parse(stdin);
      return { event: p.kind || null, action: p.action || 'other', command: p.command || null, path: null, content: null, old: null, tool: 't', input: p, opaque: p.opaque === true };
    },
    emit(v, e, row) {
      emitted.push(row && row.id);
      const text = v.context || (v.deny ? v.reason : '');
      if (e.event === 'session-start') return { stdout: text ? 'CTX ' + text + (v.message ? ' MSG ' + v.message : '') : '', stderr: '', exitCode: 0 };
      if (v.deny) return { stdout: 'DENY', stderr: v.reason, exitCode: 2 };
      if (v.ask) return { stdout: 'ASK', stderr: v.reason, exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
  const emitted = [];
  const REG = {
    dialects: ['wire-a'],
    tools: [
      { id: 'tool-a', dialect: 'wire-a', hookConfig: '.tool-a/hooks.json' },
      { id: 'tool-none', dialect: null },
      { id: 'tool-unlisted', dialect: 'wire-z' },
    ],
  };
  const seen = [];
  const h = (name, verdict, actions) => ({
    name, actions,
    gather: () => ({ from: name }),
    decide: (event, state) => { seen.push(name + ':' + state.from); if (verdict instanceof Error) throw verdict; return verdict; },
  });
  const allow = { deny: false, reason: '' };
  const run = (argv, stdin, handlers, extra) => execute(Object.assign({
    argv, stdin, handlers: handlers || {},
    readRegistry: () => REG, loadDialect: (n) => { if (n !== 'wire-a') throw new Error('no such module'); return wire; },
    context: (row, dialect) => ({ row, dialect }),
  }, extra || {}));
  const pre = ['--tool', 'tool-a', '--event', 'pre-tool'];
  const call = JSON.stringify({ kind: 'pre-tool', action: 'shell', command: 'x' });

  // the arguments
  eq('args: both flags', [parseArgs(pre).tool, parseArgs(pre).event, parseArgs(pre).problems], ['tool-a', 'pre-tool', []]);
  eq('args: no --tool is a problem', parseArgs(['--event', 'stop']).problems, ['--tool <id> is missing']);
  eq('args: no --event is a problem', parseArgs(['--tool', 'x']).problems, ['--event is missing']);
  eq('args: an unknown event is a problem', parseArgs(['--tool', 'x', '--event', 'post-tool']).problems.length, 1);
  eq('args: a flag with no value is a problem', parseArgs(['--tool', '--event', 'stop']).problems, ['--tool needs a value']);
  eq('the four events', EVENTS, ['pre-tool', 'session-start', 'prompt-submit', 'stop']);

  // a misregistered hook refuses, on stderr, with the one exit code
  for (const [label, argv] of [
    ['no arguments at all', []],
    ['an unknown tool id', ['--tool', 'tool-nope', '--event', 'pre-tool']],
    ['a row with no dialect', ['--tool', 'tool-none', '--event', 'pre-tool']],
    ['a row naming a dialect the registry does not list', ['--tool', 'tool-unlisted', '--event', 'pre-tool']],
    ['an unknown event', ['--tool', 'tool-a', '--event', 'post-tool']],
  ]) {
    const r = run(argv, call);
    eq(label + ' is a refusal with a reason', [r.exitCode, r.stdout, /^HOOK ENTRY REFUSED: /.test(r.stderr)], [2, '', true]);
  }
  eq('an unknown tool id names the ids the registry does have', /tool-a, tool-none/.test(run(['--tool', 'tool-nope', '--event', 'stop'], call).stderr), true);
  eq('an unreadable registry is a refusal', run(pre, call, {}, { readRegistry: () => { throw new Error('cannot read it'); } }).exitCode, 2);
  eq('a dialect module that will not load is a refusal', run(pre, call, {}, { loadDialect: () => { throw new Error('boom'); } }).exitCode, 2);
  eq('a dialect module with no emit() is a refusal', run(pre, call, {}, { loadDialect: () => ({ parse() {} }) }).exitCode, 2);
  // A name the registry LISTS and that is not a module name: listing it does not make it loadable.
  const loaded = [];
  const unsafe = run(['--tool', 't', '--event', 'pre-tool'], call, {}, {
    readRegistry: () => ({ dialects: ['../x'], tools: [{ id: 't', dialect: '../x' }] }),
    loadDialect: (n) => { loaded.push(n); return wire; },
  });
  eq('a listed dialect name that is a path is a refusal, and nothing is loaded for it', [unsafe.exitCode, loaded], [2, []]);

  // the gate: order, first deny, ask, throw
  seen.length = 0;
  eq('no handler at all allows, silently', run(pre, call, { 'pre-tool': [] }), { stdout: '', stderr: '', exitCode: 0 });
  eq('every handler allowing allows', run(pre, call, { 'pre-tool': [h('a', allow), h('b', allow)] }).exitCode, 0);
  eq('...and they ran in list order, each on the state its own gather() returned', seen, ['a:a', 'b:b']);
  seen.length = 0;
  const denied = run(pre, call, { 'pre-tool': [h('a', allow), h('b', { deny: true, reason: 'no: b' }), h('c', allow)] });
  eq('a deny is the dialect\'s JSON AND exit code 2', [denied.stdout, denied.stderr, denied.exitCode], ['DENY', 'no: b', 2]);
  eq('...and the first deny ends the run', seen, ['a:a', 'b:b']);
  eq('an ask is carried through', run(pre, call, { 'pre-tool': [h('a', { deny: false, ask: true, reason: 'sure?' })] }).stdout, 'ASK');
  const askThenAllow = run(pre, call, { 'pre-tool': [h('a', { deny: false, ask: true, reason: 'first' }), h('b', allow)] });
  eq('an allow after an ask does not erase the ask', [askThenAllow.stdout, askThenAllow.stderr, askThenAllow.exitCode], ['ASK', 'first', 0]);
  eq('of two asks the FIRST stands', run(pre, call, { 'pre-tool': [h('a', { deny: false, ask: true, reason: 'first' }), h('b', { deny: false, ask: true, reason: 'second' })] }).stderr, 'first');
  emitted.length = 0;
  run(pre, call, { 'pre-tool': [h('a', allow)] });
  eq('emit() is handed the registry row the call is for', emitted, ['tool-a']);
  eq('a deny after an ask is still a deny', run(pre, call, { 'pre-tool': [h('a', { deny: false, ask: true, reason: '?' }), h('b', { deny: true, reason: 'no' })] }).exitCode, 2);
  const threw = run(pre, call, { 'pre-tool': [h('a', new Error('kaboom\nsecond line')), h('b', allow)] });
  eq('a handler that throws is a deny', [threw.stdout, threw.exitCode], ['DENY', 2]);
  eq('...that names the handler and the first line of why', [/`a` handler/.test(threw.stderr), /kaboom/.test(threw.stderr), /second line/.test(threw.stderr)], [true, true, false]);
  eq('a handler that returns no verdict is a deny', run(pre, call, { 'pre-tool': [h('a', undefined)] }).exitCode, 2);
  eq('...and so is one that returns a bare true', run(pre, call, { 'pre-tool': [h('a', true)] }).exitCode, 2);
  eq('a gather() that throws is a deny too',
    run(pre, call, { 'pre-tool': [{ name: 'g', gather: () => { throw new Error('disk'); }, decide: () => allow }] }).exitCode, 2);

  // which handler is offered which call
  const deny = { deny: true, reason: 'no' };
  const read = JSON.stringify({ kind: 'pre-tool', action: 'read' });
  eq('a handler is not offered an action it does not list', run(pre, read, { 'pre-tool': [h('shell-only', deny, ['shell'])] }).exitCode, 0);
  eq('...is offered one it does', run(pre, call, { 'pre-tool': [h('shell-only', deny, ['shell'])] }).exitCode, 2);
  eq('...a handler with no list is offered every call', run(pre, read, { 'pre-tool': [h('all', deny)] }).exitCode, 2);
  eq('...and an OPAQUE call is offered to every handler whatever its action',
    run(pre, JSON.stringify({ kind: 'pre-tool', action: 'read', opaque: true }), { 'pre-tool': [h('shell-only', deny, ['shell'])] }).exitCode, 2);

  // a payload nothing could read
  const junk = run(pre, '}{ SECRETISH', { 'pre-tool': [h('a', allow)] });
  eq('an unparseable pre-tool payload is a deny', [junk.stdout, junk.exitCode], ['DENY', 2]);
  eq('...whose reason never quotes the payload', junk.stderr.includes('SECRETISH'), false);
  eq('an empty pre-tool payload is a deny, not no call at all', run(pre, '', {}).exitCode, 2);
  eq('an unparseable prompt-submit payload is a deny', run(['--tool', 'tool-a', '--event', 'prompt-submit'], 'junk', {}).exitCode, 2);
  const stopJunk = run(['--tool', 'tool-a', '--event', 'stop'], 'junk', { stop: [h('s', deny)] });
  eq('an unparseable stop payload ends the turn and says so', [stopJunk.exitCode, stopJunk.stdout, /could not be read/.test(stopJunk.stderr)], [0, '', true]);
  const stop = ['--tool', 'tool-a', '--event', 'stop'];
  const stopCall = JSON.stringify({ kind: 'stop' });
  eq('a readable stop payload gets its handler\'s deny', run(stop, stopCall, { stop: [h('s', deny)] }).exitCode, 2);
  // THE STOP RULE: a failure of the entry ends the turn; only a returned deny forces one.
  const stopThrew = run(stop, stopCall, { stop: [h('bad', new Error('kaboom')), h('s', allow)] });
  eq('a stop handler that throws ends the turn, and is named on stderr', [stopThrew.exitCode, stopThrew.stdout, /`bad` stop handler/.test(stopThrew.stderr)], [0, '', true]);
  const stopThrewThenDeny = run(stop, stopCall, { stop: [h('bad', new Error('kaboom')), h('s', deny)] });
  eq('...and the handler after it still runs, and its deny is honoured', [stopThrewThenDeny.exitCode, stopThrewThenDeny.stdout, /`bad` stop handler/.test(stopThrewThenDeny.stderr)], [2, 'DENY', true]);
  eq('runGate with nowhere to say it still skips a thrown stop handler', runGate([h('bad', new Error('x'))], { event: 'stop', action: 'other' }, {}), { deny: false, reason: '' });

  // the flag against the payload
  const start = ['--tool', 'tool-a', '--event', 'session-start'];
  const wrong = run(start, call, { 'session-start': [h('r', allow)], 'pre-tool': [h('g', allow)] });
  eq('a pre-tool payload handed to a session-start registration is a deny', [wrong.stdout, wrong.exitCode], ['DENY', 2]);
  eq('a payload that names no event takes the flag\'s', run(pre, JSON.stringify({ action: 'shell' }), { 'pre-tool': [h('a', deny)] }).exitCode, 2);
  // ...and the other directions. Every handler below would ALLOW: the refusal is the entry's.
  const everyone = { 'session-start': [h('r', allow)], 'pre-tool': [h('g', allow)], stop: [h('s', allow)], 'prompt-submit': [h('p', allow)] };
  const startCall = JSON.stringify({ kind: 'session-start', action: 'shell', command: 'x' });
  seen.length = 0;
  const stopGotCall = run(stop, call, everyone);
  eq('a pre-tool payload handed to a stop registration is a deny', [stopGotCall.stdout, stopGotCall.exitCode], ['DENY', 2]);
  const preGotStart = run(pre, startCall, everyone);
  eq('a session-start payload handed to a pre-tool registration is refused under the FLAG\'s event: exit 2', [preGotStart.stdout, preGotStart.exitCode], ['DENY', 2]);
  eq('...and to a prompt-submit registration', run(['--tool', 'tool-a', '--event', 'prompt-submit'], startCall, everyone).exitCode, 2);
  const preGotStop = run(pre, stopCall, everyone);
  eq('a stop payload handed to a pre-tool registration ends the turn, and says so',
    [preGotStop.exitCode, preGotStop.stdout, /registered with --event pre-tool and was handed a stop payload/.test(preGotStop.stderr)], [0, '', true]);
  const stopGotStart = run(stop, startCall, everyone);
  eq('a session-start payload handed to a stop registration is reported, exit 0', [stopGotStart.exitCode, /^CTX HOOK ENTRY: /.test(stopGotStart.stdout)], [0, true]);
  eq('...and no handler ran for any mismatch', seen, []);

  // the context the handlers read
  const noCtx = { context: () => { throw new Error('no config module'); } };
  const blindGate = run(pre, call, { 'pre-tool': [h('a', allow)] }, noCtx);
  eq('a context that cannot be set up is a deny at pre-tool', [blindGate.stdout, blindGate.exitCode, /could not be set up/.test(blindGate.stderr)], ['DENY', 2, true]);
  const blindStop = run(stop, stopCall, { stop: [h('s', deny)] }, noCtx);
  eq('...ends the turn at stop', [blindStop.exitCode, /could not be set up/.test(blindStop.stderr)], [0, true]);

  // session start: every reporter, joined, never a refusal
  seen.length = 0;
  const said = run(start, JSON.stringify({ kind: 'session-start' }), {
    'session-start': [h('one', { deny: false, reason: '', context: 'first', message: 'm1' }), h('quiet', allow), h('two', { deny: false, reason: '', context: 'second' })],
  });
  eq('session start joins every report in list order, with the reporters\' messages, exit 0', [said.stdout, said.exitCode], ['CTX first\n\nsecond MSG m1', 0]);
  eq('...and every reporter ran', seen, ['one:one', 'quiet:quiet', 'two:two']);
  eq('session start with nothing to say is silent', run(start, JSON.stringify({ kind: 'session-start' }), { 'session-start': [h('quiet', allow)] }), { stdout: '', stderr: '', exitCode: 0 });
  const broken = run(start, JSON.stringify({ kind: 'session-start' }), { 'session-start': [h('bad', new Error('nope')), h('two', { deny: false, reason: '', context: 'second' })] });
  eq('a reporter that throws is reported, the others still run, and the session starts',
    [broken.exitCode, /`bad` reporter/.test(broken.stdout), /second MSG /.test(broken.stdout)], [0, true, true]);
  eq('...and the person at the keyboard gets a WARNING line naming it', / MSG WARNING: the bad session-start report did not run\.$/.test(broken.stdout), true);
  const twoMsgs = run(start, JSON.stringify({ kind: 'session-start' }), { 'session-start': [h('one', { deny: false, reason: '', context: 'a', message: 'm1' }), h('two', { deny: false, reason: '', context: 'b', message: 'm2' })] });
  eq('two reporters\' messages are joined in list order', twoMsgs.stdout, 'CTX a\n\nb MSG m1 m2');
  const blindStart = run(start, JSON.stringify({ kind: 'session-start' }), {
    'session-start': [{ name: 'needs-cfg', decide: () => allow, gather: (e, ctx) => ctx.cfg() }, h('two', { deny: false, reason: '', context: 'second' })],
  }, noCtx);
  eq('a context that cannot be set up is REPORTED at session start, which still starts',
    [blindStart.exitCode, /could not be set up/.test(blindStart.stdout), /`needs-cfg` reporter/.test(blindStart.stdout), /second MSG /.test(blindStart.stdout)], [0, true, true, true]);
  const blind = run(start, 'junk', { 'session-start': [h('two', { deny: false, reason: '', context: 'second' })] });
  eq('an unreadable session-start payload is reported and the reports still run',
    [blind.exitCode, /could not be read/.test(blind.stdout), /second$/.test(blind.stdout)], [0, true, true]);
  eq('a reporter\'s deny cannot stop a session: its reason is reported', run(start, JSON.stringify({ kind: 'session-start' }), { 'session-start': [h('d', { deny: true, reason: 'why' })] }), { stdout: 'CTX why', stderr: '', exitCode: 0 });

  // a dialect that cannot spell
  const mute = { parse: wire.parse, emit() { throw new Error('no words'); } };
  eq('a deny the dialect cannot spell is still a refusal', run(pre, call, { 'pre-tool': [h('a', deny)] }, { loadDialect: () => mute }).exitCode, 2);
  eq('...and an allow it cannot spell is still an allow', run(pre, call, { 'pre-tool': [h('a', allow)] }, { loadDialect: () => mute }).exitCode, 0);
  const anAsk = { deny: false, ask: true, reason: 'sure?' };
  eq('an ASK it cannot spell is a refusal too', run(pre, call, { 'pre-tool': [h('a', anAsk)] }, { loadDialect: () => mute }).exitCode, 2);
  eq('a session-start report it cannot spell still starts the session',
    run(start, JSON.stringify({ kind: 'session-start' }), { 'session-start': [h('r', { deny: true, reason: 'a report' })] }, { loadDialect: () => mute }), { stdout: '', stderr: '', exitCode: 0 });

  // THE EXIT CODE IS THE ENTRY'S. A dialect that answers a refusal with nothing, or with no
  // exit code, or with the wrong one, does not get to turn it into a pass.
  const says = (ret) => ({ loadDialect: () => ({ parse: wire.parse, emit: () => ret }) });
  for (const [label, ret] of [
    ['returns nothing', undefined],
    ['returns null', null],
    ['returns a bare string', 'DENY'],
    ['returns no exit code', { stdout: 'DENY' }],
    ['returns the exit code as a string', { stdout: 'DENY', exitCode: '2' }],
    ['returns exit 0', { stdout: 'DENY', exitCode: 0 }],
    ['returns a fail-open exit 1', { stdout: 'DENY', exitCode: 1 }],
  ]) {
    eq('a deny through a dialect whose emit() ' + label + ' is exit 2', run(pre, call, { 'pre-tool': [h('a', deny)] }, says(ret)).exitCode, 2);
  }
  const bareDeny = run(pre, call, { 'pre-tool': [h('a', deny)] }, says({ stdout: 'DENY' }));
  eq('...what it did spell is kept, and the reason goes to stderr if it left that empty', [bareDeny.stdout, bareDeny.stderr], ['DENY', 'no']);
  eq('an ask through a dialect whose emit() returns nothing is a refusal', run(pre, call, { 'pre-tool': [h('a', anAsk)] }, says(undefined)).exitCode, 2);
  eq('an ask spelled as exit 0 and silence is a refusal: nobody would be asked', run(pre, call, { 'pre-tool': [h('a', anAsk)] }, says({ stdout: '', exitCode: 0 })).exitCode, 2);
  eq('an ask with no exit code is a refusal', run(pre, call, { 'pre-tool': [h('a', anAsk)] }, says({ stdout: 'ASK' })).exitCode, 2);
  eq('an ask spelled with a fail-open exit 1 leaves as 2', run(pre, call, { 'pre-tool': [h('a', anAsk)] }, says({ stdout: 'NO', exitCode: 1 })).exitCode, 2);
  eq('an ask spelled as an ask is exit 0', run(pre, call, { 'pre-tool': [h('a', anAsk)] }, says({ stdout: 'ASK', exitCode: 0 })), { stdout: 'ASK', stderr: '', exitCode: 0 });
  eq('an allow through a dialect whose emit() returns nothing is still an allow', run(pre, call, { 'pre-tool': [h('a', allow)] }, says(undefined)), { stdout: '', stderr: '', exitCode: 0 });
  eq('a session-start report through one is still exit 0', run(start, JSON.stringify({ kind: 'session-start' }), { 'session-start': [h('r', { deny: true, reason: 'x' })] }, says({ stdout: 'x', exitCode: 2 })).exitCode, 0);

  // the deny layer goes with the row whose hook config IS the dialect's permissions file
  const perms = { file: '.tool-a/hooks.json', read: (t) => JSON.parse(t).deny };
  const ctxOf = (row, text) => ({ row, dialect: { permissions: perms }, readText: () => { if (text === null) throw new Error('gone'); return text; } });
  eq('deny layer: read out of the file the dialect names', denyLayerOf(ctxOf(REG.tools[0], '{"deny":["a"]}')), { denyList: ['a'] });
  eq('deny layer: an unreadable file is no list, never no layer', Object.keys(denyLayerOf(ctxOf(REG.tools[0], null))), ['denyList']);
  eq('deny layer: a row that keeps its hooks elsewhere has none the harness can read', denyLayerOf(ctxOf({ hookConfig: '.other/hooks.json' }, '{}')), { denyLayer: false });
  eq('deny layer: a dialect that names no permissions file has none', denyLayerOf({ row: REG.tools[0], dialect: {} }), { denyLayer: false });

  /* THE WORKSPACE EVENT: a path on stdout, alone, and only for a row that establishes it. */
  const wt = ['--tool', 'tool-w', '--event', 'worktree-create'];
  const REGW = { dialects: ['wire-a'], tools: REG.tools.concat({ id: 'tool-w', dialect: 'wire-a', hookConfig: '.tool-w/hooks.json', worktreeCreate: true }) };
  const got = [];
  const ws = (answer) => ({ readRegistry: () => REGW, workspace: (stdin, row) => { got.push([stdin, row.id]); if (answer instanceof Error) throw answer; return answer; } });
  eq('args: worktree-create is an event the entry takes', parseArgs(wt).problems, []);
  eq('it is not one of the four that run handlers', EVENTS.includes(WORKSPACE), false);
  const made = run(wt, '{"name":"fix-a"}', { 'pre-tool': [h('g', { deny: true, reason: 'no' })] }, ws({ stdout: '/r/fix-a\n', stderr: 'CREATED\n', exitCode: 0 }));
  eq('the path is stdout, whole and alone; the rest is stderr', made, { stdout: '/r/fix-a\n', stderr: 'CREATED\n', exitCode: 0 });
  eq('...the payload reached the workspace script unparsed, with the row', got, [['{"name":"fix-a"}', 'tool-w']]);
  const refusedWs = run(wt, '{}', {}, ws({ stdout: '/half/a/path', stderr: 'WORKSPACE REFUSED: why\n', exitCode: 1 }));
  eq('a refusal is exit 2 with NOTHING on stdout, whatever the script printed', refusedWs, { stdout: '', stderr: 'WORKSPACE REFUSED: why\n', exitCode: 2 });
  const wsThrew = run(wt, '{}', {}, ws(new Error('boom')));
  eq('a script that throws is a refusal', [wsThrew.stdout, wsThrew.exitCode, /could not be created \(boom\)/.test(wsThrew.stderr)], ['', 2, true]);
  eq('...and so is one that returns nothing', run(wt, '{}', {}, ws(null)).exitCode, 2);
  const noCell = run(['--tool', 'tool-a', '--event', 'worktree-create'], '{"name":"x"}', {}, ws({ stdout: '/r/x\n', stderr: '', exitCode: 0 }));
  eq('a row that does not establish the event gets a refusal, and the script is not called', [noCell.stdout, noCell.exitCode, /worktreeCreate/.test(noCell.stderr), got.length], ['', 2, true, 4]);
  eq('an unknown tool id is refused for this event too', run(['--tool', 'tool-nope', '--event', 'worktree-create'], '{}', {}, ws(null)).exitCode, 2);

  /* THE REAL TABLE. Order is the property: it is the order the guards were registered in. */
  eq('the table has one list per event and no other key', Object.keys(HANDLERS).sort(), EVENTS.slice().sort());
  eq('pre-tool handlers, in order', HANDLERS['pre-tool'].map((x) => x.name), ['env-guard', 'commit-hygiene', 'phase-guard']);
  eq('...and what each is offered', HANDLERS['pre-tool'].map((x) => x.actions.join('+')), ['shell+read+search+write', 'shell', 'shell+write']);
  eq('session-start reporters, in order', HANDLERS['session-start'].map((x) => x.name), ['skill-verify', 'env-guard', 'docs-lint', 'branch-sync', 'worktree']);
  eq('prompt-submit and stop are lists, ready for a handler', [Array.isArray(HANDLERS['prompt-submit']), Array.isArray(HANDLERS.stop)], [true, true]);
  eq('every handler is { name, decide } with gather a function where present',
    EVENTS.every((e) => HANDLERS[e].every((x) => typeof x.name === 'string' && typeof x.decide === 'function' && (x.gather === undefined || typeof x.gather === 'function'))), true);

  /* THE REAL GUARDS, through the real table, on literals: no payload, no wire format. */
  const guarded = '.' + 'env'; // assembled, never spelled: this file is read by the guard it tests
  const live = { cfg: () => null, today: '2026-01-01' };
  const gate = (event) => runGate(HANDLERS['pre-tool'], Object.assign({ event: 'pre-tool', command: null, path: null, content: null, old: null, tool: '', input: {}, opaque: false }, event), live);
  eq('a read naming a guarded file is denied by the real list', gate({ action: 'read', input: { file_path: guarded } }).deny, true);
  eq('a read naming nothing guarded is allowed, and no other guard is asked', gate({ action: 'read', input: { file_path: 'README.md' } }), { deny: false, reason: '' });
  eq('a shell call that is not a git write and moves nothing is allowed', gate({ action: 'shell', command: 'npm test', input: { command: 'npm test' } }), { deny: false, reason: '' });
  const blindCall = gate({ action: 'other', opaque: true, tool: 'srv.q', input: { query: 'select 1' } });
  eq('an opaque call nothing can read is an ask, not an allow', [blindCall.deny, blindCall.ask], [false, true]);

  /* THE REAL REGISTRY: every dialect it lists loads, and every row that names one resolves. */
  let reg = null;
  try { reg = liveRegistry(); } catch (e) { f.push('the registry could not be read: ' + oneLine(e)); }
  if (reg) {
    for (const name of reg.dialects) {
      let d = null;
      try { d = liveDialect(name); } catch { d = null; }
      eq('dialect `' + name + '` loads and exports parse() and emit()', [!!d && typeof d.parse, !!d && typeof d.emit], ['function', 'function']);
    }
    for (const row of reg.tools) {
      let got;
      try { dialectFor(reg, row.id, liveDialect); got = 'resolved'; } catch { got = 'refused'; }
      eq('registry row `' + row.id + '` ' + (row.dialect ? 'resolves to its dialect' : 'has no dialect and is refused'), got, row.dialect ? 'resolved' : 'refused');
    }
  }

  for (const x of f) console.log('  x ' + x);
  console.log(f.length ? 'FAIL — hook.js self-test: ' + f.length + ' assertion(s)' : 'PASS — hook.js self-test (' + CHECKS + ' checks)');
  return f.length ? 1 : 0;
}

/* ── main ───────────────────────────────────────────────────────────────────── */

function readStdin(done) {
  let data = '';
  let settled = false;
  const finish = () => { if (!settled) { settled = true; done(data); } };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { data += c; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  // Never hang a tool call waiting on stdin that is not coming. What arrived is then parsed,
  // and a payload cut short does not parse, which is a refusal and not a pass.
  setTimeout(() => { try { process.stdin.destroy(); } catch { /* already gone */ } finish(); }, 2000).unref();
}

/**
 * A handler that ENDS THE PROCESS has not decided anything, and `process.exit(0)` inside a
 * guard would otherwise read as an allow. So for an event that can refuse, any exit this file
 * did not make itself leaves with code 2. Returns the function that says "this exit is mine".
 * Not armed at session-start (nothing can be refused) nor at `stop` (the turn ends: the header).
 */
function guardExit(kind) {
  if (kind === REPORT_ONLY || kind === 'stop') return () => {};
  let mine = false;
  process.on('exit', () => {
    if (mine) return;
    process.exitCode = 2;
    try { fs.writeSync(2, 'HOOK ENTRY REFUSED: the process ended before the handlers reached a verdict. A guard that did not decide has not found the call clean.\n'); } catch { /* nowhere to say it */ }
  });
  return () => { mine = true; };
}

function main() {
  const argv = process.argv.slice(2);
  // Each of these is honoured ONLY as the whole command line. Found anywhere in a registration
  // they would answer with exit 0 and never read the payload, which passes every call; and so
  // would no arguments at all, which is therefore the refusal execute() gives it.
  if (argv.length === 1 && argv[0] === '--self-test') return process.exit(selfTest());
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('hook.js — the one hook entry\n\n'
      + '  --tool <id> --event <' + EVENTS.join('|') + '>   read the tool\'s payload on stdin, run that event\'s handlers\n'
      + '  --self-test                                                  drive every decision this file makes\n');
    return process.exit(0);
  }
  const mine = guardExit(parseArgs(argv).event);
  return readStdin((stdin) => {
    let out;
    try {
      out = execute({ argv, stdin, readRegistry: liveRegistry, loadDialect: liveDialect, handlers: HANDLERS, context: liveContext, workspace: liveWorkspace });
    } catch (e) {
      out = refuse('the hook entry itself failed (' + oneLine(e) + ').');
    }
    // Written before the exit, in callbacks: a pipe may still be holding the bytes otherwise.
    process.stderr.write(out.stderr, () => process.stdout.write(out.stdout, () => { mine(); process.exit(out.exitCode); }));
  });
}

module.exports = { execute, parseArgs, runGate, runReport, dialectFor, denyLayerOf, HANDLERS, EVENTS, WORKSPACE };

if (require.main === module) main();
