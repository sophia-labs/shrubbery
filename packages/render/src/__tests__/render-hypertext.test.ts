/**
 * Hypertext (markdown) face — the DEFAULT face. REAL assertions:
 *   - the body is real markdown derived from the resource (catalog table, the
 *     component facts, the workspace summary) — not mock content,
 *   - it ALWAYS contains a "## Navigate" block with copy-pasteable curls,
 *   - the Navigate curls reference the resource's real links (self, items, the
 *     Accept-negotiated alternate faces),
 *   - the next-hop curls an agent would follow are present and correct.
 */

import { describe, it, expect } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderHypertext, type RenderCtx, type Resource } from '../index.js'

const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog', upPath: null }

const CATALOG: Resource = {
  kind: 'catalog',
  id: 'catalog',
  title: 'Shrubbery Catalog',
  summary: 'The third/fourth face of the one catalog.',
  components: [
    { tag: 'mn-top-bar', persistence: 'stamp', manifested: false, built: true, face: 'built-chrome', blurb: 'Chrome top bar.' },
    { tag: 'mn-graph-panel', persistence: 'stamp', manifested: true, built: true, face: 'manifest-panel', blurb: 'Controlled SVG graph panel.' },
  ],
}

describe('hypertext face — beautiful markdown + Navigate curl block', () => {
  it('renders the catalog as a real markdown table of the real components', () => {
    const out = renderHypertext(CATALOG, ctx)
    expect(out.contentType).toContain('text/markdown')
    expect(out.body).toContain('# Shrubbery Catalog')
    expect(out.body).toContain('The third/fourth face of the one catalog.')
    expect(out.body).toContain('**2 components.**')
    // The real component rows (not mock): tags, classes, blurbs.
    expect(out.body).toContain('`mn-top-bar`')
    expect(out.body).toContain('`mn-graph-panel`')
    expect(out.body).toContain('Controlled SVG graph panel.')
    // table header present
    expect(out.body).toMatch(/\| Component \| Class \| Manifested \| Built \| Notes \|/)
  })

  it('ALWAYS contains a Navigate block with copy-pasteable curls', () => {
    const out = renderHypertext(CATALOG, ctx)
    expect(out.body).toContain('## Navigate')
    // a fenced code block with curls
    const fence = out.body.split('## Navigate')[1]
    expect(fence).toContain('```')
    expect(fence).toContain('curl http://localhost:8787/catalog')
  })

  it('Navigate block links to each child component (the item face)', () => {
    const out = renderHypertext(CATALOG, ctx)
    expect(out.body).toContain('curl http://localhost:8787/catalog/mn-top-bar')
    expect(out.body).toContain('curl http://localhost:8787/catalog/mn-graph-panel')
  })

  it('Navigate block offers the Accept-negotiated alternate faces (turtle/json/html)', () => {
    const out = renderHypertext(CATALOG, ctx)
    expect(out.body).toContain('curl -H "Accept: text/turtle" http://localhost:8787/catalog')
    expect(out.body).toContain('curl -H "Accept: application/ld+json" http://localhost:8787/catalog')
    expect(out.body).toContain('curl -H "Accept: text/html" http://localhost:8787/catalog')
  })

  it('the catalog table cells link to the per-component page', () => {
    const out = renderHypertext(CATALOG, ctx)
    expect(out.body).toContain('[`mn-top-bar`](http://localhost:8787/catalog/mn-top-bar)')
  })

  it('renders a single component item page with real facts + up navigation', () => {
    const itemCtx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog/mn-graph-panel', upPath: '/catalog' }
    const out = renderHypertext(
      { kind: 'component', component: CATALOG.components[1] },
      itemCtx,
    )
    expect(out.body).toContain('# `mn-graph-panel`')
    expect(out.body).toContain('stamp (A)')
    expect(out.body).toContain('## Facts')
    // up/collection navigation back to the catalog
    expect(out.body).toContain('curl http://localhost:8787/catalog')
  })

  it('renders the GARDEN_DEFAULT workspace as a real summary (regions/panels/dimensions)', () => {
    const wsCtx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/workspace', upPath: null }
    const out = renderHypertext({ kind: 'workspace', config: GARDEN_DEFAULT }, wsCtx)
    expect(out.body).toContain('# Workspace — Garden Default Workspace')
    expect(out.body).toContain('## Regions')
    expect(out.body).toContain('`region-top-bar`')
    expect(out.body).toContain('`mn-top-bar`')
    expect(out.body).toContain('## Panels')
    expect(out.body).toContain('`panel-editor`')
    expect(out.body).toContain('## Dimensions')
    expect(out.body).toContain('**Skin**')
    expect(out.body).toContain('## Navigate')
  })
})
