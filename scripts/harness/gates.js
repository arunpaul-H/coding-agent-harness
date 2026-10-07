'use strict';
/* ============================================================
   gates.js — the ONE place a gate figure is allowed to exist.

   WHY THIS EXISTS
   Three separate docs drifted to stale totals and manufactured false regressions;
   the fix was a rule ("the status doc wins") that only works while a human
   remembers it. This replaces the rule with a mechanism: every gate ends its
   stdout with a machine-readable verdict, this script collects them into
   gates.json, and `--check` compares that against a COMMITTED gates.baseline.json.
   A figure in prose is now redundant by construction, and a gate that quietly
   covers less than it used to is a red build rather than a paragraph nobody reads.

   THE GATE LINE PROTOCOL
   The LAST stdout line of every gate is exactly:

       GATE <name> pass=<n> fail=<n> skipped=<n>

   `pass + fail + skipped` is the TOTAL, and that is the load-bearing part:
   comparing only `pass` cannot tell a green run from a run where checks VANISHED.
   A gate that emits no GATE line is a hard failure here — silence is not success.

   WHAT --check REDS ON
     · any fail                              a check failed
     · a non-zero exit with no fails         a verdict the figures cannot express
     · pass < baseline pass                  fewer checks passing than agreed
     · pass+fail+skipped < baseline total    a check DISAPPEARED — pass-by-absence
     · skipped > 0                           unless --allow-skip <gate>=<n>
     · reproducible !== true                 the committed artifacts are not what
                                             this source produces
     · a baseline gate missing from the run  you cannot pass by not running it
     · no GATE line parsed                   the gate died before its verdict

   A RED GATE KEEPS ITS WHOLE OUTPUT in gates.red.<name>.log beside gates.json
   (git-ignored), and the run prints that path: the tail on screen rarely reaches
   the failing check's name. That holds for a gate `--check` reds against the
   baseline and for one `--accept` refuses on.

   `--accept` rewrites the baseline. That is a deliberate re-baseline, so its
   commit subject must start `gates:` — enforced at commit time, not here.

   WHERE THE SUITE COMES FROM
   `harness.config.json` and nowhere else. This file holds no gate list, no app
   list and no artifact list, and it requires no file from the project it is
   grading. The harness it was ported from did all three, which is what made it
   one repo's harness instead of a harness.

   Zero dependencies (Node built-ins only), like every gate it runs.

   Run:  node scripts/harness/gates.js                 run all, write gates.json
         node scripts/harness/gates.js --check          run all, compare to baseline
         node scripts/harness/gates.js --accept         run all, rewrite the baseline
         node scripts/harness/gates.js --only test,docs
         node scripts/harness/gates.js --check --allow-skip reproducible-build=1
         node scripts/harness/gates.js --self-test      no gates run; checks this file
   ============================================================ */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { load, ROOT, fatal } = require('./config.js');

// ! Beside this script, NOT in the repo root — measured in the harness this was
// ported from: the commit gate DENIED a `git add` of a root-level
// gates.baseline.json, because the repo routes working files to /scripts /tests
// /docs and commit-hygiene enforces it. Root would have needed a waiver on every
// run, and a gate you waive routinely is a gate you have switched off.
const GATES_JSON = path.join(__dirname, 'gates.json');
const BASELINE_JSON = path.join(__dirname, 'gates.baseline.json');

// The artifact check's gate name. Fixed rather than configurable so a baseline
// row means the same thing in every repo, and distinct from a plain `build` gate
// so a repo can declare `{ "name": "build", "command": "npm run build" }` without
// colliding with it.
const ARTIFACT_GATE = 'reproducible-build';

