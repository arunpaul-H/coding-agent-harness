#!/usr/bin/env node
/**
 * Statusline — model · branch · directory · context %.
 *
 * ONE LINE OUT, WHATEVER GOES IN. The runtime renders whatever this prints into a
 * fixed-height strip, so two lines corrupt the frame and a throw blanks it. Every
 * field is therefore optional, every lookup is defensive, and the line is assembled
 * from whichever parts resolved. No input shape can make this print nothing, print
 * twice, or exit non-zero.
 *
 * The context percentage is the field worth the wiring. Everything else here is
 * convenience; that one number is the budget the always-on context files are graded
 * against, and a session that cannot see it spends it blind.
 *
 * A FILE, NEVER AN INLINE `node -e`. See the comment on `permissions.deny` in
 * settings.json: a one-liner handed to a shell gets word-split, and `=>` becomes a
 * redirect that writes a 0-byte file named after a fragment of its own source.
 *
 * Run:  node .claude/helpers/statusline.cjs --self-test
 */
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** The whole decision, pure: status payload in, exactly one line out (no newline). */
function line(d, branchOf) {
  const o = d && typeof d === 'object' ? d : {};
  const cwd = (o.workspace && o.workspace.current_dir) || o.cwd || process.cwd();
  // display_name first, id second, a literal last: a status line that says nothing
  // about the model is worse than one that says the generic word.
  const model = (o.model && (o.model.display_name || o.model.id)) || 'agent';
  const branch = (branchOf ? branchOf(cwd) : '') || '';
  const used = o.context_window && o.context_window.used_percentage;
  const pct = typeof used === 'number' && isFinite(used) ? ' · ctx ' + Math.round(used) + '%' : '';
  const dir = path.basename(String(cwd)) || String(cwd);
  return oneLine([model, branch, dir].map(oneLine).filter(Boolean).join(' · ') + pct) || 'agent';
}

/**
 * THE FIELDS ARE SOMEBODY ELSE'S STRINGS. "One line out" was true of every payload
 * SHAPE and false of a payload VALUE: a model name or a directory carrying a line
 * break went straight through and printed two lines into a one-line strip. Found by
 * driving the process with such a payload, not by reading the code. So every control
 * character and both Unicode line separators collapse to a single space, by code point
 * (a literal separator in this source would break the source's own lines).
 */
function oneLine(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    out += (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) ? ' ' : ch;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Short-timeout, stderr-discarded, never-throws. Not a repo is a normal state. */
function gitBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 }).trim();
  } catch { return ''; }
}

function selfTest() {
  const fails = [];
  const no = () => '';
  const must = (what, got, want) => { if (got !== want) fails.push(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); };
  const one = (what, d) => { const s = line(d, no); must(what + ' is exactly one line', s.includes('\n'), false); return s; };

  must('a full payload renders every field',
    line({ model: { display_name: 'M' }, cwd: '/w/repo', context_window: { used_percentage: 41.6 } }, () => 'main'),
    'M · main · repo · ctx 42%');
  must('no model still names something', one('no model', { cwd: '/w/repo' }).startsWith('agent · '), true);
  must('the model id is the fallback for a missing display name',
    line({ model: { id: 'm-1' }, cwd: '/w/repo' }, no), 'm-1 · repo');
  must('a missing branch collapses rather than leaving an empty field',
    line({ model: { display_name: 'M' }, cwd: '/w/repo' }, no), 'M · repo');
  must('a non-numeric context percentage is omitted, not printed as NaN',
    line({ model: { display_name: 'M' }, cwd: '/w/r', context_window: { used_percentage: 'lots' } }, no).includes('ctx'), false);
  one('an empty payload', {});
  one('a null payload', null);
  one('a string payload', 'nonsense');
  one('an array payload', []);
  must('garbage input still names a model', line('nonsense', no).startsWith('agent'), true);
  // ⚠ A VALUE can carry the line break a shape cannot. See oneLine().
  must('a line break inside the model name is collapsed',
    line({ model: { display_name: 'M\r\nX' }, cwd: '/w/repo' }, no), 'M X · repo');
  must('a line break inside the branch is collapsed',
    line({ model: { display_name: 'M' }, cwd: '/w/repo' }, () => 'ma\nin'), 'M · ma in · repo');
  must('a Unicode line separator is collapsed too',
    line({ model: { display_name: 'M' + String.fromCharCode(0x2028) + 'X' }, cwd: '/w/repo' }, no), 'M X · repo');
  must('a field that is ONLY control characters collapses rather than leaving an empty slot',
    line({ model: { display_name: 'M' }, cwd: '/w/repo' }, () => '\n\t'), 'M · repo');

  for (const f of fails) console.log('  x ' + f);
  console.log(fails.length ? 'FAIL - statusline self-test: ' + fails.length + ' assertion(s)' : 'PASS - statusline self-test');
  process.exit(fails.length ? 1 : 0);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  let raw = '';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    let d = {};
    try { d = JSON.parse(raw || '{}'); } catch { /* an unreadable payload still gets a line */ }
    try { process.stdout.write(line(d, gitBranch) + '\n'); } catch { process.stdout.write('agent\n'); }
    process.exit(0);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  // Never hold the strip blank waiting on stdin that is not coming.
  setTimeout(finish, 1500).unref();
}

try { main(); } catch { process.stdout.write('agent\n'); process.exit(0); }
