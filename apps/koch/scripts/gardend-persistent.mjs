import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const profileDir = process.env.GARDEN_PROFILE_DIR
  ? resolve(process.env.GARDEN_PROFILE_DIR)
  : join(appDir, '.koch-garden')
const runtimeManifest = join(profileDir, 'loopback.json')
const proxyManifest = join(appDir, '.gardend-loopback.json')
const graphId = process.env.GARDEN_GRAPH_ID ?? 'koch-morse'
const defaultBinary = resolve(scriptDir, '../../../../garden/src-tauri/target/release/examples/gardend')
const gardendBinary = process.env.GARDEN_BIN ?? defaultBinary

function readManifest(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed.apiUrl || !parsed.mcpUrl || !parsed.token) {
    throw new Error(`invalid gardend manifest at ${path}`)
  }
  return parsed
}

async function mcpCall(manifest, name, args) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  const url = new URL(manifest.mcpUrl)
  const response = await new Promise((resolveResponse, reject) => {
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${manifest.token}`,
        Origin: 'http://127.0.0.1',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolveResponse({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`gardend ${name}: HTTP ${response.status} — ${response.body.slice(0, 500)}`)
  }
  const payload = JSON.parse(response.body)
  if (payload.error) throw new Error(`gardend ${name}: ${JSON.stringify(payload.error)}`)
  return payload.result
}

async function main() {
  mkdirSync(profileDir, { recursive: true })
  if (existsSync(runtimeManifest)) unlinkSync(runtimeManifest)
  if (existsSync(proxyManifest)) unlinkSync(proxyManifest)

  const token = `koch-${randomUUID().replace(/-/g, '')}`
  if (!existsSync(gardendBinary)) {
    throw new Error(`gardend binary not found at ${gardendBinary}; set GARDEN_BIN to override`)
  }
  const child = spawn(gardendBinary, [], {
    cwd: profileDir,
    env: {
      ...process.env,
      GARDEN_PROFILE_DIR: profileDir,
      GARDEN_LOOPBACK_HOST: '127.0.0.1',
      GARDEN_LOOPBACK_PORT: '0',
      GARDEN_LOOPBACK_TOKEN: token,
    },
    stdio: 'inherit',
  })
  let exit = null
  child.on('exit', (code, signal) => { exit = { code, signal } })

  const deadline = Date.now() + 30_000
  while (!existsSync(runtimeManifest)) {
    if (exit) throw new Error(`gardend exited before writing loopback.json: ${JSON.stringify(exit)}`)
    if (Date.now() > deadline) throw new Error(`gardend did not write ${runtimeManifest} within 30s`)
    await sleep(120)
  }
  const manifest = readManifest(runtimeManifest)
  while (true) {
    try {
      const response = await fetch(`${manifest.apiUrl.replace(/\/$/, '')}/health`)
      if (response.ok) break
    } catch {
      // Cell is still starting.
    }
    if (exit) throw new Error(`gardend exited before becoming healthy: ${JSON.stringify(exit)}`)
    if (Date.now() > deadline) throw new Error('gardend did not become healthy within 30s')
    await sleep(120)
  }

  try {
    await mcpCall(manifest, 'create_graph', {
      graph_id: graphId,
      title: 'Koch — Morse receiving and sending practice',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/already exists|exists already|duplicate/i.test(message)) throw error
  }

  writeFileSync(proxyManifest, readFileSync(runtimeManifest))
  process.stdout.write(`\n[koch] persistent Garden ready at ${manifest.apiUrl}\n`)
  process.stdout.write(`[koch] profile: ${profileDir}\n`)
  process.stdout.write(`[koch] graph: ${graphId}\n`)
  process.stdout.write('[koch] progress survives app and gardend restarts. Ctrl-C stops the process but keeps the profile.\n\n')

  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    if (existsSync(proxyManifest)) unlinkSync(proxyManifest)
    child.kill('SIGTERM')
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise((resolveExit) => child.once('exit', () => resolveExit()))
  if (existsSync(proxyManifest)) unlinkSync(proxyManifest)
}

main().catch((error) => {
  process.stderr.write(`[koch] persistent cell failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
