---
# TEMPLATE. `harness reference new <subsystem>` renders this to <docsRoot>/reference/<SUBSYSTEM>/README.md and drops these comment lines. By hand: copy it there, fill each <PLACEHOLDER>, delete every comment.
# <SUBSYSTEM>: kebab-case, equal to the folder name. Every id in the docs tree must be unique, and the doc gate refuses a duplicate.
id: <SUBSYSTEM>
kind: reference
status: open
# <READ_WHEN>: the ONE line the generated index shows. Write the task that should make someone open this, not the topic it covers.
read_when: "<READ_WHEN>"
# <PATH_GLOB>: the trees this doc is the contract for, as a list. A reader uses it to tell whether their change is this doc's business, and the doc gate warns when a commit touches them after the `last_verified` day.
paths: ["<PATH_GLOB>"]
# <VERIFY_COMMAND>: one command, present in this repo, that checks the claims below. Nothing runs it for you. Delete the line when no such command exists.
verify: "<VERIFY_COMMAND>"
# <YYYY-MM-DD>: the day somebody last checked the body against the code. A real date: a token left here draws a warning from the doc gate and is never reported stale or drifted.
last_verified: <YYYY-MM-DD>
max_age_days: 90
---

# <TITLE>
<!-- <TITLE>: the subsystem and what it guarantees, in a clause, e.g. "Billing export: one ledger, reconciled nightly". -->
<!-- THE RULE: a fact an agent can get by search does not belong here. Write what the code cannot say. -->

## What this is the contract for

<CONTRACT>
<!-- <CONTRACT>: 2 to 5 lines. What a caller may rely on, and what this subsystem deliberately does NOT promise. -->

## Invariants, and why

1. <INVARIANT>. <WHY_IT_HOLDS>
<!-- <INVARIANT>: what must stay true after every change, stated so that a command or a test can check it. One numbered line each. -->
<!-- <WHY_IT_HOLDS>: what breaks when it does not. An invariant with no reason is removed by the first change it gets in the way of. -->

## Decisions, and why

1. <DECISION>. <WHY_IT_WAS_MADE>
<!-- <DECISION>: a choice already made that a new session would otherwise reopen, with the option that was turned down. -->
<!-- <WHY_IT_WAS_MADE>: the reason, the date and who decided. The code shows what was chosen and never why. -->

## What runs where, and outside constraints

<RUNTIME_AND_CONSTRAINTS>
<!-- <RUNTIME_AND_CONSTRAINTS>: the process, host or schedule each part runs in, and every limit set outside this repo: a vendor quota, a contract, a law, another team's API. -->

## Where the code is

- `<PATH>`: <ROLE>
<!-- <PATH>: a directory or a file, one per line. Paths only: no signature, no call graph, no line number. Those are one search away and go stale here. -->
<!-- <ROLE>: what lives there, in a clause. -->

## How to check it

`<CHECK_COMMAND>`
<!-- <CHECK_COMMAND>: the command that proves the invariants above still hold, and what its passing output looks like. When none exists, say so in one line. -->
<!-- After running it, set `last_verified` in the frontmatter to that day. -->
