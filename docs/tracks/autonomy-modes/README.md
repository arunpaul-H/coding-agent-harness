---
id: autonomy-modes
kind: track
status: open
read_when: "changing how a run mode is chosen or enforced, or stating who this harness is for"
trap_prefix: AM
paths: ["README.md", "scripts/harness/mode.js", "scripts/harness/actions.js", "scripts/harness/carveouts.js", "scripts/harness/peers.js", "scripts/harness/run.js", "scripts/harness/tools.json", "scripts/harness/tools.js", "scripts/harness/config.js", "schema/harness.config.schema.json", "harness.config.json"]
verify: "node scripts/harness/guards/docs-lint.cjs && node scripts/harness/handoff-lint.js autonomy-modes"
last_verified: 2026-10-06
max_age_days: 30
closed_phase: 1
closed_at: 2026-10-07
gates_sha: 56c38e8c6de920d96cc24cac0a6efaccbc90468714ba42d438b482e12a5027b2
block_sha: 371456f8d13737f7999fb56b084a6c85c553cc60d2a1c7752670d3ca3413491d
receipt: 8490821077e80bf880c4cb702e5dab723f23bfef8c9755d0f7617ed337578bd9
---

# Autonomy modes: the audience, and a mode a script can enforce

This track does two things that turned out to be one thing. It states who the harness is **for** —
people on flat-rate subscription seats of agentic coding tools — and it gives the harness a **run
mode** it does not have today. They are one thing because what rations a seat is quota and context,
so autonomy is an economic decision, not only a safety one.

Out of scope, explicitly: API-key-metered developers, corporate buyers, SSO, policy servers,
compliance framing, and dollar-cost accounting.

## State

| Piece | Where | State |
|---|---|---|
| The four-mode verdict | `scripts/harness/mode.js` | written, self-tested, registered nowhere |
| Duplicate-effect ledger | `scripts/harness/actions.js` | written, self-tested, not gated |
| Carve-out ratchet | `scripts/harness/carveouts.js` | written, self-tested, not gated, no baseline recorded |
| Cross-session claims | `scripts/harness/peers.js` | written, self-tested, hook NOT wired, not gated |
| The launcher | `scripts/harness/run.js` | not written |
| Audience statement | `README.md` | not written |
| Mode config section | `harness.config.json`, `schema/` | not written |

No gate figure appears in this folder. It comes from `node scripts/harness/gates.js --check` and
lives only in `scripts/harness/gates.json` and `gates.baseline.json`.

## Locked decisions

1. **Subscription seats only.** Stated in the root `README.md` and held to everywhere else.
2. **Four modes, not three** — `fully-auto`, `auto-edit` (writes free, shell gated), `hitl`,
   `manual`. The owner added the third rung after research showed it is the one people live in.
3. **The selector lives in a LAUNCHER, not in the chat.** No surveyed tool lets a repo-local hook ask
   a blocking question before the first turn, so a chat-start selector is prose on every target. A
   parent process asking before the agent exists is mechanism on every target.
4. **The mode is declared per phase**, in `plan.md` and carried in the handoff — never per chat.
5. **`fully-auto` is a real unattended loop**, and the vendor terms that constrain it are the owner's
   documented risk, per-tool, with citations. Decided 2026-10-06.
6. **Verbatim cross-chat sharing is NOT built.** Its consent artifact is agent-forgeable, which fails
   the owner's own condition. See `research/` and invariant 1 below.
7. **`peers.js` has no expiry, no stealing and no re-take.** A stale claim blocks until a human runs
   `--clear --force`. Unattended recovery was traded away deliberately.

## Invariants

1. **An artifact the agent writes cannot carry authority over the agent.** Measured four times in one
   session: the approval control moved from a `decisions` array, to a `requiresApproval` field, to a
   `kind` field, to an argv classifier plus a self-minted challenge hash. The machine may derive
   **fact**; it may not derive **approval**. Expiry of a grant is a fact. The grant is not.
2. **Therefore every approval is enforced from outside the artifact** that records it — a guard, a git
   hook, a CI required check, or a human at a terminal. Where that is impossible, the mechanism says
   it **detects** rather than **prevents**, in its own output.
3. **A mode the harness cannot grant, it does not claim.** `defaultMode: "auto"` and
   `bypassPermissions` are ignored from a project settings file, so a repo-level `fully-auto` reaches
   `acceptEdits` at most. The mode file declares intent; the launcher and the vendor grant permission.
4. **A pasted prompt cannot carry a permission mode.** The handoff names the launcher invocation.
5. **Never deny a read.** A guard that substring-matches paths against a whole shell command cannot
   tell a read from a write. Mode and claim denials act on structured path fields only, and the
   resulting shell-shaped-write gap is stated wherever it applies.
6. **Prose is labelled prose.** Anything enforced only by instructing the model says so.

## How to work

One phase per session. Read this file's State, Locked decisions and Invariants, then `plan.md` for
your phase only, then `traps.md` before touching anything. Nothing else unless a line cites it.

End the phase by running its exit command in the foreground and pasting the output, or say why it
cannot close and stop. Do not flip a `status:` and do not type a receipt — `close-phase.js` writes
both. Replace `handoff.md`'s single block wholesale; never append a second.

**Coordination:** none open. The `multi-tool` track is archived under `docs/archive/multi-tool/`, so
no other session claims a file this track touches. `traps.md` AM-02 still holds.
