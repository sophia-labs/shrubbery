/**
 * Workspace — the REAL render host (@shrubbery/runtime) rendering a REAL config
 * (GARDEN_DEFAULT / GARDEN_VARIANT from @shrubbery/nucleus) into the DOM, under
 * the REAL token system. NO mock arg bag — the config IS the library literal.
 *
 * Unbuilt regions render as inert, labeled placeholders (the runtime's own
 * behavior) — never faked content. Flip Skin/Theme to re-skin the upgraded
 * chrome live.
 */
import type { Meta, StoryObj } from '@storybook/web-components'

import '@shrubbery/components' // upgrade seam
import { renderWorkspace } from '@shrubbery/runtime'
import { GARDEN_DEFAULT, GARDEN_VARIANT, type WorkspaceConfig } from '@shrubbery/nucleus'

const meta: Meta = {
  title: 'Workspace/Render host',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

/** Render a REAL config into a host div + label still-undefined placeholders. */
function renderInto(config: WorkspaceConfig, app?: string): HTMLElement {
  const host = document.createElement('div')
  host.style.height = '100vh'
  host.style.display = 'flex'
  host.style.flexDirection = 'column'
  host.style.background = 'var(--mn-color-surface-base)'
  host.style.color = 'var(--mn-color-text-primary)'
  host.style.fontFamily = 'var(--mn-font-chrome)'
  renderWorkspace(config, { container: host, app })
  for (const el of Array.from(host.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase()
    if (tag.includes('-') && !customElements.get(tag)) {
      el.setAttribute('data-placeholder-for', tag)
      ;(el as HTMLElement).style.cssText =
        'display:flex;align-items:center;justify-content:center;flex:1;color:var(--mn-color-text-tertiary);font-size:12px;font-family:ui-monospace,monospace;border:1px dashed var(--mn-color-border-default);'
      el.textContent = `⟨ ${tag} — inert placeholder ⟩`
    }
  }
  return host
}

export const GardenDefault: Story = {
  render: () => renderInto(GARDEN_DEFAULT),
}

export const GardenVariant: Story = {
  render: () => renderInto(GARDEN_VARIANT),
}

export const ChoreographApp: Story = {
  render: () => renderInto(GARDEN_DEFAULT, 'choreograph'),
}
