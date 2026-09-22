/**
 * Runtime VTuber control seam.
 *
 * The layout graph only resolves the tag `mn-vtuber`; the sibling control
 * overlay binds that rendered panel to a durable channel and scalar state.
 */

import { describe, it, expect } from 'vitest'
import {
  parseNT,
  parseVtuberControlOverlay,
  serializeVtuberControlChannelsToTriples,
  triplesToNT,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import { renderWorkspace } from '../render-workspace.js'

const MODEL_URL = '/models/VRM1_Constraint_Twist_Sample.vrm'

const VTUBER_CONFIG: WorkspaceConfig = {
  id: 'VTuberWorkspace',
  label: 'VTuber Workspace',
  renderedByComponent: 'app-shell',
  regions: {
    'region-center': {
      id: 'region-center',
      label: 'Center',
      childRegion: null,
      order: 1,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      sizeFraction: 1,
      dockState: null,
      docksPanel: ['panel-avatar'],
      renderedByComponent: null,
    },
  },
  panels: {
    'panel-avatar': {
      id: 'panel-avatar',
      label: 'Avatar',
      renderedByComponent: 'mn-vtuber',
      dockState: 'docked',
      defaultVisible: true,
    },
  },
  dimensions: {},
  rootRegions: ['region-center'],
}

describe('renderWorkspace - VTuber control overlay', () => {
  it('reflects a panel-bound VTuber channel into the rendered element', () => {
    const vtuberControls = parseVtuberControlOverlay(parseNT(triplesToNT(serializeVtuberControlChannelsToTriples([
      {
        id: 'vtuber-main',
        label: 'Assistant avatar',
        targetPanel: 'panel-avatar',
        modelUrl: MODEL_URL,
        expression: 'excited',
        material: 'capture-safe',
        cameraFrame: 'bust',
        animated: false,
        fallback: true,
        mouth: 0.44,
        blink: 0.12,
        lookX: 0.2,
        lookY: -0.08,
        scale: 1.1,
        appearance: {
          accentTint: '#d6a84f',
          eyeTint: '#5f8fdc',
          hairTint: '#2e3440',
          outfitTint: '#49636f',
          skinWarmth: 0.2,
        },
      },
    ]))))

    const container = renderWorkspace(VTUBER_CONFIG, { vtuberControls })
    const el = container.querySelector('mn-vtuber') as HTMLElement & Record<string, unknown>
    expect(el).not.toBeNull()
    expect(el.getAttribute('data-control-channel')).toBe('vtuber-main')
    expect(el.controlChannel).toBe('vtuber-main')
    expect(el.modelUrl).toBe(MODEL_URL)
    expect(el.label).toBe('Assistant avatar')
    expect(el.expression).toBe('excited')
    expect(el.material).toBe('capture-safe')
    expect(el.cameraFrame).toBe('bust')
    expect(el.animated).toBe(false)
    expect(el.mouth).toBe(0.44)
    expect(el.lookX).toBe(0.2)
    expect(el.scale).toBe(1.1)
    expect(el.appearance).toEqual({
      accentTint: '#d6a84f',
      eyeTint: '#5f8fdc',
      hairTint: '#2e3440',
      outfitTint: '#49636f',
      skinWarmth: 0.2,
    })
  })

  it('still renders a backend-free default element without a control overlay', () => {
    const container = renderWorkspace(VTUBER_CONFIG)
    const el = container.querySelector('mn-vtuber') as HTMLElement & Record<string, unknown>
    expect(el).not.toBeNull()
    expect(el.controlChannel).toBe('')
    expect(el.modelUrl).toBe('')
    expect(el.expression).toBe('focused')
    expect(el.fallback).toBe(true)
  })
})
