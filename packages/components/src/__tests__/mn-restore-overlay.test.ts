/**
 * mn-restore-overlay.test.ts — MO object-face integration spec, master §3
 * Slice 9 (03 §6.3, §10.1, C-D27). `heading` alone could not implement
 * §7's copy deck (RA-12/RA-13 need a labelled terminal button and RA-12b a
 * SECOND one) and the element announced nothing to the mobile shell's
 * modal-owner contract — four additive properties + one event fix both,
 * with every default reproducing today's behaviour byte-for-byte.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { MnRestoreOperationState, MnRestoreOverlay } from '../mn-restore-overlay.js'

beforeAll(async () => {
  await import('../mn-restore-overlay.js')
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(overrides: Partial<{
  active: boolean
  operationState: MnRestoreOperationState | ''
  heading: string
  primaryLabel: string
  secondaryLabel: string
  overlayId: string
  message: string
  error: string
}> = {}): Promise<MnRestoreOverlay> {
  const element = document.createElement('mn-restore-overlay') as MnRestoreOverlay
  element.active = overrides.active ?? true
  if (overrides.operationState !== undefined) element.operationState = overrides.operationState
  if (overrides.heading !== undefined) element.heading = overrides.heading
  if (overrides.primaryLabel !== undefined) element.primaryLabel = overrides.primaryLabel
  if (overrides.secondaryLabel !== undefined) element.secondaryLabel = overrides.secondaryLabel
  if (overrides.overlayId !== undefined) element.overlayId = overrides.overlayId
  if (overrides.message !== undefined) element.message = overrides.message
  if (overrides.error !== undefined) element.error = overrides.error
  document.body.appendChild(element)
  await element.updateComplete
  return element
}

function title(element: MnRestoreOverlay): string | null {
  return element.shadowRoot?.querySelector('.title')?.textContent ?? null
}

function ariaLabel(element: MnRestoreOverlay): string | null {
  return element.shadowRoot?.querySelector('.content')?.getAttribute('aria-label') ?? null
}

function buttons(element: MnRestoreOverlay): readonly HTMLButtonElement[] {
  return Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? [])
}

describe('mn-restore-overlay — heading/primaryLabel/secondaryLabel defaults (byte-for-byte)', () => {
  it('operationState:"" (progress) — default heading/aria-label unchanged', async () => {
    const element = await mount({ operationState: '' })
    expect(title(element)).toBe('Restoring Workspace')
    expect(ariaLabel(element)).toBe('Restore in progress')
  })

  it('succeeded — default title/aria-label/button label unchanged', async () => {
    const element = await mount({ operationState: 'succeeded' })
    expect(title(element)).toBe('Restore Complete')
    expect(ariaLabel(element)).toBe('Restore completed')
    const rows = buttons(element)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent?.trim()).toBe('Reload')
  })

  it('failed — default title/aria-label/button label unchanged', async () => {
    const element = await mount({ operationState: 'failed' })
    expect(title(element)).toBe('Restore Failed')
    expect(ariaLabel(element)).toBe('Restore failed')
    const rows = buttons(element)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent?.trim()).toBe('Dismiss')
  })

  it('rolled_back — default title/aria-label/button label unchanged', async () => {
    const element = await mount({ operationState: 'rolled_back' })
    expect(title(element)).toBe('Restore Rolled Back')
    expect(ariaLabel(element)).toBe('Restore rolled back')
    const rows = buttons(element)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent?.trim()).toBe('Dismiss')
  })

  it('a non-empty heading overrides the title AND the aria-label together, every state', async () => {
    for (const operationState of ['', 'succeeded', 'failed', 'rolled_back'] as const) {
      const element = await mount({ operationState, heading: 'Reapplying parked work' })
      expect(title(element)).toBe('Reapplying parked work')
      expect(ariaLabel(element)).toBe('Reapplying parked work')
      element.remove()
    }
  })

  it('a non-empty primaryLabel overrides the terminal button text, both terminal states', async () => {
    const succeeded = await mount({ operationState: 'succeeded', primaryLabel: 'Open Field Notes' })
    expect(buttons(succeeded)[0]?.textContent?.trim()).toBe('Open Field Notes')
    const failed = await mount({ operationState: 'failed', primaryLabel: 'Back to parked work' })
    expect(buttons(failed)[0]?.textContent?.trim()).toBe('Back to parked work')
  })

  it('an empty secondaryLabel renders EXACTLY ONE terminal button (no existing caller grows one)', async () => {
    const succeeded = await mount({ operationState: 'succeeded' })
    expect(buttons(succeeded)).toHaveLength(1)
    const failed = await mount({ operationState: 'failed' })
    expect(buttons(failed)).toHaveLength(1)
  })

  it('a non-empty secondaryLabel renders a SECOND button that emits mn-restore-overlay-secondary', async () => {
    const element = await mount({ operationState: 'succeeded', secondaryLabel: 'Back to parked work' })
    const rows = buttons(element)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.textContent?.trim()).toBe('Back to parked work')
    let detail: unknown = 'not-yet-fired'
    element.addEventListener('mn-restore-overlay-secondary', (event) => {
      detail = (event as CustomEvent).detail
    })
    rows[1]!.click()
    expect(detail).toBeNull() // no detail payload — the host already knows what it asked for
  })
})

describe('mn-restore-overlay — mn-overlay-state-change (docs/architecture/MOBILE_INTERACTION_SYSTEM.md:285)', () => {
  it('active false→true→false→disconnect emits open:true then open:false EXACTLY ONCE EACH, with a stable id', async () => {
    const element = document.createElement('mn-restore-overlay') as MnRestoreOverlay
    element.overlayId = 'reapply-overlay-test'
    document.body.appendChild(element)
    await element.updateComplete

    const events: { readonly open: boolean; readonly id: string }[] = []
    element.addEventListener('mn-overlay-state-change', (event) => {
      const detail = (event as CustomEvent).detail as { readonly open: boolean; readonly id: string }
      events.push({ open: detail.open, id: detail.id })
    })

    element.active = true
    await element.updateComplete
    element.active = true // no-op re-set must not double-announce
    await element.updateComplete
    element.active = false
    await element.updateComplete
    element.remove() // disconnect while already closed — must not re-announce false

    expect(events).toEqual([
      { open: true, id: 'reapply-overlay-test' },
      { open: false, id: 'reapply-overlay-test' },
    ])
  })

  it('disconnecting WHILE active announces the balancing close exactly once', async () => {
    const element = document.createElement('mn-restore-overlay') as MnRestoreOverlay
    element.overlayId = 'reapply-overlay-disconnect-test'
    element.active = true
    document.body.appendChild(element)
    await element.updateComplete

    // `isConnected` is already false by the time `disconnectedCallback` runs,
    // so `announceModalState` dispatches on `ownerDocument` (the shipped
    // `mn-confirmation-dialog.ts:354-364` precedent's own fallback) — a
    // listener on the now-detached element itself would never see it, which
    // is exactly why a real host aggregates this event at the document/shell
    // level rather than per-overlay.
    const events: { readonly open: boolean }[] = []
    document.addEventListener('mn-overlay-state-change', (event) => {
      const detail = (event as CustomEvent).detail as { readonly id: string; readonly open: boolean }
      if (detail.id === 'reapply-overlay-disconnect-test') events.push({ open: detail.open })
    })
    element.remove()

    expect(events).toEqual([{ open: false }])
  })
})
