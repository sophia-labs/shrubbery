/**
 * Chrome — the REAL backend-free chrome components under the REAL token system.
 *
 * NO MOCKS: these stories register and render the actual @customElement chrome
 * (mn-top-bar / mn-bottom-bar). Their data-bearing areas are inert slots (the
 * components fake nothing); the controlled props (brand, badge, activeApp,
 * pressed states) are real component properties. Flip the Skin/Theme toolbar
 * globals to see the components re-skin live via the token cascade.
 */
import { html } from 'lit'
import type { Meta, StoryObj } from '@storybook/web-components'

// Side-effect import = the custom-element upgrade seam (same as the organism).
import '@shrubbery/components'
import type { ChromeAppId, ChromeSkinId, MnCrumb, MnQuickClip } from '@shrubbery/components'

const meta: Meta = {
  title: 'Chrome/Bars',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

/** The controlled props the TopBar story exposes as Storybook args. */
interface TopBarArgs {
  brand: string
  badge: string
  activeApp: ChromeAppId
  isDark: boolean
  activeSkin: ChromeSkinId
}

export const TopBar: StoryObj<TopBarArgs> = {
  args: { brand: 'Garden', badge: 'beta', activeApp: 'garden', isDark: false, activeSkin: 'garden' },
  argTypes: {
    activeApp: { control: 'inline-radio', options: ['garden', 'choreograph'] },
    isDark: { control: 'boolean' },
    activeSkin: { control: 'select', options: ['garden', 'emporium', '98', 'glass', 'research', 'greenhouse'] },
  },
  render: (args: TopBarArgs) => html`
    <mn-top-bar
      .brand=${args.brand}
      .badge=${args.badge}
      .activeApp=${args.activeApp}
      .isDark=${args.isDark}
      .activeSkin=${args.activeSkin}
    ></mn-top-bar>
  `,
}

/**
 * Real-browser contract for the controlled Quick Clip surface. The tiny host
 * handler stands in for the already-tested authenticated cell service; the
 * story verifies actual shadow-DOM form behavior, web/YouTube auto-detection,
 * controlled progress/success, reset, and retry without network access.
 */
export const QuickClipBrowserContract: Story = {
  tags: ['quick-clip-browser'],
  render: () => {
    const onRequest = (event: CustomEvent<{ url: string; kind: 'web' | 'youtube' }>) => {
      const clip = event.currentTarget as MnQuickClip
      clip.dataset.lastUrl = event.detail.url
      clip.dataset.lastKind = event.detail.kind
      clip.status = 'processing'
      window.setTimeout(() => { clip.status = 'complete' }, 30)
    }
    const onReset = (event: Event) => {
      const clip = event.currentTarget as MnQuickClip
      clip.status = 'idle'
      clip.error = ''
    }
    return html`
      <div style="display:flex;justify-content:flex-end;padding:16px;min-height:300px;">
        <mn-quick-clip
          @mn-quick-clip-request=${onRequest}
          @mn-quick-clip-reset=${onReset}
        ></mn-quick-clip>
      </div>
    `
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const clip = canvasElement.querySelector('mn-quick-clip') as MnQuickClip
    if (!clip) throw new Error('QuickClipBrowserContract.play: mn-quick-clip did not mount')
    await clip.updateComplete
    const root = clip.shadowRoot
    if (!root) throw new Error('QuickClipBrowserContract.play: shadow root unavailable')
    const trigger = root.querySelector<HTMLButtonElement>('[aria-label="Quick clip"]')
    if (!trigger) throw new Error('QuickClipBrowserContract.play: trigger unavailable')
    trigger.click()
    await clip.updateComplete
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')
    const input = root.querySelector<HTMLInputElement>('input')
    const form = root.querySelector<HTMLFormElement>('form')
    if (!dialog || dialog.hidden || !input || !form) {
      throw new Error('QuickClipBrowserContract.play: accessible form did not open')
    }

    input.value = 'https://example.com/deep-roots'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    form.requestSubmit()
    await waitForQuickClip(() => clip.status === 'complete')
    // Read the dataset into a local before comparing: comparing the DOM property
    // directly would narrow `clip.dataset.lastKind` to the `'web'` literal for the
    // rest of the flow, hiding the later YouTube mutation from the type checker.
    const webKind = clip.dataset.lastKind
    if (webKind !== 'web' || clip.dataset.lastUrl !== 'https://example.com/deep-roots') {
      throw new Error('QuickClipBrowserContract.play: web request was not normalized/dispatched')
    }
    if (root.querySelector<HTMLElement>('.status.complete')?.hidden !== false) {
      throw new Error('QuickClipBrowserContract.play: controlled success state was not visible')
    }

    root.querySelector<HTMLButtonElement>('.another')?.click()
    await clip.updateComplete
    input.value = 'https://youtu.be/browser-contract'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    form.requestSubmit()
    await waitForQuickClip(() => clip.status === 'complete')
    const youtubeKind = clip.dataset.lastKind
    if (youtubeKind !== 'youtube') {
      throw new Error('QuickClipBrowserContract.play: YouTube URL was not auto-detected')
    }

    root.querySelector<HTMLButtonElement>('[aria-label="Close quick clip"]')?.click()
    await clip.updateComplete
    if (!dialog.hidden || trigger.getAttribute('aria-expanded') !== 'false') {
      throw new Error('QuickClipBrowserContract.play: close did not restore collapsed semantics')
    }
  },
}

async function waitForQuickClip(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2_000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Quick Clip controlled state timed out')
    await new Promise<void>(resolve => window.setTimeout(resolve, 10))
  }
}

