---
id: claude-code-uptake-mod-order-and-guard-runs-2026-10
kind: research
status: frozen
read_when: "Building or debugging the harness-guard mod: where it sits in the chain, what a workflow agent's call reaches, and whether the built-in guard is loaded here"
question: "On this machine: in what order do two user-tier mods run, does the project pre-tool hook fire for a workflow agent's tool call, and does sec-default load?"
answer: "User-tier mods loaded with `--plugin-dir` run in flag order, first flag outermost. The project pre-tool hook DOES fire for a workflow agent's own tool call, but not for the `Workflow` call that starts it; `agent.spawn` fires for that agent. `sec-default` is not seated here, so nothing holds a deny rule or a settings hook over a user's mod."
paths:
  - .claude/settings.json
  - scripts/harness/hook.js
  - .claude/plugins/harness/hooks/register.js
commit_at: ffd8842
expires: 2026-11-08
source: measured (four headless runs on this machine, tool version 2.1.296)
---

# Mod order, workflow agents and the built-in guard: what four runs showed

Every finding below is a line from a debug log written by `claude -p ... --debug-file`, started at
this repo's root on 2026-10-09 with tool version `2.1.296`. Nothing here is a doc reading. The
earlier file, `2026-10-09-claude-code-releases.md`, is the doc reading these runs test.

## 1. How it was run

Two probe mods, `probe-a` and `probe-b`, in a scratch folder outside the repo. Each registers
`tool.call` and `agent.spawn`, writes one debug line before `next(e)` and one after, and changes
nothing. Four runs:

| run | flags | prompt asks for |
|---|---|---|
| R1 | `--plugin-dir probe-a --plugin-dir probe-b` | one shell `echo` |
| R2 | `--plugin-dir probe-b --plugin-dir probe-a` | the same |
| R3 | `--plugin-dir probe-a` | a workflow of one agent that runs one shell `echo` |
| R4 | R3 plus `--allowedTools Workflow` | the same |

Each session offered a `PowerShell` tool and no `Bash` tool, as the two earlier headless sessions did.

## 2. Mod order in the user tier

- R1 loaded `probe-a@inline` as `environment 1, tier user` and `probe-b@inline` as `environment 2,
  tier user`. On the one tool call the order was: a before, b before, the project `PreToolUse`
  hook, b after, a after.
- R2, flags swapped, loaded `probe-b` as `environment 1` and gave: b before, a before, the hook,
  a after, b after.
- So among mods named by `--plugin-dir`, the first flag is outermost: it sees the call first and
  the result last. The vendor page states only that a mod runs before the mods it lists under
  `dependencies`; flag order is not on it.
- The project hook (`node scripts/harness/hook.js --event pre-tool`) ran after the last mod's
  `next` and before any `after` line, in both runs. A mod that calls `next` therefore gets the
  settings hook's decision inside the result, and a mod that answers without `next` keeps the
  settings hook from running. That matches the vendor page.
- Two built-in mods loaded after the probes, `tier builtin`: `cc-plugin-agents-md` (which itself
  handles `tool.call`, `agent.spawn` and `prompt.mention`) and `cc-plugin-telemetry`.

NOT MEASURED: order between a `--plugin-dir` mod and a mod installed from a marketplace, and
order among installed mods with no `dependencies`. No mod is installed on this machine.

## 3. A workflow agent's calls

- R3: the lead's `Workflow` call reached the probe (`tool=Workflow agentId=main`) and was refused
  by the tool's own approval, `Review dynamic workflow before running`, which a headless run has
  nobody to answer. No `PreToolUse` line was written for it: the matcher in `.claude/settings.json`
  does not name `Workflow`.
- R4: the workflow ran one agent. In order: probe before `tool=Workflow agentId=main`; no
  `PreToolUse` line; probe `agent.spawn`; probe before `tool=PowerShell agentId=a8a871ad152f0f3b2`;
  `Hooks: PreToolUse:PowerShell [node ... hook.js --tool claude-code --event pre-tool] finished
  with status 0`; probe after.
