# Agent Harness

Scripts and hooks you copy into a repo so the rules you give a coding agent are checked by code,
not left to the agent's memory.

An agent follows a written rule until it doesn't, and nothing tells you when it stopped. Here,
every rule that matters is a check that fails loudly with an exit code. Anything that is still
just a written rule is labelled as one.

Node 20 or newer, built-ins only, zero dependencies. This repo is checked by the harness it ships.

## Who this is for

Engineers and developers who build with agents: agentic developers, not prompt engineers. If your
answer to an agent breaking a rule is a better-worded prompt, this is not that. Here the answer is
a gate, a hook or a script that fails the work, so the rule holds whether or not the agent
remembers it.

## Not a developer? Start here

You do not need to read code to use this. You tell an AI what to build, and the harness checks
the AI's work for you.

```mermaid
flowchart LR
    A[You describe what you want] --> B[The AI writes it]
    B --> C{The harness checks it}
    C -->|Green| D[Keep going]
    C -->|Red| E[The AI is told why and fixes it]
    E --> C
```

**What the colours mean**

| Result | In plain words |
|---|---|
| 🟢 Green | Every check the project has was run, and none failed or went missing. |
| 🔴 Red | A check failed or disappeared. Nothing is broken for good: the AI is told exactly what to fix. |
| ⚪ Skipped | A check did not run. It proved nothing, so ask why before you rely on the result. |

**Your first hour**

1. Open your project in Claude Code, the AI coding tool this guide is built for.
2. Ask it to copy this harness into your project. It shows you the list of files first.
3. Ask it to check that every piece is in place.
4. Type `/guide`. It walks you through the rest in plain English, one step at a time.

> **What green does not mean.** Green does not mean the idea is good, that customers want it, or
> that the product is secure. It means the checks your project has all ran and passed. A project
> with few checks goes green easily.

Everything below this line is written for developers.

## Why this is different

Most agent harness repos give you prompts, agent definitions or an orchestration framework. This
one gives you none of those as its main product. It gives you the checks around them:

- **A missing check is a failure.** Each gate's total is compared with a committed baseline, so a
  test that was deleted or silently skipped turns the run red.
