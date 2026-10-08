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
| **REF-01** | `verify` is read by no script: the standard calls it advisory, and a wrong one reds nothing. `paths` is read by the drift warning only, and only on an open doc outside the exempt directories. | `scripts/harness/guards/docs-lint.cjs` |
| **REF-02** | A `last_verified` that does not parse is never stale and never drifted; since phase 2 it draws one warning saying so, and nothing more. Write a real date at creation. | `scripts/harness/guards/docs-lint.cjs:241` |
| **REF-03** | The doc gate total is self-test decisions plus rule applications. A warning is not counted; a new self-test case is, so adding one moves the total. A rise is not red, only a drop is, but the plan still asks for a `gates:` re-baseline commit. | `scripts/harness/guards/docs-lint.cjs:1041` |
| **REF-04** | Any new doc under the docs root fails the index check until the index is regenerated, and a doc with an empty `read_when` still gets a live row. Regenerate with the script, never by hand. | `scripts/harness/docs-index.js` |
| **REF-05** | A shipped template is enumerated by hand in several places, and missing one reds a self-test far from the edit: the list beside `TRACK_TEMPLATES`, the copy line in the plan builder, the export line, the help and usage text, the self-test's fake package and its absent-piece assertion, and the installed-files list in the CLI test. | `bin/harness.js:89` |
| **REF-06** | The research file was written by an agent with no shell and its `commit_at` was taken from a session snapshot. Its line numbers were spot-checked, not all of them. Verify a line before citing it. | `docs/tracks/project-reference/research/2026-10-07-project-reference-docs.md` |
| **REF-07** | Templates sit outside the doc linter's sweep, so a template that would fail the linter once rendered is caught by nothing until an adopter runs it. Lint the RENDERED file in a test. | `tests/cli.test.js` |
| **REF-08** | The shared frontmatter reader strips one quote from each end of a value and knows no escape. Anything that writes a quoted field must refuse a double quote inside it, or the index shows a line nobody typed. | `scripts/harness/guards/doc-frozen.cjs:73` |
| **REF-09** | On a machine with no auto-memory index the doc gate reports one skip, and the suite is red unless the run tolerates it: `--allow-skip docs=1,reproducible-build=1`. The committed baseline already records that skip; `close-phase.js` prints the exact command. | `scripts/harness/gates.baseline.json` |
| **REF-10** | The `test` gate outlasts a ten-minute foreground limit on Windows, so a full run is moved to the background and its verdict arrives later. Do not edit the tree while it runs: the verdict is recorded against a dirty tree and cannot close a phase. A background run can also be killed when the machine is short of memory, leaving no verdict and two test files marked failed that are not. | `scripts/harness/gates.js` |
| **REF-11** | The template copy of the doc standard sits AT its line cap, one line longer than the repo copy, and its frontmatter date is a placeholder, so a fresh install now draws the not-a-date warning until someone dates it. Any edit there must trade lines. | `templates/docs/reference/DOC-STANDARD.md:8` |
| **REF-12** | The frontmatter reader does not match a line ending in a carriage return, so a doc checked out with CRLF reads as having no fields. A test that clones must set `core.autocrlf=false`. | `scripts/harness/guards/doc-frozen.cjs:68` |
| **REF-13** | A doc written for a measurement reds the index check twice, on creation and on deletion, and an agent told to cite a file and line reads the code whether or not a doc exists. Measure a task that the doc alone can answer, or expect the doc to save little. | `docs/tracks/project-reference/research/2026-10-08-one-task-with-and-without-a-reference-doc.md` |
