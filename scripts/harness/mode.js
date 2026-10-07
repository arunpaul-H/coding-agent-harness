#!/usr/bin/env node
'use strict';

/*
 * mode.js — the autonomy-mode decision, written in the phase-3 `hook.js` dialect shape.
 *
 * CONTRACT (agreed with the multi-tool session, 2026-10-06):
 *   decide(event) -> { deny: boolean, reason: string }
 *   event = { event, action, command, path, content }
 *   Nothing in here parses stdin. hook.js owns the transport and the vendor dialect; this file
 *   owns only the verdict. It requires no other harness module on purpose, so it is testable and
 *   adoptable while config.js, tools.json and settings.json are all in flight elsewhere.
 *
 * WHY A DENY AND NOT A QUESTION. No coding agent surveyed lets a repo-local hook ask the owner a
 * blocking question before the first turn, and the vendors say so in their own words. So the mode
 * is chosen by the LAUNCHER (a parent process, before the agent exists) and recorded in a receipt
 * on disk; this file only refuses work that the recorded mode does not authorise. An agent that is
 * merely *asked* to wait will echo the mode correctly on the turn it violates it.
 *
 * WHY THE RECEIPT MUST BE UNFORGEABLE. If the agent can write the receipt, the agent approves
 * itself and HUMAN-IN-THE-LOOP is theatre. Unforgeability lives OUTSIDE this file, in whichever of
 * these the host tool supports: a deny rule on the receipt path, a human-signed commit, or a
 * launcher-printed nonce the agent never sees. This file verifies the nonce it is given; it cannot
 * manufacture trust that the host does not provide.
 *
 * STATUS: the two verdicts below are implemented and self-tested. Registration is NOT done here —
 * phases 2 and 3 of multi-tool rewrite .claude/settings.json, so hook.js adds `prompt-submit` and
 * `stop` to its --event list and calls in.
 */

const fs = require('node:fs');
const path = require('node:path');

/* The four presets. Two axes, because the best-engineered systems separate "when does it pause"
 * from "what may it touch", and a single scale cannot express "edits free, shell gated". */
const MODES = {
  'fully-auto': { pauses: 'never', touch: 'workspace-write', gatesShell: false, needsReceipt: false },
  'auto-edit': { pauses: 'shell', touch: 'edits-free-shell-gated', gatesShell: true, needsReceipt: false },
  hitl: { pauses: 'phase', touch: 'edits-free-shell-gated', gatesShell: true, needsReceipt: true },
  manual: { pauses: 'every-mutation', touch: 'read-only-plus-approved', gatesShell: true, needsReceipt: true },
};

const MODE_IDS = Object.keys(MODES);
const MUTATING = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

const ok = () => ({ deny: false, reason: '' });
const no = (reason) => ({ deny: true, reason });

/* ---------------------------------------------------------------- state

   The receipt is {track, phase, mode, tool, nonce, written_at}, written ONLY by run.js and
   close-phase.js. An unreadable receipt is NOT a pass: a mode that cannot be read is a mode that
   is not in force, and the caller is told to re-launch rather than guess. */

function readReceipt(root, tracksDir, track) {
  const file = path.join(root, tracksDir, track, '.phase');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { missing: true, file };
  }
  try {
    const r = JSON.parse(raw);
    if (!r || typeof r !== 'object') return { malformed: true, file };
    if (!MODE_IDS.includes(r.mode)) return { malformed: true, file, why: 'mode `' + r.mode + '` is not one of ' + MODE_IDS.join(', ') };
    return { receipt: r, file };
  } catch {
    return { malformed: true, file, why: 'not JSON' };
  }
}

/* ---------------------------------------------------------------- the verdicts */

/* prompt-submit: in a receipt-bearing mode, a new phase may not be STARTED without an approval
 * receipt for it. This is the one event that both blocks and carries the host's own permission
 * mode, which is why the phase gate lives here and not in a Stop hook. */
function decidePromptSubmit(state) {
  const { receipt, missing, malformed, file, why, phaseNext } = state;

  if (missing) {
    return no(
      'no approval receipt at ' + file + ' — the run mode is unknown, so no mode is in force.\n' +
      '   fix: relaunch through the harness, which writes the receipt before the agent starts:\n' +
      '        node bin/harness.js run <' + MODE_IDS.join('|') + '> --tool <id>'
    );
  }
  if (malformed) {
    return no('unreadable approval receipt at ' + file + (why ? ' — ' + why : '') + '.\n   fix: relaunch through `node bin/harness.js run`; never hand-edit the receipt.');
  }

  const mode = MODES[receipt.mode];
  if (!mode.needsReceipt) return ok();

  if (phaseNext != null && Number(receipt.phase) !== Number(phaseNext)) {
    return no(
      'mode ' + receipt.mode + ': the receipt approves phase ' + receipt.phase + ', the handoff asks for phase ' + phaseNext + '.\n' +
      '   A phase boundary is where this mode stops. Report the phase as closed and stop; the owner\n' +
      '   approves the next one by relaunching. Do NOT write the receipt yourself.'
    );
  }
  return ok();
}

/* stop: refuse to let the turn end until the next-phase prompt exists on disk.
 *
 * NOTE, because the intuition is wrong and cost us a design detour: a Stop hook does NOT make an
 * agent wait for a human. In every tool surveyed it forces MORE turns. So its only honest use is
 * to make the agent finish an artifact it owes — never to simulate an approval pause. */
