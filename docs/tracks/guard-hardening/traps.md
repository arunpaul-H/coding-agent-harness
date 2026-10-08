---
id: guard-hardening-traps
kind: traps
status: open
read_when: "something behaves oddly while working on guard-hardening"
trap_prefix: GH
---

# Guard hardening: durable traps

Each of these was met while doing this track's work.

| id | The hazard, and what it costs | Anchor |
|---|---|---|
| **GH-01** | A here-document in this machine's Git Bash HALVES every backslash pair, even under a quoted delimiter. A test appended that way lost an escape and stopped parsing; a patch script lost its regex escapes and matched nothing. Write a file with the editor tool, or keep backslashes out of a here-document. | `tests/hook.test.js` |
| **GH-02** | The secret guard no longer reads the body of a write the dialect vouches for. A test that expects a refusal from a body must use an opaque call (a tool the dialect has no row for). Its path field is still read, and is put back by hand so a body equal to the path cannot remove it. | `scripts/harness/guards/env-guard.cjs` |
| **GH-03** | Wildcard matching covers only a guarded pattern whose filename starts with a dot. A repo that guards a key under a directory gets literal matching for it and nothing more. Widening it refused every bare star. | `scripts/harness/guards/env-guard.cjs` |
| **GH-04** | A word whose second character is a star is never read as a wildcard, because that is how a regular expression says "anything". So a dot followed by a star, pointed at a guarded dotfile, passes. Left open on purpose: refusing it refuses half of all sed and grep calls. | `scripts/harness/guards/env-guard.cjs` |
| **GH-05** | The phase guard follows the directory only when the tool's envelope names one inside the repo. Only the `claude` dialect sets it; under the other three a relative move from a changed directory is read as typed. | `scripts/harness/dialects/claude.js` |
| **GH-06** | The phase guard's self-test passes a fixture root to `rules()`. Without it an absolute directory in a fixture is compared against the real repo root and the case quietly tests nothing. | `scripts/harness/guards/phase-guard.cjs` |
| **GH-07** | The linter's archive rule fails a folder in the archive whose README says it is a track and carries no receipt. A repo that archived a track by hand before this rule existed goes red on upgrade. The fix is in the message: move it back and close it, or drop the track frontmatter if it predates the contract. | `scripts/harness/guards/docs-lint.cjs` |
| **GH-09** | At stop, exit 2 with the reason on stderr forces NOTHING under Claude Code: the turn ends with a hook-error notice. A forced turn is the block decision in JSON on stdout, and a line for the person is a system message at exit 0; stderr at exit 0 reaches nobody. Measured headless only. | `scripts/harness/dialects/claude.js` |
| **GH-10** | The stop handler reads the verdict beside the script it was loaded from, and a copied tree is all new files. A process test must copy the harness scripts into its root, run the copy, and date its verdict ahead of the copy, or it grades this repo's own verdict against a fixture. | `tests/hook.test.js` |
| **GH-11** | This repo's own four skills are pinned in the lock. An edit to one reds the `skills` gate and fails the session-start check until `skill-verify.cjs --update` re-pins it, in the same commit. That is the design, and it is the one case where the update is routine: read the diff first all the same. | `skills-lock.json` |
| **GH-08** | The guards a session runs under are the files on disk. Editing a guard changes what the same session's next call is judged by, so a half-written guard can refuse the edit that would finish it. Run its self-test after every edit. | `scripts/harness/hook.js` |
