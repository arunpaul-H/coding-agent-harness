---
id: guard-hardening-handoff
kind: handoff
status: open
read_when: "asking what guard-hardening left behind, or landing it on the source branch"
phase_next: 9
---

# Guard hardening: the track is complete

## ▶ NOTHING IS LEFT TO BUILD: what the owner does next

```
GUARD HARDENING IS COMPLETE. Every phase is closed and the gate baseline is re-recorded.
This track is archived; its folder is under docs/archive/. Nothing here is an open task.

Read, only if you need to know what was built:
  docs/archive/guard-hardening/README.md   (State, Locked decisions)
  docs/archive/guard-hardening/plan.md     (the Delivered line of each phase)
  docs/archive/guard-hardening/traps.md

SCOPE: in: landing the branch, which is the owner's. Out: everything else. No phase is open.

WHAT THE OWNER DOES:
  1. Review branch `worktrees` and merge it into the source branch. Harness files change on
     the source branch first, so this track is not in force anywhere else until that merge.
  2. Push.
  3. In a repo installed before this track, add `Agent` to the pre-tool hook matcher by hand
     (GH-12): the installer never rewrites a registration that is already there.

Do NOT reopen a phase here: a follow-up is a new track with its own folder.
Do NOT re-run a measurement: the four research files in this folder are frozen.
Do NOT edit this folder: it is archive, and the linter recomputes its receipt.
Do NOT edit a skill under .claude/skills without re-pinning it in the same commit (GH-11).

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 7 are committed and closed, and the baseline was re-recorded after them in a
  commit of its own. The receipt in README.md's frontmatter names the last close.
  WHAT EXISTS: see README.md State and the Delivered lines in plan.md.
  WHAT WAS NOT DONE: the test-time measurement covers one machine, not the Linux box the plan
  also asked for; the stop and spawn measurements were headless sessions only.
  WHAT IS OWED: the merge of `worktrees` into the source branch, and the push. Both are the
  owner's. Nothing is pushed.

First commit: `guard-hardening: archive the track`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: follow "How to work" in the track README if a question about this track comes up.
```
