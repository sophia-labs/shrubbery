/**
 * AVIARY — an audio player for the aigua field-recording sample library.
 *
 * THE THESIS. A sample library is a graph, and a player for it is a graph plus
 * an interpreter plus a component library. So AVIARY holds NO layout in its
 * browser code and NO library data in its browser code. Both arrive as RDF over
 * the one read seam, and everything you see is a projection:
 *
 *   instrument.json + the aigua directory        (real files, read server-side)
 *        │  project.ts  — the MINT stage
 *        ▼
 *   `aig:` triples  ──────────┐          `sux:` triples (serializeConfigToTriples)
 *        │                    │                     │
 *        │   GET /graph/library.nt      GET /graph/ux-config.nt
 *        ▼                    ▼                     ▼
 *   ntHttpSource — a REAL TripleSource, the ONLY network call in the browser
 *        │                                          │
 *   parseLibrary (this app's own codec)   parseTriplesToConfig (nucleus's codec)
 *        │                                          │
 *        │                                     planFor → LayoutPlan
 *        │                                          ▼
 *        └──────────► props ──────────►  renderWorkspace  → Lit DOM
 *
 * The interpreter stamps app-owned tags as bare `<av-rail></av-rail>` — it binds
 * nothing to them, by design — so this module does the rhizome thing: render
 * once, `querySelector` the elements, and push controlled props at them. The
 * elements emit intent events back; nothing below this file fetches or plays.
 *
 * NO MOCKS, NO SILENT FALLBACKS. If the read seam fails, the error is shown
 * verbatim in the transport strip and the rail and stage stay inert and labeled.
 * There is no built-in library and no default layout to fall back to.
 */

// 0) The REAL design tokens (the --mn-* vocabulary + the skin/theme applier).
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme, isSkin, type Skin, type Theme } from '@shrubbery/tokens'

// 1) The upgrade seam: registering the vetted chrome/primitive elements, then
//    AVIARY's own three. Both must happen BEFORE renderWorkspace, or the
//    stamped tags stay un-upgraded inert elements.
import '@shrubbery/components'
import './library/aviary-tags.js'
import './ui/av-rail.js'
import './ui/av-stage.js'
import './ui/av-transport.js'

