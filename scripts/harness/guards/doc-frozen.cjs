'use strict';
/**
 * doc-frozen.cjs — the predicates that decide WHAT A DOC IS, decided once.
 *
 * WHY THIS FILE EXISTS AT ALL
 * Two mechanisms ask the same question about the same file, and they used to answer it
 * differently. The doc linter exempts frozen evidence from the gate-figure rule, because a
 * research or exploration doc is a DATED MEASUREMENT: its figures are the finding, and it may not
 * be edited to keep them current, so a rule that fails it for carrying one is a rule with no legal
 * move. The PreToolUse write guard had no such exemption and denied the write outright. Between
 * them there was no way to record a measurement at all.
 *
 * The cheap escape from that disagreement was a `<!-- figure-ok: why -->` tag, which BOTH
 * mechanisms honour and which therefore grants itself — the author of the write decides whether
 * the write is allowed. A tag reached for to settle a conflict neither mechanism owns spreads, and
 * then the rule it was an exception to is whatever people remember it being.
 *
 * So the predicates live here and nowhere else. Not because duplication is untidy: because these
 * two DID drift, and a second copy is a second rule that agrees only until someone edits one of
 * them.
 *
 * A LIBRARY — no side effects at require time, nothing printed on import. It is loaded by a
 * PreToolUse hook, and a hook that prints on import breaks the tool call it was asked to decide.
 * The one thing it does when RUN is `--self-test`, guarded by `require.main` so that an import can
 * never reach it: every helper carries a self-test, and a shared predicate with none is a shared
 * predicate that passes by absence — `node doc-frozen.cjs --self-test` would exit 0 having checked
 * nothing.
 * For the same reason the config is read SOFTLY and lazily: a hook that throws because
 * harness.config.json is unreadable takes the whole session down with it.
 */
const path = require('node:path');

let CFG; // undefined = not yet asked. null = asked, unreadable.
function cfg() {
  if (CFG === undefined) {
    try {
      CFG = require(path.join(__dirname, '..', 'config.js'))
        .load({ soft: true });
    } catch {
      CFG = null; // a predicate that throws on import is worse than one that is strict
    }
  }
  return CFG;
}

/** Repo-relative, forward slashes, no trailing slash — the one spelling every rule below compares
 *  against. A config written on Windows and a path produced by a walk on Linux have to meet. */
const norm = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '');
const under = (relPath, dir) => {
  const f = norm(relPath); const d = norm(dir);
  return Boolean(d) && (f === d || f.startsWith(d + '/'));
};

/**
 * Frontmatter as a flat object, or null. Values are strings; a `[a, b]` value becomes an array.
 * It lives here rather than in the linter because the write guard needs a doc's `kind:` to ask its
 * question at all, and a second parser would disagree about a doc's KIND long before it disagreed
 * about anything visible. Scalars and inline lists only: the schema has no nested structures, so a
 * real YAML parser would be a runtime dependency bought for nothing.
 */
