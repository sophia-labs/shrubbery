/**
 * The conversation home and "Continue with…" in real browsers (Chromium and WebKit, 1440 and 390 px), with no sign-in
 * and nothing of production in the loop.
 *
 * WHAT RUNS. The REAL `<sh-chat-host>` (the element the workspace mounts in its chat rail) over the REAL hosted chat
 * service and the REAL archive client, in a real browser. Behind them, on a real socket, the scripted host the suites use
 * (`ChoreographSim` and `SobremesaRoutes`: the live host's seed store and launch admission, the live voice catalogue's
 * shape) and the archive as the sidecar gateway serves it (`ArchiveRoutes`: the list with dates, models and basis, the
 * revision list's audience, message pages with their page-level voice map). The catalogue is OpenRouter's own public
 * list of 2026-09-30 (`fixtures/chat-models-v1-20260930.json`, 294 voices).
 *
 * THE WALK, once per engine and viewport:
 *   1. open the history drawer: one list, live and imported by the date each really has, a quiet "Imported from the old
 *      garden", the voice the source recorded, an import that has no date saying so;
 *   2. open an imported conversation: the reader (a transcript with real dates and voice marks, provenance, completeness);
 *   3. "Continue with…": the chooser above the drawer, Same voice as before (named as recorded, never chosen for the person),
 *      how much is carried, where it goes; Tab stays inside it; Escape returns to the reader with focus on the button;
 *   4. choose a voice and confirm: the new chat opens below the window (the old turns keep their dates and their own voice,
 *      "Earlier assistant"), the seam is dated and names the new voice, nothing has left the browser;
 *   5. send the first message: the window goes to the seed store in the live contract's shape, the launch names it, the
 *      continuing assistant is told the old conversation's dates and model, the reply carries the voice that spoke;
 *   6. "open the original" from the seam opens the reader on the conversation that was picked up;
 *   7. a long conversation: the window leaves the middle out and says how many ("N earlier messages not included · open the
 *      original"), and the host has nothing of its own left to cut.
 *
 * Doctrine, in a real browser: no copy brings anyone back, revives or resurrects; the continuation never writes the old
 * conversation anywhere but the seed store and the launch; an import that is not the account's own is never continued.
 *
 *   SHOTS_DIR=<dir> node --import tsx scripts/home-browser-harness.mts
 *
 * Exits non-zero if any check fails; writes `evidence.json` beside the screenshots.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type BrowserType, type Page } from 'playwright'
import { createServer } from 'vite'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  costedTurn,
  workspaceWorkflow,
} from '../../../packages/runtime/src/chat-services/__tests__/fixtures/choreograph-sim.js'
import {
  ArchiveRoutes,
  conversationUrn,
  type ImportedConversation,
  type WireTurn,
} from '../../../packages/runtime/src/chat-services/__tests__/fixtures/archive-routes.js'
import { SobremesaRoutes } from '../../../packages/runtime/src/chat-services/__tests__/fixtures/sobremesa-routes.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = resolve(process.env.SHOTS_DIR ?? resolve(appDir, '.home-shots'))
mkdirSync(shotsDir, { recursive: true })

const CATALOGUE = JSON.parse(readFileSync(resolve(appDir, 'scripts/fixtures/chat-models-v1-20260930.json'), 'utf8')) as {
  models: Array<{ id: string; name: string }>
}
const USER = 'harness-user'
const GRAPH = 'atelier-20261001'
const KIMI_K25 = 'moonshotai/kimi-k2.5'
/** A model the catalogue no longer carries under that name (its family is there): offered as "closest available", said as such. */
const GONE = 'claude-sonnet-4-0'
const REPLY = 'We were on functors: a functor maps one structure to another and keeps its shape.'
const ASK = 'So where were we?'

interface Check { readonly name: string; readonly ok: boolean; readonly detail?: unknown }
interface RunReport {
  readonly scenario: string
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

// ── the account's imported conversations, as the sidecar gateway lists them ──

const DAY = 86_400_000
const AUG_2 = Date.UTC(2026, 7, 2, 15, 0)
const SEP_14 = Date.UTC(2026, 8, 14, 9, 30)

/** A short conversation that ended on an old Kimi. */
const monads: ImportedConversation = {
  number: 7,
  title: 'Monads, again',
  attributionBasis: 'direct-identity',
  turns: [
    { role: 'user', text: 'What is a monad?', at: AUG_2 },
    { role: 'assistant', text: 'A monad is a design pattern for chaining computations that carry a context.', at: AUG_2 + 30_000, model: { id: KIMI_K25, provider: 'openrouter' } },
    { role: 'user', text: 'And a functor?', at: AUG_2 + 90_000 },
    { role: 'assistant', text: 'Something that maps over a structure and keeps its shape.', at: AUG_2 + 120_000, model: { id: KIMI_K25, provider: 'openrouter' } },
  ],
}

/** Long enough that the window has to leave the middle out: 40 turns of about 6,000 characters (240,000 in all). */
function ferryTurns(): WireTurn[] {
  const paragraph = 'The ferry leaves from the north pier at a quarter past the hour and the crossing takes forty minutes in fair weather. '
  return Array.from({ length: 40 }, (_, index): WireTurn => {
    const user = index % 2 === 0
    const text = `${user ? 'Question' : 'Answer'} ${index + 1}. ${paragraph.repeat(52)}`
    return {
      role: user ? 'user' : 'assistant',
      text,
      at: SEP_14 + index * 120_000,
      ...(user ? {} : { model: { id: index % 4 === 1 ? KIMI_K25 : GONE, provider: index % 4 === 1 ? 'openrouter' : 'anthropic' } }),
    }
  })
}

const conversations: ImportedConversation[] = [
  monads,
  { number: 12, title: 'Ferry timetable for the islands', attributionBasis: 'legacy-account-header', turns: ferryTurns() },
  // A sub-agent conversation, started by the first.
  {
    number: 8,
    title: 'Subtask: look up the functor laws',
    parent: 7,
    turns: [
      { role: 'user', text: 'Look up the functor laws.', at: AUG_2 + 150_000 },
      { role: 'assistant', text: 'Identity and composition.', at: AUG_2 + 160_000, model: { id: KIMI_K25, provider: 'openrouter' } },
    ],
  },
  // Imported with no dates and no summary (the sidecar has nothing for this one yet).
  {
    number: 3,
    title: 'Notes on a recipe',
    summarised: false,
    turns: [
      { role: 'user', text: 'How long do I rest the dough?' },
      { role: 'assistant', text: 'An hour, covered.' },
    ],
  },
  // Another person's: never listed for this account, and a conversation the gateway refuses to read.
]

/**
 * Every shadow root's text, so a scan reads what a person reads and not what the light DOM happens to hold. (No named
 * inner function: the transform names them with a helper the page does not have.)
 */
async function deepText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = []
    const stack: Node[] = [document.body]
    while (stack.length > 0) {
      const node = stack.pop() as Node
      if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '')
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index])
      if (node instanceof Element && node.shadowRoot) stack.push(node.shadowRoot)
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  })
}

