/**
 * build.mts: Sophia Cluster's public site, content/**\/*.md -> dist/.
 *
 *   pnpm --filter @shrubbery/cluster build                    # -> apps/cluster/dist
 *   CLUSTER_BUILD_COMMIT=<40 hex> tsx build.mts --out <dir>   # what `ship cluster` runs
 *
 * Pages (CloudFront maps each URL to a file: /catalog -> catalog/index.html, no redirect; a path that names no file
 * answers 404 with 404.html, never a fallback page):
 *   content/index.md          -> dist/index.html           /
 *   content/catalog.md        -> dist/catalog/index.html   /catalog and /catalog/
 *   content/catalog/index.md  -> dist/catalog/index.html   (the same page: having both is refused)
 *   content/a/b.md            -> dist/a/b/index.html       /a/b
 *   content/404.md            -> dist/404.html             every path that is not a file (a real 404, never a fallback)
 *   src/site.css              -> dist/assets/site.<sha256:12>.css, immutable on CloudFront: a new name for new bytes
 *
 * Each page is markdown with a small front matter block (`title:` required, `description:` optional).
 * Pages generated from graph documents later are written into content/ in that same shape; nothing here changes.
 * Raw HTML inside markdown is escaped, never rendered, so content exported from a graph cannot inject markup.
 *
 * The output is deterministic (no timestamps): one commit and one content tree give the same bytes, which keeps
 * a publisher's asset collision check and a public index check meaningful.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Marked, type Tokens } from 'marked'
import { escapeHtml, renderPage } from './src/layout.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/
const COMMIT = /^[0-9a-f]{40}$/

export interface BuildOptions {
  contentDir?: string
  cssFile?: string
  /** Static files copied byte for byte under /assets/ (default src/static). */
  staticDir?: string
  outDir?: string
  /** Exact 40-hex commit, or "unknown". Defaults to resolveCommit(). */
  commit?: string
}

export interface BuildResult {
  outDir: string
  commit: string
  stylesheet: string
  /** Output paths relative to outDir, sorted. */
  files: string[]
}

/** CLUSTER_BUILD_COMMIT, else CodeBuild's resolved source version, else `git rev-parse HEAD`, else "unknown". */
export function resolveCommit(env: NodeJS.ProcessEnv = process.env): string {
  const given = env.CLUSTER_BUILD_COMMIT || env.CODEBUILD_RESOLVED_SOURCE_VERSION
  if (given) {
    if (!COMMIT.test(given)) throw new Error(`build commit must be 40 lowercase hex, got ${JSON.stringify(given)}`)
    return given
  }
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return COMMIT.test(head) ? head : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function parseFrontMatter(source: string, origin: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) throw new Error(`${origin}: front matter (--- title: ... ---) is required`)
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (!pair) throw new Error(`${origin}: unreadable front matter line ${JSON.stringify(line)}`)
    meta[pair[1]] = pair[2].trim()
  }
  if (!meta.title) throw new Error(`${origin}: front matter needs a title`)
  return { meta, body: source.slice(match[0].length) }
}

/** content-relative markdown path -> dist-relative html path. */
export function pagePath(source: string): string {
  const parts = source.split('/')
  const last = parts.pop()!
  if (!last.endsWith('.md')) throw new Error(`${source}: only .md files belong in content/`)
  const stem = last.slice(0, -3)
  for (const segment of [...parts, stem]) {
    if (!SEGMENT.test(segment)) throw new Error(`${source}: "${segment}" is not a clean URL segment (lowercase a-z 0-9 . _ -)`)
  }
  if (parts[0] === 'assets' || (parts.length === 0 && stem === 'assets')) throw new Error(`${source}: /assets/ is reserved for built files`)
  if (parts.length === 0 && stem === '404') return '404.html'
  if (stem === '404') throw new Error(`${source}: only content/404.md is the not-found page`)
  return [...parts, ...(stem === 'index' ? [] : [stem]), 'index.html'].join('/')
}

function markdownFiles(root: string, at = root): string[] {
  const found: string[] = []
  for (const name of readdirSync(at).sort()) {
    if (name.startsWith('.')) continue
    const path = join(at, name)
    if (statSync(path).isDirectory()) found.push(...markdownFiles(root, path))
    else found.push(relative(root, path).split(sep).join('/'))
  }
  return found
}

/**
 * The page body: everything before the first `## ` heading is the page's lead (its call to
 * action, a paragraph that is a single link, gets class "cta"); each `## ` heading opens a
 * <section class="part">. A section whose heading starts with "Draft:" is left out.
 */
