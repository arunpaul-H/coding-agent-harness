---
id: founder-guide-research-guide-skill-ship-surface
kind: research
status: frozen
read_when: "planning or reviewing the addition of a first-party skill to .claude/skills/ and to what `harness init` installs, and you need every file that names or counts the shipped skills"
question: "What must change, and what must stay true, for one new first-party user-invocable skill (working name `guide`) to ship in .claude/skills/ and be installed by `node bin/harness.js init` with every gate green?"
answer: "Two edits are load-bearing and nothing gates one against the other: `SHIPPED_SKILLS` (bin/harness.js:70) and package.json `files` (:51-53); common.json `dirs` (:42-44) and five prose counts follow. No test names the skill set, the context gate grades no skill bytes, the lock only warns; multi-tool phase 4 claims the same installer lines."
paths: ["bin/harness.js", "package.json", "scripts/harness/common.json", "scripts/harness/guards/skill-verify.cjs", "scripts/harness/measure-context.js", "scripts/harness/context-budget.json", "skills-lock.json", ".claude/skills/**", "tests/cli.test.js", "README.md", "CHANGELOG.md", "docs/methods/**", "docs/reference/branches/README.md", "docs/tracks/multi-tool/**", "docs/tracks/autonomy-modes/README.md"]
commit_at: "980221f"
expires: 2026-11-06
source: repo
---

# What shipping one more first-party skill touches (tree at 980221f, 2026-10-07)

Method: Read, Grep and Glob only. NOTHING WAS EXECUTED: this session had no shell, so no gate, no self-test and no `init` was run. Every line below is a reading of source at the cited `file:line`, reproducible with the ripgrep patterns listed under "Commands" at the end. No gate figure is quoted. The working name `guide` is the question's; no design is proposed.

## 1. Every place that names the shipped skills or agents one by one, or counts them

Mechanism (code or data a script reads):

| Where | What it holds | Effect of a fourth skill being absent from it |
|---|---|---|
| `bin/harness.js:70` `SHIPPED_SKILLS = ['plan','research','implement']` | the installer's list; `buildPlan` copies each whole directory at `:517` via `copyDir` | the skill is NOT installed. Comment `:62-68`: a directory copy would republish a third-party skill sitting in a checkout |
| `bin/harness.js:69` `SHIPPED_AGENTS` | four agent files, copied at `:516` | relevant only if the skill carries `agent:` naming a NEW agent file |
| `package.json:51-53` `files` | `.claude/skills/plan/`, `/research/`, `/implement/`, one entry each; rationale at `:23-25` | a checkout install still works (it copies from disk); a PACKED install lacks the directory, `copyDir` records it absent (`bin/harness.js:509`) and `init` stops FATAL, writing nothing (`:647-650`) |
| `scripts/harness/common.json:42-44` `dirs` | the three skill directories, mirrored byte-for-byte across branches by `branch-sync.js` | the new directory is "per-branch by default and is not checked at all" (`common.json:21-22`) |
| `scripts/harness/common.json:70` `ignore.mustTrack` | ONE probe, `.claude/skills/research/SKILL.md` | none; it is a sample, not a list |
| `bin/harness.js:1310-1313` self-test | builds its fake package by LOOPING the two constants, plus a decoy `vendored` skill and a decoy agent | none: it follows the constants |

Nothing ties the first and third rows together. `rg -n "pkg\.files|SHIPPED_SKILLS|SHIPPED_AGENTS" tests` returns one hit, `tests/hook.test.js:524`, and that test (`:515-537`) checks only the files `hook.js` and the dialects `require`. So "adding one is an edit here and in package.json `files`" (`bin/harness.js:67-68`) is prose: a skill added to the constant and omitted from `files` reds no gate in a checkout.

Prose that states the set or the count (no script reads these, and docs-lint does not compare them):

