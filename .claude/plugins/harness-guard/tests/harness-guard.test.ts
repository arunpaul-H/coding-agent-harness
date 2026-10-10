/* The harness guards as a mod, driven the way the tool drives it: no session, no sign-in, no
   network. scripts/harness/hook.js is a stub here, so what these tests hold is what the mod DOES
   with the entry's answer, never what the answer is. The guards have their own --self-test for
   that. Run: claude plugin test .claude/plugins/harness-guard */
import { expect, mock, test } from 'claude-code/testing'

const HOOK = ['node', 'scripts/harness/hook.js', '--tool', 'claude-code', '--event', 'pre-tool']

// What the entry prints for a refusal and for an ask, in the claude dialect's spelling
const spoken = (how: string, reason: string, message: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: how, permissionDecisionReason: reason }, systemMessage: message }) + '\n'
const PASS = { value: { exitCode: 0, stdout: '', stderr: '' } }
const refused = (reason: string, message = 'A guard: refused.') => ({ value: { exitCode: 2, stdout: spoken('deny', reason, message), stderr: reason } })
const asked = (reason: string) => ({ value: { exitCode: 0, stdout: spoken('ask', reason, ''), stderr: '' } })
const HYGIENE = 'Commit hygiene gate: 1 finding(s) — commit/push blocked until the tree is clean.'

// Every stub the mod needs. `answer` says what the entry answers each time it is asked.
function stubs(on: any, answer: (payload: any, nth: number) => any) {
  const seen = {
    argv: [] as string[][], payloads: [] as any[], timeouts: [] as unknown[], asked: [] as string[], options: [] as string[][],
    ran: [] as string[], spawned: 0, attached: 0,
    // What the person picks when the mod asks, in order; null dismisses the question
    picks: [] as (string | null)[],
  }
  on('session.start', () => ({ cwd: '/work' }))
  on('process.run', (_$: any, e: any) => {
    seen.argv.push(e.argv)
    seen.timeouts.push(e.init && e.init.timeoutMs)
    const payload = JSON.parse(e.init.stdin)
    seen.payloads.push(payload)
    return answer(payload, seen.payloads.length)
  })
  // The end of the chain: the tool itself, and the dialog $.ui.ask opens
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') {
      seen.ran.push(e.tool)
      return { result: { stdout: 'ran', stderr: '' } }
    }
    const question = e.questions[0].question
    seen.asked.push(question)
    seen.options.push(e.questions[0].options.map((option: any) => option.label))
    const pick = seen.picks.length ? seen.picks.shift() : null
    return pick == null ? { deny: 'dismissed' } : { result: { answers: { [question]: pick } } }
  })
  on('agent.spawn', () => {
    seen.spawned += 1
    // What the tool answers a spawn it lets start: the model that agent runs on
    return { model: 'some-model' }
  })
  on('prompt.mention', () => {
    seen.attached += 1
    return { type: 'file' }
  })
  return seen
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const BASH = (command: string) => ({ tool: 'Bash', command, description: 'a command', tool_use_id: 'toolu_1' })
const SPAWN = { tool_use_id: 'toolu_2', prompt: 'do the thing', description: 'a task', subagentType: 'implement', background: false, fork: false }
const MENTION = { mention: 'notes.md', path: '/work/notes.md' }

/* ---- a tool call ---- */

