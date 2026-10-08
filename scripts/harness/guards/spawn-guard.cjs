#!/usr/bin/env node
/**
 * Spawn guard: a pre-tool handler, run by scripts/harness/hook.js for a call that spawns a
 * subagent.
 *
 * WHY THIS EXISTS
 * The routing reference calls four fields mandatory on every spawn: OUTCOME, READ-SET, RETURN
 * and BOUNDS. Until this file nothing read a spawn prompt, so the contract was prose, and a
 * spawn with no READ-SET reads the whole tree and returns a file dump.
 *
 * WHAT IT REFUSES
 * A spawn of a REGISTERED agent (one a file in the tool's agent directory defines) whose
 * prompt does not carry all four field names, each followed by a colon. Nothing else:
 *   - an agent type the harness did not define passes untouched: the tool's built-ins, a
 *     plugin's agents, a fork. The contract is this harness's, and so are these agents.
 *   - THE CONTENT OF A FIELD IS NEVER JUDGED. `BOUNDS: none` passes. Whether a READ-SET is the
 *     right one is the lead's judgement and a reviewer's; a guard that graded prose would
 *     refuse ordinary work and be switched off.
 *   - a field name counts in any case and wherever it stands in the prompt.
 *
 * WHAT IT DOES NOT STOP, on purpose: a prompt that spells the four names and says nothing
 * under them. A guard stops the accident (the contract forgotten), not intent.
 *
 * WHICH CALL IS A SPAWN is the dialect's to say: it maps the tool's own name to the neutral
 * action `spawn` and hands over `event.spawn = { agent, prompt }`. Measured for one tool: the
 * guard-hardening track's research file on the spawn payload.
 *
 *   node scripts/harness/guards/spawn-guard.cjs --self-test
 *
 * Zero dependencies, Node built-ins only.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The four fields of the spawn contract, in the order the routing reference gives them. */
const FIELDS = ['OUTCOME', 'READ-SET', 'RETURN', 'BOUNDS'];
const ALLOW = Object.freeze({ deny: false, reason: '' });

/** Which of the four field names a prompt lacks. A name is the word, then a colon. */
function missingFields(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  return FIELDS.filter((f) => !new RegExp('(^|[^A-Za-z0-9_-])' + f + '[ \\t]*:', 'i').test(text));
}

/** The `name:` of an agent file's frontmatter, or null. */
function nameIn(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  for (const l of lines.slice(1)) {
    if (l === '---') break;
    const m = /^name\s*:\s*(.+?)\s*$/.exec(l);
    if (m) return m[1].replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

/**
 * THE DISK HALF: the names of the agents the harness's agent directory defines, each by its
 * file name and by the `name:` its frontmatter gives. No directory, or none the dialect names,
 * is no registered agent, and then every spawn passes: there is nothing here to hold it to.
 */
function gather(root, dir) {
  if (typeof dir !== 'string' || !dir) return { registered: [] };
  const abs = path.join(root, ...dir.split('/'));
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return { registered: [] }; }
  const names = new Set();
  for (const e of entries) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    names.add(e.name.replace(/\.md$/i, ''));
    let declared = null;
    try { declared = nameIn(fs.readFileSync(path.join(abs, e.name), 'utf8')); } catch { declared = null; }
    if (declared) names.add(declared);
  }
  return { registered: [...names].sort(), dir: dir };
}

/** THE PURE HALF: the neutral verdict for one event, given what gather() found. */
function decide(event, state) {
  const s = event && event.spawn;
  if (!s || typeof s.agent !== 'string') return ALLOW;
  const registered = (state && Array.isArray(state.registered)) ? state.registered : [];
  if (!registered.includes(s.agent)) return ALLOW;
  const missing = missingFields(s.prompt);
  if (!missing.length) return ALLOW;
  return {
    deny: true,
    reason: 'S1 SPAWN WITHOUT THE CONTRACT: the prompt for the registered agent `' + s.agent + '` lacks ' + missing.join(', ') + '.\n'
      + 'Every spawn of an agent this repo defines carries four fields, each as a name and a colon:\n'
      + '  OUTCOME:  one sentence; what done looks like\n'
      + '  READ-SET: the exact files this agent may read\n'
      + '  RETURN:   the shape of the answer\n'
      + '  BOUNDS:   what it must NOT do\n'
      + 'Add what is missing and spawn again. What each field says is yours to decide; nothing here reads it.',
    message: 'Spawn guard: the prompt for `' + s.agent + '` lacks ' + missing.join(', ') + '.',
  };
}

