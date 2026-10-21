/**
 * faces.ts — what each cell of an Ovillo page draws, as LayoutInterpreter faces.
 *
 * Each face is a pure function of the value the shell binds to it (data plus
 * callbacks); the shell owns the graph, the engine, the route and every fetch.
 * The gallery is the heart: playlist tabs and the shared `mn-audio-player`.
 * The bench, the tract and the score editor are MOUNT POINTS: they draw the
 * component when it is registered (`mn-ovillo-bench`, `mn-ovillo-tract`), and
 * until then say what will mount there. The score editor shows the score
 * in Hoja's MUS mode for MUS pieces (ov-score-workbench), read-only for bench scores.
 */

import { html, nothing, type TemplateResult } from 'lit'
import { until } from 'lit/directives/until.js'
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import type { WorkspaceBoundFaceDefinition } from '@shrubbery/runtime/layout/surface'
import {
  formatClock,
  formatQuantity,
  type AudioPlayer,
  type MnAudioDataLoader,
  type MnAudioTrack,
  type MnEnergyTrace,
} from '@shrubbery/components/audio'
import { OVILLO_FACE_IDS } from './face-ids.js'
import type { OvilloPiece, OvilloRender } from './model.js'
import { routeHash } from './routes.js'
import { SITE_ORIGIN } from './vocab.js'

// ── Values the shell binds ───────────────────────────────────────────────────

export interface PlaylistTab {
  readonly iri: string
  readonly title: string
  readonly count: number
  readonly derived: boolean
}

export interface GalleryFaceValue {
  readonly playlists: readonly PlaylistTab[]
  readonly playlistIri: string
  readonly label: string
  readonly tracks: readonly MnAudioTrack[]
  readonly unplayable: number
  readonly selectedId: string
  readonly engine: AudioPlayer
  readonly loader: MnAudioDataLoader
  readonly onPlaylist: (iri: string) => void
  readonly onTrackChange: (id: string) => void
}

export interface NowFaceValue {
  readonly piece: OvilloPiece | null
  readonly sounding: boolean
}

export interface AboutFaceValue {
  readonly fixture: boolean
  readonly pieces: number
  readonly sourceLine: string
}

export interface FetchedJson<T> {
  readonly url: string | undefined
  readonly data: T | null
  readonly error: string
}

export interface ReceiptJson {
  readonly schema?: string
  readonly wallSeconds?: number
  readonly eventCount?: number
  readonly voiceCount?: number
  readonly badTokens?: readonly unknown[]
  readonly warnings?: readonly unknown[]
  readonly peakDbfs?: number
  readonly rmsDbfs?: number
}

export interface PieceFaceValue {
  readonly piece: OvilloPiece
  readonly track: MnAudioTrack | null
  /** The piece's place in the gallery's order, for "previous / next piece". */
  readonly previous: OvilloPiece | null
  readonly next: OvilloPiece | null
  readonly engine: AudioPlayer
  readonly loader: MnAudioDataLoader
  readonly energy: FetchedJson<MnEnergyTrace>
  readonly receipt: FetchedJson<ReceiptJson>
  /** Resolved same-origin URLs of the render's files, for the receipt's links. */
  readonly files: ReadonlyArray<{ readonly label: string; readonly href: string }>
  readonly onSeek: (seconds: number) => void
}

