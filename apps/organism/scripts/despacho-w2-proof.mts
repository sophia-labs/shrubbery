/**
 * despacho-w2-proof.mts — the real-cell proof of el Despacho W2 against the
 * Sirin `sophia-cluster` cell through a running Organism dev server (the
 * :5182 host, cloud2 service proxy). Opens a SEAT focus and a LETTER focus,
 * waits for the faces to reach `ready`, screenshots each at rest, and prints
 * what the grids actually rendered (every entry view's subject IRI, in DOM
 * order) as JSON so the same queries run through the wrapper can be compared
 * against it. Read-only: no click, no write.
 *
 *   pnpm --dir apps/organism exec tsx scripts/despacho-w2-proof.mts \
 *     --base http://127.0.0.1:5182 --out /path/to/receipts
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!)
const base = args.get('base') ?? 'http://127.0.0.1:5182'
const out = args.get('out') ?? process.cwd()
mkdirSync(out, { recursive: true })

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const targets: { readonly name: string; readonly focus: string; readonly view: string }[] = [
  { name: 'seat-sophia', focus: `${G}:seat:sophia`, view: 'sh-seat-character-view' },
  { name: 'letter-chat-claude-first-return', focus: `${G}:letter:chat-claude-first-return-20260913`, view: 'sh-letter-page-view' },
]
// `--seat <iri>`: one more seat (correo v0.2.0: a folded keeper with moves, rules and a card). `--only seat`: skip the two defaults.
if (args.get('seat')) {
  const extra = { name: `seat-${args.get('seat')!.split(':').pop()}`, focus: args.get('seat')!, view: 'sh-seat-character-view' }
  if (args.get('only') === 'seat') targets.splice(0, targets.length, extra)
  else targets.push(extra)
}

interface Rendered {
  readonly tag: string
  readonly mode: string | null
  readonly subject: string | null
  readonly state: string | null
  readonly text: string
}

const browser = await chromium.launch({ headless: true })
const report: Record<string, unknown> = { base, at: new Date().toISOString() }
try {
  for (const target of targets) {
    // A fresh page per target: the previous room's in-flight proxy requests
    // must not stall the next navigation.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const url = `${base}/?graph=sophia-cluster&focus=${encodeURIComponent(target.focus)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    // The chapter leaf reaches `ready` when its store settles; grids settle after.
    await page.waitForFunction(
      (tag) => {
        const el = document.querySelector(tag) as HTMLElement | null
        return el !== null && el.dataset.resourceState === 'ready'
      },
      target.view,
      { timeout: 90_000 },
    )
    // Then every collection entry: each entry view runs its own shapes through
    // the proxy, so a grid of twenty-four settles well after the chapter.
    await page.waitForTimeout(2_000)
    await page
      .waitForFunction(
        () => {
          const views = [...document.querySelectorAll('sh-cuenta-chapter-view, sh-seat-character-view, sh-letter-page-view')] as HTMLElement[]
          return views.length > 1 && views.every((el) => el.dataset.resourceState === 'ready' || el.dataset.resourceState === 'error')
        },
        undefined,
        { timeout: 120_000 },
      )
      .catch((error: unknown) => console.error(`settle timed out (screenshotting anyway): ${error instanceof Error ? error.message : String(error)}`))
    await page.waitForTimeout(1_000)
    const rendered = await page.evaluate((): Rendered[] => {
      const tags = ['sh-cuenta-chapter-view', 'sh-seat-character-view', 'sh-letter-page-view']
      const out: Rendered[] = []
      for (const el of document.querySelectorAll(tags.join(','))) {
        const host = el as HTMLElement & { mode?: string }
        const stage = host.shadowRoot?.querySelector('.stage') as HTMLElement | null
        out.push({
          tag: host.tagName.toLowerCase(),
          mode: host.getAttribute('mode'),
          subject: stage?.dataset.subject ?? null,
          state: host.dataset.resourceState ?? null,
          text: (stage?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
        })
      }
      return out
    })
    const unknown = await page.evaluate(() => [...document.querySelectorAll('[data-focus-kind]')].map((el) => (el as HTMLElement).dataset.focusKind))
    const errors = await page.evaluate(() =>
      [...document.querySelectorAll('.state[data-tone="danger"], [data-fragment-error], .fragment-error')].map((el) => (el.textContent ?? '').trim().slice(0, 200)),
    )
    const shot = join(out, `despacho-w2-${target.name}-at-rest.png`)
    await page.screenshot({ path: shot, fullPage: false })
    report[target.name] = { url, screenshot: shot, focusKinds: unknown, rendered, errors }
    console.error(`${target.name}: ${rendered.length} views rendered, ${errors.length} error panes; ${shot}`)
    await page.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(out, 'despacho-w2-proof.json'), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
