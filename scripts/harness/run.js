#!/usr/bin/env node
'use strict';

/*
 * run.js — the launcher: the run mode is chosen HERE, before the agent exists.
 *
 *   node scripts/harness/run.js [<mode>] [--tool <id>] [--dry-run]
 *   node scripts/harness/run.js --modes | --self-test
 *
 * WHY A PARENT PROCESS. No coding agent surveyed lets a repo-local hook ask a blocking question
 * before the first turn, so a mode chosen in the chat is prose on every one of them. This script
 * asks on the terminal, maps the answer onto the tool's own flags, and only then starts the tool:
 * the model never sees the question and cannot skip it.
 *
 * WHAT IT READS. The flags come from the `modes` cell of the tool's row in the registry, and the
 * program to start from that row's `bin`. This script names no tool and no flag of its own.
 *
 * WHAT IT REFUSES, and never papers over by starting the tool bare:
 *   - a mode that is not one of the four
 *   - a tool with no row, or one the config has not enabled
 *   - a row with no `modes` cell, or no `bin`: nothing is established, so there is nothing to pass
 *   - a mode whose cell is null: its flag is somebody's decision still to take
 *   - no mode on the command line and no terminal to ask on: an answer that arrives down a pipe
 *     was chosen by whoever wrote the pipe
 *
 * WHAT IT DOES NOT DO. It grants nothing. The flags are what the registry RECORDS for a mode; the
 * tool grants the permission, and whether it then behaves that way is what the row's evidence
 * says, not this script. It writes no receipt and wires no hook.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { load } = require(path.join(__dirname, 'config.js'));
const TOOLS = require(path.join(__dirname, 'tools.js'));
const { MODES, MODE_IDS } = require(path.join(__dirname, 'mode.js'));

const USAGE = 'usage: node scripts/harness/run.js [<' + MODE_IDS.join('|') + '>] [--tool <id>] [--dry-run] | --modes | --self-test';
const REG = TOOLS.REGISTRY_REL;
/* An argument reaches the tool through a shell on one platform (a `.cmd` shim cannot be started
   without one), so nothing a shell would read as syntax is ever passed. */
const SAFE_ARG = /^[A-Za-z0-9._=:/@+,-]+$/;
const ASKS = 3;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const refuse = (why, fix) => ({ ok: false, why: why, fix: fix });

/* ---------- pure decisions (every one is exercised by --self-test) ---------- */

/** argv -> { mode, tool, dry } or { error }. Strict: an unknown flag, a second positional or a
 *  doubled --tool is a usage error, never one of them silently dropped. */
function parseArgs(argv) {
  const out = { mode: null, tool: null, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      if (out.dry) return { error: '--dry-run given twice' };
      out.dry = true;
    } else if (a === '--tool') {
      if (out.tool !== null) return { error: '--tool given twice' };
      const v = argv[i + 1];
      if (typeof v !== 'string' || !v || v.startsWith('-')) return { error: '--tool needs a registry id' };
      out.tool = v; i += 1;
    } else if (a.startsWith('-')) {
      return { error: 'unknown flag `' + a + '`' };
    } else if (out.mode !== null) {
      return { error: 'two modes given (`' + out.mode + '` and `' + a + '`)' };
    } else {
      out.mode = a;
    }
  }
  return out;
}

/** The row to launch: the one asked for, or the only enabled one. */
function pickTool(reg, enabled, asked) {
  const rows = isPlain(reg) && Array.isArray(reg.tools) ? reg.tools.filter(isPlain) : [];
  const on = Array.isArray(enabled) ? enabled : [];
  if (asked === null || asked === undefined) {
    if (on.length !== 1) {
      return refuse(on.length ? 'the config enables ' + on.length + ' tools (' + on.join(', ') + '), so the launcher will not pick one' : 'the config enables no tool',
        'name one: --tool <id>');
    }
    asked = on[0];
  }
  const row = rows.find((r) => r.id === asked);
  if (!row) return refuse('no row `' + asked + '` in ' + REG + ' (rows: ' + (rows.map((r) => r.id).join(', ') || 'none') + ')', 'node scripts/harness/tools.js --list');
  if (!on.includes(asked)) {
    return refuse('`' + asked + '` is not in tools.enabled of the config (enabled: ' + (on.join(', ') || 'none') + '), so nothing of the harness is installed for it',
      'node bin/harness.js init --tools ' + on.concat(asked).join(','));
  }
  return { ok: true, row: row };
}

