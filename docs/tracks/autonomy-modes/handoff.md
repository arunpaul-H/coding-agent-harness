---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 6
---

# Autonomy modes: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 6: gate the four mode scripts, then stop

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/autonomy-modes/plan.md     (Phase 6 only)
  docs/tracks/autonomy-modes/traps.md    (before touching anything; AM-09 decides the order)
  harness.config.json                    (the `gates` array and its `_readme`)
  scripts/harness/mode.js, actions.js, carveouts.js, peers.js
                                         (each file's header and its main block only: what it
                                          prints last, and which command line grades the tree)
Nothing else unless a line below cites it.

SCOPE: in: one entry in the `gates` array for each of the four scripts, each command ending in a
GATE line the runner can parse; the first carve-out baseline, recorded on a whole, committed
tree; and the re-baseline that follows. Out: wiring the peers hook, registering mode.js on any
hook event, filling a null mode, and any change to what the four scripts decide.

Do NOT re-derive, re-measure or re-open: the research sweeps are frozen under
docs/tracks/autonomy-modes/research/. The locked decisions in README.md were settled by the owner
on 2026-10-06. The launcher, the config section and the receipt are settled and pinned by tests.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 1 to 5 are closed. The config has a closed `mode` section; `harness run --track <id>`
  writes the receipt `<track>/.phase` from a terminal only; the phase guard refuses a write to
  it by path (D6) and says a shell redirect is not caught; the file is git-ignored and `doctor`
  checks that. Nothing reads the receipt: mode.js is registered on no hook event.
  A GATE WHOSE COMMAND PRINTS NO GATE LINE IS A HARD FAILURE, so a script that only prints a
  PASS line needs one before it can be listed. Two of the four already name a gate of their own.
  The suite total rises in this phase, so the re-baseline is the point and its commit subject
  starts `gates:`.
  The owner has still not chosen the unattended flag, and the peers hook is still NOT wired.
  On a machine with no auto-memory index the docs gate reports one declared skip, so the gate
  command is `node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1`.
  This is the last phase: after it closes, the track is archived by
  `node scripts/harness/close-phase.js autonomy-modes --archive`.

First commit: `gates: the mode, effects, carveouts and peers gates`
Exit: `node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

How to work: follow "How to work" in docs/tracks/autonomy-modes/README.md. One phase, then stop
and hand off.
```
