---
id: guard-hardening
kind: track
status: open
read_when: "changing what a pre-tool guard refuses, adding a stop or spawn check, or pinning the skills the harness ships"
trap_prefix: GH
paths: ["scripts/harness/guards/**", "scripts/harness/hook.js", "scripts/harness/dialects/**", "tests/hook.test.js", "tests/docs.test.js"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js guard-hardening"
last_verified: 2026-10-08
max_age_days: 30
closed_phase: 7
closed_at: 2026-10-08
gates_sha: b0a4adb7592cf03ed825f4f78d6f249e0d2f5cd1c0068b2210cba6b17c2670e7
block_sha: 4c000271477f6c9f025d7f28765b717f7b01c1661ec1167fcada96b510bb09a8
receipt: 1b970e736691abb2ff4b25c7b158041b6a8e2448e40604e84ec99dcb65e9a304
---

# Guard hardening: close the gaps an agent reaches by accident

> ### Read which section, do not read it whole.
> | Your task | Read |
> |---|---|
> | Starting or resuming a phase | `handoff.md`, then **State** below |
> | Something behaves oddly | `traps.md` first |
> | Why a gap was left open | **Locked decisions** |
> | What must not move | **Invariants** |
> | The phases and their exit commands | `plan.md` |

> **Self-evolving tracker. Current truth only, not a changelog.** Rewrite in place when a phase
> lands. A cold session reads THIS plus `handoff.md` and continues with no memory of the last one.

## What this is

An audit on 2026-10-08 fed synthetic tool calls to the hook entry and rated every part of the
harness. Nine areas rated low. The owner's rule for acting on that: improve an area only where
it helps someone who clones this repo, never to move a rating. Six areas passed that test and
are the phases here; three did not and are named under **Locked decisions**.
Evidence: `research/2026-10-08-guard-probe.md`.

## Locked decisions

1. **A guard stops the accident, not intent.** A name built from a variable, decoded, or opened
   inside a script never appears in the call. Chasing those is a list with no last row; a
   sandbox is the boundary for them. Each guard says so in its own header. Lead, 2026-10-08,
   from the owner's rule.
2. **The body of a write is not a path.** A write the dialect vouches for is judged by its path
   field; its body may mention a guarded name. An opaque call keeps the whole reading. This
   reverses the behaviour behind trap MT-01, which cost a write on every ignore-file or setup
   edit. Lead, 2026-10-08.
3. **Wildcard coverage is for dotfile guards only.** A shell star does not match a dotfile, so a
   word must start with a dot to be read as a wildcard for one. A guarded pattern that is not a
   dotfile keeps literal matching only. The wider reading refused `rm *.log`. Lead, 2026-10-08.
4. **No count-in-a-sentence rule.** Only a pasted gate line joins the ratio shape. Matching
   numbers in prose refuses ordinary writing. Lead, 2026-10-08.
5. **Not in this track:** wiring the run-mode, effects and peers scripts (the autonomy work owns
   it); promoting the registry rows that rest on vendor pages (needs each tool on a machine);
   splitting the long scripts (single-file and dependency-free is what makes them copyable).
   Owner's rule, 2026-10-08.
6. **A stop check reports by default and blocks only on opt-in.** Blocking a turn on a suite that
   takes minutes would loop. Lead, 2026-10-08; phase 4 confirmed it against the tool.

## Invariants

1. Every new refusal ships with the ordinary call beside it that must still pass, in the
   guard's `--self-test` and as a process in `tests/`.
2. A guard never denies what the doc linter accepts: a figure shape or a receipt rule changes in
   both, in one commit.
3. Node built-ins only. No guarded filename is spelled in a test or a doc; assemble it.
4. `scripts/harness/hook.js` stays the one entry. A new check is a handler in its table.

## State

| Phase | What it delivers | Status |
|---|---|---|
| 0 | the probe, frozen as research | closed |
| 1 | the secret guard reads a name as a shell opens it; a write's body is not a path | closed |
| 2 | a move or copy into the archive is refused wherever the shell stands; the linter fails a track archived by hand | closed |
| 3 | a pasted gate line is a figure, in the guard and the linter | closed |
| 4 | a stop handler that reports edits made after the last gate run; forcing a turn is the opt-in key `stop.block` | closed |
| 5 | the installer pins the skills the harness ships, as `shipped` entries that claim no review; this repo's lock pins its own | closed |
| 6 | a spawn of a registered agent must carry the four contract field names; other agents pass and no field's content is read | closed |
| 7 | where the test gate's minutes go, measured on one machine; no file or cause owns most, so no change is planned | closed |

Phases 0 to 3 were done in one session at the owner's request and are committed in three
commits, not four: phases 2 and 3 edit the same two files, so they share one. Phases 4 to 7
followed in a second session; decision 6 held against the tool, and what was measured is in
`research/2026-10-08-stop-hook.md` and `research/2026-10-08-spawn-payload.md` (headless only).
Every phase is done. What is left is the gate re-baseline and the archive. The receipt in
this file's frontmatter names the last phase closed; trust it over this sentence. Nothing is
pushed. This machine has no git identity configured: a commit passes one on the command line.
The policy file was not edited: it sits within a few bytes of its context ceiling, and raising
a ceiling is a person's edit. What the secret guard does and does not stop is in its header.

## How to work

One phase per session, unless the owner says otherwise for a session. Start from `handoff.md`,
read only what its `Read` list names, do the phase, run its `Exit:` command in the foreground
and paste the output. Then rewrite this file to current truth, replace `handoff.md` wholesale,
and close with `node scripts/harness/close-phase.js guard-hardening`. A phase that cannot close
says so and stops.

This track lives on branch `worktrees` in the folder `Agent-Harness-worktrees`, because that is
where the owner asked for it. Harness files change on the source branch first, so landing it is
a merge the owner makes.
