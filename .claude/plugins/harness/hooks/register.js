/* ============================================================
   The harness panel: a band above the prompt, /gates, and the track lifecycle as commands
   (/track, /handoff, /close-phase).

   THIS FILE HOLDS NO DECISION. It runs scripts/harness/panel.js, which judges, and draws what
   that script printed; each command runs the argv that script named and relays what it said.
   A receipt, a `status:` and a handoff are written by close-phase.js and by a person, never here.
   A mod has no Node built-ins and no `require`, so anything decided here would be out of reach
   of `node --test`. Colours, wording and where a line is cut are all this file owns.

   IT NEVER GATES A CALL: no tool.call, tool.check or prompt.submit hook, and no $.fs.write
   (it reads one file, the handoff /track shows),
   $.http.fetch or $.model.complete. `claude plugin validate` prints the proof on its `hooks:`
   and `calls:` lines.

   WHERE NOTHING DRAWS (a headless run) the band's facts are not read at all. The commands still
   work, except /close-phase: nobody is there to confirm it, so it closes nothing.
   ============================================================ */

// The one script this mod reads, relative to the folder the session runs in
const PANEL = ['node', 'scripts/harness/panel.js']
// The longest $.process.run allows. A suite that needs longer is reported as NOT RUN.
const TEN_MINUTES = 600000
const TOAST_MAX = 100
// close-phase.js lints, checks hygiene and reads the tree: longer than the default wait
const TWO_MINUTES = 120000
// The pane /track opens
const PANE = 'harness-track'
const CLOSE_IT = 'Close it'

// What panel.js printed, or null while it has not been read
let facts = null
// Why it could not be read, when it could not
let unread = 'not read yet'
// Context in use, in percent, or null when the session has not said
let percent = null
// True while /gates is running the suite
let running = false
// True when this session has somewhere to draw
let draws = false
// True from a compaction until the next turn ends
let compacted = false
// The handoff the pane shows: { id, text }, or null before /track
let shown = null

const firstLine = (error) => String((error && error.message) || error || 'no reason given').split('\n')[0]

// Run panel.js and keep what it printed. Never throws: a failure is something to draw.
async function refresh($) {
  try {
    const r = await $.process.run(PANEL)
    const read = JSON.parse(r.stdout)
    if (!read || typeof read !== 'object' || read.error) throw new Error((read && read.error) || 'panel.js printed no facts')
    facts = read
    unread = ''
  } catch (error) {
    facts = null
    unread = firstLine(error)
  }
  $.ui.invalidate('ui.render')
}

// Ask the session how full the context is
async function measure($) {
  try {
    const usage = await $.session.usage()
    percent = usage && usage.context && typeof usage.context.percent === 'number' ? Math.round(usage.context.percent) : null
  } catch {
    percent = null
  }
  $.ui.invalidate('ui.render')
}

// The lines gates.js prints under its rule: the verdict, then each reason
function closing(stdout) {
  const lines = String(stdout || '').split('\n').map((line) => line.trimEnd())
  const rule = lines.lastIndexOf('-'.repeat(56))
  const tail = (rule >= 0 ? lines.slice(rule + 1) : lines).filter(Boolean)
  return rule >= 0 ? tail.slice(0, 20) : tail.slice(-8)
}

// The open track a command means: the one named after it, or the only one there is
function trackFor(args) {
  const tracks = facts ? facts.tracks : []
  const id = String(args || '').trim()
  if (id) return tracks.find((track) => track.id === id) || null
  return tracks.length === 1 ? tracks[0] : null
}

// What to say when a command has no track to act on
function noTrack(args) {
  if (!facts) return 'NOT RUN: scripts/harness/panel.js could not be read (' + unread + '), so no track is known.'
  const open = facts.tracks.map((track) => track.id)
  if (!open.length) return 'No open track.'
  const id = String(args || '').trim()
  return (id ? 'No open track named `' + id + '`.' : 'More than one track is open, so name one.') + ' Open: ' + open.join(', ')
}

// Run one harness command and hand back everything it printed
async function relay($, argv) {
  try {
    const r = await $.process.run(argv, { timeoutMs: TWO_MINUTES })
    const said = (String(r.stdout || '') + '\n' + String(r.stderr || '')).split('\n').map((line) => line.trimEnd()).filter(Boolean)
    return said.length ? said.join('\n') : '`' + argv.join(' ') + '` printed nothing (exit ' + r.exitCode + ').'
  } catch (error) {
    return 'NOT RUN: `' + argv.join(' ') + '` did not finish (' + firstLine(error) + ').'
  }
}

// One line per open track, for the transcript
function listing() {
  return facts.tracks
    .map((track) => track.id + (track.phaseNext === null ? '' : '  phase ' + track.phaseNext) + (track.doing ? '  ' + track.doing : ''))
    .join('\n')
}

const COLOURS = { green: 'green', red: 'red', stale: 'yellow', 'not-run': 'yellow' }

