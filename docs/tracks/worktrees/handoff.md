---
id: worktrees-handoff
kind: handoff
status: open
read_when: "starting or resuming worktrees"
phase_next: 5
---

# Workspaces: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 5: anyone who clones gets workspaces working, and the docs say how

You are in the workspace folder Agent-Harness-worktrees, on branch `worktrees`. Check with
`node scripts/harness/worktree.js --list` before anything else.

Read, in this order:
  docs/tracks/worktrees/README.md   (State, Locked decision 1, Invariant 3, How to work)
  docs/tracks/worktrees/plan.md     (Phase 5 only)
  docs/tracks/worktrees/traps.md    (WT-07 before correcting the reference doc)
  docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md   (section 2)
Run, and read the output instead of the code:
  node scripts/harness/worktree.js
  node bin/harness.js doctor
Nothing else unless a line below cites it. Find code by Grep, not by reading files whole.

SCOPE: in: the installer carrying the script, the hook entry and the ignore rule; `harness
doctor` reporting the layout; the workspace section of docs/reference/branches/README.md with
its wrong-tree trap corrected; one line in AGENTS.md; the root README quick start;
scripts/harness/common.json. Out: any new behaviour in worktree.js, any other coding agent.

Do NOT move a folder: `harness doctor` reports the layout and prints the steps, nothing more.
Do NOT claim support for a coding agent with no measured row in scripts/harness/tools.json.
Do NOT add more than one line to AGENTS.md: it has a hard line cap, and the context gate
measures it against scripts/harness/context-budget.json.
Do NOT re-measure which folder a hook sees: research file, section 2, and traps.md WT-07.
Do NOT re-open the six locked decisions in the README; the owner made four of them.
Do NOT edit scripts/harness/peers.js or wire its hook.
Do NOT flip a status: line by hand.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 4 are committed and closed by close-phase.js: the receipt in README.md's
  frontmatter names the last one. Nothing is pushed. Trust the receipt over this sentence.
  WHAT EXISTS: worktree.js with --new, --list, --land, --prune and --self-test; the four
  config keys; the worktree-create hook route; the announce note and the overview; the
  session-start line; `harness worktree new|list|land|prune`.
  WHAT IS STILL PROSE: an installed repo gets these only if the installer's file list reaches
  them; nothing tells a person which layout their checkout has outside --list and --new; the
  reference doc for branches still says a worktree may be checked by the wrong tree, which the
  research file did not reproduce for a session STARTED in the workspace; AGENTS.md and the
  root README do not mention workspaces.
  The installer and the health check are bin/harness.js; what it copies is driven by
  scripts/harness/common.json and by the registry rows. Run `node bin/harness.js --self-test`
  and `node bin/harness.js doctor` before the full suite: they fail faster.
  The gate baseline is NOT re-accepted in this phase: the suite stays green when tests are added.
  This machine has no git identity configured: a commit needs one passed on the command line.

First commit: `worktrees: ship workspaces to every repo the harness is installed into`
Exit: `node bin/harness.js doctor && node bin/harness.js gates --check`

How to work: follow "How to work" in the track README.
```
