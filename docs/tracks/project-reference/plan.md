---
id: project-reference-plan
kind: plan
status: open
read_when: "project-reference: the phases, each with its exit command and first commit"
first_commit: "project-reference: measure one task with and without a reference doc"
---

# Project reference docs: the phases

One phase per session. Each ends with its exit command run in the foreground and its output
pasted. A phase that cannot close says so and stops. Read `README.md` **How to work** before
starting any of them, and `traps.md` before touching anything.

The order is cost first, risk second. Phase 1 adds a command and a template and touches no gate.
Phase 2 edits the doc linter, which can move a gate total, so it waits until phase 1 has produced a
real doc to test against. Phase 3 measures whether a doc helps at all; it needs both earlier pieces
and its result decides what the root README tells an adopter.

## Phase 0: the track is open, with frozen evidence

**Problem.** An adopter gets no project reference doc, and nobody had checked what would help.

**Do.** One research file; this folder's four docs.

**First commit:** `project-reference: open the track`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js project-reference`

**Delivered.** `research/2026-10-07-project-reference-docs.md`, written by a research agent with
no shell, so its repo claims are reads and not runs. Deviation: the owner asked for the documents
to be created up front; the evidence supports creating them on request and by hand, so that is
what phases 1 to 3 build (README decisions 1 to 3).

## Phase 1: a doc for a named subsystem, in one command

**Problem.** The only reference shape is prose in `docs/reference/DOC-STANDARD.md` §3. `init`
copies `templates/track/` through `TRACK_TEMPLATES` in `bin/harness.js` and has no equivalent for a
reference doc; the CLI has no command that writes one.

**Do.**
1. `templates/reference/README.md`: frontmatter with `<PLACEHOLDER>` tokens in the style of
   `templates/track/README.md`, and a body of headed sections for what code cannot say: what this
   is the contract for, invariants and why, decisions and why, what runs where and outside
   constraints, where the code is (paths only), how to check it. One comment line states the rule:
   a fact an agent can get by search does not belong here.
2. `harness reference new <subsystem> --read-when "<line>" --paths "<glob>[,<glob>]"`, with the
   optional `--verify "<command>"`, `--into <dir>` and `--dry-run`. It renders the template to
   `<docsRoot>/reference/<subsystem>/README.md` with `id` set to the subsystem, `kind: reference`,
   `status: open` and today's date as `last_verified`. It stops with a fix line when: the subsystem
   is not kebab-case; `--read-when` or `--paths` is absent; the file exists; the `id` is already
   used under the docs root. It ends by printing the index command to run.
3. `init` copies the template beside the track templates, so a hand copy works with no package.
4. Register it everywhere REF-05 lists: the template list and export, the usage and help text, the
   dispatch, the self-test's fake package and absent-piece assertion, and `tests/cli.test.js`.
5. Self-test cases and tests for each refusal, for `--dry-run` writing nothing, and for the
   rendered doc passing `docs-lint.cjs` in a temp repo.

**Do NOT.** Touch `docs-lint.cjs`, add a prompt, add a skill, or scaffold more than one file per
call (README invariants 2 and 3). Do not create a reference doc in THIS repo as a demonstration.

**First commit:** `project-reference: a reference template and harness reference new`
**Exit:** `node bin/harness.js --self-test && node --test`

**Delivered.** The template, `cmdReference` with the pure `referenceArgs`, `renderReference` and
`referencePlan` in `bin/harness.js`, the init copy, and cases in the self-test and
`tests/cli.test.js`, one of which lints the rendered doc in a temp repo. Built by an `implement`
agent; the lead reviewed the diff. Deviations, all beyond what the Do list names:
- A double quote or a line break in `--read-when`, `--verify` or a glob is refused, not escaped (REF-08).
- With no `--verify` the rendered doc has no `verify` line; an empty `--verify` is refused.
- Further refusals: an unknown flag (so there is no `--force`), a subcommand other than `new`, a
  target with no valid config, a target that is not a directory, a package with no template, and
  a template that lost a frontmatter field line.
- The id scan covers `project.tracksDir` as well as the docs root.
- `last_verified` is the local date, not UTC, and `max_age_days` is fixed by the template.
- The template is read from the package that runs the command, not from the target's copy.
- The self-test's absent-piece assertion now also names the track templates, which it never did.

## Phase 2: a doc that has drifted says so

**Problem.** `paths` and `verify` are read by no script (REF-01), so a doc stays "verified" while
the files it governs change. A `last_verified` that does not parse never warns (REF-02).

**Do.**
1. In `docs-lint.cjs`, beside the existing staleness warning: for a doc carrying both `paths` and
   `last_verified`, ask git for commits to those paths since that date and warn with the count and
   the newest hash. Warn, exit 0. Skip silently outside a git repo; say so in a shallow clone.
2. Warn when `last_verified` is present and does not parse as a date.
3. Tests in `tests/docs.test.js` for: drift found, no drift, no git, an unparseable date.
4. `docs/reference/DOC-STANDARD.md`, its frontmatter and linter-rule sections: say what `paths` now drives, and stop claiming that
   `verify` "must exist" unless this phase also checks it. Mirror the change in the template copy.
5. If the `docs` gate total moves, re-baseline in its own commit whose subject starts `gates:`.

**Do NOT.** Make either check a hard failure (README decision 5), or re-date any doc to quiet a
warning this phase prints about this repo's own docs: report them instead.

**First commit:** `project-reference: warn when a doc's governed paths changed since it was verified`
**Exit:** `node --test && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

**Delivered.** Both warnings, inside rule 9's one application in `docs-lint.cjs`: the pure
`notADate`, `verifiedUntil`, `driftPlan` and `driftFinding`, and a thin git half. Tests in
`tests/docs.test.js`; both copies of the doc standard; the header comment. Built by an `implement`
agent; the lead reviewed the diff. The docs gate total rose, from new self-test decisions only
(REF-03), so the baseline was re-recorded in its own `gates:` commit. Deviations:
- The exit command was run with `--allow-skip docs=1,reproducible-build=1` (REF-09).
- Drift counts a commit only from the start of the local day AFTER `last_verified`, by committer
  date; a commit on the verification day never warns. The doc's own file is excluded.
- Only a `status: open` doc outside the exempt directories is checked for drift. The date
  warning applies to every linted doc.
- The shallow-clone line prints once, and only when some doc was eligible.
- A scalar `paths` value is read as one glob.
- `verify` is still checked by nothing; the standard now calls it advisory instead (REF-01).
- Two frontmatter comment lines in `templates/reference/README.md` were corrected, because phase 2
  made them false. That file was out of this phase's scope as first written.
- Tests beyond the four named: a shallow clone, the doc's own file, exempt and non-open docs.

## Phase 3: one measurement, then tell the adopter the truth

**Problem.** No source measures a doc reached on demand through a generated index; every negative
study tests files injected into each session. Whether this mechanism saves tokens here is unknown.

**Do.**
1. Pick one real task in this repo that needs a fact from a subsystem. Run it twice from a cold
   session with the same model: once with a reference doc for that subsystem, once without.
   Record tokens, tool calls, files opened and whether the result was correct.
2. Write it as a dated research file in this track. One pair is an observation, not proof: say so.
3. From the result, add a short adopter section to the root `README.md`: when to run
   `harness reference new`, what belongs in the doc, and what the measurement showed.
4. Put the README decision 6 question to the owner with the result attached.

**Do NOT.** Keep the experiment's doc unless it is a contract this repo needs anyway.

**First commit:** `project-reference: measure one task with and without a reference doc`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

**Delivered.** `research/2026-10-08-one-task-with-and-without-a-reference-doc.md`, and the section
"Reference docs for your own project" in the root `README.md`. Both runs were correct; the run
with the doc used somewhat fewer tokens and the same number of tool calls. Deviations:
- The two runs were subagents of one session, not two cold sessions, on the owner's instruction.
- The task was a read-only question with a checkable answer, not an edit.
- The doc was written by the session that had just worked on that subsystem, which flatters it.
- Item 4 is put in the track README and the research file; the owner has not answered it.
- No phase follows, so the frontmatter `first_commit` stays this phase's.
