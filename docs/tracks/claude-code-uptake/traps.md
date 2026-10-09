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
| CU-02 | The vendor changelog page is over a million characters. One fetch returned a single week, 2.1.288 to 2.1.296, and reported the rest unread. A claim about an older release needs a fetch with an offset, or the GitHub file. | `docs/tracks/claude-code-uptake/research/2026-10-09-claude-code-releases.md` |
