---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 1
---

# Autonomy modes: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 1: finish peers.js, then stop

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/autonomy-modes/plan.md     (Phase 1 only)
  docs/tracks/autonomy-modes/traps.md    (before touching anything)
  scripts/harness/peers.js               (the file you are fixing)
Nothing else unless a line below cites it.

SCOPE: in — make `node scripts/harness/peers.js --self-test` green by correcting stale assertions
and two text surfaces. Out — the launcher, the config section, the receipt, the root README, the
tool registry, gating anything, and wiring any hook.

Do NOT re-derive, re-measure or re-open: the four research sweeps are frozen under
docs/tracks/autonomy-modes/research/ — do not repeat them. The locked decisions in README.md were
settled by the owner on 2026-10-06; do not re-litigate four modes, the launcher-owned selector, the
unattended-loop decision, or the removal of expiry, stealing and re-take from peers.js.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose. This phase does
NOT run the gate suite and does not record any baseline — see traps.md AM-09.

Inherited state:
  peers.js is HALF-EDITED by a workflow that was stopped mid-run. Its three authorship fixes
  LANDED; the self-test is red only because assertions and text lag behind them. Fix those, not
  the logic. plan.md Phase 1 lists each failing expectation and what it should now assert.
  The `ask` verdict on a sid-match-with-nonce-mismatch is CORRECT and intended.
  The registry now holds a `nonces/` directory beside `claims/`; that is the new per-session nonce
  store that makes "already yours" require authorship. Allow exactly those two.
  mode.js, actions.js and carveouts.js are written and self-test green; leave them alone.
  Nothing in this repo is committed and the whole tree is staged — see traps.md AM-03. Do not
  commit, stash, restore or `git add -A`, and do not run close-phase.js.
  Another session owns the multi-tool track; its phases 1 and 2 landed, phase 3 has not — see
  traps.md AM-01. Its guards now live under scripts/harness/guards/.
  Do NOT wire the peers hook even once the self-test is green: it denies writes, so a wrong version
  blocks the session that installed it. Wiring is a later phase and needs the owner.

First commit: `autonomy-modes: peers.js self-test green after the authorship fix`
Exit: `node scripts/harness/peers.js --self-test`

How to work: follow "How to work" in docs/tracks/autonomy-modes/README.md. One phase, then stop
and hand off.
```
