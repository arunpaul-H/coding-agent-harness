---
id: guard-hardening-handoff
kind: handoff
status: open
read_when: "starting or resuming guard-hardening"
phase_next: 8
---

# Guard hardening: the next step

## ▶ THE NEXT SESSION: paste this into a new chat

```
RE-BASELINE, THEN ARCHIVE THE TRACK: every phase is done

You are in the folder Agent-Harness-worktrees, on branch `worktrees`. Run `git status --short`
first: the tree must be clean. If it is not, say what is there and stop.

Read, in this order:
  docs/tracks/guard-hardening/README.md   (State, How to work)
  docs/reference/DOC-STANDARD.md          (section 6: closing, and the archive route)
Nothing else.

SCOPE: in: the gate re-baseline, a final handoff, the archive, the two doc checks.
Out: every script, guard and test; any new phase; merging; pushing.

DO, IN ORDER:
  1. `node scripts/harness/gates.js --accept --allow-skip docs=1,reproducible-build=1`, in the
     background, and wait for it. It refuses on a red suite.
  2. Commit scripts/harness/gates.baseline.json ALONE, subject
     `gates: re-baseline after guard hardening`.
  3. Replace this file wholesale with a block saying the track is complete, then commit it.
  4. `node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1` at HEAD on
     the clean tree, in the background.
  5. `node scripts/harness/close-phase.js guard-hardening --archive`, and commit what it moved.
  6. `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.

Do NOT re-run any of the four measurements: they are frozen under research/.
Do NOT start a change to speed the suite up: research/2026-10-08-test-gate-time.md found no
single owner of the time, and a change is another track's.
Do NOT flip a status: line, type a receipt or move the track by hand: close-phase.js does all three.
Do NOT edit the baseline by hand, and do not put anything else in its commit.
Do NOT merge `worktrees` into the source branch or push: the owner does.
No inline node -e, and no backslash inside a here-document (GH-01): write a file.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 7 are committed and closed: the receipt in README.md's frontmatter names the
  last one. Trust the receipt over this sentence. Nothing is pushed.
  WHAT EXISTS: see README.md State and the Delivered lines in plan.md.
  WHAT IS OWED: the gate baseline predates the tests this track added, so the suite is green
  against it only because more checks than the baseline is not a violation. Step 1 settles it.
  The owner is owed: the merge of `worktrees` into the source branch, and the push.
  This machine has no git identity configured: pass one on the command line, copied from
  `git log -1 --format='%an <%ae>'`. The owner authorised commits for this track on 2026-10-08.
  The whole suite runs longer than a foreground command may on this machine: start a gate run
  in the background and wait for it, and never edit the tree while one runs.

First commit: `gates: re-baseline after guard hardening`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in the track README.
```