/** What would be started: { ok, bin, args }, or the refusal. Never a bare launch. */
function plan(mode, row) {
  if (!MODE_IDS.includes(mode)) return refuse('`' + mode + '` is not a run mode (one of ' + MODE_IDS.join(', ') + ')', USAGE);
  const where = 'row `' + row.id + '` of ' + REG;
  if (!isPlain(row.modes)) {
    return refuse(where + ' records no `modes` cell: nothing is established about its flags, and starting it bare would be a mode nobody chose',
      'run the tool, read its flags off its own help output, and record them in the row — never from memory');
  }
  const args = row.modes[mode];
  if (args === null || args === undefined) {
    return refuse('mode `' + mode + '` is null in the `modes` cell of ' + where + ': no flag is established for it',
      'that flag is the owner\'s decision; once taken, record it in the row. Until then pick another mode');
  }
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && SAFE_ARG.test(a))) {
    return refuse('the `modes.' + mode + '` cell of ' + where + ' holds an argument this launcher will not pass (' + JSON.stringify(args) + ')',
      'node scripts/harness/tools.js --check');
  }
  if (typeof row.bin !== 'string' || !SAFE_ARG.test(row.bin) || /[\\/]/.test(row.bin)) {
    return refuse(where + ' records no `bin`: the launcher does not know which program is this tool',
      'record the program\'s name in the row, as it is typed on a command line');
  }
  return { ok: true, bin: row.bin, args: args.slice() };
}

/** The file a bare program name resolves to on PATH, or null. */
function resolveBin(bin, env, platform, isFile) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const x of exts) {
      for (const name of x ? [bin + x.toLowerCase(), bin + x] : [bin]) {
        const file = join(dir, name);
        if (isFile(file)) return file;
      }
    }
  }
  return null;
}

/** How to start it. A batch shim needs the platform's shell; a real program never gets one. */
function spawnSpec(file, args, platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) return { file: '"' + file + '"', args: args, shell: true };
  return { file: file, args: args, shell: false };
}

/** The menu, one line per mode, in mode.js order. A mode this tool cannot be started in says so. */
function menuLines(row) {
  const cell = isPlain(row.modes) ? row.modes : {};
  return MODE_IDS.map((id, i) => '  ' + (i + 1) + '  ' + id.padEnd(11) + 'pauses: ' + MODES[id].pauses.padEnd(15) + 'may touch: ' + MODES[id].touch +
    (Array.isArray(cell[id]) ? '' : '   (no flag established for this tool)'));
}

/** One typed answer -> a mode id, or null. A number from the menu or the id itself. */
function answerMode(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^[0-9]+$/.test(t)) return MODE_IDS[Number(t) - 1] || null;
  return MODE_IDS.includes(t) ? t : null;
}

/* ---------- the terminal ---------- */

async function ask(row) {
  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('harness run: which mode for `' + row.id + '`?');
    for (const l of menuLines(row)) console.log(l);
    for (let i = 0; i < ASKS; i += 1) {
      const got = answerMode(await rl.question('mode [1-' + MODE_IDS.length + ']: '));
      if (got) return got;
      console.log('   not a mode: type a number from the list or the mode\'s name.');
    }
    return null;
  } finally {
    rl.close();
  }
}

