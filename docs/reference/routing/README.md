---
id: routing
kind: reference
status: open
read_when: "you are the lead agent choosing a mode for a task, writing a spawn prompt, or closing a phase"
paths: [".claude/agents/**", "scripts/harness/docs-index.js", "scripts/harness/close-phase.js"]
verify: "node scripts/harness/docs-index.js --check"
last_verified: 2026-10-05
max_age_days: 90
---

# Routing: how work is routed here

> **The lead agent opens this. Nothing injects it**: every agent holds the policy file
> (`AGENTS.md`), the subtree `AGENTS.md` it touches, and its prompt.
> `node scripts/harness/measure-context.js` prints this file as the `policyReads` row. The
> principles hold under any coding agent; a clause marked *Claude Code* names that tool's own
> mechanism. Default stance: auto-route per task, unless the user says "solo this".

## 1. Routing: pick the lowest mode that fully fits

| Mode | Use when | How |
|---|---|---|
| **Solo** | 1–2 files · a ≤2-line fix · docs or config · a question · an edit you already hold the context for | Just do it. No agents. |
| **Spawn** (fan-out) | 2–N **independent** subtasks with no shared contract | Every spawn in ONE message, in the background, each named, each carrying the §2 contract (*Claude Code*: `Agent` calls with `run_in_background`) |
| **Research → plan → implement** | A phase of a track: something with a handoff, a gate and a commit | §3. The lead plans and reviews; subagents research and implement |
| **Workflow** | A multi-stage pipeline the user has explicitly opted into | The tool's native pipeline only (*Claude Code*: `Workflow`), and only on that opt-in |

Over-coordinating burns context; under-coordinating drops quality. Unsure → the lighter mode.
**A written tracker beats a persistent agent.** Every folder under `docs/tracks/` carries its own
state and exactly one `handoff.md`; that file *is* the cross-session memory.

**Route by the shape of the phase, not the size of the track.** Scaffold or mechanical clone →
solo. Work whose parts must reconcile with each other (generated data, one sequence, one
identity) → SOLO, never fan out: a fan-out yields parts that each look right and do not add up.
N independent files → spawn one per file, then verify solo. An audit → spawn per search class,
then triage solo.

## 2. The spawn contract: mandatory on every spawn

```
OUTCOME:  one sentence; what "done" looks like, checkable by the agent itself.
READ-SET: the exact files (+ headings) this agent may read. "None, everything you need is
          below" is the best answer. Past it: do the work, then report what you opened and why.
RETURN:   the shape of the answer, as fields, not prose. It lands in my context.
BOUNDS:   what it must NOT do: other subtrees, rebuild artifacts, spawn further agents, edit
          shared or config files, commit.
```

- **Checked** (*Claude Code*): `spawn-guard.cjs` denies a §4 agent's spawn lacking a name.
- **Hoist the shared read.** If N agents would each open the same doc, open it once here and
  paste the distilled lines into every prompt. Every worker then sees the *same* distillation and
  cannot drift apart on interpretation.
- **Keep READ-SETs disjoint.** Overlap is duplicated cost, and a signal they should be one agent.
- **Returns are context too.** Findings, not file dumps.
- **Count what came back.** A fan-out that filters out failed agents reports total verification
  failure as "found nothing". Count nulls explicitly, retry with a sentinel, never claim coverage
  you did not get.
- **Hooks fire for spawned agents** wherever the tool runs hooks at all: the same denied command
  comes back denied from the lead and from a subagent. A guard is therefore not a reason to keep
  write work in the lead. BOUNDS still is: a guard denies a shape, never a scope.
- Always name an agent, always say who it messages next, spawn all of them in ONE message,
  then **stop and tell the user what is running**. Never poll.

## 3. Research → plan → implement

1. **Research**: a subagent, read-only plus web. It writes nothing outside
   `docs/tracks/<id>/research/<date>-<slug>.md`, which is dated, frozen on commit, and never
   edited afterwards. Findings, not instructions.