// 2) The real render host + the real RDF codec.
import { renderWorkspace } from '@shrubbery/runtime'
import {
  TripleSourceError,
  isNoWorkspaceNodeError,
  parseTriplesToConfig,
  triplesOf,
  uxConfigGraphIri,
  type TripleRead,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'

// 3) SHELL-SIDE: the read seam, the audio element, and the pure projections.
import { ntHttpSource } from './cell/nt-http-source.js'
import { AVIARY_GRAPH_ID, LIBRARY_GRAPH_IRI } from './library/vocab.js'
import { NoLibraryNodeError, parseLibrary, type Library, type Sample } from './library/model.js'
import { allRouteIds, defaultRoute, librarySummary, trackFor } from './shell/routes.js'
import { createAudioPlayer, type PlaybackState, type Track } from './shell/audio-player.js'
import type { AvRail } from './ui/av-rail.js'
import type { AvStage, AvPlayDetail } from './ui/av-stage.js'
import type { AvTransport, ReadTestimony, TransportActionDetail, TransportSeekDetail } from './ui/av-transport.js'
import { railSections } from './shell/routes.js'

const UX_CONFIG_GRAPH = uxConfigGraphIri(AVIARY_GRAPH_ID)

/** How often the shell re-reads the library graph. The projection is generated
 *  per request from the directory, so a new file under `render/` appears here
 *  within one interval — which is why the adapter declares liveness 'poll'. */
const POLL_MS = 8000

const host = document.getElementById('host') as HTMLDivElement
const boot = document.getElementById('boot') as HTMLDivElement

// ── The read seam ────────────────────────────────────────────────────────────

const source = ntHttpSource({
  graphs: {
    [LIBRARY_GRAPH_IRI]: '/graph/library.nt',
    [UX_CONFIG_GRAPH]: '/graph/ux-config.nt',
  },
  endpoint: `${location.origin}/graph`,
  suggestedPollMs: POLL_MS,
})

// ── Shell state (the elements are controlled; this is the only mutable state) ─

interface AppearanceChoice {
  readonly skins: readonly Skin[]
  readonly themes: readonly Theme[]
}

let library: Library | null = null
let libraryNt = ''
let route = ''
let query = ''
let readError = ''
let testimony: ReadTestimony | null = null
let skin: Skin = 'garden'
let theme: Theme = 'light'
let appearance: AppearanceChoice = { skins: ['garden'], themes: ['light', 'dark'] }
let playback: PlaybackState

const player = createAudioPlayer()
playback = player.get()
// The one audio element is parented into the page so a browser test can find
// it and read its real `src`; it is display:none via the boot styles.
player.element.id = 'aviary-audio'
player.element.setAttribute('data-testid', 'aviary-audio')
document.body.appendChild(player.element)

// Element handles, resolved once after the workspace render.
let appBar: (HTMLElement & { query?: string }) | null = null
let rail: AvRail | null = null
let stage: AvStage | null = null
let transport: AvTransport | null = null

// ── Boot status (pre-render only; after that the transport strip owns it) ────

function bootSay(message: string, isError = false): void {
  boot.textContent = message
  boot.className = isError ? 'boot err' : 'boot'
  boot.hidden = false
}
function bootDone(): void {
  boot.hidden = true
}

// ── Appearance, read OUT OF THE GRAPH ────────────────────────────────────────

/**
 * The skin/theme choices come from the `sux:ConfigDimension` nodes the layout
 * graph carries — the same `dim-skin` / `dim-theme` pattern GARDEN_DEFAULT uses.
 * Adding a skin is therefore a triple, not a code change. A config with no such
 * dimension keeps the tokens package's own defaults and says so, rather than
 * silently pretending the graph offered them.
 */
function readAppearance(config: WorkspaceConfig): void {
  const skinDim = config.dimensions['dim-skin']
  const themeDim = config.dimensions['dim-theme']
  const skins = (skinDim?.values ?? []).map((v) => v.literalValue).filter(isSkin)
  const themes = (themeDim?.values ?? [])
    .map((v) => v.literalValue)
    .filter((v): v is Theme => v === 'light' || v === 'dark')
  appearance = {
    skins: skins.length > 0 ? skins : ['garden'],
    themes: themes.length > 0 ? themes : ['light', 'dark'],
  }
  const defaultSkin = skinDim?.defaultValue
  const defaultTheme = themeDim?.defaultValue
  skin = isSkin(defaultSkin) ? defaultSkin : appearance.skins[0]
  theme = defaultTheme === 'dark' ? 'dark' : 'light'
  applySkinTheme({ skin, theme })
}

/** The picker's choice — one of the skins this graph's layout config offers (`dim-skin`), nothing else. */
function selectSkin(event: Event): void {
  const chosen = (event as CustomEvent<{ skin?: unknown }>).detail?.skin
  if (typeof chosen !== 'string' || !isSkin(chosen) || !appearance.skins.includes(chosen)) return
  skin = chosen
  applySkinTheme({ skin, theme })
  pushProps()
}

function toggleTheme(): void {
  theme = theme === 'dark' ? 'light' : 'dark'
  applySkinTheme({ skin, theme })
  pushProps()
}

// ── Routing (the hash keeps your place across a reload) ──────────────────────

function routeFromHash(): string {
  return decodeURIComponent(location.hash.replace(/^#\/?/, ''))
}

function setRoute(next: string): void {
  route = next
  const encoded = `#/${encodeURIComponent(next)}`
  if (location.hash !== encoded) history.replaceState(null, '', encoded)
  pushProps()
}

function routeLabel(): string {
  if (library === null) return ''
  for (const section of railSections(library)) {
    for (const item of section.items) if (item.id === route) return item.label
  }
  return route
}

// ── Track resolution: a graph IRI → a playable Track ─────────────────────────

function findTrack(iri: string): Track | null {
  if (library === null) return null
  const sample: Sample | undefined = library.samplesByIri.get(iri)
  if (sample) {
    return trackFor({
      iri,
      label: sample.id,
      subtitle: `${sample.voice} · ${sample.note ?? '—'}`,
      media: sample.media,
      declaredDuration: sample.durationSeconds,
    })
  }
  const bed = library.beds.find((b) => b.iri === iri)
  if (bed) {
    return trackFor({
      iri,
      label: bed.name,
      subtitle: 'noise bed',
      media: bed.media,
      declaredDuration: bed.durationSeconds,
    })
  }
  const piece = library.renders.find((r) => r.iri === iri)
  if (piece) return trackFor({ iri, label: piece.name, subtitle: 'render', media: piece.media })
  const rec = library.recordings.find((r) => r.iri === iri)
  if (rec) return trackFor({ iri, label: rec.name, subtitle: 'source recording', media: rec.media })
  return null
}

// ── The one prop-push (the rhizome pattern) ──────────────────────────────────

function pushProps(): void {
  if (appBar) {
    Object.assign(appBar, {
      brand: 'Aviary',
      badge: library === null ? '' : librarySummary(library),
      glyph: 'sprout',
      showSearch: library !== null,
      searchPlaceholder: 'filter samples — id, note, shape',
      query,
      isDark: theme === 'dark',
      activeSkin: skin,
      skins: appearance.skins,
      showActions: true,
      crumbs: library === null ? [] : [{ label: 'aigua' }, { label: routeLabel() }],
    })
  }
  if (rail) {
    rail.sections = library === null ? [] : railSections(library)
    rail.selectedId = route
    rail.status = readError !== '' ? 'error' : library === null ? 'loading' : 'ready'
  }
  if (stage) {
    stage.library = library
    stage.route = route
    stage.query = query
    stage.error = readError
    stage.nowPlaying = playback.track?.iri ?? ''
    stage.isPlaying = playback.status === 'playing'
  }
  if (transport) {
    transport.playback = playback
    transport.testimony = testimony
    transport.error = readError
  }
}

// ── Wiring the intent events (delegated on the host, so a re-render is safe) ──

function wireEvents(): void {
  host.addEventListener('av-navigate', (event) => {
    setRoute((event as CustomEvent<{ id: string }>).detail.id)
  })

  host.addEventListener('av-play', (event) => {
    const detail = (event as CustomEvent<AvPlayDetail>).detail
    const track = findTrack(detail.iri)
    if (track === null) {
      // Inert and labeled: the graph knows this resource but carries no audio.
      readError = `AVIARY: <${detail.iri}> carries no playable audio media in the graph.`
      pushProps()
      return
    }
    readError = ''
    if (detail.at === undefined) player.toggle(track)
    else player.play(track, detail.at)
  })

  host.addEventListener('av-transport-action', (event) => {
    const { action } = (event as CustomEvent<TransportActionDetail>).detail
    if (action === 'stop') {
      player.stop()
      return
    }
    if (playback.track) player.toggle(playback.track)
  })

  host.addEventListener('av-transport-seek', (event) => {
    player.seek((event as CustomEvent<TransportSeekDetail>).detail.seconds)
  })

  // mn-app-bar is a real vetted primitive; these are its documented events.
  host.addEventListener('mn-search', (event) => {
    query = (event as CustomEvent<{ query: string }>).detail.query
    pushProps()
  })
  host.addEventListener('mn-theme-toggle', toggleTheme)
  host.addEventListener('mn-skin-select', selectSkin)
  host.addEventListener('mn-navigate-home', () => {
    if (library !== null) setRoute(defaultRoute(library) ?? route)
  })

  window.addEventListener('hashchange', () => {
    const next = routeFromHash()
    if (next !== '' && next !== route) setRoute(next)
  })

  // Space toggles playback from anywhere that is not a control or a text field.
  window.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space') return
    const target = event.composedPath()[0]
    if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(target.tagName)) return
    if (playback.track === null) return
    event.preventDefault()
    player.toggle(playback.track)
  })

  player.subscribe((state) => {
    playback = state
    pushProps()
  })
}

