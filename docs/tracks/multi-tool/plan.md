---
id: multi-tool-plan
kind: plan
status: open
read_when: "multi-tool: the phases, each with its exit command and first commit"
first_commit: "multi-tool: the tool registry and the tools config key"
---

# Multi-tool: the phases

One phase per session; each ends with its exit command run in the foreground and pasted, or says
why it cannot close and stops. Read `README.md` **How to work** first and `traps.md` before any
edit. Order: the registry (every later phase reads it), policy (all a hookless tool gets), the
guard move before the split (a rename, then a behaviour change), wiring, the backstop, docs last.

## Phase 0: the tool registry exists and the config can name tools

**Problem.** No key or flag names a target tool; `TOP_LEVEL` is closed (MT-03).
**Do.** (1) `scripts/harness/tools.json`: one row per tool in the research file, fields `id`,
`policy` (`native` / `import` / `config` + the file or setting), `nested`, `hookConfig`, `dialect`,
`sessionStart`, `projectHooks`, `tier`, `evidence` (`docs` or `ran`), `asOf`, `source`. Claude Code
is the only `ran` row. (2) `scripts/harness/tools.js`: `--check` validates every row and that each
enabled tool exists; `--list` prints id, tier, evidence; `--self-test`. (3) A `tools` key,
`{ "enabled": ["claude-code"] }`, in `scripts/harness/config.js`, the schema and
`harness.config.json`; absent means `["claude-code"]`. (4) `tests/tools.test.js`.
**Do NOT.** Wire anything to the registry, or rename any file. Invariant 1.
**First commit:** `multi-tool: the tool registry and the tools config key`
**Exit:** `node scripts/harness/tools.js --self-test && node scripts/harness/tools.js --check && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** 2026-10-05, uncommitted, exit green; NOT closed (`close-phase.js` needs a commit). All four Do items landed. Deviations: rows also
carry optional `name`, `notes` and `command` (required on a `ran` row); a top-level `dialects` list rows are checked against; `--check` also
enforces tier consistency and prints a `GATE tools` line (no gate wired until phase 5); the loader refuses an empty, duplicate or non-kebab
`tools.enabled`; backstop rows cover the extra research hosts; OpenClaw has no row (it loads from its own workspace). Baseline not re-accepted.

## Phase 1: `AGENTS.md` is the always-on policy

**Problem.** `AGENTS.md` means lead-only here and always-on everywhere else; the collision sites
are listed in `research/2026-10-05-claude-coupling-inventory.md`.
**Do.** (1) PROBE before editing: in Claude Code, put `@AGENTS.md` in a scratch `CLAUDE.md`, spawn
a subagent, ask which instruction files it holds; repeat with no `CLAUDE.md`. Record the result in
the Claude Code registry row. Stub import is the default; no `CLAUDE.md` at all only if the probe
shows the stub fails for subagents. (2) Move today's `AGENTS.md` body to
`docs/reference/routing/README.md`, wording made tool-neutral, and repoint
`docs-index.js --agents` there. (3) Move today's `CLAUDE.md` body to `AGENTS.md`. (4) Make the
injected-file list in `measure-context.js` come from the registry; edit
`context-budget.json` by hand. (5) Caps, `subtreeClaudeMd` handling, `templates/`, the installer
name literal and `starterBudget`, and every pinned test. (6) Gemini CLI row: the `context.fileName`
setting, not a `GEMINI.md` body.
**Do NOT.** Touch a guard or `.claude/settings.json` hooks. Leave a second policy body (invariant 3).
**First commit:** `multi-tool: AGENTS.md is the always-on policy, routing moves to reference`
**Exit:** `node scripts/harness/measure-context.js --check && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** 2026-10-06, uncommitted, exit green per the lead; NOT closed (needs a commit). `AGENTS.md` holds the policy; `CLAUDE.md` is a
two-line stub (a comment and the import); routing and the generated agent registry are in `docs/reference/routing/README.md`; `docs-lint` rule 12
fails a `CLAUDE.md` with content past the import, or a stub with no `AGENTS.md` beside it; `measure-context.js` reads the injected set from the
enabled rows; the cap key `subtreeClaudeMd` is now `subtreeAgentsMd`; templates and installer follow; the claude-code policy mode is `import`.
PROBE, lead, 2026-10-06, fresh headless session (`claude -p` at the root): the lead and a spawned subagent with no file tools each quoted the rule
beginning "This file is the only policy body" verbatim, so the stub reaches a subagent (MT-07). Deviations: a blanket `git add -A` across the
shared tree (MT-08); baseline not re-accepted; `routingDoc(cfg)` is a path convention, not a config key; two byte ceilings carried over (MT-10);
caps for both files at `scripts/harness/config.js:107`; `docs-lint.cjs` and `measure-context.js` require `tools.js`, so fixtures copy it and
`tools.json` (MT-09); `bin/harness.js` derives one `STUB_FILE` from the registry default. OWED by the lead: the row is still `docs` though the
probe ran; promoting it rewrites three pinning tests (MT-11).

