---
id: guard-hardening-handoff
kind: handoff
status: open
read_when: "starting or resuming guard-hardening"
phase_next: 4
---

# Guard hardening: the next step

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASES 4 TO 7, THEN CLOSE THE TRACK: the owner asked for the rest in one session

You are in the folder Agent-Harness-worktrees, on branch `worktrees`. Run `git status --short`
first: the tree must be clean. If it is not, say what is there and stop.

Read, in this order:
  docs/tracks/guard-hardening/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/guard-hardening/plan.md     (Phases 4 to 7)
  docs/tracks/guard-hardening/traps.md
  docs/reference/DOC-STANDARD.md          (section 6: closing, and the archive route)
Nothing else until a phase names a file.

SCOPE: in: phase 4 (the stop report), phase 5 (pins for the shipped skills), phase 6 (the spawn
contract check), phase 7 (the test-time measurement), then the re-baseline and the archive.
Out: the three pre-tool guards phases 1 to 3 changed; merging; pushing.

DO THEM IN ORDER, ONE AT A TIME. For each phase:
  1. Where plan.md says measure first, measure in a throwaway repo in the scratchpad and freeze
     the result as a research file under docs/tracks/guard-hardening/research/.
  2. Make the change, with the refusal and the ordinary call that must still pass both tested,
     in the script's --self-test and as a process under tests/.
  3. Run the phase's Exit command from plan.md in the foreground and paste its output.
  4. Rewrite README.md State and the phase's Delivered line, and replace this file wholesale
     with phase_next raised by one.
  5. Commit with the subject plan.md names, then run
     `node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1` at HEAD
     on the clean tree, then `node scripts/harness/close-phase.js guard-hardening`, then commit
     the receipt as `guard-hardening: close phase <n>`.
A phase that cannot close says why and stops; do not start the next one.

AFTER PHASE 7:
  6. `node scripts/harness/gates.js --accept --allow-skip docs=1,reproducible-build=1`, and
     commit scripts/harness/gates.baseline.json ALONE, subject `gates: re-baseline after guard hardening`.
  7. A final handoff saying the track is complete, the gate at HEAD, then
     `node scripts/harness/close-phase.js guard-hardening --archive`, and commit it.
  8. `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.

Do NOT re-run the probe: its result is in research/2026-10-08-guard-probe.md.
Do NOT re-open the six locked decisions in the README.
Do NOT flip a status: line, type a receipt or move the track by hand: close-phase.js does all three.
Do NOT make the stop handler block a turn by default: it reports, and blocking is an opt-in key.
Do NOT write a review date for a shipped skill that no person earned.
Do NOT merge `worktrees` into the source branch or push: the owner does.
No inline node -e, and no backslash inside a here-document (GH-01): write a file.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 3 are committed and closed: the receipt in README.md's frontmatter names the
  last one. Trust the receipt over this sentence. Nothing is pushed.
  WHAT EXISTS: see README.md State and the Delivered lines in plan.md.
  WHAT IS OWED: the gate baseline predates the tests this track added, so the suite is green
  against it only because more checks than the baseline is not a violation. Step 6 settles it.
  The owner is owed: the merge of `worktrees` into the source branch, and the push.
  This machine has no git identity configured: pass one on the command line, copied from
  `git log -1 --format='%an <%ae>'`. The owner authorised commits for this track on 2026-10-08.

First commit: `guards: report at stop when edits outran the gates`
Exit: `node scripts/harness/hook.js --self-test && node bin/harness.js gates --check`

How to work: follow "How to work" in the track README, except that the owner asked for every
remaining phase in this one session.
```
