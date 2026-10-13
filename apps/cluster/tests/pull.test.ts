import { Marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { renderBody } from '../build.mts'
import { catalogIndexMarkdown, inProgressSlugs, literal, pageFile, productMarkdown, productStatus, statusLabel, toItems, visible } from '../scripts/pull.mts'

const CC = 'https://sophia-labs.com/ns/cluster-catalog#'
const obj = (slug: string, p: Record<string, string>) => ({
  subject: `urn:mnemosyne:local:graph:cluster:projection:catalog:item:${slug}`,
  predicates: Object.fromEntries(Object.entries(p).map(([k, v]) => [CC + k, [`"${v}"`]])),
})
const FIELDS = ['name', 'family', 'plain', 'availability', 'leadTime', 'targetRelease', 'intent', 'partNumber']

describe('the catalogue pull', () => {
  it('reads only the public fields, never the internal ones', () => {
    const [item] = toItems([obj('x', { name: 'Thing', plain: 'Does it.', availability: 'InStock', spec: 'PN_SERVICE_TOKEN acts as anyone', statusNote: 'secret', risk: 'bad' })], FIELDS)
    expect(JSON.stringify(item)).not.toMatch(/PN_SERVICE_TOKEN|secret|bad/)
    expect(item).toMatchObject({ slug: 'x', name: 'Thing', plain: 'Does it.', availability: 'InStock' })
  })

  const items = () => visible(toItems([
    obj('a', { name: 'Alpha', family: 'Workspace', plain: 'A.', availability: 'InStock' }),
    obj('b', { name: 'Beta', family: 'Workspace', plain: 'B.', availability: 'Scheduled', targetRelease: '1.1', intent: 'Beta in 1.1.' }),
    obj('e', { name: 'Epsilon', family: 'Workspace', plain: 'E.', availability: 'Scheduled', targetRelease: '1.0.1' }),
    obj('c', { name: 'Gamma', family: 'Security & access', plain: 'C.', availability: 'Scheduled', targetRelease: '1.0.1' }),
    obj('d', { name: 'Delta', family: 'Agents', plain: 'D.', availability: 'NotOffered' }),
  ], FIELDS), ['c']).map((i) => ({ ...i, inProgress: i.slug === 'e' }))
  const desk = { slug: 'desk', document: 'product-desk', families: ['Workspace'] }
  const deskDoc = '# Sophia Desk\n\nThe workspace.\n\n- One\n- Two\n'

  it('leaves out excluded and not-offered items', () => {
    expect(items().map((i) => i.slug)).toEqual(['a', 'b', 'e'])
  })

  it('says each status in project-management terms', () => {
    const [a, b, e] = items()
    expect(statusLabel(a)).toBe('Shipped')
    expect(statusLabel(b)).toBe('Scheduled · 1.1')
    expect(statusLabel(e)).toBe('In progress · 1.0.1')
    expect(statusLabel({ slug: 'x', name: 'x', family: 'x', availability: 'MadeToOrder' })).toBe('Shipped · set up at install')
    expect(statusLabel({ slug: 'x', name: 'x', family: 'x', availability: 'Planned', targetRelease: 'later' })).toBe('Backlog')
  })

  it('gives each product one status line: shipped or not, and the next release', () => {
    expect(productStatus(desk, items())).toBe('Shipped · next release 1.0.1')
    expect(productStatus({ slug: 'chat', document: 'x', families: [], status: 'In progress' }, items())).toBe('In progress')
  })

  it('writes the shelf as one linked card per product', () => {
    const md = catalogIndexMarkdown('# Catalogue\n\nBy product.\n', [{ product: desk, doc: deskDoc }], items(), 'catalog')
    expect(md).toContain('## [Desk](/catalog/desk)\n\nThe workspace.\n\n- One\n- Two\n\n*Shipped · next release 1.0.1*')
    expect(md).not.toContain('|')
  })

  it('writes a product page: breadcrumb, splash, status, then its tables', () => {
    const md = productMarkdown(desk, deskDoc, items(), 'catalog')
    expect(md.startsWith('[Catalogue](/catalog) › Sophia Desk\n\n# Sophia Desk\n')).toBe(true) // the product page keeps the full name
    expect(md).toContain('| Alpha | A. | Shipped |')
    expect(md).toContain('| Epsilon | E. | In progress · 1.0.1 |')
    expect(md).toContain('| Beta | B. *Beta in 1.1.* | Scheduled · 1.1 |')
    expect(md.indexOf('Epsilon')).toBeLessThan(md.indexOf('Beta'))
    expect(md).not.toMatch(/In stock|Made to order|Planned/)
  })

  it('finds what in-progress beads deliver, in the cuentas namespace', () => {
    const CTA = 'http://mnemosyne.dev/cuentas#'
    const item = (s: string) => `<urn:mnemosyne:local:graph:cluster:projection:catalog:item:${s}>`
    const beads = [
      { predicates: { [CTA + 'status']: ['"in_progress"'], [CTA + 'delivers']: [item('signin-connectors')] } },
      { predicates: { [CTA + 'status']: ['"open"'], [CTA + 'delivers']: [item('audit-trail')] } },
    ]
    expect([...inProgressSlugs(beads)]).toEqual(['signin-connectors'])
  })

  it('unwraps RDF literals', () => {
    expect(literal('"2026-10-08T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>')).toBe('2026-10-08T00:00:00Z')
    expect(literal('"say \\"hi\\""')).toBe('say "hi"')
  })

  it('writes pages with their provenance in the front matter, not in the body', () => {
    const file = pageFile({ title: 'Home', feature: 'orb-v1' }, '# Home\n', 'public/cluster-home')
    expect(file).toBe('---\ntitle: Home\nfeature: orb-v1\nsource: public/cluster-home (pulled; edit it there, not here)\n---\n\n# Home\n')
  })
})

describe('the page body', () => {
  const marked = new Marked({ gfm: true, async: false })
  it('marks the call to action, opens a section per ## heading, and leaves drafts out', () => {
    const html = renderBody(marked, '# T\n\nLine.\n\n[See the catalogue](/catalog)\n\n## A letter\n\nDear reader.\n\n## Draft: Later\n\nNot yet.\n')
    expect(html).toContain('<p class="cta"><a href="/catalog">See the catalogue</a></p>')
    expect(html).toContain('<section class="part" id="a-letter">\n<h2>A letter</h2>\n<p>Dear reader.</p>\n</section>')
    expect(html).not.toContain('Not yet')
    expect(html).not.toContain('Draft')
  })
  it('leaves a link inside a sentence alone', () => {
    expect(renderBody(marked, 'See [here](/x) now.\n')).not.toContain('class="cta"')
  })
})
