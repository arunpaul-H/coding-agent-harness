---
id: multi-tool-handoff
kind: handoff
status: open
read_when: "starting or resuming multi-tool"
phase_next: 5
---

# Multi-tool: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 5: a backstop for every tier, and the matrix that admits the gaps

Read, in this order:
  docs/tracks/multi-tool/README.md   (Locked decisions, Agreed with the neighbouring track, Invariants, How to work)
  docs/tracks/multi-tool/plan.md     (Phase 5, and Phase 4 "Delivered" for what init and doctor do now)
  docs/tracks/multi-tool/traps.md    (before touching anything; MT-20, MT-21 are new)
  scripts/harness/tools.json         (each row: tier, hookConfig, dialect, sessionStart, skills, evidence)
  scripts/harness/tools.js           (--check, --list, enabledRows, skillRoots; where --matrix goes)
  scripts/harness/wire.js            (wiringFor, unwiredReason: which row gets a hook file, and why not)
  bin/harness.js                     (buildPlan, the merge items, cmdInit, toolWiring, doctor step 3b)
  scripts/harness/hook.js            (the HANDLERS table only: which guard decides which rule)
  AGENTS.md                          (section 3: the hard rules the matrix has a row for)
  harness.config.json                (the gates array a `tools` gate joins)
  tests/wire.test.js, tests/tools.test.js   (what is pinned today)
Nothing else unless a line below cites it. Find every other reference by Grep, not by reading.

SCOPE: the spec is plan.md Phase 5. IN: an opt-in git pre-commit and pre-push that run the commit
gate's report and the gate suite; tools.js --matrix, each hard rule against each enabled tool; a
`tools` gate running tools.js --check. OUT: a hook file for a tool that has none today (that needs
the tool run, MT-20), agent-definition files (locked decision 6), the method docs (phase 6).

The shape, in substance:
  The matrix is read off the registry and the wiring, never typed. For one enabled tool and one
  hard rule the cell is the mechanism that enforces it there, or `prose`. A rule a pre-tool guard
  enforces is a mechanism only for a row wire.js wires AND only for the calls that row's wiring
  registers: the second wired row registers a shell and a read event and no write event, so a rule
  about a written file is `prose` for it. Where the git hook is the only thing standing, the cell
  says backstop, at commit time, not a deny.
  The git hooks are opt-in: a hook directory is the user's. init writes nothing there unless asked,
  never replaces a hook that exists, and says what it would run. A repo with core.hooksPath set is
  left alone and told why.
  The `tools` gate is one entry in the gates array of harness.config.json AND in what init writes
  (buildConfig). A new gate moves the suite total: the re-baseline is its own gates: commit.

Do NOT claim a deny where only the backstop exists, or a mechanism for a tool the harness does not
wire. `prose` is a legal cell and the honest one.
Do NOT hand-write a support table: the registry prints it.
Do NOT render a hook file for a row with no `wiring`, or type a shape from memory (MT-20). Do NOT
report a `docs` row as verified, or promote one: no tool is run in this phase.
Do NOT re-research the tools or edit docs/tracks/multi-tool/research/: frozen evidence. Do NOT
re-derive a tool fact in code: read the row, and fix the row if it is wrong.
Do NOT change what a guard decides or what hook.js does with a call (invariant 1).
Do NOT name a tool in code outside tools.json and the dialect modules (invariant 4). The tests in
tests/wire.test.js pick rows by property for the same reason; follow that.
Do NOT edit the neighbour's work: scripts/harness/mode.js, run.js, actions.js, carveouts.js,
peers.js; a modes field in tools.json with its validator lines in tools.js and its tests in
tests/tools.test.js; its config section; its block in the root README.md. A third track,
founder-guide, edits SHIPPED_SKILLS in bin/harness.js, the files list in package.json, the dirs
list in scripts/harness/common.json and tests/cli.test.js: re-read each immediately before editing
and change only what this phase needs. A gate red because of a neighbour's file is reported, never
fixed or reverted.
Do NOT commit, push, stash, restore, reset, run close-phase.js or flip a status: line; stage by
path only (MT-08). No inline node -e: write a script file in the scratchpad. No scratch file in
the repo. Do NOT spell the guarded secret filename in a file body you write (MT-01).

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 3 are committed. Phase 4 landed uncommitted. None is closed.
  init --tools <ids> validates each id against the registry, writes tools.enabled, and builds a
  plan of copies and MERGES. A merge adds what is missing to a file that exists, returns the text
  byte for byte when nothing is missing, and refuses a file it cannot parse; one refusal stops the
  run before any write. With no flag, the config already in the target names the tools.
  A config that exists is never rewritten: --tools against one that enables a different list is
  refused with the edit to make. Adding a tool to an installed repo is: edit tools.enabled, run init.
  A hook file's shape is the `wiring` export of a dialect module and applies only to the row whose
  hookConfig is the file it names. Two dialects export one. Every other enabled row gets no hook
  file and doctor prints a NOTE with the reason and the row's notes (MT-20).
  Doctor statuses are OK, MISSING, DRIFTED and NOTE. A NOTE is a gap no command closes: it has no
  fix line and is in no count. Step 3b prints, per enabled tool, tier, evidence, the policy wire,
  each registration by list, a registration under another tool's id, and the skills.
  Skills: a row's optional `skills` cell names the root it loads from. The shipped skills are
  copied to the root they are written for and rendered, name and description only, to any other
  enabled root. A rendered copy is pinned in skills-lock.json as sourceType rendered with a
  renderedFrom path and NO reviewedAt; the skills gate reports RENDER-DRIFT when the copy is no
  longer what its source renders to.
  A skill written for a fork runs inline once its frontmatter is cut to the portable keys: the
  body of two shipped skills still says it is a fork's prompt. Not addressed.
  Not installed when the default tool is not enabled: its hook config, the status-line helper, its
  stub, its skill root. The agent files under .claude/agents are still installed, because the
  routing doc's generated registry reads them.
  The exit command is red on a machine with no auto-memory index unless docs=1 is tolerated (MT-21).
  Not run in phase 4: any coding agent, and the suite on Node 20.
  skill-verify.cjs still has its unregistered --gate mode in the old wire format. It is not a
  handler and phase 4 left it as it was. Recommendation: remove it in phase 6 with the method doc
  that describes it, or make it a handler there; do not wire it silently.
  Neighbour, reported and not ours to fix: the mode.js self-test passes a tool's own name as the
  action; peers.js documents its own pre-tool hook, which belongs in the HANDLERS table.
  Owed by the lead: promoting the default tool's row to ran (MT-11); the re-baseline, since phases
  3 and 4 each added a test file; deciding whether the Codex and Antigravity hook files are
  researched and run, which is what wires them.
  Left for phase 6: method doc prose that still describes three per-guard registrations, and the
  entry-shape note in skills-lock.json for a rendered entry.

First commit: `multi-tool: git-hook backstop and the enforcement matrix`
Exit: `node scripts/harness/tools.js --matrix && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
