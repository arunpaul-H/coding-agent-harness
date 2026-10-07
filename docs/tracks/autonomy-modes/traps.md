---
id: autonomy-modes-traps
kind: traps
status: open
read_when: "something behaves oddly while working on autonomy-modes"
trap_prefix: AM
---

# Autonomy modes: durable traps

Every one of these was measured while doing this track's work. A trap here is a thing that will cost
an hour again if it is not read first.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| **AM-01** | RETIRED 2026-10-07: the `multi-tool` track is archived, so nothing else claims this track's files. While it was open its `paths:` claim covered nearly every file here, the root `README.md` included, and an edit to one silently fought a live agent. Check for an open track's `paths:` before editing a shared file. | `docs/archive/multi-tool/README.md` |
| **AM-02** | A new field in the tool registry is never one file. The registry validates rows strictly, so `modes` also needs the validator and its test changed in the same phase. | `scripts/harness/tools.js` |
| **AM-03** | RETIRED 2026-10-07: the tree is committed. While nothing was committed and the whole tree was staged, `git restore`, `git stash`, `git checkout -- <file>` and `git add -A` could each destroy or sweep up another session's uncommitted work with no recovery point. Check `git status` before any of them. | `scripts/harness/close-phase.js` |
| **AM-04** | Line numbers in this repo drift under you while a peer session edits. An audit taken hours earlier had moved by a dozen lines in the config loader. Cite SYMBOLS in docs, verify any `file:line` in the same reply you publish it. | `scripts/harness/config.js` |
| **AM-05** | This runtime exports `CLAUDE_CODE_SESSION_ID`; there is no `CLAUDE_SESSION_ID`. Read the wrong name and the CLI falls back to a worktree-derived identity while the hook uses the payload's real one — so the guard denies the claiming session's own write and calls its own claim a peer's. A derived identity is also shared by every chat in one worktree, which is itself a two-holder bug. | `scripts/harness/peers.js` |
| **AM-06** | A `Stop` hook does **not** make an agent wait for a human. In every tool surveyed it forces MORE turns. Its only honest use is making the agent finish an artifact it owes before the turn may end. Designing an approval pause on it wastes a phase. | `scripts/harness/mode.js` |
| **AM-07** | Bash deny rules match the command STRING, so the same program invoked by a different path, or wrapped in `sh -c`, is not matched. A deny is a shape match on one tool call, never a capability boundary. | `.claude/settings.json` |
| **AM-08** | Hook trust is fingerprinted by some tools — by hook hash, or by name plus command — so a freshly cloned or freshly pulled repo silently runs with its guards skipped until they are re-approved, and nothing announces it. A session-start reporter must ASSERT its guards are live rather than assume it. Read from vendor docs, not run here. | `scripts/harness/guards/phase-guard.cjs` |
| **AM-09** | Never record a waiver census, a context budget or a gate baseline against a half-edited tree. The figure becomes a committed fixture that lies, and every later comparison inherits it. Wait for a whole tree. | `scripts/harness/carveouts.js` |
| **AM-11** | The `carveouts` gate counts MENTIONS of a waiver in the git index, per kind, against a committed census. A doc, test or handoff edit that spells a skip flag, a clear flag or a figure tag moves a total and reds the suite with nothing actually waived. Moving a file does not: only totals are compared. Re-record on a clean, committed tree, and read the per-file map it prints before accepting. | `scripts/harness/carveouts.js` |
| **AM-12** | Three of the four run-mode gates grade a SCRIPT by its self-test, not the tree. Green `mode`, `effects` and `peers` rows say the verdict logic holds; they do not say a mode is in force, a ledger is clean or a hook is wired. Quoting one as if it did is a claim nothing measured. | `harness.config.json` |
| **AM-10** | Four rounds of fixes each moved the approval control to a different field the ledger's own writer controls. If you find yourself adding a fifth field to make an approval trustworthy, stop: the conclusion is in the README's invariant 1, and the answer is a deny rule outside the artifact. | `scripts/harness/actions.js` |
