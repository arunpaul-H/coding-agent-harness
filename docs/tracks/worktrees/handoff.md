---
id: worktrees-handoff
kind: handoff
status: open
read_when: "starting or resuming worktrees"
phase_next: 3
---

# Workspaces: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 3: workspaces announce themselves, and the overview warns of overlap before a merge does

You are in the workspace folder Agent-Harness-worktrees, on branch `worktrees`. Check with
`node scripts/harness/worktree.js --list` before anything else.

Read, in this order:
  docs/tracks/worktrees/README.md   (State, Locked decisions 2 and 3, Invariants, How to work)
  docs/tracks/worktrees/plan.md     (Phase 3 only)
  docs/tracks/worktrees/traps.md    (before touching anything)
Run, and read the output instead of the code:
  node scripts/harness/worktree.js
  node scripts/harness/worktree.js --self-test
Nothing else unless a line below cites it. Find code by Grep, not by reading files whole.

SCOPE: in: the announce note a plain task gets, `--list` as an overview read from git, the
overlap report, and one session-start reporter line. Out: landing, pruning, the installer, the
reference docs, any other coding agent.

Do NOT re-measure what the agent's worktree flag or its WorktreeCreate hook does: research file.
Do NOT re-measure the brace spelling of the project-directory variable: traps.md WT-01.
Do NOT re-open the six locked decisions in the README; the owner made four of them.
Do NOT rewrite create(), decideLayout() or decideCarry() in scripts/harness/worktree.js: extend.
Do NOT add a tracked file that more than one branch writes (invariant 2): one note per task.
Do NOT make the overlap report block anything: it reports, and a person decides.
Do NOT edit scripts/harness/peers.js or wire its hook.
Do NOT run a second agent session inside this repo; a test builds a throwaway repo.
Do NOT push, merge or flip a status: line by hand.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0, 1 and 2 are committed and closed by close-phase.js: the receipt in README.md's
  frontmatter names the last one. Nothing is pushed. Trust the receipt over this sentence.
  WHAT EXISTS: worktree.js with --new, --track, --from, --list and --self-test; the config keys
  worktrees.root, branchPrefix, carry and setup, all defaulted; fromHook() and the
  `worktree-create` route in scripts/harness/hook.js, honoured for a registry row whose
  `worktreeCreate` cell is true; that entry in .claude/settings.json; brace-spelled hook commands.
  WHAT IS STILL PROSE: nothing says who is working where; --list shows folders on THIS computer
  only and reads no note; nothing reports two branches changing one file; the session-start
  reporters do not mention workspaces; the local settings file is carried only if a repo lists it
  (WT-03); no live session has run the agent's flag through this repo's own hook entry.
  The session-start reporters are an ordered list in scripts/harness/hook.js (HANDLERS), and its
  self-test pins their names in order: a new reporter changes that list in both places.
  A note is read with `git show <branch>:<path>`, so it covers a branch with no local folder.
  The gate baseline is NOT re-accepted in this phase: the suite stays green when tests are added.
  This machine has no git identity configured: a commit needs one passed on the command line.

First commit: `worktrees: an overview read from git, with an early overlap warning`
Exit: `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

How to work: follow "How to work" in the track README.
```
