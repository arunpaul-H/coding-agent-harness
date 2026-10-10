---
id: claude-code-uptake-traps
kind: traps
status: open
read_when: "something behaves oddly while working on claude-code-uptake"
trap_prefix: CU
---

# Claude Code uptake: durable traps

Every one of these was measured while doing this track's work. A trap here is a thing that will
cost an hour again if it is not read first.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| CU-01 | The spawn guard wants each of the four field names followed at once by a colon. `READ-SET (repo):` and `RETURN (fields):` were both refused as missing, and the whole spawn was denied. Put the qualifier after the colon. | `scripts/harness/hook.js` |
| CU-03 | `$.process.run` stops a command at ten minutes at most, by the vendor's reference page, and this repo's `test` gate alone runs about that long. `/gates` therefore answers NOT RUN here. `$.process.spawn` streams a long command; its signature is in the types the tool writes into a mod's `.claude-plugin/types/` on an interactive `--plugin-dir` load, and was not on any page read. | `.claude/plugins/harness/hooks/register.js` |
| CU-04 | A mod's work that nothing awaits cannot be waited for in `claude plugin test`. Start it with `$.clock.after(0, fn)`: the kit's `mock.clock(on)` then runs it on `clock.settle()`. A mod that calls `$.clock` with no mock clock fails with `no implementation for clock.after`. | `.claude/plugins/harness/tests/harness.test.ts` |
| CU-05 | `"optional": true` in `harness.config.json` is a counted waiver. It is credited as described only when `"_readme"` sits within 400 characters before it, so the key goes directly under a short `_readme`. A new one reds `carveouts` until the census is re-recorded on a clean tree. | `scripts/harness/carveouts.js` |
| CU-06 | `session.compact` can only pass a compaction on or skip it, so a line under the answer is returned by the `turn.complete` that follows. Its hook is listed by `claude plugin validate` as a gating hook: it carries a `.catch` that passes the event on. In a test the event's input and its stub's answer both need a `messages` list with at least one entry. | `.claude/plugins/harness/hooks/register.js` |
| CU-07 | `claude plugin validate` refuses a `.catch` handler that is not a function literal or the NAME of one: a handler returned by a call fails the load. It also prints a matcher built at run time as `tool=?`, so write the matcher as a literal. In `claude plugin test` a stub for `agent.spawn` must return `{ model }` or `{ deny }`, and `$.ui.ask` reaches the test as a `tool.call` for `AskUserQuestion`, the same event the mod guards. | `.claude/plugins/harness-guard/hooks/register.js` |
| CU-08 | The guard mod runs `scripts/harness/hook.js` by a path relative to the session's folder and fails closed. A session started below the repo root has every guarded call refused, with the fix in the reason. A shell command that merely NAMES the guarded secret file is refused too, by both hearings: put such a prompt in a file and pipe it. | `.claude/plugins/harness-guard/hooks/register.js` |
| CU-02 | The vendor changelog page is over a million characters. One fetch returned a single week, 2.1.288 to 2.1.296, and reported the rest unread. A claim about an older release needs a fetch with an offset, or the GitHub file. | `docs/tracks/claude-code-uptake/research/2026-10-09-claude-code-releases.md` |
