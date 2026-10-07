---
id: research-tool-enforcement-surfaces
kind: research
status: frozen
read_when: planning or reviewing how a guard, a session-start reporter or an autonomy mode behaves under a coding agent other than Claude Code
source: external
---

# ⚠ UNTRUSTED — vendor documentation, read not run

> **PROVENANCE, stated once and applying to every line below: all of it was READ FROM VENDOR
> DOCUMENTATION AND PRACTITIONER WRITEUPS. Not one claim here was produced by running the tool.**
> Nothing in this file has been observed on this machine. Treat every row as a hypothesis with a
> citation, not a measurement. The harness's own standard applies: a mechanism nobody ran is prose.
>
> **This file is NOT yet in the repo.** It is a working copy in a session scratchpad because
> `docs/INDEX.md` and `docs-index.js` are frozen by the `multi-tool` session, and creating
> `docs/tracks/<id>/research/` would make that generated index stale and turn their docs gate red.
> It moves to `docs/tracks/<id>/research/2026-10-06-tool-enforcement-surfaces.md` once phase 1 is
> green. A scratchpad is temporary storage; this needs to land.

## 1. Fail-open is the common default, not the exception

| Tool | Behaviour on a guard that errors, hangs or exits oddly | Read from |
|---|---|---|
| Kimi | fail-open **by vendor design** — any exit other than 0 or 2 permits; docs say hooks "shouldn't serve as sole security barriers" | vendor hooks docs |
| Cursor | fails open on any non-zero exit other than 2 **unless `failClosed: true`** | vendor hooks docs |
| Gemini CLI | any other exit code is a non-fatal warning | vendor config reference |
| Copilot CLI | fails **closed** on exit 2 and on a crash, but **always fails open on timeout** — including for machine-policy hooks | vendor docs |
| Claude Code | `permissions.deny` applies in every mode including `bypassPermissions`; a PreToolUse `allow` cannot override a `deny` or `ask` rule | vendor permission docs |

**Consequence for the dialect layer:** every guard should emit the JSON deny **and** exit 2, stay
fast, and be paired with a declarative deny rule, so a crashed script is not an open door.

## 2. Hook trust fingerprinting silently ungates a fresh clone

- **Codex** records hook trust **by hook hash** and skips a changed hook until re-approved via `/hooks`.
- **Gemini CLI** fingerprints project hooks by **name + command** and treats a changed one as new and untrusted.

So a freshly cloned or freshly pulled repo is a **silently ungated** repo, and nothing announces it.
This is the sharpest trap for a harness distributed as copied files. The remedy is for the
session-start reporter to **assert** that its guards are live rather than assume it, and for the
installer to print the per-tool re-trust step.

## 3. Session-start is not universal

- **No SessionStart event at all:** Antigravity, Windsurf.
- **Exists but cannot ask a question:** Claude Code (injects context + one warning line only), Codex
  ("cannot block session or ask user directly"), Gemini ("cannot pose interactive questions"),
  Cursor (returns env + `additional_context` only).

A tier is therefore needed in which session-start reporting is *structurally impossible*, not merely
switched off. And a mode selector at chat start is prose on 100% of surveyed tools — which is why the
selector belongs in a launcher process instead.

## 4. The human can switch the guards off, and one switch ships in the repo

`disableAllHooks: true` in a **repository** settings file kills every Copilot hook from every source
except machine policy. Codex has `[features] hooks = false` and `--ignore-rules`; Gemini has
`hooksConfig.enabled: false`; Factory has `hooksDisabled`; Cline lets the user toggle `AGENTS.md` off.
Guards are a control on the **model**, never on the **operator** — the docs should say so plainly.

## 5. Instruction-file portability is weaker than the convention implies

- **`AGENTS.md` is not universally honoured.** Aider auto-loads no instruction file at all. Cline lets
  the user toggle it off. Copilot ranks it lowest and declines to define precedence, and GitHub says
  Copilot "may not always follow your custom instructions in exactly the same way every time".
- **Subtree-on-touch loading is rare** — real on Claude Code, Amp, Factory, Augment. **Codex loads at
  startup with a 32 KiB cap that drops the DEEPEST files first**, inverting a nesting design.

## 6. One genuine gift: Codex deny rules have an offline test

Codex `.rules` files are Starlark, return `forbidden`, and are checkable **without running the agent**
via `codex execpolicy check`. That is a deny rule with a `--self-test`, which is this repo's own
discipline arriving from a vendor. Worth exploiting in the `tools` gate.

## 7. Known hole in Claude Code's Bash deny — the point that got truncated earlier

`permissions.deny` entries for Bash match on the command string, so **the same program invoked by a
different path, or wrapped inside `sh -c`, is not matched.** `deny: Bash(curl:*)` does not stop
`/usr/bin/curl`, and it does not stop `sh -c "curl ..."`. The deny is a **shape match on one tool
call**, never a capability boundary — which the repo's README already says about its own guards, and
which stays true of the vendor's.

## Open: needs a run, not a read

These decide real design questions and none can be settled by more reading:
`codex exec` on a ChatGPT OAuth seat · whether a subscription key in a third-party CLI draws seat
quota or silently falls through to pay-as-you-go (Kimi, Z.ai) · whether Claude Code `ask` rules still
prompt under `bypassPermissions` · whether Codex's hook-level `permissionDecision: "ask"` is
implemented · **whether Cursor CLI hooks fire on Windows at all** · the polarity of Codex's granular
approval table · whether Claude Code's SessionStart really supports `initialUserMessage`.
