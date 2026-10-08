# <PROJECT_NAME>: every agent reads this file, and only this file, by default
> TEMPLATE. Copy to the repo root, fill each `<PLACEHOLDER>`, delete these two lines and every
> comment. If this loaded because you touched `templates/`, it is NOT policy here: ignore it. <!-- <PROJECT_NAME>: the value of `project.name` in harness.config.json. Root cap is 80 lines. -->

## 0. The override rule: quality outranks every optimisation here
Every rule below is a default, not a mandate. The moment one would make the output *worse* (a
shallower answer, an unverified claim, a file you needed but did not open) **the rule loses.**
Do the fuller thing, then say in the same reply which rule you set aside and why. One line.
Never silently degrade output to save tokens. If a rule keeps forcing this, say so: it is wrong.

## 1. What this is
<WHAT_THIS_IS>
Run it: `<RUN_COMMAND>` <!-- <WHAT_THIS_IS>: 3 to 6 lines: what the repo is, its layout, the stack, what lives on which branch. <RUN_COMMAND>: the one command that starts it locally, and where it answers. -->

## 2. Finding anything
**`<DOCS_ROOT>/INDEX.md` is the map.** Find the ONE row whose *read when* matches your task, open that
file, read nothing else. Never sweep the codebase by reading files: search for targets, or use a
read-only search agent for a broad question. Never re-read a file you already read this session.
A subtree `AGENTS.md` holds that subtree's invariants and applies when you touch a file under it;
nothing else is always-on. If you were spawned, your prompt carries a `READ-SET`: read exactly
that, and report any reading past it. Open work starts at `<TRACKS_DIR>/<id>/handoff.md`. A second agent gets its own folder, never this one: `node scripts/harness/worktree.js --new <name>`.

## 3. Hard rules, and the mechanism behind each one
- **A gate figure comes from `gates.js --check` and lives in `scripts/harness/gates.baseline.json`,
  not prose.** Enforced: `scripts/harness/guards/phase-guard.cjs` D3, `scripts/harness/guards/docs-lint.cjs`.
- **Do not commit, read or print secrets or a guarded env file.** Enforced: `.gitignore`,
  `scripts/harness/guards/commit-hygiene.cjs`, `scripts/harness/guards/env-guard.cjs` over `env.guarded`.
- **No strays or root clutter in a commit.** Enforced: `commit-hygiene.cjs`, the `hygiene` gate.
- **A phase closes through `scripts/harness/close-phase.js`.** Enforced: `phase-guard.cjs` D1/D2.
- **Docs obey a contract** (frontmatter, caps, one handoff per track; this file is the only policy body and a `CLAUDE.md` only imports it). Enforced: the `docs` gate.
- **The suite is the `gates` array in `harness.config.json`.** Enforced: `scripts/harness/config.js` hard-stops without it.
- **Always-on context has a ceiling; no skill installs unvetted.** Enforced: the `context` and `skills` gates.
- **<PROJECT_RULE>** Enforced: `<MECHANISM_FILE>`.
<!-- <PROJECT_RULE>: one bullet per rule of your own. <MECHANISM_FILE>: the hook, gate or test that enforces it; with none, write "prose" and mean it. A hook guard runs only under a tool it is wired for. -->

## 4. Working rules
- Do what was asked; nothing more, nothing less. Prefer editing to creating. Never create a doc
  unless asked. Never write working files or tests to the repo root: use the scratchpad.
- Read before editing; validate at system boundaries; reuse before building; batch independent tool calls.
- One task at a time, announced. **Done means verified**: paste the command output. A gate you
  did not run is NOT RUN, never implied.

## 5. How to report
- Lead with the outcome. Failures and NOT-RUN steps first. Every figure from the gate output in the
  same reply. Every claim about code cites `file:line`. ≤15 lines when no code changed, no restating.
- If you set a rule aside (§0), say which one and why, in one line.

## 6. Build and test
`<BUILD_COMMAND>` · `<TEST_COMMAND>` · `node scripts/harness/gates.js --check <ALLOW_SKIP>` <!-- <BUILD_COMMAND>, <TEST_COMMAND>: yours. <ALLOW_SKIP>: `--allow-skip <gate>=<n>` per tolerated skip, or nothing. -->
Routing, spawning and the agent registry: `<DOCS_ROOT>/reference/routing/README.md`, opened by the lead agent only.
