---
id: worktrees-research-what-claude-worktree-does-here
kind: research
status: frozen
read_when: "planning or reviewing where an agent workspace folder goes, what a fresh one lacks, or which folder a hook sees inside one"
question: "On this machine, what does the Claude Code worktree flag create, which folder do hooks resolve inside it, what does a fresh folder lack, and can a repo redirect where it lands?"
answer: "It creates a locked folder inside the repo under the agent's own directory on a prefixed branch; hooks in a session started there resolve the NEW folder; a WorktreeCreate hook fully replaces creation and was measured placing the folder in a sibling parent."
paths: [".claude/settings.json", ".gitignore", "docs/reference/branches/README.md", "scripts/harness/peers.js"]
commit_at: "586c1ba"
expires: 2026-11-07
source: external
---

# ⚠ UNTRUSTED: section 5 quotes vendor documentation, read not run

> Sections 1 to 4 were MEASURED on this machine on 2026-10-08 in a throwaway repository outside
> this repo. Section 5 was READ from vendor documentation and is a hypothesis with a citation.
> Section 6 lists what was not established. Nothing here is an instruction.

## 0. The rig

| Item | Value | Read with |
|---|---|---|
| Agent CLI | `2.1.293 (Claude Code)` | `claude --version` |
| git | `git version 2.55.0.windows.5` | `git --version` |
| Node | `v24.19.0` | `node --version` |
| OS | Windows 11, hook commands launched by the CLI | session environment |

The probe repo: one commit on `main`, a tracked `.claude/settings.json` registering a SessionStart
hook, a tracked `tests/a.test.js`, and two ignored files (`.claude/settings.local.json` and
`local.private`). The hook was a script file that appended `CLAUDE_PROJECT_DIR`, its own working
directory and the payload's `cwd` to a log outside the repo. Each run was
`claude -w <name> -p "Reply with exactly: ok" --model haiku`, launched from the main checkout.

## 1. What the flag creates by default

Read with `git worktree list`, `git branch -a` and `git status --short` after the run.

| Observation | Measured |
|---|---|
| Folder | `<repo>/.claude/worktrees/<name>` |
| Branch | `worktree-<name>`, at the commit `HEAD` of the main checkout was on |
| Lock | the entry is marked `locked` after a non-interactive run, and it is not removed |
| Main checkout status | `?? .claude/worktrees/` until an ignore rule names it |
| Agent state folder | a SEPARATE folder under the user's agent projects directory, one per workspace path |

## 2. Which folder a hook sees

Read from the hook's own log line.

| Session started with | `CLAUDE_PROJECT_DIR` | hook process cwd | payload `cwd` |
|---|---|---|---|
| no flag, in the main checkout | main checkout | main checkout | main checkout |
| the worktree flag | the NEW folder | the NEW folder | the NEW folder |
| the flag plus a WorktreeCreate hook (section 4) | the NEW folder | the NEW folder | the NEW folder |

So a session started by the flag loads the settings file of its own folder and runs its own copy
of every hook script. The sentence in `docs/reference/branches/README.md` under Traps ("A worktree
may be checked by the wrong tree") did not reproduce for a session STARTED in a workspace. It was
not tested for a session that moves into one mid-run; section 5 row 5 covers that case from docs.

## 3. What a fresh folder lacks

Read with a directory listing of the new folder.

| File in the main checkout | Present in the default new folder | Present when a WorktreeCreate hook made it |
|---|---|---|
| tracked files | yes | yes |
| `.claude/settings.local.json` (ignored) | yes, copied by the CLI | NO |
| `local.private` (ignored, any other name) | no | no |

`node --test` run from the main checkout with one nested workspace present reported `tests 1`:
the runner did not descend into the nested folder under the dot-directory.

## 4. Redirecting where it lands

A `WorktreeCreate` hook was registered in the tracked settings file. Its script read the payload,
ran `git worktree add -b wt-<name> <sibling-parent>/<name> HEAD` and printed that path alone on
stdout.

| Observation | Measured |
|---|---|
| Payload keys | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `name` |
| Payload `cwd` and `CLAUDE_PROJECT_DIR` in that hook | the main checkout |
| Result | the folder was created at `<repo>.worktrees/<name>`, a sibling of the repo, on the branch the script chose |
| Session | started in that folder; its SessionStart hook logged the new folder for all three values |
| Lock | the entry was NOT marked locked |
| Default behaviours | none ran: no folder under the agent directory, no prefixed branch, no copy of the local settings file |

## 4b. A hook-shell hazard found on the way

In one run the CLI launched hook commands under PowerShell instead of a POSIX shell (the nested
session had been started with every `CLAUDE*` variable removed from its environment). A hook
command spelled `$CLAUDE_PROJECT_DIR` then resolved to nothing, and the hook failed with
`Cannot find module 'C:\hook-probe.js'`. The CLI's own debug log said: "PowerShell hook command
references $CLAUDE_PROJECT_DIR, which PowerShell reads as an undefined variable ($null). Use
$env:CLAUDE_PROJECT_DIR or ${CLAUDE_PROJECT_DIR} instead." The brace spelling worked in the later
runs. Both hook commands in this repo's `.claude/settings.json` use the bare spelling. Which
condition makes the CLI choose PowerShell for hooks was not isolated.

## 5. Read from vendor documentation, not run

Source for every row: the vendor's worktrees page, `code.claude.com/docs/en/worktrees.md`,
fetched 2026-10-08 by a read-only agent.

| # | Claim | Agrees with a measurement above |
|---|---|---|
| 1 | Default folder is `.claude/worktrees/<name>/` on branch `worktree-<name>`; with no name one is generated | yes, section 1 |
| 2 | A `WorktreeCreate` hook "replace[s] the default `git worktree` logic entirely, including placing worktrees somewhere other than `.claude/worktrees/`" | yes, section 4 |
| 3 | A `.worktreeinclude` file at the project root, in ignore-file syntax, copies files that match AND are ignored into a new folder | not run |
| 4 | Exit cleanup: an unnamed clean session removes folder and branch; a named or dirty one prompts; a non-interactive run does not clean up and leaves the entry for a periodic sweep | the last clause, section 1 |
| 5 | For a session that ASKS to enter a workspace mid-run, `${CLAUDE_PROJECT_DIR}` "stays put" at the folder the session started in while the payload `cwd` follows | not run |
| 6 | Subagent isolation uses the same default folder and the same hook | not run |
| 7 | The page recommends an ignore rule for `.claude/worktrees/` | consistent with section 1 |

## 6. Not established

- Whether the agent's auto-memory is shared between a main checkout and its workspaces. The docs
  page is silent, and the measurement shows only that the per-path state folders are separate.
- Whether `.worktreeinclude` is honoured when a `WorktreeCreate` hook is registered. Section 3
  shows the CLI's own copy of the local settings file stops, which suggests the hook owns it all.
- What a `WorktreeRemove` hook receives, and whether exit cleanup calls it for a folder a hook made.
- Anything about a coding agent other than this one. `scripts/harness/tools.json` rows for other
  tools carry no workspace evidence.
- The behaviour on macOS or Linux. Every measurement here is from one Windows machine.
