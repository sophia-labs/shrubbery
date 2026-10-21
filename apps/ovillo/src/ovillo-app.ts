/**
 * ovillo-app — the Ovillo shell: Sophia chrome around a graph-laid-out surface.
 *
 *   mn-top-bar (the Sophia suite's bar: the app picker, Gallery / Bench / Tract,
 *   breadcrumbs, theme and skin)
 *   ovillo-surface (LayoutInterpreter faces, one LayoutDocument per route, read
 *   from the graph's :ux:config or the app's built-in one)
 *   the testimony strip (what was read, from where, when, how)
 *
 * The shell owns everything with an effect: the TripleSource read of the
 * `ovillo` graph, the ONE audio engine every player on the page shares (with
 * its Web Audio tap), the JSON fetches (energy traces, receipts), the route.
 * Faces and components only draw what it binds and say what was asked.
 *
 * HARD RULE (Vera): Ovillo shows Ariadne only. Every sound comes out of an
 * Ariadne World; the app plays nothing the graph does not name as a render.
 */

import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import {
  createAudioPlayer,
  parseEnergyTrace,
  type AudioPlayer,
  type MnAudioDataLoader,
  type MnEnergyTrace,
} from '@shrubbery/components/audio'
import type { ChromeAppLink, ChromeAppTab, ChromeBreadcrumb } from '@shrubbery/components/top-bar'
import type { AppToolbarAction } from '@shrubbery/components/app-toolbar'
import { sophiaApp } from '@shrubbery/components/sophia-suite'
import { applySkinTheme, isSkin, type Skin, type Theme } from '@shrubbery/tokens'
import { TripleSourceError, type TripleSource } from '@shrubbery/nucleus'
import type { LayoutDocument, ViewDescriptor } from '@shrubbery/nucleus/layout'
import {
  defineWorkspaceSurfaceElement,
  type WorkspaceSurfaceElement,
  type WorkspaceSurfaceModel,
} from '@shrubbery/runtime/layout/surface'
import { OVILLO_FACE_IDS } from './face-ids.js'
import {
  OVILLO_FACE_CATALOGUE,
  type AboutFaceValue,
  type FetchedJson,
  type GalleryFaceValue,
  type MountFaceValue,
  type NowFaceValue,
  type PieceFaceValue,
  type ReceiptJson,
} from './faces.js'
import { readGraph, type GraphReadTestimony } from './graph-read.js'
import { bindPieceLayout, loadOvilloLayouts, type OvilloLayouts } from './layout.js'
import { resolveMediaUrl, type MediaResolution } from './media.js'
import { NoPiecesError, parseOvillo, type OvilloGraph, type OvilloPiece } from './model.js'
import { parseRoute, routeHash, type OvilloRoute } from './routes.js'
import { createOvilloSource, sourceConfig, type OvilloSourceConfig } from './source.js'
import { trackForPiece, tracksFor } from './tracks.js'
import { OVILLO_DATA_GRAPH, idIri } from './vocab.js'
import './ov-energy-trace.js'

const SURFACE_TAG = 'ovillo-surface'
defineWorkspaceSurfaceElement(SURFACE_TAG, OVILLO_FACE_CATALOGUE)

const SKINS: readonly Skin[] = ['garden', 'emporium']
const THEME_KEY = 'shrubbery.ovillo.theme'

const NAV_ACTIONS: readonly AppToolbarAction[] = [
  { id: 'gallery', label: 'Gallery', icon: 'list-music', event: 'ovillo-go', detail: { route: 'home' } },
  { id: 'bench', label: 'The bench', icon: 'sliders-horizontal', event: 'ovillo-go', detail: { route: 'bench' } },
  { id: 'tract', label: 'The tract', icon: 'mic', event: 'ovillo-go', detail: { route: 'tract' } },
]

const OVILLO_TAB: ChromeAppTab = { id: 'ovillo', label: sophiaApp('ovillo').label, icon: sophiaApp('ovillo').icon }
const APP_LINKS: readonly ChromeAppLink[] = [
  { id: 'garden', label: 'Garden', icon: 'sprout', href: 'https://garden.sophia-labs.com/' },
]

