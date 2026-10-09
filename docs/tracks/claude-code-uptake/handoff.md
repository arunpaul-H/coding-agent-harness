---
id: claude-code-uptake-handoff
kind: handoff
status: open
read_when: "starting or resuming claude-code-uptake"
phase_next: 5
---

# Claude Code uptake: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 5: the skill gate vets mods

Read, in this order:
  docs/tracks/claude-code-uptake/README.md   (Locked decisions, Invariants, State, How to work)
  docs/tracks/claude-code-uptake/plan.md     (Phase 5 only)
  docs/tracks/claude-code-uptake/traps.md    (before touching anything)
  docs/tracks/claude-code-uptake/research/2026-10-09-claude-code-releases.md   (section 3, the Trust line)
  docs/tracks/claude-code-uptake/research/2026-10-09-mod-order-and-guard-runs.md   (sections 2 and 4)
  docs/reference/skill-safety/README.md      (the gate this phase extends)
  scripts/harness/guards/skill-verify.cjs    (search for `enabledPlugins` and `gitCommitSha`; do not read it whole)
Then these vendor pages, and no others:
  https://code.claude.com/docs/en/plugins/mods/admin
  https://code.claude.com/docs/en/plugins/security
Nothing else unless a line below cites it.

SCOPE: scripts/harness/guards/skill-verify.cjs, its tests, skills-lock.json, docs/reference/skill-safety/
and a new templates/managed-settings.json are in. Both mods under .claude/plugins/, any settings
hook, scripts/harness/hook.js and .claude/settings.json are out.

Do NOT install, enable or update any plugin or skill: this phase teaches the gate to see them.
Do NOT call a guard final outside managed settings (decision 5). Do NOT put a decision in a mod.
Do NOT re-read the vendor changelog (CU-02).

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 4 are committed if `git log` shows the phase 4 subject,
  `mods: the guards in-process, each with a catch that denies`; if it does not, ask the user
  before any commit. Phase 4 is closed only if the track README carries `closed_phase: 4`.
  Two mods are on disk: `harness` (draws, adds commands, gates nothing) and `harness-guard`
  (gates, draws nothing). `claude plugin validate <dir> --json` is the inventory to pin: run it
  on both and read the keys it prints before designing the lock entry; nobody has yet.
  Neither mod is enabled by a settings file. Both load with `--plugin-dir`, a route the skill
  gate does not see today, like `CLAUDE_CODE_PLUGIN_DIRS` and the dev-mods folder.
  Measured on this machine: `sec-default` is NOT loaded (no managed settings, not a Team or
  Enterprise sign-in), mods named by `--plugin-dir` run in flag order, and a mod loaded ahead
  of `harness-guard` can answer a call before it is asked.
  No interactive session has loaded either mod. The band, the four commands and every question
  the guard mod asks are held by `claude plugin test` alone. Only the user can start one:
  `claude --plugin-dir .claude/plugins/harness --plugin-dir .claude/plugins/harness-guard`.
  That load writes type files into each mod's `.claude-plugin/types/`; they are ignored.
  A headless run (`claude -p --debug-file <path>`) measures most things: the debug log names
  each mod loaded, its tier and every hook that ran or was skipped.
  A shell command that names the guarded secret file is refused, twice over (CU-08).
  The `mods` gate command now covers both mods. Changing it again, or adding an optional gate,
  moves the carveouts census (CU-05).
  Traps CU-01 and CU-07 apply to any spawn and any new mod hook.

First commit: `skills: the skill gate names a mod and what it can reach`
Exit: `node scripts/harness/guards/skill-verify.cjs --self-test && node scripts/harness/guards/skill-verify.cjs --check && node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
