## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The failure this stops, or the behaviour it corrects. -->

## Checked

Paste the last line of each. A command you did not run is NOT RUN; say so.

- [ ] `node bin/harness.js selftest`
- [ ] `npm test`
- [ ] the gate suite, with the command under "Before you open a pull request" in CONTRIBUTING.md
- [ ] `node bin/harness.js doctor`

## Before you ask for review

- [ ] No new dependency: `dependencies` and `devDependencies` are still empty.
- [ ] A script that decides something has a `--self-test`, including a case that must come out "no".
- [ ] If the baseline changed, it changed through `gates.js --accept` and the commit subject starts `gates:`.
- [ ] No secret, credential or personal email address in the diff or in the commit author.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the reason behind each line.
