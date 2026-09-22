/**
 * W14.2 — the SEELe source projection (D16).
 *
 * `plans/hoja-seele-workbench-suite-20260803.md` §"W14 — The workbench
 * controller" / D16 in the decision register: nature reads raw YAML off a
 * path (`nature/src/main.rs:38,80`, `fs::read_to_string`); the constitution
 * document W14.1 exposes is a TipTap tree of prose *and* fences. Which bytes
 * are the authoritative source is a design choice, not an implementation
 * detail — D16 selects option (b): **exactly one** fenced code block tagged
 * `seele`. Zero matches and two-or-more matches are both loud, typed errors —
 * never a silent empty compile (the failure mode this projection exists to
 * rule out).
 *
 * `projectSeeleSource` is a PURE function over `LiveDocumentJSON` (W14.1's
 * `getJSON()`/`getDocumentJSON()` alias for `@tiptap/core`'s `JSONContent`).
 * It knows nothing about Yjs, the editor host, or the compile route — it only
 * ever reads the tree it is handed.
 *
 * WHAT "TAGGED `seele`" MEANS, PRECISELY (inspected against the real schema,
 * not assumed): `codeBlock`'s only language-carrying attribute is the single
 * free-form string `language` (`@tiptap/extension-code-block`'s
 * `addAttributes()` — there is no separate "info string" field in this
 * schema). The kernel's typed-fence input rule
 * (`packages/editor-kernel` via `@tiptap/extension-code-block`'s
 * `backtickInputRegex = /^```([a-z]+)?[\s\n]$/`) can only ever produce a
 * single lowercase word this way, so a live-typed fence's `language` is
 * always one token. But the attribute itself is NOT schema-constrained to
 * one token — `setCodeBlock({ language })`, a markdown import's `token.lang`,
 * or a pasted `<code class="language-…">` can all carry a multi-word string.
 * So this module treats `language` as a whitespace-separated token list and
 * matches a fence as "seele-tagged" iff `seele` is one of its tokens —
 * `'seele'` matches, and so would a hypothetical `'yaml seele'`, but plain
 * `'yaml'` does not. There is no dedicated `'yaml seele'` affordance anywhere
 * in the editor today; this is the honest reading of "support what exists"
 * for an attribute that is a string, not a structured info-string record.
 *
 * `packages/hoja` is NOT touched and NOT exercised here — this module lives
 * entirely on the hosted-document (`sh-editor-host`) path W14.1 built.
 */

import type { LiveDocumentJSON } from '../collab/live-editor.js'

/** The language token this projection recognizes as "this fence is SEELe source." */
const SEELE_LANGUAGE_TOKEN = 'seele'

/**
 * Where a recognized fence lives in the document tree.
 *
 * `blockId` is the `data-block-id` the kernel's `BlockId` extension assigns
 * (`packages/editor-kernel/src/extensions/block-id.ts`) — W3's diagnostics and
 * W2.3's offset→YAML-path mapping anchor to this same id, per W14.2's intent.
 * `path` is the child-index path from the document root to the fence node
 * (depth-first; e.g. `[2]` = the third top-level child, `[1, 0]` = the first
 * child of the second top-level child) — a stable, human-inspectable "where in
 * the document" independent of whether a block id happens to be assigned yet.
 */
export interface SourceRegion {
  readonly blockId: string | null
  readonly path: readonly number[]
}

/** What `projectSeeleSource` returns when exactly one `seele` fence exists. */
export interface SeeleSourceProjection {
  readonly source: string
  readonly region: SourceRegion
}

function describeSourceRegion(region: SourceRegion): string {
  const where = region.blockId ? `block ${region.blockId}` : `position [${region.path.join(',')}]`
  return `${where} (path [${region.path.join(',')}])`
}

/**
 * Thrown when the document contains no `seele`-tagged fenced code block.
 * Named `NoSeeleSource` per the workbench-controller build brief — a document
 * with zero fences must refuse to project a source, never silently compile
 * empty input.
 */
