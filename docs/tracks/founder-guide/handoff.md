---
id: founder-guide-handoff
kind: handoff
status: open
read_when: "starting or resuming founder-guide"
phase_next: 3
---

# Non-tech guide: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 3, CLOSE-OUT: the README section has landed; a person still has to look at it on GitHub

Read, in this order:
  docs/tracks/founder-guide/README.md   (State, Invariants, How to work, and the receipt in the frontmatter)
  docs/tracks/founder-guide/plan.md     (Phase 3, with its "Delivered")
  docs/tracks/founder-guide/traps.md    (FG-04 and FG-06 above all)
Nothing else unless a line below cites it.

SCOPE: in — get the owner's word that the start-here section of the root README draws correctly
on GitHub in light and dark mode, record it in plan.md Phase 3 "Delivered", fix only what that
look finds, close phase 3, and archive the track if the owner says so. Out — the skill body, the
installer, the tests, and every developer section of the root README.

Do NOT re-derive, re-measure or re-open: what shipping a skill touches is frozen in
docs/tracks/founder-guide/research/2026-10-07-guide-skill-ship-surface.md — do not repeat that
sweep. Do not rewrite the section, the skill or the phase 2 edits: all three are committed. The
eight locked decisions in README.md stand.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  All three phases are committed on main. The receipt in README.md's frontmatter names the last
  phase closed; trust it over any sentence, this one included.
  Phase 3 is NOT closed and must not be until a person has looked at the page: no command can
  check that a Mermaid diagram draws (FG-06). The look needs main pushed first. Pushing is the
  owner's call: ask, do not assume.
  NOT RUN anywhere yet: the suite on the two older supported Node versions (FG-03). This machine
  has one Node only. The first CI run after the push settles it; read that run before closing.
  The owner approved one skip on this machine: the docs gate's memory-index rule cannot run here.
  It is now in the committed baseline as a declared skip. Pass --allow-skip docs=1 beside the
  reproducible-build skip, on the check and on the close.
  A close needs a green verdict recorded at HEAD on a clean tree, and the block above must have
  changed since the last receipt. The full suite takes five to ten minutes: run it in the
  background and edit nothing meanwhile, or the verdict goes stale.
  Left alone on purpose: docs/methods/09-the-phase-lifecycle.md still counts three working
  skills, which is true of the three that walk a phase.
  The audience statement the autonomy-modes track reserved in the root README is still unwritten
  (FG-04). The start-here section does not make it; leave it room.
  A commit here needs an author passed on the command line: git has no identity configured.
  Other tracks may be live in this working tree (FG-01). Stage by path only; never stash or reset.
  Archiving is close-phase.js with --archive, and only when the owner asks for it.

First commit: `founder-guide: a visual start-here section in the README`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: follow "How to work" in docs/tracks/founder-guide/README.md. One phase, then stop
and hand off.
```
