# Contributing to Agent Harness

Short rules. Each one is checked by something you can run; where it is not, it says so.

## Before you open a pull request

```
node bin/harness.js selftest     # every --self-test in the repo
npm test                         # node --test
npm run gates                    # the whole suite against the committed baseline
node bin/harness.js doctor       # every piece: OK / MISSING / DRIFTED, each with its fix
```

There is no install step. If a command needs `npm install` first, the change is wrong.

On a fresh clone the `docs` gate reports one skip, because one of its checks reads a file that
lives in your user profile, not in the repo. An undeclared skip is red on purpose, so allow it by
name. CI does the same.

```
node scripts/harness/gates.js --check --allow-skip reproducible-build=1,docs=1
```

## Zero dependencies

- `dependencies` and `devDependencies` in `package.json` stay empty. Node built-ins only, Node `>=20`.
- Why: the harness runs from a hook on a fresh clone, before anyone has installed anything. A
  helper that needs a package is a guard that is silently off.
- It must work on Windows (Git Bash), macOS and Linux. Use `node:path`; never type a path separator.
- Checked by `node bin/harness.js --self-test` and the `Zero dependencies` step in CI.

## Tests

- A script that decides something (allow or deny, red or green) takes `--self-test`: exit 0 on
  pass, 1 on failure.
- Test the cases that must come out "no", not only the happy path.
- Behaviour that is an exit code or a written file is tested in `tests/*.test.js`, by running the
  real script inside a throwaway repo. Never run a fixture against this repo.
- Test on every supported Node version. Node 20 and 22 print different test output, and CI runs both.
- Keep the comment that says why a guard or gate exists.

## Add a gate

A gate is a command whose last stdout line is `GATE <name> pass=<n> fail=<n> skipped=<n>`.

1. Write the command. The total (`pass + fail + skipped`) must drop when a check is deleted.
2. A check that could not run is `skipped`, never `pass`, and prints why. The caller decides
   whether to allow it (`--allow-skip <name>=<n>`).
3. Register it under `gates` in `harness.config.json`.
4. Give it a `--self-test` and a test under `tests/`.
5. Run `node scripts/harness/gates.js --self-test`, then `node bin/harness.js doctor`.
6. Re-baseline in a commit of its own (see below).

Harness code never reads a file of the project it grades. Project details come through
`scripts/harness/config.js`.

## Add a guard

A guard is a hook that blocks a tool call before it runs.

1. One `.cjs` file under `scripts/harness/guards/`. No inline `node -e` in settings.
2. Load config with `load({ soft: true })`. If the config is missing, fall back to the strictest
   behaviour, never to allow.
3. A payload you cannot parse is an "ask", never a silent allow.
4. Check every string in `tool_input`, not a fixed list of field names. Match the decoded strings,
   not the raw JSON.
5. Add it to the `HANDLERS` table in `scripts/harness/hook.js`, with the kinds of call it decides
   on. It takes the neutral event and never a tool's own field names. Nothing else is registered:
   every tool's hook file already runs that one entry.
6. The deny message names the alternative and how to get a legitimate exception.
7. Add a `--self-test` with cases that must not be denied, and a case in `tests/`.
8. `node bin/harness.js doctor` must list the new guard as OK.

## Add a tool

A tool is a coding agent a repo can enable (`tools.enabled` in `harness.config.json`).

1. One row in `scripts/harness/tools.json`. The row contract is the `_readme` at the top of that
   file; do not restate it anywhere.
2. State the evidence. `docs` if you read the vendor's pages. `ran` only if you ran the tool, with
   the command recorded in the row. A cell you could not establish is `null`, never a guess.
3. A module under `scripts/harness/dialects/` only if the tool's hook wire format is new:
   `parse(stdin)` to the neutral event, `emit(verdict, event)` back. Reuse a dialect that fits.
4. Export a `wiring` from the dialect only if you know the shape of the tool's hook file. Without
   one the harness writes no hook file for the tool and says so. Never type a shape from memory.
5. A fixture test in `tests/hook.test.js`, built from the payload the tool sends, with a deny case.
6. Name the tool nowhere else in code. Only the registry and the dialect modules name one.
7. Run `node scripts/harness/tools.js --check`, then `--list` and `--matrix`, and read what your
   row now claims.

Checked by the `tools` gate and `tests/tools.test.js`. Whether a hook fires under the tool is
checked by nothing until someone runs it. The why is in `docs/methods/15-many-tools-one-policy.md`.

## Add a doc

1. One file under `docs/methods/` or `docs/reference/`.
2. Full frontmatter; the shape is in `docs/reference/DOC-STANDARD.md`. `read_when` says when an
   agent should open the file.
3. Stay under the line cap in `harness.config.json` (`docs.caps`). Too long? Split it:
   `node scripts/harness/split-doc.js <file.md> --out <dir>`.
4. No gate figures in prose. They live in `gates.json` and `gates.baseline.json` only.
5. One fact per line, no preamble, British spelling.
6. Regenerate the index, never edit it: `node scripts/harness/docs-index.js`.
7. `node scripts/harness/guards/docs-lint.cjs` must pass.

## Changing the baseline

- Only `gates.js --accept` writes `scripts/harness/gates.baseline.json`, and it refuses while the
  suite is red.
- A commit that includes the baseline must have a subject starting `gates:`. The commit-hygiene
  guard blocks any other subject.
- Make it its own commit, after the change that moved the figure, and say which gate moved and why.
- `scripts/harness/context-budget.json` is edited by hand, in the same commit as the growth it
  allows.

## Pins

- A workflow action is pinned to a full commit SHA, followed by `# vX.Y.Z`.
- A scanner binary is pinned by version and SHA256. Check the digest against its published source.
- A waiver in `.github/gitleaks.toml` or `.github/osv-scanner.toml` carries its reason; an
  advisory ignore also carries a date.
