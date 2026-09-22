import { describe, expect, it } from 'vitest'
import {
  createImageGenerationService,
  extractGeneratedImage,
  ImageGenerationError,
  type ImageProviderKeySource,
} from '../image-generation-service.js'

class KeySource implements ImageProviderKeySource {
  constructor(private readonly key: string | null) {}
  async getProviderKey(provider: 'openrouter'): Promise<string | null> {
    expect(provider).toBe('openrouter')
    return this.key
  }
}

describe('OpenRouterImageGenerationService', () => {
  it('sends Garden-compatible multimodal image edits and accepts message.images', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const output = 'data:image/png;base64,generated'
    const service = createImageGenerationService({
      keys: new KeySource('secret-key'),
      fetch: async (input, init) => {
        calls.push({ url: String(input), init })
        return new Response(JSON.stringify({
          choices: [{ message: { images: [{ image_url: { url: output } }] } }],
        }), { status: 200 })
      },
    })
    await expect(service.generateEdit({
      imageDataUrl: 'data:image/png;base64,source',
      prompt: ' turn it into a moonlit garden ',
    })).resolves.toBe(output)

    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret-key')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body).toMatchObject({
      model: 'google/gemini-2.5-flash-image',
      modalities: ['image', 'text'],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'turn it into a moonlit garden' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,source' } },
        ],
      }],
    })
  })

  it('accepts image parts returned inside message.content', () => {
    expect(extractGeneratedImage({
      choices: [{ message: { content: [{ url: 'data:image/webp;base64,result' }] } }],
    })).toBe('data:image/webp;base64,result')
    expect(extractGeneratedImage({ choices: [{ message: { content: 'no image' } }] })).toBeNull()
  })

  it('rejects absent secrets and invalid source inputs before transport', async () => {
    const service = createImageGenerationService({
      keys: new KeySource(null),
      fetch: async () => {
        throw new Error('transport must not run')
      },
    })
    await expect(service.generateEdit({
      imageDataUrl: 'data:image/png;base64,source',
      prompt: 'edit',
    })).rejects.toThrow(/OpenRouter API key/)
    await expect(service.generateEdit({
      imageDataUrl: 'https://example.test/source.png',
      prompt: 'edit',
    })).rejects.toThrow(/base64 image data URL/)
  })

  it('preserves provider error detail and status', async () => {
    const service = createImageGenerationService({
      keys: new KeySource('key'),
      fetch: async () => new Response(JSON.stringify({
        error: { message: 'model unavailable' },
      }), { status: 503 }),
    })
    const error = await service.generateEdit({
      imageDataUrl: 'data:image/jpeg;base64,source',
      prompt: 'edit',
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ImageGenerationError)
    expect(error).toMatchObject({ status: 503 })
    expect((error as Error).message).toContain('model unavailable')
  })
})
