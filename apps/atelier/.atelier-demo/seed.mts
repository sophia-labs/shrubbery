// Seed a :ux:control channel into the running gardend cell using the SHIPPED
// serializer, then read it back — all in Node so no shell string-mangling.
// Proves the real rdf_load -> rdf_dump round-trip before the browser relies on it.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  serializeVtuberControlChannelsToTriples,
  triplesToNT,
  uxControlGraphIri,
  type VtuberControlChannel,
} from '@shrubbery/nucleus'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(here, '..', '.gardend-loopback.json'), 'utf8'))
const { apiUrl, token, graphId } = manifest

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${apiUrl}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const json = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: unknown }
  if (json.error) throw new Error(JSON.stringify(json.error))
  return json.result?.content?.[0]?.text
}

const graphIri = uxControlGraphIri(graphId)
const channel: VtuberControlChannel = {
  id: 'demo-avatar',
  label: 'Atelier demo avatar',
  targetComponent: 'mn-vtuber',
  expression: 'focused',
  appearance: { accentTint: '#7c5cff', eyeTint: '#39d0d8', hairTint: '#e86a92', outfitTint: '#2f5d8a' },
}
const nt = triplesToNT(serializeVtuberControlChannelsToTriples([channel]))

console.log('control graph:', graphIri)
const loaded = await call('rdf_load', { graphId, data: nt, format: 'application/n-triples', targetGraphIri: graphIri })
console.log('rdf_load →', loaded)
const dumped = await call('rdf_dump', { graphId, sourceGraphIri: graphIri, format: 'application/n-triples' })
console.log('rdf_dump ↓\n' + String(dumped))
