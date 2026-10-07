---
id: method-13-one-harness-on-every-branch
kind: reference
status: open
read_when: "asking why a long-lived branch is compared against the default branch, or what that comparison misses"
paths: ["scripts/harness/branch-sync.js", "scripts/harness/common.json", "docs/reference/branches/**"]
verify: "node scripts/harness/branch-sync.js --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# One harness on every branch

## The failure

- **A branch runs the harness of the day it was cut.** A release line, a long-lived fork, a spike
  kept alive for months. The default branch gains a guard and a gate; the branch gains neither.
- **Quiet in both directions.** A branch that never received a new guard is unguarded. A branch
  that kept a helper the default branch deleted goes on loading it.
- **Nothing compared them.** Work on those branches was reviewed by a weaker harness than anyone
  believed was running, and no check was red.
- **A manifest the branch can edit.** If the list of what must match lives on the branch under
  test, the first branch under deadline pressure deletes the entry that is in its way.
- **A hard-coded branch name.** A comparison that assumes `main` is red on arrival in every repo
  that calls its default branch something else.
- **A comparison that could not run, read as one that passed.** A clone that fetched one branch
  has nothing to compare against.
- **Line-ending churn read as drift.** A byte comparison of working files flags every file on a
  machine with a different checkout convention.

## The mechanism

`scripts/harness/common.json` is the manifest of what every branch shares.
`scripts/harness/branch-sync.js` compares a branch against it. The operating procedure is
`docs/reference/branches/README.md`; this doc is the why.

| Manifest key | Compared how |
|---|---|
| `files` | whole, byte for byte |
| `dirs` | mirrored: the same file set, every file identical. A file the source dropped is drift too |
| `perBranch` | not compared. Only existence is checked |
| `sections` | compared with one named `## ` section masked, so a branch can say what it is |
| `ignore` | the EFFECT is probed through git: these paths must be tracked, these must be ignored |
| `packageScripts` | only the listed npm scripts must read exactly as written |

| Command | Does |
|---|---|
| `node scripts/harness/branch-sync.js` | the report, GATE line last |
| `... --check` | the same as a gate: exit 1 on drift |
| `... --apply` | writes the source's version of every drifted path. Review the diff, run the suite, commit |
| `... --hook` | SessionStart: silent unless drifted, always exits 0 |
| `... --ref <ref>` | compare against that ref (or env `BRANCH_SYNC_REF`) |

- **Two modes, chosen by the checkout.** On the source branch the manifest is validated against
  the tree: every listed path exists, every probe holds. On any other branch every common path
  must match the source.
- **A follower reads the manifest from the source ref**, never from its own tree. That one
  property is load-bearing: a branch cannot exempt itself by editing its own copy.
- **The source branch is detected, in order:** `--ref` or the env variable; `project.sourceBranch`
  in the config; what the remote publishes as its head; then the first of a short list of
  conventional names, reported AS a fallback so a guess is not read as a setting.
- **Unresolvable means skipped and declared.** Every check reports a skip. Never green.
- **The check count is structural**: one per manifest entry plus one for the manifest, the same
  in both modes, so a baseline recorded on one branch holds on another.
- **Content is hashed through git**, so the checkout's line-ending convention cannot read as drift.
- **Harness changes land on the source branch first.** Adding a manifest entry on a follower is
  the one edit the comparison is guaranteed not to see.

## Why a mechanism and not a rule

- "Keep the branches' tooling in step" has no moment at which it fails. Nobody drifts on
  purpose; the default branch simply moves. A comparison has a moment: every session start on a
  drifted branch, and every gate run.
- "Merge the default branch regularly" is the wrong rule for a branch that is never meant to
  merge. The manifest separates what must match from what a branch owns, which a merge cannot.
- "Do not edit the shared files on a branch" is unenforceable while the branch owns the list.
  Reading the manifest from the source ref turns the rule into a property of the comparison.

## The cost and the limits

- **It is wired as a report here, not as a gate.** The SessionStart hook ships in
  `.claude/settings.json`. This repo's `gates` registry does not list `branch-sync`; a repo with
  long-lived branches adds `{ "name": "branch-sync", "command": "node scripts/harness/branch-sync.js --check" }`.
- **A repo with one branch gets little.** In source mode the script validates its own manifest
  and compares nothing. The mechanism pays only once a second long-lived branch exists.
- **An installed copy starts with this package's manifest.** `harness init` copies `common.json`
  as it stands, and it lists paths this repo has and yours may not. Rewrite it to what your
  branches share before you register the gate: until then source mode fails each absent path.
- **Before the first commit there is no source.** With no ref to resolve, every check is a
  declared skip; the first commit on a conventionally named branch turns them into checks.
- **It needs the source ref.** A CI job that fetches one branch skips every check. Fetch the
  source and pin it with `--ref`, or tolerate the skip visibly with `--allow-skip`.
- **A branch can name itself the source** through the config key and land in source mode, where
  nothing is compared. The script reports a disagreement with the remote's published head; it
  cannot stop a repo with no remote from doing it.
- **Only listed paths are compared.** A path named nowhere in the manifest is per-branch by
  default and unchecked. A new harness file is unprotected until someone lists it.
- **Identical bytes, not correct behaviour.** A follower matching a broken source is green.
- **`--apply` overwrites.** A local fix made on a follower is lost unless it went to the source
  first. That is the rule working, and it is unwelcome the first time.
- **A masked section is unchecked entirely.** Anything written under that heading passes.
- **Cost:** a handful of git calls per session start and per gate run. No network: it compares
  against refs already fetched, so it is as current as the last fetch.
