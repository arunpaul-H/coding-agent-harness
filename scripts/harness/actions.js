'use strict';
/* ============================================================
   actions.js — an effect that LEAVES this tree happens ONCE, because a ledger says so.

   WHY THIS EXISTS
   Every guard in this repo polices writes INSIDE the tree. Every effect that leaves it
   — git push, gh pr create, gh issue comment, gh release, npm publish, a deploy — is
   ungoverned, and the failure it produces is specific: a long session is COMPACTED or
   restarted, the agent loses the memory that it already pushed, and it pushes again.
   Instructing a model to remember is PROSE, and prose does not hold across a compaction.
   A script that folds a ledger before acting does not have to remember anything.

   PORTED FROM golang/oscar/internal/actions/actions.go (Jonathan Amsterdam, Go team). The
   load-bearing ideas, kept rather than reinvented:
     . two-phase, keyed by an idempotency key: THE ROW IS WRITTEN BEFORE THE EFFECT, so a
       crash leaves a record of an effect that MIGHT have happened, never silence.
     . logging a key that already exists returns false — it does NOT enqueue a second effect.
       That one rule is the whole anti-double-push mechanism.
     . approval is APPENDED DECISION ROWS, never a boolean flag, so a decision carries an
       author and a time and cannot be edited into existence by a later write.
     . a SINGLE denial denies: one 'no' cannot be outvoted by later yeses.

   APPEND-ONLY IS THE WHOLE POINT. A state change is a NEW LINE that supersedes earlier
   lines for the same key; nothing ever rewrites a line already on disk. Reading the ledger
   means folding the lines in order. A truncated or unparseable final line is what a crash
   mid-write looks like, so it is TOLERATED, COUNTED and REPORTED — a half-written line that
   silently vanished is the failure this file exists to prevent.

   THE CONTROL IS NEVER A FIELD ON THE LINE IT CONTROLS. Three rounds of review found the same
   shape three times: the fold read `decisions`, then it read `requiresApproval`, then it read
   `kind` — each one a field on the single hand-writable line a forger owns. The third round
   measured the hole exactly: {"kind":"note","target":"origin/main","done":true} graded
   pass=1 fail=0, exit 0, because a push called a `note` needed no approval. Adding a fourth
   field would have moved the hole a fourth time. So the line no longer gets to say what the
   effect IS, by two independent mechanisms:

     A. THE KEY IS DERIVED, AND IT IS CHECKED. key = sha256(normalised kind | target |
        payloadSha), truncated. The fold RECOMPUTES it for every action row and reports a
        mismatch as damage, by key. The executor recomputes it from the ARGV IT IS ABOUT TO
        RUN — `run ... -- git push origin main` classifies that command, derives kind and
        target from it, and REFUSES unless the derived key equals the row's. Renaming the verb
        changes the key, so the rename is what the check catches. The row's `kind` is now only
        a label on an identity it cannot choose.
     B. KIND IS CROSS-CHECKED AGAINST TARGET, independently of A. A target that leaves this
        tree — origin/..., refs/remotes/..., an https:// or git@ URL, a registry host — under a
        kind the policy calls LOCAL is damage: "kind K claims to stay in-tree but target T
        leaves it". A target that cannot be classified at all under a LOCAL kind is damage too:
        fail closed, because the unclassifiable target is the one to stop.

   Decisions still arrive only as separate appended lines, the requirement still comes only
   from the KIND via the policy table, and a line that tries to set either is DAMAGE, reported
   by line number. An attempt to lower the bar must be loud; silently overriding it teaches
   nothing and hides the attempt.

   WHAT THE DERIVED TARGET IS, AND IS NOT. The classifier is NOT a parse of git's or gh's full
   CLI grammar, and it does not try to be: it is a DETERMINISTIC FINGERPRINT of a command. The
   only property anything here depends on is that the same command always yields the same
   (kind, target) pair — and because `log -- <command>` and `run -- <command>` both derive
   through the one classifier, the two sides agree by construction. A flag shape it parses
   crudely produces an odd-looking target, never a wrong verdict: an odd target still has to
   match the row's key.

   APPROVAL AUTHORITY, AND THE RESIDUAL, STATED BLUNTLY RATHER THAN IMPLIED. `log` mints a
   random CHALLENGE, prints the PLAINTEXT to stderr ONLY, and stores just its sha256 on the
   row. `decide --approve` requires that plaintext and verifies the hash, so an approval
   written by somebody who only ever had the LEDGER is recorded as UNVERIFIED and reported
   separately by --check, and `run` refuses on it. `--who` no longer signs anything: the name
   comes from the observed git identity, and a supplied --who is recorded as a `label` that
   never affects a verdict.
   The plaintext reaches the file only when a decider writes it onto their own decision line,
   which is what makes the verification checkable from the ledger alone; it authorises nothing
   beyond the one key it was minted for, and a key already approved gains nothing from a second
   approval. A DENIAL needs no challenge: nothing should stand between a human and stopping an
   effect, and a denial is final anyway.
   THE CHALLENGE RAISES THE COST OF A SELF-APPROVAL. IT IS NOT PROOF OF A HUMAN. An agent that
   can read the terminal output of `log` can read the challenge and approve itself one command
   later; an agent that can WRITE the ledger can mint whatever it likes. The only real boundary
   is a DENY RULE ON THE LEDGER PATH, so that the agent proposing the effect cannot write the
   file that authorises it — the same conclusion the mode receipt reached. Everything in this
   file is bookkeeping that makes a bypass loud, not a barrier that makes one impossible.

   FIVE INVARIANTS THE FOLD ENFORCES, each because an earlier draft did not and a review
   showed the exact line that defeated it:
     1. An action row's own `decisions` field is IGNORED, and reported. Approval arrives ONLY
        as a separate decision line. Otherwise ONE hand-written first line carrying
        {requiresApproval:true, decisions:[{approved:true}], done:true} folded to "approved,
        done" and the DONE-without-authorisation check — the only finding this gate exists to
        raise — was unreachable.
     2. An action row's own `requiresApproval` is IGNORED for the verdict, and a value that
        DISAGREES with the policy for its kind is reported as damage. Otherwise the same
        writer simply omitted the field, the fold defaulted it to false, and the same check
        went unreachable again through the adjacent field.
     3. `done` is LATCHED. Once any line records a key done, no later line may un-done it. A
        non-monotonic flag meant an appended {"done":false} made `run` stop refusing, and the
        effect fired twice. Same for a recorded result/error: a later line may not blank it.
     4. A line that names a known key and merges NOTHING is damage, counted by line number,
        and an action row carrying a field no reader uses is damage too. A quoted boolean
        ("approved":"true"), a typo ("aproved"), and an `approved` written onto the action row
        itself all used to vanish, so a human who typed an approval read a green ledger that
        contained no approval.
     5. `log`, `decide` and `run` REFUSE on a damaged OR UNREADABLE ledger. Damage means "this
        file may be lying about what already happened"; unreadable means "I could not look at
        all". Both answers are stop, and neither is a skip — a gate that cannot read its
        subject reporting skipped=1 at exit 0 is how blindness gets laundered into green.

   CONCURRENCY. `log` is read-then-append, and two terminals — the multi-agent case this file
   exists for — could both pass the duplicate check and both enqueue. Every read-then-append
   therefore runs under an exclusive lock taken with fs.openSync(path, 'wx'), the one portable
   create-or-fail primitive in Node's built-ins. The lock must never be able to BRICK the
   ledger: see withLedgerLock, stealVerdict and clearHint. Nor may it LITTER one — the ledger's
   home is a track folder where commit-hygiene blocks a stray, so a lock that turns out to be a
   DIRECTORY is removed as one, a park that could not be deleted is swept by the next recovery,
   every retry path is bounded (a persistent EEXIST over an unstattable lock refuses rather than
   spinning), and whatever survives is printed with a command that works on this platform.

   WHAT THIS BUILD DOES NOT DO: execute. `run` prints the plan and stops; --execute refuses.
   Wiring a live `git push` in before the ledger shape has been reviewed is the one mistake
   here with no undo.

   THE LEDGER PATH is a REQUIRED `--ledger <path>`. There is no default: it belongs at
   <tracksDir>/<track>/actions.jsonl, tracksDir comes from scripts/harness/config.js, and that
   seam is not wired here yet. A cwd-relative default is worse than a refusal — two shells at
   different depths silently keep two ledgers, neither sees the other's pending row, and both
   push. An unresolved seam is a hard stop in this repo, not a quiet default.

   NOT IN THE SUITE YET, said here rather than left for a reader to discover: harness.config.json's
   `gates` array does not list `effects`, and there is no tests/ entry for this file. Its
   `--self-test` is therefore its only test, and by this repo's own rule (untested = prose) this
   gate is prose with a GATE line attached until it is registered. Registering it is a change to
   harness.config.json and tests/, both outside this file.

   Zero dependencies (Node built-ins only). Node >= 20. Windows is a first-class box: every
   path goes through node:path and every read tolerates CRLF.

   Run with no command for the usage lines; --check grades a ledger, --self-test proves this.
   ============================================================ */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const GATE = 'effects';
const LOCK_TTL_MS = 30000;   // a read-check-append holding the lock longer than this is wedged

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/* kind + target + payload, hashed, truncated to 16 hex chars because a human retypes this
   on the command line and a key nobody will retype is a key nobody uses. The point is
   determinism, not secrecy: the SAME effect described twice must produce the same key, or
   the duplicate check below never fires — which is why the KIND IS NORMALISED first ('git
   push' and 'push' are one verb, so they are one key) and the target is trimmed.
   keyForSha is the primitive, because every consumer that matters has the payload's SHA and
   not the payload: the fold recomputing a row's key, and the executor recomputing it from the
   command it holds. keyFor is the convenience wrapper for a caller that has the bytes. */
const keyForSha = (kind, target, payloadSha) => sha256(normalizeKind(kind) + '|' + String(target == null ? '' : target).trim() + '|' + String(payloadSha == null ? '' : payloadSha)).slice(0, 16);
const keyFor = (kind, target, payload) => keyForSha(kind, target, sha256(payload == null ? '' : payload));

/* "Recorded" means something a later line must not erase. '' counts as empty because a blank
   result is indistinguishable from no result to every reader downstream. */
const isBlank = (v) => v === null || v === undefined || v === '';

/* ---------- the approval policy ----------
   A ROW THAT DECLARES ITS OWN NEED FOR APPROVAL IS NOT A CONTROL. The requirement is a
   property of the KIND of effect, so it lives here, in code, as a table — not on the line a
   forger writes. grade() and `run` read THIS; they never read the row's field.

   FAIL CLOSED. ESCAPES names the effects that leave this tree and therefore require approval.
   LOCAL names the ones that do not. Anything else — a verb nobody has classified — REQUIRES
   approval, because an unclassified verb is exactly the one to stop. Adding a kind here is a
   deliberate, reviewable edit; omitting a field from a ledger line is not.

   The field is still WRITTEN onto the row, because a human reading the JSONL should see which
   bar applied. It is never read back. A row whose field DISAGREES with this table is damage in
   BOTH directions: lowering the bar is an attempt to forge, and raising it is a claim the
   policy does not support — either way the line is lying about the rule that will be applied. */
const KIND_ESCAPES = new Set([
  'push', 'force-push', 'tag-push', 'pr-create', 'pr-merge', 'pr-close', 'pr-comment',
  'issue-create', 'issue-comment', 'review-submit', 'release', 'release-publish', 'publish',
  'deploy', 'rollback', 'gist-create', 'workflow-dispatch', 'webhook', 'email', 'post',
]);
const KIND_LOCAL = new Set([
  'commit', 'tag', 'branch', 'stash', 'checkout', 'merge-local', 'rebase-local',
  'fetch', 'clone', 'pull', 'note', 'scratch-write',
  'local',   // what the classifier returns for a command it recognises as nothing that leaves
]);

/* 'git push' and 'GIT_PUSH' are the same verb to a human, so they are the same verb here. The
   normalisation is deliberately small: lowercase, collapse separators, drop a leading tool
   name. Anything it fails to recognise falls through to "requires approval". */
const normalizeKind = (kind) => String(kind == null ? '' : kind).trim().toLowerCase()
  .replace(/[\s_]+/g, '-')
  .replace(/^(git|gh|npm|yarn|pnpm|docker|hub)-/, '');

function approvalPolicy(kind) {
  const k = normalizeKind(kind);
  if (KIND_ESCAPES.has(k)) return { required: true, kind: k, why: k + ' leaves this tree' };
  if (KIND_LOCAL.has(k)) return { required: false, kind: k, why: k + ' stays inside this tree' };
  return { required: true, kind: k, why: 'kind ' + JSON.stringify(String(kind)) + ' is not in the policy table — fail closed' };
}

/* ---------- does this TARGET leave the tree? ----------
   The second, independent mechanism (see B in the header). Three answers, not two: leaves=true,
   leaves=false, and leaves=null for "I cannot tell" — and null under a LOCAL kind is damage,
   because fail-closed on an unclassifiable target is the whole point of having a third answer.
   The host/registry rule is a HEURISTIC and is written as one: a dotted name whose last label
   is a common TLD reads as somewhere else. 'notes.md' does not match (md is not in the list);
   'registry.npmjs.org' does. A heuristic that admits its shape is still a mechanism, and the
   kinds it governs are the ones that claimed to stay home. */
const REMOTE_NAMES = new Set(['origin', 'upstream', 'fork', 'downstream', 'remote', 'github', 'gitlab', 'heroku']);
const REGISTRY_NAMES = new Set(['npm', 'npmjs', 'registry.npmjs.org', 'pypi', 'pypi.org', 'crates.io', 'rubygems.org', 'ghcr.io', 'docker.io', 'hub.docker.com', 'quay.io']);
const HOSTISH = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|org|net|io|dev|app|sh|co|ai|cloud|run|gov|edu)(\/|:|$)/i;

function targetEscapes(target) {
  const t = String(target == null ? '' : target).trim();
  if (!t) return { leaves: null, why: 'the target is empty, so nothing can be said about where it goes' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return { leaves: true, why: 'it is a URL' };
  if (/^[^\s/@]+@[^\s:/]+:/.test(t)) return { leaves: true, why: 'it is an scp-style git URL (user@host:path)' };
  if (/^refs\/remotes\//i.test(t)) return { leaves: true, why: 'it is a refs/remotes/ ref' };
  const head = t.split(/[/\\:]/)[0].toLowerCase();
  if (REMOTE_NAMES.has(head)) return { leaves: true, why: 'it starts at the remote ' + JSON.stringify(head) };
  if (REGISTRY_NAMES.has(head) || REGISTRY_NAMES.has(t.toLowerCase())) return { leaves: true, why: 'it names the registry ' + JSON.stringify(head) };
  if (HOSTISH.test(t)) return { leaves: true, why: 'it looks like a host or registry name' };
  if (/^HEAD([~^@]|$)/.test(t)) return { leaves: false, why: 'it is HEAD' };
  if (/^refs\/(heads|tags|notes|stash)\//i.test(t)) return { leaves: false, why: 'it is a local ref' };
  if (/^[\w.@~^/\\ -]+$/.test(t)) return { leaves: false, why: 'it is a bare ref or an in-tree path' };
  return { leaves: null, why: 'it matches no shape this file can classify' };
}

/* The cross-check itself, pure so both the fold and the `log` CLI share one answer: a kind the
   POLICY calls local may not carry a target that leaves, or one nobody can classify. The
   converse is NOT damage — an escaping kind aimed at a local-looking target (a push to a path
   remote, say) is odd but not a lie about the bar, and the bar is already the higher one. */
/* NAMED RESIDUAL, because an exemption nobody can see is a hole. Three local verbs legitimately
   name a remote — fetch, clone and pull contact one and bring things IN — so the cross-check
   cannot fire on them, and a hand-written {"kind":"fetch","target":"origin/main","done":true}
   therefore passes it. What still catches that line is the EXECUTOR: `git push` classifies as
   `push`, whose key differs, so the run is refused. The set is closed and small on purpose; any
   local kind added later is covered by the rule, not by this exception. */
const KIND_READS_REMOTE = new Set(['fetch', 'clone', 'pull']);

function kindTargetConflict(kind, target) {
  const policy = approvalPolicy(kind);
  if (policy.required) return null;                   // the bar is already the high one
  if (KIND_READS_REMOTE.has(policy.kind)) return null;
  const t = targetEscapes(target);
  if (t.leaves === true) return 'kind ' + JSON.stringify(policy.kind) + ' claims to stay in-tree but target ' + JSON.stringify(String(target)) + ' leaves it (' + t.why + ')';
  if (t.leaves === null) return 'kind ' + JSON.stringify(policy.kind) + ' claims to stay in-tree but target ' + JSON.stringify(String(target)) + ' cannot be classified (' + t.why + ') — fail closed';
  return null;
}

/* ---------- the classifier: an ACTUAL argv -> a kind and a target ----------
   THE EXECUTOR DERIVES THE KIND FROM THE COMMAND IT IS ABOUT TO RUN. Nothing here reads a
   ledger row. Determinism is the only contract (see the header): the same argv must always
   produce the same pair, because that pair is hashed into the key both sides compare.
   Unrecognised commands classify as 'local' rather than as a guess — and that is SAFE here
   only because of what happens next: a 'local' classification produces a 'local' key, which
   cannot equal the key of a row logged as a push, so the executor refuses. Fail-closed lives
   in the key comparison, not in a pessimistic default that would refuse every real command. */
const RUNNERS = new Set(['sudo', 'env', 'npx', 'pnpx', 'bunx', 'dlx', 'time', 'nice']);
// NOT '-u': `git push -u origin main` spells a BOOLEAN there, and consuming 'origin' as its
// value would quietly change the derived target of the most ordinary push there is.
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '-o', '--push-option', '--receive-pack', '--upload-pack', '-m', '--message', '-F', '--file']);
const GH_VALUED = new Set(['-R', '--repo', '-t', '--title', '-b', '--body', '-F', '--body-file', '-B', '--base', '-H', '--head', '-l', '--label', '-a', '--assignee', '-m', '--milestone', '-p', '--project', '-r', '--reviewer', '--notes', '--notes-file', '--tag', '--target', '-f', '--field', '-X', '--method', '--raw-field', '--ref', '--subject']);
const DEPLOY_VALUED = new Set(['-e', '--env', '--environment', '--stage', '--target', '-c', '--config', '--project', '--name']);
const GIT_LOCAL_SUBS = { commit: 'commit', tag: 'tag', branch: 'branch', stash: 'stash', checkout: 'checkout', switch: 'checkout', merge: 'merge-local', rebase: 'rebase-local', fetch: 'fetch', clone: 'clone', pull: 'pull', add: 'local', status: 'local', diff: 'local', log: 'local', show: 'local', restore: 'local', reset: 'local' };

const toolName = (a) => path.basename(String(a == null ? '' : a).trim().replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh)$/, '');
const flagOf = (a) => (a.indexOf('=') > 0 ? a.slice(0, a.indexOf('=')) : a);

