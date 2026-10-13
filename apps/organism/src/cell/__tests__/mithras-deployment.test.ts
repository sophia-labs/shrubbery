import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSkinForBuild, mithrasDeployment } from '../mithras-deployment.js'

describe('Mithras deployment — default skin keyed off the Flow build flag', () => {
  it('recognises only VITE_SHRUBBERY_FLOW_APP=1 (the flag that puts Flow in the picker)', () => {
    expect(mithrasDeployment(undefined)).toBe(false)
    expect(mithrasDeployment({})).toBe(false)
    expect(mithrasDeployment({ VITE_SHRUBBERY_FLOW_APP: '0' })).toBe(false)
    expect(mithrasDeployment({ VITE_SHRUBBERY_FLOW_APP: 'true' })).toBe(false)
    expect(mithrasDeployment({ VITE_SHRUBBERY_FLOW_APP: '1' })).toBe(true)
    expect(mithrasDeployment({ VITE_SHRUBBERY_FLOW_APP: ' 1 ' })).toBe(true)
  })

  it('defaults to mithras on the Mithras build and leaves every other build alone', () => {
    expect(defaultSkinForBuild({ VITE_SHRUBBERY_FLOW_APP: '1' }, 'garden')).toBe('mithras')
    expect(defaultSkinForBuild({}, 'garden')).toBe('garden')
    expect(defaultSkinForBuild(undefined, 'emporium')).toBe('emporium')
  })
})

describe('Settings honour the Mithras default (real settings module, real env)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function freshSettings() {
    vi.resetModules()
    return import('../settings-service.js')
  }

  it('a visitor with no stored skin arrives in Mithras on the Mithras build', async () => {
    vi.stubEnv('VITE_SHRUBBERY_FLOW_APP', '1')
    const { readAppearancePreferences } = await freshSettings()
    expect(readAppearancePreferences(null).skin).toBe('mithras')
    const stored = new Map<string, string>([['shrubbery.organism.settings.v1', JSON.stringify({ skin: 'glass' })]])
    const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v) } }
    expect(readAppearancePreferences(storage).skin).toBe('glass')
  })

  it('every other build keeps Garden as the default', async () => {
    vi.stubEnv('VITE_SHRUBBERY_FLOW_APP', '')
    const { readAppearancePreferences } = await freshSettings()
    expect(readAppearancePreferences(null).skin).toBe('garden')
  })
})