function parseFrontmatter(text) {
  const s = String(text || '');
  if (!s.startsWith('---')) return null;
  const end = s.indexOf('\n---', 3);
  if (end < 0) return null;
  const fm = {};
  for (const line of s.slice(s.indexOf('\n') + 1, end + 1).split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else v = v.replace(/^["']|["']$/g, '');
    fm[m[1]] = v;
  }
  return fm;
}

/**
 * The frontmatter a PAYLOAD declares, wherever it sits in the text. A tool payload carries the
 * document itself and so starts with the block; a shell payload carries it inside a heredoc and
 * starts with `cat > …`. Reading only a leading block would see the second as having none, and the
 * guard would then deny a figure into a NEW research file that the linter goes on to exempt — the
 * same disagreement, moved rather than fixed.
 *
 * This errs PERMISSIVE, deliberately and only here: a doc that is not really frozen evidence still
 * fails the doc gate for the same figure, so the cost of being wrong is a red gate one step later,
 * while the cost of being strict is a rule with no legal move. The guard must never deny what the
 * lint would accept.
 */
function declaredFrontmatter(text) {
  const s = String(text || '');
  if (s.startsWith('---')) return parseFrontmatter(s);
  const at = s.indexOf('\n---\n');
  return at < 0 ? null : parseFrontmatter(s.slice(at + 1));
}

/** The configured frozen-evidence directories, or [] when the config cannot be read. Empty means
 *  nothing is exempt, which is the strict answer; the linter, which can afford to, hard-stops on an
 *  unreadable config instead of running with this. */
const exemptDirs = (opts) => {
  if (opts && Array.isArray(opts.dirs)) return opts.dirs;
  const c = cfg();
  return (c && c.docs && Array.isArray(c.docs.exemptDirs)) ? c.docs.exemptDirs : [];
};
const tracksDir = (opts) => {
  if (opts && typeof opts.tracksDir === 'string') return opts.tracksDir;
  const c = cfg();
  return (c && c.project && c.project.tracksDir) || '';
};

/** Closed work: read as history, so it is exempt from the line caps as well as from the figures.
 *  `docs.exemptDirs` is the only source of this list — the directory names are a project's choice,
 *  and the previous version of this harness hard-coded its own two. */
const capExempt = (relPath, opts) => exemptDirs(opts).some((d) => under(relPath, d));

/**
 * Exempt from the STRUCTURAL rules — ▶-block placement, dead relative links, trap citations —
 * because the doc is read as history and nothing in it routes anybody anywhere.
 *
 * This is NOT the same list as `capExempt`, and the difference is the one hazard that making the
 * list configurable introduced. A repo may legitimately exempt its tracks directory from the line
 * caps: a live track README grows, and a cap that forces a split mid-phase is a cap that gets
 * waived. But the ▶-block rule exists FOR tracks and nowhere else, so an exemption bought for the
 * caps must not quietly switch it off. The tracks directory is live work by definition, so it is
 * removed from the history list however the config lists it.
 */
const historyExempt = (relPath, opts) => {
  const tracks = tracksDir(opts);
  return exemptDirs(opts).some((d) => under(relPath, d) && !(tracks && under(relPath, tracks)));
};

/** The kinds that ARE a dated measurement. A doc declares its own, and the linter's `kind` enum
 *  decides whether the declaration is even legal, so this list is the only thing to keep in step. */
const FROZEN_KINDS = ['research', 'exploration'];

/**
 * Whose BODY may not change once it is committed. This asks what the file IS and never where it
 * sits, which is the whole fix: the rule used to key on the evidence FOLDER's prefix, and that
 * folder's own README lives there too. A README is `kind: index`. An index OF evidence is not
 * evidence, so adding a row to it read as editing a frozen finding, and adding a new exploration
 * was an illegal move — a rule with no legal move, the same shape as the disagreement at the top
 * of this file.
 *
 * Keying on kind also reaches the research docs that were archived, which the path rule never
 * covered. That is a tightening rather than a loosening, and it is the right one: an archived
 * measurement is more obviously a dated finding than a live one, and the path rule missed those
 * only because the archive ceremony moved them out from under its prefix.
 */
const frozenBody = (fm) => Boolean(fm && FROZEN_KINDS.includes(fm.kind));

/** Exempt from the figure rule and the caps: either the doc is closed work, or it is itself a
 *  dated measurement whose figures are the finding. */
const frozenEvidence = (relPath, fm, opts) => capExempt(relPath, opts) || frozenBody(fm);

/** A code span or fenced block is QUOTING, not asserting. Both mechanisms already read a gate
 *  FIGURE this way, and each had spelled this helper itself. */
const stripCode = (text) => String(text).replace(/```[\s\S]*?```/g, '\n').replace(/`[^`\n]*`/g, '`');

/**
 * The escape hatch, decided once. The tag exempts a doc from the gate-figure rule, and the linter
 * and the write guard each carried their own copy of this pattern: the same two-copies shape as
 * the frozen-evidence predicate above, in the one place both mechanisms had already agreed they
 * must not disagree.
 *
 * The reason is required and must be substantial, which is what `\S[^>]{7,}` buys: a bare tag is a
 * reflex and a reason is a decision. It is also, measured against this repo's own fixtures, why a
 * doc that DOCUMENTS the tag does not exempt itself — a documented example reading `why` is too
 * short to match. That was worth driving rather than assuming.
 *
 * Code is stripped first, so a tag shown as an example inside a span or a fence is quoting rather
 * than claiming.
 */
const FIGURE_OK = /<!--\s*figure-ok:\s*\S[^>]{7,}-->/;
const hasFigureOk = (text) => FIGURE_OK.test(stripCode(text));

module.exports = {
  parseFrontmatter, declaredFrontmatter,
  capExempt, historyExempt, frozenEvidence, frozenBody, FROZEN_KINDS,
  stripCode, FIGURE_OK, hasFigureOk,
  norm, under,
};

/* ---------- --self-test ----------
   Literals only, and an explicit `opts` on every path predicate, so nothing here reads the config:
   the decisions under test are the predicates, not this repo's settings. Includes the cases that
   must come out NO — a predicate only ever seen saying YES cannot be told from one that cannot
   say NO. Reached only when this file is the entry point. */
function selfTest() {
  let CHECKS = 0; const f = [];
  const eq = (l, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(l + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  };
  const o = { dirs: ['docs/archive', 'docs/explorations', 'docs/tracks'], tracksDir: 'docs/tracks' };
  eq('frontmatter: none', parseFrontmatter('# t\n'), null);
  eq('frontmatter: unterminated', parseFrontmatter('---\nid: a\n'), null);
  eq('frontmatter: scalars', parseFrontmatter('---\nid: a\nkind: research\n---\nbody\n'), { id: 'a', kind: 'research' });
  eq('frontmatter: an inline list is an array', parseFrontmatter('---\npaths: [a, "b"]\n---\n').paths, ['a', 'b']);
  eq('frontmatter: a body key is not a field', parseFrontmatter('---\nid: a\n---\nkind: research\n').kind, undefined);
  eq('declared: a leading block', declaredFrontmatter('---\nkind: research\n---\nx\n').kind, 'research');
  eq('declared: a block inside a heredoc payload', declaredFrontmatter("cat > f.md <<'EOF'\n---\nkind: exploration\n---\nx\nEOF\n").kind, 'exploration');
  eq('declared: a payload with no block', declaredFrontmatter('echo hello\n'), null);
  eq('under: a file in the dir', under('docs/archive/x.md', 'docs/archive'), true);
  eq('under: a Windows spelling meets a POSIX one', under('docs\\archive\\x.md', 'docs/archive/'), true);
  eq('NOT under: a lookalike prefix', under('docs/archived/x.md', 'docs/archive'), false);
  eq('NOT under: an empty dir matches nothing', under('docs/x.md', ''), false);
  eq('cap exempt: a listed dir', capExempt('docs/archive/x.md', o), true);
  eq('NOT cap exempt: an unlisted dir', capExempt('docs/reference/x.md', o), false);
  eq('NOT cap exempt: nothing is, with an empty list', capExempt('docs/archive/x.md', { dirs: [] }), false);
  eq('history exempt: closed work', historyExempt('docs/archive/x.md', o), true);
  eq('NOT history exempt: the tracks dir, however the config lists it', historyExempt('docs/tracks/t/handoff.md', o), false);
  eq('frozen body: research', frozenBody({ kind: 'research' }), true);
  eq('frozen body: exploration', frozenBody({ kind: 'exploration' }), true);
  eq('NOT a frozen body: the index of the evidence', frozenBody({ kind: 'index' }), false);
  eq('NOT a frozen body: no frontmatter', frozenBody(null), false);
  eq('frozen evidence: by kind, outside every exempt dir', frozenEvidence('notes/a.md', { kind: 'research' }, { dirs: [] }), true);
  eq('frozen evidence: by directory, whatever its kind', frozenEvidence('docs/archive/a.md', { kind: 'track' }, o), true);
  eq('NOT frozen evidence: a live reference doc', frozenEvidence('docs/reference/a.md', { kind: 'reference' }, o), false);
  eq('strip: a code span is emptied', stripCode('a `12/34` b').includes('12/34'), false);
  eq('strip: a fence is emptied', stripCode('a\n```\n12/34\n```\nb').includes('12/34'), false);
  eq('strip: prose is left alone', stripCode('a 12/34 b'), 'a 12/34 b');
  eq('figure-ok: a reasoned tag', hasFigureOk('<!-- figure-ok: dated phase record, not current -->'), true);
  eq('NOT figure-ok: a bare tag', hasFigureOk('<!-- figure-ok -->'), false);
  eq('NOT figure-ok: a reason too short to be one', hasFigureOk('<!-- figure-ok: why -->'), false);
  eq('NOT figure-ok: a tag quoted in a code span', hasFigureOk('`<!-- figure-ok: dated phase record, not current -->`'), false);
  if (f.length) { console.error('SELF-TEST FAIL\n  ' + f.join('\n  ')); process.exit(1); }
  console.log('PASS — doc-frozen.cjs self-test (' + CHECKS + ' checks)');
}
if (require.main === module) {
  if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }
  console.error('doc-frozen.cjs is a library: require it, or run it with --self-test');
  process.exit(2);
}