/** The controlled props the AppBar story exposes as Storybook args. */
interface AppBarArgs {
  brand: string
  badge: string
  glyph: string
  query: string
  searchPlaceholder: string
  isDark: boolean
  activeSkin: ChromeSkinId
}

/**
 * AppBar — the richer GENERAL product bar (mn-app-bar): masthead + search/filter
 * + a real breadcrumb trail + nav/actions. It lifts MORE of garden's real top bar
 * than the chrome bar (the search field + crumb row), generalized + CONTROLLED.
 * The breadcrumb data is the SHELL's `.crumbs` (here a sample Emporium → pack →
 * class trail); the search is controlled (typing emits mn-search). Flip the Skin
 * toolbar global to see it re-skin Garden ↔ Emporium via the token cascade.
 */
export const AppBar: StoryObj<AppBarArgs> = {
  args: {
    brand: 'Emporium',
    badge: 'live',
    glyph: '⬡',
    query: '',
    searchPlaceholder: 'Search vocabularies…',
    isDark: false,
    activeSkin: 'emporium',
  },
  argTypes: {
    isDark: { control: 'boolean' },
    activeSkin: { control: 'select', options: ['garden', 'emporium', '98', 'glass', 'research', 'greenhouse'] },
  },
  render: (args: AppBarArgs) => {
    const crumbs: MnCrumb[] = [
      { label: 'Emporium', id: 'root' },
      { label: 'workflow', id: 'workflow' },
      { label: 'AgentNode' },
    ]
    return html`
      <mn-app-bar
        .brand=${args.brand}
        .badge=${args.badge}
        .glyph=${args.glyph}
        .query=${args.query}
        .searchPlaceholder=${args.searchPlaceholder}
        .crumbs=${crumbs}
        .isDark=${args.isDark}
        .activeSkin=${args.activeSkin}
      ></mn-app-bar>
    `
  },
}

/**
 * AppBarSkinContrast — the SAME mn-app-bar under BOTH skins, side by side, each in
 * its own [data-skin] host. Garden (fern / serif display / rounded / comfortable)
 * vs Emporium (purple / Diatype / square / tight) — the product bar re-skins live
 * via the token cascade. The crumb trail + search render identically in structure
 * but visibly different in identity.
 */
