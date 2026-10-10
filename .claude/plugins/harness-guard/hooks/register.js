/* ============================================================
   The harness guards, in-process: a tool call, an agent spawn and a file mention are each handed
   to scripts/harness/hook.js, and what it answered is relayed.

   THIS FILE HOLDS NO DECISION. Every call is spelled as the pre-tool payload the settings hook
   receives and piped to the same entry, so the verdict is the one the guards under
   scripts/harness/guards/ give, each with its own --self-test. A mod has no Node built-ins and no
   `require`, so anything decided here would be out of reach of `node --test`. What this file
   owns: the payload's spelling, the wording around a relayed reason, and the question it asks
   while a refused commit is held.

   IT IS NOT FINAL. It runs in the user tier: a mod loaded ahead of it can answer a call before
   it is asked, and a mod's `tool.check` can approve what it refused. Only a hook in managed
   settings is final. The settings hooks stay; for a tool call this is a second hearing of what
   they also judge. What only this file reaches is a spawn no `Agent` call made (a workflow
   agent, a teammate) and a file attached by a mention.

   IT FAILS CLOSED. Each hook has a `.catch` that refuses, and an entry that cannot be run or
   read is a refusal. So a session started anywhere but the repo root, where the relative path
   below does not resolve, has every guarded call refused: start it at the root.

   IT DRAWS NOTHING: no ui.render hook. `claude plugin validate` prints the proof on its
   `hooks:` and `calls:` lines.
   ============================================================ */

// The one script this mod runs, relative to the folder the session runs in
const HOOK = ['node', 'scripts/harness/hook.js', '--tool', 'claude-code', '--event', 'pre-tool']
// The wait the settings registration gives the same entry
const THIRTY_SECONDS = 30000
// How the hygiene guard opens its line for the person. Chooses the dialog, never the verdict.
const HYGIENE = 'Commit hygiene gate:'
const CHECK_AGAIN = 'Check again'
const CANCEL = 'Cancel the commit'
const ALLOW_IT = 'Allow it'
const REFUSE_IT = 'Refuse it'
// How many times a held commit is checked again before it is refused
const HELD_CHECKS = 5
const QUESTION_MAX = 1500

// Where the session runs, once it has said
let cwd = null

// Ask the entry about one call. Returns { deny, ask, reason, message }; throws if it cannot be run.
async function judge($, tool, input) {
  const payload = { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }
  if (cwd) payload.cwd = cwd
  const r = await $.process.run(HOOK, { stdin: JSON.stringify(payload), timeoutMs: THIRTY_SECONDS })
  const out = String(r.stdout || '').trim()
  let said = null
  if (out) {
    try {
      said = JSON.parse(out)
    } catch {
      said = undefined
    }
  }
  const spoken = (said && said.hookSpecificOutput) || {}
  const reason = String(spoken.permissionDecisionReason || r.stderr || '').trim()
  const message = String((said && said.systemMessage) || '')
  // Exit 2 is the entry's refusal. Any other failure is an entry that did not look, which is not a pass.
  if (r.exitCode !== 0) {
    return { deny: true, ask: false, message, reason: reason || 'scripts/harness/hook.js left with exit ' + r.exitCode + ' and no reason, so no guard looked at this call.' }
  }
  if (said === undefined || spoken.permissionDecision === 'deny') {
    return { deny: true, ask: false, message, reason: reason || 'scripts/harness/hook.js printed an answer that could not be read, so this call was not run.' }
  }
  return { deny: false, ask: spoken.permissionDecision === 'ask', reason, message }
}

// Put a question to the person. Nobody there, or a dismissed question, is the safe answer.
async function ask($, question, options, safe) {
  try {
    return await $.ui.ask(question.slice(0, QUESTION_MAX), options)
  } catch {
    return safe
  }
}

// An ask from the guards where no permission prompt follows: a person decides, or it is refused
async function decided($, verdict, what) {
  if (!verdict.ask) return verdict
  const answer = await ask($, 'The harness guards could not read ' + what + ', so you decide.\n' + verdict.reason, [ALLOW_IT, REFUSE_IT], REFUSE_IT)
  if (answer === ALLOW_IT) return { ...verdict, ask: false }
  return { ...verdict, deny: true, ask: false, reason: verdict.reason + '\nNobody allowed it, so it was refused.' }
}

// What a `.catch` answers with: the refusal, unless the hook had already passed the call on
function refusal(e, next, what) {
  if (next.called) return next(e)
  const kind = (next.error && next.error.kind) || 'failed'
  return { deny: 'harness-guard could not ask scripts/harness/hook.js about ' + what + ' (' + kind + '), so it was refused. Start the session at the repo root, or run `node scripts/harness/hook.js --self-test`.' }
}
// One per gating hook: the validator reads a `.catch` handler only by its own name
async function callFailed($, e, next) { return refusal(e, next, 'this tool call') }
async function spawnFailed($, e, next) { return refusal(e, next, 'this spawn') }
async function mentionFailed($, e, next) { return refusal(e, next, 'this mention') }

export function register(on) {
  // Runs before the first prompt, and again after a reload
  on('session.start', async ($, e, next) => {
    cwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : null
    return next(e)
  })

  // Every tool the settings matcher names, for the lead and for every agent. The names are
  // written out so `claude plugin validate` can print them, and tests/harness-guard.test.js
  // holds them to the dialect's list.
  on('tool.call', { tool: /^(Bash|PowerShell|Read|Grep|Glob|Edit|Write|Monitor|NotebookEdit|Agent|mcp__.*)$/ }, async ($, e, next) => {
    const { tool, tool_use_id, agentId, ...input } = e
    let verdict = await judge($, tool, input)
    // A refused commit is held: the person fixes the tree and has it checked again, or cancels
    for (let checks = 0; verdict.deny && verdict.message.startsWith(HYGIENE) && checks < HELD_CHECKS; checks++) {
      const answer = await ask($, verdict.reason, [CHECK_AGAIN, CANCEL], CANCEL)
      if (answer !== CHECK_AGAIN) return { deny: verdict.reason + '\nThe commit was cancelled. Do not retry it until the findings above are fixed.' }
      verdict = await judge($, tool, input)
    }
    if (verdict.deny) return { deny: verdict.reason }
    // An ask is left to the permission check under this hook, which the settings hook answers too
    return next(e)
  }).catch(callFailed)

  // Every spawn, including the ones no `Agent` call made: a workflow agent and a teammate
  on('agent.spawn', async ($, e, next) => {
    const input = { subagent_type: e.subagentType, prompt: e.prompt, description: e.description }
    const verdict = await decided($, await judge($, 'Agent', input), 'this spawn')
    if (verdict.deny) return { deny: verdict.reason }
    return next(e)
  }).catch(spawnFailed)

  // A file named with @ is attached without a Read call, so no settings hook sees it
  on('prompt.mention', async ($, e, next) => {
    const verdict = await decided($, await judge($, 'Read', { file_path: e.path }), 'this mention')
    if (verdict.deny) return { deny: verdict.reason }
    return next(e)
  }).catch(mentionFailed)
}
