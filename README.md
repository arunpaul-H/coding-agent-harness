# Agent Harness

A project-agnostic harness for agentic coding: a set of scripts and hooks you copy into a repo so
that the rules you give a coding agent are checked by code instead of by memory.

An agent follows a written rule until it does not. The rule was out of context, or contradicted by
a nearer instruction, or simply inconvenient, and nothing announces the moment it stops being
followed. So every rule that matters here is a **mechanism that fails loudly**, with an exit code
for a verdict, and not a sentence somebody has to remember. Concretely, the repo gives you: a gate
runner that compares every check's *total* against a committed baseline, so a check that vanishes
is red; three guards that deny a tool call before it runs; a linter for the docs an agent reads; a
byte ceiling on always-on context; a track and handoff format for work that spans sessions, closed
by a script that refuses unless the evidence is current; and a lock that reports when a vendored
skill changed since someone read it. What is still prose is labelled as prose.

Node 20 or newer, built-ins only, zero dependencies. It runs on itself: this repository is graded
by the harness it ships.

## Install

There is no published package. Installing is copying, because the hooks are read from your repo's
own settings file and the baseline is committed beside the code it measures. You need Node >= 20,
git, and a POSIX shell (on Windows, the one Git provides).

```bash
git clone <this-repository> agent-harness

node agent-harness/bin/harness.js init --into <your-repo> --dry-run   # the plan; writes nothing
node agent-harness/bin/harness.js init --into <your-repo>
```

`init` never overwrites an existing file without `--force`. It installs no figures measured on
another tree: the gate baseline and the context report arrive empty, and the context budget is
marked `placeholder` until you measure your own files. It writes no `.gitattributes`; pin your
line endings yourself.

To look before you copy, run it here. Nothing to install, nothing to build:

```bash
node bin/harness.js selftest    # every --self-test in the repo
npm test                        # node --test
npm run gates                   # every gate against the committed baseline
node bin/harness.js doctor      # every piece: OK / MISSING / DRIFTED, each with its fix
```

On a machine with no agent-memory index for the checkout (any fresh clone, any CI runner) the
`docs` gate declares one skip and prints why, and an undeclared skip is red by design. Tolerate it
by name: `node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1`.

## What you get

| Mechanism | Implemented in | The failure it buys you out of |
|---|---|---|
| The GATE line protocol and its baseline | `scripts/harness/gates.js`, `gates.baseline.json` | Docs quoting stale totals; a check that vanished and left the suite green |
| Reproducible-build check | `scripts/harness/gates.js`, `artifacts` in the config | A source edit committed without the rebuild, when the committed bundle is the deploy |
| Secret-file guard | `scripts/harness/guards/env-guard.cjs` | A credential file read into a transcript that leaves the machine |
| Phase guard | `scripts/harness/guards/phase-guard.cjs` | A status flipped by hand, a typed receipt, a gate figure written into a doc |
| Commit hygiene | `scripts/harness/guards/commit-hygiene.cjs` | Shell debris, a pasted token and root clutter riding into a commit |
| The doc contract | `scripts/harness/guards/docs-lint.cjs`, `doc-frozen.cjs`, `scripts/harness/docs-index.js`, `split-doc.js` | Line caps that were prose; a hand-kept read-map that drifted from the docs |
| The context budget | `scripts/harness/measure-context.js`, `context-budget.json` | An always-on cost nobody is billed for and everybody pays |
| Tracks and handoffs | `scripts/harness/handoff-lint.js`, `findings-check.js`, `templates/track/` | A cold session re-deriving what the last one knew; a finding closed by assertion |
| The phase lifecycle | `scripts/harness/close-phase.js` | A phase closed on a verdict about a different tree |
| The spawn contract and agent registry | `docs/reference/routing/README.md`, `.claude/agents/`, `docs-index.js --agents` | A registry table that drifted from the agent files. The contract itself is prose |
| Skill supply-chain lock | `scripts/harness/guards/skill-verify.cjs`, `skills-lock.json` | An instruction file from a stranger changing with no diff anyone read |
| One harness on every branch | `scripts/harness/branch-sync.js`, `common.json` | A long-lived branch running the harness of the day it was cut |
| The config seam | `scripts/harness/config.js`, `harness.config.json`, `schema/` | A harness that invents a suite when it cannot read one |
| Installer and doctor | `bin/harness.js` | An install nobody verified; a piece silently missing |

