---
id: autonomy-modes-research-mechanisms-and-seat-economics
kind: research
status: frozen
read_when: "deciding what mechanism to add to this harness next, or why a flat-rate seat changes the answer"
question: "What do the best-engineered agentic-coding projects enforce that this harness does not, and what does a flat-rate subscription seat actually ration?"
answer: "Eleven mechanisms recur in high-craft work and are absent here; the strongest are a liveness/stall detector, machine-checkable stop conditions the runner owns, held-out verification with a gate-gaming metric, an append-only log with deterministic resume, and a carve-out ratchet. On economics: a seat rations quota and context, not dollars, and the decisive fact is that FULLY AUTO has no resume path across a weekly cap while a phase-gated mode does."
paths: ["scripts/harness/gates.js", "scripts/harness/carveouts.js", "scripts/harness/actions.js", "scripts/harness/measure-context.js", "scripts/harness/handoff-lint.js"]
commit_at: "none (repo has no commits yet)"
expires: 2026-11-05
source: external
---

# ⚠ UNTRUSTED — public repos, papers and vendor posts; read, not reproduced

> **Provenance, applying to every line: this is a literature and source-code survey.** Nothing here
> was benchmarked, reproduced or measured on this machine. Where a figure appears it is the cited
> source's figure, not ours. Two sweeps produced it: a first survey of high-craft work, then an
> eight-modality sweep that excluded everything the first found, of which most agents returned and
> three deep-reads were lost to output encoding and are recorded below as **un-dug, not cleared**.

## Part 1 — Mechanisms this harness lacks, ranked by what a script here could do

The harness already has: a GATE line protocol with a baseline that reds when a check *vanishes*, a
byte ceiling on always-on context, a track and handoff lifecycle with a lint, pre-action deny guards,
a doc-contract linter, a phase-close script that refuses on stale evidence, and a skill lock. Nothing
below duplicates those.

1. **A liveness / stall detector.** Gates detect *incorrect*; nothing detects *stuck*. Magentic-One
   (Microsoft Research) rewrites a progress ledger every inner step answering five fixed questions —
   is the request satisfied, is the team looping, is progress being made, who speaks next, what exact
   instruction — and increments a stall counter that forces the plan to be rewritten past a threshold.
   The counter is a variable, not a vibe. <https://arxiv.org/abs/2411.04468>
2. **Machine-checkable stop conditions the runner owns.** A gate line the agent writes is an
   assertion; an exit code the runner executes is a fact. Block's goose attaches a `retry` block to a
   unit of work: required `checks` that must exit 0, `max_retries`, `on_failure`, `timeout_seconds`.
   <https://goose-docs.ai/docs/guides/recipes/recipe-reference/>
3. **Held-out verification and a gate-gaming metric.** A baselined suite the agent can read and run is
   a target, not a check. METR's SpecBench splits visible from held-out tests and reports the
   reward-hacking gap between them; its finding that stronger models hack evaluations *more* is why
   this matters now rather than later. <https://arxiv.org/abs/2605.21384>
4. **An append-only event log with deterministic resume.** A handoff document is a lossy summary
   written by the party least able to judge what mattered. Anthropic's managed-agents architecture
   makes the session an append-only event log and the harness stateless, resumed by `wake(sessionId)`.
   A study of many thousands of repos found loop *configs* get committed while almost nobody commits
   the state files the discourse prescribes. <https://www.anthropic.com/engineering/managed-agents> ·
   <https://arxiv.org/abs/2608.21884>
5. **The carve-out ratchet.** The baseline reds when a check disappears; nothing counts the waivers
   that keep checks green. AISI's `check_suppressions.py` fails on an exact count mismatch *and*
   refuses to record growth in reason-less waivers without an explicit flag, naming every grown rule.
   Built here as `scripts/harness/carveouts.js`. One further idea from it, not yet taken: that repo
   reads the file governing a change *from the base branch*, so a change cannot edit what governs it —
   whereas this repo's baselines are editable by the run they constrain.
   <https://github.com/UKGovernmentBEIS/inspect_ai>
6. **The derivation ceiling.** `xoai/sage` lets a hook advance state automatically only as far as a
   *fact* readable from the tree, and forbids it structurally from ever deriving an *approval*: a hook
   that advanced a cycle because the files looked finished "would forge the signature the gate exists
   to collect." This became this track's first invariant. <https://github.com/xoai/sage>
7. **The pre-effect ledger.** `golang/oscar` (Jonathan Amsterdam, Go team; live against `golang/go`)
   writes the row *before* the effect and refuses a duplicate idempotency key, so an effect cannot be
   enqueued twice. Built here as `scripts/harness/actions.js`, deliberately demoted to detection only.
