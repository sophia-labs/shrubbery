import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { CACTUS_BEATS, GARDEN_STORY_I_BEATS, MOON_BEATS } from './src/story-beats.ts'

const appDir = dirname(fileURLToPath(import.meta.url))
const referencesDir = resolve(appDir, 'private/references')
const runtimeDir = process.env.ATELIER_RUNTIME_DIR ? resolve(process.env.ATELIER_RUNTIME_DIR) : resolve(appDir, 'runtime')
const latestFramePath = resolve(runtimeDir, 'latest-frame.jpg')
const latestFrameMetadataPath = resolve(runtimeDir, 'latest-frame.json')
const storyboardDir = resolve(runtimeDir, 'storyboard')
const latestStoryboardPath = resolve(storyboardDir, 'latest-storyboard.jpg')
const latestStoryboardMetadataPath = resolve(storyboardDir, 'latest-storyboard.json')
const videosDir = resolve(runtimeDir, 'videos')
const latestVideoMetadataPath = resolve(runtimeDir, 'latest-video.json')
const latestStoryVideosPath = resolve(runtimeDir, 'latest-story-videos.json')
// The run ledger: one directory per real storyboard generation (dry_run never
// writes here). latest-* files stay exactly as they are — the ledger is the
// additive memory that stops them from being the only memory.
const runsDir = resolve(runtimeDir, 'runs')
const MAX_BODY_BYTES = 32 * 1024
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.replace(/\/$/, '') ?? 'https://api.openai.com/v1'
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '') ?? 'https://openrouter.ai/api/v1'
const VIDEO_MODEL = 'bytedance/seedance-2.0-fast'
const VIDEO_DURATION_SECONDS = 4
const VIDEO_RESOLUTION = '480p'
const STORYBOARD_ANCHORS = ['a', 'b', 'c', 'd'] as const

const propReferences: Record<string, string> = {
  'prop:star-cactus': 'star-cactus.png',
  'prop:moon-lantern': 'moon-lantern.png',
}

const sceneReferences: Record<string, string> = {
  'scene:glasshouse': 'glasshouse.png',
  'scene:night-window': 'night-window.png',
}

// ── The reference web (catalog-as-data) ──────────────────────────────────────
// The emitter's JSON projection of src/catalog/reference-web.nt — the fossil
// is the authority; the JSON is derived from it by `pnpm emit:web` and carries
// the precomputed views this server needs (role, pending, embeddedIn). Read
// fresh per request: storyboard requests are rare, and an emitter re-run is
// picked up without a dev-server restart.
const referenceWebPath = resolve(appDir, 'src/catalog/reference-web.json')
const MAX_PACK_ENTRIES = 7

interface WebEntityProjection {
  id: string
  kind: string
  role: string
  name: string
  description: string
  pending: boolean
  embeddedIn?: string
  providerReference?: string
  compositionNotes: string
  invariant: string
}

interface PackEntry {
  role: string
  id: string
  entity: WebEntityProjection
}

interface PackReference {
  role: string
  id: string
  filename: string
}

async function loadReferenceWeb(): Promise<Map<string, WebEntityProjection>> {
  const projection = JSON.parse(await readFile(referenceWebPath, 'utf8')) as {
    entities: WebEntityProjection[]
  }
  return new Map(projection.entities.map((entity) => [entity.id, entity]))
}

/** Validate a requested pack against the web. Every rejection here happens
 *  BEFORE any provider call — an invalid pack can never spend. */
function validatePack(raw: unknown, web: Map<string, WebEntityProjection>): PackEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('A pack must be a non-empty ordered array of {role, id} entries')
  }
  if (raw.length > MAX_PACK_ENTRIES) {
    throw new Error(
      `A pack holds at most ${MAX_PACK_ENTRIES} references; got ${raw.length} — trim it before composing`,
    )
  }
  const seen = new Set<string>()
  const entries = raw.map((candidate): PackEntry => {
    const role =
      typeof (candidate as { role?: unknown }).role === 'string' ? (candidate as { role: string }).role : ''
    const id = typeof (candidate as { id?: unknown }).id === 'string' ? (candidate as { id: string }).id : ''
    const entity = web.get(id)
    if (!entity) throw new Error(`Unknown entity '${id || '(missing id)'}' — not in the reference web`)
    if (role !== entity.role) {
      throw new Error(
        `Entity '${id}' is a ${entity.kind} and takes the role '${entity.role}', not '${role || '(missing role)'}'`,
      )
    }
    if (seen.has(id)) throw new Error(`Entity '${id}' appears twice in the pack`)
    seen.add(id)
    if (entity.pending) {
      throw new Error(
        `Entity '${id}' needs a reference study before it can spend — its provider reference is pending`,
      )
    }
    return { role, id, entity }
  })
  for (const entry of entries) {
    if (entry.entity.embeddedIn !== undefined && !seen.has(entry.entity.embeddedIn)) {
      throw new Error(
        `Entity '${entry.id}' rides embedded in '${entry.entity.embeddedIn}', which must also be in the pack`,
      )
    }
  }
  if (!entries.some((entry) => entry.entity.providerReference !== undefined)) {
    throw new Error('A pack must include at least one entity with a reference study')
  }
  return entries
}

let cachedOpenAiApiKey: string | null = null
let cachedOpenRouterApiKey: string | null = null

interface VideoJob {
  id: string
  remoteId: string
  status: string
  direction: string
  inputHash: string
  submittedAt: number
  submitLatencyMs: number
  generationLatencyMs?: number
  downloadLatencyMs?: number
  totalLatencyMs?: number
  cost?: number
  videoFilename?: string
  bridgeIndex?: number
  firstAnchor?: string
  lastAnchor?: string
  storyId?: string
}

const videoJobs = new Map<string, VideoJob>()
let storyManifestWrite = Promise.resolve()