const FORBIDDEN = /\b(is back|are back|welcome back|revive\w*|resurrect\w*|bring(?:s|ing)? (?:him |her |it |them )?back|brought (?:him |her |it |them )?back|reincarnat\w*|lives? again)\b/i

type Scenario = 'sidecar' | 'today' | 'rowless' | 'stale' | 'empty' | 'refused'

/**
 * Everything one walk needs. `sidecar` is the gateway the release brings (dates, models and voices on the list and the
 * pages); `today` is the deployed gateway before the home gateway rolled, which knows no `order` parameter and sends none of
 * it; `rowless` is the home gateway as it runs from the moment it rolled until its backfill has written the derived rows
 * (recency is asked for and answered in hash order with a fallback, and there is still no date, voice or parent to show):
 * the home has to work without them, and say so, in both. `stale` is the sidecar gateway with a voice catalogue that says
 * it is stale (the live catalogue at 16:54 on 2026-10-01), which the voices release offers as none.
 */
interface Rig {
  readonly engine: string
  readonly viewport: (typeof viewports)[number]
  readonly sim: ChoreographSim
  readonly routes: SobremesaRoutes
  readonly archive: ArchiveRoutes
  readonly page: Page
  readonly report: RunReport
  readonly check: (name: string, ok: boolean, detail?: unknown) => void
  readonly shot: (name: string) => Promise<void>
  readonly text: (selector: string) => Promise<string>
  readonly count: (selector: string) => Promise<number>
  readonly seen: string[]
  close(): Promise<void>
}

async function rig(browserType: BrowserType, engine: string, viewport: (typeof viewports)[number], scenario: Scenario): Promise<Rig> {
  const sim = new ChoreographSim()
  const routes = new SobremesaRoutes(sim)
  const archive = new ArchiveRoutes(sim, { userId: USER })
  archive.conversations = conversations
  archive.supportsRecent = scenario !== 'today'
  archive.summaries = scenario !== 'rowless'
  routes.rawCatalogue = { body: scenario === 'stale' ? { ...CATALOGUE, stale: true } : CATALOGUE }
  routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 970_000) }
  // The scripted host keeps the time the browser does, a minute and a half behind.
  sim.clock = Date.now() - 90_000
  sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true, host: {} })]
  // The host says which model it resolved: where the person chose the House default it is the House default.
  sim.queueTurn(costedTurn(REPLY, 1_640, scenario === 'sidecar' ? { model: KIMI_K25 } : {}))
  sim.queueTurn(costedTurn('Picking up from the ferry timetable.', 1_100))
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
  return {
    engine, viewport, sim, routes, archive, page, report, check, shot, text, count, seen: [],
    async close() {
      await browser.close()
      await sim.stop()
    },
  }
}

