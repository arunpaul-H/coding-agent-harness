---
id: multi-tool-research-claude-coupling-inventory
kind: research
status: frozen
read_when: "Planning or reviewing any change that makes the harness work under a coding agent other than Claude Code, and you need the exact file:line of each Claude coupling."
question: "Where exactly is this harness coupled to Claude Code, and is each coupling (A) naming only, (B) Claude wire format, or (C) a Claude-only capability with tool-neutral logic behind it?"
answer: "Gates, config, lifecycle and every helper's CLI mode run with no Claude runtime; the coupling is names (CLAUDE.md, .claude/, AGENTS.md buckets), one hook JSON dialect emitted by 5 scripts, and the lead-only AGENTS.md meaning. No config key or installer flag names a target tool."
paths: [".claude/settings.json", ".claude/helpers/**", ".claude/agents/**", ".claude/skills/**", "scripts/harness/**", "bin/harness.js", "harness.config.json", "schema/harness.config.schema.json", "templates/**", "AGENTS.md", "CLAUDE.md", "tests/**"]
commit_at: "none (repo has no commits yet)"
expires: 2026-11-04
source: repo
---

# Claude Code coupling inventory (working tree of 2026-10-05, uncommitted)

Method: Read and Grep over the READ-SET only; nothing was executed. Classes: **A** naming, **B** Claude wire format, **C** Claude-only capability. "Core" is the tool-neutral logic behind a row.

## 1. Helpers: hook mode versus CLI mode
| Helper | Hook entry (stdin reader) | Decider | CLI modes with no runtime | Class and separability |
|---|---|---|---|---|
| `env-guard.cjs` | `main` 527-539, `finish` 518-525 | `decide(raw, st, today)` 224-267 | `--self-test` 528 only; `--rearm-check` 531 prints SessionStart JSON 391-394 | B+C. NOT separated: `decide` parses raw stdin, reads `payload.tool_input` at 232 and returns `hookSpecificOutput` at 263-266. Core: `textOf` 203, `spans` 150, `isLive` 162, `rearmFindings` 309 (plain strings) |
| `phase-guard.cjs` | `main` 620-637 | `gate(raw)` 588-611 wraps `decide(tool, input, read, known, P, fz)` 254 | `--self-test` 621 only | B+C. Output separated (`decide` returns a reason string; `out` 613-618 wraps it). Input not: `tool_name` 595, `tool_input` 605, tool names `Bash`, `PowerShell`, `Edit`, `Write` at 259 and 272, fields `command`, `file_path`, `content`, `new_string` at 255-258 |
| `commit-hygiene.cjs` | `--gate` 1215-1221, `readStdin` 1171 | `gate(raw, ctx)` 815, reads `tool_input.command` 822 | `--report` 1213 (GATE line, `report` 868), `--clear` 1190, `--self-test` 1188 | B+C at the wrapper only (`hookOut` 794-797). Core `analyse(ctx)` 449 and `isGitWrite` 738 are shared with `--report`: already separable |
| `skill-verify.cjs` | `--hook` 976 to `emitHook` 758-789 (SessionStart); `--gate` 990 to `runGate` 662 (PreToolUse) | `verifyAll`, `isPathTool` 632, `targetSkill` 642 | `--check` 979 (GATE line 816), `--json` 1049, `--update` 1027, `--self-test` 972 | B at `emitHook`, `emitDecision` 734-744, `tool_name` 634, `tool_input` 644. Core verify separable. `--gate` is NOT registered in `.claude/settings.json` (only `--hook`, line 45) |
| `docs-lint.cjs` | `--memory-check` 694-721 (no stdin read; emits SessionStart JSON 699-718) | `memoryFindings` 227 | default run is the `docs` gate (exit at 784), `--grandfather` 39, `--self-test` 676 | Gate mode has no wire format. B only in 694-721; A elsewhere (section 6) |
| `doc-frozen.cjs` | none: a library (header 22-27) | predicates | `--self-test` 231 | Neutral. Required by `phase-guard.cjs` and by `scripts/harness/docs-index.js:31` through the literal path `.claude/helpers` (A) |
| `statusline.cjs` | `main` 100-118 | `line(d, branchOf)` 26-37 | `--self-test` 101 only | B+C. Reads `workspace.current_dir`, `cwd`, `model.display_name`, `model.id`, `context_window.used_percentage` (28-33). No gate mode |
| `scripts/harness/branch-sync.js` | `--hook` 694, `hook(ev)` 568-587 | shared evaluation (433 onward) | `--check` 707, `--apply` 702, `--self-test` 692 | B only at 583-586. Core separable |

