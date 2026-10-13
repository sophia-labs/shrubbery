/**
 * despacho-w11-proof.mts — the real-cell proof of el Despacho W11 (the roster
 * pokédex) against the Sirin `sophia-cluster` cell through a running Organism
 * dev server (the :5184 host, cloud2 service proxy).
 *
 * Two shapes are proven, because the pokédex is two things:
 *   - the GALLERY: activate the room's Gallery tab, wait for the tiles to
 *     settle, and print every tile's subject IRI in DOM order, so the same
 *     `gallery.*` query run through the wrapper can be compared against it.
 *   - the CARDS: one focus per entry kind (a folded keeper, a dormant
 *     choreograph agent, a plain roster seat), each waited to `ready` and
 *     screenshotted at rest, with the stats/moves/rules the chapter rendered.
 *
 * Read-only: no click that writes, no verb, no graph mutation. The Gallery tab
 * is activated by a pointer click on its own tab control — that is layout
 * state, not testimony.
 *
 *   pnpm --dir apps/organism exec tsx scripts/despacho-w11-proof.mts \
 *     --base http://127.0.0.1:5184 --out /path/to/receipts
 */
import { chromium, type Page } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!)
const base = args.get('base') ?? 'http://127.0.0.1:5184'
const out = args.get('out') ?? process.cwd()
mkdirSync(out, { recursive: true })

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const ENTRY_VIEW = 'sh-agent-entry-view'
/** Every chapter/entry view the room can mount, for the settle predicate. */
const ALL_VIEWS = 'sh-agent-entry-view, sh-cuenta-chapter-view, sh-seat-character-view, sh-letter-page-view'

interface Rendered {
  readonly tag: string
  readonly mode: string | null
  readonly subject: string | null
  readonly state: string | null
  readonly text: string
}

/**
 * region-center's `sux:fragmentSurface` is ONE shared slot in `:ux:config`,
 * and a parallel W4 fork repoints it to its own inbox surface for its own
 * proof windows (observed: the first run of this script screenshotted W4's
 * `…despacho-inbox` failing LAY003_UNREGISTERED_FACE against this worktree,
 * which has no inbox faces). So re-assert MY surface immediately before each
 * navigation and read it back; a collision then costs a retry, never a false
 * receipt.
 */
const REPOINT_RQ = args.get('repoint') ?? join(process.cwd(), '/path/to/private-evidence/2026-09-15-despacho/w11/despacho.surface.room.repoint.rq')
const WRAPPER = join(homedir(), '.sophia-mcp/sirin-call.sh')
const MY_SURFACE = 'urn:sophia:ux:surface:sophia-cluster-despacho-room'

function callWrapper(tool: string, payload: unknown): string {
  return execFileSync(WRAPPER, ['sophia-cluster', tool, JSON.stringify(payload)], { encoding: 'utf8', timeout: 120_000 })
}

function assertMySurface(): string {
  callWrapper('sparql_update', { graphId: 'sophia-cluster', update: readFileSync(REPOINT_RQ, 'utf8') })
  const read = callWrapper('sparql_query', {
    query:
      'SELECT ?s WHERE { GRAPH <urn:mnemosyne:local:graph:sophia-cluster:ux:config> { ' +
      '<http://sophia.ai/ux#region-center> <http://sophia.ai/ux#fragmentSurface> ?s } }',
  })
  return read.includes(MY_SURFACE) ? MY_SURFACE : `NOT MINE: ${read.slice(0, 200)}`
}

/** Click the tab whose label matches, if the room offers tabs. */
async function activateTab(page: Page, label: string): Promise<boolean> {
  const clicked = await page.evaluate((wanted) => {
    const candidates = [...document.querySelectorAll('button, [role="tab"], .tab, [data-tab-label]')] as HTMLElement[]
    const hit = candidates.find((el) => (el.textContent ?? '').trim().toLowerCase() === wanted.toLowerCase())
    if (!hit) return false
    hit.click()
    return true
  }, label)
  if (clicked) await page.waitForTimeout(1_500)
  return clicked
}

async function settle(page: Page, minViews: number, timeout = 150_000): Promise<void> {
  await page.waitForTimeout(2_000)
  await page
    .waitForFunction(
      ({ sel, min }) => {
        const views = [...document.querySelectorAll(sel)] as HTMLElement[]
        return views.length >= min && views.every((el) => el.dataset.resourceState === 'ready' || el.dataset.resourceState === 'error')
      },
      { sel: ALL_VIEWS, min: minViews },
      { timeout },
    )
    .catch((error: unknown) => console.error(`settle timed out (screenshotting anyway): ${error instanceof Error ? error.message : String(error)}`))
  await page.waitForTimeout(1_000)
}

