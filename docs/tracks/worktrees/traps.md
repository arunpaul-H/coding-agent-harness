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
| **WT-01** | A hook command spelled with the bare dollar form of the project-directory variable resolves to nothing when the agent launches hooks under PowerShell: the hook dies with a module-not-found at the drive root and every guard is silently absent. The brace form works in both shells: measured 2026-10-08 with both spellings registered side by side in one session, the brace one ran and the bare one died. Every command here and the dialect's rendering now use braces, and a test holds them to it; a hook written by hand elsewhere can still get it wrong. | `.claude/settings.json` |
| **WT-02** | The agent's own worktree flag puts the folder INSIDE the repo under its dot-directory, and the main checkout then shows it as untracked unless an ignore rule names it. The hygiene check reads that as a stray. This repo routes the flag by hook and ignores the folder; a repo that has done neither still hits this. | `.gitignore` |
| **WT-03** | A `WorktreeCreate` hook replaces creation entirely. The agent stops copying the ignored local settings file into the new folder, so a workspace made through the hook starts without one person's permissions unless the script carries them. | `docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md` |
| **WT-04** | The secret-file guard denies ANY shell command that names a guarded env file, including one that only creates a dummy in a throwaway repo. A test fixture needs a different ignored filename. | `scripts/harness/guards/env-guard.cjs` |
| **WT-05** | The local source branch can sit far behind the remote one. A workspace cut from the local name starts on a stale harness; cut from the remote ref, or fetch first. This branch was first cut stale and had to be moved. | `docs/reference/branches/README.md` |
| **WT-07** | A session started in one folder that commits in ANOTHER (`git -C`, or a `cd` first) has its commit guard read the session's own folder. With a merge staged there, a clean docs commit here was refused as a re-baseline. Measured 2026-10-08; the retry passed only after the form of the command changed, and why was not isolated. Start the session in the folder it commits in. | `scripts/harness/guards/commit-hygiene.cjs` |
| **WT-06** | A non-interactive agent run leaves its workspace entry locked and does not remove it. `git worktree remove` refuses a locked entry until it is unlocked, so a prune step that ignores locks removes nothing. | `docs/tracks/worktrees/research/2026-10-08-what-claude-worktree-does-here.md` |
| **WT-08** | The hook route has no `--from`. It cuts from the detected source branch, where the agent's own default cuts from the commit the main checkout is on. A repo on a branch with none of the usual names and no remote gets a refusal ("no source ref") from the flag until `project.sourceBranch` is set; a test fixture on such a branch fails the same way. | `scripts/harness/worktree.js` |
| **WT-09** | A `WorktreeCreate` hook's stdout is read whole as the folder path. One stray line there (a setup command's output, a log line) and the agent starts in a folder that does not exist. Everything but the path goes to stderr, and the setup command's own stdout is redirected there. | `scripts/harness/hook.js` |
