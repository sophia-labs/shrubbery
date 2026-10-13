import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ownerGraphPath = '/o/user%3Abrowser-proof-user/g/sophia-cluster'
const workflow = {
  name: 'domain-agent-activity-loop-v1',
  workflowUri: 'urn:sophia:wf:domain-agent-activity-loop-v1',
  definitionDigest: 'a'.repeat(64),
  inputs: { type: 'object', required: ['definitionDocumentId', 'trigger', 'contextRefs'] },
  outputs: { type: 'object' },
}
const calls: Array<{ method: string; url: string; body?: unknown; headers: Record<string, string> }> = []
let initialStreamSent = false
let followUpWorkerSent = false
let followUpCommitted = false
let followUpCommandId = ''

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`cloud2-chat-browser-harness assertion failed: ${message}`)
}

function semanticEvent(seq: number, type: string, value: Record<string, unknown>) {
  return {
    sessionId: 'ags-browser-proof',
    seq,
    ts: 1_000 + seq,
    type,
    payload: {
      schema: 'sophia.agent-session-semantic-event.v1',
      sourceType: type,
      value,
      meaningfulObjects: {},
    },
  }
}

function commandEvent(seq: number) {
  return {
    sessionId: 'ags-browser-proof',
    seq,
    ts: 1_000 + seq,
    type: 'command.completed',
    payload: { commandId: followUpCommandId, state: 'completed' },
  }
}

function transcript() {
  const inputId = `command:${followUpCommandId}:input`
  const order = followUpCommitted
    ? ['assistant-1', inputId, 'assistant-2']
    : ['assistant-1']
  const items: Record<string, unknown> = {
    'assistant-1': { role: 'assistant', text: 'Hello from Sophia.' },
  }
  if (followUpCommitted) {
    items[inputId] = { role: 'user', text: 'And now?' }
    items['assistant-2'] = { role: 'assistant', text: 'Still here.' }
  }
  const events = followUpCommitted
    ? [commandEvent(6)]
    : followUpWorkerSent
      ? [semanticEvent(5, 'message.completed', { output: 'Still here.' })]
      : [semanticEvent(2, 'message.completed', { output: 'Hello from Sophia.' })]
  return {
    session: {
      sessionId: 'ags-browser-proof',
      runId: 'run-browser-proof',
      graphId: 'sophia-cluster',
      status: initialStreamSent ? 'restartable' : 'running',
    },
    document: { transcript: { order, items } },
    events,
  }
}

function sseBody(events: readonly Record<string, unknown>[]): string {
  return events.map(item => {
    const seq = String(item.seq)
    const type = String(item.type)
    return `event: ${type}\nid: ${seq}\ndata: ${JSON.stringify(item)}\n\n`
  }).join('')
}

function recordValue(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : 0
if (!port) throw new Error('could not resolve Vite port')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const pageErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.message))

