'use strict';
/* ============================================================
   findings-check.js — a finding is closed when a COMMAND says so.

   WHY THIS EXISTS
   A backlog row used to close because somebody wrote `"status": "closed"` into it.
   That is an assertion, and an assertion is the same form-over-truth failure the
   phase lifecycle exists to remove: the row reads as settled, the next session
   trusts it, and nothing ever re-asks the question. So every row in a findings
   ledger carries two things a reader can check without believing anybody:

     evidence   a `path` or `path:line` that ANCHORS the finding in this tree
     proof      a shell command whose exit 0 MEANS closed

   This runs the proofs, resolves the anchors, and reports every place the RECORDED
   status disagrees with what the tree and the commands actually say.

   WHAT IT IS NOT
   . Not a writer. It never touches the ledger. A checker that can edit its own
     input proves nothing, which is the entire reason it exists.
   . Not a second command runner. The spawn shape, the per-row line, the pure
     comparator and the literal-driven --self-test all follow the gate runner, so
     there is one idea of how a check reports rather than two.

   THE FOUR STATES a row can be in
     CLOSED       the proof ran and exited 0
     OPEN         the proof ran and exited non-zero — the NORMAL state of a
                  backlog, and not red
     UNCHECKABLE  proof is null. Must say why in `proofMeans`. Reported as neither
                  closed nor open, ever.
     ERROR        the proof did NOT run: no shell, exit 127/126, or a timeout.
                  A proof that cannot run is a finding, never a silent skip.

   WHAT REDS
     . any ERROR                               a proof that did not run
     . recorded closed, proof says open        a FALSE closure
     . recorded closed, proof is null          a closure nothing can check
     . recorded closed, no evidence            a closure with nothing to read
     . evidence that does not resolve          an anchor pointing at a path, or a
                                               line, this tree does not have
     . not recorded closed, proof passes       the ledger lagging the tree
     . an id outside the track's namespace     see `trap_prefix` below
     . a malformed row                         unknown status, bad proof type,
                                               duplicate id, null proof with no
                                               `proofMeans`

   THE ID NAMESPACE comes from the track, not from this file. A track declares
   `trap_prefix:` in its README frontmatter, and every id in its ledger must begin
   with it. Hard-coding the prefixes here is what tied the original to one repo; and
   leaving them unchecked is worse than cosmetic, because two tracks that both number
   from 01 produce rows that cite each other's findings in a handoff.

   THE GATE LINE, and the one thing it may count. The original refused to emit one,
   on the grounds that counting "checks" inside somebody's proof invents a figure
   nobody can defend. That reasoning stands and is kept: this gate counts ROWS, which
   it owns exactly. pass = rows whose record agrees with the tree, fail = rows that
   disagree, skipped = rows nothing can check yet. pass+fail+skipped is the number of
   rows in the ledger, so a row DELETED to make the figure nicer lowers the total and
   is caught by the same pass-by-absence rule as a vanished test.

   EVERY PROOF RUNS THROUGH ONE POSIX SHELL, from the repo root, because ledger rows
   get written in sh (`!` negation, `$(...)`, single quotes) and guessing per row
   would be the fragile choice. On Windows that shell is the one Git Bash provides; if
   there is none, each proof reports ERROR and the gate is red. That is the intended
   behaviour: a box that cannot run the proofs has not proved anything on it.

   Zero dependencies (Node built-ins only).

   Run:  node scripts/harness/findings-check.js <path/to/findings.json>
         node scripts/harness/findings-check.js --track <track-id>
         node scripts/harness/findings-check.js --self-test
   ============================================================ */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { load, ROOT, resolve, fatal } = require('./config.js');

// A grep is instant; a full test run is not. Long enough for a real proof, short
// enough that a hang is REPORTED as an ERROR instead of hanging the phase that is
// waiting on it.
const PROOF_TIMEOUT_MS = 120000;
// Stamped into every proof child. See nestedRefusal.
const NESTED_ENV = 'HARNESS_FINDINGS_CHECK';
const STATUSES = ['open', 'closed', 'deferred', 'wontfix'];
const DEFAULT_GATE = 'findings';

/* ---------- argv ---------- */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const LEDGER_ARG = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--track'
  && argv[argv.indexOf(a) - 1] !== '--gate')[0] || null;

