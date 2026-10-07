# Agent Harness: every agent reads this file, and only this file, by default

## 0. The override rule: quality outranks every optimisation here

Every rule below is a default, not a mandate. The moment one would make the output *worse* (a
shallower answer, an unverified claim, a file you needed but did not open) **the rule loses.**
Do the fuller thing, then say in the same reply which rule you set aside and why. One line.
Never silently degrade output to save tokens. If a rule keeps forcing this, say so: it is wrong.

## 1. What this is

A project-agnostic harness for agentic coding: the gate-line protocol, the always-on context
budget, the spawn contract, the track and handoff lifecycle, the hook guards and the doc contract.
Node >=20, built-ins only, zero dependencies, cross-platform (`node:path`, never a typed separator).
Everything project-specific lives in `harness.config.json`; harness code requires no project file.
It runs on itself: this file is the policy here AND the reference a new repo copies.

## 2. Finding anything

**`docs/INDEX.md` is the map.** Find the ONE row whose *read when* matches your task, open that
file, read nothing else. Never sweep the codebase by reading files: search for targets, or use a
read-only search agent for a broad question, and keep the conclusion rather than the file dumps.
Never re-read a file you already read this session. A subtree `AGENTS.md` holds that subtree's
invariants and applies when you touch a file under it; nothing else is always-on.
If you were spawned, your prompt carries a `READ-SET`: read exactly that, and report any reading past it.
Open work lives in `docs/tracks/<id>/`; a session on a track starts at that folder's `handoff.md`.

## 3. Hard rules, and the mechanism behind each one

A rule with no mechanism named is prose, and prose does not hold. Where a line says "prose", believe it. A hook guard runs only under a tool it is wired for (`scripts/harness/tools.json`); elsewhere its rule is prose.

- **A gate figure comes from `gates.js --check`, and lives in `scripts/harness/gates.baseline.json`,
  not prose.** Enforced: `scripts/harness/guards/phase-guard.cjs` D3 on the write, `docs-lint.cjs` on the
  tree; a figure in backticks or under a reasoned `figure-ok` tag passes.
- **The suite is the `gates` array in `harness.config.json`; nothing invents one.** Enforced:
  `scripts/harness/config.js`: an absent or malformed config is a hard stop with a fix line.
- **Do not commit, read or print secrets, credentials or a guarded env file.** Enforced:
  `.gitignore`, `scripts/harness/guards/env-guard.cjs` (deny-all over `env.guarded`; an exception is a
  dated `env.openCarveOuts` row, reported at every session start), `commit-hygiene.cjs`.
- **No strays, secrets, gitignore gaps or root clutter in a commit or push** (modified tracked
  files are fine). Enforced: `commit-hygiene.cjs` (BLOCK; waive a READ finding `--clear`), the `hygiene` gate.
- **A phase closes through `scripts/harness/close-phase.js`, never by assertion.** Enforced:
  `phase-guard.cjs` D1/D2 (no hand-flipped `status:`, typed receipt or bare move into the archive).
- **Never install, vendor or update a skill or plugin** without `docs/reference/skill-safety/`.
  `scripts/harness/guards/skill-verify.cjs` is the `skills` gate. Nothing denies a read or an invocation.
- **Docs obey a contract**: frontmatter, line caps, resolving trap paths, one handoff per track.
  `docs-lint.cjs` is the `docs` gate; no hook runs it, and nothing runs the index check but you:
  `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.
- **This file is the only policy body.** A `CLAUDE.md`, root or nested, is a pointer: the import line `@AGENTS.md` and comments, nothing a rule lives in. Enforced: `docs-lint.cjs` rule 12.
- **Always-on context has a ceiling.** Enforced: `scripts/harness/measure-context.js --check` (the
  `context` gate) against hand-written `context-budget.json`; a file with no ceiling fails coverage.
- **Harness files change on the source branch first.** Reported at session start, not gated: `scripts/harness/branch-sync.js`.
- **Every deciding script keeps `--self-test`.** Enforced: `tests/`, the `test` gate; untested = prose.
- **No inline `node -e`** (word-splitting drops debris; write a script file). Enforced: the tool's own deny list where it has one (`permissions.deny` in `.claude/settings.json`); prose elsewhere.

## 4. Working rules

- Do what was asked; nothing more, nothing less. Prefer editing to creating. Never create a doc
  unless asked. Never write working files or tests to the repo root: use the scratchpad.
- Read a file before editing it; validate input at system boundaries; reuse before building; batch independent tool calls.
- One task at a time. Announce it, do it, say when it is done. **Done means verified**: paste
  the command output. A gate you did not run is NOT RUN, never implied.

## 5. How to report

- Lead with the outcome. Failures and NOT-RUN steps come first, not last.
- Every figure comes from gate or command output in the same reply. Every claim about code cites `file:line`.
- Reply in ≤15 lines when no code changed. No restating what you just did, no closing offer.
- Never re-derive what `gates.json`, `docs/INDEX.md` or the handoff already states.
- If you set a rule aside (§0), say which one and why, in one line.

## 6. Build and test

```bash
node --test                        # zero-dep. No path: a glob fails before Node 21, a bare directory after it
node scripts/harness/gates.js --check --allow-skip reproducible-build=1    # every gate, one verdict
node scripts/harness/gates.js --accept --allow-skip reproducible-build=1   # re-baseline; refuses on red
```

`gates.js` is the gate. Do not quote a total from a doc. A re-baseline commit's subject starts `gates:`. Routing, spawning and the agent registry: `docs/reference/routing/README.md`, opened by the lead agent only.
