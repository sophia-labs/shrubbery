/**
 * renderResource dispatcher — target is a PARAMETER; the resource model is
 * target-agnostic. Asserts each target yields the right contentType + body, and
 * that `dom` is correctly delegated out to the runtime (errors here, since this
 * pure package is Lit-free).
 */

import { describe, it, expect } from 'vitest'
import {
  renderResource,
  renderTextSync,
  CONTENT_TYPE,
  type RenderCtx,
  type Resource,
} from '../index.js'

const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog', upPath: null }
const CATALOG: Resource = {
  kind: 'catalog',
  id: 'catalog',
  title: 'C',
  summary: 'S',
  components: [
    { tag: 'mn-top-bar', persistence: 'stamp', manifested: false, built: true, face: 'built-chrome', blurb: 'b' },
  ],
}

describe('renderResource — target as a parameter', () => {
  it('hypertext → markdown', async () => {
    const out = await renderResource(CATALOG, 'hypertext', ctx)
    expect(out.contentType).toBe(CONTENT_TYPE.hypertext)
    expect(out.body).toContain('# C')
  })

  it('turtle → text/turtle', async () => {
    const out = await renderResource(CATALOG, 'turtle', ctx)
    expect(out.contentType).toBe(CONTENT_TYPE.turtle)
    expect(out.body).toContain('@prefix')
    expect(out.body).toContain('a cat:Catalog')
  })

  it('json → application/ld+json', async () => {
    const out = await renderResource(CATALOG, 'json', ctx)
    expect(out.contentType).toBe(CONTENT_TYPE.json)
    expect(JSON.parse(out.body)).toBeTruthy()
  })

  it("dom is delegated to the runtime — errors in the pure package", async () => {
    await expect(renderResource(CATALOG, 'dom', ctx)).rejects.toThrow(/runtime/i)
  })

  it('renderTextSync renders the two synchronous faces without an async boundary', () => {
    expect(renderTextSync(CATALOG, 'turtle', ctx).contentType).toBe(CONTENT_TYPE.turtle)
    expect(renderTextSync(CATALOG, 'hypertext', ctx).contentType).toBe(CONTENT_TYPE.hypertext)
  })

  it('the same resource model feeds all faces (target-agnostic)', async () => {
    // One Resource object, three faces — no per-face data shaping required.
    const md = await renderResource(CATALOG, 'hypertext', ctx)
    const ttl = await renderResource(CATALOG, 'turtle', ctx)
    const json = await renderResource(CATALOG, 'json', ctx)
    // Each face references the SAME component tag from the one model.
    expect(md.body).toContain('mn-top-bar')
    expect(ttl.body).toContain('mn-top-bar')
    expect(json.body).toContain('mn-top-bar')
  })
})
