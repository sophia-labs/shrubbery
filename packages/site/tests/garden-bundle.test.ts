import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  GARDEN_DEFAULT,
  NS,
  parseNT,
  parseTriplesToConfig,
  serializeConfigToTriples,
  validateConfig,
} from '@shrubbery/nucleus'
import { VISUAL_IDENTITY_SKINS } from '@shrubbery/tokens'
import { describe, expect, it } from 'vitest'
import {
  featureFor,
  GARDEN_LAYOUT_SEED_SHA256,
  GARDEN_SITE_BUNDLE,
  gardenBindingIsAccountedFor,
  RDF_TYPE,
  routeFor,
  SITE_NS,
  siteBundleForInterpreter,
  siteDefinitionIri,
  siteInterpreterCatalog,
  siteProjectionGraphIri,
  siteProjectionNt,
  siteProjectionTriples,
  sitePublicationRouteTriples,
} from '../src/index.js'

const require_ = createRequire(import.meta.url)
const SEED_PATH = require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt')
const SEED_NT = readFileSync(SEED_PATH, 'utf8')

function objects(subject: string, predicate: string, triples = siteProjectionTriples(GARDEN_SITE_BUNDLE, 'garden-bundle-test')) {
  return triples.filter((triple) => triple.s === subject && triple.p === predicate).map((triple) => triple.o)
}

describe('Garden SiteBundle — semantic product bundle', () => {
  it('is the canonical Garden workspace, not a forked shell config', () => {
    expect(GARDEN_SITE_BUNDLE.layout).toBe(GARDEN_DEFAULT)
    expect(validateConfig(GARDEN_SITE_BUNDLE.layout)).toEqual({ ok: true })
    expect(parseTriplesToConfig(serializeConfigToTriples(GARDEN_SITE_BUNDLE.layout))).toEqual(GARDEN_DEFAULT)
    expect(parseTriplesToConfig(parseNT(SEED_NT))).toEqual(GARDEN_DEFAULT)
  })

  it('pins the generated seed provenance carried by the artifact header', () => {
    const declared = /sha256\(body\): ([a-f0-9]{64})/.exec(SEED_NT)?.[1]
    expect(declared).toBe(GARDEN_LAYOUT_SEED_SHA256)
    expect(GARDEN_SITE_BUNDLE.layoutSeedSha256).toBe(declared)
  })

  it('declares total routes over existing surfaces and a stable root fallback', () => {
    const surfaceIds = new Set(GARDEN_SITE_BUNDLE.surfaces.map((surface) => surface.id))
    expect(GARDEN_SITE_BUNDLE.routes.every((route) => surfaceIds.has(route.surface))).toBe(true)
    expect(routeFor(GARDEN_SITE_BUNDLE, '/workspace')).toMatchObject({ view: 'workspace', app: 'garden' })
    expect(routeFor(GARDEN_SITE_BUNDLE, '/not-declared')).toMatchObject({ path: '/', view: 'home' })
  })

  it('declares all four Planter faces once', () => {
    expect(GARDEN_SITE_BUNDLE.faces.map((face) => face.target)).toEqual([
      'markdown',
      'turtle',
      'jsonld',
      'html',
    ])
    expect(new Set(GARDEN_SITE_BUNDLE.faces.map((face) => face.suffix)).size).toBe(4)
  })

  it('uses the shared visual-identity axis and Garden panel snap posture', () => {
    expect(GARDEN_SITE_BUNDLE.appearance.skins).toEqual(VISUAL_IDENTITY_SKINS)
    expect(GARDEN_SITE_BUNDLE.layout.dimensions['dim-skin'].values.map((value) => value.literalValue)).toEqual(
      GARDEN_SITE_BUNDLE.appearance.skins,
    )
    expect(GARDEN_SITE_BUNDLE.panels).toMatchObject({
      left: { min: 180, default: 280, max: 500, snap: '180px 280px 500px' },
      right: { min: 240, default: 420, max: 500, snap: '240px 420px 500px' },
      snapThreshold: 24,
    })
  })

  it('accounts for every configured tag and confesses service-bound lifts', () => {
    const expected = new Set<string>([GARDEN_DEFAULT.renderedByComponent])
    for (const region of Object.values(GARDEN_DEFAULT.regions)) {
      if (region.renderedByComponent) expected.add(region.renderedByComponent)
    }
    for (const panel of Object.values(GARDEN_DEFAULT.panels)) expected.add(panel.renderedByComponent)
    expect(new Set(GARDEN_SITE_BUNDLE.components.map((binding) => binding.tag))).toEqual(expected)
    expect(GARDEN_SITE_BUNDLE.components.every(gardenBindingIsAccountedFor)).toBe(true)
    expect(GARDEN_SITE_BUNDLE.components.find((binding) => binding.tag === 'mn-document-editor')).toMatchObject({
      hostStatus: 'deferred',
      persistence: 'persistent-relocatable',
    })
  })

  it('states the read/host boundary and registered projection posture', () => {
    expect(featureFor(GARDEN_SITE_BUNDLE, 'layout-live-read')?.state).toBe('supported')
    expect(featureFor(GARDEN_SITE_BUNDLE, 'appearance')?.state).toBe('supported')
    for (const id of ['documents-editor', 'daily-notes', 'settings']) {
      expect(featureFor(GARDEN_SITE_BUNDLE, id), id).toMatchObject({ state: 'deferred' })
    }
    expect(featureFor(GARDEN_SITE_BUNDLE, 'site-write')).toMatchObject({ state: 'supported' })
    expect(featureFor(GARDEN_SITE_BUNDLE, 'ea3-publication')).toMatchObject({ state: 'supported' })
    expect(GARDEN_SITE_BUNDLE.publication).toMatchObject({
      state: 'registered',
      writeTarget: 'projection:site',
    })
  })

  it('selects only an exact registered interpreter tuple', () => {
    expect(siteInterpreterCatalog()).toEqual([{
      packageName: '@shrubbery/planter',
      version: '0.0.0',
      bundleId: 'garden',
    }])
    expect(siteBundleForInterpreter('@shrubbery/planter', '0.0.0')).toBe(GARDEN_SITE_BUNDLE)
    expect(() => siteBundleForInterpreter('@shrubbery/planter', 'latest')).toThrow(/unsupported/)
    expect(() => siteBundleForInterpreter('@attacker/renderer', '0.0.0')).toThrow(/unsupported/)
  })
})