/** The release's own gateway: the whole walk. */
async function walkSidecar(r: Rig): Promise<void> {
  const { page, sim, routes, archive, check, shot, text, count, seen, report, viewport } = r
  void archive
  try {
    await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
    await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
    const boot = await page.evaluate(() => (window as unknown as { __voices: { error?: string } }).__voices)
    check('the page mounted the real host', !boot.error, boot)
    await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
    await page.waitForSelector('sh-chat-panel .model-selector-trigger', { timeout: 30_000 })

    // ── 1. the one conversation home ──
    await page.locator('button.super-bar-identity').click()
    await page.waitForSelector('[data-chat-history-drawer]', { timeout: 10_000 })
    await page.waitForSelector(`[data-chat-history-open="${conversationUrn(7)}"]`, { timeout: 15_000 })
    seen.push(await deepText(page))
    const rows = await page.locator('[data-chat-history-row]').evaluateAll(nodes => nodes.map(node => ({
      id: node.getAttribute('data-chat-history-row'),
      kind: node.getAttribute('data-chat-history-kind'),
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })))
    const importedRows = rows.filter(row => row.kind === 'imported')
    // Three rows: the sub-agent conversation sits under the one that started it, not beside it.
    check('every import is listed, each marked "Imported from the old garden"', importedRows.length === 3 && importedRows.every(row => row.text.includes('Imported from the old garden')), importedRows.map(row => row.text))
    const monadsRow = rows.find(row => row.id === conversationUrn(7))?.text ?? ''
    check('an import carries its real date, its message count and the voice the source recorded', /Aug 2/.test(monadsRow) && /4 messages/.test(monadsRow) && /Kimi K2\.5/.test(monadsRow), monadsRow)
    const undated = rows.find(row => row.id === conversationUrn(3))?.text ?? ''
    check('an import with no date says so, and never borrows one', /No date recorded/.test(undated), undated)
    check('the sub-agent conversation sits under the one that started it', (await count(`[data-chat-history-children="${conversationUrn(7)}"]`)) === 1)
    await shot('01-home')
    // Tab wraps inside the drawer (what the drawer does itself: from the last control to the first, and back).
    await page.evaluate(() => {
      const drawer = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-history-drawer]')
      const controls = Array.from(drawer?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []) as HTMLElement[]
      controls[controls.length - 1]?.focus()
    })
    await page.keyboard.press('Tab')
    const drawerFocus = await page.evaluate(() => {
      const drawer = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-history-drawer]')
      const controls = Array.from(drawer?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [])
      return { index: controls.indexOf(document.querySelector('sh-chat-host')?.shadowRoot?.activeElement as Element), count: controls.length }
    })
    check('Tab from the last control of the drawer wraps to the first', drawerFocus.index === 0 && drawerFocus.count > 4, drawerFocus)
    // A sub-agent conversation: opened from under its parent, it says who started it, and the way up is one press.
    await page.locator(`[data-chat-history-children="${conversationUrn(7)}"]`).click()
    await page.waitForSelector(`[data-chat-history-open="${conversationUrn(8)}"]`, { timeout: 10_000 })
    await page.locator(`[data-chat-history-open="${conversationUrn(8)}"]`).click()
    await page.waitForSelector('[data-chat-reader-parent]', { timeout: 10_000 })
    check('a sub-agent conversation says which conversation started it, as a link up', /Started by Monads, again/.test(await text('[data-chat-reader-parent]')), await text('[data-chat-reader-parent]'))
    await shot('01b-reader-sub-agent')
    await page.locator('[data-chat-reader-back]').click()
    await page.waitForSelector(`[data-chat-history-open="${conversationUrn(7)}"]`, { timeout: 10_000 })

    // ── 2. the reader ──
    await page.locator(`[data-chat-history-open="${conversationUrn(7)}"]`).click()
    await page.waitForSelector('[data-chat-reader]', { timeout: 10_000 })
    await page.waitForFunction(
      () => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-reader] sh-chat-panel') as { messages?: unknown[] } | null)?.messages?.length === 4,
      undefined,
      { timeout: 15_000 },
    )
    const provenance = await text('[data-chat-reader-provenance]')
    check('the reader says where it came from and on what basis', /Imported from the old garden/.test(provenance) && /direct identity/.test(provenance), provenance)
    const readerMarks = await page.locator('[data-chat-reader] .message.assistant .message-annotation').allInnerTexts()
    check('every old assistant turn shows its real date and the model the source recorded, as recorded (the gateway sent the voices beside the messages)',
      readerMarks.length === 2 && readerMarks.every(mark => /Aug 2/.test(mark) && /voice: Kimi K2\.5 · source-recorded/.test(mark)), readerMarks)
    const continueButton = page.locator('[data-chat-reader-continue]')
    check('"Continue with…" is offered, beside Save to Garden and Download', (await continueButton.count()) === 1 && (await count('[data-chat-reader-save]')) === 1 && (await count('[data-chat-reader-download]')) === 1)
    const continueBox = await continueButton.boundingBox()
    if (viewport.phone) check('Continue is a touch target (44 px)', (continueBox?.height ?? 0) >= 44, continueBox)
    await shot('02-reader')

    // ── 3. the chooser ──
    await continueButton.click()
    await page.waitForSelector('sh-continue-chooser [data-voice-option]', { timeout: 15_000 })
    await page.waitForTimeout(250)
    seen.push(await deepText(page))
    const chooser = await text('sh-continue-chooser [data-continue-chooser]')
    check('the chooser names what it will do: how much is carried, the old model as recorded, where the text goes',
      /Continue “Monads, again”/.test(chooser) && /All 4 messages will be carried over/.test(chooser)
        && /Same voice as before \(source-recorded\)/.test(chooser) && /Continuing sends this conversation to .* through OpenRouter/.test(chooser), chooser)
    const checkedKey = await page.locator('sh-continue-chooser input[type="radio"]:checked').evaluate(input => (input.closest('[data-voice-option]') as HTMLElement | null)?.dataset.voiceOption ?? null)
    check('the voice is never chosen for the person: the House default stands until they choose', checkedKey === 'house', checkedKey)
    check('the drawer is still there under the chooser', (await count('[data-chat-history-drawer]')) === 1 && (await count('[data-chat-reader]')) === 1)
    const sheetBox = await page.locator('sh-continue-chooser [data-continue-chooser]').boundingBox()
    check('the chooser sits inside the viewport', !!sheetBox && sheetBox.x >= -1 && sheetBox.y >= -1 && sheetBox.x + sheetBox.width <= viewport.width + 1 && sheetBox.y + sheetBox.height <= viewport.height + 1, { sheetBox, viewport })
    if (viewport.phone) {
      const heights = await page.locator('sh-continue-chooser button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height))
      check('the chooser’s buttons are touch targets (44 px)', heights.length > 0 && heights.every(height => height >= 43.5), heights)
    }
    await shot('03-chooser')
    // Tab stays in the chooser. The order the engine walks BETWEEN controls is the engine's own (Safari on a Mac does not
    // Tab to buttons at all unless asked to), so what is held here is what the chooser does itself: from the last control
    // Tab wraps to the first, and from the first Shift+Tab wraps to the last.
    const where = () => page.evaluate(() => {
      const chooser = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-continue-chooser')
      const controls = Array.from(chooser?.shadowRoot?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])
      return { index: controls.indexOf(chooser?.shadowRoot?.activeElement as Element), count: controls.length }
    })
    await page.evaluate(() => {
      const chooser = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-continue-chooser')
      const controls = Array.from(chooser?.shadowRoot?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? []) as HTMLElement[]
      controls[controls.length - 1]?.focus()
    })
    await page.keyboard.press('Tab')
    const afterTab = await where()
    check('Tab from the last control wraps to the first, inside the chooser', afterTab.index === 0 && afterTab.count > 3, afterTab)
    await page.keyboard.press('Shift+Tab')
    const afterShiftTab = await where()
    check('Shift+Tab from the first control wraps to the last, inside the chooser', afterShiftTab.index === afterShiftTab.count - 1 && afterShiftTab.count > 3, afterShiftTab)
    // Escape returns to the reader, with focus on the button that asked.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-continue-chooser'), undefined, { timeout: 5_000 })
    const focusOnContinue = await page.evaluate(() => (document.querySelector('sh-chat-host')?.shadowRoot?.activeElement as HTMLElement | null)?.hasAttribute('data-chat-reader-continue') ?? false)
    check('Escape closes only the chooser and gives focus back to Continue', focusOnContinue && (await count('[data-chat-reader]')) === 1)
    check('nothing was sent by asking', sim.received.filter(call => call.method === 'POST').length === 0, sim.received.filter(call => call.method === 'POST').map(call => call.route))

    // ── 4. continue, in the voice the source recorded ──
    await continueButton.click()
    await page.waitForSelector('sh-continue-chooser [data-voice-option]', { timeout: 15_000 })
    await page.locator('sh-continue-chooser [data-voice-option="same"]').click()
    await shot('04-chooser-same-voice')
    await page.locator('sh-continue-chooser [data-continue-confirm]').click()
    await page.waitForFunction(() => !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-history-drawer]'), undefined, { timeout: 15_000 })
    await page.waitForSelector('sh-chat-panel .message.window', { timeout: 15_000 })
    await page.waitForSelector('sh-chat-panel .seam-line', { timeout: 15_000 })
    seen.push(await deepText(page))
    const windowTexts = await page.locator('sh-chat-panel .message.window .message-content').allInnerTexts()
    check('the new chat shows exactly the window that was read, read-only, in order', windowTexts.length === 4 && windowTexts[0].trim() === 'What is a monad?' && windowTexts[3].trim() === 'Something that maps over a structure and keeps its shape.', windowTexts)
    const windowMarks = await page.locator('sh-chat-panel .message.window .message-voice').allInnerTexts()
    check('the old turns keep their own voice, as recorded', windowMarks.length === 2 && windowMarks.every(mark => mark.trim() === 'voice: Kimi K2.5 · source-recorded'), windowMarks)
    // `textContent`: the byline is set in capitals by the stylesheet.
    const authors = await page.locator('sh-chat-panel .message.window.assistant .message-author').allTextContents()
    check('the old assistant is called what it is: "Earlier assistant"', authors.length === 2 && authors.every(author => author.trim() === 'Earlier assistant'), authors)
    const windowTimes = await page.locator('sh-chat-panel .message.window .message-time').allInnerTexts()
    check('the old turns carry the dates the source recorded', windowTimes.length === 4 && windowTimes.every(time => /Aug 2/.test(time)), windowTimes)
    const note = await text('sh-chat-panel .window-note')
    check('the window says it holds the whole conversation, and offers the original', /The whole conversation is included/.test(note) && /open the original/.test(note), note)
    const seamLine = await text('sh-chat-panel .seam-line')
    check('the seam is dated and names the voice that picked it up', /^— .*2026 · picked up with Kimi K2\.5 —$/.test(seamLine), seamLine)
    check('one line says where the window goes', /Continuing sends this conversation to Moonshot through OpenRouter\./.test(await text('sh-chat-panel .seam-notice')))
    const title = await text('sh-chat-panel .super-bar-chat-title')
    check('the chat is titled "{old title} · continued"', title === 'Monads, again · continued', title)
    check('nothing has left the browser yet', routes.seeds.length === 0 && sim.invocations().length === 0)
    await page.waitForTimeout(600)
    // Where a person lands: at the seam, with the line that says where the window goes in view above the composer.
    const landing = await page.evaluate(() => {
      const panel = document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel')
      const area = panel?.querySelector('.messages-container') as HTMLElement | null
      const notice = panel?.querySelector('.seam-notice')?.getBoundingClientRect()
      const areaBox = area?.getBoundingClientRect()
      return {
        short: area ? area.scrollHeight - area.scrollTop - area.clientHeight : null,
        noticeInView: !!notice && !!areaBox && notice.top >= areaBox.top - 1 && notice.bottom <= areaBox.bottom + 1,
      }
    })
    check('the person lands at the seam, with the line that says where the window goes in view', landing.noticeInView && (landing.short ?? 99) <= 2, landing)
    await shot('05-continued-chat')

    // ── 5. the first message ──
    const editor = page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first()
    await editor.click()
    await page.keyboard.type(ASK, { delay: 4 })
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('sh-chat-host')?.shadowRoot?.querySelectorAll('sh-chat-panel .message.assistant:not(.window) .message-content').length === 1
        && !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('sh-chat-panel .status-streaming'),
      undefined,
      { timeout: 30_000 },
    )
    await page.waitForTimeout(400)
    const reply = await text('sh-chat-panel .message.assistant:not(.window) .message-content')
    check('the reply arrives whole, below the seam', reply === REPLY, reply)
    check('the reply is marked with the voice that spoke, apart from the old marks', (await text('sh-chat-panel .message.assistant:not(.window) .message-voice')) === 'voice: Kimi K2.5')
    check('no dead buttons under a reply: Copy, and no Read aloud or Regenerate that nothing answers',
      (await count('sh-chat-panel .message-action-btn[aria-label="Regenerate"]')) === 0
        && (await count('sh-chat-panel .message-action-btn[aria-label="Read aloud"]')) === 0
        && (await count('sh-chat-panel .message.assistant:not(.window) .message-action-btn[aria-label="Copy message"]')) === 1)
    check('the window is still above the seam, untouched', (await count('sh-chat-panel .message.window')) === 4)
    check('one seed was stored, and the launch names it', routes.seeds.length === 1 && sim.invocations().length === 1, { seeds: routes.seeds.length, launches: sim.invocations().length })
    const seedBody = routes.seeds[0]?.body as { schema?: string; messages?: Array<Record<string, unknown>> } | undefined
    check('the seed is `sophia.chat-seed.v1` and its messages, with the source’s dates and models on them, and nothing else',
      JSON.stringify(Object.keys(seedBody ?? {}).sort()) === JSON.stringify(['messages', 'schema'])
        && seedBody?.schema === 'sophia.chat-seed.v1'
        && seedBody?.messages?.length === 4
        && seedBody.messages.every(message => Object.keys(message).every(key => ['role', 'text', 'occurredAt', 'voice'].includes(key)))
        && seedBody.messages[1].occurredAt === new Date(AUG_2 + 30_000).toISOString()
        && JSON.stringify(seedBody.messages[1].voice) === JSON.stringify({ model: KIMI_K25 })
        && seedBody.messages[0].voice === undefined, seedBody)
    const launch = sim.invocations()[0]?.body?.input ?? {}
    check('the launch carries the digest, the window as counts, the title and the voice, and no body',
      launch.seed?.seedDigest === routes.seeds[0]?.digest
        && JSON.stringify(launch.seed?.window) === JSON.stringify({ kept: 4, omitted: 0, total: 4 })
        && launch.seed?.continuesConversation?.archiveConversationUrn === conversationUrn(7)
        && launch.title === 'Monads, again · continued'
        && JSON.stringify(launch.inference) === JSON.stringify({ provider: 'openrouter', model: KIMI_K25 })
        && !JSON.stringify(sim.invocations()[0]?.body).includes('A monad is a design pattern'), launch)
    const briefing = routes.admitted[0]?.briefing
    check('the continuing assistant is told when the old conversation was held, which model spoke in it, and that it was not that model',
      !!briefing && /held 2026-08-02–2026-08-02 in the old Garden/.test(briefing.framing) && briefing.framing.includes(`Its model was recorded at the source as ${KIMI_K25}.`) && briefing.framing.includes('You were not part of it.'), briefing?.framing)
    const writes = sim.received.filter(call => call.method !== 'GET' && call.method !== 'OPTIONS').map(call => call.route)
    check('the old conversation is written nowhere but the seed store and the launch', writes.every(route => route === '/chat-seeds' || route === '/invocations' || /^\/agent-sessions\/[^/]+\/(driver|commands)$/.test(route)), writes)
    seen.push(await deepText(page))
    await shot('06-first-reply')

    // A reload finds it as it was: the window and its marks above the seam, the one reply below it, the title.
    await page.reload()
    await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
    await page.waitForFunction(
      () => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelectorAll('sh-chat-panel .message').length ?? 0) >= 6,
      undefined,
      { timeout: 30_000 },
    )
    await page.waitForTimeout(600)
    check('after a reload the window, the seam and the one reply are where they were',
      (await count('sh-chat-panel .message.window')) === 4 && (await count('sh-chat-panel .seam-line')) === 1
        && (await count('sh-chat-panel .message.assistant:not(.window) .message-content')) === 1
        && (await text('sh-chat-panel .message.assistant:not(.window) .message-content')) === REPLY
        && (await text('sh-chat-panel .super-bar-chat-title')) === 'Monads, again · continued',
      { window: await count('sh-chat-panel .message.window'), seam: await count('sh-chat-panel .seam-line'), title: await text('sh-chat-panel .super-bar-chat-title') })
    check('the old turns still carry their own marks after the reload', (await page.locator('sh-chat-panel .message.window .message-voice').allInnerTexts()).every(mark => mark.trim() === 'voice: Kimi K2.5 · source-recorded'))
    await shot('06b-after-reload')

    // ── 6. open the original from the seam ──
    await page.locator('sh-chat-panel .window-open-original').click()
    await page.waitForSelector('[data-chat-reader]', { timeout: 10_000 })
    await page.waitForFunction(
      () => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-reader] sh-chat-panel') as { messages?: unknown[] } | null)?.messages?.length === 4,
      undefined,
      { timeout: 15_000 },
    )
    check('"open the original" opens the reader on the conversation that was picked up', /Monads, again/.test(await text('[data-chat-reader-title]')) && /Imported from the old garden/.test(await text('[data-chat-reader-provenance]')))
    await shot('07-open-the-original')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-history-drawer]'), undefined, { timeout: 5_000 })

    // ── 7. a long conversation: the window leaves the middle out, and says so ──
    await page.locator('button.super-bar-identity').click()
    await page.waitForSelector('[data-chat-history-drawer]', { timeout: 10_000 })
    // The drawer remembers where it was: it opens on the reader of the original. Back to the list.
    if ((await count('[data-chat-reader]')) > 0) await page.locator('[data-chat-reader-back]').click()
    await page.waitForSelector(`[data-chat-history-open="${conversationUrn(12)}"]`, { timeout: 15_000 })
    await page.locator(`[data-chat-history-open="${conversationUrn(12)}"]`).click()
    await page.waitForSelector('[data-chat-reader-continue]', { timeout: 15_000 })
    await page.locator('[data-chat-reader-continue]').click()
    await page.waitForSelector('sh-continue-chooser [data-voice-option]', { timeout: 20_000 })
    const longChooser = await text('sh-continue-chooser [data-continue-window]')
    const omittedInChooser = Number(/(\d+) earlier messages? (?:are|is) not included/.exec(longChooser)?.[1] ?? '0')
    check('the chooser says how much of a long conversation is carried: the first turn and the most recent', omittedInChooser > 0 && /of 40 messages will be carried over: the first, and the most recent/.test(longChooser), longChooser)
    await shot('08-chooser-long')
    const closest = await text('sh-continue-chooser [data-voice-option="closest"]')
    check('a model the catalogue no longer carries is offered as the closest available, said as such, never as "the same"',
      (await count('sh-continue-chooser [data-voice-option="same"]')) === 0 && /Closest available/.test(closest) && closest.includes(`the source recorded ${GONE}`), closest)
    await page.locator('sh-continue-chooser [data-voice-option="house"]').click()
    await page.locator('sh-continue-chooser [data-continue-confirm]').click()
    await page.waitForSelector('sh-chat-panel .window-note[data-window-omitted]', { timeout: 15_000 })
    const longNote = await text('sh-chat-panel .window-note')
    check('the window says how many earlier messages are not included, beside "open the original"', new RegExp(`${omittedInChooser.toLocaleString()} earlier messages not included`).test(longNote) && /open the original/.test(longNote), longNote)
    await page.waitForFunction(() => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelectorAll('sh-chat-panel .message.window').length ?? 0) >= 2, undefined, { timeout: 15_000 })
    const windowBytes = await page.locator('sh-chat-panel .message.window .message-content').evaluateAll(nodes => nodes.reduce((sum, node) => sum + (node.textContent ?? '').length, 0))
    check('the window stays under what the host shows the model', windowBytes <= 114_000, windowBytes)
    await shot('09-continued-long')
    await editor.click()
    await page.keyboard.type('Pick up from the last answer.', { delay: 4 })
    await page.keyboard.press('Enter')
    const began = Date.now()
    while (sim.invocations().length < 2 && Date.now() - began < 30_000) await page.waitForTimeout(100)
    const second = routes.admitted[1]
    check('the host admitted it, and cut nothing of its own: the window arrived whole',
      !!second && second.window.omitted === omittedInChooser && second.renderedChars <= 120_000 && second.window.total === 40, second && { window: second.window, renderedChars: second.renderedChars })
    check('the model is told how many messages were left out, counted as the panel counts them', !!second && second.briefing.framing.includes(`${omittedInChooser} of 40 messages were omitted from the middle to fit.`), second?.briefing.framing)

    // ── the whole walk ──
    for (const [index, said] of seen.entries()) {
      const hit = said.match(FORBIDDEN)?.[0]
      if (hit) check(`no phase brings anyone back (phase ${index})`, false, hit)
    }
    check('no phase of the walk brings anyone back, revives or resurrects', seen.every(said => !FORBIDDEN.test(said)))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('no horizontal overflow', overflow <= 0, overflow)
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  }
}

