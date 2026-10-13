/**
 * The credits release in real browsers (Chromium; WebKit when asked for), light and dark, at 1440 and
 * 390 px, with no sign-in and nothing of production in the loop.
 *
 * WHAT RUNS. The REAL `<sh-chat-host>` over the REAL hosted chat service with the credits grant
 * `main.ts` gives it, the REAL `connectChatCredits` and Settings overlay the shell uses to take a person
 * from the chat to Billing, and the REAL Settings route over the REAL `HostedBilling` (see
 * `credits-browser-page.ts`). What is scripted is the gateway on the other side of a real socket (the
 * same `ChoreographSim` the suites use, with the gateway's `/billing/*` wire and the voice catalogue
 * added to it) and the two things a browser owns: leaving for Stripe is recorded, not followed, and the
 * harness plays the return itself.
 *
 * THE REGIME IS THE BACKEND'S (Vera, 2026-10-03). The balance answer carries `feeBps`, `gateMode`
 * ("observe" | "enforce") and `creditsStartDate` (absent until it is set); the SPA is built once, and what
 * it says of the fee, of "Out of credits" and of the day credits start is whatever the gateway answered on
 * the page's last balance read. The scripted gateway therefore speaks the three regimes a build meets:
 * TODAY (observing, 15%, no day yet), AFTER THE FLIP (enforcing, 20%), and an OLDER BACKEND that says none
 * of it. The same build, the same bytes, runs all three.
 *
 * WHAT IT WITNESSES, for each engine, viewport and theme (lane `credits`):
 *   chat      the balance line in each of its states, enforcing (normal, running low, out of credits, the
 *             gateway's own "would refuse", the starter credit, unavailable), observing and from an older
 *             backend (the band that used to read "Out of credits" reads "Running low" with Add credits,
 *             and no refusal is ever predicted); the 402 refusal banner with the message kept and its Add
 *             credits button; that button opening Billing over the live chat with the amount that covers
 *             the need armed; the credits notice: absent until the backend names a day, then its day and its
 *             fee (15%, then 20% after the flip with nothing rebuilt), Details, Dismiss, remembered, told
 *             again when the day moves, and never promising that credits do not expire.
 *   billing   a fresh account (the $1.00 starter credit, no dead portal button), the fee line as the backend
 *             states it (15%, 20%, or left out for an older backend), the presets and the custom
 *             amount with its two refusals, pending, a refused checkout, the checkout the gateway accepts
 *             (the exact body, the bearer, Stripe's host), keyboard order, focus ring, touch targets.
 *   history   entries with "Show earlier" (the cursor on the wire), empty, failed with a retry, absent.
 *   return    a payment that lands (the toast, the balance poll, "Credits added", the new line in the
 *             history), one that has not landed, and a cancelled checkout.
 *
 * AND, in lane `skins`: the skin picker in the bar of the Billing page (keyboard and mouse; on a phone the
 * Skin drop-down in Settings, Appearance, where the bar has always folded it), every one of the six skins
 * chosen through it with Billing drawn in each, and Hotdog Stand on the credits surfaces: Billing, the
 * balance line, the notice, the 402 banner, Billing over the chat, the return toasts, each measured text
 * run against the surface it sits on (the skin's own rule: below 4.5:1 only on Window red, never below
 * 3:1, and nowhere after hours). Those screenshots go to `skins/`.
 *
 *   SHOTS_DIR=<dir> node --import tsx scripts/credits-browser-harness.mts
 *   HARNESS_ONLY="chromium:1440:light" ... runs one combination while the harness is being worked on.
 *   ENGINES=chromium,webkit adds WebKit.
 *   LANES=credits,skins (the default) | LANES=skins | LANES=credits
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
  workspaceWorkflow,
} from '../../../packages/runtime/src/chat-services/__tests__/fixtures/choreograph-sim.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = resolve(process.env.SHOTS_DIR ?? resolve(appDir, '.credits-shots'))
mkdirSync(shotsDir, { recursive: true })

const CATALOGUE = JSON.parse(readFileSync(resolve(appDir, 'scripts/fixtures/chat-models-v1-20260930.json'), 'utf8')) as unknown
const USER = 'harness-user'
const GRAPH = 'atelier-20261003'
const STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_credits_harness'
/** What the backend sends as `creditsStartDate`, and what a person reads of it. */
const START_ISO = '2026-10-12'
const START_READ = 'October 12, 2026'
const MOVED_ISO = '2026-10-19'
const MOVED_READ = 'October 19, 2026'
/** The fee in basis points: 15% while the gate observes, 20% once it enforces. */
const FEE_TODAY = 1500
const FEE_AFTER_FLIP = 2000
const CONTACT = 'vera@sophia-labs.com'
/** What the person types when the gate refuses. */
const ASK = 'Could you summarise my notes on the harvest?'
/** The 402 the gateway answers a refused request with (an enforcing gate's). */
const REFUSED_402 = { status: 402, body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } } }

interface Check { readonly name: string; readonly ok: boolean; readonly detail?: unknown }
/** One measured page: every visible text run against the surface it sits on (the Hotdog Stand proof's audit). */
interface Audit { readonly where: string; readonly skin: string; readonly total: number; readonly minRatio: number; readonly belowAA: number; readonly exempt: number; readonly worst: unknown }
interface RunReport {
  readonly engine: string
  readonly viewport: string
  readonly theme: string
  readonly checks: Check[]
  readonly shots: string[]
  readonly audits: Audit[]
  /** Anything else worth keeping beside the checks (what each skin drew the credits controls as, and so on). */
  readonly notes: Record<string, unknown>
  readonly pageErrors: string[]
  readonly consoleErrors: string[]
}
const reports: RunReport[] = []
const lanes = new Set((process.env.LANES ?? 'credits,skins').split(',').map(lane => lane.trim()).filter(Boolean))

const viewports = [
  { label: '1440', width: 1440, height: 900, phone: false },
  { label: '390', width: 390, height: 844, phone: true },
] as const
const themes = ['light', 'dark'] as const

const port = Number(process.env.HARNESS_PORT ?? 5193)
const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: false },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const vitePort = typeof address === 'object' && address ? address.port : 0
if (!vitePort) throw new Error('could not resolve the Vite port')
const pageUrl = `http://127.0.0.1:${vitePort}/credits-browser-harness.html`

/** A history row as Choreograph writes it (`sophia.credit-history.v1`). */
interface HistoryItem { id: string; kind: string; ts: number; amountMicroUsd: number; label: string; reason: string | null }
const at = (iso: string): number => Date.parse(iso)

/**
 * The gateway's account wire and the voice catalogue, on the sim's own socket (so a person's chat
 * and their Billing talk to one origin, as they do in production).
 */
class Gateway {
  readonly requests: Received[] = []
  balanceMicroUsd = 970_000
  initialized = true
  canMakeRequests: boolean | undefined = true
  balanceStatus: number | undefined
  /**
   * What the backend says of the credits regime, on the balance answer; each is absent from the answer while
   * it is `undefined`, as from an older backend, and `creditsStartDate` is absent until the day is set.
   */
  feeBps: number | undefined = FEE_TODAY
  gateMode: 'observe' | 'enforce' | undefined = 'observe'
  creditsStartDate: string | undefined
  balanceReads = 0
  onBalanceRead: ((reads: number) => void) | undefined
  checkout: (request: Received) => Answer = () => ({ status: 200, body: { url: STRIPE, checkout_url: STRIPE } })
  history: (request: Received) => Answer = () => ({ status: 404, body: { error: 'not found', code: 'not_found' } })

  constructor(sim: ChoreographSim) {
    sim.extraRoutes.push(request => this.answer(request))
  }

  /** Today: the gate observes, the fee is 15%, and no day has been named yet. */
  observe(): void {
    this.gateMode = 'observe'
    this.feeBps = FEE_TODAY
  }

  /** After the flip: the gate enforces and the fee is 20%. The SPA is the same build as before it. */
  enforce(): void {
    this.gateMode = 'enforce'
    this.feeBps = FEE_AFTER_FLIP
  }

  /** A backend that predates the facts: the balance carries none of them. */
  older(): void {
    this.gateMode = undefined
    this.feeBps = undefined
    this.creditsStartDate = undefined
  }

  reset(): void {
    this.requests.length = 0
    this.balanceMicroUsd = 970_000
    this.initialized = true
    this.canMakeRequests = true
    this.balanceStatus = undefined
    this.observe()
    this.creditsStartDate = undefined
    this.balanceReads = 0
    this.onBalanceRead = undefined
    this.checkout = () => ({ status: 200, body: { url: STRIPE, checkout_url: STRIPE } })
    this.history = () => ({ status: 404, body: { error: 'not found', code: 'not_found' } })
  }

  calls(path: string, method?: string): Received[] {
    return this.requests.filter(request => request.path === path && (method === undefined || request.method === method))
  }

