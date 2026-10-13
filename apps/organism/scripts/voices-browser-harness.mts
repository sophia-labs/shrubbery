/**
 * The Voices release in real browsers (Chromium and WebKit, 1440 and 390 px), with no sign-in and
 * nothing of production in the loop.
 *
 * WHAT RUNS. The REAL `<sh-chat-host>` (the element the workspace mounts in its chat rail), over the
 * REAL hosted chat service, in a real browser, against a scripted host served from a real socket
 * (`ChoreographSim`, the same server the suites use). Two hosts are scripted, because the release
 * has to be safe against both:
 *
 *   legacy   Today's live host. Its registry is the one read from production on 2026-09-30
 *            (`workspace-chat-v1` lists trigger, contextRefs and interactionMode and nothing else), and the
 *            catalogue route answers with the gateway's old projection. Expected: no picker, no Continue,
 *            nothing new on the wire, and chat exactly as it is today (plus the voice on each reply).
 *   voices   The new contracts (`C-choreograph-return.md`): a registry that advertises `inference` and
 *            `seed`, and `GET /chat/models?view=chat` answering `choreograph.chat-models.v1`. Expected: a
 *            big searchable, grouped list with House pinned and every voice priced, the choice carried to
 *            the launch as `inference`, the chip locked after the first message, every reply marked with the
 *            voice that spoke, and STILL no Continue anywhere (its entry point ships later).
 *
 *   reload   Today's host again, but with the three ways the follow-up path failed in production (step zero,
 *            D2 to D4): a follow-up reply that arrives in two pieces across reads, a durable transcript that
 *            holds the reply twice (a `command-result` and a repeating `node-result`), and a host clock three
 *            hours off the browser's. The page is reloaded after two turns. Expected: each live reply whole,
 *            each reply once after the reload, and every message dated by the host's record of it, not by the
 *            moment the page was read.
 *
 * WHERE THE DATA IS REAL. The legacy registry and the old catalogue rows are production's (fixtures/
 * live-20260929.ts). The new catalogue (`fixtures/chat-models-v1-20260930.json`, 294 voices) is
 * OpenRouter's own public catalogue of 2026-09-30 (464 models), filtered by the rule the Choreograph
 * return documents (tools, priced, 32k+ context, text in and out, no batch routes or free models) and
 * priced as the person pays (price x 1.2, rounded up to a micro-dollar). The return's count on
 * 2026-09-29 is 288: this list also keeps the six models whose overrides that rule refuses for a price
 * dimension it does not read. The replies are the two the live host gave the probe in step zero.
 *
 *   SHOTS_DIR=<dir> node --import tsx scripts/voices-browser-harness.mts
 *
 * Exits non-zero if any check fails; writes `evidence.json` beside the screenshots.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type BrowserType, type Page } from 'playwright'
import { createServer } from 'vite'
import {
  type Answer,
  ChoreographSim,
  DOMAIN_WORKFLOW,
  type Received,
  completed,
  costedTurn,
  delta,
  reserved,
  settled,
  started,
  turnDone,
  workspaceWorkflow,
} from '../../../packages/runtime/src/chat-services/__tests__/fixtures/choreograph-sim.js'
import {
  LIVE_CATALOGUE_ROUTE_TODAY,
  LIVE_DOMAIN_AGENT_ENTRY,
  LIVE_WORKSPACE_CHAT_ENTRY,
} from '../../../packages/runtime/src/chat-services/__tests__/fixtures/live-20260929.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = resolve(process.env.SHOTS_DIR ?? resolve(appDir, '.voices-shots'))
mkdirSync(shotsDir, { recursive: true })

const CATALOGUE = JSON.parse(readFileSync(resolve(appDir, 'scripts/fixtures/chat-models-v1-20260930.json'), 'utf8')) as {
  models: Array<{ id: string; name: string; promptPerMillionUsd: number; completionPerMillionUsd: number }>
}
/** How far the reload scenario's host clock is from the browser's: three hours behind. */
const HOST_CLOCK_OFFSET_MS = 3 * 3_600_000
const USER = 'harness-user'
const GRAPH = 'atelier-20260930'
const KIMI = 'moonshotai/kimi-k2.6'
const HOUSE = 'google/gemini-2.5-flash'

