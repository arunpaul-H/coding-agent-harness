---
id: branches
kind: reference
status: open
read_when: "cutting, reviving or syncing a long-lived branch, or changing any harness file"
paths: ["scripts/harness/common.json", "scripts/harness/branch-sync.js", "harness.config.json"]
verify: "node scripts/harness/branch-sync.js --self-test && node scripts/harness/branch-sync.js"
last_verified: 2026-10-05
max_age_days: 90
---

# Branches, and the one harness they all run

## The model

- One branch is the **source** of the harness: the repo's default branch. Every other branch,
  a release line, a long-lived fork, a spike kept alive for months, runs the SAME harness (guards,
  hooks, agents, skills, the gate runner, the doc contract) and says what it is in a handful of
  per-branch files.
- `scripts/harness/common.json` lists what is common. `scripts/harness/branch-sync.js` compares a
  branch against it: one check per manifest entry, plus one for the manifest itself.
- **Harness files change on the source branch first.** A branch never edits a common file in
  place; it pulls the change. `branch-sync.js --check` is red on a branch whose common files differ
  from the source's, and a SessionStart hook says so at the top of every session opened on it.
  This repo wires the hook only; a repo with long-lived branches registers `--check` as a gate.

A follower reads the manifest **from the source ref**, not from its own tree. That is the
load-bearing property: without it, the one file that decides what gets compared is the one file a
branch can edit to be compared less, and the first branch under deadline pressure deletes the entry
that is in its way.

## Why, concretely

Nothing drifts on purpose. A branch is cut, it carries the harness of that day, and then the source
gains a guard, a gate and three agents while the branch gains none of them. In the harness this one
was ported from, two such branches were measured long after they were cut: both were missing every
file under `scripts/harness/`, the doc contract, the agents and the skills, and both still wired
helpers the source had deleted. Nothing had noticed, because nothing compared them. Work done on
those branches was reviewed by a weaker harness than anyone believed was running.

The failure is quiet in both directions. A branch that never receives a new guard is unguarded; a
branch that keeps a deleted helper goes on loading it. Only a comparison catches either.

## Which branch is the source

Detected, never assumed to be `main`: a public repo may use `master`, `trunk` or anything else, and
a hard-coded name would make this script red on arrival. In order:

1. `--ref <ref>`, or `BRANCH_SYNC_REF`: an operator trying a harness change that is still on a
   feature branch, and the recommended shape for CI, which should pin the ref it compares against.
2. `project.sourceBranch` in `harness.config.json`: the repo states it.
3. `git symbolic-ref refs/remotes/origin/HEAD`: what the remote publishes. A clone written by
   `git init` has none; `git remote set-head origin -a` repairs it.
4. The first of `main`, `master`, `trunk`, `default` that exists as a ref. This is the documented
   fallback and it is reported **as** a fallback, so a guess is never read as a setting.

With none of those resolvable (a clone that fetched one branch and no remote, or a repo with no
commits yet) every check is SKIPPED and declared. Never green: a comparison that could not run is
not a comparison that passed.

## What is common, and what each branch owns

| Common: identical to the source, compared byte for byte | Per-branch: authored on each branch |
|---|---|
| `.claude/helpers/`, `.claude/agents/`, the three skills | `AGENTS.md` §1 "What this is"; the rest of that file is common |
| `.claude/settings.json`, `CLAUDE.md` (the import stub), `skills-lock.json` | `harness.config.json`: the gate registry and every project-specific setting |
| `scripts/harness/`, except its per-branch files | `scripts/harness/context-budget.json`: this branch's context ceilings |
| `tests/`, `schema/`, `templates/`, `.github/workflows/ci.yml`, `.gitattributes` | `scripts/harness/gates.baseline.json`, `harness-baseline.json`: measured here |
| `docs/reference/DOC-STANDARD.md`, `docs/reference/skill-safety/`, `docs/reference/routing/`, this folder | every subtree `AGENTS.md`, and all of `docs/` outside the listed contract files |
| | `.gitignore` and `package.json`: only their EFFECT is checked |