function readOpenAiKey(): string {
  if (cachedOpenAiApiKey) return cachedOpenAiApiKey
  cachedOpenAiApiKey = execFileSync(
    '/usr/bin/security',
    ['find-generic-password', '-a', 'vera', '-s', 'OpenAI API Key', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
  if (!cachedOpenAiApiKey) throw new Error('The OpenAI API key in Keychain was empty')
  return cachedOpenAiApiKey
}

function readOpenRouterKey(): string {
  if (cachedOpenRouterApiKey) return cachedOpenRouterApiKey
  const environmentKey = process.env.OPENROUTER_API_KEY?.trim()
  if (environmentKey) {
    cachedOpenRouterApiKey = environmentKey
    return environmentKey
  }

  try {
    cachedOpenRouterApiKey = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-a', 'vera', '-s', 'OpenRouter API Key', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  } catch {
    throw new Error("OpenRouter key missing. Add it to Keychain as service 'OpenRouter API Key', account 'vera'.")
  }
  if (!cachedOpenRouterApiKey) throw new Error('The OpenRouter API key in Keychain was empty')
  return cachedOpenRouterApiKey
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function requireCatalogId(value: unknown, catalog: Record<string, string>, label: string): string {
  if (typeof value !== 'string' || !catalog[value]) throw new Error(`Unknown ${label}`)
  return value
}

function buildPrompt(direction: string, propId: string, sceneId: string): string {
  const prop = propId === 'prop:star-cactus'
    ? 'the exact small star cactus and coral pot shown in image 2'
    : 'the exact glowing moon lantern shown in image 2'
  const scene = sceneId === 'scene:glasshouse'
    ? 'the warm, unruly glasshouse atmosphere shown in image 3'
    : 'the rainy ink-blue night-window atmosphere shown in image 3'

  return [
    'Create one finished square animation keyframe, with no text, borders, labels, contact sheet, or UI.',
    'Image 1 is a private source plate rendered from the real VTuber model. Use it only to establish the performer: preserve the recognizable face, black bob haircut, clothing, proportions, and overall character identity. Do not preserve the source pose or plain renderer background.',
    `Image 2 establishes ${prop}. The performer must interact physically and convincingly with that exact prop.`,
    `Image 3 establishes ${scene}; reinterpret it freely as a cinematic setting rather than copying its reference-card typography.`,
    'Style: expressive, tactile editorial animation; strong silhouette; visible brush and paper texture; coherent hands; intimate camera; designed as the first frame of a short animated clip.',
    `Direction: ${direction}`,
  ].join('\n\n')
}

// Shared storyboard grammar — used verbatim by BOTH the legacy prompt (whose
// output must stay byte-identical) and the pack compiler.
const STORYBOARD_GOAL_FORMAT =
  'Create one 1024×1024 production storyboard sheet containing four equal square animation anchors in an exact 2×2 grid: A top-left, B top-right, C bottom-left, D bottom-right. Each quadrant must be a complete standalone square frame extending exactly to its quadrant edges. Invisible seams only: no gutters, borders, captions, letters, numbers, labels, contact-sheet furniture, or UI.'
const STORYBOARD_CAMERA_PARAGRAPHS = [
  'Eye-level camera with a natural normal-lens feeling. Across A→B→C→D, make one almost imperceptible continuous dolly forward combined with a slow lateral drift left. Never reverse direction, jump the axis, cut, zoom, orbit, or change lenses. The movement should feel patient and motivated by attention rather than spectacle.',
  'Use the rule of thirds deliberately in every quadrant. Keep the performer primarily on the right vertical third, her eyes near the upper-right intersection, and reserve the left two-thirds as breathing room for the prop and its transformation. Preserve screen direction and the 180-degree axis.',
  'Build three depth planes in every quadrant: soft wet leaves or glass reflections crossing the extreme foreground; performer and prop in the midground; greenhouse or window structure receding in the background. Let wind, condensation, reflected light, and leaves imply time passing around a mostly still person.',
]
const STORYBOARD_FOUR_CHECKPOINTS =
  'These are four checkpoints from one unbroken twelve-second shot, not four separate illustrations.'
const STORYBOARD_ENDPOINT_SENTENCE =
  'The performer remains screen-right and the object travels through the same left-side negative space. Each pose should be calm and settled enough to serve as the exact endpoint of one generated video and the exact first frame of the next.'
const STORYBOARD_NO_TEXT =
  'No text, logos, watermark, duplicated performer, split-screen effects inside a quadrant, montage overlays, extra hands, extra props, costume changes, sudden camera changes, or photorealism.'
// The beat families live in src/story-beats.ts — shared verbatim with the
// backfill script so recorded beats can never drift from compiled prompts.

function buildStoryboardPrompt(direction: string, propId: string, sceneId: string): string {
  const prop = propId === 'prop:star-cactus'
    ? 'the exact small blue-green star cactus and hand-painted coral pot shown in Image 2'
    : 'the exact cloudy glass moon lantern with a captive crescent shown in Image 2'
  const scene = sceneId === 'scene:glasshouse'
    ? 'the warm, overgrown glasshouse atmosphere, amber panes, wet leaves, and deep natural layers shown in Image 3'
    : 'the rainy ink-blue studio-window atmosphere, reflective glass, and distant warm lights shown in Image 3'
  const beats = propId === 'prop:star-cactus' ? CACTUS_BEATS : MOON_BEATS

  return [
    'GOAL / FORMAT',
    STORYBOARD_GOAL_FORMAT,
    '',
    'REFERENCE ROLES',
    'Image 1 is a private source plate rendered from the real VTuber. Use it only to establish the same performer in every quadrant: preserve her recognizable face, black bob haircut, dark hoodie, body proportions, and identity. Replace the renderer pose and background.',
    `Image 2 establishes ${prop}. Preserve its shape, colors, and physical identity across all four quadrants.`,
    `Image 3 establishes ${scene}. Reinterpret it as one continuous physical setting, not as four different locations and not as a graphic reference card.`,
    '',
    'VISUAL MEDIUM',
    `Expressive tactile editorial animation: visible brush and paper texture, restrained warm palette, coherent anatomy and hands, natural material detail, cinematic depth. ${STORYBOARD_FOUR_CHECKPOINTS}`,
    '',
    'CAMERA PATH AND STRUCTURAL COMPOSITION',
    ...STORYBOARD_CAMERA_PARAGRAPHS,
    '',
    'NARRATIVE BEATS',
    ...beats,
    '',
    'CONTINUITY INVARIANTS',
    `The same face, haircut, hoodie, hands, prop, room, time of day, camera axis, color script, and illustration technique in all quadrants. ${STORYBOARD_ENDPOINT_SENTENCE}`,
    STORYBOARD_NO_TEXT,
    '',
    'DIRECTOR INTENT',
    direction,
  ].join('\n')
}

// ── Pack compilation: the labeled sections assemble FROM the web ─────────────
// Role priority is prompt language, not metadata: identity gets "preserve
// exactly"; atmosphere gets "inform, never override". Each entity contributes
// its composition notes and invariant fragment; embedded riders (the hoodie)
// fold their line into their host's section instead of taking an image slot.

function capitalizeSentence(fragment: string): string {
  return fragment.charAt(0).toUpperCase() + fragment.slice(1)
}

function packRoleSection(entry: PackEntry, imageIndex: number, riders: PackEntry[]): string {
  const { entity } = entry
  const riderSentences = riders
    .map(
      (rider) =>
        ` Also embedded in this plate: ${rider.entity.name.toLowerCase()} — preserve ${rider.entity.invariant}. ${rider.entity.compositionNotes}`,
    )
    .join('')
  const label = `Image ${imageIndex}`
  switch (entry.role) {
    case 'identity':
      return `${label} is a private source plate rendered from the real VTuber (${entity.name}). Use it only to establish the same performer in every quadrant: preserve exactly ${entity.invariant}. Replace the renderer pose and background. ${entity.compositionNotes}${riderSentences}`
    case 'wardrobe':
      return `${label} establishes her wardrobe, ${entity.name.toLowerCase()}: ${entity.description}. Preserve ${entity.invariant} in every quadrant. ${entity.compositionNotes}${riderSentences}`
    case 'prop':
      return `${label} establishes ${entity.name.toLowerCase()}: ${entity.description}. Preserve ${entity.invariant} across all four quadrants. ${entity.compositionNotes}${riderSentences}`
    case 'scene':
      return `${label} establishes ${entity.name.toLowerCase()}: ${entity.description}. Reinterpret it as one continuous physical setting, not as four different locations and not as a graphic reference card. Preserve ${entity.invariant}. ${entity.compositionNotes}${riderSentences}`
    case 'atmosphere':
      return `${label} is an atmosphere study, ${entity.name.toLowerCase()}: ${entity.description}. Let it inform palette, weather, and light only — it must never override the performer or the objects. ${entity.compositionNotes}${riderSentences}`
    case 'technique':
      return `${label} is a technique study, ${entity.name.toLowerCase()}: ${entity.description}. Let it govern the illustration medium in every quadrant: preserve ${entity.invariant}. ${entity.compositionNotes}${riderSentences}`
    case 'anchor':
      return `${label} is an accepted anchor from an earlier story. Continue its world exactly: preserve ${entity.invariant}. ${entity.compositionNotes}${riderSentences}`
    default:
      throw new Error(`Entity '${entry.id}' has unknown role '${entry.role}'`)
  }
}

/** Beat families remain per-story authorship, keyed on the primary prop. */
function packBeats(entries: PackEntry[]): string[] {
  const primary = entries.find((entry) => entry.role === 'prop')
  if (primary?.id === 'prop:star-cactus') return CACTUS_BEATS
  if (primary?.id === 'prop:moon-lantern') return MOON_BEATS
  if (primary?.id === 'prop:paper-drum-lantern') return GARDEN_STORY_I_BEATS
  const focus = primary ? primary.entity.name.toLowerCase() : 'the scene'
  return [
    `A — QUIET BEFORE: she sits on the right third and studies ${focus} resting at the lower-left thirds intersection; everything is still; her hands are still.`,
    `B — RECOGNITION: from the same continuous setup, ${focus} begins its one quiet change; she has just noticed it; wonder replaces stillness.`,
    'C — RELEASE: the change has moved gently into the negative space near the upper-left thirds intersection; she reaches toward it from screen-right and follows it with her gaze.',
    'D — RECEIVING: the slow camera move has arrived at an intimate medium close-up; she receives the change with both hands near the lower-center intersection and looks toward the viewer with quiet delight.',
  ]
}

function buildPackPrompt(
  direction: string,
  entries: PackEntry[],
  web: Map<string, WebEntityProjection>,
): string {
  const imaged = entries.filter((entry) => entry.entity.providerReference !== undefined)
  const sections = imaged.map((entry, index) =>
    packRoleSection(
      entry,
      index + 1,
      entries.filter((rider) => rider.entity.embeddedIn === entry.id),
    ),
  )
  // The technique entity's invariant does the work the hardcoded VISUAL MEDIUM
  // phrase does for the legacy path — web-resident language, even while its
  // own reference study is pending.
  const technique = [...web.values()].find((entity) => entity.kind === 'technique')
  const medium = technique
    ? `${capitalizeSentence(technique.invariant)}. ${technique.compositionNotes} ${STORYBOARD_FOUR_CHECKPOINTS}`
    : `Expressive tactile editorial animation: visible brush and paper texture, restrained warm palette, coherent anatomy and hands, natural material detail, cinematic depth. ${STORYBOARD_FOUR_CHECKPOINTS}`

  return [
    'GOAL / FORMAT',
    STORYBOARD_GOAL_FORMAT,
    '',
    'REFERENCE ROLES',
    ...sections,
    '',
    'VISUAL MEDIUM',
    medium,
    '',
    'CAMERA PATH AND STRUCTURAL COMPOSITION',
    ...STORYBOARD_CAMERA_PARAGRAPHS,
    '',
    'NARRATIVE BEATS',
    ...packBeats(entries),
    '',
    'CONTINUITY INVARIANTS',
    `Hold exactly, in all four quadrants: ${entries.map((entry) => entry.entity.invariant).join('; ')}; the same room, time of day, camera axis, color script, and illustration technique. ${STORYBOARD_ENDPOINT_SENTENCE}`,
    STORYBOARD_NO_TEXT,
    '',
    'DIRECTOR INTENT',
    direction,
  ].join('\n')
}

function buildMotionPrompt(direction: string): string {
  return [
    'Create one uninterrupted four-second passage between the supplied exact first and last storyboard frames.',
    'Begin on the first frame and land cleanly on the last frame. Preserve character identity, costume, prop, setting, screen direction, camera axis, palette, and tactile illustration style throughout.',
    `Bridge action: ${direction}`,
    'Camera: continue one extremely slow dolly forward with a subtle lateral drift left, constant direction and speed, as if time itself is revealing the scene. No handheld shake, orbit, sudden push, zoom, rack focus, cut, or reframing jump.',
    'Performance: one readable change, quiet face and eyes, subtle breathing; ease gently out of the first pose and settle gently into the last. Let foreground leaves, condensation, reflected light, hair, and cloth carry secondary motion.',
    'No transitions, text, logos, dialogue, lip-sync, new characters, duplicated limbs, identity drift, costume changes, or transformation into a different person.',
  ].join('\n\n')
}

function storyboardAnchorPath(index: number): string {
  return resolve(storyboardDir, `anchor-${STORYBOARD_ANCHORS[index]}.jpg`)
}

async function readStoryboardResult(): Promise<Record<string, unknown>> {
  const metadata = JSON.parse(await readFile(latestStoryboardMetadataPath, 'utf8')) as Record<string, unknown>
  const anchors = await Promise.all(STORYBOARD_ANCHORS.map(async (id, index) => ({
    id: `anchor-${id}`,
    imageDataUrl: `data:image/jpeg;base64,${(await readFile(storyboardAnchorPath(index))).toString('base64')}`,
  })))
  return { ...metadata, anchors }
}

function cropStoryboardAnchors(): void {
  const offsets = [[0, 0], [512, 0], [0, 512], [512, 512]]
  offsets.forEach(([x, y], index) => {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', latestStoryboardPath,
      // Give the image model a little tolerance for a faint contact-sheet seam.
      // A 6 px inset is only 1.2% of a quadrant and keeps every animation
      // endpoint free of borders before scaling it back to the target size.
      '-vf', `crop=500:500:${x + 6}:${y + 6},scale=512:512:flags=lanczos`,
      '-frames:v', '1',
      '-q:v', '2',
      storyboardAnchorPath(index),
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
  })
}

function publicVideoJob(job: VideoJob): Record<string, unknown> {
  return {
    jobId: job.id,
    remoteId: job.remoteId,
    status: job.status,
    model: VIDEO_MODEL,
    durationSeconds: VIDEO_DURATION_SECONDS,
    resolution: VIDEO_RESOLUTION,
    inputHash: job.inputHash,
    submittedAt: job.submittedAt,
    submitLatencyMs: job.submitLatencyMs,
    generationLatencyMs: job.generationLatencyMs,
    downloadLatencyMs: job.downloadLatencyMs,
    totalLatencyMs: job.totalLatencyMs,
    cost: job.cost,
    bridgeIndex: job.bridgeIndex,
    firstAnchor: job.firstAnchor,
    lastAnchor: job.lastAnchor,
    storyId: job.storyId,
    videoUrl: job.videoFilename ? `/api/video-content/${job.id}` : undefined,
  }
}

async function writeStoryVideoManifest(storyId: string): Promise<void> {
  storyManifestWrite = storyManifestWrite.then(async () => {
    const clips = [...videoJobs.values()]
      .filter((candidate) => candidate.storyId === storyId && candidate.videoFilename)
      .sort((left, right) => (left.bridgeIndex ?? 0) - (right.bridgeIndex ?? 0))
      .map(publicVideoJob)
    await writeFile(latestStoryVideosPath, `${JSON.stringify({ storyId, clips }, null, 2)}\n`)
  })
  await storyManifestWrite
}

async function materializeVideo(job: VideoJob, apiKey: string): Promise<void> {
  if (job.videoFilename) return
  const downloadStartedAt = performance.now()
  const response = await fetch(`${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(job.remoteId)}/content`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: video download failed`)
  const video = Buffer.from(await response.arrayBuffer())
  if (!video.length) throw new Error('OpenRouter returned an empty video')

  job.videoFilename = `${job.id}.mp4`
  job.downloadLatencyMs = Math.round(performance.now() - downloadStartedAt)
  job.totalLatencyMs = Date.now() - job.submittedAt
  await mkdir(videosDir, { recursive: true })
  await Promise.all([
    writeFile(resolve(videosDir, job.videoFilename), video),
    writeFile(latestVideoMetadataPath, `${JSON.stringify(publicVideoJob(job), null, 2)}\n`),
  ])
  if (job.storyId) await writeStoryVideoManifest(job.storyId)
  console.log(`[atelier-video] cached local=${job.id} bytes=${video.length} download=${job.downloadLatencyMs}ms total=${job.totalLatencyMs}ms`)
}

// ── The run ledger ───────────────────────────────────────────────────────────
// Every REAL storyboard generation persists runtime/runs/<storyId>/:
//   request.json  — the composed call: mode, pack/legacy ids, direction, the
//                   beats used, the ordered reference list, inputHash, and the
//                   FULL prompt (what dry_run shows, made durable).
//   sheet.jpg + anchor-a..d.jpg — copies of the artifacts at generation time,
//                   so the next run's latest-* overwrite can never lose them.
//   meta.json     — provenance: model, provider request id, latency, settings.
//   bridges/<jobId>.json — appended when a Seedance job reaches a terminal
//                   state, resolved to its owning run by storyId.
// Ledger writes are fail-soft ON PURPOSE: a bookkeeping error must never cost
// the paid artifact it records — it logs loudly instead.

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

const RUN_ID_PATTERN = /^[a-z0-9-]+$/

interface RunPersistArgs {
  storyId: string
  mode: 'legacy' | 'pack'
  pack?: Array<{ role: string; id: string }>
  propId?: string
  sceneId?: string
  direction: string
  beats: readonly string[]
  references: PackReference[]
  inputHash: string
  prompt: string
  latencyMs: number
  requestId: string | null
}

async function persistRunRecord(args: RunPersistArgs): Promise<void> {
  const runDir = resolve(runsDir, args.storyId)
  await mkdir(resolve(runDir, 'bridges'), { recursive: true })
  const createdAt = Date.now()
  const request = {
    mode: args.mode,
    ...(args.pack ? { pack: args.pack } : { propId: args.propId, sceneId: args.sceneId }),
    direction: args.direction,
    beats: args.beats,
    references: args.references,
    inputHash: args.inputHash,
    prompt: args.prompt,
  }
  const meta = {
    runId: args.storyId,
    storyId: args.storyId,
    mode: args.mode,
    model: 'gpt-image-2',
    providerRequestId: args.requestId,
    latencyMs: args.latencyMs,
    createdAt,
    createdAtIso: new Date(createdAt).toISOString(),
    imageSettings: { quality: 'low', size: '1024x1024', outputFormat: 'jpeg', outputCompression: 88 },
    refCount: args.references.length,
    partial: false,
  }
  await Promise.all([
    writeFile(resolve(runDir, 'request.json'), `${JSON.stringify(request, null, 2)}\n`),
    writeFile(resolve(runDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`),
    copyFile(latestStoryboardPath, resolve(runDir, 'sheet.jpg')),
    ...STORYBOARD_ANCHORS.map((id, index) =>
      copyFile(storyboardAnchorPath(index), resolve(runDir, `anchor-${id}.jpg`)),
    ),
  ])
  console.log(`[atelier-runs] recorded run=${args.storyId} mode=${args.mode} refs=${args.references.length}`)
}

/** Append a terminal-state Seedance job to its owning run (by storyId). */
async function appendBridgeRecord(job: VideoJob): Promise<void> {
  if (!job.storyId || !RUN_ID_PATTERN.test(job.storyId)) return
  const bridgesDir = resolve(runsDir, job.storyId, 'bridges')
  if (!(await pathExists(bridgesDir))) return
  await writeFile(
    resolve(bridgesDir, `${job.id}.json`),
    `${JSON.stringify({ ...publicVideoJob(job), direction: job.direction }, null, 2)}\n`,
  )
  console.log(`[atelier-runs] bridge run=${job.storyId} job=${job.id} status=${job.status}`)
}

interface StoredBridge extends Record<string, unknown> {
  bridgeIndex?: number
  cost?: number
}

async function readRunBridges(runDir: string): Promise<StoredBridge[]> {
  const bridgesDir = resolve(runDir, 'bridges')
  if (!(await pathExists(bridgesDir))) return []
  const names = (await readdir(bridgesDir)).filter((name) => name.endsWith('.json'))
  const bridges = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(resolve(bridgesDir, name), 'utf8')) as StoredBridge),
  )
  return bridges.sort((left, right) => (left.bridgeIndex ?? 0) - (right.bridgeIndex ?? 0))
}

