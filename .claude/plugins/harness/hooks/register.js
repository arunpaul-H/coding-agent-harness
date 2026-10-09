/* ============================================================
   The harness panel: a band above the prompt, and /gates.

   THIS FILE HOLDS NO DECISION. It runs scripts/harness/panel.js, which judges, and draws what
   that script printed; /gates runs the command that script named and relays its closing lines.
   A mod has no Node built-ins and no `require`, so anything decided here would be out of reach
   of `node --test`. Colours, wording and where a line is cut are all this file owns.

   IT NEVER GATES A CALL: no tool.call, tool.check or prompt.submit hook, and no $.fs.write,
   $.http.fetch or $.model.complete. `claude plugin validate` prints the proof on its `hooks:`
   and `calls:` lines.

   WHERE NOTHING DRAWS (a headless run) the band's facts are not read at all. /gates still works.
   ============================================================ */

// The one script this mod reads, relative to the folder the session runs in
const PANEL = ['node', 'scripts/harness/panel.js']
// The longest $.process.run allows. A suite that needs longer is reported as NOT RUN.
const TEN_MINUTES = 600000
const TOAST_MAX = 100

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
    } catch (error) {
      $.ui.log('/gates was not added: ' + firstLine(error))
    }
    return next(e)
  })

  // A turn may have edited a file, which makes a recorded run stale
  on('turn.complete', async ($, e, next) => {
    if (draws) $.clock.after(0, () => refresh($))
    return next(e)
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