A path listed nowhere in the manifest is per-branch by default and is not checked at all. Only a
`perBranch` entry buys an existence check, which is what you want for a file every branch must have
one of its own.

### The entry kinds

- `files`: compared whole.
- `dirs`: mirrored exactly: the same file set AND every file byte-identical. A file the source no
  longer has is drift too, which is how a deleted harness helper stops lingering on an old branch.
- `perBranch`: deliberately not compared; only existence is checked.
- `sections`: compared with one named `## ` section masked, so a branch can say what it is in one
  section of `AGENTS.md` while the rest of the file stays common. `except` is a heading prefix, so
  `## 1.` does not match `## 10.`.
- `ignore`: `.gitignore` is per-branch and its order matters, so its EFFECT is probed with
  `git check-ignore --no-index` over `mustTrack` and `mustIgnore`. `--no-index` asks what the rules
  say rather than what the index happens to hold: the question is what a fresh clone would carry.
- `packageScripts`: `package.json` is per-branch; the named npm scripts must read exactly this.

Comparison is by **git blob id**, computed through `git hash-object`, so `.gitattributes` line-ending
normalisation applies and a CRLF checkout of an LF blob is not drift. That is also why
`.gitattributes` is itself a common file: without the `text` attribute it declares, a Windows
checkout can read as drift everywhere at once.

## Change a harness file

1. Make the change on the source branch, with its gate suite green, and commit it there.
2. On each other branch run `node scripts/harness/branch-sync.js --apply`. It writes the source's
   version of every drifted path, deletes files the source no longer carries from the common
   directories, keeps the branch's own `AGENTS.md` §1, and lists as OWED whatever it will not do.
3. Review `git diff`, run the gate suite, and commit with explicit paths. A change that moves a gate
   total is a re-baseline on that branch too.

`--apply` does not stage, commit or run the gates. The point of pulling a harness change is that
someone reads the diff it makes, and a script that commits for you removes the only step where that
happens.

A fix found on a branch is written on the source first and then pulled, never the other way round: a
branch-local edit to a common file is exactly what the check reds on.

## Cut a new branch

Cut from the source and the branch starts identical, so there is nothing to sync. Before its first
commit: rewrite `AGENTS.md` §1 to say what the branch is; adjust `harness.config.json` if its gate
registry differs; give every new subtree `AGENTS.md` a ceiling in `context-budget.json`; then run the
suite and accept a baseline under a `gates:` subject.

## Revive a branch from an older ref

A branch cut from a tag or an old commit predates the harness. Bootstrap it from the source:

```bash
git checkout main -- scripts/harness/branch-sync.js scripts/harness/common.json
node scripts/harness/branch-sync.js --apply
```

(Substitute the source branch name if this repo's default is not `main`.) Then do what `--apply`
cannot: the per-branch files above, a `GATE <name> pass= fail= skipped=` last line in every check
script the gate registry names, the `.gitignore` stanzas a failing probe names, and the branch's own
docs moved onto the contract in `DOC-STANDARD.md`.

## Traps

- **`--apply` never edits `.gitignore`.** Last-match-wins ordering and directory exclusions make a
  scripted merge unsafe, so the stanza a failing probe names is ported by hand.
- **The local source branch can be stale.** The checker compares against whichever of `<name>` and
  `origin/<name>` is newer, preferring the local one when they have diverged, because that is what
  this machine's next commit on the source will be made against. `--ref` overrides it.
- **A branch can point `project.sourceBranch` at itself** and land in source mode, where nothing is
  compared. Two things make that visible: a disagreement with the remote's published default branch
  fails the manifest check outright, and every report names the mode, the branch and how the source
  was chosen. CI should pin the ref rather than trust a tracked file.
- **A worktree may be checked by the wrong tree.** Hooks resolve the session's project directory,
  not the worktree a command runs in. Run the checks inside the worktree yourself before committing
  from one.
- **The check count is structural**, the same in both modes and with no source ref at all, so a
  baseline holds across branches. Anything that changes the count without a manifest change is a
  bug: the gate runner reads it as a check that vanished.