test('a tool call is handed to the entry as the payload the settings hook gets, and runs when it passes', async ($, on) => {
  const seen = stubs(on, () => PASS)
  await $.session.start(START)

  const result = await $.tool.call(BASH('echo hi'))

  expect(seen.argv).toEqual([HOOK])
  expect(seen.timeouts).toEqual([30000])
  // The call's own arguments, without the envelope the tool wraps them in
  expect(seen.payloads[0]).toEqual({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi', description: 'a command' }, cwd: '/work' })
  expect(seen.ran).toEqual(['Bash'])
  expect(result.deny).toBeUndefined()
})

test('a refusal is relayed in the guard\'s own words and the tool does not run', async ($, on) => {
  const seen = stubs(on, () => refused('Secret-file guard: this names a guarded file.'))

  const result = await $.tool.call({ tool: 'Read', file_path: '/work/.env', tool_use_id: 't' })

  expect(result.deny).toBe('Secret-file guard: this names a guarded file.')
  expect(seen.ran).toEqual([])
  // No question: only a refused commit is held
  expect(seen.asked).toEqual([])
})

test('a refusal on stderr alone is still a refusal', async ($, on) => {
  stubs(on, () => ({ value: { exitCode: 2, stdout: '', stderr: 'HOOK ENTRY REFUSED: --tool <id> is missing.\n' } }))

  const result = await $.tool.call(BASH('echo hi'))

  expect(result.deny).toBe('HOOK ENTRY REFUSED: --tool <id> is missing.')
})

test('an entry that left with any other failure did not look, so the call is refused', async ($, on) => {
  const seen = stubs(on, () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))

  const result = await $.tool.call(BASH('echo hi'))

  expect(result.deny).toMatch(/left with exit 1 and no reason, so no guard looked at this call/)
  expect(seen.ran).toEqual([])
})

test('an answer that cannot be read is a refusal, never a pass', async ($, on) => {
  const seen = stubs(on, () => ({ value: { exitCode: 0, stdout: 'not json', stderr: '' } }))

  const result = await $.tool.call(BASH('echo hi'))

  expect(result.deny).toMatch(/could not be read, so this call was not run/)
  expect(seen.ran).toEqual([])
})

test('an entry that cannot be run at all is refused by the catch', async ($, on) => {
  const seen = stubs(on, () => ({ deny: 'node is not on the path' }))

  const result = await $.tool.call(BASH('echo hi'))

  expect(result.deny).toMatch(/^harness-guard could not ask scripts\/harness\/hook\.js about this tool call/)
  expect(seen.ran).toEqual([])
})

test('an ask on a tool call is left to the permission check under the mod', async ($, on) => {
  const seen = stubs(on, () => asked('no guard can read this call'))

  await $.tool.call({ tool: 'mcp__server__thing', anything: 1, tool_use_id: 't' })

  expect(seen.asked).toEqual([])
  expect(seen.ran).toEqual(['mcp__server__thing'])
})

test('a tool the settings matcher does not name is not handed over', async ($, on) => {
  const seen = stubs(on, () => refused('never reached'))

  await $.tool.call({ tool: 'TodoWrite', todos: [], tool_use_id: 't' })

  expect(seen.payloads).toEqual([])
  expect(seen.ran).toEqual(['TodoWrite'])
})

/* ---- a held commit ---- */

test('a commit the hygiene guard refuses is held, shown with its findings, and cancelled on request', async ($, on) => {
  const seen = stubs(on, () => refused('COMMIT HYGIENE: 1 finding\n  x stray.tmp is untracked', HYGIENE))
  seen.picks = ['Cancel the commit']

  const result = await $.tool.call(BASH('git commit -m x'))

  expect(seen.asked).toEqual(['COMMIT HYGIENE: 1 finding\n  x stray.tmp is untracked'])
  expect(seen.options).toEqual([['Check again', 'Cancel the commit']])
  expect(result.deny).toMatch(/^COMMIT HYGIENE: 1 finding\n {2}x stray\.tmp is untracked\nThe commit was cancelled\./)
  expect(seen.ran).toEqual([])
})

test('a held commit runs once the guard, asked again, finds the tree clean', async ($, on) => {
  const seen = stubs(on, (_payload, nth) => (nth === 1 ? refused('COMMIT HYGIENE: 1 finding', HYGIENE) : PASS))
  seen.picks = ['Check again']

  const result = await $.tool.call(BASH('git commit -m x'))

  // Asked twice with the same payload: the second verdict is the guard's, not the person's
  expect(seen.payloads.length).toBe(2)
  expect(seen.payloads[1]).toEqual(seen.payloads[0])
  expect(seen.ran).toEqual(['Bash'])
  expect(result.deny).toBeUndefined()
})

test('a held commit that stays dirty is asked about again, and refused when nobody answers', async ($, on) => {
  const seen = stubs(on, () => refused('COMMIT HYGIENE: 1 finding', HYGIENE))
  seen.picks = ['Check again', null]

  const result = await $.tool.call(BASH('git commit -m x'))

  expect(seen.asked.length).toBe(2)
  expect(result.deny).toMatch(/The commit was cancelled\./)
  expect(seen.ran).toEqual([])
})

test('a held commit is checked again five times at most, then refused', async ($, on) => {
  const seen = stubs(on, () => refused('COMMIT HYGIENE: 1 finding', HYGIENE))
  seen.picks = Array(9).fill('Check again')

  const result = await $.tool.call(BASH('git commit -m x'))

  expect(seen.asked.length).toBe(5)
  expect(seen.payloads.length).toBe(6)
  expect(result.deny).toBe('COMMIT HYGIENE: 1 finding')
  expect(seen.ran).toEqual([])
})

/* ---- a spawn ---- */

test('every spawn is handed to the entry as an Agent call, and starts when it passes', async ($, on) => {
  const seen = stubs(on, () => PASS)

  await $.agent.spawn({ ...SPAWN, subagentType: 'workflow-subagent', workflow: { runId: 'wf_1', agentIndex: 1 } })

  expect(seen.payloads[0]).toEqual({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'workflow-subagent', prompt: 'do the thing', description: 'a task' } })
  expect(seen.spawned).toBe(1)
})

