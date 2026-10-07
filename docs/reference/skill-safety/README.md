---
id: skill-safety
kind: reference
status: open
read_when: "installing, vendoring, updating or vetting an agent skill"
paths: ["scripts/harness/guards/skill-verify.cjs", "skills-lock.json", ".agents/skills/**", ".claude/skills/**"]
verify: "node scripts/harness/guards/skill-verify.cjs --self-test && node scripts/harness/guards/skill-verify.cjs --check"
last_verified: 2026-10-05
max_age_days: 180
---
# Skill safety: what to run before installing or updating any skill

A skill is **prose the model follows as instruction**. Installing one is closer to granting
edit access to your system prompt than to running `npm install`. This directory holds the
argument for why that needs a process, the eight-gate review checklist, and the mechanism
that makes the result stick.

**This process cannot make a skill safe. Nothing can.** An instruction-following agent
reading attacker-controlled text is an unsolved problem. What it guarantees is narrower and
achievable: **nothing changes silently.** Every skill you reviewed is hash-pinned, every
skill you did not review is named, and what the lock cannot cover at all is reported as
uncovered rather than omitted.

## Sections

- [Why this exists](01-why-this-exists.md): the threat model, the cited evidence, the
  honest limit, and the scope table: what the lock covers and what it cannot.
- [Enforcement](02-enforcement.md): the mechanism. Digest algorithm, the two copies,
  what is actually blockable and what is only reported.
- [The checklist](03-the-checklist.md): the eight gates. Run all of them before
  vendoring, installing, enabling or re-baselining a skill.

## The commands

```bash
node scripts/harness/guards/skill-verify.cjs --check      # the verdict, ending in a GATE line
node scripts/harness/guards/skill-verify.cjs --json       # the same verdict, machine-readable
node scripts/harness/guards/skill-verify.cjs --self-test  # drive every decision with literals
node scripts/harness/guards/skill-verify.cjs --update     # re-baseline, AFTER reading the diff
```

`--check` is wired as a gate in `harness.config.json`. `--hook` runs at `SessionStart` and
always exits 0, because a session must start whatever it finds. `--update` is wired to
nothing and must stay that way: an auto-updating lockfile is not a lockfile.

## The one rule

**A hash mismatch is a stop, not a warning.** The failure mode of this whole system is an
agent (or a person) hitting a denial and reaching for `--update` to get unblocked. That
converts the gate into a rubber stamp in one keystroke. Read the diff. Understand why it
changed. *Then* decide. If you cannot explain the change, the answer is not to re-baseline it.