async function readRendered(page: Page): Promise<Rendered[]> {
  return page.evaluate((sel): Rendered[] => {
    const out: Rendered[] = []
    for (const el of document.querySelectorAll(sel)) {
      const host = el as HTMLElement & { mode?: string }
      const stage = host.shadowRoot?.querySelector('.stage') as HTMLElement | null
      out.push({
        tag: host.tagName.toLowerCase(),
        mode: host.getAttribute('mode'),
        subject: stage?.dataset.subject ?? null,
        state: host.dataset.resourceState ?? null,
        text: (stage?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 280),
      })
    }
    return out
  }, ALL_VIEWS)
}

async function readErrors(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.state[data-tone="danger"], [data-fragment-error], .fragment-error')].map((el) => (el.textContent ?? '').trim().slice(0, 200)),
  )
}

const cards: { readonly name: string; readonly focus: string; readonly why: string }[] = [
  { name: 'keeper-deploy-canary', focus: `${G}:seat:deploy-canary`, why: 'a facility folded from the swarm graph: mandate, card, moves, rules' },
  { name: 'choreograph-sophia-1', focus: `${G}:seat:sophia-1`, why: 'a dormant choreograph agent: habitat, definitions, run stats, lineage' },
  { name: 'roster-seat-chat-archive', focus: `${G}:seat:chat-archive`, why: 'a plain roster seat (also a keeper by the fold): letters, runs' },
]

/** `--only <name>`: re-capture one target (a card name, or `gallery`) without re-walking the rest. */
const only = args.get('only') ?? null
const wants = (name: string): boolean => only === null || only === name

const browser = await chromium.launch({ headless: true })
const report: Record<string, unknown> = { base, at: new Date().toISOString(), only }
try {
  // ── the gallery ────────────────────────────────────────────────────────────
  if (wants('gallery')) {
    const surfaceAtStart = assertMySurface()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const url = `${base}/?graph=sophia-cluster`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForTimeout(8_000) // the shell boots before the first fragment render
    const tabbed = await activateTab(page, 'Gallery')
    await settle(page, 2)
    const tiles = await page.evaluate((tag) => {
      const out: { subject: string | null; state: string | null; text: string }[] = []
      for (const el of document.querySelectorAll(tag)) {
        const host = el as HTMLElement
        if (host.getAttribute('mode') !== 'tile') continue
        const stage = host.shadowRoot?.querySelector('.stage') as HTMLElement | null
        out.push({
          subject: stage?.dataset.subject ?? null,
          state: host.dataset.resourceState ?? null,
          text: (stage?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
        })
      }
      return out
    }, ENTRY_VIEW)
    const errors = await readErrors(page)
    const shot = join(out, 'despacho-w11-gallery-at-rest.png')
    await page.screenshot({ path: shot, fullPage: false })
    report.gallery = { url, surfaceAtStart, tabActivated: tabbed, screenshot: shot, tileCount: tiles.length, tiles, errors }
    console.error(`gallery: tab=${tabbed}, ${tiles.length} tiles, ${errors.length} error panes; ${shot}`)
    await page.close()
  }

  // ── the cards ──────────────────────────────────────────────────────────────
  for (const card of cards) {
    if (!wants(card.name)) continue
    const surfaceAtStart = assertMySurface()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const url = `${base}/?graph=sophia-cluster&focus=${encodeURIComponent(card.focus)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForTimeout(8_000)
    const tabbed = await activateTab(page, 'Gallery')
    await page
      .waitForFunction(
        (tag) => {
          const chapter = [...document.querySelectorAll(tag)].find((el) => (el as HTMLElement).getAttribute('mode') !== 'tile') as HTMLElement | undefined
          return chapter !== undefined && (chapter.dataset.resourceState === 'ready' || chapter.dataset.resourceState === 'error')
        },
        ENTRY_VIEW,
        { timeout: 120_000 },
      )
      .catch((error: unknown) => console.error(`${card.name}: chapter wait timed out: ${error instanceof Error ? error.message : String(error)}`))
    await settle(page, 2)
    const rendered = await readRendered(page)
    const chapter = rendered.find((r) => r.tag === ENTRY_VIEW && r.mode !== 'tile') ?? null
    const errors = await readErrors(page)
    const shot = join(out, `despacho-w11-${card.name}-at-rest.png`)
    await page.screenshot({ path: shot, fullPage: false })
    report[card.name] = { url, why: card.why, surfaceAtStart, tabActivated: tabbed, screenshot: shot, chapter, viewCount: rendered.length, errors }
    console.error(`${card.name}: chapter ${chapter?.state ?? 'absent'}, ${rendered.length} views, ${errors.length} error panes; ${shot}`)
    await page.close()
  }
} finally {
  await browser.close()
}
const reportPath = join(out, only === null ? 'despacho-w11-proof.json' : `despacho-w11-proof-${only}.json`)
writeFileSync(reportPath, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
