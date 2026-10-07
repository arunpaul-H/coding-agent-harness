# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-05

First public release: the harness as a project-agnostic package, with everything project-specific
behind one config file.

### Added

- **The config seam.** `harness.config.json` holds everything the harness knows about the repo it
  grades, validated by `scripts/harness/config.js` against `schema/harness.config.schema.json`. An
  absent or malformed config is a hard stop with a one-line fix, never a default suite.
- **The gate-line protocol.** `scripts/harness/gates.js` runs the configured gates, reads each
  one's final `GATE <name> pass=<n> fail=<n> skipped=<n>` line into `gates.json`, and with `--check`
  compares the run against the committed `gates.baseline.json`. A missing gate line, a check that
  disappears and an undeclared skip are all red. An empty `artifacts` list makes the
  reproducible-build check declare a skip instead of passing by absence.
- **Hook guards**, registered in `.claude/settings.json`, every matcher covering `mcp__.*`: the
  secret-file guard (deny-all, with dated carve-outs that re-arm themselves), the commit-hygiene
  gate and the phase guard.
- **The doc contract.** `docs-lint.cjs` (frontmatter, line caps, dead links, frozen evidence),
  `docs-index.js` (the generated `INDEX.md` and the agent registry) and `split-doc.js` (a lossless
  split for a doc over its cap).
- **The context budget.** `measure-context.js` grades always-on context against hand-written
  ceilings in `context-budget.json`, which no script rewrites.
- **The phase lifecycle.** `close-phase.js`, `handoff-lint.js` and `findings-check.js`, with the
  track folder templates under `templates/track/`.
- **Branch sync.** `branch-sync.js` and `common.json` keep the harness byte-identical across
  long-lived branches.
- **Skill vetting.** `skill-verify.cjs`, an empty `skills-lock.json` and the checklist under
  `docs/reference/skill-safety/`. No third-party skill is shipped.
- **Agents and skills.** Four agent briefs (`explore`, `implement`, `research`, `review`) and three
  skills (`plan`, `research`, `implement`).
- **The `harness` CLI** (`bin/harness.js`): `init` copies the harness into a repo and generates its
  config from what it detects, never overwriting without `--force`, refusing a flag it does not know,
  and writing an empty gate baseline, an empty context report and a `placeholder` context budget
  instead of inheriting this package's figures; `doctor` reports every installed
  piece as OK, MISSING or DRIFTED with the one command that fixes it; `gates`, `docs`, `host` and
  `selftest` wrap the scripts.
- **CI.** A `gates` job on Node 20 and 22 with no install step, and a `scan` job (actionlint,
  zizmor, gitleaks over history and tree, OSV-Scanner, Semgrep CE), every tool pinned by version and
  SHA256 and every action pinned by commit SHA.

### Security

- Zero runtime dependencies and zero development dependencies. The property is asserted by
  `node bin/harness.js --self-test` and by CI.

[Unreleased]: https://github.com/arunpaul-H/Agent-Harness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/arunpaul-H/Agent-Harness/releases/tag/v0.1.0
