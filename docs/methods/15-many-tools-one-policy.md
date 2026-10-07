---
id: method-15-many-tools-one-policy
kind: reference
status: open
read_when: "running the harness under a coding agent other than the default one, adding a tool, or asking what enforces a rule under a given tool"
paths: ["scripts/harness/tools.json", "scripts/harness/tools.js", "scripts/harness/hook.js", "scripts/harness/wire.js", "scripts/harness/githooks.js", "scripts/harness/dialects/**"]
verify: "node scripts/harness/tools.js --self-test && node scripts/harness/tools.js --check && node scripts/harness/wire.js --self-test && node scripts/harness/githooks.js --self-test"
last_verified: 2026-10-07
max_age_days: 90
---

# Many tools, one policy: a registry row, a dialect, and a matrix that admits the gaps

## The failure

- **A policy file that meant two things.** `AGENTS.md` was the lead-only routing file here and the
  always-on instruction file in most other coding agents. Under those tools every agent loaded
  the routing text, and the rules sat in a file they never opened.
- **Enforcement filed under one vendor's directory.** The guards lived beside one tool's settings,
  so a repo driven by another tool carried its enforcement in a directory that tool never reads.
- **Guards that read one tool's field names.** The deciding functions took the payload of one
  runtime. A second runtime meant a second copy of each guard, and two copies of a rule drift.
- **"Supported" as a word in a table.** A support table in prose says yes or no. It cannot say
  which rule holds at the tool call, which holds only at commit time, and which is only asked for.
- **A tool nobody ran.** Hook field names and exit codes were read off vendor pages. Code built
  on a paraphrase behaves like code built on a fact until the day the tool is run.

## The mechanism

**Three layers, and a tool is supported by adding to the third only.**

| Layer | What it is | Where |
|---|---|---|
| Policy | ONE always-on file, plus one per subtree | `AGENTS.md` |
| Core | guards and gates that take a neutral event and return a plain verdict | `scripts/harness/hook.js`, `scripts/harness/guards/` |
| Adapter | per tool: how it reaches the policy, its hook file, its wire format | one row of `scripts/harness/tools.json`, one module in `scripts/harness/dialects/` |

- **The registry.** One row per tool: how it reaches the policy file, where its pre-tool hook is
  registered, which dialect that hook speaks, whether it has a session-start event, where it
  loads skills from. The row contract is the header of `tools.json`; `tools.js --check` holds
  every row to it and is the `tools` gate.
- **Every row carries its evidence.** `docs` means the cells were read off vendor pages and the
  tool was never run here. `ran` means somebody ran it, and the row records the command. A `docs`
  row is never printed as anything stronger. A cell nobody established is `null`, never a guess.
- **One policy body.** A tool that loads `AGENTS.md` itself needs nothing. One that does not gets
  a pointer: an import stub, or a setting in its own config. Never a second copy of the rules.
- **A neutral event.** A dialect module turns a tool's payload into `{ event, action, command,
  path, content }`, with `action` one of shell, read, search, write or other. Guards decide on
  that and return `{ deny, reason }`. No guard reads a tool's own field names.
- **One hook entry.** Every registration runs `hook.js --tool <id> --event <event>`. It looks the
  row up, parses with the row's dialect, runs that event's ordered handler list and emits the
  verdict in the dialect's spelling. A deny is the dialect's JSON AND exit code 2, because several
  tools are documented to pass a call on any other exit code.
- **A call nobody can read is not waved through.** A payload whose shape the dialect cannot vouch
  for is opaque. An opaque call no guard can read is an ask, and a dialect with no spelling for an
  ask refuses it.
- **A tier per tool, stated and never implied.**

| Tier | Means |
|---|---|
| full | a deny-capable pre-tool hook, a session-start event, a checked-in project hook file |
| guard-only | a deny-capable hook, but no session-start event or no project-level hook file |
| backstop | no hook the harness can wire: the policy file, the git hooks and the gate suite |
| inherits | a model, not an agent: it takes the tier of the host it runs in |

- **A tier is what the tool offers, not what is wired.** `harness init --tools <ids>` renders a
  hook file only for a row whose dialect records the shape of that file. Every other enabled tool
  gets the policy, the skills and a stated gap, repeated by `doctor` as a NOTE on every run.
- **Which tools, on what evidence:** `node scripts/harness/tools.js --list` prints every row with
  its tier and evidence. That output is the support table. No doc carries a copy.

**The matrix.** `node scripts/harness/tools.js --matrix` prints each hard rule of the policy file
against each enabled tool. A cell is worked out, never typed, from three things: the
registration found in the repo's own hook file, the handler table of `hook.js`, and the gates in
`harness.config.json`. There are five kinds of cell:

| Cell | Means |
|---|---|
| deny | refused at the tool call, for the kinds of call named. A kind the registration does not carry is named as NOT covered |
| report | said at session start. It refuses nothing |
| gate | red when somebody runs the suite. Nothing runs it for you |
| backstop | a git hook runs it at commit or push time. After the work, and not a deny |
| prose | nothing enforces the rule under this tool. The policy file asks; that is all |

**The git-hook backstop.** `harness init --git-hooks` writes a `pre-commit` that runs the commit
gate's report and a `pre-push` that runs the gate suite ([12](12-commit-hygiene.md),
[04](04-gates-and-the-gate-line-protocol.md)).

- **Opt-in.** A hook directory is the user's. Without the flag `init` prints the two commands and
  writes nothing.
- **A hook that exists is never replaced**, with or without `--force`. It is named, with the one
  line to add by hand.
- **A repo that keeps its hooks elsewhere is left alone**, and told why.
- **Standing is judged by effect.** The matrix counts a backstop when the file git would run
  holds the command, whoever wrote it.

## Why a mechanism and not a rule

- "This harness supports tool X" is a sentence. The matrix is the same claim broken into one cell
  per rule, each derived from a file on disk, and a cell that cannot be derived prints `prose`.
- "Keep the copies of the policy in step" has no failing moment. One body and a pointer cannot
  drift, and the doc gate fails a stub that carries a rule.
- "We read the vendor's docs carefully" is not evidence. An evidence column that only a recorded
  command can promote is.
- "Remember to run the gates before you push" is the rule a hookless tool leaves you with. The
  pre-push hook is that rule with a failing moment.

## The cost and the limits

- **Most rows are `docs` evidence.** Nothing here proves a rendered hook file is loaded by its
  tool. `--list` says which rows were run, and by what command.
- **Few tools get a hook file.** A row whose hook file has no recorded shape, or whose dialect
  cannot read the tool's calls, is wired for nothing. The fix is running the tool and recording
  what it sends, never a shape typed from memory.
- **A wired tool may be wired in part.** Where a registration carries shell calls and file reads
  only, a rule about a written file is `prose` there. The matrix says so cell by cell.
- **A backstop is late and skippable.** It runs after the work exists, and `--no-verify` passes
  it. It narrows the gap for a hookless tool; it does not close it.
- **The pre-push hook costs one run of the suite per push.** On a slow suite that is minutes.
- **The rule table is typed once.** The cells are derived, but the list of rules and the
  mechanism each one names mirror section 3 of the policy file by hand. A test holds the count
  and the names to the live tables; it cannot hold the meaning.
- **Subagent definitions are not rendered per tool.** Agent files exist in one tool's format only.
- **Cost:** one registry read and one dialect load per hook call, on top of the guard itself.