function stop(why, fix, code) {
  console.error('RUN REFUSED — ' + why);
  if (fix) console.error('   fix: ' + fix);
  return code || 1;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (a.error) { console.error(a.error + '\n' + USAGE); return 2; }

  let cfg; let reg;
  try { cfg = load(); reg = TOOLS.readRegistry(); } catch (e) { return stop(e.message, e.fix); }
  const v = TOOLS.validate(reg, cfg.tools.enabled);
  if (v.findings.length) return stop(REG + ' has ' + v.findings.length + ' finding(s): flags are not read from a registry its own gate refuses', 'node scripts/harness/tools.js --check');

  const picked = pickTool(reg, cfg.tools.enabled, a.tool);
  if (!picked.ok) return stop(picked.why, picked.fix);
  const row = picked.row;

  let mode = a.mode;
  if (mode === null) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return stop('no mode given and no terminal to ask on: a mode that arrives down a pipe was chosen by whoever wrote the pipe',
        'run it from a terminal, or name the mode: ' + MODE_IDS.join(' | '));
    }
    mode = await ask(row);
    if (!mode) return stop('no mode chosen after ' + ASKS + ' answers', USAGE);
  }

  const p = plan(mode, row);
  if (!p.ok) return stop(p.why, p.fix);

  const file = resolveBin(p.bin, process.env, process.platform, (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  console.log('harness run: `' + row.id + '` in mode ' + mode + ' -> ' + [p.bin].concat(p.args).join(' '));
  console.log('   the flags are what ' + REG + ' records for this mode (evidence: ' + row.evidence + '); the tool grants the permission, not the harness.');
  if (a.dry) {
    console.log('   --dry-run: nothing started. ' + (file ? 'Would start ' + file : '`' + p.bin + '` is NOT on PATH, so a real run would be refused'));
    return 0;
  }
  if (!file) return stop('`' + p.bin + '` is not on PATH, so there is no tool to start', 'install the tool, or open a shell where `' + p.bin + '` runs');

  const s = spawnSpec(file, p.args, process.platform);
  const r = spawnSync(s.file, s.args, { stdio: 'inherit', shell: s.shell, cwd: cfg.root });
  if (r.error) return stop('could not start ' + file + ' (' + (r.error.code || r.error.message) + ')', 'run `' + p.bin + '` by hand to see why');
  return r.status === null ? 1 : r.status;
}

/* ---------- self-test ----------
   Literals only: no registry read for the decisions, no terminal, and nothing is ever started. */

function selfTest() {
  const fails = [];
  let n = 0;
  const eq = (what, got, want) => { n += 1; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); };
  const why = (r) => (r.ok ? 'ok' : r.why);

  const cell = { 'fully-auto': null, 'auto-edit': ['--mode', 'edits'], hitl: ['--mode', 'edits'], manual: [] };
  const row = (over) => Object.assign({ id: 'tool-a', bin: 'tool-a', evidence: 'docs', modes: Object.assign({}, cell) }, over || {});
  const reg = (rows) => ({ tools: rows });

  // the command line
  eq('args: a mode, a tool and a dry run', parseArgs(['hitl', '--tool', 'tool-a', '--dry-run']), { mode: 'hitl', tool: 'tool-a', dry: true });
  eq('args: nothing at all asks later', parseArgs([]), { mode: null, tool: null, dry: false });
  eq('args: the flag may come first', parseArgs(['--tool', 'tool-a', 'manual']).mode, 'manual');
  eq('args: an unknown flag is a usage error', parseArgs(['hitl', '--yolo']).error, 'unknown flag `--yolo`');
  eq('args: two modes is a usage error', parseArgs(['hitl', 'manual']).error, 'two modes given (`hitl` and `manual`)');
  eq('args: --tool with no id', parseArgs(['hitl', '--tool']).error, '--tool needs a registry id');
  eq('args: --tool eating a flag', parseArgs(['--tool', '--dry-run']).error, '--tool needs a registry id');
  eq('args: --tool twice', parseArgs(['--tool', 'a', '--tool', 'b']).error, '--tool given twice');
  eq('args: --dry-run twice', parseArgs(['--dry-run', '--dry-run']).error, '--dry-run given twice');

  // which tool
  eq('tool: the one asked for, when enabled', pickTool(reg([row()]), ['tool-a'], 'tool-a').row.id, 'tool-a');
  eq('tool: none asked and one enabled is that one', pickTool(reg([row(), row({ id: 'tool-b' })]), ['tool-b'], null).row.id, 'tool-b');
  eq('tool: none asked and two enabled is refused', /enables 2 tools \(tool-a, tool-b\)/.test(why(pickTool(reg([row(), row({ id: 'tool-b' })]), ['tool-a', 'tool-b'], null))), true);
  eq('tool: none asked and none enabled is refused', why(pickTool(reg([row()]), [], null)), 'the config enables no tool');
  eq('tool: an id with no row is refused, with the rows', /no row `tool-z`.*rows: tool-a/.test(why(pickTool(reg([row()]), ['tool-a'], 'tool-z'))), true);
  eq('tool: a row the config has not enabled is refused', /`tool-b` is not in tools\.enabled/.test(why(pickTool(reg([row(), row({ id: 'tool-b' })]), ['tool-a'], 'tool-b'))), true);
  eq('tool: ...and the fix keeps what is enabled', pickTool(reg([row(), row({ id: 'tool-b' })]), ['tool-a'], 'tool-b').fix, 'node bin/harness.js init --tools tool-a,tool-b');
  eq('tool: a registry that is not one has no rows', /no row `tool-a`.*rows: none/.test(why(pickTool(null, ['tool-a'], 'tool-a'))), true);

  // what would be started
  eq('plan: a mode with flags', plan('auto-edit', row()), { ok: true, bin: 'tool-a', args: ['--mode', 'edits'] });
  eq('plan: an empty list is a launch with no extra flag', plan('manual', row()), { ok: true, bin: 'tool-a', args: [] });
  eq('plan: the args are a copy, not the row\'s own list', (() => { const r = row(); plan('auto-edit', r).args.push('x'); return r.modes['auto-edit']; })(), ['--mode', 'edits']);
  eq('plan: A NULL MODE IS REFUSED, and named', /mode `fully-auto` is null in the `modes` cell of row `tool-a`/.test(why(plan('fully-auto', row()))), true);
  eq('plan: A ROW WITH NO CELL IS REFUSED, never started bare', /records no `modes` cell/.test(why(plan('manual', row({ modes: undefined })))), true);
  eq('plan: a cell that is not an object is no cell', /records no `modes` cell/.test(why(plan('manual', row({ modes: ['--x'] })))), true);
  eq('plan: a mode the cell leaves out is refused like a null', /mode `hitl` is null/.test(why(plan('hitl', row({ modes: { manual: [] } })))), true);
  eq('plan: a mode that is not one', /`yolo` is not a run mode/.test(why(plan('yolo', row()))), true);
  eq('plan: a row with no bin', /records no `bin`/.test(why(plan('manual', row({ bin: undefined })))), true);
  for (const b of ['', 'a b', '../tool', 'dir/tool', 'c:\\tool', 'tool;rm', 7, null]) {
    eq('plan: bin ' + JSON.stringify(b) + ' is refused', /records no `bin`/.test(why(plan('manual', row({ bin: b })))), true);
  }
  for (const bad of [['--a b'], ['--a', '&&', 'x'], ['$(x)'], ['a|b'], ['"q"'], [''], [7], '--mode']) {
    eq('plan: args ' + JSON.stringify(bad) + ' are never passed', /will not pass/.test(why(plan('manual', row({ modes: Object.assign({}, cell, { manual: bad }) })))), true);
  }
  eq('plan: every refusal carries a fix', [plan('yolo', row()), plan('fully-auto', row()), plan('manual', row({ modes: undefined })), plan('manual', row({ bin: undefined }))].every((r) => !r.ok && r.fix.length > 0), true);

  // finding the program
  const files = (list) => (f) => list.includes(f);
  eq('bin: found in the second directory', resolveBin('tool-a', { PATH: '/a:/b' }, 'linux', files(['/b/tool-a'])), '/b/tool-a');
  eq('bin: the first directory wins', resolveBin('tool-a', { PATH: '/a:/b' }, 'linux', files(['/a/tool-a', '/b/tool-a'])), '/a/tool-a');
  eq('bin: not on PATH is null', resolveBin('tool-a', { PATH: '/a:/b' }, 'linux', files([])), null);
  eq('bin: no PATH at all is null', resolveBin('tool-a', {}, 'linux', files(['/a/tool-a'])), null);
  eq('bin: the other platform tries its extensions, in order', resolveBin('tool-a', { Path: 'C:\\a;C:\\b', PATHEXT: '.EXE;.CMD' }, 'win32', files(['C:\\b\\tool-a.cmd', 'C:\\b\\tool-a.exe'])), 'C:\\b\\tool-a.exe');
  eq('bin: ...and a bare name with no extension is not a program there', resolveBin('tool-a', { Path: 'C:\\a', PATHEXT: '.EXE' }, 'win32', files(['C:\\a\\tool-a'])), null);
  eq('start: a real program gets no shell', spawnSpec('/a/tool-a', ['--x'], 'linux'), { file: '/a/tool-a', args: ['--x'], shell: false });
  eq('start: an .exe gets no shell', spawnSpec('C:\\a\\tool-a.exe', [], 'win32').shell, false);
  eq('start: a batch shim gets one, with its path quoted', spawnSpec('C:\\a b\\tool-a.CMD', ['--x'], 'win32'), { file: '"C:\\a b\\tool-a.CMD"', args: ['--x'], shell: true });
  eq('start: the same name elsewhere is just a file', spawnSpec('/a/tool-a.cmd', [], 'linux').shell, false);

  // the question
  eq('menu: one line per mode, in order', menuLines(row()).map((l) => l.trim().split(/\s+/)[1]), MODE_IDS);
  eq('menu: a null mode is marked', menuLines(row()).filter((l) => /no flag established/.test(l)).length, 1);
  eq('menu: a row with no cell marks all of them', menuLines(row({ modes: undefined })).filter((l) => /no flag established/.test(l)).length, MODE_IDS.length);
  eq('answer: a number from the menu', answerMode(' 2 '), MODE_IDS[1]);
  eq('answer: the id itself, any case', answerMode('HITL'), 'hitl');
  for (const t of ['', '0', '9', 'yes', '1.5', '-1', null]) eq('answer: ' + JSON.stringify(t) + ' is no mode', answerMode(t), null);

  // the two lists this script joins, and the registry it ships beside
  eq('modes: the registry validates the modes mode.js decides', TOOLS.HARNESS_MODES, MODE_IDS);
  let shipped = null;
  try { shipped = TOOLS.readRegistry(); } catch (e) { fails.push('the shipped registry does not read: ' + e.message); }
  if (shipped) {
    const rows = shipped.tools.filter((r) => isPlain(r.modes));
    eq('shipped: every row with a `modes` cell names its program', rows.filter((r) => typeof r.bin !== 'string').map((r) => r.id), []);
    eq('shipped: every recorded mode plans, every null one is refused',
      rows.flatMap((r) => MODE_IDS.filter((m) => plan(m, r).ok !== Array.isArray(r.modes[m])).map((m) => r.id + '.' + m)), []);
  }

  if (fails.length) {
    console.error(fails.map((f) => '  x ' + f).join('\n'));
    console.log('FAIL — run.js self-test (' + fails.length + ' of ' + n + ')');
    return 1;
  }
  console.log('PASS — run.js self-test (' + n + ' checks, nothing started)');
  return 0;
}

module.exports = { parseArgs, pickTool, plan, resolveBin, spawnSpec, menuLines, answerMode, USAGE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  // A mode of this script like the others: beside anything else it is a usage error, so
  // `hitl --self-test` can never read as a launch that was tested.
  if (argv.includes('--self-test') || argv.includes('--modes')) {
    if (argv.length !== 1) { console.error(USAGE); process.exit(2); }
    if (argv[0] === '--self-test') process.exit(selfTest());
    for (const id of MODE_IDS) console.log(id.padEnd(12) + 'pauses=' + MODES[id].pauses.padEnd(16) + 'touch=' + MODES[id].touch);
    process.exit(0);
  }
  main(argv).then((code) => process.exit(code), (e) => { console.error('RUN REFUSED — ' + (e && e.message ? e.message : e)); process.exit(1); });
}