2. **Plan**: the LEAD, from a named research file. Rewrite `plan.md` and `handoff.md`; name the
   phase's `first_commit:` and its exit command. Planning is judgement, so it stays with the lead.
3. **Implement**: a subagent that cannot spawn (*Claude Code*: no `Agent` tool). Reads `handoff.md`
   plus the touched subtree's `AGENTS.md` and nothing else. Does ONE task. Ends by running the gate.
4. **Review**: the lead model (*Claude Code*: `inherit`), read-only, findings as `file:line` only.

**Model tiering is a principle, not a model list.** The lead does judgement: classify, plan,
review, security, and anything touching money, PII or auth. A strong model implements and
researches inside a READ-SET. A cheap model only explores, lists and transforms mechanically,
where a wrong answer is cheap to catch. Agent files name a tier alias (*Claude Code*: `opus`,
`haiku`, `inherit`), never a dated id, so the tier survives a model release.
**Never fan out the lead model.** The context-rot control is a fresh session per phase, and the
handoff block is the compaction artifact.

## 4. The agent registry (*Claude Code*)

This section is that tool's own: the table is generated from `.claude/agents/*.md`, and no other
tool's agent files are rendered. An unregistered `subagent_type` is not a soft failure: the spawn
comes back empty. Use a name from this table or from the runtime's own available-agent list;
plugin agents are always `plugin:name`. Built-ins that always resolve: `Explore` (broad
read-only search), `general-purpose` (open-ended multi-step), `Plan` (implementation plan).

<!-- agents:begin -->
<!-- GENERATED by `node scripts/harness/docs-index.js --agents`. DO NOT EDIT. -->

| subagent_type | model | tools | use for |
|---|---|---|---|
| `explore` | haiku | Read, Grep, Glob | Read-only search across many files or naming conventions when only the conclusion is wanted, not the file dumps. Locates code; does not judge it. |
| `implement` | opus | Read, Grep, Glob, Edit, Write, Bash | Does ONE task from a handoff block inside a named READ-SET and ends by running the gate. Spawns nothing and commits nothing. |
| `research` | opus | Read, Grep, Glob, WebFetch, WebSearch, Write | Answers ONE question from the repo and the web and leaves a dated frozen research file behind. Writes that one file and nothing else. |
| `review` | inherit | Read, Grep, Glob | Read-only review of a change already in the tree; returns ranked file:line findings and fixes nothing. Inherits the lead model because reviewing is judgement. |

<!-- agents:end -->

## 5. Outcome gate: what "done" means

Done means **verified**, not edited:

- `node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1` green, its output
  pasted. Every gate, one verdict, and the only place a figure exists. `--accept` re-baselines;
  it refuses on a red suite and on an undeclared skip. Its commit subject must start `gates:`.
- **Behaviour observed** where a surface changed: run the thing and look at it. A green suite
  proves the checks pass, not that the change does what was asked.
- **No regressions**: you did not break a neighbour, and nothing was silently removed.
- **Reported faithfully**: a skipped step or a failing test is said out loud, with output.

The stray-file sweep is not a manual ritual. `commit-hygiene.cjs` denies a commit carrying
strays, secrets, gitignore gaps or root clutter, and it reads ignored files too, so it sees what
a bare `git status` hides. Modified tracked files are not a finding. Read a finding before you
waive it.

**Closing a phase of a track**, in this order:

1. Rewrite the track folder to current truth. It is a tracker, not a changelog.
2. Replace `handoff.md` **wholesale**, for a session with no memory of this one.
3. Run the gate at HEAD against a clean tree.
4. `node scripts/harness/close-phase.js <id>`. It refuses unless `gates.json` is green at HEAD,
   was recorded against a clean tree (absent is not clean), and is not stale; the tree is
   hygiene-clean; `handoff-lint` passes; and the ▶ block has changed since the last receipt.
   Then it writes that receipt, which `docs-lint` recomputes.
5. `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.

`phase-guard.cjs` denies the manual versions of step 4: a hand-flipped `status:`, a typed
receipt, a bare `mv` into `docs/archive/`, a gate figure written into a doc.
