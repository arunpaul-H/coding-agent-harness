---
id: worktrees-handoff
kind: handoff
status: open
read_when: "asking what the workspaces track left behind"
phase_next: 7
---

# Workspaces: the track is complete

## ▶ NOTHING IS LEFT TO BUILD

```
THE WORKSPACES TRACK IS COMPLETE. Every phase is closed, merged into the source branch, and
the gate baseline was re-recorded after it. Nothing here is an open task.

Read, only if you need to know what was built:
  docs/reference/branches/workspaces.md   (the reference: how to use a workspace)
  scripts/harness/worktree.js             (its header)

SCOPE: in: nothing. Out: everything. A follow-up is a new track with its own folder.

Do NOT reopen a phase here, and do NOT re-open the six locked decisions.
Do NOT re-run the measurement of what the agent's own worktree flag does: it is frozen.
Do NOT merge, push or remove a workspace from a script: a person does.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 5 are closed by close-phase.js and merged. The receipt in README.md's
  frontmatter names the last close.
  WHAT EXISTS: `harness worktree new|list|land|prune`, the announce note, the overlap warning,
  the session-start line, the routed worktree hook, and the installer carries all of it.
  WHAT WAS CHECKED AT CLOSE: every Delivered line in plan.md against the tree, and the
  script's own self-test.
  WHAT IS OWED: nothing by an agent. The owner may still adopt the parent-folder layout for
  this project (`node bin/harness.js doctor` prints the steps).

First commit: `tracks: close worktrees and project-reference`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in the track README if a question about this track comes up.
```
