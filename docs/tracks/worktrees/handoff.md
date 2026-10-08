---
id: worktrees-handoff
kind: handoff
status: open
read_when: "starting or resuming worktrees"
phase_next: 1
---

# Workspaces: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 1: create and list workspaces with one command

You are in the workspace folder Agent-Harness-worktrees, on branch `worktrees`. Check with
`git worktree list` before anything else; do not work on this track from another folder.

Read, in this order:
  docs/tracks/worktrees/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/worktrees/plan.md     (Phase 1 only)
  docs/tracks/worktrees/traps.md    (before touching anything)
  docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md   (sections 1 to 4)
Nothing else unless a line below cites it. Find code by Grep, not by reading files whole.

SCOPE: in: scripts/harness/worktree.js with --new, --list and --self-test, its two optional
config keys, the schema, the `harness worktree` subcommand and tests. Out: carried files, the
setup command, any hook registration, the overview, landing, the installer.

Do NOT re-measure what the agent's worktree flag does: it is in the research file.
Do NOT re-open the six locked decisions in the README; the owner made four of them.
Do NOT edit scripts/harness/peers.js or wire its hook.
Do NOT run a second agent session inside this repo; a test builds a throwaway repo.
Do NOT name a guarded env file in a shell command, even as a fixture (WT-04).
Do NOT commit, push, merge or flip a status: line unless the owner asks.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phase 0 wrote the research file and this track folder, is committed, and was closed by
  close-phase.js on 2026-10-08: the receipt is in README.md's frontmatter. Nothing is pushed.
  A session started OUTSIDE this folder has its commit guard read the other folder (WT-07):
  start the session here.
  The branch was cut from origin/main; the local source branch was stale (WT-05).
  Measured, and safe to build on: a session started in a workspace resolves its OWN folder in
  hooks; a WorktreeCreate hook can place the folder anywhere. Both are phase 2's business.
  The source ref is already detected by scripts/harness/branch-sync.js: reuse it, do not write
  a second detector.
  The git common directory is already resolved without a subprocess in
  scripts/harness/peers.js (resolveRegistry): reuse the approach, do not import the registry.

First commit: `worktrees: create and list workspaces with one command`
Exit: `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