async function readRunSummary(runId: string): Promise<Record<string, unknown> | null> {
  const runDir = resolve(runsDir, runId)
  try {
    const [meta, request, bridges, hasSheet] = await Promise.all([
      readFile(resolve(runDir, 'meta.json'), 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>),
      readFile(resolve(runDir, 'request.json'), 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>),
      readRunBridges(runDir),
      pathExists(resolve(runDir, 'sheet.jpg')),
    ])
    const costs = bridges.map((bridge) => bridge.cost).filter((cost): cost is number => typeof cost === 'number')
    return {
      ...meta,
      direction: request.direction ?? null,
      inputHash: request.inputHash ?? null,
      pack: request.pack ?? null,
      references: request.references ?? null,
      bridgeCount: bridges.length,
      totalCost: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
      hasSheet,
    }
  } catch {
    return null
  }
}

async function readRunSummaries(): Promise<Array<Record<string, unknown>>> {
  if (!(await pathExists(runsDir))) return []
  const entries = (await readdir(runsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
  const summaries = (await Promise.all(entries.map(readRunSummary))).filter(
    (summary): summary is Record<string, unknown> => summary !== null,
  )
  return summaries.sort((left, right) => ((right.createdAt as number) ?? 0) - ((left.createdAt as number) ?? 0))
}

/** The full record: meta + request (incl. prompt) + bridges + qa + the web
 *  entities the pack named (so the inspector can show each reference's own
 *  language — and the identity plate's hash instead of its pixels). */
async function readRunDetail(runId: string): Promise<Record<string, unknown> | null> {
  const runDir = resolve(runsDir, runId)
  if (!(await pathExists(resolve(runDir, 'meta.json')))) return null
  const [meta, request, bridges, hasSheet] = await Promise.all([
    readFile(resolve(runDir, 'meta.json'), 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>),
    readFile(resolve(runDir, 'request.json'), 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>),
    readRunBridges(runDir),
    pathExists(resolve(runDir, 'sheet.jpg')),
  ])
  const qaPath = resolve(runDir, 'qa.json')
  const qa = (await pathExists(qaPath))
    ? (JSON.parse(await readFile(qaPath, 'utf8')) as Record<string, unknown>)
    : null
  const assembledName = `${runId}-assembled`
  const assembledUrl = (await pathExists(resolve(videosDir, `${assembledName}.mp4`)))
    ? `/api/video-content/${assembledName}`
    : null

  const entities: Record<string, Record<string, unknown>> = {}
  try {
    const web = await loadReferenceWeb()
    const packIds = [
      ...((request.pack as Array<{ id?: string }> | undefined) ?? []),
      ...((request.references as Array<{ id?: string }> | undefined) ?? []),
    ]
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string')
    for (const id of new Set(packIds)) {
      const entity = web.get(id)
      if (!entity) continue
      entities[id] = {
        id: entity.id,
        kind: entity.kind,
        role: entity.role,
        name: entity.name,
        description: entity.description,
        pending: entity.pending,
        ...(entity.embeddedIn !== undefined ? { embeddedIn: entity.embeddedIn } : {}),
        compositionNotes: entity.compositionNotes,
        invariant: entity.invariant,
        studyLocked: entity.kind === 'character',
        ...(entity.kind === 'character' && entity.providerReference !== undefined
          ? { studySha256: await sha256OfReference(entity.providerReference) }
          : {}),
      }
    }
  } catch (error) {
    console.error(`[atelier-runs] entity enrichment failed for ${runId}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const costs = bridges.map((bridge) => bridge.cost).filter((cost): cost is number => typeof cost === 'number')
  return {
    ...meta,
    direction: (request.direction as string | undefined) ?? null,
    inputHash: (request.inputHash as string | undefined) ?? null,
    hasSheet,
    bridgeCount: bridges.length,
    totalCost: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    assembledUrl,
    request,
    bridges,
    ...(qa ? { qa } : {}),
    entities,
  }
}

async function sha256OfReference(filename: string): Promise<string> {
  return createHash('sha256').update(await readFile(resolve(referencesDir, filename))).digest('hex')
}

function serveJpeg(res: ServerResponse, bytes: Buffer): void {
  res.statusCode = 200
  res.setHeader('content-type', 'image/jpeg')
  res.setHeader('cache-control', 'no-store')
  res.end(bytes)
}

async function serveVideo(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const match = path.match(/^\/([a-z0-9-]+)$/)
  if (!match) {
    sendJson(res, 404, { error: 'Video not found' })
    return
  }

  const video = await readFile(resolve(videosDir, `${match[1]}.mp4`))
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  res.setHeader('content-type', 'video/mp4')
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'no-store')
  if (!range) {
    res.statusCode = 200
    res.setHeader('content-length', video.length)
    res.end(video)
    return
  }

  const start = range[1] ? Number(range[1]) : 0
  const end = range[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= video.length) {
    res.statusCode = 416
    res.setHeader('content-range', `bytes */${video.length}`)
    res.end()
    return
  }
  const chunk = video.subarray(start, end + 1)
  res.statusCode = 206
  res.setHeader('content-range', `bytes ${start}-${end}/${video.length}`)
  res.setHeader('content-length', chunk.length)
  res.end(chunk)
}

function localImageApi(): Plugin {
  return {
    name: 'atelier-local-image-api',
    configureServer(server) {
      // Vite dev mode normally serves arbitrary files beneath its root. Deny
      // this directory explicitly: only the server-side compositor may read it.
      server.middlewares.use('/private/', (_req, res) => {
        res.statusCode = 404
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('Not found')
      })

      server.middlewares.use('/api/latest-storyboard', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        try {
          sendJson(res, 200, await readStoryboardResult())
        } catch {
          sendJson(res, 404, { error: 'No generated storyboard yet' })
        }
      })

      server.middlewares.use('/api/latest-frame', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        try {
          const [image, metadata] = await Promise.all([
            readFile(latestFramePath),
            readFile(latestFrameMetadataPath, 'utf8').then((value) => JSON.parse(value) as Record<string, unknown>),
          ])
          sendJson(res, 200, { ...metadata, imageDataUrl: `data:image/jpeg;base64,${image.toString('base64')}` })
        } catch {
          sendJson(res, 404, { error: 'No generated frame yet' })
        }
      })

      server.middlewares.use('/api/latest-video', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        try {
          const metadata = JSON.parse(await readFile(latestVideoMetadataPath, 'utf8')) as Record<string, unknown>
          sendJson(res, 200, metadata)
        } catch {
          sendJson(res, 404, { error: 'No generated video yet' })
        }
      })

      server.middlewares.use('/api/latest-story-videos', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        try {
          sendJson(res, 200, JSON.parse(await readFile(latestStoryVideosPath, 'utf8')))
        } catch {
          sendJson(res, 404, { error: 'No completed story video set yet' })
        }
      })

      // ── The run library ────────────────────────────────────────────────────
      // GET /api/runs                    newest-first summaries
      // GET /api/runs/:id                the full record, prompt included
      // GET /api/runs/:id/sheet.jpg      byte-served artifacts
      // GET /api/runs/:id/anchor-x.jpg   (x in a..d)
      server.middlewares.use('/api/runs', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        const path = req.url ?? '/'
        try {
          if (path === '/' || path === '') {
            sendJson(res, 200, await readRunSummaries())
            return
          }
          const artifact = path.match(/^\/([a-z0-9-]+)\/(sheet|anchor-[a-d])\.jpg$/)
          if (artifact) {
            serveJpeg(res, await readFile(resolve(runsDir, artifact[1], `${artifact[2]}.jpg`)))
            return
          }
          const detail = path.match(/^\/([a-z0-9-]+)$/)
          if (detail) {
            const record = await readRunDetail(detail[1])
            if (record) sendJson(res, 200, record)
            else sendJson(res, 404, { error: 'Run not found' })
            return
          }
          sendJson(res, 404, { error: 'Run not found' })
        } catch {
          sendJson(res, 404, { error: 'Run artifact not found' })
        }
      })

      // ── Entity studies ─────────────────────────────────────────────────────
      // Serves a web entity's provider reference study BY ENTITY ID — the
      // filename resolves server-side from the reference web, never from a
      // path. Character entities are the hard exception: the identity source
      // plate is browser-private (doc 02: identity source ≠ public feed) and
      // returns 403 with its hash instead of its pixels. The blanket /private/
      // denial above stays in force for everything path-shaped.
      server.middlewares.use('/api/entity-study', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        let decodedPath: string
        try {
          decodedPath = decodeURIComponent(req.url ?? '')
        } catch {
          sendJson(res, 404, { error: 'Unknown entity' })
          return
        }
        // The pattern rejects every decoded slash and dot — an id is never a path.
        const match = decodedPath.match(/^\/([a-z0-9:-]+)$/)
        if (!match) {
          sendJson(res, 404, { error: 'Unknown entity' })
          return
        }
        try {
          const web = await loadReferenceWeb()
          const entity = web.get(match[1])
          if (!entity) {
            sendJson(res, 404, { error: `Unknown entity '${match[1]}' — not in the reference web` })
            return
          }
          if (entity.kind === 'character') {
            sendJson(res, 403, {
              error: 'The identity source plate is browser-private.',
              doctrine:
                'Identity source ≠ public feed. This plate is rendered deterministically from the real VRM and exists only to establish the performer inside provider calls, server-side. It never crosses to a browser — not in the feed, not in the library, not here. Served in its place: the plate’s SHA-256, for provenance.',
              id: entity.id,
              kind: entity.kind,
              sha256:
                entity.providerReference !== undefined ? await sha256OfReference(entity.providerReference) : null,
            })
            return
          }
          if (entity.providerReference === undefined) {
            sendJson(res, 404, {
              error:
                entity.embeddedIn !== undefined
                  ? `Entity '${entity.id}' has no study of its own — its pixels ride embedded in '${entity.embeddedIn}'`
                  : `Entity '${entity.id}' has no reference study yet — it is pending`,
            })
            return
          }
          const bytes = await readFile(resolve(referencesDir, entity.providerReference))
          res.statusCode = 200
          res.setHeader('content-type', 'image/png')
          res.setHeader('cache-control', 'no-store')
          res.end(bytes)
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      })

      server.middlewares.use('/api/video-provider', (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        try {
          readOpenRouterKey()
          sendJson(res, 200, {
            configured: true,
            model: VIDEO_MODEL,
            durationSeconds: VIDEO_DURATION_SECONDS,
            resolution: VIDEO_RESOLUTION,
          })
        } catch (error) {
          sendJson(res, 503, {
            configured: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

      server.middlewares.use('/api/video-content', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET required' })
          return
        }
        try {
          await serveVideo(req, res, req.url ?? '/')
        } catch {
          sendJson(res, 404, { error: 'Video not found' })
        }
      })

      server.middlewares.use('/api/video-jobs', async (req, res) => {
        const path = req.url ?? '/'
        if (req.method === 'POST' && (path === '/' || path === '')) {
          const requestStartedAt = performance.now()
          const submittedAt = Date.now()
          try {
            const body = await readJsonBody(req)
            const direction = typeof body.direction === 'string' ? body.direction.trim() : ''
            if (!direction || direction.length > 2_000) throw new Error('Direction must be between 1 and 2,000 characters')
            const firstAnchorIndex = typeof body.firstAnchorIndex === 'number' ? body.firstAnchorIndex : undefined
            const lastAnchorIndex = typeof body.lastAnchorIndex === 'number' ? body.lastAnchorIndex : undefined
            const isStoryboardBridge = firstAnchorIndex !== undefined || lastAnchorIndex !== undefined
            if (isStoryboardBridge && (
              !Number.isInteger(firstAnchorIndex)
              || !Number.isInteger(lastAnchorIndex)
              || firstAnchorIndex! < 0
              || lastAnchorIndex! >= STORYBOARD_ANCHORS.length
              || lastAnchorIndex !== firstAnchorIndex! + 1
            )) throw new Error('Storyboard video jobs require adjacent anchor indexes between 0 and 3')

            const [firstFrame, lastFrame, frameMetadata] = isStoryboardBridge
              ? await Promise.all([
                  readFile(storyboardAnchorPath(firstAnchorIndex!)),
                  readFile(storyboardAnchorPath(lastAnchorIndex!)),
                  readFile(latestStoryboardMetadataPath, 'utf8').then((value) => JSON.parse(value) as { inputHash?: string; storyId?: string }),
                ])
              : await Promise.all([
                  readFile(latestFramePath),
                  Promise.resolve(null),
                  readFile(latestFrameMetadataPath, 'utf8').then((value) => JSON.parse(value) as { inputHash?: string }),
                ])
            const apiKey = readOpenRouterKey()
            const bridgeLabel = isStoryboardBridge ? `${STORYBOARD_ANCHORS[firstAnchorIndex!]}->${STORYBOARD_ANCHORS[lastAnchorIndex!]}` : 'single'
            console.log(`[atelier-video] submit model=${VIDEO_MODEL} bridge=${bridgeLabel} input=${frameMetadata.inputHash ?? 'unknown'} duration=${VIDEO_DURATION_SECONDS}s resolution=${VIDEO_RESOLUTION}`)
            const frameImages = [{
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${firstFrame.toString('base64')}` },
              frame_type: 'first_frame',
            }]
            if (lastFrame) frameImages.push({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${lastFrame.toString('base64')}` },
              frame_type: 'last_frame',
            })
            const response = await fetch(`${OPENROUTER_BASE_URL}/videos`, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
                'http-referer': 'http://localhost:5184',
                'x-title': 'Shrubbery Atelier Feed Lab',
              },
              body: JSON.stringify({
                model: VIDEO_MODEL,
                prompt: buildMotionPrompt(direction),
                frame_images: frameImages,
                duration: VIDEO_DURATION_SECONDS,
                resolution: VIDEO_RESOLUTION,
                aspect_ratio: isStoryboardBridge ? '1:1' : '16:9',
                generate_audio: false,
                seed: isStoryboardBridge ? 7300 + firstAnchorIndex! : 7300,
              }),
              signal: AbortSignal.timeout(45_000),
            })
            const result = await response.json() as {
              id?: string
              status?: string
              error?: string | { message?: string }
            }
            if (!response.ok || !result.id) {
              const message = typeof result.error === 'string' ? result.error : result.error?.message
              throw new Error(`OpenRouter ${response.status}: ${message ?? 'video submission failed'}`)
            }

            const id = `shot-${Date.now()}-${randomUUID().slice(0, 8)}`
            const job: VideoJob = {
              id,
              remoteId: result.id,
              status: result.status ?? 'pending',
              direction,
              inputHash: frameMetadata.inputHash ?? 'unknown',
              submittedAt,
              submitLatencyMs: Math.round(performance.now() - requestStartedAt),
              bridgeIndex: firstAnchorIndex,
              firstAnchor: firstAnchorIndex === undefined ? undefined : `anchor-${STORYBOARD_ANCHORS[firstAnchorIndex]}`,
              lastAnchor: lastAnchorIndex === undefined ? undefined : `anchor-${STORYBOARD_ANCHORS[lastAnchorIndex]}`,
              storyId: 'storyId' in frameMetadata ? frameMetadata.storyId : undefined,
            }
            videoJobs.set(id, job)
            console.log(`[atelier-video] accepted local=${id} remote=${job.remoteId} submit=${job.submitLatencyMs}ms status=${job.status}`)
            sendJson(res, 202, publicVideoJob(job))
          } catch (error) {
            const latencyMs = Math.round(performance.now() - requestStartedAt)
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[atelier-video] submit-failed latency=${latencyMs}ms ${message}`)
            sendJson(res, 500, { error: message, latencyMs })
          }
          return
        }

        const match = path.match(/^\/([a-z0-9-]+)$/)
        if (req.method !== 'GET' || !match) {
          sendJson(res, req.method === 'GET' ? 404 : 405, { error: req.method === 'GET' ? 'Video job not found' : 'GET or POST required' })
          return
        }

        const job = videoJobs.get(match[1])
        if (!job) {
          sendJson(res, 404, { error: 'Video job not found; it may predate this dev-server process' })
          return
        }
        if (job.videoFilename || ['failed', 'cancelled', 'expired'].includes(job.status)) {
          sendJson(res, 200, publicVideoJob(job))
          return
        }

        try {
          const apiKey = readOpenRouterKey()
          const response = await fetch(`${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(job.remoteId)}`, {
            headers: { authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30_000),
          })
          const result = await response.json() as {
            status?: string
            error?: string | { message?: string }
            usage?: { cost?: number }
          }
          if (!response.ok) {
            const message = typeof result.error === 'string' ? result.error : result.error?.message
            throw new Error(`OpenRouter ${response.status}: ${message ?? 'video status failed'}`)
          }

          const previousStatus = job.status
          job.status = result.status ?? job.status
          if (typeof result.usage?.cost === 'number') job.cost = result.usage.cost
          if (job.status !== previousStatus) console.log(`[atelier-video] status local=${job.id} ${previousStatus}->${job.status}`)
          if (job.status === 'completed') {
            job.generationLatencyMs = Date.now() - job.submittedAt - job.submitLatencyMs
            await materializeVideo(job, apiKey)
            await appendBridgeRecord(job).catch((error) =>
              console.error(`[atelier-runs] bridge record failed job=${job.id}: ${error instanceof Error ? error.message : String(error)}`),
            )
          } else if (job.status !== previousStatus && ['failed', 'cancelled', 'expired'].includes(job.status)) {
            await appendBridgeRecord(job).catch((error) =>
              console.error(`[atelier-runs] bridge record failed job=${job.id}: ${error instanceof Error ? error.message : String(error)}`),
            )
          }
          sendJson(res, 200, publicVideoJob(job))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[atelier-video] poll-failed local=${job.id} ${message}`)
          sendJson(res, 502, { ...publicVideoJob(job), error: message })
        }
      })

      server.middlewares.use('/api/generate-storyboard', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST required' })
          return
        }

        const startedAt = performance.now()
        try {
          const body = await readJsonBody(req)
          const direction = typeof body.direction === 'string' ? body.direction.trim() : ''
          if (!direction || direction.length > 2_000) throw new Error('Direction must be between 1 and 2,000 characters')

          // Compose the call: a role-labeled pack from the reference web, or
          // the legacy propId/sceneId three-reference form — byte-identical to
          // the pre-web behavior when no pack is sent.
          let prompt: string
          let references: PackReference[]
          let packMeta: Array<{ role: string; id: string }> | undefined
          let propId: string | undefined
          let sceneId: string | undefined
          let beats: readonly string[]
          if (body.pack !== undefined) {
            const web = await loadReferenceWeb()
            const entries = validatePack(body.pack, web)
            prompt = buildPackPrompt(direction, entries, web)
            references = entries
              .filter((entry) => entry.entity.providerReference !== undefined)
              .map((entry) => ({ role: entry.role, id: entry.id, filename: entry.entity.providerReference! }))
            packMeta = entries.map((entry) => ({ role: entry.role, id: entry.id }))
            beats = packBeats(entries)
          } else {
            propId = requireCatalogId(body.propId, propReferences, 'prop')
            sceneId = requireCatalogId(body.sceneId, sceneReferences, 'scene')
            prompt = buildStoryboardPrompt(direction, propId, sceneId)
            references = [
              { role: 'identity', id: 'character:avatar-sample-a', filename: 'vtuber-source.png' },
              { role: 'prop', id: propId, filename: propReferences[propId] },
              { role: 'scene', id: sceneId, filename: sceneReferences[sceneId] },
            ]
            beats = propId === 'prop:star-cactus' ? CACTUS_BEATS : MOON_BEATS
          }

          const referenceBytes = await Promise.all(
            references.map((reference) => readFile(resolve(referencesDir, reference.filename))),
          )
          const hasher = createHash('sha256')
          for (const bytes of referenceBytes) hasher.update(bytes)
          const inputHash = hasher.update(prompt).digest('hex').slice(0, 16)

          if (body.dry_run === true) {
            // Compose-then-inspect: the fully composed call — every reference
            // in order with its role, the complete prompt, the input hash —
            // with NO provider call and no spend. Filenames only; private
            // paths and pixels never leave the server.
            sendJson(res, 200, {
              dryRun: true,
              mode: packMeta ? 'pack' : 'legacy',
              model: 'gpt-image-2',
              references,
              inputHash,
              prompt,
            })
            return
          }

          const form = new FormData()
          form.append('model', 'gpt-image-2')
          form.append('prompt', prompt)
          form.append('quality', 'low')
          form.append('size', '1024x1024')
          form.append('output_format', 'jpeg')
          form.append('output_compression', '88')
          referenceBytes.forEach((bytes, index) => {
            form.append('image[]', new Blob([bytes], { type: 'image/png' }), `reference-${index + 1}.png`)
          })

          console.log(
            `[atelier-storyboard] start input=${inputHash} ${packMeta ? `pack=${packMeta.map((entry) => entry.id).join('+')}` : `prop=${propId} scene=${sceneId}`}`,
          )
          const response = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
            method: 'POST',
            headers: { authorization: `Bearer ${readOpenAiKey()}` },
            body: form,
            signal: AbortSignal.timeout(170_000),
          })
          const result = await response.json() as {
            data?: Array<{ b64_json?: string }>
            error?: { code?: string; message?: string; type?: string }
            usage?: unknown
          }
          if (!response.ok) {
            throw new Error(`OpenAI ${response.status}: ${result.error?.message ?? result.error?.code ?? 'storyboard edit failed'}`)
          }
          const image = result.data?.[0]?.b64_json
          if (!image) throw new Error('OpenAI returned no storyboard bytes')

          const latencyMs = Math.round(performance.now() - startedAt)
          const requestId = response.headers.get('x-request-id')
          const storyId = `story-${Date.now()}-${randomUUID().slice(0, 8)}`
          const metadata = {
            storyId,
            inputHash,
            latencyMs,
            model: 'gpt-image-2',
            requestId,
            ...(packMeta ? { pack: packMeta, references } : { propId, sceneId }),
            direction,
            anchorIds: STORYBOARD_ANCHORS.map((id) => `anchor-${id}`),
            composition: 'rule-of-thirds · continuous slow dolly-forward/lateral-left · three depth planes',
          }
          await mkdir(storyboardDir, { recursive: true })
          await writeFile(latestStoryboardPath, Buffer.from(image, 'base64'))
          cropStoryboardAnchors()
          const firstAnchor = await readFile(storyboardAnchorPath(0))
          await Promise.all([
            writeFile(latestStoryboardMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`),
            writeFile(latestFramePath, firstAnchor),
            writeFile(latestFrameMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`),
          ])
          console.log(`[atelier-storyboard] complete story=${storyId} input=${inputHash} latency=${latencyMs}ms request=${requestId ?? 'unknown'}`)
          // The run ledger — additive, fail-soft: a bookkeeping error must
          // never cost the paid artifact it records.
          await persistRunRecord({
            storyId,
            mode: packMeta ? 'pack' : 'legacy',
            ...(packMeta ? { pack: packMeta } : { propId, sceneId }),
            direction,
            beats,
            references,
            inputHash,
            prompt,
            latencyMs,
            requestId,
          }).catch((error) =>
            console.error(`[atelier-runs] run record failed story=${storyId}: ${error instanceof Error ? error.message : String(error)}`),
          )
          sendJson(res, 200, { ...await readStoryboardResult(), usage: result.usage })
        } catch (error) {
          const latencyMs = Math.round(performance.now() - startedAt)
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[atelier-storyboard] failed latency=${latencyMs}ms ${message}`)
          sendJson(res, 500, { error: message, latencyMs })
        }
      })

      server.middlewares.use('/api/generate-frame', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST required' })
          return
        }

        const startedAt = performance.now()
        try {
          const body = await readJsonBody(req)
          const propId = requireCatalogId(body.propId, propReferences, 'prop')
          const sceneId = requireCatalogId(body.sceneId, sceneReferences, 'scene')
          const direction = typeof body.direction === 'string' ? body.direction.trim() : ''
          if (!direction || direction.length > 2_000) throw new Error('Direction must be between 1 and 2,000 characters')

          const referencePaths = [
            resolve(referencesDir, 'vtuber-source.png'),
            resolve(referencesDir, propReferences[propId]),
            resolve(referencesDir, sceneReferences[sceneId]),
          ]
          const referenceBytes = await Promise.all(referencePaths.map((path) => readFile(path)))
          const inputHash = createHash('sha256')
            .update(referenceBytes[0])
            .update(referenceBytes[1])
            .update(referenceBytes[2])
            .digest('hex')
            .slice(0, 16)

          const form = new FormData()
          form.append('model', 'gpt-image-2')
          form.append('prompt', buildPrompt(direction, propId, sceneId))
          form.append('quality', 'low')
          form.append('size', '1024x1024')
          form.append('output_format', 'jpeg')
          form.append('output_compression', '82')
          referenceBytes.forEach((bytes, index) => {
            form.append('image[]', new Blob([bytes], { type: 'image/png' }), `reference-${index + 1}.png`)
          })

          console.log(`[atelier-image] start input=${inputHash} prop=${propId} scene=${sceneId}`)
          const response = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
            method: 'POST',
            headers: { authorization: `Bearer ${readOpenAiKey()}` },
            body: form,
            signal: AbortSignal.timeout(170_000),
          })
          const result = await response.json() as {
            data?: Array<{ b64_json?: string }>
            error?: { code?: string; message?: string; type?: string }
            usage?: unknown
          }
          if (!response.ok) {
            throw new Error(`OpenAI ${response.status}: ${result.error?.message ?? result.error?.code ?? 'image edit failed'}`)
          }
          const image = result.data?.[0]?.b64_json
          if (!image) throw new Error('OpenAI returned no image bytes')

          const latencyMs = Math.round(performance.now() - startedAt)
          const requestId = response.headers.get('x-request-id')
          const metadata = {
            inputHash,
            latencyMs,
            model: 'gpt-image-2',
            requestId,
          }
          await mkdir(runtimeDir, { recursive: true })
          await Promise.all([
            writeFile(latestFramePath, Buffer.from(image, 'base64')),
            writeFile(latestFrameMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`),
          ])
          console.log(`[atelier-image] complete input=${inputHash} latency=${latencyMs}ms request=${requestId ?? 'unknown'}`)
          sendJson(res, 200, {
            imageDataUrl: `data:image/jpeg;base64,${image}`,
            ...metadata,
            usage: result.usage,
          })
        } catch (error) {
          const latencyMs = Math.round(performance.now() - startedAt)
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[atelier-image] failed latency=${latencyMs}ms ${message}`)
          sendJson(res, 500, { error: message, latencyMs })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [localImageApi()],
  server: {
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/private/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
