---
id: worktrees-traps
kind: traps
status: open
read_when: "something behaves oddly while working on worktrees"
trap_prefix: WT
---

# Workspaces: durable traps

Every one of these was measured while doing this track's work. A trap here is a thing that will
cost an hour again if it is not read first.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| **WT-01** | A hook command spelled with the bare dollar form of the project-directory variable resolves to nothing when the agent launches hooks under PowerShell: the hook dies with a module-not-found at the drive root and every guard is silently absent. The brace form works in both shells. Both commands here use the bare form. | `.claude/settings.json` |
| **WT-02** | The agent's own worktree flag puts the folder INSIDE the repo under its dot-directory, and the main checkout then shows it as untracked because no ignore rule names it. The hygiene check reads that as a stray. | `.gitignore` |
| **WT-03** | A `WorktreeCreate` hook replaces creation entirely. The agent stops copying the ignored local settings file into the new folder, so a workspace made through the hook starts without one person's permissions unless the script carries them. | `docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md` |
| **WT-04** | The secret-file guard denies ANY shell command that names a guarded env file, including one that only creates a dummy in a throwaway repo. A test fixture needs a different ignored filename. | `scripts/harness/guards/env-guard.cjs` |
| **WT-05** | The local source branch can sit far behind the remote one. A workspace cut from the local name starts on a stale harness; cut from the remote ref, or fetch first. This branch was first cut stale and had to be moved. | `docs/reference/branches/README.md` |
| **WT-06** | A non-interactive agent run leaves its workspace entry locked and does not remove it. `git worktree remove` refuses a locked entry until it is unlocked, so a prune step that ignores locks removes nothing. | `docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md` |
