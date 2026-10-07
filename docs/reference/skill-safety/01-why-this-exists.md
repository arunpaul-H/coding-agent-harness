---
id: skill-safety-why-this-exists
kind: reference
status: open
read_when: "skill-safety: Why this exists, the threat model and the scope of the lock"
---
# Why this exists

## A skill is not a library

A library is code the machine executes inside a sandbox you control; a skill is **prose the
model follows as instruction**. Installing one is closer to granting someone edit access to
your system prompt than to running `npm install`.

That changes the threat model entirely. The dangerous payload is not a binary: **it is a
sentence.** Dependency scanners, lockfile auditors and CVE feeds all find nothing, because
there is no code to scan. The review has to be a *reading*, done by whoever is accountable
for what the agent then does.

> **Cited third-party figure.** Snyk's *ToxicSkills* study reported prompt injection in
> **~36%** of the agent skills it tested. That number is theirs, not a measurement made in
> this repo; treat it as the reason to read, not as a statistic to quote onward. Nothing in
> this harness measures injection rates, and no figure here should be presented as if it did.

## The honest limit

**This checklist reduces risk. It does not make a skill "100% safe"; nothing does.** An
instruction-following agent reading attacker-controlled text is an unsolved problem. A skill
can be clean on the day you read it and malicious on the day its upstream moves. A skill can
be clean and still be wrong.

What the process below *does* guarantee is that **nothing changes silently**: every skill
you reviewed is hash-pinned, any drift is loud, any skill present but never reviewed is
named, and anything outside the lock's reach is reported as uncovered rather than left out.
That is a weaker promise than "safe", and it is the one that can actually be kept.

## Scope: what is covered and what is not

| Surface | Covered? | By what |
|---|---|---|
| Vendored third-party skills in `.agents/skills/` | Yes | `skills-lock.json` + `skill-verify.cjs` digest |
| The live copies under `.claude/skills/` | Yes | mirror check: the loaded bytes must equal the reviewed bytes |
| This repo's own skills in `.claude/skills/` | Partly | reported as `UNLOCKED` until pinned; reviewed by tracked diff |
| Marketplace **plugin** skills, installed outside the repo | **No** | nothing in this repo can secure them |
| A skill's upstream after you pinned it | No | the pin proves the bytes did not move, not that upstream is honest |

### Why the plugin row is a flat no

A marketplace plugin's files live outside the repository and are **replaced wholesale on
update**. A digest over them would describe a cache, not a commit, and it would be void the
next time the plugin updated. So the verifier does not pretend: an enabled plugin with no pin
is reported every session as *uncovered, not clean*, in those words.

That gap is the reason to **keep the enabled plugin set deliberately small**. The lock
secures what the repo holds; pruning removes what it cannot secure. There is no third option.

**Do not mistake a green `skill-verify` for coverage of the plugin caches.** A green verdict
means every *locked* skill still hashes to its recorded digest. It says nothing whatsoever
about an enabled plugin nobody pinned, which is why that case is a standing warning rather
than silence.

## Why severity differs by surface

The verifier grades the same question at three different severities, and the distinction is
load-bearing rather than squeamish:

- **A vendored skill absent from the lock is an error.** Its bytes came from somewhere else
  and the lock is the only record that anyone read them. This matters *more* than drift:
  drift means someone edited a skill you reviewed; `UNLOCKED` means a skill arrived and was
  never reviewed at all, which is the likelier path in reality.
- **This repo's own skill absent from the lock is a warning.** It arrived through the same
  review path as the rest of the repo (a tracked diff), so a digest over it is bookkeeping
  rather than integrity. Making it an error would put the gate in the red on a fresh clone
  of a clean repo, and a gate that fails on day one is switched off on day two. That costs
  you the error cases too.
- **An enabled, unpinned plugin is a warning; a pin that no longer describes its install is
  an error.** Pinning is opt-in. A false assertion the operator made themselves is worth
  stopping for; an uncovered surface they cannot fix from inside this repo is worth saying
  out loud every session and nothing more.

The rule underneath all three: **a check may never be red for something the reader cannot
act on, and may never be green for something it did not grade.**
