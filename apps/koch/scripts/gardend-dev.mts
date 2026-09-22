import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpClient } from '@shrubbery/source'
import { loopbackSeedTarget, spawnGardend } from '@shrubbery/source/node'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const manifestOut = join(appDir, '.gardend-loopback.json')
const graphId = process.env.GARDEN_GRAPH_ID ?? 'koch-morse'

async function main(): Promise<void> {
  process.stdout.write('[koch] starting a disposable real gardend cell…\n')
  const cell = await spawnGardend()
  const target = loopbackSeedTarget(cell)
  const client = new McpClient(target)

  await client.callTool('create_graph', {
    graph_id: graphId,
    title: 'Koch — Morse receiving and sending practice',
  })

  writeFileSync(
    manifestOut,
    JSON.stringify({
      apiUrl: cell.apiUrl,
      mcpUrl: cell.mcpUrl,
      token: cell.token,
      port: cell.manifest.port,
      graphId,
    }, null, 2),
  )

  process.stdout.write(`[koch] gardend ready: ${cell.apiUrl}\n`)
  process.stdout.write(`[koch] graph ready: ${graphId}\n`)
  process.stdout.write('[koch] now run: pnpm --filter @shrubbery/koch dev\n')
  process.stdout.write('[koch] open: http://localhost:5188\n')
  process.stdout.write('[koch] this convenience cell is disposable; Ctrl-C removes its temp profile.\n')

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    if (existsSync(manifestOut)) unlinkSync(manifestOut)
    await cell.kill()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  await new Promise<never>(() => undefined)
}

main().catch((error) => {
  process.stderr.write(`[koch] failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
