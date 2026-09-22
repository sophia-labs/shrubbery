import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { renderPortrait } from '@shrubbery/atelier-vtuber/mirror'

const execFileAsync = promisify(execFile)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const modelPath = resolve(appDir, '../../packages/atelier/fixtures/vrm/avatar-sample-a.vrm')
const referencesDir = resolve(appDir, 'private/references')
const rawPath = resolve(referencesDir, 'vtuber-source-raw.png')
const outputPath = resolve(referencesDir, 'vtuber-source.png')
const manifestPath = resolve(referencesDir, 'vtuber-source.json')

await mkdir(referencesDir, { recursive: true })

const renderSettings = {
  cameraFrame: 'bust' as const,
  expression: 'neutral' as const,
  size: { width: 1024, height: 1024 },
}

const portrait = await renderPortrait({ modelPath, ...renderSettings })
if (portrait.status.status !== 'ready' || !portrait.status.stats) {
  throw new Error(`The real VRM did not render successfully: ${JSON.stringify(portrait.status)}`)
}

await writeFile(rawPath, portrait.png)

// Normalize the browser screenshot into one stable, square RGB source plate.
// This is deliberately boring preprocessing: no generative pixels, no pose
// inference, and no browser-facing route. The artistic model receives only the
// resulting still image.
await execFileAsync('/usr/local/bin/ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  rawPath,
  '-vf',
  'scale=1024:1024:flags=lanczos,format=rgb24',
  '-frames:v',
  '1',
  '-compression_level',
  '9',
  outputPath,
])

const [modelBytes, sourceBytes] = await Promise.all([readFile(modelPath), readFile(outputPath)])
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

await writeFile(manifestPath, `${JSON.stringify({
  sourceModel: '../../packages/atelier/fixtures/vrm/avatar-sample-a.vrm',
  sourceModelSha256: sha256(modelBytes),
  sourcePlateSha256: sha256(sourceBytes),
  renderSha256: portrait.sha256,
  renderSettings,
  renderStats: portrait.status.stats,
  contract: 'private build input; never served to the browser',
}, null, 2)}\n`)

process.stdout.write(`Prepared hidden VTuber source plate ${outputPath}\n`)