Shared wire facts: every hook exits 0 and carries its verdict in JSON (`.claude/settings.json:2`, `phase-guard.cjs:630`, `env-guard.cjs:524`, `commit-hygiene.cjs:1220`, `skill-verify.cjs:743`), shaped `{ hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason | additionalContext }, systemMessage }`.
Three decision values are in use: `deny`, `ask` (also the answer to an unparseable payload: `phase-guard.cjs:593`, `env-guard.cjs:229`, `commit-hygiene.cjs:820`, `skill-verify.cjs:684`) and silent allow.
`docs/methods/05-hooks-as-mechanism.md:101-105` already states that the schema belongs to one runtime and nothing emits an equivalent.

## 2. `.claude/settings.json` registrations
| Event | Matcher | Command | Line |
|---|---|---|---|
| PreToolUse | `Bash\|PowerShell\|Read\|Grep\|Glob\|Edit\|Write\|mcp__.*` | `node "$CLAUDE_PROJECT_DIR/.claude/helpers/env-guard.cjs"` (timeout 10) | 7-12 |
| PreToolUse | `Bash\|PowerShell\|mcp__.*` | `... commit-hygiene.cjs" --gate` (timeout 20) | 18-23 |
| PreToolUse | `Bash\|PowerShell\|Edit\|Write\|mcp__.*` | `... phase-guard.cjs"` (timeout 10) | 29-34 |
| SessionStart | none | `... skill-verify.cjs" --hook` | 45 |
| SessionStart | none | `... env-guard.cjs" --rearm-check` | 55 |
| SessionStart | none | `... docs-lint.cjs" --memory-check` | 65 |
| SessionStart | none | `node "$CLAUDE_PROJECT_DIR/scripts/harness/branch-sync.js" --hook` | 75 |
| statusLine | n/a | `node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/statusline.cjs"` | 83-86 |

`permissions.allow` (89-92): `Bash(node .claude/*)`, `Bash(node scripts/harness/*)`. `permissions.deny` (93-98), four entries: two `Read(...)` denies for the first literal in `env.guarded`, in the `./` spelling (94) and the `//**/` spelling (95), then `Bash(node -e*)` (96) and `Bash(node --eval*)` (97). The guarded filename is not spelled in this file because the secret-file guard refuses any write that names it.
All of it is class B (schema) over class C (PreToolUse deny, SessionStart context injection, permission rules). `env-guard.cjs:363-364` reads `permissions.deny` back from `.claude/settings.json` and reports a missing spelling (343).
`CLAUDE_PROJECT_DIR` is also read at `scripts/harness/config.js:68` (root fallback), expanded at `bin/harness.js:745-747` and set at `scripts/harness/measure-context.js:800`.

## 3. `measure-context.js` and `context-budget.json`: what "always-on" means
| Bucket | Source | Hardcoded name | Class |
|---|---|---|---|
| `injected` | `injectedRows` 664-670 | `~/.claude/CLAUDE.md` 666, root `CLAUDE.md` 667, `~/.claude/projects/<flattened root>/memory/MEMORY.md` 668 (dir rule 635-636, 25 KiB clip 663) | A for the root name (`INJECTED_NAME` 689); C for the user-global file and auto-memory |
| `nestedOnTouch` | `nestedRows` 676-682, `walkFind(ROOT, 'CLAUDE.md')` 678 | filename `CLAUDE.md` | A name, C lazy load on touch (17-20, `context-budget.json:30-32`) |
| `policyReads` | `policyFiles` 690-694: every root-level `.md` key of `docs.caps` except `CLAUDE.md` | none in code; `AGENTS.md` arrives via config | Neutral derivation; rows stamped `leadOnly: true` at 859 (section 7) |
| `listing` (ungraded) | `listingRows` 738-777 | `.claude/commands`, `.claude/skills`, `.claude/agents` 759-761; `~/.claude/skills`, `~/.claude/agents` 764-765; plugin cache 719-727 | A+C |
| `hooks` (ungraded) | `hookRows` 793-816 | `.claude/settings.json` 798; events `SessionStart`, `UserPromptSubmit` 806; payload keys `session_id`, `transcript_path`, `hook_event_name` 801-804 | B |
| `groundTruth` | 823-850 | Claude transcript `.jsonl` under `PROJ`; `message.usage.cache_creation_input_tokens` 840-845 | B |