  private answer(request: Received): Answer | undefined {
    if (request.graph !== null) return undefined
    if (request.path.startsWith('/billing/')) this.requests.push(request)
    switch (request.path) {
      case '/chat/models':
        return request.method === 'GET' ? { status: 200, body: CATALOGUE } : undefined
      case '/billing/balance': {
        this.balanceReads += 1
        this.onBalanceRead?.(this.balanceReads)
        if (this.balanceStatus !== undefined) return { status: this.balanceStatus, body: { error: 'upstream', code: 'billing_authority_unavailable' } }
        return {
          status: 200,
          body: {
            userId: USER,
            user_id: USER,
            balanceMicroUsd: this.balanceMicroUsd,
            balance_micro_usd: this.balanceMicroUsd,
            lifetimeUsageMicroUsd: 1_234,
            initialized: this.initialized,
            ...(this.canMakeRequests === undefined ? {} : { can_make_requests: this.canMakeRequests }),
            ...(this.feeBps === undefined ? {} : { feeBps: this.feeBps }),
            ...(this.gateMode === undefined ? {} : { gateMode: this.gateMode }),
            ...(this.creditsStartDate === undefined ? {} : { creditsStartDate: this.creditsStartDate }),
          },
        }
      }
      case '/billing/subscription':
        return { status: 200, body: { userId: USER, tier: 'free', accountTier: 'free', status: 'none', plan: null, currentPeriodEnd: null, canManage: false } }
      case '/billing/usage':
        return { status: 200, body: { userId: USER, totalMicroUsd: 123_000, eventCount: 7, fromTs: Date.now() - 30 * 86_400_000, toTs: Date.now() } }
      case '/billing/checkout':
        return this.checkout(request)
      case '/billing/credits/history':
        return this.history(request)
      default:
        return undefined
    }
  }
}

const ENTRIES: HistoryItem[] = [
  { id: 'h_5e1d8a90c2b7f4e61a03', kind: 'adjustment', ts: at('2026-10-02T00:00:00Z'), amountMicroUsd: -5_000_000, label: 'Refund', reason: 'Refunded at your request' },
  { id: 'h_77aa10d3e9c24b58f6e1', kind: 'adjustment', ts: at('2026-10-01T09:30:00Z'), amountMicroUsd: 850_000, label: 'Credits added by Sophia', reason: 'credits start' },
  { id: 'h_20c4be7183d9a05f4c62', kind: 'top-up', ts: at('2026-09-30T18:00:00Z'), amountMicroUsd: 10_000_000, label: 'Credits added', reason: null },
]
const EARLIER: HistoryItem[] = [
  { id: 'h_9b02f1e45c78d3a60b19', kind: 'top-up', ts: at('2026-09-12T11:00:00Z'), amountMicroUsd: 25_000_000, label: 'Credits added', reason: null },
]
const historyBody = (items: HistoryItem[], nextCursor: string | null) => ({ schema: 'sophia.credit-history.v1', userId: USER, items, nextCursor })

async function typeAndSend(page: Page, text: string): Promise<void> {
  const editor = page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type(text, { delay: 4 })
  await page.keyboard.press('Enter')
}

interface AuditRow { fg: string; bg: string; ratio: number; count: number; sample: string[]; where: string }

/**
 * The contrast audit of the Hotdog Stand proof (`hotdog-stand-skin-proof.mts`), scoped to one surface: every
 * visible text node and placeholder under `rootSelector`, piercing open shadow roots, measured against the
 * composited background it actually sits on (walking up through shadow boundaries until an opaque layer).
 * Hidden, zero-size and disabled things are skipped; a gradient or image behind the text is skipped, not
 * guessed at. Returns only what is under 4.5:1, grouped, and the lowest ratio seen.
 */
async function textAudit(page: Page, rootSelector: string): Promise<{ total: number; minRatio: number; below45: AuditRow[] } | null> {
  return page.evaluate(rootSel => {
    type RGBA = [number, number, number, number]
    const parse = (css: string): RGBA | null => {
      let m = css.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?\)/)
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
      m = css.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/)
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])]
      return null
    }
    const lum = ([r, g, b]: RGBA): number => {
      const l = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b)
    }
    const over = (f: RGBA, b: RGBA): RGBA => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1]
    const ratio = (a: RGBA, b: RGBA): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    const parentOf = (n: Node): Element | null => {
      const p = (n as Element).parentElement
      if (p) return p
      const root = n.getRootNode()
      return root instanceof ShadowRoot ? root.host : null
    }
    const isDisabled = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = parentOf(n)) {
        if ((n as HTMLButtonElement).disabled === true || n.getAttribute('aria-disabled') === 'true') return true
      }
      return false
    }
    const effectiveBg = (el: Element): RGBA | 'gradient' => {
      const layers: RGBA[] = []
      for (let n: Element | null = el; n; n = parentOf(n)) {
        const cs = getComputedStyle(n)
        if (cs.backgroundImage !== 'none') return 'gradient'
        const bg = parse(cs.backgroundColor)
        if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] === 1) break }
      }
      let base: RGBA = [255, 255, 255, 1]
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
      return base
    }
    const opacityOf = (el: Element): number => {
      let o = 1
      for (let n: Element | null = el; n; n = parentOf(n)) o *= Number(getComputedStyle(n).opacity)
      return o
    }
    const start = document.querySelector(rootSel)
    if (!start) return null
    const targets: Array<{ el: Element; fg: string; label: string }> = []
    const walk = (root: Element | ShadowRoot): void => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      for (let n: Node | null = tw.nextNode(); n; n = tw.nextNode()) {
        if (n.nodeType === 1) {
          const el = n as Element
          if (el.shadowRoot) walk(el.shadowRoot)
          if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder && !el.value) {
            targets.push({ el, fg: getComputedStyle(el, '::placeholder').color, label: `placeholder:${el.placeholder}` })
          }
        } else if (n.nodeType === 3 && (n.textContent ?? '').trim()) {
          const el = n.parentElement
          if (!el || el.closest('svg, style, script, option, noscript')) continue
          targets.push({ el, fg: getComputedStyle(el).color, label: (n.textContent ?? '').trim().slice(0, 40) })
        }
      }
    }
    if (start.shadowRoot) walk(start.shadowRoot)
    walk(start)
    const groups = new Map<string, AuditRow>()
    let total = 0
    let minRatio = Infinity
    const nameOf = (el: Element): string => {
      const parts: string[] = []
      for (let n: Element | null = el, i = 0; n && i < 4; n = parentOf(n), i++) parts.unshift(`${n.localName}${typeof n.className === 'string' && n.className ? `.${n.className.split(' ')[0]}` : ''}`)
      return parts.join('>')
    }
    for (const { el, fg: fgCss, label } of targets) {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none' || opacityOf(el) === 0) continue
      if (isDisabled(el)) continue
      const bg = effectiveBg(el)
      if (bg === 'gradient') continue
      const fg = parse(fgCss)
      if (!fg || fg[3] === 0) continue
      const painted = over([fg[0], fg[1], fg[2], fg[3] * opacityOf(el)], bg)
      const r = Math.round(ratio(painted, bg) * 100) / 100
      total++
      minRatio = Math.min(minRatio, r)
      if (r >= 4.5) continue
      const fgKey = `rgb(${painted.slice(0, 3).map(Math.round).join(', ')})`
      const bgKey = `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`
      const key = `${fgKey}|${bgKey}|${r}`
      const row = groups.get(key) ?? { fg: fgKey, bg: bgKey, ratio: r, count: 0, sample: [], where: nameOf(el) }
      row.count++
      if (row.sample.length < 4) row.sample.push(label)
      groups.set(key, row)
    }
    return { total, minRatio: total === 0 ? 0 : Math.round(minRatio * 100) / 100, below45: [...groups.values()].sort((a, b) => a.ratio - b.ratio) }
  }, rootSelector)
}