export class NoSeeleSourceError extends Error {
  constructor() {
    super(
      'No seele-tagged fenced code block found in the document. ' +
        `A source projection requires exactly one code block whose language ` +
        `is (or includes the token) '${SEELE_LANGUAGE_TOKEN}'.`,
    )
    this.name = 'NoSeeleSource'
  }
}

/**
 * Thrown when the document contains two or more `seele`-tagged fenced code
 * blocks. Named `MultipleSeeleSources` per the workbench-controller build
 * brief. `locations` lists every match, in document order, so a caller (the
 * chip, a diagnostic) can point at each one rather than guess.
 */
export class MultipleSeeleSourcesError extends Error {
  readonly locations: readonly SourceRegion[]

  constructor(locations: readonly SourceRegion[]) {
    super(
      `Found ${locations.length} seele-tagged fenced code blocks; exactly one is required. ` +
        `Locations: ${locations.map(describeSourceRegion).join('; ')}`,
    )
    this.name = 'MultipleSeeleSources'
    this.locations = locations
  }
}

function seeleLanguageTokens(language: unknown): readonly string[] {
  if (typeof language !== 'string') return []
  return language
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

function isSeeleTaggedFence(node: LiveDocumentJSON): boolean {
  if (node.type !== 'codeBlock') return false
  return seeleLanguageTokens(node.attrs?.['language']).includes(SEELE_LANGUAGE_TOKEN)
}

function blockIdOf(node: LiveDocumentJSON): string | null {
  const raw = node.attrs?.['data-block-id']
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** Concatenate a `codeBlock` node's text content. `codeBlock`'s schema is
 * `content: 'text*', marks: ''` — plain text runs only, never marks or other
 * node types — but a CRDT-backed document can still split one logical run
 * across several adjacent text nodes, so every run is joined. */
function codeBlockText(node: LiveDocumentJSON): string {
  const children = node.content
  if (!Array.isArray(children)) return ''
  let text = ''
  for (const child of children) {
    if (child.type === 'text' && typeof child.text === 'string') text += child.text
  }
  return text
}

interface FoundFence {
  readonly node: LiveDocumentJSON
  readonly region: SourceRegion
}

/** Depth-first walk over every descendant, in document order, collecting `seele`-tagged fences wherever they live (top level, inside a blockquote, a list item, a table cell — anywhere the schema allows a `codeBlock`). */
function collectSeeleFences(doc: LiveDocumentJSON): FoundFence[] {
  const found: FoundFence[] = []

  const walk = (node: LiveDocumentJSON, path: readonly number[]): void => {
    if (isSeeleTaggedFence(node)) {
      found.push({ node, region: { blockId: blockIdOf(node), path } })
    }
    const children = node.content
    if (!Array.isArray(children)) return
    children.forEach((child, index) => walk(child, [...path, index]))
  }

  const topLevel = doc.content
  if (Array.isArray(topLevel)) {
    topLevel.forEach((child, index) => walk(child, [index]))
  }

  return found
}

/**
 * Project the authoritative SEELe source out of a TipTap document JSON tree.
 *
 * - Exactly one `seele`-tagged fenced code block → its text, byte-exact
 *   (including any trailing newline the fence's own text carries), plus the
 *   `SourceRegion` it came from.
 * - Zero fences → throws {@link NoSeeleSourceError}.
 * - Two or more fences → throws {@link MultipleSeeleSourcesError}, listing
 *   every match's `SourceRegion`.
 *
 * Prose anywhere else in the document — including prose that merely LOOKS
 * like YAML — is never consulted; only the fence's own `content` is read.
 */
export function projectSeeleSource(doc: LiveDocumentJSON): SeeleSourceProjection {
  const fences = collectSeeleFences(doc)
  if (fences.length === 0) throw new NoSeeleSourceError()
  if (fences.length > 1) throw new MultipleSeeleSourcesError(fences.map((fence) => fence.region))
  const [fence] = fences
  return { source: codeBlockText(fence.node), region: fence.region }
}
