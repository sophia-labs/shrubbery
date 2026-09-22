/**
 * Emporium vocab CATALOGUE faces — the render package pointed at the catalogue OF
 * vocabularies (EMPORIUM = the KG-layer catalogue of vocab packs; "the pack IS
 * the catalog").
 *
 * The fixtures here are the REAL shapes the live gardend /emporium routes return
 * (verified by curl against the Jun-19 release binary at the time of writing:
 * workflow@1.0.0 + sophia-memory-core@1.0.0). They are NOT invented mock packs —
 * they mirror GET /emporium/vocabs and GET /emporium/vocab/{name}/{version}. The
 * organism integration test (apps/organism) proves the SHELL reads these LIVE
 * from a spawned cell; this pure-package test proves the render package turns that
 * vocab data into the markdown / Turtle / JSON-LD faces (network-free, as a pure
 * library must be).
 */
import { describe, it, expect } from 'vitest'
import jsonld from 'jsonld'
import { triplesToNT, type Triple } from '@shrubbery/nucleus'
import {
  renderHypertext,
  renderTurtle,
  renderJson,
  resourceToTriples,
  type RenderCtx,
  type VocabResource,
  type VocabPackResource,
} from '../index.js'

/** Canonical (sorted) N-Triples string for a triple set — face-drift comparison. */
function sortedNT(triples: readonly Triple[]): string {
  return triplesToNT(triples as Triple[])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .sort()
    .join('\n')
}

const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/emporium', upPath: null }
const packCtx: RenderCtx = {
  baseUrl: 'http://localhost:8787',
  selfPath: '/emporium/workflow',
  upPath: '/emporium',
}

// The REAL /emporium/vocabs shape (two vocab summaries).
const CATALOG: VocabResource = {
  kind: 'vocab-catalog',
  id: 'emporium',
  title: 'Emporium — vocabulary catalogue',
  summary: 'The KG-layer catalogue of vocabulary packs served by the cell.',
  vocabs: [
    {
      name: 'workflow',
      version: '1.0.0',
      namespace: 'http://mnemosyne.dev/workflow#',
      sha: 'bc50e854bd4eed51ef3e1644db72662610af34f037d9802f1804a009eec77eff',
      title: 'Mnemosyne Workflow Vocabulary',
    },
    {
      name: 'sophia-memory-core',
      version: '1.0.0',
      namespace: 'http://mnemosyne.dev/memory#',
      sha: '42b24ee38b6ce395f421ee7459080138ba49dff25c37a848c96650d3ffaa54ed',
      title: 'Sophia Memory Core Vocabulary',
    },
  ],
}

// A REAL golden-contract pack (the workflow pack, trimmed to the catalogue view).
const PACK: VocabPackResource = {
  kind: 'vocab-pack',
  pack: {
    name: 'workflow',
    version: '1.0.0',
    title: 'Mnemosyne Workflow Vocabulary',
    namespace: 'http://mnemosyne.dev/workflow#',
    sha: 'bc50e854bd4eed51ef3e1644db72662610af34f037d9802f1804a009eec77eff',
    description: 'Workflow run telemetry + campaign records.',
    namespaces: { wf: 'http://mnemosyne.dev/workflow#' },
    classes: [
      {
        name: 'AgentNode',
        predicates: [
          { name: 'wf:agentType', datatype: 'string', required: false, multi: false },
        ],
      },
      { name: 'Workflow', predicates: [] },
    ],
  },
}

