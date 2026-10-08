---
id: worktrees-plan
kind: plan
status: open
read_when: "worktrees: the phases, each with its exit command and first commit"
first_commit: "worktrees: create and list workspaces with one command"
---

# Workspaces: the phases

One phase per session. Each ends with its exit command run in the foreground and its output
pasted. A phase that cannot close says so and stops. Read `README.md` **How to work** before
starting any of them, and `traps.md` before touching anything.

The order follows dependence. Creation comes first because every later phase needs a folder to
act on. Readiness comes before the overview because an unready folder is where a first run
fails. Landing comes after the overview because it reuses the overview's reading of each branch.
Packaging is last so an adopter receives only what was proven here.

## Phase 0: evidence for what the agent's own flag does

**Problem.** The design assumed where the flag puts a folder and which folder a hook sees.
`docs/reference/branches/README.md` Traps claimed hooks check the wrong tree.

**Do.** Measure it in a throwaway repo and freeze the result as a research file.

**Do NOT.** Write code, or run a second agent session inside this repo.

**First commit:** `worktrees: open the track with measured evidence`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/handoff-lint.js worktrees`

**Delivered.** `research/2026-10-08-what-claude-worktree-does-here.md`, written and uncommitted.
Deviations: the docs lookup was delegated to a read-only agent, and the lead ran the measurements
itself because the research agent has no shell. Not closed: nothing is committed.

## Phase 1: create and list workspaces with one command

**Problem.** A workspace is made by hand today, with a hand-picked path and a branch cut from
whichever ref was nearest (WT-05).

**Do.**
- `scripts/harness/worktree.js`: `--new <name> [--track]`, `--list`, `--self-test`.
- `--new` resolves the root (parent layout when the repo sits in a workspace parent, else the
  sibling `<repo>.worktrees/`), cuts the branch from the source ref that `branch-sync.js`
  already detects, refuses an existing name, and prints the folder plus the command to start an
  agent in it. Under the sibling layout it also prints the one-line parent-layout advice.
- `--track` copies `templates/track/` into the new folder's tracks directory.
- `worktrees.root` and `worktrees.branchPrefix` in `harness.config.json`, both optional with
  derived defaults; the schema; `config.js` validation.
- `harness worktree` in `bin/harness.js`; tests under `tests/` that build a throwaway repo.

**Do NOT.** Copy ignored files, run a setup command or register a hook: phase 2. Do not touch
`scripts/harness/peers.js` (README, What this is).

**First commit:** `worktrees: create and list workspaces with one command`
**Exit:** `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

**Delivered.** not started

## Phase 2: a new folder is ready to work in

**Problem.** A fresh folder lacks every ignored file (research, section 3), an adopter's repo
needs an install step, and the agent's own flag lands somewhere else (WT-02, WT-03).

**Do.**
- `worktrees.carry` (ignored paths copied in, never a guarded env file without a dated
  carve-out) and `worktrees.setup` (one command run in the new folder); both default empty.
- A `WorktreeCreate` entry in `scripts/harness/hook.js` and the tool registry that hands the
  agent's flag to `worktree.js`, so both routes land in one root.
- Spell the project-directory variable in the brace form in every hook command (WT-01), on the
  source branch, with the installer's copy.
- The ignore rule for the agent's default folder, for a repo that has not wired the hook.

**Do NOT.** Carry a file the secret guard denies. Do not wire the peers hook.

**First commit:** `worktrees: make a new workspace ready and route the agent's own flag to it`
**Exit:** `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

**Delivered.** not started

## Phase 3: workspaces announce themselves and the overview warns of overlap

**Problem.** Isolation hides a collision until merge, and nothing says who is working where.

**Do.**
- The announce note: for a track, its `handoff.md`; for a plain task, one note file named for
  the task under the docs root, written by `--new` as the branch's first commit content.
- `--list` becomes the overview: every branch with a note, read from git, with folder, branch,
  what it is doing and the next phase. It covers a remote branch with no local folder.
- The overlap warning: files changed against the source branch on two or more branches. Report
  only; it never blocks.
- A session-start reporter line naming sibling workspaces, silent when there are none.

**Do NOT.** Add a tracked file more than one branch writes (invariant 2).

**First commit:** `worktrees: an overview read from git, with an early overlap warning`
**Exit:** `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

**Delivered.** not started

## Phase 4: land and remove a workspace safely

**Problem.** A finished workspace is removed by hand, and a hand removal can lose uncommitted or
unmerged work. A non-interactive run leaves a locked entry (WT-06).

**Do.**
- `--land <name>`: refuse unless the folder is clean, the gate verdict is green at its HEAD and
  the branch is merged into the source; otherwise print the merge command and stop. Once merged,
  remove the plain-task note, the folder and the branch.
- `--prune`: list entries whose folder is gone or whose branch is merged; remove only with an
  explicit flag, and name a locked entry instead of skipping it silently.

**Do NOT.** Merge, push, force or delete an unmerged branch (invariant 1).

**First commit:** `worktrees: land and prune a workspace, refusing whatever would lose work`
**Exit:** `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

**Delivered.** not started

## Phase 5: anyone who clones gets it working

**Problem.** The feature exists only in this repo's tree until the installer and the docs carry it.

**Do.**
- `harness init` copies the script, the config keys, the hook entry and the ignore rule.
- The parent layout for a new download: the documented clone-into-`main` shape, detected by
  `worktree.js`; `harness doctor` reports the layout and, under the sibling one, the steps to
  adopt the parent one. It never moves a folder itself.
- A workspace section in `docs/reference/branches/README.md`, correcting its wrong-tree trap
  against the research file; one line in `AGENTS.md`; the root `README.md` quick start.
- `scripts/harness/common.json` lists the new common files.

**Do NOT.** Claim support for a coding agent with no measured row in `scripts/harness/tools.json`.

**First commit:** `worktrees: ship workspaces to every repo the harness is installed into`
**Exit:** `node bin/harness.js doctor && node bin/harness.js gates --check`

**Delivered.** not started
