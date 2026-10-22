/**
 * MUS as a lowlight (highlight.js) grammar, and the `CodeHighlighter` Hoja's code view takes.
 *
 * The score language (Ovillo's `SPEC.md`, `SPEC-TAB.md`) read line by line:
 *
 *   # tempo: 96    time: 4/4           a header: keys as meta, values as strings
 *   # text @b4: one fretted line       a text comment: its bar as a number, the prose as a comment
 *   #   gt.p = thumb (treble, pos=0.10) an instrument: its abbreviation, its params
 *   bar 4 [chord=Am]: gt.v=A3e@3:2[ho] a bar: the keyword, its number and meta, then each track's tokens
 *
 * and inside a bar, per token: the pitch (`A3`, `C#4`, `Bb-1`, `E4+23`), the duration (`q`, `h.`, `h~e`, `e3`,
 * `q{5:4}`), the tab position (`@string:fret`), the flags and params (`[ho]`, `[gain=-6,pm=0.6]`), dynamics and hairpins
 * (`{p}`, `{<}`), chords (`<A3@3:2 C4@2:1>q`), rests (`Rq`), pattern repetitions (`( … ×4)`), and `-` / `tacet`.
 *
 * Classes are highlight.js's standard scopes (`hljs-title`, `hljs-type`, ...), so any hljs theme colours it; Hoja's MUS
 * mode ships its own from house tokens (`musHighlightStyles`).
 */
import { createLowlight } from 'lowlight'
import type { LanguageFn } from 'highlight.js'
import type { CodeHighlighter, CodeHighlightRange } from '@shrubbery/editor-kernel'

