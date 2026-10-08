---
id: project-reference-handoff
kind: handoff
status: open
read_when: "asking what the project-reference track left behind"
phase_next: 5
---

# Project reference docs: the track is complete

## ▶ NOTHING IS LEFT TO BUILD

```
THE PROJECT-REFERENCE TRACK IS COMPLETE. Every phase is closed and merged into the source
branch, and the owner said to close it. Nothing here is an open task.

Read, only if you need to know what was built:
  templates/reference/README.md   (the shape `harness reference new` renders)
  docs/reference/DOC-STANDARD.md  (section 5: the drift warning)

SCOPE: in: nothing. Out: everything. A follow-up is a new track with its own folder.

Do NOT reopen a phase here. Decision 6 stands: no drafting or interview skill.
Do NOT re-run either measurement: both research files are frozen.
Do NOT re-date a doc to quiet a drift warning: re-verify it, then re-date it.
One pair of runs is an observation, not proof; do not quote it as more.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 3 are closed by close-phase.js and merged. The receipt in README.md's
  frontmatter names the last close.
  WHAT EXISTS: `harness reference new <subsystem>`, its template, the paths-against-history
  drift warning, the unreadable-date warning, and the adopter section of the root README.
  WHAT WAS CHECKED AT CLOSE: every Delivered line in plan.md against the tree.
  WHAT IS STILL TRUE: this repo's own docs draw drift warnings. Re-verifying them is a
  separate job nobody has taken, and it is not this track's.
  WHAT IS OWED: nothing.

First commit: `tracks: close worktrees and project-reference`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in docs/tracks/project-reference/README.md if a question comes up.
```