Bucket names are fixed constants (`GRADED_BUCKETS` 144, `SUMMED_BUCKETS` 152, `WORST_BUCKET` 153, `CHECK_NAMES` 890). Generated-block markers default to `<!-- agents:begin -->` and `<!-- agents:end -->` (906-907), overridable per row (924-925).
`context-budget.json` rows: `injected.CLAUDE.md` 82, `nestedOnTouch.templates/CLAUDE.md` 85, `policyReads.AGENTS.md` 88, `generated.policyReads/AGENTS.md` 92. `harness-baseline.json` is a rewritten report, not a list: it mirrors the buckets (17-42) and records Claude hook events (64-89) and a transcript model id (93).

## 4. `bin/harness.js`: the installer
| Copied or written | Source | Destination (hardcoded) | Line |
|---|---|---|---|
| settings, helpers | `.claude/settings.json`, `.claude/helpers/*.{js,cjs,mjs}` | same paths | 481, 483 |
| agents, skills | `SHIPPED_AGENTS` (58), `SHIPPED_SKILLS` (59) | `.claude/agents/<name>`, `.claude/skills/<name>/` | 484-485 |
| scripts | `scripts/harness/*` minus run output and three figure files | same paths | 488-489 |
| figure files | generated in place | `gates.baseline.json` 490, `harness-baseline.json` 491, `context-budget.json` 515 | 490-516 |
| schema, track skeleton | `schema/harness.config.schema.json`, `templates/track/{README,plan,traps,handoff}.md` (60) | same paths | 492-493 |
| config, lock, ignore | generated | `harness.config.json` 496, `skills-lock.json` 497, `.gitignore` 498 | 496-498 |
| instruction files | `templates/CLAUDE.md`, `templates/AGENTS.md`, rendered | root `CLAUDE.md`, `AGENTS.md` (the name list is a literal) | 502-507 |

- `buildConfig` writes Claude names into the generated config: gate commands 244-247, `workDirs` 270, `rootAllow` 271, `docs.caps` 275. `starterBudget` hardcodes `CLAUDE.md` as `injected` and `AGENTS.md` as `policyReads` (423-445).
- `STATIC_IGNORES` names two `.claude/` paths (77-78). `doctor` hardcodes `.claude/settings.json` 831-834, `.claude/helpers` 855 and 870, nested `CLAUDE.md` 915, summary text 918.
- `templates/subtree-CLAUDE.md` and `templates/docs/reference/DOC-STANDARD.md` exist, and no `copy` call in 481-516 names them.
- No notion of a target tool or agent: `init` accepts only `--into`, `--only`, `--force`, `--dry-run` (578-579); `detect` 131-234 probes package manager, test command, docs dir and branch; `harness host` (`hostReport` 1042-1065) describes the machine, not the agent runtime.

## 5. Config seam
| Key | Where | Claude name baked in | Class |
|---|---|---|---|
| `docs.caps` | `harness.config.json:174-179`, `config.js:105`, schema 210-219 | keys `CLAUDE.md`, `AGENTS.md`, `subtreeClaudeMd` | A. Open map: schema 213-218 accepts any key with a positive integer |
| `commitHygiene.rootAllow` | `harness.config.json:137-151`, `config.js:101-102` | `CLAUDE.md`, `AGENTS.md` | A, plain string list |
| `commitHygiene.workDirs` | `harness.config.json:136` | `.claude` (the default at `config.js:100` omits it) | A, plain string list |
| `gates[].command` | `harness.config.json:89, 97, 101` | `.claude/helpers/...` paths | A |

- `TOP_LEVEL` is a closed list (`config.js:116-117`); an unknown top-level key is a hard error (307-312) and the schema sets `additionalProperties: false` at line 7. No listed key holds tools, agents, runtimes or instruction files.
- The nearest existing seam is `docs.caps`: a root-level `.md` cap key is measured by `policyFiles` (`measure-context.js:690-694`), watched by `close-phase.js:229-234`, capped by `capFor` (`docs-lint.cjs:147`) and by `doctor` (`bin/harness.js:907`). A file added that way lands in `policyReads` (lead-only), never in `injected`. `subtreeClaudeMd` is a reserved cap key bound to a filename regex (`docs-lint.cjs:149`, `bin/harness.js:915-916`).

