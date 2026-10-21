// node scripts/bundle.mjs --out <dir>
//
// One directory that is a public-mode gardend's `siteDir` for the ovillo graph:
// the built app (reading the graph from the same origin's /mcp), the graph's
// files (media/, scores/, receipts/, llms.txt and the markdown twin, as the
// graph builder wrote them), the graph itself as N-Triples (graph/, for
// ?source=nt and for agents), and the engines in wasm/. The page carries the
// deploy CSP as a meta tag (own-origin scripts, 'wasm-unsafe-eval', blob:
// workers, inline styles), so it runs under it wherever it is served; the
// front proxy sends the same policy as a header. Writes MANIFEST.sha256 and
// bundle.json (what went in, from where).
//
// Needs: OVILLO_OUT (the graph builder's out/), OVILLO_MUS_WASM, OVILLO_BENCH_WASM, OVILLO_TRACT_WASM.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const outDir = resolve(arg('out') ?? join(appDir, 'bundle'))
const graphOut = process.env.OVILLO_OUT && resolve(process.env.OVILLO_OUT)
const need = ['OVILLO_OUT', 'OVILLO_MUS_WASM', 'OVILLO_BENCH_WASM', 'OVILLO_TRACT_WASM'].filter((k) => !process.env[k] || !existsSync(process.env[k]))
if (need.length) {
  console.error(`bundle: set ${need.join(', ')} (the graph builder's out/ and the three built engines)`)
  process.exit(2)
}

export const DEPLOY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const git = (args, cwd) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim() } catch { return '' }
}

// 1. The app, built to read the graph from this origin's gardend.
console.log('bundle: building the app (source: gardend)…')
execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: appDir, stdio: 'inherit', env: { ...process.env, VITE_OVILLO_SOURCE: 'gardend' } })
const dist = join(appDir, 'dist')

// 2. Assemble: the graph's files first, then the app over them (its index.html replaces the builder's stand-in).
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(join(graphOut, 'site'), outDir, { recursive: true })
cpSync(dist, outDir, { recursive: true })
mkdirSync(join(outDir, 'graph'), { recursive: true })
cpSync(join(graphOut, 'ovillo.nt'), join(outDir, 'graph/ovillo.nt'))
if (existsSync(join(graphOut, 'ux-config.nt'))) cpSync(join(graphOut, 'ux-config.nt'), join(outDir, 'graph/ux-config.nt'))

// 3. The deploy CSP rides in the page.
const indexPath = join(outDir, 'index.html')
const index = readFileSync(indexPath, 'utf8')
if (!index.includes('http-equiv="Content-Security-Policy"')) {
  writeFileSync(indexPath, index.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${DEPLOY_CSP}" />`))
}

// 4. What is in it, and where it came from.
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(p)
  }
}
walk(outDir)
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const manifest = files.map((p) => `${sha(p)}  ${relative(outDir, p)}`).join('\n') + '\n'
const bytes = files.reduce((n, p) => n + statSync(p).size, 0)
const describe = {
  built: new Date().toISOString(),
  app: { repo: 'sophia-labs/shrubbery', path: 'apps/ovillo', commit: git(['rev-parse', 'HEAD'], appDir), dirty: git(['status', '--porcelain', '--', '.'], appDir) !== '' },
  graph: { out: graphOut, commit: git(['rev-parse', 'HEAD'], graphOut) },
  wasm: Object.fromEntries(['mus_wasm.wasm', 'ovillo_web.wasm', 'tract.wasm'].map((n) => [n, `sha256:${sha(join(outDir, 'wasm', n))}`])),
  csp: DEPLOY_CSP,
  files: files.length,
  bytes,
}
writeFileSync(join(outDir, 'MANIFEST.sha256'), manifest)
writeFileSync(join(outDir, 'bundle.json'), `${JSON.stringify(describe, null, 2)}\n`)
console.log(`bundle: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB -> ${outDir}`)
