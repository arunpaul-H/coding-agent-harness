---
id: project-reference-research-one-task-with-and-without-a-reference-doc
kind: research
status: frozen
read_when: "deciding whether a reference doc saves an agent anything, or what to tell an adopter about harness reference new"
question: "Does a hand-filled reference doc, reached through the generated index, change what one agent spends or gets right on one task in this repo?"
answer: "On one pair, slightly. Both runs were correct on all four parts. The run with the doc used about a sixth fewer tokens, the same number of tool calls and one fewer file. One pair is an observation, not proof."
paths: ["bin/harness.js", "templates/reference/**", "scripts/harness/guards/docs-lint.cjs", "README.md"]
commit_at: "1ee350e"
expires: 2026-11-07
---

# One task, with and without a reference doc

**One pair of runs is an observation, not proof.** Nothing here is a rate, an average or a
significance claim. A second pair could reverse the sign of every difference below.

## What was run

- **Date:** 2026-10-08, tree at `1ee350e`, branch `project-reference`.
- **Agents:** two fresh `general-purpose` subagents, both pinned to the same model tier (`opus`),
  each with no memory of the session that spawned it.
- **Prompt:** byte-identical for both. It names no doc. It tells the agent to follow the repo's
  policy file, which sends it to the generated index first.
- **Run A:** the tree held `docs/reference/doc-gate-count/README.md`, created with
  `harness reference new doc-gate-count --read-when ... --paths ... --verify ...` and filled by
  hand by the lead, and the index was regenerated so its row was live.
- **Run B:** that doc was deleted and the index regenerated, so the tree matched `1ee350e`.
- **Order:** A, then B. They could not run at once: the tree differs.

## The task

Read-only. The agent was asked, about a planned warn-only check in the doc linter with three new
self-test cases and no new rule application:

1. by how much the `docs` gate total changes, and which part of the change moves it;
2. whether `gates.js --check` then goes red against the committed baseline, and by which rule;
3. the exact `--allow-skip` value a machine with no auto-memory index needs, and why the docs
   total is the same with and without that index;
4. which command re-baselines, when it refuses, what the commit subject must be, and which script
   enforces that.

Each answer had to cite a file and line. The lead held the answers before the runs, from code and
command output read while building phase 2 of this track: the total rises by three, from the
self-test cases only; no, only a drop is red; `docs=1,reproducible-build=1`, because the
auto-memory rule is one check either way; `gates.js --accept`, which refuses on any red or
undeclared skip, with a `gates:` subject enforced by `commit-hygiene.cjs`.

## What came back

| | Run A, with the doc | Run B, without |
|---|---|---|
| Tokens, from the run's usage report | `65083` | `78068` |
| Tool uses, from the usage report | `18` | `18` |
| Tool calls the agent counted itself | `17` | `17` |
| Wall time, from the usage report | `48099` ms | `43839` ms |
| Files opened, self-reported | `6` | `7` |
| Parts correct, graded by the lead | 4 of 4 | 4 of 4 |

Run A opened the index, the reference doc (whole), and parts of `docs-lint.cjs`, `gates.js`,
`gates.baseline.json` and `commit-hygiene.cjs`. Run B opened the index, the baseline and
`harness.config.json` whole, parts of the same three scripts, and grep hits in `close-phase.js`.

Run A used `12985` fewer tokens than run B. Run B finished about four seconds sooner.

## What it does and does not show

- **Correctness did not differ.** Both agents got every part right from the code. The doc was
  not needed to be right on this task.
- **The doc did not spare the code.** Run A read the doc and then read the same three scripts,
  and said why: the task demanded a file and line, which the doc deliberately does not carry.
  Run A's saving came from narrower reads, not from fewer of them.
- **Run B found something run A did not.** With no doc to lean on it noticed that the gate command
  in the policy file is red on a machine with no auto-memory index. That is true and useful.
- **The index did its job in both directions.** Run A matched the doc's row and opened it. Run B
  found no matching row and went to the code by search, without opening an unrelated doc.

## Why this is weak evidence

- One pair. Model sampling alone can move a token count by more than the gap seen here.
- The doc was written by the session that had just worked on that subsystem and had already
  framed the task. An adopter's doc is written before the question is known.
- The task was a question with a checkable answer. An edit task might behave differently.
- The repo is small and its code is heavily commented, so the code explains itself more than most.
  The comments run B read are the same reasons the doc restated.
- "Files opened" and the per-tool counts are the agents' own reports. Tokens, tool uses and wall
  time are from the runtime's usage line for each run.
- The cost of writing the doc, and of re-verifying it each time the drift warning fires, is not
  in the table.

## The experiment's doc

It was deleted after run A, as planned: `docs/methods/04-gates-and-the-gate-line-protocol.md`
already covers this ground for a human reader. Its body, for the record:

```
# Doc gate count: what moves the docs total, and what a move costs

## What this is the contract for
The figure on the doc linter's GATE docs line, and how gates.js --check grades it against the
committed baseline. It promises that the total falls when a check stops running. It does NOT
promise that the total is stable across edits to the linter: adding a self-test case moves it.

## Invariants, and why
1. The total is self-test decisions plus rule applications, one application per rule per file.
2. A warning never moves the total, and neither does what a rule finds outside the repo.
3. A new eq(...) case in the self-test raises the total by one; a new applied(n) raises it by
   one per file the rule runs on.
4. --check reds on a total BELOW the baseline total, and on a pass figure below the baseline
   pass when the gate skipped nothing. A total above the baseline is green.
5. The auto-memory rule is exactly one check on every machine: one pass where the index was
   read, one skip where it was not.

## Decisions, and why
1. A skip is red unless the caller names it: --allow-skip docs=1,reproducible-build=1 on a
   machine with no auto-memory index.
2. A re-baseline is gates.js --accept and nothing else. It refuses on any red and on an
   undeclared skip, and the commit subject must start gates:.
3. A rise does not need a re-baseline to stay green.

## Where the code is
docs-lint.cjs, gates.js, gates.baseline.json, commit-hygiene.cjs (paths only).
```

## For the owner: README decision 6

Decision 6 left an interview skill open until this measurement. What the measurement adds: a
doc's value on this one task was small and came entirely from content a person already knew. It
says nothing for or against a skill that interviews a person to draw that content out, because no
such skill was run. The question stays the owner's.