## Phase 2: guards live in `scripts/harness/guards/`

**Problem.** A Codex-only repo carries its enforcement under `.claude/helpers/`.
**Do.** `git mv` every `.claude/helpers/*.cjs` to `scripts/harness/guards/`; update
`.claude/settings.json`, the `gates` commands, `commitHygiene`, `common.json`,
`harness-baseline.json`, the installer (copy list, `buildConfig`, `doctor`), requires between
scripts, templates, tests, `AGENTS.md`, and every doc `verify:` line, prose path and trap anchor.
`statusline.cjs` stays: only Claude Code reads it. Move and repoint `.claude/settings.json` in one
step: the running session's hooks are registered from it.
**Do NOT.** Change a line of deciding logic. A diff that is not a path is out of scope (MT-04).
**First commit:** `multi-tool: guards move to scripts/harness/guards, verdicts unchanged`
**Exit:** `node --test && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** 2026-10-06, uncommitted, exit green; NOT closed (needs a commit). Six guards moved by `git mv`, references repointed; only
`statusline.cjs` is left in `.claude/helpers/`, so `common.json`, the installer helper walk, the branch-sync fixture (MT-14) and method doc `00`
still name that directory, by design. Deviations: two logic changes, each restoring a pre-move verdict (the orphan-helper rule scans both
directories; `buildPlan` copies `guards/` as its own required piece); a `files` entry for guards (MT-13); three old paths in the neighbour's
`carveouts.js` repointed. Owed to phase 4: `statusline.cjs` as a Claude-only installer file. Not re-baselined.

## Phase 3: one neutral event, one hook entry, a dialect per wire format

**Problem.** Two guards read Claude field and tool names in `decide`; five scripts emit one dialect.
**Do.** (1) Neutral event `{ event, action, command, path, content }` with `action` one of
`shell`, `read`, `search`, `write`, `other`; neutral verdict `{ deny, reason }`. (2) Each guard's
`decide(event, state)` returns the verdict and is pure: no stdin, no disk; `hook.js` reads what a
guard needs and passes it as `state`. A deny is emitted as the dialect's JSON AND exit 2, since
several tools are documented to fail open on any other code (`docs` evidence, README). (3)
`scripts/harness/dialects/<name>.js`, each exporting `parse(stdin)` and `emit(verdict, event)`:
`claude` (the registry maps Codex and Kimi Code to it), `gemini`, `cursor`, `antigravity`. (4)
`scripts/harness/hook.js --tool <id> --event <pre-tool|session-start|prompt-submit|stop>`: registry
lookup, parse, run that event's ordered handler list, emit. A guard that throws denies. (5) Session-start reporters go through the same
entry. (6) Fixture tests per dialect built from the research file's protocol cells; rows stay `docs`.
(7) Close MT-12: the write-time figure rule must also cover a nested `AGENTS.md`.
**Do NOT.** Render any non-Claude config file. Weaken the re-arm check (MT-06).
**First commit:** `multi-tool: guards take a neutral event, dialects own the wire format`
**Exit:** `node --test && node scripts/harness/hook.js --self-test && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** 2026-10-06, uncommitted, exit as the implementer reported; NOT closed (needs a commit). Landed: `scripts/harness/hook.js` (one
ordered handler list per event; `prompt-submit` and `stop` are empty lists, the seam); four dialects plus the shared `dialects/_wire.js`;
`.claude/settings.json` registers `hook.js --tool claude-code` once per event; `tests/hook.test.js`; MT-12 closed. Deviations: (a) the verdict
carries an ASK beside deny (invariant 1); a dialect with no spelling for it denies. (b) An unparseable payload denies at pre-tool and
prompt-submit only. Session-start cannot refuse: it, and a reporter that throws, are named in the context and the session starts. At stop the turn
ends with the failure on stderr, since a deny there forces turns forever; a stop handler's own deny is honoured. (c) Added: a payload whose event
disagrees with `--event` denies; `--help` and `--self-test` count only as the whole command line, and no arguments at all is exit 2. (d) The
pre-tool matcher is the UNION of the three old ones, not match-all: an unlisted tool name is opaque and an unreadable opaque call is an ask. Which
guard sees which action is its `actions` list. (e) A non-object tool input is kept as text and marked opaque, never dropped to an empty allow. (f)
`docs-lint.cjs` exports its session-start pair when required; `phase-guard.cjs` takes its name-to-action map from `dialects/claude.js` (no dialect
beside it: opaque). (g) The registrations test now runs the registered command per guard per kind of call, its command floor one lower (MT-04). (h) `bin/harness.js` doctor
follows a hook script's literal relative requires one level, pulled forward from phase 4 because a doctor test went red. (i) Hook timeouts are one
longer value per entry. (j) A deny writes its reason to stderr too. (k) A `files` entry for dialects (MT-13). NOT measured: the wiring from a
fresh session; whether the JSON message still shows on an exit-2 deny. Owed: MT-11; the re-baseline (the suite grew, nothing fell). Left for
phase 4: `hook.js` does not check `tools.enabled`; three dialects have no tool-name table, so every call there is opaque (MT-16).

