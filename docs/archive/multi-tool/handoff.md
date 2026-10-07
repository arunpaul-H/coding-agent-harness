---
id: multi-tool-handoff
kind: handoff
status: open
read_when: "starting or resuming multi-tool"
phase_next: 6
---

# Multi-tool: closed and archived

## ▶ THE NEXT SESSION: paste this into a new chat

```
TRACK ARCHIVED: every phase of the plan has landed, and the owner asked for the archive.

Read, in this order:
  docs/tracks/multi-tool/README.md   (State, and the receipt in the frontmatter)
  docs/tracks/multi-tool/traps.md    (before touching anything)
Run, and read the output instead of the code:
  node scripts/harness/tools.js --list
  node scripts/harness/tools.js --matrix
Nothing else unless a line below cites it. Find every other reference by Grep, not by reading.
After the archive this folder sits under the docs root's archive directory, same file names.

SCOPE: in: nothing. Out: the registry contract, the hook entry, the dialects, the installer, the
matrix and the method docs: all are committed. A new tool is a registry row by the "Add a tool"
section of the root CONTRIBUTING.md, not a phase here. A new idea is a new track.

Do NOT re-research the tools or edit this folder's research files: frozen evidence.
Do NOT call a `docs` row verified, tested or working, and do NOT promote one without running
the tool and recording the command in the row (MT-11 names the tests that then move).
Do NOT render a hook file for a row with no `wiring`, or type a shape from memory (MT-20).
Do NOT hand-write a support table or a matrix: the registry prints both, and the block in the
root README is a paste a test holds to the command's output.
Do NOT describe a git hook as a deny, or as installed by default: it is opt-in.
Do NOT change what a guard decides or what hook.js does with a call (invariant 1).
Do NOT name a tool in code outside tools.json and the dialect modules (invariant 4).
Do NOT commit, push, stash, restore, reset or flip a status: line unless the owner asks; stage
by path only (MT-08). No inline node -e: write a script file in the scratchpad.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  The receipt in README.md's frontmatter names the last phase closed. Trust it over any
  sentence, this one included.
  Every phase is committed. The last three were closed by close-phase.js; the first four were
  committed before any close ran and carry no receipt of their own.
  The default tool's row is `ran`: on 2026-10-07 a fresh headless session was started at the
  repo root with the command the row records, and the lead and a spawned subagent each quoted
  the policy through the import stub. Its `nested` and `sessionStart` cells were not observed
  and the row's notes say so. Every other row is `docs` evidence.
  Two rows get a hook file: the default tool, and one more for its shell and read events only.
  Every other row gets the policy, the skills and a stated gap.
  The git hooks are opt-in (`harness init --git-hooks`), never replace a hook that exists, and
  are a backstop at commit or push time. Doctor does not report them.
  The matrix reads the registration in the repo's own hook file (MT-24).
  The exit command is red on a machine with no auto-memory index unless docs=1 is tolerated
  (MT-21); the committed baseline records that skip.
  A close needs any other session to commit and pause for one whole run of the suite (MT-22).
  This machine has no git identity configured: this track's last commits passed the repo
  history's identity with -c, and changed no config.
  The two places outside this folder that cited its research file by path, the header of
  tools.json and the header of tests/hook.test.js, name the archived path.
  Never run: any coding agent other than the default one, a real commit or push through a
  written git hook, and the suite on the oldest supported Node.
  Codex and Antigravity were NOT run: neither is installed on the machine this was closed on.
  Running one, and recording what its hook file looks like, is what would wire it. That is a
  new track's first phase, with the tool installed first.
  Not addressed, each small: skill-verify.cjs keeps an unregistered --gate mode in the old wire
  format; the body of two shipped skills still says it is a fork's prompt; the entry-shape note
  in skills-lock.json for a rendered entry.
  Neighbour, reported and not ours to fix: the mode.js self-test passes a tool's own name as the
  action; peers.js documents its own pre-tool hook, which belongs in the HANDLERS table.

First commit: none; no work is owed.
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip docs=1,reproducible-build=1`

How to work: there is no next phase. A new need is a new track.
```
