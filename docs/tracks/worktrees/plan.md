---
id: worktrees-plan
kind: plan
status: open
read_when: "worktrees: the phases, each with its exit command and first commit"
first_commit: "worktrees: land and prune a workspace, refusing whatever would lose work"
---

# Workspaces: the phases

Each phase ends with its exit command run and its output pasted; one that cannot close says so
and stops. Read `README.md` **How to work** first, and `traps.md` before touching anything.
The order follows dependence: creation, readiness, the overview, landing (it reuses the
overview's reading of each branch), and packaging last so an adopter gets only what was proven.

## Phase 0: evidence for what the agent's own flag does

Closed. Measured in a throwaway repo and frozen as a research file; no code.
**First commit:** `worktrees: open the track with measured evidence`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/handoff-lint.js worktrees`

**Delivered.** `research/2026-10-08-what-claude-worktree-does-here.md`. Deviations: the docs
lookup went to a read-only agent; the lead ran the measurements, as that agent has no shell.

## Phase 1: create and list workspaces with one command

Closed. A workspace was made by hand, with a hand-picked path and a branch cut from whichever
ref was nearest (WT-05).
**First commit:** `worktrees: create and list workspaces with one command`
**Exit:** `node scripts/harness/worktree.js --self-test && node bin/harness.js gates --check`

**Delivered.** `scripts/harness/worktree.js` (`--new`, `--track`, `--from`, `--list`, `--self-test`),
the `worktrees` config section with both keys defaulted, its schema, `harness worktree new|list`
and `tests/worktree.test.js`. Deviations: the source ref repeats `branch-sync.js`'s pick with
its imported `decideSource`, as that file's resolver is bound to its own root; a root inside ANY
checkout is refused, unasked; the bare-repo layout is a pure decision, no bare repo was built;
the "start an agent" line names no program; this repo's own config gained no section.

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

**Delivered.** `worktrees.carry` and `worktrees.setup` (loader, schema, both empty by default);
`decideCarry()` and `fromHook()` in `worktree.js`; the `worktree-create` route in `hook.js`; the
`worktreeCreate` registry cell, true for one row; the entry in the dialect's wiring and in
`.claude/settings.json`; the brace spelling in every hook command; the ignore rule. Deviations:
a guarded carry path refuses the whole `--new` instead of being skipped; a failing setup keeps
the folder (`--new` exits 1, the hook route still answers with the path); the route is a fifth
event with no handler list and a longer timeout; it cuts from the source branch, not `HEAD`
(WT-08); the local settings file is NOT carried by default (WT-03); the brace form was measured
under PowerShell first (WT-01); no live session ran the flag through this repo's own entry.

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

**Delivered.** `--new` writes `<docsRoot>/workspaces/<name>.md` for a plain task (`--doing` is its
line); `--list` reads each branch's note with `git show`, lists announced branches with no folder
here, and reports files changed on two or more branches; a fifth session-start reporter names
sibling checkouts. Deviations: the note is found among the files a branch CHANGED, so a track
under another name than its branch is still read; the note is written, not committed (an
uncommitted one is read off its folder and said so); the hook route writes no note; the docs
index skips the notes folder, an edit to `docs-index.js` the work list did not name; the note's
`kind` is `design`, the nearest in the enum; the reporter line does not run the overlap diff.

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