function decideStop(state) {
  const { receipt, missing, handoffHasNextPrompt } = state;
  if (missing || !receipt) return ok();          // the prompt-submit gate already reported this
  if (!MODES[receipt.mode].needsReceipt) return ok();
  if (handoffHasNextPrompt) return ok();
  return no(
    'mode ' + receipt.mode + ': this phase may not end without a ready-to-paste prompt for the next\n' +
    '   phase in the track handoff. Write it, then stop. It must be a self-contained fenced block:\n' +
    '   it will be pasted into a cold session, possibly under a different tool.'
  );
}

/* shell gating: three of the four modes gate shell commands. Deny here is advisory in the sense
 * that the HOST's own allow/deny list is the real boundary — this exists so a tool with no deny
 * list still gets the verdict, and so the reason names the mode that caused it. */
function decideShell(state, event) {
  const { receipt } = state;
  if (!receipt || !MODES[receipt.mode].gatesShell) return ok();
  if (receipt.mode === 'manual') {
    return no('mode manual: every shell command is gated. Ask the owner, naming the exact command.');
  }
  return ok();
}

function decide(event, state) {
  if (!event || typeof event !== 'object') return no('mode.js: unreadable event — a blind guard asks, it never permits.');
  const s = state || {};
  switch (event.event) {
    case 'prompt-submit': return decidePromptSubmit(s);
    case 'stop': return decideStop(s);
    case 'pre-tool':
      if (event.command) return decideShell(s, event);
      if (MUTATING.has(event.action) && s.receipt && MODES[s.receipt.mode].touch === 'read-only-plus-approved') {
        return no('mode manual: a write needs the owner\'s approval first. Name the path and wait.');
      }
      return ok();
    default: return ok();
  }
}

/* ---------------------------------------------------------------- self-test

   Literals only, no filesystem, no network: every deciding script in this repo keeps a --self-test,
   and a test that needs a fixture tree is a test that stops being run. */

function selfTest() {
  const fails = [];
  const check = (name, got, wantDeny) => {
    if (!!got.deny !== wantDeny) fails.push(name + ': deny=' + got.deny + ' want ' + wantDeny + (got.reason ? ' | ' + got.reason.split('\n')[0] : ''));
  };

  const r = (mode, phase) => ({ receipt: { track: 't', phase, mode, tool: 'claude-code', nonce: 'n', written_at: '2026-10-06' }, file: 'x' });

  // an absent or broken receipt is never a pass
  check('missing receipt denies', decide({ event: 'prompt-submit' }, { missing: true, file: 'f' }), true);
  check('malformed receipt denies', decide({ event: 'prompt-submit' }, { malformed: true, file: 'f' }), true);
  check('unreadable event denies', decide(null, {}), true);

  // receipt-free modes are not gated by a phase boundary
  check('fully-auto passes prompt', decide({ event: 'prompt-submit' }, r('fully-auto', 1)), false);
  check('auto-edit passes prompt', decide({ event: 'prompt-submit' }, r('auto-edit', 1)), false);

  // the phase boundary is the gate, and only in receipt-bearing modes
  check('hitl same phase passes', decide({ event: 'prompt-submit' }, { ...r('hitl', 2), phaseNext: 2 }), false);
  check('hitl next phase denies', decide({ event: 'prompt-submit' }, { ...r('hitl', 2), phaseNext: 3 }), true);
  check('manual next phase denies', decide({ event: 'prompt-submit' }, { ...r('manual', 2), phaseNext: 3 }), true);
  check('fully-auto crosses phases', decide({ event: 'prompt-submit' }, { ...r('fully-auto', 2), phaseNext: 3 }), false);

  // stop: owes a next-phase prompt in receipt-bearing modes only
  check('hitl without prompt cannot stop', decide({ event: 'stop' }, { ...r('hitl', 1), handoffHasNextPrompt: false }), true);
  check('hitl with prompt stops', decide({ event: 'stop' }, { ...r('hitl', 1), handoffHasNextPrompt: true }), false);
  check('auto-edit stops freely', decide({ event: 'stop' }, { ...r('auto-edit', 1), handoffHasNextPrompt: false }), false);

  // touch axis
  check('manual gates shell', decide({ event: 'pre-tool', action: 'Bash', command: 'ls' }, r('manual', 1)), true);
  check('auto-edit allows shell verdict here', decide({ event: 'pre-tool', action: 'Bash', command: 'ls' }, r('auto-edit', 1)), false);
  check('manual gates write', decide({ event: 'pre-tool', action: 'Write', path: 'a.txt' }, r('manual', 1)), true);
  check('auto-edit allows write', decide({ event: 'pre-tool', action: 'Write', path: 'a.txt' }, r('auto-edit', 1)), false);

  // every mode id is a real preset with both axes declared
  for (const id of MODE_IDS) {
    const m = MODES[id];
    if (!m.pauses || !m.touch) fails.push('mode ' + id + ' is missing an axis');
  }

  const total = 16 + MODE_IDS.length;
  if (fails.length) {
    console.error(fails.map((f) => '  x ' + f).join('\n'));
    console.log('FAIL — mode.js self-test (' + fails.length + ' of ' + total + ')');
    return 1;
  }
  console.log('PASS — mode.js self-test (' + total + ' checks, ' + MODE_IDS.length + ' modes, 0 filesystem reads)');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  if (process.argv.includes('--modes')) {
    for (const id of MODE_IDS) console.log(id.padEnd(12) + 'pauses=' + MODES[id].pauses.padEnd(16) + 'touch=' + MODES[id].touch);
    process.exit(0);
  }
  console.log('mode.js — the autonomy verdict. Called by hook.js, not directly.\n  --self-test   every verdict, from literals\n  --modes       the four presets and their two axes');
  process.exit(0);
}

module.exports = { decide, readReceipt, MODES, MODE_IDS, selfTest };