## Quickstart

Everything below was run against a throwaway repo named `acme-api` holding a `package.json` and
one `node:test` file. The output is pasted from that run on Windows, hence the backslashes. Only
the absolute path of the target is replaced, and `[...]` marks lines cut for length.

**1. Init.**

```
$ node agent-harness/bin/harness.js init --into .
harness init -> <your-repo>

DETECTED
  project name      acme-api   <- package.json `name`
  package manager   npm   <- package.json with no lockfile
  test command      node --test   [node-test]   <- package.json `scripts.test`
  docs root         docs   <- the default (no docs directory yet)
  default branch    main   <- a local `main` branch

WROTE (41)
  .claude/settings.json
  [...]
  harness.config.json   — generated from what was detected
  skills-lock.json   — empty — a lock inherited from another machine pins another machine's review
  .gitignore   — the ignore rules the harness depends on
  AGENTS.md   — rendered for `acme-api`
  CLAUDE.md   — a pointer: it imports AGENTS.md and holds no rule
  docs/reference/routing/README.md   — rendered for `acme-api`
  scripts/harness/context-budget.json   — placeholder ceilings for AGENTS.md, CLAUDE.md and the routing doc as written — no figure is inherited

LEFT FOR YOU TO FILL (8) — init cannot detect these, so the token stays visible:
  AGENTS.md: <WHAT_THIS_IS>
  [...]
```

**2. Read `harness.config.json`.** `init` wrote it; it is the only place the harness learns
anything about your project. The gate registry it generated here:

```json
"gates": [
  { "name": "test",    "command": "node --test", "adapter": "node-test" },
  { "name": "docs",    "command": "node scripts/harness/guards/docs-lint.cjs" },
  { "name": "context", "command": "node scripts/harness/measure-context.js --check" },
  { "name": "hygiene", "command": "node scripts/harness/guards/commit-hygiene.cjs --report" },
  { "name": "skills",  "command": "node scripts/harness/guards/skill-verify.cjs --check" }
],
"artifacts": []
```

Add your own checks to that array. `node scripts/harness/config.js` prints the resolved config.
With the file absent there is no default suite; every script stops:

```
FATAL — no readable harness.config.json at <your-repo>\harness.config.json (ENOENT)
   fix: write harness.config.json at the repo root — see schema/harness.config.schema.json for the shape. The harness has no default suite.
```

**3. Scaffold a track** (only for work that will span several sessions).

```
$ mkdir -p docs/tracks && cp -r templates/track docs/tracks/login-rate-limit
$ node scripts/harness/handoff-lint.js login-rate-limit
handoff-lint: docs/tracks/login-rate-limit/handoff.md — the block is self-contained for a cold session
$ node scripts/harness/docs-index.js
wrote docs/INDEX.md — 4 live docs
```

The lint passes on the unfilled template, which tells you what it checks: the shape of the block,
not whether you wrote anything useful in it. Fill every `<PLACEHOLDER>`.

**4. Run the gate.** `git add` what was written first: the context gate grades only tracked files.
The first run is red, and should be. Two checks could not run, and only one skip was allowed:

