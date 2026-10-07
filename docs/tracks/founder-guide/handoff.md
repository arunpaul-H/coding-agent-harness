---
id: founder-guide-handoff
kind: handoff
status: open
read_when: "starting or resuming founder-guide"
phase_next: 1
---

# Founder guide: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 1: the guide skill exists and a person has used it

Read, in this order:
  docs/tracks/founder-guide/README.md   (State, Locked decisions, Invariants, How to work)
  docs/tracks/founder-guide/plan.md     (Phase 1 only)
  docs/tracks/founder-guide/traps.md    (before touching anything)
  .claude/skills/plan/SKILL.md          (the one shipped skill that runs inline: copy its shape)
  docs/reference/skill-safety/03-the-checklist.md   (run it against the new skill)
Nothing else unless a line below cites it.

SCOPE: in — write .claude/skills/guide/SKILL.md, run the skill-safety checklist against it, and
have a person invoke it once. Out — the installer, package.json, every test, the root README, any
agent file, and any advice about whether a business idea is good.

Do NOT re-derive, re-measure or re-open: what shipping a skill touches is frozen in
docs/tracks/founder-guide/research/2026-10-07-guide-skill-ship-surface.md — do not repeat that
sweep. The eight locked decisions in README.md stand; do not re-litigate skill versus agent, inline
versus fork, the reader, the scope or the lock.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Nothing of this track is built. The track folder holds its four files and one research file.
  The tree is committed and pushed on main and CI is green there; work from a clean tree.
  Two other tracks are open, multi-tool and autonomy-modes. Phase 1 creates one new directory and
  edits no file either of them has written, but multi-tool claims .claude/** — see traps.md FG-01.
  The frontmatter is name, description and argument-hint only. No context key and no agent key:
  a forked skill cannot ask a question — see traps.md FG-05.
  Whether a skill with no context key really runs inline has not been observed, only stated by
  this repo's authors. The one live invocation in this phase is what settles it; record the result.
  The guide must never re-baseline, waive a finding or allow a skip for the person without a plain
  explanation and a yes (README.md, locked decision 7).
  Do not add tests here. They arrive in phase 2 with one re-baseline, not two.

First commit: `founder-guide: the guide skill, inline and in plain English`
Exit: `node scripts/harness/guards/skill-verify.cjs --check && node scripts/harness/measure-context.js --check && node scripts/harness/guards/commit-hygiene.cjs --report`

How to work: follow "How to work" in docs/tracks/founder-guide/README.md. One phase, then stop
and hand off.
```
