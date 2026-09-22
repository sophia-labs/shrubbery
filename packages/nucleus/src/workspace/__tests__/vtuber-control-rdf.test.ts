/**
 * VTuber control overlay - triples specify the channel, not layout props.
 *
 * This pins the sibling graph contract for mn-vtuber:
 *   layout:  panel/region -> renderedByComponent "mn-vtuber"
 *   control: panel/region -> sux:controlChannel -> sux:VTuberControlChannel
 *
 * Pure: no DOM, no component imports, no stores.
 */

import { describe, it, expect } from 'vitest'
import { parseNT, triplesToNT } from '../rdf-model.js'
import {
  parseVtuberControlOverlay,
  selectVtuberControlChannel,
  serializeVtuberControlChannelsToTriples,
  uxControlGraphIri,
  type VtuberControlChannel,
} from '../vtuber-control-rdf.js'

const MODEL_URL = '/models/VRM1_Constraint_Twist_Sample.vrm'

describe('VTuber control RDF overlay', () => {
  it('names the sibling ux:control graph', () => {
    expect(uxControlGraphIri('g-abc')).toBe('urn:mnemosyne:local:graph:g-abc:ux:control')
  })

  it('round-trips a panel-bound VTuber channel', () => {
    const channel: VtuberControlChannel = {
      id: 'vtuber-main',
      label: 'Garden avatar',
      targetPanel: 'panel-avatar',
      modelUrl: MODEL_URL,
      expression: 'excited',
      material: 'capture-safe',
      cameraFrame: 'bust',
      animated: true,
      fallback: true,
      mouth: 0.42,
      blink: 0.1,
      lookX: 0.18,
      lookY: -0.06,
      scale: 1.08,
      appearance: {
        accentTint: '#d6a84f',
        eyeTint: '#5f8fdc',
        hairTint: '#2e3440',
        outfitTint: '#49636f',
        skinWarmth: 0.2,
      },
      poseSource: 'pose:assistant-presenter',
      lipsyncSource: 'audio:assistant-turn',
      gazeSource: 'gaze:pointer',
      clockSource: 'clock:workspace',
      statusSink: 'events:vtuber-status',
    }

    const triples = serializeVtuberControlChannelsToTriples([channel])
    const nt = triplesToNT(triples)
    expect(nt).toContain('<http://sophia.ai/ux#panel-avatar> <http://sophia.ai/ux#controlChannel> <http://sophia.ai/ux#vtuber-main> .')
    expect(nt).toContain('<http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#targetComponent> "mn-vtuber" .')

    const overlay = parseVtuberControlOverlay(parseNT(nt))
    expect(overlay.channels['vtuber-main']).toEqual({
      ...channel,
      targetComponent: 'mn-vtuber',
      targetRegion: null,
    })
  })

  it('can infer a target panel from the binding triple alone', () => {
    const overlay = parseVtuberControlOverlay(parseNT(`
<http://sophia.ai/ux#panel-avatar> <http://sophia.ai/ux#controlChannel> <http://sophia.ai/ux#vtuber-main> .
<http://sophia.ai/ux#vtuber-main> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#VTuberControlChannel> .
<http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#expression> "focused" .
<http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#mouth> "0.37"^^<http://www.w3.org/2001/XMLSchema#decimal> .
    `))

    expect(overlay.channels['vtuber-main']).toMatchObject({
      id: 'vtuber-main',
      targetComponent: 'mn-vtuber',
      targetPanel: 'panel-avatar',
      expression: 'focused',
      mouth: 0.37,
    })
  })

  it('selects panel binding before region binding', () => {
    const overlay = parseVtuberControlOverlay(parseNT(triplesToNT(serializeVtuberControlChannelsToTriples([
      { id: 'region-channel', targetRegion: 'region-center', expression: 'neutral' },
      { id: 'panel-channel', targetPanel: 'panel-avatar', expression: 'strained' },
    ]))))

    expect(selectVtuberControlChannel(overlay, {
      panelId: 'panel-avatar',
      regionId: 'region-center',
    })?.id).toBe('panel-channel')
    expect(selectVtuberControlChannel(overlay, { regionId: 'region-center' })?.id).toBe('region-channel')
    expect(selectVtuberControlChannel(overlay, { panelId: 'panel-missing' })).toBeNull()
  })

  it('bounds normalized control scalars on parse', () => {
    const overlay = parseVtuberControlOverlay(parseNT(`
<http://sophia.ai/ux#panel-avatar> <http://sophia.ai/ux#controlChannel> <http://sophia.ai/ux#vtuber-main> .
<http://sophia.ai/ux#vtuber-main> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#VTuberControlChannel> .
<http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#mouth> "2"^^<http://www.w3.org/2001/XMLSchema#decimal> .
<http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#lookX> "-2"^^<http://www.w3.org/2001/XMLSchema#decimal> .
<http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#scale> "99"^^<http://www.w3.org/2001/XMLSchema#decimal> .
    `))

    expect(overlay.channels['vtuber-main']).toMatchObject({
      mouth: 1,
      lookX: -1,
      scale: 4,
    })
  })
})
