# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **More than one coding agent.** A tool registry, `scripts/harness/tools.json`, holds one row per
  agent with the evidence behind it; `harness init --tools <ids>` wires the ones a repo names, and
  `doctor` prints each tool's tier and every missing wire. The guards now take a neutral event
  through one hook entry, `scripts/harness/hook.js`, with a dialect module per wire format. A hook
  file is written for Claude Code and, in part, Cursor; every other row is `docs` evidence and gets
  the policy, the skills and a stated gap.
- **The enforcement matrix.** `node scripts/harness/tools.js --matrix` prints what enforces each
  hard rule under each enabled tool: a deny, a report, a gate, a git-hook backstop, or prose.
- **An opt-in git-hook backstop.** `harness init --git-hooks` writes a pre-commit and a pre-push.
  A hook that exists is never replaced.
- **A `tools` gate** running `tools.js --check`, in this repo's suite and in the config `init` writes.
- **A plain-English on-ramp.** A fourth skill, `guide`, walks a person who is not a tech expert
  through setup, reading a red or green result, and turning a goal into a request that can be
  checked. It runs as a conversation, and it will not re-baseline, waive a finding or allow a
  skip without explaining what that gives up and getting a yes. `harness init` installs it, and
  the README opens with a "Not a developer? Start here" section. No gate, guard or threshold
  changed.
- **An optional `modes` cell in the tool registry**: each harness run mode mapped to the tool's own
  command-line flags, or null where none is established. `tools.js --check` validates it. One row
  carries it, read off that tool's help and not run.
- **A launcher: `harness run [<mode>] [--tool <id>]`** (`scripts/harness/run.js`). The run mode is
  chosen by a person before the agent exists: with no mode it asks on the terminal, and with no
  terminal it refuses. It starts the tool with the flags its registry row records for that mode,
  and the program named by the row's new optional `bin` cell. A tool with no `modes` cell or no
  `bin`, and a mode whose cell is null, are refused and never started bare. `--dry-run` starts
  nothing. No session of any tool was started under a mode through it.
- **A `mode` config section and a phase receipt.** `mode.default` is the mode a bare Enter takes
  at the launcher's question; it is never used without one. `harness run --track <id>` writes
  `<track>/.phase`, recording which phase was approved and in which mode, and only from a
  terminal. The phase guard refuses the agent's own write to that file (D6) by the path of a
  write call; a shell redirect into it is not caught, and the guard says so. `init` and `doctor`
  now require the receipt to be git-ignored. Nothing reads the receipt yet.
- **Four gates in this repo's suite: `mode`, `effects`, `carveouts`, `peers`.** Three run a
  script's self-test and read its exit status; they grade the script, not the tree. `carveouts`
  compares the waivers in the git index, per kind, with a committed census
  (`scripts/harness/carveouts.baseline.json`): a count of mentions, so an edit that spells a
  waiver moves it. The config `harness init` writes does not list them.

### Changed

- **The README states who the harness is for:** flat-rate subscription seats, where quota and
  context are what runs out. Per-token cost accounting and organisation-wide policy are out of scope.
- **`AGENTS.md` is the always-on policy file** and `CLAUDE.md` is a stub that imports it. Routing
  moved to `docs/reference/routing/README.md`.
- **The guards moved** from `.claude/helpers/` to `scripts/harness/guards/`. Their verdicts did not change.

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