export const AppBarSkinContrast: Story = {
  render: () => {
    const crumbs: MnCrumb[] = [
      { label: 'Emporium', id: 'root' },
      { label: 'sophia-memory-core', id: 'mem' },
      { label: 'Memory' },
    ]
    return html`
      <div style="display:grid;grid-template-rows:auto auto;gap:1px;">
        <section data-skin="garden" style="background:var(--mn-color-surface-base);">
          <mn-app-bar
            .brand=${'Garden'}
            .badge=${'fern'}
            .glyph=${'🌱'}
            .searchPlaceholder=${'Search…'}
            .crumbs=${crumbs}
          ></mn-app-bar>
        </section>
        <section data-skin="emporium" style="background:var(--mn-color-surface-base);">
          <mn-app-bar
            .brand=${'Emporium'}
            .badge=${'purple'}
            .glyph=${'⬡'}
            .searchPlaceholder=${'Search vocabularies…'}
            .crumbs=${crumbs}
            .activeSkin=${'emporium'}
          ></mn-app-bar>
        </section>
      </div>
    `
  },
}

export const BottomBar: Story = {
  render: () => html`
    <mn-bottom-bar
      .leftPanelMode=${'files'}
      .panel=${'chat'}
    ></mn-bottom-bar>
  `,
}

export const TopAndBottom: Story = {
  render: () => html`
    <div style="display:flex;flex-direction:column;height:100vh;">
      <mn-top-bar .brand=${'Garden'} .badge=${'alpha'}></mn-top-bar>
      <div
        style="flex:1;display:flex;align-items:center;justify-content:center;
               background:var(--mn-color-surface-base);color:var(--mn-color-text-secondary);
               font-family:var(--mn-font-chrome);"
      >
        workspace body — chrome top + bottom re-skin via the token cascade
      </div>
        <mn-bottom-bar .leftPanelMode=${'files'} .panel=${'chat'}></mn-bottom-bar>
    </div>
  `,
}

/**
 * SkinContrast — the SAME chrome under BOTH skins, side by side, each wrapped in
 * its OWN [data-skin] host. The components are skin-aware (iteration 3b): each
 * mirrors the ambient skin onto itself and re-skins via the token cascade, so
 * Garden (fern / Literata / rounded / captioned / 28px) and Emporium (purple /
 * Diatype / square / icon-only / tight 24px) render visibly different here. This
 * is the explicit contrast target the 3c Playwright pass screenshots + computes
 * against. The wrapping [data-theme] is left to the toolbar Theme global, so each
 * pane composes skin × theme orthogonally.
 */
export const SkinContrast: Story = {
  render: () => html`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;height:100vh;">
      <section
        data-skin="garden"
        style="display:flex;flex-direction:column;background:var(--mn-color-surface-base);"
      >
        <mn-top-bar .brand=${'Garden'} .badge=${'fern'}></mn-top-bar>
        <div
          style="flex:1;display:flex;align-items:center;justify-content:center;
                 color:var(--mn-color-text-secondary);font-family:var(--mn-font-chrome);
                 font-size:13px;letter-spacing:0.02em;"
        >
          Garden skin — captioned, rounded, comfortable
        </div>
        <mn-bottom-bar .leftPanelMode=${'files'} .panel=${'chat'}></mn-bottom-bar>
      </section>
      <section
        data-skin="emporium"
        style="display:flex;flex-direction:column;background:var(--mn-color-surface-base);"
      >
        <mn-top-bar .brand=${'Emporium'} .badge=${'purple'}></mn-top-bar>
        <div
          style="flex:1;display:flex;align-items:center;justify-content:center;
                 color:var(--mn-color-text-secondary);font-family:var(--mn-font-chrome);
                 font-size:13px;letter-spacing:0.02em;"
        >
          Emporium skin — icon-only, square, tight 24px
        </div>
      <mn-bottom-bar .leftPanelMode=${'files'} .panel=${'chat'}></mn-bottom-bar>
      </section>
    </div>
  `,
}
