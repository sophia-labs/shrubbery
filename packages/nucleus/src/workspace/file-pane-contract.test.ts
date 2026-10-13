/**
 * `FilePaneNode.status` is LIFECYCLE, never copy (review G1 / P0.2). The fixture
 * once stored the sentence "Saved in this browser" there; the tree rendered any
 * status as a badge that took the whole row, so six file rows read "SAVED IN THIS
 * BROWSER" and no name. NO MOCKS: a pure function over plain nodes.
 */
import { describe, expect, it } from 'vitest'
import { FILE_PANE_LIFECYCLES, filePaneLifecycle } from './file-pane-contract.js'

const node = (status?: string | null) => ({ status })

describe('filePaneLifecycle', () => {
  it('is quiet for a ready file: ready, idle, empty and missing draw nothing', () => {
    for (const status of ['ready', 'READY', ' ready ', 'idle', '', '   ', null, undefined]) {
      expect(filePaneLifecycle(node(status)), JSON.stringify(status)).toBeNull()
    }
  })

  it('names the lifecycle states a file can be in', () => {
    expect(FILE_PANE_LIFECYCLES).toEqual(['ready', 'uploading', 'processing', 'unavailable', 'error'])
    for (const status of FILE_PANE_LIFECYCLES.filter(state => state !== 'ready')) {
      expect(filePaneLifecycle(node(status))).toBe(status)
    }
  })

  it('passes an unfamiliar single-word state through, so a producer’s new lifecycle word still shows', () => {
    expect(filePaneLifecycle(node('failed'))).toBe('failed')
    expect(filePaneLifecycle(node('needs-review'))).toBe('needs-review')
  })

  it('never lets copy through: a sentence is not a lifecycle state', () => {
    for (const copy of ['Saved in this browser', 'Sample metadata', 'Changes save in this browser', 'metadata only']) {
      expect(filePaneLifecycle(node(copy)), copy).toBeNull()
    }
  })
})
