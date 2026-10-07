---
id: project-reference
kind: track
status: open
read_when: "changing how an adopter gets a project reference doc, the reference template, or the check that a doc has drifted from the files it governs"
trap_prefix: REF
paths: ["bin/harness.js", "templates/reference/**", "scripts/harness/guards/docs-lint.cjs", "tests/cli.test.js", "docs/reference/DOC-STANDARD.md"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js project-reference"
last_verified: 2026-10-07
max_age_days: 30
closed_phase: 1
closed_at: 2026-10-07
gates_sha: 4bfc4c652f12c47096b61c37b35595a0102e6b64040c24038f4c05feae238651
block_sha: bce45fea36e89e9dd813c1a975b418a4ff246d7fa2851c4867aed27ae5efea1d
receipt: 747715444ebfc263c2cb0f908868e0d238701e543db7af8efac4e76fc2193729
---

# Project reference docs: asked for by name, and never stale in silence

> ### Read which section, do not read it whole.
> | Your task | Read |
> |---|---|
> | Starting or resuming a phase | `handoff.md`, then **State** below |
> | Something behaves oddly | `traps.md` first |
> | Why the scope is this and not more | **Locked decisions** |
> | What must not move | **Invariants** |
> | The phases and their exit commands | `plan.md` |

> **Self-evolving tracker. Current truth only, not a changelog.** Rewrite in place when a phase
> lands. A cold session reads THIS plus `handoff.md` and continues with no memory of the last one.

## What this is

An adopter who installs the harness gets no reference doc about their own project: `init` renders
only the routing doc and copies `templates/track/`. Every session therefore re-reads code to learn
facts that never change. This track ships the smallest mechanism that fixes that: a reference
template, a command that scaffolds ONE doc for a subsystem the user names, and a warning when the
files a doc governs have changed since it was last verified. Evidence:
`research/2026-10-07-project-reference-docs.md`.

It deliberately does NOT generate doc content from code, does NOT create a fixed list of docs
(architecture, backend, admin, hosting, legal, data-model), and adds no prompt to `init`.

## Locked decisions

1. **Opt-in, one subsystem at a time, named by the user.** Owner, 2026-10-07: reference docs are
   created with the user's permission and only where they help. A typed command IS the permission.
2. **No blanket stubs and no fixed list.** An empty doc still gets a live row in the generated
   index and invites a read of nothing (research part 1). A CLI has no admin or hosting surface.
3. **The harness scaffolds the shape; a person supplies the content.** Lead, from research part 3:
   the one controlled study found machine-written context files raise cost with no gain in
   success, and code overviews did not speed file-finding. A doc holds what the code cannot say:
   invariants and their reasons, decisions, what runs where, outside constraints.
4. **`read_when` and `paths` are required at creation.** A scaffold without them is the empty row
   of decision 2, and the drift check of phase 2 has nothing to compare.
5. **Drift is a warning, never a red.** A block is cleared by re-dating the doc unread, which
   turns a verified claim into an unverified one (`docs/reference/DOC-STANDARD.md` §5).
6. **No drafting skill in this track.** A skill that summarises code is the measured-cost case of
   decision 3, and its approval step is prose a model can skip. An interview skill may be
   reconsidered after phase 3; that is blocked on the owner.

## Invariants

1. `harness init` writes no file under `<docsRoot>/reference/` other than the routing doc.
2. `harness reference new` never overwrites an existing file and writes exactly one file.
3. Zero dependencies and no interactive input: every choice is a flag, as in the rest of the CLI.
4. A doc that fails nothing today fails nothing after phase 2; the new checks only warn.
5. Every new decision path keeps a `--self-test` case and a test under `tests/`.

## State

| Phase | What it delivers | Status |
|---|---|---|
| 0 | The track opened: research frozen, plan and handoff written | closed |
| 1 | `templates/reference/README.md` and `harness reference new <subsystem>` | closed |
| 2 | A paths-against-history drift warning, and a warning for an unreadable date | built |
| 3 | One measured task with and without a reference doc, and the adopter guidance it supports | open |

Branch `project-reference`, commits only: no push, no PR. `harness reference new` and its template
are in the tree, and the doc gate now warns when a commit touches an open doc's `paths` after its
`last_verified` day, or when that date does not parse. Both warn and exit 0. This repo's own docs
draw drift warnings and were left as they are: re-verifying them is the owner's call, not a re-date.
No reference doc was created in this repo.

## How to work

One phase per session. Start from `handoff.md`, read only what its `Read` list names, do the
phase, run its `Exit:` command in the foreground and paste the output. Then rewrite this file to
current truth, replace `handoff.md` wholesale, and close with
`node scripts/harness/close-phase.js project-reference`. A phase that cannot close says so and stops.

The research agent had no shell. Check any line number from the research file against the tree
before you rely on it, and cite a symbol where one exists (REF-06).