/* ---------- the recursion guard ----------
   A proof command that invoked this checker over the same ledger would run its own
   proof, and so on: a fork bomb on a small box, triggered by a plausible row. Every
   proof child is stamped, and a stamped child refuses to check a ledger.
   --self-test is DELIBERATELY EXEMPT: it reads no ledger and terminates, so a row
   whose proof is exactly that command can prove itself. */
function nestedRefusal(env) {
  return env && env[NESTED_ENV] === '1'
    ? 'refusing to check a ledger from inside a proof command — that recurses'
    : null;
}

/* ---------- the evidence anchor (pure) ----------
   `path` or `path:line`, always relative to the repo root. An absolute path or one
   that climbs out with `..` is refused rather than resolved: an anchor outside the
   tree can never be fixed by a commit to it, and on another machine it points
   somewhere else entirely. */
function parseEvidence(ev) {
  if (typeof ev !== 'string' || !ev.trim()) return null;
  const m = ev.trim().match(/^(.*?)(?::(\d+))?$/);
  const file = (m[1] || '').trim();
  if (!file) return null;
  const line = m[2] ? Number(m[2]) : null;
  const parts = file.split(/[\\/]/);
  const outside = path.isAbsolute(file) || /^[A-Za-z]:/.test(file) || parts.includes('..');
  return { file: parts.filter(Boolean).join('/'), line, outside };
}

/** Does the anchor resolve in THIS tree? Returns null when it does, else the reason.
 *  The line number is checked too, because a `path:line` that survives the file being
 *  rewritten cites a line that is now about something else — and a citation nobody can
 *  follow is the same as no citation. `root` is a parameter so the self-test can drive
 *  it against a synthetic tree instead of asserting whatever this repo holds today. */
function evidenceProblem(ev, root) {
  const parsed = parseEvidence(ev);
  if (!parsed) return 'evidence must be a `path` or `path:line` inside the repo';
  if (parsed.outside) return 'evidence `' + String(ev).trim() + '` points outside the repo — an anchor no commit here can fix';
  const abs = path.join(root || ROOT, parsed.file);
  let st;
  try { st = fs.statSync(abs); } catch { return 'evidence `' + parsed.file + '` does not resolve in this tree'; }
  if (!st.isFile()) return 'evidence `' + parsed.file + '` is not a file';
  if (parsed.line !== null) {
    const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
    if (parsed.line < 1 || parsed.line > lines) {
      return 'evidence `' + parsed.file + ':' + parsed.line + '` is past the end of the file (' + lines + ' lines)';
    }
  }
  return null;
}

/* ---------- the ledger contract (pure) ----------
   Returns the list of reasons this row is malformed; empty is well-formed. A row whose
   SHAPE is wrong is never run: there is nothing to learn from executing a command on a
   row we cannot interpret, and the reason is already recorded. */
function rowProblems(row, seenIds, prefix) {
  if (!row || typeof row.id !== 'string' || !row.id.trim()) return ['a row has no id'];
  const out = [];
  if (seenIds && seenIds.has(row.id)) out.push(row.id + ': duplicate id — the second row shadows the first wherever one is cited');
  if (prefix && !new RegExp('^' + prefix.replace(/[^A-Za-z0-9_]/g, '') + '-').test(row.id)) {
    out.push(row.id + ': id is outside this track\'s namespace — `trap_prefix` is `' + prefix
      + '`, so ids read `' + prefix + '-nn`');
  }
  if (!STATUSES.includes(row.status)) {
    out.push(row.id + ': status ' + JSON.stringify(row.status) + ' is not one of ' + STATUSES.join(', '));
  }
  if (row.proof !== null && !(typeof row.proof === 'string' && row.proof.trim())) {
    out.push(row.id + ': proof must be a non-empty command string, or null');
  }
  if (row.proof === null && !(typeof row.proofMeans === 'string' && row.proofMeans.trim())) {
    out.push(row.id + ': proof is null and proofMeans does not say why');
  }
  return out;
}