/**
 * A gateway with nothing derived, before the sidecar's rows exist (`today`: the deployed gateway, which refuses `order`;
 * `rowless`: the home gateway before its backfill, which answers it in hash order): the list says what it does not know
 * (no date, no voice, no grouping), the reader says the voice was not recorded and shows the time each message itself
 * carries, and a conversation can still be picked up, honestly: the seed names no model nobody recorded, and the
 * continuing assistant is told so.
 */
async function walkToday(r: Rig, kind: 'today' | 'rowless' = 'today'): Promise<void> {
  const { page, sim, routes, archive, check, shot, text, count, seen, report, viewport } = r
  const tag = kind === 'today' ? 'before-the-sidecar' : 'before-the-backfill'
  try {
    await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
    await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
    await page.waitForSelector('sh-chat-panel .model-selector-trigger', { timeout: 30_000 })
    await page.locator('button.super-bar-identity').click()
    await page.waitForSelector(`[data-chat-history-open="${conversationUrn(7)}"]`, { timeout: 15_000 })
    seen.push(await deepText(page))
    const rows = await page.locator('[data-chat-history-row][data-chat-history-kind="imported"]').evaluateAll(nodes => nodes.map(node => (node.textContent ?? '').replace(/\s+/g, ' ').trim()))
    // The deployed gateway says nothing of dates, models or parents on the list: four rows, none dated, none grouped.
    check('every import is listed, with the date it does not have said so, never borrowed', rows.length === 4 && rows.every(row => /No date recorded/.test(row) && /Imported from the old garden/.test(row)), rows)
    check('no voice is claimed on a row, and no sub-agent grouping is invented', rows.every(row => !/∿/.test(row)) && (await count('[data-chat-history-children]')) === 0, rows)
    const asked = archive.requests.filter(request => request.route === '/me/conversations').map(request => request.query.get('order'))
    if (kind === 'today') {
      check('the list asked for recency, was refused as the deployed gateway refuses an unknown parameter, and asked again without it', asked.join(',') === 'recent,', asked)
    } else {
      check('the list asked for recency once and was answered (in hash order, with a fallback): no second ask, no refusal', asked.join(',') === 'recent', asked)
    }
    await shot(`01-home-${tag}`)
    await page.locator(`[data-chat-history-open="${conversationUrn(7)}"]`).click()
    await page.waitForFunction(
      () => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-reader] sh-chat-panel') as { messages?: unknown[] } | null)?.messages?.length === 4,
      undefined,
      { timeout: 15_000 },
    )
    const marks = await page.locator('[data-chat-reader] .message.assistant .message-annotation').allInnerTexts()
    // The archive's own messages carry the time they were said (it is the list that has none): the reader shows those.
    check('the reader says "voice not recorded" for every assistant turn, and shows the date each message itself carries', marks.length === 2 && marks.every(mark => /voice not recorded/.test(mark) && /Aug 2/.test(mark)), marks)
    check('the reader still offers Continue (the registry advertises `seed`)', (await count('[data-chat-reader-continue]')) === 1)
    await shot(`02-reader-${tag}`)
    await page.locator('[data-chat-reader-continue]').click()
    await page.waitForSelector('sh-continue-chooser [data-voice-option]', { timeout: 15_000 })
    const keys = await page.locator('sh-continue-chooser [data-voice-option]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.voiceOption))
    check('no "same voice" is offered for a model nobody recorded: the House default and the others only', JSON.stringify(keys) === JSON.stringify(['house', 'other']), keys)
    await shot(`03-chooser-${tag}`)
    await page.locator('sh-continue-chooser [data-continue-confirm]').click()
    await page.waitForSelector('sh-chat-panel .seam-line', { timeout: 15_000 })
    const windowMarks = await page.locator('sh-chat-panel .message.window .message-voice').allInnerTexts()
    check('the window marks every old assistant turn "voice not recorded"', windowMarks.length === 2 && windowMarks.every(mark => mark.trim() === 'voice not recorded'), windowMarks)
    const editor = page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first()
    await editor.click()
    await page.keyboard.type(ASK, { delay: 4 })
    await page.keyboard.press('Enter')
    const began = Date.now()
    while (sim.invocations().length < 1 && Date.now() - began < 30_000) await page.waitForTimeout(100)
    await page.waitForFunction(
      () => document.querySelector('sh-chat-host')?.shadowRoot?.querySelectorAll('sh-chat-panel .message.assistant:not(.window) .message-content').length === 1,
      undefined,
      { timeout: 30_000 },
    )
    const seed = routes.seeds[0]?.body as { messages?: Array<Record<string, unknown>> } | undefined
    check('the seed names no model that nobody recorded, and carries the dates the messages themselves had',
      !!seed?.messages && seed.messages.length === 4 && seed.messages.every(message => message.voice === undefined)
        && seed.messages[0].occurredAt === new Date(AUG_2).toISOString(), seed)
    const briefing = routes.admitted[0]?.briefing
    check('the continuing assistant is told when it was held, and that nobody recorded which model spoke',
      !!briefing && briefing.framing.includes('held 2026-08-02\u20132026-08-02') && briefing.framing.includes('Its model was not recorded.'), briefing?.framing)
    check('the seam is dated today and names the voice that picked it up: the House default, chosen by nobody for them', /^— .*2026 · picked up with Gemini 2\.5 Flash —$/.test(await text('sh-chat-panel .seam-line')), await text('sh-chat-panel .seam-line'))
    seen.push(await deepText(page))
    await shot(`04-continued-${tag}`)
    check('no phase brings anyone back, revives or resurrects', seen.every(said => !FORBIDDEN.test(said)))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('no horizontal overflow', overflow <= 0, overflow)
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
    void viewport
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  }
}