// ── Reads ────────────────────────────────────────────────────────────────────

function recordTestimony(read: TripleRead): void {
  testimony = {
    kind: source.description.kind,
    liveness: source.description.liveness,
    graphIri: read.graphIri,
    tripleCount: read.tripleCount,
    readAt: read.readAt,
  }
}

/** Read the LIBRARY graph and re-project. Returns true when anything changed. */
async function readLibrary(): Promise<boolean> {
  const read = await source.read(LIBRARY_GRAPH_IRI)
  recordTestimony(read)
  const nt = read.nt ?? ''
  if (nt === libraryNt && library !== null) return false
  libraryNt = nt
  library = parseLibrary(triplesOf(read))
  if (route === '' || !allRouteIds(library).includes(route)) {
    route = routeFromHash() || defaultRoute(library) || ''
    if (!allRouteIds(library).includes(route)) route = defaultRoute(library) ?? ''
  }
  return true
}

function describeFailure(cause: unknown): string {
  if (cause instanceof TripleSourceError) {
    return `TripleSourceError[${cause.code}] ${cause.message}${cause.detail ? `\n${cause.detail}` : ''}`
  }
  if (cause instanceof NoLibraryNodeError) {
    return `${cause.message} — the graph parsed but carries no aig:Library node.`
  }
  if (isNoWorkspaceNodeError(cause)) {
    return `${cause.message} — /graph/ux-config.nt served triples with no sux:Workspace node.`
  }
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
}

async function main(): Promise<void> {
  // ── 1. The LAYOUT, read as RDF and interpreted ─────────────────────────────
  bootSay('reading the sux: layout graph…')
  let config: WorkspaceConfig
  try {
    const read = await source.read(UX_CONFIG_GRAPH)
    config = parseTriplesToConfig(triplesOf(read))
  } catch (cause) {
    bootSay(`AVIARY could not read its own layout graph — nothing is rendered.\n${describeFailure(cause)}`, true)
    return
  }
  readAppearance(config)
  // planFor runs inside here; the DOM below is entirely the interpreter's.
  renderWorkspace(config, { container: host })

  appBar = host.querySelector('mn-app-bar')
  rail = host.querySelector('av-rail')
  stage = host.querySelector('av-stage')
  transport = host.querySelector('av-transport')
  if (rail === null || stage === null || transport === null) {
    bootSay(
      'AVIARY: the interpreter did not stamp av-rail / av-stage / av-transport. ' +
        'That means the render gate rejected them — check registerRenderableComponentTags.',
      true,
    )
    return
  }
  wireEvents()
  pushProps()

  // ── 2. The LIBRARY, read as RDF and projected ──────────────────────────────
  bootSay('reading the aig: library graph…')
  try {
    await readLibrary()
    bootDone()
  } catch (cause) {
    readError = describeFailure(cause)
    bootDone()
  }
  pushProps()

  // ── 3. The poll — the directory grows, so the graph does too ───────────────
  window.setInterval(() => {
    void readLibrary()
      .then((changed) => {
        readError = ''
        if (changed) pushProps()
        else if (transport) transport.testimony = testimony
      })
      .catch((cause: unknown) => {
        readError = describeFailure(cause)
        pushProps()
      })
  }, POLL_MS)
}

void main()
