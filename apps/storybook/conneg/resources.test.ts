/**
 * conneg resources — the resource set is derived from the REAL catalog (which is
 * derived from the MANIFEST + built chrome), NOT a mock. These pin that:
 *   - the catalog resource has one component per CATALOG_ENTRIES row,
 *   - each component's manifested/built/persistence come straight from the model,
 *   - the route table covers the catalog, every item, and the workspace,
 *   - the built signal is honest (chrome + lifted controlled panels built) —
 *     the same truth the catalog-coherence test pins in the browser.
 */

import { describe, it, expect } from 'vitest'
import { CATALOG_ENTRIES } from '../catalog/catalog-model.js'
import { catalogResource, componentResource, workspaceResource, routeTable } from './resources.js'
import { vocabCatalogResource, vocabPackResource, snapshotVocabSummaries } from './emporium.js'

describe('conneg resources — derived from the real catalog (no mock)', () => {
  it('the catalog resource has exactly one component per catalog entry', () => {
    const cat = catalogResource()
    expect(cat.components.map((c) => c.tag).sort()).toEqual(CATALOG_ENTRIES.map((e) => e.tag).sort())
  })

  it('each component carries the real manifest persistence + manifested flag', () => {
    const cat = catalogResource()
    for (const entry of CATALOG_ENTRIES) {
      const comp = cat.components.find((c) => c.tag === entry.tag)!
      expect(comp.persistence).toBe(entry.persistence)
      expect(comp.manifested).toBe(entry.manifested)
      expect(comp.blurb).toBe(entry.blurb)
    }
  })

  it('the built signal is honest: chrome and controlled graph panel built', () => {
    const cat = catalogResource()
    const byTag = Object.fromEntries(cat.components.map((c) => [c.tag, c]))
    expect(byTag['mn-top-bar'].built).toBe(true)
    expect(byTag['mn-bottom-bar'].built).toBe(true)
    expect(byTag['mn-document-editor'].built).toBe(false)
    expect(byTag['mn-graph-panel'].built).toBe(true)
  })

  it('componentResource resolves a known tag and rejects an unknown one', () => {
    expect(componentResource('mn-top-bar')?.component.tag).toBe('mn-top-bar')
    expect(componentResource('does-not-exist')).toBeNull()
  })

  it('the workspace resource is GARDEN_DEFAULT', () => {
    expect(workspaceResource().config.id).toBe('GardenDefault')
  })

  it('the built signal is honest: the general primitives are built', () => {
    const byTag = Object.fromEntries(catalogResource().components.map((c) => [c.tag, c]))
    for (const tag of [
      'mn-chip',
      'mn-badge',
      'mn-sparkline',
      'mn-ribbon',
      'mn-card',
      'mn-input',
      'mn-textarea',
      'mn-search-input',
      'mn-tooltip',
      'mn-avatar',
      'mn-panel-header',
      'mn-dropdown-button',
      'mn-inline-edit',
      'mn-toast',
      'mn-modal',
      'mn-dialog',
    ]) {
      expect(byTag[tag], `${tag} present`).toBeDefined()
      expect(byTag[tag].built, `${tag} built`).toBe(true)
      expect(byTag[tag].face).toBe('general-primitive')
    }
  })

  it('the route table covers /catalog, /workspace, /emporium, and every item', () => {
    const routes = routeTable()
    expect(routes['/catalog']).toBeDefined()
    expect(routes['/workspace']).toBeDefined()
    expect(routes['/emporium']).toBeDefined()
    for (const e of CATALOG_ENTRIES) {
      expect(routes[`/catalog/${e.tag}`], `route for ${e.tag}`).toBeDefined()
      expect(routes[`/catalog/${e.tag}`].ctx('http://x').upPath).toBe('/catalog')
    }
    for (const v of snapshotVocabSummaries()) {
      expect(routes[`/emporium/${v.name}`], `route for vocab ${v.name}`).toBeDefined()
      expect(routes[`/emporium/${v.name}`].ctx('http://x').upPath).toBe('/emporium')
    }
  })
})

describe('conneg EMPORIUM vocab catalogue — from the captured-real registry (no mock)', () => {
  it('the vocab catalogue lists the real vocabularies (workflow + sophia-memory-core)', () => {
    const cat = vocabCatalogResource()
    expect(cat.kind).toBe('vocab-catalog')
    const names = cat.vocabs.map((v) => v.name)
    expect(names).toContain('workflow')
    expect(names).toContain('sophia-memory-core')
    // real content-hash shas (64 hex), not invented values.
    for (const v of cat.vocabs) {
      expect(v.sha).toMatch(/^[0-9a-f]{64}$/)
      expect(v.namespace).toMatch(/^https?:\/\//)
    }
  })

  it('a vocab pack resolves to its golden contract (classes + predicates)', () => {
    const r = vocabPackResource('workflow')
    expect(r).not.toBeNull()
    expect(r!.pack.name).toBe('workflow')
    expect(r!.pack.namespace).toBe('http://mnemosyne.dev/workflow#')
    expect(r!.pack.classes.length).toBeGreaterThan(0)
    expect(r!.pack.classes.map((c) => c.name)).toContain('AgentNode')
    const withPreds = r!.pack.classes.find((c) => c.predicates.length > 0)
    expect(withPreds).toBeDefined()
  })

  it('an unknown vocab resolves to null (no faked pack)', () => {
    expect(vocabPackResource('does-not-exist')).toBeNull()
  })
})
