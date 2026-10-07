---
id: multi-tool-handoff
kind: handoff
status: open
read_when: "starting or resuming multi-tool"
phase_next: 4
---

# Multi-tool: the next phase

## ▶ THE NEXT SESSION: paste this into a new chat

```
PHASE 4: the installer wires each enabled tool and says its tier

Read, in this order:
  docs/tracks/multi-tool/README.md   (Locked decisions, Agreed with the neighbouring track, Invariants, How to work)
  docs/tracks/multi-tool/plan.md     (Phase 4, and Phase 3 "Delivered" for what the entry does)
  docs/tracks/multi-tool/traps.md    (before touching anything)
  docs/tracks/multi-tool/research/2026-10-05-tool-instruction-surfaces.md   (sections A, B, C: the shape of each tool's config, hooks and skills)
  scripts/harness/tools.json         (each row: policy, hookConfig, dialect, sessionStart, projectHooks, tier, evidence)
  scripts/harness/tools.js           (the helpers the installer already calls)
  bin/harness.js                     (init, buildPlan, buildConfig, doctor)
  scripts/harness/hook.js            (header and the HANDLERS table only: what a registration must say)
  .claude/settings.json              (the one rendered config that exists: the reference shape)
  scripts/harness/guards/skill-verify.cjs   (the skill roots and the lock)
  tests/cli.test.js, tests/skill-verify.test.js   (what is pinned today)
Nothing else unless a line below cites it. Find every other reference by Grep, not by reading.

SCOPE: the spec is plan.md Phase 4. IN: init --tools <ids>; per enabled tool a rendered hook
config and policy pointer; skills rendered once for the tools that read the shared root, with
skill-verify and the lock extended to it; doctor printing tier, evidence and each missing wire
per enabled tool. OUT: agent-definition files (locked decision 6), the git-hook backstop, the
matrix and the tools gate (phase 5), the method docs (phase 6), wiring mode.js.

The shape, in substance:
  init --tools <ids> validates every id against the registry. An unknown id is a hard stop that
  lists the valid ones. It then writes tools.enabled in harness.config.json.
  For each enabled tool it renders the hook config at that row's hookConfig path, registering
  node scripts/harness/hook.js --tool <id> --event pre-tool, and --event session-start only
  where the row has sessionStart. A tool whose policy mode is import or config also gets its
  policy pointer (the import stub, or the one setting); a native row gets nothing more.
  Rendering MERGES into an existing config file and is idempotent: a second run changes nothing.
  It never overwrites a user's other keys, and on a file it cannot parse it refuses with a fix
  line and writes nothing.
  The shape of every rendered file comes from the research file and is docs evidence (invariant
  6, MT-02). Say so in a comment in the rendered file or in the doctor output. Never claim a
  rendered config was run.
  A tool whose row has projectHooks null or false gets NO project hook file, and doctor says
  what it does not get. Same for a missing session-start: a guard-only tool lists its gaps.
  Skills: render once to .agents/skills/ for the tools whose row reads that root, dropping
  Claude-only frontmatter keys; .claude/skills/ stays for Claude Code. Extend skill-verify and
  the lock to the rendered copies.
  doctor prints, per enabled tool: tier, evidence, and each missing wire. It verifies that the
  tool's hook config registers hook.js with THAT tool's id, for pre-tool and, where the row has
  it, session-start.

Do NOT render agent-definition files (locked decision 6).
Do NOT probe the machine for installed tools: the config says which tools, nothing else does.
Do NOT overwrite a config file, or write a second policy body (invariant 3): a pointer only.
Do NOT report a docs row as verified, or promote a row to ran: no tool is run in this phase.
Do NOT change what a guard decides or what hook.js does with a call (invariant 1). If a rendered
config needs the entry to behave differently, stop and say so.
Do NOT re-research the tools or edit docs/tracks/multi-tool/research/: frozen evidence. Do NOT
re-derive a tool fact in code: read the row, and fix the row if it is wrong.
Do NOT name a tool in code outside tools.json and the dialect modules (invariant 4). The
installer renders from row fields; a per-tool branch in bin/harness.js breaks the invariant.
Do NOT edit the neighbour's work: scripts/harness/mode.js, run.js, actions.js, carveouts.js,
peers.js; a modes field in tools.json with its validator lines in tools.js and its tests in
tests/tools.test.js (if the field is there, leave it and render nothing from it); its config
section; its block in the root README.md. Re-read a shared file immediately before editing it
and change only what this phase needs. A gate red because of one of its files is reported as a
neighbour problem, never fixed or reverted.
Do NOT commit, push, stash, restore, reset, run close-phase.js or flip a status: line; stage by
path only (MT-08). No inline node -e: write a script file in the scratchpad. No scratch file in
the repo. Do NOT spell the guarded secret filename in a file body you write (MT-01), which
includes a rendered deny entry or a quoted example from another tool's docs.

Provenance: every figure comes from `node scripts/harness/gates.js --check`, and lives only in
scripts/harness/gates.json and gates.baseline.json. Never copy one out of prose.

Inherited state:
  Phases 0 to 3 landed uncommitted and are not closed; the repo has no commit yet.
  One entry exists: scripts/harness/hook.js --tool <id> --event <name>, events pre-tool,
  session-start, prompt-submit, stop. .claude/settings.json registers it once for pre-tool and
  once for session-start, tool id claude-code. It is the only rendered config in the tree.
  A deny is the dialect's JSON on stdout, the reason on stderr, and exit code 2.
  hook.js refuses any command line that is not exactly a tool id plus an event (MT-18): a
  rendered registration with one token wrong denies every call on that tool.
  hook.js does NOT check tools.enabled: any row with a dialect is accepted. Enabling is the
  installer's and doctor's to enforce.
  The Claude pre-tool matcher is the union of the tool names the guards decide on, not
  match-all, and must stay so (MT-17). A rendered config for another tool needs the same care.
  The gemini, cursor and antigravity dialects have no tool-name table, so every call there is
  opaque and an unreadable one is refused (MT-16). Rendering their config makes that live. Say
  it in the doctor output for those tools; do not invent a table from the docs.
  codex-cli and kimi-code share the claude dialect but not its permissions file, so they get no
  deny-layer check and their own deny files have no reader (MT-06, scripts/harness/hook.js:94).
  Doctor reads only .claude/settings.json today. It finds a missing guard by following the
  registered script's literal relative requires one level; tests/cli.test.js:304 pins that.
  Rows to design against, all in tools.json: kimi-code keeps its hooks in a file under the
  user's home with projectHooks null, so it gets no project file; antigravity has no
  session-start; gemini-cli's policy pointer is a setting in the same file as its hooks, so one
  merge writes both; github-copilot's hookConfig is a glob and its tier is backstop, so nothing
  is rendered for it. Tiers backstop and inherits get instructions only.
  skill-verify.cjs already lists .agents/skills as a root, as VENDORED (not first-party) at
  scripts/harness/guards/skill-verify.cjs:75. Rendered copies of this repo's own skills land in
  that same root: read how the two kinds are graded before extending the lock.
  skill-verify.cjs also has an unregistered --gate pre-tool mode in the old wire format. It is
  not a handler. Decide in your report whether it becomes one or goes; do not wire it silently.
  Owed to this phase from phase 2: statusline.cjs as a Claude-only installer file (check
  whether an install with Claude Code not enabled still copies it), and the broad .claude allow rule in settings.json permissions.
  The installer already derives one stub file name from the registry default (STUB_FILE in
  bin/harness.js) and package.json ships scripts by one-level globs (MT-13, package.json:46): a
  new directory of modules or templates needs its own files entry.
  The registrations test runs the real registered command (MT-04, tests/guards.test.js:836), and
  three tests pin the claude-code row (MT-11). Re-rendering .claude/settings.json through the new
  code path must leave the file byte-for-byte what it is, or those say why not.
  A session reads its hooks when it starts (MT-07). Not measured in phase 3: the new wiring from
  a fresh Claude Code session, and whether the JSON message still shows on an exit-2 deny.
  Neighbour, reported and not ours to fix: the mode.js self-test passes a tool's own name as the
  action, so against the neutral event its write gate never fires; peers.js documents its own
  pre-tool hook, which belongs as a handler in the HANDLERS table, not a second registration.
  A new test file changes the suite total: the re-baseline is a separate gates: commit after the
  phase commit, already owed from phase 3, and neither is made unless the user asks.
  Owed by the lead, not this phase: promoting the claude-code row to ran (MT-11).
  Left for phase 6: method doc prose that still describes three per-guard registrations.

First commit: `multi-tool: init renders per-tool wiring, doctor reports the tier`
Exit: `node --test && node bin/harness.js doctor && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

How to work: follow "How to work" in the track README. One phase, then stop and hand off.
```
