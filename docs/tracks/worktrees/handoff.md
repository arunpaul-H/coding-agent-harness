---
id: worktrees-handoff
kind: handoff
status: open
read_when: "starting or resuming worktrees"
phase_next: 6
---

# Workspaces: the next step

## ▶ THE NEXT SESSION: paste this into a new chat

```
AFTER PHASE 5: re-baseline the gates, then archive the track

You are in the workspace folder Agent-Harness-worktrees, on branch `worktrees`. Check with
`node scripts/harness/worktree.js --list` before anything else.

Read, in this order:
  docs/tracks/worktrees/README.md   (State: every phase must read closed)
  docs/reference/DOC-STANDARD.md    (section 6: closing, and the archive route)
Nothing else. No code changes in this step.

SCOPE: in: one re-baseline commit, a final handoff saying the track is complete, the archive
through close-phase.js. Out: any change to a script, a test or a reference doc; merging; pushing.

Do NOT move the track folder or flip a status: line by hand: close-phase.js --archive does both.
Do NOT stage anything beside scripts/harness/gates.baseline.json in the re-baseline commit, and
start its subject with `gates:`.
Do NOT merge `worktrees` into the source branch, push, or remove a workspace: the owner does.
Do NOT re-open the six locked decisions in the README.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 5 are committed and closed by close-phase.js: the receipt in README.md's
  frontmatter names the last one. Nothing is pushed. Trust the receipt over this sentence.
  WHAT EXISTS: everything the plan lists, and the installer carries it. See README.md State.
  WHAT IS OWED: the gate baseline predates the tests the last four phases added, so the suite
  is green against it only because more checks than the baseline is not a violation.
  The owner is owed: merging `worktrees` into the source branch, pushing, and adopting the
  parent-folder layout for this project (`node bin/harness.js doctor` prints the steps).
  This machine has no git identity configured: a commit needs one passed on the command line.

First commit: `gates: re-baseline after the workspace phases`
Exit: `node bin/harness.js gates --check`

How to work: follow "How to work" in the track README.
```