/* ---------- the proof runner ---------- */
function runProof(proof, root) {
  const env = Object.assign({}, process.env);
  env[NESTED_ENV] = '1';
  // `node --test` exports NODE_TEST_CONTEXT into everything it spawns, and a proof
  // that inherits it is graded in a different reporter from the one it was written
  // against. A proof must mean the same thing wherever it is run from.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('sh', ['-c', proof], {
    cwd: root || ROOT, encoding: 'utf8', timeout: PROOF_TIMEOUT_MS, env: env, windowsHide: true,
  });
  const out = (String(r.stdout || '') + String(r.stderr || '')).trim();
  if (r.error) {
    return { ran: false, exit: null, out,
      why: 'could not spawn a POSIX shell (' + (r.error.code || r.error.message) + ')' };
  }
  if (r.signal) {
    return { ran: false, exit: null, out, why: 'killed by ' + r.signal + ' after ' + PROOF_TIMEOUT_MS + 'ms' };
  }
  const exit = typeof r.status === 'number' ? r.status : 1;
  // 127 and 126 are the shell saying it never got to run the command. Reading either
  // as "still open" is exactly the silent skip this script exists to refuse.
  if (exit === 127) return { ran: false, exit, why: 'command not found', out };
  if (exit === 126) return { ran: false, exit, why: 'command not executable', out };
  return { ran: true, exit, out };
}

/* ---------- vacuity: a proof that cannot fail is not a proof ----------
   `node --test --test-name-pattern <p>` exits 0 when p matches NOTHING. So a proof
   written as a filtered test run keeps passing after the block it names is renamed or
   deleted, and reports a closure nothing is checking — pass-by-absence wearing the most
   convincing disguise a ledger produces, since a filtered run is the natural way to
   write a proof for one test.

   The obvious guard is to read the proof's TEXT and demand it match a TAP line. That is
   a spelling rule: it would pass a proof that greps output it never reads, and fail a
   correct proof written another way. So the NEGATIVE DIRECTION is driven instead. The
   same command is re-run with the pattern replaced by one that matches nothing, and a
   proof that STILL exits 0 was never checking what it names.

   Returns null where the shape does not apply, which is most proofs and costs them
   nothing. */