/* Walk an argv once: the first bare word is the subcommand, the rest split into positionals and
   a lookup of flag -> value. `valued` names the flags whose NEXT argument is their value, so a
   `-m "fix thing"` message is never mistaken for a positional target. */
function splitArgs(args, valued) {
  const pos = [];
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--') continue;
    if (a.length > 1 && a[0] === '-') {
      const f = flagOf(a);
      if (a.indexOf('=') > 0) { flags.set(f, a.slice(a.indexOf('=') + 1)); continue; }
      if (valued.has(f) && i + 1 < args.length) { flags.set(f, String(args[i + 1])); i++; continue; }
      flags.set(f, true);
      continue;
    }
    pos.push(a);
  }
  return { pos, flags };
}
const firstOf = (flags, names) => { for (const n of names) { const v = flags.get(n); if (typeof v === 'string') return v; } return null; };

function classifyArgv(argv) {
  const raw = (argv || []).map((a) => String(a == null ? '' : a)).filter((a) => a !== '');
  const no = (why) => ({ kind: 'local', target: '', why, tool: '', sub: '', command: raw.join(' ') });
  if (!raw.length) return no('an empty command classifies as nothing');
  let i = 0;
  while (i < raw.length - 1 && RUNNERS.has(toolName(raw[i]))) i++;   // npx/sudo/env wrappers
  const tool = toolName(raw[i]);
  const rest = raw.slice(i + 1);
  const command = raw.slice(i).join(' ');
  const out = (kind, target, why) => ({ kind, target, why, tool, sub: '', command });

  if (tool === 'git') {
    const { pos, flags } = splitArgs(rest, GIT_VALUED);
    const sub = (pos[0] || '').toLowerCase();
    const after = pos.slice(1);
    const r = (kind, target, why) => Object.assign(out(kind, target, why), { sub });
    if (sub === 'push') {
      const remote = after[0] || '(default remote)';
      const refs = after.slice(1);
      const target = refs.length ? remote + '/' + refs.join(',') : remote;
      const forced = flags.has('--force') || flags.has('-f') || flags.has('--force-with-lease') || flags.has('--force-if-includes');
      if (forced) return r('force-push', target, 'git push with a force flag');
      if (flags.has('--tags') || flags.has('--follow-tags') || refs.some((x) => /^refs\/tags\//i.test(x))) return r('tag-push', target, 'git push of tags');
      return r('push', target, 'git push');
    }
    if (Object.prototype.hasOwnProperty.call(GIT_LOCAL_SUBS, sub)) {
      const k = GIT_LOCAL_SUBS[sub];
      const why = KIND_READS_REMOTE.has(k) ? 'git ' + sub + ' contacts a remote but brings things IN; nothing leaves' : 'git ' + sub + ' stays in this tree';
      return r(k, after.join(' ') || (k === 'commit' ? 'HEAD' : sub), why);
    }
    return r('local', ('git ' + [sub].concat(after).join(' ')).trim(), 'git ' + (sub || '(no subcommand)') + ' is not a verb this table classifies as leaving');
  }

  if (tool === 'gh' || tool === 'hub') {
    const { pos, flags } = splitArgs(rest, GH_VALUED);
    const sub = (pos[0] || '').toLowerCase();
    const verb = (pos[1] || '').toLowerCase();
    const repo = firstOf(flags, ['--repo', '-R']) || '(default repo)';
    const arg = pos[2] ? '#' + pos[2] : '';
    const target = repo + arg;
    const r = (kind, why) => Object.assign(out(kind, target, why), { sub: sub + (verb ? ' ' + verb : '') });
    const MAP = {
      'pr create': 'pr-create', 'pr merge': 'pr-merge', 'pr close': 'pr-close', 'pr comment': 'pr-comment',
      'pr review': 'review-submit', 'pr edit': 'pr-comment', 'pr ready': 'pr-comment',
      'issue create': 'issue-create', 'issue comment': 'issue-comment', 'issue close': 'issue-comment', 'issue edit': 'issue-comment',
      'release create': 'release', 'release upload': 'release', 'release edit': 'release', 'release delete': 'release',
      'gist create': 'gist-create', 'workflow run': 'workflow-dispatch', 'repo create': 'post', 'secret set': 'post',
    };
    const k = MAP[sub + ' ' + verb];
    if (k) return r(k, 'gh ' + sub + ' ' + verb);
    if (sub === 'api') {
      const method = String(firstOf(flags, ['--method', '-X']) || 'GET').toUpperCase();
      const writes = method !== 'GET' || flags.has('--field') || flags.has('-f') || flags.has('--raw-field');
      return Object.assign(out(writes ? 'post' : 'local', (pos[1] || repo) + (writes ? ' [' + method + ']' : ''), 'gh api with method ' + method), { sub: 'api' });
    }
    return r('local', 'gh ' + (sub || '(no subcommand)') + ' ' + verb + ' is not a verb this table classifies as leaving');
  }

  if (tool === 'npm' || tool === 'pnpm' || tool === 'yarn' || tool === 'bun') {
    const { pos, flags } = splitArgs(rest, new Set(['--registry', '--tag', '--access', '--otp', '--workspace', '-w']));
    const sub = (pos[0] || '').toLowerCase();
    const r = (kind, target, why) => Object.assign(out(kind, target, why), { sub });
    if (sub === 'publish') return r('publish', firstOf(flags, ['--registry']) || 'registry.npmjs.org', tool + ' publish uploads to a registry');
    if (sub === 'deprecate' || sub === 'unpublish' || sub === 'dist-tag') return r('publish', firstOf(flags, ['--registry']) || 'registry.npmjs.org', tool + ' ' + sub + ' changes what a registry serves');
    return r('local', (tool + ' ' + [sub].concat(pos.slice(1)).join(' ')).trim(), tool + ' ' + (sub || '(no subcommand)') + ' stays local');
  }

  // A DEPLOY VERB, whatever the tool: wrangler/vercel/fly/sst/netlify/serverless all spell it
  // the same way, and the verb is the part that matters. 'rollback' is its own kind because the
  // policy table already distinguishes it.
  const { pos, flags } = splitArgs(rest, DEPLOY_VALUED);
  const verbs = pos.map((x) => x.toLowerCase());
  const env = firstOf(flags, ['--env', '--environment', '--stage', '-e']) || (verbs.length > 1 ? verbs[1] : '');
  if (verbs.includes('rollback')) return out('rollback', tool + (env ? '/' + env : ''), tool + ' rollback changes what is deployed');
  if (verbs.includes('deploy') || verbs.includes('deployment') || (tool === 'wrangler' && verbs.includes('publish')) || (tool === 'vercel' && flags.has('--prod'))) {
    return out('deploy', tool + (env ? '/' + env : ''), tool + ' deploys');
  }
  if (tool === 'curl' || tool === 'wget') {
    const c = splitArgs(rest, new Set(['-X', '--request', '-d', '--data', '--data-raw', '--data-binary', '-H', '--header', '-o', '--output', '-u', '--user', '-T', '--upload-file']));
    const url = c.pos.find((x) => /^[a-z][a-z0-9+.-]*:\/\//i.test(x));
    const method = String(firstOf(c.flags, ['-X', '--request']) || (c.flags.has('-d') || c.flags.has('--data') || c.flags.has('-T') || c.flags.has('--upload-file') ? 'POST' : 'GET')).toUpperCase();
    const writes = method !== 'GET' || c.flags.has('--post-data') || c.flags.has('--post-file');
    if (url && writes) return out('webhook', url, tool + ' sends a ' + method + ' to a URL');
    // A read is INBOUND, so it is the same family as fetch/clone/pull — and it has to be, or a
    // 'local' kind would carry a URL target and contradict the cross-check.
    return out('fetch', url || tool, tool + ' with no write method only reads');
  }
  return out('local', (tool + ' ' + pos.join(' ')).trim(), 'no rule in this classifier matches ' + JSON.stringify(tool) + ', so it is treated as staying in-tree — the key comparison, not this default, is what refuses a mismatch');
}

/* Every field any reader of an action row uses. Anything else on the row is damage (INVARIANT
   4): `approved` written onto the action row was invisible, so a human who typed an approval
   there saw no complaint anywhere. */
const ACTION_FIELDS = new Set(['kind', 'key', 'target', 'payloadSha', 'challengeSha', 'requiresApproval', 'decisions', 'done', 'result', 'error', 'logged_at']);

/* THE CHALLENGE, verified. `log` printed a random plaintext to stderr ONCE and stored only its
   sha256 here, so a decision line that carries the plaintext proves its writer saw that
   terminal. It proves nothing more than that — see the residual in the header. A row with no
   stored challenge can carry no verified decision at all, which is the honest answer for a
   hand-written row: it was never issued a challenge, so nothing can have met it. */
function verifyChallenge(row, plain) {
  if (!row || typeof row.challengeSha !== 'string' || !row.challengeSha) return { ok: false, why: 'the action row stores no `challengeSha`, so no decision under it can be verified' };
  if (typeof plain !== 'string' || !plain) return { ok: false, why: 'the decision line carries no `challenge` plaintext' };
  return sha256(plain) === row.challengeSha ? { ok: true, why: 'the challenge hashes to the one stored when the effect was logged' } : { ok: false, why: 'the `challenge` does not hash to the stored challengeSha' };
}

/* One remedy per CAUSE, named where the cause is found rather than guessed from the fact that
   something failed. --check prints the fixes the findings actually carry, in order. */
const FIX = {
  repair: 'the ledger is APPEND-ONLY: review the damaged line by hand and append the correction — never rewrite a line already on disk',
  mislabel: 'a row whose key is not keyFor(kind|target|payloadSha), or whose local kind points somewhere that leaves the tree, is not the effect it names: treat it as a mislabelling attempt, and re-log the effect under its real kind',
  unverified: 'an UNVERIFIED approval authorises nothing. The challenge was printed ONCE, to stderr, by `log`; if it is lost, no approval for that key can ever verify — re-log the effect with a changed payload (new key, new challenge) rather than accepting the unverified line',
  doneUnauth: 'an effect recorded done without approval must be reviewed by hand — the effect ALREADY HAPPENED',
  blind: 'make the ledger readable — a permission, a process holding the file, or a path that is now a directory — then re-run --check',
  duplicate: 'two pending rows for one effect would fire it twice: decide which row is real, and close the other with an appended error state row',
  orphan: 'a decision or state row under an unknown key decides nothing: check the key, then append it again under the key an action row actually logged',
};

/* ---------- the fold ----------
   `lines` holds raw JSONL strings, or already-parsed objects (the self-test feeds literals,
   so most of it needs no scratch directory). Three line shapes, told apart by their fields
   because the row on disk carries no `type` tag: `kind` = an action row, the first appearance
   of a key; `approved` = a decision row under an existing key; otherwise a state row merged
   over the row it names. It returns the folded state AND everything wrong with the file,
   because a reader that quietly drops lines is how a lost effect becomes invisible. */
function fold(lines) {
  const rows = new Map();
  const order = [];
  const bad = [];        // { at, why, fix } — unparseable, forged, or merging nothing
  const duplicates = []; // action rows whose key was already present — the re-enqueue bug
  const orphans = [];    // decision/state rows naming a key no action row ever logged
  // THE FIX TRAVELS WITH THE FINDING. --check used to choose one remedy by `else if (fail)`, so
  // a truncated line printed "the effect ALREADY HAPPENED" — it asserted an authorisation
  // incident that nothing had reported. A remedy guessed after the fact is not a remedy.
  const damage = (at, why, fix) => bad.push({ at, why, fix: fix || FIX.repair });

  (lines || []).forEach((line, i) => {
    const at = i + 1;
    let obj = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t) return;                               // a blank line is not data, not damage
      try { obj = JSON.parse(t); } catch { damage(at, 'unparseable — a crash mid-write, or a hand edit'); return; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { damage(at, 'not a JSON object'); return; }
    if (typeof obj.key !== 'string' || !obj.key) { damage(at, 'carries no usable `key`'); return; }

    if (typeof obj.kind === 'string') {
      if (rows.has(obj.key)) { duplicates.push(obj.key); return; }  // keep the FIRST; the copy is the finding
      // INVARIANT 1. Approval written into existence by the FIRST line is the forgery this
      // ledger exists to detect, so the field is ignored AND the attempt is reported: a
      // silently dropped field would let a caller keep trying until something changed.
      if (obj.decisions !== undefined) damage(at, 'action row carries an inline `decisions` field — approval may arrive ONLY as a separate decision line, so it was IGNORED');
      // INVARIANT 2. The requirement comes from the kind, never from the row. A row that
      // disagrees with the policy is reported in both directions; see the policy table.
      const policy = approvalPolicy(obj.kind);
      if (obj.requiresApproval !== undefined && obj.requiresApproval !== policy.required) {
        damage(at, 'row declares requiresApproval=' + JSON.stringify(obj.requiresApproval) + ' but policy says ' + policy.required + ' (' + policy.why + ') — a row cannot set its own bar, so the POLICY was applied and this line is a finding');
      }
      // INVARIANT 4, action-row half: a field no reader uses is not a comment, it is a line
      // somebody expected to do something. `approved` here is the live case.
      const stray = Object.keys(obj).filter((f) => !ACTION_FIELDS.has(f));
      if (stray.length) damage(at, 'action row carries ' + stray.join(', ') + ' — no reader uses ' + (stray.length > 1 ? 'those fields' : 'that field') + '; a decision or a state change must be its OWN appended line, so it was IGNORED');
      const tgt = typeof obj.target === 'string' ? obj.target : '';
      const psha = typeof obj.payloadSha === 'string' ? obj.payloadSha : '';
      // MECHANISM A (header). The key is DERIVED from kind|target|payloadSha, so a row carrying
      // a key of its own choosing names an effect nobody can reproduce — and renaming the verb
      // to something local changes the key, which is exactly how the mislabelling class dies.
      const wantKey = keyForSha(obj.kind, tgt, psha);
      if (obj.key !== wantKey) damage(at, 'key ' + obj.key + ' is not keyFor(kind=' + JSON.stringify(normalizeKind(obj.kind)) + ', target=' + JSON.stringify(tgt) + ', payloadSha=' + (psha ? psha.slice(0, 12) + '…' : '(absent)') + ') = ' + wantKey + ' — the key is DERIVED from the effect, so this row names an effect it cannot be checked against', FIX.mislabel);
      // MECHANISM B (header), independent of A: a self-consistent row can still lie by calling
      // a remote target a local verb. THIS is the measured hole — {"kind":"note",
      // "target":"origin/main","done":true} graded green until this line existed.
      const conflict = kindTargetConflict(obj.kind, tgt);
      if (conflict) damage(at, conflict + ' — the POLICY for the kind was applied, and this line is a finding', FIX.mislabel);
      rows.set(obj.key, {
        kind: obj.kind,
        key: obj.key,
        target: tgt,
        payloadSha: psha,
        challengeSha: typeof obj.challengeSha === 'string' ? obj.challengeSha : null,
        derivedKey: wantKey,
        keyMatches: obj.key === wantKey,
        conflict,
        at,                                         // the line it came from, so a row-level finding can point at it
        requiresApproval: policy.required,          // from the TABLE; the row's field is not read
        approvalWhy: policy.why,
        declaredRequiresApproval: obj.requiresApproval === undefined ? null : obj.requiresApproval,
        decisions: [],                              // never seeded from the line; see above
        done: obj.done === true,
        result: obj.result === undefined ? null : obj.result,
        error: obj.error === undefined ? null : obj.error,
        logged_at: obj.logged_at || null,
      });
      order.push(obj.key);
      return;
    }

    const row = rows.get(obj.key);
    if (!row) { orphans.push(obj.key); return; }     // a decision nothing can read is not a decision

    // INVARIANT 4. `merged` is the whole point of this block: a line that reaches the end
    // having changed nothing is reported, never dropped. {"approved":"true"} from a shell
    // that quoted the boolean, and a misspelled {"aproved":true}, are the live cases.
    let merged = false;

    if (obj.approved !== undefined) {
      if (typeof obj.approved !== 'boolean') damage(at, '`approved` is ' + JSON.stringify(obj.approved) + ', not a boolean — NO decision was recorded');
      else {
        // The decision is RECORDED either way, and its authority is recorded WITH it. A hand
        // appended {"approved":true,"name":"nobody-checked-this"} used to count exactly as much
        // as a real one; now it counts as an UNVERIFIED decision and is reported as one.
        const v = verifyChallenge(row, obj.challenge);
        if (!v.ok && obj.challenge !== undefined) damage(at, 'carries a `challenge` for ' + obj.key + ' that does not verify (' + v.why + ') — the decision was recorded UNVERIFIED', FIX.unverified);
        row.decisions.push({
          name: typeof obj.name === 'string' && obj.name ? obj.name : 'unknown',
          label: typeof obj.label === 'string' && obj.label ? obj.label : null,   // free text; never read for a verdict
          time: obj.time || null,
          approved: obj.approved,
          verified: v.ok,
          verifyWhy: v.why,
        });
      }
      merged = true;
    }

    // A state row supersedes: later line wins for the fields it names, and only those —
    // except where INVARIANT 3 forbids an erasure.
    if (obj.done !== undefined) {
      if (typeof obj.done !== 'boolean') damage(at, '`done` is ' + JSON.stringify(obj.done) + ', not a boolean — nothing was merged');
      else if (obj.done) row.done = true;
      else if (row.done) damage(at, 'sets `done` false on a key already recorded done — completion is INDELIBLE, so the line was IGNORED');
      merged = true;
    }
    if (obj.result !== undefined) {
      if (isBlank(obj.result) && !isBlank(row.result)) damage(at, 'blanks a `result` already recorded — a recorded outcome is INDELIBLE, so the line was IGNORED');
      else row.result = obj.result;                 // a different non-empty value still supersedes; both lines stay on disk
      merged = true;
    }
    if (obj.error !== undefined) {
      if (isBlank(obj.error) && !isBlank(row.error)) damage(at, 'blanks an `error` already recorded — a recorded outcome is INDELIBLE, so the line was IGNORED');
      else row.error = obj.error;
      merged = true;
    }

    if (!merged) damage(at, 'names key ' + obj.key + ' but none of approved/done/result/error — NOTHING was merged (a typo, or a quoted boolean)');
  });
  return { rows, order, bad, duplicates, orphans, missing: false, blind: false, why: '' };
}

/* TRUE only when somebody actually decided AND nobody denied. Silence is not approval, so
   zero decisions is false; a denial is final, so a 'no' plus two later 'yes' rows is still
   false. Oscar's rule, kept: the opposite rule is how an effect gets approved by attrition. */
function approved(row) {
  const d = (row && row.decisions) || [];
  if (d.length === 0) return false;
  return !d.some((x) => x && x.approved === false);
}

/* The same rule, plus authority: at least one approval that MET THE CHALLENGE, and no denial.
   A denial needs no challenge — anyone may stop an effect, and a denial that had to be
   authenticated would be a bar on the conservative answer. `run` reads this one. */
function approvedVerified(row) {
  const d = (row && row.decisions) || [];
  if (d.some((x) => x && x.approved === false)) return false;
  return d.some((x) => x && x.approved === true && x.verified === true);
}
const unverifiedApprovals = (row) => ((row && row.decisions) || []).filter((x) => x && x.approved === true && !x.verified);

/* INVARIANT 5, as a pure predicate so every caller shares one answer. Two states mean "what
   already happened may not be in here": damage (a truncated done-row folds to done=false, and
   proceeding re-runs an effect that already fired) and BLINDNESS (the file exists and could not
   be read at all). Neither is a skip. */
function integrity(folded) {
  const f = folded || {};
  if (f.blind) return { ok: false, why: f.why + ' — nothing may be enqueued, decided or run against a ledger that cannot be read.' };
  const n = (f.bad || []).length + (f.duplicates || []).length + (f.orphans || []).length;
  if (n === 0) return { ok: true, why: '' };
  return { ok: false, why: n + ' damaged or unaccountable line(s) in the ledger — it may not record an effect that already fired. Run --check and repair by hand before any effect.' };
}

/* ---------- the verdict ----------
   One unit per row, plus one per damaged line and one per duplicate append, so the TOTAL is
   load-bearing: a row deleted to make the figure nicer lowers the total, and comparing only
   `pass` cannot tell that from a green run. */
function grade(folded) {
  const problems = [];
  const fixes = [];
  const needFix = (fix) => { if (fix && fixes.indexOf(fix) < 0) fixes.push(fix); };
  const f = folded || {};
  // BLINDNESS IS A FAILURE, NOT A SKIP. A ledger that exists and cannot be read may hold a
  // pending unapproved push; reporting skipped=1 at exit 0 lets `--allow-skip effects=1` turn
  // "I could not look" into green. Only an ABSENT ledger may declare a skip.
  if (f.blind) {
    problems.push(f.why);
    problems.push('a ledger that exists but cannot be read may hold a pending or unapproved effect — blindness is a FAILURE, never a skip');
    return { pass: 0, fail: 1, skipped: 0, total: 1, problems, skips: [], fixes: [FIX.blind] };
  }
  if (f.missing) {
    // A declared skip, never a silent pass: there is no ledger to grade yet.
    return { pass: 0, fail: 0, skipped: 1, total: 1, problems, skips: ['no ledger file — nothing to grade'], fixes: [] };
  }
  for (const b of f.bad) { problems.push('line ' + b.at + ': ' + b.why); needFix(b.fix || FIX.repair); }
  for (const key of f.duplicates) { problems.push(key + ': appended a second time as a fresh pending row'); needFix(FIX.duplicate); }
  for (const key of f.orphans) { problems.push(key + ': decision or state row for a key no action row logged'); needFix(FIX.orphan); }
  let pass = 0;
  let fail = f.bad.length + f.duplicates.length + f.orphans.length;
  for (const key of f.order) {
    const row = f.rows.get(key);
    const found = [];
    // A ROW WHOSE IDENTITY DOES NOT CHECK OUT IS NOT AN ACCOUNTED-FOR EFFECT. The damaged LINE is
    // counted above and says what is wrong with it; this says the ROW must not land in `pass` and
    // be read as "accounted for and authorised" when nothing can say what effect it names. One
    // line, pointing at the line that holds the detail, rather than the same words twice.
    if (!row.keyMatches || row.conflict) {
      found.push(key + ' (' + row.kind + ' -> ' + row.target + '): NOT ACCOUNTED FOR — this row\'s own identity does not check out; see the line ' + row.at + ' finding(s) above');
      needFix(FIX.mislabel);
    }
    if (row.done && row.requiresApproval && !approved(row)) {
      found.push(key + ' (' + row.kind + ' -> ' + row.target + '): DONE without authorisation — approval was required because ' + row.approvalWhy);
      needFix(FIX.doneUnauth);
    }
    // AUTHORITY, REPORTED SEPARATELY FROM CONSENT. An approval nobody could authenticate is not
    // the same finding as no approval at all, so it does not borrow the other one's words.
    const un = unverifiedApprovals(row);
    if (un.length) {
      const ok = row.decisions.filter((d) => d.approved === true && d.verified).length;
      found.push(key + ' (' + row.kind + ' -> ' + row.target + '): ' + un.length + ' UNVERIFIED approval(s) [' + un.map((d) => d.name + ': ' + d.verifyWhy).join('; ') + '] against ' + ok + ' verified — an approval that cannot be authenticated is recorded, and counts for nothing');
      needFix(FIX.unverified);
    }
    if (found.length) { for (const p of found) problems.push(p); fail++; continue; }
    pass++;
  }
  const total = f.order.length + f.bad.length + f.duplicates.length + f.orphans.length;
  return { pass, fail, skipped: 0, total, problems, skips: [], fixes };
}

/* What `log` does about a key it has seen before. Pure, so the refusal is testable without a
   ledger on disk: 'pending' means the effect is already enqueued and must NOT be enqueued
   again; 'done' is Oscar's exact bug — a finished action on the pending list, which means a
   second effect was about to fire. */
const logDecision = (folded, key) => {
  const row = folded.rows.get(key);
  if (!row) return { action: 'append' };
  return row.done ? { action: 'done', row } : { action: 'pending', row };
};

const gateLine = (t) => 'GATE ' + GATE + ' pass=' + t.pass + ' fail=' + t.fail + ' skipped=' + t.skipped;

/* ---------- argv ----------
   A flag is not a value. `--ledger --check` used to set the ledger to a file named '--check'
   and still run --check, so the operator read a verdict about a ledger they never named.
   `--flag=value` is the escape hatch for a value that really does start with '-'. */
function flagValue(args, flag) {
  const list = args || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === flag) {
      if (i + 1 >= list.length) return { error: flag + ' needs a value' };
      const next = list[i + 1];
      if (next.length && next[0] === '-') return { error: flag + ' was followed by the flag ' + next + ' — if the value really starts with "-", write ' + flag + '=<value>' };
      return { value: next };
    }
    if (a.startsWith(flag + '=')) return { value: a.slice(flag.length + 1) };
  }
  return { absent: true };
}

/* No default ledger, on purpose. See THE LEDGER PATH in the header. */
function resolveLedger(args) {
  const v = flagValue(args, '--ledger');
  if (v.error) return { error: v.error };
  if (v.absent) return { error: '--ledger <path> is required: there is no default. The tracksDir seam (scripts/harness/config.js) is not wired here, and a cwd-relative default keeps one ledger per directory — two shells then both enqueue the same effect.' };
  if (!v.value) return { error: '--ledger needs a non-empty path' };
  return { path: path.resolve(process.cwd(), v.value) };
}

/* ---------- disk ---------- */
const ARGV = process.argv.slice(2);
/* EVERYTHING AFTER A BARE `--` IS THE COMMAND, not our flags. It is how the executor is handed
   the argv it will run — `run --key K --ledger L --execute -- git push origin main` — and the
   split has to happen before any flag is read, or a `--ledger` inside that command would be
   picked up as ours and the operator would get a verdict about a ledger they never named. */
const CUT = ARGV.indexOf('--');
const FLAGS = CUT < 0 ? ARGV : ARGV.slice(0, CUT);
const CMD = CUT < 0 ? [] : ARGV.slice(CUT + 1);
const has = (f) => FLAGS.includes(f);
const shellish = (a) => a.map((x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x)).join(' ');

const emptyFold = () => ({ rows: new Map(), order: [], bad: [], duplicates: [], orphans: [], missing: false, blind: false, why: '' });

// Three outcomes, and the third is the one the earlier draft lost. ENOENT is MISSING: there is
// no ledger yet, which is the ordinary first-use state. Any other error is UNREADABLE, and it
// carries the reason: EACCES on a protected path, EBUSY while an editor or antivirus holds the
// file, EISDIR when the path became a directory. Swallowing those as "missing" graded a ledger
// nobody could read as "nothing to grade", skipped=1, exit 0.
// Split on /\r?\n/: a CRLF ledger must fold the same as an LF one. A trailing '\r' would
// fail every JSON.parse and make the whole file read as damage.
function readLedger(p) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    const code = (e && e.code) || 'unknown';
    if (code === 'ENOENT') return { missing: true, unreadable: false, why: '', lines: [] };
    return { missing: false, unreadable: true, why: 'the ledger ' + p + ' EXISTS but could not be read: ' + code + ' (' + ((e && e.message) || String(e)) + ')', lines: [] };
  }
  return { missing: false, unreadable: false, why: '', lines: text.split(/\r?\n/) };
}

