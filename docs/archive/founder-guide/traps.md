---
id: founder-guide-traps
kind: traps
status: open
read_when: "something behaves oddly while working on founder-guide, or before editing a file another track claims"
trap_prefix: FG
---

# Non-tech guide: durable traps

Every one of these was measured while planning this track or in the session that planned it. A
trap here is a thing that will cost an hour again if it is not read first.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| FG-01 | The `multi-tool` track's `paths:` claims `.claude/**`, `bin/harness.js`, `scripts/harness/**`, `tests/**` and `docs/methods/**`, and its next phase rewrites `buildPlan` and renders the shipped skills into a second directory. An edit here beyond the lines `plan.md` names lands in the middle of that rewrite. Keep phase 2 to the constant, the file list and one test. | `docs/tracks/multi-tool/README.md` |
| FG-02 | A skill added to `SHIPPED_SKILLS` and left out of `package.json` `files` reds nothing in a checkout, because a checkout install copies from disk. Only a packed install fails, and it fails whole: `init` stops and writes nothing. Until the phase 2 test exists, both edits are made together by hand. | `bin/harness.js` |
| FG-03 | A test that is green on your machine can be red in CI on the other Node version. On 2026-10-07 one fixture passed on Node 22 and 24 and failed on Node 20, which prints a filtered-out test as a skipped `ok` line. A test that spawns `node` also runs whatever `node` is first on PATH, not the one running the suite. Run both versions before pushing. | `tests/lifecycle.test.js` |
| FG-04 | The `autonomy-modes` track claims the root `README.md` for an audience statement it has not written yet. A start-here section that says who the repo is for can contradict it before it exists. Leave that statement room. | `docs/archive/autonomy-modes/README.md` |
| FG-05 | A skill with `context: fork` runs in the background as a subagent and cannot ask the person a question. A guide written that way would talk to nobody. Both forked skills say so in their own bodies. | `.claude/skills/research/SKILL.md` |
| FG-06 | The root `README.md` is the human front door and is outside every doc-lint rule, so a broken link or a diagram that does not draw there reds nothing. A Mermaid block is drawn by the browser on GitHub only. The check is a person looking at the page. | `scripts/harness/guards/docs-lint.cjs` |
