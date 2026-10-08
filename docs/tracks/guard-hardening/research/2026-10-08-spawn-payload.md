---
id: guard-hardening-research-spawn-payload
kind: research
status: frozen
read_when: "changing how a spawn is recognised in a pre-tool payload, or what the spawn contract check reads"
question: "Under the enabled tool, which tool name and which input fields does a subagent spawn carry in a pre-tool payload, and does a deny there stop the spawn?"
answer: "The tool name is `Agent`. Its input carries `description`, `prompt`, `subagent_type` and `run_in_background`; the agent's name is `subagent_type` and the text is `prompt`. A deny in the established spelling stopped the spawn and its reason reached the model."
paths: ["scripts/harness/hook.js", "scripts/harness/dialects/claude.js", "scripts/harness/guards/spawn-guard.cjs"]
commit_at: "ba88eee"
expires: 2026-11-07
source: measured
---

# What a spawn looks like in a pre-tool payload under Claude Code, measured

> Measured on 2026-10-08 on Windows 11, Node v24.19.0, tool version 2.1.293, with the repo at
> commit `ba88eee` on branch `worktrees`. Findings, not instructions. Both runs were HEADLESS
> sessions (`claude -p`, stream output) in a throwaway git repo in the session scratchpad.

## 1. The method

The throwaway repo registered one probe script for `PreToolUse` with a match-all matcher, and
held a copy of this repo's `review` agent file under `.claude/agents/`. The probe logged every
payload. The first session was asked to spawn one subagent of type `review` and then one of
type `general-purpose`, each with a one-line prompt. In the second session the probe answered
the `review` spawn with a deny in the spelling the `claude` dialect already uses for a pre-tool
deny: the permission decision in JSON on stdout, the reason on stderr, exit 2.

## 2. The payload

Both spawns arrived as a `PreToolUse` payload with these envelope keys: `session_id`,
`transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`,
`tool_name`, `tool_input`, `tool_use_id`.

| Field | The registered agent | The built-in agent |
|---|---|---|
| `tool_name` | `Agent` | `Agent` |
| keys of `tool_input` | `description`, `prompt`, `subagent_type`, `run_in_background` | the same four |
| `tool_input.subagent_type` | `review` | `general-purpose` |
| `tool_input.prompt` | the prompt text, whole, as a string | the same |

Nothing in the payload says whether the agent type is one a file under `.claude/agents/`
defines or one the tool builds in. The two differ only in the value of `subagent_type`.

## 3. The deny

In the second session the stream showed the tool call, then a user-side tool result reading
`PreToolUse:Agent hook error: ` followed by the probe's reason, and no task-start event: the
subagent never ran. The model repeated the reason and the session ended after its second turn.
The probe was called once for the spawn and once at stop.

## 4. What this does and does not establish

- A spawn is a call of the tool named `Agent`; the agent is `subagent_type`, the text `prompt`.
- A handler that must tell a registered agent from any other has to read the agent directory
  itself: the payload does not carry the distinction.
- The existing pre-tool deny spelling refuses a spawn, and the reason is what the model sees.
- Not measured: a spawn made by a subagent; a spawn with no `subagent_type` at all; a forked
  agent; an interactive session; the two other registry rows that share the wire format.
- The tool's hook matcher has to name `Agent` for the entry to be called at all. The match-all
  matcher used here is not the one this repo registers.