```
$ git add .
$ node scripts/harness/gates.js --check --allow-skip reproducible-build=1
> test ... pass=1 fail=0 skipped=0 exit=0  (0.3s)
> docs ... pass=147 fail=0 skipped=1 exit=0  (0.2s)
> context ... pass=6 fail=0 skipped=0 exit=0  (0.3s)
> hygiene ... pass=7 fail=0 skipped=0 exit=0  (0.2s)
> skills ... pass=2 fail=0 skipped=0 exit=0  (0.1s)
> reproducible-build ... pass=0 fail=0 skipped=1 exit=0  (0s)
    note: not applicable — 0 artifacts configured, 0 graded. Declare it: --allow-skip reproducible-build=1
[...]
GATES RED — 1 violation(s) against scripts\harness\gates.baseline.json:
  x docs: skipped=1 and no --allow-skip docs=n was given
```

Read why it skipped (this machine holds no agent-memory index for the repo), allow it by name,
record the baseline, and check against it:

```
$ node scripts/harness/gates.js --accept --allow-skip reproducible-build=1,docs=1
[...]
wrote scripts\harness\gates.baseline.json — this is a deliberate RE-BASELINE.
! its commit subject must start `gates:` so the change is legible in `git log --oneline`.

$ node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1
[...]
GATES GREEN — test 1/1 . docs 147/148 (1 skipped, declared) . context 6/6 . hygiene 7/7 . skills 2/2 . reproducible-build 0/1 (1 skipped, declared)
```

What the baseline is for. A second test was added and accepted, then removed. Nothing fails; a
check is simply gone, and the exit code is 1:

```
GATES RED — 2 violation(s) against scripts\harness\gates.baseline.json:
  x test: pass 1 < baseline 2
  x test: 1 checks in the total, baseline had 2 — a check DISAPPEARED (pass-by-absence)
```

Then `node agent-harness/bin/harness.js doctor` (it ended `HEALTHY — ok=49 missing=0 drifted=0`
on this run), commit, and put the same `--check` command in CI. The full walk-through, including
how to confirm the hooks actually fire, is
[docs/methods/11-adopting-this-in-your-repo.md](docs/methods/11-adopting-this-in-your-repo.md).

## Does this work with my stack?

Mostly, with two honest qualifications.

**The harness itself is Node.** Your project need not be, but Node >= 20 must be on the machine
and in CI, because every script and every hook is a Node file.

**What is language-agnostic.** The gate runner runs any shell command: one that ends its stdout
with `GATE <name> pass=<n> fail=<n> skipped=<n>` is read exactly, and anything else can use the
`exit-code` adapter, which grades it as one pass or one fail. That is coarse; wrap your runner to
print a GATE line when the count matters. `init` detects `go.mod`, `Cargo.toml` and a Python
project with a tests directory and writes `go test ./...`, `cargo test` or `python -m pytest`
under that adapter; for anything else it writes no test gate and says so. The doc contract, the
track lifecycle, the context budget, commit hygiene and the skill lock read files and git, not
your code.

**What is Claude Code-specific.** The blocking layer: `.claude/settings.json` wires the three
guards to `PreToolUse` and four reports to `SessionStart`, and the guards parse that runtime's
hook payload. So are the `.claude/agents/` and `.claude/skills/` files, the status line, the
`permissions.deny` entries, and the doc gate's sweep of the agent-memory index. The policy itself
is not: it lives in `AGENTS.md`, which most coding agents load, and `CLAUDE.md` is a one-line stub
that imports it. The doc caps and the context budget key on those two names.

**The equivalent elsewhere.** No adapter for another agent runtime ships here. What ports as it
stands: `gates.js --check` in CI, and `commit-hygiene.cjs --report` (exit 1 on findings) in a
git pre-commit hook or a CI step. The pre-action deny has to be rebuilt on whatever hook your
runtime offers; if it offers none, the guards are not available to you and the remaining checks
run after the fact. Section 7 of the adoption doc lists the ideas that port without the code.

## What this does NOT do

- **A green gate does not prove the code is correct.** It proves the declared checks ran, none
  failed and none vanished. A test that asserts the wrong thing is green forever.
- **Nobody has measured that it improves output.** There is no control arm: the same work has not
  been run with the harness off. Its costs are measured; its benefit is argued from the failures
  it ended.