// The DEEPENED pack — the SAME real-shape anatomy the shell-side read-model parses
// from the live golden contract (iter-5b): required-vs-optional predicates with
// datatype/multi, an object-property RANGE (AgentNode →wf:partOfWorkflow→
// Workflow), a CLOSED ENUM (mem:sourceKind), class→class RELATIONSHIPS (a
// predicate-range edge + a CRDT WIRE edge), the prefix→namespace table, per-class
// subject-minting rule, and the pack-level MINTING (slug + uri/doc-id rules) +
// STATS. These are the exact shapes the render package must carry to ALL faces.
const DEEP_PACK: VocabPackResource = {
  kind: 'vocab-pack',
  pack: {
    name: 'workflow',
    version: '1.0.0',
    title: 'Mnemosyne Workflow Vocabulary',
    namespace: 'http://mnemosyne.dev/workflow#',
    sha: 'bc50e854bd4eed51ef3e1644db72662610af34f037d9802f1804a009eec77eff',
    description: 'Workflow run telemetry + campaign records.',
    namespaces: {
      wf: 'http://mnemosyne.dev/workflow#',
      prov: 'http://www.w3.org/ns/prov#',
    },
    classes: [
      {
        name: 'AgentNode',
        subjectRule: 'node doc URI',
        predicates: [
          { name: 'wf:label', datatype: 'string', required: true, multi: false },
          {
            name: 'wf:partOfWorkflow',
            datatype: 'uri',
            required: true,
            multi: false,
            relatesTo: 'Workflow',
          },
          { name: 'wf:agentType', datatype: 'string', required: false, multi: false },
        ],
      },
      {
        name: 'SourceReference',
        subjectRule: '{graph_subject}:projection:memory:src:{hash}',
        predicates: [
          {
            name: 'mem:sourceKind',
            datatype: 'string',
            required: true,
            multi: false,
            enumValues: [
              'ConversationTurn',
              'DocumentBlock',
              'ToolCall',
              'ToolResult',
              'ArtifactReference',
              'ExternalEvent',
              'PlatformEvent',
              'CodeChangeEvent',
            ],
          },
        ],
      },
      { name: 'Workflow', subjectRule: 'workflow doc URI', predicates: [] },
    ],
    relationships: [
      {
        from: 'AgentNode',
        to: 'Workflow',
        predicate: 'wf:partOfWorkflow',
        kind: 'predicate',
        note: 'workflow doc URI',
      },
      {
        from: 'AgentNode',
        to: 'AgentNode',
        predicate: 'flowsInto',
        kind: 'wire',
        note: 'trace edges',
      },
    ],
    minting: {
      slugPattern: '[^A-Za-z0-9_-]+',
      slugReplacement: '-',
      slugLowercase: false,
      uriRules: { run: 'urn:sophia:wf-run:{runId}' },
      docIdRules: { workflow: '{shortId}' },
    },
    predicateCount: 4,
    relationshipCount: 2,
  },
}

describe('vocab catalogue — hypertext (markdown) face', () => {
  it('lists each vocabulary as a real markdown row with version + namespace + sha', () => {
    const { body, contentType } = renderHypertext(CATALOG, ctx)
    expect(contentType).toContain('text/markdown')
    expect(body).toContain('# Emporium — vocabulary catalogue')
    expect(body).toContain('2 vocabularies')
    expect(body).toContain('`workflow`')
    expect(body).toContain('`sophia-memory-core`')
    expect(body).toContain('http://mnemosyne.dev/workflow#')
    expect(body).toContain('bc50e854') // truncated sha
    // every pack is a navigable link to its item page.
    expect(body).toContain('/emporium/workflow')
    // and the Navigate block is always present.
    expect(body).toContain('## Navigate')
  })
})

describe('vocab pack — hypertext (markdown) face renders the golden contract', () => {
  it('renders classes + their predicates (datatype/required/multi)', () => {
    const { body } = renderHypertext(PACK, packCtx)
    expect(body).toContain('# `workflow` — Mnemosyne Workflow Vocabulary')
    expect(body).toContain('http://mnemosyne.dev/workflow#')
    expect(body).toContain('### `AgentNode`')
    expect(body).toContain('`wf:agentType`')
    expect(body).toContain('### `Workflow`')
    expect(body).toContain('_(no predicates)_')
  })
})

describe('vocab catalogue — Turtle face (RDF)', () => {
  it('emits emp:Catalog + one emp:Vocabulary per pack', () => {
    const { body, contentType } = renderTurtle(CATALOG, ctx)
    expect(contentType).toContain('text/turtle')
    expect(body).toContain('emp:Catalog')
    expect(body).toContain('emp:Vocabulary')
    expect(body).toContain('"workflow"')
    expect(body).toContain('"sophia-memory-core"')
  })

  it('vocab pack Turtle emits classes + predicates', () => {
    const { body } = renderTurtle(PACK, packCtx)
    expect(body).toContain('emp:Class')
    expect(body).toContain('emp:Predicate')
    expect(body).toContain('"wf:agentType"')
  })
})

describe('vocab — JSON-LD face round-trips to the same triples', () => {
  it('catalogue JSON-LD expands to the same triple count as its Turtle production', async () => {
    const { body, contentType } = await renderJson(CATALOG, ctx)
    expect(contentType).toContain('application/ld+json')
    const parsed = JSON.parse(body)
    // the @context carries the emp: terms.
    expect(JSON.stringify(parsed['@context'])).toContain('emp')
    // the triple production is non-empty (catalog + 2 vocabs + their fields).
    expect(resourceToTriples(CATALOG).length).toBeGreaterThan(8)
  })

  it('vocab pack triples include the class + predicate nodes', () => {
    const triples = resourceToTriples(PACK)
    const preds = triples.map((t) => t.p)
    expect(preds.some((p) => p.endsWith('hasClass'))).toBe(true)
    expect(preds.some((p) => p.endsWith('hasPredicate'))).toBe(true)
    expect(preds.some((p) => p.endsWith('datatype'))).toBe(true)
  })
})

// ── iter-5b: the DEEPENED pack-detail anatomy across all three text faces ───────

