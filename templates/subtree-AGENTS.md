# <SUBTREE>/ — <ONE_LINE_PURPOSE>
<!-- TEMPLATE. Copy to <SUBTREE>/AGENTS.md, fill each <PLACEHOLDER>, delete every comment. Cap: 50 lines. -->
<!-- <SUBTREE>: the directory, repo-relative, e.g. `scripts`. <ONE_LINE_PURPOSE>: what lives under it, in a clause. -->
<!-- THEN add a `nestedOnTouch` ceiling for this file to scripts/harness/context-budget.json (measured bytes + 10%, rounded up to 256). A subtree AGENTS.md with no ceiling fails the `context` gate by name. -->
<!-- A tool that does not load AGENTS.md natively gets a one-line stub beside this file, never a second body: `<SUBTREE>/CLAUDE.md` holding only `@AGENTS.md` (copy templates/CLAUDE.md). The doc gate fails a stub with any other content. -->

Loads when you touch a file under `<SUBTREE>/`. Root `AGENTS.md` applies.

## Invariants

- **<INVARIANT>** <WHY_AND_WHAT_BREAKS>
<!-- <INVARIANT>: a property of THIS subtree that must not move, one bullet each, at most six. -->
<!-- <WHY_AND_WHAT_BREAKS>: the failure that bought the rule, and a `path:line` reference where one exists. An invariant with no reason gets deleted by the next session. -->
<!-- Nothing that is true of the whole repo belongs here: that is the root AGENTS.md, and saying it twice is paying for it twice. -->

## Key files

`<KEY_FILE>` (<WHAT_IT_IS>) · `<KEY_FILE>`
<!-- <KEY_FILE>: the 3 to 8 files a task under this subtree actually opens. A map, not a listing: `Glob` already lists. -->

## The gate

`<SUBTREE_GATE_COMMAND>`, and `--self-test` on any helper you changed.
<!-- <SUBTREE_GATE_COMMAND>: the narrowest command that proves a change here, e.g. `node scripts/harness/gates.js --check --only <gate>`. The whole suite still runs before "done". -->

## Traps

- **<PREFIX>-01** <THE_HAZARD_AND_WHAT_IT_COSTS> `<ANCHOR_PATH>`
<!-- <PREFIX>: 2 to 5 capitals unique to this subtree, so a trap id is unambiguous across docs. -->
<!-- <THE_HAZARD_AND_WHAT_IT_COSTS>: something that already cost a real hour here. Not a possibility: a measured event. -->
<!-- <ANCHOR_PATH>: the file (and line) where the trap lives, so the next reader can check it instead of believing it. -->
