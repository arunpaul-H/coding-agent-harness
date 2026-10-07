---
id: project-reference-handoff
kind: handoff
status: open
read_when: "starting or resuming project-reference"
phase_next: 1
---

# Project reference docs: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 1: a doc for a named subsystem, in one command

Read, in this order:
  docs/tracks/project-reference/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/project-reference/plan.md     (Phase 1 only)
  docs/tracks/project-reference/traps.md    (before touching anything)
  templates/track/README.md                 (the placeholder style to copy)
  bin/harness.js                            (search for TRACK_TEMPLATES, render, cmdInit; do not read it whole)
Nothing else unless a line below cites it.

SCOPE: in — templates/reference/README.md, the `harness reference new <subsystem>` command in
bin/harness.js, init copying that one template, and the self-test and test cases for all three.
Out — docs-lint.cjs, any drift or staleness check, any skill, any prompt, the root README, and
creating a reference doc in this repo.

Do NOT re-derive, re-measure or re-open: the evidence is frozen in
docs/tracks/project-reference/research/2026-10-07-project-reference-docs.md — do NOT re-run its
web search or its repo sweep. The locked decisions in README.md were settled on 2026-10-07; do not
re-litigate opt-in per subsystem, no fixed doc list, no content generated from code, or
warn-not-block.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phase 0 wrote the research file and this folder. Nothing is committed; the branch is
  project-reference, cut from main. No code has changed.
  The command's flags, refusals and output path are specified in plan.md Phase 1; build exactly
  those. --read-when and --paths are required, and the date written is today's (traps.md REF-02).
  A template is registered by hand in several places; traps.md REF-05 names every one.
  The rendered doc must pass docs-lint in a temp repo, inside a test (traps.md REF-07).
  Owed to the owner: a commit of phase 0, when asked. Phase 3's skill question waits on the owner.

First commit: `project-reference: a reference template and harness reference new`
Exit: `node bin/harness.js --self-test && node --test`

How to work: follow "How to work" in docs/tracks/project-reference/README.md. One phase, then stop
and hand off.
```
