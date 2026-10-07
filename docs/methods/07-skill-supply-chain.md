---
id: method-07-skill-supply-chain
kind: reference
status: open
read_when: "asking why skills are hash-pinned, or what the skill lock does and does not protect"
paths: ["scripts/harness/guards/skill-verify.cjs", "skills-lock.json", "docs/reference/skill-safety/**"]
verify: "node scripts/harness/guards/skill-verify.cjs --self-test && node scripts/harness/guards/skill-verify.cjs --check"
last_verified: 2026-10-05
max_age_days: 90
---

# The skill supply chain: nothing changes silently

## The failure

- **A skill is not a library.** A library is code a sandbox runs. A skill is prose the model
  follows as instruction. Installing one is closer to granting edit access to the system prompt
  than to installing a package, and a code scanner finds nothing, because the payload is a
  sentence.
- **An update nobody read.** A skill reviewed once is updated by an ordinary package command. The
  new text is in force in the next session. No diff was shown and no test fails.
- **A lock that was clean when corrupt.** An early verifier reported nothing on a lock file it
  could not parse. Silence looked like a pass.
- **A digest nobody could reproduce.** The first lock recorded hashes without recording the
  algorithm. Its digests could never be recomputed from the files on disk, so a mismatch proved
  nothing either way.
- **Enabled but unpinned was nothing at all.** The check took the pinned set as its subject. A
  plugin that was enabled and absent from the lock produced no finding.
- **A re-baseline that forged a review.** Updating the lock stamped today's date onto every
  entry, including the ones nobody had re-read.
- **Half the copies checked.** A vendored skill existed as an archival copy and a live copy. Only
  the archival one was hashed; the bytes the agent actually loaded were unverified.

## The mechanism

| Piece | File | Does |
|---|---|---|
| The lock | `skills-lock.json` | one entry per skill directory a human has read: source, review date, directory hash, per-file digests |
| The verifier | `scripts/harness/guards/skill-verify.cjs` | recomputes every digest and reports drift, naming the changed file |
| The gate | `skills` in `harness.config.json`, running `--check` | ends in a GATE line; red on drift, on an unvetted skill, on an unreadable lock |
| The session report | `--hook` at SessionStart | names every drifted or unvetted skill in context before any can be used; always exits 0 |
| The review | `docs/reference/skill-safety/` | the eight-gate checklist a person runs before trusting a skill |

- **The lock ships empty.** `{"version": 2, "skills": {}}` plus its explanation. A lock inherited
  from another machine pins another person's review. This repo republishes no third-party skill.
- **The digest algorithm is written down** in the verifier's header: walk the directory, sort by
  POSIX-normalised relative path, fold path and bytes into one hash, normalise line endings
  first. A rename registers as surely as an edit, and line-ending churn does not read as
  tampering.
- **Both copies are hashed**, and a mirror check requires the live copy to equal the archival
  one.
- **The subject is the enabled set.** An enabled plugin with no pin is reported every session as
  uncovered, at warn: its files live outside the repo and no lock here can secure them. A pin
  that no longer describes its install is an error.
- **`--update` moves a review date only when the digest moved**, and is never wired to a hook.
  An auto-updating lock file is not a lock file.
- **What it cannot cover is reported as uncovered**: user-level skills and plugins outside the
  repo are named in the output and never dropped from it.
- **A drift is a stop.** Read the diff, re-run the checklist, then `--update`.

## Why a mechanism and not a rule

- "Review a skill before installing it" is a rule everybody agrees with and nobody can verify
  afterwards. The lock turns "I reviewed it" into a hash of what was reviewed, so the claim is
  false the moment the bytes change.
- "Re-review on update" fails by default: the update arrives through a routine command and the
  session simply starts. The session-start report puts the drift in front of the agent before the
  skill can be used, without anyone remembering to look.
- Each failure above was a quiet one in an earlier verifier: no output on a corrupt lock, no
  finding for an unpinned plugin. The lesson generalises. A checker must fail loudly on its own
  blind spots, or its silence is read as a verdict.

## The cost and the limits

- **It cannot make a skill safe. Nothing can.** An instruction-following agent reading text an
  attacker controls is an unsolved problem. The guarantee is narrower: nothing changes silently.
- **A hash pins what was reviewed, not how well.** A careless review is pinned exactly as firmly
  as a careful one. The checklist is prose and a person can skim it.
- **Invocation cannot be blocked.** Invoking a skill issues no tool call in the runtime this was
  built against, so no PreToolUse hook sees it. The session-start report is the control: weaker
  than a block, correctly timed. Establish this on your own build before relying on it.
- **`--gate` is optional code.** It can deny a file read of a drifted skill once registered on
  PreToolUse. It is not wired by default here. Do not describe it as live until a real deny has
  been observed.
- **The report is advisory.** An agent told a skill has drifted can still use it.
- **Outside the repo is outside the lock.** User-level skills, global plugins and MCP servers
  load into every session and no file in this tree can pin them. They are named, not secured.
- **MCP tool descriptions are the same class of risk** and are not hashed here at all.
- **A warn never fails the run**, on purpose: a verifier that reds on what is unverifiable by
  design gets switched off, and that costs the error cases too.
- **Cost:** hashing the skill directories once per gate run and once per session start. With an
  empty lock, effectively nothing. The human cost is the review, which is the point.