function foldFile(p) {
  const f = readLedger(p);
  if (f.missing) return Object.assign(emptyFold(), { missing: true });
  if (f.unreadable) return Object.assign(emptyFold(), { blind: true, why: f.why });
  return Object.assign(emptyFold(), fold(f.lines));
}

// mkdir first: the row is written BEFORE the effect, so an ENOENT here is an effect that fires
// with no record of it. Once the ledger moves to <tracksDir>/<track>/, that directory may not exist.
const append = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(obj) + '\n'); };

/* ---------- the lock ----------
   Atomics.wait rather than a spin: a busy loop burns the core the lock holder needs to finish.
   SharedArrayBuffer is a Node built-in; if a host ever denies it, a failed sleep degrades into
   an immediate retry, which is slower-to-succeed, never incorrect. */
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* retry immediately */ } };

/* The ONE thing printed in every lock refusal. A lock that can wedge the ledger with no stated
   way out is worse than no lock: the operator meets a refusal and has nothing to act on. */
// A DIRECTORY needs a different command, on both platforms. `del` cannot remove one on Windows
// and `rm -f` cannot remove one anywhere, so the hint printed for a directory-shaped lock used to
// be a command the operator could only watch fail.
const clearHint = (p, isDir) => (process.platform === 'win32'
  ? (isDir ? 'rmdir /s /q "' + p + '"' : 'del "' + p + '"')
  : (isDir ? 'rm -rf "' + p + '"' : 'rm -f "' + p + '"'));
const lockClearHint = (lockPath, isDir) => clearHint(lockPath, !!isDir);

/* PROVABLY gone, or false. signal 0 is a liveness probe, not a signal: ESRCH means no such
   process, EPERM means it EXISTS under another user and therefore reads as ALIVE. Anything we
   cannot prove returns false.
   PID REUSE MAKES THIS A HEURISTIC, NOT A GUARANTEE. A pid is recycled — quickly on Windows —
   so a LIVE answer is not proof the original holder lives, and a GONE answer is only as good as
   the assumption that nobody took the number in between. That is why the TTL below is the real
   guarantee and this probe is only a shortcut that lets a crashed holder be cleaned up fast. */
// The rule is split out from the probe so it can be driven by the error codes a probe RETURNS,
// not only by the pids this box happens to have: a box where no pid is owned by another user
// cannot produce EPERM, and the EPERM-means-ALIVE rule is the half that must not loosen.
// ESRCH is the only code that proves absence. EPERM means the process EXISTS under another user.
// Anything else proves nothing, and proving nothing means ALIVE, which means REFUSE to steal.
const errorProvesGone = (e) => !!e && e.code === 'ESRCH';
function holderIsGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch (e) { return errorProvesGone(e); }
}

/* What is on disk at lockPath, as data: its age source (mtime) and its parsed contents, which
   may be null because a crash between create and write leaves a zero-byte file. */