/**
 * A catalogue of voices that says it is stale (the live one did at 16:54 on 2026-10-01; the voices release offers a stale
 * catalogue as none): no voice picker in the chat, and "Continue with…" has no voice to choose: the chooser says the
 * workspace's own voice will pick it up, and Confirm does exactly that (it used to be refused as "a voice that is not on
 * offer", after the sheet had promised the opposite). The seam names the House default, the launch carries the seed and
 * names no voice, and the reply arrives.
 */
async function walkStale(r: Rig): Promise<void> {
  const { page, sim, routes, check, shot, text, count, seen, report } = r
  try {
    await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
    await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
    await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
    check('a stale catalogue is offered as none: no voice picker in the chat', (await count('sh-chat-panel .model-selector-trigger')) === 0)
    await page.locator('button.super-bar-identity').click()
    await page.waitForSelector(`[data-chat-history-open="${conversationUrn(7)}"]`, { timeout: 15_000 })
    await page.locator(`[data-chat-history-open="${conversationUrn(7)}"]`).click()
    await page.waitForFunction(
      () => (document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-reader] sh-chat-panel') as { messages?: unknown[] } | null)?.messages?.length === 4,
      undefined,
      { timeout: 15_000 },
    )
    check('the reader still offers Continue', (await count('[data-chat-reader-continue]')) === 1)
    await page.locator('[data-chat-reader-continue]').click()
    await page.waitForSelector('sh-continue-chooser [data-continue-confirm]', { timeout: 15_000 })
    seen.push(await deepText(page))
    check('the chooser has no voice to choose and says whose voice will pick it up',
      (await count('sh-continue-chooser [data-voice-option]')) === 0
        && /This workspace.s own voice will pick it up\./.test(await text('sh-continue-chooser [data-continue-default]')),
      await text('sh-continue-chooser [data-chat-continue-sheet], sh-continue-chooser [data-continue-chooser]'))
    check('it still says where the window goes', /^Continuing sends this conversation to OpenRouter and the model provider behind it\.$/.test(await text('sh-continue-chooser [data-continue-notice]')), await text('sh-continue-chooser [data-continue-notice]'))
    await shot('01-chooser-without-voices')
    await page.locator('sh-continue-chooser [data-continue-confirm]').click()
    await page.waitForSelector('sh-chat-panel .seam-line', { timeout: 15_000 })
    check('Confirm opens the chat, with no refusal anywhere', (await count('sh-continue-chooser')) === 0 && !/not on offer/.test(await deepText(page)))
    check('the seam names the House default, dated today', /^— .*2026 · picked up with House default —$/.test(await text('sh-chat-panel .seam-line')), await text('sh-chat-panel .seam-line'))
    const editor = page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first()
    await editor.click()
    await page.keyboard.type(ASK, { delay: 4 })
    await page.keyboard.press('Enter')
    const began = Date.now()
    while (sim.invocations().length < 1 && Date.now() - began < 30_000) await page.waitForTimeout(100)
    await page.waitForFunction(
      () => document.querySelector('sh-chat-host')?.shadowRoot?.querySelectorAll('sh-chat-panel .message.assistant:not(.window) .message-content').length === 1,
      undefined,
      { timeout: 30_000 },
    )
    const [launch] = sim.invocations()
    check('the launch carries the seed and names no voice', !!launch?.body.input.seed && launch.body.input.inference === undefined, launch?.body.input)
    check('the seed store took the whole window, and the host admitted it', routes.seeds.length === 1 && routes.admitted.length === 1)
    seen.push(await deepText(page))
    await shot('02-continued-without-voices')
    check('no phase brings anyone back, revives or resurrects', seen.every(said => !FORBIDDEN.test(said)))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('no horizontal overflow', overflow <= 0, overflow)
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  }
}