## 6. `docs-lint.cjs`, `docs-index.js` and other name special cases
| Site | What | Class |
|---|---|---|
| `docs-lint.cjs:149`, `259-261` | subtree cap and tree walk keyed on basename `CLAUDE.md` | A |
| `docs-lint.cjs:271`, `321`, `524` | literal `'CLAUDE.md', 'AGENTS.md'` in scope, link corpus and git diff | A |
| `docs-lint.cjs:225` | `~/.claude/projects/<flattened root>/memory/MEMORY.md` (rule 10, 197-222) | C (auto-memory) |
| `docs-index.js:40-42`, `285-292` | `--agents` rewrites the block between the two markers inside root `AGENTS.md` | A for the target file |
| `docs-index.js:197-209`, `217` | reads `.claude/agents/*.md`, requires `model`, `tools`, `description`; table column is `subagent_type` | B (agent frontmatter, spawn parameter name) |
| `phase-guard.cjs:182` | figure rule governs `CLAUDE.md`, `AGENTS.md` and any nested `CLAUDE.md` | A |
| `commit-hygiene.cjs:77`, `305`, `385-390`, `572` | waiver file under `.claude/`, wiring corpus, scanned settings files, orphan-helper directory | A |
| `skill-verify.cjs:75-76`, `88-91`, `656` | roots `.agents/skills` and `.claude/skills`; `~/.claude/settings.json` `enabledPlugins`, `installed_plugins.json` | A for roots, C for plugins |

## 7. The `AGENTS.md` collision: everything that depends on "lead-only"
| Site | Dependence |
|---|---|
| `AGENTS.md:3-7`, `templates/AGENTS.md:4-5` | states leaves do not read it and that a fan-out saves the row once per leaf |
| `CLAUDE.md:80`, `templates/CLAUDE.md:50` | "read by the lead agent only" |
| `docs/methods/01-nested-context.md:34`, `45-47` | tier table and the lead-only split |
| `docs/methods/01-nested-context.md:77-80` | already records that many tools treat `AGENTS.md` as read-by-everyone and that the inversion "does not travel" |
| `measure-context.js:23-25`, `684-694`, `859`, `1029-1030` | bucket defined as what a LEAD opens; `leadOnly: true`; printed as `[lead only]` |
| `measure-context.js:867` | `subagentInjected` sums `injected` rows flagged `subagent` plus the worst nested row; `policyReads` is excluded |
| `context-budget.json:32-34`, `87-97`; `harness-baseline.json:36-42` | `AGENTS.md` budgeted under `policyReads`, allowance keyed `policyReads/AGENTS.md`; recorded row `leadOnly: true` |
| `bin/harness.js:423`, `443-445` | starter budget places `AGENTS.md` in `policyReads` |
| `.claude/agents/implement.md:10-11`, `AGENTS.md:60-61` | a leaf reads the handoff plus the subtree `CLAUDE.md` and nothing else |
| `docs-index.js:285-292`, `AGENTS.md:79-89` | the generated registry (`subagent_type`, model aliases, Claude tool names) is written into `AGENTS.md` |
| `AGENTS.md:14`, `28`, `50`, `74-77` | content assumes `Agent` calls, `run_in_background`, `subagent_type`, built-ins `Explore`, `general-purpose`, `Plan` (C) |
| `tests/context.test.js:123`, `125`, `238`, `318`, `551`, `634` | fixtures and assertions place `AGENTS.md` under `policyReads` |
| `harness.config.json:157-158`, schema 211 | prose calls both files "always-on", which differs from the lead-only wording above |

## 8. Tests that pin Claude names or wire shapes
Counts are matching LINES from Grep in count mode over `tests/`. P0 = `CLAUDE\.md|\.claude/|AGENTS\.md|tool_input|tool_name|permissionDecision|hookSpecificOutput`: 219 lines in 8 of 9 files (`gates.test.js` has none). W = `tool_input|tool_name|permissionDecision|hookSpecificOutput`.