// The two replies the live host gave the probe account in step zero (F-step-zero.md).
const REPLY_ONE = 'I can help you read and search your workspace, including its documents, blocks, wires, values, and RDF (SPARQL SELECT).'
const REPLY_TWO = 'Read and search workspace.'
const ASK_ONE = 'What can you help me with in this workspace?'
const ASK_TWO = 'Say that again in five words or fewer.'

interface Check { readonly name: string; readonly ok: boolean; readonly detail?: unknown }
interface RunReport {
  readonly scenario: Scenario
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
const pageUrl = `http://127.0.0.1:${vitePort}/voices-browser-harness.html`

/** What the gateway answers at its own root (not below a graph): the catalogue route and the balance. */
class GatewayRoot {
  readonly catalogueRequests: Received[] = []
  readonly seedRequests: Received[] = []
  constructor(sim: ChoreographSim, private readonly catalogue: unknown, private readonly balanceMicroUsd: number) {
    sim.extraRoutes.push(request => this.answer(request))
  }
  get asked(): { catalogue: number } { return { catalogue: this.catalogueRequests.length } }
  private answer(request: Received): Answer | undefined {
    if (request.graph === null && request.method === 'GET' && request.route === '/chat/models') {
      this.catalogueRequests.push(request)
      return { status: 200, body: this.catalogue }
    }
    if (request.graph === null && request.method === 'GET' && request.route === '/billing/balance') {
      return {
        status: 200,
        body: {
          balanceMicroUsd: this.balanceMicroUsd,
          balance_micro_usd: this.balanceMicroUsd,
          can_make_requests: true,
          floorMicroUsd: -500_000,
          initialized: true,
          userId: USER,
          user_id: USER,
        },
      }
    }
    if (request.graph !== null && request.route === '/chat-seeds') this.seedRequests.push(request)
    return undefined
  }
}

type Scenario = 'legacy' | 'voices' | 'reload'

function scriptHost(scenario: Scenario): { sim: ChoreographSim; routes: GatewayRoot } {
  const sim = new ChoreographSim()
  const todays = scenario !== 'voices'
  const routes = todays
    // What the gateway answers at the catalogue route today: the page must not even ask, and must refuse it if it did.
    // The balance is one at which "Out of credits" would be said, if the page said it: it must not.
    ? new GatewayRoot(sim, LIVE_CATALOGUE_ROUTE_TODAY, 3_800)
    : new GatewayRoot(sim, CATALOGUE, 970_000)
  // The scripted host keeps the same time the browser does (a host and a browser agree about now),
  // except where the scenario is about a host whose clock is not the browser's.
  sim.clock = scenario === 'reload' ? Date.now() - HOST_CLOCK_OFFSET_MS : Date.now() - 90_000
  sim.workflows = todays
    ? [LIVE_DOMAIN_AGENT_ENTRY, LIVE_WORKSPACE_CHAT_ENTRY]
    : [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
  sim.queueTurn(costedTurn(REPLY_ONE, 3_178))
  if (scenario === 'reload') {
    // The follow-up as production gave it in step zero: "Read" first and the rest across a later read (D2), and
    // the run-level result repeating the command's reply in the transcript (D3).
    sim.queueTurn({
      answer: REPLY_TWO,
      echo: true,
      stages: [
        [started(), reserved(), delta('Read')],
        [delta(' and search workspace.'), settled(1_612), turnDone(), completed(REPLY_TWO)],
      ],
    })
  } else {
    sim.queueTurn(costedTurn(REPLY_TWO, 1_612))
  }
  return { sim, routes }
}

async function typeAndSend(page: Page, text: string): Promise<void> {
  const editor = page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type(text, { delay: 4 })
  // Enter sends (untested in production until now: step zero clicked the button).
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

async function run(
  browserType: BrowserType,
  engine: string,
  viewport: (typeof viewports)[number],
  scenario: Scenario,
): Promise<void> {
  const { sim, routes } = scriptHost(scenario)
  await sim.start()
  const browser = await browserType.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.phone ? 2 : 1,
    ...(viewport.phone ? { isMobile: true, hasTouch: true } : {}),
  })
  const page = await context.newPage()
  const report: RunReport = { scenario, engine, viewport: viewport.label, checks: [], shots: [], pageErrors: [], consoleErrors: [] }
  reports.push(report)
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
    if (!ok) process.stderr.write(`  FAIL [${scenario} ${engine} ${viewport.label}] ${name} ${detail === undefined ? '' : JSON.stringify(detail)}\n`)
  }
  const shot = async (name: string): Promise<void> => {
    const file = `${scenario}-${engine}-${viewport.label}-${name}.png`
    await page.screenshot({ path: resolve(shotsDir, file) })
    report.shots.push(file)
  }
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  const text = async (selector: string): Promise<string> =>
    (await page.locator(selector).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  const count = (selector: string): Promise<number> => page.locator(selector).count()

  try {
    await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
    await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
    const boot = await page.evaluate(() => (window as unknown as { __voices: { error?: string } }).__voices)
    check('the page mounted the real host', !boot.error, boot)
    await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })

