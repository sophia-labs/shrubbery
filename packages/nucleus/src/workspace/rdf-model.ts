/**
 * rdf-model.ts — the GENERIC RDF term/triple model + N-Triples codec.
 *
 * ZERO application-vocabulary knowledge lives here. This is the plain RDF
 * substrate: the `Term`/`Triple` types, the literal/IRI term constructors,
 * deterministic triple ordering, and the N-Triples serialize/parse pair
 * (`triplesToNT` / `parseNT`). The vocabulary-aware config⇄RDF contract is
 * built ON TOP of this in ux-rdf.ts.
 *
 * The N-Triples codec is a faithful inverse pair for the subset this codebase
 * emits (absolute IRIs, plain/typed literals, no blank nodes, no language tags,
 * no relative IRIs): `parseNT(triplesToNT(ts))` recovers `ts` term-for-term.
 *
 * Pure functions only — no DOM, no stores, no network.
 */

// ── Term + Triple model ──────────────────────────────────────────────────────

export type Term =
  | { readonly type: 'iri'; readonly value: string }
  | { readonly type: 'literal'; readonly value: string; readonly datatype?: string }

/** s and p are always IRIs; o is an IRI or a typed/plain literal. */
export interface Triple {
  readonly s: string
  readonly p: string
  readonly o: Term
}

// ── Term constructors ─────────────────────────────────────────────────────────

/** An IRI-valued term. */
export const I = (value: string): Term => ({ type: 'iri', value })
/** A literal-valued term (plain when `datatype` is omitted, typed otherwise). */
export const L = (value: string, datatype?: string): Term =>
  datatype ? { type: 'literal', value, datatype } : { type: 'literal', value }

// XSD datatype IRIs — the only RDF-level constants this generic layer needs to
// stamp typed literals. (Application vocabulary terms live in ux-rdf.ts.)
const XSD = 'http://www.w3.org/2001/XMLSchema#'
export const XSD_INT = XSD + 'integer'
export const XSD_BOOL = XSD + 'boolean'
export const XSD_DEC = XSD + 'decimal'

/** xsd:integer literal (truncates to an integer). */
export const Lint = (n: number): Term => L(String(Math.trunc(n)), XSD_INT)
/** xsd:boolean literal. */
export const Lbool = (b: boolean): Term => L(b ? 'true' : 'false', XSD_BOOL)
/** xsd:decimal literal. */
export const Ldec = (n: number): Term => L(String(n), XSD_DEC)

// ── Deterministic ordering ────────────────────────────────────────────────────

/** Stable sort key for a term (IRIs sort after literals; datatype is part of the key). */
export function termKey(t: Term): string {
  return t.type === 'iri' ? `1${t.value}` : `0${t.value} ${t.datatype ?? ''}`
}

/** Total order on triples by (s, p, object-key) — the canonical seed ordering. */
export function compareTriples(a: Triple, b: Triple): number {
  return a.s.localeCompare(b.s) || a.p.localeCompare(b.p) || termKey(a.o).localeCompare(termKey(b.o))
}

// ── small guards ──────────────────────────────────────────────────────────────

export function isIri(t: Term): t is { type: 'iri'; value: string } {
  return t.type === 'iri'
}

// ── N-Triples rendering ───────────────────────────────────────────────────────

/** Render a term as N-Triples. */
export function termToNT(t: Term): string {
  if (t.type === 'iri') return `<${t.value}>`
  const esc = t.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return t.datatype ? `"${esc}"^^<${t.datatype}>` : `"${esc}"`
}

/** Render a triple list as N-Triples (one statement per line). */
export function triplesToNT(triples: readonly Triple[]): string {
  return triples.map((t) => `<${t.s}> <${t.p}> ${termToNT(t.o)} .`).join('\n')
}

// ── N-Triples parsing ─────────────────────────────────────────────────────────

/** Unescape an N-Triples literal lexical form (inverse of termToNT's escaping). */
function unescapeLiteral(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const next = s[++i]
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 't':
        out += '\t'
        break
      case 'r':
        out += '\r'
        break
      case '"':
        out += '"'
        break
      case '\\':
        out += '\\'
        break
      default:
        // Unknown escape — keep the char verbatim (lenient; we never emit these).
        out += next ?? ''
    }
  }
  return out
}

/**
 * Parse the object position of an N-Triples statement (everything between the
 * predicate IRI and the terminating ` .`) into a Term.
 */
function parseObject(raw: string): Term {
  const s = raw.trim()
  if (s.startsWith('<') && s.endsWith('>')) {
    return I(s.slice(1, -1))
  }
  if (s.startsWith('"')) {
    // "lexical"^^<datatype>  |  "lexical"  (no lang tags emitted by this codebase)
    const close = findClosingQuote(s)
    if (close === -1) throw new Error(`parseNT: unterminated literal: ${raw}`)
    const lexical = unescapeLiteral(s.slice(1, close))
    const rest = s.slice(close + 1).trim()
    if (rest.startsWith('^^<') && rest.endsWith('>')) {
      return L(lexical, rest.slice(3, -1))
    }
    if (rest === '') return L(lexical)
    throw new Error(`parseNT: unsupported literal suffix in: ${raw}`)
  }
  throw new Error(`parseNT: unrecognized object term: ${raw}`)
}

/** Index of the closing unescaped double-quote starting at index 0 ('"'). */
function findClosingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === '"') return i
  }
  return -1
}

/**
 * Parse an N-Triples document into a Triple[]. Inverse of `triplesToNT` for the
 * subset this codebase emits: absolute `<IRI>` subjects/predicates, IRI or
 * plain/typed-literal objects, one statement per line, terminated by ` .`.
 *
 * Blank lines and `#` comment lines are skipped (so a committed seed artifact
 * with a comment header parses cleanly). Throws on a malformed statement.
 */
export function parseNT(nt: string): Triple[] {
  const out: Triple[] = []
  for (const rawLine of nt.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (!line.endsWith('.')) throw new Error(`parseNT: statement missing trailing '.': ${rawLine}`)

    // Subject — <IRI>
    if (!line.startsWith('<')) throw new Error(`parseNT: subject must be an IRI: ${rawLine}`)
    const sEnd = line.indexOf('>')
    if (sEnd === -1) throw new Error(`parseNT: unterminated subject IRI: ${rawLine}`)
    const s = line.slice(1, sEnd)

    // Predicate — <IRI>
    const afterS = line.slice(sEnd + 1).trimStart()
    if (!afterS.startsWith('<')) throw new Error(`parseNT: predicate must be an IRI: ${rawLine}`)
    const pEnd = afterS.indexOf('>')
    if (pEnd === -1) throw new Error(`parseNT: unterminated predicate IRI: ${rawLine}`)
    const p = afterS.slice(1, pEnd)

    // Object — everything up to the terminating ' .'
    const afterP = afterS.slice(pEnd + 1).trimStart()
    const objRaw = afterP.replace(/\s*\.\s*$/, '')
    out.push({ s, p, o: parseObject(objRaw) })
  }
  return out
}
