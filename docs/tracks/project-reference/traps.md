---
id: project-reference-traps
kind: traps
status: open
read_when: "something behaves oddly while working on project-reference"
trap_prefix: REF
---

# Project reference docs: durable traps

Found while opening this track or while building a phase of it. A trap here is a thing that will cost an
hour again if it is not read first.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| **REF-01** | The frontmatter fields `paths` and `verify` are read by no script. The standard says a `verify` command "must exist in this repo"; nothing checks it. Do not design on the belief that a wrong `verify` reds a gate: it does not. | `scripts/harness/guards/docs-lint.cjs` |
| **REF-02** | The staleness warning compares `Date.parse(last_verified)` with the clock. An unfilled date token parses to NaN, the comparison is false, and nothing prints: a scaffold with a placeholder date is silent for ever. Write a real date at creation. | `scripts/harness/guards/docs-lint.cjs:581` |
| **REF-03** | The doc gate counts rule applications, so a new counted rule changes its total and the suite reds against the baseline until a re-baseline commit whose subject starts `gates:`. A warning may not be counted; check before assuming either way. | `scripts/harness/gates.baseline.json` |
| **REF-04** | Any new doc under the docs root fails the index check until the index is regenerated, and a doc with an empty `read_when` still gets a live row. Regenerate with the script, never by hand. | `scripts/harness/docs-index.js` |
| **REF-05** | A shipped template is enumerated by hand in several places, and missing one reds a self-test far from the edit: the list beside `TRACK_TEMPLATES`, the copy line in the plan builder, the export line, the help and usage text, the self-test's fake package and its absent-piece assertion, and the installed-files list in the CLI test. | `bin/harness.js:89` |
| **REF-06** | The research file was written by an agent with no shell and its `commit_at` was taken from a session snapshot. Its line numbers were spot-checked, not all of them. Verify a line before citing it. | `docs/tracks/project-reference/research/2026-10-07-project-reference-docs.md` |
| **REF-07** | Templates sit outside the doc linter's sweep, so a template that would fail the linter once rendered is caught by nothing until an adopter runs it. Lint the RENDERED file in a test. | `tests/cli.test.js` |
| **REF-08** | The shared frontmatter reader strips one quote from each end of a value and knows no escape. Anything that writes a quoted field must refuse a double quote inside it, or the index shows a line nobody typed. | `scripts/harness/guards/doc-frozen.cjs:73` |
| **REF-09** | On a machine with no auto-memory index the doc gate reports one skip, and the suite is red unless the run tolerates it: `--allow-skip docs=1,reproducible-build=1`. The committed baseline already records that skip; `close-phase.js` prints the exact command. | `scripts/harness/gates.baseline.json` |
| **REF-10** | The `test` gate outlasts a ten-minute foreground limit on Windows, so a full run is moved to the background and its verdict arrives later. Do not edit the tree while it runs: the verdict is recorded against a dirty tree and cannot close a phase. | `scripts/harness/gates.js` |
