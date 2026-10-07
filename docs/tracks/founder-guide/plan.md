---
id: founder-guide-plan
kind: plan
status: open
read_when: "founder-guide: the three phases, each with its exit command and first commit"
first_commit: "founder-guide: the guide skill, inline and in plain English"
---

# Non-tech guide: the phases

One phase per session. Each ends with its exit command run in the foreground and its output
pasted. A phase that cannot close says so and stops. Read `README.md` **How to work** before
starting any of them, and `traps.md` before touching anything.

The skill comes first because the other two phases point at it: an installer entry or a README
link to a skill that does not exist is a dangling promise. The installer comes second because it
is the one edit that collides with the `multi-tool` track, so it should be small and land early.
The README comes last so that everything it tells a non-tech reader to type already works.

## Phase 1: the guide skill exists and a person has used it

**Problem.** Nothing in the repo speaks to a reader who does not code. The three shipped skills
are written for a lead agent, and two of them fork and cannot converse
(`research/2026-10-07-guide-skill-ship-surface.md`, section 7).

**Do.**
- Write `.claude/skills/guide/SKILL.md`. Frontmatter: `name`, `description`, `argument-hint`
  only. No `context`, no `agent`, no `disable-model-invocation`, so a plain request such as
  "I am not technical, help me start" can reach it.
- The body is instructions to the agent on how to guide a person. It covers four jobs:
  1. **First run.** Check what is installed (`node bin/harness.js doctor`), and walk the missing
     steps one at a time, one command per message, saying what each does before it runs.
  2. **Read a result.** Run the gates and translate the verdict: what passed, what failed, what
     was skipped, each in one plain sentence, then the one next step.
  3. **What to ask next.** Turn the person's goal into a request the agent can be held to: what to
     build, and what check will show it works.
  4. **What green does not mean.** Say it every time it matters: a green result means the declared
     checks ran and none failed or vanished. It does not mean the idea is good, the code is
     correct or the product is secure.
- Tone rules in the body: no jargon without a plain definition beside it; never more than one
  question at a time; never a figure the agent did not just read from a command.
- The refusals in the body, from locked decision 7: no re-baseline, no hygiene waiver and no
  allowed skip without a plain explanation of what it gives up and a yes from the person.
- Run `docs/reference/skill-safety/03-the-checklist.md` against the new skill and record the
  outcome of each of its gates in **Delivered** below, including what was decided about
  `allowed-tools`.
