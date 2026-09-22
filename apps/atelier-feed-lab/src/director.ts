/**
 * director.ts — the feed-lab orchestrator: the SAME pipeline logic the
 * original single-file main.ts carried, restructured to drive the three
 * layout leaves (afl-broadcast / afl-director / afl-pipeline) instead of
 * poking a hand-rolled innerHTML shell.
 *
 * SEMANTICS ARE PRESERVED, deliberately:
 *   - the same API calls in the same order (provider check → storyboard →
 *     three parallel Seedance submissions → polling);
 *   - the progressive in-order enqueue: story order is CLAIMED SYNCHRONOUSLY
 *     (nextToEnqueue advances before any await) so concurrent completions can
 *     never enqueue out of order or twice;
 *   - the same failure behavior (active stages reset to waiting, idle keeps
 *     the feed, the error lands in the pipeline title);
 *   - the same playout contract: VideoPlayout owns the two deck elements and
 *     their `is-active` class; this orchestrator owns `body.dataset.feed`.
 *
 * View writes all flow through leaf props — the leaves render, they never
 * decide.
 */

import { clips, type LocalClip } from './catalog.js'
import { embeddedHostOf, isPendingEntity, roleForKind, type WebEntity } from './catalog/reference-web-codec.js'
import { VideoPlayout } from './playout.js'
import { familyFor } from './story-families.js'
import type { AflBroadcast } from './leaves/afl-broadcast.js'
import type { AflDirector } from './leaves/afl-director.js'
import type {
  AflLibrary,
  EntityInspection,
  RunDetail,
  RunSummary,
} from './leaves/afl-library.js'
import type { PackDraft, PackReview } from './leaves/afl-pack.js'
import type { AflPipeline, PipelineStage, StageState } from './leaves/afl-pipeline.js'

type StageName = 'references' | 'still' | 'motion' | 'decode'

interface ShotRequest {
  id: string
  characterId: string
  propId: string
  sceneId: string
  direction: string
  requestedAt: number
}

interface GeneratedFrameResult {
  error?: string
  imageDataUrl?: string
  inputHash?: string
  latencyMs?: number
  model?: string
  requestId?: string | null
}

interface StoryboardAnchor {
  id: string
  imageDataUrl: string
}

interface StoryboardResult {
  error?: string
  storyId?: string
  anchors?: StoryboardAnchor[]
  inputHash?: string
  latencyMs?: number
  model?: string
  requestId?: string | null
  composition?: string
  /** Present when the storyboard was composed from a reference-web pack. */
  pack?: Array<{ role: string; id: string }>
}

interface VideoJobResult {
  error?: string
  jobId?: string
  remoteId?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired'
  model?: string
  durationSeconds?: number
  resolution?: string
  inputHash?: string
  submittedAt?: number
  submitLatencyMs?: number
  generationLatencyMs?: number
  downloadLatencyMs?: number
  totalLatencyMs?: number
  cost?: number
  videoUrl?: string
  bridgeIndex?: number
  firstAnchor?: string
  lastAnchor?: string
}

const STAGE_ORDER: readonly StageName[] = ['references', 'still', 'motion', 'decode']

