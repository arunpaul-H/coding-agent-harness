---
# TEMPLATE. Fill each <PLACEHOLDER>, delete every comment. <TRACK_ID> is the folder name; the `-plan` suffix keeps the id unique.
id: <TRACK_ID>-plan
kind: plan
status: open
# <READ_WHEN>: when to open the plan rather than the handoff, e.g. "<track>: the phases, each with its exit command and first commit".
read_when: "<READ_WHEN>"
# <FIRST_COMMIT_SUBJECT>: the subject of the CURRENT phase's first commit, verbatim. docs-lint greps git log for it and warns until it lands.
first_commit: "<FIRST_COMMIT_SUBJECT>"
---

# <TRACK_TITLE>: the phases
<!-- <TRACK_TITLE>: as in README.md. -->

One phase per session. Each ends with its exit command run in the foreground and its output
pasted. A phase that cannot close says so and stops. Read `README.md` **How to work** before
starting any of them, and `traps.md` before touching anything.

<ORDERING_RATIONALE>
<!-- <ORDERING_RATIONALE>: 2 to 4 lines on why the phases are in this order: what each one unblocks. An order with no reason gets reshuffled. -->

## Phase 0: <PHASE_NAME>
<!-- <PHASE_NAME>: the outcome, not the activity. "green the suite at HEAD", not "work on tests". -->

**Problem.** <PROBLEM>
<!-- <PROBLEM>: what is wrong today, with the evidence: a `path:line`, a trap id, or the research file. -->

**Do.** <WORK_LIST>
<!-- <WORK_LIST>: the changes, concrete enough that a session with no memory of this one can start. -->

**Do NOT.** <OUT_OF_SCOPE>
<!-- <OUT_OF_SCOPE>: the tempting neighbour this phase must leave alone, and which invariant governs it. -->

**First commit:** `<FIRST_COMMIT_SUBJECT>`
**Exit:** `<EXIT_COMMAND>`
<!-- <EXIT_COMMAND>: the command whose output proves the phase, verbatim and runnable. A phase with no exit command is a wish. -->

**Delivered.** <WHAT_ACTUALLY_LANDED>
<!-- <WHAT_ACTUALLY_LANDED>: filled when the phase closes: what it really delivered and every deviation from **Do**. Leave "not started" until then. -->

<!-- Copy the Phase 0 block for each further phase, numbered in order. Every phase carries its own First commit and Exit lines. -->
