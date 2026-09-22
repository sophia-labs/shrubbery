/**
 * REAL loading primitives — Garden loading/empty states lifted as backend-free
 * components in BOTH skins. NO MOCKS.
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-spinner.js'
import '../mn-loading.js'
import '../mn-empty-state.js'
import type { MnSpinner } from '../mn-spinner.js'
import type { MnLoading } from '../mn-loading.js'
import type { MnEmptyState } from '../mn-empty-state.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']

function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
}

async function mount<T extends HTMLElement>(skin: Skin, tag: string, props: Partial<T> = {}): Promise<T> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement(tag) as T
  Object.assign(el, props)
  host.appendChild(el)
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.removeAttribute('data-theme')
})

describe('mn-spinner — real spinner primitive', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] renders stable status semantics and size`, async () => {
      const el = await mount<MnSpinner>(skin, 'mn-spinner', { size: 'lg', label: 'Syncing' })
      const spinner = el.shadowRoot!.querySelector('.spinner') as HTMLElement
      expect(spinner).not.toBeNull()
      expect(spinner.classList.contains('size-lg')).toBe(true)
      expect(spinner.getAttribute('role')).toBe('status')
      expect(spinner.getAttribute('aria-label')).toBe('Syncing')
      expect(el.getAttribute('size')).toBe('lg')
      expect(el.getAttribute('data-skin')).toBe(skin === 'emporium' ? 'emporium' : null)
    })
  }

  it('uses role tokens for border/accent and carries the Emporium structural hook', () => {
    const css = styleText(document.createElement('mn-spinner'))
    expect(css).toContain('var(--mn-color-border-default')
    expect(css).toContain('var(--mn-color-accent')
    expect(css).toContain(":host([data-skin='emporium'])")
  })
})

describe('mn-loading — composed loading states', () => {
  it('spinner variant delegates to the real mn-spinner', async () => {
    const el = await mount<MnLoading>('garden', 'mn-loading', { text: 'Loading graph' })
    expect(el.shadowRoot!.querySelector('mn-spinner')).not.toBeNull()
    expect(el.shadowRoot!.textContent).toContain('Loading graph')
    expect(el.shadowRoot!.querySelector('.container')!.getAttribute('role')).toBe('status')
  })

  it('renders dots, pulse, and skeleton variants from real DOM', async () => {
    const dots = await mount<MnLoading>('garden', 'mn-loading', { variant: 'dots', size: 'sm' })
    expect(dots.shadowRoot!.querySelectorAll('.dot')).toHaveLength(3)
    expect(dots.shadowRoot!.querySelector('.dots')!.classList.contains('size-sm')).toBe(true)

    const pulse = await mount<MnLoading>('garden', 'mn-loading', { variant: 'pulse', size: 'lg' })
    expect(pulse.shadowRoot!.querySelector('.pulse')!.classList.contains('size-lg')).toBe(true)

    const skeleton = await mount<MnLoading>('garden', 'mn-loading', { variant: 'skeleton' })
    expect(skeleton.shadowRoot!.querySelector('.skeleton')).not.toBeNull()
  })

  it('mirrors Emporium skin and reflects fullscreen state', async () => {
    const el = await mount<MnLoading>('emporium', 'mn-loading', {
      variant: 'dots',
      fullscreen: true,
    })
    expect(el.getAttribute('data-skin')).toBe('emporium')
    expect(el.hasAttribute('fullscreen')).toBe(true)
  })

  it('uses tokenized overlay, accent, and skeleton surfaces', () => {
    const css = styleText(document.createElement('mn-loading'))
    expect(css).toContain('var(--mn-color-surface-overlay')
    expect(css).toContain('var(--mn-color-accent')
    expect(css).toContain('var(--mn-color-surface-sunken')
  })
})

describe('mn-empty-state — empty/error/placeholder surface', () => {
  it('renders icon, title, description, and action slot', async () => {
    const host = document.createElement('div')
    host.innerHTML = `
      <mn-empty-state icon="inbox" title="No blocks" description="Open a document.">
        <button slot="action">Create</button>
      </mn-empty-state>
    `
    document.body.appendChild(host)
    const el = host.querySelector('mn-empty-state') as MnEmptyState
    await el.updateComplete
    await new Promise((resolve) => setTimeout(resolve, 0))
    await el.updateComplete

    expect(el.shadowRoot!.querySelector('.icon-container svg')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('.title')!.textContent).toBe('No blocks')
    expect(el.shadowRoot!.querySelector('.description')!.textContent).toBe('Open a document.')
    const actionSlot = el.shadowRoot!.querySelector('slot[name="action"]') as HTMLSlotElement
    expect(actionSlot.assignedElements({ flatten: true })[0]?.textContent).toBe('Create')
  })

  it('supports compact/inline variants, danger mood, and hidden icon', async () => {
    const compact = await mount<MnEmptyState>('garden', 'mn-empty-state', {
      variant: 'compact',
      mood: 'danger',
      title: 'Failed',
      hideIcon: true,
    })
    const root = compact.shadowRoot!.querySelector('.empty-state')!
    expect(root.classList.contains('variant-compact')).toBe(true)
    expect(root.classList.contains('mood-danger')).toBe(true)
    expect(compact.shadowRoot!.querySelector('.icon-container')).toBeNull()

    const inline = await mount<MnEmptyState>('garden', 'mn-empty-state', { variant: 'inline' })
    expect(inline.shadowRoot!.querySelector('.empty-state')!.classList.contains('variant-inline')).toBe(true)
  })

  it('mirrors Emporium skin and routes structure through token hooks', async () => {
    const el = await mount<MnEmptyState>('emporium', 'mn-empty-state', { title: 'Empty' })
    expect(el.getAttribute('data-skin')).toBe('emporium')
    const css = styleText(document.createElement('mn-empty-state'))
    expect(css).toContain('var(--mn-color-surface-sunken')
    expect(css).toContain('var(--mn-color-danger')
    expect(css).toContain(":host([data-skin='emporium'])")
  })
})
