'use strict';
/* AGENT HARNESS — read every live doc's frontmatter and generate <docsRoot>/INDEX.md.
   Replaces: the hand-written read-map in the policy file, the status board, and each doc's own
   "read which section" routing block. One row per entry point, each with the ONE LINE that says
   when to open it, and nothing else — `read_when` is the field the whole index is built from, so
   a doc with a vague `read_when` is a doc nobody opens at the right moment.

   The file is GENERATED AND NOT EDITED. That is not tidiness: a routing table maintained by hand
   drifts away from the docs it routes to, and the first symptom is an agent reading a file that
   no longer holds what the index promised. The generator is the only writer, `--check` is the
   exit code that proves nobody edited it, and the banner at the top of the output says so.

   --check      regenerate in memory and exit 1 if the committed INDEX differs, or if the agent
                registry block in the routing doc differs from what the agent files render to.
                This is the verdict form: it pairs with the doc gate, it also validates the agent
                files below, and it WRITES NOTHING, even with --agents beside it.
   --agents     rewrite the agent-registry block in the routing doc
                (<docsRoot>/reference/routing/README.md) between its begin/end markers from
                .claude/agents/*.md. Everything outside the markers is left byte-identical.
   --self-test  drive the pure parts with literals, including the cases that must come out NO.
   Zero-dep, Node built-ins only.
   Usage: node scripts/harness/docs-index.js [--check] [--agents] [--self-test] */
const fs = require('node:fs');
const path = require('node:path');

const { load, ROOT, resolve, fatal, routingDoc } = require(path.join(__dirname, 'config.js'));
/* ONE frontmatter parser for everything that asks what a doc IS — this index, the doc linter and
   the write guard — imported from the helper all three load. Two copies would disagree about a
   doc's `id` or its `kind` long before they disagreed about anything visible, and the index is
   keyed by `id`. (close-phase.js keeps a narrower reader of its own, flat scalars only, for the
   receipt fields it writes; it asks nothing about a doc's kind, and the linter recomputes every
   receipt from what THIS parser reads, so a disagreement between the two is a red doc gate.) */
// By __dirname, not ROOT: ROOT is the tree being INDEXED, and the helper lives beside the harness.
const { parseFrontmatter } = require(path.join(__dirname, 'guards', 'doc-frozen.cjs'));

const args = process.argv.slice(2);
let CFG;
try { CFG = load(); } catch (e) { fatal(e.message, e.fix); }

const DOCS = CFG.project.docsRoot;
const TRACKS = CFG.project.tracksDir;
const INDEX = resolve(DOCS, 'INDEX.md');
/* The registry block lives in the lead-only routing doc, NOT in the policy file: the policy file
   is injected into every agent, and a table only the spawning agent reads would be paid for by
   every leaf. config.js spells the path once; the context measurement reads the same one. */
const ROUTING_REL = routingDoc(CFG);
const ROUTING = resolve(...ROUTING_REL.split('/'));
const A_BEGIN = '<!-- agents:begin -->';
const A_END = '<!-- agents:end -->';
/* An agent brief is frontmatter-always-on: its description is startup cost on every session that
   can spawn it. 40 lines is the ceiling, and a brief that wants more is a doc — it belongs in the
   spawn contract's READ-SET, where it is paid for only when that agent actually runs. */
const AGENT_CAP = 40;

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

/* Closed work lives in `<docsRoot>/archive` by convention and is DELIBERATELY ABSENT from the
   index: a row here is an invitation to read, and nothing in the archive is live. The doc linter
   uses the same convention for the same reason. */
const ARCHIVE = norm(DOCS) + '/archive';
/* A workspace's announce note (`<docsRoot>/workspaces/<task>.md`, written by worktree.js) is
   absent too, for a different reason: it is read by `worktree.js --list` straight out of git and
   is removed when the workspace lands. A row here would make this GENERATED file one that every
   plain task rewrites, which is a merge conflict per task for no reader. The linter still grades
   the note; only the routing skips it. The folder name is worktree.js's NOTES_DIR. */
const NOTES = norm(DOCS) + '/workspaces';
/* The index routes to an ENTRY POINT, not to every file in a folder. Split residue — `NN-slug.md`
   and its prefixed forms `plan-NN-`, `qa-NN-` — is listed by its own folder README instead. One
   row per entry point is the whole point of replacing the read-map; forty rows for one doc that
   was split is the read-map again, with worse names. */
