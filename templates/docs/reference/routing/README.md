---
id: routing
kind: reference
status: open
read_when: "you are the lead agent choosing a mode for a task, writing a spawn prompt, or closing a phase"
paths: [".claude/agents/**", "scripts/harness/docs-index.js", "scripts/harness/close-phase.js"]
verify: "node scripts/harness/docs-index.js --check"
---

# Routing: how work is routed here
<!-- TEMPLATE. `harness init` renders it to <DOCS_ROOT>/reference/routing/README.md. Fill each <PLACEHOLDER>, delete every comment EXCEPT the two `agents:` markers in section 4. Keep it under 150 lines, the `default` cap in `docs.caps`: this doc has no cap key of its own. -->

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
**A written tracker beats a persistent agent.** Every folder under `<TRACKS_DIR>/` carries its own
state and exactly one `handoff.md`; that file *is* the cross-session memory.
<!-- <TRACKS_DIR>: `project.tracksDir` in harness.config.json. Default `docs/tracks`. -->

<ROUTING_LESSONS>
<!-- <ROUTING_LESSONS>: 2 to 5 lines of routing this repo paid to learn, e.g. which kind of work must stay solo because its parts have to reconcile. Delete the line if you have none yet. -->

## 2. The spawn contract: mandatory on every spawn

```
OUTCOME:  one sentence; what "done" looks like, checkable by the agent itself.
READ-SET: the exact files (+ headings) this agent may read. "None — everything you need is
          below" is the best answer. Past it: do the work, then report what you opened and why.
RETURN:   the shape of the answer, as fields, not prose. It lands in my context.
BOUNDS:   what it must NOT do: <BOUNDS_EXAMPLES>, spawn further agents, commit.
```
<!-- <BOUNDS_EXAMPLES>: the scopes a worker most often strays into here, e.g. "other packages, rebuild artifacts, edit shared config". -->

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
   `<TRACKS_DIR>/<id>/research/<date>-<slug>.md`, which is dated, frozen on commit, and never
   edited afterwards. Findings, not instructions.
2. **Plan**: the LEAD, from a named research file. Rewrite `plan.md` and `handoff.md`; name the
   phase's `first_commit:` and its exit command. Planning is judgement, so it stays with the lead.
3. **Implement**: a subagent that cannot spawn (*Claude Code*: no `Agent` tool). Reads `handoff.md`
   plus the touched subtree's `AGENTS.md` and nothing else. Does ONE task. Ends by running the gate.
4. **Review**: the lead model (*Claude Code*: `inherit`), read-only, findings as `file:line` only.

**Model tiering is a principle, not a model list.** The lead does judgement: classify, plan,
review, security, and anything touching money, PII or auth. A strong model implements and
researches inside a READ-SET. A cheap model only explores, lists and transforms mechanically,
where a wrong answer is cheap to catch. **Never fan out the lead model.** The context-rot control
is a fresh session per phase, and the handoff block is the compaction artifact.

## 4. The agent registry (*Claude Code*)

This section is that tool's own. An unregistered `subagent_type` is not a soft failure: the spawn
comes back empty. Use a name from this table or from the runtime's own available-agent list;
plugin agents are always `plugin:name`. Built-ins that always resolve: `Explore` (broad
read-only search), `general-purpose` (open-ended multi-step), `Plan` (implementation plan).

<!-- KEEP the two markers below exactly as they are (they are not template comments), then run `node scripts/harness/docs-index.js --agents`: it writes the table between them from .claude/agents/*.md. Never edit the table by hand. -->
<!-- agents:begin -->
<!-- agents:end -->

## 5. Outcome gate: what "done" means

Done means **verified**, not edited:

- `node scripts/harness/gates.js --check <ALLOW_SKIP>` green, its output pasted. Every gate, one
  verdict, and the only place a figure exists. `--accept` re-baselines; it refuses on a red suite
  and on an undeclared skip. A re-baseline commit's subject starts `gates:`.
- **Behaviour observed** where a surface changed: `<RUN_COMMAND>`, then look at the surface.
- **No regressions**: you did not break a neighbour, and nothing was silently removed.
- **Reported faithfully**: a skipped step or a failing test is said out loud, with output.
<!-- <ALLOW_SKIP>: `--allow-skip <gate>=<n>` for each skip this repo tolerates, or nothing. -->
<!-- <RUN_COMMAND>: the command that starts the thing a user would actually see. -->

The stray-file sweep is not a manual ritual. `commit-hygiene.cjs` denies a commit carrying
strays, secrets, gitignore gaps or root clutter, and it reads ignored files too, so it sees what
a bare `git status` hides. Modified tracked files are not a finding. Read a finding before you
waive it.

**Closing a phase of a track**, in this order: rewrite the track folder to current truth ·
replace `handoff.md` wholesale for a cold session · run the gate at HEAD on a clean tree ·
`node scripts/harness/close-phase.js <id>` (it refuses unless the verdict is green, at HEAD,
clean and not stale, hygiene is clean, `handoff-lint` passes and the ▶ block changed; then it
writes the receipt) · `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.
`phase-guard.cjs` denies the manual versions: a hand-flipped `status:`, a typed receipt, a bare
`mv` into the archive, a gate figure written into a doc.
