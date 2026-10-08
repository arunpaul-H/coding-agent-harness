---
id: method-03-tracks-handoffs-and-cross-session-memory
kind: reference
status: open
read_when: "starting work that will outlive one session, or writing a handoff for the next one"
paths: ["templates/track/**", "scripts/harness/handoff-lint.js", "scripts/harness/findings-check.js"]
verify: "node scripts/harness/handoff-lint.js --self-test && node scripts/harness/findings-check.js --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# Tracks, handoffs and cross-session memory

## The failure

- **The cold session re-derives everything.** It has no memory of the last one. Without being
  told what was already measured, it measures again, gets a slightly different number, and reads
  the difference as a change in the code.
- **"What next" lives in two places.** A status board says one thing, a tracker says another, and
  the new session picks up the older one.
- **A handoff that is appended to.** Each session adds a section. The file becomes a stack of
  stale instructions with the oldest on top.
- **A number nobody can check.** "Smoke was at some figure" is copied forward through three
  handoffs, compared against a fresh run two phases later, and reported as a regression. The
  figure was stale when it was first written.
- **Traps as rumours.** "Careful, X breaks under Y" with no file behind it. Nobody can confirm
  it, nobody dares delete it, and every later session treats it as a constraint.
- **Research that is maintained.** A measurement edited to stay current is no longer a
  measurement of anything, and the date on it lies.
- **A central status doc.** One file tracking every stream of work is edited by every session,
  conflicts constantly, and is always partly wrong.

## The mechanism

**A track is a folder**, one per stream of work, under `project.tracksDir`:

| File | Holds | Enforced by |
|---|---|---|
| `README.md` | current truth: decisions and why, invariants, "How to work", state | frontmatter, `docs-lint.cjs` |
| `plan.md` | phases, each naming its `first_commit` and its exit command | a warning if the commit never lands |
| `traps.md` | one line per trap, prefixed id, anchored to a path | `docs-lint.cjs` rule 7: the path must resolve |
| `handoff.md` | exactly ONE ▶ block, replaced wholesale | `docs-lint.cjs` rule 5, `handoff-lint.js` |
| `research/<date>-<slug>.md` | dated frozen evidence | `docs-lint.cjs` rule 8: the body may not change |
| `findings.json` (optional) | a backlog where each row carries a proof command | `findings-check.js` |

- **The track README is rewritten in place.** Current truth only, never a changelog.
- **The handoff block is the compaction artifact.** The context-rot control is a fresh session
  per phase, and the ▶ block is everything that session inherits.
- **`node scripts/harness/handoff-lint.js <track-id>`** exits 1 unless the block has: a `Read`
  line naming a path that resolves; a negative instruction; a line citing `gates.json` as the
  source of figures; a `SCOPE:` line; `Exit:` and `First commit:` lines; a pointer to "How to
  work"; and passes the claims ledger.
- **The claims ledger.** Every standalone integer of 10 or more must share its line with a
  `path:line`, a prefixed trap id or `gates.json`. Dates, versions and names with digits are
  masked first so the rule stays about figures.
- **The negative instruction is mandatory** because re-deriving is the default failure. "Do NOT
  re-measure X, it is in `research/...`" saves more than any positive instruction.
- **A wrong finding is corrected by a new dated file,** never by editing the old one.
- **`node scripts/harness/findings-check.js --track <track-id>`** runs each ledger row's proof
  and reports `CLOSED`, `OPEN`, `UNCHECKABLE` or `ERROR`. It never writes the ledger.
- **`docs/INDEX.md`** carries one row per track, generated, so there is no central board to
  maintain. A track waiting on a person says so in `blocked_on:` and the index surfaces it.
- The exact shapes are in `docs/reference/DOC-STANDARD.md`. The skeleton to copy is
  `templates/track/`.

## Why a mechanism and not a rule

- "Write a good handoff" was a checklist in a doc. Handoffs written under it carried bare
  figures and no negative instruction, because the session writing one already knows the context
  and cannot see what is missing. A linter has no context, which is exactly the reader's
  position.
- "One source of truth for what next" was a convention with a tie-break rule ("the board wins").
  A tie-break only works while someone remembers it. One ▶ block per track, with a second block
  anywhere as a lint failure, needs no tie-break.
- "Do not edit old research" was respected until a figure in it became embarrassing. The
  frozen-body rule compares against the committed version and fails.
- "Cite your traps" produced traps that cited files which had since moved. The rule now resolves
  the path on every run, so a trap goes red the day its anchor disappears.

## The cost and the limits

- **The handoff is written by a model and read as authority.** The ledger checks that an integer
  is cited. It does not check that the citation supports the integer, and nothing marks the block
  as lower-trust than the files it summarises. A confident, well-cited, wrong handoff passes.
- **The loop closes once per phase, by hand.** A session that dies or compacts mid-phase leaves
  nothing behind. Nothing here watches the context window and writes a breadcrumb.
- **Citations are checked for form.** A trap line passes if any cited path exists. Whether the
  trap is still true of that file is not checked.
- **The handoff lint is keyword-shaped.** It looks for `SCOPE:`, `Exit:`, a `do NOT re-` phrase.
  A block can satisfy every pattern and still be useless. It raises the floor only.
- **Frozen bodies cannot be corrected in place.** A wrong measurement stays in the tree, wrong,
  with a newer file beside it. That is the price of the date meaning something.
- **Wholesale replacement loses history on purpose.** The previous block survives only in git.
- **A track is overhead.** Folder, four files, a lint. For work that fits in one or two sessions
  it costs more than it returns; the doc contract's default answer to "should I open one" is no.
- **Cost to run:** both linters are a file read and a few regexes. `findings-check.js` costs
  whatever its proof commands cost, with a timeout per proof.