    const todays = scenario !== 'voices'
    if (todays) {
      // Wait until the page has asked the host what it can do, and then a little longer for the answer to be acted on.
      await page.waitForFunction(() => true)
      const began = Date.now()
      while (sim.calls('/workflows', 'GET').filter(call => call.route === '/workflows').length === 0 && Date.now() - began < 10_000) {
        await page.waitForTimeout(100)
      }
      await page.waitForTimeout(1_500)
      check('the registry was read', sim.calls('/workflows', 'GET').some(call => call.route === '/workflows'))
      check('no voice picker against today’s registry', (await count('sh-chat-panel .model-selector-trigger')) === 0)
      check('the catalogue was not even asked for', routes.asked.catalogue === 0, routes.asked.catalogue)
    } else {
      await page.waitForSelector('sh-chat-panel .model-selector-trigger', { timeout: 30_000 })
      check('the picker appears once the registry advertises `inference` and the catalogue answers', true)
      check('the chip names the House default before anything is chosen', (await text('.model-selector-trigger .model-name')) === 'Gemini 2.5 Flash', await text('.model-selector-trigger .model-name'))

      await page.locator('sh-chat-panel .model-selector-trigger').click()
      await page.waitForSelector('sh-chat-panel .model-picker .model-picker-search-input', { timeout: 10_000 })
      const pinned = await text('.model-picker-pinned')
      check('House is pinned, named as the House default, and priced', /House default/.test(pinned) && /Gemini 2\.5 Flash/.test(pinned) && /\$0\.36 in · \$3\.00 out/.test(pinned), pinned)
      check('the House note says who runs it', /House default · via OpenRouter/.test(pinned), pinned)
      const foot = await text('.model-picker-foot')
      check('the footnote says the prices are what the person pays, fee included', /US dollars per million tokens, with the 20% service fee included/.test(foot), foot)
      check('the picker is a searchable catalogue of the whole list', /Search 29\d voices/.test((await page.locator('.model-picker-search-input').getAttribute('placeholder')) ?? ''), await page.locator('.model-picker-search-input').getAttribute('placeholder'))
      await shot('01-picker')

      await page.locator('.model-picker-search-input').fill('kimi')
      await page.waitForSelector('sh-chat-panel .model-picker-result-group', { timeout: 10_000 })
      const groups = await page.locator('.model-picker-result-group').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
      check('search groups the matches by maker', groups.length > 0 && groups.every(group => group === 'Moonshot'), groups)
      const row = await text(`button[data-model-id="${KIMI}"]`)
      check('every voice carries its price, its context and its multiple of House', /\$0\.78 in · \$4\.09 out/.test(row) && /ctx/.test(row) && /× House/.test(row), row)
      await shot('02-picker-search-kimi')

      // A premium voice is asked about once, in words, before it is chosen; declining leaves the choice as it was.
      const PREMIUM = 'openai/gpt-5.4-pro'
      await page.locator('.model-picker-search-input').fill('gpt-5.4 pro')
      await page.waitForSelector(`button[data-model-id="${PREMIUM}"]`, { timeout: 10_000 })
      await page.locator(`button[data-model-id="${PREMIUM}"]`).click()
      await page.waitForSelector('sh-chat-panel [data-voice-confirm]', { timeout: 10_000 })
      const question = await text('[data-voice-confirm]')
      check('a premium voice is asked about once, with what a short reply costs and how many times House', /A short reply costs about \$0\.15, roughly 8\d× House/.test(question), question)
      await shot('02b-premium-question')
      await page.locator('[data-voice-confirm-cancel]').click()
      await page.waitForFunction(() => !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-voice-confirm]'))
      check('declining leaves the choice as it was (House)', (await text('.model-selector-trigger .model-name')) === 'Gemini 2.5 Flash', await text('.model-selector-trigger .model-name'))
      const focusedRow = await page.evaluate(() => (document.querySelector('sh-chat-host')?.shadowRoot?.activeElement as HTMLElement | null)?.dataset?.modelId ?? null)
      check('declining gives focus back to the row that asked', focusedRow === PREMIUM, focusedRow)
      await page.locator('.model-picker-search-input').fill('kimi')
      await page.waitForSelector(`button[data-model-id="${KIMI}"]`, { timeout: 10_000 })
      await page.locator(`button[data-model-id="${KIMI}"]`).click()
      await page.waitForFunction(() => document.querySelector('sh-chat-host')?.shadowRoot
        ?.querySelector('.model-selector-trigger .model-name')?.textContent?.trim() === 'Kimi K2.6')
      check('the chip names the voice chosen', true)
    }

