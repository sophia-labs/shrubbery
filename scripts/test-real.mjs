#!/usr/bin/env node
// test-real.mjs — `pnpm test:real`: the suites that need a REAL gardend, in a real browser, in one command.
//
//   pnpm test:real                    # the real-gardend suites, Chromium and WebKit
//   pnpm test:real --engine webkit    # one engine
//   pnpm test:real --only find        # suites whose name contains "find"
//   pnpm test:real --list             # what would run
//   pnpm test:real --all              # also the long existing browser harnesses (test:browser, test:browser-verified)
//   pnpm test:real --no-install       # skip the Playwright browser check
//
// Which gardend: the first that exists of
//   1. GARDEN_BIN                       a gardend you built or downloaded
//   2. the prebuilt for the pinned sha  scripts/gardend.pin (one line: a full commit sha of sophia-labs/gardend), or
//                                       GARDEND_REV; with neither, the newest prebuilt on the `main-latest` prerelease.
//                                       Fetched once into .gardend-cache/ (gitignored). GitHub builds one for every
//                                       commit on gardend's main (gardend-<sha>-<target>).
//   3. a sibling build                  ../gardend (or ../garden) /src-tauri/target/release/examples/gardend
// No Rust toolchain is needed for 2. Each suite starts its own gardend on a scratch profile and a random port, and
// removes it afterwards. Nothing here touches ~/sophia or a gardend you already have running.
//
// No mocks: every suite here drives the real binary. A missing gardend is an error with the way to get one, never a skip.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.gardend-cache')
const GARDEND_REPO = 'sophia-labs/gardend'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const engines = (() => {
  const wanted = option('--engine') ?? 'both'
  if (wanted === 'both') return ['chromium', 'webkit']
  if (wanted === 'chromium' || wanted === 'webkit') return [wanted]
  throw new Error('--engine must be chromium, webkit or both')
})()

// A suite is a package script that reads SHRUBBERY_BROWSER_ENGINE (or runs one engine only).
const SUITES = [
  { name: 'editor-arrow-across-blocks', filter: '@shrubbery/organism', script: 'test:editor-arrow-across-blocks', engines: ['chromium', 'webkit'] },
  { name: 'editor-find', filter: '@shrubbery/organism', script: 'test:editor-find', engines: ['chromium', 'webkit'] },
  { name: 'value-gutter-zone', filter: '@shrubbery/organism', script: 'test:value-gutter-zone', engines: ['chromium', 'webkit'] },
  { name: 'value-gutter-renew', filter: '@shrubbery/organism', script: 'test:value-gutter-renew', engines: ['chromium', 'webkit'] },
  // The dev server sends no CSP, so the app's own is checked twice: the style policy on the dev server, and the
  // built SPA served with the desktop app's exact policy read from gardend's src-tauri/tauri.conf.json.
  { name: 'app-csp-styles', filter: '@shrubbery/organism', script: 'test:app-csp-styles', engines: ['chromium', 'webkit'] },
  { name: 'app-csp-built', filter: '@shrubbery/organism', script: 'test:app-csp-built', engines: ['webkit', 'chromium'] },
]
const ALL_SUITES = [
  { name: 'organism-browser', filter: '@shrubbery/organism', script: 'test:browser', engines: ['chromium'] },
  { name: 'organism-browser-verified', filter: '@shrubbery/organism', script: 'test:browser-verified', engines: ['chromium'] },
  { name: 'hoja-browser', filter: '@shrubbery/hoja-app', script: 'test:browser', engines: ['chromium'] },
]
// The vitest suites that spawn a real gardend (the *.integration.test.ts files).
const INTEGRATION = { name: 'integration', command: ['pnpm', ['-r', '--no-bail', 'exec', 'node', '../../scripts/vitest-if-present.mjs', 'run', 'integration.test', '--passWithNoTests']] }

const selected = (flag('--all') ? [...SUITES, ...ALL_SUITES] : SUITES).filter((s) => {
  const only = option('--only')
  return !only || s.name.includes(only)
})
const plan = []
if (!option('--only') || INTEGRATION.name.includes(option('--only'))) plan.push({ ...INTEGRATION, engine: null })
for (const suite of selected) for (const engine of engines) if (suite.engines.includes(engine)) plan.push({ ...suite, engine })

if (flag('--list')) {
  for (const p of plan) console.log(`${p.name}${p.engine ? ` (${p.engine})` : ''}`)
  process.exit(0)
}

// ---- the gardend binary ----------------------------------------------------------------------------------------------

function targetTriple() {
  const { platform, arch } = process
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu'
  return null
}

