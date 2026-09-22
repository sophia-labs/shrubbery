// Honest, cell-backed Atelier demo. Every panel is a real round-trip through a
// running gardend cell (same-origin /cell proxy):
//   - :ux:control is READ from the cell (rdf_dump) and WRITTEN by the real
//     set_appearance verb (growVtuberAppearance → sparql_update). No client-side
//     serialization stands in for the graph; the panel shows the cell's own bytes.
//   - the avatar is our committed fixture, styled from the channel the verb wrote.
//   - license testimony is extracted from the fixture's VRM meta by glb-inspect.
// No cell running → the honest live-read error is shown, never faked.
import '@shrubbery/atelier-vtuber'
import type { MnVtuberAppearance, MnVtuberExpressionPreset } from '@shrubbery/atelier-vtuber'
import { inspectGlb, type VrmInspectionReport } from '@shrubbery/atelier-vtuber/glb-inspect'
import {
  parseNT,
  parseVtuberControlOverlay,
  serializeVtuberControlChannelsToTriples,
  triplesToNT,
  uxControlGraphIri,
  type VtuberControlChannel,
  type VtuberControlOverlay,
} from '@shrubbery/nucleus'
import {
  growVtuberAppearance,
  makeAppearanceGrowCell,
  sparqlUpdateArgs,
  type SetVtuberAppearanceSpec,
} from '@shrubbery/runtime'

const FIXTURE_DIR = '/@fs/Users/vera/dev/sophia/shrubbery/packages/atelier/fixtures/vrm/'
const CHANNEL_ID = 'demo-avatar'

const el = <T extends HTMLElement>(id: string) => document.querySelector<T>('#' + id)!
const avatar = el<HTMLElement & { modelUrl: string; expression: MnVtuberExpressionPreset; appearance?: MnVtuberAppearance; animated: boolean }>('avatar')
const statusEl = el<HTMLPreElement>('status')
const fixtureSel = el<HTMLSelectElement>('fixture')
const triplesEl = el<HTMLPreElement>('triples')
const licenseEl = el<HTMLDListElement>('license')
const expressionSel = el<HTMLSelectElement>('expression')
const skinWarmth = el<HTMLInputElement>('skinWarmth')
const skinWarmthOut = el<HTMLOutputElement>('skinWarmthOut')
const graphLabel = el<HTMLSpanElement>('graph-label')
const mirrorBtn = el<HTMLButtonElement>('mirror-btn')
const mirrorImg = el<HTMLImageElement>('mirror-img')
const mirrorCaption = el<HTMLParagraphElement>('mirror-caption')

const TINTS = ['accentTint', 'eyeTint', 'hairTint', 'outfitTint'] as const

// ── the real cell, over the same-origin /cell proxy ────────────────────────────
const GRAPH = 'atelier-dev'
let cellOk = false

async function toolsCall(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch('/cell/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  if (res.status === 404) throw new Error(`MCP HTTP 404 for ${name}: Is a cell running? Start one with:  pnpm gardend:dev`)
  if (!res.ok) throw new Error(`MCP HTTP ${res.status} for ${name}`)
  const json = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: { message?: string } }
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error))
  return json.result?.content?.[0]?.text ?? ''
}

// the AppearanceGrowCell port the SHIPPED verb needs — real read + real mutate
const port = makeAppearanceGrowCell({
  async readControlOverlay(graphId): Promise<VtuberControlOverlay> {
    const dump = JSON.parse(await toolsCall('rdf_dump', {
      graphId, sourceGraphIri: uxControlGraphIri(graphId), format: 'application/n-triples',
    })) as { data?: string }
    return parseVtuberControlOverlay(parseNT(dump.data ?? ''))
  },
  async mutateGraph(graphId, update): Promise<void> {
    await toolsCall('sparql_update', sparqlUpdateArgs(graphId, update))
  },
})

// every control maps to a real predicate the verb writes — always send the full
// set (the verb is replace-only; it has no "delete a predicate" edit, so the demo
// offers no control that would imply one).
function readEdit(): SetVtuberAppearanceSpec['appearance'] {
  const a: Record<string, unknown> = {}
  for (const k of TINTS) a[k] = el<HTMLInputElement>(k).value
  a.skinWarmth = Number(skinWarmth.value)
  a.expression = expressionSel.value as MnVtuberExpressionPreset
  return a as SetVtuberAppearanceSpec['appearance']
}

// reflect the cell's own :ux:control bytes into the avatar + the triples panel
async function reflectFromCell(): Promise<void> {
  const dump = JSON.parse(await toolsCall('rdf_dump', {
    graphId: GRAPH, sourceGraphIri: uxControlGraphIri(GRAPH), format: 'application/n-triples',
  })) as { data?: string }
  const nt = dump.data ?? ''
  triplesEl.textContent = nt.trim() || '(channel not yet in cell)'
  const overlay = parseVtuberControlOverlay(parseNT(nt))
  const ch = overlay.channels[CHANNEL_ID]
  if (!ch) return
  avatar.appearance = (ch.appearance ?? {}) as MnVtuberAppearance
  if (ch.expression) { avatar.expression = ch.expression as MnVtuberExpressionPreset; expressionSel.value = ch.expression }
}

// drive the REAL verb, then reflect what actually landed in the cell
let writing = false
async function applyToCell(): Promise<void> {
  if (!cellOk || writing) return
  writing = true
  try {
    const spec: SetVtuberAppearanceSpec = {
      verb: 'set_vtuber_appearance',
      target: { channelId: CHANNEL_ID },
      appearance: readEdit(),
    }
    const result = await growVtuberAppearance(port, GRAPH, spec)
    if (!result.ok) { statusEl.textContent = `verb rejected [${result.gate}] — cell unchanged`; return }
    await reflectFromCell()
  } catch (err) {
    triplesEl.textContent = 'live-read/write error (no fallback):\n' + (err as Error).message
  } finally {
    writing = false
  }
}

