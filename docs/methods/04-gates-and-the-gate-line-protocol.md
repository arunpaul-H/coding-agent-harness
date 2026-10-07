---
id: method-04-gates-and-the-gate-line-protocol
kind: reference
status: open
read_when: "adding a gate, reading a red verdict, or asking where a pass figure may be quoted from"
paths: ["scripts/harness/gates.js", "scripts/harness/gates.baseline.json", "harness.config.json"]
verify: "node scripts/harness/gates.js --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# Gates, and the GATE line protocol

## The failure

- **Figures in prose drift.** Three docs each quoted the suite's pass total. Each was edited at a
  different time. A fresh run was compared against the stalest of the three and the difference
  was reported as a regression. Hours went on bugs that did not exist. The patch was a rule
  ("this doc wins") that worked only while someone remembered it.
- **Pass-by-absence.** A test file stops being collected, or a check is deleted. Nothing fails.
  The pass count falls, and a comparison that only asks "did anything fail" stays green.
- **The skip that switches off the comparison.** A check that skipped was tallied differently on
  the two sides of the baseline comparison, which quietly disabled the count comparison for that
  whole gate. One skipped check, and the gate could no longer notice checks disappearing.
- **A gate that excuses itself.** The check cannot find its dependency, prints a warning and
  exits 0. It is permanently skipped and permanently green.
- **An absent dependency dressed as regressions.** A backing service was down. The server still
  answered its health check, every route errored, and the comparison gate reported a wall of
  differing cases. A health check is not a dependency check.
- **A runner that turns a crash into a number.** Given a bad argument, a test runner reported
  its own startup failure as one failing test.
- **Silence read as success.** A gate that died before printing anything left no failure to see.

## The mechanism

**The protocol.** The LAST stdout line of every gate is exactly:

```
GATE <name> pass=<n> fail=<n> skipped=<n>
```

`pass + fail + skipped` is the total, and the total is the load-bearing part.

**The runner** is `scripts/harness/gates.js`. The registry is `gates` in `harness.config.json`;
the runner holds no gate list of its own and requires no file from the project it grades.

| Command | Does |
|---|---|
| `node scripts/harness/gates.js` | runs every gate, writes `gates.json` (git-ignored, the last verdict) |
| `... --check` | runs, then compares against the committed `gates.baseline.json` |
| `... --accept` | rewrites the baseline. Refuses on a red suite |
| `... --only a,b` | a subset. A name matching no gate is refused before anything is written |
| `... --allow-skip g=n` | tolerates n skips in gate g, for this invocation only |

**`--check` reds on:** any fail · a non-zero exit with no fails · `pass` below the baseline ·
the total below the baseline total (a check vanished) · any skip not allowed by the caller ·
a baseline gate missing from the run · no GATE line at all · artifacts that do not reproduce.

- **Tolerance lives in the invocation.** A gate may declare a skip. It may not decide the skip
  is acceptable. Only the caller can, with `--allow-skip`, where the decision is visible in the
  command and in CI config. A declared skip goes through one formula on both sides of the
  comparison.
- **An unconfigured check declares itself.** With `artifacts` empty, the reproducible-build check
  prints that it graded nothing and reports `skipped=1`. No green line stands in for it.
- **A re-baseline is its own commit**, subject starting `gates:`, so a moved figure is a diff
  somebody reviewed.
- **A red gate keeps its whole output** in `gates.red.<name>.log` beside `gates.json`.
- **Adapters** (`node-test`, `exit-code`) cover runners that will not print the line. An unknown
  adapter name is a hard error, never a fallback.
- **Wrapping your own check** costs two lines: tally, then print the GATE line last. Count a
  unit that falls when a check is removed. The doc gate tallies rule applications because a
  file count did not move when a rule's call site was deleted.
- **Probe the dependency itself.** A gate that needs a service connects to it and declares a
  skip when it is absent, and does not infer health from a neighbour.
- **A figure lives in two machine-written files and nowhere else:** `gates.json`, the last run,
  and `gates.baseline.json`, the committed record. Prose may not carry one
  ([06](06-the-doc-contract.md)).

## Why a mechanism and not a rule

- "Quote figures only from the latest run" was the rule. The figures were quoted from docs
  anyway, because the doc was open and the run was not. Removing the figure from prose and
  making the comparison a command leaves nothing to quote wrongly.
- "Check the log for skips" was a ritual performed after every run, then after most runs, then
  not. A skip is now red by default.
- "Do not delete tests to get green" cannot be policed by reading diffs at scale. A falling
  total is caught by arithmetic.
- "Re-baseline deliberately" became a flag that refuses on red, plus a commit-subject check in
  `commit-hygiene.cjs` ([12](12-commit-hygiene.md)).

## The cost and the limits

- **A green verdict proves three things only:** the declared checks ran, none failed, and none
  vanished since the baseline. It does not prove any check tests the right property.
- **Counts, not content.** A strong assertion replaced by a weak one keeps the total. A deleted
  check plus an added trivial one keeps the total. The baseline holds integers, not identities.
- **The baseline certifies whatever was accepted.** `--accept` on a suite that is green and
  wrong records wrong. It is a ratchet, not an oracle.
- **A verdict goes stale.** `gates.json` describes the tree it ran against. The runner records
  the commit and a dirty flag but does not stop anyone quoting an old verdict; only
  `close-phase.js` refuses one ([09](09-the-phase-lifecycle.md)).
- **`--allow-skip` can become wallpaper.** A skip allowed in every invocation for months is a
  check that does not exist. Review the allowances as you would the baseline.
- **Timing-sensitive gates flake under load.** Running the whole suite back to back is heavier
  than running one gate alone, and a tight time budget inside a gate will red on a busy machine.
- **Local only until CI runs it.** On one machine this is an honour system with good bookkeeping.
- **Cost:** the wall time of your suite, plus one process per gate. The runner adds nothing
  material. Zero dependencies.