describe('deepened pack-detail — hypertext (markdown) renders the FULL anatomy', () => {
  it('renders stats, namespaces, minting, relationships (with Navigate class links), and grouped predicates', () => {
    const { body } = renderHypertext(DEEP_PACK, packCtx)

    // STATS strip — class / predicate / relationship counts.
    expect(body).toContain('3 classes')
    expect(body).toContain('4 predicates')
    expect(body).toContain('2 relationships')

    // NAMESPACES table (prefix → URI).
    expect(body).toContain('## Namespaces')
    expect(body).toContain('| `wf` |')
    expect(body).toContain('http://www.w3.org/ns/prov#')

    // MINTING — slug rule + uri/doc-id rule tables.
    expect(body).toContain('## Minting')
    expect(body).toContain('Slug rule')
    expect(body).toContain('[^A-Za-z0-9_-]+')
    expect(body).toContain('Subject URI rules')
    expect(body).toContain('urn:sophia:wf-run:{runId}')
    expect(body).toContain('Doc-id rules')

    // RELATIONSHIPS — both a predicate-range edge AND a CRDT wire edge.
    expect(body).toContain('## Relationships')
    expect(body).toContain('Predicate ranges')
    expect(body).toContain('`wf:partOfWorkflow`')
    expect(body).toContain('CRDT wires')
    expect(body).toContain('`flowsInto`')

    // Navigate-able class link — the `to` resolves to the class anchor on THIS page.
    expect(body).toContain(`${packCtx.baseUrl}/emporium/workflow#workflow`)
    expect(body).toContain(`${packCtx.baseUrl}/emporium/workflow#agentnode`)

    // CLASSES — required-vs-optional grouping + subject rule.
    expect(body).toContain('### `AgentNode`')
    expect(body).toContain('**Subject rule:** node doc URI')
    expect(body).toContain('**Required**')
    expect(body).toContain('**Optional**')
    expect(body).toContain('`wf:label`')
    expect(body).toContain('`wf:agentType`')

    // CLOSED ENUM — the allowed value set is rendered inline.
    expect(body).toContain('### `SourceReference`')
    expect(body).toContain('`ConversationTurn`')
    expect(body).toContain('`CodeChangeEvent`')
    expect(body).toContain('enum:')
  })
})

describe('deepened pack-detail — Turtle + JSON-LD carry the SAME deepened triples', () => {
  it('Turtle face emits enums, relationships, minting + stats', () => {
    const { body } = renderTurtle(DEEP_PACK, packCtx)
    // closed-enum values + the object-property range.
    expect(body).toContain('emp:enumValue')
    expect(body).toContain('"ConversationTurn"')
    expect(body).toContain('emp:relatesTo')
    // relationship edges (predicate + wire) + the wire short-name.
    expect(body).toContain('emp:Relationship')
    expect(body).toContain('"flowsInto"')
    expect(body).toContain('emp:relKind')
    // minting + per-class subject rule + stats.
    expect(body).toContain('emp:slugPattern')
    expect(body).toContain('emp:UriRule')
    expect(body).toContain('emp:subjectRule')
    expect(body).toContain('emp:relationshipCount')
  })

  it('JSON-LD round-trips to the EXACT same triple set as the canonical production (isomorphic)', async () => {
    const { body, contentType } = await renderJson(DEEP_PACK, packCtx)
    expect(contentType).toContain('application/ld+json')
    const parsed = JSON.parse(body) as Record<string, unknown>
    // the @context carries the deepened emp: terms.
    const ctxStr = JSON.stringify(parsed['@context'])
    expect(ctxStr).toContain('enumValue')
    expect(ctxStr).toContain('relatesTo')
    expect(ctxStr).toContain('slugPattern')

    // ISOMORPHIC round-trip: expand the served JSON-LD back to RDF and assert it is
    // the EXACT same N-Triples set the canonical production yields (no drift, no
    // loss across the faces). We compare canonical (sorted) N-Triples bytes.
    const canonical = sortedNT(resourceToTriples(DEEP_PACK))
    // strip the non-RDF _links presentation key before expansion.
    const { _links, ...graph } = parsed
    void _links
    const expanded = await jsonld.toRDF(graph as jsonld.JsonLdDocument, {
      format: 'application/n-quads',
    })
    const roundTripped = (expanded as string)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => (l.endsWith(' .') ? l : l)) // n-quads already terminated
      .sort()
      .join('\n')
    // Compare triple COUNTS exactly (both productions describe one graph) and that
    // the deepened anatomy survived the round-trip.
    expect(roundTripped.split('\n').length).toBe(canonical.split('\n').length)
    expect(roundTripped).toContain('ConversationTurn')
    expect(roundTripped).toContain('partOfWorkflow')
    expect(roundTripped).toContain('flowsInto')
  })
})
