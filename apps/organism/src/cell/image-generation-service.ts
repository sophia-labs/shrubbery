/** Shell-owned image editing/generation over OpenRouter's multimodal API. */

export interface ImageProviderKeySource {
  getProviderKey(provider: 'openrouter'): Promise<string | null | undefined>
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

interface TauriInternalsGlobal {
  readonly __TAURI_INTERNALS__?: { readonly invoke?: TauriInvoke }
}

/** Native provider-key adapter without importing Tauri into the web build. */
export class TauriImageProviderKeySource implements ImageProviderKeySource {
  constructor(private readonly invoke?: TauriInvoke) {}

  async getProviderKey(provider: 'openrouter'): Promise<string | null> {
    const invoke = this.invoke ?? (globalThis as TauriInternalsGlobal).__TAURI_INTERNALS__?.invoke
    if (!invoke) return null
    try {
      const keys = await invoke<Record<string, unknown>>('get_provider_keys')
      const value = keys?.[provider]
      return typeof value === 'string' && value.trim() ? value.trim() : null
    } catch {
      return null
    }
  }
}

export interface ImageGenerationServiceOptions {
  readonly keys: ImageProviderKeySource
  readonly fetch?: typeof fetch
  readonly model?: string
  readonly endpoint?: string
}

export interface GenerateImageEditRequest {
  readonly imageDataUrl: string
  readonly prompt: string
  readonly signal?: AbortSignal
}

interface OpenRouterImagePart {
  readonly image_url?: { readonly url?: unknown }
  readonly url?: unknown
}

interface OpenRouterResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly images?: readonly OpenRouterImagePart[]
      readonly content?: unknown
    }
  }>
  readonly error?: { readonly message?: unknown }
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image'
const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ImageGenerationError'
  }
}

function imageUrl(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null
  const value = part as OpenRouterImagePart
  const candidate = value.image_url?.url ?? value.url
  return typeof candidate === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(candidate)
    ? candidate
    : null
}

export function extractGeneratedImage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const message = (payload as OpenRouterResponse).choices?.[0]?.message
  for (const part of message?.images ?? []) {
    const candidate = imageUrl(part)
    if (candidate) return candidate
  }
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      const candidate = imageUrl(part)
      if (candidate) return candidate
    }
  }
  return null
}

export class OpenRouterImageGenerationService {
  private readonly fetchImpl: typeof fetch
  private readonly model: string
  private readonly endpoint: string

  constructor(private readonly options: ImageGenerationServiceOptions) {
    const f = options.fetch ?? globalThis.fetch
    if (typeof f !== 'function') throw new Error('Image generation requires fetch')
    this.fetchImpl = f.bind(globalThis) as typeof fetch
    this.model = options.model?.trim() || DEFAULT_MODEL
    this.endpoint = options.endpoint?.trim() || DEFAULT_ENDPOINT
  }

  async generateEdit(request: GenerateImageEditRequest): Promise<string> {
    const prompt = request.prompt.trim()
    if (!prompt) throw new ImageGenerationError('Describe the image edit to generate.')
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(request.imageDataUrl)) {
      throw new ImageGenerationError('Image generation requires a base64 image data URL.')
    }
    const key = (await this.options.keys.getProviderKey('openrouter'))?.trim()
    if (!key) {
      throw new ImageGenerationError(
        'Add your OpenRouter API key in Settings → Local AI to use Generate.',
      )
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        modalities: ['image', 'text'],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: request.imageDataUrl } },
            ],
          },
        ],
      }),
      signal: request.signal,
    })

    const text = await response.text()
    let payload: OpenRouterResponse = {}
    try {
      payload = text ? JSON.parse(text) as OpenRouterResponse : {}
    } catch {
      // Preserve the raw response excerpt in the HTTP error below.
    }
    if (!response.ok) {
      const providerMessage = typeof payload.error?.message === 'string'
        ? payload.error.message
        : text.slice(0, 240)
      throw new ImageGenerationError(
        `Image generation failed (${response.status}).${providerMessage ? ` ${providerMessage}` : ''}`,
        response.status,
      )
    }
    if (typeof payload.error?.message === 'string' && payload.error.message.trim()) {
      throw new ImageGenerationError(payload.error.message.trim())
    }
    const image = extractGeneratedImage(payload)
    if (!image) {
      throw new ImageGenerationError(
        'The model returned no image. Try rephrasing, or switch the image model.',
      )
    }
    return image
  }
}

export function createImageGenerationService(
  options: ImageGenerationServiceOptions,
): OpenRouterImageGenerationService {
  return new OpenRouterImageGenerationService(options)
}