describe('Garden SiteBundle — deterministic shrubbery-site RDF projection', () => {
  const graphId = 'garden-bundle-test'
  const graphRoot = `urn:mnemosyne:local:graph:${graphId}`
  const triples = siteProjectionTriples(GARDEN_SITE_BUNDLE, graphId, {
    endpoint: 'http://127.0.0.1:7090/mcp',
    graphId,
    graphIri: `${graphRoot}:ux:config`,
    authMode: 'dev',
    liveness: 'poll',
    observer: 'garden-bundle-test',
    readAt: Date.UTC(2026, 6, 12, 12),
    tripleCount: parseNT(SEED_NT).length,
  })

  it('targets Garden\'s reserved site projection graph', () => {
    expect(siteProjectionGraphIri(graphId)).toBe(`${graphRoot}:projection:site`)
    expect(triples.length).toBeGreaterThan(0)
    expect(parseNT(siteProjectionNt(GARDEN_SITE_BUNDLE, graphId)).length).toBeGreaterThan(0)
  })

  it('uses projection subjects and references real serialized layout nodes', () => {
    expect(triples.every((triple) => triple.s.startsWith(`${graphRoot}:projection:site:`))).toBe(true)
    const serializedLayoutSubjects = new Set(parseNT(SEED_NT).map((triple) => triple.s))
    const layoutPredicates = new Set([
      `${SITE_NS}workspace`, `${SITE_NS}entryRegion`, `${SITE_NS}presentsPanel`,
      `${SITE_NS}appValue`, `${SITE_NS}appRootEntry`, `${SITE_NS}themeDimension`,
      `${SITE_NS}skinDimension`, `${SITE_NS}defaultThemeValue`, `${SITE_NS}defaultSkinValue`,
    ])
    for (const triple of triples.filter((candidate) => layoutPredicates.has(candidate.p))) {
      expect(triple.o.type).toBe('iri')
      if (triple.o.type === 'iri') {
        expect(triple.o.value.startsWith(NS.sux)).toBe(true)
        expect(serializedLayoutSubjects.has(triple.o.value), triple.o.value).toBe(true)
      }
    }
  })

  it('emits the required predicates for every bundle-authored vocabulary class', () => {
    const required: Record<string, readonly string[]> = {
      SiteDefinition: ['bundleId', 'bundleVersion', 'interpreterPackage', 'interpreterVersion', 'layoutSeedSha256'],
      Surface: ['label', 'workspace'],
      Route: ['path', 'appValue'],
      Theme: ['themeDimension'],
      ComponentBinding: ['componentTag'],
      PackProvenance: ['packName', 'packVersion', 'contentSha'],
      ContentSource: ['endpoint', 'graphId', 'authMode', 'liveness'],
    }
    for (const [className, predicates] of Object.entries(required)) {
      const subjects = triples
        .filter((triple) => triple.p === RDF_TYPE && triple.o.type === 'iri' && triple.o.value === `${SITE_NS}${className}`)
        .map((triple) => triple.s)
      expect(subjects.length, className).toBeGreaterThan(0)
      for (const subject of subjects) {
        for (const predicate of predicates) {
          expect(objects(subject, `${SITE_NS}${predicate}`, triples).length, `${className}.${predicate}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('never serializes a credential and refuses a relative endpoint IRI', () => {
    expect(siteProjectionNt(GARDEN_SITE_BUNDLE, graphId, {
      endpoint: 'https://api.example.test/g/garden',
      ownerPrincipal: 'agent:planter',
      graphId,
      authMode: 'cognito',
      liveness: 'poll',
    })).not.toMatch(/token|secret|bearer/i)
    expect(siteProjectionNt(GARDEN_SITE_BUNDLE, graphId, {
      endpoint: 'https://api.example.test/o/agent%3Aplanter/g/garden',
      ownerPrincipal: 'agent:planter',
      graphId,
      authMode: 'service',
      liveness: 'poll',
    })).toContain('"agent:planter"')
    expect(() => siteProjectionTriples(GARDEN_SITE_BUNDLE, graphId, {
      endpoint: '/cell',
      graphId,
      authMode: 'none',
      liveness: 'poll',
    })).toThrow(/absolute, redacted IRI/)
    expect(() => siteProjectionTriples(GARDEN_SITE_BUNDLE, graphId, {
      endpoint: 'https://api.example.test',
      graphId: 'same-slug-wrong-target',
      authMode: 'cognito',
      liveness: 'poll',
    })).toThrow(/must equal the projection graph target/)
  })
})

describe('Garden SiteBundle — exact owner-scoped publication routes', () => {
  it('derives the interpreter and site-definition target from the reviewed bundle', () => {
    const triples = sitePublicationRouteTriples('platform-authority', GARDEN_SITE_BUNDLE, {
      id: 'shrubbery-preview',
      publicName: 'shrubbery-preview',
      pathPrefix: '/',
      ownerPrincipal: 'user:specialist-sub',
      graphId: 'shrubbery-domain',
      state: 'unlisted',
    })
    const subject = 'urn:mnemosyne:local:graph:platform-authority:projection:site:publication-route:shrubbery-preview'
    expect(objects(subject, `${SITE_NS}ownerPrincipal`, triples)).toEqual([
      { type: 'literal', value: 'user:specialist-sub' },
    ])
    expect(objects(subject, `${SITE_NS}siteDefinition`, triples)).toEqual([
      { type: 'iri', value: siteDefinitionIri('shrubbery-domain', GARDEN_SITE_BUNDLE.id) },
    ])
    expect(objects(subject, `${SITE_NS}interpreterPackage`, triples)).toEqual([
      { type: 'literal', value: '@shrubbery/planter' },
    ])
  })

  it('requires human testimony for publish and refuses malformed targets', () => {
    expect(() => sitePublicationRouteTriples('platform-authority', GARDEN_SITE_BUNDLE, {
      id: 'public', publicName: 'shrubbery', pathPrefix: '/',
      ownerPrincipal: 'user:specialist-sub', graphId: 'shrubbery-domain', state: 'published',
    })).toThrow(/requires approvedBy/)
    expect(() => sitePublicationRouteTriples('platform-authority', GARDEN_SITE_BUNDLE, {
      id: 'wrong-owner', publicName: 'shrubbery', pathPrefix: '/',
      ownerPrincipal: 'specialist-sub', graphId: 'shrubbery-domain', state: 'unlisted',
    })).toThrow(/typed owner/)
    expect(() => sitePublicationRouteTriples('platform-authority', GARDEN_SITE_BUNDLE, {
      id: 'wrong-graph', publicName: 'shrubbery', pathPrefix: '/',
      ownerPrincipal: 'user:specialist-sub', graphId: 'Shrubbery Domain', state: 'unlisted',
    })).toThrow(/graphId/)
    expect(() => sitePublicationRouteTriples('platform-authority', GARDEN_SITE_BUNDLE, {
      id: 'wrong-state', publicName: 'shrubbery', pathPrefix: '/',
      ownerPrincipal: 'user:specialist-sub', graphId: 'shrubbery-domain', state: 'draft' as never,
    })).toThrow(/closed publication state/)
  })

  it('accepts an explicitly human-approved published route', () => {
    const triples = sitePublicationRouteTriples('platform-authority', GARDEN_SITE_BUNDLE, {
      id: 'public', publicName: 'shrubbery.sophia-labs.com', pathPrefix: '/',
      ownerPrincipal: 'user:specialist-sub', graphId: 'shrubbery-domain', state: 'published',
      approvedBy: 'user:vera', approvedAt: '2026-08-03T12:00:00Z',
    })
    expect(triples.some((triple) =>
      triple.p === `${SITE_NS}publicationState`
      && triple.o.type === 'literal'
      && triple.o.value === 'published',
    )).toBe(true)
  })
})
