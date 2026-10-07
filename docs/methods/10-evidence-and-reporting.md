---
id: method-10-evidence-and-reporting
kind: reference
status: open
read_when: "writing a report, closing a finding, recording a measurement, or auditing the harness itself"
paths: ["scripts/harness/findings-check.js", "scripts/harness/guards/docs-lint.cjs", "docs/explorations/**", "AGENTS.md"]
verify: "node scripts/harness/findings-check.js --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# Evidence and reporting: a claim is as good as the command behind it

## The failure

- **A figure quoted from memory, or from a doc.** The report says the suite stands at some
  total. The total came from a tracker last edited two phases ago.
- **"All green" describing the parent commit.** True when it was written, false at HEAD.
- **A step that was not run, reported by omission.** The report lists what passed. The check
  that was skipped is simply not mentioned, and the reader assumes it ran.
- **A finding closed by saying so.** A backlog row gets `closed` written into it. Nothing
  re-asks the question.
- **A proof that could not fail.** Rows in a findings ledger carried proof commands. Read, they
  looked right. Run, several were wrong: a proof that never executed at all, proofs that asserted
  a spelling in the source and not the property, a proof that rewrote a tracked file on every run. A test
  runner that exits 0 when a name pattern matches nothing makes a proof that passes vacuously.
- **A probe that cannot find its target and passes.** A check that asserts "no error on the
  page" passes trivially when the page never loaded.
- **An audit graded by its own author.** A self-assessment listed several mechanisms as ahead of
  common work in the field, having never looked outside the repo. Tested against public
  harnesses, none of those claims survived intact.
- **External text read as instruction.** A fetched page or another model's answer, pasted into a
  doc, is obeyed by the next agent that opens it.

## The mechanism

**Reporting rules** for the root `AGENTS.md`, with what actually enforces each:

| Rule | In docs | In a chat reply |
|---|---|---|
| Lead with the outcome. Failures and NOT-RUN steps first | prose | prose |
| Every figure comes from `gates.json` or a command whose output is in the same reply | `docs-lint.cjs` rule 3, `phase-guard.cjs` D3 | prose |
| Every claim about code cites `file:line` | traps: `docs-lint.cjs` rule 7 | prose |
| A gate you did not run is NOT RUN, never implied | `close-phase.js` refuses a stale verdict | prose |
| Done means verified: paste the command output | `close-phase.js` | prose |
| If a rule would make the output worse, set it aside and say which, in one line | prose | prose |

**A findings ledger.** `node scripts/harness/findings-check.js <ledger.json>` or
`--track <track-id>`. Each row carries `evidence` (a `path` or `path:line` that anchors it in
this tree) and `proof` (a shell command whose exit 0 means closed).

- Four states: `CLOSED` (proof ran, exit 0) · `OPEN` (ran, non-zero; normal, not red) ·
  `UNCHECKABLE` (no proof; must say why) · `ERROR` (the proof did not run; a finding, never a
  skip).
- Red on: any `ERROR`, a row recorded closed whose proof says open, a closure with no proof or
  no evidence, an anchor that does not resolve, and a row whose proof passes while the ledger
  still says open.
- **The executed negative control.** For a proof built on a test-name pattern, the checker
  re-runs it with a nonsense pattern. If that also passes, the proof discriminates nothing.
- **It never writes the ledger.** A checker that can edit its own input proves nothing.
- It emits a GATE line that tallies rows, so a row deleted to improve the figure lowers the
  total and is caught as a vanished check.

**Frozen evidence.** A measurement goes in a `research` or `exploration` doc: dated, findings
not instructions, body immutable after commit (`docs-lint.cjs` rule 8). Its figures are exempt
from the figure rule because they are the finding. State the method, the date, and what was not
verified.

**Untrusted content.** A doc whose `source:` declares external content must carry the
`⚠ UNTRUSTED` banner in its body, or the doc gate is red.

**Negative results get a field.** Spawn returns carry `ABSENT`, `NOT DONE` and `UNSURE`
([02](02-routing-and-the-spawn-contract.md)), and a handoff's integers must be cited
([03](03-tracks-handoffs-and-cross-session-memory.md)).

**Audit the harness like anything else:** an auditor per dimension, an independent verifier that
re-opens every citation and re-runs every command, then a ledger with a proof per finding.

## Why a mechanism and not a rule

- "Do not quote a stale figure" lost to convenience every time. The figure is now barred from
  the doc at write time and at gate time, so the only available source is the command.
- "Mark a finding closed when it is fixed" is an assertion by the person least able to doubt it.
  A proof command moves the closure from a claim to an exit code.
- The proofs themselves needed the same treatment. Reading them found nothing; running them
  found several to be wrong. Hence the negative control, executed at check time.
- The override rule is deliberately prose. It is the escape hatch that makes hard caps safe: an
  agent that must break a rule to do good work is told to do so, and to say so.

## The cost and the limits

- **Chat replies are unpoliced.** Every reporting rule's enforcement stops at the edge of the
  repo. Nothing scores a reply. In conversation these are rules, and are labelled as rules.
- **A proof is only as good as its author.** The negative control covers one vacuity pattern.
  A proof that greps for a string still passes when the string is in a comment.
- **Frozen means a wrong measurement stays wrong**, with a correction beside it, not over it.
- **A file-and-line citation rots.** Line numbers move. Only trap lines are checked, and only
  for the path, not the line.
- **The UNTRUSTED banner is a label.** It warns the reader. It sandboxes nothing.
- **This method's effect is itself unproven.** There is no control arm with the harness off.
  The claims in these docs are that specific failures stopped recurring, which is weaker than a
  measured improvement, and should be read as such.
- **Cost:** the ledger check costs what its proofs cost, each under a timeout, and needs a POSIX
  shell. On Windows that is the one Git provides; with none, every proof is an `ERROR` and red.