export interface MountFaceValue {
  readonly kind: 'bench' | 'tract' | 'score'
  readonly piece: OvilloPiece | null
  readonly missingSlug: string
  /** The app's audio engine (the score editor's takes play through it). */
  readonly engine: AudioPlayer
  /** Same-origin URLs of the wasm modules the mounts load. */
  readonly wasm: { readonly mus: string; readonly bench: string; readonly tract: string }
  /** The graph's bench scores (`ovillo-score-json`), for the bench to play. */
  readonly benchScores: ReadonlyArray<{ readonly id: string; readonly title: string; readonly json: string }>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const acceptsIri = (prefix: string) => (locator: ResourceLocator): boolean =>
  locator.kind === 'iri' && locator.iri.startsWith(prefix)

const PIECE_PREFIX = `${SITE_ORIGIN}/id/piece/`

function shortDigest(d: string | undefined): TemplateResult | string {
  if (!d) return '—'
  const [algo, hex] = d.includes(':') ? d.split(':', 2) : ['', d]
  return html`<code title=${d}>${algo ? `${algo}:` : ''}${hex.slice(0, 12)}…</code>`
}

function num(x: number | undefined, unit: string, digits = 1): string {
  return x === undefined ? '—' : `${x.toFixed(digits)} ${unit}`
}

function row(label: string, value: unknown): TemplateResult {
  return html`<div class="fact"><dt>${label}</dt><dd>${value ?? '—'}</dd></div>`
}

function faceHead(eyebrow: string, title: string): TemplateResult {
  return html`<header class="face-head"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></header>`
}

// ── Gallery (home) ───────────────────────────────────────────────────────────

function galleryFace(v: GalleryFaceValue): TemplateResult {
  return html`<section class="ov-face gallery" data-face="gallery">
    <div class="gallery-head">
      <div>
        <span class="eyebrow">Gallery</span>
        <h1 class="display">Pieces played by Ariadne Worlds</h1>
      </div>
      <nav class="playlists" aria-label="Playlists">
        ${v.playlists.map((p) => html`<button type="button" class="pl" aria-pressed=${String(p.iri === v.playlistIri)}
          data-playlist=${p.iri} @click=${() => v.onPlaylist(p.iri)}>${p.title}<span class="count">${p.count}</span></button>`)}
      </nav>
    </div>
    <mn-audio-player
      global-keys
      .label=${v.label}
      .tracks=${v.tracks}
      .selectedId=${v.selectedId}
      .engine=${v.engine}
      .loader=${v.loader}
      @mn-audio-track-change=${(e: CustomEvent<{ id: string }>) => v.onTrackChange(e.detail.id)}
    ></mn-audio-player>
    ${v.unplayable > 0
      ? html`<p class="quiet">${v.unplayable} ${v.unplayable === 1 ? 'piece has' : 'pieces have'} no audio in the graph and ${v.unplayable === 1 ? 'is' : 'are'} not listed.</p>`
      : nothing}
  </section>`
}

function nowFace(v: NowFaceValue): TemplateResult {
  const p = v.piece
  if (!p) return html`<section class="ov-face"><p class="quiet">Choose a piece.</p></section>`
  const r = p.render
  return html`<section class="ov-face now" data-face="now" data-piece=${p.iri}>
    ${faceHead(v.sounding ? 'About the piece playing' : 'About the piece', p.title)}
    ${p.note ? html`<p class="prose">${p.note}</p>` : nothing}
    <p class="meta">${[p.engine, ...p.instruments.map((i) => i.tuning).filter(Boolean)].filter(Boolean).join(' · ')}</p>
    ${r && r.ledgers.length > 0
      ? html`<mn-energy-ledger compact .ledgers=${r.ledgers}></mn-energy-ledger>`
      : r?.bench
        ? html`<dl class="facts">
            ${row('Bench closure residual', formatQuantity(r.bench.closureResidual, 'J')?.text)}
            ${row('Safety-limited frames', r.bench.safetyLimitedFrames)}
          </dl>`
        : html`<p class="quiet">This render states no ledger.</p>`}
    <a class="link" href=${routeHash({ name: 'piece', slug: p.slug })}>The piece: score, receipt, ledger and traces →</a>
  </section>`
}

function aboutFace(v: AboutFaceValue): TemplateResult {
  return html`<section class="ov-face about" data-face="about">
    ${faceHead('Ovillo', 'Only Ariadne')}
    <p class="prose">Every sound here comes out of an Ariadne World: a physical model of an instrument and its room,
      played by hands written in a score. Each render keeps the World's energy ledger, and the player shows where
      the energy is while you listen.</p>
    ${v.fixture
      ? html`<p class="fixture" role="note">This is the app's <b>fixture</b>: ${v.pieces} pieces standing in for the
          <code>ovillo</code> graph, made from the renders of 2026-10-20.</p>`
      : nothing}
    <ul class="links">
      <li><a href=${routeHash({ name: 'bench' })}>The bench</a> <span class="quiet">a simulated guitarist into a World, live</span></li>
      <li><a href=${routeHash({ name: 'tract' })}>The tract</a> <span class="quiet">a vocal tract, live</span></li>
    </ul>
    <p class="testimony-line">${v.sourceLine}</p>
  </section>`
}

// ── The piece page ───────────────────────────────────────────────────────────

function piecePlayerFace(v: PieceFaceValue): TemplateResult {
  const p = v.piece
  return html`<section class="ov-face piece-player" data-face="piece-player" data-piece=${p.iri}>
    <nav class="piece-nav" aria-label="Pieces">
      <a href=${routeHash({ name: 'home' })}>← Gallery</a>
      <span class="spacer"></span>
      ${v.previous ? html`<a href=${routeHash({ name: 'piece', slug: v.previous.slug })} rel="prev">‹ ${v.previous.title}</a>` : nothing}
      ${v.next ? html`<a href=${routeHash({ name: 'piece', slug: v.next.slug })} rel="next">${v.next.title} ›</a>` : nothing}
    </nav>
    <header class="piece-head">
      <span class="eyebrow">${[p.group, p.render?.created].filter(Boolean).join(' · ')}</span>
      <h1 class="display">${p.title}</h1>
      ${p.engine ? html`<p class="meta">${p.engine}</p>` : nothing}
      ${p.tags.length ? html`<div class="tags">${p.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>` : nothing}
    </header>
    ${p.note ? html`<p class="prose lead">${p.note}</p>` : nothing}
    ${v.track
      ? html`<mn-audio-player variant="single" bare global-keys .tracks=${[v.track]} .label=${p.title} .engine=${v.engine} .loader=${v.loader}></mn-audio-player>`
      : html`<p class="quiet">This render names no audio.</p>`}
  </section>`
}

function pieceTraceFace(v: PieceFaceValue): TemplateResult {
  const r = v.piece.render
  return html`<section class="ov-face" data-face="piece-trace">
    ${faceHead('Energy', 'Where the energy is, by body')}
    ${r?.energyTrace
      ? html`<ov-energy-trace .trace=${v.energy.data} .error=${v.energy.error} .engine=${v.engine} track-id=${v.piece.iri}
          @ov-trace-seek=${(e: CustomEvent<{ seconds: number }>) => v.onSeek(e.detail.seconds)}></ov-energy-trace>`
      : html`<p class="quiet">This render states no energy trace${r?.bench ? ' (a bench run keeps its closure residual instead)' : ''}.</p>`}
  </section>`
}

function pieceLedgerFace(v: PieceFaceValue): TemplateResult {
  const r = v.piece.render
  return html`<section class="ov-face" data-face="piece-ledger">
    ${faceHead('Ledger', r && r.ledgers.length > 1 ? `${r.ledgers.length} Worlds` : 'The World’s energy ledger')}
    ${r && r.ledgers.length > 0
      ? html`<mn-energy-ledger .ledgers=${r.ledgers}></mn-energy-ledger>`
      : r?.bench
        ? html`<dl class="facts">
            ${row('Closure residual', formatQuantity(r.bench.closureResidual, 'J')?.text)}
            ${row('Safety-limited frames', r.bench.safetyLimitedFrames)}
          </dl>
          <p class="quiet">A bench run states its closure residual; it keeps no per-World ledger.</p>`
        : html`<mn-energy-ledger .ledgers=${[]}></mn-energy-ledger>`}
  </section>`
}

function patchSummary(patch: string | undefined): TemplateResult | string {
  if (!patch) return '—'
  try {
    const o = JSON.parse(patch) as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name : typeof o.preset === 'string' ? o.preset : ''
    const keys = Object.keys(o).filter((k) => k !== 'name' && k !== 'preset')
    return html`<span title=${patch}>${name || 'patch'}${keys.length ? html` <span class="quiet">(${keys.length} settings)</span>` : nothing}</span>`
  } catch {
    return html`<code>${patch.slice(0, 40)}</code>`
  }
}

function pieceWorldFace(v: PieceFaceValue): TemplateResult {
  const p = v.piece
  const bench = p.render?.bench ?? null
  return html`<section class="ov-face" data-face="piece-world">
    ${faceHead('World', p.instruments.length > 1 ? `${p.instruments.length} instruments` : 'The instrument')}
    ${p.instruments.length === 0 ? html`<p class="quiet">The graph names no instrument for this piece.</p>` : nothing}
    ${p.instruments.map((i) => html`<dl class="facts" data-instrument=${i.iri}>
      ${row('Instrument', i.title)}
      ${row('Kind', i.kind)}
      ${i.anatomy ? row('Anatomy', html`<code>${i.anatomy}</code>`) : nothing}
      ${i.tuning ? row('Tuning', i.tuning) : nothing}
    </dl>`)}
    ${bench
      ? html`<dl class="facts" data-bench=${bench.iri}>
          ${row('Bench pattern', bench.pattern)}
          ${row('Pickup', bench.pickup)}
          ${row('Patch', patchSummary(bench.patch))}
        </dl>`
      : nothing}
  </section>`
}

function receiptFacts(r: OvilloRender, receipt: ReceiptJson | null): TemplateResult {
  return html`<dl class="facts">
    ${row('Duration', r.durationSeconds !== undefined ? `${formatClock(r.durationSeconds)} (${r.durationSeconds.toFixed(2)} s)` : undefined)}
    ${row('Engine', r.engineVersion ? html`<code>${r.engineVersion}</code>` : undefined)}
    ${row('Render digest', shortDigest(r.renderDigest))}
    ${row('World peak', num(r.worldPeakDbfs, 'dBFS'))}
    ${row('World RMS', num(r.worldRmsDbfs, 'dBFS'))}
    ${row('Page gain', r.pageGainDb !== undefined ? `${r.pageGainDb >= 0 ? '+' : ''}${r.pageGainDb.toFixed(1)} dB` : undefined)}
    ${row('Wall time', num(r.wallSeconds ?? receipt?.wallSeconds, 's'))}
    ${row('Events', r.eventCount ?? receipt?.eventCount)}
    ${receipt ? row('Warnings', receipt.warnings?.length ?? '—') : nothing}
    ${receipt ? row('Bad tokens', receipt.badTokens?.length ?? '—') : nothing}
    ${r.sourceRevision ? row('Source revision', html`<code title=${r.sourceRevision}>${r.sourceRevision.slice(0, 10)}</code>`) : nothing}
    ${r.created ? row('Rendered', r.created) : nothing}
  </dl>`
}

function pieceReceiptFace(v: PieceFaceValue): TemplateResult {
  const r = v.piece.render
  return html`<section class="ov-face" data-face="piece-receipt">
    ${faceHead('Receipt', 'The render')}
    ${r ? receiptFacts(r, v.receipt.data) : html`<p class="quiet">The graph states no render for this piece.</p>`}
    ${v.receipt.error ? html`<p class="error">The receipt file could not be read: ${v.receipt.error}</p>` : nothing}
    ${v.receipt.data?.schema ? html`<p class="quiet">Receipt schema <code>${v.receipt.data.schema}</code>.</p>` : nothing}
    ${v.files.length ? html`<ul class="files">${v.files.map((f) => html`<li><a href=${f.href}>${f.label}</a></li>`)}</ul>` : nothing}
  </section>`
}

function pieceScoreFace(v: PieceFaceValue): TemplateResult {
  const s = v.piece.score
  return html`<section class="ov-face" data-face="piece-score">
    <header class="face-head row-head">
      <div><span class="eyebrow">Score${s?.format ? ` · ${s.format}` : ''}</span><h2>${s?.repoPath ?? 'The score'}</h2></div>
      ${s ? html`<a class="link" href=${routeHash({ name: 'score', slug: v.piece.slug })}>Open in the score editor →</a>` : nothing}
    </header>
    ${s?.text
      ? html`<pre class="score" data-format=${s.format ?? ''} tabindex="0" aria-label="Score, read-only">${s.text}</pre>`
      : html`<p class="quiet">The graph carries no score text for this piece.</p>`}
    ${s ? html`<p class="quiet">Read-only for now. Source digest ${shortDigest(s.sourceDigest)}${s.generator ? html` · written by <code>${s.generator}</code>` : nothing}.</p>` : nothing}
  </section>`
}

// ── Mount points ─────────────────────────────────────────────────────────────

/** The live instruments' modules, loaded once on demand (each brings its own canvas/WebGL and audio code). */
const MOUNT_MODULES: Record<'bench' | 'tract', () => Promise<unknown>> = {
  bench: () => import('./bench/mn-ovillo-bench.js'),
  tract: () => import('./tract/mn-ovillo-tract.js'),
}
const mountLoads = new Map<string, Promise<unknown>>()

function loadMount(kind: 'bench' | 'tract'): Promise<unknown> {
  let p = mountLoads.get(kind)
  if (!p) {
    p = MOUNT_MODULES[kind]()
    p.catch(() => mountLoads.delete(kind))
    mountLoads.set(kind, p)
  }
  return p
}

const MOUNT_TITLES = { bench: 'The bench', tract: 'The tract' } as const

function mountFace(v: MountFaceValue): TemplateResult {
  if (v.kind === 'score') return scoreEditorFace(v)
  const kind = v.kind
  const tag = kind === 'bench' ? 'mn-ovillo-bench' : 'mn-ovillo-tract'
  const loading = loadMount(kind)
  const defined = typeof customElements !== 'undefined' && customElements.get(tag) !== undefined
  // The element is written now and upgrades when its module arrives; until then (or if it cannot load) the
  // face says so.
  const status = until(
    loading.then(
      () => nothing,
      (error: unknown) => html`<p class="error" role="alert">${MOUNT_TITLES[kind]} could not load: ${error instanceof Error ? error.message : String(error)}</p>`,
    ),
    defined ? nothing : html`<p class="quiet">Loading ${MOUNT_TITLES[kind].toLowerCase()}…</p>`,
  )
  return html`<section class="ov-face mount" data-face=${`mount-${kind}`} data-mount=${tag} data-mounted=${String(defined)}>
    <nav class="piece-nav"><a href=${routeHash({ name: 'home' })}>← Gallery</a></nav>
    ${status}
    ${kind === 'bench'
      ? html`<mn-ovillo-bench class="mounted" wasm=${v.wasm.bench} .scores=${v.benchScores}></mn-ovillo-bench>`
      : html`<mn-ovillo-tract class="mounted" wasm=${v.wasm.tract}></mn-ovillo-tract>`}
  </section>`
}

let workbench: Promise<unknown> | null = null
/** The editor's module, loaded once on demand (it brings TipTap); a failure is said, not swallowed. */
function loadScoreWorkbench(): Promise<unknown> {
  if (!workbench) {
    workbench = import('./ov-score-workbench.js').catch((error: unknown) => {
      workbench = null
      console.error('ovillo: the score editor could not load', error)
    })
  }
  return workbench
}

/**
 * The score editor: Hoja's MUS mode on the piece's score (ov-score-workbench,
 * loaded on demand), for MUS pieces. A bench score (the bench's JSON) stays
 * read-only: the bench plays it live, and there is no MUS mode for it.
 */
function scoreEditorFace(v: MountFaceValue): TemplateResult {
  const p = v.piece
  if (!p) {
    return html`<section class="ov-face mount" data-face="mount-score"><p class="quiet">No piece named “${v.missingSlug}” in the graph.</p>
      <a class="link" href=${routeHash({ name: 'home' })}>← Back to the gallery</a></section>`
  }
  const s = p.score
  const mus = s?.format === 'mus' && !!s.text
  if (mus) void loadScoreWorkbench()
  return html`<section class="ov-face mount" data-face="mount-score" data-mount=${mus ? 'hoja-mus' : 'read-only'} data-score=${s?.iri ?? ''} data-format=${s?.format ?? ''}>
    <nav class="piece-nav"><a href=${routeHash({ name: 'piece', slug: p.slug })}>← ${p.title}</a></nav>
    <span class="eyebrow">Score editor${s?.format ? ` · ${s.format}` : ''}</span>
    <h1 class="display">${p.title}</h1>
    ${mus
      ? html`<ov-score-workbench .piece=${{ iri: p.iri, slug: p.slug, title: p.title, note: p.note, score: s!.text! }} .engine=${v.engine} wasm=${v.wasm.mus}></ov-score-workbench>`
      : html`<div class="read-only">
          <p class="quiet">${s?.format === 'ovillo-score-json'
            ? 'This is a score for the bench’s simulated guitarist (JSON); the bench plays it live. It stays read-only here.'
            : 'This piece has no MUS score to edit.'}</p>
          ${s?.text ? html`<pre class="score" tabindex="0" aria-label="Score, read-only">${s.text}</pre>` : nothing}
        </div>`}
  </section>`
}

// ── The catalogue ────────────────────────────────────────────────────────────

function face<T>(
  faceId: string,
  accepts: (locator: ResourceLocator) => boolean,
  render: (value: T) => TemplateResult,
  persistence: WorkspaceBoundFaceDefinition['persistence'] = 'persistent-relocatable',
  minHeight = 160,
): WorkspaceBoundFaceDefinition {
  return {
    faceId,
    persistence,
    accepts,
    constraints: () => ({ minWidth: 280, minHeight, overflow: 'scroll' }),
    render: (_target, value) => render(value as T),
  }
}

export const OVILLO_FACE_CATALOGUE: readonly WorkspaceBoundFaceDefinition[] = [
  face<GalleryFaceValue>(OVILLO_FACE_IDS.gallery, acceptsIri(`${SITE_ORIGIN}/id/gallery`), galleryFace, 'persistent-relocatable', 420),
  face<NowFaceValue>(OVILLO_FACE_IDS.now, acceptsIri(`${SITE_ORIGIN}/id/gallery`), nowFace),
  face<AboutFaceValue>(OVILLO_FACE_IDS.about, acceptsIri(`${SITE_ORIGIN}/id/about`), aboutFace),
  face<PieceFaceValue>(OVILLO_FACE_IDS.piecePlayer, acceptsIri(PIECE_PREFIX), piecePlayerFace, 'persistent-relocatable', 320),
  face<PieceFaceValue>(OVILLO_FACE_IDS.pieceTrace, acceptsIri(PIECE_PREFIX), pieceTraceFace),
  face<PieceFaceValue>(OVILLO_FACE_IDS.pieceLedger, acceptsIri(PIECE_PREFIX), pieceLedgerFace),
  face<PieceFaceValue>(OVILLO_FACE_IDS.pieceWorld, acceptsIri(PIECE_PREFIX), pieceWorldFace),
  face<PieceFaceValue>(OVILLO_FACE_IDS.pieceReceipt, acceptsIri(PIECE_PREFIX), pieceReceiptFace),
  face<PieceFaceValue>(OVILLO_FACE_IDS.pieceScore, acceptsIri(PIECE_PREFIX), pieceScoreFace),
  face<MountFaceValue>(OVILLO_FACE_IDS.bench, acceptsIri(`${SITE_ORIGIN}/id/bench`), mountFace, 'persistent-non-relocatable', 360),
  face<MountFaceValue>(OVILLO_FACE_IDS.tract, acceptsIri(`${SITE_ORIGIN}/id/tract`), mountFace, 'persistent-non-relocatable', 360),
  face<MountFaceValue>(OVILLO_FACE_IDS.scoreEditor, acceptsIri(PIECE_PREFIX), mountFace, 'persistent-relocatable', 360),
]
