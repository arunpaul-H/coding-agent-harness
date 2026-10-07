---
id: method-06-the-doc-contract
kind: reference
status: open
read_when: "asking why the doc rules are a linter, or changing what the doc linter enforces"
paths: ["scripts/harness/guards/docs-lint.cjs", "scripts/harness/guards/doc-frozen.cjs", "scripts/harness/split-doc.js", "docs/reference/DOC-STANDARD.md"]
verify: "node scripts/harness/guards/docs-lint.cjs --self-test && node scripts/harness/guards/docs-lint.cjs"
last_verified: 2026-10-05
max_age_days: 90
---

# The doc contract: docs are context, so they are linted like code

## The failure

- **A cap that was prose.** "No doc over N lines" was a house rule. It was broken again and
  again while it was prose, by reasonable additions, and the longest doc became the place
  everything went.
- **A gate figure quoted from a doc two phases stale.** The doc said the suite stood at one
  total. The suite had moved twice since. A session compared a fresh run to the doc and filed a
  regression.
- **A linter wired into nothing.** The doc linter existed, carried the whole contract, and was
  called by no hook, no gate and no close path. The contract was voluntary and the instruction
  file said "enforced".
- **A rule that was dead for weeks.** A pass that strips code spans ran first. Later rules
  keyed on a token inside a code span, so they never matched anything and never failed.
- **A deleted rule that changed nothing.** The gate tallied files swept. Deleting one rule's call
  site left the verdict line byte-identical.
- **An over-enforced rule that bred its own opt-out.** A write guard denied figures in dated
  measurements, where figures are the whole point. The cheap escape was an exemption tag the
  author grants themselves, and a large share of docs soon carried one.
- **A split that lost a line.** Splitting an over-long tracker under deadline dropped a decision,
  and nobody could tell it had ever been made.
- **Proposal docs.** Written, never coded from, archived within a fortnight, read in the meantime
  by agents that took them for instruction.

## The mechanism

`scripts/harness/guards/docs-lint.cjs` is the contract. It runs as the `docs` gate, so it is in every
`gates.js --check` and in CI. `docs/reference/DOC-STANDARD.md` explains the shapes it expects.

| Rule | Hard or warn | What it stops |
|---|---|---|
| Line caps from `docs.caps` | hard | a doc doing two jobs; always-on files growing |
| Frontmatter, enums, unique `id` | hard | a doc the index cannot route to |
| No gate figure in prose | hard | the stale-total regression |
| Prefixed trap ids | hard | `trap #3` meaning two things once a second track exists |
| One ▶ block, only in `handoff.md` | hard | two "what next" blocks |
| Links and section references resolve | hard | a split orphaning a pointer |
| Every trap cites a path that resolves | hard | traps as rumours |
| Frozen evidence body unchanged | hard | a measurement edited to stay current |
| `status: complete` needs a recomputable receipt | hard | completion by assertion |
| External content needs the UNTRUSTED banner | hard | fetched text read as instruction |
| Staleness, unlanded `first_commit`, slop | warn | nothing; they inform |

- **The verdict tallies rule applications**, one per rule per file, plus the self-test's own
  decisions. A deleted rule lowers the total, which the gate runner reds as a vanished check,
  and the missing rule is named in the output.
- **The self-test runs on every invocation.** A linter whose own decisions have regressed has no
  business reporting a clean sweep.
- **Rules that key on a code span read the raw body.** Written into the code as a comment so the
  dead-rule failure is not repeated.
- **`docs/INDEX.md` is generated** by `scripts/harness/docs-index.js` from `read_when`, and
  `--check` proves nobody edited it.
- **`scripts/harness/split-doc.js`** asserts the multiset of non-blank lines is preserved before
  it writes anything, and prints the undo command if not.
- **The write-time twin.** `phase-guard.cjs` denies the same figure, status flip and receipt at
  the tool call, using predicates imported from `doc-frozen.cjs`. Frozen evidence is exempt from
  the figure rule in both, because its figures are the finding.
- **The escape hatch needs a reason.** The figure-ok tag only counts with a reason of real
  length. A bare tag is a reflex; a reason is a decision someone can review.
- **`--grandfather` downgrades the caps and the link checks to warnings** while a split is in
  flight. It is a flag, so it is visible; a phase that leaves it on has not finished.
- **Default: do not write the doc.** The first table in the standard exists to prevent files.

## Why a mechanism and not a rule

- The caps are the plainest case in the repo. The same limits existed as guidance and were
  exceeded many times. As exit codes they hold, and the price is that over-cap work stops until
  the doc is split.
- "The doc contract is enforced" was itself a false prose claim until the linter became a gate.
  Fixing the wording made the claim honest. Wiring the gate made it true. Both were needed, in
  that order, and in separate commits: changing a claim and a mechanism together is how the two
  drift apart.
- Staleness is the deliberate exception. It stays a warning forever, because the cheapest way to
  clear a red staleness check is to re-date the doc, which converts a verified claim into an
  unverified one while the gate turns green.

## The cost and the limits

- **It checks shape, never truth.** A doc with perfect frontmatter, under its cap, with every
  link resolving, can be wrong in every sentence. Nothing here reads for accuracy.
- **Lines are the wrong unit.** A cap in lines does not bound cost; one enormous line passes.
- **The figure rule is a regex.** It catches a digit pair around a slash. The same figure spelled
  "nn of nn" passes. It removes the common form, not the idea.
- **The figure-ok tag is still self-granted.** A reason is required; nobody checks the reason is
  good. Read the tags in review. Most turn out to be legitimate: a date range, a screen tally,
  a dated record.
- **Frozen bodies cannot be fixed.** A wrong measurement is permanent by contract.
- **A receipt recomputes from the fields beside it.** That proves the close script wrote it. It
  does not prove the phase was good ([09](09-the-phase-lifecycle.md)).
- **`read_when` is checked for presence only.** A vague one passes.
- **The slop warning is a blunt list.** It flags an em-dash and a few filler words on added
  lines. It warns; it will never tell you prose is good.
- **Cost:** a tree walk and a handful of git calls, cheap enough to run on every gate run. The
  editorial cost is the real one: at the cap, writing means cutting.