const RESIDUE = /(^|\/)(?:[a-z-]+-)?\d\d-[^/]*\.md$/;

/* Section titles. The tracks directory comes first because open work is what a session is usually
   looking for; the rest of the prose tree follows in directory order. A directory with no title
   here is titled after itself rather than left out — an unlisted directory would be a silently
   unrouted part of the docs tree, which is the failure this file exists to end. */
const TITLES = {
  reference: 'Reference: permanent contracts',
  explorations: 'Explorations: frozen point-in-time audits (findings, never instructions)',
  design: 'Design authority',
  guides: 'Guides: how to do a thing here',
};
const titleFor = (dir) => {
  const base = norm(dir).split('/').pop();
  return TITLES[base] || (base.charAt(0).toUpperCase() + base.slice(1).replace(/-/g, ' '));
};

/** The sections of the index, derived from the config rather than listed in this file: the
 *  previous version named its own repo's four folders here, so a new docs folder was invisible to
 *  routing until someone edited the generator. */
function sections(docsRoot, tracksDir, readdir) {
  const docs = norm(docsRoot), tracks = norm(tracksDir);
  const out = [{ dir: tracks, title: 'Tracks: open work' }];
  for (const d of readdir(docs)) {
    const p = docs + '/' + d;
    if (p === tracks || p === ARCHIVE || p === NOTES) continue;
    out.push({ dir: p, title: titleFor(p) });
  }
  // A tracks dir nested inside the docs root is already first; one configured elsewhere is too.
  return out.filter((s, i) => out.findIndex((x) => x.dir === s.dir) === i);
}
const dirsIn = (d) => {
  const abs = resolve(d);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
};

