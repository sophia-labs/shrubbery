// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesClient } from '../files-contract.js'
import { FilesWires, customPredicate, humanize } from '../files-connections.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

let server: FilesContractServer
let wires: FilesWires
beforeEach(async () => {
  server = await startFilesContractServer()
  wires = new FilesWires(new FilesClient(contractFor(server), mcpFor(server)))
})
afterEach(async () => { await server.close() })

describe('connections are the graph\'s wires', () => {
  it('creates a wire between two artifacts, reads it back from the source, and deletes it', async () => {
    await wires.create(server.graphId, server.graphIncarnation, { id: 'w1', source: 'a', target: 'b', predicate: 'supports' })
    expect(await wires.list(server.graphId, ['a'])).toEqual([{ id: 'w1', source: 'a', target: 'b', predicate: 'supports', label: 'supports' }])
    expect(await wires.list(server.graphId, ['b'])).toEqual([])                 // listed once, by its source
    await wires.delete(server.graphId, 'w1')
    expect(await wires.list(server.graphId, ['a', 'b'])).toEqual([])
  })

  it('offers the cell\'s vocabulary, and a custom predicate joins it', async () => {
    const first = await wires.relations(server.graphId)
    expect(first.map(r => r.uri).slice(0, 3)).toEqual(['relatedTo', 'supports', 'contradicts'])
    await wires.create(server.graphId, server.graphIncarnation, { id: 'w2', source: 'a', target: 'b', predicate: customPredicate('Is a draft of') })
    const after = await wires.relations(server.graphId)
    expect(after.at(-1)).toEqual({ uri: 'isADraftOf', label: 'is a draft of' })
  })

  it('names predicates from words and words from predicates', () => {
    expect(customPredicate('  Annotates ')).toBe('annotates')
    expect(customPredicate('Is a draft of')).toBe('isADraftOf')
    expect(humanize('http://mnemosyne.ai/vocab#isADraftOf')).toBe('is a draft of')
  })
})
