---
id: autonomy-modes-plan
kind: plan
status: open
read_when: "autonomy-modes: the phases, each with its exit command and first commit"
first_commit: "autonomy-modes: peers.js self-test green after the authorship fix"
---

# Autonomy modes: the phases

One phase per session. Read `README.md` **How to work** first, then `traps.md`. The order is forced
by two things: what the `multi-tool` session still holds, and the rule that nothing is gated until
the suite can run honestly against a whole tree.

A phase with no exit command is a wish. Every exit command below is runnable as written.

## Phase 1 — finish `peers.js`, then stop

A stopped workflow left it half-edited. **The three authorship fixes LANDED; four self-test
assertions and two text surfaces lag behind them.** Every failure is a stale expectation, not a logic
fault, so fix the assertions and the text — not the code.

- `hook: our OWN claim never blocks us` expects an allow and now correctly gets `ask`. That IS the new
  designed behaviour: a sid match with a nonce mismatch is a conflict and must not be silently
  adopted. Update the assertion.
- `registry: it holds claims/ and nothing else` now also sees `nonces/`, the per-session nonce store
  that makes "already yours" require authorship. Allow exactly those two.
- The derived-sid note must also say that `--hook` can still see a real per-session id.
- `--install` output must say to pass `--sid <that chat's session_id>` on every call.

Then the standing rule for this file: **do not wire its hook until the self-test is green.** It denies
writes, so a broken version blocks the session that installed it.

**First commit:** `autonomy-modes: peers.js self-test green after the authorship fix`
**Exit:** `node scripts/harness/peers.js --self-test`

## Phase 2 — the audience statement

The root `README.md` gains the scope statement and the quota-not-cost framing, and
`docs/methods/00-overview.md` gains one line so the methods set agrees with it. Cheapest phase, and
it constrains every later decision, which is why it is not last.

No longer waits on anything: the `multi-tool` track that was editing `README.md` is archived. See
`traps.md` AM-01.

**First commit:** `autonomy-modes: README states the subscription-seat audience`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`

## Phase 3 — the `modes` column in the tool registry

Owned by this track end to end: `scripts/harness/tools.json` gains an OPTIONAL `modes` field mapping
each harness mode to that tool's own flags, and `scripts/harness/tools.js` plus `tests/tools.test.js`
are updated to validate it. See `traps.md` AM-02.

**First commit:** `autonomy-modes: tools.json carries each tool's mode flags`
**Exit:** `node scripts/harness/tools.js --check && node --test`

## Phase 4 — the launcher

`scripts/harness/run.js`, surfaced as `node bin/harness.js run <mode> --tool <id>`: prompt on the
terminal when no mode is given, map the mode onto that tool's native flags from the registry, exec the
tool. This is the whole reason the selector works — it is a parent process, so the model never sees the
decision and cannot skip it.

Delivered with one addition the plan did not name: the registry row gained an optional `bin` cell,
because the launcher may name no tool and the row recorded flags but not the program to start.

**First commit:** `autonomy-modes: the launcher owns the mode`
**Exit:** `node scripts/harness/run.js --self-test`

## Phase 5 — the config section and the receipt

A new top-level config section following the `tools` precedent: an unknown top-level key is a hard stop
before the merge, and a per-section allowed-sub-key list so a misspelled key errors instead of silently
defaulting. Then the `.phase` receipt, written only by the launcher and `close-phase.js`.

Per invariant 1, the receipt is worthless unless something outside it refuses to let the agent write
it. Ship the deny rule in the same change or do not ship the receipt.

Delivered, with three things narrower than the paragraph above reads. The receipt is written by the
launcher alone: `close-phase.js` does not touch it, because a receipt for a closed phase already
denies the next one. The deny rule is the phase guard's D6, on a write's path field only, so a
shell redirect into the file is a stated gap (invariant 5). And the launcher writes a receipt only
from a terminal, which detects a terminal and does not prove a person.

**First commit:** `autonomy-modes: the mode config section and the phase receipt`
**Exit:** `node scripts/harness/config.js --self-test && node bin/harness.js doctor`

## Phase 6 — gate the four scripts

`mode.js`, `actions.js`, `carveouts.js` and `peers.js` each get an entry in the `gates` array, so the
suite total rises and the re-baseline is visible. `carveouts.js` records its first baseline here and
nowhere earlier: a census measured against a half-edited tree is a fixture that lies.

A re-baseline commit's subject starts `gates:`.

Delivered narrower than "each gets an entry" reads. `mode`, `effects` and `peers` gate the
script's own self-test through the exit status, because none of the three prints a verdict about
this tree: `mode.js` is registered on no hook, there is no ledger for `actions.js` to grade, and
the peers hook is not wired. Only `carveouts` grades the tree. The gates are in this repo's suite
and not in the config `harness init` writes, since a census must be bootstrapped per repo.

**First commit:** `gates: the mode, effects, carveouts and peers gates`
**Exit:** `node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