async function run(browserType: BrowserType, engine: string, viewport: (typeof viewports)[number], theme: (typeof themes)[number]): Promise<void> {
  const sim = new ChoreographSim()
  const gw = new Gateway(sim)
  sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
  await sim.start()
  const browser = await browserType.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.phone ? 2 : 1,
    colorScheme: theme,
    ...(viewport.phone ? { isMobile: true, hasTouch: true } : {}),
  })
  // tsx keeps function names with an injected `__name` helper; the page has none, so a named function
  // inside `page.evaluate` (the contrast audit, `deepText`) needs one (see mithras-skin-proof.mts).
  await context.addInitScript('globalThis.__name = (f) => f')
  const page = await context.newPage()
  const report: RunReport = { engine, viewport: viewport.label, theme, checks: [], shots: [], audits: [], notes: {}, pageErrors: [], consoleErrors: [] }
  reports.push(report)
  const label = `${engine} ${viewport.label} ${theme}`
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
    if (!ok) process.stderr.write(`  FAIL [${label}] ${name} ${detail === undefined ? '' : JSON.stringify(detail)}\n`)
  }
  /** Where the screenshots of the lane that is running go: beside `evidence.json`, or in `skins/`. */
  let shotDir = ''
  /** A screenshot of the page, with `into` (when given) scrolled to the bottom edge of the view first: the Settings page scrolls inside itself, so on a phone the part that matters can be below the fold. */
  const shot = async (name: string, into?: string): Promise<void> => {
    if (into) {
      await page.locator(into).first().evaluate(element => element.scrollIntoView({ block: 'end', inline: 'nearest' })).catch(() => undefined)
      await page.waitForTimeout(120)
    }
    const file = `${shotDir}${name}-${engine}-${theme}-${viewport.label}.png`
    mkdirSync(dirname(resolve(shotsDir, file)), { recursive: true })
    await page.screenshot({ path: resolve(shotsDir, file) })
    report.shots.push(file)
  }
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => {
    // The checkout hung on purpose and the gateway's 404 for a route that is not there are not the page's errors.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) report.consoleErrors.push(message.text())
  })
  const text = async (selector: string): Promise<string> =>
    (await page.locator(selector).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  const count = (selector: string): Promise<number> => page.locator(selector).count()
  /** All the words under `selector`, through every shadow root, as one line. */
  const deepText = (selector: string): Promise<string> => page.evaluate(sel => {
    const words = (node: Element | ShadowRoot): string => {
      let out = ''
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) out += ` ${child.textContent ?? ''}`
        else if (child instanceof Element && !['STYLE', 'SCRIPT'].includes(child.tagName)) out += ` ${words(child)}`
      }
      return node instanceof Element && node.shadowRoot ? `${out} ${words(node.shadowRoot)}` : out
    }
    const start = document.querySelector(sel)
    return start ? words(start).replace(/\s+/g, ' ').trim() : ''
  }, selector)
  /**
   * Measure what a surface draws and keep the numbers in the evidence. For Hotdog Stand the skin's own rule is
   * held: a text run is under 4.5:1 only on Window red (light), never under 3:1, and none at all after hours.
   * Every other skin is measured and reported, not judged: they are not what this lane changed.
   */
  const audited = async (where: string, rootSelector: string, skin: string): Promise<void> => {
    const result = await textAudit(page, rootSelector)
    if (!result || result.total === 0) { check(`${where}: there are text runs to measure`, false, rootSelector); return }
    const exempt = result.below45.filter(row => skin === 'hotdog-stand' && theme === 'light' && row.bg === 'rgb(255, 0, 0)' && row.ratio >= 3)
    const violations = result.below45.filter(row => !exempt.includes(row))
    report.audits.push({
      where,
      skin,
      total: result.total,
      minRatio: result.minRatio,
      belowAA: result.below45.reduce((sum, row) => sum + row.count, 0),
      exempt: exempt.reduce((sum, row) => sum + row.count, 0),
      worst: violations.slice(0, 4),
    })
    if (skin === 'hotdog-stand') {
      check(`${where}: ${result.total} text runs measured and Hotdog Stand's rule holds (${theme === 'light' ? 'under 4.5:1 only on Window red, never under 3:1' : 'every run at 4.5:1 or better'})`, violations.length === 0, violations.slice(0, 6))
    }
  }
  /**
   * The balance line must not run into the header's other controls (the voice picker, the chat's buttons) nor
   * out of the panel. Its box and the controls' boxes are kept in the evidence under the scene's name.
   */
  const balanceLineClear = async (what: string): Promise<void> => {
    const found = await page.evaluate(() => {
      const deep = (selector: string, root: Document | ShadowRoot = document): HTMLElement | null => {
        const direct = root.querySelector<HTMLElement>(selector)
        if (direct) return direct
        for (const el of Array.from(root.querySelectorAll('*'))) {
          const hit = el.shadowRoot ? deep(selector, el.shadowRoot) : null
          if (hit) return hit
        }
        return null
      }
      const note = deep('[data-account-note]')
      if (!note) return null
      // The panel's own tree: the note's root (a shadow root, or the document when the panel renders in light DOM).
      const scope = note.getRootNode() as Document | ShadowRoot
      const panel = (scope instanceof ShadowRoot ? scope.host : note.closest('sh-chat-panel') ?? note.parentElement) as HTMLElement
      const round = (rect: DOMRect): number[] => [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)]
      const box = note.getBoundingClientRect()
      const controls: Array<{ name: string; box: number[] }> = []
      const overlaps: string[] = []
      for (const control of Array.from(scope.querySelectorAll('button, [role="button"]'))) {
        if (note.contains(control)) continue
        const rect = control.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        // Only the row the note is on: the header's controls, not the composer's or the messages'.
        if (rect.top > box.bottom + 8 || rect.bottom < box.top - 8) continue
        const name = (control.getAttribute('aria-label') ?? control.textContent ?? control.className).trim().replace(/\s+/g, ' ').slice(0, 28)
        controls.push({ name, box: round(rect) })
        const across = Math.min(rect.right, box.right) - Math.max(rect.left, box.left)
        const down = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)
        if (across > 1 && down > 1) overlaps.push(`${name} ${Math.round(across)}x${Math.round(down)}`)
      }
      const panelBox = panel.getBoundingClientRect()
      return { note: round(box), panel: round(panelBox), controls, overlaps, outside: box.left < panelBox.left - 1 || box.right > panelBox.right + 1 }
    })
    report.notes[`balance line: ${what}`] = found
    check(`the balance line clears the header's controls: ${what}`, found !== null && found.overlaps.length === 0 && !found.outside, found)
  }
  /** How far the page runs past the right edge of the view, and (when it does) what reaches past it, through every shadow root. */
  const pageOverflow = async (): Promise<{ over: number; offenders: Array<{ at: string; right: number }> }> => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over <= 0) return { over, offenders: [] }
    const offenders = await page.evaluate(() => {
      const edge = document.documentElement.clientWidth
      const found: Array<{ at: string; right: number; clipped: boolean }> = []
      const parentOf = (n: Element): Element | null => {
        const rootNode: Node = n.getRootNode()
        return n.parentElement ?? (rootNode instanceof ShadowRoot ? rootNode.host : null)
      }
      // An element past the edge that a scroller inside the view clips (the Settings strip of section buttons) is not what widens the page. A scroller
      // clips only what it contains: an absolutely positioned element escapes every scroller below its containing block (the Settings strip's visually
      // hidden labels were exactly that), so for one the scrollers count from its containing block upward.
      const isContainingBlock = (cs: CSSStyleDeclaration): boolean =>
        cs.position !== 'static' || cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || /paint|layout|strict|content/.test(cs.contain)
      const clipped = (el: Element): boolean => {
        const own = getComputedStyle(el).position
        let reached = own !== 'absolute' && own !== 'fixed'
        for (let n = parentOf(el); n; n = parentOf(n)) {
          const cs = getComputedStyle(n)
          if (!reached && isContainingBlock(cs)) reached = true
          if (reached && ['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX) && n.getBoundingClientRect().right <= edge + 0.5) return true
        }
        return false
      }
      const walk = (root: Document | ShadowRoot | Element): void => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.right > edge + 0.5) {
            const where: string[] = []
            let n: Element | null = el
            for (let i = 0; n && i < 3; i++) {
              where.unshift(`${n.localName}${typeof n.className === 'string' && n.className ? `.${n.className.split(' ')[0]}` : ''}`)
              n = parentOf(n)
            }
            found.push({ at: `${where.join('>')} (${getComputedStyle(el).position})`, right: Math.round(rect.right * 10) / 10, clipped: clipped(el) })
          }
          if (el.shadowRoot) walk(el.shadowRoot)
        }
      }
      walk(document)
      // The ones nothing clips first (they are the cause), then the rest.
      return found.sort((a, b) => Number(a.clipped) - Number(b.clipped) || b.right - a.right).slice(0, 6).map(({ at, right, clipped: c }) => ({ at: `${c ? '[clipped] ' : '[UNCLIPPED] '}${at}`, right }))
    })
    return { over, offenders }
  }
  const overflow = async (what: string): Promise<void> => {
    const { over, offenders } = await pageOverflow()
    check(`no horizontal overflow: ${what}`, over <= 0, over > 0 ? { over, offenders } : over)
  }
  /**
   * The house fonts are narrower on this laptop than on the build box's Linux (the box's first run of this witness: the Settings strip of section
   * buttons put the page 5 px wider at 390 px, where the laptop measured 0 to 2). A page that fits only in the narrow face is not fitted, so the
   * same page is measured again in a face wider than any the house ships (every font role the components read, set at the root).
   */
  const WIDE_FACE = 'Verdana, "DejaVu Sans", "Trebuchet MS", sans-serif'
  const widenFonts = async (): Promise<void> => {
    await page.evaluate(face => {
      const style = document.createElement('style')
      style.id = 'harness-wide-fonts'
      style.textContent = `:root { ${['utility', 'chrome', 'sans', 'serif', 'display'].map(role => `--mn-font-${role}: ${face} !important;`).join(' ')} }`
      document.head.append(style)
    }, WIDE_FACE)
    await page.waitForTimeout(200)
  }
  const unwidenFonts = async (): Promise<void> => {
    await page.evaluate(() => document.getElementById('harness-wide-fonts')?.remove())
    await page.waitForTimeout(100)
  }
  /** The credits' own content (Add credits, the history, the notice in them) stays inside the view, whatever the Settings chrome around it does. */
  const creditsClearOfEdge = async (what: string): Promise<void> => {
    const past = await page.evaluate(() => {
      const edge = document.documentElement.clientWidth
      const found: string[] = []
      const label = (el: Element): string => `${el.localName}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}`
      const walk = (root: ShadowRoot): void => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.right > edge + 0.5) found.push(`${label(el)} ${Math.round(rect.right * 10) / 10}`)
          if (el.shadowRoot) walk(el.shadowRoot)
        }
      }
      for (const host of Array.from(document.querySelectorAll('mn-add-credits, mn-credit-history'))) {
        if (host.getBoundingClientRect().right > edge + 0.5) found.push(`${label(host)} ${Math.round(host.getBoundingClientRect().right * 10) / 10}`)
        if (host.shadowRoot) walk(host.shadowRoot)
      }
      return found.slice(0, 6)
    })
    check(`the credits content stays inside the view: ${what}`, past.length === 0, past)
  }
  const load = async (params: Record<string, string>): Promise<void> => {
    // The first load of a cold dev server compiles the whole app's modules: give it time, then go fast.
    await page.goto(`${pageUrl}?${new URLSearchParams({ gateway: sim.base, graph: GRAPH, user: USER, theme, ...params })}`, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    await page.waitForFunction(() => (window as unknown as { __credits?: { ready?: boolean } }).__credits?.ready === true, undefined, { timeout: 240_000 })
    const boot = await page.evaluate(() => (window as unknown as { __credits: { error?: string } }).__credits.error ?? null)
    if (boot) check(`the page mounted (${params.scene})`, false, boot)
  }
  const credits = (): Promise<{ stripe: string[]; replaced: string[]; closed: number }> =>
    page.evaluate(() => (window as unknown as { __credits: { stripe: string[]; replaced: string[]; closed: number } }).__credits)
  const toast = (selector: string): Promise<{ message: string; description: string } | null> => page.evaluate(sel => {
    const node = document.body.querySelector(sel) as (HTMLElement & { message?: string; description?: string }) | null
    return node ? { message: node.message ?? '', description: node.description ?? '' } : null
  }, selector)

  const noticeSel = '.composer-notice[data-notice-id="credits-notice"]'
  /** The chat scene, once its first balance read has been taken (the balance line is what shows it). */
  const openChat = async (params: Record<string, string> = {}): Promise<void> => {
    await load({ scene: 'chat', ...params })
    await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
    await page.waitForSelector('[data-account-note]', { timeout: 15_000 }).catch(() => undefined)
  }
  const closeBilling = async (): Promise<void> => {
    await page.locator('button[aria-label="Close settings"]').click()
    await page.waitForFunction(() => !document.querySelector('.organism-settings-overlay'))
  }

  try {
    if (lanes.has('credits')) {
      // ───────── chat: the balance line, in each of its states, under each regime ─────────
      // The gate ENFORCING (after the flip): "Out of credits" is a fact the gate will act on. The gate OBSERVING
      // (today), or a backend old enough to say nothing of it: the line is a balance, and where the balance
      // could not pay for a message it offers Add credits and says "Running low"; no refusal is predicted.
      type Regime = 'enforce' | 'observe' | 'older'
      const NEVER_REFUSES = /Out of credits|refuse|Not enough/i
      const states: Array<{
        name: string
        regime: Regime
        set: () => void
        note: { label?: string; value?: string; button: boolean }
        /** What this regime must never say, in the line or in its tooltip. */
        never?: RegExp
      }> = [
        { name: 'normal', regime: 'enforce', set: () => { gw.balanceMicroUsd = 970_000 }, note: { label: 'Credit', value: '$0.97', button: false } },
        { name: 'low', regime: 'enforce', set: () => { gw.balanceMicroUsd = 210_000 }, note: { label: 'Running low', value: '$0.21', button: false } },
        { name: 'out', regime: 'enforce', set: () => { gw.balanceMicroUsd = 3_800 }, note: { label: 'Out of credits', value: '', button: true } },
        { name: 'refuses', regime: 'enforce', set: () => { gw.balanceMicroUsd = -600_000; gw.canMakeRequests = false }, note: { label: 'Out of credits', value: '', button: true } },
        { name: 'starter', regime: 'enforce', set: () => { gw.balanceMicroUsd = 1_000_000; gw.initialized = false }, note: { value: '$1.00 starter credit', button: false } },
        { name: 'unavailable', regime: 'enforce', set: () => { gw.balanceStatus = 503 }, note: { label: 'Credit', value: 'unavailable', button: false } },
        { name: 'observe-low', regime: 'observe', set: () => { gw.balanceMicroUsd = 210_000 }, note: { label: 'Running low', value: '$0.21', button: false }, never: NEVER_REFUSES },
        { name: 'observe-out', regime: 'observe', set: () => { gw.balanceMicroUsd = 3_800 }, note: { label: 'Running low', value: '$0.0038', button: true }, never: NEVER_REFUSES },
        { name: 'observe-would-refuse', regime: 'observe', set: () => { gw.balanceMicroUsd = -600_000; gw.canMakeRequests = false }, note: { label: 'Running low', value: '$0.00', button: true }, never: NEVER_REFUSES },
        { name: 'older-out', regime: 'older', set: () => { gw.balanceMicroUsd = 3_800 }, note: { label: 'Running low', value: '$0.0038', button: true }, never: NEVER_REFUSES },
      ]
      for (const state of states) {
        gw.reset()
        if (state.regime === 'enforce') gw.enforce()
        if (state.regime === 'older') gw.older()
        state.set()
        await load({ scene: 'chat' })
        await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
        await page.waitForSelector('[data-account-note]', { timeout: 15_000 }).catch(() => undefined)
        const note = await text('[data-account-note]')
        const expected = [state.note.label, state.note.value].filter(Boolean).join(' ')
        check(`balance line (${state.name}) reads "${expected}"`, note.startsWith(expected) || note === expected, note)
        check(`balance line (${state.name}) ${state.note.button ? 'offers' : 'does not offer'} Add credits`, (await count('[data-account-action="add-credits"]')) === (state.note.button ? 1 : 0))
        if (state.name === 'unavailable') {
          check('an unreadable balance is never shown as $0', !/\$0/.test(note), note)
        }
        if (state.never) {
          const hint = (await page.locator('[data-account-note]').first().getAttribute('title').catch(() => null)) ?? ''
          check(`balance line (${state.name}) predicts no refusal, in the line or in its tooltip`, !state.never.test(note) && !state.never.test(hint), { note, hint })
        }
        await shot(`chat-balance-${state.name}`)
        await overflow(`chat balance ${state.name}`)
        await balanceLineClear(`balance ${state.name}`)
      }

      // ───────── chat: a refusal, and the way to Billing ─────────
      // A 402 is the gate refusing a request, so it is an enforcing gate's: what the gate DID is said whatever its mode was.
      gw.reset()
      gw.enforce()
      gw.balanceMicroUsd = 3_800
      sim.invocation = () => REFUSED_402
      await load({ scene: 'chat' })
      await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
      await typeAndSend(page, ASK)
      await page.waitForSelector('.composer-notice[data-notice-id="billing-refusal"]', { timeout: 30_000 })
      const banner = await text('.composer-notice[data-notice-id="billing-refusal"]')
      check('the refusal says it in the billing report’s words', /You.re out of credits\. Your message is saved\. Add credits to continue\./.test(banner), banner)
      check('the refusal carries the balance and an Add credits button', /Balance \$0\.0038/.test(banner) && /Add credits/.test(banner), banner)
      check('the refusal is an alert, said once', (await page.locator('.composer-notice[role="alert"]').count()) === 1)
      check('the person’s words are back in the composer', (await page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first().innerText()).includes(ASK))
      check('no assistant message was invented for a refused turn', (await count('sh-chat-panel .message.assistant')) === 0)
      await shot('chat-refused-402')
      await overflow('the refusal')

      await page.locator('.composer-notice[data-notice-id="billing-refusal"] .banner-action').click()
      await page.waitForSelector('mn-add-credits [data-add-credits-submit]', { timeout: 30_000 })
      const opened = new URL(page.url())
      check('Add credits opens Settings, Billing in place (no page load) on the amount that covers the need',
        opened.pathname === '/settings' && opened.searchParams.get('settings') === 'billing' && opened.searchParams.get('topup') === '10', opened.search)
      check('…keeping the cell graph and the way back', opened.searchParams.get('graph') === GRAPH && (opened.searchParams.get('returnTo') ?? '').includes('credits-browser-harness.html'), opened.search)
      check('$10 is the preset that is armed', (await page.locator('mn-add-credits [data-amount="10"]').getAttribute('aria-pressed')) === 'true')
      check('the button names the amount', (await text('[data-add-credits-submit]')) === 'Add $10 in credits', await text('[data-add-credits-submit]'))
      check('the Billing overlay is on screen, covering the page', await page.evaluate(() => {
        const box = document.querySelector('.organism-settings-overlay')?.getBoundingClientRect()
        return box !== undefined && box.top === 0 && box.left === 0 && Math.round(box.width) === window.innerWidth && Math.round(box.height) === window.innerHeight
      }))
      check('the live chat is still in the page, inert beneath the overlay', await page.evaluate(() => {
        const surface = document.getElementById('surface') as HTMLElement
        return surface.inert === true && surface.querySelector('sh-chat-host') !== null
      }))
      await shot('chat-add-credits-opens-billing')
      await overflow('Billing over the chat')
      await page.locator('button[aria-label="Close settings"]').click()
      await page.waitForFunction(() => !document.querySelector('.organism-settings-overlay'))
      check('closing Billing returns to the same conversation with the message still kept', (await page.locator('sh-chat-panel hoja-editor [contenteditable="true"]').first().innerText()).includes(ASK))
      check('…and the refusal is still on screen', (await count('.composer-notice[data-notice-id="billing-refusal"]')) === 1)
      check('…and the page was never reloaded to get there', (await credits()).closed === 1)
      await shot('chat-back-from-billing')

      // the balance line's own button takes the same road, whether the gate enforces ("Out of credits") or observes ("Running low")
      sim.invocation = () => undefined
      for (const regime of ['enforce', 'observe'] as const) {
        gw.reset()
        if (regime === 'enforce') gw.enforce()
        gw.balanceMicroUsd = 3_800
        await load({ scene: 'chat' })
        await page.waitForSelector('[data-account-action="add-credits"]', { timeout: 30_000 })
        await page.locator('[data-account-action="add-credits"]').click()
        await page.waitForSelector('mn-add-credits [data-add-credits-submit]', { timeout: 30_000 })
        check(`the balance line’s Add credits (${regime}) opens Billing on the same default`, (await page.locator('mn-add-credits [data-amount="10"]').getAttribute('aria-pressed')) === 'true')
        await page.locator('button[aria-label="Close settings"]').click()
        await page.waitForFunction(() => !document.querySelector('.organism-settings-overlay'))
      }

      // ───────── chat: the credits notice, from what the backend says ─────────
      // The day and the fee are the BACKEND's: this build says nothing of either until a balance read brings it.
      // A wording this person put away in an earlier scene must not hide this one: the scenes below own the storage.
      await page.evaluate(() => localStorage.clear())

      // 1. today, before the backend has named a day: observing, 15%, and no notice at all
      gw.reset()
      await openChat()
      await page.waitForTimeout(300)
      check('until the backend names a day there is no notice at all: absent until it is set', (await count(noticeSel)) === 0)
      check('…and the balance line is as it was', (await text('[data-account-note]')).startsWith('Credit $0.97'), await text('[data-account-note]'))

      // 2. the backend names the day (observing, 15%)
      gw.creditsStartDate = START_ISO
      await openChat()
      await page.waitForSelector(noticeSel, { timeout: 30_000 })
      const heads = await text(noticeSel)
      check('once the backend names the day, the heads-up names it in words', heads.includes(`Credits start on ${START_READ}.`), heads)
      check('…and states the fee the backend states today: 15%', heads.includes('plus a 15% service fee') && !heads.includes('20%'), heads)
      check('…as a quiet status, not an alert', (await page.locator('.composer-notice[role="status"]').count()) === 1 && (await page.locator('.composer-notice[role="alert"]').count()) === 0)
      const headsButtons = await page.locator(`${noticeSel} button`).allInnerTexts()
      check('…with Details and Dismiss, and nothing else', JSON.stringify(headsButtons.map(item => item.trim())) === JSON.stringify(['Details', 'Dismiss']), headsButtons)
      check('…and never says that credits do not expire', !/expir/i.test(heads), heads)
      await shot('chat-notice')
      await overflow('the credits notice')
      await page.locator(`${noticeSel} .banner-action:not([data-notice-dismiss])`).click()
      await page.waitForSelector('mn-add-credits [data-credits-notice]', { timeout: 30_000 })
      const aside = await text('mn-add-credits [data-credits-notice]')
      check('Details opens Billing, where the whole notice is (the minimum, the 15% fee, non-refundable)', /from \$5/.test(aside) && /15% service fee/.test(aside) && /non-refundable/.test(aside), aside)
      check(`…ending with where questions go: ${CONTACT}`, aside.endsWith(`Questions or problems: ${CONTACT}.`), aside)
      check('…and nothing about credits expiring', !/expir/i.test(aside), aside)
      check('…with nothing armed: looking is not buying', (await page.locator('mn-add-credits [aria-pressed="true"]').count()) === 0 && await page.locator('[data-add-credits-submit]').isDisabled())
      check('Billing states the same 15% in its own fee line', (await text('[data-fee-note]')) === "You pay the model's price plus a 15% service fee. Credits are prepaid and non-refundable.", await text('[data-fee-note]'))
      await shot('chat-notice-details-billing')
      await closeBilling()

      // 3. the flip: the gate enforces and the fee is 20%. Nothing is rebuilt or republished: the same SPA reads it off the balance.
      gw.enforce()
      await openChat()
      await page.waitForSelector(noticeSel, { timeout: 30_000 })
      const flipped = await text(noticeSel)
      check('after the flip the same notice states the 20% the backend now states, and no 15%', flipped.includes('plus a 20% service fee') && !flipped.includes('15%'), flipped)
      check('…on the same day', flipped.includes(`Credits start on ${START_READ}.`), flipped)
      await shot('chat-notice-after-flip')
      await page.locator(`${noticeSel} .banner-action:not([data-notice-dismiss])`).click()
      await page.waitForSelector('mn-add-credits [data-credits-notice]', { timeout: 30_000 })
      check('…and Billing states the 20% in the notice and in its fee line', /20% service fee/.test(await text('mn-add-credits [data-credits-notice]')) && (await text('[data-fee-note]')) === "You pay the model's price plus a 20% service fee. Credits are prepaid and non-refundable.", await text('[data-fee-note]'))
      await closeBilling()

      // 4. put away for good by the person who put it away
      await page.locator(`${noticeSel} [data-notice-dismiss]`).click()
      await page.locator(noticeSel).waitFor({ state: 'detached', timeout: 10_000 })
      check('Dismiss puts the heads-up away', (await count(noticeSel)) === 0)
      await page.reload()
      await page.waitForFunction(() => (window as unknown as { __credits?: { ready?: boolean } }).__credits?.ready === true, undefined, { timeout: 60_000 })
      await page.waitForSelector('sh-chat-panel .composer', { timeout: 30_000 })
      await page.waitForSelector('[data-account-note]', { timeout: 15_000 }).catch(() => undefined)
      await page.waitForTimeout(500)
      check('…for good: a reload does not bring it back', (await count(noticeSel)) === 0)

      // 5. a day the backend moves is a new notice
      gw.creditsStartDate = MOVED_ISO
      await openChat()
      await page.waitForSelector(noticeSel, { timeout: 30_000 })
      check('a day the backend moves is a new notice: told again, with the new day', (await text(noticeSel)).includes(`Credits start on ${MOVED_READ}.`), await text(noticeSel))

      // 6. a day the backend takes away takes the notice with it
      gw.creditsStartDate = undefined
      await openChat()
      await page.waitForTimeout(300)
      check('a day the backend takes away takes the notice with it', (await count(noticeSel)) === 0)

      // 7. an older backend says none of it: no notice, and a balance line as it always was
      gw.older()
      await openChat()
      await page.waitForTimeout(300)
      check('an older backend that says none of it gets no notice, and the same balance line', (await count(noticeSel)) === 0 && (await text('[data-account-note]')).startsWith('Credit $0.97'), await text('[data-account-note]'))
      check('…and no brace or placeholder reaches the page', !/[{}]|undefined|NaN/.test(await deepText('#rail')), await deepText('#rail'))

      // ───────── billing ─────────
      // An older backend names no fee: the line says only what is certain, and no notice is shown. No number is guessed.
      gw.reset()
      gw.older()
      await load({ scene: 'settings' })
      await page.waitForSelector('[data-add-credits-submit]', { timeout: 30_000 })
      check('an older backend names no fee, so the fee line states none and keeps what is certain', (await text('[data-fee-note]')) === 'Credits are prepaid and non-refundable.', await text('[data-fee-note]'))
      check('…and Billing shows no notice for it', (await count('mn-add-credits [data-credits-notice]')) === 0)
      await shot('billing-older-backend', '[data-add-credits-submit]')

      gw.reset()
      gw.initialized = false
      gw.balanceMicroUsd = 1_000_000
      await load({ scene: 'settings' })
      await page.waitForSelector('[data-add-credits-submit]', { timeout: 30_000 })
      check('a fresh account shows the starter credit, not "Not initialized"', (await count('text=$1.00 starter credit')) >= 1 && (await count('text=Not initialized')) === 0)
      check('there is no Manage billing button and no portal apology', (await page.getByRole('button', { name: 'Manage billing' }).count()) === 0 && (await count('text=No billing portal')) === 0)
      check('the copy states the 15% fee the backend states today, and what a credit is', (await text('[data-fee-note]')) === "You pay the model's price plus a 15% service fee. Credits are prepaid and non-refundable.", await text('[data-fee-note]'))
      check('…and Billing never says that credits expire', !/expir/i.test(await deepText('#settings-root')), await deepText('#settings-root'))
      check('the presets are $5, $10, $25 and $50', JSON.stringify(await page.locator('mn-add-credits [data-amount]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-amount')))) === JSON.stringify(['5', '10', '25', '50']))
      check('whole dollars from $5 to $200 is said', (await text('mn-add-credits .hint')) === 'Whole dollars, $5 to $200.', await text('mn-add-credits .hint'))
      check('no credit history while the deployment has none (the list is hidden, not apologised for)', (await count('mn-credit-history [data-credit-history]')) === 0)
      check('nothing is armed until the person chooses, and the button says so', await page.locator('[data-add-credits-submit]').isDisabled() && (await text('[data-add-credits-submit]')) === 'Add credits')
      await shot('billing-fresh')
      await overflow('Billing, a fresh account')
      await widenFonts()
      await overflow('Billing, a fresh account, in a face wider than the house fonts')
      await unwidenFonts()
      await shot('billing-add-credits', '[data-add-credits-submit]')

      await page.locator('[data-amount="25"]').click()
      check('a preset arms the amount in the button', (await text('[data-add-credits-submit]')) === 'Add $25 in credits')
      await shot('billing-preset-25', '[data-add-credits-submit]')

      await page.locator('[data-custom-amount]').fill('4')
      check('$4 says the minimum and cannot be sent', (await text('[data-amount-error]')) === 'The minimum top-up is $5.' && await page.locator('[data-add-credits-submit]').isDisabled(), await text('[data-amount-error]'))
      await shot('billing-custom-4', '[data-add-credits-submit]')
      await page.locator('[data-custom-amount]').fill('201')
      check('$201 says the most', (await text('[data-amount-error]')) === 'The most you can add at once is $200.', await text('[data-amount-error]'))
      await shot('billing-custom-201', '[data-add-credits-submit]')
      await page.locator('[data-custom-amount]').fill('12.5')
      check('cents are refused in words', (await text('[data-amount-error]')) === 'Enter a whole-dollar amount.', await text('[data-amount-error]'))
      await page.locator('[data-custom-amount]').fill('37')
      check('a whole-dollar amount in range is named in the button', (await text('[data-add-credits-submit]')) === 'Add $37 in credits' && await page.locator('[data-add-credits-submit]').isEnabled())

      // keyboard order, focus ring, touch targets
      await page.locator('[data-amount="5"]').focus()
      const order: string[] = []
      const active = (): Promise<{ id: string; ring: boolean }> => page.evaluate(() => {
        let el: Element | null = document.activeElement
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
        const node = el as HTMLElement | null
        const id = node ? (node.dataset.amount ? `amount:${node.dataset.amount}` : node.hasAttribute('data-custom-amount') ? 'custom' : node.hasAttribute('data-add-credits-submit') ? 'submit' : node.hasAttribute('data-history-more') ? 'history-more' : node.tagName.toLowerCase()) : 'none'
        return { id, ring: node ? getComputedStyle(node).boxShadow !== 'none' : false }
      })
      const rings: boolean[] = []
      // Safari's default is that Tab skips buttons (Full Keyboard Access is off); Option+Tab is its way to every control.
      const next = engine === 'webkit' ? 'Alt+Tab' : 'Tab'
      for (let step = 0; step < 6; step += 1) {
        const now = await active()
        order.push(now.id)
        rings.push(now.ring)
        await page.keyboard.press(next)
      }
      check('Tab reaches the presets, the amount field and Add, in that order', JSON.stringify(order) === JSON.stringify(['amount:5', 'amount:10', 'amount:25', 'amount:50', 'custom', 'submit']), order)
      // The first was focused by script, which a browser does not count as keyboard; every one reached by Tab is.
      check('each one reached by Tab shows a focus ring', rings.slice(1).every(Boolean), rings)
      const heights = await page.evaluate(() => {
        const root = document.querySelector('mn-add-credits')!.shadowRoot!
        return ['[data-amount="5"]', '[data-custom-amount]', '[data-add-credits-submit]'].map(selector => Math.round(root.querySelector(selector)!.getBoundingClientRect().height))
      })
      check('the presets, the amount field and Add are at least 40 px tall', heights.every(height => height >= 40), heights)

      // pending, refused, and the checkout the gateway accepts
      await page.locator('[data-amount="10"]').click()
      gw.checkout = () => ({ hang: true })
      await page.locator('[data-add-credits-submit]').click()
      await page.waitForFunction(() => document.querySelector('mn-add-credits')?.shadowRoot?.querySelector('[data-add-credits-submit]')?.textContent?.includes('Opening checkout'))
      check('while the checkout is made the button says so and cannot be pressed twice', (await text('[data-add-credits-submit]')) === 'Opening checkout…' && await page.locator('[data-add-credits-submit]').isDisabled())
      await shot('billing-pending', '[data-add-credits-submit]')
      await load({ scene: 'settings' })
      await page.waitForSelector('[data-add-credits-submit]', { timeout: 30_000 })
      gw.checkout = () => ({ status: 400, body: { error: 'top-up must be a whole number of dollars from 5 to 200', code: 'topup_amount_out_of_range' } })
      await page.locator('[data-amount="10"]').click()
      await page.locator('[data-add-credits-submit]').click()
      await page.waitForSelector('[data-checkout-error]', { timeout: 15_000 })
      check('a refused checkout is said in the SPA’s own words, as an alert, and the button is back', (await text('[data-checkout-error]')).startsWith("That amount can't be charged") && await page.locator('[data-checkout-error][role="alert"]').count() === 1 && await page.locator('[data-add-credits-submit]').isEnabled(), await text('[data-checkout-error]'))
      check('…and never echoes the gateway’s prose', !(await text('[data-checkout-error]')).includes('whole number of dollars from 5 to 200'))
      await shot('billing-checkout-refused', '[data-checkout-error]')
      gw.checkout = () => ({ status: 200, body: { url: STRIPE, checkout_url: STRIPE } })
      await page.locator('[data-add-credits-submit]').click()
      await page.waitForFunction(() => (window as unknown as { __credits: { stripe: string[] } }).__credits.stripe.length > 0, undefined, { timeout: 15_000 })
      const checkoutCall = gw.calls('/billing/checkout', 'POST').at(-1)
      check('the checkout body is exactly what the gateway takes: a top-up of 1000 cents', JSON.stringify(checkoutCall?.body) === JSON.stringify({ kind: 'topup', amountCents: 1000 }), checkoutCall?.body)
      check('…carrying the person’s bearer', checkoutCall?.headers.authorization === 'Bearer harness-token', checkoutCall?.headers.authorization ? 'present' : 'absent')
      const sent = await credits()
      check('the browser is sent to Stripe’s checkout host and nowhere else', sent.stripe.length === 1 && new URL(sent.stripe[0]).host === 'checkout.stripe.com', sent.stripe)
      check('it left a marker for the return, in this tab only', await page.evaluate(() => sessionStorage.getItem('shrubbery.checkout.pending.v1') !== null))
      check('…and not in storage that outlives the tab', await page.evaluate(() => localStorage.getItem('shrubbery.checkout.pending.v1') === null))

      // ───────── the return: a payment that lands ─────────
      const before = gw.balanceMicroUsd
      gw.history = () => ({ status: 200, body: historyBody([], null) })
      await load({ scene: 'settings', checkout: 'success', poll: '150:40' })
      await page.waitForSelector('mn-toast[data-checkout-return="success"]', { timeout: 15_000 })
      const received = await toast('mn-toast[data-checkout-return="success"]')
      check('the return says the payment was received and the credits are on the way', received?.message === 'Payment received. Your credits are on the way.', received)
      check('the return scrubbed the Stripe marker from the URL', (await credits()).replaced.some(url => !url.includes('checkout=')))
      await shot('return-success-pending')
      gw.history = request => request.query.get('after')
        ? { status: 200, body: historyBody(EARLIER, null) }
        : { status: 200, body: historyBody([{ id: 'h_new1', kind: 'top-up', ts: Date.now(), amountMicroUsd: 10_000_000, label: 'Credits added', reason: null }, ...ENTRIES], null) }
      // The webhook lands: the ledger now has a row, so the account is no longer "uninitialized".
      gw.initialized = true
      gw.balanceMicroUsd = before + 10_000_000
      await page.waitForSelector('mn-toast[data-checkout-result="credited"]', { timeout: 15_000 })
      const credited = await toast('mn-toast[data-checkout-result="credited"]')
      check('when the balance rises, it says "Credits added" with the balance', credited?.message === 'Credits added' && credited.description === 'Your balance is $11.00.', credited)
      await page.waitForFunction(() => document.body.querySelectorAll('mn-toast').length === 1, undefined, { timeout: 5_000 }).catch(() => undefined)
      check('…as the one message on screen: it took the place of "on the way", it did not cover it', (await count('mn-toast')) === 1 && (await count('mn-toast[data-checkout-return]')) === 0, await count('mn-toast'))
      await page.waitForSelector('mn-credit-history [data-credit-entry]', { timeout: 15_000 })
      check('…and the history shows the top-up that landed', (await page.locator('mn-credit-history [data-credit-entry]').first().innerText()).replace(/\s+/g, ' ').includes('+$10.00'), await text('mn-credit-history [data-credit-entry]'))
      check('the balance tile reads the new balance, no longer called a starter credit', (await count('text=$11.00')) >= 1 && (await count('text=starter credit')) === 0)
      await shot('return-success-credited')
      await overflow('the return')
      await shot('return-success-credited-history', 'mn-credit-history')

      // ───────── the return: a payment that has not landed ─────────
      gw.reset()
      gw.history = () => ({ status: 404, body: { error: 'not found', code: 'not_found' } })
      await load({ scene: 'settings' })
      await page.waitForSelector('[data-add-credits-submit]', { timeout: 30_000 })
      await page.locator('[data-amount="25"]').click()
      await page.locator('[data-add-credits-submit]').click()
      await page.waitForFunction(() => (window as unknown as { __credits: { stripe: string[] } }).__credits.stripe.length > 0, undefined, { timeout: 15_000 })
      await load({ scene: 'settings', checkout: 'success', poll: '100:6' })
      await page.waitForSelector('mn-toast[data-checkout-result="late"]', { timeout: 15_000 })
      const late = await toast('mn-toast[data-checkout-result="late"]')
      check('a payment that has not landed says so, and how to check again, without claiming a failure', late?.message === 'Your credits have not arrived yet' && /Reload this page in a moment/.test(late.description), late)
      await shot('return-success-late')

      // ───────── the return: cancelled ─────────
      await load({ scene: 'settings', checkout: 'cancel' })
      await page.waitForSelector('mn-toast[data-checkout-return="cancel"]', { timeout: 15_000 })
      check('a cancelled checkout is quiet', (await toast('mn-toast[data-checkout-return="cancel"]'))?.message === 'Checkout cancelled')
      await shot('return-cancelled')

      // ───────── credit history ─────────
      gw.reset()
      gw.history = request => request.query.get('after')
        ? { status: 200, body: historyBody(EARLIER, null) }
        : { status: 200, body: historyBody(ENTRIES, 'WzE3OTAwMDAwMDAwMDAsImFiYyJd') }
      await load({ scene: 'settings' })
      await page.waitForSelector('mn-credit-history [data-credit-entry]', { timeout: 30_000 })
      const rows = (await page.locator('mn-credit-history [data-credit-entry]').allInnerTexts()).map(row => row.replace(/\s+/g, ' ').trim())
      check('the history lists date, words and a signed amount, newest first', rows.length === 3 && rows[0].includes('Refund') && rows[0].includes('-$5.00') && rows[1].includes('Credits added by Sophia') && rows[1].includes('+$0.85') && rows[2].includes('+$10.00'), rows)
      check('a refund is marked by its sign, not by colour alone', rows[0].includes('-$5.00') && (await page.locator('mn-credit-history [data-credit-entry][data-direction="out"]').count()) === 1)
      check('no id of any kind is shown', !rows.join(' ').includes('h_'), rows)
      await shot('history-entries', 'mn-credit-history')
      await overflow('Billing with history')
      const moreHeight = await page.evaluate(() => Math.round(document.querySelector('mn-credit-history')!.shadowRoot!.querySelector('[data-history-more]')!.getBoundingClientRect().height))
      check('"Show earlier" is at least 40 px tall', moreHeight >= 40, moreHeight)
      await page.locator('mn-credit-history [data-history-more]').click()
      await page.waitForFunction(() => (document.querySelector('mn-credit-history')?.shadowRoot?.querySelectorAll('[data-credit-entry]').length ?? 0) === 4)
      const paged = gw.calls('/billing/credits/history', 'GET').at(-1)
      check('"Show earlier" asks for the next page with the cursor the gateway gave, as `after`', paged?.query.get('after') === 'WzE3OTAwMDAwMDAwMDAsImFiYyJd', paged?.query.toString())
      check('…and the list grows by the earlier entries, with no button left', (await count('mn-credit-history [data-history-more]')) === 0)
      await shot('history-more', 'mn-credit-history')

      gw.history = () => ({ status: 200, body: historyBody([], null) })
      await load({ scene: 'settings' })
      await page.waitForSelector('mn-credit-history [data-history-empty]', { timeout: 30_000 })
      check('an account with no activity is told so', (await text('mn-credit-history [data-history-empty]')) === 'No credit activity yet.')
      await shot('history-empty', 'mn-credit-history')

      gw.history = () => ({ status: 500, body: { error: 'x' } })
      await load({ scene: 'settings' })
      await page.waitForSelector('mn-credit-history [data-history-error]', { timeout: 30_000 })
      check('a failed read says so and offers to try again', /could not be loaded/.test(await text('mn-credit-history [data-history-error]')) && (await count('mn-credit-history [data-history-retry]')) === 1, await text('mn-credit-history [data-history-error]'))
      await shot('history-failed', 'mn-credit-history')
      gw.history = () => ({ status: 200, body: historyBody(ENTRIES, null) })
      await page.locator('mn-credit-history [data-history-retry]').click()
      await page.waitForSelector('mn-credit-history [data-credit-entry]', { timeout: 15_000 })
      check('Try again reads it', (await count('mn-credit-history [data-credit-entry]')) === 3)
    }

    if (lanes.has('skins')) {
      shotDir = 'skins/'
      const SKINS = ['garden', 'emporium', '98', 'glass', 'mithras', 'hotdog-stand']
      const LABELS = ['Garden', 'Sophia', '98', 'Glass', 'Mithras', 'Hotdog Stand']
      const HDS = 'hotdog-stand'
      const labelOf = (skin: string): string => LABELS[SKINS.indexOf(skin)] ?? skin
      const skinOf = (): Promise<{ root: string; body: string; applied: string; heard: string[] }> => page.evaluate(() => {
        const credits = (window as unknown as { __credits: { skin: string; skinEvents: string[] } }).__credits
        return {
          root: document.documentElement.dataset.skin ?? 'garden',
          body: document.body.dataset.skin ?? 'garden',
          applied: credits.skin,
          heard: credits.skinEvents.slice(),
        }
      })
      /** What the credits controls on Billing are drawn as, read from the live cascade. */
      const look = (): Promise<Record<string, string>> => page.evaluate(() => {
        const root = document.querySelector('mn-add-credits')?.shadowRoot
        const css = (el: Element | null | undefined, prop: string): string => (el ? getComputedStyle(el).getPropertyValue(prop) : '')
        const amount = root?.querySelector('[data-amount="10"]')
        return {
          amountBackground: css(amount, 'background-color'),
          amountInk: css(amount, 'color'),
          noticeBackground: css(root?.querySelector('[data-credits-notice]'), 'background-color'),
          feeInk: css(root?.querySelector('[data-fee-note]'), 'color'),
        }
      })
      const trigger = page.locator('mn-top-bar mn-skin-picker button.trigger')
      /**
       * Choose a skin the way this viewport's person does: the picker in the bar of a desktop; on a phone, where
       * the bar has always folded it, the Skin drop-down in Settings, Appearance, and then back to Billing.
       */
      const chooseSkin = async (skin: string): Promise<void> => {
        if (!viewport.phone) {
          await trigger.click()
          await page.locator(`mn-top-bar mn-skin-picker [data-menu-item-id="${skin}"]`).click()
        } else {
          await page.locator('mn-settings-page [data-section-id="appearance"]').click()
          await page.locator('mn-settings-page').getByLabel('Skin', { exact: true }).selectOption(skin)
          await page.locator('mn-settings-page [data-section-id="billing"]').click()
          await page.waitForSelector('mn-add-credits [data-add-credits-submit]', { timeout: 15_000 })
        }
        await page.waitForFunction(expected => (window as unknown as { __credits: { skin: string } }).__credits.skin === expected, skin, { timeout: 10_000 })
        await page.waitForTimeout(150)
      }

      // ───────── skins: the picker in the Billing page's own bar ─────────
      // The gate enforcing, the day named, an account that cannot pay for a message, and a history to show.
      gw.reset()
      gw.enforce()
      gw.creditsStartDate = START_ISO
      gw.balanceMicroUsd = 3_800
      gw.history = () => ({ status: 200, body: historyBody(ENTRIES, null) })
      await load({ scene: 'settings' })
      await page.waitForSelector('mn-credit-history [data-credit-entry]', { timeout: 30_000 })
      await page.waitForSelector('mn-add-credits [data-credits-notice]', { timeout: 15_000 })
      check('Billing starts in Garden', (await skinOf()).root === 'garden', await skinOf())
      if (!viewport.phone) {
        check('the Billing page’s bar carries the skin picker, naming the skin that is on', (await trigger.getAttribute('aria-label')) === 'Visual style: Garden', await trigger.getAttribute('aria-label'))
        await trigger.focus()
        await page.keyboard.press('ArrowUp')
        const items = page.locator('mn-top-bar mn-skin-picker [data-menu-item-id]')
        await items.first().waitFor({ state: 'visible', timeout: 5_000 })
        const ids = await items.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.menuItemId))
        const labels = await items.evaluateAll(nodes => nodes.map(node => node.querySelector('.item-label')?.textContent?.trim()))
        check('ArrowUp opens the list of every skin, by its label, Hotdog Stand last', ids.join() === SKINS.join() && labels.join() === LABELS.join(), { ids, labels })
        check('…with the keyboard on the last one, Hotdog Stand', (await items.evaluateAll(nodes => nodes.findIndex(node => node.classList.contains('focused')))) === SKINS.length - 1)
        await shot('picker-open-over-billing')
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => (window as unknown as { __credits: { skin: string } }).__credits.skin === 'hotdog-stand', undefined, { timeout: 10_000 })
        await page.waitForTimeout(150)
        const chosen = await skinOf()
        check('Enter chooses Hotdog Stand: the root, the body and the page agree, and the picker said so once', chosen.root === HDS && chosen.body === HDS && chosen.applied === HDS && chosen.heard.join() === HDS, chosen)
        check('…and the picker names the skin that is on', (await trigger.getAttribute('aria-label')) === 'Visual style: Hotdog Stand', await trigger.getAttribute('aria-label'))
      } else {
        const folded = await page.evaluate(() => {
          const picker = document.querySelector('mn-top-bar')?.shadowRoot?.querySelector('mn-skin-picker') as HTMLElement | null
          return picker ? getComputedStyle(picker).display : null
        })
        check('on a phone the bar folds the picker, as it always folded the skin control', folded === 'none', folded)
        await chooseSkin(HDS)
        const chosen = await skinOf()
        check('…and Settings, Appearance, Skin chooses Hotdog Stand: the root, the body and the page agree', chosen.root === HDS && chosen.body === HDS && chosen.applied === HDS, chosen)
      }
      await page.waitForSelector('mn-add-credits [data-credits-notice]', { timeout: 15_000 })
      await page.locator('[data-amount="10"]').click()
      await shot('billing-hotdog-stand-add-credits', '[data-add-credits-submit]')
      check('in Hotdog Stand the amount is armed and named in the button', (await text('[data-add-credits-submit]')) === 'Add $10 in credits' && await page.locator('[data-add-credits-submit]').isEnabled())

      // ───────── skins: all six, chosen through the picker, with Billing drawn in each ─────────
      const looks: Record<string, Record<string, string>> = {}
      for (const skin of SKINS) {
        await chooseSkin(skin)
        const now = await skinOf()
        check(`the picker chooses ${labelOf(skin)}: the root, the body and the page agree`, now.root === skin && now.body === skin && now.applied === skin, now)
        if (!viewport.phone) check(`…and names it: "Visual style: ${labelOf(skin)}"`, (await trigger.getAttribute('aria-label')) === `Visual style: ${labelOf(skin)}`, await trigger.getAttribute('aria-label'))
        await page.waitForSelector('mn-add-credits [data-credits-notice]', { timeout: 15_000 })
        await page.waitForSelector('mn-credit-history [data-credit-entry]', { timeout: 15_000 })
        await page.locator('[data-amount="10"]').click()
        await page.waitForTimeout(150)
        await shot(`billing-skin-${skin}`)
        await overflow(`Billing in ${labelOf(skin)}`)
        await creditsClearOfEdge(`Billing in ${labelOf(skin)}`)
        await widenFonts()
        await overflow(`Billing in ${labelOf(skin)}, in a face wider than the house fonts`)
        await unwidenFonts()
        await audited(`Billing (${skin})`, '#settings-root', skin)
        looks[skin] = await look()
      }
      report.notes.looks = looks
      check('Hotdog Stand reaches the credits controls: they are not drawn as Garden draws them', JSON.stringify(looks[HDS]) !== JSON.stringify(looks.garden), { garden: looks.garden, hotdogStand: looks[HDS] })
      const heardInOrder = (await skinOf()).heard
      check('every choice was said by the picker once, in the order it was made', heardInOrder.join() === (viewport.phone ? [] : [HDS, ...SKINS]).join(), heardInOrder)

      // ───────── skins: Hotdog Stand on the chat's credits surfaces ─────────
      // The way a person who chose it last visit meets them: the page starts in it. The gate enforcing, the day named.
      await page.evaluate(() => localStorage.clear())
      gw.reset()
      gw.enforce()
      gw.creditsStartDate = START_ISO
      gw.balanceMicroUsd = 3_800
      sim.invocation = () => REFUSED_402
      await openChat({ skin: HDS })
      await page.waitForSelector(noticeSel, { timeout: 30_000 })
      check('the chat starts in Hotdog Stand', (await skinOf()).root === HDS, await skinOf())
      check('"Out of credits" and Add credits read in Hotdog Stand too', (await text('[data-account-note]')).startsWith('Out of credits') && (await count('[data-account-action="add-credits"]')) === 1, await text('[data-account-note]'))
      check('the notice names the day and the 20% in Hotdog Stand', (await text(noticeSel)).includes(`Credits start on ${START_READ}.`) && (await text(noticeSel)).includes('20% service fee'), await text(noticeSel))
      await shot('chat-hotdog-stand-out-and-notice')
      await overflow('the chat in Hotdog Stand')
      await balanceLineClear('"Out of credits" in Hotdog Stand')
      await audited('chat (the balance line and the notice)', '#rail', HDS)
      await typeAndSend(page, ASK)
      await page.waitForSelector('.composer-notice[data-notice-id="billing-refusal"]', { timeout: 30_000 })
      await shot('chat-hotdog-stand-refused-402')
      await overflow('the refusal in Hotdog Stand')
      await audited('chat (the 402 banner)', '#rail', HDS)
      await page.locator('.composer-notice[data-notice-id="billing-refusal"] .banner-action').click()
      await page.waitForSelector('mn-add-credits [data-add-credits-submit]', { timeout: 30_000 })
      await page.waitForTimeout(250)
      check('Billing opens over the chat in Hotdog Stand', (await skinOf()).root === HDS)
      if (!viewport.phone) check('…and the picker in its bar names Hotdog Stand', (await trigger.getAttribute('aria-label')) === 'Visual style: Hotdog Stand', await trigger.getAttribute('aria-label'))
      await shot('chat-hotdog-stand-billing-over-chat')
      await audited('Billing over the chat', '.organism-settings-overlay', HDS)
      await closeBilling()

      // observing (today): "Running low" and Add credits, never a refusal, in Hotdog Stand
      await page.evaluate(() => localStorage.clear())
      sim.invocation = () => undefined
      gw.reset()
      gw.creditsStartDate = START_ISO
      gw.balanceMicroUsd = 3_800
      await openChat({ skin: HDS })
      await page.waitForSelector(noticeSel, { timeout: 30_000 })
      check('observing, the line reads "Running low" with Add credits in Hotdog Stand, and the notice states 15%', (await text('[data-account-note]')).startsWith('Running low') && (await count('[data-account-action="add-credits"]')) === 1 && (await text(noticeSel)).includes('15% service fee'), await text('[data-account-note]'))
      await shot('chat-hotdog-stand-observe-low-and-notice')
      await balanceLineClear('"Running low" with Add credits in Hotdog Stand')
      await audited('chat (observing: Running low and the notice)', '#rail', HDS)

      // the return toasts, in Hotdog Stand
      gw.reset()
      gw.history = () => ({ status: 200, body: historyBody([], null) })
      const before = gw.balanceMicroUsd
      await load({ scene: 'settings', checkout: 'success', poll: '150:40', skin: HDS })
      await page.waitForSelector('mn-toast[data-checkout-return="success"]', { timeout: 15_000 })
      await page.waitForTimeout(200)
      await shot('return-toast-on-the-way-hotdog-stand')
      await audited('the return toast (on the way)', 'mn-toast[data-checkout-return="success"]', HDS)
      gw.initialized = true
      gw.balanceMicroUsd = before + 10_000_000
      await page.waitForSelector('mn-toast[data-checkout-result="credited"]', { timeout: 15_000 })
      await page.waitForTimeout(200)
      await shot('return-toast-credited-hotdog-stand')
      await audited('the credited toast', 'mn-toast[data-checkout-result="credited"]', HDS)
      shotDir = ''
    }

    check('every request to the account wire carried the bearer', gw.requests.every(request => request.method === 'OPTIONS' || request.headers.authorization === 'Bearer harness-token'), gw.requests.filter(request => request.headers.authorization !== 'Bearer harness-token').map(request => `${request.method} ${request.path}`))
    if (report.pageErrors.length > 0) check('no page errors', false, report.pageErrors)
    if (report.consoleErrors.length > 0) check('no console errors', false, report.consoleErrors)
  } catch (error) {
    check('the run finished', false, error instanceof Error ? error.message : String(error))
    try { await shot('zz-failure') } catch { /* the page may be gone */ }
  } finally {
    await browser.close()
    await sim.stop()
  }
}

