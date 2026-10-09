---
id: claude-code-uptake-plan
kind: plan
status: open
read_when: "claude-code-uptake: the phases, each with its exit command and first commit"
first_commit: "claude: bring the hook entry, agents and skills up to the tool as it is"
---

# Claude Code uptake: the phases

One phase per session. Each ends with its exit command run in the foreground and its output
pasted. A phase that cannot close says so and stops. Read `README.md` **How to work** before
starting any of them, and `traps.md` before touching anything.

Phase 1 is wiring only and pays back at once. Phase 2 is the smallest mod that is useful, and it
proves the load, test and gate path every later mod reuses. Phase 3 adds commands to that mod.
Phase 4 is the first mod that can refuse a call, so it comes after the path is proven. Phase 5
needs real mods on disk to vet. Phase 6 packages what the others built.

GATE, wherever a phase's exit names it:
`node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

## Phase 0: the evidence, dated and frozen

**Do.** One research file from the vendor's changelog and the mods pages.

**First commit:** `docs: open the claude-code-uptake track with its evidence`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

**Delivered.** `research/2026-10-09-claude-code-releases.md`, uncommitted. Deviations: scope moved
mid-run from permission modes to mods; the changelog was read to 2.1.287 only (CU-02). No runs.

## Phase 1: leverage what already shipped

**Problem.** The wiring predated several releases: a pre-tool hook that timed out let the call
through, the matcher omitted two tools, and agent files used four fields of many.

**Do.** (1) `"onFailure": "block"` on the pre-tool entry, measured. (2) `Monitor` and
`NotebookEdit` in the matcher and the dialect. (3) Agent fields: `effort`, `maxTurns`,
`isolation`, `disallowedTools`. (4) `background: false` on the forked skills if a run needs it.
(5) A `Tool(param:value)` deny rule for a spawn limit. (6) Update the `claude-code` tool row.

**Do NOT.** Write a mod, or add `Workflow` to the matcher: Phase 4 reaches those agents.

**First commit:** `claude: bring the hook entry, agents and skills up to the tool as it is`
**Exit:** GATE

**Delivered.** Uncommitted. Items 1, 2 and 6 as written: the pre-tool entry carries
`onFailure: "block"` and the dialect renders it (`scripts/harness/dialects/claude.js`), `Monitor`
and `NotebookEdit` are mapped and in the matcher with tests, and the tool row records both probe
runs. Deviations, each a deliberate cut:
- Item 3: `effort` only. `isolation: worktree` on `implement` was WRONG as planned: its edits
  would land in another folder than the one the lead reviews. `maxTurns` has no measured basis,
  and a guessed ceiling cuts a real run short. No tool list needed a `disallowedTools`.
- Item 4: no change. `.claude/skills/research/SKILL.md:13` already says the fork runs in the
  background and is written for it.
- Item 5: no rule added. The spawn guard holds a contract, not a limit a rule could state.
- Not run: a hook that cannot start, and any spawn of an agent after `effort` was added.

## Phase 2: the `harness` mod, a panel and `/gates`

**Problem.** The stale-verdict report is text at the end of a turn, the session-start reports
scroll away, and running the gate costs a model turn.

**Do.**
1. `.claude/plugins/harness/`: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.js`.
2. A new script with `--self-test` that prints the panel's facts as JSON: the verdict in
   `scripts/harness/gates.json` (green, red, stale), the open track and its `phase_next`, the
   session-start findings. The mod runs it with `$.process.run` and only draws (decision 1).
3. A band above the prompt showing those facts and context percent from `$.session.usage()`.
4. `/gates`: runs GATE, prints its closing lines, notifies with `$.ui.notify`. No model turn.
5. `.test.ts` files beside the mod, and a `mods` gate in `harness.config.json`, `optional: true`.

**Do NOT.** Hook `tool.call`, `tool.check`, `prompt.submit`; call `$.fs.write`, `$.http.fetch`, `$.model.complete`.

