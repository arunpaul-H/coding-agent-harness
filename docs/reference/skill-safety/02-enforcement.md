---
id: skill-safety-enforcement
kind: reference
status: open
read_when: "skill-safety: Enforcement, the mechanism, and what is actually blockable"
---
# Enforcement

| Mechanism | Where | Behaviour |
|---|---|---|
| `--check` | `harness.config.json` gate registry | Whole-directory sha256; names the exact changed file; ends in a `GATE` line |
| `--hook` | `SessionStart` | **The control that covers invocation.** Reports drift and uncovered surfaces into context; never blocks; always exits 0 |
| `--gate` | `PreToolUse` on file tools | Denies a *read* of a drifted or unvetted skill. Live only once registered |
| `--gate` | `PreToolUse` on `Skill` | Inert by construction: the matcher does not fire. See below |
| `--update` | manual only | Re-baselines. **Never wired to a hook**: an auto-updating lockfile is not a lockfile |
| `--json` | tooling | `ok` plus fully attributed findings. The exit code agrees with `ok` |

A **warn alone never fails the run.** A verifier that goes red on something unverifiable by
design is a verifier people switch off, and switching it off costs the error cases too.

## Skill invocation cannot be blocked

`PreToolUse` with a `Skill` matcher **does not fire**. Invoking a skill injects its body
into the conversation *without issuing a tool call*, so there is no event to intercept, and
for the same reason a `Read` matcher does not catch invocation either.

Establish this on your own build before relying on either claim: wire a logging hook to the
matcher, invoke a skill, and look for a payload. Treat it as measured only once you have seen
the result. State it as measured only then, too.

The consequence is honest and worth saying plainly: **there is no blocking gate on skill
invocation.** What covers that path is the `SessionStart` report, which fires before any
skill can be used and names every drifted or unvetted skill in context. Weaker than a block,
correctly timed, and real.

`--gate` is therefore code whose caller is optional. Register it on `PreToolUse` and it
becomes live for *file* tools; the `Skill` matcher stays inert for the reason above. **Do not
describe either form as live until a real deny has been observed.**

### The guard's own rules

- Every `PreToolUse` matcher in this harness names `mcp__.*` alongside its native tools, so
  an MCP-shaped call reaches the guard rather than sliding past the matcher.
- An **unparseable payload is an `ask`**, never a silent allow. A guard that cannot read its
  input has learned nothing about the call, and "I could not tell" must not render as "fine".
- An `mcp__` tool is classified with the file tools, not as skill-shaped: it cannot invoke a
  skill, so it must not trigger the whole-tree check on every call.

## Two copies, one hash

A vendored skill exists twice: the archival copy under `.agents/skills/` (what the lock
records, and what a clone contains) and the live copy under `.claude/skills/` (what the agent
actually loads). Hashing only the first would leave the bytes that matter unverified:
tampering with the copy that is loaded would pass clean.

The mirror check requires the two to be identical and reports `MIRROR-DRIFT`, naming the
file, when they diverge. Symlinked entries are skipped: same bytes by construction, and on
Windows a link read as a directory would be hashed twice for nothing.

This is why **copies, not symlinks** is safe here: the lock provides the integrity guarantee
the symlinks were standing in for, and it covers both locations.

## The locked copy must be the tracked one

`skillDir` points at `.agents/skills/<name>`, never at a gitignored live mirror. An entry
whose `skillDir` points at the mirror pins a digest over bytes that **do not exist in a
clone**.

This has failed in exactly that way: entries pointing at the mirror made a fresh checkout
report `MISSING` and exit 1. The gate failed *on clone*, before anyone had touched a skill:
the worst form of the proportionality problem below, because the documented way to clear a
`MISSING` is `--update`, the one action that must never be reflexive. A gate that fails on
day one is removed on day two.

Check against the tree git would actually produce, not the working copy:

```bash
tmp=$(mktemp -d) && git archive HEAD | tar -x -C "$tmp" \
  && (cd "$tmp" && node scripts/harness/guards/skill-verify.cjs --check)
```

A skill worth locking is worth committing. If it is not worth committing, drop it instead:
that is a provenance answer, not a plumbing decision.

## Proportionality

The file-tool gate resolves a skill name from the path in the payload. When it cannot find
one, the call is simply not about a skill and is **allowed**. An earlier revision fell through
to checking every locked skill, which meant one drifted skill denied every unrelated read in
the session. A gate that blocks ordinary work is a gate that gets switched off within a day,
and that costs you the real gate.

Whole-tree fallback is reserved for skill-shaped calls whose name cannot be parsed, and even
then it is a *drift* check only, never the `UNLOCKED` check. Denying skill A because
unrelated skill B was never vetted is disproportionate.

## Digest algorithm (`sha256-dir-v2`)

Whole directory, not just `SKILL.md`: bundled scripts are attack surface. Files are sorted
by POSIX-normalised relative path, so the digest is stable across Windows, macOS and Linux.
Each file's path is folded into the running hash alongside its bytes, so a **rename**
registers as surely as an edit. CRLF is normalised to LF first, because line-ending churn is
not tampering and a check that cries wolf is a check that gets switched off.

Per-file digests are recorded beside the directory digest, which is what lets a drift report
name the file rather than the folder. An **added** file is drift too: a new file dropped into
a vetted skill is an unvetted instruction source, and comparing only the files already known
would miss the easiest way to smuggle one in.

*The algorithm is written down because v1's was not, and v1's digests could never be
reproduced from the files on disk. An unreproducible digest is not a lock.*

## Review dates are claims about a person

`reviewedAt` says a human read that skill on that day. `--update` moves it **only** when the
digest moved (reading the change *is* the review), or when the entry carried no date at all.
An earlier revision stamped today onto every entry unconditionally, which rewrote every date
to the day `--update` happened to run: assertions that somebody re-read skills nobody opened.

For the same reason `--update` **never adopts** a skill it finds on disk. Adding an entry is
the act of saying you read it, so the tool prints a ready-to-paste stub and stops. Its output
reports digests changed and review dates stamped as two separate numbers, because one is a
fact about bytes and the other is an assertion about a person.

## Nothing passes by absence

An empty lock and an empty tree grade nothing, so the check **declares itself**: it reports
`skipped=1` with the reason, and never a green `pass=0 fail=0 skipped=0`. A skip is red
unless the caller tolerates it explicitly, which keeps the decision visible in the
invocation rather than hidden in the check's own opinion of its environment.

The lock itself follows the same rule. **Absent is not unreadable:** no `skills-lock.json` is
a repo that predates the lock, and `--hook` stays silent. A lock that exists and cannot be
parsed is every pin switched off at once, so `--hook` still exits 0 and says in context that
no skill was verified, while `--check` fails with a `GATE` line.
