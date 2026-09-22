import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'

const executableFixtureTest = process.platform === 'win32' ? it.skip : it

describe('spawnGardend process isolation', () => {
  executableFixtureTest('contains process-relative runtime files inside the disposable profile', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'shrubbery-fake-gardend.'))
    const binary = join(fixtureDir, 'gardend.mjs')
    writeFileSync(binary, `#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const profileDir = process.env.GARDEN_PROFILE_DIR
const token = process.env.GARDEN_LOOPBACK_TOKEN
if (!profileDir || !token) process.exit(2)

mkdirSync('.fastembed_cache')
writeFileSync(join(profileDir, 'child-observation.json'), JSON.stringify({ cwd: process.cwd() }))

const server = createServer((_request, response) => {
  response.statusCode = 200
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.end('ok')
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') process.exit(3)
  const apiUrl = \`http://127.0.0.1:\${address.port}\`
  writeFileSync(join(profileDir, 'loopback.json'), JSON.stringify({
    port: address.port,
    apiUrl,
    mcpUrl: \`\${apiUrl}/mcp\`,
    token,
  }))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`)
    chmodSync(binary, 0o755)

    let cell: GardendCell | null = null
    try {
      cell = await spawnGardend({ bin: binary, readyTimeoutMs: 5_000 })
      const observation = JSON.parse(
        readFileSync(join(cell.profileDir, 'child-observation.json'), 'utf8'),
      ) as { cwd: string }
      expect(realpathSync(observation.cwd)).toBe(realpathSync(cell.profileDir))
      expect(existsSync(join(cell.profileDir, '.fastembed_cache'))).toBe(true)
    } finally {
      await cell?.kill()
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})
