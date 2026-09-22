import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let vite: ViteDevServer | undefined

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))
  return match?.[1] ?? null
}

afterEach(async () => {
  await vite?.close()
  vite = undefined
})

describe('organism app-shell assets', () => {
  it('declares a favicon that the Vite settings route serves successfully', async () => {
    // The Organism suite intentionally shares one fork. Some controller tests
    // stub global fetch; this network-level assertion must always use Node's
    // real fetch rather than inherit a prior file's response shim.
    vi.unstubAllGlobals()
    vite = await createServer({
      root: appDir,
      configFile: resolve(appDir, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'silent',
    })
    await vite.listen()

    const address = vite.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port')
    const routeUrl = `http://127.0.0.1:${address.port}/settings?source=cell&graph=favicon-test`
    const route = await fetch(routeUrl)

    expect(route.status).toBe(200)
    expect(route.headers.get('content-type')).toContain('text/html')
    const html = await route.text()
    const icons = html.match(/<link\b[^>]*\brel=["'][^"']*\bicon\b[^"']*["'][^>]*>/gi) ?? []
    expect(icons).toHaveLength(1)
    const [iconTag] = icons
    if (!iconTag) throw new Error('settings route omitted its favicon declaration')
    expect(attribute(iconTag, 'type')).toBe('image/png')
    expect(attribute(iconTag, 'href')).toBe('/sophialabslogo.png')

    const icon = await fetch(new URL(attribute(iconTag, 'href')!, routeUrl))
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toContain('image/png')
    expect((await icon.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })
})
