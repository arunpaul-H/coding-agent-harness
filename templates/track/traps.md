---
# TEMPLATE. Fill each <PLACEHOLDER>, delete every comment. <TRACK_ID> is the folder name; the `-traps` suffix keeps the id unique.
id: <TRACK_ID>-traps
kind: traps
status: open
# <READ_WHEN>: e.g. "something behaves oddly while working on <track>".
read_when: "<READ_WHEN>"
# <PREFIX>: the same 2 to 5 capitals as README.md `trap_prefix`.
trap_prefix: <PREFIX>
---

# <TRACK_TITLE>: durable traps
<!-- <TRACK_TITLE>: as in README.md. -->

Every one of these was measured while doing this track's work. A trap here is a thing that will
cost an hour again if it is not read first.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| <PREFIX>-01 | <HAZARD_AND_COST> | `<ANCHOR_PATH>` |
<!-- ONE LINE PER TRAP. docs-lint fails any row or bullet in this file that cites no path resolving on disk today: a trap nobody can check is a rumour, and a rumour here is read as a constraint by every later session. -->
<!-- <HAZARD_AND_COST>: what happens, why it is not obvious, what it costs, and the way round it. Something that HAPPENED, not something that might. -->
<!-- <ANCHOR_PATH>: a repo path in backticks, optionally `path:line`, where the trap lives. It must exist; when the file moves, move the anchor in the same commit. -->
<!-- Ids are never reused and never renumbered: handoffs and commits cite them. Retire a trap by deleting its row once the hazard is gone. -->
