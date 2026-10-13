/**
 * The empowered workspace chat in real browsers (Chromium and WebKit, 1440 and 390 px), with no sign-in
 * and nothing of production in the loop.
 *
 * WHAT RUNS. The REAL `<sh-chat-host>` over the REAL hosted chat service, with the shell's `workspace`
 * grant (change links; the live HTML preview port main.ts builds, over the real `ArtifactLivePreview`),
 * against a scripted Choreograph on a real socket (`ChoreographSim`, the suites' server) that answers as
 * Choreograph cad0507 does (RETURN.md §4): the empowered registry digest, a Writer session
 * (`document.source.graphAccess: write`), and durable tool events that carry an id-only receipt.
 *
 * WHAT IS WITNESSED (design §10; Vera's rulings of 10-05/10-06):
 *  1. the panel says what the chat may do here: an editor's chat reads and changes the workspace;
 *  2. "Changed in this turn" under the reply: each document links to its History (standing before the
 *     turn), the artifact to its revisions, no undo button; the deleted document shown apart, gone with
 *     its history and nothing to open; the wire deletion an ordinary row by its id;
 *  3. the written HTML artifact previewed live in the chat: an <mn-artifact-view> frame with scripts off,
 *     re-rendered when the agent rewrites it;
 *  4. what is open travels with every turn: `input.contextRefs` on the first, `payload.contextRefs` on a
 *     follow-up;
 *  5. the strip survives a reload and the next turn (the chips no longer vanish).
 *
 *   SHOTS_DIR=<dir> node --import tsx scripts/chat-writes-browser-harness.mts
 *
 * Exits non-zero if any check fails; writes `evidence.json` beside the screenshots.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type BrowserType, type Page } from 'playwright'
import { createServer } from 'vite'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  delta,
  durableToolCompleted,
  durableToolStarted,
  started,
  turnDone,
  workspaceWorkflow,
} from '../../../packages/runtime/src/chat-services/__tests__/fixtures/choreograph-sim.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = resolve(process.env.SHOTS_DIR ?? resolve(appDir, '.chat-writes-shots'))
mkdirSync(shotsDir, { recursive: true })

const USER = 'harness-user'
const GRAPH = 'writes-qa-20261006'
/** `workspace-chat-v1` as Choreograph cad0507 serves it (RETURN.md, top). */
const EMPOWERED_DIGEST = '5a9e54bc641a8754db4aeb822454670e6aec9865564763f71b4b68d68fb540c4'
const ASK_ONE = 'Tighten the plan, make a status board, and clear out the old notes.'
const REPLY_ONE = 'Done. I edited the plan, made a status board, removed the old wire, and deleted "Old notes". Its history was deleted with it, and it cannot be brought back from History.'
const ASK_TWO = 'Thanks. Anything else open?'
const REPLY_TWO = 'Only the plan.'

interface Check { readonly name: string; readonly ok: boolean; readonly detail?: unknown }
interface RunReport {
  readonly engine: string
  readonly viewport: string
  readonly checks: Check[]
  readonly shots: string[]
  readonly pageErrors: string[]
  readonly consoleErrors: string[]
}
const reports: RunReport[] = []

const viewports = [
  { label: '1440', width: 1440, height: 900, phone: false },
  { label: '390', width: 390, height: 844, phone: true },
] as const

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const vitePort = typeof address === 'object' && address ? address.port : 0
if (!vitePort) throw new Error('could not resolve the Vite port')
const pageUrl = `http://127.0.0.1:${vitePort}/chat-writes-browser-harness.html`

function board(version: number) {
  const text = `<!doctype html><html><body><h1>Status board v${version}</h1><script>document.body.dataset.ran = 'yes'</script></body></html>`
  return {
    graphId: GRAPH,
    graphIncarnation: 'inc-harness',
    artifactId: 'board',
    filename: 'status-board.html',
    mimeType: 'text/html',
    text,
    sizeBytes: text.length,
    contentHashSha256: String(version).repeat(64).slice(0, 64),
  }
}

