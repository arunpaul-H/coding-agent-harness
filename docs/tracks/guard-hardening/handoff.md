---
id: guard-hardening-handoff
kind: handoff
status: open
read_when: "starting or resuming guard-hardening"
phase_next: 7
---

# Guard hardening: the next step

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 7, THEN CLOSE THE TRACK: the owner asked for the rest in one session

You are in the folder Agent-Harness-worktrees, on branch `worktrees`. Run `git status --short`
first: the tree must be clean. If it is not, say what is there and stop.

Read, in this order:
  docs/tracks/guard-hardening/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/guard-hardening/plan.md     (Phase 7)
  docs/tracks/guard-hardening/traps.md
  docs/reference/DOC-STANDARD.md          (section 6: closing, and the archive route)
Nothing else until a phase names a file.

SCOPE: in: phase 7 (where the test gate's time goes, measured per test file and frozen as
research), then the re-baseline and the archive.
Out: every guard and handler phases 1 to 6 changed; speeding the suite up; merging; pushing.

PHASE 7:
  1. Measure the test gate per test file on this machine, one file at a time, from a script in
     the scratchpad. Freeze the result under docs/tracks/guard-hardening/research/.
  2. A Linux box is not reachable from this machine: say so in the research file. Do not
     invent a second column.
  3. Plan a change only if one file or one cause owns most of the time, and plan it in the
     research file as a finding. Do not make the change in this track.
  4. Run the Exit command in the foreground and paste its output.
  5. Rewrite README.md State and the phase's Delivered line, and replace this file wholesale.
  6. Commit with the subject below, then run
     `node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1` at HEAD
     on the clean tree, then `node scripts/harness/close-phase.js guard-hardening`, then commit
     the receipt as `guard-hardening: close phase 7`.
A phase that cannot close says why and stops.

AFTER PHASE 7:
  7. `node scripts/harness/gates.js --accept --allow-skip docs=1,reproducible-build=1`, and
     commit scripts/harness/gates.baseline.json ALONE, subject `gates: re-baseline after guard hardening`.
  8. A final handoff saying the track is complete, the gate at HEAD, then
     `node scripts/harness/close-phase.js guard-hardening --archive`, and commit it.
  9. `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.

Do NOT re-run the probe, the stop-hook measurement or the spawn measurement: all three are
frozen under research/.
Do NOT re-open the six locked decisions in the README.
Do NOT flip a status: line, type a receipt or move the track by hand: close-phase.js does all three.
Do NOT edit a skill under .claude/skills without re-pinning it in the same commit (GH-11).
Do NOT copy a duration into a track doc as a gate figure: a research file is where one lives.
Do NOT merge `worktrees` into the source branch or push: the owner does.
No inline node -e, and no backslash inside a here-document (GH-01): write a file.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 6 are committed and closed: the receipt in README.md's frontmatter names the
  last one. Trust the receipt over this sentence. Nothing is pushed.
  WHAT EXISTS: see README.md State and the Delivered lines in plan.md.
  WHAT IS OWED: the gate baseline predates the tests this track added, so the suite is green
  against it only because more checks than the baseline is not a violation. Step 7 settles it.
  The owner is owed: the merge of `worktrees` into the source branch, and the push.
  This machine has no git identity configured: pass one on the command line, copied from
  `git log -1 --format='%an <%ae>'`. The owner authorised commits for this track on 2026-10-08.
  The whole suite now runs longer than a foreground command may on this machine: start a gate
  run in the background and wait for it, and never edit the tree while one runs.

First commit: `guards: measure where the test gate's time goes`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in the track README, except that the owner asked for every
remaining phase in this one session.
```
