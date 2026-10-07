---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 2
---

# Autonomy modes: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 2: the audience statement, then stop

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/autonomy-modes/plan.md     (Phase 2 only)
  docs/tracks/autonomy-modes/traps.md    (before touching anything)
  README.md                              (the file that gains the statement)
  docs/methods/00-overview.md            (gains one line that agrees with it)
Nothing else unless a line below cites it.

SCOPE: in — the root README.md states that the harness is for flat-rate subscription seats and
frames the ration as quota and context, not dollars; docs/methods/00-overview.md gains one line that
agrees. Out — the tool registry, the launcher, the config section, the receipt, gating anything, and
wiring any hook.

Do NOT re-derive, re-measure or re-open: the research sweeps are frozen under
docs/tracks/autonomy-modes/research/ — do not repeat them. The locked decisions in README.md were
settled by the owner on 2026-10-06; do not re-litigate the subscription-seat audience, four modes,
the launcher-owned selector, or the unattended-loop decision.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phase 1 needed no code change: `node scripts/harness/peers.js --self-test` exits 0 at HEAD. The
  authorship fixes and the assertions that lagged them were already in the tree when it was
  imported. Its hook is still NOT wired, and wiring it still needs the owner.
  The multi-tool track is archived under docs/archive/multi-tool/, so README.md is no longer
  claimed by another session and traps.md AM-01 no longer blocks this phase.
  The tree is committed. Work on a branch; commit normally.
  On this machine the docs gate reports one declared skip (no auto-memory index), so the gate
  command is `node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1`.
  The README is capped by the doc contract: check the cap before adding a section.

First commit: `autonomy-modes: README states the subscription-seat audience`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in docs/tracks/autonomy-modes/README.md. One phase, then stop
and hand off.
```
