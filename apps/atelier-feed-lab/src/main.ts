/**
 * main.ts — the Atelier feed lab boot: layout-as-data over the Shrubbery
 * render host.
 *
 * The workspace shape is NOT hardcoded here. It lives in
 * src/layout/feed-lab.ux.nt — a fossil-v1 N-Triples document in the sux:
 * vocabulary (authored in src/layout/feed-lab-config.ts, emitted by
 * scripts/emit-layout.mts) — read through a REAL static TripleSource
 * (`staticNtSource`, the no-backend read path PLANTER proved), decoded by
 * `parseTriplesToConfig`, and rendered by `renderWorkspace` from
 * @shrubbery/runtime. The frame stamps mn-app-bar (chrome), the
 * broadcast|director split, and the pipeline band; the three afl-* leaves
 * (src/leaves/) upgrade in place — the upgrade seam.
 *
 * Import order matters: @shrubbery/components + the afl-* leaf modules + the
 * render-gate registration (feed-lab-config) must land BEFORE renderWorkspace
 * so the stamped tags upgrade instead of staying inert.
 *
 * The pipeline orchestration (director.ts) is wired AFTER the frame renders,
 * by lifting the stamped leaves — same lifecycle rhizome uses.
 */

import '@shrubbery/tokens/tokens.css'
import { applySkinTheme, type Skin, type Theme } from '@shrubbery/tokens'
import '@shrubbery/components'
import '@shoelace-style/shoelace/dist/components/split-panel/split-panel.js'
import './leaves/afl-broadcast.js'
import './leaves/afl-director.js'
import './leaves/afl-library.js'
import './leaves/afl-pipeline.js'
import { renderWorkspace } from '@shrubbery/runtime'
import { parseTriplesToConfig, triplesOf, uxConfigGraphIri } from '@shrubbery/nucleus'
import { staticNtSource } from '@shrubbery/source'
import { FEED_LAB_GRAPH_ID } from './layout/feed-lab-config.js'
import LAYOUT_NT from './layout/feed-lab.ux.nt?raw'
import { parseTriplesToWeb, referenceWebGraphIri } from './catalog/reference-web-codec.js'
import WEB_NT from './catalog/reference-web.nt?raw'
import { FeedLabDirector } from './director.js'
import type { AflBroadcast } from './leaves/afl-broadcast.js'
import type { AflDirector } from './leaves/afl-director.js'
import type { AflPipeline } from './leaves/afl-pipeline.js'

// The night-room instrument skin — the broadcast console identity.
let activeSkin: Skin = 'observatory'
let activeTheme: Theme = 'dark'
applySkinTheme({ skin: activeSkin, theme: activeTheme })

async function bootFeedLab(): Promise<void> {
// ── Layout as data: fossil NT → TripleSource → WorkspaceConfig → frame ───────
const source = staticNtSource(LAYOUT_NT)
const read = await source.read(uxConfigGraphIri(FEED_LAB_GRAPH_ID))
const config = parseTriplesToConfig(triplesOf(read))
await source.close()

// ── Catalog as data: the reference web boots through the SAME fossil path ────
// (src/catalog/reference-web.nt, authored in reference-web-config.ts, emitted
// by `pnpm emit:web`). Entities, studies, pendings, and relations all arrive
// from the graph; nothing about the catalog is hardcoded in components.
const webSource = staticNtSource(WEB_NT)
const webRead = await webSource.read(referenceWebGraphIri(FEED_LAB_GRAPH_ID))
const web = parseTriplesToWeb(triplesOf(webRead))
await webSource.close()

const host = document.getElementById('host') as HTMLElement
renderWorkspace(config, { container: host })

// ── Brand the stamped masthead (the rhizome/emporium pattern) ────────────────
const SKIN_CYCLE: readonly Skin[] = ['observatory', 'garden', 'emporium', '98', 'glass']
const bar = host.querySelector('mn-app-bar') as
  | (HTMLElement & {
      brand?: string
      glyph?: string
      badge?: string
      activeSkin?: Skin
      isDark?: boolean
      showSearch?: boolean
    })
  | null
if (bar) {
  bar.brand = 'Atelier'
  bar.glyph = 'star'
  bar.badge = 'feed lab'
  bar.activeSkin = activeSkin
  bar.isDark = activeTheme === 'dark'
  bar.showSearch = false
  bar.addEventListener('mn-skin-toggle', () => {
    activeSkin = SKIN_CYCLE[(SKIN_CYCLE.indexOf(activeSkin) + 1) % SKIN_CYCLE.length]
    applySkinTheme({ skin: activeSkin, theme: activeTheme })
    bar.activeSkin = activeSkin
  })
  bar.addEventListener('mn-theme-toggle', () => {
    activeTheme = activeTheme === 'light' ? 'dark' : 'light'
    applySkinTheme({ skin: activeSkin, theme: activeTheme })
    bar.isDark = activeTheme === 'dark'
  })
}

// ── Responsive spine: stack broadcast over director on narrow viewports ──────
// Layout data gives the 66/34 split; orientation is a VIEWPORT concern, so the
// shell flips the stamped split panel vertical below the breakpoint (and back).
const split = host.querySelector<HTMLElement & { position?: number }>('.main sl-split-panel')
const narrow = window.matchMedia('(max-width: 980px)')
const applyOrientation = (): void => {
  if (!split) return
  split.toggleAttribute('vertical', narrow.matches)
  split.position = narrow.matches ? 52 : 66
}
applyOrientation()
narrow.addEventListener('change', applyOrientation)

// ── Lift the stamped leaves and hand them to the orchestrator ────────────────
const broadcast = host.querySelector<AflBroadcast>('afl-broadcast')
const director = host.querySelector<AflDirector>('afl-director')
const pipeline = host.querySelector<AflPipeline>('afl-pipeline')
if (!broadcast || !director || !pipeline) {
  throw new Error('the workspace frame did not stamp the atelier leaves — check the layout fossil')
}

// ── The run library: app furniture, not a layout leaf ────────────────────────
// A full-viewport overlay (the afl-pack precedent at app scale; the runtime's
// own overlays work the same way) — the workspace fossil stays untouched and
// the feed keeps playing underneath while the ledger is read.
const library = document.createElement('afl-library')
document.body.appendChild(library)

const feedLab = new FeedLabDirector({ broadcast, director, pipeline, library }, web)
await feedLab.start()
}

void bootFeedLab()
