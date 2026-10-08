---
id: guard-hardening-plan
kind: plan
status: open
read_when: "guard-hardening: the phases, each with its exit command and first commit"
first_commit: "guards: measure where the test gate's time goes"
---

# Guard hardening: the phases

Each phase ends with its exit command run and its output pasted; one that cannot close says so
and stops. Read `README.md` **How to work** first, and `traps.md` before touching anything.
The order is by what a cloner meets first: a secret read by accident, then a close that was
never a close, then a figure that goes stale. The stop report and the skill pins need a fact
about the tool confirmed first, so they follow. The test-time question is last: it helps
contributors, not adopters.

## Phase 0: evidence for what the guards let through

Closed. `research/2026-10-08-guard-probe.md`.
**First commit:** `guards: open the hardening track with a measured probe`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/handoff-lint.js guard-hardening`

## Phase 1: the secret guard reads a name as a shell opens it

Closed.
**First commit:** `guards: read a guarded name as a shell opens it`
**Exit:** `node scripts/harness/guards/env-guard.cjs --self-test && node bin/harness.js gates --check`

**Delivered.** In `scripts/harness/guards/env-guard.cjs`: the text is read three ways (as
written, quotes dropped, backslashes dropped); a word carrying a wildcard is refused when it can
match a guarded dotfile; the body of a vouched-for write is not read and its path still is; the
refusal says a wildcard counts; the header says what the guard does not stop. Process tests in
`tests/hook.test.js`. Deviations: the plan said "doc prose" and the change is every vouched-for
write body, because nothing separates a doc from a config file by name (README decision 2). The
policy file was left alone (README, State).

## Phase 2: an archive is a close, wherever the shell stands

Closed.
**First commit:** `guards: follow the directory before judging a move into the archive`
**Exit:** `node scripts/harness/guards/phase-guard.cjs --self-test && node scripts/harness/guards/docs-lint.cjs --self-test && node bin/harness.js gates --check`

**Delivered.** `scripts/harness/guards/phase-guard.cjs` follows each chained `cd` and the
directory the envelope names, and refuses a copy of a track into the archive. The `claude`
dialect passes the directory through; `scripts/harness/dialects/_wire.js` documents the field.
`scripts/harness/guards/docs-lint.cjs` gains rule 13: an archived track must be complete with a
receipt that recomputes for its folder name. Both copies of the doc standard say so. Deviations:
the other three dialects do not pass a directory (GH-05).

## Phase 3: a pasted gate line is a figure

Closed.
**First commit:** `guards: refuse a pasted gate line in a governed doc`
**Exit:** `node scripts/harness/guards/phase-guard.cjs --self-test && node scripts/harness/guards/docs-lint.cjs --self-test && node bin/harness.js gates --check`

**Delivered.** One more shape in the figure pattern of both the guard and the linter: a count
of two digits or more after the three count words of a gate line. A one-digit count, the line
format with placeholders and a count in a sentence all pass. Deviations: it has no commit of
its own. It edits the same two files as phase 2 and landed in that phase's commit, with the
process tests of all three phases.

## Phase 4: a stop handler that reports edits made after the last gate run

**Problem.** "Done means verified" has no mechanism: the `stop` list in
`scripts/harness/hook.js` is empty, so a turn can end on edits no gate saw.

**Do.**
- First, measure in a throwaway repo what a stop hook can do under the enabled tool: message
  the person without forcing a turn, and tell a first stop from a forced one. Freeze it as research.
- A `stop` handler that compares the tree with what `scripts/harness/gates.json` recorded and,
  where tracked files changed since, tells the person. It reuses the staleness walk in
  `scripts/harness/close-phase.js`.
- A config key, default off, that turns the report into a forced turn, once per stop.
- Register `Stop` through the dialect's wiring and the installer.

**Do NOT.** Block by default (README decision 6). Run the suite from the handler.

**First commit:** `guards: report at stop when edits outran the gates`
**Exit:** `node scripts/harness/hook.js --self-test && node bin/harness.js gates --check`

**Delivered.** Measured first: `research/2026-10-08-stop-hook.md`. The `stop` list in
`scripts/harness/hook.js` holds one handler, `gate-staleness`; its two halves are `gatherStop`
and `decideStop` in `scripts/harness/close-phase.js`, over the walk the close already used. It
tells the person how many gate-relevant files are newer than the recorded verdict and ends the
turn. `stop.block` in the config, default false, forces one turn per stop. The `claude` dialect
spells a report as a system message and a forced turn as a block decision, and registers `Stop`
through its wiring, so the installer renders it. Deviations: the entry now carries an allowing
stop handler's line to the dialect, which it dropped before; silent with no recorded verdict.

## Phase 5: the installer pins the skills the harness ships

**Problem.** `skills-lock.json` ships empty, so every clone starts every session with a line
naming the four shipped skills as unpinned. A warning that never clears is one nobody reads.

**Do.** A distinct lock entry kind for a skill the harness itself shipped, carrying its digests
and claiming no human review. `harness init` writes those entries for what it renders.
`scripts/harness/guards/skill-verify.cjs` is silent for a shipped skill that matches and loud
for one that drifted. Read `docs/reference/skill-safety/README.md` first.

**Do NOT.** Write a `reviewedAt` date nobody earned. Pin a skill the installer did not render.

**First commit:** `skills: pin what the harness ships, and say only that`
**Exit:** `node scripts/harness/guards/skill-verify.cjs --self-test && node bin/harness.js gates --check`

**Delivered.** A lock entry kind `shipped` in `scripts/harness/guards/skill-verify.cjs`: the
directory, its digests, no review date. Matching it is silent, drifted it is a `DRIFT` error,
and pointed anywhere but the project's own skill root it is refused, so it cannot silence a
vendored skill. `--update` re-pins one and never dates it. `bin/harness.js` init writes one
per skill it copies; a name that is also rendered keeps its rendered entry and gains
`<name>.shipped`. This repo's `skills-lock.json` pins its own four the same way, so a clone
starts silent. Deviations: the lock no longer ships empty, which two tests and the lock's own
note asserted; a rendered entry is untouched, including the date `--update` gives it.

## Phase 6: a spawn of a registered agent carries the contract

**Problem.** `docs/reference/routing/README.md` calls the four contract fields mandatory on
every spawn, and nothing reads a spawn prompt.

**Do.** Measure the tool name and the prompt field a spawn carries in a pre-tool payload, and
freeze it. Then a pre-tool handler that refuses a spawn of an agent in `.claude/agents/` whose
prompt lacks any of the four field names. Every other agent type passes untouched.

**Do NOT.** Judge the content of a field. Touch a spawn the harness did not define.

**First commit:** `guards: a spawn of a registered agent carries the contract`
**Exit:** `node scripts/harness/hook.js --self-test && node bin/harness.js gates --check`

**Delivered.** Measured first: `research/2026-10-08-spawn-payload.md`. A fourth pre-tool
handler, `spawn-guard`, in `scripts/harness/guards/spawn-guard.cjs`: a spawn of an agent a file
in the tool's agent directory defines is denied unless its prompt carries the four field names,
each with a colon, in any case. Every other agent type passes, and no field's content is read.
The `claude` dialect maps the tool name to a new neutral action `spawn`, hands on the agent and
the prompt, names the agent directory, and renders the tool name into the matcher. Deviations:
the older guards are not offered a spawn; an earlier install keeps its old matcher (GH-12).

## Phase 7: where the test gate's minutes go

**Problem.** The `test` gate took minutes on the audit machine; the figure is in
`scripts/harness/gates.json`. A contributor pays that on every check.

**Do.** Measure per test file, on this machine and one Linux box. Freeze it as research. Plan a
change only if one file or one cause owns most of the time.

**First commit:** `guards: measure where the test gate's time goes`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

**Delivered.** `research/2026-10-08-test-gate-time.md`: each test file timed alone, the
slowest tests, the cost of one child process. No file or single cause was shown to own most
of the time, so no change is planned. Deviations: one machine; no Linux box was reachable.
