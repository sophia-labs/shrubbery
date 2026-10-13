/**
 * Pull the site's words from Sophia graphs into content/.
 *
 *   pnpm --filter @shrubbery/cluster pull      (then build)
 *
 * Pages come from the documents named in site.json (graph "public"), read as markdown.
 * The catalogue page is generated from the catalogue records in graph "cluster", reading
 * ONLY the fields site.json allows (never the internal ones: status notes, risks,
 * evidence, untrue claims, or the engineering spec lines).
 *
 * Transport: with SOPHIA_MCP_URL and SOPHIA_API_KEY set (CI), it calls the graph's MCP
 * endpoint over HTTP; otherwise it uses the operator's ~/.sophia-mcp/sirin-call.sh.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CC = 'https://sophia-labs.com/ns/cluster-catalog#'

export interface SitePage { path: string; document: string; title: string; description?: string; feature?: string }
export interface Product { slug: string; document: string; families: string[]; status?: string }
export interface SiteMap {
  graph: string
  pages: SitePage[]
  catalog?: {
    path: string
    document: string
    graph: string
    title: string
    description?: string
    fields: string[]
    exclude: string[]
    products: Product[]
  }
}

export interface Item {
  slug: string
  name: string
  family: string
  plain?: string
  availability: string
  leadTime?: string
  targetRelease?: string
  intent?: string
  partNumber?: string
  /** True when a roadmap bead delivering this item is in progress (read from the beads' status and delivers only). */
  inProgress?: boolean
}

const FAMILIES = ['Workspace', 'Agents', 'Connections', 'Data & export', 'Security & access', 'Installation', 'Operations', 'Developer surface']

/** One RDF literal as plain text: '"x"' or '"x"^^<type>' or '"x"@lang' to 'x'. */
export function literal(term: string): string {
  const m = term.match(/^"([\s\S]*)"(?:\^\^<[^>]+>|@[a-z-]+)?$/)
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : term
}

/** Hydrated emporium objects to catalogue items, reading only the allowed fields. */
export function toItems(objects: Array<{ subject: string; predicates: Record<string, string[]> }>, fields: string[]): Item[] {
  return objects.map((o) => {
    const get = (k: string) => (fields.includes(k) ? (o.predicates[CC + k] ?? []).map(literal)[0] : undefined)
    return {
      slug: o.subject.split(':').pop() as string,
      name: get('name') ?? '',
      family: get('family') ?? 'Workspace',
      plain: get('plain'),
      availability: get('availability') ?? 'Planned',
      leadTime: get('leadTime'),
      targetRelease: get('targetRelease'),
      intent: get('intent'),
      partNumber: get('partNumber'),
    }
  })
}

const CTA = 'http://mnemosyne.dev/cuentas#'

/** Catalogue item slugs that an in-progress roadmap bead delivers. Reads only each bead's status and delivers. */
export function inProgressSlugs(beads: Array<{ predicates: Record<string, string[]> }>): Set<string> {
  const slugs = new Set<string>()
  for (const b of beads) {
    if ((b.predicates[CTA + 'status'] ?? []).map(literal)[0] !== 'in_progress') continue
    for (const d of b.predicates[CTA + 'delivers'] ?? []) slugs.add(d.replace(/^<|>$/g, '').split(':').pop() as string)
  }
  return slugs
}

