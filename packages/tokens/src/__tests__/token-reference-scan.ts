/**
 * Scanner behind the undefined-token lint (review P0.1, design §9). Pure, no
 * DOM, no mocks: it reads the real token CSS and the real component sources.
 *
 * WHAT IT FINDS. A `var(--mn-x …)` reference to a custom property that is
 * defined nowhere that can reach it: not in the token layer (the files
 * `tokens.css` imports) and not in the component file that uses it. The review
 * found `var(--mn-color-accent-primary, #49785a)` painting a stray green in all
 * ten skin/theme combinations for exactly this reason: the name was defined
 * nowhere, so the literal fallback always won. A fallback does not make a
 * reference defined; it hides the fact that it is not.
 *
 * WHAT "THE COMPONENT THAT USES IT" MEANS. The same source file. A component
 * may declare its own knob (`:host { --mn-foo: 1px }`, or
 * `el.style.setProperty('--mn-foo', …)`) and read it; it may not read another
 * component's knob, and it may not read a name nobody declares.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The monorepo root: packages/tokens/src/__tests__ is four levels down. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const TOKEN_CSS_DIR = 'packages/tokens/css'
export const TOKEN_ENTRYPOINT = `${TOKEN_CSS_DIR}/tokens.css`

export interface TokenReference {
  readonly file: string
  readonly line: number
  readonly name: string
  /** True for `var(--mn-x, fallback)`: the reference survives being undefined, wrongly. */
  readonly hasFallback: boolean
}

/** Block and HTML comments become spaces; newlines survive so line numbers stay true. */
export function stripComments(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    // A `//` comment, but never the `//` of a URL (those follow a colon).
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (match, lead: string) => lead + blank(match.slice(lead.length)))
}

const DECLARATION = /(--mn-[a-z0-9-]*[a-z0-9])\s*:/g
const SET_PROPERTY = /setProperty\(\s*['"`](--mn-[a-z0-9-]*[a-z0-9])['"`]/g
const REFERENCE = /var\(\s*(--mn-[a-z0-9-]*[a-z0-9])\s*([,)])/g

/** Every `--mn-*` name a source declares: CSS declarations and `setProperty` calls. */
export function declaredNames(source: string): Set<string> {
  const clean = stripComments(source)
  const names = new Set<string>()
  for (const match of clean.matchAll(DECLARATION)) names.add(match[1]!)
  for (const match of clean.matchAll(SET_PROPERTY)) names.add(match[1]!)
  return names
}

/** Every `var(--mn-*)` reference in a source, with its line. Dynamic names (`--mn-x-${y}`) are not references. */
export function referencesIn(file: string, source: string): TokenReference[] {
  const found: TokenReference[] = []
  stripComments(source).split('\n').forEach((text, index) => {
    for (const match of text.matchAll(REFERENCE)) {
      found.push({ file, line: index + 1, name: match[1]!, hasFallback: match[2] === ',' })
    }
  })
  return found
}

/** References in `source` that neither the token layer nor `source` itself defines. */
export function undefinedReferences(file: string, source: string, layer: ReadonlySet<string>): TokenReference[] {
  const own = declaredNames(source)
  return referencesIn(file, source).filter(ref => !layer.has(ref.name) && !own.has(ref.name))
}

/** Index of the paren that closes the `(` at `open`, or -1. */
function closingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** A colour call split at its top-level commas (a `var(…, fallback)` keeps its comma). */
function topLevelArguments(inside: string): string[] {
  const args: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] === '(') depth++
    else if (inside[i] === ')') depth--
    else if (inside[i] === ',' && depth === 0) { args.push(inside.slice(start, i).trim()); start = i + 1 }
  }
  args.push(inside.slice(start).trim())
  return args
}

export interface ChannelCall {
  readonly line: number
  readonly call: string
}

/**
 * Every `rgb()`/`rgba()` that spends a channel triple the legacy way:
 * `rgba(var(--x-ch), 0.12)`, a `var()` as the first of exactly two arguments.
 * The token layer's channels (`--mn-color-accent-ch: 74 136 96`) are
 * space-separated, so that call expands to `rgba(74 136 96, 0.12)`, which is
 * invalid and computes to transparent where it is used. The valid form is
 * `rgb(var(--x-ch) / 0.12)`. (A call with a `var()` per channel,
 * `rgba(var(--r), var(--g), var(--b), a)`, has four arguments and is fine.)
 */
export function legacyChannelCalls(source: string): ChannelCall[] {
  const text = stripComments(source)
  const found: ChannelCall[] = []
  for (const start of text.matchAll(/\brgba?\(/gi)) {
    const open = start.index! + start[0].length - 1
    const end = closingParen(text, open)
    if (end < 0) continue
    const args = topLevelArguments(text.slice(open + 1, end))
    if (args.length === 2 && args[0]!.startsWith('var(')) {
      found.push({ line: text.slice(0, start.index!).split('\n').length, call: text.slice(start.index!, end + 1).replace(/\s+/g, ' ') })
    }
  }
  return found
}

/** The CSS files `tokens.css` imports, repo-relative, in cascade order. */
export function tokenLayerFiles(root = REPO_ROOT): string[] {
  const entry = readFileSync(join(root, TOKEN_ENTRYPOINT), 'utf8')
  return [...stripComments(entry).matchAll(/@import\s+['"]\.\/([\w.-]+\.css)['"]/g)]
    .map(match => `${TOKEN_CSS_DIR}/${match[1]}`)
}

/** Every `--mn-*` name the token layer defines. */
export function tokenLayerNames(root = REPO_ROOT): Set<string> {
  const names = new Set<string>()
  for (const file of tokenLayerFiles(root)) {
    for (const name of declaredNames(readFileSync(join(root, file), 'utf8'))) names.add(name)
  }
  return names
}

const SKIPPED_DIRECTORIES = new Set([
  'node_modules', 'dist', '.git', '.vite', 'coverage',
  '__tests__', '__generated__', 'fixtures',
  // Proof scripts and Storybook specimens are not stylesheets that ship.
  'scripts', 'stories', 'storybook',
])

/** A source that can carry a component stylesheet and ships (tests, typings and stories do not). */
function isComponentSource(path: string): boolean {
  if (!/\.(css|ts|mts|html)$/.test(path)) return false
  if (/\.d\.ts$/.test(path)) return false
  if (/\.(test|spec|stories)\.(ts|mts)$/.test(path) || /\.(browser|integration|probe|live)\.test\.ts$/.test(path)) return false
  return true
}

function walk(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory)) {
    // Build output (dist, dist-selfhost, ...) is not source: a build must not turn this test red.
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('dist-')) continue
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (isComponentSource(full)) out.push(full)
  }
}

/**
 * Every shipped source under `packages/` and `apps/`, keyed by repo-relative
 * POSIX path, excluding the token layer itself (which defines, and is checked
 * for closure separately).
 */
export function componentSources(root = REPO_ROOT): Map<string, string> {
  const files: string[] = []
  walk(join(root, 'packages'), files)
  walk(join(root, 'apps'), files)
  const sources = new Map<string, string>()
  for (const file of files.sort()) {
    const repoPath = relative(root, file).split(sep).join('/')
    if (repoPath.startsWith(`${TOKEN_CSS_DIR}/`)) continue
    sources.set(repoPath, readFileSync(file, 'utf8'))
  }
  return sources
}
