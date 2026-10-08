'use strict';
/* ============================================================
   close-phase.js — closing a phase is a VERIFIED act, not an asserted one.

   WHY THIS EXISTS
   "Done" used to be a sentence somebody wrote: a `status:` flipped by hand, a
   receipt typed from memory, a track folder moved into the archive because the
   work felt finished. Every one of those is form over truth, and each one held up
   until the next cold session trusted it. This file replaces the sentence with a
   verdict. It owns no opinion of its own about whether the work is good — it runs
   the mechanisms that already answer that, and refuses while any of them says no.

   THE SIX PRECONDITIONS, every one an exit code somebody else already owns
   (this file RUNS them, it does not re-implement them):

     1. the gate verdict is at HEAD            gates.json's `commit` is `git rev-parse HEAD`
     2. it was recorded against a CLEAN tree   gates.js writes `dirty`; until a check read it,
                                               a phase could close on a run that was green over
                                               somebody's uncommitted work. ABSENT IS NOT CLEAN.
     3. it is GREEN against the baseline       through gates.js's own `violations()`, required
                                               from here, so the comparator cannot drift from
                                               the comparator that produced the verdict
     4. it is not STALE                        nothing under the gate-relevant trees is newer
                                               than the run. A gate you did not run is NOT RUN.
     5. the tree is hygiene-clean              the declared hygiene gate, re-run now
     6. the handoff is real                    handoff-lint passes AND the ▶ block has CHANGED
                                               since the last receipt

   Only then does it write the receipt into the track README's frontmatter, as FLAT
   scalar fields, because the frontmatter parsers in a doc contract read scalars:

       closed_phase · closed_at · gates_sha · block_sha · receipt

   THE RECEIPT IS EXPORTED, NOT COPIED. The doc linter recomputes it with
   `receiptFor` from this file. A second implementation of the same hash is how the
   two drift, and the day they drift the linter either rejects every honest receipt
   or accepts a forged one; neither failure announces itself. A tree-hash receipt
   was considered and rejected for a plainer reason: it would die the moment this
   script edited the file it was hashing.

   NOTHING HERE IS PROJECT-SPECIFIC. The track location, the trees watched for
   staleness and the hygiene command all come from harness.config.json.

   --phase N          the phase being closed (default: handoff.md's `phase_next` minus one)
   --allow-skip g=n   as gates.js. A skip already recorded in the COMMITTED baseline counts as
                      declared, because `gates.js --accept` refuses to record an undeclared one,
                      so the baseline is a decision somebody made rather than a default.
   --archive          the whole track is done: set `status: complete`, `git mv` the folder under
                      <docsRoot>/archive/, regenerate the doc index.
   --self-test        drive every pure decision with literals, including the cases that must
                      come out NO. Needs no config and reads no track.

   Zero dependencies (Node built-ins only).

   Run:  node scripts/harness/close-phase.js <track-id> [--phase N] [--allow-skip g=n] [--archive]
         node scripts/harness/close-phase.js --self-test
   ============================================================ */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { load, ROOT, resolve, fatal } = require('./config.js');

/* The harness's own state lives beside the script that writes it, and its path is
   NOT configurable. A verdict file a repo could re-point is a verdict with a second
   place to hide: the close would read one file while the gate run wrote another, and
   both would look right. gates.js resolves these two the same way, from __dirname. */
const GATES_JSON = path.join(__dirname, 'gates.json');
const BASELINE_JSON = path.join(__dirname, 'gates.baseline.json');
const HANDOFF_LINT = path.join(__dirname, 'handoff-lint.js');
const DOCS_INDEX = path.join(__dirname, 'docs-index.js');

/* The hygiene check is reached BY GATE NAME, not by script path. It is already a
   declared gate in every repo that runs one, so taking the command from the registry
   keeps one copy of it; a hard-coded helper path here would be a second place to
   change when a repo moves its helpers. A repo that declares no hygiene gate gets a
   refusal naming the row to add — not a pass, because a phase that closes against a
   tree nobody graded is the pass-by-absence the whole protocol exists to end. */
const HYGIENE_GATE_NAMES = ['hygiene', 'commit-hygiene'];

/* Directories that never hold a gate's INPUT: dependencies, build output, git's own
   store, and the harness's own verdict files. Excluding the verdict files is not
   tidiness — gates.json is written by the run whose freshness is being judged, so
   watching it would make every verdict stale against itself. */
const NOT_SOURCE = /(^|\/)(node_modules|dist|build|coverage|\.git)(\/|$)|(^|\/)gates(\.baseline)?\.json$|(^|\/)gates\.red\.[^/]*\.log$/;

/* ---------- argv ---------- */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const VALUE_FLAGS = ['--phase', '--allow-skip'];
function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
// Positional = not a flag, and not the value of one. Spelled out rather than
// inferred, so `--phase 4 my-track` and `my-track --phase 4` mean the same thing.
function positionals(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('-')) { if (VALUE_FLAGS.includes(list[i])) i++; continue; }
    out.push(list[i]);
  }
  return out;
}

