---
id: claude-code-uptake-handoff
kind: handoff
status: open
read_when: "starting or resuming claude-code-uptake"
phase_next: 3
---

# Claude Code uptake: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 3: the track lifecycle as commands

Read, in this order:
  docs/tracks/claude-code-uptake/README.md   (Locked decisions, Invariants, State, How to work)
  docs/tracks/claude-code-uptake/plan.md     (Phase 3 only)
  docs/tracks/claude-code-uptake/traps.md    (before touching anything)
  .claude/plugins/harness/hooks/register.js  (the mod this phase adds to)
  .claude/plugins/harness/tests/harness.test.ts   (the stubs every new test reuses)
Then these vendor pages, and no others:
  https://code.claude.com/docs/en/plugins/mods/interface   (Open a pane at the right time)
  https://code.claude.com/docs/en/plugins/mods/test        (the stub table, `$.ui.ask`)
  https://code.claude.com/docs/en/plugins/mods/reference   (session.compact, limits)
Nothing else unless a line below cites it.

SCOPE: three commands and one session.compact hook in .claude/plugins/harness/, their tests, and
whatever scripts/harness/panel.js must print for them are in. Any hook that gates a call, a new
plugin, the skill gate and .claude/settings.json are out.

Do NOT write a receipt, a `status:` or a handoff from the mod: close-phase.js and handoff-lint.js
do, as today. Do NOT re-open the five locked decisions. Do NOT put a decision inside the mod: a
new judgement goes in scripts/harness/panel.js with a self-test check.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0, 1 and 2 landed as files and are UNCOMMITTED, so none is closed. Owed to the user:
  three commits, subjects in plan.md, then a `gates:` commit, then
  `node scripts/harness/close-phase.js claude-code-uptake`. Ask the user before any commit.
  The gate is RED on carveouts until the census is re-recorded on a clean tree (CU-05):
  `node scripts/harness/carveouts.js --accept --i-know-the-tree-is-clean`. The `mods` gate has no
  baseline row until `gates.js --accept`. Both belong to the `gates:` commit.
  No session has loaded the mod. Before building on it, the user runs
  `claude --plugin-dir .claude/plugins/harness` in a terminal and says what the band shows and
  what /gates prints. That load also writes the types into .claude/plugins/harness/.claude-plugin/types/
  which hold the `$.process.spawn` signature /gates needs (CU-03). Those files are generated:
  decide with the user whether they are ignored or committed before the commit-hygiene guard decides.
  /gates stops at ten minutes and this repo's suite runs longer, so here it answers NOT RUN (CU-03).
  Work nothing awaits is started with `$.clock.after(0, fn)` so a test can settle it (CU-04).
  The pre-tool entry fails closed: if every tool call is refused, the fix is in
  scripts/harness/hook.js or the dialect, not in the settings.
  Traps CU-01 and CU-02 apply to any spawn and any changelog read.

First commit: `mods: /track, /handoff and /close-phase without a model turn`
Exit: `claude plugin validate .claude/plugins/harness --strict && claude plugin test .claude/plugins/harness && node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
