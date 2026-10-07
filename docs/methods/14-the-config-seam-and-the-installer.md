---
id: method-14-the-config-seam-and-the-installer
kind: reference
status: open
read_when: "asking why the harness has one config file, why it is copied in and not imported, or what init and doctor do"
paths: ["scripts/harness/config.js", "harness.config.json", "schema/harness.config.schema.json", "bin/harness.js"]
verify: "node scripts/harness/config.js --self-test && node bin/harness.js --self-test"
last_verified: 2026-10-05
max_age_days: 90
---

# The config seam, and the installer

## The failure

- **A harness that grades one repo.** The gate table was a literal inside the runner, and the
  artifact list was pulled out of the project's build script with a `require`. Every such
  coupling meant "this grades that repo and no other", and adopting it meant forking it.
- **An invented suite.** A runner that cannot read its gate list and falls back to a default
  prints a green verdict about a suite nobody agreed to. That figure is then the one people trust.
- **A typo read as a setting.** A misspelt key is ignored, the default applies, and the file
  still looks as if the setting were in force.
- **A hook that throws.** A PreToolUse hook that crashes on a missing config takes the session
  down with it.
- **A run that climbs out of its directory.** A test in a temp directory walked upward, found the
  real repo, and asserted against it.
- **A harness as a dependency.** A fresh clone does not have it until someone installs, and a hook
  pointing into an install directory is silently absent on exactly that clone.
- **An installer that overwrites.** The files a second run would replace are the ones a person
  has been editing since the first.
- **"Some files may be out of date."** A message that sends the reader to find out which.
- **A directory glob that republishes.** A skill someone was still vetting sat in the checkout,
  and a copy of the whole directory would have shipped it into every repo, with no lock entry.

## The mechanism

**The seam.** `harness.config.json` holds everything project-specific.
`scripts/harness/config.js` is the one loader; every gate script and every guard goes through it.

- **Absent or malformed is a hard stop** with a one-line fix. There is no default `gates` array
  and there never may be. Every other key has a documented default, because every other key has
  a safe one.
- **An unknown key is an error**, at the top level and inside a gate entry. An unknown
  adapter name is a hard error in the gate runner, never a fallback.
- **Soft mode is for hooks only.** `load({ soft: true })` answers `null` and the hook decides
  what no config means for it: the env guard falls back to deny-all, the hygiene gate to the
  default layout. Neither falls back to allow ([05](05-hooks-as-mechanism.md)).
- **The root is found three ways, in order:** upward from the working directory for the config
  file; the project directory the runtime exports to a hook; two levels up from the loader. Never
  upward from the loader's own location, which is the climb-out failure above.
- **Paths must stay inside the repo.** An absolute path or a `..` is refused. Caps must be
  positive integers.
- **`_readme` is a legal key.** JSON has no comments, so the reasoning sits in the file as data.
- **`node scripts/harness/config.js`** prints the resolved config, defaults merged in.
- **`schema/harness.config.schema.json`** documents every key for an editor.

**The installer.** `bin/harness.js`, the `harness` command of the package:

| Command | Does |
|---|---|
| `harness init [--into <dir>]` | copies the harness in and generates a config from what it detects. `--dry-run` prints the plan. `--force`, with `--only <path-prefix>`, is the only way to overwrite |
| `harness doctor [--root <dir>]` | every piece as OK, MISSING or DRIFTED, each with the one command that fixes it. GATE line last |
| `harness gates` | runs `gates.js`, passing the skips the repo has DECLARED. `--print-allow-skip` prints them and runs nothing |
| `harness docs` | the doc gate; with `--index`, the index generator |
| `harness host` | prints the inputs a verdict rests on that the repo does not contain. Always exits 0 |
| `harness selftest` | runs every `--self-test` in the repo |

- **Installing is copying.** The hooks are read from the repo's own settings file and a baseline
  is committed beside the code it measures, so the harness has to sit inside the repo it grades.
- **`init` writes no test gate when it detects no test command**, and says so. Tokens it cannot
  fill stay visible in the output for a person to fill.
- **Agents and skills are named file by file** in the installer and in the package's file list.
  Only the harness's own work ships.
- **`doctor` checks:** the config loads; every gate command resolves; every hook path exists;
  every shipped file is present and unchanged; every self-test passes; docs carry frontmatter and sit under
  their caps; the skill lock parses; the ignore rules hold, probed through git by effect.
- **The secret-file ignore rules are derived from `env.guarded`**, so the file the guard refuses
  to open and the file git refuses to track are one list.
- **A declared skip is one the repo already chose:** an empty `artifacts` list, or a baseline row
  recorded with a skip. `harness gates` types the flag; it does not invent the tolerance.
- **Zero dependencies is asserted**, not hoped: the installer's self-test checks the manifest.

## Why a mechanism and not a rule

- "Edit the gate list in the runner when you adopt this" is an instruction to fork. A config file
  is the same edit in a place an update does not overwrite.
- "Configure it before the first run" is forgotten exactly once, on the run whose green verdict
  gets believed. A hard stop cannot be forgotten.
- "Keep your copy of the harness current" has no failing moment. `doctor` gives it one, and
  names the path and the command.
- "Do not overwrite the user's files" was a promise in an installer's documentation. It is now
  the default behaviour, with the override spelt out in the command.

## The cost and the limits

- **A copy drifts.** That is the price of not being a dependency. N repos hold N copies, and an
  upstream fix reaches none of them until someone re-runs `init --force --only <path>` and
  reads the diff. `doctor` reports DRIFTED; it does not merge.
- **DRIFTED cannot tell a local improvement from decay.** A helper edited on purpose reads the
  same as one that rotted.
- **The schema and the validator are two files.** The schema documents; `config.js` enforces.
  Adding a key means editing both, and a key in only one of them is a defect.
- **Detection is a guess, printed.** `init` reads the package manifest and the layout. A repo
  with an unusual test command gets no test gate and a line telling it so.
- **`doctor` proves presence and wiring on disk.** It does not prove a hook fires in a session.
  Only a denied probe does ([11](11-adopting-this-in-your-repo.md), section 4).
- **One config per repo.** A monorepo whose packages need different gate suites declares them as
  separate gates in one file. There is no per-directory config.
- **Soft-load fallbacks are per hook.** Each documents its own strictest stance; there is no
  single rule a new hook inherits.
- **Cost:** a file read and a validation pass per script start, cached per process. `doctor`
  costs the sum of the self-tests unless run with `--no-self-tests`.
