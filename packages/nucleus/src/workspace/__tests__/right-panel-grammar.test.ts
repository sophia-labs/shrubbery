import { describe, expect, it } from 'vitest'
import {
  panelsForRightPanelMode,
  rightPanelModeFromPanels,
  selectRightPanel,
} from '../right-panel-grammar.js'

describe('Garden right-panel grammar', () => {
  it('selects a new panel and closes the active panel when selected again', () => {
    expect(selectRightPanel('chat', 'comments')).toBe('comments')
    expect(selectRightPanel('comments', 'comments')).toBe('none')
    expect(selectRightPanel('none', 'comments')).toBe('comments')
  })

  it('migrates a legacy ordered panel list to its most recently selected panel', () => {
    expect(rightPanelModeFromPanels(['chat', 'comments'])).toBe('comments')
    expect(rightPanelModeFromPanels(['wires', 'graph', 'comments'])).toBe('comments')
    expect(rightPanelModeFromPanels([])).toBe('none')
  })

  it('projects scalar state back to a one-element compatibility list', () => {
    expect(panelsForRightPanelMode('chat')).toEqual(['chat'])
    expect(panelsForRightPanelMode('none')).toEqual([])
  })
})
