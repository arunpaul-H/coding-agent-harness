---
id: project-reference-handoff
kind: handoff
status: open
read_when: "starting or resuming project-reference"
phase_next: 2
---

# Project reference docs: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 2: a doc that has drifted says so

Read, in this order:
  docs/tracks/project-reference/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/project-reference/plan.md     (Phase 2 only)
  docs/tracks/project-reference/traps.md    (before touching anything)
  docs/reference/DOC-STANDARD.md            (the frontmatter and linter-rule sections only)
  scripts/harness/guards/docs-lint.cjs      (search for last_verified, soft, applied; do not read it whole)
  tests/docs.test.js                        (search for the helper that builds a temp repo; not whole)
Nothing else unless a line below cites it.

SCOPE: in: two warnings in docs-lint.cjs (governed paths changed since last_verified; a
last_verified that is not a date), their tests in tests/docs.test.js, DOC-STANDARD.md and its
copy under templates/docs/reference/, and a re-baseline only if the docs gate total moved.
Out: bin/harness.js, the reference template, any hard failure, any skill, the root README, and
re-dating any doc to quiet a warning.

Do NOT re-derive, re-measure or re-open: the evidence is frozen in
docs/tracks/project-reference/research/2026-10-07-project-reference-docs.md. Do NOT re-run its
web search or its repo sweep. The locked decisions in README.md were settled on 2026-10-07; do not
re-litigate warn-not-block, opt-in per subsystem, or no content generated from code.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 and 1 are closed and committed on branch project-reference. Nothing is pushed.
  `harness reference new` and templates/reference/README.md exist; no reference doc was created in
  this repo, so the drift check's first real subjects are the docs already under docs/reference/.
  Both new checks WARN and exit 0. A warning may or may not be counted by the gate (traps.md REF-03):
  measure it before assuming. The doc standard sits one line under its cap, so an edit there must
  trade lines, not add them.
  The gate needs a second tolerated skip on a machine with no auto-memory index (traps.md REF-09),
  and the full suite outlasts a foreground limit (traps.md REF-10).
  Owed to the owner: a list of every warning the new checks print about this repo's own docs, not
  a fix for them. Phase 3's skill question waits on the owner.

First commit: `project-reference: warn when a doc's governed paths changed since it was verified`
Exit: `node --test && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

How to work: follow "How to work" in docs/tracks/project-reference/README.md. One phase, then stop
and hand off.
```
