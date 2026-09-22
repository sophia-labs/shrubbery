/**
 * turtle.ts — a REAL Turtle serializer + parser for the subset this codebase
 * emits (absolute IRIs, plain/typed literals, no blank nodes, no lang tags).
 *
 * Why not just N-Triples (nucleus already has triplesToNT)? The ratified design
 * serves `text/turtle`, and bare N-Triples is ugly for a human reading it via
 * `curl`. So this emits PRETTY Turtle: `@prefix` directives (from the shared
 * PREFIXES table), prefixed names (`comp:mn-graph-panel`), predicate/object
 * grouping (`;` / `,`), and `a` for rdf:type. The matching parser EXPANDS all of
 * that back to a flat Triple[], so the round-trip `triples → turtle → parse` is a
 * genuine inverse — that is what the test asserts (no mock).
 *
 * The parser is scoped to exactly the Turtle this serializer produces (it is the
 * proof that our serializer is sound), not a general-purpose Turtle reader.
 *
 * Pure: no DOM, no network.
 */

import {
  I,
  L,
  compareTriples,
  type Term,
  type Triple,
} from '@shrubbery/nucleus'
import { PREFIXES, RDF_TYPE } from './context.js'

// Longest-namespace-first so e.g. rdf:type never wins over a more specific NS.
const PREFIX_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.entries(PREFIXES).sort(
  (a, b) => b[1].length - a[1].length,
)

const XSD = 'http://www.w3.org/2001/XMLSchema#'
const XSD_STRING = XSD + 'string'

/** A valid Turtle local-name (PN_LOCAL, conservative subset — no escapes needed). */
const SAFE_LOCAL = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** Abbreviate an IRI to `prefix:local` when a known prefix + safe local applies. */
function abbreviateIri(iri: string): string {
  for (const [prefix, ns] of PREFIX_ENTRIES) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length)
      if (SAFE_LOCAL.test(local)) return `${prefix}:${local}`
    }
  }
  return `<${iri}>`
}

/** Render a literal lexical form with Turtle string escaping. */
function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/** Render a term in Turtle (IRIs abbreviated, typed literals with `^^prefix:dt`). */
function termToTurtle(t: Term): string {
  if (t.type === 'iri') return abbreviateIri(t.value)
  const lex = `"${escapeLiteral(t.value)}"`
  if (!t.datatype || t.datatype === XSD_STRING) return lex
  return `${lex}^^${abbreviateIri(t.datatype)}`
}

// ── Serialize ─────────────────────────────────────────────────────────────────

/**
 * Serialize a Triple[] to pretty Turtle: a `@prefix` header (only the prefixes
 * actually used), then per-subject blocks with predicate grouping (`;`), object
 * lists (`,`), and `a` for rdf:type. Deterministic (subjects/predicates/objects
 * are canonically sorted via compareTriples) so the output is byte-stable.
 */
export function triplesToTurtle(triples: readonly Triple[]): string {
  const sorted = [...triples].sort(compareTriples)

  // Which prefixes are referenced (header only lists used prefixes).
  const used = new Set<string>()
  const noteIri = (iri: string) => {
    for (const [prefix, ns] of PREFIX_ENTRIES) {
      if (iri.startsWith(ns) && SAFE_LOCAL.test(iri.slice(ns.length))) {
        used.add(prefix)
        return
      }
    }
  }
  for (const t of sorted) {
    noteIri(t.s)
    noteIri(t.p)
    if (t.o.type === 'iri') noteIri(t.o.value)
    else if (t.o.datatype && t.o.datatype !== XSD_STRING) noteIri(t.o.datatype)
  }

  const header = PREFIX_ENTRIES.filter(([p]) => used.has(p))
    .map(([p, ns]) => `@prefix ${p}: <${ns}> .`)
    .join('\n')

  // Group by subject, then predicate.
  const bySubject = new Map<string, Map<string, Term[]>>()
  const subjectOrder: string[] = []
  for (const t of sorted) {
    let preds = bySubject.get(t.s)
    if (!preds) {
      bySubject.set(t.s, (preds = new Map()))
      subjectOrder.push(t.s)
    }
    const arr = preds.get(t.p)
    if (arr) arr.push(t.o)
    else preds.set(t.p, [t.o])
  }

  const blocks: string[] = []
  for (const s of subjectOrder) {
    const preds = bySubject.get(s)!
    // rdf:type first (rendered as `a`), then the rest in sorted predicate order.
    const predKeys = [...preds.keys()].sort((a, b) => {
      if (a === RDF_TYPE) return -1
      if (b === RDF_TYPE) return 1
      return a.localeCompare(b)
    })
    const lines = predKeys.map((p) => {
      const pterm = p === RDF_TYPE ? 'a' : abbreviateIri(p)
      const objs = preds.get(p)!.map(termToTurtle).join(' , ')
      return `    ${pterm} ${objs}`
    })
    blocks.push(`${abbreviateIri(s)}\n${lines.join(' ;\n')} .`)
  }

  return `${header}\n\n${blocks.join('\n\n')}\n`
}

// ── Parse (the inverse, scoped to what we emit) ──────────────────────────────

const PREFIX_BY_NAME = new Map(PREFIX_ENTRIES.map(([p, ns]) => [p, ns]))

