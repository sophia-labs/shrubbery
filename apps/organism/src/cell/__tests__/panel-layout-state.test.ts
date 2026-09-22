import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_LAYOUT,
  LEFT_PANEL_SNAP,
  PANEL_SNAP_THRESHOLD_PX,
  RIGHT_PANEL_SNAP,
  normalizePanelLayoutState,
  readPanelLayoutState,
  writePanelLayoutState,
} from '../panel-layout-state.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('panel layout state', () => {
  it('publishes Garden-compatible physical snap modes', () => {
    expect(LEFT_PANEL_SNAP).toBe('180px 280px 500px')
    expect(RIGHT_PANEL_SNAP).toBe('240px 420px 500px')
    expect(PANEL_SNAP_THRESHOLD_PX).toBe(24)
  })

  it('falls back safely and canonicalizes impossible mode combinations', () => {
    expect(readPanelLayoutState(null)).toEqual(DEFAULT_PANEL_LAYOUT)
    expect(normalizePanelLayoutState({
      leftPanelWidth: Number.NaN,
      rightPanelWidth: 900,
      leftCollapsed: true,
      leftExpanded: true,
      rightCollapsed: false,
    })).toEqual({
      ...DEFAULT_PANEL_LAYOUT,
      rightPanelWidth: 500,
      leftCollapsed: true,
      rightCollapsed: false,
    })

    expect(normalizePanelLayoutState({ leftExpanded: true, rightCollapsed: false })).toEqual({
      ...DEFAULT_PANEL_LAYOUT,
      leftExpanded: true,
      rightCollapsed: true,
    })

    const storage = new MemoryStorage()
    storage.setItem('bad', '{')
    expect(readPanelLayoutState(storage, 'bad')).toEqual(DEFAULT_PANEL_LAYOUT)
  })

  it('round-trips continuous widths and discrete modes in tab-scoped storage', () => {
    const storage = new MemoryStorage()
    const state = {
      leftPanelWidth: 355,
      rightPanelWidth: 463,
      leftCollapsed: false,
      leftExpanded: false,
      rightCollapsed: true,
    }
    writePanelLayoutState(storage, state)
    expect(readPanelLayoutState(storage)).toEqual(state)
  })
})
