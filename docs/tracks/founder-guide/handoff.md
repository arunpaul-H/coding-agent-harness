---
id: founder-guide-handoff
kind: handoff
status: open
read_when: "starting or resuming founder-guide"
phase_next: 2
---

# Non-tech guide: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 2, CLOSE-OUT: the code has landed; phases 1 and 2 still need their receipts

Read, in this order:
  docs/tracks/founder-guide/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/founder-guide/plan.md     (Phase 1 and Phase 2 "Delivered", then Phase 3)
  docs/tracks/founder-guide/traps.md    (before touching anything)
  scripts/harness/close-phase.js        (the header comment only: the six preconditions)
Nothing else unless a line below cites it.

SCOPE: in — get a gate verdict recorded at HEAD on a clean tree, close phase 1, replace this
block with the phase 3 block from plan.md, close phase 2. Out — any edit to bin/harness.js,
package.json, scripts/harness/common.json, tests/, the skill body or the root README. Phase 3
itself is the session after this one.

Do NOT re-derive, re-measure or re-open: what shipping a skill touches is frozen in
docs/tracks/founder-guide/research/2026-10-07-guide-skill-ship-surface.md — do not repeat that
sweep. Do not redo the phase 2 edits: they are committed under the subject on the First commit
line below. The eight locked decisions in README.md stand.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phase 1 and phase 2 are both landed and committed on main, neither is closed, nothing is pushed.
  Why not closed: close-phase.js needs a verdict recorded on a clean tree. The gates ran green at
  the phase 2 commit, but while they ran another session rewrote scripts/harness/gates.baseline.json
  and left it uncommitted, so the verdict was recorded as dirty and the close refused.
  That baseline change is NOT this track's. It already counts this track's two new tests. Do not
  commit, revert, stash or re-accept it: ask the owner whether the multi-tool session will commit
  it under a subject starting gates:, or whether this track should. Until it is committed or
  gone, no close can succeed. This track owes no second re-baseline once that one is committed.
  The owner approved one skip on this machine: the docs gate's memory-index rule cannot run here.
  Pass it as --allow-skip docs=1 beside the reproducible-build skip, on the check and on the close.
  Order: run git status and stop if anything is modified that you did not modify. Run the Exit
  line. Close phase 1 with close-phase.js founder-guide --phase 1 and both skips. Commit the
  receipt. Replace this block wholesale with the phase 3 block (phase_next becomes 3), commit,
  re-run the gates, then close phase 2: the close refuses unless the block changed since the
  last receipt, and each commit moves HEAD past the last verdict.
  The full suite takes about ten minutes; run it in the background and edit nothing meanwhile.
  NOT RUN in phase 2: the suite on the two older supported Node versions (FG-03). This machine
  has one Node only. The first CI run after a push is where that is settled; read it.
  A commit here needs an author passed on the command line: git has no identity configured.
  The multi-tool track may still be live in this working tree (FG-01). Stage by path only.

First commit: `founder-guide: init installs the guide skill`
Exit: `node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: follow "How to work" in docs/tracks/founder-guide/README.md. One phase, then stop
and hand off.
```
