---
id: claude-code-uptake
kind: track
status: open
read_when: "adopting a recent Claude Code feature in the harness, or building, testing or shipping a harness mod"
trap_prefix: CU
paths: [".claude/settings.json", ".claude/agents/**", ".claude/skills/**", ".claude/plugins/**", "scripts/harness/hook.js", "scripts/harness/dialects/**", "scripts/harness/guards/skill-verify.cjs", "scripts/harness/tools.json"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js claude-code-uptake"
last_verified: 2026-10-09
max_age_days: 30
closed_phase: 3
closed_at: 2026-10-09
gates_sha: f3844e3702fea2a42d65fde993c0952a53af1a3f446bbfdfc06fcebfd355c363
block_sha: 0c2bb531638d2283be722551ddd7b612c8f849939fa1c7c009741d258c1f0099
receipt: b8c64841ad4803a9875709985a3d71ba468109089bfbdb57a112125ab9d627ec
---

# Claude Code uptake: what we leverage, and what we build as mods

> ### Read which section, do not read it whole.
> | Your task | Read |
> |---|---|
> | Starting or resuming a phase | `handoff.md`, then **State** below |
> | Something behaves oddly | `traps.md` first |
> | Which feature maps to which phase | **Leverage and build** |
> | What must not move | **Invariants** |
> | The phases and their exit commands | `plan.md` |

> **Self-evolving tracker. Current truth only, not a changelog.** Rewrite in place when a phase
> lands. A cold session reads THIS plus `handoff.md` and continues with no memory of the last one.

## What this is

The harness is wired to Claude Code as it was before mods. The evidence for what has shipped since
is `research/2026-10-09-claude-code-releases.md`: the vendor changelog and the mods pages, read on
2026-10-09, nothing run. This track takes two things from it. LEVERAGE: features that already
exist and need only wiring. BUILD: mods, plugins whose JavaScript handlers run inside Claude Code
(terminal from 2.1.287), which can draw, add commands that take no model turn, and see every
spawn. It does NOT change a guard's decision, the gate protocol, or any other tool's wiring.

## Leverage and build

| What shipped | We | Phase |
|---|---|---|
| Hook `onFailure: "block"`; `Monitor` and `NotebookEdit` tools; `Tool(param:value)` deny rules | leverage: the pre-tool entry fails closed and sees every tool | 1 |
| Subagent fields (`effort`, `maxTurns`, `isolation`, `disallowedTools`, `autoCompactWindow`); forked skills now run in the background | leverage: agent and skill files say what they mean | 1 |
| Mods: `ui.render`, `$.ui.toast`, `session.measure`, `turn.complete`, `command.run` | build: a panel for the gate verdict, the open track and the context in use; `/gates` with no turn | 2 |
| Mods: `$.command.register`, `session.compact`, `turn.complete`, `$.ui.ask` | build: the track lifecycle as commands (`/handoff`, `/close-phase`, `/track`) | 3 |
| Mods: `tool.call`, `agent.spawn` (teammates, workflow agents), `prompt.mention`, hold-and-ask | build: the guards in-process, and the spawn contract reaching every spawn | 4 |
| `claude plugin validate` and `test`; a mod can approve past a settings hook | leverage: the skill gate vets mods, ours included | 5 |
| Plugins and marketplaces | build: the harness installs as one plugin | 6 |

## Locked decisions

1. **A mod holds no decision.** It calls a harness script and draws or relays the verdict. The
   deciding code stays in `scripts/harness/` with its `--self-test`. A mod cannot use Node
   built-ins or `require`, so logic written inside one is out of reach of `node --test`.
2. **Settings hooks stay.** A mod is an addition for Claude Code. The vendor states settings hooks
   are not deprecated, and every other row in `scripts/harness/tools.json` has only those to wire.
3. **The mod gate is optional by absence.** `claude plugin validate` and `claude plugin test` need
   the `claude` program. Their gate is `optional: true`: absent is a declared skip, present and
   unhappy is a fail. The harness gains no dependency.
4. **Two plugins.** `harness` draws and adds commands and never gates a call. `harness-guard`
   gates and never draws. The `calls:` line of `claude plugin validate` proves each one's limits.
5. **No claim of finality.** A mod a user installs can approve past a project settings hook; only
   managed settings make a guard final. Docs and reports say so wherever it is true.

## Invariants

1. `node --test` passes with no `claude` program on PATH.
2. Every deny decision is reachable from a script with `--self-test`, never only from a mod.
3. `.claude/settings.json` keeps one entry per hook event, each `node scripts/harness/hook.js`.
4. Where nothing draws (`-p`, VS Code, the SDK, cloud) a mod is silent and breaks nothing.
5. No gate figure in this folder: `node scripts/harness/gates.js --check` is how one is read.

## State

| Phase | What it delivers | Status |
|---|---|---|
| 0 | The dated evidence | done |
| 1 | Leverage: hook entry, matcher, agent and skill files brought up to the tool as it is | done |
| 2 | Build: the `harness` mod, a panel and `/gates` | done |
| 3 | Build: the track lifecycle as commands | closed, receipt above |
| 4 | Build: the `harness-guard` mod | open |
| 5 | Leverage: the skill gate vets mods | open |
| 6 | Build: the harness ships as a plugin | open |

Phases 0 to 2 are committed, and the one receipt in this file's frontmatter closes phase 3 on a
green gate run. Phase 4 is next, and its first item is a
research file from runs in a real session. What each phase cut is in `plan.md`.

The mod is `.claude/plugins/harness/`; every judgement it draws is made by
`scripts/harness/panel.js`. No settings file enables it: load it for one session with
`claude --plugin-dir .claude/plugins/harness`. No session has loaded it yet: the band, the
pane and the four commands (`/gates`, `/track`, `/handoff`, `/close-phase`) are held by tests.

## How to work

One phase per session. Start from `handoff.md`, read only what its `Read` list names, do the
phase, run its `Exit:` command in the foreground and paste the output. Then rewrite this file to
current truth, replace `handoff.md` wholesale, and close with
`node scripts/harness/close-phase.js claude-code-uptake`. A phase that cannot close says so and stops.

A claim about what Claude Code does is a doc reading until somebody runs it. Record which it is,
with the tool version, in the `claude-code` row of `scripts/harness/tools.json`. The research file
is frozen: correct a finding with a new dated file, never an edit.
