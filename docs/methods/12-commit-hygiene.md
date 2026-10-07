---
id: method-12-commit-hygiene
kind: reference
status: open
read_when: "a commit or push was denied by the hygiene gate, or a finding needs waiving"
paths: ["scripts/harness/guards/commit-hygiene.cjs", "harness.config.json"]
verify: "node scripts/harness/guards/commit-hygiene.cjs --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# Commit hygiene: the tree is read before the commit, by a script

## The failure

- **Debris nobody made on purpose.** Empty files named after fragments of code piled up at the
  repo root. The factory was a mis-wrapped hook ([05](05-hooks-as-mechanism.md)). Any mis-quoted
  one-liner in any shell makes the same litter, and the next factory will not announce itself.
- **A warning written into an ignore file.** "Read the status before you add." Nobody is reading
  that file at the moment of the add.
- **An ignore rule that hides the evidence.** A plain status listing omits an ignored file, so
  debris that happened to match an ignore rule was invisible to the ritual meant to catch it.
- **A token in a file git never reports.** A literal credential pasted into an ignored settings
  file appears in no walk of the status output.
- **A waiver that outlived its tree.** A clearance keyed on the status output alone went on
  suppressing a block after a token was pasted into a file the status never lists.
- **A re-baseline buried in a feature commit.** The gate baseline moved inside an unrelated
  commit and nobody reviewed the figure.
- **A gate waived on every run.** Harness state kept at the repo root needed a waiver each time,
  and a gate waived routinely is a gate switched off.

## The mechanism

`scripts/harness/guards/commit-hygiene.cjs`, one file in four modes:

| Mode | Runs as | Does |
|---|---|---|
| `--gate` | PreToolUse on the shell tools and `mcp__.*` | filters itself to `git commit` and `git push`, denies while findings stand, says nothing about any other command |
| `--report` | the `hygiene` gate, and CI | a real verdict: exit 1 with findings, the GATE line last. Ignores every waiver |
| `--clear "<reason>"` | by hand | waives the findings you have read. Recorded, and bound to this tree state |
| `--self-test` | by hand, and from `harness selftest` | every pure decision with literals, then the whole analysis in a throwaway git repo |

What it looks for: shell debris (a name carrying punctuation no real path has, or any empty
untracked file) · junk an ignore rule should have covered · an oversized blob · a secret on its
way in · a staged path an ignore rule also matches · new clutter at the top level · a helper
under `scripts/harness/guards/` that nothing wires · a literal credential in a settings file.

- **A modified tracked file is not a finding.** Work in progress is what a tree is for. A gate
  that objected to it would be waived on every commit.
- **It reads the status with ignored files included**, so debris behind an ignore rule is seen.
- **It steps outside the status once**, to read the settings files from disk, because a
  credential in an ignored file is visible no other way.
- **It never quotes a secret it found.** The detectors return booleans, so nothing downstream is
  able to print a match. A deny reason is written into the transcript for good.
- **The waiver is bound to the tree.** It stores a hash of the status output and of the scanned
  settings files' content, and dies when either changes. Clearing once does not open the gate.
- **`--report` ignores waivers on purpose.** A waiver is one person's decision about one tree on
  one machine, and CI is none of those.
- **A staged `gates.baseline.json` needs a subject starting `gates:`.** A subject the guard cannot
  read with certainty is asked, not denied on a guess.
- **Where files may live is config**: `commitHygiene.workDirs` and `rootAllow` in
  `harness.config.json`. With no readable config the hook falls back to the documented defaults,
  which can only produce a finding, never a green verdict.
- **The orphan-helper finding polices the harness itself.** A guard file nothing invokes is the
  "enforced" claim with no mechanism behind it, caught as a file.
- **The phase close re-runs it.** Precondition 5 of [09](09-the-phase-lifecycle.md) is this gate.

## Why a mechanism and not a rule

- "Read the status before you add" is a rule about a moment at which nobody is reading rules.
  The hook sits on the commit itself, the one moment that cannot be skipped.
- "Never commit a secret" has no after-the-fact. A pushed token is rotated, not un-pushed.
- A warning that scrolls past is not a gate, so every finding denies. A deny with no exit gets
  the whole hook removed, so there is a waiver. A waiver that lasts becomes a rubber stamp, so
  it is hashed to the tree. Each step answers the failure of the one before.
- "Re-baseline in its own commit" was a convention. It is now a refusal with the subject in it.

## The cost and the limits

- **It sees a commit only when the agent issues one.** A commit typed in a terminal passes no
  PreToolUse hook. The `--report` mode in the gate suite and in CI is the layer that does not
  depend on the agent, and it reads the tree, not the commit.
- **It matches the spelling of the command.** A commit made through a tool that does not spell
  `git commit` in a field this guard reads is not filtered here. An MCP payload with no readable
  field falls to the phase guard's ask ([05](05-hooks-as-mechanism.md)).
- **Secret detection is pattern-shaped.** A credential in a format the detectors do not know
  passes. This is a net for accidents, not a scanner to rely on alone.
- **It grades the tree, never the change.** A clean tree carrying a wrong diff commits freely.
- **The waiver's reason is recorded and not judged.** Read the clearance file in review.
- **The waiver file must itself be ignored**: `.claude/.commit-hygiene-clearance.json`. It
  describes one machine's tree. `harness doctor` probes that it is.
- **The size threshold and the detector list are code**, not config. Changing them is an edit to
  the helper, which every branch then has to pull ([13](13-one-harness-on-every-branch.md)).
- **Cost:** one Node process on every shell tool call to decide whether it is a commit, and a
  status read plus a tree scan on the calls that are. The self-test builds a throwaway repo and
  is the slowest self-test in the tree.