/**
 * An account with nothing imported (the probe account's own state): no Imported filter, no sentence about imports, no dead end
 * ("No imported chats found."), and New still starts a chat.
 */
async function walkEmpty(r: Rig): Promise<void> {
  const { page, sim, archive, check, shot, text, count, seen, report } = r
  archive.conversations = []
  try {
    await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
    await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
    await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
    await page.locator('button.super-bar-identity').click()
    await page.waitForSelector('[data-chat-history-drawer]', { timeout: 10_000 })
    await page.waitForSelector('[data-chat-history-empty]', { timeout: 15_000 })
    seen.push(await deepText(page))
    const drawerText = await text('[data-chat-history-drawer]')
    check('an empty home says so in one plain sentence and points to New', /No chats yet\. Choose New to start one\./.test(drawerText), drawerText)
    check('no Imported filter, no sentence about imports, and never the dead end "No imported chats found."',
      (await count('[data-chat-history-filter]')) === 0 && !/imported/i.test(drawerText) && !/No imported chats found/.test(drawerText), drawerText)
    check('the archive was asked, and answered with nothing', archive.requests.some(request => request.route === '/me/conversations'))
    await shot('01-empty-home')
    await page.locator('[data-chat-history-new]').click()
    await page.waitForFunction(() => !document.querySelector('sh-chat-host')?.shadowRoot?.querySelector('[data-chat-history-drawer]'), undefined, { timeout: 10_000 })
    check('New starts a chat and closes the drawer', (await count('sh-chat-panel .composer')) === 1)
    check('no phase brings anyone back, revives or resurrects', seen.every(said => !FORBIDDEN.test(said)))
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  }
}