- **The guards deny a shape, never a scope.** Each is a pattern match over one tool call. A
  different spelling of the same action can pass. They stop accidents and reflexes, not an
  adversary, and not an agent that is determined.
- **The skill lock cannot secure what is outside the repo.** Marketplace plugin caches, user-level
  skills and MCP servers load into every session and no file in this tree can pin their bytes. An
  enabled plugin with no pin is reported as uncovered; that is naming it, not securing it. MCP
  tool descriptions are not hashed at all. Invoking a drifted skill is reported at session start
  and not blocked.
- **The context budget measures bytes, not what the model does with them.** It grades the
  instruction files you declared, at bytes over four as a token estimate. Tool schemas, skill
  listings and the system prompt are usually the larger share and are not graded. A green
  `context` gate says the declared files stayed inside their sizes, not that a session is cheap.
- **The lints check shape.** The handoff lint passes an unfilled template, as shown above. Whether
  a handoff is any good, and what a spawn prompt says, stay judgement.
- **On one machine it is an honour system.** `.github/workflows/ci.yml` ships with this repo, but a
  workflow file is not a run: until the suite has run on a pushed commit, in this repo or yours,
  every guarantee is local. Its Semgrep step is marked in the file as not yet calibrated against
  this tree.
- **It is not a framework for building agents.** It orchestrates nothing and calls no model.

## Design principles

- **Promote a rule to code once it has been broken silently, and not before.**
  [00-overview](docs/methods/00-overview.md)
- **Compare the total, not the pass count.** A vanished check must be red.
  [04-gates-and-the-gate-line-protocol](docs/methods/04-gates-and-the-gate-line-protocol.md)
- **A check may declare a skip; only the invocation may tolerate one.** Same doc.
- **Deny at the action, and ask when blind.** An unreadable payload is a question, never a
  permission. [05-hooks-as-mechanism](docs/methods/05-hooks-as-mechanism.md)
- **A threshold no tool writes.** A budget a script can update records what happened, not what was
  agreed. [08-the-context-budget](docs/methods/08-the-context-budget.md)
- **"Done" is something a script does, and it can refuse.**
  [09-the-phase-lifecycle](docs/methods/09-the-phase-lifecycle.md)
- **One config seam, and an absent config is a stop, never a default.**
  [14-the-config-seam-and-the-installer](docs/methods/14-the-config-seam-and-the-installer.md)

## Repo layout

```
bin/                 harness.js: the installer and the one CLI (init, doctor, gates, docs, host, selftest)
scripts/harness/     the gate runner, config loader, context measurement, lifecycle and doc scripts, baselines
scripts/harness/guards/  the three guards, the doc linter, the skill verifier
.claude/helpers/     the status line
.claude/agents/      four agent briefs: explore, implement, research, review
.claude/skills/      three working skills: plan, research, implement
.claude/             settings.json, the hook wiring
schema/              the JSON schema for harness.config.json
templates/           skeletons: AGENTS.md, its CLAUDE.md stub, the routing doc, a subtree AGENTS.md, a track folder, the doc standard
docs/methods/        one page per mechanism: the failure, the mechanism, why not a rule, the cost and limits
docs/reference/      the enforced shapes: the doc standard, routing (lead-only), skill safety, branches
docs/INDEX.md        generated by scripts/harness/docs-index.js; never edited by hand
tests/               node:test; every script driven as a real process in a throwaway repo
.github/             the CI workflow, Dependabot, and the two scanner configs
```

At the root: `harness.config.json` (everything project-specific), `skills-lock.json` (shipped
empty), and `AGENTS.md`, which is this repository's own policy and the reference a new repo starts
from, with `CLAUDE.md` beside it as the stub that imports it. Tracks go under `docs/tracks/<id>/`; none ships.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the zero-dependency rule and how to add a gate, a guard
or a doc. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE).