/** `wasm/<module>` beside index.html, or where `?muswasm=` / `?benchwasm=` / `?tractwasm=` say. */
export function wasmUrls(search: string, base: string = document.baseURI): { mus: string; bench: string; tract: string } {
  const p = new URLSearchParams(search)
  const at = (key: string, file: string): string => new URL(p.get(key) ?? `wasm/${file}`, base).href
  return { mus: at('muswasm', 'mus_wasm.wasm'), bench: at('benchwasm', 'ovillo_web.wasm'), tract: at('tractwasm', 'tract.wasm') }
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage may be refused (a private window); the system preference stands.
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function describe(cause: unknown): string {
  if (cause instanceof TripleSourceError) return `TripleSourceError[${cause.code}] ${cause.message}${cause.detail ? `\n${cause.detail}` : ''}`
  if (cause instanceof NoPiecesError) return `${cause.message}: the source answered, but this is not the ovillo graph.`
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
}

@customElement('ovillo-app')
export class OvilloApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #1f2a24);
      background: var(--mn-color-surface-canvas, var(--mn-color-surface-base, #fafaf7));
      font-family: var(--mn-font-sans, system-ui, sans-serif);
    }
    * { box-sizing: border-box; }
    .shell {
      height: 100dvh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
    }
    mn-top-bar { min-width: 0; }
    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      display: flex;
      overflow: hidden;
    }
    ovillo-surface {
      flex: 1 1 auto;
    }
    ovillo-surface [data-layout-grid-interior='true'] {
      padding: var(--mn-space-4, 16px);
      max-width: 1280px;
      margin: 0 auto;
    }
    ovillo-surface [data-layout-grid-cell-id] {
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-base, #fff);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      box-shadow: var(--mn-shadow-xs, 0 1px 2px rgb(0 0 0 / 0.035));
    }
    ovillo-surface [data-layout-grid-cell-id='gallery'],
    ovillo-surface [data-layout-grid-cell-id='player'] {
      background: transparent;
      border: 0;
      box-shadow: none;
    }
    @media (max-width: 760px) {
      ovillo-surface [data-layout-grid-interior='true'] {
        padding: 10px;
        grid-template-columns: minmax(0, 1fr) !important;
      }
      ovillo-surface [data-layout-grid-cell-id] {
        grid-column: 1 / -1 !important;
      }
    }

    /* ── Faces (rendered into the surface, inside this shadow root) ── */
    .ov-face {
      padding: var(--mn-space-4, 16px);
      min-width: 0;
    }
    .gallery,
    .piece-player {
      padding: 4px 0 0;
      display: grid;
      gap: var(--mn-space-3, 12px);
    }
    .eyebrow {
      display: block;
      font-size: 0.6875rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .display {
      margin: 2px 0 0;
      font-family: var(--mn-font-display, Georgia, serif);
      font-weight: 500;
      font-size: clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem);
      line-height: 1.15;
      color: var(--mn-color-text-title, var(--mn-color-text-primary, #1f2a24));
      overflow-wrap: anywhere;
    }
    .face-head { margin-bottom: var(--mn-space-3, 12px); }
    .face-head h2 {
      margin: 2px 0 0;
      font-family: var(--mn-font-display, Georgia, serif);
      font-weight: 500;
      font-size: 1.125rem;
      overflow-wrap: anywhere;
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: 8px 16px;
    }
    .gallery-head {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: 10px 20px;
    }
    .playlists {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pl {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font: inherit;
      font-size: 0.8125rem;
      padding: 5px 12px;
      border-radius: var(--mn-radius-full, 999px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #1f2a24);
      cursor: pointer;
    }
    .pl .count {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.6875rem;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .pl[aria-pressed='true'] {
      background: var(--mn-color-accent, #4a8b6f);
      border-color: var(--mn-color-accent, #4a8b6f);
      color: var(--mn-color-on-accent, #fff);
    }
    .pl[aria-pressed='true'] .count { color: inherit; opacity: 0.8; }
    .pl:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-focus, #2563eb));
      outline-offset: 2px;
    }
    .prose {
      font-family: var(--mn-font-prose, Georgia, serif);
      font-size: 0.9375rem;
      line-height: 1.55;
      margin: 0 0 var(--mn-space-3, 12px);
      max-width: 68ch;
    }
    .prose.lead { font-size: 1.0625rem; margin: 0; }
    .meta {
      margin: 2px 0 var(--mn-space-3, 12px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.875rem;
    }
    .piece-head .meta { margin-bottom: 6px; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag {
      font-size: 0.75rem;
      padding: 2px 10px;
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .quiet {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.8125rem;
      margin: 6px 0 0;
    }
    .error {
      color: var(--mn-color-text-danger, #b91c1c);
      font-size: 0.8125rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    a, .link {
      color: var(--mn-color-text-link, var(--mn-color-text-accent, #2f6f57));
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .link { display: inline-block; margin-top: var(--mn-space-3, 12px); font-size: 0.875rem; }
    .facts {
      display: grid;
      grid-template-columns: minmax(0, auto) minmax(0, 1fr);
      gap: 4px 14px;
      margin: 0 0 var(--mn-space-3, 12px);
      font-size: 0.875rem;
    }
    .fact { display: contents; }
    .facts dt { color: var(--mn-color-text-secondary, #4b5563); }
    .facts dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
      min-width: 0;
    }
    code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.8125em;
    }
    .files {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      font-size: 0.8125rem;
    }
    pre.score {
      margin: 0;
      padding: 12px 14px;
      max-height: 460px;
      overflow: auto;
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.75rem;
      line-height: 1.55;
      white-space: pre;
      tab-size: 4;
    }
    .piece-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      font-size: 0.8125rem;
      align-items: center;
    }
    .piece-nav .spacer { flex: 1 1 auto; }
    .links {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--mn-space-3, 12px);
      display: grid;
      gap: 6px;
      font-size: 0.875rem;
    }
    .fixture {
      font-size: 0.8125rem;
      padding: 8px 10px;
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-text-warning, #92400e);
      border: 1px solid var(--mn-color-warning-border, #fcd34d);
      margin: 0 0 var(--mn-space-3, 12px);
    }
    .testimony-line {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.6875rem;
      color: var(--mn-color-text-muted, #6b7280);
      overflow-wrap: anywhere;
      margin: 0;
    }
    .mount { padding: var(--mn-space-6, 24px); }
    .score-bench { display: grid; gap: 12px; margin-top: 8px; min-width: 0; }
    .bench-intro { margin: 0; }
    .excerpt { display: flex; flex-wrap: wrap; gap: 6px; }
    .workbench-host { min-width: 0; }
    @media (max-width: 760px) { .mount { padding: 14px 10px; } }
    .mount-empty { max-width: 62ch; }
    .mount .score { margin-top: 12px; }

    /* ── Boot, errors, the testimony strip ── */
    .boot {
      margin: auto;
      padding: 24px;
      max-width: 72ch;
      text-align: center;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .boot.error {
      text-align: left;
      white-space: pre-wrap;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.8125rem;
      color: var(--mn-color-text-danger, #b91c1c);
    }
    footer {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 14px;
      padding: 6px 14px;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.6875rem;
      color: var(--mn-color-text-muted, #6b7280);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-chrome, var(--mn-color-surface-base, #fff));
      min-width: 0;
    }
    footer span { overflow-wrap: anywhere; min-width: 0; }
    footer .fx { color: var(--mn-color-text-warning, #92400e); }
    @media (max-width: 760px) {
      footer { padding: 4px 10px; gap: 0 10px; }
      footer .wide { display: none; }
    }
  `

  @state() private graph: OvilloGraph | null = null
  @state() private bootError = ''
  @state() private layouts: OvilloLayouts | null = null
  @state() private route: OvilloRoute = parseRoute(location.hash)
  @state() private playlistIri = ''
  @state() private currentId = ''
  @state() private soundingId = ''
  @state() private theme: Theme = initialTheme()
  @state() private skin: Skin = 'garden'
  @state() private testimony: GraphReadTestimony | null = null
  @state() private fetched = new Map<string, FetchedJson<unknown>>()

  readonly config: OvilloSourceConfig = sourceConfig(location.search, import.meta.env.VITE_OVILLO_SOURCE as string | undefined)
  readonly media: MediaResolution = { mediaBase: new URLSearchParams(location.search).get('media') ?? '' }
  /** The wasm modules beside the page (the bundle's wasm/; never vendored in this repo). */
  readonly wasm = wasmUrls(location.search)
  readonly source: TripleSource = createOvilloSource(this.config)
  readonly engine: AudioPlayer
  private readonly json = new Map<string, Promise<unknown>>()
  private tracksCache = new Map<string, ReturnType<typeof tracksFor>>()
  private unsubscribe: (() => void) | null = null

  readonly loader: MnAudioDataLoader = (url) => this.fetchJson(url)

  constructor() {
    super()
    const audio = new Audio()
    audio.id = 'ovillo-audio'
    audio.hidden = true
    document.body.appendChild(audio)
    this.engine = createAudioPlayer(audio, { analyse: true })
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.applyAppearance()
    window.addEventListener('hashchange', this.onHash)
    this.unsubscribe = this.engine.subscribe((s) => {
      const id = s.status === 'playing' || s.status === 'loading' ? s.track?.iri ?? '' : ''
      if (id !== this.soundingId) this.soundingId = id
      if (s.track && s.track.iri !== this.currentId && this.route.name === 'home') this.currentId = s.track.iri
    })
    void this.boot()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('hashchange', this.onHash)
    this.unsubscribe?.()
    void this.source.close()
  }

  private readonly onHash = (): void => {
    this.route = parseRoute(location.hash)
  }

  private go(route: OvilloRoute): void {
    const hash = routeHash(route)
    if (location.hash !== hash) location.hash = hash
    else this.route = route
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private async boot(): Promise<void> {
    try {
      const read = await readGraph(this.source, OVILLO_DATA_GRAPH)
      this.testimony = read.testimony
      const graph = parseOvillo(read.triples)
      this.layouts = await loadOvilloLayouts(this.source)
      this.graph = graph
      this.playlistIri = graph.playlists[0]?.iri ?? ''
      this.currentId = graph.playlists[0]?.items[0]?.iri ?? ''
    } catch (cause) {
      this.bootError = describe(cause)
    }
  }

  private fetchJson(url: string): Promise<unknown> {
    let pending = this.json.get(url)
    if (!pending) {
      pending = fetch(url, { headers: { Accept: 'application/json' } }).then(async (r) => {
        if (!r.ok) throw new Error(`GET ${url} → ${r.status}${r.statusText ? ` ${r.statusText}` : ''}`)
        return r.json()
      })
      this.json.set(url, pending)
      pending.catch(() => this.json.delete(url))
    }
    return pending
  }

  /** Fetch (once) and remember a JSON file a face shows; `parse` turns it into what the face draws. */
  private want<T>(url: string | undefined, parse: (json: unknown) => T): FetchedJson<T> {
    if (!url) return { url, data: null, error: '' }
    const have = this.fetched.get(url) as FetchedJson<T> | undefined
    if (have) return have
    const pending: FetchedJson<T> = { url, data: null, error: '' }
    this.fetched.set(url, pending)
    void this.fetchJson(url)
      .then((json) => ({ url, data: parse(json), error: '' }))
      .catch((cause: unknown) => ({ url, data: null, error: cause instanceof Error ? cause.message : String(cause) }))
      .then((done) => {
        this.fetched = new Map(this.fetched).set(url, done)
      })
    return pending
  }

  // ── Appearance ────────────────────────────────────────────────────────────

  private applyAppearance(): void {
    applySkinTheme({ skin: this.skin, theme: this.theme })
    applySkinTheme({ skin: this.skin, theme: this.theme, target: document.body })
  }

  private toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_KEY, this.theme)
    } catch {
      // The choice holds for this visit.
    }
    this.applyAppearance()
  }

  private selectSkin(event: CustomEvent<{ skin?: unknown }>): void {
    const chosen = event.detail?.skin
    if (!isSkin(chosen) || !SKINS.includes(chosen)) return
    this.skin = chosen
    this.applyAppearance()
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('route') || changed.has('graph')) {
      const piece = this.routePiece()
      document.title = piece ? `${piece.title} · Ovillo` : this.route.name === 'home' ? 'Ovillo' : `Ovillo · ${this.route.name}`
    }
  }

  // ── The surface model ─────────────────────────────────────────────────────

  private benchScoresCache: { graph: OvilloGraph; scores: MountFaceValue['benchScores'] } | null = null

  /** Every bench score the graph carries (the bench plays them live). */
  private benchScores(graph: OvilloGraph): MountFaceValue['benchScores'] {
    if (this.benchScoresCache?.graph !== graph) {
      const scores = graph.pieces
        .filter((p) => p.score?.format === 'ovillo-score-json' && p.score.text)
        .map((p) => ({ id: p.iri, title: p.title, json: p.score!.text! }))
      this.benchScoresCache = { graph, scores }
    }
    return this.benchScoresCache.scores
  }

  private routePiece(): OvilloPiece | null {
    const r = this.route
    if (!this.graph || (r.name !== 'piece' && r.name !== 'score')) return null
    return this.graph.bySlug.get(r.slug) ?? null
  }

  private playlistTracks(iri: string) {
    let cached = this.tracksCache.get(iri)
    if (!cached && this.graph) {
      const playlist = this.graph.playlists.find((p) => p.iri === iri) ?? this.graph.playlists[0]
      cached = tracksFor(playlist?.items ?? [], this.media)
      this.tracksCache.set(iri, cached)
    }
    return cached ?? { tracks: [], unplayable: 0 }
  }

  private galleryValue(graph: OvilloGraph): GalleryFaceValue {
    const playlist = graph.playlists.find((p) => p.iri === this.playlistIri) ?? graph.playlists[0]
    const { tracks, unplayable } = this.playlistTracks(playlist.iri)
    const selected = tracks.some((t) => t.id === this.currentId) ? this.currentId : tracks[0]?.id ?? ''
    return {
      playlists: graph.playlists.map((p) => ({ iri: p.iri, title: p.title, count: p.items.length, derived: p.derived })),
      playlistIri: playlist.iri,
      label: playlist.title,
      tracks,
      unplayable,
      selectedId: selected,
      engine: this.engine,
      loader: this.loader,
      onPlaylist: (iri) => {
        this.playlistIri = iri
      },
      onTrackChange: (id) => {
        if (id !== this.currentId) this.currentId = id
      },
    }
  }

  private pieceValue(graph: OvilloGraph, piece: OvilloPiece): PieceFaceValue {
    const r = piece.render
    const order = graph.pieces
    const i = order.indexOf(piece)
    const energyUrl = resolveMediaUrl(r?.energyTrace, this.media)
    const receiptUrl = resolveMediaUrl(r?.receipt, this.media)
    const track = trackForPiece(piece, this.media)
    const files = [
      { label: 'mp3', href: resolveMediaUrl(r?.audio, this.media) },
      { label: 'waveform peaks (JSON)', href: resolveMediaUrl(r?.peaks, this.media) },
      { label: 'energy trace (JSON)', href: energyUrl },
      { label: 'receipt (JSON)', href: receiptUrl },
    ].filter((f): f is { label: string; href: string } => !!f.href)
    return {
      piece,
      track,
      previous: i > 0 ? order[i - 1] : null,
      next: i >= 0 && i < order.length - 1 ? order[i + 1] : null,
      engine: this.engine,
      loader: this.loader,
      energy: this.want<MnEnergyTrace>(energyUrl, parseEnergyTrace),
      receipt: this.want<ReceiptJson>(receiptUrl, (j) => j as ReceiptJson),
      files,
      onSeek: (seconds) => {
        if (!track) return
        if (this.engine.get().track?.iri === track.id) this.engine.seek(seconds)
        else this.engine.play({ iri: track.id, label: track.title, subtitle: track.subtitle ?? '', src: track.src, declaredDuration: track.duration }, seconds)
      },
    }
  }

  private valueFor(faceId: string, graph: OvilloGraph): unknown {
    const piece = this.routePiece()
    switch (faceId) {
      case OVILLO_FACE_IDS.gallery:
        return this.galleryValue(graph)
      case OVILLO_FACE_IDS.now: {
        const p = graph.byIri.get(this.currentId) ?? graph.pieces[0] ?? null
        return { piece: p, sounding: !!p && this.soundingId === p.iri } satisfies NowFaceValue
      }
      case OVILLO_FACE_IDS.about: {
        const t = this.testimony
        return {
          fixture: graph.fixture,
          pieces: graph.pieces.length,
          sourceLine: t ? `${this.source.description.kind} · ${t.tripleCount} triples · ${t.via}${t.via === 'select' ? ` ×${t.pages}` : ''}` : '',
        } satisfies AboutFaceValue
      }
      case OVILLO_FACE_IDS.bench:
        return { kind: 'bench', piece: null, missingSlug: '', engine: this.engine, wasm: this.wasm, benchScores: this.benchScores(graph) } satisfies MountFaceValue
      case OVILLO_FACE_IDS.tract:
        return { kind: 'tract', piece: null, missingSlug: '', engine: this.engine, wasm: this.wasm, benchScores: this.benchScores(graph) } satisfies MountFaceValue
      case OVILLO_FACE_IDS.scoreEditor:
        return { kind: 'score', piece, missingSlug: this.route.name === 'score' ? this.route.slug : '', engine: this.engine, wasm: this.wasm, benchScores: this.benchScores(graph) } satisfies MountFaceValue
      default:
        return piece ? this.pieceValue(graph, piece) : null
    }
  }

  private surfaceModel(graph: OvilloGraph, layouts: OvilloLayouts): WorkspaceSurfaceModel<null> {
    const r = this.route
    let document: LayoutDocument = layouts.docs[r.name]
    if (r.name === 'piece' || r.name === 'score') document = bindPieceLayout(document, idIri('piece', r.slug))
    const bindings = new Map<string, unknown>()
    const bind = (d: ViewDescriptor): void => {
      const id = d.params?.bindingId
      if (typeof id === 'string') bindings.set(id, this.valueFor(d.faceId, graph))
    }
    for (const node of Object.values(document.nodes)) {
      if (node.kind === 'leaf') bind(node.descriptor)
      else if (node.kind === 'grid' && node.children.kind === 'fixed') for (const c of node.children.cells) bind(c.descriptor)
    }
    return { build: () => ({ document, bindings, metadata: null }) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private crumbs(): ChromeBreadcrumb[] {
    const r = this.route
    const piece = this.routePiece()
    const out: ChromeBreadcrumb[] = [{ id: 'home', label: 'Gallery', kind: 'view', current: r.name === 'home' }]
    if (r.name === 'piece') out.push({ id: 'piece', label: piece?.title ?? r.slug, kind: 'view', current: true })
    if (r.name === 'score') {
      out.push({ id: `piece:${r.slug}`, label: piece?.title ?? r.slug, kind: 'view' })
      out.push({ id: 'score', label: 'Score', kind: 'view', current: true })
    }
    if (r.name === 'bench') out.push({ id: 'bench', label: 'Bench', kind: 'view', current: true })
    if (r.name === 'tract') out.push({ id: 'tract', label: 'Tract', kind: 'view', current: true })
    return out
  }

  private onCrumb(event: CustomEvent<{ breadcrumb: ChromeBreadcrumb }>): void {
    const id = event.detail.breadcrumb.id
    if (id === 'home') this.go({ name: 'home' })
    else if (id.startsWith('piece:')) this.go({ name: 'piece', slug: id.slice(6) })
  }

  private footer() {
    const t = this.testimony
    const d = this.source.description
    const layout = this.layouts ? this.layouts.sources[this.route.name] : '—'
    return html`<footer aria-label="Where this page's data came from">
      <span>graph ovillo · ${d.kind}<span class="wide">${d.endpoint ? ` ${d.endpoint}` : ''} (${d.liveness})</span></span>
      ${t
        ? html`<span>${t.tripleCount} triples · ${t.via === 'select' ? `${t.pages} SELECT page${t.pages === 1 ? '' : 's'}` : 'one read'} · read ${new Date(t.readAt).toLocaleTimeString()}</span>`
        : nothing}
      <span>layout ${layout}</span>
      ${this.graph?.fixture ? html`<span class="fx">FIXTURE · not the ovillo graph</span>` : nothing}
    </footer>`
  }

  private body() {
    if (this.bootError) {
      return html`<div class="boot error" role="alert">Ovillo could not read its graph; nothing is shown in its place.\n\n${this.bootError}</div>`
    }
    const graph = this.graph
    const layouts = this.layouts
    if (!graph || !layouts) return html`<div class="boot" role="status">Reading the ovillo graph…</div>`
    const r = this.route
    if (r.name === 'piece' && !graph.bySlug.has(r.slug)) {
      return html`<div class="boot" role="alert">
        <p class="display">No such piece</p>
        <p>The graph has no piece named “${r.slug}”.</p>
        <p><a href=${routeHash({ name: 'home' })}>← Back to the gallery</a></p>
      </div>`
    }
    return html`<ovillo-surface .model=${this.surfaceModel(graph, layouts)}></ovillo-surface>`
  }

  render() {
    return html`<div class="shell">
      <mn-top-bar
        role="banner"
        active-app="ovillo"
        brand="Ovillo"
        .apps=${[OVILLO_TAB]}
        .appLinks=${APP_LINKS}
        .toolbarActions=${NAV_ACTIONS}
        .controls=${['theme', 'skin']}
        .skins=${SKINS}
        .activeSkin=${this.skin}
        .isDark=${this.theme === 'dark'}
        .breadcrumbs=${this.crumbs()}
        @ovillo-go=${(e: CustomEvent<{ route: 'home' | 'bench' | 'tract' }>) => this.go({ name: e.detail.route })}
        @mn-breadcrumb-open=${this.onCrumb}
        @mn-theme-toggle=${() => this.toggleTheme()}
        @mn-skin-select=${(e: CustomEvent<{ skin?: unknown }>) => this.selectSkin(e)}
      ></mn-top-bar>
      <main class="stage">${this.body()}</main>
      ${this.footer()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ovillo-app': OvilloApp
    'ovillo-surface': WorkspaceSurfaceElement<null>
  }
}
