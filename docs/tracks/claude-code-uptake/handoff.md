---
id: claude-code-uptake-handoff
kind: handoff
status: open
read_when: "starting or resuming claude-code-uptake"
phase_next: 4
---

# Claude Code uptake: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 4: the `harness-guard` mod

Read, in this order:
  docs/tracks/claude-code-uptake/README.md   (Locked decisions, Invariants, State, How to work)
  docs/tracks/claude-code-uptake/plan.md     (Phase 4 only)
  docs/tracks/claude-code-uptake/traps.md    (before touching anything)
  docs/tracks/claude-code-uptake/research/2026-10-09-claude-code-releases.md   (section 2)
  .claude/plugins/harness/hooks/register.js  (the shape a mod of this repo takes)
  .claude/plugins/harness/tests/harness.test.ts   (the stubs a new mod's tests start from)
Then these vendor pages, and no others:
  https://code.claude.com/docs/en/plugins/mods/events
  https://code.claude.com/docs/en/plugins/mods/admin
  https://code.claude.com/docs/en/plugins/mods/troubleshoot
Nothing else unless a line below cites it.

SCOPE: one research file from runs, then a new plugin folder .claude/plugins/harness-guard/, its
tests and its `mods` gate command are in. The `harness` mod, any settings hook, the skill gate and
.claude/settings.json are out.

Do NOT start item 2 before item 1's research file exists: the plan marks it BLOCKED ON it. Do NOT
re-read the vendor changelog: what shipped is already measured in the research file. Do NOT remove
a settings hook or call the mod final (decisions 2 and 5). Do NOT put a decision inside the mod:
it hands the call to scripts/harness/hook.js and relays the verdict.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 2 are committed and phase 2 is closed by receipt. Phase 3 is committed if `git log`
  shows its first commit, subject in plan.md; if it does not, ask the user before any commit.
  No session has loaded the `harness` mod. Item 1 needs runs in a real terminal session, which
  only the user can start: `claude --plugin-dir .claude/plugins/harness`. Ask for what the band
  shows and what /gates, /track, /handoff and /close-phase print before building on them.
  That load writes type files into .claude/plugins/harness/.claude-plugin/types/. They are
  generated: decide with the user whether they are ignored or committed. They hold the
  `$.process.spawn` signature /gates needs to outlast ten minutes (CU-03).
  Every gating hook in the new mod needs a `.catch` that denies; `claude plugin validate` prints
  one line per gating hook saying whether it has one (CU-06 shows the line).
  A second optional gate, or a longer `mods` command, moves the carveouts census (CU-05).
  Work nothing awaits is started with `$.clock.after(0, fn)` so a test can settle it (CU-04).
  The pre-tool entry fails closed: if every tool call is refused, the fix is in
  scripts/harness/hook.js or the dialect, not in the settings.
  Traps CU-01 and CU-02 apply to any spawn and any changelog read.

First commit: `mods: the guards in-process, each with a catch that denies`
Exit: `claude plugin validate .claude/plugins/harness-guard --strict && claude plugin test .claude/plugins/harness-guard && node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