    const beforeFirst = (await count('sh-chat-panel .message.assistant'))
    check('no assistant message before anything is said', beforeFirst === 0, beforeFirst)
    await typeAndSend(page, ASK_ONE)
    await waitForAssistantMessages(page, 1)
    if (scenario === 'voices') {
      const locked = await page.locator('sh-chat-panel .model-selector-trigger').isDisabled()
      check('the chip locks after the first message', locked)
      check('the chip still names the voice that speaks', (await text('.model-selector-trigger .model-name')) === 'Kimi K2.6')
    }
    await typeAndSend(page, ASK_TWO)
    await waitForAssistantMessages(page, 2)
    await page.waitForTimeout(400)

    // ── what every reply says of itself ──
    const marks = await page.locator('sh-chat-panel .message.assistant .message-voice').allInnerTexts()
    const expectedMark = scenario === 'voices' ? 'voice: Kimi K2.6' : 'voice: gemini-2.5-flash'
    check('every live reply shows its model', marks.length === 2 && marks.every(mark => mark.trim() === expectedMark), marks)
    const chips = await page.locator('sh-chat-panel .message.assistant .message-annotation').allInnerTexts()
    check('every live reply shows what it cost', chips.length === 2 && chips.every(chip => /^\$0\.00\d\d$/.test(chip.trim())), chips)
    const replies = await page.locator('sh-chat-panel .message.assistant .message-content').allInnerTexts()
    check('the replies are whole, once each, in order', replies.length === 2 && replies[0].trim() === REPLY_ONE && replies[1].trim() === REPLY_TWO, replies)
    const said = await page.locator('sh-chat-panel .message.user .message-content').allInnerTexts()
    check('what was sent is what was typed, each message alone (the composer was emptied)', said.length === 2 && said[0].trim() === ASK_ONE && said[1].trim() === ASK_TWO, said)
    const composer = await page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first().innerText()
    check('the composer is empty after sending', composer.trim() === '', composer)
    const times = await page.locator('sh-chat-panel .message .message-time').allInnerTexts()
    check('every message is dated', times.length === 4 && times.every(time => /\d/.test(time)), times)

