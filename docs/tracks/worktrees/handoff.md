---
id: worktrees-handoff
kind: handoff
status: open
read_when: "starting or resuming worktrees"
phase_next: 2
---

# Workspaces: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 2: a new workspace is ready to work in, and the agent's own flag lands in the same place

You are in the workspace folder Agent-Harness-worktrees, on branch `worktrees`. Check with
`node scripts/harness/worktree.js --list` before anything else.

Read, in this order:
  docs/tracks/worktrees/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/worktrees/plan.md     (Phase 2 only)
  docs/tracks/worktrees/traps.md    (before touching anything)
  docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md   (sections 3, 4, 4b)
Run, and read the output instead of the code:
  node scripts/harness/worktree.js
  node scripts/harness/worktree.js --self-test
Nothing else unless a line below cites it. Find code by Grep, not by reading files whole.

SCOPE: in: the two config keys `worktrees.carry` and `worktrees.setup`, a WorktreeCreate entry
that hands the agent's flag to worktree.js, the brace spelling of the project-directory variable
in every hook command, and the ignore rule for the agent's default folder. Out: the overview,
the announce note, landing, pruning, the installer, any other coding agent.

Do NOT re-measure what the agent's worktree flag or its WorktreeCreate hook does: research file.
Do NOT re-open the six locked decisions in the README; the owner made four of them.
Do NOT rewrite create() or decideLayout() in scripts/harness/worktree.js: extend them.
Do NOT carry a guarded env file into a workspace without a dated carve-out (invariant: the
secret guard's stance is unchanged), and do not name one in a shell command (WT-04).
Do NOT edit scripts/harness/peers.js or wire its hook.
Do NOT run a second agent session inside this repo; a test builds a throwaway repo.
Do NOT commit, push, merge or flip a status: line unless the owner asks.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 and 1 are committed and closed by close-phase.js: the receipt in README.md's
  frontmatter names the last one. Nothing is pushed. Trust the receipt over this sentence.
  WHAT EXISTS: scripts/harness/worktree.js with --new, --track, --from, --list and --self-test;
  the `worktrees` config section (root, branchPrefix), both defaulted; `harness worktree
  new|list`; tests/worktree.test.js. The gate baseline was re-accepted after the new tests.
  WHAT IS STILL PROSE: nothing is copied into a new folder and no setup runs; the agent's own
  flag still lands inside the repo (WT-02); no hook is registered; the bare-repo layout is a
  pure decision that no real bare repo has exercised.
  The hook entry point is scripts/harness/hook.js, one registration per event, and the events
  a tool has are rows of scripts/harness/tools.json read through scripts/harness/dialects/.
  A WorktreeCreate hook must print the folder path ALONE on stdout: anything else on stdout is
  read as part of the path (research file, section 4).
  A session started outside this folder has its commit guard read the other folder (WT-07).
  This machine has no git identity configured: a commit needs one passed on the command line.

First commit: `worktrees: make a new workspace ready and route the agent's own flag to it`
Exit: `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