try {
  await page.route('https://api.canary.sophia-labs.com/**', async route => {
    const request = route.request()
    const headers = request.headers()
    let body: unknown
    try { body = request.postDataJSON() } catch { body = request.postData() ?? undefined }
    calls.push({ method: request.method(), url: request.url(), body, headers })
    const cors = {
      'access-control-allow-origin': `http://127.0.0.1:${port}`,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,prefer',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = new URL(request.url())
    const json = async (value: unknown, status = 200) => route.fulfill({
      status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    })
    if (url.pathname.endsWith('/workflows')) return json({ workflows: [workflow] })
    if (url.pathname.endsWith('/invocations')) {
      const invocation = recordValue(body)
      return json({ runId: 'run-browser-proof', invocationId: invocation.invocationId }, 202)
    }
    if (url.pathname.endsWith('/workflows/runs/run-browser-proof/agents')) {
      return json({ agents: [{ sessionId: 'ags-browser-proof', label: 'pilot-headed' }] })
    }
    if (url.pathname.endsWith('/agent-sessions/ags-browser-proof/driver')) return json({ applied: true })
    if (url.pathname.endsWith('/agent-sessions/ags-browser-proof/commands') && request.method() === 'POST') {
      const command = recordValue(body)
      followUpCommandId = String(command.commandId)
      return json({ command: { command_id: followUpCommandId, state: 'delivered' } }, 202)
    }
    if (url.pathname.endsWith('/agent-sessions/ags-browser-proof/commands')) {
      return json({
        commands: followUpCommandId
          ? [{ command_id: followUpCommandId, state: followUpCommitted ? 'completed' : 'delivered' }]
          : [],
      })
    }
    if (url.pathname.endsWith('/agent-sessions/ags-browser-proof/events')) {
      if (!headers.accept?.includes('text/event-stream')) return json({ events: [] })
      let events: Record<string, unknown>[]
      if (!initialStreamSent) {
        initialStreamSent = true
        events = [
          semanticEvent(1, 'message.delta', { delta: 'Hello from Sophia.' }),
          semanticEvent(2, 'message.completed', { output: 'Hello from Sophia.' }),
        ]
      } else if (!followUpWorkerSent) {
        followUpWorkerSent = true
        events = [
          semanticEvent(3, 'input.follow_up', { text: 'And now?' }),
          semanticEvent(4, 'message.delta', { delta: 'Still here.' }),
          semanticEvent(5, 'message.completed', { output: 'Still here.' }),
        ]
      } else {
        followUpCommitted = true
        events = [commandEvent(6)]
      }
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: sseBody(events),
      })
      return
    }
    if (url.pathname.endsWith('/agent-sessions/ags-browser-proof')) return json(transcript())
    return json({ error: `unhandled ${request.method()} ${url.pathname}` }, 404)
  })

  const harnessUrl = `http://127.0.0.1:${port}/cloud2-chat-browser-harness.html`
  const runStage = async (stage: string) => {
    await page.goto(`${harnessUrl}?stage=${stage}`)
    await page.waitForFunction(() => (window as unknown as {
      __cloud2ChatHarness?: { ready?: boolean }
    }).__cloud2ChatHarness?.ready === true)
    return page.evaluate(() => (window as unknown as {
      __cloud2ChatHarness?: Record<string, unknown>
    }).__cloud2ChatHarness)
  }

  const first = await runStage('first')
  assert(!first?.error, String(first?.error))
  assert(String(first?.sessionId).startsWith('c2chat-'), 'first stage did not retain a virtual c2chat id')

  const pending = await runStage('pending')
  assert(!pending?.error, String(pending?.error))
  assert(pending?.sessionId === first?.sessionId, 'first reload did not reuse the virtual chat descriptor')
  assert(JSON.stringify(pending?.during) === JSON.stringify([
    ['user', 'Hello Sophia'], ['assistant', 'Hello from Sophia.'], ['user', 'And now?'],
  ]), `pending user bubble was not projected after worker completion: ${JSON.stringify(pending?.during)}`)

  const resumed = await runStage('resume')
  assert(!resumed?.error, String(resumed?.error))
  assert(resumed?.sessionId === first?.sessionId, 'second reload did not reuse the virtual chat descriptor')
  assert(JSON.stringify(resumed?.pending) === JSON.stringify([
    ['user', 'Hello Sophia'], ['assistant', 'Hello from Sophia.'], ['user', 'And now?'],
  ]), `reload lost the pending user bubble: ${JSON.stringify(resumed?.pending)}`)
  assert(JSON.stringify(resumed?.after) === JSON.stringify([
    ['user', 'Hello Sophia'], ['assistant', 'Hello from Sophia.'],
    ['user', 'And now?'], ['assistant', 'Still here.'],
  ]), `unexpected canonical transcript after completion: ${JSON.stringify(resumed?.after)}`)
  const finalRows = resumed?.after as unknown[]
  assert(finalRows.filter(row => JSON.stringify(row) === JSON.stringify(['user', 'And now?'])).length === 1,
    'pending and canonical follow-up user bubbles were duplicated')

  for (const stage of [first, pending, resumed]) {
    assert(stage?.sessionCount === 1, `reload minted another local descriptor: ${JSON.stringify(stage)}`)
    assert(stage?.slotSessionId === first?.sessionId, 'active slot drifted across reload')
    assert(JSON.stringify(stage?.binding) === JSON.stringify(first?.binding),
      `run/Agent Session binding drifted across reload: ${JSON.stringify(stage?.binding)}`)
    // The retired single "Sophia-1 · profile-managed" entry is gone, and nothing takes its place: a host
    // whose registry advertises no voice (this one lists only the Domain Agent) offers no picker at all.
    assert(JSON.stringify(stage?.models) === JSON.stringify([]),
      `a host that advertises no voice must offer no picker: ${JSON.stringify(stage?.models)}`)
  }
  assert(JSON.stringify(first?.binding) === JSON.stringify({
    virtualId: first?.sessionId,
    runId: 'run-browser-proof',
    agentSessionId: 'ags-browser-proof',
  }), `unexpected persisted Cloud-2 binding: ${JSON.stringify(first?.binding)}`)

  const applicationCalls = calls.filter(call => call.method !== 'OPTIONS')
  const invocation = applicationCalls.filter(call => new URL(call.url).pathname.endsWith('/invocations'))
  const runAgents = applicationCalls.filter(call => new URL(call.url).pathname.endsWith('/workflows/runs/run-browser-proof/agents'))
  const commands = applicationCalls.filter(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/commands'))
  assert(invocation.length === 1, `expected one first invocation, saw ${invocation.length}`)
  assert(runAgents.length === 1, `expected one run-to-Agent-Session resolution, saw ${runAgents.length}`)
  assert(invocation[0]?.headers.prefer === 'respond-async', 'browser omitted Prefer: respond-async')
  const invocationBody = recordValue(invocation[0]?.body)
  const invocationInput = recordValue(invocationBody.input)
  assert(!Object.hasOwn(invocationInput, 'inference'), 'profile-bound invocation included legacy input.inference')
  assert(invocationBody.actorRef === 'user:browser-proof-user', 'invocation actor authority was not canonical')
  assert(recordValue(invocationBody.graph).graphId === 'sophia-cluster', 'invocation escaped its graph authority')
  assert(commands.length === 1, `expected one idempotent follow-up command POST, saw ${commands.length}`)
  assert(applicationCalls.every(call => new URL(call.url).pathname.startsWith(`${ownerGraphPath}/`)),
    'a browser request escaped the owner-scoped gateway graph route')
  assert(applicationCalls.every(call => !new URL(call.url).pathname.includes('/api/sessions')), 'legacy session request escaped')
  assert(applicationCalls.every(call => new URL(call.url).origin === 'https://api.canary.sophia-labs.com'), 'direct Choreograph request escaped')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    proof: 'intercepted-production-shaped',
    browser: 'chromium',
    authority: `https://api.canary.sophia-labs.com${ownerGraphPath}`,
    sessionId: first?.sessionId,
    runId: 'run-browser-proof',
    agentSessionId: 'ags-browser-proof',
    localDescriptors: first?.sessionCount,
    invocationPosts: invocation.length,
    runAgentResolutions: runAgents.length,
    followUpCommands: commands.length,
    preflights: calls.filter(call => call.method === 'OPTIONS').length,
    workerCompletedBeforeCommand: true,
    pendingBubbleSurvivedReload: true,
    canonicalBubbleDuplicates: 0,
    origins: [...new Set(applicationCalls.map(call => new URL(call.url).origin))],
    legacySessionRequests: applicationCalls.filter(call => new URL(call.url).pathname.includes('/api/sessions')).length,
    directChoreographRequests: applicationCalls.filter(call => new URL(call.url).origin.includes('choreograph')).length,
  }, null, 2)}\n`)
} finally {
  await browser.close()
  await server.close()
}
