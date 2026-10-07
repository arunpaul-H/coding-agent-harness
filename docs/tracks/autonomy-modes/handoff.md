---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 4
---

# Autonomy modes: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 4: the launcher, then stop

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/autonomy-modes/plan.md     (Phase 4 only)
  docs/tracks/autonomy-modes/traps.md    (before touching anything)
  scripts/harness/tools.json             (the `modes` entry of `_readme`, and the one row carrying it)
  scripts/harness/mode.js                (MODES and MODE_IDS)
  bin/harness.js                         (where the `run` subcommand is surfaced)
Nothing else unless a line below cites it.

SCOPE: in: scripts/harness/run.js, surfaced as `node bin/harness.js run <mode> --tool <id>`. It asks
on the terminal when no mode is given, reads that tool's flags for the mode from the registry's
`modes` cell, and execs the tool. Out: the config section, the receipt, gating the four mode
scripts, wiring any hook, and adding `modes` to a row from memory.

Do NOT re-derive, re-measure or re-open: the research sweeps are frozen under
docs/tracks/autonomy-modes/research/. The locked decisions in README.md were settled by the owner
on 2026-10-06; do not re-litigate four modes or the launcher-owned selector. The shape of the
`modes` cell is settled and validated by `node scripts/harness/tools.js --check`.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 1 to 3 are closed. tools.js exports HARNESS_MODES, pinned to mode.js MODE_IDS by a test.
  Only the default tool's row carries `modes`, read off its own help output and never run under.
  Every other row has no cell, so the launcher has nothing to pass for those tools and must say
  so and stop, not launch the tool bare.
  THE OWNER MUST DECIDE BEFORE `fully-auto` CAN LAUNCH ANYTHING: that mode is null in the one
  filled row, on purpose. The tool's help lists more than one flag that stops it asking; which one
  an unattended run takes is the owner's risk under locked decision 5. Ask; do not pick. Until
  then the launcher refuses `fully-auto` and names the null cell.
  A null mode and an absent `modes` cell both mean "refuse and say why"; an empty list means
  "launch with no extra flag".
  The peers hook is still NOT wired, and wiring it needs the owner.
  On a machine with no auto-memory index the docs gate reports one declared skip, so the gate
  command is `node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1`.
  This work was done in a second git worktree because another session was committing in the
  first: check `git worktree list` and `git log` before assuming you are alone in a tree.

First commit: `autonomy-modes: the launcher owns the mode`
Exit: `node scripts/harness/run.js --self-test`

How to work: follow "How to work" in docs/tracks/autonomy-modes/README.md. One phase, then stop
and hand off.
```
