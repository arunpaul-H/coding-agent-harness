---
id: branches-workspaces
kind: reference
status: open
read_when: "running more than one agent in this project on one computer, or creating, listing, landing or removing a workspace folder"
paths: ["scripts/harness/worktree.js", "scripts/harness/hook.js", ".claude/settings.json", ".gitignore"]
verify: "node scripts/harness/worktree.js --self-test"
last_verified: 2026-10-08
max_age_days: 90
---

# Workspaces: one folder per agent

Two sessions in one folder trip over each other's unfinished files, and a shared dirty tree blocks
every phase close. A workspace is a git worktree: a folder on its own branch over one shared
history. `scripts/harness/worktree.js` decides where it goes, what it is cut from and what it is
called, so nobody decides those from memory. Run it bare for the usage; `harness worktree <verb>`
spells the same flags.

## The four commands

| Command | What it does | What it refuses |
|---|---|---|
| `--new <name> [--track] [--doing "..."]` | a folder and a branch of that name, cut from the source branch; copies in `worktrees.carry`, runs `worktrees.setup`; writes the announce note | a name in use, a root inside any checkout, a carried path the secret guard guards |
| `--list` | every checkout and what its branch says it is doing, read from git; announced branches with no folder here; files changed on two or more branches | nothing: the overlap list is a report |
| `--land <name>` | unmerged: prints the merge command and removes nothing. Merged: removes the folder and the branch, stages the removal of the note | a dirty folder, a locked entry, an unmerged branch not shown green at its commit |
| `--prune [--yes]` | lists entries whose folder is gone or whose branch is merged; removes them only with `--yes` | a locked, dirty or brand-new entry is named and kept |

Nothing here merges, pushes, force-removes a dirty folder or deletes an unmerged branch. A person
runs the merge.

## Where the folder goes

- **Parent layout.** The project was cloned as `git clone <url> <project>/main`. Every workspace is
  a sibling of `main/` inside `<project>/`. This is the shape to use for a new download.
- **Sibling layout.** A plain clone, which nothing moves. Workspaces go in `<repo>.worktrees/`
  beside it. `harness doctor` and `--new` print the three steps to adopt the parent layout.
- **Configured.** `worktrees.root` in `harness.config.json`, resolved against the main checkout.

A root inside any checkout is refused: a second copy of every test and doc under the tree would be
graded by the first tree's gates and listed as a stray by its hygiene check.

## How a workspace says what it is doing

A track's `handoff.md` is its note. A plain task gets one file, `<docsRoot>/workspaces/<name>.md`,
written by `--new`; commit it first, because `--list` reads notes out of git and an uncommitted one
is invisible from every other folder. No shared list exists: a file every branch edits conflicts
at every merge. The docs index skips that folder for the same reason.

## The agent's own worktree flag

Claude Code's `--worktree` flag is routed to the same script by the `WorktreeCreate` entry in
`.claude/settings.json`, so both routes land in one root. That route writes no note, and the agent
stops copying its ignored local settings file once the hook exists: list it in `worktrees.carry`
if a workspace should start with it. Only the registry row with `worktreeCreate: true` in
`scripts/harness/tools.json` is routed; no other coding agent's flag has been measured.

## Traps

- **Start the agent IN the workspace folder.** Its hooks then check that folder. A session started
  elsewhere that commits there has its commit guard read the wrong tree.
- **A fresh folder holds tracked files only.** Installed packages and local settings are absent
  until `worktrees.carry` or `worktrees.setup` supplies them.
- **An empty overlap report is not a clean merge.** It compares against the source ref as last
  fetched, and only branches with a folder here or a note.
- **A non-interactive agent run leaves its entry locked.** `--land` and `--prune` name it with the
  unlock command and never unlock it themselves.
