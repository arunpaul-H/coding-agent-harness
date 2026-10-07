---
id: doc-standard
kind: reference
status: open
read_when: "creating any .md, opening a track, or closing a phase"
paths: ["docs/**", "CLAUDE.md", "AGENTS.md"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check"
last_verified: 2026-10-05
max_age_days: 90
---

# How to write a doc here

> Every doc here except the root `README.md` is written **for an agent, not a human**. Optimise
> for retrieval. No preamble, no motivation section. A fact per line. **Most of this file is
> enforced, not requested**: `node scripts/harness/guards/docs-lint.cjs` is the contract and runs as the
> `docs` gate. A rule the linter does not check is not a rule; one found here is a bug.

## 1. Do you need a doc at all?

**Default: no.** A doc is a thing every future agent must decide whether to read.

| Situation | Do this |
|---|---|
| A fact about how the code works | Put it in the code, or in the subtree's own `AGENTS.md` |
| A one-off answer to a question | Answer it. Do not write a file. |
| Something learned that will bite again | One line in the track's `traps.md`, anchored to a `path:line` |
| Work spanning three or more sessions with carried state | Open a track: §3 |
| A permanent contract others code against | A reference doc: `docs/reference/<subsystem>/` |
| A measurement, an audit, a "what is true right now" | `research/` in the track, or `docs/explorations/`. Dated, frozen, never maintained |
| A proposal nobody has written code from | Do not create it. It is archive within a fortnight |

## 2. Frontmatter: every doc under the docs root carries it

```yaml
id:            # REQUIRED. unique kebab-case slug; the linter refuses a duplicate
kind:          # REQUIRED. track | plan | handoff | traps | reference | research | exploration | index | design
status:        # REQUIRED. open | frozen | complete   (complete needs a receipt only close-phase.js writes)
read_when:     # REQUIRED. ONE line: the trigger phrase that should make someone open this file
paths:         # globs this doc governs
verify:        # the command that checks this doc's claims; it must exist in this repo
last_verified: # date; drives a WARN, never a block
max_age_days:  # staleness threshold for last_verified
blocked_on:    # e.g. "user": surfaces the doc in the index as waiting on a decision
trap_prefix:   # e.g. AH: required wherever traps exist; ids are then AH-01, AH-02
fires_when:    # trigger condition for a conditional doc
source:        # any value containing "external" requires an UNTRUSTED banner in the body
first_commit:  # plan docs: the subject line of the commit the phase produces
phase_next:    # handoff docs: the phase the block hands over
```

**`read_when` is the important one.** `docs/INDEX.md` is generated from it by
`scripts/harness/docs-index.js`, and the index is how any agent finds anything. A doc with a vague
`read_when` is a doc nobody opens at the right moment. Write the task, not the topic. The fields
`closed_phase`, `closed_at`, `gates_sha`, `block_sha` and `receipt` are machine-written.

## 3. Shapes

**A track** is a folder under `project.tracksDir` (default `docs/tracks/<id>/`):

| File | Holds |
|---|---|
| `README.md` | current truth: what this is, locked decisions and why, invariants, "How to work", state |
| `plan.md` | the phases, each naming its `first_commit` and its exit command |
| `traps.md` | one line per trap, `**<PREFIX>-nn** ...`, each anchored to a path that resolves today |
| `handoff.md` | exactly ONE ▶ block: what the next session does. Replaced wholesale, never appended |
| `research/<date>-<slug>.md` | dated frozen evidence. Findings, not instructions |

**A reference doc** is `docs/reference/<subsystem>/`, one file per concern, each named for the
TASK rather than the topic, with a `README.md` that routes between them. A file named
`NN-slug.md` is routed by its folder's `README.md`; the index lists entry points, not parts.

**Everything else** is `docs/archive/` (closed work: no instruction there, nothing routes to it)
or `docs/explorations/` (dated audits, same rule).

## 4. The caps, and why they are hard

The numbers live in `docs.caps` in `harness.config.json`. Defaults: root `AGENTS.md` 80 lines,
its `CLAUDE.md` stub 5, a subtree `AGENTS.md` 50, every other doc 150. An exact path key overrides the
default for that one file. Exempt: every directory in `docs.exemptDirs`, and any `research` or
`exploration` doc; those are history, not carried context. Listing a directory there also lifts
the figure rule and the `§N` check of §5; a listed tracks directory keeps the ▶, link and trap rules.

They are hard failures because the prose versions of the same limits were violated over and
over: a limit nobody enforces records what happened. Over the cap means the doc is doing two
jobs. Split it with `node scripts/harness/split-doc.js <file.md> --out <dir>`, which runs
`git mv` first and asserts the multiset of non-blank lines is preserved, so no line is lost.

## 5. The rules the linter enforces

Hard failures. Each exits 1 and reds the `docs` gate:

- **The caps** of §4.
- **Frontmatter**: the four required fields, the two enums, a unique `id`.
- **No gate figure in prose.** A pair matching `\d{2,4}/\d{2,4}` outside a code span fails.
  `node scripts/harness/gates.js --check` is the only way to read one. For a figure that is
  historical or not a gate figure, tag the file `<!-- figure-ok: <reason> -->`; a bare tag or a reason of a few characters does not count.
- **No bare `trap #n`** where the doc declares a `trap_prefix`.
- **One ▶ block per track, in `handoff.md`.** Two "what next" blocks means the wrong one is read.
- **Every relative `.md` link and every `§N` reference resolves**: in the doc, in its folder, or
  in the folder of the doc it names. This stops a split orphaning a pointer.
- **Every `traps.md` line cites a path that resolves.** A trap nobody can check is a rumour.
- **Frozen evidence is frozen.** A `research` or `exploration` body that differs from its
  committed version fails; only frontmatter may change. Correct a finding with a new dated file.
- **`status: complete` needs a receipt** that recomputes from `closed_phase`, `gates_sha` and
  `block_sha`. The linter imports the formula from `close-phase.js`, so a typed receipt fails.
- **`source: external` needs a `⚠ UNTRUSTED` banner in the body.** Quoted outside text is data.
- **Every rule must have run.** The gate tallies rule applications: a deleted rule is named.

Warnings, exit 0, deliberately. **Staleness**: an expired `last_verified` never blocks, because
blocking on a date gets a doc re-dated instead of re-verified. A plan whose `first_commit` is not
in `git log`. Slop on added lines (an em-dash, a filler word such as `delve`). An over-long line
in the auto-memory index, which lives outside the repo: `docs-lint.cjs --memory-check` reports it
at session start and it never moves the gate figure.

The write-time half is `scripts/harness/guards/phase-guard.cjs`: it denies a gate figure, a hand-flipped
`status:`, a typed receipt and a bare archive move, sharing `doc-frozen.cjs` with the linter.

## 6. Closing a phase

1. Finish the last source edit. A later edit under a watched tree makes the verdict stale.
2. Rewrite the track folder to current truth: `README.md` state, `plan.md`, `traps.md`.
3. Replace `handoff.md` wholesale for a cold session (§7).
4. Commit when asked, then `node scripts/harness/gates.js --check`: the verdict must be recorded
   at HEAD on a clean tree, so uncommitted work cannot close.
5. `node scripts/harness/close-phase.js <track-id>`. It refuses unless the verdict is at HEAD,
   clean-tree, green and not stale; hygiene is clean; `handoff-lint` passes; and the ▶ block
   changed since the last receipt. Then it writes the receipt into the track README.
6. `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.

`close-phase.js <track-id> --archive` closes a whole track and is the only route into
`docs/archive/`. This section is the single copy of the order; other docs point here.

## 7. What a handoff block must contain

Written for a session with **no memory of yours**. Six things, or the next phase re-derives it all:

1. **What to read, in order**: a `Read` line and repo paths that resolve, nothing more.
2. **The scope**: one `SCOPE:` line naming what is in and what is out.
3. **What NOT to do**: "Do NOT re-measure X, it is in `research/...`". Re-deriving is the default.
4. **Inherited state**: what landed, what is uncommitted, what is owed to the user, and a line
   citing `gates.json` or `gates.baseline.json` as where a figure may come from.
5. **The exit command**, verbatim on an `Exit:` line, and a `First commit:` subject line.
6. **A pointer to "How to work"** in the track's README, the standing rule for the track.

**The integer rule.** Every standalone integer of 10 or more in the block sits on a line that
also carries a `path:line`, a prefixed trap id, or `gates.json`. Otherwise nobody can check it,
which is how a stale figure becomes a false regression two phases later. Dates, versions and
names carrying digits are not claims. Exit-coded: `node scripts/harness/handoff-lint.js <id>`.
