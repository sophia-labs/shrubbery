import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { curriculumRecords, KOCH_VOCAB } from '../src/vocabulary.js'

function argument(name: string): string {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : args.find(candidate => candidate.startsWith(`${name}=`))?.slice(name.length + 1)
  if (!value) throw new Error(`${name} is required`)
  return value
}

const graphId = argument('--graph')
const sourceRevision = argument('--source-revision')
const output = resolve(argument('--out'))
if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error('--source-revision must be a 40-character Git commit')

const manifest = {
  schema: 'sophia.cloud.morse-seed.v1',
  sourceRevision,
  tool: 'emporium_write',
  arguments: {
    graphId,
    vocab: KOCH_VOCAB,
    records: curriculumRecords(graphId),
  },
}

mkdirSync(dirname(output), { recursive: true })
const temporary = `${output}.${randomUUID()}.tmp`
writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
renameSync(temporary, output)
process.stdout.write(`${output}\n`)
