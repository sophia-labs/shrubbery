import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { build, pagePath, resolveCommit } from '../build.mts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const scratch: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cluster-build-'))
  scratch.push(dir)
  return dir
}

function contentTree(files: Record<string, string>): string {
  const dir = tempDir()
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

function listFiles(root: string, at = root): string[] {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(root, join(at, entry.name)) : [join(at, entry.name).slice(root.length + 1)],
  )
}

const page = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n${body}\n`

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the committed site', () => {
  it('emits index.html, 404.html and one hashed stylesheet, with no JavaScript', () => {
    const out = join(tempDir(), 'dist')
    const result = build({ outDir: out, commit: COMMIT })
    const pages = result.files.filter((f) => !f.startsWith('assets/fonts/') && !f.startsWith('assets/drawings/') && !f.startsWith('assets/features/'))
    expect(pages.filter((f) => !f.startsWith('catalog/'))).toEqual(['404.html', result.stylesheet.slice(1), 'index.html'].sort())
    expect(pages).toContain('catalog/index.html')
    expect(result.files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs')).every((f) => f.startsWith('assets/features/'))).toBe(true)
    expect(result.stylesheet).toMatch(/^\/assets\/site\.[0-9a-f]{12}\.css$/)
    const index = readFileSync(join(out, 'index.html'), 'utf8')
    expect(index).toContain('<title>Sophia Cluster 1.0</title>')
    expect(index).toContain('<main class="page-index">')
    expect(index).toContain('<p class="cta"><a href="/catalog">')
    expect(index).toContain('<h1>Sophia Cluster 1.0</h1>')
    expect(index).toContain(`<code title="${COMMIT}">${COMMIT.slice(0, 12)}</code>`)
    // The masthead names the maker; the page names the product (never the product twice).
    expect(index).toContain('<header class="site"><a href="/">Sophia Labs</a></header>')
    // The footer is the serial number alone: no prose around it.
    expect(index).toContain(`<footer class="site"><code title="${COMMIT}">${COMMIT.slice(0, 12)}</code></footer>`)
    expect(index).not.toContain('Built from')
    expect(index).toContain(`<meta name="build-commit" content="${COMMIT}">`)
    expect(index).not.toMatch(/content-security-policy/i)
    expect(index).toContain(`href="${result.stylesheet}"`)
    expect(readFileSync(join(out, '404.html'), 'utf8')).toContain('<h1>Not found</h1>')
    // The only script on any page is the boot module of a live feature the page names.
    const boot = '<script type="module" src="/assets/features/mount-v1.js" data-feature="orb-v1">'
    for (const file of listFiles(out).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(join(out, file), 'utf8')
      expect(html.match(/<script[^>]*>/gi) ?? []).toEqual(file === 'index.html' ? [boot] : [])
    }
  })

  it('is deterministic: the same commit gives the same bytes', () => {
    const a = join(tempDir(), 'a')
    const b = join(tempDir(), 'b')
    build({ outDir: a, commit: COMMIT })
    build({ outDir: b, commit: COMMIT })
    expect(listFiles(a).sort()).toEqual(listFiles(b).sort())
    for (const file of listFiles(a)) expect(readFileSync(join(a, file))).toEqual(readFileSync(join(b, file)))
  })
})

describe('pages from content', () => {
  it('maps markdown to clean-URL directories and keeps 404 flat', () => {
    expect(pagePath('index.md')).toBe('index.html')
    expect(pagePath('404.md')).toBe('404.html')
    expect(pagePath('catalog.md')).toBe('catalog/index.html')
    expect(pagePath('catalog/index.md')).toBe('catalog/index.html')
    expect(pagePath('catalog/graphs.md')).toBe('catalog/graphs/index.html')
  })

  it('refuses names that would not be clean URLs, the reserved /assets/, and stray files', () => {
    expect(() => pagePath('Catalog.md')).toThrow(/clean URL segment/)
    expect(() => pagePath('a b.md')).toThrow(/clean URL segment/)
    expect(() => pagePath('assets/x.md')).toThrow(/reserved/)
    expect(() => pagePath('catalog/404.md')).toThrow(/not-found page/)
    expect(() => pagePath('logo.png')).toThrow(/only \.md/)
  })

  it('builds a nested tree with root-absolute links and refuses two sources for one page', () => {
    const content = contentTree({
      'index.md': page('Home', '# Home\n\n[Catalogue](/catalog)'),
      '404.md': page('Not found', '# Not found'),
      'catalog.md': page('Catalogue', '# Catalogue'),
      'catalog/graphs.md': page('Graphs', '# Graphs'),
    })
    const out = join(tempDir(), 'dist')
    const result = build({ contentDir: content, outDir: out, commit: COMMIT })
    expect(result.files).toContain('catalog/index.html')
    expect(result.files).toContain('catalog/graphs/index.html')
    expect(readFileSync(join(out, 'catalog/graphs/index.html'), 'utf8')).toContain(`href="${result.stylesheet}"`)

    writeFileSync(join(content, 'catalog/index.md'), page('Again', '# Again'))
    expect(() => build({ contentDir: content, outDir: out, commit: COMMIT })).toThrow(/both become catalog\/index\.html/)
  })

  it('escapes raw HTML in markdown instead of rendering it', () => {
    const content = contentTree({
      'index.md': page('Home', '# Home\n\n<script>alert(1)</script>\n\n<b>bold</b>'),
      '404.md': page('Not found', '# Not found'),
    })
    const out = join(tempDir(), 'dist')
    build({ contentDir: content, outDir: out, commit: COMMIT })
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('requires front matter with a title, and both index and 404 pages', () => {
    const out = join(tempDir(), 'dist')
    const noTitle = contentTree({ 'index.md': '# Home\n', '404.md': page('Not found', '# Not found') })
    expect(() => build({ contentDir: noTitle, outDir: out, commit: COMMIT })).toThrow(/front matter/)
    const no404 = contentTree({ 'index.md': page('Home', '# Home') })
    expect(() => build({ contentDir: no404, outDir: out, commit: COMMIT })).toThrow(/404\.html/)
  })
})

describe('static assets', () => {
  it('copies src/static byte for byte under /assets/', () => {
    const out = tempDir()
    const result = build({ outDir: out, commit: COMMIT })
    expect(result.files).toContain('assets/fonts/dm-mono-5.3.0-latin-400.woff2')
    const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'static', 'fonts', 'dm-mono-5.3.0-latin-400.woff2')
    expect(readFileSync(join(out, 'assets/fonts/dm-mono-5.3.0-latin-400.woff2')).equals(readFileSync(here))).toBe(true)
    expect(result.files).toContain('assets/fonts/dm-mono-5.3.0-OFL.txt')
  })
})

describe('a page feature', () => {
  function site(feature: string | null) {
    const root = tempDir()
    const content = join(root, 'content')
    const statics = join(root, 'static')
    mkdirSync(content, { recursive: true })
    mkdirSync(join(statics, 'features'), { recursive: true })
    writeFileSync(join(content, 'index.md'), `---\ntitle: Front\n${feature ? `feature: ${feature}\n` : ''}---\n\n# Front\n`)
    writeFileSync(join(content, '404.md'), '---\ntitle: Not found\n---\n\n# Not found\n')
    writeFileSync(join(statics, 'features', 'orb-v1.js'), 'export function mount() { return () => {} }\n')
    writeFileSync(join(statics, 'features', 'orb-v1.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
    writeFileSync(join(statics, 'features', 'mount-v1.js'), '// boot\n')
    return { content, statics, out: join(root, 'dist') }
  }

  it('puts the still frame in the page and boots the live one, only when asked', () => {
    const s = site('orb-v1')
    build({ contentDir: s.content, staticDir: s.statics, outDir: s.out, commit: COMMIT })
    const index = readFileSync(join(s.out, 'index.html'), 'utf8')
    expect(index).toContain('<figure class="feature" aria-hidden="true"><img src="/assets/features/orb-v1.svg" alt=""></figure>\n</main>')
    expect(index).toContain('<script type="module" src="/assets/features/mount-v1.js" data-feature="orb-v1"></script>')
    const notFound = readFileSync(join(s.out, '404.html'), 'utf8')
    expect(notFound).not.toContain('<script')
    expect(notFound).not.toContain('figure')
  })

  it('refuses a feature whose files are missing or whose name is not clean', () => {
    const missing = site('ghost-v1')
    expect(() => build({ contentDir: missing.content, staticDir: missing.statics, outDir: missing.out, commit: COMMIT })).toThrow(/ghost-v1\.js/)
    const dirty = site('../orb-v1')
    expect(() => build({ contentDir: dirty.content, staticDir: dirty.statics, outDir: dirty.out, commit: COMMIT })).toThrow(/feature/)
  })
})

describe('the build commit', () => {
  it('takes an exact commit from the environment and refuses anything else', () => {
    expect(resolveCommit({ CLUSTER_BUILD_COMMIT: COMMIT })).toBe(COMMIT)
    expect(resolveCommit({ CODEBUILD_RESOLVED_SOURCE_VERSION: COMMIT })).toBe(COMMIT)
    expect(() => resolveCommit({ CLUSTER_BUILD_COMMIT: 'main' })).toThrow(/40 lowercase hex/)
  })

  it('falls back to the checkout HEAD', () => {
    expect(resolveCommit({})).toMatch(/^([0-9a-f]{40}|unknown)$/)
  })
})