/**
 * What the archive refuses, in its own words, beside a live list that keeps working: each refusal on a fresh page (a lapsed
 * session, an archive that is not open to this sign-in, an erased one, a busy store), and whether trying again can help.
 */
async function walkRefused(r: Rig): Promise<void> {
  const { page, sim, archive, check, shot, count, seen, report } = r
  const cases = [
    { status: 401, code: 'signed_out', kind: 'unauthorized', title: /Your session expired/, retry: true },
    { status: 403, code: 'human_user_required', kind: 'forbidden', title: /not open to this sign-in/, retry: false },
    { status: 410, code: 'conversation_archive_erased', kind: 'erased', title: /were erased/, retry: false },
    { status: 503, code: 'conversation_archive_busy', kind: 'unavailable', title: /could not be loaded|busy|not available|unavailable/i, retry: true },
  ] as const
  try {
    for (const item of cases) {
      archive.refuse = { status: item.status, code: item.code }
      await page.goto(`${pageUrl}?gateway=${encodeURIComponent(sim.base)}&graph=${GRAPH}&user=${USER}`)
      await page.waitForFunction(() => (window as unknown as { __voices?: { ready?: boolean } }).__voices?.ready === true, undefined, { timeout: 60_000 })
      await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
      await page.locator('button.super-bar-identity').click()
      await page.waitForSelector('[data-chat-history-notice]', { timeout: 15_000 })
      const notice = await page.locator('[data-chat-history-notice]').evaluate(node => ({ kind: node.getAttribute('data-kind'), text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(), retry: !!node.querySelector('[data-chat-history-notice-retry]'), dismiss: !!node.querySelector('[data-chat-history-notice-dismiss]') }))
      check(`a ${item.status} says what it is, in its own words, and that live chats are unaffected`, notice.kind === item.kind && item.title.test(notice.text) && /live chats/.test(notice.text), notice)
      check(`a ${item.status} offers ${item.retry ? '"Try again"' : '"Dismiss"'} only where it can help`, item.retry ? notice.retry && !notice.dismiss : notice.dismiss && !notice.retry, notice)
      check(`the live side keeps working beside a ${item.status}`, (await count('[data-chat-history-new]')) === 1 && (await count('[data-chat-history-live-error]')) === 0)
      seen.push(notice.text)
      await shot(`01-notice-${item.status}`)
    }
    check('no refusal speaks of bringing anything back', seen.every(said => !FORBIDDEN.test(said)), seen)
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  }
}