export function renderBody(marked: Marked, body: string): string {
  const [lead, ...sections] = body.split(/^(?=## )/m)
  let html = (marked.parse(lead) as string).replace(/<p><a href="([^"]+)">([^<]+)<\/a><\/p>/, '<p class="cta"><a href="$1">$2</a></p>')
  for (const section of sections) {
    const heading = section.slice(3, section.indexOf('\n') === -1 ? undefined : section.indexOf('\n')).trim()
    if (/^draft:/i.test(heading)) continue
    const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    html += `<section class="part" id="${id}">\n${marked.parse(section) as string}</section>\n`
  }
  return html
}

function allFiles(root: string, at: string = root): string[] {
  const found: string[] = []
  for (const name of readdirSync(at).sort()) {
    const path = join(at, name)
    if (statSync(path).isDirectory()) found.push(...allFiles(root, path))
    else found.push(relative(root, path).split(sep).join('/'))
  }
  return found
}

function refuseDangerousOutDir(outDir: string): void {
  const forbidden = [resolve('/'), resolve(homedir()), HERE, resolve(HERE, '..'), resolve(HERE, '../..')]
  if (forbidden.includes(outDir) || HERE.startsWith(outDir + sep)) {
    throw new Error(`refusing to clear ${outDir}: the out directory must be a build directory of its own`)
  }
}

export function build(options: BuildOptions = {}): BuildResult {
  const contentDir = resolve(options.contentDir ?? join(HERE, 'content'))
  const cssFile = resolve(options.cssFile ?? join(HERE, 'src/site.css'))
  const outDir = resolve(options.outDir ?? join(HERE, 'dist'))
  const commit = options.commit ?? resolveCommit()
  if (commit !== 'unknown' && !COMMIT.test(commit)) throw new Error(`commit must be 40 lowercase hex or "unknown", got ${commit}`)
  refuseDangerousOutDir(outDir)

  const marked = new Marked({ gfm: true, async: false })
  marked.use({ renderer: { html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text) } })

  const css = readFileSync(cssFile)
  const stylesheet = `/assets/site.${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`
  const outputs = new Map<string, Buffer | string>([[stylesheet.slice(1), css]])
  // src/static/** is copied byte for byte to /assets/**. Assets are served as immutable, so every
  // static file carries its version in its name (dm-mono-5.3.0-latin-400.woff2, viable-v1.svg).
  const staticDir = resolve(options.staticDir ?? join(HERE, 'src/static'))
  if (existsSync(staticDir)) {
    for (const file of allFiles(staticDir)) outputs.set(`assets/${file}`, readFileSync(join(staticDir, file)))
  }
  const origins = new Map<string, string>()
  for (const source of markdownFiles(contentDir)) {
    const target = pagePath(source)
    const earlier = origins.get(target)
    if (earlier) throw new Error(`${source} and ${earlier} both become ${target}`)
    origins.set(target, source)
    const { meta, body } = parseFrontMatter(readFileSync(join(contentDir, source), 'utf8'), `content/${source}`)
    const bodyHtml = renderBody(marked, body)
    const feature = meta.feature
    if (feature !== undefined) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(feature)) throw new Error(`content/${source}: feature "${feature}" is not a clean name (a-z 0-9 -)`)
      for (const file of [`features/${feature}.js`, `features/${feature}.svg`, 'features/mount-v1.js']) {
        if (!existsSync(join(staticDir, file))) throw new Error(`content/${source}: feature ${feature} needs src/static/${file}`)
      }
    }
    const page = target === 'index.html' ? 'index' : target.replace(/(\/index)?\.html$/, '').replaceAll('/', '-')
    outputs.set(target, renderPage({ title: meta.title, description: meta.description, bodyHtml, feature, page }, { commit, stylesheet }))
  }
  for (const required of ['index.html', '404.html']) {
    if (!outputs.has(required)) throw new Error(`content/ must produce ${required} (content/${required.replace('.html', '.md')})`)
  }

  rmSync(outDir, { recursive: true, force: true })
  for (const [path, bytes] of outputs) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true })
    writeFileSync(join(outDir, path), bytes)
  }
  return { outDir, commit, stylesheet, files: [...outputs.keys()].sort() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--out')
  if (args.length !== 0 && !(args.length === 2 && at === 0)) {
    console.error('usage: tsx build.mts [--out <dir>]')
    process.exit(2)
  }
  const result = build({ outDir: at === 0 ? args[1] : undefined })
  console.log(JSON.stringify(result))
}
