/**
 * parse-term.ts — unwrap SPARQL row values (N-Triples-style term STRINGS) into
 * typed terms.
 *
 * HOISTED from apps/rhizome/src/garden-client.ts:60-92 @ b2f408e — rhizome's
 * copy stays app-local; @shrubbery/source is the sole external
 * adapter-consumption convention. Behavior is as-is; only the return type is
 * widened to the contract's `SourceTerm` (a supertype of the shape rhizome
 * produced). Bare `_:b0`-style tokens still land in the lenient bare-literal
 * branch — the JSON-bindings path of the generic SPARQL adapter (which is
 * where blank nodes arrive typed) does its own `bnode` mapping.
 *
 * gardend's sparql_query rows come back as term strings, e.g.
 *   "<urn:…:record:3c37…>"  |  "\"active\""  |  "\"2\"^^<…#integer>".
 */

import type { SourceTerm } from '@shrubbery/nucleus'

/**
 * Unwrap a SPARQL row value (an N-Triples-style string) into a SourceTerm.
 *   "<iri>"                 → { type:'iri', value:'iri' }
 *   "\"lex\"^^<dt>"         → { type:'literal', value:'lex', datatype:'dt' }
 *   "\"lex\""               → { type:'literal', value:'lex' }
 *   bare "lex"              → { type:'literal', value:'lex' }  (lenient)
 */
export function parseTerm(raw: string): SourceTerm {
  const s = raw.trim()
  if (s.startsWith('<') && s.endsWith('>')) {
    return { type: 'iri', value: s.slice(1, -1) }
  }
  if (s.startsWith('"')) {
    // find the closing unescaped quote
    let close = -1
    for (let i = 1; i < s.length; i++) {
      if (s[i] === '\\') {
        i++
        continue
      }
      if (s[i] === '"') {
        close = i
        break
      }
    }
    if (close === -1) return { type: 'literal', value: s }
    const lex = s
      .slice(1, close)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\')
    const rest = s.slice(close + 1).trim()
    if (rest.startsWith('^^<') && rest.endsWith('>')) {
      return { type: 'literal', value: lex, datatype: rest.slice(3, -1) }
    }
    return { type: 'literal', value: lex }
  }
  // bare token (some cells return unquoted literals) — treat as a plain literal.
  return { type: 'literal', value: s }
}

/** Parse one raw SELECT row (var → term string) into var → SourceTerm. */
export function parseRow(raw: Readonly<Record<string, string>>): Record<string, SourceTerm> {
  const parsed: Record<string, SourceTerm> = {}
  for (const [k, v] of Object.entries(raw)) parsed[k] = parseTerm(v)
  return parsed
}
