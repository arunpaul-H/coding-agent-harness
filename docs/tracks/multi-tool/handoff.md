---
id: multi-tool-handoff
kind: handoff
status: open
read_when: "starting or resuming multi-tool"
phase_next: 6
---

# Multi-tool: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 6: the method is written down and a contributor can add a tool

Read, in this order:
  docs/tracks/multi-tool/README.md   (The method, Locked decisions, Invariants, How to work)
  docs/tracks/multi-tool/plan.md     (Phase 6, and the "Delivered" lines of phases 3, 4 and 5)
  docs/tracks/multi-tool/traps.md    (before touching anything; MT-22, MT-23, MT-24 are new)
  docs/methods/README.md             (how a method doc is routed, and the frontmatter one carries)
  docs/methods/05-hooks-as-mechanism.md             (the model to correct: one entry, not three)
  docs/methods/14-the-config-seam-and-the-installer.md   (init and doctor as they are now)
  CONTRIBUTING.md                    (where "Adding a tool" goes, and its register)
  scripts/harness/tools.js           (the header only: --check, --list, --matrix, and RULES)
  scripts/harness/githooks.js        (the header only: what the two hooks run, and the three rules)
Run, and read the output instead of the code:
  node scripts/harness/tools.js --list
  node scripts/harness/tools.js --matrix
Nothing else unless a line below cites it. Find every other reference by Grep, not by reading.
The other method docs plan.md Phase 6 lists are in scope only where a Grep finds the old model in them.

SCOPE: the spec is plan.md Phase 6. IN: one new method doc routed from docs/methods/README.md
(the three layers, the tiers, the matrix and its five kinds of cell, the git-hook backstop);
corrections to the method docs that phase lists, where they state the old model; an "Adding a tool"
section in CONTRIBUTING.md; the supported tools in the root README.md, as printed by --list.
OUT: any change to what a script does, a new registry row, promoting a row, a hook file for a
tool that has none (MT-20).

The shape, in substance:
  A contributor adds a tool with one registry row, a dialect module only if the wire format is
  new, a fixture test, and the evidence tier stated. The doc says that and points at the row
  contract in the header of tools.json; it does not restate the contract.
  A support table is PRINTED, never typed: the doc says which command prints it. Where a doc
  must show tool names, it shows the command and at most the output pasted under a dated line
  that says it is a paste.
  The matrix has five kinds of cell, deny, report, gate, backstop and prose, and the doc keeps
  them apart in those words: a backstop runs after the work, at commit or push time, and is not
  a deny; a gate with no hook standing is red only when somebody runs the suite.
  Method prose that describes three per-guard hook registrations is wrong since phase 3: there
  is one entry, scripts/harness/hook.js, and one ordered handler list per event.

Do NOT hand-write a support table, or a matrix: the registry prints both.
Do NOT call a `docs` row verified, tested or working, in any doc. No tool is run in this phase.
Do NOT describe a git hook as a deny, or as installed by default: it is opt-in.
Do NOT put a gate figure in a doc: phase-guard D3 denies the write and the doc gate reds the tree.
Do NOT grow AGENTS.md or the routing doc: both sit close to their byte ceilings (MT-10).
Do NOT re-research the tools or edit docs/tracks/multi-tool/research/: frozen evidence.
Do NOT change what a guard decides or what hook.js does with a call (invariant 1).
Do NOT name a tool in code outside tools.json and the dialect modules (invariant 4).
Do NOT edit the neighbour's work: scripts/harness/mode.js, run.js, actions.js, carveouts.js,
peers.js; a modes field in tools.json with its validator lines in tools.js and its tests in
tests/tools.test.js; its config section; its block in the root README.md. The founder-guide
track edits the root README.md, SHIPPED_SKILLS in bin/harness.js, the files list in
package.json, the dirs list in scripts/harness/common.json and tests/cli.test.js: re-read each
immediately before editing and change only what this phase needs. A gate red because of a
neighbour's file is reported, never fixed or reverted.
Do NOT commit, push, stash, restore, reset, run close-phase.js or flip a status: line; stage by
path only (MT-08). No inline node -e: write a script file in the scratchpad. No scratch file in
the repo. Do NOT spell the guarded secret filename in a file body you write (MT-01).

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 4 are committed; phase 4 is closed by close-phase.js, its receipt in the track
  README's frontmatter. Phase 5 is committed and is not closed.
  The git hooks: `harness init --git-hooks` writes a pre-commit that runs the commit gate's
  report and a pre-push that runs the suite with the skips the config declares. Without the flag
  init prints the two commands and writes nothing. A hook that exists is never replaced, --force
  included; one that already runs the command counts as standing, whoever wrote it. A repo with
  core.hooksPath set, a directory that is not a git repository, and a harness below the top of
  its repository each get no hook and the reason. Doctor does not report the hooks.
  The matrix: `tools.js --matrix` prints, per ENABLED tool, one cell per hard rule. The rules
  are the RULES table in tools.js, typed once in the policy file's order; a test holds its
  length to section 3 of the policy file and its guard, reporter and gate names to the live
  tables. A cell is worked out from the registration in the repo's own hook file (MT-24), the
  actions that registration carries (the `actions` list on a dialect's wiring), the HANDLERS
  table and the config's gates. It is a report: no GATE line, and exit 1 only on a registry
  --check refuses.
  The `tools` gate is in harness.config.json and in what init writes. It has no baseline row yet.
  The exit command is red on a machine with no auto-memory index unless docs=1 is tolerated (MT-21).
  A close needs the other session to commit and pause for one whole run of the suite (MT-22).
  This machine has no git identity configured: the one commit of this phase's session passed
  the repo history's identity with -c, and changed no config.
  Not run in phase 5: any coding agent, a real commit or push through a written hook, Node 20.
  Carried from phase 4, not addressed: skill-verify.cjs still has its unregistered --gate mode
  in the old wire format (remove it here with the method doc that describes it, or make it a
  handler; do not wire it silently); the body of two shipped skills still says it is a fork's
  prompt; the entry-shape note in skills-lock.json for a rendered entry.
  Neighbour, reported and not ours to fix: the mode.js self-test passes a tool's own name as the
  action; peers.js documents its own pre-tool hook, which belongs in the HANDLERS table.
  Owed by the lead: closing phase 5; the re-baseline in its own
  gates: commit, since phase 5 added a gate and a test file; promoting the default tool's row to
  ran (MT-11); deciding whether the Codex and Antigravity hook files are researched and run,
  which is what wires them.

First commit: `multi-tool: the method doc and the add-a-tool contributor path`
Exit: `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