    // ── no dead UI, no ghosts ──
    const panelText = await text('sh-chat-panel')
    check('no Continue anywhere (its entry point ships later)', !/continue/i.test(panelText) && (await count('sh-continue-chooser')) === 0 && (await count('[data-continue-chooser], [data-continue-confirm], .window-open-original')) === 0, panelText.match(/.{0,30}continue.{0,30}/i)?.[0])
    check('no "Add credits" button, and nothing said of being out of credits, while nothing can sell credits', !/add credits|out of credits/i.test(panelText) && (await count('[data-account-action], .account-note-action')) === 0, panelText.match(/.{0,30}credits.{0,30}/i)?.[0])
    check('the retired "Sophia-1 · profile-managed" entry is gone', !/profile-managed/i.test(panelText) && !/Sophia-1/.test(await text('.header')), await text('.header'))
    // Vera's ruling for the voices release (cf3cea5): each reply shows its cost, the chat shows no balance line. The
    // balance here allows requests (`can_make_requests: true`), so nothing may be said of it; a refusal still shows,
    // which the host's own suite holds (sh-chat-host-billing.test.ts, chat-billing.test.ts).
    const balance = await text('[data-account-note]')
    check('no balance line (each reply shows its cost instead)', balance === '' && (await count('[data-account-note]')) === 0, balance)

