---
id: method-00-overview
kind: reference
status: open
read_when: "meeting this harness for the first time, or deciding whether any of it is worth adopting"
paths: ["docs/methods/**", ".claude/helpers/**"]
verify: "node scripts/harness/gates.js --self-test && node scripts/harness/guards/docs-lint.cjs"
last_verified: 2026-10-05
max_age_days: 90
---

# The method, in one page

## The thesis

A rule is a thing a human has to remember. A mechanism is a thing that fails loudly.
An agent follows a written rule until the rule is inconvenient, out of context, or contradicted by
a nearer instruction, and nothing announces the moment it stops.
Every mechanism in this repo began as a sentence in an instruction file, and was promoted to code
because the sentence was violated. None was built on speculation.
The test for belonging here: the control retires at least one prose rule, and its verdict is an
exit code. A check that needs a person to read a log is not a gate.

The corollary matters as much. A rule that claims a mechanism it does not have is worse than an
honest prose rule: once one "enforced" line is provably unenforced, the real ones lose authority.
So each doc in this folder says what is code, what is still prose, and what a green verdict does
not prove.

## The mechanisms, and the failure each one buys you out of

| Mechanism | File in this repo | The failure it ends |
|---|---|---|
| Nested context | `docs-lint.cjs` caps, `docs-index.js` | One instruction file that grows a paragraph at a time and is paid for by every agent on every turn |
| The spawn contract | `.claude/agents/*.md`, `docs-index.js --agents` | A fan-out that drops its failed workers and reports total verification failure as "found nothing" |
| Tracks and handoffs | `handoff-lint.js`, `findings-check.js` | A cold session that re-derives what the last one knew, or picks up the wrong "what next" |
| The GATE line protocol | `gates.js`, `gates.baseline.json` | Three docs quoting three stale totals and manufacturing regressions; a check that vanished unnoticed |
| Hooks as mechanism | `env-guard.cjs`, `phase-guard.cjs` | A guard that never fired and nobody knew; a tool surface no guard was watching |
| The doc contract | `docs-lint.cjs`, `doc-frozen.cjs`, `split-doc.js` | Line caps broken while they were prose; a gate figure quoted from a doc two phases stale |
| Skill supply chain | `skill-verify.cjs`, `skills-lock.json` | An instruction file from a stranger changing under you with no diff anyone read |
| The context budget | `measure-context.js`, `context-budget.json` | An always-on cost nobody is billed for and everybody pays |
| The phase lifecycle | `close-phase.js`, `phase-guard.cjs` | "Done" as a sentence: a status flipped by hand, a receipt typed from memory |
| Evidence and reporting | `findings-check.js`, `docs-lint.cjs` | A closure nobody proved; a proof that would have passed whatever the code did |
| Commit hygiene | `commit-hygiene.cjs` | Shell debris, a pasted token and root clutter riding into a commit nobody read the status for |
| One harness on every branch | `branch-sync.js`, `common.json` | A long-lived branch running the harness of the day it was cut, with nothing comparing |
| The config seam, the installer | `config.js`, `bin/harness.js` | A harness that grades one repo only, or invents a suite when it cannot read one |
| Many tools, one policy | `tools.json`, `hook.js`, `dialects/` | A rule enforced under one coding agent and silently prose under the next |

Every script lives under `scripts/harness/` (`.claude/helpers/` holds only the status line), plus the installer at
`bin/harness.js` ([14](14-the-config-seam-and-the-installer.md)). Everything project-specific
lives in `harness.config.json` and nowhere else: `scripts/harness/config.js` is the only reader,
and an absent config is a hard stop, never an invented default suite.

## Reading order