function pinnedRev() {
  if (process.env.GARDEND_REV) return process.env.GARDEND_REV.trim()
  const pin = join(ROOT, 'scripts', 'gardend.pin')
  if (!existsSync(pin)) return null
  const line = readFileSync(pin, 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  return line || null
}

async function fetchPrebuilt() {
  const target = targetTriple()
  if (!target) return null
  const rev = pinnedRev()
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'shrubbery-test-real' }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${GARDEND_REPO}/releases/tags/main-latest`, { headers })
  if (!res.ok) throw new Error(`could not list the main-latest prebuilts (HTTP ${res.status})`)
  const release = await res.json()
  const assets = (release.assets ?? []).filter((a) => a.name.endsWith(`-${target}`) && a.name.startsWith('gardend-'))
  const asset = rev
    ? assets.find((a) => a.name === `gardend-${rev}-${target}`)
    : assets.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (!asset) {
    throw new Error(rev
      ? `no prebuilt gardend-${rev}-${target} on ${GARDEND_REPO} main-latest (it keeps the newest few dozen; bump scripts/gardend.pin)`
      : `no prebuilt gardend for ${target} on ${GARDEND_REPO} main-latest`)
  }
  const dest = join(CACHE, asset.name)
  if (existsSync(dest)) return dest
  mkdirSync(CACHE, { recursive: true })
  console.log(`[test:real] fetching ${asset.name} (${Math.round(asset.size / 1e6)} MB)`)
  const dl = await fetch(asset.browser_download_url, { headers: { 'user-agent': headers['user-agent'] } })
  if (!dl.ok) throw new Error(`download failed (HTTP ${dl.status})`)
  const tmp = `${dest}.part`
  writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()))
  chmodSync(tmp, 0o755)
  renameSync(tmp, dest)
  return dest
}

async function resolveGardend() {
  if (process.env.GARDEN_BIN) {
    if (!existsSync(process.env.GARDEN_BIN)) throw new Error(`GARDEN_BIN does not exist: ${process.env.GARDEN_BIN}`)
    return process.env.GARDEN_BIN
  }
  let fetchError = null
  try {
    const fetched = await fetchPrebuilt()
    if (fetched) return fetched
  } catch (error) {
    fetchError = error
  }
  for (const sibling of ['gardend', 'garden']) {
    const candidate = resolve(ROOT, '..', sibling, 'src-tauri/target/release/examples/gardend')
    if (existsSync(candidate)) return candidate
  }
  throw new Error([
    `no gardend to test against${fetchError ? ` (${fetchError.message})` : ''}.`,
    'Any one of these fixes it:',
    '  - set GARDEN_BIN=/path/to/gardend',
    `  - let this script fetch the prebuilt (needs network access to github.com/${GARDEND_REPO})`,
    '  - build it beside this checkout: git clone git@github.com:sophia-labs/gardend.git ../gardend, then in ../gardend:',
    '      cargo build --release --manifest-path src-tauri/Cargo.toml --no-default-features --features headless --example gardend',
    '    (or use the local build service described in gardend\'s CONTRIBUTING.md, which keeps a warm cargo cache)',
  ].join('\n'))
}

// ---- run -------------------------------------------------------------------------------------------------------------

function run(command, commandArgs, env = {}) {
  const started = Date.now()
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  return { ok: result.status === 0, seconds: Math.round((Date.now() - started) / 1000) }
}

const bin = await resolveGardend().catch((error) => {
  console.error(`[test:real] ${error.message}`)
  process.exit(2)
})
const version = spawnSync(bin, ['--version'], { encoding: 'utf8' })
console.log(`[test:real] gardend: ${bin}${version.status === 0 ? ` (${version.stdout.trim()})` : ''}`)

if (!flag('--no-install')) {
  const needed = [...new Set(plan.flatMap((p) => (p.engine ? [p.engine] : [])))]
  if (needed.length > 0) {
    const install = ['--filter', '@shrubbery/organism', 'exec', 'playwright', 'install', ...(process.env.CI ? ['--with-deps'] : []), ...needed]
    console.log(`[test:real] playwright install ${needed.join(' ')}`)
    if (!run('pnpm', install).ok) {
      console.error('[test:real] could not install the Playwright browsers')
      process.exit(2)
    }
  }
}

const results = []
for (const item of plan) {
  const label = `${item.name}${item.engine ? ` (${item.engine})` : ''}`
  console.log(`\n[test:real] ---- ${label}`)
  const env = { GARDEN_BIN: bin, ...(item.engine ? { SHRUBBERY_BROWSER_ENGINE: item.engine } : {}) }
  const outcome = item.command
    ? run(item.command[0], item.command[1], env)
    : run('pnpm', ['--filter', item.filter, 'run', item.script], env)
  results.push({ label, ...outcome })
}

console.log('\n[test:real] summary')
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}  ${r.seconds}s`)
const failed = results.filter((r) => !r.ok)
console.log(`[test:real] ${results.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length === 0 ? 0 : 1)
