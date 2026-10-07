---
id: method-05-hooks-as-mechanism
kind: reference
status: open
read_when: "writing, wiring or debugging a hook, or asking whether a rule is really enforced"
paths: [".claude/settings.json", "scripts/harness/hook.js", "scripts/harness/guards/**"]
verify: "node scripts/harness/hook.js --self-test && node scripts/harness/guards/phase-guard.cjs --self-test && node scripts/harness/guards/env-guard.cjs --self-test"
last_verified: 2026-10-07
max_age_days: 90
---

# Hooks as mechanism: a guard denies a shape at the tool call

## The failure

- **A hook that never ran.** A guard was wired as `cmd /c "IF EXIST ... node ..."`. The agent
  runtime executes hook commands under a POSIX shell even on Windows. The shell rewrote `/c`
  into a path, an interactive command prompt started, and the JSON hook payload was executed as
  a command line. Every `=>` in a tool call became a redirect, writing 0-byte files into the repo
  root named after fragments of code. Several guards had never fired once, and the only visible
  symptom was litter that got blamed on something else.
- **A tool surface nobody watched.** Every matcher named the built-in tools. None named an MCP
  tool, so a server that can read files, write files and run code fired no hook at all.
- **A widened matcher that allows in silence.** Adding the MCP pattern alone is not a fix: the
  guard reads `command` and `file_path`, an MCP payload carries whatever its server defines, and
  an unreadable payload fell through to allow.
- **"Enforced:" lines written at the strength the author wanted.** An instruction file named a
  mechanism for each hard rule. Several named a script that nothing invoked. The first one an
  agent finds teaches it the whole list is negotiable.
- **Two mechanisms answering one question differently.** The write guard denied what the linter
  accepted. The escape people reached for was a self-granted exemption tag, which then spread.
- **Many no-op hooks.** A hook pack that only logged, or injected text on every prompt, cost
  context and time and never caught a defect.

## The mechanism

ONE entry, `scripts/harness/hook.js`, is registered once per event in each wired tool's own hook
file (`.claude/settings.json` for the default tool). It turns the tool's payload into a neutral
event, runs that event's ordered handler list, and emits the verdict in the tool's wire format
([15](15-many-tools-one-policy.md)). Each handler is a file in `scripts/harness/guards/`:

| Handler | Event | Denies |
|---|---|---|
| `env-guard.cjs` | pre-tool | any tool call naming a guarded secret file. Deny-all; exceptions are dated entries in `env.openCarveOuts` that re-arm on expiry |
| `commit-hygiene.cjs` | pre-tool | a commit or push carrying strays, secrets, ignore gaps or root clutter. A modified tracked file is not a finding |
| `phase-guard.cjs` | pre-tool | D1 a bare move into the archive · D2 a hand-flipped `status:` or typed receipt · D3 a gate figure written into a governed doc |
| `phase-guard.cjs` | pre-tool | D4 an MCP payload it cannot read is ASKED · D5 a missing shared predicate is ASKED |
| `skill-verify.cjs`, `env-guard.cjs`, `docs-lint.cjs`, `scripts/harness/branch-sync.js` | session-start | nothing. They report, and the session starts whatever they found |

`skill-verify.cjs` also has a `--gate` mode that denies a read of a drifted skill, in the wire
format the guards printed before the one entry existed. It is not a handler and nothing
registers it; skill drift is reported, not blocked ([07](07-skill-supply-chain.md)).
The commit gate has its own doc ([12](12-commit-hygiene.md)), as does the branch report
([13](13-one-harness-on-every-branch.md)).

Two entries in the same settings file are not hooks. `permissions.deny` refuses an inline
`node -e` or `node --eval` (the debris factory above) and a `Read` of each wildcard-free guarded
secret path, as a second layer under the env guard. `statusLine` runs `statusline.cjs`, which
prints one line for the person at the keyboard and puts nothing into agent context.

**The rules every hook here obeys.** Each is a failure that happened.

- **A file, never an inline one-liner.** The form is
  `node "$CLAUDE_PROJECT_DIR/scripts/harness/hook.js" --tool <id> --event <event>`. A one-liner
  handed to a shell is word-split and its arrows become redirects.
- **The default tool's pre-tool matcher includes `mcp__.*`.** A verb list or a named set of
  servers is silent about every server added later.
- **An unparseable payload is an ask, never a silent allow.** The ask names the payload's keys
  and never its values, because the reason string is written into the transcript.
- **Decide against the disk, not a pattern alone.** Rewriting a doc with its status unchanged is
  normal work; flipping it is the thing caught. The prior value is read from the file.
- **Load the config softly.** A handler that throws is a deny, with the handler named. With no
  readable config a guard falls back to the strictest documented stance, which produces a
  visible refusal. It never falls back to allow.
- **A session-start reporter never refuses** and is silent while clean.
- **A deny is the JSON AND exit code 2.** Several tools are documented to pass a call on any
  other exit code. Exit 2 is the entry's; a guard run by hand prints its verdict and exits 0.
- **One predicate, imported twice.** `doc-frozen.cjs` is loaded by the write guard and by the
  linter, so the write-time and gate-time answers cannot drift.
- **Every guard has `--self-test`** driving deny cases AND allow cases with literals. A rule
  only ever seen saying yes is indistinguishable from one that cannot say no.
- **Few handlers.** Each pre-tool survivor denies something. Each session-start survivor is
  silent while clean. A hook that only logs is deleted.

## Why a mechanism and not a rule

- "Never read the secrets file" in an instruction file is honoured until a debugging session
  where reading it is the obvious next step. Reading a secret copies it into the transcript
  permanently. There is no after-the-fact for that, so the control has to sit before the call.
- "Archive a track only through the close script" was prose, and the folder was moved by hand
  the first time the work felt finished.
- The discipline also runs the other way. A hard rule in the instruction file names its
  mechanism, and a rule with none is marked as prose. An "enforced" claim nothing backs is
  repaired by rewording it to what is true, or by wiring the mechanism. Never by leaving it.

## The cost and the limits

- **Every guard is a string match over one tool surface.** The same action spelled another way
  can pass: a copy where a move is denied, a figure written in words where digits are denied, a
  relative path prefix the normaliser missed. Widening a pattern closes one spelling. Guards
  stop accidents and reflexes. They do not contain a determined or adversarial agent.
- **A guard denies a shape, never a scope.** It cannot know which directory a task was told to
  stay out of.
- **D4 asking is the guard admitting blindness.** It is not a trust boundary. An MCP call that
  a person approves without reading is allowed.
- **One runtime was run.** A dialect module exists per wire format, but every one except the
  default tool's was read off vendor pages, and most tools get no hook file at all. Under those
  a rule is a gate, a backstop or prose ([15](15-many-tools-one-policy.md)).
- **Hooks exist only where the runtime runs.** A plain `git commit` in a terminal passes no
  pre-tool hook. The opt-in git hooks and the gate suite in CI do not depend on the agent.
- **Whether a hook fires is an empirical fact.** Test it the way the host invokes it, on each
  platform you support. A `--self-test` proves the decision function, not the wiring.
- **Cost:** one Node process per matched tool call, tens of milliseconds each, on every call.
  A hook that prints into context also costs tokens; these print only on a deny or a finding.
