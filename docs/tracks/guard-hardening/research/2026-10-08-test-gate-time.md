---
id: guard-hardening-research-test-gate-time
kind: research
status: frozen
read_when: "deciding whether to speed up the test gate, or asking why a gate run takes minutes"
question: "Where does the test gate's time go, per test file, and does one file or one cause own most of it?"
answer: "No file owns most: the largest is about a sixth and the top three under half. One test, the worktree script's own self-test run as a process, is about a twelfth alone. Child processes are the likely common cause but their share was not measured, so no change is planned."
paths: ["tests/**", "scripts/harness/gates.js", "harness.config.json"]
commit_at: "ad3a8a2"
expires: 2026-11-07
source: measured
---

# Where the test gate's time goes, measured per test file

> Measured on 2026-10-08 on Windows 11, Node v24.19.0, 4 logical CPUs, at commit `ad3a8a2` on
> branch `worktrees`. Findings, not instructions. ONE MACHINE: the plan asked for a Linux box as
> well, and none was reachable from here (no WSL installed, no remote host). There is no
> second column, and nothing below says how the suite behaves on Linux.

## 1. The method

A script in the session scratchpad ran `node --test` on each file under `tests/` alone, one
after another, with nothing else running, and took the wall-clock time of each process. The
variable the test runner exports into its children was removed first, as the gate runner does.
Every file passed. The spec reporter's per-test durations were kept to name the slowest tests.
A second script timed twenty runs each of five kinds of child process.

## 2. Per file, slowest first

| File | ms alone | Share | Tests | ms per test |
|---|---|---|---|---|
| `tests/worktree.test.js` | 130871 | 17.4% | 33 | 3966 |
| `tests/docs.test.js` | 127171 | 16.9% | 139 | 915 |
| `tests/lifecycle.test.js` | 105164 | 14.0% | 51 | 2062 |
| `tests/branch-sync.test.js` | 70511 | 9.4% | 38 | 1856 |
| `tests/wire.test.js` | 62382 | 8.3% | 22 | 2836 |
| `tests/cli.test.js` | 52431 | 7.0% | 28 | 1873 |
| `tests/hook.test.js` | 39223 | 5.2% | 93 | 422 |
| `tests/guards.test.js` | 39082 | 5.2% | 80 | 489 |
| `tests/context.test.js` | 33301 | 4.4% | 41 | 812 |
| `tests/backstop.test.js` | 27383 | 3.6% | 19 | 1441 |
| `tests/tools.test.js` | 19562 | 2.6% | 54 | 362 |
| `tests/gates.test.js` | 19333 | 2.6% | 31 | 624 |
| `tests/skill-verify.test.js` | 11736 | 1.6% | 42 | 279 |
| `tests/mode-gates.test.js` | 5949 | 0.8% | 10 | 595 |
| `tests/config.test.js` | 4621 | 0.6% | 19 | 243 |
| `tests/run.test.js` | 3669 | 0.5% | 24 | 153 |

The sixteen files sum to 752389 ms run one at a time. The gate runs them through one
`node --test`, which runs files side by side; its own duration for the same commit is the `ms`
of the `test` row in `scripts/harness/gates.json`. Across this session's gate runs that figure
was between roughly six tenths and nine tenths of the one-at-a-time sum, and it varied by
minutes from run to run on an unchanged suite, so running the files side by side on four CPUs
bought far less than a quarter of the time.

## 3. The slowest tests

| ms | File | Test |
|---|---|---|
| 59499 | `tests/worktree.test.js` | worktree.js --self-test passes |
| 17445 | `tests/worktree.test.js` | --prune lists by default, removes only with --yes |
| 11500 | `tests/cli.test.js` | --self-test passes and says what it checked |
| 10613 | `tests/docs.test.js` | the policy file imports NOTHING |
| 10424 | `tests/docs.test.js` | an EMPTY policy file is no policy file |
| 10350 | `tests/wire.test.js` | a registration that was removed is MISSING |
| 9004 | `tests/cli.test.js` | the exit code is the verdict |
| 8388 | `tests/worktree.test.js` | --land walks the three refusals in order |

The first row is one test, and it is 7.9% of the one-at-a-time sum and 45% of its own file. It
starts the worktree script's self-test as a process, and that self-test builds real git
repositories and linked worktrees. Every one of the 25 slowest tests took two seconds or more.

## 4. What one child process costs here

| Child | Mean of 20, ms |
|---|---|
| `node` on an empty script | 75 |
| `node` loading the hook entry and printing its help | 68 |
| `git --version` | 32 |
| `git status --porcelain` in this repo | 53 |
| a shell string that runs `node` on an empty script | 82 |

Loading the harness code costs nothing measurable beside starting the process. The suite is
process tests by design: nearly every test starts at least one `node`, and the slow files also
start `git` many times per test to build a fixture repo.

## 5. Findings

- **No one file owns most of the time.** The largest is 17.4%; the top three together are 48.3%.
- **No one cause was shown to own most of it.** Process start-up is the candidate: it is the one
  cost every slow test shares, and at the figures in section 4 a test that starts a dozen
  children spends about a second before asserting anything. But the number of children each
  file starts at run time was not counted, so its share of the total is not known.
- **One test is an outlier**: the worktree self-test run as a process, about a minute alone.
- **Per the plan's own condition no change is planned.** It asked for one only where one file
  or one cause owns most of the time, and neither was established.
- Not measured: Linux, where the cost of starting a process differs and the table could
  order differently; the count of child processes per file at run time; whether the
  outlier's minute is git, the file system or antivirus scanning of new files in the temp folder.
- What a later track would measure first: children started per file (a counter around the
  spawn helper each test file already has), and the same table on a Linux box.
