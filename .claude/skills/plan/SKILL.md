---
name: plan
description: Rewrite a track's plan.md and handoff.md from a named research file, naming the phase's first_commit and its exit command. Use when a track phase is ready to be specified, or when a handoff needs replacing wholesale.
argument-hint: <track-id> <path to the research file>
disable-model-invocation: true
---

# /plan — the LEAD writes this, and does not delegate it

Planning is judgement: what to build, in what order, and what proves it. It stays with the lead.
No fork, no subagent. If no research file is named, say what evidence is missing and stop. A plan
written from memory instead of from a dated file is an opinion with a phase number on it.

Tracks live under `project.tracksDir` in `harness.config.json`; `docs/tracks` below is the default.

## Read, and nothing else

- `docs/tracks/<id>/README.md` — the operating model, the locked decisions, the invariants
- the named `research/<date>-<slug>.md` — the evidence this plan rests on
- `docs/tracks/<id>/plan.md` — the phase you are about to specify

## Write two files, both wholesale

**`plan.md`** — for the phase: its work list, its `first_commit:` subject, and the exit command
that proves it. A phase with no exit command is a wish. Record what the previous phase actually
delivered and every deviation from what it was asked to do, in the same pass.

**`handoff.md`** — exactly ONE ▶ block, replaced wholesale, never appended. It is written for a
session with NO memory of this one, and `node scripts/harness/handoff-lint.js <id>` is the
acceptance test. It reds unless the block carries: a `Read` line naming paths that resolve today ·
a `SCOPE:` line · a negative instruction (`do NOT re-...`) · a line citing gates.json for where a
figure may come from · a `First commit:` line · an `Exit:` line · a "How to work" pointer · and
every standalone integer of 10 or more sitting on a line that also carries gates.json, a
`path:line`, or a prefixed trap id. That last one is the claims ledger: a figure nobody can check
is how a stale number becomes a false regression two phases later.

Set `phase_next:` in the handoff frontmatter: `close-phase.js` closes that number minus one.

## What NOT to do

- Do not flip a `status:` or type a receipt — `close-phase.js` writes both, and phase-guard denies
  the manual version.
- Do not restate a gate total anywhere, including in a commit subject.
- Do not leave a second ▶ block anywhere in the repo; docs-lint fails it.
- Do not carry forward a work item without saying who it is blocked on.

## Then

Run `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check` and paste
the output. Do not commit unless the user asks.