const PITCH = /[A-G](?:bb|##|b|#|n|x)?-?\d+(?:[+-]\d+)?/
const DURATION_UNIT = /(?:ww|[whqestx])\.*(?:\{\d+:\d+\}|[35679](?![\d:]))?/

export const musLanguage: LanguageFn = () => {
  const dynamic = { scope: 'built_in', match: /\{(?:<|>|\||[a-z]+)\}/ }
  const tuplet = { scope: 'type', match: /\{\d+:\d+\}/ }
  const position = { scope: 'number', match: /@\d+:\d+/ }
  const params = {
    scope: 'params',
    begin: /\[/,
    end: /\]/,
    contains: [
      { scope: 'attr', match: /[a-z][\w-]*(?==)/ },
      { scope: 'number', match: /-?\d+(?:\.\d+)?/ },
      { scope: 'attr', match: /[a-z][\w-]*/ },
    ],
  }
  const lyric = { scope: 'string', begin: /"/, end: /"/ }
  // A pitch, then its duration (if any): one token, two scopes.
  const note = {
    match: [new RegExp(`(?<![\\w@:])${PITCH.source}`), new RegExp(`(?:${DURATION_UNIT.source}(?:~${DURATION_UNIT.source})*)?`)],
    scope: { 1: 'title', 2: 'type' },
  }
  const rest = {
    match: [/(?<![\w@:])R/, new RegExp(`(?:${DURATION_UNIT.source}(?:~${DURATION_UNIT.source})*)?`)],
    scope: { 1: 'literal', 2: 'type' },
  }
  const unpitched = {
    match: [/(?<![\w@:])X/, new RegExp(`(?:${DURATION_UNIT.source}(?:~${DURATION_UNIT.source})*)?`)],
    scope: { 1: 'literal', 2: 'type' },
  }
  const chord = {
    begin: /</,
    end: />/,
    beginScope: 'punctuation',
    endScope: 'punctuation',
    contains: [{ scope: 'title', match: PITCH }, position],
  }
  // A chord's duration follows its closing `>`.
  const chordDuration = { scope: 'type', match: new RegExp(`(?<=>)${DURATION_UNIT.source}(?:~${DURATION_UNIT.source})*`) }
  const repeat = { scope: 'operator', match: /\(|×\s*\d+\)|\)|~|->/ }
  const track = { match: [/(?<![\w.])[A-Za-z][\w.]*/, /=/], scope: { 1: 'variable', 2: 'operator' } }
  const tacet = { scope: 'literal', match: /(?<=[=:\s])(?:-|tacet)(?=\s|$)/ }
  const bar = {
    begin: /^[ \t]*bars?(?=[ \t])/,
    beginScope: 'keyword',
    end: /$/,
    contains: [
      { scope: 'number', match: /(?<=bars?[ \t]+)\d+(?:[ \t]*-[ \t]*\d+)?/ },
      { scope: 'meta', begin: /(?<=\d[ \t]*)\[/, end: /\]/ },
      {
        begin: /:/,
        beginScope: 'punctuation',
        end: /$/,
        endsParent: true,
        contains: [dynamic, tuplet, track, chord, chordDuration, params, position, lyric, note, rest, unpitched, repeat, tacet],
      },
    ],
  }
  const instrument = {
    begin: /^#[ \t]+(?=[\w.]+[ \t]*=)/,
    beginScope: 'comment',
    end: /$/,
    contains: [
      { scope: 'variable', match: /(?<=^#[ \t]+)[\w.]+/ },
      { scope: 'attr', match: /[a-z][\w-]*(?==)/ },
      { scope: 'number', match: /-?\d+(?:\.\d+)?/ },
      { scope: 'title', match: PITCH },
      { scope: 'string', match: /(?<==)[\w./-]+/ },
    ],
  }
  const text = {
    match: [/^#[ \t]*(?:text|note|section)\b[^:\n]*:/, /.*/],
    scope: { 1: 'meta', 2: 'comment' },
  }
  const header = {
    begin: /^#[ \t]*(?=[\w-]+[ \t]*:)/,
    beginScope: 'meta',
    end: /$/,
    contains: [
      { scope: 'meta', match: /[\w-]+(?=[ \t]*:)/ },
      { scope: 'string', match: /[^\s:][^:]*?(?=[ \t]{2,}[\w-]+[ \t]*:|$)/ },
    ],
  }
  const comment = { scope: 'comment', match: /^#.*/ }
  return {
    name: 'MUS',
    aliases: ['mus', 'mus-t'],
    case_insensitive: false,
    contains: [bar, text, instrument, header, comment],
  }
}

const lowlight = createLowlight()
lowlight.register({ mus: musLanguage })

interface HastText { readonly type: 'text'; readonly value: string }
interface HastElement { readonly type: 'element'; readonly properties?: { readonly className?: unknown }; readonly children: readonly HastNode[] }
type HastNode = HastText | HastElement | { readonly type: string }

/** Offsets + `hljs-*` classes for a MUS score (the kernel turns them into decorations). */
export function highlightMus(code: string): CodeHighlightRange[] {
  const tree = lowlight.highlight('mus', code)
  const out: CodeHighlightRange[] = []
  let offset = 0
  const walk = (nodes: readonly HastNode[], classes: readonly string[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const length = (node as HastText).value.length
        if (classes.length && length) out.push({ from: offset, to: offset + length, className: classes.join(' ') })
        offset += length
      } else if (node.type === 'element') {
        const el = node as HastElement
        const own = Array.isArray(el.properties?.className) ? (el.properties!.className as unknown[]).map(String) : []
        walk(el.children, own.length ? [...classes, ...own] : classes)
      }
    }
  }
  walk(tree.children as readonly HastNode[], [])
  return out
}

/**
 * Hoja's code-view seam for MUS: colours ```` ```mus ```` fences (and `mus-t`), and leaves every other language to
 * `fallback` (the host's own highlighter), or uncoloured.
 */
export function createMusHighlighter(fallback: CodeHighlighter | null = null): CodeHighlighter {
  return (code, language) => {
    const lang = language?.trim().toLowerCase().split(/\s+/) ?? []
    if (lang.includes('mus') || lang.includes('mus-t')) return highlightMus(code)
    return fallback ? fallback(code, language) : null
  }
}

export const musHighlighter: CodeHighlighter = createMusHighlighter()
