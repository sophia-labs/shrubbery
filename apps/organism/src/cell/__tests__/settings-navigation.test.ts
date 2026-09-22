import { describe, expect, it } from 'vitest'
import {
  settingsCellGraph,
  settingsNavigationUrl,
  settingsReturnPath,
} from '../settings-navigation.js'

describe('Settings navigation policy', () => {
  it('preserves a live-cell graph and exact workspace return path', () => {
    const url = settingsNavigationUrl(
      new URL('http://127.0.0.1:5210/?source=cell&graph=organism-dev&r=comments#focus'),
      'organism-dev',
    )
    expect(url.pathname).toBe('/settings')
    expect(url.searchParams.get('source')).toBe('cell')
    expect(url.searchParams.get('graph')).toBe('organism-dev')
    expect(url.searchParams.get('returnTo')).toBe('/?source=cell&graph=organism-dev&r=comments#focus')
    expect(settingsCellGraph(url)).toBe('organism-dev')
    expect(settingsReturnPath(url)).toBe('/?source=cell&graph=organism-dev&r=comments#focus')
  })

  it('keeps ordinary routes contract-free and rejects external returns', () => {
    const url = settingsNavigationUrl(new URL('https://garden.test/'), null)
    expect(url.href).toBe('https://garden.test/settings')
    expect(settingsCellGraph(url)).toBeNull()

    const hostile = new URL('https://garden.test/settings?returnTo=https://evil.test/')
    const protocolRelative = new URL('https://garden.test/settings?returnTo=//evil.test/')
    const backslashRelative = new URL('https://garden.test/settings?returnTo=%2F%5Cevil.test%2F')
    expect(settingsReturnPath(hostile)).toBe('/')
    expect(settingsReturnPath(protocolRelative)).toBe('/')
    expect(settingsReturnPath(backslashRelative)).toBe('/')
  })
})
