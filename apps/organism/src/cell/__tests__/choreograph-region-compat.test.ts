/**
 * A graph whose saved :ux:config predates modes v1 names `wf-studio-shell`
 * for the Choreograph region; the read projects it to the modes surface.
 */
import { describe, expect, it } from 'vitest'
import { parseNT, parseTriplesToConfig, validateConfig } from '@shrubbery/nucleus'
import SEED_NT from '@shrubbery/nucleus/seed/garden-default.ux.nt?raw'
import { withChoreographModesRegion } from '../choreograph-region-compat.js'

const REGION = '<http://sophia.ai/ux#region-choreo-center> <http://sophia.ai/ux#renderedByComponent>'

describe('withChoreographModesRegion', () => {
  it('the committed seed already stamps the modes surface', () => {
    expect(SEED_NT).toContain(`${REGION} "choreo-modes-surface" .`)
    const config = parseTriplesToConfig(parseNT(SEED_NT))
    expect(withChoreographModesRegion(config)).toBe(config)
  })

  it('projects a pre-modes saved config (wf-studio-shell) to choreo-modes-surface, read-only', () => {
    const legacyNt = SEED_NT.replace(`${REGION} "choreo-modes-surface" .`, `${REGION} "wf-studio-shell" .`)
    expect(legacyNt).not.toBe(SEED_NT)
    const legacy = parseTriplesToConfig(parseNT(legacyNt))
    expect(legacy.regions['region-choreo-center']?.renderedByComponent).toBe('wf-studio-shell')
    const projected = withChoreographModesRegion(legacy)
    expect(projected.regions['region-choreo-center']?.renderedByComponent).toBe('choreo-modes-surface')
    expect(legacy.regions['region-choreo-center']?.renderedByComponent).toBe('wf-studio-shell')
    expect(validateConfig(projected).ok).toBe(true)
  })

  it('leaves an author-chosen component alone', () => {
    const customNt = SEED_NT.replace(`${REGION} "choreo-modes-surface" .`, `${REGION} "mn-agent-studio-editor" .`)
    const custom = parseTriplesToConfig(parseNT(customNt))
    expect(withChoreographModesRegion(custom)).toBe(custom)
  })
})