/** Matter-of-fact project-management status for one item. */
export function statusLabel(item: Item): string {
  const release = item.targetRelease && item.targetRelease !== 'later' ? item.targetRelease : undefined
  switch (item.availability) {
    case 'InStock': return 'Shipped'
    case 'MadeToOrder': return 'Shipped · set up at install'
    case 'Scheduled': return `${item.inProgress ? 'In progress' : 'Scheduled'}${release ? ` · ${release}` : ''}`
    case 'Planned': return 'Backlog'
    default: return item.availability
  }
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim()
const ORDER: Record<string, number> = { InStock: 0, MadeToOrder: 1, Scheduled: 2, Planned: 3 }
const releaseRank = (r?: string) => (r && r !== 'later' ? r.split('.').map((n) => n.padStart(3, '0')).join('.') : 'zzz')

export function visible(items: Item[], exclude: string[]): Item[] {
  return items.filter((i) => i.availability !== 'NotOffered' && !exclude.includes(i.slug) && i.name)
}

/** One line for a product's card: shipped or not, and the next release that touches it. */
export function productStatus(product: Product, items: Item[]): string {
  if (product.status) return product.status
  const mine = items.filter((i) => product.families.includes(i.family))
  const shipped = mine.some((i) => i.availability === 'InStock' || i.availability === 'MadeToOrder')
  const next = mine.map((i) => i.targetRelease).filter((r): r is string => !!r && r !== 'later').sort((a, b) => releaseRank(a).localeCompare(releaseRank(b)))[0]
  return [shipped ? 'Shipped' : 'In progress', next ? `next release ${next}` : ''].filter(Boolean).join(' · ')
}

/** A product document ("# Title", one line, highlights) split into its parts. */
export function splitProductDoc(markdown: string): { title: string; rest: string } {
  const m = markdown.trim().match(/^#\s+(.+)\n([\s\S]*)$/)
  if (!m) throw new Error('a product document must start with "# <name>"')
  return { title: m[1].trim(), rest: m[2].trim() }
}

/** The catalogue's front page: the intro, then one card per product. */
export function catalogIndexMarkdown(intro: string, products: Array<{ product: Product; doc: string }>, items: Item[], path: string): string {
  const out = [intro.trim(), '']
  for (const { product, doc } of products) {
    const { title, rest } = splitProductDoc(doc)
    // On the shelf the maker is already named once: "Sophia Desk" is shown as "Desk".
    const short = title.replace(/^Sophia\s+/, '')
    out.push(`## [${short}](/${path}/${product.slug})`, '', rest, '', `*${productStatus(product, items)}*`, '')
  }
  return out.join('\n')
}

/** One product's page: breadcrumb, its splash, its status, then a table per family. */
export function productMarkdown(product: Product, doc: string, items: Item[], path: string): string {
  const { title, rest } = splitProductDoc(doc)
  const out = [`[Catalogue](/${path}) › ${title}`, '', `# ${title}`, '', rest, '', `*${productStatus(product, items)}*`, '']
  for (const family of product.families) {
    const rows = items
      .filter((i) => i.family === family)
      .sort((a, b) => (ORDER[a.availability] ?? 9) - (ORDER[b.availability] ?? 9) || releaseRank(a.targetRelease).localeCompare(releaseRank(b.targetRelease)) || a.name.localeCompare(b.name))
    if (rows.length === 0) continue
    out.push(`## ${family}`, '', '| Item | What it is | Status |', '| --- | --- | --- |')
    for (const i of rows) {
      const what = [cell(i.plain), i.intent && i.availability !== 'InStock' ? `*${cell(i.intent)}*` : ''].filter(Boolean).join(' ')
      out.push(`| ${cell(i.name)} | ${what} | ${statusLabel(i)} |`)
    }
    out.push('')
  }
  return out.join('\n')
}

export function pageFile(page: { title: string; description?: string; feature?: string }, body: string, source: string): string {
  const meta = [`title: ${page.title}`]
  if (page.description) meta.push(`description: ${page.description}`)
  if (page.feature) meta.push(`feature: ${page.feature}`)
  meta.push(`source: ${source} (pulled; edit it there, not here)`)
  return `---\n${meta.join('\n')}\n---\n\n${body.trim()}\n`
}

// ---- transport

/** A dormant graph answers "graph_activating" while its cell wakes: wait and ask again (up to ~5 minutes). */
function callTool(graph: string, tool: string, args: Record<string, unknown>): any {
  for (let attempt = 1; ; attempt++) {
    const res = callToolOnce(graph, tool, args)
    if (res?.code !== 'graph_activating') return res
    if (attempt >= 30) throw new Error(`${graph} did not wake within ${attempt} tries`)
    execFileSync('sleep', ['10'])
  }
}

function callToolOnce(graph: string, tool: string, args: Record<string, unknown>): any {
  const url = process.env.SOPHIA_MCP_URL
  const key = process.env.SOPHIA_API_KEY
  if (url && key) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
    const raw = execFileSync('curl', ['-sS', '--max-time', '60', '-X', 'POST', url.replace('{graph}', graph),
      '-H', `Authorization: Bearer ${key}`, '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream',
      '-H', 'MCP-Protocol-Version: 2025-03-26', '--data-binary', '@-'], { input: body, encoding: 'utf8' })
    const json = raw.trim().startsWith('{') ? raw : raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('')
    const res = JSON.parse(json)
    if (res.code === 'graph_activating') return res
    if (res.error) throw new Error(`${tool} on ${graph}: ${JSON.stringify(res.error)}`)
    return res.result.structuredContent ?? JSON.parse(res.result.content[0].text)
  }
  const script = join(homedir(), '.sophia-mcp', 'sirin-call.sh')
  const raw = execFileSync(script, [graph, tool, JSON.stringify(args)], { encoding: 'utf8', maxBuffer: 64 << 20 })
  const res = JSON.parse(raw)
  if (res.code === 'graph_activating') return res
  if (res.error || !res.result) throw new Error(`${tool} on ${graph}: ${raw.slice(0, 300)}`)
  return res.result.structuredContent
}

export function pull(site: SiteMap = JSON.parse(readFileSync(join(HERE, 'site.json'), 'utf8')), contentDir = join(HERE, 'content')): string[] {
  const written: string[] = []
  for (const page of site.pages) {
    const doc = callTool(site.graph, 'read_document', { graph_id: site.graph, documentId: page.document, format: 'markdown', maxChars: 262144 })
    if (typeof doc?.content !== 'string' || !doc.content.trim()) throw new Error(`${site.graph}/${page.document}: empty or unreadable`)
    writeFileSync(join(contentDir, `${page.path}.md`), pageFile(page, doc.content, `${site.graph}/${page.document}`))
    written.push(`${page.path}.md`)
  }
  if (site.catalog) {
    const c = site.catalog
    const res = callTool(c.graph, 'emporium_query', { graph_id: c.graph, vocab: 'cluster-catalog', class: 'Item', limit: 500 })
    const beads = callTool(c.graph, 'emporium_query', { graph_id: c.graph, vocab: 'cuentas', class: 'Cuenta', limit: 500 })
    const inProgress = inProgressSlugs(beads.objects)
    const items = visible(toItems(res.objects, c.fields), c.exclude).map((i) => ({ ...i, inProgress: inProgress.has(i.slug) }))
    const read = (doc: string) => {
      const r = callTool(site.graph, 'read_document', { graph_id: site.graph, documentId: doc, format: 'markdown', maxChars: 262144 })
      if (typeof r?.content !== 'string' || !r.content.trim()) throw new Error(`${site.graph}/${doc}: empty or unreadable`)
      return r.content as string
    }
    const products = c.products.map((product) => ({ product, doc: read(product.document) }))
    mkdirSync(join(contentDir, c.path), { recursive: true })
    writeFileSync(join(contentDir, `${c.path}.md`), pageFile(c, catalogIndexMarkdown(read(c.document), products, items, c.path), `${site.graph}/${c.document} + products + ${c.graph} catalogue (public fields)`))
    written.push(`${c.path}.md`)
    for (const { product, doc } of products) {
      const title = splitProductDoc(doc).title
      writeFileSync(join(contentDir, c.path, `${product.slug}.md`), pageFile({ title: `${title} — Sophia Cluster 1.0`, description: doc.trim().split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('-'))?.trim() }, productMarkdown(product, doc, items, c.path), `${site.graph}/${product.document} + ${c.graph} catalogue (public fields)`))
      written.push(`${c.path}/${product.slug}.md`)
    }
  }
  return written
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify({ pulled: pull() }))
}