/* ---------- argv ---------- */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}
const CHECK = has('--check');
const ACCEPT = has('--accept');
const SELF_TEST = has('--self-test');
const ONLY = (valueOf('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
// --allow-skip reproducible-build=1,lint=1 — the DECISION to tolerate a skip lives
// in the invocation, never in the gate script's own opinion of its environment. A
// gate that decides for itself that its dependency is reasonably absent is a gate
// that goes green on a box where it checks nothing.
const ALLOW_SKIP = (valueOf('--allow-skip') || '').split(',').map((s) => s.trim()).filter(Boolean)
  .reduce((m, pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) { m[pair] = Infinity; return m; }
    m[pair.slice(0, eq)] = Number(pair.slice(eq + 1)) || 0;
    return m;
  }, {});

/* ---------- the config, read once and late ----------
   Late because `--self-test` must work in a tree with no config at all: it tests
   this file, not this repo. Everything else stops hard without one. */
let CFG = null;
function config() {
  if (CFG) return CFG;
  try { CFG = load(); } catch (e) { fatal(e.message, e.fix); }
  return CFG;
}

/* ---------- running a configured command ----------
   A gate's `command` is a shell string, because that is what a repo already has
   written down in its package scripts and its CI file. `shell: true` is therefore
   deliberate and the quoting in the config is the author's to get right. */
function nodeCommand(command) {
  // A command beginning with a bare `node` is re-pointed at THIS process's
  // executable. On Windows `node` on PATH can be a shim whose exit code is not the
  // runner's, and in a repo with a version manager the `node` on PATH need not be
  // the one the harness is running under — so the suite would be graded by a
  // runtime nobody chose. Everything else goes to the shell untouched.
  return command.replace(/^node(?=\s|$)/, '"' + process.execPath + '"');
}
// AN AMBIENT VARIABLE THAT CHANGES WHAT A GATE PRINTS. Measured, not theoretical:
// `node --test` sets NODE_TEST_CONTEXT in every test process it spawns, and a
// `node --test` gate that inherits it switches to the serialized child reporter and
// prints no human summary at all — so the adapter reads no verdict and a passing
// suite reports pass=0. The shape that matters is general: a gate must be graded on
// the environment the suite declares, not on whatever the parent happened to
// export. Scrubbed here, where every gate goes through, rather than per gate.
const SCRUB_ENV = ['NODE_TEST_CONTEXT'];
function gateEnv() {
  const env = Object.assign({}, process.env);
  for (const k of SCRUB_ENV) delete env[k];
  return env;
}
function runCommand(command) {
  return spawnSync(nodeCommand(command), {
    shell: true, cwd: ROOT, encoding: 'utf8', env: gateEnv(), windowsHide: true,
  });
}
// `optional: true` means "an ABSENT TOOL declares a skip, not a fail". It does not
// mean the gate is optional: a tool that is present and unhappy still fails. The
// shapes a missing executable takes differ per platform, so all of them are named.
function toolMissing(r) {
  if (r && r.error && (r.error.code === 'ENOENT' || r.error.code === 'EACCES')) return true;
  if (r && (r.status === 127 || r.status === 9009)) return true;          // sh, cmd.exe
  const err = String((r && r.stderr) || '');
  return /command not found|is not recognized as an internal or external command|No such file or directory/i.test(err);
}

/* ---------- adapters ----------
   Most gates speak the protocol themselves and need no adapter. An adapter is for
   a runner that prints its OWN summary and will not print ours — `node --test`,
   a type checker whose verdict is its exit code. The wrapping lives HERE and not
   in each gate script, which is the whole reason this file exists: a repo should
   be able to gate a tool it does not own.

   An unknown adapter name is a HARD ERROR. Falling back to the GATE-line parser
   would turn a typo (`node_test`) into "this gate emits no verdict", which reads
   as a crashing gate and sends the reader to the wrong file. */
const ADAPTERS = {
  // The default. Reads the LAST GATE line bearing this gate's own name.
  'gate-line': (r, spec) => parseGateLine(r.stdout, spec.gateLine || spec.name),

  // node:test. Both reporter formats are read, because the default reporter is a
  // LOOK and has changed between releases — `# pass N` under tap, `i pass N`
  // under spec — while the numbers either side of it are a format. Pinning one
  // reporter in the config would work too; reading both means a repo that did not
  // pin one still gets a verdict instead of a mystery.
  'node-test': (r) => {
    const out = String(r.stdout || '') + '\n' + String(r.stderr || '');
    const num = (key) => {
      const m = out.match(new RegExp('^(?:#|\\u2139)\\s*' + key + '\\s+(\\d+)\\s*$', 'm'));
      return m ? Number(m[1]) : null;
    };
    const pass = num('pass');
    const fail = num('fail');
    if (pass === null || fail === null) return null; // no summary -> no verdict -> hard failure
    // A CANCELLED test produced no verdict of its own, so it is charged as a
    // failure rather than dropped: dropping it is pass-by-absence with extra steps.
    return { pass: pass, fail: fail + (num('cancelled') || 0), skipped: num('skipped') || 0 };
  },

  // For a tool with no notion of "checks", whose verdict IS its exit code.
  'exit-code': (r) => ({ pass: r.status === 0 ? 1 : 0, fail: r.status === 0 ? 0 : 1, skipped: 0 }),
};
function resolveAdapter(name) {
  const key = name || 'gate-line';
  if (!Object.prototype.hasOwnProperty.call(ADAPTERS, key)) {
    const e = new Error('unknown adapter "' + key + '"');
    e.fix = 'use one of: ' + Object.keys(ADAPTERS).join(', ')
      + ' — or drop `adapter` and have the command end with its own GATE line.';
    throw e;
  }
  return ADAPTERS[key];
}

/* ---------- the committed build artifacts ----------
   The harness this was ported from derived its artifact list from the project's
   own build script with a `require`. That one line was the deepest coupling in the
   file: it made the gate runner unusable in any repo that did not have that
   script, with that export, listing those apps. The list now comes from
   `config.artifacts`, as literal paths or globs, and an EMPTY list declares itself
   rather than passing. Pass-by-absence is the failure this whole file exists to
   end; a reproducible-build check that silently grades nothing would be an
   instance of it sitting inside the mechanism that forbids it. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:[^/]+/)*'; } // `**/` crosses directories
        else re += '.*';                                       // trailing `**` takes the rest
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
function filesUnder(absDir, relPrefix, out) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const rel = relPrefix ? relPrefix + '/' + e.name : e.name;
    if (e.isDirectory()) filesUnder(path.join(absDir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
}
// A deliberately small wildcard matcher, not a dependency. `*` and `?` stay inside
// one path segment; `**/` crosses them. Enough for `dist/**/*.js`, which is the
// shape every artifact list in practise takes.
function expandGlob(pattern) {
  const parts = pattern.split('/');
  const fixed = [];
  let i = 0;
  while (i < parts.length && !/[*?[]/.test(parts[i])) { fixed.push(parts[i]); i++; }
  if (i === parts.length) return [pattern];                 // no wildcard: a literal
  const base = path.join(ROOT, ...fixed);
  const re = globToRegExp(parts.slice(i).join('/'));
  const prefix = fixed.join('/');
  return filesUnder(base, '', []).filter((rel) => re.test(rel))
    .map((rel) => (prefix ? prefix + '/' + rel : rel)).sort();
}
function resolveArtifacts(entries) {
  const out = [];
  for (const e of entries || []) {
    const found = typeof e === 'string'
      ? expandGlob(e)
      : e && e.glob ? expandGlob(e.glob) : [String(e && e.path)];
    for (const rel of found) if (!out.includes(rel)) out.push(rel);
  }
  return out;
}
function sha256(rel) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); }
  catch (e) { return null; }
}

/* The reproducible-build gate. It asserts something no exit code can: that every
   COMMITTED artifact is byte-identical to what this source produces. Where the
   committed bundle IS the deploy, a source edit committed without a rebuild ships
   code no gate ever rendered, while every other gate stays green.

   Two config shapes, because repos differ in whether their build is already a gate:
     "artifacts": [ ... ]                         hash before the suite, hash after
                                                  it — whichever declared gate
                                                  rebuilds them is graded by this
     "artifacts": { command, files: [ ... ] }      run `command` between the hashes */
function artifactGate(cfg) {
  const spec = Array.isArray(cfg.artifacts) ? { command: null, files: cfg.artifacts } : cfg.artifacts;
  const files = resolveArtifacts(spec.files);
  return {
    name: ARTIFACT_GATE,
    synthetic: true,
    run: () => {
      if (!files.length) {
        // NOT APPLICABLE, said out loud and charged as a skip. The skip is then
        // red unless the CALLER declares it, exactly as every other skip is, so a
        // repo with no artifacts runs `--allow-skip reproducible-build=1` and the
        // decision is visible in the invocation instead of assumed in here.
        return {
          status: 0, stderr: '',
          stdout: 'reproducible build: NOT APPLICABLE — `artifacts` in harness.config.json lists '
            + 'nothing, so 0 artifacts were graded.\nGATE ' + ARTIFACT_GATE + ' pass=0 fail=0 skipped=1\n',
          __empty: true,
        };
      }
      const before = files.map(sha256);
      const r = spec.command ? runCommand(spec.command) : { status: 0, stdout: '', stderr: '' };
      r.__before = before;
      r.__after = files.map(sha256);
      return r;
    },
    parse: (r) => {
      if (r.__empty) {
        return {
          pass: 0, fail: 0, skipped: 1,
          note: 'not applicable — 0 artifacts configured, 0 graded. Declare it: --allow-skip ' + ARTIFACT_GATE + '=1',
        };
      }
      // A configured artifact that is ABSENT on either side is a fail, not a file
      // that quietly drops out of the total. "Configured but not committed" and
      // "committed but not produced" are both real defects and both would
      // otherwise shrink the figure without failing anything.
      const same = [];
      const moved = [];
      files.forEach((rel, i) => {
        const b = r.__before[i];
        const a = r.__after[i];
        if (b && a && b === a) same.push(rel); else moved.push(rel);
      });
      const extra = {
        reproducible: r.status === 0 && moved.length === 0,
        artifacts: files.reduce((m, rel, i) => { m[rel] = r.__after[i]; return m; }, {}),
      };
      if (moved.length) extra.moved = moved;
      return Object.assign({ pass: same.length, fail: moved.length, skipped: 0 }, extra);
    },
  };
}

/* ---------- the gate table ----------
   Built from `config.gates`, IN DECLARATION ORDER, with the artifact check last.
   Order is the config's because a repo's gates are not independent: a build gate
   has to run before the check that grades what it produced. */
function buildGates(cfg) {
  const gates = cfg.gates.map((spec) => {
    let adapter;
    try { adapter = resolveAdapter(spec.adapter); }
    catch (e) { fatal('gate `' + spec.name + '`: ' + e.message, e.fix); }
    return {
      name: spec.name,
      optional: Boolean(spec.optional),
      run: () => runCommand(spec.command),
      parse: (r) => {
        if (spec.optional && toolMissing(r)) {
          // `exit: 0` overrides the shell's. A tool that is not installed exits
          // non-zero BECAUSE it is not installed: that is the same fact as the
          // skip, not a second one, and charging it twice would print "exit 127
          // with no failing check" beside a skip that already says why.
          return {
            pass: 0, fail: 0, skipped: 1, exit: 0,
            note: 'the tool is not installed here — declared optional, so this is a skip, not a fail',
          };
        }
        return adapter(r, spec);
      },
    };
  });
  gates.push(artifactGate(cfg));
  const names = gates.map((g) => g.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) {
    fatal('two gates share a name: ' + dup.join(', '),
      'rename one in harness.config.json — `' + ARTIFACT_GATE + '` is reserved for the artifact check.');
  }
  return gates;
}
let REGISTRY = null;
const registry = () => (REGISTRY || (REGISTRY = buildGates(config())));

/* ---------- the GATE line parser ---------- */
// Exported, and deliberately strict: it reads the LAST GATE line for this gate's
// own name. Strict because a loose parser is how a gate that printed something
// after its verdict, or printed another gate's name, would be read as green.
// Returns null when there is no verdict at all.
function parseGateLine(stdout, name) {
  const re = new RegExp('^GATE\\s+' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '\\s+pass=(\\d+)\\s+fail=(\\d+)\\s+skipped=(\\d+)\\s*$', 'gm');
  let m, last = null;
  while ((m = re.exec(String(stdout || '')))) last = m;
  if (!last) return null;
  return { pass: Number(last[1]), fail: Number(last[2]), skipped: Number(last[3]) };
}

/* ---------- the comparator ---------- */
/* The checks a verdict ACCOUNTS FOR. One formula, called from both sides of the
   only comparison that uses it, because the two drifting apart was a real defect:
   the recorded total was pass + fail while the comparator summed pass + fail +
   skipped, so a gate declaring a skip the baseline had never included carried that
   many checks of free headroom before pass-by-absence could fire. A declared skip
   is a check the verdict accounts for; it is the PASS comparison that stands down
   for a skip, and only that one. */
const tally = (v) => v.pass + v.fail + (v.skipped || 0);

/* `--only` filters by name, and a name that matches nothing filtered EVERYTHING
   out: no gate ran, no subject was compared, and `--check` printed GATES GREEN
   with an empty summary and exited 0, having overwritten the verdict of record on
   its way. A typo in a gate name is the likeliest way anyone meets this. Pure, so
   the self-test drives it with literals. */
const unknownGates = (requested, registered) => requested.filter((n) => !registered.includes(n));

// One gate's verdict against one baseline row. Returns the list of reasons it is
// red; an empty list is green. Pure, so the tests drive it with literals instead
// of booting a whole suite.
function violations(name, cur, base, allowSkip) {
  const out = [];
  if (!cur) { out.push(name + ': did not run (present in the baseline)'); return out; }
  if (cur.missingVerdict) out.push(name + ': emitted no GATE line — the gate died before its verdict');
  if (cur.fail > 0) out.push(name + ': ' + cur.fail + ' failing check(s)');
  if (cur.exit !== 0 && !(cur.fail > 0)) {
    out.push(name + ': exit ' + cur.exit + ' with no failing check — a verdict the figures cannot express');
  }
  const allowed = allowSkip && Object.prototype.hasOwnProperty.call(allowSkip, name) ? allowSkip[name] : 0;
  if (cur.skipped > allowed) {
    out.push(name + ': skipped=' + cur.skipped + (allowed ? ' exceeds the allowed ' + allowed : ' and no --allow-skip ' + name + '=n was given'));
  }
  // Generalized from a hard-coded gate name: ANY gate whose verdict carries a
  // `reproducible` flag is red when that flag is not true. The artifact check is
  // the only one that sets it today, and a repo-specific one can set it tomorrow
  // without editing this function.
  if (Object.prototype.hasOwnProperty.call(cur, 'reproducible') && cur.reproducible !== true) {
    out.push(name + ': NOT reproducible — the committed artifacts are not what this source produces'
      + (cur.moved ? ' (moved: ' + cur.moved.join(', ') + ')' : ''));
  }
  // A gate that skipped has a lower PASS figure for a reason that is not a
  // regression: charging it with "pass 0 < baseline 900" would report an absent
  // dependency as a data regression, the exact false-regression shape this whole
  // file exists to end. So the PASS comparison stands down for a skip, and only
  // for a skip.
  // The TOTAL comparison does not, and once it did — the whole block was guarded
  // on skipped === 0, so any declared skip switched pass-by-absence off for that
  // gate entirely. That is a hole precisely where it matters most: CI declares
  // skips, so on the one box nobody watches, a check could vanish out of a
  // baseline without a word. A DECLARED skip is a check the verdict ACCOUNTS FOR,
  // not a check gone, so it is part of the total. A gate that skips more checks
  // than it declares is red here, which is the figure discipline every gate is
  // asked for anyway: "emits skipped=n with an exact figure".
  if (base) {
    if (cur.skipped === 0 && cur.pass < base.pass) out.push(name + ': pass ' + cur.pass + ' < baseline ' + base.pass);
    const total = tally(cur);
    // The fallback for a baseline recorded before `total` existed goes through the
    // same formula, not the one that caused the drift above.
    const baseTotal = typeof base.total === 'number' ? base.total : tally(base);
    // The pass-by-absence check. A deleted check leaves pass lower AND total
    // lower; a check that merely started failing leaves total intact. Only the
    // second is legible from `fail` alone, which is why the total is compared.
    if (total < baseTotal) {
      out.push(name + ': ' + total + ' checks in the total, baseline had ' + baseTotal + ' — a check DISAPPEARED (pass-by-absence)');
    }
  }
  return out;
}

/* ---------- run ---------- */
function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
}
function gitDirty() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim().length > 0 : null;
}

/* ---------- a red gate's WHOLE output ----------
   The 14-line tail below is what a terminal can take, and it is the END of the
   output: a failing test case or smoke check prints its name hundreds of lines
   above its summary, so a red that did not reproduce left nothing to read. The
   whole stdout and stderr of a red gate is therefore kept, one file per gate,
   beside gates.json, and its path is printed and recorded on the gate's row.
   Ignored by git as gates.json is, so it is never a commit's business. A gate that
   is green on a later run drops its file: a stale one would name a failure that is
   no longer there. Neither call throws; a file that cannot be written must not turn
   a red into a crash. */
const redFile = (name, dir) => path.join(dir || __dirname, 'gates.red.' + name + '.log');
function keepRedOutput(name, r, dir) {
  const file = redFile(name, dir);
  try {
    fs.writeFileSync(file, '# gate ' + name + ' exit=' + (r && typeof r.status === 'number' ? r.status : 'none')
      + (r && r.signal ? ' signal=' + r.signal : '') + (r && r.error ? ' spawn-error=' + String(r.error.code || r.error.name) : '')
      + ' at ' + new Date().toISOString() + '\n# ---- stdout ----\n' + String((r && r.stdout) || '')
      + '\n# ---- stderr ----\n' + String((r && r.stderr) || '') + '\n');
    return file;
  } catch (e) { return null; }
}
function dropRedOutput(name, dir) {
  try { fs.unlinkSync(redFile(name, dir)); } catch (e) { /* none kept */ }
}
// The output of the gates this run found green on their own figures: `--check` can
// still red one against the baseline (a vanished check, an undeclared skip), and
// that red wants its output too.
const HELD = new Map();
function keepHeldOutput(name, row, dir) {
  if (!HELD.has(name) || (row && row.output)) return null;
  const kept = keepRedOutput(name, HELD.get(name), dir);
  if (kept && row) row.output = path.relative(ROOT, kept);
  return kept;
}

/* Why `--accept` refuses: every rule that needs no baseline, over every gate that
   ran. A gate that is red ONLY here (an undeclared skip: exit 0, no fail) was green
   to runAll, which dropped any earlier gates.red.<name>.log and held the output; a
   refusal that then exited without keeping it made "a red gate keeps its whole
   output" false for this one red. `dir` is for the tests, as in runAll. */
function acceptBlockers(gates, allowSkip, dir) {
  const blocking = [];
  for (const n of Object.keys(gates)) {
    const found = violations(n, gates[n], null, allowSkip);
    if (found.length) keepHeldOutput(n, gates[n], dir);
    blocking.push(...found);
  }
  return blocking;
}

// `opts` exists for the tests: { gates, dir, log, write } swap the gate table,
// where a red gate's output is kept, and where the progress lines go. A real run
// passes none of them.
function runAll(names, opts) {
  const o = opts || {};
  const say = o.log || console.log;
  const write = o.write || ((s) => process.stdout.write(s));
  const gates = {};
  for (const g of o.gates || registry()) {
    if (names.length && !names.includes(g.name)) continue;
    write('> ' + g.name + ' ... ');
    const t0 = Date.now();
    const r = g.run();
    const ms = Date.now() - t0;
    const exit = typeof r.status === 'number' ? r.status : 1;
    let v = g.parse ? g.parse(r) : parseGateLine(r.stdout, g.name);
    let missingVerdict = false;
    if (!v) { v = { pass: 0, fail: 0, skipped: 0 }; missingVerdict = true; }
    // This total is what `--accept` records as the baseline, so it goes through the
    // same tally() the comparator uses. Two formulas for one number is how the
    // drift described above happened.
    // A parse function may OVERRIDE the exit status, and exactly one does: an
    // absent optional tool, whose non-zero exit is the skip restated. Everything
    // else takes the shell's, because a gate that could edit its own exit status
    // is a gate that can declare itself fine.
    const row = Object.assign({}, v, { total: tally(v), exit: typeof v.exit === 'number' ? v.exit : exit, ms: ms });
    if (missingVerdict) row.missingVerdict = true;
    gates[g.name] = row;
    say(
      (missingVerdict ? 'NO VERDICT' : 'pass=' + row.pass + ' fail=' + row.fail + ' skipped=' + row.skipped)
      + ' exit=' + row.exit + '  (' + Math.round(ms / 100) / 10 + 's)'
      + (row.reproducible === false ? '  ! NOT REPRODUCIBLE' : ''));
    // A gate that graded nothing on purpose says so on its own line. Without this
    // the only trace of a not-applicable check is a figure of 0, which reads
    // identically to a check that ran and found nothing to do.
    if (row.note) say('    note: ' + row.note);
    // A gate that produced nothing usable is worth its output; a green one is not.
    if (missingVerdict || row.exit !== 0 || row.fail > 0) {
      const tail = String(r.stdout || '').split('\n').slice(-14).join('\n');
      if (tail.trim()) say(tail.replace(/^/gm, '    | '));
      const errTail = String(r.stderr || '').split('\n').slice(-8).join('\n');
      if (errTail.trim()) say(errTail.replace(/^/gm, '    ! '));
      // The tail is the END of the output; the failing check's name is usually above it.
      const kept = keepRedOutput(g.name, r, o.dir);
      if (kept) row.output = path.relative(ROOT, kept);
      say(kept ? '    whole output: ' + path.relative(ROOT, kept) : '    whole output: could NOT be written beside gates.json');
    } else {
      dropRedOutput(g.name, o.dir);
      HELD.set(g.name, r);
    }
  }
  return gates;
}

/* ---------- --self-test ----------
   The parser, the comparator and the adapters are what everything else trusts, and
   they are what a green gate suite can never exercise (a suite that passes proves
   the happy path only). This drives all of them with literals, and it runs in a
   tree with no config at all. */
function selfTest() {
  const fails = [];
  const eq = (what, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  };

  /* the parser */
  eq('parses a verdict', parseGateLine('noise\nGATE smoke pass=264 fail=0 skipped=0\n', 'smoke'), { pass: 264, fail: 0, skipped: 0 });
  eq('takes the LAST verdict', parseGateLine('GATE smoke pass=1 fail=0 skipped=0\nGATE smoke pass=2 fail=0 skipped=0', 'smoke'), { pass: 2, fail: 0, skipped: 0 });
  eq('will not read another gate\'s verdict', parseGateLine('GATE docs pass=64 fail=0 skipped=0', 'smoke'), null);
  eq('rejects a malformed verdict', parseGateLine('GATE smoke pass=264 fail=0', 'smoke'), null);
  eq('no verdict at all', parseGateLine('everything is fine!', 'smoke'), null);
  eq('a hyphenated gate name is not a regex', parseGateLine('GATE reproducible-build pass=3 fail=0 skipped=0', 'reproducible-build'), { pass: 3, fail: 0, skipped: 0 });

  /* the comparator */
  const green = { pass: 264, fail: 0, skipped: 0, total: 264, exit: 0 };
  const base = { pass: 264, fail: 0, skipped: 0, total: 264 };
  eq('green is green', violations('smoke', green, base, {}), []);
  eq('a failing check reds', violations('smoke', { pass: 263, fail: 1, skipped: 0, total: 264, exit: 1 }, base, {}).length > 0, true);
  eq('a DELETED check reds (pass-by-absence)', violations('smoke', { pass: 263, fail: 0, skipped: 0, total: 263, exit: 0 }, base, {}).length > 0, true);
  eq('an unexplained non-zero exit reds', violations('smoke', { pass: 264, fail: 0, skipped: 0, total: 264, exit: 1 }, base, {}).length > 0, true);
  eq('an undeclared skip reds', violations('lint', { pass: 0, fail: 0, skipped: 1, total: 0, exit: 0 }, null, {}).length > 0, true);
  eq('a declared skip is green', violations('lint', { pass: 0, fail: 0, skipped: 1, total: 0, exit: 0 }, null, { lint: 1 }), []);
  // A DECLARED skip is a check the verdict ACCOUNTS FOR, not a check gone, so it is
  // part of the total. Both verdicts are pinned: a gate whose baseline held 900
  // checks and whose verdict now covers one is 899 short whether or not the caller
  // tolerated the skip, and the same gate against its own empty baseline is green.
  eq('a declared skip does not excuse the 899 checks it did not declare',
    violations('lint', { pass: 0, fail: 0, skipped: 1, total: 0, exit: 0 }, { pass: 900, fail: 0, total: 900 }, { lint: 1 }).length > 0, true);
  eq('a whole-gate skip against its own empty baseline is green',
    violations('lint', { pass: 0, fail: 0, skipped: 1, total: 0, exit: 0 }, { pass: 0, fail: 0, total: 0 }, { lint: 1 }), []);
  // THE CI SHAPE, asserted here because CI is the one environment a dev box cannot
  // reproduce: a gate without a live credential reports 375/375 with two live
  // checks declared skipped, against a 377 baseline recorded WITH them.
  eq('a partially-skipped gate is green against a fuller baseline',
    violations('api-check', { pass: 375, fail: 0, skipped: 2, total: 375, exit: 0 }, { pass: 377, fail: 0, total: 377 }, { 'api-check': 2 }), []);
  eq('...but a THIRD skip is not absorbed',
    violations('api-check', { pass: 374, fail: 0, skipped: 3, total: 374, exit: 0 }, { pass: 377, fail: 0, total: 377 }, { 'api-check': 2 }).length > 0, true);
  // THE HOLE THIS CLOSES, in the exact shape CI takes it: two skips tolerated,
  // three hundred and seventy-four checks run, and one gone. Green under the old guard.
  eq('a check that VANISHES behind a tolerated skip still reds',
    violations('api-check', { pass: 374, fail: 0, skipped: 2, total: 374, exit: 0 }, { pass: 377, fail: 0, total: 377 }, { 'api-check': 2 }).length > 0, true);
  eq('a non-reproducible verdict reds on its own',
    violations(ARTIFACT_GATE, { pass: 4, fail: 2, skipped: 0, total: 6, exit: 0, reproducible: false }, null, {}).length > 0, true);
  eq('...and a gate with no `reproducible` flag is not charged for one',
    violations('docs', { pass: 4, fail: 0, skipped: 0, total: 4, exit: 0 }, null, {}), []);
  eq('a missing GATE line reds',
    violations('smoke', { pass: 0, fail: 0, skipped: 0, total: 0, exit: 0, missingVerdict: true }, null, {}).length > 0, true);
  eq('a baseline gate that did not run reds', violations('smoke', null, base, {}).length > 0, true);
  eq('tally: a declared skip is part of the total', tally({ pass: 0, fail: 0, skipped: 1 }), 1);
  eq('tally: a baseline row predating `skipped`', tally({ pass: 900, fail: 0 }), 900);
  eq('a gate recorded and re-run unchanged is green against itself',
    violations('lint', { pass: 0, fail: 0, skipped: 1, exit: 0 },
      { pass: 0, fail: 0, skipped: 1, total: tally({ pass: 0, fail: 0, skipped: 1 }) }, { lint: 1 }), []);
  eq('...and losing the skipped check reds against that same baseline',
    violations('lint', { pass: 0, fail: 0, skipped: 0, exit: 0 },
      { pass: 0, fail: 0, skipped: 1, total: tally({ pass: 0, fail: 0, skipped: 1 }) }, { lint: 1 }).length > 0, true);

  /* --only */
  eq('--only: a registered name is known', unknownGates(['test'], ['test', 'docs']), []);
  eq('--only: a typo is named back', unknownGates(['tset'], ['test', 'docs']), ['tset']);
  eq('--only: one good name does not excuse a bad one', unknownGates(['test', 'nope'], ['test', 'docs']), ['nope']);
  eq('--only: no --only at all is not an error', unknownGates([], ['test', 'docs']), []);

  /* the adapters */
  eq('the default adapter is the GATE line parser', resolveAdapter(undefined), ADAPTERS['gate-line']);
  const unknown = (() => { try { resolveAdapter('node_test'); return null; } catch (e) { return e; } })();
  eq('an unknown adapter is a hard error, never a silent fallback', Boolean(unknown), true);
  eq('...and it names the adapters that exist', Boolean(unknown && /gate-line/.test(unknown.fix)), true);
  // Both reporter shapes node:test has shipped. The numbers are a format; the
  // decoration around them is a look, and a look is not worth a gate.
  eq('node-test reads the tap summary',
    ADAPTERS['node-test']({ stdout: '# tests 3\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 1\n' }), { pass: 2, fail: 0, skipped: 1 });
  eq('node-test reads the spec summary',
    ADAPTERS['node-test']({ stdout: 'ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ skipped 1\n' }), { pass: 2, fail: 0, skipped: 1 });
  eq('node-test charges a cancelled test as a failure',
    ADAPTERS['node-test']({ stdout: '# pass 2\n# fail 0\n# cancelled 1\n# skipped 0\n' }), { pass: 2, fail: 1, skipped: 0 });
  eq('node-test with no summary is no verdict', ADAPTERS['node-test']({ stdout: 'MODULE_NOT_FOUND' }), null);
  eq('exit-code: zero is one passing check', ADAPTERS['exit-code']({ status: 0 }), { pass: 1, fail: 0, skipped: 0 });
  eq('exit-code: non-zero is one failing check', ADAPTERS['exit-code']({ status: 2 }), { pass: 0, fail: 1, skipped: 0 });

  /* `optional` */
  eq('an absent tool is recognised on a POSIX shell', toolMissing({ status: 127, stderr: 'sh: lint: command not found' }), true);
  eq('an absent tool is recognised on cmd.exe', toolMissing({ status: 9009, stderr: "'lint' is not recognized as an internal or external command" }), true);
  eq('a tool that ran and was unhappy is NOT absent', toolMissing({ status: 1, stderr: '3 problems' }), false);

  /* the wildcard matcher */
  eq('a glob stays inside one segment', globToRegExp('dist/*.js').test('dist/a/b.js'), false);
  eq('...and matches within it', globToRegExp('dist/*.js').test('dist/a.js'), true);
  eq('`**/` crosses directories', globToRegExp('dist/**/*.css').test('dist/a/b/c.css'), true);
  eq('...including zero of them', globToRegExp('dist/**/*.css').test('dist/c.css'), true);
  eq('a dot is a dot, not any character', globToRegExp('a.js').test('axjs'), false);

  /* the scrubbed environment */
  process.env.NODE_TEST_CONTEXT = 'child-v8';
  eq('an ambient NODE_TEST_CONTEXT is gone from the child env', 'NODE_TEST_CONTEXT' in gateEnv(), false);
  delete process.env.NODE_TEST_CONTEXT;
  eq('...and nothing else is taken away', gateEnv().PATH, process.env.PATH);

  /* node re-pointing */
  eq('a bare `node` is re-pointed at this runtime', nodeCommand('node --test x').startsWith('"' + process.execPath + '"'), true);
  eq('...and only at the start of the command', nodeCommand('npm run node-thing'), 'npm run node-thing');

  /* the state files live beside the script, not at the repo root */
  eq('gates.json lives beside this script', path.dirname(GATES_JSON), __dirname);
  eq('the baseline lives beside this script', path.dirname(BASELINE_JSON), __dirname);

  /* a red gate's WHOLE output is kept, not its tail */
  const redDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gates-self-test-'));
  try {
    const long = ['not ok 1 - the failing check'].concat(Array.from({ length: 60 }, (_, i) => 'ok ' + (i + 2))).join('\n');
    const kept = keepRedOutput('x', { status: 1, stdout: long, stderr: 'on stderr' }, redDir);
    eq('a red gate\'s output is kept beside the verdict, under its own name', kept, redFile('x', redDir));
    const text = kept ? fs.readFileSync(kept, 'utf8') : '';
    eq('...the WHOLE of it, the first line included', text.includes('not ok 1 - the failing check') && text.includes('ok 61'), true);
    eq('...and stderr with it', text.includes('on stderr'), true);
    dropRedOutput('x', redDir);
    eq('a gate that is green again drops its kept output', fs.existsSync(redFile('x', redDir)), false);
    eq('an unwritable place answers null, never a throw', keepRedOutput('x', { status: 1 }, path.join(redDir, 'no', 'such', 'dir')), null);
  } finally {
    fs.rmSync(redDir, { recursive: true, force: true });
  }

  /* the empty artifact list declares itself. Driven through the real gate, because
     the thing under test is that the RUN says so: a parse function that returns a
     note proves nothing about whether anything prints it. */
  const emptyArt = artifactGate({ artifacts: [] });
  const emptyRow = emptyArt.parse(emptyArt.run());
  eq('an empty artifact list is a declared skip, not a pass', { pass: emptyRow.pass, fail: emptyRow.fail, skipped: emptyRow.skipped }, { pass: 0, fail: 0, skipped: 1 });
  eq('...and says it graded nothing', /not applicable/.test(String(emptyRow.note)), true);
  eq('...and the gate name is reserved, not borrowed', emptyArt.name, ARTIFACT_GATE);
  const printed = [];
  runAll([], { gates: [emptyArt], dir: redDir, log: (s) => printed.push(String(s)), write: () => {} });
  eq('...and the run prints the declaration', printed.some((l) => /note: not applicable/.test(l)), true);
  eq('...and carries no `reproducible` flag to be charged for',
    Object.prototype.hasOwnProperty.call(emptyRow, 'reproducible'), false);

  /* the registry, if this tree has a config. A self-test must pass without one. */
  const cfg = load({ soft: true });
  if (cfg) {
    const names = registry().map((g) => g.name);
    eq('no two gates share a name', names.length, new Set(names).size);
    eq('every configured gate is registered, in declaration order',
      names.slice(0, cfg.gates.length), cfg.gates.map((g) => g.name));
    eq('the artifact check is registered last', names[names.length - 1], ARTIFACT_GATE);
    eq('every registered gate is nameable in --only', unknownGates(names, names), []);
    eq('the gate table comes from the config and nowhere else', names.length, cfg.gates.length + 1);
  }

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? '\nFAIL — gates.js self-test: ' + fails.length + ' assertion(s)'
    : 'PASS — gates.js self-test' + (cfg ? ' (' + registry().length + ' gates: ' + registry().map((g) => g.name).join(' ') + ')' : ' (no config in this tree; the file was tested, not the suite)'));
  process.exit(fails.length ? 1 : 0);
}

/* ---------- main ---------- */
function main() {
  if (SELF_TEST) return selfTest();

  const GATES = registry();
  const names = ONLY;
  // BEFORE anything runs and before anything is written: a --only name that matches
  // no gate is a hard failure, not an empty run. The verdict of record is left
  // exactly as it was.
  const unknown = unknownGates(names, GATES.map((g) => g.name));
  if (unknown.length) {
    console.log('FAIL — --only names no such gate: ' + unknown.join(', '));
    console.log('   registered: ' + GATES.map((g) => g.name).join(', '));
    console.log('   nothing ran, and ' + path.relative(ROOT, GATES_JSON) + ' is untouched.');
    process.exit(1);
  }
  const gates = runAll(names);
  const doc = {
    generatedAt: new Date().toISOString(),
    commit: gitHead(),
    dirty: gitDirty(),
    node: process.version,
    gates: gates,
  };
  fs.writeFileSync(GATES_JSON, JSON.stringify(doc, null, 2) + '\n');
  console.log('\nwrote ' + path.relative(ROOT, GATES_JSON));

  if (ACCEPT) {
    // A RED SUITE CANNOT BECOME THE BASELINE. Everything except the
    // baseline-relative rules is re-checked here with no baseline at all, so a
    // failing check, an unexplained exit, an undeclared skip or a non-reproducible
    // build blocks the re-baseline. Without this, `--accept` is a one-command way
    // to make any regression permanent — which is the failure a baseline exists to
    // prevent.
    const blocking = acceptBlockers(gates, ALLOW_SKIP);
    if (blocking.length) {
      console.log('\nREFUSING TO RE-BASELINE — the suite is not green:');
      for (const r of blocking) console.log('  x ' + r);
      const kept = Object.keys(gates).filter((n) => gates[n].output);
      if (kept.length) {
        console.log('The whole output of each red gate that ran:');
        for (const n of kept) console.log('  ' + n + ': ' + gates[n].output);
        // A row's `output` set by acceptBlockers came after gates.json was written.
        try { fs.writeFileSync(GATES_JSON, JSON.stringify(doc, null, 2) + '\n'); } catch (e) { /* the refusal stands */ }
      }
      process.exit(1);
    }
    const accepted = Object.assign({
      _readme: ['The verdict of record. Written ONLY by `node scripts/harness/gates.js --accept`,',
        'which refuses unless the suite is green. A re-baseline is a deliberate act, so its',
        'commit subject must start `gates:` — enforced at commit time, not here.'],
    }, doc);
    fs.writeFileSync(BASELINE_JSON, JSON.stringify(accepted, null, 2) + '\n');
    console.log('wrote ' + path.relative(ROOT, BASELINE_JSON) + ' — this is a deliberate RE-BASELINE.');
    console.log('! its commit subject must start `gates:` so the change is legible in `git log --oneline`.');
    process.exit(0);
  }

  if (!CHECK) process.exit(0);

  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8')); }
  catch (e) {
    console.log('\nFAIL — no readable ' + path.relative(ROOT, BASELINE_JSON) + ' to check against.');
    console.log('   Record one with: node scripts/harness/gates.js --accept   (commit subject must start `gates:`)');
    process.exit(1);
  }

  const reasons = [];
  const baseGates = baseline.gates || {};
  // Every gate in the BASELINE must have run — you cannot go green by not running
  // one — plus every gate this run did produce, so a new gate is checked from day one.
  const subjects = Array.from(new Set(Object.keys(baseGates).concat(Object.keys(gates))))
    .filter((n) => !names.length || names.includes(n));
  // A comparison with no subjects is not a green one. Unreachable while --only is
  // validated above, and kept because that is the door the defect came through:
  // green by comparing nothing.
  if (!subjects.length) reasons.push('--check compared no gates at all — a run that checked nothing is not green');
  for (const n of subjects) {
    // A gate that is REGISTERED but never baselined runs, prints green, and is
    // exempt from both baseline-relative rules — `pass < baseline` and
    // pass-by-absence — until someone runs `--accept`, with no warning anywhere:
    // violations() skips its whole baseline block when `base` is falsy, so silence
    // is indistinguishable from protection. Adding a gate is exactly when that hole
    // opens, so it is said out loud rather than discovered later.
    if (gates[n] && !baseGates[n]) {
      console.log('! ' + n + ': ran with no baseline row — NOT protected by pass-by-absence or the pass floor until `--accept`');
    }
    const found = violations(n, gates[n], baseGates[n], ALLOW_SKIP);
    // Red against the baseline only (a vanished check, an undeclared skip): its
    // output is kept now.
    if (found.length) keepHeldOutput(n, gates[n]);
    reasons.push(...found);
  }

  console.log('\n' + '-'.repeat(56));
  if (reasons.length) {
    console.log('GATES RED — ' + reasons.length + ' violation(s) against ' + path.relative(ROOT, BASELINE_JSON) + ':');
    for (const r of reasons) console.log('  x ' + r);
    const kept = subjects.filter((n) => gates[n] && gates[n].output);
    if (kept.length) {
      console.log('The whole output of each red gate that ran:');
      for (const n of kept) console.log('  ' + n + ': ' + gates[n].output);
      // The row's `output` was set after gates.json was written for a baseline-only red.
      try { fs.writeFileSync(GATES_JSON, JSON.stringify(doc, null, 2) + '\n'); } catch (e) { /* the verdict stands */ }
    }
    process.exit(1);
  }
  const summary = subjects.map((n) => n + ' ' + gates[n].pass + '/' + gates[n].total
    + (gates[n].skipped ? ' (' + gates[n].skipped + ' skipped, declared)' : '')).join(' . ');
  console.log('GATES GREEN — ' + summary);
  process.exit(0);
}

module.exports = {
  parseGateLine, violations, tally, unknownGates, runAll, acceptBlockers,
  keepRedOutput, redFile, resolveAdapter, ADAPTERS, buildGates, artifactGate,
  resolveArtifacts, globToRegExp, toolMissing, nodeCommand, ARTIFACT_GATE,
};

if (require.main === module) main();
