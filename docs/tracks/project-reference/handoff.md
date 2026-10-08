---
id: project-reference-handoff
kind: handoff
status: open
read_when: "starting or resuming project-reference"
phase_next: 4
---

# Project reference docs: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 4: the owner decides, then the track archives or grows one phase

Read, in this order:
  docs/tracks/project-reference/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/project-reference/research/2026-10-08-one-task-with-and-without-a-reference-doc.md
  docs/tracks/project-reference/traps.md    (before touching anything)
Nothing else unless a line below cites it.

SCOPE: in: once the owner has merged the pull request and said so, archiving the track through
close-phase.js, or planning one further phase if the owner reopens README decision 6.
Out: building any skill before the owner answers, re-running the measurement, re-dating any doc
to quiet a drift warning, and touching bin/harness.js or docs-lint.cjs.

Do NOT re-derive, re-measure or re-open: the measurement is frozen in the research file named
above and the earlier evidence in
docs/tracks/project-reference/research/2026-10-07-project-reference-docs.md. Do NOT re-run either.
One pair of runs is an observation, not proof; do not quote it as more.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 3 are closed and committed on branch project-reference. The branch is pushed and a
  pull request is open; the merge is the owner's.
  The command, the template, both warnings and the root README section exist. The experiment's
  doc was deleted. The track README carries blocked_on, so the index lists it as waiting.
  The root README links to the measurement inside this track folder; archiving moves that file,
  so the link must be repointed in the same change (traps.md REF-04 covers the index half).
  This repo's own docs draw drift warnings. Re-verifying them is a separate job nobody has taken.
  The gate needs a second tolerated skip on a machine with no auto-memory index (traps.md REF-09).
  Decision 6 is answered: no interview skill now. After phase 3 the gate command in the policy
  file was corrected and six over-wide `paths` lists were narrowed; no doc was re-dated.
  Owed to the owner: nothing. Owed by the owner: the merge, and whether to archive.

First commit: `project-reference: archive the track`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js project-reference`

How to work: follow "How to work" in docs/tracks/project-reference/README.md. One phase, then stop
and hand off.
```
