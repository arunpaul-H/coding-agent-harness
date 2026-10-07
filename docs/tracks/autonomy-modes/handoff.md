---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 5
---

# Autonomy modes: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 5: the mode config section and the phase receipt, then stop

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/autonomy-modes/plan.md     (Phase 5 only)
  docs/tracks/autonomy-modes/traps.md    (before touching anything)
  scripts/harness/config.js              (DEFAULTS, the allowed top-level keys, the `tools` section)
  schema/harness.config.schema.json      (the `tools` property, as the precedent)
  scripts/harness/mode.js                (readReceipt, and the receipt's fields)
  scripts/harness/run.js                 (main: where a launch is decided)
  scripts/harness/guards/phase-guard.cjs (how a write to a track file is refused today)
Nothing else unless a line below cites it.

SCOPE: in: a new top-level config section for the run mode, closed like `tools` (an unknown
sub-key is an error); the `.phase` receipt, written by the launcher; and, in the SAME change, a
refusal outside the receipt that stops the agent writing it. Out: gating the four mode scripts,
wiring the peers hook, registering mode.js on any hook event, and filling a null mode.

Do NOT re-derive, re-measure or re-open: the research sweeps are frozen under
docs/tracks/autonomy-modes/research/. The locked decisions in README.md were settled by the owner
on 2026-10-06. The launcher's refusals are settled and pinned by tests/run.test.js.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 1 to 4 are closed. `node bin/harness.js run [<mode>] [--tool <id>] [--dry-run]` starts
  the program a row's `bin` names with the flags its `modes` cell records, and refuses a null
  mode, a row with no cell or no `bin`, a tool the config has not enabled, and a missing mode
  with no terminal to ask on. It writes NO receipt yet and nothing reads one.
  INVARIANT 1 DECIDES THIS PHASE: a receipt the agent can write approves nothing. The config
  loader is closed twice (the loader's key list AND the schema), so a new section in one place
  only reds every gate with a config stop.
  The owner has still not chosen the unattended flag: that mode stays null in the one filled row
  and the launcher refuses it by name. Ask; do not pick.
  The peers hook is still NOT wired, and wiring it needs the owner.
  On a machine with no auto-memory index the docs gate reports one declared skip, so the gate
  command is `node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1`.
  No real coding agent was ever started through the launcher: its tests plant a throwaway
  program under the row's `bin`.

First commit: `autonomy-modes: the mode config section and the phase receipt`
Exit: `node scripts/harness/config.js --self-test && node bin/harness.js doctor`

How to work: follow "How to work" in docs/tracks/autonomy-modes/README.md. One phase, then stop
and hand off.
```