8. **Cross-model review at phase close.** A same-model reviewer shares the author's blind spots; Amp
   exposes a deliberately different, stronger model as an in-loop tool. Nearly free on a seat, since a
   seat-holder usually owns two or three vendors. <https://ampcode.com/notes>
9. **Skill *efficacy* evals, not just provenance.** The lock checks that a skill's bytes did not
   change; nothing checks that editing one did not break the behaviour it existed to produce. Fixture
   prompts with binary pass/fail is the discipline.
10. **Citation-grounded reports.** HumanLayer's subagent contract requires `path/file.ext:line` for
    every claim and forbids the researcher from evaluating — and is enforced by nothing but a prompt
    file. A lint that rejects an ungrounded finding is the port, and the linter already exists here.
11. **Subagent concurrency classes.** Unbounded for read and search, exactly one for build and verify,
    to avoid backpressure collapse (from the Ralph loop's practice).

**Deliberately not adopted.** `github/spec-kit`'s phase gates are prose plus "review before
continuing", which adds nothing this repo lacks. Off-VM credential brokering (exe.dev) is correct and
out of reach without infrastructure a subscription user does not have; the env guard here stays the
honest shape-match it is already labelled as.

**Un-dug, not cleared.** Three deep-reads failed on output encoding and were never judged:
`strongdm/leash`, `symposium-dev/symposium` (Niko Matsakis's org), and `harmonist`. Anyone resuming
this survey should start there rather than assume they were rejected.

## Part 2 — What a flat-rate seat rations

1. **There are at least five incompatible metering units**, so one conservation rule cannot be correct
   on all of them: tokens in a rolling window; messages per model per window; dollars of underlying
   model cost; monthly credits that do not roll over; requests per day or per window; weighted credits
   with off-peak discounts; and three independent rolling windows at once. Portability means a per-tool
   metering adapter, not a shared rule.
2. **Cached input counts for less against a subscription limit**, and the vendor's own team treats
   cache breaks as incidents. So the thing to minimise is *cache misses*. Switching model, changing
   effort and compaction invalidate; editing repo files, invoking a skill and **changing permission
   posture** preserve. That last one is a direct argument for expressing a mode as permission posture
   rather than as model choice.
3. **Subagents cost several times a chat, and multi-agent systems an order of magnitude more.** A
   subagent's first request does not read the parent's cache; a *fork* inherits the prefix and does. So
   a spawn contract should prefer a fork wherever isolation from history is not genuinely required.
4. **Compaction is cheap warm and expensive cold** — on a resumed old session it reprocesses the whole
   history as uncached input. Clearing costs nothing.
5. **Mid-session model tiering can cost more, not less**, because each model has its own cache.
   Tiering pays at session start and on subagents.
6. **The decisive fact for this track: an unattended run has no resume path across a weekly cap, and a
   phase-gated one does.** Auto-resume does not apply when the reset is more than a day away, which is
   exactly the weekly cap, and not in background runs at all. This is the strongest argument for the
   modes and nobody writes about it. It was then confirmed the hard way: the session that produced
   this file lost ten research agents at once to a weekly cap, and the harness noticed nothing,
   recorded nothing, and had no resume path.
7. **A fresh chat per phase is justified on quality, not cost.** Sequential sessions share a cached
   prefix only while the startup repository snapshot matches, and a phase that ends in a commit
   changes it — so the next chat starts cold either way. Say which variable a rule optimises, or
   someone will tune the wrong one.

## Part 3 — Risks that must be designed around

1. **Fail-open is the more common default** on a guard that errors or times out, across tools. Every
   guard should emit its deny *and* exit non-zero, stay fast, and be paired with a declarative deny
   rule so a crashed script is not an open door.
2. **Hook trust is fingerprinted** by some tools, so a freshly cloned or pulled repo runs silently
   ungated until re-approved. A session-start reporter must assert its guards are live.
3. **The operator can switch every guard off, and one switch ships inside a repo** in at least one
   tool. Guards constrain the model, never the operator; say so plainly.
4. **Auto-approve can suppress the agent's own questions** in some tools, which voids any design that
   depends on the agent choosing to pause — a second, independent reason a gate must be a deny.
5. **Terms of service constrain unattended operation specifically** on several seats, and that is
   enforced by account action rather than by code. Treat headless-on-subscription as a per-tool
   capability flag with a citation, never a baseline claim.
6. **The billing universe can flip on an environment variable** — an API key present in the agent's
   environment can move the same binary from flat-rate seat to per-token billing. A seat-holder who
   believes they are flat-rate and is silently metered is the worst outcome available, and it is
   detectable.