function scriptHost(): { sim: ChoreographSim; artifact: { version: number } } {
  const sim = new ChoreographSim()
  sim.clock = Date.now() - 90_000
  sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ definitionDigest: EMPOWERED_DIGEST })]
  sim.sessionGraphAccess = 'write'
  const artifact = { version: 1 }
  sim.extraRoutes.push(request => {
    if (request.graph === GRAPH && request.method === 'GET' && request.route === `/artifacts/${GRAPH}/board/text`) {
      return { status: 200, body: board(artifact.version) }
    }
    return undefined
  })
  const call = (tool: string, targets: Record<string, unknown>[]) => [durableToolStarted(tool, targets), durableToolCompleted(tool, targets)]
  sim.queueTurn({
    answer: REPLY_ONE,
    stages: [[
      started(),
      ...call('read_document', [{ kind: 'document', id: 'plan' }]),
      ...call('write_document', [{ kind: 'document', id: 'plan' }]),
      ...call('create_artifact_text', [{ kind: 'artifact', id: 'board', mediaType: 'text/html', title: 'status-board.html' }]),
      ...call('delete', [{ kind: 'wire', id: 'w-old-link' }]),
      ...call('delete_document', [{ kind: 'document', id: 'old-notes', title: 'Old notes' }]),
      delta(REPLY_ONE),
      turnDone(),
      completed(REPLY_ONE),
    ]],
  })
  sim.queueTurn({ answer: REPLY_TWO, stages: [[started(), delta(REPLY_TWO), turnDone(), completed(REPLY_TWO)]] })
  return { sim, artifact }
}

async function typeAndSend(page: Page, text: string): Promise<void> {
  const editor = page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type(text, { delay: 2 })
  await page.keyboard.press('Enter')
}

async function waitForAssistantMessages(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    expected => document.querySelector('sh-chat-host')?.shadowRoot
      ?.querySelectorAll('sh-chat-panel .message.assistant:not(.window) .message-content').length === expected
      && !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel .status-streaming'),
    count,
    { timeout: 30_000 },
  )
}

