/**
 * emporium-client.ts — SHELL-SIDE live read of a gardend cell's /emporium vocab
 * CATALOGUE (the KG-layer catalogue of vocabulary packs).
 *
 * EMPORIUM is the catalogue of VOCABULARIES — "the pack IS the catalog". A current
 * gardend cell serves it over plain authenticated REST:
 *   GET /emporium/vocabs                  → { vocabularies: VocabSummaryRaw[] }
 *   GET /emporium/vocab/{name}/{version}  → the golden contract JSON (classes…)
 *   (version may be a concrete version OR the literal `latest`.)
 *
 * This lives in apps/organism (the SHELL), NOT in the pure library — exactly like
 * loopback-mcp.ts / gardend-contract.ts. The library (@shrubbery/render) is
 * network-free and only knows how to RENDER the VocabResource / VocabPackResource
 * shapes; this client READS them live and maps the upstream JSON into those
 * shapes. Nothing is mocked: every read is a real GET against a real cell.
 *
 * Transport: mirrors loopback-mcp's environment split — Node uses node:http
 * (undici drops Authorization on loopback POSTs; GETs are also kept on node:http
 * for parity + so the bearer is attached), the browser path uses fetch through the
 * same-origin /cell proxy (token injected server-side; never shipped to JS).
 *
 * Source of truth verified by curl against the Jun-19 release gardend:
 *   /emporium/vocabs → workflow@1.0.0 + sophia-memory-core@1.0.0.
 */

import type {
  VocabClass,
  VocabClassPredicate,
  VocabMinting,
  VocabPack,
  VocabRelationship,
  VocabSummary,
} from '@shrubbery/render'

/** How the client reaches the cell's /emporium routes (mirrors LoopbackTransport). */
export interface EmporiumTransport {
  /** Base URL of the cell, e.g. http://127.0.0.1:<port> (Node) or '/cell' (browser proxy). */
  readonly baseUrl: string
  /** Bearer token to attach (Node). Omit in the browser — the proxy injects it. */
  readonly token?: string
  /** Origin header to send (Node callers mirror neem-rs with http://127.0.0.1). */
  readonly origin?: string
  /** Injected fetch (browser path). Defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch
  /** Force the transport; auto-detected when omitted (absolute URL + Node ⇒ node-http). */
  readonly transport?: 'fetch' | 'node-http'
}

/** The raw /emporium/vocabs row shape (verbatim from the cell). */
interface VocabSummaryRaw {
  name: string
  version: string
  namespace: string
  sha: string
  title: string
}

/** One raw predicate spec inside a class (golden `classes.{cls}.predicates.{curie}`). */
interface PredicateSpecRaw {
  datatype?: string
  required?: boolean
  multi?: boolean
  /** Free-text provenance note — ALSO carries the `enum: a|b|c` closed-enum decl. */
  source?: string
  comment?: string
}

/** One raw class spec (golden `classes.{cls}`). */
interface ClassSpecRaw {
  predicates?: Record<string, PredicateSpecRaw>
  rdf_types?: string[]
  /** The class's subject-minting convention. */
  subject_rule?: string
}

/** One raw CRDT wire rule (golden `wires.{name}`). */
interface WireRuleRaw {
  from_kind?: string
  to_kind?: string
  source?: string
  predicate_uri?: string
  comment?: string
}

/** The raw slug rule (golden `slug_rule`). */
interface SlugRuleRaw {
  pattern?: string
  replacement?: string
  strip?: string
  lowercase?: boolean
}

/** The raw golden-contract shape (the FULL anatomy we now map). */
interface VocabPackRaw {
  name?: string
  version?: string
  title?: string
  description?: string
  namespaces?: Record<string, string>
  primary_prefix?: string
  classes?: Record<string, ClassSpecRaw>
  wires?: Record<string, WireRuleRaw>
  slug_rule?: SlugRuleRaw
  uri_rules?: Record<string, string>
  doc_id_rules?: Record<string, string>
}

interface HttpResponse {
  status: number
  ok: boolean
  text(): Promise<string>
}

const isNode =
  typeof process !== 'undefined' &&
  typeof (process as { versions?: { node?: string } }).versions?.node === 'string'

/** Read the live /emporium vocab catalogue from one gardend cell. */
export class EmporiumClient {
  private readonly mode: 'fetch' | 'node-http'
  private readonly fetchImpl: typeof fetch | undefined
  private readonly base: string

  constructor(private readonly t: EmporiumTransport) {
    this.base = t.baseUrl.replace(/\/+$/, '')
    const looksAbsolute = /^https?:\/\//.test(this.base)
    this.mode = t.transport ?? (isNode && looksAbsolute ? 'node-http' : 'fetch')
    if (this.mode === 'fetch') {
      const g = globalThis as typeof globalThis & { fetch?: typeof fetch }
      const f = t.fetch ?? (typeof g.fetch === 'function' ? g.fetch.bind(g) : undefined)
      if (!f) throw new Error('EmporiumClient: no fetch available (pass transport.fetch)')
      this.fetchImpl = f
    }
  }