- So the project pre-tool hook DOES fire for a tool call a workflow agent makes. The env guard and
  the hygiene guard already reach it. What no settings hook sees is the spawn itself: the `Agent`
  matcher never fires, because the agent is started by the script, not by an `Agent` call.
- `agent.spawn` fired for that agent. The event's keys were `tool_use_id`, `prompt`,
  `description`, `subagentType`, `provider`, `model`, `parentModel`, `permissionMode`,
  `background`, `fork`, `workflow`, `name`, `cwd`. The values were not recorded.
- A mod's `tool.call` carries `e.agentId` for an agent's call and nothing for the lead's.

NOT MEASURED: a teammate spawn, an `Agent` tool spawn (whether `agent.spawn` and the `Agent`
`PreToolUse` both fire for it, and in which order), and what `agent.spawn` returns to deny.

## 4. Whether `sec-default` loads here

All four logs carry `cc-plugin-sec-default@builtin not seated: no managed settings and not a Team
or Enterprise organization (max)`. On this machine, then:

- no deny rule in `.claude/settings.json` holds over a user's mod;
- a user's mod can answer `tool.call` without `next`, which skips this repo's pre-tool hook, or
  approve at `tool.check` what the hook refused;
- `harness-guard` gets no protection from the built-in guard, and is itself `tier user`: any mod
  loaded ahead of it can answer a call before it sees it. Decision 5 holds as written.

## 5. What this settles for item 2, and what it does not

- `tool.call` in the guard mod is the SECOND hearing of a call the settings hook also judges, for
  the lead and for every agent. Its added reach is not coverage; it is the hold-and-ask and a
  `.catch` that denies.
- The spawn contract is the gap a mod closes: `agent.spawn` is the only point that saw the
  workflow agent start.
- `Workflow` is absent from the settings matcher, so the lead's `Workflow` call is judged by no
  guard today. A mod's `tool.call` sees it.

## 6. The shapes the mod is written against

Two more headless runs with a third probe, `probe-c`, same day and version. A headless load wrote
no `.claude-plugin/types/` folder into any probe, so these come from runs and not from the types.

- `$.process.run(argv, { stdin: 'text' })` delivers the text on standard input: a script that
  echoes its input printed `STDIN[via-stdin]`. The same call with `{ input: 'text' }` delivered
  nothing. The result's keys: `exitCode`, `stdout`, `stderr`, `isStdoutTruncated`,
  `isStderrTruncated`. The command ran in the session's folder.
- `tool.call`: the event is the tool's arguments beside `tool` and `tool_use_id`, as in
  `{"command":..., "description":..., "tool":"PowerShell", "tool_use_id":...}`. `next(e)` resolved
  to `ref`, `result`, `text`.
- `agent.spawn`: returning `{ deny: 'reason' }` without `next` refused the workflow agent. The
  log said `agent.spawn workflow-subagent: refused by a hook`, and the workflow failed with
  `Workflow agent spawn denied by a plugin:` and the reason. For that agent `subagentType` was
  `workflow-subagent` and `workflow` held `runId` and `agentIndex`.
- `prompt.mention`: the event is `{ mention, path }`, `path` absolute. `next(e)` resolved to
  `{"type":"file"}`. Returning `{ deny: 'reason' }` refused it: `refused by a hook ...; nothing
  attached`. The built-in `cc-plugin-agents-md` hooks the same event, beneath a user's mod.
- `claude plugin validate` refuses a `.catch` handler that is not a function literal or the name
  of one, and prints a matcher built at run time as `tool=?`.

Then the mod itself, `.claude/plugins/harness-guard/`, in one headless session: a mention of
`AGENTS.md` was handed to the entry and attached (exit 0); a shell `echo` was handed over, passed,
and then judged again by the settings hook; a `Read` of the guarded secret file was refused by the
mod on the entry's exit 2, `answered tool.call without next()`, so the settings hook did not run.

NOT MEASURED: any of this in an interactive session. No question the mod asks was ever drawn, so
the held commit and the ask on a spawn are held by `claude plugin test` alone. A teammate spawn,
and an `Agent` tool spawn passing both `tool.call` and `agent.spawn`, were not run either.
