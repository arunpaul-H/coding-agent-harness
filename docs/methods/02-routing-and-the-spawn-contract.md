---
id: method-02-routing-and-the-spawn-contract
kind: reference
status: open
read_when: "deciding whether to spawn agents, or writing the prompt for one"
paths: ["docs/reference/routing/**", ".claude/agents/**", ".claude/skills/**", "scripts/harness/docs-index.js"]
verify: "node scripts/harness/docs-index.js --self-test && node scripts/harness/docs-index.js --check"
last_verified: 2026-10-05
max_age_days: 90
---

# Routing, and the four-block spawn contract

## The failure

- **A fan-out that filters out its failures.** A batch of verifiers is spawned, several of them die
  or return nothing, the collector drops the empty results, and the summary reads "no problems
  found". Total verification failure has been reported as a clean result.
- **Workers that drift on interpretation.** N agents each open the same long doc and each distils
  it differently. Their outputs do not reconcile and nobody can say which reading was intended.
- **Overlapping reads.** Two agents read the same files. The cost is paid twice and the overlap
  was a signal they should have been one agent.
- **Returns that are file dumps.** A worker's reply lands in the lead's context. A reply that
  pastes what it read spends the lead's window on the thing the spawn existed to avoid.
- **Coherent work fanned out.** Generated or seeded data split across workers yields totals that
  do not add up while every individual output still looks plausible.
- **A spawn naming an agent type that does not exist** comes back empty, not as an error.
- **Over-coordination.** A two-line fix routed through three agents costs more than the fix.

## The mechanism

**Routing: pick the lowest mode that fully fits.** This table belongs in the routing doc,
`docs/reference/routing/README.md`, which only the lead opens.

| Mode | Use when | How |
|---|---|---|
| Solo | one or two files, a small fix, docs, a question, an edit you already hold context for | Do it. No agents. |
| Spawn | several independent subtasks with no shared contract | all spawned in one message, each named, each carrying the contract |
| Research, plan, implement | a phase of a track: a handoff, a gate and a commit | the lead plans and reviews; subagents research and implement |
| Workflow | a multi-stage pipeline the user explicitly opted into | only on that opt-in |

Unsure: the lighter mode. Anything whose parts must reconcile in one head stays solo.

**The spawn contract: four blocks on every spawn.**

```
OUTCOME:  one sentence; what "done" looks like, checkable by the agent itself.
READ-SET: the exact files (and headings) this agent may read. "None, everything you need is
          below" is the best answer. Past it: do the work, then report what was opened and why.
RETURN:   the shape of the answer, as fields, not prose. It lands in the lead's context.
BOUNDS:   what it must NOT do: other areas, rebuilds, further spawns, shared files, commits.
```

- **Hoist the shared read.** If N agents would open the same doc, open it once in the lead and
  paste the distilled lines into every prompt. Every worker then sees the same distillation.
- **Keep READ-SETs disjoint.**
- **Give absence a field.** RETURN should carry `ABSENT`, `NOT DONE`, `UNSURE` and `READ-PAST`,
  so "I did not find it" and "I did not look" are different answers.
- **Count what came back.** Compare replies received against agents spawned. A null is a failure
  to verify, never "found nothing". Retry with a sentinel value; never claim coverage you lack.
- **Tier the models.** The lead keeps judgement: classify, plan, review, anything touching
  security or money. A strong model implements and researches inside a READ-SET. The cheapest
  model only explores and transforms mechanically, where a wrong answer is cheap to catch.
- **A written tracker beats a persistent agent.** State lives in the track folder
  ([03](03-tracks-handoffs-and-cross-session-memory.md)), not in a long-lived worker.

**What is code.**

- The four agent briefs in `.claude/agents/` (`explore`, `research`, `implement`, `review`) each
  declare `model:` and `tools:`. Two are read-only by construction; `implement` has no spawn tool.
- `node scripts/harness/docs-index.js --agents` generates the registry block in the routing doc from
  those files, so the table of valid agent names cannot be hand-edited out of step.
- `docs-index.js --check` validates the agent files and holds each brief to a line cap, because
  a brief's description is startup cost in every session that can spawn it.
- The PreToolUse guards fire for a spawned agent's tool calls exactly as for the lead's. Probe
  this in your own runtime: issue one harmless denied command from each and compare.

## Why a mechanism and not a rule

Stated plainly: **most of this doc is still a rule.** The contract is four labelled blocks in a
prompt, and nothing refuses a spawn that omits them. It is here because the failures above are
real and the wording is the cheapest known defence, not because it is enforced.

What was promoted to code is the part that failed silently:

- The agent registry was a hand-kept list. A name missing from it produced an empty reply with
  no error, so the list is now generated and checked.
- "A subagent must not spawn or write" was a sentence in a brief. It is now the absence of the
  tool from that agent's `tools:` line.
- "Guards apply to subagents too" was an assumption the routing doctrine was designed around
  without knowing. It is now a probe: one denied command from the lead, one from a spawned
  agent, compared. This repo ships the probe as a step, not a stored result. Record yours.

## The cost and the limits

- **The contract is unenforced.** A lead that skips it gets no error. Review the spawn prompts.
- **`tools:` is evidenced, not guaranteed.** A named agent has been observed to fall back,
  silently, to a general-purpose agent with a full tool pool. Do not treat an agent's tool list
  as a security boundary without checking what the spawned agent actually holds.
- **A guard denies a shape, BOUNDS limits a scope.** Hooks reaching subagents does not make
  BOUNDS redundant: no hook knows which directory a worker was told to stay out of.
- **READ-PAST is self-reported.** Nothing detects an agent that read outside its READ-SET and
  did not say so.
- **"Count what came back" is arithmetic the lead must do.** No script tallies a fan-out here.
- **Model tiering is a judgement.** Which tier is good enough for implementation is a local
  measurement. Re-measure when models change; a cheaper wrong answer costs a correction cycle.
- **Cost:** every spawn pays the runtime's per-agent floor before it reads a byte of its task.
  For a small job that floor exceeds the job. That is the argument for solo as the default.