- `README.md:166` "four agent briefs, three skills"
- `CHANGELOG.md:39-40` "Four agent briefs (...) and three skills (`plan`, `research`, `implement`)"
- `docs/methods/09-the-phase-lifecycle.md:67` "The three working skills ... (`research`, `plan`, `implement`)"
- `docs/methods/11-adopting-this-in-your-repo.md:31` "the four agent briefs and three working skills"
- `docs/reference/branches/README.md:65` "`.claude/helpers/`, `.claude/agents/`, the three skills"
- No count, rule statement only: `docs/methods/14-the-config-seam-and-the-installer.md:72` (agents and skills named file by file in the installer and the package file list); `bin/harness.js:1154` help text (`.claude/{settings.json,helpers,agents,skills}`).

Checked and found to name NO skill and hold no skill list:

- `harness.config.json` (read whole): a `skills` GATE at `:99-102`, no skill names.
- `scripts/harness/tools.json`: one case-insensitive hit for `\.agents|skill`, no key for a skills directory. `scripts/harness/tools.js` and `scripts/harness/dialects/`: zero hits for `skill`. `schema/harness.config.schema.json`: only `tracksDir` prose at `:41`.
- `docs/reference/routing/README.md` and its template under `templates/docs/reference/routing/`: the generated block (`:91-101` in the live doc) is the AGENT registry, built from `.claude/agents/*.md` by `docs-index.js --agents`. Its section 3 (`:64-73`) describes research, plan and implement as stages, not as a skill list. A skill adds no row.
- `templates/`: `templates/AGENTS.md:32` mentions the `skills` gate generically; `TRACK_TEMPLATES` (`bin/harness.js:71`) is unrelated.
- `.claude/settings.json`: names no skill (`:19` describes the session-start skill report). `docs/INDEX.md`: generated from docs; SKILL.md files are not indexed.

## 2. Tests that assert on the set, or on how many files init writes

`rg -n "\.claude/skills|\.claude/agents|SHIPPED_|skills/" tests -g "!{skill-verify,docs}.test.js"` returns ONE line, `tests/context.test.js:167`, a fixture agent file.

- No test under `tests/` names `plan`, `research` or `implement` as a skill, and none asserts a count of installed files. `tests/cli.test.js:124` matches `WOULD WRITE \(\d+\)`, any number.
- `tests/cli.test.js:153-158` asserts a list of installed paths that includes NO skill and NO agent file. An install that dropped every skill would pass it.
- `tests/cli.test.js:254` asserts a registry row for each of the four AGENT names, in a loop inside one test. It moves only if a new agent file ships.
- `bin/harness.js` self-test: counts are relative (`dry.wrote.length === plan.items.length` at `:1341`; likewise `:1345`, `:1364`); `:1336` asserts no destination contains `vendored`. `tests/cli.test.js:63-66` requires only `PASS ... (\d+ assertions`, with no floor.
- `tests/skill-verify.test.js` builds its own repos (`withRepo`) with fixture names such as `delta-local` and `gamma-arrived` (`:272-299`); it does not read this repo's skills. `tests/guards.test.js:155-158` holds self-test FLOORS per guard script; a skill does not touch them.

## 3. Always-on cost, and what the context gate grades

- A skill is counted in the `listing` bucket only, as an ESTIMATE: per `SKILL.md`, basename length + frontmatter `name` + frontmatter `description` + 6 bytes (`scripts/harness/measure-context.js:797-799`; set `.claude/skills (repo)` at `:822`). The BODY of a SKILL.md is measured nowhere in that script.
- The bucket is reported and NOT graded: `context-budget.json:60-63`, and the note the gate prints (`measure-context.js:1040-1055`). The gate's checks are a fixed list of six names (`CHECK_NAMES`, `:953`), and `listing` is not one. The self-test pins that a tenfold listing moves neither the aggregate nor the verdict (`:602-610`).
- `context-budget.json` has no skill row and needs none; `totalTokenCeiling` (`:117`) excludes the listing.
- Two ways a skill directory WOULD reach the graded surface. (a) A file named `AGENTS.md` or `CLAUDE.md` inside it is found by the tree walk as `nestedOnTouch` and fails coverage until budgeted (`context-budget.json:34-37`; fixture at `measure-context.js:505-510`), and docs-lint sweeps the same file as an instruction file (`docs-lint.cjs:292-294`). (b) A new agent file adds a row to the generated registry block, budgeted at `maxRows: 6` with four rows present (`context-budget.json:110-116`; routing doc `:96-99`).
- `scripts/harness/harness-baseline.json:62` records the listing set as last measured: a report rewritten in full by an ordinary `measure-context.js` run, graded by nothing.

