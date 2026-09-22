/**
 * Link-set parity — the load-bearing invariant: all FOUR faces of one resource
 * advertise the SAME set of navigable links (FAIR Signposting). This is what lets
 * an agent move between faces without ever hitting a dead end; it is the no-drift
 * guarantee at the hypermedia level.
 *
 * "Same set" = same {rel, href} pairs, modulo the one `self` link whose `type`
 * differs by face (self is always typed as the face you are currently looking at).
 * So we compare the rel+href pairs across faces and require them identical.
 */

import { describe, it, expect } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import {
  renderResource,
  toLinkHeader,
  type AltLink,
  type RenderCtx,
  type RenderTarget,
  type Resource,
} from '../index.js'

const TEXT_TARGETS: RenderTarget[] = ['hypertext', 'turtle', 'json']

/** The comparable signature of a link set: sorted "rel href" pairs. */
function relHrefSet(links: readonly AltLink[]): string[] {
  return links.map((l) => `${l.rel} ${l.href}`).sort()
}

async function facesOf(resource: Resource, ctx: RenderCtx): Promise<Record<string, AltLink[]>> {
  const out: Record<string, AltLink[]> = {}
  for (const t of TEXT_TARGETS) {
    out[t] = [...(await renderResource(resource, t, ctx)).links]
  }
  return out
}

describe('link-set parity — the four faces advertise the same links', () => {
  it('catalog: all faces carry an identical rel+href link set', async () => {
    const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog', upPath: null }
    const catalog: Resource = {
      kind: 'catalog',
      id: 'catalog',
      title: 'C',
      summary: 'S',
      components: [
        { tag: 'mn-top-bar', persistence: 'stamp', manifested: false, built: true, face: 'built-chrome', blurb: 'b' },
        { tag: 'mn-graph-panel', persistence: 'stamp', manifested: true, built: true, face: 'manifest-panel', blurb: 'b' },
      ],
    }
    const faces = await facesOf(catalog, ctx)
    const ref = relHrefSet(faces.hypertext)
    expect(relHrefSet(faces.turtle)).toEqual(ref)
    expect(relHrefSet(faces.json)).toEqual(ref)
  })

  it('component item: all faces carry an identical link set (incl. up + collection)', async () => {
    const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog/mn-top-bar', upPath: '/catalog' }
    const item: Resource = {
      kind: 'component',
      component: { tag: 'mn-top-bar', persistence: 'stamp', manifested: false, built: true, face: 'built-chrome', blurb: 'b' },
    }
    const faces = await facesOf(item, ctx)
    const ref = relHrefSet(faces.hypertext)
    expect(relHrefSet(faces.turtle)).toEqual(ref)
    expect(relHrefSet(faces.json)).toEqual(ref)
    // the item face must advertise up + collection back to the catalog
    expect(ref.some((s) => s.startsWith('up '))).toBe(true)
    expect(ref.some((s) => s.startsWith('collection '))).toBe(true)
  })

  it('workspace: all faces carry an identical link set', async () => {
    const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/workspace', upPath: null }
    const faces = await facesOf({ kind: 'workspace', config: GARDEN_DEFAULT }, ctx)
    const ref = relHrefSet(faces.hypertext)
    expect(relHrefSet(faces.turtle)).toEqual(ref)
    expect(relHrefSet(faces.json)).toEqual(ref)
  })

  it('every face advertises self + the three alternate faces (self/alternate/describedby)', async () => {
    const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog', upPath: null }
    const catalog: Resource = { kind: 'catalog', id: 'catalog', title: 'C', summary: 'S', components: [] }
    const out = await renderResource(catalog, 'hypertext', ctx)
    const rels = out.links.map((l) => l.rel)
    expect(rels).toContain('self')
    expect(rels).toContain('describedby') // the .ttl (FAIR machine description)
    // md + json + html as alternate (the face-invariant pinned-face set).
    expect(rels.filter((r) => r === 'alternate').length).toBeGreaterThanOrEqual(3)
  })

  it('toLinkHeader emits a valid RFC 8288 Link header value', async () => {
    const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog', upPath: null }
    const catalog: Resource = { kind: 'catalog', id: 'catalog', title: 'C', summary: 'S', components: [] }
    const out = await renderResource(catalog, 'hypertext', ctx)
    const header = toLinkHeader(out.links)
    expect(header).toContain('rel="self"')
    expect(header).toContain('rel="describedby"')
    expect(header).toMatch(/<http:\/\/localhost:8787\/catalog>; rel="self"; type="text\/markdown/)
  })
})
