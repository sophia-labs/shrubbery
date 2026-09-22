import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { GenerateImageEditRequest } from './image-generation-service.js'

export interface ImageEditGenerator {
  generateEdit(request: GenerateImageEditRequest): Promise<string>
}

export interface GenerateArtifactImageRequest {
  readonly graphId: string
  readonly artifactId: string
  readonly sourceDataUrl: string
  readonly prompt: string
  readonly target: 'version' | 'artifact'
  readonly title?: string
  readonly parentId?: string | null
  readonly signal?: AbortSignal
}

export interface GeneratedArtifactImage {
  readonly graphId: string
  readonly artifactId: string
  readonly sourceArtifactId: string
  readonly dataUrl: string
  readonly mimeType: 'image/png' | 'image/jpeg'
  readonly target: 'version' | 'artifact'
}

export interface ArtifactImageGenerationFlowOptions {
  readonly fetch?: typeof fetch
  readonly idFactory?: () => string
  readonly now?: () => number
}

type ImageCellContract = Pick<ShrubberyContract, 'auth' | 'runtime'>

function trimmedBase(value: string): string {
  return value.replace(/\/+$/, '')
}

function headers(contract: ImageCellContract, json = false): Record<string, string> {
  const value: Record<string, string> = { 'X-User-ID': contract.auth.userId() }
  const token = contract.auth.token()
  if (token) value.Authorization = `Bearer ${token}`
  if (json) value['Content-Type'] = 'application/json'
  return value
}

function dataUrlParts(value: string): { mimeType: 'image/png' | 'image/jpeg'; dataBase64: string } {
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=]+)$/i.exec(value.trim())
  if (!match) throw new Error('Generated image must be a PNG or JPEG base64 data URL.')
  return { mimeType: match[1].toLowerCase() as 'image/png' | 'image/jpeg', dataBase64: match[2] }
}

function defaultId(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `generated-image-${suffix}`
}

async function checked(response: Response, operation: string): Promise<void> {
  if (response.ok) return
  const detail = await response.text().catch(() => response.statusText)
  throw new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ''}`)
}

/** Generate bytes, then persist either a revision or a brand-new artifact. */
export async function generateArtifactImage(
  contract: ImageCellContract,
  generator: ImageEditGenerator,
  request: GenerateArtifactImageRequest,
  options: ArtifactImageGenerationFlowOptions = {},
): Promise<GeneratedArtifactImage> {
  if (!request.graphId.trim() || !request.artifactId.trim()) {
    throw new Error('Image generation requires graphId and artifactId.')
  }
  const fetchImpl = (options.fetch ?? globalThis.fetch)?.bind(globalThis)
  if (!fetchImpl) throw new Error('Image generation persistence requires fetch.')
  const dataUrl = await generator.generateEdit({
    imageDataUrl: request.sourceDataUrl,
    prompt: request.prompt,
    signal: request.signal,
  })
  const { mimeType, dataBase64 } = dataUrlParts(dataUrl)
  const graphId = request.graphId.trim()
  const sourceArtifactId = request.artifactId.trim()
  const artifactId = request.target === 'artifact' ? (options.idFactory ?? defaultId)() : sourceArtifactId
  const apiBase = trimmedBase(contract.runtime.graphBaseUrl(graphId))
  const encodedGraph = encodeURIComponent(graphId)
  const encodedArtifact = encodeURIComponent(artifactId)
  const revision = await fetchImpl(`${apiBase}/artifacts/${encodedGraph}/${encodedArtifact}/revisions`, {
    method: 'POST',
    headers: headers(contract, true),
    body: JSON.stringify({
      dataBase64,
      mimeType,
      label: request.target === 'artifact' ? 'Generated' : 'Generated',
      ...(request.target === 'artifact'
        ? { filename: `${artifactId}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}` }
        : {}),
    }),
    signal: request.signal,
  })
  await checked(revision, 'Save generated image revision')

  if (request.target === 'artifact') {
    const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const filename = `${artifactId}.${extension}`
    const label = request.title?.trim() || `Generated image ${new Date(options.now?.() ?? Date.now()).toLocaleString()}`
    const navigation = await fetchImpl(`${apiBase}/navigation/${encodedGraph}/artifacts/${encodedArtifact}`, {
      method: 'PUT',
      headers: headers(contract, true),
      body: JSON.stringify({
        label,
        originalFilename: filename,
        mimeType,
        status: 'ready',
        storageKey: `local://artifacts/${artifactId}/original/${filename}`,
        ...(request.parentId ? { parentId: request.parentId } : {}),
      }),
      signal: request.signal,
    })
    await checked(navigation, 'Register generated image artifact')
  }

  return {
    graphId,
    artifactId,
    sourceArtifactId,
    dataUrl,
    mimeType,
    target: request.target,
  }
}