## 4. What skill-verify, the lock and skill-safety require of a first-party skill

- Roots are constants: `.agents/skills` (vendored) and `.claude/skills` with `firstParty: true` (`skill-verify.cjs:74-77`). A directory counts as a skill only if it holds `SKILL.md` (`:323`).
- A first-party skill absent from the lock is a WARN finding, "UNLOCKED — this repo's own skill ... add a lock entry to pin it" (`:325-331`; reasoning `:295-301`). It is graded inside ONE `skill-inventory` check that passes unless a VENDORED skill is unlocked (`:539-541`). A fourth unpinned skill adds a fourth warning line and no check.
- The session-start report prints errors and warnings alike and never denies (`:781-799`). `.claude/settings.json:19` states it prints every session as shipped, because the lock is empty.
- `skills-lock.json:42` is `"skills": {}`. Pinning is optional. Each lock entry is graded as its own `skill:<name>` check (`skill-verify.cjs:202-243`); an entry whose `skillDir` is the live directory gets no mirror check (`:259`). `--update` does not adopt an unlisted skill, it prints a stub to paste (`:1080-1085`). Entry shape: `skills-lock.json:14-29`; `sourceType` may be `local`.
- A pin does not travel: `init` writes the target an empty lock (`bin/harness.js:534`), so an installed copy reports the shipped skills as UNLOCKED there, pinned here or not.
- `docs/reference/skill-safety/01-why-this-exists.md:43` scopes "this repo's own skills" as "Partly ... reported as `UNLOCKED` until pinned; reviewed by tracked diff", and `:71` repeats that it is a warning. `03-the-checklist.md:9-11` says all eight gates run "before vendoring, installing, enabling or re-baselining a skill", with no exemption "including for your own". `:89-95` is the `allowed-tools` gate: absent means full inherited scope, and none of the three shipped skills declares it. Root policy states the same duty and says nothing denies a read or an invocation.
- `02-enforcement.md:21-23`: a skill INVOCATION cannot be blocked by a hook.

## 5. Which gate totals would move (names only)

- `test`: only if a `test(...)` is added or removed. Editing the constant or the self-test moves nothing.
- `docs`: yes, whenever a `.md` enters `docs/`. Its unit is one tick per rule per in-scope file (`docs-lint.cjs:891-904`); scope is the docs root, the tracks dir and instruction files (`:312-318`). A `SKILL.md` adds nothing; this research file and any further file in this track folder do. Whether rewording an existing doc changes the count was not established.
- `context`: no (six fixed checks, listing ungraded), barring the two cases in section 3.
- `hygiene`: no; its count is per finding kind (`commit-hygiene.cjs:932`, `:939`), not per file.
- `skills`: no while the skill is unpinned; yes, by one check per lock entry, if it is pinned.
- `reproducible-build`: no (`artifacts` is empty, `harness.config.json:105`).

## 6. Collision with the two open tracks

**multi-tool** `paths:` (`docs/tracks/multi-tool/README.md:7`) claims `.claude/**`, `scripts/harness/**`, `bin/harness.js`, `templates/**`, `harness.config.json`, `tests/**`, `docs/methods/**`. That covers the new skill directory, `SHIPPED_SKILLS`, `common.json`, every test, and three of the five prose counts.

- Its NEXT phase is phase 4 (State table `:129`, open). The handoff's read list is `bin/harness.js (init, buildPlan, buildConfig, doctor)`, `skill-verify.cjs`, `tests/cli.test.js` and `tests/skill-verify.test.js` (`handoff.md:23-27`).
- Phase 4 renders this repo's own skills a second time into `.agents/skills/`, "dropping Claude-only frontmatter keys", and extends skill-verify and the lock to the copies (`handoff.md:51-53`, `plan.md:118-120`). That root is graded as VENDORED today, where an unlocked skill is an ERROR (`handoff.md:106-108`; `skill-verify.cjs:75`, `:332-338`).
- Phase 6 owns the method docs. Locked decision 6 puts agent-definition files out of that track (`README.md:82-83`); decision 4 says `.claude/` holds only what Claude Code itself reads, skills included (`:77-79`); invariant 4 allows no tool named in code outside `tools.json` and the dialects (`:116-117`).