  /** GET /emporium/vocabs → the catalogue rows mapped to the render VocabSummary shape. */
  async listVocabs(): Promise<VocabSummary[]> {
    const res = await this.get(`${this.base}/emporium/vocabs`)
    if (!res.ok) throw new Error(`GET /emporium/vocabs → HTTP ${res.status}`)
    const json = JSON.parse(await res.text()) as { vocabularies?: VocabSummaryRaw[] }
    const rows = json.vocabularies ?? []
    return rows.map((r) => ({
      name: r.name,
      version: r.version,
      namespace: r.namespace,
      sha: r.sha,
      title: r.title,
    }))
  }

  /**
   * GET /emporium/vocab/{name}/{version} → the golden contract, mapped to the
   * render VocabPack shape (classes + their predicates). `version` defaults to
   * 'latest'. `summary` (from the catalogue row) supplies sha/namespace if the
   * contract body omits them.
   */
  async getVocab(
    name: string,
    version = 'latest',
    summary?: VocabSummary,
  ): Promise<VocabPack> {
    const res = await this.get(`${this.base}/emporium/vocab/${encodeURIComponent(name)}/${encodeURIComponent(version)}`)
    if (!res.ok) throw new Error(`GET /emporium/vocab/${name}/${version} → HTTP ${res.status}`)
    const raw = JSON.parse(await res.text()) as VocabPackRaw
    return mapPack(name, raw, summary)
  }

  // ── transport primitives (mirror loopback-mcp) ──────────────────────────────

  private async get(url: string): Promise<HttpResponse> {
    if (this.mode === 'node-http') return this.nodeRequest('GET', url)
    const res = await this.fetchImpl!(url, { method: 'GET', headers: this.fetchHeaders() })
    return { status: res.status, ok: res.ok, text: () => res.text() }
  }

  private fetchHeaders(): Record<string, string> {
    const h: Record<string, string> = {}
    if (this.t.token) h['Authorization'] = `Bearer ${this.t.token}`
    return h
  }

