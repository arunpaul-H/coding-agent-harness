---
id: worktrees-handoff
kind: handoff
status: open
read_when: "starting or resuming worktrees"
phase_next: 4
---

# Workspaces: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 4: land and remove a workspace safely, refusing whatever would lose work

You are in the workspace folder Agent-Harness-worktrees, on branch `worktrees`. Check with
`node scripts/harness/worktree.js --list` before anything else.

Read, in this order:
  docs/tracks/worktrees/README.md   (State, Locked decision 4, Invariant 1, How to work)
  docs/tracks/worktrees/plan.md     (Phase 4 only)
  docs/tracks/worktrees/traps.md    (WT-06 and WT-10 before touching anything)
Run, and read the output instead of the code:
  node scripts/harness/worktree.js
  node scripts/harness/worktree.js --self-test
Nothing else unless a line below cites it. Find code by Grep, not by reading files whole.

SCOPE: in: `--land <name>` and `--prune`, each refusing a dirty folder, an unmerged branch and
a locked entry by name. Out: merging, pushing, the installer, the reference docs, any other
coding agent.

Do NOT merge, push, force-remove a dirty folder or delete an unmerged branch (invariant 1).
Do NOT skip a locked entry silently: name it and say how to unlock it (traps.md WT-06).
Do NOT re-measure what a non-interactive agent run leaves behind: research file, section 1.
Do NOT re-open the six locked decisions in the README; the owner made four of them.
Do NOT rewrite create(), decideLayout(), decideCarry() or list() in worktree.js: extend them.
Do NOT edit scripts/harness/peers.js or wire its hook.
Do NOT run a second agent session inside this repo; a test builds a throwaway repo.
Do NOT flip a status: line by hand.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 3 are committed and closed by close-phase.js: the receipt in README.md's
  frontmatter names the last one. Nothing is pushed. Trust the receipt over this sentence.
  WHAT EXISTS: worktree.js with --new (--track, --from, --doing), --list as the overview, and
  --self-test; the config keys root, branchPrefix, carry and setup; the worktree-create hook
  route; the plain-task note under the docs root's `workspaces` folder; the overlap report; a
  session-start line naming sibling checkouts.
  WHAT IS STILL PROSE: a finished workspace is removed by hand; nothing checks that a folder is
  clean or its branch merged before it goes; a stale or locked entry stays until someone runs
  git by hand; the plain-task note is not removed by anything.
  list() already reads each branch's note and its changed files against the source ref: landing
  reuses that reading and sourceRef() for "merged into the source".
  The gate verdict for a HEAD is the file scripts/harness/gates.json in THAT folder: it records
  the commit it was run at, whether the tree was dirty, and whether it was green.
  The gate baseline is NOT re-accepted in this phase: the suite stays green when tests are added.
  This machine has no git identity configured: a commit needs one passed on the command line.

First commit: `worktrees: land and prune a workspace, refusing whatever would lose work`
Exit: `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

How to work: follow "How to work" in the track README.
```
