---
id: founder-guide
kind: track
status: open
read_when: "any work on the non-technical on-ramp: the guide skill, its install by init, or the start-here section of the root README"
trap_prefix: FG
paths: [".claude/skills/guide/**", "bin/harness.js", "package.json", "scripts/harness/common.json", "tests/cli.test.js", "README.md", "CHANGELOG.md", "docs/methods/**", "docs/reference/branches/README.md"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js founder-guide"
last_verified: 2026-10-07
max_age_days: 30
---

# Non-tech guide: a plain-English on-ramp that changes no check

> ### Read which section, do not read it whole.
> | Your task | Read |
> |---|---|
> | Starting or resuming a phase | `handoff.md`, then **State** below |
> | Something behaves oddly | `traps.md` first. Every hazard there cost a real hour |
> | Why the scope is this and not more | **Locked decisions** |
> | What must not move | **Invariants** |
> | The phases and their exit commands | `plan.md` |

> **Self-evolving tracker. Current truth only, not a changelog.** Rewrite in place when a phase
> lands. A cold session reads THIS plus `handoff.md` and continues with no memory of the last one.

## What this is

Many new repository owners are not tech experts: they do not write code, and they drive a coding
agent themselves. A founder is one such reader, not the only one. The track id keeps its first
name, `founder-guide`; the reader it serves is anyone who is not a tech expert. This repo speaks to developers only: its README assumes a reader who knows what a gate, a hook and
a baseline are. This track adds an on-ramp for that reader and nothing else:

- one skill, `guide`, that walks a non-technical person through setup and says in plain words
  what a red or green result means and what to ask the agent next;
- that skill installed by `harness init`, so that reader has it in their own repo;
- one short, visual section near the top of the root `README.md` that points to it.

The evidence for what shipping a skill touches is `research/2026-10-07-guide-skill-ship-surface.md`.
It deliberately does NOT change any gate, guard or threshold, and does not change who the repo is
for: it stays a developer's tool with a side door.

## Locked decisions

Decisions 1 to 3 were made by the owner on 2026-10-07. Decisions 4 to 8 are the lead's, taken from
the research file, and stand until the owner says otherwise.

1. **The reader is a person who is not a tech expert, driving the agent themselves**, in their
   own repo. The owner widened this from "a solo founder" on 2026-10-07. Not someone overseeing
   a developer or an agency: that reader needs a different guide.
2. **The guide covers this harness only.** Setup, reading a result, what to ask next, and what a
   green result does not prove. No coaching on whether the idea is good: nothing here can check
   that advice, and the README says this repo is not a prompt library.
3. **`init` installs it.** A guide that exists only in a clone of this repo never reaches the
   reader's project.
4. **A skill, not an agent.** An agent is a worker the lead spawns; it cannot hold a conversation
   with a person. A new agent file would also add a row to the generated registry and a line to
   the context budget for no gain.
5. **The skill runs inline.** Its frontmatter carries no `context` and no `agent` key. A forked
   skill runs in the background and cannot ask a question (FG-05).
6. **The skill stays unpinned in `skills-lock.json`**, like the three already shipped. A pin does
   not travel through `init`, and pinning one of four would be inconsistent.
7. **The guide never weakens a check on the reader's behalf.** It may run the gates and explain
   them. It does not re-baseline, waive a hygiene finding or allow a skip without first saying in
   plain words what that gives up and getting a yes.
8. **Diagrams are Mermaid blocks in the README.** GitHub draws them; no image file is committed
   and no tool is added.

## Invariants

1. `.claude/agents/` holds the same four files after every phase.
2. `.claude/skills/guide/SKILL.md` has no `context:` and no `agent:` line in its frontmatter.
3. `.claude/skills/guide/` holds no `AGENTS.md` and no `CLAUDE.md`.
4. Every name in `SHIPPED_SKILLS` (`bin/harness.js`) has an entry in `package.json` `files`. From
   phase 2 a test holds this; before it, it is prose.
5. `package.json` `dependencies` and `devDependencies` stay empty.
6. The start-here section of the root `README.md` carries no gate figure, and every developer
   section below it stays.
7. No gate is removed, reordered or loosened, and `harness.config.json` `gates` is untouched.

## State

| Phase | What it delivers | Status |
|---|---|---|
| 1 | The `guide` skill, written, checked against the skill-safety checklist, and tried once by a person | landed; closed only if this file's frontmatter carries its receipt |
| 2 | `init` installs it; a test ties the installer's list to the package file list | landed; closed only if this file's frontmatter carries its receipt |
| 3 | The visual start-here section in the root README; every prose count of skills corrected | landed, not yet looked at on GitHub; closed only by a receipt above |

## How to work

One phase per session. Start from `handoff.md`, read only what its `Read` list names, do the
phase, run its `Exit:` command in the foreground and paste the output. Then rewrite this file to
current truth, replace `handoff.md` wholesale, and close with
`node scripts/harness/close-phase.js founder-guide`. A phase that cannot close says so and stops.

Two other tracks are open and claim files this one touches (FG-01, FG-04). Before editing a file
they claim, check that no other session is live in the tree, and keep the edit to the lines named
in `plan.md`. Write for a reader who has never opened a terminal: short sentences, no jargon
without a plain definition beside it, and never a promise the harness cannot keep.