// isDir, size, ino and the read's error code are carried too, because `raw` ALONE cannot tell a
// corpse from a live lock: an unreadable corpse and an unreadable LIVE lock both read as null,
// and removeCorpse's "are these the same bytes" question then answered yes about a file it had
// never judged. See fingerprintLock.
function readLockState(lockPath) {
  let st;
  try { st = fs.statSync(lockPath); } catch { return { gone: true, mtimeMs: NaN, size: -1, ino: 0, isDir: false, raw: null, readErr: 'ENOENT', info: null }; }
  let raw = null;
  let readErr = '';
  try { raw = fs.readFileSync(lockPath, 'utf8'); } catch (e) { raw = null; readErr = (e && e.code) || 'unknown'; }
  let info = null;
  if (raw !== null) { try { const o = JSON.parse(raw); if (o && typeof o === 'object' && !Array.isArray(o)) info = o; } catch { info = null; } }
  return { gone: false, mtimeMs: st.mtimeMs, size: st.size, ino: Number(st.ino) || 0, isDir: st.isDirectory(), raw, readErr, info };
}

/* The IDENTITY of whatever sits at the lock path, as one comparable string. A rename moves the
   same entity, so every component survives the park: inode (0 where the platform does not give
   one), kind, size, mtime, and the bytes or the reason there are none. Two different unreadable
   things — a directory and a protected file, or one directory and the next — differ here. */
const fingerprintLock = (s) => {
  const x = s || {};
  if (x.gone) return 'gone';
  return [x.isDir ? 'dir' : 'file', x.ino, x.size, x.mtimeMs, x.raw === null ? 'unreadable:' + x.readErr : 'bytes:' + x.raw].join('|');
};

/* The decision table for an EXISTING lock, pure so every branch is tested without having to
   manufacture a dead process. Stealable when EITHER condition holds:
     . the recorded pid is PROVABLY gone (ESRCH) — a fast path for a crashed holder, and only
       trusted when the lock was written on THIS host, because a pid from another machine is
       meaningless in both directions; or
     . the lock's MTIME is older than the stated TTL — the real guarantee. A read-check-append
       of one small file does not take 30s; one that has is wedged.
   AGE COMES FROM MTIME, not from the recorded timestamp, because the recorded field is part of
   the contents a crash may never have written, and a hand-edited `at` must not be able to make
   a live lock look stealable.
   THERE IS NO PERMANENTLY WEDGED STATE. Unreadable contents are stealable once past the TTL
   (unreadable AND fresh still refuses — a run may have created it microseconds ago). An mtime
   skewed into the future by more than the TTL is stealable too, because refusing forever over a
   bad clock is the worse mistake. Every refusal names its reason, and the caller prints the
   exact command that clears the file. */
function stealVerdict(state, nowMs, ttlMs, isGone) {
  const s = state || {};
  const info = s.info && typeof s.info === 'object' && !Array.isArray(s.info) ? s.info : null;
  if (!Number.isFinite(s.mtimeMs)) return { steal: false, why: 'the lock file could not be stat-ed, so its age is unknown — refusing to guess' };
  // Rounded: an mtime is sub-millisecond on some filesystems, and "held it for 5485.57666015625ms"
  // is the line an operator reads under pressure.
  const age = Math.round(nowMs - s.mtimeMs);
  const who = info && info.pid !== undefined ? 'pid ' + info.pid : 'an unreadable holder';
  const sameHost = !info || !info.host || info.host === os.hostname();
  const probeable = !!info && Number.isInteger(info.pid) && sameHost;
  if (probeable && isGone(info.pid)) return { steal: true, why: 'pid ' + info.pid + ' is provably gone (ESRCH) and the lock is ' + age + 'ms old' };
  if (age >= ttlMs) return { steal: true, why: who + ' has held it for ' + age + 'ms, past the ' + ttlMs + 'ms TTL — a read-check-append that slow is wedged' };
  if (age < -ttlMs) return { steal: true, why: 'the lock mtime is ' + (-age) + 'ms in the FUTURE, more than the ' + ttlMs + 'ms TTL — the clock or the file is wrong, and refusing forever over a bad clock is worse' };
  if (!info) return { steal: false, why: 'the lock file is unreadable or malformed and only ' + age + 'ms old — under the ' + ttlMs + 'ms TTL, so another run may have just created it' };
  if (!sameHost) return { steal: false, why: who + ' recorded host ' + JSON.stringify(String(info.host)) + ', not this one, so its liveness cannot be probed from here; the lock is ' + age + 'ms old, under the ' + ttlMs + 'ms TTL' };
  return { steal: false, why: who + ' has held it for ' + age + 'ms, under the ' + ttlMs + 'ms TTL — another run is working' };
}

/* A STEAL DOES NOT GRANT THE LOCK. It only removes the corpse; afterwards this run races for
   the 'wx' create like everybody else, so holding comes ONLY from a create that won. That is
   what closes the two-stealer window an earlier comment denied: two runs could both judge one
   stale lock, both unlink, and both proceed into the critical section.
   The corpse is taken by RENAME — the one built-in with a single winner, since the loser's
   rename fails — and its bytes are re-checked AFTER the move, because between the judgement and
   the move the real holder may have released and a NEW run may have created a live lock at that
   path. If it is not the same entity we moved somebody's live lock, so we put it BACK and wait.

   A LOCK CAN BE A DIRECTORY. Something else creates `<ledger>.lock` as a directory and the old
   delete was unlinkSync alone, which cannot remove one: the park then stayed beside the ledger
   forever, and the ledger's home is <tracksDir>/<track>/, where commit-hygiene BLOCKS a stray —
   so lock recovery used to plant the thing that blocks the commit that would preserve the
   record. Removal is shape-aware now, and whatever survives is RETURNED so the caller can print
   a command that actually works on this platform. */
function removeCorpse(lockPath, judged) {
  const parked = lockPath + '.stale-' + process.pid + '-' + Date.now();
  const no = (why) => ({ removed: false, parked: null, isDir: false, why });
  try { fs.renameSync(lockPath, parked); } catch { return no('the lock vanished or another stealer moved it first'); }
  const after = readLockState(parked);
  // Compared by FINGERPRINT, not by bytes: an unreadable corpse and an unreadable live lock both
  // read as null bytes, and `raw !== judged.raw` therefore confirmed locks it had never judged.
  if (!judged || fingerprintLock(after) !== fingerprintLock(judged)) {
    try { fs.renameSync(parked, lockPath); } catch { return { removed: false, parked, isDir: after.isDir, why: 'what was at the lock path is NOT what was judged, and it could not be put back' }; }
    return no('what was at the lock path is not what was judged (' + fingerprintLock(after) + ' vs ' + fingerprintLock(judged) + ') — it was put back');
  }
  try {
    if (after.isDir) fs.rmSync(parked, { recursive: true, force: true });
    else fs.unlinkSync(parked);
  } catch (e) { /* reported below, with a hint that matches the shape */ void e; }
  if (fs.existsSync(parked)) return { removed: false, parked, isDir: after.isDir, why: 'the corpse was judged stale and moved aside, but could not be deleted' };
  return { removed: true, parked: null, isDir: after.isDir, why: 'the judged corpse was removed' };
}

/* CLEAN UP AFTER THE RECOVERY. A park that could not be deleted — or one left by a run that died
   mid-steal — is a stray in a tracked folder. Ours is always swept; somebody else's is swept only
   once it is past the TTL, because a park normally lasts microseconds and a fresh one belongs to
   a steal still in flight. Age comes from mtime, like every other age in this file. */
function sweepStrays(lockPath, nowMs, ttlMs) {
  const dir = path.dirname(lockPath);
  const prefix = path.basename(lockPath) + '.stale-';
  const mine = prefix + process.pid + '-';
  const left = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return { left, swept: 0 }; }
  let swept = 0;
  for (const nm of names) {
    if (nm.indexOf(prefix) !== 0) continue;
    const full = path.join(dir, nm);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (nm.indexOf(mine) !== 0 && (nowMs - st.mtimeMs) < ttlMs) continue;   // somebody's steal, still in flight
    try {
      if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      else fs.unlinkSync(full);
    } catch (e) { void e; }
    if (fs.existsSync(full)) left.push({ path: full, isDir: st.isDirectory() });
    else swept++;
  }
  return { left, swept };
}
const strayReport = (left) => left.map((s) => 'note: a parked lock corpse is still beside the ledger: ' + s.path + '\n  fix: ' + clearHint(s.path, s.isDir)).join('\n');

/* Release only what is still OURS. The earlier release unlinked whatever `.lock` was on disk,
   which after a steal is another run's LIVE lock — the same defect as the unconditional steal,
   at the other end. The nonce is what makes "ours" checkable. */
function releaseIfOurs(lockPath, nonce) {
  const s = readLockState(lockPath);
  if (s.gone) return 'already gone';
  if (!s.info || s.info.nonce !== nonce) return 'not ours';
  try { fs.unlinkSync(lockPath); return 'released'; } catch { return 'could not unlink'; }
}

/* Runs fn() with an exclusive lock beside the ledger. openSync(..., 'wx') fails when the file
   exists, which is the atomic create-or-fail this needs; the file's EXISTENCE is the lock, so
   the fd is closed immediately (holding it open would make unlink fail on Windows). */
function withLedgerLock(target, fn, opts) {
  const o = opts || {};
  const ttlMs = o.ttlMs === undefined ? LOCK_TTL_MS : o.ttlMs;
  const tries = o.tries === undefined ? 50 : o.tries;
  const waitMs = o.waitMs === undefined ? 100 : o.waitMs;
  const isGone = o.isGone || holderIsGone;
  const readState = o.readState || readLockState;   // injectable so the bounded-retry paths below
  const lockPath = target + '.lock';                // can be driven without manufacturing an errno
  const nonce = crypto.randomBytes(8).toString('hex');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let held = false;
  let lastWhy = 'no attempt was made';
  let waited = 0;   // counts only attempts that FOUND A LIVE LOCK; a steal must not consume a
  let steals = 0;   // try, or `tries: 1` could never take over a stale lock at all
  let vanished = 0; // EEXIST on create while stat says there is nothing there
  let strays = [];
  while (!held) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), nonce, at: new Date().toISOString() }) + '\n'); } finally { fs.closeSync(fd); }
      held = true;
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      const state = readState(lockPath);
      if (state.gone) {
        // BOUNDED, because the unbounded version of this branch was the one failure shape worse
        // than a refusal: create keeps returning EEXIST while stat keeps failing (EACCES/EPERM on
        // the lock, a filesystem that reports the entry and refuses to stat it) and the loop spun
        // at 100% CPU with no counter, no sleep, no message and no exit. Every other path is
        // bounded; this one is now too, and it REFUSES rather than guessing.
        if (++vanished > tries) { lastWhy = 'create reports EEXIST but the lock at ' + lockPath + ' cannot be stat-ed, ' + vanished + ' attempts running — refusing rather than spinning on it'; break; }
        sleepSync(waitMs);
        continue;
      }
      const v = stealVerdict(state, Date.now(), ttlMs, isGone);
      lastWhy = v.why;
      if (v.steal) {
        // Bounded: a lock re-created after every steal is a live competitor, not a corpse.
        if (++steals > 3) { lastWhy = 'the lock was re-created after ' + (steals - 1) + ' steals — a live holder keeps taking it'; break; }
        const r = removeCorpse(lockPath, state);
        if (r.parked) strays.push({ path: r.parked, isDir: r.isDir });
        continue;
      }
      if (++waited >= tries) break;
      sleepSync(waitMs);
    }
  }
  // Lock recovery must not leave litter in a track folder. Swept whenever this run parked
  // anything, and on the way out of a refusal, where the operator is already reading.
  if (steals > 0 || strays.length) strays = sweepStrays(lockPath, Date.now(), ttlMs).left;
  if (!held) {
    const now = readState(lockPath);
    const err = new Error('ledger lock ' + lockPath + ' is already held: ' + lastWhy
      + '\n  fix: wait for the other run, or — if no run is working — clear it with: ' + clearHint(lockPath, !now.gone && now.isDir)
      + (strays.length ? '\n' + strayReport(strays) : ''));
    err.lockRefusal = true;
    throw err;
  }
  if (strays.length) console.log(strayReport(strays));
  try { return fn(); } finally {
    const how = releaseIfOurs(lockPath, nonce);
    if (how === 'not ours') console.log('note: the lock at ' + lockPath + ' is no longer this run\'s (stolen or replaced) — leaving it for its owner');
  }
}

/* Oscar hardcodes 'unknown' for the decider, with a TODO beside it, because it has no local
   identity to read. We do: the git identity is who is at this box. Falling back to 'unknown'
   rather than failing, because an unattributed decision still beats recording none. */
// It asks git from the LEDGER's directory, not the process cwd: a ledger inside the repo must
// be signed by the identity configured for that repo, or a decision gets attributed to
// whatever global config the shell happened to be sitting in.
function whoAmI(cwd) {
  try {
    const out = execFileSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || 'unknown';
  } catch { return 'unknown'; }
}

/* Literals where it can: it folds in-memory arrays instead of building a fixture tree, because
   a test that needs a scratch directory is a test that stops being run. The lock, the CRLF read
   and the unreadable-ledger case are filesystem objects and cannot be proven that way, so those
   cases — and only those — use one mkdtemp directory under os.tmpdir(), removed in a finally.
   EVERY CASE HERE EARNS ITS LINE. Cases whose comment claimed more than they proved were
   deleted rather than kept at a lower claim; the count is smaller than it could be on purpose. */
