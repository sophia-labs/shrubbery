import { describe, expect, it, vi } from 'vitest'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { generateArtifactImage } from '../image-generation-flow.js'
import { TauriImageProviderKeySource } from '../image-generation-service.js'

function contract(): Pick<ShrubberyContract, 'auth' | 'runtime'> {
  return {
    auth: {
      token: () => 'token',
      userId: () => 'user',
      isAuthenticated: () => true,
      whenReady: async () => {},
      onChange: () => () => {},
    },
    runtime: {
      mode: () => 'hosted',
      isGateway: () => true,
      graphBaseUrl: graphId => `https://gateway.test/g/${graphId}`,
    },
  }
}

describe('image generation shell flow', () => {
  it('reads native provider keys without importing Tauri into web builds', async () => {
    const invoke = vi.fn(async <T>() => ({ openrouter: '  secret  ' }) as T)
    await expect(new TauriImageProviderKeySource(
      invoke as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    ).getProviderKey('openrouter')).resolves.toBe('secret')
    expect(invoke).toHaveBeenCalledWith('get_provider_keys')
    await expect(new TauriImageProviderKeySource().getProviderKey('openrouter')).resolves.toBeNull()
  })

  it('persists generated versions on the source artifact', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 201 })) as unknown as typeof globalThis.fetch
    const generated = await generateArtifactImage(contract(), {
      generateEdit: async () => 'data:image/png;base64,aW1hZ2U=',
    }, {
      graphId: 'g',
      artifactId: 'source',
      sourceDataUrl: 'data:image/png;base64,c291cmNl',
      prompt: 'make it green',
      target: 'version',
    }, { fetch })

    expect(generated).toMatchObject({ artifactId: 'source', target: 'version', mimeType: 'image/png' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'https://gateway.test/g/g/artifacts/g/source/revisions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates a conforming artifact without the broken multipart size projection', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response('{}', { status: 201 })
    }
    const generated = await generateArtifactImage(contract(), {
      generateEdit: async () => 'data:image/jpeg;base64,aW1hZ2U=',
    }, {
      graphId: 'g',
      artifactId: 'source',
      sourceDataUrl: 'data:image/png;base64,c291cmNl',
      prompt: 'make another',
      target: 'artifact',
      title: 'Second image',
      parentId: 'folder-a',
    }, { fetch, idFactory: () => 'generated-1' })

    expect(generated.artifactId).toBe('generated-1')
    expect(calls.map(call => call.url)).toEqual([
      'https://gateway.test/g/g/artifacts/g/generated-1/revisions',
      'https://gateway.test/g/g/navigation/g/artifacts/generated-1',
    ])
    const metadata = JSON.parse(String(calls[1].init?.body))
    expect(metadata).toMatchObject({
      label: 'Second image',
      originalFilename: 'generated-1.jpg',
      mimeType: 'image/jpeg',
      status: 'ready',
      parentId: 'folder-a',
    })
    expect(metadata).not.toHaveProperty('sizeBytes')
  })
})
