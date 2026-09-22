/**
 * backfill-runs.mts — ingest the surviving artifacts of the pre-ledger runs
 * into runtime/runs/ records, honestly.
 *
 * Run with `pnpm --dir apps/atelier-feed-lab exec tsx scripts/backfill-runs.mts`
 * (optionally `--studies <dir>` to point at an alternate archive of the
 * density-probe sheets; `--force` to rewrite existing records).
 *
 * Four runs from the night of 2026-07-31, in the order they happened:
 *   cactus proof   story-1785532454769-12596e2f  clips + assembled survive; sheet and manifest LOST → partial
 *   moon story     story-1785535435053-f4c938d7  clips + assembled + QA frames survive; sheet LOST → partial
 *   4-ref probe    story-1785544099387-f45e3b3f  sheet + meta + dry-run survive (probe archive); no bridges BY DESIGN
 *   6-ref premiere story-1785544138314-9e8f2e4a  everything survives (latest-* + manifest + dry-run + QA)
 *
 * Honesty rules:
 *   - a field that did not survive is null, never invented;
 *   - reconstructed bridge directions (from the deterministic story-family
 *     code path) carry directionReconstructed: true;
 *   - re-derived anchors (same ffmpeg crop the server uses) carry
 *     anchorsDerived: true;
 *   - lost sheets stay lost — partial: true and a note that says why.
 *
 * Seam QA: where adjacent-bridge boundary frames survive in runtime/qa, their
 * SSIM is computed here (ffmpeg, server-side — never in the browser) and lands
 * in the run's qa.json.
 *
 * NOT backfilled, deliberately: shot-1785530646907-e6b2de2f.mp4 — the lone
 * single-frame-era test shot; it belongs to no story.
 */

import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beatsForPrimaryProp } from '../src/story-beats.ts'
import { storyFamilies } from '../src/story-families.ts'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = process.env.ATELIER_RUNTIME_DIR
  ? resolve(process.env.ATELIER_RUNTIME_DIR)
  : resolve(appDir, 'runtime')
const runsDir = resolve(runtimeDir, 'runs')
const videosDir = resolve(runtimeDir, 'videos')
const qaDir = resolve(runtimeDir, 'qa')
const storyboardDir = resolve(runtimeDir, 'storyboard')

const args = process.argv.slice(2)
const force = args.includes('--force')
const studiesFlag = args.indexOf('--studies')
const studiesDirs = [
  resolve(runtimeDir, 'probe-archive'),
  ...(studiesFlag >= 0 && args[studiesFlag + 1] ? [resolve(args[studiesFlag + 1])] : []),
]

const ANCHOR_LETTERS = ['a', 'b', 'c', 'd'] as const
const VIDEO_MODEL = 'bytedance/seedance-2.0-fast'

const GARDEN_STORY_ID = 'story-1785544138314-9e8f2e4a'
const PROBE_4REF_STORY_ID = 'story-1785544099387-f45e3b3f'
const MOON_STORY_ID = 'story-1785535435053-f4c938d7'
const CACTUS_STORY_ID = 'story-1785532454769-12596e2f'

const GARDEN_JOB_IDS = [
  'shot-1785544337219-85bc405a',
  'shot-1785544343380-10091ad2',
  'shot-1785544348016-9fb4b634',
]
const MOON_JOB_IDS = [
  'shot-1785535440793-92c6dc87',
  'shot-1785535441106-cee2bffc',
  'shot-1785535441312-af1eb091',
]
const CACTUS_JOB_IDS = [
  'shot-1785532460042-3ff0de40',
  'shot-1785532460739-ed690a12',
  'shot-1785532462255-da08e69b',
]

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

async function findStudyFile(name: string): Promise<string | null> {
  for (const dir of studiesDirs) {
    const candidate = resolve(dir, name)
    if (await pathExists(candidate)) return candidate
  }
  return null
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function storyTimestamp(storyId: string): number {
  const match = storyId.match(/^story-(\d+)-/)
  if (!match) throw new Error(`cannot read a timestamp out of '${storyId}'`)
  return Number(match[1])
}

/** The server's exact anchor crop (vite.config.ts cropStoryboardAnchors). */
function cropAnchors(sheetPath: string, runDir: string): void {
  const offsets = [
    [0, 0],
    [512, 0],
    [0, 512],
    [512, 512],
  ]
  offsets.forEach(([x, y], index) => {
    const out = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', sheetPath,
      '-vf', `crop=500:500:${x + 6}:${y + 6},scale=512:512:flags=lanczos`,
      '-frames:v', '1',
      '-q:v', '2',
      resolve(runDir, `anchor-${ANCHOR_LETTERS[index]}.jpg`),
    ])
    if (out.status !== 0) throw new Error(`ffmpeg anchor crop failed for ${sheetPath} quadrant ${index}`)
  })
}