function selfTest() {
  let n = 0; const fails = [];
  const eq = (what, got, want) => {
    n++;
    const a = JSON.stringify(got); const b = JSON.stringify(want);
    if (a !== b) fails.push(what + ': got ' + a + ', wanted ' + b);
  };
  const refusal = (fn) => { try { fn(); return ''; } catch (e) { return String((e && e.message) || e); } };
  // why(folded, i) rather than .bad[i].why: a regression that reports NOTHING must fail a check,
  // not throw a TypeError out of the suite before the verdict line is printed.
  const why = (f, i) => ((f.bad || [])[i || 0] || {}).why || '(no damage was reported)';

  // The key is deterministic, and the target is part of it — otherwise a push to a fork
  // and a push to origin would share one row and the second would be refused as a dupe.
  eq('same inputs give the same key', keyFor('push', 'origin/main', ''), keyFor('push', 'origin/main', ''));
  eq('a different target gives a different key', keyFor('push', 'origin/main', '') === keyFor('push', 'origin/next', ''), false);
  eq('a different payload gives a different key', keyFor('push', 'origin/main', 'a') === keyFor('push', 'origin/main', 'b'), false);
  eq('the key is 16 hex chars', /^[0-9a-f]{16}$/.test(keyFor('push', 'origin/main', '')), true);

  const K = keyFor('push', 'origin/main', '');
  // EVERY FIXTURE NOW CARRIES A DERIVABLE KEY, because a row whose key is not
  // keyFor(kind|target|payloadSha) is damage — so a fixture that wants to prove something ELSE
  // has to be honest about its identity first. CHAL is the challenge plaintext: the action row
  // stores only its sha256 (as a real one does), and an approval row quotes the plaintext.
  const CHAL = 'self-test-challenge-plaintext';
  const action = (over) => Object.assign({ kind: 'push', key: K, target: 'origin/main', payloadSha: sha256(''), challengeSha: sha256(CHAL), requiresApproval: true, done: false, result: null, error: null, logged_at: 'T' }, over);
  const approvalRow = (over) => Object.assign({ key: K, name: 'a@example.com', time: 'T1', approved: true, challenge: CHAL }, over);
  const bare = (kind, target, over) => Object.assign({ kind, key: keyForSha(kind, target, ''), target }, over);   // no payloadSha, so the sha in the key is ''

  // The anti-double-push rule, both halves.
  eq('a pending key refuses a second enqueue', logDecision(fold([action({})]), K).action, 'pending');
  eq('a done key is the bug Oscar names', logDecision(fold([action({}), { key: K, done: true, result: 'pushed' }]), K).action, 'done');
  eq('an unseen key appends', logDecision(fold([action({})]), 'ffffffffffffffff').action, 'append');
  eq('a second action line for one key is counted as a duplicate', fold([action({}), action({})]).duplicates, [K]);

  // Approval: appended rows, and one denial is final.
  eq('no decisions is not approval', approved({ decisions: [] }), false);
  eq('one approval approves', approved({ decisions: [{ approved: true }] }), true);
  eq('a denial after two approvals still denies', approved({ decisions: [{ approved: true }, { approved: true }, { approved: false }] }), false);
  eq('a denial first also denies', approved({ decisions: [{ approved: false }, { approved: true }] }), false);

  // ---- THE POLICY TABLE. The requirement comes from the KIND, so the row cannot lower it.
  eq('a push leaves the tree and requires approval', approvalPolicy('push').required, true);
  eq('`git push` normalises to the same verb', approvalPolicy('git push').required, true);
  eq('`gh pr create` normalises to a classified escaping kind', approvalPolicy('gh pr create').kind, 'pr-create');
  eq('a local commit does not require approval', approvalPolicy('commit').required, false);
  eq('an UNCLASSIFIED kind requires approval (fail closed)', approvalPolicy('frobnicate').required, true);
  eq('...and says it fell through the table', /not in the policy table/.test(approvalPolicy('frobnicate').why), true);

  // BLOCKER: the row that simply OMITS requiresApproval. This is the shape that made the
  // DONE-without-authorisation check unreachable a second time, through the adjacent field.
  const omitted = fold([{ kind: 'push', key: K, target: 'origin/main', payloadSha: sha256(''), challengeSha: sha256(CHAL), done: true }]);   // genuinely no requiresApproval field
  eq('a done push that omits requiresApproval is still unauthorised', grade(omitted).fail, 1);
  eq('...and the problem names the policy reason', grade(omitted).problems.some((p) => /DONE without authorisation — approval was required because push leaves this tree/.test(p)), true);
  eq('...and the row carries the POLICY requirement, not the line\'s', omitted.rows.get(K).requiresApproval, true);
  eq('an omitted field is not itself damage', omitted.bad, []);

  // A row that DISAGREES with the policy is damage in both directions: lowering the bar is a
  // forgery attempt and must be loud, and claiming a bar the policy does not set is also a lie.
  const lowered = fold([action({ requiresApproval: false, done: true })]);
  eq('a row claiming a push needs no approval is damage', lowered.bad.length, 1);
  eq('...named as a row that cannot set its own bar', /cannot set its own bar/.test(why(lowered)), true);
  eq('...the policy is applied anyway', lowered.rows.get(K).requiresApproval, true);
  eq('...so the forgery fails twice: the bad line and the unauthorised done', grade(lowered).fail, 2);
  const raised = fold([bare('commit', 'HEAD', { requiresApproval: true, done: true })]);
  eq('a local row claiming it needs approval is also damage', raised.bad.length, 1);
  eq('...and the policy still says no approval is needed', raised.rows.get(keyForSha('commit', 'HEAD', '')).requiresApproval, false);
  eq('an unclassified kind recorded done with no decision fails', grade(fold([bare('frobnicate', 'somewhere', { done: true })])).fail, 1);
  eq('a local kind recorded done with no decision is fine', grade(fold([bare('commit', 'HEAD', { requiresApproval: false, done: true })])).fail, 0);

  // ---- MECHANISM A: THE KEY IS DERIVED, AND THE FOLD RECOMPUTES IT.
  eq('the kind is normalised INTO the key, so one verb has exactly one key', keyFor('git push', 'origin/main', ''), keyFor('push', 'origin/main', ''));
  eq('keyForSha over a payload sha equals keyFor over the payload', keyForSha('push', 'origin/main', sha256('x')), keyFor('push', 'origin/main', 'x'));
  eq('a correct row is not reported (the check is not over-eager)', fold([action({})]).bad, []);
  const handKey = fold([action({ key: 'aaaaaaaaaaaaaaaa' })]);
  eq('a hand-written key is damage', handKey.bad.length, 1);
  eq('...reported by BOTH keys, the row\'s and the derived one', /aaaaaaaaaaaaaaaa is not keyFor/.test(why(handKey)) && why(handKey).indexOf(K) > 0, true);
  eq('...and the fix names a mislabelling, not a repair of bytes', grade(handKey).fixes.some((f) => /mislabelling attempt/.test(f)), true);
  // THE MEASURED HOLE, second half: three pending rows for ONE push used to grade pass=3 fail=0.
  const threeForOne = fold([action({ key: 'aaaaaaaaaaaaaaaa' }), action({ key: 'bbbbbbbbbbbbbbbb' }), action({})]);
  eq('two hand-keyed pending rows for one push are findings, not green — and the forged rows do not pass either', [grade(threeForOne).pass, grade(threeForOne).fail], [1, 4]);
  eq('...and no effect may run against that ledger', integrity(threeForOne).ok, false);

  // ---- MECHANISM B: KIND CROSS-CHECKED AGAINST TARGET. THE MEASURED HOLE, first half: a push
  // recorded as a `note` graded `every logged effect is accounted for and authorised`, exit 0.
  const asNote = fold([bare('note', 'origin/main', { done: true, result: 'pushed to origin/main' })]);
  eq('a push recorded as a `note` is damage', asNote.bad.length, 1);
  eq('...named as a local kind whose target leaves the tree', /claims to stay in-tree but target "origin\/main" leaves it/.test(why(asNote)), true);
  eq('...so the ledger that used to grade pass=1 fail=0 now fails twice: as a line, and as a row that is not accounted for', [grade(asNote).pass, grade(asNote).fail], [0, 2]);
  eq('...and a `commit` to origin/main is caught the same way', fold([bare('commit', 'origin/main', { done: true })]).bad.length, 1);
  eq('targetEscapes: a remote-tracking ref leaves', [targetEscapes('origin/main').leaves, targetEscapes('upstream/trunk').leaves], [true, true]);
  eq('targetEscapes: refs/remotes/ leaves', targetEscapes('refs/remotes/origin/main').leaves, true);
  eq('targetEscapes: an https URL leaves', targetEscapes('https://example.com/hooks/1').leaves, true);
  eq('targetEscapes: an scp-style git URL leaves', targetEscapes('git@github.com:o/r.git').leaves, true);
  eq('targetEscapes: a registry name leaves', targetEscapes('registry.npmjs.org').leaves, true);
  eq('targetEscapes: HEAD and a local ref do not', [targetEscapes('HEAD').leaves, targetEscapes('refs/heads/master').leaves], [false, false]);
  eq('targetEscapes: an in-tree path does not, and a dotted filename is not a host', [targetEscapes('docs/tracks/x/handoff.md').leaves, targetEscapes('notes.md').leaves], [false, false]);
  eq('targetEscapes: an empty or unclassifiable target yields NO answer', [targetEscapes('').leaves, targetEscapes('??|weird').leaves], [null, null]);
  eq('a local kind with a local target does not conflict', kindTargetConflict('commit', 'HEAD'), null);
  eq('an ESCAPING kind with a remote target does not conflict — its bar is already the high one', kindTargetConflict('push', 'origin/main'), null);
  eq('an unclassified kind is not cross-checked either: it already requires approval', kindTargetConflict('frobnicate', 'origin/main'), null);
  eq('a local kind with an UNJUDGEABLE target fails closed', /cannot be classified[\s\S]*fail closed/.test(kindTargetConflict('note', '??|weird')), true);
  eq('...and that is damage in the fold too', fold([bare('note', '??|weird', { done: true })]).bad.length, 1);

  // ---- THE CLASSIFIER: an ACTUAL argv -> a kind. This is what the executor reads instead of the
  // row. Its contract is determinism, not a full CLI grammar (see the header), so these cases
  // pin the shapes a refusal depends on: the verb, the force and tag variants, and the target.
  const cls = (s) => classifyArgv(s.split(' '));
  eq('git push classifies as push, with remote/ref as the target', [cls('git push origin main').kind, cls('git push origin main').target], ['push', 'origin/main']);
  eq('a forced push is its own kind', [cls('git push --force origin main').kind, cls('git push -f origin main').kind], ['force-push', 'force-push']);
  eq('--force-with-lease is still a force push', cls('git push --force-with-lease origin main').kind, 'force-push');
  eq('pushing tags is its own kind', cls('git push --tags origin').kind, 'tag-push');
  eq('`git push -u origin main` keeps the remote in the target (-u takes no value)', cls('git push -u origin main').target, 'origin/main');
  eq('a git global flag with a value is skipped, not read as the subcommand', [cls('git -C /tmp/x push origin main').kind, cls('git -C /tmp/x push origin main').target], ['push', 'origin/main']);
  eq('a commit message is not mistaken for a target', [cls('git commit -m wip').kind, cls('git commit -m wip').target], ['commit', 'HEAD']);
  eq('gh pr create classifies, with the repo as the target', [cls('gh pr create --repo o/r --title t').kind, cls('gh pr create --repo o/r --title t').target], ['pr-create', 'o/r']);
  eq('gh issue comment and gh pr comment classify', [cls('gh issue comment 12 --repo o/r').kind, cls('gh pr comment 7 --repo o/r').kind], ['issue-comment', 'pr-comment']);
  eq('gh release create classifies', cls('gh release create v1 --repo o/r').kind, 'release');
  eq('gh api with a write method is not local', [cls('gh api repos/o/r/issues -X POST').kind, cls('gh api repos/o/r/issues').kind], ['post', 'local']);
  eq('npm publish classifies, with the registry as the target', [cls('npm publish').kind, cls('npm publish').target], ['publish', 'registry.npmjs.org']);
  eq('...and a named registry becomes the target', cls('npm publish --registry https://r.example.com').target, 'https://r.example.com');
  eq('a deploy verb classifies whatever the tool spells it on', [cls('wrangler deploy --env production').kind, cls('wrangler deploy --env production').target], ['deploy', 'wrangler/production']);
  eq('a runner prefix is skipped to the real tool', cls('npx wrangler deploy').kind, 'deploy');
  eq('curl with a write method is a webhook; a read is INBOUND, so it classifies like a fetch', [cls('curl -X POST https://example.com/h').kind, cls('curl https://example.com/h').kind], ['webhook', 'fetch']);
  eq('an unrecognised command classifies as local', cls('ls -la').kind, 'local');
  eq('...and `local` is IN the policy table, so it is a real answer and not a fall-through', [approvalPolicy('local').required, /not in the policy table/.test(approvalPolicy('local').why)], [false, false]);
  eq('a Windows basename with .exe is the same tool', classifyArgv(['C:\\Program Files\\Git\\cmd\\git.exe', 'push', 'origin', 'main']).kind, 'push');
  eq('an empty command classifies as nothing that leaves', [classifyArgv([]).kind, classifyArgv([]).target], ['local', '']);
  // Nothing the classifier can emit may fall through the policy table: a verb spelt one way here
  // and another way there would silently become "unclassified", which is a refusal, not a match.
  const SAMPLES = ['git push origin main', 'git push --force origin main', 'git push --tags origin', 'git commit -m x', 'git fetch origin',
    'gh pr create --repo o/r', 'gh pr merge 1 --repo o/r', 'gh issue create --repo o/r', 'gh release create v1', 'gh gist create f',
    'gh workflow run w --repo o/r', 'gh api x -X POST', 'npm publish', 'wrangler deploy', 'wrangler rollback', 'curl -X POST https://e.com', 'ls -la'];
  eq('every kind the classifier returns is in the policy table', SAMPLES.filter((s) => /not in the policy table/.test(approvalPolicy(cls(s).kind).why)), []);
  // The classifier and the cross-check must agree, or `run` would print a plan that --check calls
  // damage: a derived LOCAL kind may never come with a target that the cross-check says leaves.
  eq('...and no derived (kind, target) pair contradicts the cross-check', SAMPLES.map(cls).filter((c) => kindTargetConflict(c.kind, c.target)).map((c) => c.command), []);

  // Folding: decisions and state rows land on the row they name.
  const folded = fold([
    action({}),
    approvalRow(),
    { key: K, done: true, result: 'pushed' },
  ]);
  eq('a decision row lands on its action row', folded.rows.get(K).decisions.length, 1);
  eq('a state row supersedes done', folded.rows.get(K).done, true);
  eq('an approved, done row is green', grade(folded).fail, 0);
  eq('...because the decision met the challenge the row stored', folded.rows.get(K).decisions[0].verified, true);
  eq('...and approvedVerified agrees with approved on it', [approved(folded.rows.get(K)), approvedVerified(folded.rows.get(K))], [true, true]);

  // ---- MECHANISM C: APPROVAL AUTHORITY. A hand-appended approval is RECORDED and reported, and
  // it authorises nothing. Measured before this existed: {"approved":true,"name":"nobody-checked-
  // this"} appended by hand graded pass=1 fail=0 and `run` printed approvals=1.
  const handApproved = fold([action({}), { key: K, approved: true, name: 'nobody-checked-this' }, { key: K, done: true, result: 'pushed' }]);
  eq('a hand-appended approval is still RECORDED, not dropped', handApproved.rows.get(K).decisions.length, 1);
  eq('...and marked UNVERIFIED, with the reason', [handApproved.rows.get(K).decisions[0].verified, /carries no `challenge`/.test(handApproved.rows.get(K).decisions[0].verifyWhy)], [false, true]);
  eq('...so it does not authorise the effect', approvedVerified(handApproved.rows.get(K)), false);
  eq('...while the weaker rule still reads it as consent — which is why run uses the stronger one', approved(handApproved.rows.get(K)), true);
  eq('...the gate fails it, as UNVERIFIED', grade(handApproved).problems.some((p) => /1 UNVERIFIED approval\(s\)/.test(p)), true);
  eq('...reported SEPARATELY from "no approval at all"', grade(handApproved).problems.some((p) => /DONE without authorisation/.test(p)), false);
  eq('...with the challenge fix, not the already-happened one', [grade(handApproved).fixes.some((f) => /The challenge was printed ONCE/.test(f)), grade(handApproved).fixes.some((f) => /ALREADY HAPPENED/.test(f))], [true, false]);
  const wrongChal = fold([action({}), approvalRow({ challenge: 'not-the-plaintext' })]);
  eq('a decision carrying a WRONG challenge is damage', /does not verify/.test(why(wrongChal)), true);
  eq('...and the decision is recorded unverified', wrongChal.rows.get(K).decisions[0].verified, false);
  eq('a row that stores NO challengeSha can carry no verified decision', fold([action({ challengeSha: undefined }), approvalRow()]).rows.get(K).decisions[0].verified, false);
  eq('...and verifyChallenge says exactly that', /stores no `challengeSha`/.test(verifyChallenge({ challengeSha: null }, CHAL).why), true);
  eq('an UNVERIFIED DENIAL is not a finding — a denial needs no authority to stop an effect', grade(fold([action({}), { key: K, approved: false, name: 'anyone' }])).fail, 0);
  eq('--who cannot become the decider: a `label` is folded as a label', fold([action({}), approvalRow({ name: 'git@identity', label: 'ceo@example.com (not really)' })]).rows.get(K).decisions[0], { name: 'git@identity', label: 'ceo@example.com (not really)', time: 'T1', approved: true, verified: true, verifyWhy: 'the challenge hashes to the one stored when the effect was logged' });

  // The finding this whole file exists to surface.
  const unapproved = fold([action({}), { key: K, done: true, result: 'pushed' }]);
  const gUn = grade(unapproved);
  eq('done + requires approval + no decision fails', gUn.fail, 1);
  eq('...and the problem names the key', gUn.problems.some((p) => p.indexOf(K) === 0), true);
  eq('a denied, done row fails too', grade(fold([action({}), { key: K, approved: false, name: 'x' }, { key: K, done: true }])).fail, 1);

  // INVARIANT 1 — forged approval on the action row itself. BLOCKER: this exact line used to
  // fold to approved+done, fail=0, which made the check above unreachable.
  const forged = fold([action({ decisions: [{ approved: true, name: 'me' }], done: true })]);
  eq('an inline decisions array on an action row is ignored', forged.rows.get(K).decisions, []);
  eq('...so the row is NOT approved', approved(forged.rows.get(K)), false);
  eq('...the line is reported as damage', forged.bad.map((b) => b.at), [1]);
  eq('...by name', why(forged).indexOf('inline `decisions`') >= 0, true);
  eq('...and the forgery fails twice: the bad line and the unauthorised done', grade(forged).fail, 2);
  // KEPT, not decoration: one inverted condition in the INVARIANT-1 check would make every
  // clean action row damage, and integrity() would then refuse every ledger in the repo.
  eq('an action row with NO decisions field is not damage', fold([action({})]).bad, []);

  // INVARIANT 4, action-row half — a field no reader uses. `approved` written here was silent,
  // so the human who typed an approval onto the action row saw no complaint anywhere.
  const stray = fold([action({ approved: true, done: true })]);
  eq('an `approved` on the action row records no decision', stray.rows.get(K).decisions, []);
  eq('...and the stray field is reported', /carries approved/.test(why(stray)), true);
  eq('a typo\'d field on an action row is reported too', /carries aproved/.test(why(fold([action({ aproved: true })]))), true);

  // INVARIANT 3 — done is latched. BLOCKER: the un-done line made `run` stop refusing.
  const undone = fold([action({}), { key: K, done: true, result: 'pushed' }, { key: K, done: false }]);
  eq('a later line cannot un-done a key', undone.rows.get(K).done, true);
  eq('...the attempt is reported', undone.bad.map((b) => b.at), [3]);
  eq('...and log still refuses the second enqueue', logDecision(undone, K).action, 'done');
  // KEPT, not decoration: an over-eager latch (damage on EVERY done:false) would make an
  // ordinary pending state row damage, and a damaged ledger refuses every effect.
  eq('done false BEFORE any done true is an ordinary no-op', fold([action({}), { key: K, done: false }]).bad, []);
  eq('a non-boolean done is damage, not a silent drop', fold([action({}), { key: K, done: 'true' }]).bad.length, 1);
  const blanked = fold([action({}), { key: K, result: 'pushed' }, { key: K, result: null }, { key: K, error: 'boom' }, { key: K, error: '' }]);
  eq('a recorded result cannot be blanked', blanked.rows.get(K).result, 'pushed');
  eq('a recorded error cannot be blanked', blanked.rows.get(K).error, 'boom');
  eq('...both attempts are reported', blanked.bad.map((b) => b.at), [3, 5]);

  // INVARIANT 4, state-row half. REAL: these two used to vanish.
  const quoted = fold([action({}), { key: K, approved: 'true' }, { key: K, aproved: true }]);
  eq('a quoted boolean records NO decision', quoted.rows.get(K).decisions, []);
  eq('a quoted boolean and a typo are both reported', quoted.bad.map((b) => b.at), [2, 3]);
  eq('...the typo says nothing was merged', /NOTHING was merged/.test(why(quoted, 1)), true);
  eq('...and both fail the check', grade(quoted).fail, 2);

  // INVARIANT 5 — damage and blindness block the effect instead of being left to a later --check.
  eq('a clean ledger passes the integrity gate', integrity(fold([action({})])).ok, true);
  eq('a truncated line blocks log, decide and run', integrity(fold([JSON.stringify(action({})), '{"key":"K","do'])).ok, false);
  eq('a duplicate blocks them too', integrity(fold([action({}), action({})])).ok, false);
  eq('an orphan blocks them too', integrity(fold([{ key: 'nosuchkey', approved: true }])).ok, false);
  eq('...and the refusal says to repair by hand', /repair by hand/.test(integrity(fold([action({}), action({})])).why), true);
  const blind = Object.assign(emptyFold(), { blind: true, why: 'the ledger X EXISTS but could not be read: EACCES' });
  eq('a blind fold refuses every effect', integrity(blind).ok, false);
  eq('a blind fold FAILS the gate — it is not a skip', [grade(blind).pass, grade(blind).fail, grade(blind).skipped], [0, 1, 0]);
  eq('...and says blindness is not a skip', grade(blind).problems.some((p) => /never a skip/.test(p)), true);

  // A crash mid-write leaves a half line. Tolerated, counted, reported — never silent.
  const damaged = fold([JSON.stringify(action({})), '{"key":"abc","kin']);
  eq('an unparseable line does not stop the fold', damaged.rows.size, 1);
  eq('...and is counted by line number', damaged.bad.map((b) => b.at), [2]);
  const gDam = grade(damaged);
  eq('...and fails the check', gDam.fail, 1);
  eq('...and is reported in words', gDam.problems.some((p) => /unparseable/.test(p)), true);
  eq('a blank line is not damage', fold([JSON.stringify(action({})), '', '  ']).bad, []);
  eq('an orphan decision is a finding', grade(fold([{ key: 'nosuchkey', approved: true }])).fail, 1);

  // KEPT, one of the three identity asserts the review called near-arithmetic: this one crosses
  // two independent loops (total from the fold's lengths, pass/fail from the row walk) on a
  // ledger that has BOTH a row and a damaged line. The two weaker copies were deleted.
  eq('the total accounts for every unit', gDam.total, gDam.pass + gDam.fail + gDam.skipped);
  const gSkip = grade({ missing: true });
  eq('a missing ledger declares a skip, it does not pass', [gSkip.pass, gSkip.fail, gSkip.skipped, gSkip.total], [0, 0, 1, 1]);
  eq('the GATE line carries the three figures', gateLine({ pass: 2, fail: 1, skipped: 0 }), 'GATE effects pass=2 fail=1 skipped=0');

  // argv: a flag is never a value, and there is no default ledger.
  eq('--ledger --check is refused, not taken as a filename', !!flagValue(['--ledger', '--check'], '--ledger').error, true);
  eq('--ledger=<v> is the escape hatch for a leading dash', flagValue(['--ledger=-weird.jsonl'], '--ledger').value, '-weird.jsonl');
  eq('a trailing flag with no value is refused', !!flagValue(['--kind'], '--kind').error, true);
  eq('a missing --ledger is a hard stop', !!resolveLedger(['--check']).error, true);
  eq('...and the refusal explains the seam', /tracksDir/.test(resolveLedger(['--check']).error), true);
  eq('--ledger <p> resolves to an absolute path', path.isAbsolute(resolveLedger(['--ledger', 'a.jsonl']).path), true);

  // ---- THE LIVENESS PROBE, against this platform rather than a stub. The stale-lock table is
  // driven with an injected isGone below; these two cases are the only ones that run the real
  // function, which is where the file's Windows claim lives.
  eq('our own pid reads as ALIVE, never provably gone', holderIsGone(process.pid), false);
  // A child we spawned and reaped is genuinely absent on this box. If a recycled pid ever makes
  // this fail, that failure IS the heuristic's limit showing up — which is why the TTL, not this
  // probe, is what stealVerdict relies on for its guarantee.
  const reaped = spawnSync(process.execPath, ['--version']);
  eq('a spawned-and-exited pid is provably gone (ESRCH)', holderIsGone(reaped.pid), true);
  eq('a non-integer pid proves nothing', holderIsGone('4321'), false);
  eq('pid 0 proves nothing', holderIsGone(0), false);
  // The code rule itself, because a box with no other-user process cannot produce EPERM and
  // this is the half whose loosening would let a LIVE holder's lock be stolen.
  eq('ESRCH is the only code that proves absence', errorProvesGone({ code: 'ESRCH' }), true);
  eq('EPERM means the process exists under another user — ALIVE, never gone', errorProvesGone({ code: 'EPERM' }), false);
  eq('an unclassified error proves nothing', errorProvesGone({ code: 'EINVAL' }), false);
  eq('a thrown non-error proves nothing', errorProvesGone(null), false);

  // ---- THE STALE-LOCK TABLE. Stealable on EITHER provably-dead OR past-TTL; no state is
  // permanently unstealable, which is the brick the review found.
  const dead = () => true; const alive = () => false;
  const now = Date.parse('2026-10-06T00:01:00.000Z');
  const st = (over) => Object.assign({ gone: false, mtimeMs: now - 60000, raw: '{}', info: { pid: 4321, host: os.hostname() } }, over);   // 60s old
  eq('a fresh lock whose holder lives is not stolen', stealVerdict(st({ mtimeMs: now - 5 }), now, 30000, alive).steal, false);
  eq('...and says it is under the TTL', /under the 30000ms TTL/.test(stealVerdict(st({ mtimeMs: now - 5 }), now, 30000, alive).why), true);
  eq('a provably dead holder is stolen even while fresh', stealVerdict(st({ mtimeMs: now - 5 }), now, 30000, dead).steal, true);
  eq('...and says ESRCH', /provably gone \(ESRCH\)/.test(stealVerdict(st({ mtimeMs: now - 5 }), now, 30000, dead).why), true);
  eq('a lock past the TTL is stolen even from a LIVE holder — the TTL is the guarantee', stealVerdict(st({}), now, 30000, alive).steal, true);
  eq('...and says which TTL it passed', /past the 30000ms TTL/.test(stealVerdict(st({}), now, 30000, alive).why), true);
  eq('an UNREADABLE lock that is fresh is NOT stolen', stealVerdict(st({ mtimeMs: now - 5, raw: '', info: null }), now, 30000, dead).steal, false);
  eq('...and names it unreadable', /unreadable or malformed/.test(stealVerdict(st({ mtimeMs: now - 5, raw: '', info: null }), now, 30000, dead).why), true);
  eq('an UNREADABLE lock past the TTL IS stolen — nothing may wedge forever', stealVerdict(st({ raw: '', info: null }), now, 30000, alive).steal, true);
  eq('an mtime far in the FUTURE is stolen, not refused forever', stealVerdict(st({ mtimeMs: now + 600000 }), now, 30000, alive).steal, true);
  eq('...and blames the clock', /in the FUTURE/.test(stealVerdict(st({ mtimeMs: now + 600000 }), now, 30000, alive).why), true);
  eq('a pid from ANOTHER host is not probed', stealVerdict(st({ mtimeMs: now - 5, info: { pid: 4321, host: 'some-other-box' } }), now, 30000, dead).steal, false);
  eq('...and says why it could not probe it', /cannot be probed from here/.test(stealVerdict(st({ mtimeMs: now - 5, info: { pid: 4321, host: 'some-other-box' } }), now, 30000, dead).why), true);
  eq('...but that lock is still stolen once past the TTL', stealVerdict(st({ info: { pid: 4321, host: 'some-other-box' } }), now, 30000, dead).steal, true);
  eq('a lock that cannot be stat-ed is not stolen', stealVerdict(st({ mtimeMs: NaN }), now, 0, dead).steal, false);
  // Measured, and it is the line an operator reads under pressure: 'held it for 5485.57666015625ms'.
  eq('an age is reported in whole milliseconds', /has held it for 5ms,/.test(stealVerdict(st({ mtimeMs: now - 5.4 }), now, 30000, alive).why), true);

  // The filesystem cases: the lock is a real file, CRLF is a real byte sequence, and an
  // unreadable ledger is a real errno.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-actions-selftest-'));
  try {
    const p = path.join(tmp, 'nested', 'actions.jsonl');   // nested: append must create the dir
    append(p, action({}));
    eq('append creates the ledger directory it needs', fs.existsSync(p), true);
    eq('a ledger round-trips through disk', foldFile(p).rows.size, 1);

    // CRLF: the one Windows claim this file makes about reading, now measured.
    const crlf = path.join(tmp, 'crlf.jsonl');
    fs.writeFileSync(crlf, JSON.stringify(action({})) + '\r\n' + JSON.stringify({ key: K, done: true }) + '\r\n');
    eq('a CRLF ledger folds with no damage', foldFile(crlf).bad, []);
    eq('...and folds to the same state as LF', foldFile(crlf).rows.get(K).done, true);

    // MISSING vs UNREADABLE, the distinction the earlier readLedger lost. A directory is the
    // portable way to make readFileSync fail with something other than ENOENT (EISDIR here).
    eq('a ledger that does not exist is missing, not unreadable', readLedger(path.join(tmp, 'nope.jsonl')).missing, true);
    eq('...and grades as a skip', grade(foldFile(path.join(tmp, 'nope.jsonl'))).skipped, 1);
    const asDir = path.join(tmp, 'ledger-as-dir');
    fs.mkdirSync(asDir);
    const unread = readLedger(asDir);
    eq('a ledger that exists and cannot be read is NOT missing', unread.missing, false);
    eq('...it is unreadable', unread.unreadable, true);
    eq('...and the reason is reported, not swallowed', /EISDIR|EPERM|EACCES/.test(unread.why), true);
    eq('...it FAILS the gate instead of declaring a skip', [grade(foldFile(asDir)).fail, grade(foldFile(asDir)).skipped], [1, 0]);
    eq('...and no effect may run against it', integrity(foldFile(asDir)).ok, false);

    // The lock itself: exclusive while held, released afterwards, and a second holder refused.
    const lp = path.join(tmp, 'lock-target.jsonl');
    let inside = false;
    withLedgerLock(lp, () => { inside = fs.existsSync(lp + '.lock'); });
    eq('the lock file exists while the body runs', inside, true);
    eq('...and is released afterwards', fs.existsSync(lp + '.lock'), false);

    let second = 'not attempted';
    withLedgerLock(lp, () => { second = refusal(() => withLedgerLock(lp, () => { second = 'GRANTED TWICE'; }, { tries: 1, ttlMs: 60000 })); });
    eq('a second holder is refused while the first holds it', /already held/.test(second), true);
    eq('...and the refusal names the TTL reason', /under the 60000ms TTL/.test(second), true);
    eq('...and prints the exact command that clears the lock', second.indexOf(lockClearHint(lp + '.lock')) > 0, true);

    // A dead holder's lock is stolen; a live one's is not.
    fs.writeFileSync(lp + '.lock', JSON.stringify({ pid: 999999, host: os.hostname(), nonce: 'x', at: '2000-01-01T00:00:00.000Z' }) + '\n');
    let stole = false;
    withLedgerLock(lp, () => { stole = true; }, { tries: 1, ttlMs: 1000, isGone: () => true });
    eq('a provably dead holder\'s lock is stolen', stole, true);
    eq('...and the stealer\'s own lock is released after', fs.existsSync(lp + '.lock'), false);

    // THE BRICK. A crash between create and write leaves a ZERO-BYTE lock. The earlier table
    // refused that shape at any age, with any retry count, even with a dead holder — so the
    // ledger was unusable forever without a hand delete nobody was told about.
    fs.writeFileSync(lp + '.lock', '');
    eq('an empty lock file is refused while it is FRESH', /unreadable or malformed/.test(refusal(() => withLedgerLock(lp, () => {}, { tries: 1, ttlMs: 60000 }))), true);
    let unbricked = false;
    // Wrapped in refusal(): a regression here must be REPORTED as a failing check, not thrown
    // out of the suite as a stack trace that never prints the one-line verdict.
    const stillBricked = refusal(() => withLedgerLock(lp, () => { unbricked = true; }, { tries: 1, ttlMs: 0, isGone: () => false }));
    eq('...and stolen once past the TTL, so the ledger is never bricked', [unbricked, stillBricked], [true, '']);
    eq('...leaving no lock behind', fs.existsSync(lp + '.lock'), false);

    // Release only what is ours. The earlier release unlinked whatever .lock was on disk, which
    // after a steal is another run's LIVE lock.
    fs.writeFileSync(lp + '.lock', JSON.stringify({ pid: process.pid, host: os.hostname(), nonce: 'AAA', at: 'T' }) + '\n');
    eq('a lock with somebody else\'s nonce is NOT released', releaseIfOurs(lp + '.lock', 'BBB'), 'not ours');
    eq('...and is still on disk', fs.existsSync(lp + '.lock'), true);
    eq('our own lock is released', releaseIfOurs(lp + '.lock', 'AAA'), 'released');
    eq('...and is gone', fs.existsSync(lp + '.lock'), false);
    eq('releasing a lock that already vanished is not an error', releaseIfOurs(lp + '.lock', 'AAA'), 'already gone');

    // The two-stealer window: a steal must not remove a lock that CHANGED since it was judged,
    // because between the judgement and the unlink the holder may have released and a new run
    // may have created a live one.
    // read-or-null, so a steal that wrongly deleted the file reports a failing check instead of
    // throwing ENOENT out of the suite.
    const peek = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
    fs.writeFileSync(lp + '.lock', 'CORPSE');
    const judged = readLockState(lp + '.lock');
    fs.writeFileSync(lp + '.lock', 'A DIFFERENT, LIVE LOCK');
    eq('a steal refuses to remove a lock whose bytes changed since it was judged', removeCorpse(lp + '.lock', judged).removed, false);
    eq('...and puts the live lock back', peek(lp + '.lock'), 'A DIFFERENT, LIVE LOCK');
    fs.writeFileSync(lp + '.lock', 'CORPSE');
    eq('the corpse it actually judged IS removed', removeCorpse(lp + '.lock', readLockState(lp + '.lock')).removed, true);
    eq('...and nothing is left parked beside it', fs.readdirSync(tmp).filter((f) => f.indexOf('.stale-') >= 0), []);

    // ---- A LOCK THAT IS A DIRECTORY. Measured: `log` recovered and appended, and left
    // 'g.jsonl.lock.stale-23368-1791250894522' beside the ledger FOREVER, because removeCorpse
    // could only unlinkSync — and the printed hint ('del ...') cannot remove a directory on
    // Windows either. The ledger lives in a track folder where commit-hygiene BLOCKS a stray.
    const dl = path.join(tmp, 'dirlock.jsonl');
    const dlk = dl + '.lock';
    const old = new Date(Date.now() - 120000);
    const strayNames = () => fs.readdirSync(tmp).filter((f) => f.indexOf('.stale-') >= 0);
    fs.mkdirSync(dlk); fs.utimesSync(dlk, old, old);
    const jd = readLockState(dlk);
    eq('a DIRECTORY lock reads as a directory with no bytes, not as missing', [jd.gone, jd.isDir, jd.raw], [false, true, null]);
    eq('a judged DIRECTORY corpse is actually removed', removeCorpse(dlk, jd).removed, true);
    eq('...leaving nothing parked beside the ledger', strayNames(), []);

    // ...and the same shape end to end: recovery must neither brick the ledger nor litter it.
    fs.mkdirSync(dlk); fs.utimesSync(dlk, old, old);
    let tookDir = false;
    withLedgerLock(dl, () => { tookDir = true; }, { tries: 1, ttlMs: 1000, waitMs: 1 });
    eq('a stale DIRECTORY lock is recovered, not refused forever', tookDir, true);
    eq('...the recovery leaves no stray in the folder', strayNames(), []);
    eq('...and no lock', fs.existsSync(dlk), false);

    // A park left by a run that DIED mid-steal is swept by the next recovery. The ledger's home is
    // a track folder, so a stray there blocks the very commit that would preserve the record.
    fs.mkdirSync(dlk); fs.utimesSync(dlk, old, old);
    const ghost = path.join(tmp, path.basename(dlk) + '.stale-999999-1');
    fs.writeFileSync(ghost, 'parked by a run that never came back');
    fs.utimesSync(ghost, old, old);
    let took2 = false;
    withLedgerLock(dl, () => { took2 = true; }, { tries: 1, ttlMs: 1000, waitMs: 1 });
    eq('a recovery sweeps a park an earlier run left behind', [took2, fs.existsSync(ghost)], [true, false]);

    // An unreadable CORPSE and an unreadable LIVE lock both read as raw=null, so a byte compare
    // confirmed a lock it had never judged — and the live one was already moved away by then.
    fs.mkdirSync(dlk); fs.utimesSync(dlk, old, old);
    const judgedDir = readLockState(dlk);
    fs.rmSync(dlk, { recursive: true, force: true });
    fs.mkdirSync(dlk);                                   // a DIFFERENT directory, also raw=null
    eq('two unreadable things are not the same lock', fingerprintLock(readLockState(dlk)) === fingerprintLock(judgedDir), false);
    eq('...so the steal refuses', removeCorpse(dlk, judgedDir).removed, false);
    eq('...and the live one is put back, not left parked', [fs.existsSync(dlk) && fs.statSync(dlk).isDirectory(), strayNames()], [true, []]);
    fs.rmSync(dlk, { recursive: true, force: true });

    // The hint has to match the SHAPE, or it is a command the operator can only watch fail.
    eq('the clear hint for a directory is not the one for a file', clearHint('X', true) === clearHint('X', false), false);
    eq('...and it is a command that can remove a directory on this platform', /^(rmdir \/s \/q|rm -rf) "X"$/.test(clearHint('X', true)), true);

    // THE HOT LOOP. `if (state.gone) continue;` had no counter, no sleep and no bound, so EEXIST
    // on create paired with a persistently failing stat spun at 100% CPU with no message and no
    // exit. The injected reader is the only way to produce that interleaving on demand; with the
    // bound removed this check does not fail, it never returns at all.
    fs.writeFileSync(dl + '.lock', 'x');
    const spun = refusal(() => withLedgerLock(dl, () => {}, { tries: 3, waitMs: 1, readState: () => ({ gone: true, mtimeMs: NaN, size: -1, ino: 0, isDir: false, raw: null, readErr: 'EACCES', info: null }) }));
    eq('EEXIST plus a lock that cannot be stat-ed REFUSES instead of spinning', /cannot be stat-ed, 4 attempts running/.test(spun), true);
    eq('...and still prints a command that clears it', spun.indexOf(clearHint(dl + '.lock', false)) > 0, true);
    fs.unlinkSync(dl + '.lock');

    // A park that could not be deleted is swept rather than left for commit-hygiene to find.
    const parkedName = path.basename(dlk) + '.stale-' + process.pid + '-1';
    fs.mkdirSync(path.join(tmp, parkedName));
    eq('a parked corpse left by an earlier run is swept', sweepStrays(dlk, Date.now(), 1000).swept, 1);
    eq('...and the folder is clean', strayNames(), []);
    fs.mkdirSync(path.join(tmp, path.basename(dlk) + '.stale-999999-' + Date.now()));
    eq('somebody ELSE\'s fresh park is left alone — a steal in flight is not litter', sweepStrays(dlk, Date.now(), 30000).swept, 0);
    eq('...but the same park is swept once it is past the TTL', sweepStrays(dlk, Date.now() + 60000, 30000).swept, 1);

    // MUTUAL EXCLUSION, actually exercised. The earlier version of this case called an
    // enqueue helper TWICE IN SEQUENCE — the first released before the second started — so it
    // passed against a completely unlocked implementation and proved nothing. Here the second
    // attempt runs WHILE the first holder is inside its critical section, against an EMPTY
    // ledger: without the lock it would fold, see no key, and append the duplicate.
    const race = path.join(tmp, 'race.jsonl');
    const enqueueOnce = () => withLedgerLock(race, () => {
      const f = foldFile(race);
      if (logDecision(f, K).action !== 'append') return 'refused';
      append(race, action({}));
      return 'appended';
    }, { tries: 1, ttlMs: 60000 });

    let whileHeld = 'not attempted';
    let sawRows = -1;
    withLedgerLock(race, () => {
      whileHeld = refusal(enqueueOnce);           // the ledger does not exist yet
      sawRows = foldFile(race).rows.size;
      append(race, action({}));                   // the holder's own row, written inside the section
    }, { tries: 1, ttlMs: 60000 });
    eq('an enqueue attempted while the lock is HELD is refused by the LOCK', /already held/.test(whileHeld), true);
    eq('...before it could append anything', sawRows, 0);
    eq('...so the ledger holds exactly the holder\'s one row', foldFile(race).rows.size, 1);
    eq('...and no duplicate was ever written', foldFile(race).duplicates, []);
    eq('and once the lock is free, the row on disk is what refuses the next enqueue', enqueueOnce(), 'refused');

    // main()'s EXIT CONTRACT, driven through the real CLI: an exit code cannot be observed from
    // inside this process, and the contract — 0 enqueued, 3 already pending, 1 refused — is what
    // a shell wrapper acts on. Without this the whole of main() has no test at all.
    const cli = (args) => {
      const r = spawnSync(process.execPath, [__filename].concat(args), { encoding: 'utf8' });
      return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
    };
    const led = path.join(tmp, 'cli.jsonl');
    const first = cli(['log', '--kind', 'push', '--target', 'origin/main', '--ledger', led]);
    eq('log enqueues and exits 0', first.code, 0);
    eq('...printing the key as its first line', /^[0-9a-f]{16}$/.test(first.out.split('\n')[0].trim()), true);
    eq('...and the bar the POLICY set, not one the caller chose', /approval REQUIRED: push leaves this tree/.test(first.out), true);
    const again = cli(['log', '--kind', 'push', '--target', 'origin/main', '--ledger', led]);
    eq('a second log of the same effect exits 3, so a wrapper cannot read it as its own enqueue', again.code, 3);
    eq('...and says ALREADY PENDING', /ALREADY PENDING/.test(again.out), true);
    eq('--check ends with the GATE line and exits 0 on a clean pending row', [cli(['--check', '--ledger', led]).out.trim().split('\n').pop(), cli(['--check', '--ledger', led]).code], ['GATE effects pass=1 fail=0 skipped=0', 0]);
    eq('run refuses an unapproved push by naming the policy reason', /requires approval \(push leaves this tree\)/.test(cli(['run', '--key', first.out.split('\n')[0].trim(), '--ledger', led]).out), true);
    const noArgs = cli([]);
    eq('no args prints usage and exits 0', [noArgs.code, /^usage:/.test(noArgs.out)], [0, true]);
    eq('an unknown command exits 1', cli(['frobnicate', '--ledger', led]).code, 1);
    eq('a missing --ledger is refused, not defaulted', [cli(['--check']).code, /--ledger <path> is required/.test(cli(['--check']).out)], [1, true]);
    // A decision appended to a ledger that is damaged decides nothing, because the fold it will
    // be read back through is already untrustworthy. `decide` refuses for the same reason log does.
    const hurt = path.join(tmp, 'damaged.jsonl');
    fs.writeFileSync(hurt, JSON.stringify(action({})) + '\n{"key":"' + K + '","do\n');
    const decided = cli(['decide', '--key', K, '--approve', '--who', 'x@example.com', '--ledger', hurt]);
    eq('decide REFUSES on a damaged ledger', decided.code, 1);
    eq('...naming the damage rather than appending a decision', /damaged or unaccountable line/.test(decided.out), true);
    eq('...and wrote nothing', fs.readFileSync(hurt, 'utf8').split('\n').filter((l) => /approved/.test(l)), []);

    // ---- THE EXECUTOR DERIVES THE KIND FROM THE COMMAND, end to end through the real CLI.
    const ledX = path.join(tmp, 'exec.jsonl');
    const lg = cli(['log', '--ledger', ledX, '--', 'git', 'push', 'origin', 'main']);
    const kx = lg.out.split('\n')[0].trim();
    eq('log derives kind and target from the command after `--`', [lg.code, /push  ->  origin\/main/.test(lg.out)], [0, true]);
    eq('...and says what it derived them from', /derived from: git push origin main/.test(lg.out), true);
    eq('...and the key it wrote is keyFor(push, origin/main, sha256(""))', kx, keyFor('push', 'origin/main', ''));
    // THE CHALLENGE IS ON STDERR ONLY: stdout is what a wrapper captures and a log file keeps.
    const chal = (/CHALLENGE \S+ (\S+)/.exec(lg.err) || [])[1] || '';
    eq('the challenge plaintext is printed to stderr, and never to stdout', [/^[0-9a-f]{32}$/.test(chal), /CHALLENGE/.test(lg.out)], [true, false]);
    const rawX = fs.readFileSync(ledX, 'utf8');
    eq('...the ledger stores only its sha256', [/"challengeSha":"[0-9a-f]{64}"/.test(rawX), rawX.indexOf(chal) >= 0], [true, false]);
    eq('an approval with no --challenge is REFUSED, not recorded unverified', [cli(['decide', '--key', kx, '--approve', '--ledger', ledX]).code, /needs --challenge/.test(cli(['decide', '--key', kx, '--approve', '--ledger', ledX]).out)], [1, true]);
    const badChal = cli(['decide', '--key', kx, '--approve', '--challenge', 'not-it', '--ledger', ledX]);
    eq('a WRONG --challenge is refused', [badChal.code, /does not verify/.test(badChal.out)], [1, true]);
    eq('...and appended nothing', fs.readFileSync(ledX, 'utf8').split('\n').filter((l) => /"approved"/.test(l)), []);
    const okDec = cli(['decide', '--key', kx, '--approve', '--challenge', chal, '--who', 'ceo@example.com (not really)', '--ledger', ledX]);
    eq('the right challenge approves', [okDec.code, /challenge VERIFIED/.test(okDec.out)], [0, true]);
    eq('...and --who is recorded as a LABEL, not as the decider', /\(label: "ceo@example.com \(not really\)", which no verdict reads\)/.test(okDec.out), true);
    const decLine = JSON.parse(fs.readFileSync(ledX, 'utf8').split('\n').filter((l) => /"approved"/.test(l))[0]);
    eq('...so the ledger\'s name is the observed identity, never the caller\'s string', decLine.name === 'ceo@example.com (not really)', false);
    eq('...with the label beside it', decLine.label, 'ceo@example.com (not really)');
    eq('...and --check is green on a verified approval', cli(['--check', '--ledger', ledX]).out.trim().split('\n').pop(), 'GATE effects pass=1 fail=0 skipped=0');
    const good = cli(['run', '--key', kx, '--ledger', ledX, '--', 'git', 'push', 'origin', 'main']);
    eq('run with the command it was logged for proceeds', [good.code, /WOULD RUN/.test(good.out)], [0, true]);
    eq('...printing the kind it DERIVED, beside the key it recomputed', /classified: kind=push target=origin\/main/.test(good.out), true);
    const wrongTarget = cli(['run', '--key', kx, '--ledger', ledX, '--', 'git', 'push', 'origin', 'next']);
    eq('run against a DIFFERENT target is refused by the recomputed key', [wrongTarget.code, /NOT the effect that was logged/.test(wrongTarget.out)], [1, true]);
    const relabelled = cli(['run', '--key', kx, '--ledger', ledX, '--', 'ls', '-la']);
    eq('...and so is a command that classifies as something else entirely', [relabelled.code, /classifies as local/.test(relabelled.out)], [1, true]);
    eq('--execute with no command after `--` is refused before anything else', [cli(['run', '--key', kx, '--ledger', ledX, '--execute']).code, /the kind is DERIVED from that command/.test(cli(['run', '--key', kx, '--ledger', ledX, '--execute']).out)], [1, true]);
    eq('--execute with a MISMATCHED command is refused by the key, not by the dead end', /NOT the effect that was logged/.test(cli(['run', '--key', kx, '--ledger', ledX, '--execute', '--', 'git', 'push', 'origin', 'next']).out), true);
    eq('--execute with the right command still refuses: no executor is wired', /--execute is not wired/.test(cli(['run', '--key', kx, '--ledger', ledX, '--execute', '--', 'git', 'push', 'origin', 'main']).out), true);

    // THE MEASURED HOLE, through the CLI: a push called a `note`.
    const misP = path.join(tmp, 'mislabel.jsonl');
    const mis = cli(['log', '--kind', 'note', '--target', 'origin/main', '--ledger', misP]);
    eq('log REFUSES a local kind aimed at a target that leaves the tree', [mis.code, /claims to stay in-tree but target "origin\/main" leaves it/.test(mis.out)], [1, true]);
    eq('...and wrote no ledger at all', fs.existsSync(misP), false);
    const dis = cli(['log', '--kind', 'note', '--ledger', misP, '--', 'git', 'push', 'origin', 'main']);
    eq('a --kind that disagrees with the command is refused', [dis.code, /disagrees with the command/.test(dis.out)], [1, true]);
    // The hand-forged line, graded by the real CLI: this exact ledger printed
    // 'every logged effect is accounted for and authorised', pass=1 fail=0, exit 0.
    const forgedP = path.join(tmp, 'forged.jsonl');
    fs.writeFileSync(forgedP, '{"kind":"note","key":"K4","target":"origin/main","done":true,"result":"pushed to origin/main"}\n');
    const fck = cli(['--check', '--ledger', forgedP]);
    eq('the exact forged line from the review now FAILS the gate', [fck.code, fck.out.trim().split('\n').pop()], [1, 'GATE effects pass=0 fail=3 skipped=0']);
    eq('...naming both the forged key and the mislabelled kind', [/is not keyFor/.test(fck.out), /claims to stay in-tree/.test(fck.out)], [true, true]);

    // A DENIAL IS FINAL, and the exit code and the fix line both have to say so.
    const denP = path.join(tmp, 'denied.jsonl');
    const dlog = cli(['log', '--ledger', denP, '--', 'git', 'push', 'origin', 'main']);
    const dk = dlog.out.split('\n')[0].trim();
    const dchal = (/CHALLENGE \S+ (\S+)/.exec(dlog.err) || [])[1] || '';
    eq('a denial needs no challenge — nothing should stand between a human and stopping an effect', cli(['decide', '--key', dk, '--deny', '--ledger', denP]).code, 0);
    const after = cli(['decide', '--key', dk, '--approve', '--challenge', dchal, '--ledger', denP]);
    eq('an approval after a denial exits 3: the verb succeeded, the verdict did not move', [after.code, /denial is final/.test(after.out)], [3, true]);
    eq('run names the dead end instead of offering `decide --approve` again', /no way forward for this key/.test(cli(['run', '--key', dk, '--ledger', denP]).out), true);

    // A HAND-APPENDED APPROVAL, through the CLI: recorded, reported, and refused by run.
    const unvP = path.join(tmp, 'unverified.jsonl');
    const ulog = cli(['log', '--ledger', unvP, '--', 'git', 'push', 'origin', 'main']);
    const uk = ulog.out.split('\n')[0].trim();
    fs.appendFileSync(unvP, JSON.stringify({ key: uk, approved: true, name: 'nobody-checked-this', time: 'T' }) + '\n');
    const uck = cli(['--check', '--ledger', unvP]);
    eq('a hand-appended approval reds the gate', [uck.code, /UNVERIFIED approval/.test(uck.out)], [1, true]);
    eq('...and run refuses it by name', /do NOT verify/.test(cli(['run', '--key', uk, '--ledger', unvP]).out), true);

    // --check's FIX LINE MATCHES THE FAILURE THAT FIRED. Measured: a ledger whose only failure was
    // a truncated line printed 'the effect ALREADY HAPPENED' — an authorisation incident nothing
    // had reported, while the actual repair was only in the problem list above it.
    const truncP = path.join(tmp, 'truncated.jsonl');
    fs.writeFileSync(truncP, JSON.stringify(action({})) + '\n{"key":"KH","do\n');
    const tck = cli(['--check', '--ledger', truncP]);
    eq('a truncated line fails the check', [tck.code, tck.out.trim().split('\n').pop()], [1, 'GATE effects pass=1 fail=1 skipped=0']);
    eq('...and the fix is the append-only repair, NOT "the effect ALREADY HAPPENED"', [/APPEND-ONLY/.test(tck.out), /ALREADY HAPPENED/.test(tck.out)], [true, false]);
    const unauthP = path.join(tmp, 'unauth.jsonl');
    fs.writeFileSync(unauthP, JSON.stringify(action({})) + '\n' + JSON.stringify({ key: K, done: true, result: 'pushed' }) + '\n');
    eq('...while the ledger that DID record a done effect without approval gets that fix', /ALREADY HAPPENED/.test(cli(['--check', '--ledger', unauthP]).out), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? 'FAIL — actions.js self-test (' + fails.length + ' of ' + n + ')'
    : 'PASS — actions.js self-test (' + n + ' checks)');
  process.exit(fails.length ? 1 : 0);
}

/* ---------- main ---------- */
function main() {
  if (has('--self-test')) return selfTest();
  const cmd = FLAGS[0] && FLAGS[0][0] !== '-' ? FLAGS[0] : (has('--check') ? '--check' : null);
  if (!cmd) return usage(0);          // no args is a question, not an error

  const L = resolveLedger(FLAGS);
  if (L.error) return die(L.error);
  const p = L.path;

  if (cmd === '--check') {
    const folded = foldFile(p);
    const g = grade(folded);
    console.log('ledger: ' + p);
    for (const s of g.skips) console.log('  - skip: ' + s);
    for (const problem of g.problems) console.log('  x ' + problem);
    if (!g.fail && !g.skipped) console.log('  every logged effect is accounted for and authorised');
    // One fix PER CAUSE, carried by the findings themselves. The old single line was chosen by
    // `else if (g.fail)`, so a truncated line was reported as an effect that had already fired.
    for (const fix of g.fixes) console.log('  fix: ' + fix);
    console.log(gateLine(g));                 // last stdout line, always
    return process.exit(g.fail ? 1 : 0);
  }

  if (cmd === 'log') {
    const kind = flagValue(FLAGS, '--kind'); const target = flagValue(FLAGS, '--target');
    if (kind.error || target.error) return die(kind.error || target.error);
    // THE COMMAND IS THE BEST DESCRIPTION OF THE EFFECT. `log -- git push origin main` derives
    // kind and target through the SAME classifier the executor uses, so the two sides cannot
    // disagree about the identity of the effect. A caller that names both must agree with it.
    let kindV = kind.absent ? '' : kind.value;
    let targetV = target.absent ? '' : target.value;
    let derivedFrom = '';
    if (CMD.length) {
      const c = classifyArgv(CMD);
      if (kindV && normalizeKind(kindV) !== c.kind) return die('--kind ' + JSON.stringify(kindV) + ' disagrees with the command after `--`, which classifies as ' + JSON.stringify(c.kind) + ' (' + c.why + ') — the command decides what the effect IS, so fix the flag or drop it');
      if (targetV && targetV.trim() !== c.target) return die('--target ' + JSON.stringify(targetV) + ' disagrees with the target derived from the command, ' + JSON.stringify(c.target) + ' — drop --target and let the command say where it goes');
      kindV = c.kind; targetV = c.target; derivedFrom = c.command;
    }
    if (!kindV || !targetV) return die('log needs --kind <k> and --target <t>, or the command itself after `--` (log --ledger <p> -- git push origin main)');
    const pay = flagValue(FLAGS, '--payload');
    if (pay.error) return die(pay.error);
    const payload = pay.value || '';
    const key = keyFor(kindV, targetV, payload);
    const policy = approvalPolicy(kindV);
    // MECHANISM B at the door, not only in --check: a local verb aimed somewhere that leaves is
    // refused before it is written, because the measured hole was exactly this call succeeding.
    const conflict = kindTargetConflict(kindV, targetV);
    if (conflict) return die(conflict + ' — REFUSED: log the effect under the kind that matches where it actually goes');
    // The challenge is minted here and PRINTED ONCE, to stderr. Only its sha256 reaches the file,
    // so a later approval has to come from somebody who saw this terminal. The header is blunt
    // about what that is worth: it raises the cost of a self-approval, it does not prove a human.
    const challenge = crypto.randomBytes(16).toString('hex');
    // The whole read-check-append is one critical section. Outside it, two terminals both saw
    // the key absent, both appended, and both pushed — the duplicate was only ever DETECTED
    // afterwards, by a --check that ran after both effects had fired.
    let code = 0;
    try {
      code = withLedgerLock(p, () => {
        const folded = foldFile(p);
        const i = integrity(folded);
        if (!i.ok) { console.log('REFUSED — ' + i.why); return 1; }
        const d = logDecision(folded, key);
        if (d.action === 'pending') {
          console.log(key);
          // Exit 3, not 0: a wrapper that reads the key off stdout must not mistake somebody
          // else's enqueue for its own and go on to run the effect.
          console.log('ALREADY PENDING — this effect is enqueued and must NOT be enqueued again (exit 3)');
          return 3;
        }
        if (d.action === 'done') {
          console.log(key);
          console.log('REFUSED — a DONE action is on the pending list: the effect already happened');
          return 1;
        }
        // Written BEFORE anything leaves the tree: a crash must leave a record, not silence.
        // requiresApproval is written from the POLICY so a reader sees the bar; it is never read back.
        append(p, { kind: kindV, key, target: targetV, payloadSha: sha256(payload), challengeSha: sha256(challenge), requiresApproval: policy.required, done: false, result: null, error: null, logged_at: new Date().toISOString() });
        console.log(key);
        console.log('  ' + kindV + '  ->  ' + targetV + (derivedFrom ? '   (derived from: ' + derivedFrom + ')' : ''));
        console.log('  approval ' + (policy.required ? 'REQUIRED' : 'not required') + ': ' + policy.why);
        // stderr ONLY, and not in the ledger: stdout is what a wrapper captures and a transcript
        // keeps. This is the one line that must be read rather than parsed.
        process.stderr.write('CHALLENGE ' + key + ' ' + challenge + '\n');
        process.stderr.write('  printed ONCE, to stderr, and never written to the ledger (only its sha256 is).\n');
        process.stderr.write('  `decide --key ' + key + ' --approve --challenge <that value>` is the only approval that verifies.\n');
        if (has('--requires-approval')) console.log('  note: --requires-approval is ignored — the requirement comes from the kind, not from the caller or the row');
        return 0;
      });
    } catch (e) { return die((e && e.message) || String(e)); }
    return process.exit(code);
  }

  if (cmd === 'decide') {
    const k = flagValue(FLAGS, '--key');
    if (k.error) return die(k.error);
    if (k.absent || !k.value) return die('decide needs --key <k>');
    const key = k.value;
    if (has('--approve') === has('--deny')) return die('decide needs exactly one of --approve or --deny');
    // --who SIGNS NOTHING. It was unvalidated free text that `whoAmI` only fell back to, so the
    // ledger recorded whatever the caller typed — `ceo@example.com (not really)` included. The
    // name is now the OBSERVED git identity for the ledger's own directory, and --who is kept as
    // a label beside it, which no verdict ever reads.
    const who = flagValue(FLAGS, '--who');
    if (who.error) return die(who.error);
    const ch = flagValue(FLAGS, '--challenge');
    if (ch.error) return die(ch.error);
    let code = 0;
    try {
      code = withLedgerLock(p, () => {
        const folded = foldFile(p);
        // A decision appended to a ledger that cannot be read, or that is damaged, decides
        // nothing: the fold it will be read back through is already untrustworthy.
        const i = integrity(folded);
        if (!i.ok) throw new Error(i.why);
        const prior = folded.rows.get(key);
        if (!prior) throw new Error('no action logged under key ' + key + ' — a decision nobody can read is not a decision');
        const approving = has('--approve');
        // An APPROVAL must meet the challenge; a DENIAL must not, because a bar on the
        // conservative answer is a bar on stopping an effect. Verified BEFORE the append, so this
        // CLI never writes an unverified approval — only a hand edit can, and --check names it.
        let v = { ok: false, why: 'a denial needs no challenge' };
        if (approving) {
          if (ch.absent || !ch.value) throw new Error('an approval needs --challenge <value>: the plaintext `log` printed to stderr for ' + key + '. Without it the decision would be recorded UNVERIFIED and run would refuse it.');
          v = verifyChallenge(prior, ch.value);
          if (!v.ok) throw new Error('the --challenge does not verify for ' + key + ' (' + v.why + ') — nothing was appended');
        }
        const row = { key, name: whoAmI(path.dirname(p)), label: who.absent ? null : String(who.value), time: new Date().toISOString(), approved: approving };
        if (approving) row.challenge = ch.value;
        append(p, row);
        console.log((row.approved ? 'APPROVED' : 'DENIED') + ' ' + key + ' by ' + row.name + (row.label ? ' (label: ' + JSON.stringify(row.label) + ', which no verdict reads)' : ''));
        if (approving) console.log('  challenge VERIFIED: ' + v.why);
        // The state, not just the verb: appending an approval over a denial used to print
        // APPROVED while approved() stayed false, and only a later `run` revealed it.
        const after = prior.decisions.concat([{ approved: row.approved, verified: v.ok }]);
        if (row.approved && !approvedVerified({ decisions: after })) {
          // Exit 3, like `log`'s already-pending: a wrapper under `set -e` read exit 0 here and
          // went on to `run`, which then refused. The verb succeeded; the decision changed nothing.
          console.log('  the key is still NOT approved: a denial is final and no later approval can outvote it (exit 3)');
          return 3;
        }
        return 0;
      });
    } catch (e) { return die((e && e.message) || String(e)); }
    return process.exit(code);
  }

  if (cmd === 'run') {
    const k = flagValue(FLAGS, '--key');
    if (k.error) return die(k.error);
    if (k.absent || !k.value) return die('run needs --key <k>');
    const key = k.value;
    const folded = foldFile(p);
    const i = integrity(folded);
    // A damaged or unreadable ledger may be missing the done-row for an effect that already
    // fired. Refusing is the only answer that cannot double-fire; --check names what to repair.
    if (!i.ok) return die(i.why);
    const row = folded.rows.get(key);
    if (!row) return die('unknown key ' + key);
    if (row.done) return die(key + ' is already done — re-running is the double-effect this ledger exists to stop');
    if (row.requiresApproval && !approved(row)) {
      // The fix line used to say `decide --approve` for EVERY unapproved state, including the one
      // state where that cannot work: a denial is final, so following it printed APPROVED, then
      // "still NOT approved", and run refused identically.
      const denied = row.decisions.some((d) => d.approved === false);
      return die(key + ' requires approval (' + row.approvalWhy + ') and has ' + (denied ? 'a DENIAL, which is final: there is no way forward for this key — log the effect again under a changed payload if it genuinely must happen, and have THAT key decided' : 'none: run `decide --key ' + key + ' --approve --challenge <the value log printed to stderr>`'));
    }
    if (row.requiresApproval && !approvedVerified(row)) {
      return die(key + ' has approval(s) that do NOT verify [' + unverifiedApprovals(row).map((d) => d.name + ': ' + d.verifyWhy).join('; ') + '] — an approval nobody could authenticate authorises nothing.\n  fix: ' + FIX.unverified);
    }
    // THE EXECUTOR DERIVES THE KIND FROM THE COMMAND IT IS ABOUT TO RUN, never from the row, and
    // then refuses unless the key it recomputes is the key that was logged and approved. Because
    // the key is sha256(normalised kind | target | payloadSha), a match PROVES the command's kind
    // and target are the row's — so the approval bar that was applied is the bar for the command
    // actually about to run. Renaming the verb changes the key; that is the whole mechanism.
    const plan = CMD.length ? classifyArgv(CMD) : null;
    if (has('--execute') && !plan) return die('--execute needs the command it is about to run, after `--` (run --key ' + key + ' --ledger <p> --execute -- git push origin main): the kind is DERIVED from that command, never read off the row');
    if (plan) {
      const derivedKey = keyForSha(plan.kind, plan.target, row.payloadSha);
      console.log('command: ' + shellish(CMD));
      console.log('  classified: kind=' + plan.kind + ' target=' + plan.target + ' (' + plan.why + ')');
      console.log('  derived key=' + derivedKey + '  row key=' + key);
      if (derivedKey !== key) {
        return die('REFUSED — the command classifies as ' + plan.kind + ' -> ' + plan.target + ', whose key is ' + derivedKey
          + ', but this row is ' + row.kind + ' -> ' + row.target + ' (' + key + '). The effect about to run is NOT the effect that was logged'
          + (approvalPolicy(plan.kind).required && !approvalPolicy(row.kind).required ? ' — and the command requires approval (' + approvalPolicy(plan.kind).why + ') while the row claimed it did not' : '')
          + '.\n  fix: log the command itself (log --ledger <p> -- ' + shellish(CMD) + '), have THAT key approved, and run it');
      }
    }
    console.log('WOULD RUN  ' + row.kind + '  ->  ' + row.target);
    console.log('  key=' + key + ' payloadSha=' + row.payloadSha + ' approvals=' + row.decisions.length + ' verified=' + row.decisions.filter((d) => d.verified).length + ' approval=' + (row.requiresApproval ? 'required (' + row.approvalWhy + ')' : 'not required'));
    if (has('--execute')) {
      // Deliberate dead end. No executor is wired yet, and an --execute that silently did
      // nothing would be worse than one that refuses: the caller would record success.
      console.log('REFUSED — --execute is not wired in this build: no effect runner exists yet.');
      console.log('  fix: wire an executor per kind, then mark the row done with an appended state row');
      return process.exit(1);
    }
    console.log('(dry run — pass --execute once an executor exists; it refuses today)');
    return process.exit(0);
  }

  console.log('FAIL — unknown command ' + JSON.stringify(cmd));
  return usage(1);
}

function usage(code) {
  console.log('usage: node scripts/harness/actions.js log --ledger <p> -- <the command, e.g. git push origin main>');
  console.log('       node scripts/harness/actions.js log --kind <k> --target <t> --ledger <p> [--payload <s>]');
  console.log('       node scripts/harness/actions.js decide --key <k> --approve --challenge <v> --ledger <p> [--who <label>]');
  console.log('       node scripts/harness/actions.js decide --key <k> --deny --ledger <p>');
  console.log('       node scripts/harness/actions.js run --key <k> --ledger <p> [--execute] -- <the same command>');
  console.log('       node scripts/harness/actions.js --check --ledger <p>');
  console.log('       node scripts/harness/actions.js --self-test');
  console.log('--ledger has NO default: the tracksDir seam is not wired, and a cwd-relative ledger splits in two.');
  console.log('whether an effect needs approval comes from its KIND (the policy table in this file), never from a flag or a ledger line.');
  console.log('the KIND itself comes from the COMMAND after `--`, and a key that does not match the command is refused.');
  console.log('--challenge is the value `log` printed ONCE to stderr; an approval without it is recorded UNVERIFIED and run refuses it.');
  console.log('--who is a LABEL only: the recorded name is the observed git identity.');
  console.log('log exits 0 when it enqueued, 3 when the key was ALREADY PENDING, 1 on a refusal.');
  console.log('decide exits 0 when the decision changed the verdict, 3 when it did not (a denial is final), 1 on a refusal.');
  process.exit(code === undefined ? 0 : code);
}

function die(why) { console.log('FAIL — ' + why); process.exit(1); }

module.exports = { keyFor, keyForSha, fold, approved, approvedVerified, unverifiedApprovals, verifyChallenge, integrity, grade, logDecision, flagValue, resolveLedger, approvalPolicy, normalizeKind, classifyArgv, targetEscapes, kindTargetConflict, stealVerdict, holderIsGone, errorProvesGone, readLockState, fingerprintLock, removeCorpse, sweepStrays, releaseIfOurs, withLedgerLock, clearHint, readLedger, foldFile, selfTest, FIX };

if (require.main === module) main();