export function register(on) {
  // Runs before the first prompt, and again after a reload
  on('session.start', async ($, e, next) => {
    draws = e.isInteractive === true
    if (draws) {
      // On a timer, so the session does not wait for the facts
      $.clock.after(0, () => refresh($))
      $.clock.after(0, () => measure($))
    }
    // Last, because a refused name throws and the rest of the hook would be skipped
    try {
      await $.command.register({ name: 'gates', description: 'Run the gate suite and show its verdict, without a model turn' })
      await $.command.register({ name: 'track', description: 'List the open tracks and show one handoff in a pane', argumentHint: '[track]' })
      await $.command.register({ name: 'handoff', description: 'Lint the handoff of a track and show each finding', argumentHint: '[track]' })
      await $.command.register({ name: 'close-phase', description: 'Close the phase of a track through close-phase.js, after you confirm', argumentHint: '[track]' })
    } catch (error) {
      $.ui.log('a command was not added: ' + firstLine(error))
    }
    return next(e)
  })

  // A compacted session has lost the handoff it was working from. This event can refuse a
  // compaction and this hook never does: it notes that one happened, and if it fails the
  // compaction goes ahead.
  on('session.compact', async ($, e, next) => {
    compacted = true
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // A turn may have edited a file, which makes a recorded run stale
  on('turn.complete', async ($, e, next) => {
    if (draws) $.clock.after(0, () => refresh($))
    const result = await next(e)
    if (!compacted) return result
    compacted = false
    const track = facts ? facts.tracks.find((open) => open.handoff) : null
    if (!track) return result
    // The line under the answer
    const line = 'Context was compacted. The open track resumes from ' + track.handoff
    return { ...result, text: result && result.text ? result.text + '\n' + line : line }
  })

  // Fires after each turn, and when a plan limit moves
  on('session.measure', async ($, e, next) => {
    if (draws) await measure($)
    return next(e)
  })

  // Runs when the person types /gates
  on('command.run', { command: 'gates' }, async ($) => {
    if (running) return { text: 'The gate suite is already running.' }
    if (!facts) await refresh($)
    if (!facts) return { text: 'GATES NOT RUN: scripts/harness/panel.js could not be read (' + unread + '), so there is no gate command to run.' }
    const command = facts.gates.command
    running = true
    $.ui.invalidate('ui.render')
    let text
    try {
      const r = await $.process.run(facts.gates.argv, { timeoutMs: TEN_MINUTES })
      const lines = closing(r.stdout)
      text = lines.length ? lines.join('\n') : 'GATES NOT RUN: `' + command + '` printed nothing (exit ' + r.exitCode + ').'
    } catch (error) {
      text = 'GATES NOT RUN: `' + command + '` did not finish (' + firstLine(error) + '). A mod may run a command for ten minutes at most; run it in a shell.'
    }
    running = false
    await refresh($)
    $.ui.toast(text.split('\n')[0].slice(0, TOAST_MAX))
    return { text }
  })

  // Runs when the person types /track
  on('command.run', { command: 'track' }, async ($, e) => {
    if (!facts) await refresh($)
    const track = trackFor(e.args)
    if (!track) return { text: noTrack(e.args) }
    if (!track.handoff) return { text: listing() + '\n' + track.id + ' has no handoff to show.' }
    let text
    try {
      text = await $.fs.read(track.handoff)
    } catch (error) {
      return { text: listing() + '\n' + track.handoff + ' could not be read (' + firstLine(error) + ').' }
    }
    shown = { id: track.id, text }
    await $.ui.open({ id: PANE, title: 'handoff: ' + track.id, focus: true, closeOnEscape: true })
    $.ui.invalidate('ui.render')
    return { text: listing() }
  })

  // Runs when the person types /handoff
  on('command.run', { command: 'handoff' }, async ($, e) => {
    if (!facts) await refresh($)
    const track = trackFor(e.args)
    if (!track) return { text: noTrack(e.args) }
    return { text: await relay($, track.lint) }
  })

  // Runs when the person types /close-phase
  on('command.run', { command: 'close-phase' }, async ($, e) => {
    if (!facts) await refresh($)
    const track = trackFor(e.args)
    if (!track) return { text: noTrack(e.args) }
    const what = (track.closes === null ? 'the phase' : 'phase ' + track.closes) + ' of ' + track.id
    let answer
    try {
      answer = await $.ui.ask('Close ' + what + '?', [CLOSE_IT, 'Cancel'])
    } catch {
      return { text: 'NOT CLOSED: nobody confirmed closing ' + what + '.' }
    }
    if (answer !== CLOSE_IT) return { text: 'NOT CLOSED: ' + what + ' was left open.' }
    const text = await relay($, track.close)
    await refresh($)
    return { text }
  })

  // Runs each time a pane is drawn
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    // Leave other mods' panes alone
    if (e.requestId !== PANE || !shown) return next(e)
    const { Box, Markdown } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', children: [Markdown({ key: 'handoff', text: shown.text })] })
  })

  // Runs each time the band above the prompt is drawn
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    // What the mods after this one draw there, kept under this one's line
    const theirs = await next(e)
    const parts = [Text({ bold: true, children: ['harness'] })]

    if (running) {
      parts.push(Text({ color: 'yellow', children: ['gates: running'] }))
    } else if (!facts) {
      parts.push(Text({ color: 'yellow', wrap: 'truncate-end', children: ['facts not read: ' + unread] }))
    } else {
      const g = facts.gates
      parts.push(Text({ color: COLOURS[g.state], wrap: 'truncate-end', children: ['gates: ' + g.state + (g.why ? ' (' + g.why + ')' : '')] }))
    }

    if (facts) {
      const track = facts.tracks[0]
      const more = facts.tracks.length > 1 ? ' +' + (facts.tracks.length - 1) + ' more' : ''
      parts.push(Text({
        dimColor: !track,
        children: [track ? 'track: ' + track.id + (track.phaseNext === null ? '' : ' phase ' + track.phaseNext) + more : 'no open track'],
      }))
      if (facts.findings.length) parts.push(Text({ children: ['findings: ' + facts.findings.length] }))
      if (facts.problems.length) parts.push(Text({ color: 'red', children: ['unread: ' + facts.problems.length] }))
    }
    if (percent !== null) parts.push(Text({ dimColor: true, children: ['context ' + percent + '%'] }))

    const mine = Box({ flexDirection: 'row', columnGap: 2, children: parts })
    return theirs ? Box({ flexDirection: 'column', children: [mine, theirs] }) : mine
  })
}
