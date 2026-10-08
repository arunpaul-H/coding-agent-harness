---
id: worktrees
kind: track
status: open
read_when: "changing how an agent gets its own workspace folder, how workspaces announce themselves, or how one is landed and removed"
trap_prefix: WT
paths: ["scripts/harness/**", "bin/harness.js", "templates/**", "schema/**", "harness.config.json", ".claude/settings.json", ".gitignore"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js worktrees"
last_verified: 2026-10-08
max_age_days: 30
closed_phase: 0
closed_at: 2026-10-08
gates_sha: 55f7091810c3e10160b5aec608b139ac70d2824a8e23fae6e6f793f759c3c719
block_sha: fa4bbfd4dc3af38a3262567b526018e7baea5fc9727f63792180e63acb7a4b60
receipt: c454d98c049825931139a4949cbbcd6b91f567aa2334228e13e0135d6735719f
---

# Workspaces: several agents in one project on one computer, without collisions

> ### Read which section, do not read it whole.
> | Your task | Read |
> |---|---|
> | Starting or resuming a phase | `handoff.md`, then **State** below |
> | Something behaves oddly | `traps.md` first. Every hazard there cost a real hour |
> | Why the scope is this and not more | **Locked decisions** |
> | What must not move | **Invariants** |
> | The phases and their exit commands | `plan.md` |

> **Self-evolving tracker. Current truth only, not a changelog.** Rewrite in place when a phase
> lands. A cold session reads THIS plus `handoff.md` and continues with no memory of the last one.

## What this is

The goal, in the owner's words: anyone cloning this repo for agentic coding must be able to
seamlessly use multiple agents doing multiple things in the same project on the same computer.
Two agents in one folder trip over each other's unfinished files. A git worktree gives each agent
its own folder on its own branch over one shared history. This track makes that one command:
create a workspace, see every workspace, be warned of overlap early, land and remove one safely.
Evidence: `research/2026-10-08-what-claude-worktree-does-here.md`.
It does NOT change the path-claim registry in `scripts/harness/peers.js`, which stays unwired.

## Locked decisions

1. **Layout: a parent workspace folder for new downloads.** The parent holds the project in
   `main/` and every workspace beside it. An already-cloned repo is not moved: its workspaces go
   in a sibling `<repo>.worktrees/` folder, and every command says the parent layout works
   better and prints the steps to adopt it. Owner, 2026-10-08.
2. **Each workspace announces itself in a committed, uniquely named file.** A track's
   `handoff.md` is that file; a task with no track gets one note file named for the task, removed
   at landing. No file every branch edits. Owner agreed 2026-10-08: one shared root file
   conflicts at every merge and leaves a stale note on the source branch.
3. **The overview is generated, never maintained.** It reads each branch's note straight from
   git, so it covers a branch with no folder on this computer. Owner, 2026-10-08.
4. **Landing verifies and prints; a person merges.** The script checks clean, green and merged,
   prints the merge command, and removes the folder only after the merge exists. Owner, 2026-10-08.
5. **A track is optional.** A workspace is a folder and a branch; `--track` adds the track
   folder. Small tasks must not pay for four docs. Lead, 2026-10-08, from the owner's goal.
6. **The harness command is the supported path; the agent's own flag is routed to it.** A
   `WorktreeCreate` hook hands the flag to the same script, so both land in one place. Measured
   possible in the research file, section 4.

## Invariants

1. No command in this track merges, pushes, force-removes a dirty folder or deletes an unmerged
   branch. A refusal names what would be lost.
2. No shared state lives in a tracked file that more than one branch writes.
3. A fresh clone needs no config edit: every new config key has a derived default.
4. `scripts/harness/worktree.js` keeps `--self-test`, and its tests use a throwaway repo, never this one.
5. Node built-ins only, `node:path` everywhere, no git subprocess where a file read answers.

## State

| Phase | What it delivers | Status |
|---|---|---|
| 0 | the research file: what the agent's flag does on this machine | closed |
| 1 | `worktree.js --new`, `--list`, `--self-test`; config keys with defaults | open |
| 2 | a new folder is ready: carried local files, setup command, the flag routed by hook | open |
| 3 | the announce note, the generated overview, the overlap warning, a session-start line | open |
| 4 | `--land` and `--prune`, refusing a dirty or unmerged folder | open |
| 5 | packaging: `harness init`, the parent layout for new downloads, the reference doc | open |

Phase 0 is committed and closed. Nothing is pushed. Phase 1 has not started.

## How to work

One phase per session. Start from `handoff.md`, read only what its `Read` list names, do the
phase, run its `Exit:` command in the foreground and paste the output. Then rewrite this file to
current truth, replace `handoff.md` wholesale, and close with
`node scripts/harness/close-phase.js worktrees`. A phase that cannot close says so and stops.

This track runs in its own workspace, `Agent-Harness-worktrees`, on branch `worktrees`, cut from
`origin/main`. Every measurement that needs a second agent session uses a throwaway repo in the
scratchpad, never this repo.