const NO_SUCH_TEST = '__findings_check_no_such_test_name__';
function vacuityProbe(proof) {
  const m = String(proof).match(/--test-name-pattern[= ]\s*(["'])((?:(?!\1).)*)\1/);
  if (!m || m[2] === NO_SUCH_TEST) return null;
  return String(proof).replace(m[0], m[0].replace(m[2], NO_SUCH_TEST));
}

/* ---------- the classifier (pure) ---------- */
function classify(row, result) {
  if (row.proof === null) return 'UNCHECKABLE';
  if (!result.ran) return 'ERROR';
  return result.exit === 0 ? 'CLOSED' : 'OPEN';
}

/* ---------- the comparator (pure) ----------
   One row's recorded status against what its proof and its anchor just said. Returns
   the reasons it is red; empty is green. Pure so the self-test can drive the cases
   that matter — a real ledger that happens to agree with itself can never exercise
   them. */
function disagreements(row, state, result, evidenceReason) {
  const out = [];
  const claimsClosed = row.status === 'closed';
  // The anchor is charged first and for every status: a finding whose `path:line` has
  // moved is unreadable whether it is open or closed, and the fix is the same.
  if (evidenceReason) out.push(row.id + ': ' + evidenceReason);
  if (claimsClosed && !(typeof row.evidence === 'string' && row.evidence.trim())) {
    out.push(row.id + ': recorded closed with no `evidence` — a closure with nothing to read is an assertion');
  }
  if (state === 'ERROR') {
    out.push(row.id + ': its proof DID NOT RUN — ' + (result.why || 'unknown')
      + '. Not a status; a finding in its own right');
    return out;
  }
  if (state === 'UNCHECKABLE') {
    if (claimsClosed) out.push(row.id + ': recorded closed with proof null — a closure nothing can check');
    return out;
  }
  if (claimsClosed && state === 'OPEN') {
    out.push(row.id + ': recorded closed, but its proof exits ' + result.exit + ' — NOT a closure');
  }
  if (!claimsClosed && state === 'CLOSED') {
    out.push(row.id + ': recorded ' + row.status + ', but its proof already passes — the ledger lags the tree');
  }
  return out;
}

/* ---------- the track's id namespace ----------
   One source of truth, and a second copy is an error rather than a tie-break. A ledger
   may carry `trap_prefix` for a track that has no README yet (a fixture, a track being
   scaffolded); where both exist and differ, the two have already drifted and guessing
   which is current is how the wrong one wins. */
function resolvePrefix(doc, trackReadmeText) {
  const fromDoc = typeof doc.trap_prefix === 'string' ? doc.trap_prefix.trim() : '';
  let fromTrack = '';
  if (trackReadmeText) {
    const m = String(trackReadmeText).match(/^trap_prefix:\s*(.+)$/m);
    if (m) fromTrack = m[1].trim().replace(/^["']|["']$/g, '');
  }
  if (fromDoc && fromTrack && fromDoc !== fromTrack) {
    return { error: 'the ledger says trap_prefix `' + fromDoc + '` and the track README says `' + fromTrack
      + '` — two copies that have drifted. Delete the one in the ledger' };
  }
  const prefix = fromTrack || fromDoc;
  if (!prefix) {
    return { error: 'no `trap_prefix` for this ledger, so no id can be validated — two tracks numbering '
      + 'from 01 produce rows that cite each other. Add `trap_prefix:` to the track README frontmatter' };
  }
  return { prefix };
}

/* ---------- run ---------- */
const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - String(s).length));
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s));

/** Grades one ledger. `opts.root` relocates both the proof cwd and the anchor
 *  resolution, which is what lets the self-test drive a synthetic tree. */
function checkLedger(ledgerPath, opts) {
  const o = opts || {};
  const root = o.root || ROOT;
  const say = o.emit || ((s) => console.log(s));
  let doc;
  try { doc = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
  catch (e) { return { fatal: 'cannot read ' + ledgerPath + ' — ' + e.message }; }
  if (!doc || !Array.isArray(doc.findings)) return { fatal: ledgerPath + ' — no findings array' };

  let prefix = o.prefix || null;
  if (!prefix) {
    const r = resolvePrefix(doc, o.trackReadmeText);
    if (r.error) return { fatal: r.error };
    prefix = r.prefix;
  }

  const reasons = [];
  const counts = { CLOSED: 0, OPEN: 0, UNCHECKABLE: 0, ERROR: 0 };
  // Rows, not reasons. A row with three problems is one failing row, so that
  // pass+fail+skipped stays equal to the number of rows and the total means something.
  const tally = { pass: 0, fail: 0, skipped: 0 };
  const rows = [];
  const seen = new Set();

  for (const row of doc.findings) {
    const problems = rowProblems(row, seen, prefix);
    if (row && typeof row.id === 'string') seen.add(row.id);
    if (problems.length) {
      reasons.push(...problems);
      tally.fail += 1;
      say('\u25b6 ' + pad(row && row.id ? row.id : '?', 10) + 'MALFORMED');
      for (const p of problems) say('    ! ' + clip(p, 100));
      continue;
    }

    const t0 = Date.now();
    const result = row.proof === null
      ? { ran: false, exit: null, why: 'no proof', out: '' }
      : runProof(row.proof, root);
    const ms = Date.now() - t0;
    const state = classify(row, result);
    counts[state] += 1;

    // An absent `evidence` is only charged on a closed row (above); a PRESENT one is
    // charged on every row, because an anchor is either followable or it is not.
    const evidenceReason = typeof row.evidence === 'string' && row.evidence.trim()
      ? evidenceProblem(row.evidence, root) : null;
    const rowReasons = disagreements(row, state, result, evidenceReason);

    // A proof that just passed, in the one shape that can pass for nothing. Driven,
    // not read: only a proof that survives having its pattern broken is reported.
    let vacuous = false;
    if (state === 'CLOSED') {
      const probe = vacuityProbe(row.proof);
      if (probe) {
        const again = runProof(probe, root);
        if (again.ran && again.exit === 0) {
          vacuous = true;
          rowReasons.push(row.id + ': its proof passes with a --test-name-pattern that matches NOTHING'
            + ' — it reports a closure it is not checking. Read the TAP lines, not the exit code');
        }
      }
    }

    reasons.push(...rowReasons);
    if (rowReasons.length) tally.fail += 1;
    else if (state === 'UNCHECKABLE') tally.skipped += 1;
    else tally.pass += 1;
    rows.push({ id: row.id, status: row.status, state, exit: result.exit, ms, red: rowReasons.length > 0 });

    say('\u25b6 ' + pad(row.id, 10) + pad(state, 13)
      + (state === 'UNCHECKABLE' ? '' : 'exit=' + result.exit + '  (' + (Math.round(ms / 100) / 10) + 's)')
      + (row.status === 'closed' && state !== 'CLOSED' ? '  ! recorded closed' : '')
      + (row.status !== 'closed' && state === 'CLOSED' ? '  ! recorded ' + row.status : '')
      + (evidenceReason ? '  ! anchor' : '')
      + (vacuous ? '  ! VACUOUS - passes with a pattern that matches nothing' : ''));
    // Detail only where a reader needs it: why a row cannot be checked, and what a
    // proof that would not run actually said. A green row is not worth output.
    if (state === 'UNCHECKABLE') say('    | ' + clip(row.proofMeans, 92));
    if (evidenceReason) say('    ! ' + clip(evidenceReason, 100));
    if (state === 'ERROR') {
      say('    ! ' + result.why + ': ' + clip(row.proof, 92));
      if (result.out) say(result.out.split('\n').slice(-4).join('\n').replace(/^/gm, '    ! '));
    }
  }
  return { rows, reasons, counts, tally, prefix };
}

/* ---------- --self-test ----------
   The classifier, the comparator, the anchor resolver and the row contract are what
   everything else trusts, so each is driven with literals in BOTH directions. Then one
   end-to-end run over a SYNTHETIC ledger in a temp directory — synthetic because a
   fixture pointed at a live repo path asserts whatever that repo happens to contain,
   and passes for the wrong reason the day somebody moves the file. */
function selfTest() {
  const fails = [];
  const eq = (what, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
    }
  };

  // The classifier.
  eq('exit 0 is a closure', classify({ proof: 'x' }, { ran: true, exit: 0 }), 'CLOSED');
  eq('a proof that exits non-zero is NOT a closure', classify({ proof: 'x' }, { ran: true, exit: 1 }), 'OPEN');
  eq('a null proof is UNCHECKABLE, not open', classify({ proof: null }, { ran: false }), 'UNCHECKABLE');
  eq('a null proof is UNCHECKABLE, not closed either', classify({ proof: null }, { ran: true, exit: 0 }), 'UNCHECKABLE');
  eq('a proof that did not run is an ERROR, not open', classify({ proof: 'x' }, { ran: false, why: 'command not found' }), 'ERROR');

  // The anchor, parsed.
  eq('anchor: a bare path', parseEvidence('scripts/harness/gates.js'), { file: 'scripts/harness/gates.js', line: null, outside: false });
  eq('anchor: path:line', parseEvidence('tests/a.test.js:235'), { file: 'tests/a.test.js', line: 235, outside: false });
  eq('anchor: a backslash path normalises', parseEvidence('docs\\reference\\x.md').file, 'docs/reference/x.md');
  eq('anchor: a climb out is flagged', parseEvidence('../elsewhere/x.js').outside, true);
  eq('anchor: an absolute POSIX path is flagged', parseEvidence('/etc/hosts').outside, true);
  eq('anchor: a drive letter is flagged', parseEvidence('D:/tree/x.js').outside, true);
  eq('anchor: an empty string is no anchor', parseEvidence('  '), null);

  // The comparator, both directions.
  const P = (status, proof, evidence) => ({ id: 'EX-F01', status, proof: proof === undefined ? 'x' : proof,
    evidence: evidence === undefined ? 'docs/x.md' : evidence });
  eq('a proved closure is green', disagreements(P('closed'), 'CLOSED', { exit: 0 }, null), []);
  eq('an open row with a failing proof is green', disagreements(P('open'), 'OPEN', { exit: 1 }, null), []);
  eq('a deferred row with a failing proof is green', disagreements(P('deferred'), 'OPEN', { exit: 1 }, null), []);
  eq('an unchecked open row is not charged', disagreements(P('open', null), 'UNCHECKABLE', {}, null), []);
  eq('an open row needs no evidence', disagreements(P('open', 'x', undefined), 'OPEN', { exit: 1 }, null), []);
  eq('a FALSE closure reds', disagreements(P('closed'), 'OPEN', { exit: 1 }, null).length, 1);
  eq('a closure with no proof reds', disagreements(P('closed', null), 'UNCHECKABLE', {}, null).length, 1);
  eq('a closure with no evidence reds', disagreements({ id: 'EX-F01', status: 'closed', proof: 'x' }, 'CLOSED', { exit: 0 }, null).length, 1);
  eq('a closure whose evidence is blank reds', disagreements(P('closed', 'x', '   '), 'CLOSED', { exit: 0 }, null).length, 1);
  eq('a proof that did not run reds', disagreements(P('open'), 'ERROR', { why: 'command not found' }, null).length, 1);
  eq('a not-closed row whose proof passes reds', disagreements(P('deferred'), 'CLOSED', { exit: 0 }, null).length, 1);
  eq('an anchor that does not resolve reds whatever the status',
    disagreements(P('open'), 'OPEN', { exit: 1 }, 'evidence `docs/x.md` does not resolve in this tree').length, 1);
  eq('an anchor is charged even on a row whose proof did not run',
    disagreements(P('open'), 'ERROR', { why: 'no shell' }, 'gone').length, 2);

  // The row contract.
  eq('a well-formed row is clean', rowProblems({ id: 'EX-F01', status: 'open', proof: 'x', proofMeans: 'why' }, new Set(), 'EX'), []);
  eq('an unknown status is malformed', rowProblems({ id: 'EX-F01', status: 'done', proof: 'x' }, new Set(), 'EX').length, 1);
  eq('a null proof with no proofMeans is malformed', rowProblems({ id: 'EX-F01', status: 'open', proof: null }, new Set(), 'EX').length, 1);
  eq('a non-string proof is malformed', rowProblems({ id: 'EX-F01', status: 'open', proof: 0, proofMeans: 'x' }, new Set(), 'EX').length, 1);
  eq('a duplicate id is malformed', rowProblems({ id: 'EX-F01', status: 'open', proof: 'x' }, new Set(['EX-F01']), 'EX').length, 1);
  eq('a row with no id is malformed', rowProblems({ status: 'open', proof: 'x' }, new Set(), 'EX').length, 1);
  eq('an id from another track is malformed', rowProblems({ id: 'ZZ-F01', status: 'open', proof: 'x' }, new Set(), 'EX').length, 1);
  eq('...and the refusal names the prefix it wanted',
    /trap_prefix` is `EX`/.test(rowProblems({ id: 'ZZ-F01', status: 'open', proof: 'x' }, new Set(), 'EX')[0]), true);
  // The separator is part of the namespace: without it, prefix `EX` would adopt every
  // id of a track whose prefix merely starts with those letters.
  eq('a longer prefix does not match the shorter one',
    rowProblems({ id: 'EXTRA-F01', status: 'open', proof: 'x' }, new Set(), 'EX').length, 1);
  eq('the id may carry a letter inside the number, as traps do',
    rowProblems({ id: 'EX-F01', status: 'open', proof: 'x' }, new Set(), 'EX').length, 0);

  // The id namespace.
  eq('the track README is the source of the prefix', resolvePrefix({}, '---\nid: t\ntrap_prefix: EX\n---\n'), { prefix: 'EX' });
  eq('a ledger may carry it where there is no README', resolvePrefix({ trap_prefix: 'EX' }, null), { prefix: 'EX' });
  eq('two copies that agree are fine', resolvePrefix({ trap_prefix: 'EX' }, 'trap_prefix: EX\n'), { prefix: 'EX' });
  eq('two copies that differ are an error, not a tie-break',
    typeof resolvePrefix({ trap_prefix: 'EX' }, 'trap_prefix: ZZ\n').error, 'string');
  eq('no prefix at all is an error', typeof resolvePrefix({}, null).error, 'string');

  // The vacuity probe. The pure half here; the behaviour is driven end to end against
  // a real filtered run in the test suite, because the shape only matters when the
  // runner is the thing exiting 0.
  eq('vacuity: a plain proof has no probe', vacuityProbe("sh -c 'grep -q x file'"), null);
  eq('vacuity: a filtered run gets one',
    vacuityProbe('node --test --test-name-pattern "some block" tests/a.test.js'),
    'node --test --test-name-pattern "' + NO_SUCH_TEST + '" tests/a.test.js');
  eq('vacuity: single quotes too',
    vacuityProbe("node --test --test-name-pattern 'some block' t.js"),
    "node --test --test-name-pattern '" + NO_SUCH_TEST + "' t.js");
  eq('vacuity: the = spelling too',
    vacuityProbe('node --test --test-name-pattern="some block" t.js'),
    'node --test --test-name-pattern="' + NO_SUCH_TEST + '" t.js');
  // Without this the probe would rewrite its own probe, and every filtered proof would
  // look vacuous the second time round.
  eq('vacuity: the probe does not re-probe itself',
    vacuityProbe('node --test --test-name-pattern "' + NO_SUCH_TEST + '" t.js'), null);
  eq('vacuity: the rest of the command is untouched',
    vacuityProbe('sh -c \'o=$(node --test --test-name-pattern "b" t.js); case "$o" in *"not ok"*) exit 1;; esac\''),
    'sh -c \'o=$(node --test --test-name-pattern "' + NO_SUCH_TEST + '" t.js); case "$o" in *"not ok"*) exit 1;; esac\'');

  eq('a nested run is refused', typeof nestedRefusal({ HARNESS_FINDINGS_CHECK: '1' }), 'string');
  eq('an ordinary run is allowed', nestedRefusal({}), null);

  eq('the GATE line is the last line and names its figures',
    gateLine(DEFAULT_GATE, { pass: 3, fail: 1, skipped: 2 }), 'GATE findings pass=3 fail=1 skipped=2');

  /* END TO END over a synthetic tree: five rows covering every state, plus the two
     anchor failures, with real files on disk so the resolver is doing real work. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-findings-check-self-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'anchor.md'), 'one\ntwo\nthree\n');
    const fixture = path.join(dir, 'findings.json');
    const ledger = (findings) => {
      fs.writeFileSync(fixture, JSON.stringify({ schema: 1, track: 'example', trap_prefix: 'EX', findings }, null, 2) + '\n');
      return checkLedger(fixture, { root: dir, emit: () => {} });
    };

    const run = ledger([
      { id: 'EX-F01', status: 'closed', evidence: 'docs/anchor.md:2', proof: "sh -c 'exit 0'", proofMeans: 'a closure a command agrees with' },
      { id: 'EX-F02', status: 'closed', evidence: 'docs/anchor.md', proof: "sh -c 'exit 1'", proofMeans: 'an ASSERTED closure - must not pass' },
      { id: 'EX-F03', status: 'open', evidence: 'docs/anchor.md', proof: null, proofMeans: 'not machine-checkable yet' },
      { id: 'EX-F04', status: 'open', evidence: 'docs/anchor.md', proof: "sh -c 'exit 1'", proofMeans: 'honestly still open' },
      { id: 'EX-F05', status: 'open', evidence: 'docs/anchor.md', proof: 'harness-no-such-command', proofMeans: 'a proof that cannot run' },
    ]);
    eq('the fixture ledger ran', !!run && !run.fatal, true);
    eq('one closure proved, one refused, one unrunnable', run.counts, { CLOSED: 1, OPEN: 2, UNCHECKABLE: 1, ERROR: 1 });
    eq('exactly two rows are red', run.reasons.length, 2);
    eq('the false closure is named', /EX-F02/.test(String(run.reasons)), true);
    eq('the dead proof is named', /EX-F05/.test(String(run.reasons)), true);
    eq('the honest rows are not named', /EX-F01|EX-F03|EX-F04/.test(String(run.reasons)), false);
    eq('the figures account for every row', run.tally, { pass: 2, fail: 2, skipped: 1 });
    eq('...and they add up to the rows in the ledger',
      run.tally.pass + run.tally.fail + run.tally.skipped, run.rows.length);

    const moved = ledger([
      { id: 'EX-F01', status: 'closed', evidence: 'docs/gone.md', proof: "sh -c 'exit 0'", proofMeans: 'closed, but its anchor moved' },
    ]);
    eq('an anchor that no longer resolves reds a proved closure', moved.reasons.length, 1);
    eq('...and says so about the path', /does not resolve/.test(String(moved.reasons)), true);

    const pastEnd = ledger([
      { id: 'EX-F01', status: 'closed', evidence: 'docs/anchor.md:99', proof: "sh -c 'exit 0'", proofMeans: 'a line that is not there' },
    ]);
    eq('a line past the end of the file reds', /past the end/.test(String(pastEnd.reasons)), true);

    const noEvidence = ledger([
      { id: 'EX-F01', status: 'closed', proof: "sh -c 'exit 0'", proofMeans: 'a closure with nothing to read' },
    ]);
    eq('a closure with no evidence reds even when its proof passes', noEvidence.reasons.length, 1);
    eq('...and the figures call it a failing row', noEvidence.tally, { pass: 0, fail: 1, skipped: 0 });

    const foreign = ledger([
      { id: 'ZZ-F01', status: 'open', evidence: 'docs/anchor.md', proof: "sh -c 'exit 1'", proofMeans: 'wrong namespace' },
    ]);
    eq('a row from another track is malformed and not run', foreign.tally, { pass: 0, fail: 1, skipped: 0 });

    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    eq('an unparseable ledger is fatal, not green',
      typeof checkLedger(path.join(dir, 'broken.json'), { root: dir, emit: () => {} }).fatal, 'string');
    eq('a missing ledger is fatal, not green',
      typeof checkLedger(path.join(dir, 'absent.json'), { root: dir, emit: () => {} }).fatal, 'string');
    fs.writeFileSync(path.join(dir, 'noprefix.json'), JSON.stringify({ schema: 1, findings: [] }));
    eq('a ledger with no trap_prefix anywhere is fatal',
      typeof checkLedger(path.join(dir, 'noprefix.json'), { root: dir, emit: () => {} }).fatal, 'string');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? '\nFAIL — findings-check.js self-test: ' + fails.length + ' assertion(s)'
    : 'PASS — findings-check.js self-test (classifier, anchors, comparator, row contract, '
      + 'id namespace, vacuity probe, one synthetic ledger end to end)');
  process.exit(fails.length ? 1 : 0);
}

/* ---------- the GATE line ----------
   Last stdout line, exactly, so the gate runner can parse a verdict out of this check
   like any other. Its own function because the figures are the contract. */
const gateLine = (name, t) => 'GATE ' + name + ' pass=' + t.pass + ' fail=' + t.fail + ' skipped=' + t.skipped;

/* ---------- main ---------- */
function main() {
  if (has('--self-test')) return selfTest();

  const gate = valueOf('--gate') || DEFAULT_GATE;
  /* A check that dies before its verdict is indistinguishable from a crash, and the
     gate runner is right to treat a missing GATE line as a hard failure. So every exit
     from here prints one, and a refusal is stated in the figures rather than only in
     prose. */
  const stop = (why, fix) => {
    console.log('FAIL — ' + why);
    if (fix) console.log('   fix: ' + fix);
    console.log(gateLine(gate, { pass: 0, fail: 1, skipped: 0 }));
    process.exit(1);
  };

  const refusal = nestedRefusal(process.env);
  if (refusal) stop(refusal, 'a proof must not invoke this checker — give the row a proof that checks the tree');

  let cfg;
  try { cfg = load(); } catch (e) { fatal(e.message, e.fix); }

  // Two ways in, because both are natural: a path, or the track whose ledger it is.
  // The track form is the one a gate registers, and it keeps the path out of the config.
  const track = valueOf('--track');
  let ledgerPath;
  let trackReadmeText = null;
  if (track) {
    ledgerPath = resolve(cfg.project.tracksDir, track, 'findings.json');
    const readme = resolve(cfg.project.tracksDir, track, 'README.md');
    try { trackReadmeText = fs.readFileSync(readme, 'utf8'); } catch { trackReadmeText = null; }
  } else if (LEDGER_ARG) {
    ledgerPath = path.resolve(process.cwd(), LEDGER_ARG);
    // A ledger sitting in a track folder gets that track's prefix without being told.
    const readme = path.join(path.dirname(ledgerPath), 'README.md');
    try { trackReadmeText = fs.readFileSync(readme, 'utf8'); } catch { trackReadmeText = null; }
  } else {
    console.log('usage: node scripts/harness/findings-check.js <path/to/findings.json>');
    console.log('       node scripts/harness/findings-check.js --track <track-id>');
    console.log('       node scripts/harness/findings-check.js --self-test');
    console.log(gateLine(gate, { pass: 0, fail: 1, skipped: 0 }));
    process.exit(1);
  }

  const rel = path.relative(ROOT, ledgerPath).split(path.sep).join('/');
  console.log('ledger: ' + rel + '   (proofs run from the repo root, one POSIX shell each)\n');

  const res = checkLedger(ledgerPath, { trackReadmeText });
  if (res.fatal) stop(res.fatal);

  const c = res.counts;
  const states = 'closed=' + c.CLOSED + ' open=' + c.OPEN + ' uncheckable=' + c.UNCHECKABLE
    + (c.ERROR ? ' ERROR=' + c.ERROR : '');
  console.log('\n' + '-'.repeat(60));
  if (res.reasons.length) {
    console.log('LEDGER RED — ' + res.reasons.length + ' disagreement(s) in ' + rel + ':');
    for (const r of res.reasons) console.log('  x ' + r);
    console.log('  ' + states);
    console.log('  fix: close each row by making its proof pass, or record the status its proof already says');
    console.log(gateLine(gate, res.tally));
    process.exit(1);
  }
  console.log('LEDGER GREEN — every recorded status agrees with its proof and its anchor: ' + states);
  console.log(gateLine(gate, res.tally));
  process.exit(0);
}

module.exports = {
  classify, disagreements, rowProblems, runProof, checkLedger, nestedRefusal,
  parseEvidence, evidenceProblem, resolvePrefix, vacuityProbe, gateLine,
  STATUSES, NO_SUCH_TEST, DEFAULT_GATE,
};

if (require.main === module) main();
