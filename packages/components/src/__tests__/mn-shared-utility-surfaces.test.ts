/**
 * REAL component tests - Garden shared utility surfaces lifted as controlled UI.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-upgrade-banner.js'
import '../mn-storage-banner.js'
import '../mn-tts-player.js'
import type { MnUpgradeBanner, MnUpgradeBannerDetail } from '../mn-upgrade-banner.js'
import type { MnStorageBanner, MnStorageBannerDetail } from '../mn-storage-banner.js'
import type { MnTtsActionDetail, MnTtsPlayer } from '../mn-tts-player.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountUpgrade(setup?: (el: MnUpgradeBanner) => void): Promise<MnUpgradeBanner> {
  const el = document.createElement('mn-upgrade-banner') as MnUpgradeBanner
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountStorage(setup?: (el: MnStorageBanner) => void): Promise<MnStorageBanner> {
  const el = document.createElement('mn-storage-banner') as MnStorageBanner
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountTts(setup?: (el: MnTtsPlayer) => void): Promise<MnTtsPlayer> {
  const el = document.createElement('mn-tts-player') as MnTtsPlayer
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-upgrade-banner / mn-storage-banner / mn-tts-player', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the Garden shared utility tags', () => {
    expect(customElements.get('mn-upgrade-banner')).toBeDefined()
    expect(customElements.get('mn-storage-banner')).toBeDefined()
    expect(customElements.get('mn-tts-player')).toBeDefined()
  })

  it('mn-upgrade-banner renders only when visible and emits upgrade/dismiss intents', async () => {
    const el = await mountUpgrade(node => {
      node.visible = true
    })
    const upgrades: MnUpgradeBannerDetail[] = []
    const dismisses: MnUpgradeBannerDetail[] = []
    el.addEventListener('mn-upgrade', event => {
      upgrades.push((event as CustomEvent<MnUpgradeBannerDetail>).detail)
    })
    el.addEventListener('mn-dismiss', event => {
      dismisses.push((event as CustomEvent<MnUpgradeBannerDetail>).detail)
    })

    expect(sr(el).querySelector('.banner')?.textContent).toContain('Unlock the full Garden')
    ;(sr(el).querySelector('.upgrade-btn') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.dismiss-btn') as HTMLButtonElement).click()

    expect(upgrades).toEqual([{ source: 'upgrade-banner' }])
    expect(dismisses).toEqual([{ source: 'upgrade-banner' }])

    el.visible = false
    await el.updateComplete
    expect(sr(el).querySelector('.banner')).toBeNull()
  })

  it('mn-upgrade-banner renders mobile copy and reflects mobile state', async () => {
    const el = await mountUpgrade(node => {
      node.visible = true
      node.mobile = true
    })

    expect(el.hasAttribute('mobile')).toBe(true)
    expect(sr(el).querySelector('.banner-row')).not.toBeNull()
    expect(sr(el).querySelector('.banner')?.textContent).toContain('512MB storage')
  })

  it('mn-storage-banner maps thresholds to default warning/error behavior', async () => {
    const warning = await mountStorage(node => {
      node.threshold = { level: 90 }
    })
    const warningUpgrades: MnStorageBannerDetail[] = []
    const warningDismisses: MnStorageBannerDetail[] = []
    warning.addEventListener('mn-upgrade', event => {
      warningUpgrades.push((event as CustomEvent<MnStorageBannerDetail>).detail)
    })
    warning.addEventListener('mn-dismiss', event => {
      warningDismisses.push((event as CustomEvent<MnStorageBannerDetail>).detail)
    })

    expect(sr(warning).querySelector('.banner')?.classList.contains('warning')).toBe(true)
    expect(sr(warning).querySelector('.banner')?.getAttribute('data-storage-level')).toBe('90')
    expect(sr(warning).querySelector('.banner')?.textContent).toContain('90% storage capacity')
    ;(sr(warning).querySelector('.upgrade-btn') as HTMLButtonElement).click()
    ;(sr(warning).querySelector('.dismiss-btn') as HTMLButtonElement).click()

    expect(warningUpgrades).toEqual([{ level: 90, tone: 'warning' }])
    expect(warningDismisses).toEqual([{ level: 90, tone: 'warning' }])

    const full = await mountStorage(node => {
      node.threshold = { level: 100 }
    })
    expect(sr(full).querySelector('.banner')?.classList.contains('error')).toBe(true)
    expect(sr(full).querySelector('.dismiss-btn')).toBeNull()
  })

  it('mn-storage-banner supports mobile custom threshold copy', async () => {
    const el = await mountStorage(node => {
      node.mobile = true
      node.threshold = {
        level: 95,
        tone: 'error',
        message: 'Almost full.',
        dismissable: true,
      }
    })

    expect(el.hasAttribute('mobile')).toBe(true)
    expect(sr(el).querySelector('.banner')?.textContent).toContain('Almost full.')
    expect(sr(el).querySelector('.banner-row')).not.toBeNull()
    expect(sr(el).querySelector('.dismiss-btn')).not.toBeNull()
  })

  it('mn-tts-player hides when idle and emits playback/settings intents', async () => {
    const el = await mountTts(node => {
      node.status = 'playing'
      node.currentBlockIndex = 1
      node.totalBlocks = 3
      node.currentBlockText = 'The current paragraph being read aloud.'
      node.speed = 1
      node.tier = 'classic'
      node.stopShortcut = 'Cmd+Opt+L'
    })
    const actions: MnTtsActionDetail[] = []
    el.addEventListener('mn-tts-action', event => {
      actions.push((event as CustomEvent<MnTtsActionDetail>).detail)
    })

    expect(sr(el).querySelector('.tts-bar')?.textContent).toContain('2 / 3')
    expect(sr(el).querySelector('.block-preview')?.textContent).toContain('current paragraph')
    expect(sr(el).querySelector('.stop')?.getAttribute('title')).toBe('Stop (Cmd+Opt+L)')

    ;(sr(el).querySelector('.primary') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[title="Previous block"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[title="Next block"]') as HTMLButtonElement).click()
    const selects = sr(el).querySelectorAll('select')
    selects[0]!.value = '1.5'
    selects[0]!.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    selects[1]!.value = 'enhanced'
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    ;(sr(el).querySelector('.stop') as HTMLButtonElement).click()

    expect(actions).toEqual([
      { action: 'pause', status: 'playing' },
      { action: 'skip-back', status: 'playing' },
      { action: 'skip-forward', status: 'playing' },
      { action: 'speed', status: 'playing', speed: 1.5 },
      { action: 'tier', status: 'playing', tier: 'enhanced' },
      { action: 'stop', status: 'playing' },
    ])

    el.status = 'idle'
    await el.updateComplete
    expect(sr(el).querySelector('.tts-bar')).toBeNull()
  })

  it('mn-tts-player handles loading, paused, and mobile states', async () => {
    const loading = await mountTts(node => {
      node.status = 'loading'
    })
    expect(sr(loading).querySelector('.loading')?.textContent).toBe('Loading...')

    const paused = await mountTts(node => {
      node.status = 'paused'
    })
    const resumes: MnTtsActionDetail[] = []
    paused.addEventListener('mn-tts-resume', event => {
      resumes.push((event as CustomEvent<MnTtsActionDetail>).detail)
    })
    ;(sr(paused).querySelector('.primary') as HTMLButtonElement).click()
    expect(resumes).toEqual([{ action: 'resume', status: 'paused' }])

    paused.mobile = true
    await paused.updateComplete
    expect(paused.hasAttribute('mobile')).toBe(true)
  })
})
