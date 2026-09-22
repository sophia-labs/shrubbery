import { describe, expect, it } from 'vitest'
import { applyOperation, locateParent } from '../operations.js'
import { singleTabsDoc, TEST_VALIDATE_OPTIONS, makeDescriptor, tabsInSplitDoc } from './fixtures.js'

describe('tabs operations', () => {
  it('wraps the root and adds, activates, and closes tabs', () => {
    const doc = singleTabsDoc()
    const wrapped = applyOperation(doc, { op: 'wrap_in_tabs', nodeId: 'T', tabsId: 'outer', label: 'Outer', expectedParent: { kind: 'root' } }, TEST_VALIDATE_OPTIONS)
    expect(wrapped.ok).toBe(true)
    if (!wrapped.ok) return
    const added = applyOperation(wrapped.doc, { op: 'tabs_add_tab', tabsId: 'outer', newLeafId: 'new', descriptor: makeDescriptor(), label: 'New', activate: true, expectedTabsRevision: 0 }, TEST_VALIDATE_OPTIONS)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.doc.nodes.outer).toMatchObject({ kind: 'tabs', activeNodeId: 'new', tabsRevision: 1 })
    const closed = applyOperation(added.doc, { op: 'tabs_close_tab', tabsId: 'outer', nodeId: 'new', expectedTabsRevision: 1 }, TEST_VALIDATE_OPTIONS)
    expect(closed.ok).toBe(true)
  })

  it('splits a direct tab child and follows the active tab to the new split', () => {
    const doc = singleTabsDoc()
    const result = applyOperation(doc, {
      op: 'split_leaf', leafId: 't-a', axis: 'horizontal', side: 'end', newLeafId: 'new', splitId: 'inner', descriptor: makeDescriptor(), expectedParent: { kind: 'tab', tabsId: 'T', index: 0 },
    }, TEST_VALIDATE_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.nodes.T).toMatchObject({ activeNodeId: 'inner', tabsRevision: 1 })
  })

  it('promotes a split sibling into its containing tab when closing a grandchild', () => {
    const doc = tabsInSplitDoc()
    const result = applyOperation(doc, { op: 'close_leaf', leafId: 't-b1', expectedParent: { kind: 'child', splitId: 't-b-split', side: 'start' } }, TEST_VALIDATE_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.nodes.T).toMatchObject({ kind: 'tabs', tabsRevision: 1 })
    expect((result.doc.nodes.T as Extract<typeof result.doc.nodes.T, { kind: 'tabs' }>).tabs[1].nodeId).toBe('t-b2')
  })

  it('fences direct tab-child relocation', () => {
    const doc = singleTabsDoc()
    const result = applyOperation(doc, { op: 'close_leaf', leafId: 't-a', expectedParent: { kind: 'tab', tabsId: 'T', index: 0 } }, TEST_VALIDATE_OPTIONS)
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'LAYOP_TAB_CHILD_NOT_RELOCATABLE' } })
    expect(locateParent(doc, 't-a')).toEqual({ kind: 'tab', tabsId: 'T', index: 0 })
  })
})