- Have a person invoke it once in a real session and record what happened. Whether a skill with
  no `context` key runs inline is this repo's authors' statement only (research file, "Not
  established", item 2); this run is what settles it.

**Do NOT.** Add an agent file (invariant 1). Touch `bin/harness.js`, `package.json` or any test:
that is phase 2. Write advice about validating a business idea (locked decision 2). Pin the skill
in `skills-lock.json` (locked decision 6).

**First commit:** `founder-guide: the guide skill, inline and in plain English`
**Exit:** `node scripts/harness/guards/skill-verify.cjs --check && node scripts/harness/measure-context.js --check && node scripts/harness/guards/commit-hygiene.cjs --report`

**Delivered.** Landed on 2026-10-07: written, checked and tried once by the owner.

- `.claude/skills/guide/SKILL.md` exists. Frontmatter is `name`, `description`, `argument-hint`.
  The exit command ran green; `guide` reports as UNLOCKED, a warning, like the other three.
- Deviation: the plan names `node bin/harness.js doctor`. `init` does not copy `bin/` into a
  target repo, so the skill uses that command only where the file exists and otherwise runs the
  person's own copy of the harness with `--root .`.
- The skill-safety checklist, gate by gate:
  1. Prose: written and read whole by the lead. Zero-width and comment/blob greps: no hit.
  2. and 3. Bundled files: none, the directory holds `SKILL.md` only. Network: no URL.
  4. Secrets: no hit on the pattern as run. The env-guard denies a shell command that spells the
     checklist's own `process`/`os` environment terms, so those two terms were NOT grepped; the
     body was authored here and names no variable.
  5. Tool scope: `allowed-tools` left absent, as on the three shipped skills. The guide runs
     `doctor`, `init` and `gates.js`, and a narrow list would be this track inventing a key no
     shipped skill uses; the body's refusals (locked decision 7) are prose, not a mechanism.
  6. Provenance: first-party, tracked in this repo; duplicates no installed skill.
  7. and 8. Record: not pinned, by locked decision 6, so no lock change to commit with it.
- Observed: the running session listed `guide` as available without a restart.
- The live try: the owner ran `/guide` in a session of their own on 2026-10-07 and reported that
  it answered in the chat and waited for an answer, and that nothing it said was confusing or
  wrong. That is one person's report of one run, in Claude Code only; no transcript is kept. It
  settles that a skill with no `context` key runs inline there (research file, "Not
  established", item 2). Which of the four jobs the run exercised was not recorded.
- After that try the owner widened the reader from "a solo founder" to anyone who is not a tech
  expert. Three sentences of the skill were reworded to match (the description's trigger words,
  the reader paragraph, one line of job three). The reworded text has NOT been tried by a person.

## Phase 2: init installs the guide, and a test holds the two lists together

**Problem.** The installer copies only the skills named in `SHIPPED_SKILLS` (`bin/harness.js`),
and a packed install carries only what `package.json` `files` names. Nothing compares the two: a
skill in one and not the other reds no gate in a checkout and stops a packed install dead (FG-02).

**Do.**
- Add `guide` to `SHIPPED_SKILLS` in `bin/harness.js`.
- Add `.claude/skills/guide/` to `files` in `package.json`.
- Add `.claude/skills/guide` to `dirs` in `scripts/harness/common.json`, beside the other three,
  so every branch carries the same guide.
- Add one test to `tests/cli.test.js`: every name in `SHIPPED_SKILLS` has a `files` entry, and
  after `init` into a throwaway repo each shipped skill's `SKILL.md` exists there. Export the
  constant from `bin/harness.js` if the test needs it.
- In the same test file, assert the guide's frontmatter has no `context` and no `agent` key
  (invariant 2), so a later edit cannot quietly fork it.
- Run the suite on Node 20 and Node 22 before pushing (FG-03).
- Re-baseline in a commit of its own, subject starting `gates:`, saying the `test` gate moved
  because of the new tests.

**Do NOT.** Rewrite `buildPlan` or change how a skill directory is copied: the `multi-tool`
track's next phase owns that (FG-01). Add a skills key to `tools.json` or a dialect. Change what
`init` writes for `skills-lock.json`.

**First commit:** `founder-guide: init installs the guide skill`
**Exit:** `node bin/harness.js --self-test && node --test tests/cli.test.js && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

**Delivered.** not started

## Phase 3: the README shows a non-tech reader the way in, in pictures

**Problem.** The root `README.md` opens with a definition a developer understands and a non-tech reader
does not. The owner asked for a section near the top that uses pictures instead of technical
explanation.

**Do.**
- Add one section, titled for the reader ("Not a developer? Start here"), directly after the
  opening paragraphs and before "Why this is different". At most about forty lines.
- It holds exactly four things, in this order:
  1. **How it works**, a Mermaid flowchart with five boxes: you describe what you want; the AI
     writes it; the harness checks it; green, keep going; red, the AI is told why and fixes it.
  2. **What the colours mean**, a three-row table: green, red, skipped. One plain sentence each.
  3. **Your first hour**, four numbered steps ending in "type `/guide`".
  4. **What green does not mean**, one short quoted block: not that the idea is good, not that
     customers want it, not that the product is secure.
- No gate figure, no file path and no flag in that section (invariant 6). Technical detail stays
  in the sections below it, unchanged.
- Add one line to "Who it is for" naming the reader who is not a tech expert, and keep "Who it is not for" honest: the
  repo is still not a prompt library.
- Correct every prose count of shipped skills. The research file, section 1, lists the five
  places: the root README's layout block, `CHANGELOG.md`,
  `docs/methods/09-the-phase-lifecycle.md`, `docs/methods/11-adopting-this-in-your-repo.md` and
  `docs/reference/branches/README.md`. Re-find each by searching for the words, not by line number.
- Add a `CHANGELOG.md` entry for the guide and the on-ramp.
- Look at the README on GitHub in a browser, in light and dark mode, and say in **Delivered**
  that you did. No command can check that a diagram draws (FG-06).

**Do NOT.** Write the audience statement the `autonomy-modes` track has reserved in the README
(FG-04): leave it room and do not contradict it. Shorten or reorder the developer sections. Add an
image file or a diagram tool (locked decision 8).

**First commit:** `founder-guide: a visual start-here section in the README`
**Exit:** `node scripts/harness/guards/docs-lint.cjs && node scripts/harness/docs-index.js --check && node scripts/harness/gates.js --check --allow-skip reproducible-build=1`

**Delivered.** not started