| File | P0 | `CLAUDE\.md` | `AGENTS\.md` | `\.claude/` | W |
|---|---|---|---|---|---|
| `branch-sync.test.js` | 72 | 13 | 37 | 20 | 5 |
| `context.test.js` | 54 | 37 | 16 | 4 | 0 |
| `guards.test.js` | 42 | 1 | 0 | 10 | 31 |
| `docs.test.js` | 24 | 5 | 10 | 10 | 2 |
| `skill-verify.test.js` | 16 | 0 | 0 | 8 | 8 |
| `cli.test.js` | 6 | 5 | 1 | 1 | 0 |
| `lifecycle.test.js` | 4 | 4 | 2 | 0 | 0 |
| `config.test.js` | 1 | 1 | 0 | 0 | 0 |

- `guards.test.js:119` builds the PreToolUse payload (`hook_event_name`, `tool_name`, `tool_input`, `cwd`, `session_id`); `720-735` reads the real `.claude/settings.json` and asserts exactly three PreToolUse entries, each matching `mcp__`.
- SessionStart shape asserted at `skill-verify.test.js:126-127`, `branch-sync.test.js:257-258`, `docs.test.js:820-821`, `guards.test.js:337-338`. `docs.test.js:42` pins the caps keys; `82` and `922-960` pin the `AGENTS.md` markers and `--agents`.
- `CLAUDE_PROJECT_DIR` is scrubbed in 8 files (Grep `CLAUDE_PROJECT_DIR`): cli 28, gates 32, skill-verify 93, context 52, lifecycle 53, branch-sync 53, docs 119, guards 74.
- In-file self-tests pin the same names: `bin/harness.js:1156-1331`, `measure-context.js:377-580`, `docs-lint.cjs:547-558`, `close-phase.js:480-519`, `branch-sync.js:651-668`.

## 9. Agent and skill frontmatter
- `.claude/agents/{explore,implement,research,review}.md` lines 1-6: `name`, `description`, `model`, `tools`. Claude-specific: `model` aliases (`haiku`, `opus`, `inherit`) and `tools` values (`Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch`, `WebSearch`).
- `.claude/skills/plan/SKILL.md` 1-6: `name`, `description`, `argument-hint`, `disable-model-invocation`. `skills/research/SKILL.md` 1-7 adds `context: fork` and `agent: research`; `skills/implement/SKILL.md` 1-8 adds `context: fork`, `agent: implement`, `disable-model-invocation`. `context: fork` plus `agent` is class C: the skill body becomes a forked subagent's prompt (stated at `research/SKILL.md:11-14`).
- `name` and `description` are the only keys also consumed by harness code (`measure-context.js:737`, `docs-index.js:204-209`).

## 10. Hardcoded file lists in branch-sync inputs
- `common.json` `files` 30-37: `AGENTS.md`, `.claude/settings.json`, `.github/workflows/ci.yml`, `.gitattributes`, `docs/reference/DOC-STANDARD.md`, `skills-lock.json`. `dirs` 39-51: `.claude/helpers`, `.claude/agents`, three `.claude/skills/*`, `scripts/harness`, `schema`, `templates`, `tests`, two `docs/reference/*`. `perBranch` 53-58: config plus the three figure files. `sections` 60-62: `CLAUDE.md` except `## 1.`. `ignore` 64-82 names four `.claude/` paths. `branch-sync.js` holds no file list of its own outside its self-test (651-668) and reads `common.json` from the source ref; `harness-baseline.json` holds no list (section 3).

## Not established
- Whether Claude Code really withholds `AGENTS.md` from subagents: not measured here; `01-nested-context.md:77-78` itself says to probe it.
- `tests/` bodies were not read (one range excepted), so section 8 counts lines, not assertions that would fail. `scripts/harness/{gates,handoff-lint,findings-check,split-doc}.js` were only Grepped (`CLAUDE|\.claude|AGENTS`, zero hits). `commit-hygiene.cjs` `analyse` (449-640) was seen through Grep hits only.
- `package.json` `files`, `README.md`, `CONTRIBUTING.md`, `.github/**` and docs outside the READ-SET were not scanned. Why `skill-verify.cjs --gate` exists unregistered is not stated in any file read. Read past the READ-SET: `tests/guards.test.js:712-741`, `scripts/harness/close-phase.js:222-235`.
