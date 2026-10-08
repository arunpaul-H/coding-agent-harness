---
id: autonomy-modes-handoff
kind: handoff
status: open
read_when: "starting or resuming autonomy-modes"
phase_next: 7
---

# Autonomy modes: closed and archived

## ▶ THE NEXT SESSION: paste this into a new chat

```
TRACK ARCHIVED: every phase of the plan has landed, and the owner asked for it to be completed.

Read, in this order:
  docs/tracks/autonomy-modes/README.md   (State, Locked decisions, Invariants, the receipt)
  docs/tracks/autonomy-modes/traps.md    (before touching anything)
Run, and read the output instead of the code:
  node bin/harness.js --help
  node scripts/harness/run.js --modes
Nothing else unless a line below cites it. Find every other reference by Grep, not by reading.
After the archive this folder sits under the docs root's archive directory, same file names.

SCOPE: in: nothing. Out: the launcher, the registry cells it reads, the config section, the
receipt, the guard rule and the four gates: all are committed. A new idea is a new track.

Do NOT re-research the tools or edit this folder's research files: frozen evidence.
Do NOT fill the unattended mode's cell in the registry: which flag it takes is the owner's
decision and risk (locked decision 5). Ask; do not pick.
Do NOT wire the peers hook, or register mode.js on a hook event, without the owner.
Do NOT add a mode cell or a program name to a registry row from memory: read it off the tool.
Do NOT quote a green `mode`, `effects` or `peers` gate as proof a mode is enforced (AM-12).
Do NOT add a field to the receipt to make it trustworthy (AM-10, invariant 1).
Do NOT commit, push, stash, restore, reset or flip a status: line unless the owner asks.
No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  The receipt in README.md's frontmatter names the last phase closed. Trust it over any
  sentence, this one included.
  Every phase was closed by close-phase.js, the last on 2026-10-07; the archive followed it in
  a separate run, because a close and an archive each need a handoff that has changed.
  One anchor outside this folder named its open-track path, the archived founder-guide trap
  FG-04; it names the archived path.
  WHAT IS MECHANISM: the mode is chosen by a person at a terminal, in a parent process, before
  the agent exists; the tool is started with the flags its registry row records; a null mode, a
  row with no cell and a missing terminal are refused. A write to a track's receipt is refused
  by the phase guard, under a tool whose hook is wired.
  WHAT IS STILL PROSE: no hook reads the receipt, so no mode is ENFORCED on a running agent. The
  verdicts exist in mode.js and are self-tested; nothing calls them. A shell redirect into the
  receipt is not caught. A terminal is detected, a person is not proven.
  The unattended mode is null in the one filled row, so the launcher refuses it by name.
  The carve-out gate counts mentions and moves with ordinary edits (AM-11).
  The four gates are in this repo's suite only, not in the config the installer writes.
  The suite needs two declared skips on a machine with no auto-memory index; the committed
  baseline records them.
  Never run: a real coding agent through the launcher (its tests plant a throwaway program), the
  receipt being written from a real terminal, the four new gates on the CI runner or on the
  oldest supported Node, and a session under any mode flag.

First commit: none; no work is owed.
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

How to work: there is no next phase. A new need is a new track.
```
