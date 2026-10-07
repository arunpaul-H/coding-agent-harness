---
id: method-01-nested-context
kind: reference
status: open
read_when: "deciding where a fact should live, or why an agent here does not read the whole repo"
paths: ["AGENTS.md", "CLAUDE.md", "**/AGENTS.md", "docs/reference/routing/**", "docs/INDEX.md", "scripts/harness/docs-index.js"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check"
last_verified: 2026-10-05
max_age_days: 90
---

# Nested context: every agent reads one small file by default

## The failure

- One root instruction file holds everything: identity, rules, a read-map, a status board, traps.
  It grows a paragraph at a time, each paragraph justified on its own.
- The runtime injects that file into every session and every subagent. A fan-out of N workers
  pays for it N times, and most of what each worker pays for is routing advice it cannot use.
- A hand-written read-map ("for X read Y") drifts from the docs it points at. The first symptom
  is an agent opening a file that no longer holds what the map promised.
- With no map it trusts, the agent sweeps the codebase by reading files, and the conclusions are
  buried under the dumps.
- A fact stored in the wrong place is loaded by the wrong audience: an invariant of one directory
  taxes every task in every other directory.

## The mechanism

Six tiers, scoped by audience and by lifetime. Each tier has a cap or a generator behind it.

| Tier | Loads | Cap (default) | Holds |
|---|---|---|---|
| root `AGENTS.md` | every agent, every session | 80 lines | the override rule, identity, hard rules naming their mechanism, how to report |
| `docs/reference/routing/README.md` | the lead agent only, by opening it | 150 lines | routing, the spawn contract, the generated agent registry |
| `<subtree>/AGENTS.md` | when a file under that directory is touched | 50 lines | that subtree's invariants, its gate, its traps |
| `docs/INDEX.md` | on demand | generated | one row per doc: the single line that says when to open it |
| reference and track docs | on demand, via the index | 150 lines | contracts, current truth, handoffs |
| archive and explorations | never as instruction | exempt | closed work and dated measurements |

- **The caps are enforced** by `scripts/harness/guards/docs-lint.cjs` rule 1, from `docs.caps` in
  `harness.config.json`. The linter walks the whole tree for nested `AGENTS.md` files, so a new
  subtree file is capped the day it appears, without anyone adding it to a list.
- **One policy body.** A tool that does not load `AGENTS.md` natively reads a `CLAUDE.md` stub
  holding only the import line `@AGENTS.md`. Rule 12 of the linter fails a stub with any other
  content, or with no `AGENTS.md` beside it.
- **The index is generated** by `node scripts/harness/docs-index.js` from each doc's `read_when`
  frontmatter line. `--check` exits 1 if the committed index differs from the generated one.
- **The lead-only split.** Policy that only an orchestrator needs lives in the routing doc,
  which nothing injects and a leaf agent is never handed. A leaf gets the root file, the subtree
  file it touches, and its prompt.
- **The placement rule.** A fact lives in the narrowest folder whose code it constrains: the
  subtree `AGENTS.md`, else `docs/reference/<subsystem>/`. If it constrains no code it is a
  measurement and belongs in a dated research file. If it is "what next" it lives in exactly one
  `handoff.md`.
- **The reading rule.** Find the one index row whose `read_when` matches the task, open that
  file, read nothing else. Search for targets; do not sweep by reading.
- **The size of all of it is graded** by the `context` gate. See
  [08](08-the-context-budget.md).

## Why a mechanism and not a rule

- "Keep the instruction file short" was a prose limit, and it was broken over and over while it
  was prose. Nobody decided to break it. Each addition was reasonable and the total was nobody's
  job. A cap that exits 1 makes the next line displace an existing one, which is the only form of
  the rule that survives a deadline.
- "Keep the read-map current" has no moment at which it fails. A generated index has one: the
  `--check` exit code. The map cannot drift from the docs because it is made from them.
- "Put facts in the right place" stays a rule. No script can tell which directory a fact
  constrains. What the mechanism does is make the wrong place expensive: the root file is at its
  cap, so a misplaced fact has to evict something.

## The cost and the limits

- **The cap is denominated in lines, and lines are the wrong unit.** One line of several thousand
  characters passes a 150-line cap and costs more than a page. The context budget grades bytes for
  the always-on files; nothing bounds the bytes of an on-demand doc.
- **Nothing measures whether the index routes correctly.** `read_when` lines can be vague or
  near-duplicates of each other, and the linter only checks that the field exists. "Read the one
  row" fails when the landing file is itself a router. Treat routing as unproven.
- **The lead-only split is a convention, not a load rule.** Most tools treat `AGENTS.md` as the
  portable, read-by-everyone file, so the policy lives there and the lead-only part lives in a
  doc no tool injects. Whether a stub import reaches a spawned agent is a property of the tool:
  probe it by asking a spawned agent what instruction files it holds.
- **The files are a minority of the bill.** Tool schemas, skill listings and the per-subagent
  floor are usually larger than every instruction file combined, and this tiering does not touch
  them. Shaving the instruction files is real and smaller than it looks.
- **A subtree file's accuracy is checked by nothing.** Its size is capped. Whether its invariants
  still describe the code is a matter of review.
- **Cost to run:** one directory walk per lint, one regeneration per doc change. Negligible. The
  real cost is editorial: at the cap, every addition is a negotiation.
