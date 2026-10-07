---
# TEMPLATE. Copy this folder to <tracksDir>/<TRACK_ID>/, fill each <PLACEHOLDER>, delete every comment.
# <TRACK_ID>: kebab-case, equal to the folder name. close-phase.js is invoked with it, and every id in the docs tree must be unique.
id: <TRACK_ID>
kind: track
status: open
# <READ_WHEN>: the ONE line the generated index shows. Say when to open this, not what it is. Vague here means nobody opens it at the right moment.
read_when: "<READ_WHEN>"
# <PREFIX>: 2 to 5 capitals. Traps are then cited as <PREFIX>-01 everywhere, and a bare `trap #1` fails the doc gate.
trap_prefix: <PREFIX>
# <PATH_GLOB>: the trees this track changes, as a list. A reader uses it to tell whether their task is this track's business.
paths: ["<PATH_GLOB>"]
# <TRACK_ID> again below: the two commands that prove this folder is still well formed.
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js <TRACK_ID>"
# <YYYY-MM-DD>: the day somebody last RAN `verify`, not the day the file was edited. Stale is a warning, never a red.
last_verified: <YYYY-MM-DD>
max_age_days: 30
# NEVER type closed_phase / closed_at / gates_sha / block_sha / receipt, and never flip status to complete.
# close-phase.js writes all of them, phase-guard denies the typed version, and docs-lint recomputes the receipt.
---

# <TRACK_TITLE>
<!-- <TRACK_TITLE>: the outcome in a clause, e.g. "Billing export: one ledger, reconciled". -->

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

<WHAT_AND_WHY>
<!-- <WHAT_AND_WHY>: 3 to 8 lines. The problem, the evidence it rests on (name the research file), and what this track changes. Then one line on what it deliberately does NOT change. -->

## Locked decisions

1. <DECISION>. <WHY_IT_IS_LOCKED>
<!-- <DECISION>: a choice already made that a new session would otherwise reopen. One numbered line each. -->
<!-- <WHY_IT_IS_LOCKED>: the reason, and who decided. A decision with no reason is reopened by the first session that disagrees with it. -->

## Invariants

1. <INVARIANT>
<!-- <INVARIANT>: what must stay true through every phase, stated so that a command or a test can check it. -->

## State

| Phase | What it delivers | Status |
|---|---|---|
| 0 | <PHASE_OUTCOME> | open |
<!-- <PHASE_OUTCOME>: one clause per phase, matching plan.md. Status is `open` or `closed`. A row says closed only after close-phase.js printed CLOSED for it. -->
<!-- No gate figure in this table or anywhere in this file: `node scripts/harness/gates.js --check` is how one is read. -->

## How to work

One phase per session. Start from `handoff.md`, read only what its `Read` list names, do the
phase, run its `Exit:` command in the foreground and paste the output. Then rewrite this file to
current truth, replace `handoff.md` wholesale, and close with
`node scripts/harness/close-phase.js <TRACK_ID>`. A phase that cannot close says so and stops.

<TRACK_SPECIFIC_WORKING_RULES>
<!-- <TRACK_SPECIFIC_WORKING_RULES>: the standing rules for THIS track only, e.g. "never edit the live hook, mutate a copy". Delete the line if there are none. -->
