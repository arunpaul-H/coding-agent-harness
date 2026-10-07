# Contributing to Agent Harness

A fact per line. Every rule here is enforced by something you can run; where it is not, it says so.

## Before you open a pull request

```
node bin/harness.js selftest     # every --self-test in the repo; red if any fails
npm test                         # node --test, with no path (see package.json for why)
npm run gates                    # the whole suite against the committed baseline
node bin/harness.js doctor       # every installed piece: OK / MISSING / DRIFTED, each with its fix
```

There is no install step. If a command above needs `npm install` first, the change is wrong (next section).

One skip is a property of YOUR machine, and only you can declare it. The `docs` gate's rule 10 sweeps
the agent runtime's memory index for this checkout, which lives in your user profile. Where there is
none (a fresh clone, and CI) the gate reports `skipped=1` and says why, and `npm run gates` is red on
an undeclared skip by design. Read the reason, then tolerate it by name:

```
node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1
```

The total is the same with and without the index, so a baseline accepted on either kind of machine
holds on the other. CI declares the same skip, in `RUNNER_SKIPS` in `.github/workflows/ci.yml`.

## The zero-dependency rule

- `dependencies` and `devDependencies` in `package.json` are empty objects, and stay empty.
- Node built-ins only (`node:fs`, `node:path`, `node:child_process`, `node:test`, ...), Node `>=20`.
- Why: the harness is copied INTO the repo it grades and runs from a PreToolUse hook on a fresh clone,
  before anyone has installed anything. A helper that needs a package is a guard that is silently off
  on exactly that clone.
- Enforced by: `node bin/harness.js --self-test` (asserts both objects are empty) and the
  `Zero dependencies` step in `.github/workflows/ci.yml` (also refuses a lockfile). CI has no
  `npm ci` step to fall back on.
- Cross-platform means Windows (Git Bash), macOS and Linux. Use `node:path`; never type a separator.
  Do not shell out for something a built-in does.

## Every decision ships a `--self-test`, every behaviour gets a test

- A script that DECIDES something (deny or allow, red or green, drift or clean) takes `--self-test`:
  exit 0 on pass, 1 on failure, and it prints what it checked.
- The self-test drives the pure decision with literals, and must include the cases that come out NO.
  A green suite only proves the happy path; a guard is only as good as its negative cases.
- `node bin/harness.js selftest` finds a script by the quoted `'--self-test'` literal it compares
  against. A script without one is not run, so a new helper with no self-test is invisible there:
  that is a review finding, not a pass.
- Behaviour that is an exit code or a written file is tested in `tests/*.test.js` by running the REAL
  script as a process inside a throwaway directory that is a whole little repo. Never run a fixture
  against this repo: it would overwrite the real `gates.json` on its way.
- Keep the reasoning comment. Each guard and gate says WHY it exists and what failure bought it. A
  change that deletes the reason while keeping the rule will be asked to put it back.

## Add a gate

A gate is a command whose LAST stdout line is exactly `GATE <name> pass=<n> fail=<n> skipped=<n>`.

1. Write the command. `pass + fail + skipped` is the total, and the total must not depend on whether
   the tree is clean: list the checks structurally, so a deleted rule shows up as a smaller total.
2. A check that could not be made is `skipped`, never `pass`, and prints why. The decision to tolerate
   it belongs to the caller (`--allow-skip <name>=<n>`), never to the gate's opinion of its machine.
3. Register it in `harness.config.json` under `gates`: `{ "name": "<kebab-case>", "command": "..." }`.
   Use `adapter` only for a runner that prints its own summary (`node-test`, `exit-code`), and
   `optional: true` only when an ABSENT TOOL should declare a skip.
4. Give the script a `--self-test` and a test under `tests/`.
5. Run `node scripts/harness/gates.js --self-test` (prints every registered name), then
   `node bin/harness.js doctor` (confirms the command resolves).
6. Re-baseline, as its own commit (see the last section).

Never require a file of the project being graded from harness code. Everything project-specific
arrives through `scripts/harness/config.js`.

## Add a guard

A guard is a PreToolUse hook that denies a SHAPE. It is mechanism, not prose: if the rule can be
ignored by an agent that did not read it, it is not a guard yet.

1. One file under `scripts/harness/guards/`, `.cjs`. Never an inline `node -e` in `settings.json`: a
   one-liner handed to a shell is word-split and breaks on its own source.
2. Read config with `load({ soft: true })`. A hook that throws takes the session down, so on a
   missing config degrade to the strictest documented stance, never to allow.
3. An unparseable payload is an ASK, never a silent allow.
4. Test every string in the `tool_input` unless you have a reason not to: a list of field names is
   silent about every tool added after it was written. Match the DECODED strings, keys included,
   never the serialised JSON: there a newline is two characters, and a name at the start of a
   line hides behind the second of them.
5. Register it in `.claude/settings.json`. EVERY matcher includes `mcp__.*`, or an MCP server that
   does the same thing under another name walks straight past it.
6. The deny message names the alternative and the one way to get a legitimate exception. A guard
   that blocks its own recommended alternative trains people to click through it.
7. `--self-test` with the negative cases (what must NOT be denied), plus a case in `tests/`.
8. `node bin/harness.js doctor` must list the new hook path as OK.

## Add a method doc

1. One file under `docs/` (`docs/methods/` for a method, `docs/reference/` for a reference).
2. Frontmatter, all of it: `id`, `kind`, `status`, `read_when`, `paths`, `verify`, `last_verified`,
   `max_age_days`. `read_when` is the one line the generated index is built from: write the moment
   an agent should open the file, not a description of it. The shape is in
   `docs/reference/DOC-STANDARD.md`.
3. Obey the line cap in `harness.config.json` `docs.caps`. Over the cap, split it:
   `node scripts/harness/split-doc.js <file.md> --out <dir>` (lossless, and it asserts so).
4. No gate figure in prose. A figure lives in `gates.json` (the last run) or `gates.baseline.json`
   (the committed record), or it does not exist.
5. Written for an agent: a fact per line, no preamble. British spelling, to match the rest.
6. Regenerate the index, never edit it: `node scripts/harness/docs-index.js`.
7. `node scripts/harness/guards/docs-lint.cjs` must be green.

## Re-baselining: the `gates:` commit subject

- `scripts/harness/gates.baseline.json` is the agreed figure. Only `gates.js --accept` writes it, and
  `--accept` refuses while the suite is red.
- A commit that stages the baseline MUST have a subject starting `gates:`. The commit-hygiene guard
  denies any other subject, so every re-baseline is legible in `git log --oneline`.
- Make it a commit of its own, after the change that moved the figure, and say in the body which gate
  moved and why. A baseline that moves inside a feature commit is a regression nobody was asked about.
- `scripts/harness/context-budget.json` is NOT a gate figure and `--accept` does not touch it: raise
  a ceiling by hand, in the same commit as the growth it pays for.

## Pins

- A workflow action is pinned to a full commit SHA with a trailing `# vX.Y.Z` that ENDS the comment.
- A scanner binary is pinned by version and SHA256 together. The workflow says where each digest is
  published. Never commit a digest you did not check against that source.
- A waiver in `.github/gitleaks.toml` or `.github/osv-scanner.toml` carries its reason; an
  advisory ignore also carries a date. Both files state the standard.