/** SSIM between two same-sized boundary frames, via ffmpeg. Null when it
 *  cannot be computed — never a guess. */
function ssimOf(framePathA: string, framePathB: string): number | null {
  const out = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', framePathA, '-i', framePathB, '-lavfi', 'ssim', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const match = `${out.stderr ?? ''}`.match(/All:(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}

interface SeamSpec {
  boundary: string
  first: string
  second: string
}

async function writeQa(runDir: string, seams: SeamSpec[]): Promise<boolean> {
  const measured: Array<{ boundary: string; ssim: number | null; pair: string[] }> = []
  for (const seam of seams) {
    const first = resolve(qaDir, seam.first)
    const second = resolve(qaDir, seam.second)
    if (!(await pathExists(first)) || !(await pathExists(second))) continue
    measured.push({ boundary: seam.boundary, ssim: ssimOf(first, second), pair: [seam.first, seam.second] })
  }
  if (measured.length === 0) return false
  await writeJson(resolve(runDir, 'qa.json'), {
    method:
      'ffmpeg SSIM between adjacent bridge boundary frames (last frame of one clip vs first frame of the next), from runtime/qa',
    computedAt: new Date().toISOString(),
    seams: measured,
  })
  return true
}

interface BridgeSeed {
  jobId: string
  index: number
  direction: string
  manifest?: Record<string, unknown>
}

async function writeBridges(runDir: string, storyId: string, seeds: BridgeSeed[]): Promise<number> {
  const bridgesDir = resolve(runDir, 'bridges')
  await mkdir(bridgesDir, { recursive: true })
  let written = 0
  for (const seed of seeds) {
    const videoPath = resolve(videosDir, `${seed.jobId}.mp4`)
    if (!(await pathExists(videoPath))) {
      console.warn(`  ! clip missing, bridge skipped: ${seed.jobId}.mp4`)
      continue
    }
    const record = seed.manifest
      ? { ...seed.manifest, direction: seed.direction, directionReconstructed: true }
      : {
          jobId: seed.jobId,
          remoteId: null,
          status: 'completed',
          model: VIDEO_MODEL,
          durationSeconds: 4,
          resolution: '480p',
          inputHash: null,
          submittedAt: null,
          submitLatencyMs: null,
          generationLatencyMs: null,
          downloadLatencyMs: null,
          totalLatencyMs: null,
          cost: null,
          bridgeIndex: seed.index,
          firstAnchor: `anchor-${ANCHOR_LETTERS[seed.index]}`,
          lastAnchor: `anchor-${ANCHOR_LETTERS[seed.index + 1]}`,
          storyId,
          videoUrl: `/api/video-content/${seed.jobId}`,
          direction: seed.direction,
          directionReconstructed: true,
        }
    await writeJson(resolve(bridgesDir, `${seed.jobId}.json`), record)
    written += 1
  }
  return written
}

interface MetaSeed {
  storyId: string
  mode: 'legacy' | 'pack' | null
  providerRequestId?: string | null
  latencyMs?: number | null
  refCount?: number | null
  partial: boolean
  note: string
  anchorsDerived?: boolean
}

function metaFor(seed: MetaSeed): Record<string, unknown> {
  const createdAt = storyTimestamp(seed.storyId)
  return {
    runId: seed.storyId,
    storyId: seed.storyId,
    mode: seed.mode,
    model: seed.mode === null ? null : 'gpt-image-2',
    providerRequestId: seed.providerRequestId ?? null,
    latencyMs: seed.latencyMs ?? null,
    createdAt,
    createdAtIso: new Date(createdAt).toISOString(),
    imageSettings:
      seed.mode === null
        ? null
        : { quality: 'low', size: '1024x1024', outputFormat: 'jpeg', outputCompression: 88 },
    refCount: seed.refCount ?? null,
    partial: seed.partial,
    backfilled: true,
    backfilledAt: new Date().toISOString(),
    note: seed.note,
    ...(seed.anchorsDerived ? { anchorsDerived: true } : {}),
  }
}

async function shouldSkip(runDir: string, storyId: string): Promise<boolean> {
  if (force) return false
  if (await pathExists(resolve(runDir, 'meta.json'))) {
    console.log(`= ${storyId} already recorded (use --force to rewrite)`)
    return true
  }
  return false
}

interface ProbeMeta {
  storyId: string
  inputHash: string
  latencyMs: number
  requestId: string
  pack: Array<{ role: string; id: string }>
  references: Array<{ role: string; id: string; filename: string }>
  direction: string
}

interface DryRun {
  inputHash: string
  prompt: string
}

/** A fully-surviving pack run from a probe meta + dry-run + sheet. */
async function backfillPackRun(options: {
  storyId: string
  meta: ProbeMeta
  dryRun: DryRun
  sheetPath: string
  anchors: 'copy-latest' | 'derive'
  note: string
  qaSeams: SeamSpec[]
  bridgeSeeds: BridgeSeed[]
}): Promise<void> {
  const { storyId, meta, dryRun } = options
  if (meta.storyId !== storyId) throw new Error(`meta storyId ${meta.storyId} does not match ${storyId}`)
  if (dryRun.inputHash !== meta.inputHash) {
    throw new Error(`dry-run inputHash ${dryRun.inputHash} does not match meta ${meta.inputHash} for ${storyId}`)
  }
  const runDir = resolve(runsDir, storyId)
  if (await shouldSkip(runDir, storyId)) return
  await mkdir(resolve(runDir, 'bridges'), { recursive: true })

  const primaryPropId = meta.pack.find((entry) => entry.role === 'prop')?.id
  await writeJson(resolve(runDir, 'request.json'), {
    mode: 'pack',
    pack: meta.pack,
    direction: meta.direction,
    beats: beatsForPrimaryProp(primaryPropId),
    references: meta.references,
    inputHash: meta.inputHash,
    prompt: dryRun.prompt,
  })
  await writeJson(
    resolve(runDir, 'meta.json'),
    metaFor({
      storyId,
      mode: 'pack',
      providerRequestId: meta.requestId,
      latencyMs: meta.latencyMs,
      refCount: meta.references.length,
      partial: false,
      note: options.note,
      anchorsDerived: options.anchors === 'derive',
    }),
  )
  await copyFile(options.sheetPath, resolve(runDir, 'sheet.jpg'))
  if (options.anchors === 'copy-latest') {
    for (const letter of ANCHOR_LETTERS) {
      await copyFile(resolve(storyboardDir, `anchor-${letter}.jpg`), resolve(runDir, `anchor-${letter}.jpg`))
    }
  } else {
    cropAnchors(options.sheetPath, runDir)
  }
  const bridges = await writeBridges(runDir, storyId, options.bridgeSeeds)
  const qa = await writeQa(runDir, options.qaSeams)
  console.log(`+ ${storyId} recorded (pack, ${meta.references.length} refs, ${bridges} bridges${qa ? ', qa' : ''})`)
}

/** A clips-only run whose sheet and request are lost — partial, honestly. */
async function backfillPartialRun(options: {
  storyId: string
  note: string
  bridgeSeeds: BridgeSeed[]
  qaSeams: SeamSpec[]
}): Promise<void> {
  const { storyId } = options
  const runDir = resolve(runsDir, storyId)
  if (await shouldSkip(runDir, storyId)) return
  await mkdir(resolve(runDir, 'bridges'), { recursive: true })
  await writeJson(resolve(runDir, 'request.json'), {
    mode: null,
    pack: null,
    direction: null,
    beats: null,
    references: null,
    inputHash: null,
    prompt: null,
  })
  await writeJson(
    resolve(runDir, 'meta.json'),
    metaFor({ storyId, mode: null, refCount: null, partial: true, note: options.note }),
  )
  const bridges = await writeBridges(runDir, storyId, options.bridgeSeeds)
  const qa = await writeQa(runDir, options.qaSeams)
  console.log(`+ ${storyId} recorded (partial, ${bridges} bridges${qa ? ', qa' : ''})`)
}

async function main(): Promise<void> {
  await mkdir(runsDir, { recursive: true })

  // ── The 6-ref Garden premiere — everything survives ────────────────────────
  {
    const latestMetaPath = resolve(storyboardDir, 'latest-storyboard.json')
    const latestMeta = (await pathExists(latestMetaPath)) ? await readJson<ProbeMeta>(latestMetaPath) : null
    const latestIsGarden = latestMeta?.storyId === GARDEN_STORY_ID
    const metaPath = latestIsGarden ? latestMetaPath : await findStudyFile('sheet-6ref-meta.json')
    const dryRunPath = await findStudyFile('sheet-6ref-dryrun.json')
    const sheetPath = latestIsGarden
      ? resolve(storyboardDir, 'latest-storyboard.jpg')
      : await findStudyFile('sheet-6ref.jpg')
    if (!metaPath || !dryRunPath || !sheetPath) {
      console.warn(`! ${GARDEN_STORY_ID} skipped — 6-ref meta/dry-run/sheet not found in ${studiesDirs.join(', ')}`)
    } else {
      // Bridge records: the story manifest if it still names this story,
      // else clip-derived seeds. Direction texts are the moon-family bridge
      // lines — the deterministic code path for a paper-drum-lantern pack
      // (familyFor falls through to the moon family) — marked reconstructed.
      const manifestPath = resolve(runtimeDir, 'latest-story-videos.json')
      const manifest = (await pathExists(manifestPath))
        ? await readJson<{ storyId?: string; clips?: Array<Record<string, unknown>> }>(manifestPath)
        : null
      const manifestClips = manifest?.storyId === GARDEN_STORY_ID ? manifest.clips ?? [] : []
      const bridgeSeeds: BridgeSeed[] = GARDEN_JOB_IDS.map((jobId, index) => ({
        jobId,
        index,
        direction: storyFamilies.moon.bridges[index],
        manifest: manifestClips.find((clip) => clip.jobId === jobId),
      }))
      await backfillPackRun({
        storyId: GARDEN_STORY_ID,
        meta: await readJson<ProbeMeta>(metaPath),
        dryRun: await readJson<DryRun>(dryRunPath),
        sheetPath,
        anchors: latestIsGarden ? 'copy-latest' : 'derive',
        note:
          'Backfilled: the Garden of Forking Paths Story I premiere — the 6-ref density-probe sheet whose world was approved for bridges. Bridge directions are the moon-family lines the pipeline deterministically sends for a paper-drum-lantern pack.',
        qaSeams: [
          { boundary: 'B', first: 'garden-ab-last.png', second: 'garden-bc-first.png' },
          { boundary: 'C', first: 'garden-bc-last.png', second: 'garden-cd-first.png' },
        ],
        bridgeSeeds,
      })
    }
  }

  // ── The 4-ref density-probe sheet — sheet-only by design ───────────────────
  {
    const metaPath = await findStudyFile('sheet-4ref-meta.json')
    const dryRunPath = await findStudyFile('sheet-4ref-dryrun.json')
    const sheetPath = await findStudyFile('sheet-4ref.jpg')
    if (!metaPath || !dryRunPath || !sheetPath) {
      console.warn(`! ${PROBE_4REF_STORY_ID} skipped — 4-ref meta/dry-run/sheet not found in ${studiesDirs.join(', ')}`)
    } else {
      await backfillPackRun({
        storyId: PROBE_4REF_STORY_ID,
        meta: await readJson<ProbeMeta>(metaPath),
        dryRun: await readJson<DryRun>(dryRunPath),
        sheetPath,
        anchors: 'derive',
        note:
          'Backfilled: the 4-ref arm of the E11 density probe (hybrid ruling) — a storyboard call only, no bridges by design. Anchors re-cropped from the archived sheet with the server’s exact crop.',
        qaSeams: [],
        bridgeSeeds: [],
      })
    }
  }

  // ── The moon story — sheet lost to the latest-* overwrite ──────────────────
  await backfillPartialRun({
    storyId: MOON_STORY_ID,
    note:
      'Backfilled, partial: the moon-lantern story. Its sheet, anchors, and request metadata were overwritten in runtime/storyboard/latest-* by the next run before the ledger existed — this loss is why the ledger was built. Clips, the assembled story, and QA boundary frames survive. Bridge directions are the moon-family lines, reconstructed.',
    bridgeSeeds: MOON_JOB_IDS.map((jobId, index) => ({
      jobId,
      index,
      direction: storyFamilies.moon.bridges[index],
    })),
    qaSeams: [
      { boundary: 'B', first: 'moon-ab-last.png', second: 'moon-bc-first.png' },
      { boundary: 'C', first: 'moon-bc-last.png', second: 'moon-cd-first.png' },
    ],
  })

  // ── The cactus proof — the first full story of the night ───────────────────
  await backfillPartialRun({
    storyId: CACTUS_STORY_ID,
    note:
      'Backfilled, partial: the star-cactus proof story — the first full three-bridge story. Its sheet and story manifest were lost to later runs; clips and the assembled story survive. Bridge order is the submission (timestamp) order; directions are the cactus-family lines, reconstructed.',
    bridgeSeeds: CACTUS_JOB_IDS.map((jobId, index) => ({
      jobId,
      index,
      direction: storyFamilies.cactus.bridges[index],
    })),
    qaSeams: [],
  })

  console.log('backfill complete.')
}

await main()