    // ── what crossed the wire ──
    const launches = sim.invocations().filter(call => call.body?.target?.workflowName === 'workspace-chat-v1')
    check('exactly one launch reached the workspace assistant', launches.length === 1, launches.length)
    const input = launches[0]?.body?.input ?? {}
    if (todays) {
      check('the launch carries exactly what the live host takes', JSON.stringify(Object.keys(input).sort()) === JSON.stringify(['contextRefs', 'interactionMode', 'trigger']), Object.keys(input))
      check('the launch names the live digest', launches[0]?.body?.target?.definitionDigest === LIVE_WORKSPACE_CHAT_ENTRY.definitionDigest)
      check('no seed was stored, no catalogue was read', routes.seedRequests.length === 0 && routes.asked.catalogue === 0)
    } else {
      check('the choice reaches the launch as `inference`', JSON.stringify(input.inference) === JSON.stringify({ provider: 'openrouter', model: KIMI }), input.inference)
      check('the launch carries no seed (nothing picks up an earlier conversation)', input.seed === undefined && routes.seedRequests.length === 0)
      check('the catalogue was read once, at the gateway root', routes.catalogueRequests.length === 1 && routes.catalogueRequests[0].graph === null, routes.catalogueRequests.length)
      check('the bearer went with it (a real browser sends what it is given)', routes.catalogueRequests[0]?.headers.authorization === 'Bearer harness-token', routes.catalogueRequests[0]?.headers.authorization ? 'present' : 'absent')
    }
    if (scenario !== 'reload') await shot(scenario === 'voices' ? '03-chat-voice-marks' : '01-chat')
    if (scenario === 'reload') {
      // D2: the live bubble was whole ("Read" first and the rest later), above. D3 and D4 are about what a reload reads back.
      const session = sim.session()
      const finished = session.events.filter(event => event.type === 'message.completed').map(event => event.ts)
      const clock = (epoch: number): Promise<string> => page.evaluate(
        at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        epoch,
      )
      await page.reload()
      await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
      await page.waitForFunction(
        () => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelectorAll('sh-chat-panel .message').length ?? 0) >= 4,
        undefined,
        { timeout: 30_000 },
      )
      await page.waitForTimeout(800)
      const after = await page.locator('sh-chat-panel .message').evaluateAll(nodes => nodes.map(node => ({
        role: node.classList.contains('user') ? 'user' : 'assistant',
        text: node.querySelector('.message-content')?.textContent?.trim() ?? '',
        time: node.querySelector('.message-time')?.textContent?.trim() ?? '',
        voice: node.querySelector('.message-voice')?.textContent?.trim() ?? '',
        cost: node.querySelector('.message-annotation')?.textContent?.trim() ?? '',
      })))
      check('D3: after a reload each turn is there once, in order (the host wrote the reply twice)',
        JSON.stringify(after.map(item => [item.role, item.text])) === JSON.stringify([
          ['user', ASK_ONE], ['assistant', REPLY_ONE], ['user', ASK_TWO], ['assistant', REPLY_TWO],
        ]), after.map(item => [item.role, item.text]))
      check('D3: the host really did hold the second reply twice', session.order.filter(id => session.items[id].role === 'assistant' && session.items[id].text === REPLY_TWO).length === 2)
      const now = await clock(Date.now())
      const expected = [await clock(session.createdAt), await clock(finished[0]), await clock(finished[1] - 1_000), await clock(finished[1])]
      check('D4: after a reload the replies carry the time the host recorded, not the time the page was read',
        after[1].time === await clock(finished[0]) && after[3].time === await clock(finished[1]) && after[1].time !== now && after[3].time !== now,
        { after: after.map(item => item.time), hostEvents: [await clock(finished[0]), await clock(finished[1])], now })
      check('D4: the first message is dated by the host’s record of the session, not by when the chat was made', after[0].time === expected[0] && after[0].time !== now, { first: after[0].time, expected: expected[0], now })
      check('the voice and the cost of each reply survive a reload', after[1].voice === 'voice: gemini-2.5-flash' && after[3].voice === 'voice: gemini-2.5-flash' && /^\$0\.00/.test(after[1].cost) && /^\$0\.00/.test(after[3].cost), after.map(item => [item.voice, item.cost]))
      const count4 = await page.locator('sh-chat-panel .message').count()
      check('nothing is shown twice after the reload', count4 === 4, count4)
      await shot('02-after-reload')
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('no horizontal overflow', overflow <= 0, overflow)
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  } finally {
    await browser.close()
    await sim.stop()
  }
}

// HARNESS_ONLY="chromium:1440:voices" (any part may be `*`) runs one combination while the harness is being worked on.
const only = (process.env.HARNESS_ONLY ?? '*:*:*').split(':')
const wanted = (part: string, index: number): boolean => (only[index] ?? '*') === '*' || only[index] === part

try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]] as const) {
    for (const viewport of viewports) {
      for (const scenario of ['legacy', 'voices', 'reload'] as const) {
        if (!wanted(engine, 0) || !wanted(viewport.label, 1) || !wanted(scenario, 2)) continue
        process.stdout.write(`${scenario} ${engine} ${viewport.label}\n`)
        await run(type, engine, viewport, scenario)
      }
    }
  }
} finally {
  await server.close()
}

const failed = reports.flatMap(report => report.checks.filter(item => !item.ok).map(item => ({ run: `${report.scenario} ${report.engine} ${report.viewport}`, ...item })))
writeFileSync(resolve(shotsDir, 'evidence.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  catalogue: { voices: CATALOGUE.models.length, house: HOUSE },
  runs: reports,
  failed,
}, null, 1))
process.stdout.write(`${reports.length} runs, ${reports.reduce((sum, report) => sum + report.checks.length, 0)} checks, ${failed.length} failed; shots in ${shotsDir}\n`)
process.exit(failed.length === 0 ? 0 : 1)