| If you are | Read |
|---|---|
| Deciding whether to adopt | this page, then [11](11-adopting-this-in-your-repo.md) |
| Installing | [11](11-adopting-this-in-your-repo.md), then [04](04-gates-and-the-gate-line-protocol.md) and [05](05-hooks-as-mechanism.md) |
| Taking one idea only | [04](04-gates-and-the-gate-line-protocol.md). The GATE line is the smallest piece that pays for itself |
| Running multi-session work | [03](03-tracks-handoffs-and-cross-session-memory.md), then [09](09-the-phase-lifecycle.md) |
| Running many agents | [01](01-nested-context.md), [02](02-routing-and-the-spawn-contract.md), [08](08-the-context-budget.md) |
| Writing docs for agents | [06](06-the-doc-contract.md), then `docs/reference/DOC-STANDARD.md` |
| Installing third-party skills | [07](07-skill-supply-chain.md) |
| Reporting or auditing work | [10](10-evidence-and-reporting.md) |
| Keeping long-lived branches | [13](13-one-harness-on-every-branch.md) |
| Asking why a commit was denied | [12](12-commit-hygiene.md) |

Every doc except this one and 11 answers the same four questions in the same order: the
failure, the mechanism, why a mechanism and not a rule, the cost and the limits.

## The objections, answered

- **"A better model will follow the rules."** The failures in these docs are not failures of
  comprehension. The rule was out of context (a subagent never handed the file), contradicted by
  a nearer instruction, or unobservable at the moment of the edit (a total nobody summed). A
  more capable model still cannot obey a sentence it was not shown, and cannot see a file
  growing one justified paragraph at a time. Where capability does retire a rule, delete the
  mechanism; section 6 of [11](11-adopting-this-in-your-repo.md) is the review that finds it.
- **"This is CI and a linter under new names."** Largely, and that is the claim. Three parts are
  not ordinary CI: the TOTAL compared against a baseline, where most pipelines ask only whether
  anything failed; the deny placed before the tool call, where CI runs after the secret is in the
  transcript; and prose graded as an input, because an agent executes it.
- **"A mechanism cannot bend; a rule can."** True, so the bend is built in and made visible: the
  override rule stays prose ([10](10-evidence-and-reporting.md)), tolerance is a flag in the
  invocation ([04](04-gates-and-the-gate-line-protocol.md)), a waiver dies with its tree
  ([12](12-commit-hygiene.md)). A mechanism that over-enforces breeds its own opt-out;
  [06](06-the-doc-contract.md) records one that did. The repair was to narrow the mechanism.
- **"Judgement cannot be mechanised."** Correct, and no doc here tries. Where a fact belongs, what
  a spawn prompt says and whether a handoff is any good stay rules, and each doc says so under
  its third heading. The thesis is narrower than "no rules": promote a rule once it has been
  broken AND its breach was silent. Label the rest as prose.
- **"Where is the evidence that it works?"** Not of the kind the question deserves. See the
  first line below.

## What this harness does not claim

- **It is written for flat-rate subscription seats.** A seat rations quota and context, not dollars, so costs here are bytes and repeated work; per-token billing and organisation-wide policy are out of scope (root `README.md`).
- **It has no control arm.** Nobody has run the same work with the harness off. Its costs are
  measured; its effect on output quality is argued from the failures it ended, not measured.
- **A green verdict proves shape, not truth.** The gates prove that the declared checks ran, that
  none failed and that none vanished. They do not prove the checks test the right thing.
- **Guards deny a shape, never a scope.** Each hook is a match over a tool call. A different
  spelling of the same action can pass. Guards remove accidents; they do not contain an adversary.
- **The blocking layer is wired for few tools.** The gate runner, the linters and the phase
  lifecycle are plain Node and run anywhere. The guards take a neutral event, but a hook file is
  rendered only for a tool whose file shape is recorded ([15](15-many-tools-one-policy.md)).
- **Enforcement on one machine is an honour system.** Until the gate suite runs in CI on a pushed
  commit, every guarantee here is local.
- **The handoff is model-written and read as authority.** Its integers are checked for citations.
  Nothing marks it as lower-trust than the files it summarises.