## Phase 4: the installer wires each enabled tool and says its tier

**Problem.** `init` has no target-tool notion and `doctor` checks one settings file.
**Do.** (1) `harness init --tools <ids>` writes `tools.enabled` and renders, per tool, the hook
config at its registry `hookConfig` path calling `hook.js --tool <id>`, plus the policy pointer.
Merge into an existing config file, never overwrite. (2) Skills render once to `.agents/skills/`
for tools whose row reads it, Claude-only frontmatter keys dropped; `.claude/skills/` stays for
Claude Code. Extend `skill-verify` and the lock to the new root. (3) `doctor` prints per enabled
tool: tier, evidence, and each missing wire. A `guard-only` tool lists what it does not get.
**Do NOT.** Render agent-definition files (locked decision 6). Probe the machine for installed tools.
**First commit:** `multi-tool: init renders per-tool wiring, doctor reports the tier`
**Exit:** `node --test && node bin/harness.js doctor && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** 2026-10-07, uncommitted; NOT closed. `scripts/harness/wire.js` holds the merges; a hook file's shape is a dialect's `wiring` export, used only for the row whose `hookConfig` is that file. Deviations: (a) TWO rows are wired, the default tool and Cursor (shell and read events only); the research gives no file shape for the Codex or Antigravity hook file and the Gemini row cannot read a call, so those get no hook file and a NOTE (MT-20). (b) Rows carry an optional `skills` cell; rendered copies are pinned in the lock as `sourceType: rendered` with no review date, and checked against their source (RENDER-DRIFT). (c) A config that exists is never rewritten: `--tools` against one that differs is refused with the edit to make. (d) Doctor has a fourth status, NOTE, uncounted. (e) Without the default tool, its hook config, helpers, stub and skill root are not installed; agent files still are. Tests in `tests/wire.test.js`. Not run: any tool; Node 20. Owed: the re-baseline; the unregistered `--gate` mode of `skill-verify.cjs` (left as it was).

## Phase 5: a backstop for every tier, and the matrix that admits the gaps

**Problem.** A tool with no wired hook enforces nothing until CI.
**Do.** (1) `harness init` offers a git `pre-commit` and `pre-push` that run
`commit-hygiene --report` and the gate; opt-in, since a hook dir is the user's. (2)
`tools.js --matrix`: each hard rule of the policy file against each enabled tool, cell = the
mechanism or `prose`. (3) A `tools` gate running `tools.js --check`.
**Do NOT.** Claim a deny where only the backstop exists.
**First commit:** `multi-tool: git-hook backstop and the enforcement matrix`
**Exit:** `node scripts/harness/tools.js --matrix && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** 2026-10-07, uncommitted; NOT closed. `scripts/harness/githooks.js` holds the hook text and the decisions; `init --git-hooks` writes them, and without the flag init only prints the commands. The matrix is `RULES` and `cellFor` in `tools.js`: a cell is worked out from the tool's registration IN THE REPO'S OWN HOOK FILE (a registration that was removed is no longer a mechanism), the `HANDLERS` table and the config's gates. Deviations: (a) the two hooks are split, pre-commit runs the commit gate's report and pre-push runs the suite with the config's declared skips, so a gate backstop is `at push` and only the hygiene one is `at commit`. (b) A hook that exists is never replaced, `--force` included; one that already runs the command counts as standing whoever wrote it. (c) A gate with no git hook standing prints as `gate <name> when run`, under every tool, a third cell beside the mechanism and `prose`. (d) Both wired dialects export an `actions` list on `wiring`; the matrix reads it. (e) The rule table is typed once, in policy order, and `tests/backstop.test.js` holds its length to the policy file's section 3 and its handler, reporter and gate names to the live tables. (f) `--matrix` is a report: no GATE line, exit 1 only on a registry `--check` refuses. (g) Doctor does not report the git hooks. Not run: any tool, a real commit or push through a hook, Node 20. Owed: the re-baseline (a new gate and a new test file).

## Phase 6: the method is written down and a contributor can add a tool

**Problem.** The method docs describe a Claude-only harness.
**Do.** One new method doc routed from `docs/methods/README.md` (three layers, tiers, the
matrix); correct `01`, `02`, `05`, `11`, `14` where they state the old model; a "Adding a tool"
section in `CONTRIBUTING.md`: one registry row, a dialect only if new, a fixture test, evidence
tier stated. Root `README.md` lists the supported tools from `tools.js --list`.
**Do NOT.** Hand-write a support table that the registry can print.
**First commit:** `multi-tool: the method doc and the add-a-tool contributor path`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`
**Delivered.** not started
