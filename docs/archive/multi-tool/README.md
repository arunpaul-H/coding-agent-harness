---
id: multi-tool
kind: track
status: complete
read_when: "making the harness work under a coding agent other than Claude Code, or adding support for a new one"
trap_prefix: MT
paths: ["AGENTS.md", "CLAUDE.md", ".claude/**", "scripts/harness/**", "bin/harness.js", "templates/**", "schema/**", "harness.config.json", "tests/**", "docs/methods/**"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js multi-tool"
last_verified: 2026-10-06
max_age_days: 30
closed_phase: 6
closed_at: 2026-10-07
gates_sha: 6451bd40aaf9eb60811b79151b65949c5f20b4005ed823f82b972d92388011f4
block_sha: 7b6b97051d9b55dde088f66b96835614a3507358a3681df264c7758ad72ca05e
receipt: 469beab886d40a1763dc9dff24c76c345f61658e43fc641b5854590e9d035f01
---

# Multi-tool: one policy, one guard core, a thin adapter per agent

> ### Read which section, do not read it whole.
> | Your task | Read |
> |---|---|
> | Starting or resuming a phase | `handoff.md`, then **State** below |
> | Something behaves oddly | `traps.md` first. Every hazard there cost a real hour |
> | Why the scope is this and not more | **Locked decisions** |
> | What must not move | **Invariants** |
> | The phases and their exit commands | `plan.md` |
> | Adding a tool nobody listed | **The method**, then "Add a tool" in the root `CONTRIBUTING.md` |

> **Self-evolving tracker. Current truth only, not a changelog.** Rewrite in place when a phase
> lands. A cold session reads THIS plus `handoff.md` and continues with no memory of the last one.

## What this is

`harness init --tools <ids>` wires the tools a repo names: the one hook entry, `scripts/harness/hook.js`,
in each tool's own hook file, the policy pointer, and the skills. Two rows get a hook file, Claude Code
and Cursor (shell and read events only); the other four get the rules, the skills and a stated gap (MT-20).
`tools.js --matrix` prints what each rule rests on per enabled tool; `init --git-hooks` adds the opt-in backstop.
Evidence: `research/2026-10-05-tool-instruction-surfaces.md` (what each tool loads and can deny)
and `research/2026-10-05-claude-coupling-inventory.md` (where this repo is tied to Claude Code).
The inventory's finding is that gates, config, lifecycle and every helper's CLI mode already run
with no Claude runtime; the coupling is names, one hook dialect, and the meaning of `AGENTS.md`.
This track changes those three things. It does NOT change what any guard decides, what any gate
grades, or the gate-line protocol.

## The method

Three layers, and a tool is supported by adding to the third only.

| Layer | What it is | Who owns it |
|---|---|---|
| 1. Policy | ONE always-on file, `AGENTS.md`, plus a subtree `AGENTS.md` per directory | the repo |
| 2. Core | Guards and gates that take a neutral event and return a plain verdict | the harness |
| 3. Adapter | Per tool: how it reaches layer 1, its hook config file, its payload and deny dialect | one registry row + one dialect module |

Every tool sits on an enforcement tier, stated by the harness and never implied:

| Tier | Means | Tools today, per the research file |
|---|---|---|
| full | deny-capable pre-tool hook + session-start, checked-in project config | Claude Code, Codex CLI, Gemini CLI, Cursor |
| guard-only | deny-capable hook, but no session-start or no project-level config | Antigravity, Kimi Code |
| backstop | no hook the harness can wire: instructions plus git hook plus CI gate | Aider and any unlisted host |
| inherits | a model, not an agent: takes the tier of the host it runs in | DeepSeek |

A rule a tier cannot enforce is reported as prose for that tool. That is the same standard root
policy applies to itself, extended one axis.

## Locked decisions

1. **`AGENTS.md` is the always-on policy file; lead-only routing lives in
   `docs/reference/routing/README.md`.** Four of the six named tools auto-load a root `AGENTS.md`,
   so a lead-only `AGENTS.md` is injected into every agent there and the saving it was built for
   is already gone outside Claude Code. Lead, 2026-10-05; landed in phase 1. The routing path is a
   convention off the docs root (`routingDoc(cfg)` in `scripts/harness/config.js`), not a config key.
2. **One canonical policy, never generated copies per tool.** A tool that does not read `AGENTS.md`
   natively gets a pointer (an import stub or a config setting), not a second body. Two bodies
   drift, and the drift is silent. Lead, 2026-10-05. For Claude Code the pointer is the `CLAUDE.md`
   import stub; the lead's probe of 2026-10-06 showed it reaches a spawned subagent (MT-07).
3. **Tool facts live in one data file, `scripts/harness/tools.json`, each row carrying its evidence
   tier (`docs` or `ran`) and date.** Nothing else in the code names a tool. A contributor adds a
   row and, only if the dialect is new, one module. Lead, 2026-10-05.
4. **Guards leave `.claude/helpers/` for `scripts/harness/guards/`.** `.claude/` then holds only
   what Claude Code itself reads (settings, agents, skills, and `helpers/statusline.cjs`), the same
   as every other tool's directory. Lead, 2026-10-05; landed in phase 2.
5. **No future-proofing.** Only tools in the research file get a row. User, 2026-10-05: contributors
   and the maintainer add the rest.
6. **Subagent parity is out.** Agent-definition formats differ per tool and are not all
   established. Routing prose becomes tool-neutral; rendering agent files per tool is not this track.

## Agreed with the neighbouring autonomy-modes track

A second session is opening a track for run modes. These are settled, so neither side re-asks:

1. It owns the `modes` field of `scripts/harness/tools.json` end to end (rows, the `tools.js`
   validator, `tests/tools.test.js`), as an optional field, after phase 1 is green and before
   phase 3 starts.
2. Phase 3 adopts `scripts/harness/mode.js` as written: a handler is `decide(event, state)`, pure,
   with any disk read done by the caller in `hook.js` and passed in as `state`. This is the handler
   signature for every guard, and phase 3 landed it. The verdict also carries an ask.
3. `hook.js` takes two more events, `prompt-submit` and `stop`. A stop hook forces more turns; it
   is never used to make an agent wait.
4. It does not touch `close-phase.js` until phase 2 has landed, nor `.claude/settings.json` at all.
5. Its hook findings (fail-open defaults, hook trust lost after a pull, no session-start event on
   some tools) were read from docs and nothing was run. They are `docs` evidence under invariant 6.
6. Every window above is open. A later phase re-reads `tools.json`, `tools.js` and `config.js` before each edit.
7. `hook.js` keeps one ordered handler list per event (`HANDLERS`). Phase 3 did not wire `mode.js`:
   `prompt-submit` and `stop` are empty lists, and the neighbour adds its handler there, in one
   place, never as a second registration. Open on its side: the `mode.js` self-test passes a tool's
   own name as `action`, so against the neutral event its write gate never fires.
8. A failure of the entry itself at `stop` ends the turn and is reported, never a deny; only a stop
   handler that returns a deny forces a turn. Session-start cannot refuse and reports instead.

## Invariants

1. Claude Code behaviour is unchanged at every phase boundary: `node --test` stays green with the
   guard verdict fixtures in `tests/guards.test.js` untouched in meaning.
2. `node scripts/harness/gates.js --check --allow-skip reproducible-build=1` is green at each close.
3. Exactly one policy body exists. A second file carrying the rules is a failure of the phase.
4. No file outside `scripts/harness/tools.json` and the dialect modules names a specific tool in
   code. Docs and templates may.
5. Zero dependencies, Node built-ins only, `node:path` for every separator.
6. A registry row whose evidence is `docs` is never reported as verified.

## State

| Phase | What it delivers | Status |
|---|---|---|
| 0 | The tool registry, its checker, and a `tools` key in the config. Landed, committed, not closed | open |
| 1 | `AGENTS.md` is the always-on policy; routing is a reference doc. Landed, committed, not closed | open |
| 2 | Guards live in `scripts/harness/guards/`, verdicts identical. Landed, committed, not closed | open |
| 3 | A neutral guard event, one hook entry point, a dialect per wire format. Landed, committed, not closed | open |
| 4 | `harness init --tools` renders each tool's wiring; `doctor` prints its tier. Landed, committed, closed by `close-phase.js` on 2026-10-07 (the receipt is in this file's frontmatter) | open |
| 5 | The opt-in git hooks, `tools.js --matrix`, and a `tools` gate. Landed, committed, closed by `close-phase.js` on 2026-10-07 | open |
| 6 | The method doc `docs/methods/15-many-tools-one-policy.md`, "Add a tool" in `CONTRIBUTING.md`, the tool list in the root README. Landed, committed, closed by `close-phase.js` on 2026-10-07 | open |

## How to work

One phase per session. Start from `handoff.md`, read only what its `Read` list names, do the
phase, run its `Exit:` command in the foreground and paste the output. Then rewrite this file to
current truth, replace `handoff.md` wholesale, and close with
`node scripts/harness/close-phase.js multi-tool`. A phase that cannot close says so and stops.

- Every phase is SOLO. The parts reconcile against one registry and one policy file; a fan-out
  yields adapters that each look right and disagree.
- A phase that adds or removes a test changes the suite total: re-baseline with `gates.js --accept`
  in its own commit whose subject starts `gates:`, after the phase commit.
- A tool fact used in code comes from `scripts/harness/tools.json`. If the row is wrong, fix the
  row and its evidence, never the call site.
- Before promoting a row from `docs` to `ran`, run that tool and record the command in the row.
- Do not commit unless the user asks.