  private async nodeRequest(method: string, url: string): Promise<HttpResponse> {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? await import('node:https') : await import('node:http')
    const headers: Record<string, string> = {}
    if (this.t.token) headers['Authorization'] = `Bearer ${this.t.token}`
    if (this.t.origin) headers['Origin'] = this.t.origin
    return new Promise<HttpResponse>((resolve, reject) => {
      const req = lib.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
        (res) => {
          let data = ''
          res.setEncoding('utf8')
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            const status = res.statusCode ?? 0
            resolve({ status, ok: status >= 200 && status < 300, text: () => Promise.resolve(data) })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
  }
}

/**
 * Parse a CLOSED-ENUM allowed-value set out of a predicate's `source` note.
 *
 * The golden contract encodes closed enums in the free-text `source` field with
 * the convention `enum: a|b|c` (optionally `enum (N): a|b|c`, sometimes with a
 * trailing ` - note`). e.g. mem:sourceKind →
 *   "enum (8): ConversationTurn|DocumentBlock|ToolCall|…"
 * Returns the trimmed value list, or undefined when the source is not an enum
 * declaration. NEVER invents values — only what the contract literally lists.
 */
export function parseEnumValues(source: string | undefined): string[] | undefined {
  if (!source) return undefined
  // `enum` optionally followed by `(N)`, then `:`, then the pipe-joined values.
  const m = /\benum\b\s*(?:\([^)]*\))?\s*:\s*([^]*)/i.exec(source)
  if (!m) return undefined
  // The value list runs to the first ` - ` / ` — ` prose separator (if any).
  const list = m[1].split(/\s+[-—]\s+/)[0]
  const values = list
    .split('|')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  return values.length > 0 ? values : undefined
}

/**
 * Infer which OTHER pack class an object-property (`datatype:'uri'`) predicate
 * points at — the class→class relationship range.
 *
 * The golden contract carries no explicit `range`, so we resolve it from two
 * generalized, contract-agnostic signals (no per-vocab hardcoding):
 *   1. the predicate's `source` note, which conventionally names the target as
 *      "<thing> doc URI" / "<thing> subject" — match the leading word against a
 *      class name (case-insensitive, e.g. "workflow doc URI" → Workflow,
 *      "archetype doc URI (judgment)" → Archetype).
 *   2. the predicate LOCAL name, which conventionally embeds the target class
 *      (e.g. partOfWorkflow → Workflow, optimizesArchetype → Archetype,
 *      targetArchetype → Archetype) — match the longest class-name suffix/substr.
 * Only resolves to a class that ACTUALLY exists in this pack (`classNames`); an
 * unresolvable uri predicate is simply not a relationship (honest, not faked).
 */
export function inferRelatesTo(
  predName: string,
  source: string | undefined,
  classNames: readonly string[],
): string | undefined {
  // index classes by lowercase for case-insensitive matching.
  const byLower = new Map(classNames.map((c) => [c.toLowerCase(), c]))
  // 1) source note: leading "<word> ..." (strip the CURIE prefix is irrelevant here).
  if (source) {
    const first = source.trim().split(/[\s(]+/)[0]?.toLowerCase()
    if (first && byLower.has(first)) return byLower.get(first)
  }
  // 2) predicate local name (drop the prefix): longest class name that appears.
  const local = predName.includes(':') ? predName.slice(predName.indexOf(':') + 1) : predName
  const localLower = local.toLowerCase()
  let best: string | undefined
  for (const c of classNames) {
    const cl = c.toLowerCase()
    if (localLower.includes(cl)) {
      if (!best || c.length > best.length) best = c
    }
  }
  return best
}

/** Map the raw golden-contract JSON into the render package's FULL VocabPack shape. */
export function mapPack(name: string, raw: VocabPackRaw, summary?: VocabSummary): VocabPack {
  const rawClassEntries = Object.entries(raw.classes ?? {})
  const classNames = rawClassEntries.map(([n]) => n)

  const classes: VocabClass[] = rawClassEntries
    .map(([clsName, cls]): VocabClass => {
      const predicates: VocabClassPredicate[] = Object.entries(cls.predicates ?? {}).map(
        ([predName, pred]): VocabClassPredicate => {
          const enumValues = parseEnumValues(pred.source)
          const relatesTo =
            pred.datatype === 'uri'
              ? inferRelatesTo(predName, pred.source, classNames)
              : undefined
          return {
            name: predName,
            datatype: pred.datatype,
            required: pred.required,
            multi: pred.multi,
            ...(enumValues ? { enumValues } : {}),
            ...(relatesTo ? { relatesTo } : {}),
          }
        },
      )
      return {
        name: clsName,
        predicates,
        rdfTypes: cls.rdf_types,
        ...(cls.subject_rule ? { subjectRule: cls.subject_rule } : {}),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── class→class RELATIONSHIPS: predicate-range edges + CRDT wire edges ───────
  const relationships: VocabRelationship[] = []
  // predicate edges (from the per-class object-property ranges resolved above).
  for (const cls of classes) {
    for (const pred of cls.predicates) {
      if (pred.relatesTo) {
        const rawPred = raw.classes?.[cls.name]?.predicates?.[pred.name]
        relationships.push({
          from: cls.name,
          to: pred.relatesTo,
          predicate: pred.name,
          kind: 'predicate',
          ...(rawPred?.source ? { note: rawPred.source } : {}),
        })
      }
    }
  }
  // wire edges (CRDT doc-connection rules: from_kind → to_kind via the wire name).
  for (const [wireName, wire] of Object.entries(raw.wires ?? {})) {
    relationships.push({
      from: wire.from_kind ?? '?',
      to: wire.to_kind ?? '?',
      predicate: wireName,
      kind: 'wire',
      ...(wire.source ? { note: wire.source } : {}),
    })
  }

  const namespaces = raw.namespaces
  const primaryPrefix = raw.primary_prefix
  const namespace =
    summary?.namespace ??
    (primaryPrefix && namespaces ? namespaces[primaryPrefix] : undefined) ??
    ''

  // ── pack-level minting (slug rule + per-template uri/doc-id rules) ───────────
  const minting: VocabMinting | undefined =
    raw.slug_rule || raw.uri_rules || raw.doc_id_rules
      ? {
          ...(raw.slug_rule?.pattern !== undefined ? { slugPattern: raw.slug_rule.pattern } : {}),
          ...(raw.slug_rule?.replacement !== undefined
            ? { slugReplacement: raw.slug_rule.replacement }
            : {}),
          ...(raw.slug_rule?.lowercase !== undefined
            ? { slugLowercase: raw.slug_rule.lowercase }
            : {}),
          ...(raw.uri_rules ? { uriRules: raw.uri_rules } : {}),
          ...(raw.doc_id_rules ? { docIdRules: raw.doc_id_rules } : {}),
        }
      : undefined

  const predicateCount = classes.reduce((n, c) => n + c.predicates.length, 0)

  return {
    name: raw.name ?? name,
    version: raw.version ?? summary?.version ?? 'latest',
    title: raw.title ?? summary?.title ?? name,
    namespace,
    sha: summary?.sha,
    description: raw.description,
    namespaces,
    classes,
    relationships,
    ...(minting ? { minting } : {}),
    predicateCount,
    relationshipCount: relationships.length,
  }
}