/* ---------- --self-test ---------- */
function selfTest() {
  let n = 0;
  const fails = [];
  const must = (what, got, want) => {
    n++;
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  };
  const FULL = 'OUTCOME: the list of callers.\nREAD-SET: None, everything is below.\nRETURN: one line per caller.\nBOUNDS: read only.\n';
  const reg = { registered: ['explore', 'review'] };
  const spawn = (agent, prompt) => ({ event: 'pre-tool', action: 'spawn', spawn: { agent: agent, prompt: prompt } });

  // the field names
  must('a prompt with all four lacks none', missingFields(FULL), []);
  must('an empty prompt lacks all four, in the contract\'s order', missingFields(''), FIELDS);
  must('a prompt that is not text lacks all four', missingFields(undefined), FIELDS);
  must('one missing field is named', missingFields(FULL.replace('BOUNDS:', 'Limits:')), ['BOUNDS']);
  must('a field name counts in any case', missingFields(FULL.toLowerCase()), []);
  must('...and after a list dash or inside bold', missingFields('- OUTCOME: a\n- READ-SET: b\n**RETURN:** c\n> BOUNDS : d'), []);
  must('a name with no colon is not the field', missingFields('the OUTCOME is good, READ-SET too, RETURN and BOUNDS as well'), FIELDS);
  must('a longer word that ends in a field name is not the field', missingFields(FULL.replace('RETURN:', 'NORETURN:')), ['RETURN']);
  must('THE CONTENT IS NOT JUDGED: four names with nothing under them lack none', missingFields('OUTCOME:\nREAD-SET:\nRETURN:\nBOUNDS: none'), []);

  // the decision
  must('with no agent known to be registered, nothing is refused', decide(spawn('review', 'look at the diff')).deny, false);
  const refused = decide(spawn('review', 'look at the diff'), reg);
  must('THE REFUSAL: a registered agent, a prompt with no contract', refused.deny, true);
  must('...whose reason names the agent, every missing field and the four lines to add',
    [/`review`/.test(refused.reason), /lacks OUTCOME, READ-SET, RETURN, BOUNDS\./.test(refused.reason), /READ-SET: the exact files/.test(refused.reason)], [true, true, true]);
  must('...and one line for the person', refused.message, 'Spawn guard: the prompt for `review` lacks OUTCOME, READ-SET, RETURN, BOUNDS.');
  must('a partial contract is refused, naming only what is missing', /lacks RETURN\.\n/.test(decide(spawn('explore', FULL.replace('RETURN:', '')), reg).reason), true);
  must('THE ORDINARY CALL: a registered agent with the whole contract passes', decide(spawn('review', FULL), reg), ALLOW);
  must('an agent the harness did not define passes with no contract at all', decide(spawn('general-purpose', 'do the thing'), reg), ALLOW);
  must('...so does a plugin agent', decide(spawn('some-plugin:review', 'do the thing'), reg), ALLOW);
  must('...and a spawn that names no agent', decide(spawn(null, 'do the thing'), reg), ALLOW);
  must('a name is matched whole and in its own case', [decide(spawn('Review', 'x'), reg).deny, decide(spawn('review-all', 'x'), reg).deny], [false, false]);
  must('a call that is not a spawn is not this guard\'s', decide({ event: 'pre-tool', action: 'shell', command: 'npm test' }, reg), ALLOW);
  must('no event at all is an allow, not a throw', decide(undefined, reg), ALLOW);
  must('a registered agent whose prompt is not text is refused', decide(spawn('review', ['OUTCOME:']), reg).deny, true);

  // the agent directory, on a throwaway tree
  must('frontmatter name: read', nameIn('---\nname: review\nmodel: inherit\n---\nbody\n'), 'review');
  must('frontmatter name: quoted, CRLF', nameIn('---\r\nname: "the-one"\r\n---\r\n'), 'the-one');
  must('frontmatter name: a name in the BODY is not one', nameIn('---\nmodel: x\n---\nname: body\n'), null);
  must('frontmatter name: no frontmatter', nameIn('# an agent\n'), null);
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-spawn-guard-self-test-'));
  try {
    fs.mkdirSync(path.join(dir, '.tool', 'agents', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.tool', 'agents', 'review.md'), '---\nname: review\n---\n');
    fs.writeFileSync(path.join(dir, '.tool', 'agents', 'file-name.md'), '---\nname: declared-name\n---\n');
    fs.writeFileSync(path.join(dir, '.tool', 'agents', 'notes.txt'), 'not an agent\n');
    fs.writeFileSync(path.join(dir, '.tool', 'agents', 'nested', 'deep.md'), '---\nname: deep\n---\n');
    must('gather: every agent file, by its file name and by the name it declares', gather(dir, '.tool/agents').registered, ['declared-name', 'file-name', 'review']);
    must('gather: no such directory is no registered agent', gather(dir, '.tool/none').registered, []);
    must('gather: a dialect that names no directory is no registered agent', gather(dir, undefined).registered, []);
    must('the two halves together: refuse', decide(spawn('declared-name', 'go'), gather(dir, '.tool/agents')).deny, true);
    must('the two halves together: allow', decide(spawn('deep', 'go'), gather(dir, '.tool/agents')), ALLOW);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length
    ? 'FAIL — spawn-guard.cjs self-test: ' + fails.length + ' of ' + n + ' assertion(s)'
    : 'PASS — spawn-guard.cjs self-test (' + n + ' checks: field names, the decision, the agent directory)');
  return fails.length ? 1 : 0;
}

module.exports = { FIELDS, missingFields, nameIn, gather, decide };

if (require.main === module) {
  if (process.argv.slice(2).includes('--self-test')) process.exit(selfTest());
  process.stdout.write('spawn-guard.cjs: a pre-tool handler of scripts/harness/hook.js. Run it with --self-test.\n');
  process.exit(0);
}
