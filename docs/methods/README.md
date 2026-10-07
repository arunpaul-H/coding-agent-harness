---
id: methods
kind: reference
status: open
read_when: "asking why a harness mechanism exists, what it costs, or how to adopt it elsewhere"
paths: ["docs/methods/**"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check"
last_verified: 2026-10-05
max_age_days: 90
---

# The method: why each mechanism exists

Start at [00-overview](00-overview.md). Every doc except 00 and 11 answers four questions in
order: the failure, the mechanism, why a mechanism and not a rule, the cost and the limits.

| Your question | Read |
|---|---|
| What is this, and is it worth adopting | [00-overview](00-overview.md) |
| Where a fact should live; why agents do not read everything | [01-nested-context](01-nested-context.md) |
| Whether to spawn agents, and what a spawn prompt must carry | [02-routing-and-the-spawn-contract](02-routing-and-the-spawn-contract.md) |
| How work survives a session ending | [03-tracks-handoffs-and-cross-session-memory](03-tracks-handoffs-and-cross-session-memory.md) |
| Adding a gate, or reading a red verdict | [04-gates-and-the-gate-line-protocol](04-gates-and-the-gate-line-protocol.md) |
| Writing or debugging a hook | [05-hooks-as-mechanism](05-hooks-as-mechanism.md) |
| Why docs are linted | [06-the-doc-contract](06-the-doc-contract.md) |
| Why skills are hash-pinned | [07-skill-supply-chain](07-skill-supply-chain.md) |
| The context gate is red | [08-the-context-budget](08-the-context-budget.md) |
| Closing a phase; the close script refuses | [09-the-phase-lifecycle](09-the-phase-lifecycle.md) |
| Reporting, closing a finding, recording a measurement | [10-evidence-and-reporting](10-evidence-and-reporting.md) |
| Installing this elsewhere, or taking one idea | [11-adopting-this-in-your-repo](11-adopting-this-in-your-repo.md) |
| A commit or push was denied; waiving a finding | [12-commit-hygiene](12-commit-hygiene.md) |
| Why a long-lived branch is compared to the default one | [13-one-harness-on-every-branch](13-one-harness-on-every-branch.md) |
| Why one config file, why a copy and not a dependency | [14-the-config-seam-and-the-installer](14-the-config-seam-and-the-installer.md) |
| Running under another coding agent, adding a tool, or what enforces a rule under one | [15-many-tools-one-policy](15-many-tools-one-policy.md) |

The enforced shapes are in `docs/reference/DOC-STANDARD.md`. These docs explain; that one binds.
