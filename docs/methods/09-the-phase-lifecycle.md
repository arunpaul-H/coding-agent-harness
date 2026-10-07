---
id: method-09-the-phase-lifecycle
kind: reference
status: open
read_when: "closing a phase or archiving a track, or when the close script refuses"
paths: ["scripts/harness/close-phase.js", "scripts/harness/guards/phase-guard.cjs", "docs/tracks/**"]
verify: "node scripts/harness/close-phase.js --self-test && node scripts/harness/guards/phase-guard.cjs --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# The phase lifecycle: closing is a verified act

## The failure

- **"Done" as a sentence.** A `status:` flipped by hand. A completion note typed from memory. A
  track folder moved into the archive because the work felt finished. Each held up until the
  next cold session trusted it.
- **A green verdict about a different tree.** The recorded gate verdict was one commit behind
  HEAD. The commit in between was the close-and-archive itself, and it had deleted a file that a
  test read as a fixture. The suite was red at HEAD, every doc said green, and nothing compared
  the verdict's commit to the current one.
- **A verdict recorded over uncommitted work.** The runner wrote a dirty flag into the verdict
  and nothing read it. A phase could close on a run that was green only because of files nobody
  had committed, some of them another session's.
- **A gate that was not run, implied as run.** Source changed after the last suite run. The
  report said "gates green" and meant "gates were green earlier".
- **A plan whose first commit never landed.** The plan described a phase as underway for weeks.
  No commit with that subject existed.
- **A handoff nobody rewrote.** The phase closed with the previous phase's "what next" block
  still in place.

## The mechanism

**A phase** is one unit of a track's `plan.md`. It names its `first_commit` subject and its exit
command before work starts. One phase per session; the handoff block carries state across.

**`node scripts/harness/close-phase.js <track-id>`** refuses unless all six hold. It runs the
mechanisms that own each answer and re-implements none of them.

| # | Precondition | Read from |
|---|---|---|
| 1 | the gate verdict is at HEAD | `gates.json` `commit` against `git rev-parse HEAD` |
| 2 | it was recorded against a clean tree | `gates.json` `dirty`. Absent is not clean |
| 3 | it is green against the baseline | the gate runner's own comparator, imported |
| 4 | it is not stale | no file under the watched trees, the capped root docs or the config is newer than the run |
| 5 | the tree is hygiene-clean | the declared `hygiene` gate, re-run now |
| 6 | the handoff is real | `handoff-lint.js` passes AND the ▶ block's hash differs from the last receipt's |

Then it writes five flat fields into the track README's frontmatter: `closed_phase`,
`closed_at`, `gates_sha`, `block_sha`, `receipt`.

- **The receipt is recomputed by the doc linter** with the formula imported from the close
  script. Two implementations of one hash would drift, and on that day the linter either rejects
  every honest receipt or accepts a forged one.
- **`--archive`** closes the whole track: sets `status: complete`, moves the folder under the
  archive with `git mv`, regenerates the index. It is the only route into the archive.
- **`scripts/harness/guards/phase-guard.cjs` denies the manual versions** at the tool call: D1 a bare
  move into the archive, D2 a hand-flipped `status:` or a typed receipt field, D3 a gate figure
  written into a governed doc. It reads the prior status off disk, so rewriting a doc with its
  status unchanged is not denied.
- **Order matters.** The close run is the LAST thing after the final edit. The full order is
  section 6 of `docs/reference/DOC-STANDARD.md`.
- **A re-baseline during a phase is its own commit** with a `gates:` subject.
- **Tests must not read live track files as fixtures.** Build a synthetic one in a temp
  directory, or the next archive breaks the suite.
- **The three working skills** in `.claude/skills/` (`research`, `plan`, `implement`) walk one
  phase: frozen research, a plan and handoff written by the lead, one task implemented and gated.

## Why a mechanism and not a rule

- The close checklist existed as numbered prose steps. It was followed, loosely, and the status
  line was the first thing edited and the suite the last thing run. A script that refuses puts
  the order beyond negotiation.
- "Run the gates before you say done" depends on the reporter being honest about when "before"
  was. Comparing the verdict's commit and time against the tree does not.
- "Rewrite the handoff" is checked by hash: an unchanged block cannot close a phase.
- The guard exists because a script that does the right thing is no use if the wrong thing is
  one `mv` away. The refusal message names the command to run instead.

## The cost and the limits

- **The receipt is a digest, not a chain.** It is a hash over the track id and three fields. It
  authenticates one close and orders none; there is no link to a prior receipt.
- **It proves provenance, not quality.** A valid receipt means the script wrote it while six
  conditions held. It does not mean the phase did the right work. Green gates over the wrong
  tests close cleanly.
- **Unfakeable by assertion, not by effort.** An agent cannot type its way past the linter. An
  agent with a shell could still run the formula itself; the guard denies shapes, not intent.
- **The trigger is manual.** Nothing closes a phase for you, and a session that dies mid-phase
  leaves no receipt and no fresh handoff.
- **Staleness is strict on purpose and it is irritating.** Any edit under a watched tree after
  the suite run forces a re-run, documentation included when the docs root is a watched tree.
- **A shared worktree blocks every close.** A second session's uncommitted work makes the tree
  dirty, and precondition 2 refuses. That is correct and inconvenient. Use separate worktrees.
- **Modification times are the staleness signal.** A checkout or a tool that touches files can
  make a verdict look stale. The remedy is to re-run the suite, which is never wrong.
- **A commit must exist before the close**, because the verdict must be at HEAD on a clean tree.
  Where an agent may not commit, the close waits for a person.
- **Cost:** one hygiene gate run, one handoff lint and some git calls, on top of the suite run
  that had to happen anyway.
