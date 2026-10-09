/* The harness panel, driven the way the tool drives it: no session, no sign-in, no network.
   Every answer the mod expects from outside itself is a stub here, so what these tests hold is
   what the mod DOES with panel.js's facts, never what the facts say. panel.js has its own
   --self-test for that. Run: claude plugin test .claude/plugins/harness */
import { expect, mock, test } from 'claude-code/testing'

const PANEL = ['node', 'scripts/harness/panel.js']
const GATE = ['node', 'scripts/harness/gates.js', '--check', '--allow-skip', 'docs=1']

// What panel.js prints, in the shape scripts/harness/panel.js gives it
const factsOf = (gates: object, more: object = {}) => ({
  at: '2026-01-01T00:00:00.000Z',
  gates: { state: 'green', why: '', at: '2026-01-01T00:00:00.000Z', ran: 2, of: 2, reasons: [], changed: 0, newest: null, command: GATE.join(' '), argv: GATE, ...gates },
  tracks: [{ id: 'some-track', phaseNext: 2, doing: 'PHASE 2: do the thing', handoff: true }],
  findings: [],
  problems: [],
  ...more,
})

// What the tool passes a ui.render hook for the band above the prompt
const BAND = {
  plugin: 'harness',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 120, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

// Every stub the mod needs. `answer` says what each command prints; `ran` records each argv.
function stubs(on: any, answer: (argv: string[]) => any) {
  const seen = { ran: [] as string[][], timeouts: [] as unknown[], toasts: [] as string[], commands: [] as string[] }
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$: any, e: any) => {
    seen.commands.push(e.name)
    return { value: undefined }
  })
  on('process.run', (_$: any, e: any) => {
    seen.ran.push(e.argv)
    seen.timeouts.push(e.init && e.init.timeoutMs)
    return answer(e.argv)
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 68800, window: 200000, percent: 34.4 }, rateLimits: [], cost: null } }))
  on('ui.toast', (_$: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  // Stands for what the tool itself draws in the band: nothing of its own
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by the tool'] }))
  return { seen, clock }
}

const printed = (value: object) => ({ value: { exitCode: 0, stdout: JSON.stringify(value) + '\n', stderr: '' } })
const isPanel = (argv: string[]) => argv.join(' ') === PANEL.join(' ')
const START = { surface: 'terminal', isInteractive: true, cwd: '/work' }

test('the band draws the verdict, the open track, the findings and the context', async ($, on) => {
  const { seen, clock } = stubs(on, () =>
    printed(factsOf({ state: 'stale', why: '2 gate-relevant files changed after the run', changed: 2 }, { findings: [{ name: 'docs-lint', line: 'x' }] })),
  )
  await $.session.start(START)
  await clock.settle()

  expect(seen.commands).toEqual(['gates'])
  expect(seen.ran).toEqual([PANEL])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'gates: stale (2 gate-relevant files changed after the run)' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^gates: / }))!.props.color).toBe('yellow')
  expect(await ui.find({ type: 'Text', text: 'track: some-track phase 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'findings: 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'context 34%' })).toBeDefined()
  // What the mods after this one drew is kept
  expect(await ui.find({ type: 'Text', text: 'drawn by the tool' })).toBeDefined()
})

test('a green verdict is green, and a quiet session shows no findings', async ($, on) => {
  const { clock } = stubs(on, () => printed(factsOf({}, { tracks: [] })))
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount(BAND)
  const gates = await ui.find({ type: 'Text', text: 'gates: green' })
  expect(gates!.props.color).toBe('green')
  expect(await ui.find({ type: 'Text', text: 'no open track' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^findings: / })).toBeUndefined()
})

test('facts that cannot be read are drawn as unread, never as a clean band', async ($, on) => {
  const { clock } = stubs(on, () => ({ deny: 'node is not on the path' }))
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^facts not read: / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^gates: / })).toBeUndefined()
})

test('a script that reports its own failure is unread too', async ($, on) => {
  const { clock } = stubs(on, () => ({ value: { exitCode: 1, stdout: '{"error":"it broke"}\n', stderr: '' } }))
  await $.session.start(START)
  await clock.settle()

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'facts not read: it broke' })).toBeDefined()
})

test('/gates runs the command panel.js named, relays its closing lines and redraws', async ($, on) => {
  let state = 'stale'
  const { seen } = stubs(on, (argv) => {
    if (isPanel(argv)) return printed(factsOf({ state }))
    state = 'green'
    return { value: { exitCode: 0, stdout: 'GATE test pass=10 fail=0 skipped=0\n\n' + '-'.repeat(56) + '\nGATES GREEN — test 10/10\n', stderr: '' } }
  })

  const answer = await $.command.run({ command: 'gates', args: '' })

  expect(answer.text).toBe('GATES GREEN — test 10/10')
  // The facts first, then the command they named with the longest wait a mod may ask for, then the facts again
  expect(seen.ran).toEqual([PANEL, GATE, PANEL])
  expect(seen.timeouts[1]).toBe(600000)
  expect(seen.toasts).toEqual(['GATES GREEN — test 10/10'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'gates: green' })).toBeDefined()
})

test('/gates relays a red run with every reason under the rule', async ($, on) => {
  const out = 'noise\n' + '-'.repeat(56) + '\r\nGATES RED — 1 violation(s) against scripts/harness/gates.baseline.json:\r\n  x test: 1 failing check(s)\r\n'
  stubs(on, (argv) => (isPanel(argv) ? printed(factsOf({ state: 'red' })) : { value: { exitCode: 1, stdout: out, stderr: '' } }))

  const answer = await $.command.run({ command: 'gates', args: '' })

  expect(answer.text).toBe('GATES RED — 1 violation(s) against scripts/harness/gates.baseline.json:\n  x test: 1 failing check(s)')
})

test('a suite that does not finish is NOT RUN, with the command to run in a shell', async ($, on) => {
  const { seen } = stubs(on, (argv) => (isPanel(argv) ? printed(factsOf({})) : { deny: 'still running at the timeout' }))

  const answer = await $.command.run({ command: 'gates', args: '' })

  expect(answer.text).toMatch(/^GATES NOT RUN: `node scripts\/harness\/gates\.js --check --allow-skip docs=1` did not finish/)
  expect(seen.toasts.length).toBe(1)
})

test('with no facts there is no command, so /gates runs nothing and says so', async ($, on) => {
  const { seen } = stubs(on, () => ({ deny: 'node is not on the path' }))

  const answer = await $.command.run({ command: 'gates', args: '' })

  expect(answer.text).toMatch(/^GATES NOT RUN: scripts\/harness\/panel\.js could not be read/)
  expect(seen.ran).toEqual([PANEL])
})

test('a finished turn reads the facts again', async ($, on) => {
  let state = 'green'
  const { seen, clock } = stubs(on, () => printed(factsOf({ state })))
  await $.session.start(START)
  await clock.settle()

  state = 'stale'
  await $.turn.complete({ turnId: 't', answer: 'done', durationMs: 1, isAborted: false, usage: null })
  await clock.settle()

  expect(seen.ran).toEqual([PANEL, PANEL])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'gates: stale' })).toBeDefined()
})

test('where nothing draws, the facts are not read at all and /gates is still added', async ($, on) => {
  const { seen, clock } = stubs(on, () => printed(factsOf({})))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.turn.complete({ turnId: 't', answer: 'done', durationMs: 1, isAborted: false, usage: null })
  await clock.settle()

  expect(seen.ran).toEqual([])
  expect(seen.commands).toEqual(['gates'])
})