- **Bad actions are blocked before they run**, by hooks, not asked for politely in a prompt.
- **"Done" is a script.** A phase closes only when the script sees current evidence.
- **It says what it cannot do.** See [What it does not do](#what-it-does-not-do).
- **Nothing to install.** No dependencies, no build, no service, no model calls.

## Who it is for

**People on a flat-rate subscription seat of an agentic coding tool:** a plan with a usage limit,
not a bill per token. What rations a seat is quota and context, not dollars. So the harness counts
what a seat runs out of, the bytes loaded on every turn and the work a session has to redo, and it
accounts for nothing in money.

- You run a coding agent on a real repo, across many sessions.
- You have seen an agent skip a rule, quote a stale test count or call unfinished work done.
- You want that caught by CI and hooks instead of by review.
- You are not a tech expert and you drive a coding agent yourself: [start here](#not-a-developer-start-here).

## Who it is not for

- You pay per token on an API key and want cost in dollars tracked. Nothing here measures it.
- You are buying for an organisation and need SSO, a policy server or compliance reporting.
- You want a framework for building or orchestrating agents. This calls no model.
- You want a prompt or skill library to drop in.
- You cannot run Node 20 on your machine and in CI.
- You want blocking hooks on a coding agent the harness does not wire yet (see [Your stack](#your-stack)).

## When to use it

Use it once the same rule has been broken silently more than once, or when work spans sessions
and each new session re-learns what the last one knew. For a one-off script or a weekend
prototype it is more process than you need.

## Install

There is no published package. Installing is copying. You need Node >= 20, git and a POSIX shell
(on Windows, the one Git provides).

```bash
git clone <this-repository> agent-harness

node agent-harness/bin/harness.js init --into <your-repo> --dry-run   # the plan; writes nothing
node agent-harness/bin/harness.js init --into <your-repo>
```

`init` never overwrites a file without `--force`, and it copies no numbers measured on another
repo: your baseline starts empty. It writes no `.gitattributes`; pin your line endings yourself.

To try it here first:

```bash
node bin/harness.js selftest    # every --self-test in the repo
npm test                        # node --test
npm run gates                   # every gate against the committed baseline
node bin/harness.js doctor      # every piece: OK / MISSING / DRIFTED, each with its fix
```

On a fresh clone or a CI runner the `docs` gate reports one skip and says why. An undeclared skip
is red on purpose, so allow it by name:

```bash
node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1
```

## Quickstart

1. **Init**, as above. It detects your package manager, test command, docs folder and default
   branch, and lists the placeholders it left for you to fill in `AGENTS.md`.
2. **Read `harness.config.json`.** It is the only place the harness learns about your project.
   Add your own checks to its `gates` array. With no config file, every script stops; there is
   no default suite.
3. **Run the gates.** `git add` first, because the context gate reads tracked files only.

   ```
   $ node scripts/harness/gates.js --check --allow-skip reproducible-build=1
   GATES RED — 1 violation(s) against scripts\harness\gates.baseline.json:
     x docs: skipped=1 and no --allow-skip docs=n was given
   ```

   The first run is red, and should be. Read the reason, allow the skip, record the baseline:

   ```
   $ node scripts/harness/gates.js --accept --allow-skip reproducible-build=1,docs=1
   $ node scripts/harness/gates.js --check  --allow-skip reproducible-build=1,docs=1
   GATES GREEN — test 1/1 . docs 147/148 (1 skipped, declared) . context 6/6 . hygiene 7/7 . skills 2/2 . reproducible-build 0/1 (1 skipped, declared)
   ```

4. **Commit** (a commit that changes the baseline needs a subject starting `gates:`), run
   `node agent-harness/bin/harness.js doctor`, and put the same `--check` command in CI.

What the baseline buys you: delete a test later and nothing fails, yet the run is red.

```
GATES RED — 2 violation(s) against scripts\harness\gates.baseline.json:
  x test: pass 1 < baseline 2
  x test: 1 checks in the total, baseline had 2 — a check DISAPPEARED (pass-by-absence)
```

Full walk-through, including how to confirm the hooks fire:
[docs/methods/11-adopting-this-in-your-repo.md](docs/methods/11-adopting-this-in-your-repo.md).

## What you get

| Piece | What it stops | Where |
|---|---|---|
| Gates and a baseline | Stale totals in docs; a check that vanished while the suite stayed green | `scripts/harness/gates.js` |
| Reproducible-build check | A source edit committed without its rebuilt bundle | `scripts/harness/gates.js` |
| Secret-file guard | A credential file read into a transcript | `scripts/harness/guards/env-guard.cjs` |
| Phase guard | A status flipped by hand; a gate figure typed into a doc | `scripts/harness/guards/phase-guard.cjs` |
| Commit hygiene | Stray files, pasted tokens and root clutter in a commit | `scripts/harness/guards/commit-hygiene.cjs` |
| Doc contract | Docs over their line cap; an index that drifted from the docs | `scripts/harness/guards/docs-lint.cjs` |
| Context budget | Always-loaded instruction files growing unnoticed | `scripts/harness/measure-context.js` |
| Tracks and handoffs | A new session re-deriving what the last one knew | `templates/track/` |
| Phase lifecycle | A phase closed on evidence from a different tree | `scripts/harness/close-phase.js` |
| Skill lock | A third-party skill changing with no diff anyone read | `scripts/harness/guards/skill-verify.cjs` |
| Branch sync | A long-lived branch running an old copy of the harness | `scripts/harness/branch-sync.js` |
| Installer and doctor | An install nobody verified | `bin/harness.js` |

Each piece has a page under [docs/methods/](docs/methods/README.md): the failure, the mechanism,
its cost and its limits.

## Reference docs for your own project

The harness writes no doc about your code. `init` installs a template and nothing else, because a
doc generated from code repeats what a search already finds. When a subsystem has rules that live
in someone's head, ask for one doc, by name:

```
node agent-harness/bin/harness.js reference new billing-export \
  --read-when "changing what the nightly export writes" --paths "src/billing/**,tests/billing/**"
node scripts/harness/docs-index.js
```

That writes `docs/reference/billing-export/README.md` with the frontmatter filled and the body
left for you. It never overwrites, and both flags are required: `--read-when` is the one line an
agent sees in the index, and `--paths` is what the doc gate compares against history.

- **Run it when** the same question about a subsystem keeps being re-answered from the code, or
  the answer is not in the code at all.
- **Put in it** invariants and why they hold, decisions and what was turned down, what runs
  where, and limits set outside the repo. Leave out anything a search returns.
- **Afterwards** the doc gate warns, and never fails, when a commit touches those paths after the
  doc's `last_verified` day. Re-check the doc, then change the date. Changing only the date
  defeats the warning.

What we measured, once: the same read-only question put to two fresh agents on the same model,
one tree with a hand-filled doc and one without. Both answered every part correctly. The run with
the doc used `65083` tokens against `78068`, the same `18` tool uses, and one fewer file; it still
read the code, because the question asked for line numbers. One pair is an observation, not
proof, and it does not count the time spent writing the doc. Expect a modest saving at best, and
write a doc for what the code cannot say, not to save tokens. The write-up is
[here](docs/tracks/project-reference/research/2026-10-08-one-task-with-and-without-a-reference-doc.md).

## Your stack

- **The harness is Node.** Your project need not be, but Node >= 20 must be on the machine and in CI.
- **Any language can be gated.** A gate is any shell command. If its last stdout line is
  `GATE <name> pass=<n> fail=<n> skipped=<n>` the counts are read exactly; otherwise the
  `exit-code` adapter grades it as one pass or one fail. `init` detects Node, Go, Rust and Python
  test commands.
- **The blocking hooks are wired for few tools.** `harness init --tools <ids>` names the coding
  agents to wire. A hook file is written for Claude Code and, for shell calls and file reads only,
  for Cursor. Every other tool below gets the policy, the skills and a stated gap. The agent files
  and the status line are Claude Code's only.
- **Which tools, and on what evidence.** `ran` means the tool was run here and the row records
  the command. `docs` means the row was read off the vendor's pages and the tool was never run. Printed by `node scripts/harness/tools.js --list`, 2026-10-07:

  <!-- tools-list:start -->
  ```
  id              tier        evidence  enabled
  claude-code     full        ran       yes
  codex-cli       full        docs
  gemini-cli      full        docs
  antigravity     guard-only  docs
  cursor          full        docs
  kimi-code       guard-only  docs
  deepseek        inherits    docs
  github-copilot  backstop    docs
  windsurf        backstop    docs
  cline           backstop    docs
  aider           backstop    docs
  opencode        backstop    docs
  qwen-code       backstop    docs
  ```
  <!-- tools-list:end -->

- **What enforces each rule under your tools.** `node scripts/harness/tools.js --matrix` prints
  it per enabled tool: a deny at the tool call, a report, a gate, a git-hook backstop, or prose.
- **The policy is not tied to one tool.** It lives in `AGENTS.md`, which most coding agents load;
  `CLAUDE.md` is a one-line pointer to it.
- **What works anywhere today:** `gates.js --check` in CI, and the opt-in git hooks:
  `harness init --git-hooks` writes a pre-commit that runs `commit-hygiene.cjs --report` and a
  pre-push that runs the gate suite. A backstop after the work, not a deny.

## What it does not do

- **A green gate does not prove the code is correct.** It proves the declared checks ran, none
  failed and none vanished.
- **Nobody has measured that it improves output.** There is no run with the harness off to
  compare against.
- **The guards match patterns.** A different spelling of the same action can get through. They
  stop accidents, not a determined agent or an attacker.
- **The skill lock cannot cover what lives outside the repo:** plugin caches, user-level skills
  and MCP servers. It reports them as uncovered; it does not secure them.
- **The context budget counts bytes of the files you declare.** Tool schemas and the system
  prompt are usually larger and are not counted.
- **The lints check shape, not quality.** An unfilled handoff template passes.
- **It is not an agent framework.** It orchestrates nothing and calls no model.

## Repo layout

```
bin/                     harness.js: the installer and CLI (init, doctor, gates, docs, host, selftest)
scripts/harness/         the gate runner, config loader, lifecycle and doc scripts, baselines
scripts/harness/guards/  the guards, the doc linter, the skill verifier
.claude/                 hook wiring, four agent briefs, four skills, the status line
schema/                  the JSON schema for harness.config.json
templates/               starting files for AGENTS.md, CLAUDE.md, the routing doc and a track
docs/methods/            one page per mechanism
docs/reference/          the enforced shapes: doc standard, routing, skill safety, branches
docs/tracks/             open work on this repo
tests/                   node:test; every script run as a real process in a throwaway repo
.github/                 the CI workflow, Dependabot and scanner configs
```

`harness.config.json` holds everything project-specific. `AGENTS.md` is this repo's own policy
and the starting point for yours.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE).