test('a spawn the spawn guard refuses does not start', async ($, on) => {
  const seen = stubs(on, () => refused('S1 SPAWN WITHOUT THE CONTRACT: the prompt lacks OUTCOME:'))

  const result = await $.agent.spawn(SPAWN)

  expect(result.deny).toBe('S1 SPAWN WITHOUT THE CONTRACT: the prompt lacks OUTCOME:')
  expect(seen.spawned).toBe(0)
})

test('a spawn the entry cannot be asked about is refused by the catch', async ($, on) => {
  const seen = stubs(on, () => ({ deny: 'timed out' }))

  const result = await $.agent.spawn(SPAWN)

  expect(result.deny).toMatch(/^harness-guard could not ask scripts\/harness\/hook\.js about this spawn/)
  expect(seen.spawned).toBe(0)
})

test('an ask on a spawn goes to the person, and starts only on their word', async ($, on) => {
  const seen = stubs(on, () => asked('no guard can read this spawn'))
  seen.picks = ['Allow it']

  await $.agent.spawn(SPAWN)
  expect(seen.options).toEqual([['Allow it', 'Refuse it']])
  expect(seen.spawned).toBe(1)

  // Nobody answers the second time
  const result = await $.agent.spawn(SPAWN)
  expect(result.deny).toMatch(/Nobody allowed it, so it was refused\.$/)
  expect(seen.spawned).toBe(1)
})

/* ---- a mention ---- */

test('a mentioned file is handed to the entry as a Read call, and attached when it passes', async ($, on) => {
  const seen = stubs(on, () => PASS)

  const result = await $.prompt.mention(MENTION)

  expect(seen.payloads[0]).toEqual({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/work/notes.md' } })
  expect(seen.attached).toBe(1)
  expect(result.type).toBe('file')
})

test('a mention of a guarded file is refused and nothing is attached', async ($, on) => {
  const seen = stubs(on, () => refused('Secret-file guard: refused a call naming a guarded file.'))

  const result = await $.prompt.mention({ mention: '.env', path: '/work/.env' })

  expect(result.deny).toBe('Secret-file guard: refused a call naming a guarded file.')
  expect(seen.attached).toBe(0)
})

test('a mention the entry cannot be asked about is refused by the catch', async ($, on) => {
  const seen = stubs(on, () => ({ deny: 'node is not on the path' }))

  const result = await $.prompt.mention(MENTION)

  expect(result.deny).toMatch(/^harness-guard could not ask scripts\/harness\/hook\.js about this mention/)
  expect(seen.attached).toBe(0)
})