**First commit:** `mods: a panel for the gate verdict and the open track, and /gates`
**Exit:** `claude plugin validate .claude/plugins/harness --strict && claude plugin test .claude/plugins/harness` then GATE

**Delivered.** Uncommitted, NOT closed: `carveouts` is red until re-recorded (CU-05). Deviations: a state `not-run`; `$.ui.toast`
for the absent `$.ui.notify`; `/gates` answers NOT RUN here (CU-03); `mods=1` in the CI runner's skips. No session loaded it.

## Phase 3: the track lifecycle as commands

**Problem.** Opening a track, linting a handoff and closing a phase are commands an agent must
remember and spend a turn on.

**Do.** In the `harness` mod: `/track` (list tracks, open one's handoff in a pane), `/handoff`
(run `handoff-lint.js`, show reasons), `/close-phase` (confirm with `$.ui.ask`, run
`close-phase.js`, show its refusal or receipt). A `session.compact` hook that names the open
track's handoff in the line under the answer. Tests for each.

**Do NOT.** Write a receipt, a `status:` or a handoff from the mod: the scripts do, as today.

**First commit:** `mods: /track, /handoff and /close-phase without a model turn`
**Exit:** as Phase 2

**Delivered.** not started

## Phase 4: the `harness-guard` mod

**Problem.** A settings hook never sees a teammate or a workflow agent spawn, so the spawn
contract misses them. A deny is a wall of text where a mod could hold the call and ask.

**Do.**
1. First, a research file from runs: mod order in the user tier, whether a project pre-tool hook
   fires for a workflow agent's calls, whether `sec-default` loads here. Item 2 is BLOCKED ON it.
2. `.claude/plugins/harness-guard/`: `tool.call` hands the call to `scripts/harness/hook.js` and
   relays the verdict; `agent.spawn` applies the four-field contract to every spawn;
   `prompt.mention` refuses a guarded file; a commit the hygiene guard refuses is held and shown
   with its findings and a cancel button. Every gating hook has a `.catch` that denies.

**Do NOT.** Remove a settings hook (decision 2) or call the mod final (decision 5).

**First commit:** `mods: the guards in-process, each with a catch that denies`
**Exit:** `claude plugin validate .claude/plugins/harness-guard --strict && claude plugin test .claude/plugins/harness-guard` then GATE

**Delivered.** not started

## Phase 5: the skill gate vets mods

**Problem.** `scripts/harness/guards/skill-verify.cjs:90` reads `enabledPlugins` from the user file
only and cannot tell a mod from any other plugin.

**Do.** Cover every load route (project file, `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, the
dev-mods folder). Pin a mod's events and API calls in `skills-lock.json` from
`claude plugin validate --json`. Session start names any unpinned mod that handles `tool.call` or
`tool.check`. Rewrite `docs/reference/skill-safety/` for mods. Add
`templates/managed-settings.json` for an owner who wants the guard mod to be final.

**First commit:** `skills: the skill gate names a mod and what it can reach`
**Exit:** `node scripts/harness/guards/skill-verify.cjs --self-test && node scripts/harness/guards/skill-verify.cjs --check` then GATE

**Delivered.** not started

## Phase 6: the harness ships as a plugin

**Do.** A marketplace manifest listing both plugins, with the skills and agents alongside the
mods, an install line in the root `README.md`, and the installer taught to offer the plugin route
for Claude Code and the file-copy route for every other tool.

**First commit:** `plugin: install the harness from a marketplace`
**Exit:** `claude plugin validate . --strict` then GATE

**Delivered.** not started

## Not scheduled: each waits on the user

- `fully-auto` in `scripts/harness/tools.json:83` mapped to auto mode: the owner's risk to accept.
- A saved workflow for research, plan, implement, review: needs an opt-in to multi-agent runs.
- Scheduled gate runs (`/loop`, routines) and a `WorktreeRemove` hook: no stated need yet.