/** Expand a Turtle IRI token (`<abs>` | `prefix:local`) to an absolute IRI. */
function expandIri(tok: string, prefixes: Map<string, string>): string {
  if (tok.startsWith('<') && tok.endsWith('>')) return tok.slice(1, -1)
  const colon = tok.indexOf(':')
  if (colon === -1) throw new Error(`turtle parse: not an IRI token: ${tok}`)
  const prefix = tok.slice(0, colon)
  const local = tok.slice(colon + 1)
  const ns = prefixes.get(prefix)
  if (ns === undefined) throw new Error(`turtle parse: unknown prefix '${prefix}:'`)
  return ns + local
}

/** Unescape a Turtle string literal lexical form. */
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
      case 'n': out += '\n'; break
      case 'r': out += '\r'; break
      case 't': out += '\t'; break
      case '"': out += '"'; break
      case '\\': out += '\\'; break
      default: out += next ?? ''
    }
  }
  return out
}

/**
 * Tokenize an object-list segment (between a predicate and the next `;`/`.`) into
 * Term[], splitting on top-level `,` (commas inside a quoted literal are kept).
 */
function parseObjectList(seg: string, prefixes: Map<string, string>): Term[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  let inStr = false
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (inStr) {
      cur += c
      if (c === '\\') {
        cur += seg[++i] ?? ''
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
      cur += c
    } else if (c === '<') {
      depth++
      cur += c
    } else if (c === '>') {
      depth--
      cur += c
    } else if (c === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  if (cur.trim() !== '') parts.push(cur.trim())
  return parts.map((p) => parseObjectTerm(p, prefixes))
}

function parseObjectTerm(tok: string, prefixes: Map<string, string>): Term {
  const s = tok.trim()
  if (s.startsWith('"')) {
    const close = findClosingQuote(s)
    if (close === -1) throw new Error(`turtle parse: unterminated literal: ${tok}`)
    const lex = unescapeLiteral(s.slice(1, close))
    const rest = s.slice(close + 1).trim()
    if (rest === '') return L(lex)
    if (rest.startsWith('^^')) return L(lex, expandIri(rest.slice(2).trim(), prefixes))
    throw new Error(`turtle parse: unsupported literal suffix: ${tok}`)
  }
  return I(expandIri(s, prefixes))
}

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
 * Parse the Turtle this serializer emits back into a flat Triple[]. Handles
 * `@prefix` directives, prefixed/absolute IRIs, the `a` keyword, predicate
 * grouping (`;`) and object lists (`,`). Throws on anything outside that subset.
 *
 * The inverse of `triplesToTurtle` for the emitted subset:
 *   parse(triplesToTurtle(ts)) deep-equals ts modulo triple ordering.
 */
export function parseTurtle(ttl: string): Triple[] {
  // Local prefix map seeded with the built-in shared prefixes, then overlaid
  // with any @prefix directives in the document.
  const prefixes = new Map(PREFIX_BY_NAME)

  // Strip comment lines (full-line `#...`), collect @prefix, keep the rest.
  const bodyLines: string[] = []
  for (const raw of ttl.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const pm = /^@prefix\s+([A-Za-z][\w-]*):\s+<([^>]*)>\s*\.$/.exec(line)
    if (pm) {
      prefixes.set(pm[1], pm[2])
      continue
    }
    bodyLines.push(raw)
  }

  const body = bodyLines.join('\n')

  // Split into per-subject statements: a statement ends at a ` .` that is at the
  // top level (not inside a quoted literal or an <IRI>).
  const statements = splitStatements(body)

  const out: Triple[] = []
  for (const stmt of statements) {
    const trimmed = stmt.trim()
    if (trimmed === '') continue

    // subject = first token (IRI), then the predicate-object list.
    const { token: subjTok, rest } = readFirstToken(trimmed)
    const s = expandIri(subjTok, prefixes)

    // predicate;predicate;... split on top-level ';'
    for (const predSeg of splitTopLevel(rest, ';')) {
      const seg = predSeg.trim()
      if (seg === '') continue
      const { token: predTok, rest: objSeg } = readFirstToken(seg)
      const p = predTok === 'a' ? RDF_TYPE : expandIri(predTok, prefixes)
      for (const o of parseObjectList(objSeg, prefixes)) {
        out.push({ s, p, o })
      }
    }
  }
  return out
}

/** Split a Turtle body into top-level statements terminated by ` .`. */
function splitStatements(body: string): string[] {
  const stmts: string[] = []
  let cur = ''
  let inStr = false
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (inStr) {
      cur += c
      if (c === '\\') cur += body[++i] ?? ''
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      cur += c
    } else if (c === '<') {
      depth++
      cur += c
    } else if (c === '>') {
      depth--
      cur += c
    } else if (c === '.' && depth === 0) {
      stmts.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  if (cur.trim() !== '') stmts.push(cur)
  return stmts
}

/** Split a string on a top-level separator char (not inside literal/IRI). */
function splitTopLevel(s: string, sep: ';' | ','): string[] {
  const parts: string[] = []
  let cur = ''
  let inStr = false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      cur += c
    } else if (c === '<') {
      depth++
      cur += c
    } else if (c === '>') {
      depth--
      cur += c
    } else if (c === sep && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  parts.push(cur)
  return parts
}

/** Read the first whitespace-delimited token (an IRI/`a`), return it + the rest. */
function readFirstToken(s: string): { token: string; rest: string } {
  const t = s.trimStart()
  if (t.startsWith('<')) {
    const end = t.indexOf('>')
    if (end === -1) throw new Error(`turtle parse: unterminated IRI in: ${s}`)
    return { token: t.slice(0, end + 1), rest: t.slice(end + 1).trimStart() }
  }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t)
  if (!m) throw new Error(`turtle parse: empty token in: ${s}`)
  return { token: m[1], rest: m[2] }
}