**autonomy-modes** `paths:` (`docs/tracks/autonomy-modes/README.md:7`) claims `README.md`, `harness.config.json`, `schema/harness.config.schema.json`, `tools.json`, `tools.js`, `config.js` and its own scripts. The overlap is `README.md` (the count at `:166`): its State table lists "Audience statement | `README.md` | not written" (`:32`) under locked decision 1, "Subscription seats only. Stated in the root `README.md`" (`:40`). It claims no skill, installer or test file.

Claimed by NEITHER list: `package.json`, `skills-lock.json`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/reference/**` (branches, skill-safety, routing).

Possibly stale in the multi-tool tracker: it says phases 0 to 3 are "Landed, uncommitted" and "the repo has no commit yet" (`README.md:125-128`, `handoff.md:83`), while the session's git snapshot showed a clean tree with four commits ending at 980221f. Not re-verified here (no shell).

## 7. Frontmatter the three shipped skills use, and inline versus fork

| Skill | `name` | `description` | `argument-hint` | `context` | `agent` | `disable-model-invocation` |
|---|---|---|---|---|---|---|
| `plan/SKILL.md:1-6` | yes | yes | yes | absent | absent | `true` |
| `research/SKILL.md:1-7` | yes | yes | yes | `fork` | `research` | absent |
| `implement/SKILL.md:1-8` | yes | yes | yes | `fork` | `implement` | `true` |

- A sixth key, `disable-model-invocation`, is in use; the question listed five.
- Fork is `context: fork` plus `agent:`. Both forked skills say so in their own bodies: "with `context: fork` the skill text becomes the subagent's instructions", it runs in the background, and it cannot ask a question mid-run (`research/SKILL.md:11-14`, `implement/SKILL.md:12-14`). The multi-tool inventory records the same reading (`2026-10-05-claude-coupling-inventory.md:140`).
- Inline: the one skill with neither key, `plan`, is the one whose body says "the LEAD writes this ... No fork, no subagent" (`plan/SKILL.md:8-11`). That is this repo's only evidence that an absent `context` means the body runs in the lead's own conversation.
- `rg -n "user-invocable|allowed-tools" .` finds `user-invocable` nowhere in the repo and `allowed-tools` only in the skill-safety checklist. No shipped skill sets either.

## Not established

1. That any gate is green today, or stays green after such a change: nothing was run.
2. Runtime semantics of the frontmatter keys (what an absent `context` and an absent `disable-model-invocation` do in the agent runtime). The repo holds its authors' statements only, and the question excluded web sources.
3. The real per-session cost of one more listing entry: `descBytes` is a stated estimate.
4. Whether docs-lint or `docs-index.js --check` accepts a track folder that holds only a `research/` file and no README, plan, traps or handoff. This file creates exactly that state, and `docs/INDEX.md` has no row for it until the index is regenerated.
5. Whether the two track READMEs describe the tree as it now stands (section 6, last paragraph).

## Commands (ripgrep patterns behind the claims above)

    rg -n "SHIPPED_|skills|agents/" bin/harness.js
    rg -n -i "skill" scripts/harness -g "*.{js,json}"
    rg -c -i "\.agents|skill" scripts/harness/tools.json ; rg -c -i "skill" scripts/harness/dialects
    rg -n -i "skill|three|four" README.md CHANGELOG.md CONTRIBUTING.md templates docs/INDEX.md docs/reference
    rg -n -i "skill" docs/methods -g "!07-*.md"
    rg -n "\.claude/skills|\.claude/agents|SHIPPED_|skills/" tests -g "!{skill-verify,docs}.test.js"
    rg -n "pkg\.files|SHIPPED_SKILLS|SHIPPED_AGENTS" tests
    rg -n "grade\(rep|UNLOCKED|firstParty" scripts/harness/guards/skill-verify.cjs
    rg -n -i "skill|listing|description" scripts/harness/measure-context.js
    rg -n "context: fork|disable-model-invocation|user-invocable|argument-hint|allowed-tools" .