const only = (process.env.HARNESS_ONLY ?? '*:*:*').split(':')
const wanted = (part: string, index: number): boolean => (only[index] ?? '*') === '*' || only[index] === part
const engines: Array<[string, BrowserType]> = [['chromium', chromium]]
if ((process.env.ENGINES ?? '').split(',').includes('webkit')) engines.push(['webkit', webkit])

try {
  for (const [engine, type] of engines) {
    for (const viewport of viewports) {
      for (const theme of themes) {
        if (!wanted(engine, 0) || !wanted(viewport.label, 1) || !wanted(theme, 2)) continue
        process.stdout.write(`${engine} ${viewport.label} ${theme}\n`)
        await run(type, engine, viewport, theme)
      }
    }
  }
} finally {
  await server.close()
}

const failed = reports.flatMap(report => report.checks.filter(item => !item.ok).map(item => ({ run: `${report.engine} ${report.viewport} ${report.theme}`, ...item })))
writeFileSync(resolve(shotsDir, 'evidence.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  runs: reports,
  failed,
}, null, 1))
process.stdout.write(`${reports.length} runs, ${reports.reduce((sum, report) => sum + report.checks.length, 0)} checks, ${failed.length} failed; shots in ${shotsDir}\n`)
process.exit(failed.length === 0 ? 0 : 1)