/** The rows of a reply's strip: id, subject, removal, classes, buttons, words. */
async function stripRows(page: Page, replyIndex: number) {
  return page.evaluate(index => {
    const panel = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel')
    const replies = Array.from(panel?.querySelectorAll('article.message.assistant') ?? [])
    const reply = replies[index]
    return Array.from(reply?.querySelectorAll('.turn-change') ?? []).map(row => ({
      id: (row as HTMLElement).dataset.changeId ?? null,
      subject: (row as HTMLElement).dataset.changeSubject ?? null,
      removal: (row as HTMLElement).dataset.removal ?? null,
      removed: row.classList.contains('removed'),
      buttons: Array.from(row.querySelectorAll('button')).map(button => button.textContent?.trim() ?? ''),
      text: (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
  }, replyIndex)
}

/** What the live preview's frame holds: its sandbox and its document. */
async function previewFrame(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel sh-chat-artifact-preview')
    const view = host?.shadowRoot?.querySelector('mn-artifact-view') as (HTMLElement & { allowHtmlScripts?: boolean }) | null
    const frame = view?.shadowRoot?.querySelector('iframe.html-preview') as HTMLIFrameElement | null
    return {
      present: Boolean(host),
      allowHtmlScripts: view?.allowHtmlScripts ?? null,
      sandbox: frame?.getAttribute('sandbox') ?? null,
      srcdoc: frame?.srcdoc ?? '',
      width: (host as HTMLElement | undefined)?.getBoundingClientRect().width ?? 0,
    }
  })
}

async function run(browserType: BrowserType, engine: string, viewport: (typeof viewports)[number]): Promise<void> {
  const { sim, artifact } = scriptHost()
  await sim.start()
  const browser = await browserType.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.phone ? 2 : 1,
    ...(viewport.phone && engine === 'chromium' ? { isMobile: true, hasTouch: true } : {}),
  })
  const page = await context.newPage()
  const report: RunReport = { engine, viewport: viewport.label, checks: [], shots: [], pageErrors: [], consoleErrors: [] }
  reports.push(report)
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
    if (!ok) process.stderr.write(`  FAIL [${engine} ${viewport.label}] ${name} ${detail === undefined ? '' : JSON.stringify(detail)}\n`)
  }
  const shot = async (name: string): Promise<void> => {
    const file = `${engine}-${viewport.label}-${name}.png`
    await page.screenshot({ path: resolve(shotsDir, file) })
    report.shots.push(file)
  }
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  const boot = async () => {
    await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
    await page.waitForFunction(() => (window as unknown as { __chatWrites?: { ready?: boolean } }).__chatWrites?.ready === true, undefined, { timeout: 60_000 })
    const state = await page.evaluate(() => (window as unknown as { __chatWrites: { error?: string } }).__chatWrites)
    check('the page mounted the real host', !state.error, state)
    await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
  }

  try {
    await boot()
    // 1. What the chat may do here.
    await page.waitForSelector('sh-chat-panel .chat-access', { timeout: 15_000 })
    const access = await page.locator('sh-chat-panel .chat-access').first()
    check('an editor\'s chat says it can read and change the workspace',
      (await access.getAttribute('data-access')) === 'write'
        && (await access.innerText()).includes('Sophia can read and change this workspace, as you.'),
      await access.innerText())

    await typeAndSend(page, ASK_ONE)
    await waitForAssistantMessages(page, 1)
    await page.waitForSelector('sh-chat-panel .turn-changes', { timeout: 15_000 })

    // 2. Changed in this turn.
    const rows = await stripRows(page, 0)
    const byId = Object.fromEntries(rows.map(row => [row.id, row]))
    check('the strip names the four things the turn changed, and not the read', rows.length === 4
      && ['plan', 'board', 'w-old-link', 'old-notes'].every(id => id in byId), rows)
    check('the edited document is named, opens, and links to its History',
      byId.plan?.text.includes('Q4 plan') && byId.plan?.text.includes('edited')
        && JSON.stringify(byId.plan?.buttons) === JSON.stringify(['Q4 plan', 'History']), byId.plan)
    check('the artifact links to its revisions', JSON.stringify(byId.board?.buttons) === JSON.stringify(['status-board.html', 'Revisions']), byId.board)
    check('the deleted document is shown apart, gone with its history, nothing to open',
      byId['old-notes']?.removed === true && byId['old-notes']?.removal === 'document'
        && byId['old-notes']?.buttons.length === 0
        && byId['old-notes']?.text.includes('Deleted with its history: it cannot be brought back from History.'), byId['old-notes'])
    check('the wire deletion is an ordinary row, by its id, nothing to open',
      byId['w-old-link']?.removed === false && byId['w-old-link']?.text.includes('w-old-link')
        && byId['w-old-link']?.text.includes('deleted') && byId['w-old-link']?.buttons.length === 0, byId['w-old-link'])
    check('there is no undo button anywhere', !(await page.locator('sh-chat-panel button', { hasText: /^\s*Undo\s*$/ }).count()))

    // 3. The live HTML preview.
    await page.waitForFunction(() => {
      const host = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel sh-chat-artifact-preview')
      const frame = host?.shadowRoot?.querySelector('mn-artifact-view')?.shadowRoot?.querySelector('iframe.html-preview') as HTMLIFrameElement | null
      return Boolean(frame?.srcdoc.includes('Status board v1'))
    }, undefined, { timeout: 15_000 })
    const first = await previewFrame(page)
    check('the written HTML artifact is framed in the chat under the reply', first.present && first.srcdoc.includes('Status board v1'), first)
    // The frame is opaque to the page (no allow-same-origin), so it is checked by what it was given, not by
    // looking inside: the sandbox and the policy the shell's own preview writes into the document.
    check('its scripts are off: no allow-scripts or allow-same-origin in the sandbox, script-src none in its policy',
      first.allowHtmlScripts === false && first.sandbox !== null && !first.sandbox.includes('allow-scripts')
        && !first.sandbox.includes('allow-same-origin') && first.srcdoc.includes("script-src 'none'"), { sandbox: first.sandbox })
    check('the preview fits the rail (no horizontal overflow)', first.width > 0 && first.width <= Math.min(440, viewport.width), first.width)
    await page.locator('sh-chat-panel .turn-artifact-preview').first().scrollIntoViewIfNeeded()
    await shot('changed-in-this-turn')

    artifact.version = 2
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('harness-artifact-changed', { detail: 'board' })))
    await page.waitForFunction(() => {
      const host = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel sh-chat-artifact-preview')
      const frame = host?.shadowRoot?.querySelector('mn-artifact-view')?.shadowRoot?.querySelector('iframe.html-preview') as HTMLIFrameElement | null
      return Boolean(frame?.srcdoc.includes('Status board v2'))
    }, undefined, { timeout: 15_000 }).then(() => check('the agent rewrites it and the open preview updates, live', true),
      () => check('the agent rewrites it and the open preview updates, live', false))

    // The way back: History before the turn; the artifact's revisions.
    await page.locator('sh-chat-panel .turn-change[data-change-id="plan"] .turn-change-history').click()
    await page.locator('sh-chat-panel .turn-change[data-change-id="board"] .turn-change-history').click()
    const intents = await page.evaluate(() => (window as unknown as { __chatWrites: { intents: unknown[] } }).__chatWrites.intents)
    const history = intents[0] as { type?: string; documentId?: string; before?: number } | undefined
    check('History opens the edited document, standing before the turn',
      history?.type === 'open-history' && history.documentId === 'plan' && typeof history.before === 'number', intents)
    check('Revisions opens the artifact\'s revisions',
      JSON.stringify(intents[1]) === JSON.stringify({ type: 'open-artifact', artifactId: 'board', revisions: true }), intents)

    // 4. What is open, on the first turn.
    const launch = sim.invocations().find(call => call.body?.target?.workflowName === 'workspace-chat-v1')
    check('the first message carries what is open (input.contextRefs)',
      JSON.stringify(launch?.body?.input?.contextRefs) === JSON.stringify(['plan', 'plan#b7']), launch?.body?.input?.contextRefs)

    // 5. A reload: the strip is rebuilt from the durable record.
    await boot()
    await waitForAssistantMessages(page, 1)
    await page.waitForSelector('sh-chat-panel .turn-changes', { timeout: 15_000 })
    const reloaded = await stripRows(page, 0)
    check('after a reload the strip is the same', JSON.stringify(reloaded.map(row => [row.id, row.removal, row.buttons]))
      === JSON.stringify(rows.map(row => [row.id, row.removal, row.buttons])), reloaded)
    const chips = await page.evaluate(() => document.querySelector('sh-chat-host')?.shadowRoot
      ?.querySelectorAll('sh-chat-panel article.message.assistant .tool-call').length ?? 0)
    check('after a reload the reply\'s tool chips are back (five calls)', chips === 5, chips)

    // A follow-up: what is open travels with it, and the first reply keeps its strip.
    await typeAndSend(page, ASK_TWO)
    await waitForAssistantMessages(page, 2)
    const followUp = sim.calls('/commands', 'POST').find(call => call.body?.name === 'follow_up')
    check('a follow-up carries what is open (payload.contextRefs)',
      JSON.stringify(followUp?.body?.payload) === JSON.stringify({ text: ASK_TWO, contextRefs: ['plan', 'plan#b7'] }), followUp?.body?.payload)
    const afterNext = await stripRows(page, 0)
    check('the first reply keeps its strip through the next turn', afterNext.length === 4, afterNext)
    check('a reply that changed nothing has no strip', (await stripRows(page, 1)).length === 0)
    await shot('after-follow-up')

    check('no page errors', report.pageErrors.length === 0, report.pageErrors)
  } catch (error) {
    check('the run completed', false, error instanceof Error ? error.message : String(error))
    await shot('failure').catch(() => undefined)
  } finally {
    await browser.close()
    await sim.stop()
  }
}

try {
  for (const viewport of viewports) {
    await run(chromium, 'chromium', viewport)
    await run(webkit, 'webkit', viewport)
  }
} finally {
  await server.close()
}

const failed = reports.flatMap(report => report.checks.filter(item => !item.ok).map(item => `${report.engine} ${report.viewport}: ${item.name}`))
writeFileSync(resolve(shotsDir, 'evidence.json'), `${JSON.stringify({ when: new Date().toISOString(), reports }, null, 2)}\n`)
const total = reports.reduce((sum, report) => sum + report.checks.length, 0)
process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, checks: total, failed, shots: shotsDir }, null, 2)}\n`)
if (failed.length > 0) process.exit(1)
