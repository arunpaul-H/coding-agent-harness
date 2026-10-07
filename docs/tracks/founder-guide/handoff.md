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
PHASE 2: init installs the guide, and a test holds the two lists together

Read, in this order:
  docs/tracks/founder-guide/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/founder-guide/plan.md     (Phase 2, and Phase 1 "Delivered" for what exists)
  docs/tracks/founder-guide/traps.md    (before touching anything)
  docs/tracks/multi-tool/handoff.md     (what the neighbour's live phase is doing to the same files)
Nothing else unless a line below cites it. In bin/harness.js, package.json,
scripts/harness/common.json and tests/cli.test.js, find the lines by Grep for SHIPPED_SKILLS and
for the skills/plan directory entry; do not read those files whole.

SCOPE: in — add guide to SHIPPED_SKILLS in bin/harness.js, its directory to files in package.json
and to dirs in scripts/harness/common.json, and the tests plan.md Phase 2 names in
tests/cli.test.js; then one re-baseline commit. Out — buildPlan and how a skill directory is
copied, tools.json, every dialect, skills-lock.json, the skill body, the root README, any agent file.

Do NOT re-derive, re-measure or re-open: what shipping a skill touches is frozen in
docs/tracks/founder-guide/research/2026-10-07-guide-skill-ship-surface.md — do not repeat that
sweep. The eight locked decisions in README.md stand; do not re-litigate skill versus agent, inline
versus fork, the reader, the scope or the lock. Do not rewrite the skill: it was tried and found clear.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phase 1 landed: .claude/skills/guide/SKILL.md exists, inline, tried once by the owner. Whether
  phase 1 is CLOSED is the receipt in README.md's frontmatter; if it is absent, the close was
  refused because the tree was not clean, and it is owed before this phase closes.
  The multi-tool track's phase is LIVE in this same working tree and edits bin/harness.js,
  tests/cli.test.js and scripts/harness/** (FG-01). Before any edit here, run git status. If any
  of the four files this phase edits is modified and you did not modify it, STOP and ask the
  owner: do not edit under another session's uncommitted work.
  Re-read each shared file immediately before editing it and change only the lines named above.
  Stage by path only. Never stash, restore or reset: the other session's work is in the tree.
  A gate red because of a file the neighbour changed is reported as theirs, never fixed here.
  Make both list edits together: a skill in SHIPPED_SKILLS and not in files reds nothing in a
  checkout and stops a packed install dead (FG-02).
  The neighbour renders every shipped skill a second time into another directory. This phase
  adds nothing for that; the guide reaches it through the same constant.
  Run the suite on both supported Node versions before pushing (FG-03).
  The new tests move the test gate: re-baseline in a commit of its own whose subject starts
  gates:, only on a green run, and only when the owner asks for commits.

First commit: `founder-guide: init installs the guide skill`
Exit: `node bin/harness.js --self-test && node --test tests/cli.test.js && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

How to work: follow "How to work" in docs/tracks/founder-guide/README.md. One phase, then stop
and hand off.
```