async function run(browserType: BrowserType, engine: string, viewport: (typeof viewports)[number], scenario: Scenario): Promise<void> {
  const r = await rig(browserType, engine, viewport, scenario)
  try {
    if (scenario === 'sidecar') await walkSidecar(r)
    else if (scenario === 'today') await walkToday(r, 'today')
    else if (scenario === 'rowless') await walkToday(r, 'rowless')
    else if (scenario === 'stale') await walkStale(r)
    else if (scenario === 'empty') await walkEmpty(r)
    else await walkRefused(r)
  } finally {
    await r.close()
  }
}

// HARNESS_ONLY="chromium:1440:sidecar" (any part may be `*`) runs one combination while the harness is being worked on.
const only = (process.env.HARNESS_ONLY ?? '*:*:*').split(':')
const wanted = (part: string, index: number): boolean => (only[index] ?? '*') === '*' || only[index] === part

try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]] as const) {
    for (const viewport of viewports) {
      for (const scenario of ['sidecar', 'today', 'rowless', 'stale', 'empty', 'refused'] as const) {
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
  catalogue: { voices: CATALOGUE.models.length },
  conversations: conversations.map(item => ({ number: item.number, title: item.title, turns: item.turns.length })),
  runs: reports,
  failed,
}, null, 1))
process.stdout.write(`${reports.length} runs, ${reports.reduce((sum, report) => sum + report.checks.length, 0)} checks, ${failed.length} failed; shots in ${shotsDir}\n`)
process.exit(failed.length === 0 ? 0 : 1)