/* ---------- pure decisions (every one is exercised by --self-test) ---------- */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** THE RECEIPT. Exported so the doc linter recomputes it with THIS function and
 *  never a second copy. The four inputs are joined with a separator that cannot
 *  occur in any of them, because concatenating them bare would make phase 45 of
 *  track `t` indistinguishable from phase 4 of a run whose gates hash began `5`. */
const receiptFor = (id, phase, gatesSha, blockSha) => sha256([id, phase, gatesSha, blockSha].join('|'));

/** The ▶ block, verbatim, from a handoff body. One block, replaced wholesale: that
 *  is the track invariant, and this is the mechanism that reads it. A heading DEEPER
 *  than the block's own stays inside it, so a block with sub-sections is one block. */
function blockOf(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,4})\s*▶/);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !new RegExp('^#{1,' + m[1].length + '}\\s').test(lines[j])) j++;
    return lines.slice(i, j).join('\n').trim();
  }
  return null;
}

/** Flat scalar frontmatter. Deliberately not a YAML parser: the doc contract is
 *  scalars only, and a parser that accepted nested structures here would accept
 *  frontmatter the rest of the harness cannot read. */
function parseFrontmatter(text) {
  if (!String(text).startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const fm = {};
  for (const line of text.slice(text.indexOf('\n') + 1, end + 1).split('\n')) {
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

/** Set flat frontmatter fields, replacing IN PLACE where the key already exists so
 *  field order stays stable across closes. A receipt that reshuffled the frontmatter
 *  would put a diff on every close that nobody can read. */
function setFrontmatter(text, fields) {
  const nl = String(text).indexOf('\n');
  const end = String(text).indexOf('\n---', 3);
  if (!String(text).startsWith('---') || end < 0) throw new Error('no frontmatter block to write the receipt into');
  const head = text.slice(nl + 1, end + 1).split('\n').filter((l) => l.length > 0);
  const rest = text.slice(end + 1);
  for (const [k, v] of Object.entries(fields)) {
    const i = head.findIndex((l) => new RegExp('^' + k + ':').test(l));
    if (i >= 0) head[i] = k + ': ' + v; else head.push(k + ': ' + v);
  }
  return '---\n' + head.join('\n') + '\n' + rest;
}

/** A skip recorded in the COMMITTED baseline is a declared skip: `gates.js --accept`
 *  refuses to record an undeclared one, so a baseline row is a human decision and not
 *  a default. The CLI can only ever widen what the baseline already declares. */
function allowedSkips(baseline, cli) {
  const out = {};
  for (const [name, row] of Object.entries((baseline && baseline.gates) || {})) {
    if (row && row.skipped > 0) out[name] = row.skipped;
  }
  for (const kv of String(cli || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [n, v] = kv.split('=');
    if (n) out[n] = Math.max(Number(v) || 0, out[n] || 0);
  }
  return out;
}

/** The exact command that re-records a usable verdict, including the --allow-skip
 *  the baseline already declares. Generated rather than written down, because a
 *  refusal that names a command with the wrong flags sends the reader round the loop
 *  a second time, and the flags are repo-specific while this file is not. */
function checkCommand(baseline) {
  const skips = Object.entries(allowedSkips(baseline, '')).map(([n, v]) => n + '=' + v);
  return 'node scripts/harness/gates.js --check' + (skips.length ? ' --allow-skip ' + skips.join(',') : '');
}

/** ABSENT IS NOT CLEAN — the subtle one, and the reason this is its own function.
 *  gates.js records whether the tree was clean when it graded it. A verdict written
 *  before that field existed, or one whose `git status` itself failed, does not ANSWER
 *  the question, and an unanswered gate question is NOT RUN — the same rule the
 *  staleness check applies. So only the boolean `false` closes a phase. The string
 *  `"false"` is something somebody typed, not a measurement, and a hand-edited verdict
 *  is exactly the assertion this script exists to refuse.
 *  The two refusals read differently on purpose: one blames the tree, the other blames
 *  the verdict, and sending a reader to stash work they have not got wastes the trip. */
function dirtyViolations(gates, fixCmd) {
  const fix = fixCmd || 'node scripts/harness/gates.js --check';
  const d = gates ? gates.dirty : undefined;
  if (d === false) return [];
  if (d === true) {
    return ['the gate verdict was recorded against a DIRTY tree — it is about uncommitted work, '
      + 'not about this commit. Commit or stash, then re-run: ' + fix];
  }
  return ['the gate verdict does not record whether the tree was clean (dirty: '
    + JSON.stringify(d === undefined ? null : d) + ') — an unanswered question is NOT RUN. '
    + 'Re-run a verdict that answers it: ' + fix];
}

/** The trees a gate actually READS, derived from the config and never listed here.
 *  `commitHygiene.workDirs` is already the repo's own statement of where working files
 *  live, so it is the right set by construction. docsRoot and tracksDir join it because
 *  a doc linter registered as a gate makes a paragraph move a gate figure — a rationale
 *  that reads as pedantic until the close itself writes a receipt into a doc, i.e. edits
 *  an input to a gate it had stopped watching. Nested entries are dropped so a tree is
 *  not walked twice. */
function sourceTrees(cfg) {
  const raw = []
    .concat((cfg.commitHygiene && cfg.commitHygiene.workDirs) || [])
    .concat([cfg.project && cfg.project.docsRoot, cfg.project && cfg.project.tracksDir])
    .filter(Boolean)
    .map((p) => String(p).split(/[\\/]/).filter(Boolean).join('/'));
  const uniq = [...new Set(raw)].sort();
  return uniq.filter((p) => !uniq.some((q) => q !== p && p.startsWith(q + '/')));
}

/** The root files a gate reads that sit under no tree at all. Watching the trees and
 *  not these would be half a fix: the always-on context files are linted by the doc
 *  gate and live at the root, and the CONFIG FILE *is* the suite — edit it and the
 *  recorded verdict describes a different set of gates while still matching HEAD. */
function sourceFiles(cfg, configFile) {
  const caps = (cfg.docs && cfg.docs.caps) || {};
  const docs = Object.keys(caps).filter((k) => /\.md$/i.test(k));
  const cfgName = configFile ? path.basename(configFile) : 'harness.config.json';
  return [...new Set(docs.concat([cfgName]))].sort();
}

/* ---------- impure helpers ---------- */

/* AN AMBIENT VARIABLE THAT CHANGES WHAT A CHILD PRINTS. `node --test` exports
   NODE_TEST_CONTEXT into every process it spawns, and a child that inherits it
   switches to the serialized reporter. Since this script is itself driven from the
   test suite, a child graded on the parent's environment is a child graded on where
   it happened to be called from. Scrubbed once, here, where every child goes through. */
function childEnv() {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  return env;
}
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: childEnv(), windowsHide: true });
const node = (script, args) => run(process.execPath, [script].concat(args || []));
/* A gate command is a shell string, because that is the form a repo already has it
   in. A leading bare `node` is re-pointed at THIS runtime, for the reason gates.js
   gives: on Windows the `node` on PATH can be a shim whose exit code is not the
   runner's, so the check would be graded by a runtime nobody chose. */
function shell(command) {
  const repointed = String(command).replace(/^node(?=\s|$)/, '"' + process.execPath + '"');
  return spawnSync(repointed, { shell: true, cwd: ROOT, encoding: 'utf8', env: childEnv(), windowsHide: true });
}

const hygieneGate = (cfg) => (cfg.gates || []).find((g) => HYGIENE_GATE_NAMES.includes(g.name)) || null;

/** The newest mtime under the gate-relevant trees, and the file that carries it.
 *  The three inputs are PARAMETERS so a test can drive this against a synthetic tree
 *  in a temp directory rather than against the live repo: a check that walks a set is
 *  only proved to walk it by watching it find something there, and a fixture pointed
 *  at the real tree asserts whatever that tree happens to contain today. */
function newestSource(dirs, files, root) {
  let best = { file: null, ms: 0 };
  walkSources(dirs, files, root, (p, ms) => { if (ms > best.ms) best = { file: p, ms: ms }; });
  return best;
}

/** THE WALK ITSELF: every gate-relevant file, handed to `visit` with its mtime. One walk, two
 *  readers: the close asks for the newest file, the stop report counts the ones past a moment. */
function walkSources(dirs, files, root, visit) {
  const base = root || ROOT;
  const consider = (p) => {
    let st;
    try { st = fs.statSync(path.join(base, p)); } catch { return; }
    visit(p, st.mtimeMs);
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(path.join(base, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = dir + '/' + e.name;
      if (NOT_SOURCE.test(p)) continue;
      if (e.isDirectory()) { walk(p); continue; }
      consider(p);
    }
  };
  for (const d of dirs || []) walk(d);
  for (const f of files || []) consider(f);
}

/* ---------- the stop report ----------
   "Done means verified" as a mechanism: when a turn ends, the same walk the close uses says
   whether a gate-relevant file is newer than the recorded verdict. scripts/harness/hook.js runs
   these two as its one `stop` handler. IT REPORTS. It forces another turn only where the config
   says `stop.block: true`, and then once per stop: the tool marks the stop that follows a forced
   turn, and that one only reports (measured: the track's research file on the stop hook).
   IT NEVER RUNS THE SUITE. A suite takes minutes and a stop hook has seconds.
   SILENT where it has nothing to compare: no readable config, or no verdict with a usable
   `generatedAt`. A repo that never ran its gates is the health check's finding, and a line on
   every stop of every session there is a line nobody reads.
   An mtime is what it reads, so a checkout that rewrites files counts as an edit, exactly as
   it makes the verdict stale for the close. */

/** The disk half. `gatesFile` and `baselineFile` are parameters for the self-test alone. */
function gatherStop(cfg, root, gatesFile, baselineFile) {
  if (!cfg) return {};
  let gates = null;
  let baseline = null;
  try { gates = JSON.parse(fs.readFileSync(gatesFile || GATES_JSON, 'utf8')); } catch { /* silent: see above */ }
  try { baseline = JSON.parse(fs.readFileSync(baselineFile || BASELINE_JSON, 'utf8')); } catch { /* the fix line then carries no flags */ }
  const at = gates ? Date.parse(gates.generatedAt) : NaN;
  if (!Number.isFinite(at)) return {};
  let count = 0;
  let newest = { file: null, ms: 0 };
  walkSources(sourceTrees(cfg), sourceFiles(cfg, cfg.configFile), root, (p, ms) => {
    if (ms <= at) return;
    count++;
    if (ms > newest.ms) newest = { file: p, ms: ms };
  });
  return { at: at, count: count, newest: newest.file, fix: checkCommand(baseline), block: !!cfg.stop && cfg.stop.block === true };
}

/** The pure half: the neutral verdict. A `message` is the line for the person; a deny at stop
 *  is a forced turn, and its `reason` is what the model is handed. */
function decideStop(event, state) {
  const s = state || {};
  if (!Number.isFinite(s.at) || !(s.count > 0)) return { deny: false, reason: '' };
  const what = s.count + ' gate-relevant file' + (s.count === 1 ? '' : 's') + ' changed after the last gate run (newest: ' + s.newest + ')';
  const message = 'Gates NOT RUN on this tree: ' + what + '. Verify with: ' + s.fix;
  if (s.block === true && !(event && event.forced === true)) {
    return {
      deny: true,
      message: message,
      reason: 'STOP CHECK (`stop.block` is on in harness.config.json): ' + what + ', so no gate has seen the tree this turn ends on.\n'
        + 'Run `' + s.fix + '` in the foreground and paste its output, or tell the person in plain words that the gates were NOT RUN.\n'
        + 'This is asked once: the next stop only reports.',
    };
  }
  return { deny: false, reason: '', message: message };
}

/* ---------- the preconditions ----------
   Every refusal carries the ONE command that fixes it. A refusal that only states
   the problem makes the reader go and find out what to type; this file knows. */
function preconditions(cfg, id, allowSkipCli) {
  const bad = [];
  const tracks = cfg.project.tracksDir;
  const trackDir = resolve(tracks, id);
  const readme = path.join(trackDir, 'README.md');
  const handoff = path.join(trackDir, 'handoff.md');
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

  if (!fs.existsSync(readme)) {
    return { bad: ['no ' + tracks + '/' + id + '/README.md — there is no such track. '
      + 'fix: scaffold it from templates/track/, or check the id against `ls ' + tracks + '`'] };
  }
  if (!fs.existsSync(handoff)) {
    return { bad: ['no ' + tracks + '/' + id + '/handoff.md — a phase closes by handing off. '
      + 'fix: write it from templates/track/handoff.md, one ▶ block'] };
  }

  /* 1 + 2 + 3 + 4 — the gate verdict. All four are questions about ONE file, so they
     share its read and a single refusal when it is not there. */
  let gates = null;
  let baseline = null;
  try { gates = JSON.parse(fs.readFileSync(GATES_JSON, 'utf8')); } catch { /* reported below */ }
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8')); } catch { /* reported below */ }
  const fix = checkCommand(baseline);
  if (!gates) bad.push('no readable ' + rel(GATES_JSON) + ' — nothing has graded this commit. fix: ' + fix);
  if (!baseline) {
    bad.push('no readable ' + rel(BASELINE_JSON) + ' — there is no verdict of record to compare against. '
      + 'fix: node scripts/harness/gates.js --accept');
  }

  if (gates) {
    const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
    if (!head) {
      bad.push('`git rev-parse HEAD` said nothing — a receipt names a commit, so there has to be one. '
        + 'fix: make the first commit, then re-run the gates');
    } else if (gates.commit !== head) {
      bad.push('the gate verdict was recorded at ' + String(gates.commit).slice(0, 8) + ', HEAD is '
        + head.slice(0, 8) + ' — that verdict is about another tree. fix: ' + fix);
    }

    for (const v of dirtyViolations(gates, fix)) bad.push(v);

    /* The comparator comes from gates.js itself. Re-implementing `violations()` here
       would mean two answers to "is this suite green", and the day they disagree the
       close is the one that wins — silently. */
    const { violations } = require('./gates.js');
    const skips = allowedSkips(baseline, allowSkipCli);
    const names = [...new Set(
      Object.keys((baseline && baseline.gates) || {}).concat(Object.keys(gates.gates || {})),
    )];
    if (names.length === 0) {
      bad.push('the gate verdict records no gates at all — an empty suite is not a green one. fix: ' + fix);
    }
    for (const n of names) {
      for (const v of violations(n, (gates.gates || {})[n], ((baseline && baseline.gates) || {})[n], skips)) {
        bad.push('gates — ' + v + '. fix: ' + fix);
      }
    }

    const newest = newestSource(sourceTrees(cfg), sourceFiles(cfg, cfg.configFile), ROOT);
    const at = Date.parse(gates.generatedAt);
    if (!Number.isFinite(at)) {
      bad.push('the gate verdict has no usable `generatedAt`, so its age cannot be judged. fix: ' + fix);
    } else if (newest.ms > at) {
      bad.push('the gate verdict is STALE: ' + newest.file + ' changed after the run. '
        + 'A gate you did not run is NOT RUN. fix: ' + fix);
    }
  }

  /* 5 — the tree, re-run NOW rather than read off the verdict. The hygiene question is
     about the tree this close is going to write a receipt into, which is a later moment
     than the one the gate suite graded. */
  const hyg = hygieneGate(cfg);
  if (!hyg) {
    bad.push('no gate named `' + HYGIENE_GATE_NAMES[0] + '` in harness.config.json — a phase cannot close '
      + 'against a tree nobody graded. fix: add { "name": "hygiene", "command": "<your hygiene check>" } to `gates`');
  } else {
    const r = shell(hyg.command);
    if (r.status !== 0) {
      bad.push('the `' + hyg.name + '` gate is not clean:\n      '
        + String(r.stdout || r.stderr || '(no output)').trim().split('\n').slice(0, 6).join('\n      ')
        + '\n      fix: ' + hyg.command);
    }
  }

  /* 6 — the handoff. Two separate questions: is the block well-formed, and is it a NEW
     block. The second is invariant "handoff.md is replaced wholesale" expressed as a
     mechanism, because a handoff carried over from the last phase reads as current
     truth to a cold session and is the most expensive doc in the repo to get wrong. */
  if (!fs.existsSync(HANDOFF_LINT)) {
    bad.push('no ' + path.relative(ROOT, HANDOFF_LINT).split(path.sep).join('/')
      + ' — the handoff cannot be graded, and an ungraded handoff is not a passing one. '
      + 'fix: install the handoff-lint helper');
  } else {
    const hl = node(HANDOFF_LINT, [id]);
    if (hl.status !== 0) {
      bad.push('handoff-lint failed:\n      '
        + String(hl.stderr || hl.stdout || '(no output)').trim().split('\n').slice(0, 8).join('\n      ')
        + '\n      fix: node scripts/harness/handoff-lint.js ' + id);
    }
  }

  const handoffText = fs.readFileSync(handoff, 'utf8');
  const block = blockOf(handoffText);
  if (!block) {
    bad.push(tracks + '/' + id + '/handoff.md carries no ▶ block — there is nothing to hand off. '
      + 'fix: write one ▶ block naming the next action');
  }
  const fm = parseFrontmatter(fs.readFileSync(readme, 'utf8')) || {};
  const blockSha = block ? sha256(block) : null;
  if (blockSha && fm.block_sha === blockSha) {
    bad.push('the ▶ block is byte-identical to the one that closed phase ' + fm.closed_phase
      + ' — a handoff that did not change describes the phase before this one. '
      + 'fix: replace handoff.md wholesale, then re-run this command');
  }

  const hf = parseFrontmatter(handoffText) || {};
  return { bad, gates, readme, handoff, blockSha, fm, phaseNext: Number(hf.phase_next) };
}

/* ---------- --self-test ----------
   Drives every pure decision with literals, AND the cases that must come out NO —
   a check is only proved to refuse by watching it refuse. Needs no config and reads
   no track, so it tests this file rather than this repo. */
function selfTest() {
  let checks = 0;
  const f = [];
  const eq = (what, got, want) => {
    checks++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  };

  // The receipt: every input must move it, and no two inputs may run together.
  eq('the receipt is stable for the same inputs', receiptFor('t', 4, 'a', 'b'), receiptFor('t', 4, 'a', 'b'));
  eq('a different track is a different receipt', receiptFor('t2', 4, 'a', 'b') === receiptFor('t', 4, 'a', 'b'), false);
  eq('a different phase is a different receipt', receiptFor('t', 4, 'a', 'b') === receiptFor('t', 5, 'a', 'b'), false);
  eq('a different verdict is a different receipt', receiptFor('t', 4, 'a', 'b') === receiptFor('t', 4, 'a2', 'b'), false);
  eq('a different block is a different receipt', receiptFor('t', 4, 'a', 'b') === receiptFor('t', 4, 'a', 'b2'), false);
  eq('the fields cannot run together', receiptFor('t', 45, 'a', 'b') === receiptFor('t', 4, '5a', 'b'), false);

  // The block.
  eq('block: found and trimmed', blockOf('---\nid: x\n---\n# t\n## ▶ next\nbody\n'), '## ▶ next\nbody');
  eq('block: absent is null, not a crash', blockOf('# t\nnothing here\n'), null);
  eq('block: a deeper heading stays inside', blockOf('## ▶ a\n### sub\nx\n'), '## ▶ a\n### sub\nx');
  eq('block: a sibling heading ends it', blockOf('## ▶ a\nx\n## after\ny\n'), '## ▶ a\nx');
  eq('block: CRLF reads the same as LF', blockOf('## ▶ a\r\nx\r\n'), '## ▶ a\nx');

  // Frontmatter.
  eq('frontmatter: replace in place keeps field order',
    setFrontmatter('---\nid: x\nstatus: open\n---\nbody\n', { status: 'complete' }),
    '---\nid: x\nstatus: complete\n---\nbody\n');
  eq('frontmatter: append when absent',
    setFrontmatter('---\nid: x\n---\nbody\n', { receipt: 'abc' }), '---\nid: x\nreceipt: abc\n---\nbody\n');
  eq('frontmatter: the body is untouched',
    setFrontmatter('---\nid: x\n---\nstatus: not a field\n', { receipt: 'a' }).endsWith('status: not a field\n'), true);
  eq('frontmatter: a file without one refuses rather than corrupting it',
    (() => { try { setFrontmatter('# no frontmatter\n', { receipt: 'a' }); return 'wrote'; } catch { return 'refused'; } })(), 'refused');
  eq('frontmatter: parsed as flat scalars', parseFrontmatter('---\nid: x\nphase_next: 5\n---\nb\n'), { id: 'x', phase_next: '5' });

  // Declared skips.
  eq('skips: a baseline skip is declared', allowedSkips({ gates: { lint: { skipped: 1 } } }, ''), { lint: 1 });
  eq('skips: a green baseline declares none', allowedSkips({ gates: { test: { skipped: 0 } } }, ''), {});
  eq('skips: the CLI can only widen', allowedSkips({ gates: { lint: { skipped: 1 } } }, 'lint=3,docs=2'), { lint: 3, docs: 2 });
  eq('skips: a narrower CLI figure does not shrink the baseline', allowedSkips({ gates: { lint: { skipped: 2 } } }, 'lint=1'), { lint: 2 });
  eq('the fix command carries the declared skips',
    checkCommand({ gates: { lint: { skipped: 1 } } }), 'node scripts/harness/gates.js --check --allow-skip lint=1');
  eq('a fully green baseline needs no flags', checkCommand({ gates: {} }), 'node scripts/harness/gates.js --check');

  // ABSENT IS NOT CLEAN.
  eq('dirty: a clean tree is the only verdict that closes a phase', dirtyViolations({ dirty: false }), []);
  eq('dirty: a verdict taken over uncommitted work refuses', dirtyViolations({ dirty: true }).length, 1);
  eq('dirty: that refusal names the tree', /DIRTY tree/.test(dirtyViolations({ dirty: true })[0]), true);
  eq('dirty: absent is not clean', dirtyViolations({}).length, 1);
  eq('dirty: null is not clean either', dirtyViolations({ dirty: null }).length, 1);
  eq('dirty: the string "false" is not the boolean', dirtyViolations({ dirty: 'false' }).length, 1);
  eq('dirty: 0 is not the boolean', dirtyViolations({ dirty: 0 }).length, 1);
  eq('dirty: an unanswered flag blames the verdict, not the tree', /DIRTY tree/.test(dirtyViolations({})[0]), false);
  eq('dirty: every refusal carries the fix command', dirtyViolations({}, 'CMD')[0].includes('CMD'), true);

  // What counts as a gate input.
  eq('watched trees come from the config, not from here',
    sourceTrees({ commitHygiene: { workDirs: ['scripts', 'tests'] }, project: { docsRoot: 'docs', tracksDir: 'docs/tracks' } }),
    ['docs', 'scripts', 'tests']);
  eq('a nested tree is not walked twice',
    sourceTrees({ commitHygiene: { workDirs: ['docs', 'docs/tracks'] }, project: { docsRoot: 'docs', tracksDir: 'docs/tracks' } }), ['docs']);
  eq('a backslash in the config normalises',
    sourceTrees({ commitHygiene: { workDirs: ['a\\b'] }, project: { docsRoot: 'a/b', tracksDir: 'a/b/c' } }), ['a/b']);
  eq('the always-on docs and the config file are watched',
    sourceFiles({ docs: { caps: { 'AGENTS.md': 80, 'CLAUDE.md': 5, subtreeAgentsMd: 50, default: 150 } } }, '/r/harness.config.json'),
    ['AGENTS.md', 'CLAUDE.md', 'harness.config.json']);
  eq('not source: a dependency tree', NOT_SOURCE.test('scripts/node_modules/x.js'), true);
  eq('not source: build output', NOT_SOURCE.test('web/dist/bundle.js'), true);
  eq('not source: the verdict file itself', NOT_SOURCE.test('scripts/harness/gates.json'), true);
  eq('not source: a red gate log', NOT_SOURCE.test('scripts/harness/gates.red.test.log'), true);
  eq('IS source: the baseline\'s neighbour script', NOT_SOURCE.test('scripts/harness/gates.js'), false);
  eq('IS source: a helper', NOT_SOURCE.test('scripts/harness/guards/docs-lint.cjs'), false);
  eq('IS source: a test', NOT_SOURCE.test('tests/close-phase.test.js'), false);
  eq('IS source: a doc', NOT_SOURCE.test('docs/reference/DOC-STANDARD.md'), false);

  // The hygiene gate is reached by name, and a repo without one is refused later.
  eq('the hygiene gate is found by name', (hygieneGate({ gates: [{ name: 'test' }, { name: 'hygiene', command: 'x' }] }) || {}).command, 'x');
  eq('a repo with no hygiene gate yields null', hygieneGate({ gates: [{ name: 'test' }] }), null);

  // Argument order must not matter.
  eq('positionals: the flag value is not the track id', positionals(['--phase', '4', 'my-track']), ['my-track']);
  eq('positionals: and neither is it when it trails', positionals(['my-track', '--allow-skip', 'lint=1', '--archive']), ['my-track']);

  /* THE STALENESS WALK, against a SYNTHETIC tree. Driven rather than reasoned about,
     because a walk is only proved to visit a set by watching it find a file there —
     and a fixture pointed at the live repo would assert whatever today's tree holds. */
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-close-phase-self-test-'));
  try {
    const put = (rel, mtime) => {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'x');
      fs.utimesSync(p, mtime / 1000, mtime / 1000);
    };
    const T0 = Date.now() - 100000;
    put('scripts/a.js', T0);
    put('docs/reference/b.md', T0 + 1000);
    put('AGENTS.md', T0 + 2000);
    put('scripts/node_modules/dep/index.js', T0 + 90000);
    put('scripts/harness/gates.json', T0 + 90000);
    const dirs = ['scripts', 'docs'];
    const files = ['AGENTS.md', 'harness.config.json'];
    eq('the walk finds the newest watched file', newestSource(dirs, files, dir).file, 'AGENTS.md');
    put('docs/reference/b.md', T0 + 5000);
    eq('a doc edit moves the newest file — docs ARE a gate input', newestSource(dirs, files, dir).file, 'docs/reference/b.md');
    put('harness.config.json', T0 + 6000);
    eq('editing the suite itself moves it too', newestSource(dirs, files, dir).file, 'harness.config.json');
    eq('an excluded tree is not the newest, however fresh', newestSource(dirs, files, dir).file === 'scripts/node_modules/dep/index.js', false);
    eq('an unwatched tree is invisible', newestSource(['tests'], [], dir).file, null);

    /* THE STOP REPORT, on the same synthetic tree. The verdict's moment is a parameter here. */
    const cfgOf = (block) => ({ commitHygiene: { workDirs: ['scripts'] }, project: { docsRoot: 'docs', tracksDir: 'docs/tracks' }, docs: { caps: { 'AGENTS.md': 80 } }, stop: { block: block } });
    const verdict = (ms) => { put('state/gates.json', T0); fs.writeFileSync(path.join(dir, 'state/gates.json'), JSON.stringify({ generatedAt: new Date(ms).toISOString() })); return path.join(dir, 'state/gates.json'); };
    const none = path.join(dir, 'state/absent.json');
    const fresh = gatherStop(cfgOf(false), dir, verdict(T0 + 50000), none);
    eq('stop: a verdict newer than every watched file counts nothing', [fresh.count, fresh.newest], [0, null]);
    eq('stop: ...and that is silence', decideStop({ event: 'stop' }, fresh), { deny: false, reason: '' });
    const stale = gatherStop(cfgOf(false), dir, verdict(T0 + 3000), none);
    eq('stop: files past the verdict are counted, the newest named, the excluded trees not', [stale.count, stale.newest, stale.block], [2, 'harness.config.json', false]);
    eq('stop: with no baseline the fix line carries no flags', stale.fix, 'node scripts/harness/gates.js --check');
    const said = decideStop({ event: 'stop' }, stale);
    eq('stop: BY DEFAULT it reports and does not force a turn', [said.deny, /^Gates NOT RUN on this tree: 2 gate-relevant files changed/.test(said.message), said.message.endsWith(stale.fix)], [false, true, true]);
    const forcing = gatherStop(cfgOf(true), dir, verdict(T0 + 3000), none);
    const forced = decideStop({ event: 'stop' }, forcing);
    eq('stop: under `stop.block` the first stop forces a turn, with the command in the reason', [forced.deny, forced.reason.includes(forcing.fix), forced.message === said.message], [true, true, true]);
    eq('stop: ...and the stop after a forced turn only reports', decideStop({ event: 'stop', forced: true }, forcing), said);
    eq('stop: a truthy block that is not the boolean forces nothing', decideStop({ event: 'stop' }, Object.assign({}, stale, { block: 'true' })).deny, false);
    eq('stop: no verdict file is silence, not a report', decideStop({ event: 'stop' }, gatherStop(cfgOf(true), dir, none, none)), { deny: false, reason: '' });
    fs.writeFileSync(path.join(dir, 'state/gates.json'), JSON.stringify({ generatedAt: 'yesterday' }));
    eq('stop: a verdict with no usable moment is silence', gatherStop(cfgOf(true), dir, path.join(dir, 'state/gates.json'), none), {});
    eq('stop: a config that could not be read is silence', gatherStop(null, dir, verdict(T0), none), {});
    eq('stop: one file is singular', /1 gate-relevant file changed/.test(decideStop({}, { at: 1, count: 1, newest: 'a', fix: 'CMD' }).message), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const line of f) console.log('  x ' + line);
  console.log(f.length ? '\nFAIL — close-phase.js self-test: ' + f.length + ' assertion(s) of ' + checks
    : 'PASS — close-phase.js self-test (' + checks + ' checks: receipt, ▶ block, frontmatter, declared skips, '
      + 'clean-tree flag, watched trees, staleness walk, stop report)');
  process.exit(f.length ? 1 : 0);
}

/* ---------- main ---------- */
function main() {
  let cfg;
  try { cfg = load(); } catch (e) { fatal(e.message, e.fix); }

  const id = positionals(argv)[0];
  if (!id) {
    console.error('usage: node scripts/harness/close-phase.js <track-id> [--phase N] [--allow-skip g=n] [--archive]');
    console.error('       node scripts/harness/close-phase.js --self-test');
    process.exit(2);
  }

  const pre = preconditions(cfg, id, valueOf('--allow-skip'));
  if (pre.bad.length) {
    console.error('CANNOT CLOSE ' + id + ' — ' + pre.bad.length + ' precondition(s) unmet:');
    for (const b of pre.bad) console.error('  x ' + b);
    console.error('\nA phase closes when the mechanisms say so. Fix the finding; do not assert past it.');
    process.exit(1);
  }

  const phase = Number(valueOf('--phase') !== null ? valueOf('--phase') : pre.phaseNext - 1);
  if (!Number.isInteger(phase) || phase < 0) {
    console.error('close-phase: no phase to close — pass --phase N, or set `phase_next:` in the handoff frontmatter.');
    process.exit(2);
  }

  const gatesSha = sha256(fs.readFileSync(GATES_JSON, 'utf8'));
  const receipt = receiptFor(id, phase, gatesSha, pre.blockSha);
  const fields = {
    closed_phase: String(phase),
    closed_at: new Date().toISOString().slice(0, 10),
    gates_sha: gatesSha,
    block_sha: pre.blockSha,
    receipt: receipt,
  };
  // `--archive` is the only thing that may write `status: complete`, and the doc
  // linter only accepts that status beside a receipt it can recompute. That pairing
  // is what makes "complete" a verdict rather than a word.
  if (has('--archive')) fields.status = 'complete';
  fs.writeFileSync(pre.readme, setFrontmatter(fs.readFileSync(pre.readme, 'utf8'), fields));

  const tracks = cfg.project.tracksDir;
  console.log('CLOSED ' + id + ' phase ' + phase);
  console.log('  gates       green against the committed baseline, recorded at ' + String(pre.gates.commit).slice(0, 8) + ' on a clean tree');
  console.log('  hygiene     clean');
  console.log('  handoff     lint-clean, and replaced since the last receipt');
  console.log('  receipt     ' + receipt.slice(0, 16) + '…  (written to ' + tracks + '/' + id + '/README.md, recomputed by the doc linter)');

  if (has('--archive')) {
    // `git mv`, not fs.renameSync: the archive move has to be legible in history, and
    // a rename git did not see reads as a delete plus an unrelated add.
    const archive = path.posix.join(cfg.project.docsRoot, 'archive');
    fs.mkdirSync(resolve(archive), { recursive: true });
    const mv = run('git', ['mv', path.posix.join(tracks, id), path.posix.join(archive, id)]);
    if (mv.status !== 0) {
      console.error('  x git mv failed: ' + String(mv.stderr || mv.stdout || '').trim());
      console.error('    fix: resolve that, then re-run with --archive (the receipt is already written)');
      process.exit(1);
    }
    console.log('  archived    ' + tracks + '/' + id + ' -> ' + archive + '/' + id);
    // The index is generated FROM the tree, so a move that does not regenerate it
    // leaves a published link pointing at a path that no longer exists.
    if (!fs.existsSync(DOCS_INDEX)) {
      console.error('  x the doc index was not regenerated: no ' + path.relative(ROOT, DOCS_INDEX).split(path.sep).join('/'));
      console.error('    fix: install the docs-index helper and run it — the index now names a path that moved');
      process.exit(1);
    }
    const idx = node(DOCS_INDEX, []);
    console.log('  ' + String(idx.stdout || idx.stderr || '').trim());
    if (idx.status !== 0) process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  receiptFor, blockOf, parseFrontmatter, setFrontmatter, allowedSkips, checkCommand,
  dirtyViolations, sourceTrees, sourceFiles, newestSource, hygieneGate, positionals,
  preconditions, NOT_SOURCE, HYGIENE_GATE_NAMES, walkSources, gatherStop, decideStop,
};

if (require.main === module) {
  if (has('--self-test')) selfTest();
  else main();
}
