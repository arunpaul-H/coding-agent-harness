---
id: method-11-adopting-this-in-your-repo
kind: reference
status: open
read_when: "installing this harness into another repo, or borrowing one idea from it on another stack"
paths: ["harness.config.json", "schema/harness.config.schema.json", "templates/**", "scripts/harness/**", ".claude/**"]
verify: "node scripts/harness/config.js --self-test && node scripts/harness/gates.js --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# Adopting this in your repo

Requirements: Node 20 or newer, git, and a POSIX shell (on Windows, the one Git provides). Zero
runtime dependencies; nothing here needs an install step.

## 1. Install: copy five things

`node <harness-checkout>/bin/harness.js init --into <your-repo>` does this copy, writes a
`harness.config.json` from what it detects, and never overwrites an existing file without
`--force`. `--dry-run` prints the plan and writes nothing. With no test command detected it
writes no test gate and says so ([14](14-the-config-seam-and-the-installer.md)). Of `templates/`
it installs the track skeleton and renders `AGENTS.md` (the policy), its `CLAUDE.md` stub and
`docs/reference/routing/README.md`; the subtree and doc-standard skeletons stay in the package. It writes no
`.gitattributes`: pin your line endings yourself (`* text=auto eol=lf`). By hand:

| Copy | Why |
|---|---|
| `scripts/harness/` | the gate runner, the config loader, the lifecycle and doc scripts |
| `scripts/harness/guards/` and `.claude/settings.json` | the guards and their wiring. Merge the settings file if you already have one |
| `.claude/agents/`, `.claude/skills/` | the four agent briefs and three working skills. Optional |
| `schema/harness.config.schema.json` | documents every config key |
| `templates/` | skeletons: `AGENTS.md`, the `CLAUDE.md` stub, the routing doc, a subtree `AGENTS.md`, a track folder, the doc standard |

Then create `skills-lock.json` as `{"version": 2, "skills": {}}`. Do not copy another repo's lock:
it pins another person's review.

Add `scripts/harness/gates.json` and `scripts/harness/gates.red.*.log` to `.gitignore`. Commit
`gates.baseline.json`.

Then `node <harness-checkout>/bin/harness.js doctor --root <your-repo>`: every installed piece
as OK, MISSING or DRIFTED, each with the one command that fixes it, ending in a GATE line.

## 2. Write `harness.config.json`

This file is the only place the harness learns anything about your project. There is no default
suite: with no config, or no `gates`, every script stops and names the fix.

```json
{
  "$schema": "./schema/harness.config.schema.json",
  "project": { "name": "acme-api" },
  "gates": [
    { "name": "test", "command": "node --test", "adapter": "node-test" },
    { "name": "docs", "command": "node scripts/harness/guards/docs-lint.cjs" },
    { "name": "hygiene", "command": "node scripts/harness/guards/commit-hygiene.cjs --report" }
  ]
}
```

- `node scripts/harness/config.js` prints the resolved config, defaults merged in. Read it
  before the first run: it is what the harness believes it is grading.
- An unknown key is an error, not a shrug. A typo would otherwise read as a setting in force.
- Give `node --test` no path if you support Node 20. A quoted glob is not understood before
  Node 21 and exits `Could not find`. A bare directory is read as a module from Node 21 on and
  reported as one failing test. With no path every version finds the same `*.test.js` files.
- Set `commitHygiene.workDirs` and `rootAllow` to your layout, and `env.guarded` to your secret
  files. The default stance is deny-all on dotenv files; an exception is a dated carve-out.

## 3. Run your first gate

1. Make each check end its stdout with `GATE <name> pass=<n> fail=<n> skipped=<n>`, or give it
   an adapter. For your own script that is two lines: tally, print.
2. `git add` what you installed, then `node scripts/harness/gates.js`. Read the output. A gate
   with no GATE line is red. The `context` gate grades only what git tracks, so before the add
   it is red on coverage for the files it budgets: that is the rule working, not a fault.
3. `node scripts/harness/gates.js --accept --allow-skip reproducible-build=1`. This records the
   baseline. The allowance is needed while `artifacts` is empty, because that check declares
   itself skipped and never passes silently. Drop it once you list artifacts. On a machine with
   no agent-memory index for this checkout the doc gate declares one skip too and prints why:
   add `,docs=1`, here and in step 5. The total is the same with and without the index.
4. Commit `gates.baseline.json` alone, subject starting `gates:`.
5. From now on: `node scripts/harness/gates.js --check --allow-skip reproducible-build=1`.
6. Put that same command in CI. Until it runs on a pushed commit, nothing here is enforced
   beyond one machine.

## 4. Check the hooks actually fire

Do not assume. In a session, issue one harmless denied action per guard: ask to read a guarded
secret-file name that does not exist, and to move a nonexistent folder into `docs/archive/`.
Each should come back denied with the guard's message. Repeat from a spawned agent. Repeat on
every operating system your team uses. A guard that was never observed denying is a guard you
have not installed.

## 5. Scaffold your first track

Only for work that will span three or more sessions.

1. Copy `templates/track/` to `docs/tracks/<id>/`. Fill every placeholder, delete the comments.
2. Copy `templates/docs/reference/DOC-STANDARD.md` to `docs/reference/DOC-STANDARD.md`.
3. `node scripts/harness/docs-index.js` to generate `docs/INDEX.md`.
4. `node scripts/harness/handoff-lint.js <id>` until it passes.
5. `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check`.
6. Work one phase. Close it with `node scripts/harness/close-phase.js <id>`
   ([09](09-the-phase-lifecycle.md)).

Write the root `AGENTS.md` and the routing doc from the templates, then replace the placeholder
ceilings in `scripts/harness/context-budget.json` with measured bytes plus 10%, and delete its
`placeholder` flag ([08](08-the-context-budget.md)).

## 6. Day 30

- **List every `--allow-skip` in CI and in scripts.** Each is a check that does not run. Still
  justified, or wallpaper?
- **Read `git log --grep "^gates:"`.** Every baseline move. Did any lower a total, and why?
- **Search for figure-ok tags.** Read the reasons.
- **Check `env.openCarveOuts`.** Anything expiring, anything renewed by reflex?
- **Find the prose rule broken most often this month.** That is the next mechanism. If nothing
  was broken, build nothing.
- **Find the hook that never denied anything.** Either it is working or it is dead; probe it. A
  hook that only observes should be deleted.
- **Re-read every "enforced by" line** in `AGENTS.md` and confirm the named mechanism runs.
- **Read the staleness warnings.** Re-verify, do not re-date.

## 7. Take the ideas, not the code

On another language, another agent runtime, or none, these port as ideas:

- **A verdict line with a total.** Last line of every check: pass, fail, skipped. Compare the
  TOTAL to a committed baseline, so a vanished check is red. A dozen lines in any language.
- **Tolerance lives in the invocation.** A check may declare a skip; only the caller may allow it.
- **A threshold file no tool writes.** Budgets a script can update record what happened.
- **One handoff block, replaced wholesale,** with a mandatory "do not redo this" line and no
  uncited integer.
- **Deny at the action, and ask when blind.** Whatever your runtime's pre-action hook is: refuse
  the shape, and treat an unreadable request as a question, never as permission.
- **Caps as exit codes,** and an index generated from one "open this when" line per doc.
- **A close that refuses** unless the verdict is at the current commit, clean and fresh.
- **Self-tests that include the NO cases,** and one shared predicate where two checks ask one
  question.
- **Name the mechanism beside every hard rule,** and mark the rest as prose.

Start with the first. It needs no agent at all.