// ensure the channel exists in the cell (seed once via the shipped serializer)
async function ensureSeed(): Promise<void> {
  const overlay = await port.readControlOverlay(GRAPH)
  if (overlay.channels[CHANNEL_ID]) return
  const channel: VtuberControlChannel = {
    id: CHANNEL_ID, label: 'Atelier demo avatar', targetComponent: 'mn-vtuber',
    expression: 'focused',
    appearance: { accentTint: '#7c5cff', eyeTint: '#39d0d8', hairTint: '#e86a92', outfitTint: '#2f5d8a' },
  }
  const nt = triplesToNT(serializeVtuberControlChannelsToTriples([channel]))
  await toolsCall('rdf_load', { graphId: GRAPH, data: nt, format: 'application/n-triples', targetGraphIri: uxControlGraphIri(GRAPH) })
}

function renderLicense(report: VrmInspectionReport): void {
  const rows: Array<[string, string | undefined]> = report.vrm1
    ? [
        ['name', report.vrm1.meta.name],
        ['authors — credit', (report.vrm1.meta.authors ?? []).join(', ')],
        ['avatarPermission', report.vrm1.meta.avatarPermission],
        ['commercialUsage', report.vrm1.meta.commercialUsage],
        ['creditNotation', report.vrm1.meta.creditNotation],
        ['modification', report.vrm1.meta.modification],
        ['redistribution', String(report.vrm1.meta.allowRedistribution)],
        ['licenseUrl', report.vrm1.meta.licenseUrl],
        ['spec', 'VRM ' + (report.vrm1.specVersion ?? '1.0')],
      ]
    : [
        ['title', report.vrm0?.meta.title],
        ['author — credit', report.vrm0?.meta.author],
        ['allowedUser', report.vrm0?.meta.allowedUserName],
        ['license', report.vrm0?.meta.licenseName],
        ['commercial', report.vrm0?.meta.commercialUssageName],
        ['spec', 'VRM 0.x'],
      ]
  licenseEl.innerHTML = rows.filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${String(v)}</dd>`).join('')
}

// ── S3 made visible — POST /mirror runs the REAL headless render + archive
// server-side (renderPortrait spawns playwright+vite, so it can't run in this
// browser tab), and hands back the PNG + where it landed in the cell. ────────
interface MirrorResponse {
  artifactId: string
  sha256: string
  pngBase64: string
  status: { status: string }
}

let mirroring = false
async function renderMirror(): Promise<void> {
  if (mirroring) return
  mirroring = true
  mirrorBtn.disabled = true
  mirrorCaption.textContent = 'rendering…'
  try {
    const res = await fetch('/mirror', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture: fixtureSel.value }),
    })
    const json = (await res.json()) as MirrorResponse & { error?: string }
    if (!res.ok || json.error) throw new Error(json.error ?? `mirror HTTP ${res.status}`)
    // honesty: a fallback/error render is the procedural rig, NOT the real VRM —
    // mark it plainly rather than presenting it as a clean portrait (the demo's
    // no-mock contract; distinct from the Emporium license gate, which is deferred).
    const ready = json.status.status === 'ready'
    mirrorImg.src = `data:image/png;base64,${json.pngBase64}`
    mirrorImg.hidden = false
    mirrorImg.classList.toggle('mirror-fallback', !ready)
    mirrorCaption.classList.toggle('warn', !ready)
    mirrorCaption.textContent = ready
      ? `artifact ${json.artifactId} · sha ${json.sha256.slice(0, 8)} · real VRM (ready) — in cell \`atelier-dev\``
      : `⚠ ${json.status.status} — PROCEDURAL FALLBACK RIG, not the real VRM · artifact ${json.artifactId}`
  } catch (err) {
    mirrorCaption.textContent = 'mirror error (no fallback): ' + (err as Error).message
  } finally {
    mirroring = false
    mirrorBtn.disabled = false
  }
}
mirrorBtn.addEventListener('click', () => void renderMirror())

async function loadFixture(name: string): Promise<void> {
  statusEl.textContent = 'loading ' + name + '…'
  avatar.modelUrl = FIXTURE_DIR + name
  try {
    renderLicense(inspectGlb(await (await fetch(FIXTURE_DIR + name)).arrayBuffer()))
  } catch (err) {
    licenseEl.textContent = 'inspect failed: ' + (err as Error).message
  }
}

// wiring
for (const k of TINTS) el<HTMLInputElement>(k).addEventListener('input', () => void applyToCell())
skinWarmth.addEventListener('input', () => { skinWarmthOut.textContent = Number(skinWarmth.value).toFixed(2); void applyToCell() })
expressionSel.addEventListener('change', () => void applyToCell())
fixtureSel.addEventListener('change', () => void loadFixture(fixtureSel.value))
avatar.addEventListener('mn-vtuber-status', (e) => { statusEl.textContent = JSON.stringify((e as CustomEvent).detail) })

avatar.animated = true

async function boot(): Promise<void> {
  await loadFixture(fixtureSel.value)
  graphLabel.textContent = GRAPH
  try {
    await ensureSeed()
    await reflectFromCell()
    cellOk = true
    graphLabel.textContent = GRAPH + ' · live'
  } catch (err) {
    cellOk = false
    graphLabel.textContent = GRAPH + ' · OFFLINE'
    triplesEl.textContent = 'live-read error (no fallback):\n' + (err as Error).message
  }
}
void boot()
