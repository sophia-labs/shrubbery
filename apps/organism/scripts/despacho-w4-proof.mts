/**
 * despacho-w4-proof.mts — the real-cell proof of el Despacho W4 against the
 * Sirin `sophia-cluster` cell through a running Organism dev server (the
 * :5185 host, cloud2 service proxy).
 *
 * The two W4 rooms are NOT focus-driven — an inbox is nobody's subject in the
 * graph — so each is proven by pointing region-center at the room's own
 * surface for one window. This script does not repoint anything itself: it
 * takes the room to expect and reports what the surface actually rendered
 * (the counts the room claims, the gates in their rendered order with their
 * readiness, and any error pane) so the same queries run through the wrapper
 * can be compared against it.
 *
 * READ-ONLY by construction: it never clicks. The `read` act would write a
 * Lectura witnessed as the viewer, and that testimony is Vera's to give.
 *
 *   pnpm --dir apps/organism exec tsx scripts/despacho-w4-proof.mts \
 *     --base http://127.0.0.1:5185 --room inbox --out /path/to/receipts
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!)
const base = args.get('base') ?? 'http://127.0.0.1:5185'
const out = args.get('out') ?? process.cwd()
const room = args.get('room') ?? 'inbox'
mkdirSync(out, { recursive: true })

const VIEW = room === 'inbox' ? 'sh-inbox-room-view' : 'sh-my-work-view'

interface GateRow {
  readonly iri: string | null
  readonly ready: string | null
  readonly title: string
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const url = `${base}/?graph=sophia-cluster`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(
    (tag) => {
      const el = document.querySelector(tag) as HTMLElement | null
      return el !== null && el.dataset.resourceState === 'ready'
    },
    VIEW,
    { timeout: 120_000 },
  )
  // The docket grid's entries each run their own shapes; let them settle.
  await page.waitForTimeout(3_000)
  await page
    .waitForFunction(
      () => {
        const views = [...document.querySelectorAll('sh-cuenta-chapter-view')] as HTMLElement[]
        return views.length === 0 || views.every((el) => el.dataset.resourceState === 'ready' || el.dataset.resourceState === 'error')
      },
      undefined,
      { timeout: 120_000 },
    )
    .catch((error: unknown) => console.error(`docket settle timed out (screenshotting anyway): ${error instanceof Error ? error.message : String(error)}`))
  await page.waitForTimeout(1_000)

  const observed = await page.evaluate((tag) => {
    const host = document.querySelector(tag) as HTMLElement | null
    const shadow = host?.shadowRoot ?? null
    const stage = shadow?.querySelector('.stage') as HTMLElement | null
    const text = (stage?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const gates: GateRow[] = [...(shadow?.querySelectorAll('[data-gate]') ?? [])].map((el) => ({
      iri: (el as HTMLElement).dataset.gate ?? null,
      ready: (el as HTMLElement).dataset.ready ?? null,
      title: (el.querySelector('a')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
    const letters = [...(shadow?.querySelectorAll('[data-letter]') ?? [])].map((el) => (el as HTMLElement).dataset.letter ?? null)
    const returns = [...(shadow?.querySelectorAll('[data-rendicion]') ?? [])].map((el) => (el as HTMLElement).dataset.rendicion ?? null)
    const beads = [...(shadow?.querySelectorAll('[data-bead]') ?? [])].map((el) => ({
      iri: (el as HTMLElement).dataset.bead ?? null,
      status: (el as HTMLElement).dataset.status ?? null,
      gate: (el as HTMLElement).dataset.gate ?? null,
    }))
    const acts = [...(shadow?.querySelectorAll('button') ?? [])].map((b) => ({
      label: (b.textContent ?? '').trim(),
      disabled: (b as HTMLButtonElement).disabled,
    }))
    return {
      state: host?.dataset.resourceState ?? null,
      stance: stage?.getAttribute('data-stance') ?? null,
      ariaLabel: stage?.getAttribute('aria-label') ?? null,
      // The counts line the room itself claims, verbatim from the DOM.
      countsLine: (shadow?.querySelector('.counts')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      eyebrow: (shadow?.querySelector('.eyebrow')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      headings: [...(shadow?.querySelectorAll('h1, h2') ?? [])].map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim()),
      gates,
      letters,
      returns,
      beads,
      acts,
      emptyLines: [...(shadow?.querySelectorAll('.empty') ?? [])].map((el) => (el.textContent ?? '').trim()),
      textHead: text.slice(0, 400),
    }
  }, VIEW)

  const fragmentErrors = await page.evaluate(() =>
    [...document.querySelectorAll('[data-fragment-error], .fragment-error, .state[data-tone="danger"]')].map((el) => (el.textContent ?? '').trim().slice(0, 240)),
  )
  const docket = await page.evaluate(() =>
    [...document.querySelectorAll('sh-cuenta-chapter-view')].map((el) => {
      const host = el as HTMLElement
      const stage = host.shadowRoot?.querySelector('.stage') as HTMLElement | null
      return { subject: stage?.dataset.subject ?? null, state: host.dataset.resourceState ?? null }
    }),
  )

  const shot = join(out, `despacho-w4-${room}-at-rest.png`)
  await page.screenshot({ path: shot, fullPage: false })
  const report = { base, room, url, at: new Date().toISOString(), screenshot: shot, observed, docket, fragmentErrors }
  writeFileSync(join(out, `despacho-w4-${room}-proof.json`), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  console.error(`${room}: state=${observed.state} gates=${observed.gates.length} letters=${observed.letters.length} returns=${observed.returns.length} beads=${observed.beads.length} errors=${fragmentErrors.length}; ${shot}`)
  await page.close()
} finally {
  await browser.close()
}