function walk(dir, out = []) {
  const abs = resolve(dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = norm(path.join(dir, e.name));
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function collect(scope) {
  const docs = [];
  /* One row per doc, under the FIRST section that reaches it. A tracks dir nested two levels down
     (`docs/work/tracks`) is walked once as the tracks section and again inside `docs/work`; without
     this a track would be routed twice, and a duplicated row reads as two documents. */
  const seen = new Set();
  for (const s of scope) {
    for (const f of walk(s.dir)) {
      if (f.startsWith(ARCHIVE + '/') || f.startsWith(NOTES + '/') || RESIDUE.test(f) || seen.has(f)) continue;
      seen.add(f);
      if (!fs.existsSync(resolve(f))) continue;
      const fm = parseFrontmatter(fs.readFileSync(resolve(f), 'utf8')) || {};
      docs.push({ file: f, section: s.title, fm });
    }
  }
  docs.sort((a, b) => a.file.localeCompare(b.file));
  return docs;
}

/** INDEX.md lives IN the docs root, so a path under it is relative and anything else climbs out. */
const docLink = (f, docsRoot) => {
  const d = norm(docsRoot) + '/';
  return norm(f).startsWith(d) ? norm(f).slice(d.length) : '../' + norm(f);
};
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
const cell = (s) => (esc(s) || '-');

function render(docs, scope) {
  const L = [];
  L.push('<!-- GENERATED by scripts/harness/docs-index.js. DO NOT EDIT. Run the script. -->');
  L.push('');
  L.push(`# ${DOCS}/INDEX.md: every live doc, and the one line that says when to read it`);
  L.push('');
  L.push('> This file replaces every hand-written read-map and status board in this repo.');
  L.push('> Find the ONE row whose **read when** matches your task, open that file, read nothing else.');
  L.push('> Gate figures are not here and are not in any doc: `node scripts/harness/gates.js --check`.');
  L.push(`> Closed work is in \`${ARCHIVE}/\` and is deliberately absent: nothing there is an instruction.`);
  L.push('');
  for (const s of scope) {
    const rows = docs.filter((d) => d.section === s.title);
    if (!rows.length) continue;
    L.push(`## ${s.title}`);
    L.push('');
    L.push('| id | read when | status |');
    L.push('|---|---|---|');
    for (const d of rows) {
      L.push(`| [${cell(d.fm.id || path.basename(d.file, '.md'))}](${docLink(d.file, DOCS)}) | ${cell(d.fm.read_when)} | ${cell(d.fm.status)} |`);
    }
    L.push('');
  }
  /* verify / last_verified are empty on most rows, so they get their own short table rather than
     two mostly-blank columns on every one. Same fields, a fraction of the bytes — and this file is
     read by an agent that pays for every line of it. */
  const checked = docs.filter((d) => d.fm.verify || d.fm.last_verified);
  if (checked.length) {
    L.push('## Docs that carry their own check');
    L.push('');
    L.push('| id | verify | last verified |');
    L.push('|---|---|---|');
    for (const d of checked) L.push(`| [${cell(d.fm.id)}](${docLink(d.file, DOCS)}) | ${d.fm.verify ? '`' + esc(d.fm.verify) + '`' : '-'} | ${cell(d.fm.last_verified)} |`);
    L.push('');
  }
  /* The blocked section is printed even when it is EMPTY, with "Nothing is blocked." in it. An
     absent section reads as "nobody checked"; a present empty one reads as "checked, and nothing
     is waiting on a human", which is the fact a session starting work needs. */
  const blocked = docs.filter((d) => d.fm.blocked_on);
  L.push('## Blocked: waiting on someone outside the code');
  L.push('');
  if (!blocked.length) L.push('Nothing is blocked.');
  else {
    L.push('| id | blocked on | read when |');
    L.push('|---|---|---|');
    for (const d of blocked) L.push(`| [${cell(d.fm.id)}](${docLink(d.file, DOCS)}) | ${cell(d.fm.blocked_on)} | ${cell(d.fm.read_when)} |`);
  }
  L.push('');
  const fires = docs.filter((d) => d.fm.fires_when);
  if (fires.length) {
    L.push('## Conditional: read only when the trigger fires');
    L.push('');
    L.push('| id | fires when |');
    L.push('|---|---|');
    for (const d of fires) L.push(`| [${cell(d.fm.id)}](${docLink(d.file, DOCS)}) | ${cell(d.fm.fires_when)} |`);
    L.push('');
  }
  L.push(`<!-- ${docs.length} live docs -->`);
  return L.join('\n') + '\n';
}

/* ---------- --agents: the registry block inside the routing doc, generated from the agent files ---- */
function agentRows() {
  const dir = resolve('.claude', 'agents');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  const rows = [], bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = parseFrontmatter(text) || {};
    const name = fm.name || path.basename(f, '.md');
    if (!fm.model) bad.push(`.claude/agents/${f}: missing \`model:\``);
    if (!fm.tools) bad.push(`.claude/agents/${f}: missing \`tools:\` — an agent with an unstated tool set is one whose BOUNDS nobody can read`);
    if (!fm.description) bad.push(`.claude/agents/${f}: missing \`description:\` — the registry row and the spawn decision both read it`);
    const lines = text.replace(/\r\n/g, '\n').split('\n').length;
    if (lines > AGENT_CAP) bad.push(`.claude/agents/${f}: ${lines} lines > cap ${AGENT_CAP} — an agent brief that long is a doc, and it belongs in the READ-SET`);
    rows.push({ name, model: fm.model, tools: fm.tools, description: fm.description });
  }
  return { rows, bad };
}
function renderAgents(rows) {
  const L = [A_BEGIN, '<!-- GENERATED by `node scripts/harness/docs-index.js --agents`. DO NOT EDIT. -->'];
  if (!rows.length) L.push('', '_No repo agents yet._', '');
  else {
    L.push('', '| subagent_type | model | tools | use for |', '|---|---|---|---|');
    for (const r of rows) L.push(`| \`${esc(r.name)}\` | ${cell(r.model)} | ${cell(Array.isArray(r.tools) ? r.tools.join(', ') : r.tools)} | ${cell(r.description)} |`);
    L.push('');
  }
  L.push(A_END);
  return L.join('\n');
}

const readOrNull = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
/** Does the block in `text` differ from what the agent rows render to? null when it matches, or
 *  when there is no block to compare (no text, or no marker pair). Line endings are not drift: a
 *  CRLF checkout holds the same block. */
function registryDrift(text, rows) {
  if (text == null) return null;
  const t = String(text).replace(/\r\n/g, '\n');
  const i = t.indexOf(A_BEGIN), j = t.indexOf(A_END);
  if (i < 0 || j < 0 || j < i) return null;
  const have = t.slice(i, j + A_END.length).split('\n');
  const want = renderAgents(rows).split('\n');
  for (let k = 0; k < Math.max(have.length, want.length); k++) {
    if (have[k] !== want[k]) return { line: k + 1, committed: have[k] === undefined ? '<eof>' : have[k], generated: want[k] === undefined ? '<eof>' : want[k] };
  }
  return null;
}

/* ---------- --self-test: the pure parts, driven by literals ---------- */
function selfTest() {
  let CHECKS = 0;
  const fails = [];
  const eq = (label, got, want) => {
    CHECKS++;
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };
  eq('no frontmatter', parseFrontmatter('# hello\n'), null);
  eq('unterminated frontmatter', parseFrontmatter('---\nid: x\n'), null);
  eq('scalars', parseFrontmatter('---\nid: a-b\nstatus: open\n---\n# t\n'), { id: 'a-b', status: 'open' });
  eq('inline list', parseFrontmatter('---\npaths: ["scripts/**", "x.js"]\n---\n').paths, ['scripts/**', 'x.js']);
  eq('quoted scalar keeps colons', parseFrontmatter('---\nread_when: "a: b, c"\n---\n').read_when, 'a: b, c');
  eq('body key is not frontmatter', parseFrontmatter('---\nid: a\n---\nnope: b\n').nope, undefined);
  eq('pipe is escaped for the table', esc('a|b'), 'a\\|b');
  eq('a newline in a cell does not break the row', esc('a\nb'), 'a b');
  eq('empty cell is a hyphen', cell(''), '-');
  eq('agents block is stable when empty', renderAgents([]).includes('_No repo agents yet._'), true);
  eq('agents block keeps its markers', renderAgents([]).startsWith(A_BEGIN) && renderAgents([]).endsWith(A_END), true);
  const ROWS = [{ name: 'explore', model: 'small', tools: 'Read, Grep', description: 'find things' }];
  const DOC = (block) => '# Routing\n\n' + block + '\n\nafter\n';
  eq('registry: the rendered block is not drift', registryDrift(DOC(renderAgents(ROWS)), ROWS), null);
  eq('registry: nor is the same block with CRLF line endings', registryDrift(DOC(renderAgents(ROWS)).replace(/\n/g, '\r\n'), ROWS), null);
  eq('registry: an agent added since the block was written IS', registryDrift(DOC(renderAgents(ROWS)), ROWS.concat([{ name: 'zeta', model: 'm', tools: 't', description: 'd' }])).line, 7);
  eq('registry: an agent removed is too', registryDrift(DOC(renderAgents(ROWS)), []) !== null, true);
  eq('registry: a hand-edited cell is named with both sides', registryDrift(DOC(renderAgents(ROWS).replace('small', 'large')), ROWS),
    { line: 6, committed: '| `explore` | large | Read, Grep | find things |', generated: '| `explore` | small | Read, Grep | find things |' });
  eq('registry: an empty block against agents on disk is drift', registryDrift(DOC(renderAgents([])), ROWS) !== null, true);
  eq('registry: no routing doc is no block to drift', registryDrift(null, ROWS), null);
  eq('registry: a doc with no marker pair is no block either', registryDrift('# Routing\n', ROWS), null);
  eq('residue: a split section file', RESIDUE.test('docs/tracks/example/01-what-this-is.md'), true);
  eq('residue: a prefixed split section file', RESIDUE.test('docs/tracks/example/plan-04-where.md'), true);
  eq('NOT residue: a track README', RESIDUE.test('docs/tracks/example/README.md'), false);
  eq('NOT residue: a dated research file', RESIDUE.test('docs/tracks/example/research/2026-01-04-baseline.md'), false);
  eq('NOT residue: handoff', RESIDUE.test('docs/tracks/example/handoff.md'), false);
  eq('link: a doc under the docs root is relative', docLink('docs/reference/x.md', 'docs'), 'reference/x.md');
  eq('link: a doc outside it climbs out', docLink('templates/x.md', 'docs'), '../templates/x.md');
  eq('link: a non-default docs root', docLink('prose/reference/x.md', 'prose'), 'reference/x.md');
  // The sections, derived from the config. The hazard being pinned is a tracks dir configured
  // OUTSIDE the docs root, and a docs folder nobody listed in this file.
  const dirs = { docs: ['archive', 'explorations', 'reference', 'tracks', 'oddments', 'workspaces'] };
  const readdir = (d) => dirs[d] || [];
  const inside = sections('docs', 'docs/tracks', readdir).map((s) => s.dir);
  eq('sections: tracks first', inside[0], 'docs/tracks');
  eq('sections: the archive is absent', inside.includes('docs/archive'), false);
  eq('sections: the workspace notes are absent, so a plain task never rewrites the index', inside.includes(NOTES), false);
  eq('sections: tracks is not listed twice', inside.filter((d) => d === 'docs/tracks').length, 1);
  eq('sections: an unknown docs folder is still routed', inside.includes('docs/oddments'), true);
  eq('sections: an unknown folder is titled after itself', sections('docs', 'docs/tracks', readdir).find((s) => s.dir === 'docs/oddments').title, 'Oddments');
  eq('sections: a known folder keeps its title', sections('docs', 'docs/tracks', readdir).find((s) => s.dir === 'docs/reference').title, TITLES.reference);
  eq('sections: a tracks dir outside the docs root is still first', sections('docs', 'tracks', readdir)[0].dir, 'tracks');
  if (fails.length) { console.error('SELF-TEST FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS — docs-index.js self-test (' + CHECKS + ' checks)');
}

/* ---------- main ---------- */
if (args.includes('--self-test')) { selfTest(); process.exit(0); }

const scope = sections(DOCS, TRACKS, dirsIn);
const docs = collect(scope);
const generated = render(docs, scope);
let exit = 0;

/* The agent files are validated on --check as well as on --agents: the check that matters is that
   `--check` FAILS an agent file missing `model:` or `tools:`, because a rule that only fires on
   the command which REWRITES the block is a rule nobody runs. */
const { rows: agents, bad: agentsBad } = agentRows();
if (agentsBad.length && (args.includes('--check') || args.includes('--agents'))) {
  agentsBad.forEach((b) => console.error('AGENT FILE ' + b));
  exit = 1;
}

/* --check is a VERDICT and writes nothing, whatever else is on the command line: with --agents
   beside it the block used to be rewritten first and judged second, which turned the proof into
   the fix. */
if (args.includes('--agents') && !args.includes('--check')) {
  if (!fs.existsSync(ROUTING)) fatal('no routing doc at ' + ROUTING_REL, 'create ' + ROUTING_REL + ' (templates/docs/reference/routing/README.md is the shape) with a ' + A_BEGIN + ' / ' + A_END + ' pair where the registry belongs.');
  const text = fs.readFileSync(ROUTING, 'utf8');
  const i = text.indexOf(A_BEGIN), j = text.indexOf(A_END);
  if (i < 0 || j < 0) fatal(`${ROUTING_REL} has no ${A_BEGIN} / ${A_END} markers`, 'add both markers where the generated registry belongs; everything outside them is left untouched.');
  const next = text.slice(0, i) + renderAgents(agents) + text.slice(j + A_END.length);
  if (next !== text) { fs.writeFileSync(ROUTING, next); console.log(ROUTING_REL + ' registry block rewritten'); }
  else console.log(ROUTING_REL + ' registry block already current');
}

if (args.includes('--check')) {
  /* The verdict form. An INDEX that differs from what the generator produces means either someone
     edited the generated file or someone added a doc without regenerating; both leave routing
     pointing at something that is not there. The FIRST differing line is printed, because a diff
     of two generated tables is unreadable and the first line is where the cause is. */
  const committed = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : '';
  if (committed !== generated) {
    console.error(`INDEX DRIFT ${rel(INDEX)} differs from the generated index — run \`node scripts/harness/docs-index.js\``);
    const a = committed.split('\n'), b = generated.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  first difference at line ${i + 1}:\n    committed: ${a[i] === undefined ? '<eof>' : a[i]}\n    generated: ${b[i] === undefined ? '<eof>' : b[i]}`);
        break;
      }
    }
    process.exit(1);
  }
  console.log(`docs-index --check: ${rel(INDEX)} matches (${docs.length} live docs)`);
  /* The registry block is generated too, and it drifts the same two ways: an agent file added,
     removed or reworded without regenerating, or the block edited by hand. Either leaves the
     routing doc describing agents that are not the ones on disk. A routing doc that is absent, or
     has no marker pair, holds no block to drift and is not this check's finding: --agents is the
     command that refuses those. */
  const drift = registryDrift(readOrNull(ROUTING), agents);
  if (drift) {
    console.error(`REGISTRY DRIFT ${ROUTING_REL} — the agent registry block differs from .claude/agents/*.md — run \`node scripts/harness/docs-index.js --agents\``);
    console.error(`  first difference at block line ${drift.line}:\n    committed: ${drift.committed}\n    generated: ${drift.generated}`);
    process.exit(1);
  }
  process.exit(exit);
}

if (!args.includes('--agents')) {
  fs.mkdirSync(path.dirname(INDEX), { recursive: true });
  fs.writeFileSync(INDEX, generated);
  console.log(`wrote ${rel(INDEX)} — ${docs.length} live docs`);
}
process.exit(exit);
