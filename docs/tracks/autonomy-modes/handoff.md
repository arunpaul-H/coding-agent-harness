---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 3
---

# Autonomy modes: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 3: the `modes` column in the tool registry, then stop

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/autonomy-modes/plan.md     (Phase 3 only)
  docs/tracks/autonomy-modes/traps.md    (AM-02 before touching anything)
  scripts/harness/tools.json             (the `_readme` is the row contract)
  scripts/harness/tools.js               (checkRow and selfTest)
  tests/tools.test.js
Nothing else unless a line below cites it.

SCOPE: in: scripts/harness/tools.json gains an OPTIONAL `modes` field mapping each harness mode
to that tool's own flags; scripts/harness/tools.js validates it; tests/tools.test.js covers it.
Out: the launcher, the config section, the receipt, gating the four mode scripts, and wiring any
hook.

Do NOT re-derive, re-measure or re-open: the research sweeps are frozen under
docs/tracks/autonomy-modes/research/ and do not name any tool's mode flags, so do not look for
them there. The four mode ids are the keys of MODES in scripts/harness/mode.js; do not re-litigate
them. The audience statement landed in phase 2; do not reword it.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 1 and 2 are closed. README.md and docs/methods/00-overview.md now state the
  subscription-seat audience.
  The registry's rule is that a cell nobody established is null and never a guess. A flag recalled
  from memory is a guess: record a tool's flags only from a source you can cite or a command you
  ran, and say in the row's notes which it was.
  tests/tools.test.js copies only config.js and tools.js into its fixture repos, so tools.js may
  not require mode.js at load. Keep the mode ids in tools.js and pin them to mode.js in a test.
  The peers hook is still NOT wired, and wiring it needs the owner.
  On this machine the docs gate reports one declared skip (no auto-memory index), so the gate
  command is `node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1`.
  New tests raise the `test` total, so a re-baseline commit (subject starts `gates:`) follows.

First commit: `autonomy-modes: tools.json carries each tool's mode flags`
Exit: `node scripts/harness/tools.js --check && node --test`

How to work: follow "How to work" in docs/tracks/autonomy-modes/README.md. One phase, then stop
and hand off.
```
