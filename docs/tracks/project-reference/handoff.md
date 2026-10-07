---
id: project-reference-handoff
kind: handoff
status: open
read_when: "starting or resuming project-reference"
phase_next: 3
---

# Project reference docs: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 3: one measurement, then tell the adopter the truth

Read, in this order:
  docs/tracks/project-reference/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/project-reference/plan.md     (Phase 3 only)
  docs/tracks/project-reference/traps.md    (before touching anything)
  docs/reference/routing/README.md          (the spawn contract; the lead only)
  README.md                                 (the root one: its headings, to place one short section)
Nothing else unless a line below cites it.

SCOPE: in: one reference doc made with `harness reference new` and filled by hand, one task run
by two fresh agents on the same model with the same prompt (one tree with the doc, one without),
a dated research file in this track, and a short adopter section in the root README.
Out: bin/harness.js, docs-lint.cjs, any skill, archiving the track, and keeping the experiment's
doc unless this repo needs it as a real contract.

Do NOT re-derive, re-measure or re-open: the evidence is frozen in
docs/tracks/project-reference/research/2026-10-07-project-reference-docs.md. Do NOT re-run its
web search or its repo sweep. The locked decisions in README.md were settled on 2026-10-07; do not
re-litigate them. Decision 6, the interview skill, is the owner's: put the question, do not answer it.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 2 are closed and committed on branch project-reference. Nothing is pushed.
  The command and both warnings exist. This repo's own docs draw drift warnings; they were left
  alone on purpose and are not this phase's to quiet.
  Record for each run: tokens, tool calls, files opened, and whether the answer was correct, taken
  from the agent's own usage report. One pair is an observation, not proof: the file must say so.
  A new doc under the docs root reds the index check until the index is regenerated, and again
  when the doc is deleted (traps.md REF-04). A research file is frozen once committed.
  The gate needs a second tolerated skip on a machine with no auto-memory index (traps.md REF-09).
  Owed to the owner: the measurement, and the decision 6 question with it. Do not archive the track.

First commit: `project-reference: measure one task with and without a reference doc`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in docs/tracks/project-reference/README.md. One phase, then stop
and hand off.
```