const STAGE_COPY: Record<StageName, { label: string; detail: string }> = {
  references: { label: 'Assemble references', detail: 'local cache' },
  still: { label: 'Render four anchors', detail: 'gpt-image-2 · 2×2 sheet' },
  motion: { label: 'Bridge the anchors', detail: '3× Seedance Fast · parallel' },
  decode: { label: 'Play the story', detail: 'progressive ordered splice' },
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export class FeedLabDirector {
  private readonly broadcast: AflBroadcast
  private readonly director: AflDirector
  private readonly pipeline: AflPipeline
  private readonly library: AflLibrary
  private playout!: VideoPlayout

  // ── The reference web (decoded from the catalog fossil at boot) ───────────
  private readonly web: readonly WebEntity[]
  private readonly character: WebEntity
  private readonly propAssets: readonly WebEntity[]
  private readonly sceneAssets: readonly WebEntity[]

  private selectedProp: WebEntity
  private selectedScene: WebEntity
  private direction: string
  private take = 1
  private busy = false
  private latestStoryClips: LocalClip[] = []
  private stageStates: Record<StageName, { state: StageState; seconds?: number }> = {
    references: { state: 'waiting' },
    still: { state: 'waiting' },
    motion: { state: 'waiting' },
    decode: { state: 'waiting' },
  }

  // ── Pack state (the composer's single source of truth) ────────────────────
  private pack: readonly PackDraft[] = []
  private review: PackReview | null = null
  private composeBusy = false

  // ── Library state (the ledger reader's single source of truth) ────────────
  private libraryRuns: RunSummary[] = []
  private libraryPinned: string[] = []

  constructor(
    leaves: { broadcast: AflBroadcast; director: AflDirector; pipeline: AflPipeline; library: AflLibrary },
    web: readonly WebEntity[],
  ) {
    this.broadcast = leaves.broadcast
    this.director = leaves.director
    this.pipeline = leaves.pipeline
    this.library = leaves.library

    this.web = web
    const ready = (kind: WebEntity['kind']): WebEntity[] =>
      web.filter((entity) => entity.kind === kind && entity.providerReference !== undefined)
    const [character] = ready('character')
    this.propAssets = ready('prop')
    this.sceneAssets = ready('scene')
    if (!character || this.propAssets.length === 0 || this.sceneAssets.length === 0) {
      throw new Error('the reference web has no ready character/prop/scene — check the catalog fossil')
    }
    this.character = character
    this.selectedProp = this.propAssets[0]
    this.selectedScene = this.sceneAssets[0]
    this.direction = familyFor(this.selectedProp.id).impulse
  }

  /** Wire the leaves, build the playout, run the restore boot. */
  async start(): Promise<void> {
    this.director.character = this.character
    this.director.propAssets = this.propAssets
    this.director.sceneAssets = this.sceneAssets
    this.director.webEntities = this.web
    this.director.direction = this.direction
    this.director.take = this.take
    this.syncSelection()
    this.syncPack()
    this.resetStages()
    this.pipeline.title = 'Idle is carrying the feed.'

    this.director.addEventListener('afl-select-prop', (event) =>
      this.onSelectProp((event as CustomEvent<{ assetId: string }>).detail.assetId),
    )
    this.director.addEventListener('afl-select-scene', (event) =>
      this.onSelectScene((event as CustomEvent<{ assetId: string }>).detail.assetId),
    )
    this.director.addEventListener('afl-direction', (event) => {
      this.direction = (event as CustomEvent<{ value: string }>).detail.value
      // The direction is part of any reviewed call; editing it reopens review.
      this.invalidateReview()
    })
    this.director.addEventListener('afl-direct', () => void this.directShot())
    this.director.addEventListener('afl-pack-add', (event) =>
      this.onPackAdd((event as CustomEvent<{ id: string }>).detail.id),
    )
    this.director.addEventListener('afl-pack-remove', (event) =>
      this.onPackRemove((event as CustomEvent<{ index: number }>).detail.index),
    )
    this.director.addEventListener('afl-pack-move', (event) => {
      const { index, delta } = (event as CustomEvent<{ index: number; delta: number }>).detail
      this.onPackMove(index, delta)
    })
    this.director.addEventListener('afl-pack-preset', (event) =>
      this.onPackPreset((event as CustomEvent<{ preset: 'cactus' | 'moon' }>).detail.preset),
    )
    this.director.addEventListener('afl-pack-clear', () => {
      this.pack = []
      this.invalidateReview()
      this.syncPack()
    })
    this.director.addEventListener('afl-pack-compose', () => void this.composePack())
    this.broadcast.addEventListener('afl-replay', () => {
      if (this.latestStoryClips.length > 0) void this.playout.queueSequence(this.latestStoryClips)
    })

    // ── The library: the ledger's reading room ────────────────────────────
    this.broadcast.addEventListener('afl-library-open', () => void this.openLibrary())
    // afl-entity-inspect bubbles composed from afl-pack through the director
    // rail, and also from the library's own reference cards.
    this.director.addEventListener('afl-entity-inspect', (event) =>
      void this.openEntity((event as CustomEvent<{ id: string }>).detail.id),
    )
    this.library.addEventListener('afl-entity-inspect', (event) =>
      void this.openEntity((event as CustomEvent<{ id: string }>).detail.id),
    )
    this.library.addEventListener('afl-library-close', () => {
      this.library.open = false
      this.library.status = ''
    })
    this.library.addEventListener('afl-library-show-list', () => {
      this.library.view = 'list'
      this.library.status = ''
      void this.refreshRuns()
    })
    this.library.addEventListener('afl-library-open-run', (event) =>
      void this.openRun((event as CustomEvent<{ runId: string }>).detail.runId),
    )
    this.library.addEventListener('afl-library-pin', (event) =>
      this.togglePin((event as CustomEvent<{ runId: string }>).detail.runId),
    )
    this.library.addEventListener('afl-library-compare', () => void this.openCompare())
    this.library.addEventListener('afl-library-queue', (event) =>
      void this.queueRun((event as CustomEvent<{ runId: string }>).detail.runId),
    )

    const decks = await this.broadcast.decks()
    this.playout = new VideoPlayout(decks, [clips.idleGlasshouse, clips.idleNight], {
      onClipChange: (clip: LocalClip) => {
        if (clip.kind === 'shot') this.broadcast.clearFrame()
        this.broadcast.currentAnchor =
          clip.kind === 'shot' && clip.storyIndex !== undefined ? clip.storyIndex : -1
        this.broadcast.nowPlaying = clip.label
        this.broadcast.feedState = clip.kind === 'idle' ? 'idle loop' : 'generated splice'
        document.body.dataset.feed = clip.kind
        this.broadcast.bufferCopy =
          clip.kind === 'idle'
            ? 'idle coverage · continuous'
            : `${clip.durationSeconds}s shot playing · idle held in reserve`
      },
      onBufferChange: (clip: LocalClip | null) => {
        this.broadcast.bufferCopy = clip ? `ready · ${clip.label}` : 'standby deck open'
      },
    })

    await this.boot()
  }

  // ── Selection (the cactus/moon family swap, verbatim rule) ────────────────

  private onSelectProp(assetId: string): void {
    const asset = this.propAssets.find((candidate) => candidate.id === assetId)
    if (!asset) return
    const previousImpulse = familyFor(this.selectedProp.id).impulse
    this.selectedProp = asset
    if (this.direction.trim() === previousImpulse.trim()) {
      this.direction = familyFor(asset.id).impulse
      this.director.direction = this.direction
    }
    this.syncSelection()
  }

  private onSelectScene(assetId: string): void {
    const asset = this.sceneAssets.find((candidate) => candidate.id === assetId)
    if (!asset) return
    this.selectedScene = asset
    this.syncSelection()
  }

  private syncSelection(): void {
    this.director.selectedPropId = this.selectedProp.id
    this.director.selectedSceneId = this.selectedScene.id
    this.pipeline.lineage = this.lineageBase()
  }

  // ── The pack composer (orchestrator-owned state; afl-pack only renders) ───

  /** The lineage prefix: the assembled pack when one exists, else the legacy
   *  three-reference selection. */
  private lineageBase(): string {
    return this.pack.length > 0
      ? this.packLineage(this.pack)
      : `${this.character.id} + ${this.selectedProp.id} + ${this.selectedScene.id}`
  }

  private packLineage(entries: ReadonlyArray<{ role: string; id: string }>): string {
    return `pack(${entries.map((entry) => entry.role).join('+')}): ${entries.map((entry) => entry.id).join(' + ')}`
  }

  private syncPack(): void {
    this.director.pack = this.pack
    this.director.packReview = this.review
    this.director.composeBusy = this.composeBusy
    this.pipeline.lineage = this.lineageBase()
  }

  /** Any change to the pack or the direction reopens review — spending is
   *  only ever allowed on a call that has been read as composed. */
  private invalidateReview(): void {
    if (this.review !== null) {
      this.review = null
      this.syncPack()
    }
  }

  private onPackAdd(id: string): void {
    const entity = this.web.find((candidate) => candidate.id === id)
    if (!entity || isPendingEntity(entity) || this.pack.some((entry) => entry.id === id)) return
    this.pack = [...this.pack, { role: roleForKind(entity.kind), id }]
    this.invalidateReview()
    this.syncPack()
  }

  private onPackRemove(index: number): void {
    if (index < 0 || index >= this.pack.length) return
    this.pack = this.pack.filter((_, at) => at !== index)
    this.invalidateReview()
    this.syncPack()
  }

  private onPackMove(index: number, delta: number): void {
    const target = index + delta
    if (index < 0 || index >= this.pack.length || target < 0 || target >= this.pack.length) return
    const next = [...this.pack]
    ;[next[index], next[target]] = [next[target], next[index]]
    this.pack = next
    this.invalidateReview()
    this.syncPack()
  }

  /** Presets follow the web's own wires: identity + the family prop + the
   *  scene its `pairs-with` relation names — today's one-click packs. */
  private onPackPreset(preset: 'cactus' | 'moon'): void {
    const propId = preset === 'cactus' ? 'prop:star-cactus' : 'prop:moon-lantern'
    const prop = this.web.find((entity) => entity.id === propId)
    const sceneId = prop?.relations.find((relation) => relation.kind === 'pairs-with')?.target
    if (!prop || !sceneId) return
    const previousImpulse = familyFor(this.selectedProp.id).impulse
    this.pack = [
      { role: 'identity', id: this.character.id },
      { role: 'prop', id: propId },
      { role: 'scene', id: sceneId },
    ]
    if (this.direction.trim() === previousImpulse.trim()) {
      this.direction = familyFor(propId).impulse
      this.director.direction = this.direction
    }
    this.invalidateReview()
    this.syncPack()
  }

  /** Compose-then-inspect: dry_run returns the fully composed call — roles,
   *  ordered references, full prompt, input hash — with no provider call. */
  private async composePack(): Promise<void> {
    if (this.pack.length === 0 || this.composeBusy) return
    this.composeBusy = true
    this.review = null
    this.syncPack()
    try {
      const response = await fetch('/api/generate-storyboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack: this.pack, direction: this.direction.trim(), dry_run: true }),
      })
      const result = (await response.json()) as PackReview & { error?: string }
      this.review = response.ok ? result : { error: result.error ?? 'Dry-run composition failed' }
    } catch (error) {
      this.review = { error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.composeBusy = false
      this.syncPack()
    }
  }

  // ── The run library (all fetches live here; afl-library only renders) ─────

  private async openLibrary(): Promise<void> {
    this.library.open = true
    this.library.view = 'list'
    this.library.status = ''
    await this.refreshRuns()
  }

  private async refreshRuns(): Promise<void> {
    this.library.loading = true
    try {
      const response = await fetch('/api/runs')
      this.libraryRuns = response.ok ? ((await response.json()) as RunSummary[]) : []
    } catch {
      this.libraryRuns = []
    }
    this.library.runs = this.libraryRuns
    this.library.loading = false
  }

  private async fetchRunDetail(runId: string): Promise<RunDetail | null> {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`)
      return response.ok ? ((await response.json()) as RunDetail) : null
    } catch {
      return null
    }
  }

  private async openRun(runId: string): Promise<void> {
    this.library.open = true
    this.library.view = 'run'
    this.library.activeRun = null
    this.library.loading = true
    this.library.activeRun = await this.fetchRunDetail(runId)
    this.library.loading = false
  }

  private togglePin(runId: string): void {
    this.libraryPinned = this.libraryPinned.includes(runId)
      ? this.libraryPinned.filter((id) => id !== runId)
      : [...this.libraryPinned, runId].slice(-2)
    this.library.pinned = this.libraryPinned
    if (this.library.view === 'compare') {
      if (this.libraryPinned.length === 2) void this.openCompare()
      else {
        this.library.compareRuns = null
        this.library.view = 'list'
      }
    }
  }

  private async openCompare(): Promise<void> {
    if (this.libraryPinned.length !== 2) return
    this.library.view = 'compare'
    this.library.compareRuns = null
    this.library.loading = true
    const [left, right] = await Promise.all(this.libraryPinned.map((id) => this.fetchRunDetail(id)))
    this.library.compareRuns = left && right ? [left, right] : null
    this.library.loading = false
  }

  /** Entity inspection: the web entity's own language + its study (or the
   *  browser-private doctrine, hash instead of pixels) + the runs that used
   *  it, derived from the run records. */
  private async openEntity(id: string): Promise<void> {
    const entity = this.web.find((candidate) => candidate.id === id)
    if (!entity) return
    this.library.open = true
    this.library.view = 'entity'
    this.library.entity = null
    this.library.loading = true
    await this.refreshRuns()
    const usedBy = this.libraryRuns.filter(
      (run) =>
        run.pack?.some((entry) => entry.id === id) ||
        run.references?.some((reference) => reference.id === id),
    )
    const locked = entity.kind === 'character'
    let doctrine: string | undefined
    let sha256: string | null | undefined
    let studyUrl: string | null = null
    let pendingNote: string | undefined
    if (locked) {
      // The 403 is the feature: it carries the doctrine and the plate's hash.
      try {
        const response = await fetch(`/api/entity-study/${encodeURIComponent(id)}`)
        const body = (await response.json()) as { doctrine?: string; sha256?: string | null }
        doctrine = body.doctrine
        sha256 = body.sha256
      } catch {
        doctrine = 'The identity source plate is browser-private and never crosses to a client.'
      }
    } else if (entity.providerReference !== undefined) {
      studyUrl = `/api/entity-study/${encodeURIComponent(id)}`
    } else {
      const host = embeddedHostOf(entity)
      pendingNote = host !== undefined ? `pixels ride embedded in ${host}` : 'reference study pending'
    }
    const inspection: EntityInspection = {
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      description: entity.description,
      compositionNotes: entity.compositionNotes,
      invariant: entity.invariant,
      locked,
      doctrine,
      sha256,
      studyUrl,
      pendingNote,
      usedBy,
    }
    this.library.entity = inspection
    this.library.loading = false
  }

  /** Queue a recorded run's bridges into the feed — the EXISTING playout
   *  path (queueSequence), the same labels and ordering the live pipeline
   *  uses. Replay follows the queued story, as it does for a fresh one. */
  private async queueRun(runId: string): Promise<void> {
    const detail =
      this.library.activeRun?.runId === runId ? this.library.activeRun : await this.fetchRunDetail(runId)
    if (!detail) return
    const storyClips = (detail.bridges ?? [])
      .filter((bridge) => bridge.videoUrl && bridge.status === 'completed')
      .sort((left, right) => (left.bridgeIndex ?? 0) - (right.bridgeIndex ?? 0))
      .map((bridge, fallbackIndex): LocalClip => {
        const index = bridge.bridgeIndex ?? fallbackIndex
        return {
          id: `clip:${bridge.jobId ?? `${runId}-${index}`}`,
          src: bridge.videoUrl!,
          poster: detail.hasSheet
            ? `/api/runs/${encodeURIComponent(runId)}/anchor-${'abcd'[index] ?? 'a'}.jpg`
            : '',
          label: `story ${String.fromCharCode(65 + index)}→${String.fromCharCode(66 + index)} · Seedance`,
          kind: 'shot',
          durationSeconds: 4,
          storyIndex: index,
        }
      })
    if (storyClips.length === 0) return
    this.latestStoryClips = storyClips
    this.broadcast.replayVisible = true
    this.library.status = `queued ${storyClips.length} clip${storyClips.length === 1 ? '' : 's'} — the feed takes them at the next idle boundary`
    await this.playout.queueSequence(storyClips)
  }

  // ── Pipeline stages ───────────────────────────────────────────────────────

  private setStage(stage: StageName, state: StageState, duration?: number): void {
    this.stageStates[stage] = { state, seconds: state === 'done' ? duration : undefined }
    this.pushStages()
  }

  private resetStages(): void {
    for (const stage of STAGE_ORDER) this.stageStates[stage] = { state: 'waiting' }
    this.pushStages()
  }

  private pushStages(): void {
    this.pipeline.stages = STAGE_ORDER.map(
      (stage): PipelineStage => ({
        stage,
        label: STAGE_COPY[stage].label,
        detail: STAGE_COPY[stage].detail,
        state: this.stageStates[stage].state,
        seconds: this.stageStates[stage].seconds,
      }),
    )
  }

  private async runStage(stage: StageName, ms: number): Promise<void> {
    const startedAt = performance.now()
    this.setStage(stage, 'active')
    await wait(ms)
    this.setStage(stage, 'done', (performance.now() - startedAt) / 1000)
  }

  // ── Presentation over the broadcast leaf ──────────────────────────────────

  private async presentGeneratedFrame(result: GeneratedFrameResult): Promise<void> {
    if (!result.imageDataUrl) throw new Error('Generated frame has no image data')
    await this.broadcast.presentFrame(result.imageDataUrl)
    this.broadcast.nowPlaying = 'generated frame · gpt-image-2'
    this.broadcast.feedState = 'still · motion next'
    this.broadcast.bufferCopy = `frame ready in ${((result.latencyMs ?? 0) / 1000).toFixed(1)}s · idle moving underneath`
  }

  private async presentStoryboard(result: StoryboardResult): Promise<void> {
    if (!result.anchors?.length) throw new Error('Generated storyboard has no anchors')
    this.broadcast.anchors = result.anchors
    await this.broadcast.presentFrame(result.anchors[0].imageDataUrl)
    this.broadcast.nowPlaying = 'storyboard anchor A · gpt-image-2'
    this.broadcast.feedState = 'four anchors · bridges next'
    this.broadcast.bufferCopy = `four anchors ready in ${((result.latencyMs ?? 0) / 1000).toFixed(1)}s · parallel motion next`
  }

  // ── Seedance jobs (identical request/poll/failure semantics) ──────────────

  private async submitVideoJob(
    motionDirection: string,
    firstAnchorIndex: number,
    lastAnchorIndex: number,
  ): Promise<VideoJobResult> {
    const response = await fetch('/api/video-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: motionDirection, firstAnchorIndex, lastAnchorIndex }),
    })
    const result = (await response.json()) as VideoJobResult
    if (!response.ok || !result.jobId) throw new Error(result.error ?? 'Seedance submission failed')
    return result
  }

  private async waitForVideo(initial: VideoJobResult): Promise<VideoJobResult> {
    if (!initial.jobId) throw new Error('Seedance returned no local job ID')
    const deadline = Date.now() + 10 * 60_000
    let consecutivePollFailures = 0
    let result = initial

    while (Date.now() < deadline) {
      if (result.status === 'completed') {
        if (!result.videoUrl) throw new Error('Seedance completed without a cached video URL')
        return result
      }
      if (result.status && ['failed', 'cancelled', 'expired'].includes(result.status)) {
        throw new Error(`Seedance job ${result.status}${result.error ? `: ${result.error}` : ''}`)
      }

      const elapsedSeconds = Math.round((Date.now() - (result.submittedAt ?? Date.now())) / 1000)
      this.broadcast.bufferCopy = `Seedance ${result.status ?? 'pending'} · ${elapsedSeconds}s elapsed · idle coverage continuous`
      await wait(3_000)

      const response = await fetch(`/api/video-jobs/${encodeURIComponent(initial.jobId)}`)
      const next = (await response.json()) as VideoJobResult
      if (!response.ok) {
        consecutivePollFailures += 1
        if (consecutivePollFailures >= 3) throw new Error(next.error ?? 'Seedance status polling failed')
        continue
      }
      consecutivePollFailures = 0
      result = next
    }

    throw new Error('Seedance job exceeded the ten-minute local deadline')
  }

  private generatedStoryClip(storyboard: StoryboardResult, video: VideoJobResult, index: number): LocalClip {
    const poster = storyboard.anchors?.[index]?.imageDataUrl
    if (!video.jobId || !video.videoUrl || !poster) throw new Error('Generated story clip is missing required media')
    return {
      id: `clip:${video.jobId}`,
      src: video.videoUrl,
      poster,
      label: `story ${String.fromCharCode(65 + index)}→${String.fromCharCode(66 + index)} · Seedance`,
      kind: 'shot',
      durationSeconds: video.durationSeconds ?? 4,
      storyIndex: index,
    }
  }

  // ── The full story pipeline ───────────────────────────────────────────────

  private async directShot(): Promise<void> {
    if (this.busy) return
    // Review-before-spend is structural: an assembled pack may only spend on
    // the exact call its dry_run displayed (the ⌘↵ path re-checks the gate the
    // button enforces visually).
    const usingPack = this.pack.length > 0
    if (usingPack && (this.review === null || this.review.error !== undefined)) return
    const packSnapshot = usingPack
      ? this.pack.map((entry) => ({ role: entry.role, id: entry.id }))
      : null
    this.busy = true
    this.director.busy = true
    this.resetStages()

    const request: ShotRequest = {
      id: `take-${String(this.take).padStart(2, '0')}`,
      characterId: this.character.id,
      propId: this.selectedProp.id,
      sceneId: this.selectedScene.id,
      direction: this.direction.trim(),
      requestedAt: Date.now(),
    }
    this.pipeline.title = packSnapshot
      ? `${request.id}: a reviewed pack of ${packSnapshot.length} from the reference web`
      : `${request.id}: ${this.selectedProp.name.toLowerCase()} in ${this.selectedScene.name.toLowerCase()}`

    try {
      const providerResponse = await fetch('/api/video-provider')
      const provider = (await providerResponse.json()) as { configured?: boolean; error?: string }
      if (!providerResponse.ok || !provider.configured) {
        throw new Error(provider.error ?? 'Seedance provider is not configured')
      }

      await this.runStage('references', 180)
      this.setStage('still', 'active')
      this.pipeline.title = `${request.id}: gpt-image-2 is composing four camera anchors…`
      this.broadcast.bufferCopy = 'idle carries the feed while the full visual arc is composed'

      const response = await fetch('/api/generate-storyboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          packSnapshot
            ? { pack: packSnapshot, direction: request.direction }
            : { propId: request.propId, sceneId: request.sceneId, direction: request.direction },
        ),
      })
      const storyboard = (await response.json()) as StoryboardResult
      if (!response.ok || storyboard.anchors?.length !== 4) {
        throw new Error(storyboard.error ?? 'Storyboard generation failed')
      }

      this.setStage('still', 'done', (storyboard.latencyMs ?? 0) / 1000)
      await this.presentStoryboard(storyboard)
      this.pipeline.lineage = `${this.lineageBase()} · story:${storyboard.storyId ?? 'unknown'} · input:${storyboard.inputHash ?? 'unknown'}`

      this.setStage('motion', 'active')
      this.pipeline.title = `${request.id}: three Seedance bridges are racing in parallel…`
      const bridgePropId = packSnapshot
        ? packSnapshot.find((entry) => entry.role === 'prop')?.id ?? request.propId
        : request.propId
      const bridgeDirections = familyFor(bridgePropId).bridges
      const motionStartedAt = performance.now()
      const submittedVideos = await Promise.all(
        bridgeDirections.map((bridge, index) => this.submitVideoJob(bridge, index, index + 1)),
      )

      // Progressive playout: a bridge enters the feed the moment it and every
      // earlier bridge have arrived, instead of holding the whole story for the
      // slowest job. Story order is claimed synchronously (before any await) so
      // concurrent completions can never enqueue out of order or twice.
      const storyClips: LocalClip[] = []
      const arrivals: (VideoJobResult | undefined)[] = new Array(bridgeDirections.length)
      let nextToEnqueue = 0
      const timing: { firstMotionSeconds: number | null } = { firstMotionSeconds: null }
      const videos = await Promise.all(
        submittedVideos.map(async (submitted, index) => {
          const completed = await this.waitForVideo(submitted)
          arrivals[index] = completed
          while (nextToEnqueue < arrivals.length && arrivals[nextToEnqueue]) {
            const bridgeIndex = nextToEnqueue
            nextToEnqueue += 1
            const clip = this.generatedStoryClip(storyboard, arrivals[bridgeIndex]!, bridgeIndex)
            storyClips.push(clip)
            if (timing.firstMotionSeconds === null) {
              timing.firstMotionSeconds = (performance.now() - motionStartedAt) / 1000
              this.setStage('decode', 'active')
              this.pipeline.title = `${request.id}: the first bridge is entering the feed while the others render…`
            }
            await this.playout.queueSequence([clip])
          }
          return completed
        }),
      )
      this.setStage('motion', 'done', (performance.now() - motionStartedAt) / 1000)
      this.setStage('decode', 'done', timing.firstMotionSeconds ?? undefined)
      this.latestStoryClips = storyClips
      this.broadcast.replayVisible = true
      const totalCost = videos.reduce((sum, video) => sum + (video.cost ?? 0), 0)
      const completeStorySeconds = (performance.now() - motionStartedAt) / 1000
      this.pipeline.title = `${request.id}: story in the feed · first motion ${timing.firstMotionSeconds?.toFixed(1) ?? '—'}s · complete ${completeStorySeconds.toFixed(1)}s · $${totalCost.toFixed(3)}.`
      this.pipeline.lineage += ` · bridges:${videos.map((video) => video.jobId ?? 'unknown').join(',')}`
      this.take += 1
      this.director.take = this.take
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.pipeline.title = `${request.id} failed: ${message}`
      this.broadcast.bufferCopy = 'idle coverage continues · inspect the server log'
      for (const stage of ['still', 'motion', 'decode'] as StageName[]) {
        if (this.stageStates[stage].state === 'active') this.setStage(stage, 'waiting')
      }
    } finally {
      this.busy = false
      this.director.busy = false
    }
  }

  // ── Boot restore (the free surfaces: cached storyboard / story / frame) ───

  private async boot(): Promise<void> {
    try {
      await this.playout.start()
      const [storyboardResponse, storyVideosResponse, latestResponse] = await Promise.all([
        fetch('/api/latest-storyboard'),
        fetch('/api/latest-story-videos'),
        fetch('/api/latest-frame'),
      ])
      if (storyboardResponse.ok) {
        const storyboard = (await storyboardResponse.json()) as StoryboardResult
        await this.presentStoryboard(storyboard)
        this.pipeline.title = 'Restored the latest four-anchor storyboard.'
        const restoredFrom = storyboard.pack ? this.packLineage(storyboard.pack) : this.character.id
        this.pipeline.lineage = `${restoredFrom} · story:${storyboard.storyId ?? 'unknown'} · cached input:${storyboard.inputHash ?? 'unknown'}`
        if (storyVideosResponse.ok) {
          const manifest = (await storyVideosResponse.json()) as { storyId?: string; clips?: VideoJobResult[] }
          if (manifest.storyId === storyboard.storyId && manifest.clips?.length === 3) {
            this.latestStoryClips = manifest.clips.map((video, index) =>
              this.generatedStoryClip(storyboard, video, index),
            )
            this.broadcast.replayVisible = true
            await this.playout.queueSequence(this.latestStoryClips)
            this.pipeline.title = 'Restored the latest twelve-second story into the playout queue.'
          }
        }
      } else if (latestResponse.ok) {
        const latest = (await latestResponse.json()) as GeneratedFrameResult
        await this.presentGeneratedFrame(latest)
        this.pipeline.title = 'Restored the latest generated artistic frame.'
        this.pipeline.lineage = `${this.character.id} · cached input:${latest.inputHash ?? 'unknown'}`
      } else {
        this.pipeline.title = 'Idle is carrying the feed.'
      }
    } catch (error) {
      this.broadcast.bufferCopy = error instanceof Error ? error.message : String(error)
    }
  }
}
