import { describe, expect, it } from 'vitest'
import { graphIdFromRoomTitle, localRoomCatalog } from '../src/backend.js'

describe('Garden graph rooms', () => {
  it('projects the real local list_graphs envelope into the shared catalog shape', () => {
    expect(localRoomCatalog({
      count: 2,
      graphs: [
        { graph_id: 'night-code', title: 'Night Code', status: 'active', role: 'editor' },
        { graph_id: 'koch-morse', title: 'Koch Room', status: 'active', role: 'owner' },
      ],
    })).toEqual([
      { graphId: 'koch-morse', title: 'Koch Room', role: 'owner', cellState: 'running' },
      { graphId: 'night-code', title: 'Night Code', role: 'editor', cellState: 'running' },
    ])
  })

  it('derives a Garden-safe local graph id from the Hoja-authored room title', () => {
    expect(graphIdFromRoomTitle('  Café Morse / Mondays  ')).toBe('cafe-morse-mondays')
    expect(() => graphIdFromRoomTitle('___')).toThrow(/letter or number/)
  })
})
