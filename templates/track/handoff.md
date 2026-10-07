---
# TEMPLATE. Fill each <PLACEHOLDER>, delete every comment. <TRACK_ID> is the folder name; the `-handoff` suffix keeps the id unique.
id: <TRACK_ID>-handoff
kind: handoff
status: open
# <READ_WHEN>: e.g. "starting or resuming <track>".
read_when: "<READ_WHEN>"
# <N>: the number of the phase the block below describes. close-phase.js closes phase_next minus one unless given --phase.
phase_next: <N>
---

# <TRACK_TITLE>: the next phase

<!-- THE RULES OF THIS FILE. Acceptance test: `node scripts/harness/handoff-lint.js <TRACK_ID>`.
  · Exactly ONE block under a single arrow heading, in this file only. REPLACE it wholesale each phase; never append a second.
  · It is written for a session with NO memory of yours. Whatever is not in the block has to be re-derived, and re-deriving is the default failure.
  · Every whole number of two or more digits must sit on a line that also carries gates.json, a `path:line` or a prefixed trap id.
    A figure nobody can check is copied forward, compared with a fresh measurement, and read as a regression in the code.
  · close-phase.js refuses if the block is byte-identical to the one that closed the previous phase.
  <TRACKS_DIR>: `project.tracksDir` in harness.config.json, default `docs/tracks`. The Read paths must resolve on disk.
  <PHASE_NAME>: as in plan.md.   <SCOPE_SENTENCE>: one sentence naming what is in AND what is out.
  <ALREADY_SETTLED>: the measurement or decision a cold session would otherwise redo.
  <INHERITED_STATE>: what the last phase left: what landed, what was deferred and on whom it waits, which traps apply.
  <FIRST_COMMIT_SUBJECT> and <EXIT_COMMAND>: verbatim from plan.md for this phase. -->

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE <N>: <PHASE_NAME>

Read, in this order:
  <TRACKS_DIR>/<TRACK_ID>/README.md   (State, Locked decisions, Invariants, How to work)
  <TRACKS_DIR>/<TRACK_ID>/plan.md     (this phase only)
  <TRACKS_DIR>/<TRACK_ID>/traps.md    (before touching anything)
Nothing else unless a line below cites it.

SCOPE: <SCOPE_SENTENCE>

Do NOT re-derive, re-measure or re-open: <ALREADY_SETTLED>

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  <INHERITED_STATE>

First commit: `<FIRST_COMMIT_SUBJECT>`
Exit: `<EXIT_COMMAND>`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
