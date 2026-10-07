---
id: method-08-the-context-budget
kind: reference
status: open
read_when: "the context gate is red, or an always-on instruction file needs to grow"
paths: ["scripts/harness/measure-context.js", "scripts/harness/context-budget.json", "scripts/harness/harness-baseline.json"]
verify: "node scripts/harness/measure-context.js --self-test && node scripts/harness/measure-context.js --check"
last_verified: 2026-10-05
max_age_days: 90
---

# The context budget: always-on cost as a graded figure

## The failure

- **The cost nobody is billed for.** An injected instruction file grows a paragraph at a time.
  Each paragraph is justified. The total surfaces only as "the model seems to have less room than
  it used to", in a retrospective, with no commit to point at.
- **An unobservable rule.** "Keep context under some share of the window" cannot be checked by
  anyone at the moment of an edit. It was a rule with no instrument.
- **A measurement that gated nothing.** A script measured the always-on bytes and wrote a
  baseline file. Nothing compared the two. The recorded figure for one file was badly out of date
  within days and no check was red.
- **A ceiling in a file the routine command rewrites.** Had the ceiling lived in that baseline
  file, anyone would have lifted it by running the ordinary measurement: no refusal, no special
  commit, no review.
- **A total that contradicts its own rows.** A hand-chosen aggregate budget and hand-chosen
  per-file budgets drift until the sum of the parts no longer equals the whole.
- **A conservative guess that became a fact.** The generated doc index was charged to the startup
  budget for weeks. Nothing injects it; a session opens it like any other doc.
- **The managed slice reported as the total.** The headline figure covered the instruction
  files. The measured first turn was many times larger.

## The mechanism

`scripts/harness/measure-context.js` measures; `scripts/harness/context-budget.json` holds the
ceilings; `--check` is the `context` gate.

| File | Written by | Holds |
|---|---|---|
| `harness-baseline.json` | every ordinary measurement run, in full | the report: bytes per file, per bucket |
| `context-budget.json` | a human, only | the ceilings |

That split is the mechanism. No script ever writes the budget file.

- **The rule for a ceiling:** measured bytes plus 10%, rounded up to the next 256 B. The
  headroom separates "nobody did anything wrong" from "someone spent past a declared budget". An
  ordinary prose edit must not red the suite; a pasted block must. A ceiling carried over from
  another file instead of measured by the rule has less headroom than that until it is
  re-measured, and the budget file marks each one.
- **When it reds:** raise the number in the budget file in the SAME commit as the growth, so the
  always-on cost lands in that commit's diff. That is the whole protocol. The gate runner's
  `--accept` does not touch this file.
- **One-sided.** A row that shrank passes. A deleted file passes.
- **Coverage fails closed.** A tracked always-on file with no ceiling FAILS. A new subtree
  `AGENTS.md` is found by walking the tree and is red the day it appears, until someone budgets
  it. A bucket that holds ceilings and graded nothing fails too.
- **The total is derived, not chosen:** every injected and policy-read ceiling, plus the LARGEST
  subtree directory's ceilings, at bytes over four. A task touches one subtree, not all of them,
  and one touch loads a policy file together with the stub beside it. The gate
  recomputes it and fails if the recorded figure disagrees in either direction.
- **Generated blocks get their own allowance.** The agent registry inside the routing doc is
  budgeted per row with a declared maximum row count, so the authored bytes are graded alone.
- **The check count is structural:** the same number of checks in every state of the tree, so
  deleting a subtree file cannot read as a vanished check to the gate runner.
- **Only what the repo determines is graded.** Rows under the user's home directory and
  untracked files are measured and printed, never graded: a red with no diff behind it cannot be
  fixed by a commit.
- **What is not graded is named on every run:** skill and agent listings, hook output, MCP tool
  definitions, the per-subagent floor. No green line stands in for them.

## Why a mechanism and not a rule

- A budget expressed as a share of the window is unobservable, so it was never kept. A number
  per file is observable at the one moment it matters: the diff that grows the file.
- "Re-measure after changing the instruction file" was a step people skipped. Now the gate
  re-measures on every run.
- The hand-written file is the lesson worth stealing. A threshold that a tool can update records
  what happened. A threshold only a person can edit records what was agreed.

## The cost and the limits

- **A fresh install starts on a placeholder.** `harness init` writes the budget with
  `placeholder: true` and ceilings taken from the starter files it has just rendered. The gate
  prints a warning line while the flag is set, and a pass under it means little: measure, replace
  the figures, delete the flag. This repo's own budget is measured; its working is in the file.
- **Nothing is graded before the first commit.** The gate grades what git tracks, so an empty
  index is red on coverage. That is the honest verdict, and it clears when the files are added.
- **Bytes over four is an estimate** of tokens, not a tokenizer.
- **It grades the minority of the bill.** Tool schemas, skill listings, the system prompt and
  the per-subagent floor are typically far larger than every instruction file together, and they
  are measured at best, never graded. A green `context` gate says the declared files stayed
  inside their declared sizes. It does not say the session is cheap.
- **Prompt caching changes the arithmetic.** A stable always-on prefix is mostly paid as a cache
  read after the first turn. Shaving it has real but smaller marginal value than a raw byte count
  suggests; the uncached per-agent floor is where fan-out spend goes.
- **Cold start only.** Nothing here watches the window fill during a session or warns the agent.
  The one in-session signal is the context percentage `.claude/helpers/statusline.cjs` prints,
  and that reaches the person, not the agent.
- **A ceiling is consent, not virtue.** Raising the number is always allowed. The mechanism
  guarantees the raise is visible in a diff, and nothing more.
- **Cost:** a tree walk and a file read per run. The gate skips hook execution and transcript
  reads because both are properties of the machine, not of the tree.
