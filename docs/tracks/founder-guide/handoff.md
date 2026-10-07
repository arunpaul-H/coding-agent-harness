---
id: founder-guide-handoff
kind: handoff
status: open
read_when: "starting or resuming founder-guide"
phase_next: 3
---

# Non-tech guide: the track is complete

## ▶ THE NEXT SESSION: paste this into a new chat

```
TRACK COMPLETE: all three phases have landed, and nothing is owed

Read, in this order:
  docs/tracks/founder-guide/README.md   (State, and the receipt in the frontmatter)
Nothing else unless a line below cites it.

SCOPE: in: nothing. No phase is left to do. Out: the skill body, the installer, the tests and
the root README: all are committed and looked at. A new idea for the non-tech reader is a new
track, not a fourth phase here.

Do NOT re-derive, re-measure or re-open: what shipping a skill touches is frozen in
docs/tracks/founder-guide/research/2026-10-07-guide-skill-ship-surface.md. The eight locked
decisions in README.md stand.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  The receipt in README.md's frontmatter names the last phase closed; trust it over any
  sentence, this one included.
  The owner looked at the start-here section on GitHub on 2026-10-07, in light and dark mode,
  and said it was all good (FG-06). plan.md Phase 3 "Delivered" records it.
  The suite ran green in CI on both older supported Node versions (FG-03) on the pushed branch.
  The docs gate's memory-index rule cannot run on the owner's machine. It is a declared skip in
  the committed baseline: pass --allow-skip docs=1 beside the reproducible-build skip.
  Archiving is close-phase.js with --archive, and only when the owner asks for it.
  Not this track's to write: the audience statement the autonomy-modes track reserved in the
  root README (FG-04). The start-here section leaves it room.
  Other tracks may be live in this working tree (FG-01). Stage by path only; never stash or reset.

First commit: none; no work is owed.
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: there is no next phase. If the owner asks for the archive, run it and stop.
```
