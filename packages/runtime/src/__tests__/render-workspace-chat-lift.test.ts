/**
 * render-workspace chat lift — the first real Garden chat-region strangle.
 *
 * NO MOCKS: the lifted path uses the production renderWorkspace(), the production
 * mountChatHost(), a real local ChatService, and the real <sh-chat-host> which
 * imperatively mounts the real <sh-chat-panel>. The no-host path stays inert.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace } from '../render-workspace.js'
import { makeLocalChatService } from '../chat-services/local-chat-service.js'
import type { ShChatHost } from '../chat-host/chat-host.js'

const chatHost = (c: HTMLElement) => c.querySelector('#sh-chat-host') as ShChatHost | null

async function settle(container: HTMLElement): Promise<void> {
  const h = chatHost(container)
  if (!h) return
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('renderWorkspace chat lift', () => {
  it('keeps mn-chat-panel inert when no chatHost option is supplied', () => {
    const container = renderWorkspace(GARDEN_DEFAULT)
    const rightPane = container.querySelector('.split-pane[data-region="region-right-rail"]')
    expect(rightPane).not.toBeNull()
    expect(rightPane!.querySelector('mn-chat-panel')).not.toBeNull()
    expect(rightPane!.querySelector('#sh-chat-host')).toBeNull()
  })

  it('lifts the configured mn-chat-panel region into the real sh-chat-host organism', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'workspace-chat-lift' })

    const container = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: { service, sessionId: session.id },
    })
    document.body.appendChild(container)
    await settle(container)

    const rightPane = container.querySelector('.split-pane[data-region="region-right-rail"]')
    const host = chatHost(container)
    expect(rightPane).not.toBeNull()
    expect(host).not.toBeNull()
    expect(host!.closest('.split-pane')).toBe(rightPane)
    expect(rightPane!.querySelector('mn-chat-panel')).toBeNull()
    expect(host!.panel).not.toBeNull()
    expect(host!.panel!.tagName.toLowerCase()).toBe('sh-chat-panel')
  })

  it('threads chatHost.onHeaderAction through to the real sh-chat-host (regression: pop-out button was a dead click)', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'workspace-chat-header-action' })
    const seen: string[] = []

    const container = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: {
        service,
        sessionId: session.id,
        onHeaderAction: (detail) => seen.push(detail.action),
      },
    })
    document.body.appendChild(container)
    await settle(container)

    const host = chatHost(container)
    expect(host!.onHeaderAction).toBeTypeOf('function')
    // sh-chat-panel renders in a CLOSED shadow root (unlike the mn-* Lit
    // components), so its popout button isn't reachable from outside via
    // querySelector — exercise the same path chat-host wires the button's
    // click handler to instead: the panel's own onHeaderAction property,
    // which chat-host._applyToPanel() sets unconditionally.
    const panel = host!.panel!
    expect(panel.onHeaderAction).toBeTypeOf('function')
    void panel.onHeaderAction!('popout')
    await settle(container)

    expect(seen).toEqual(['popout'])
  })

  it('keeps the same live chat host and panel across a store-style workspace re-render', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'workspace-chat-survival' })
    const container = document.createElement('div')
    document.body.appendChild(container)

    renderWorkspace(GARDEN_DEFAULT, { container, chatHost: { service, sessionId: session.id } })
    await settle(container)
    const host0 = chatHost(container)!
    const panel0 = host0.panel
    expect(host0).not.toBeNull()
    expect(panel0).not.toBeNull()

    renderWorkspace(GARDEN_DEFAULT, { container, chatHost: { service, sessionId: session.id } })
    await settle(container)
    const host1 = chatHost(container)!

    expect(host1).toBe(host0)
    expect(host1.panel).toBe(panel0)
  })

  it('projects the same live host and panel full-screen, then restores it to the rail', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'workspace-chat-projection' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const seen: string[] = []

    const renderPresentation = (presentation: 'rail' | 'fullscreen'): void => {
      renderWorkspace(GARDEN_DEFAULT, {
        container,
        chatHost: {
          service,
          sessionId: session.id,
          presentation,
          onHeaderAction: detail => seen.push(detail.action),
        },
      })
    }

    renderPresentation('rail')
    await settle(container)
    const host0 = chatHost(container)!
    const panel0 = host0.panel!
    const hoja0 = panel0.querySelector('hoja-editor[posture="composer"]') as HTMLElement & {
      updateComplete: Promise<boolean>
    }
    await hoja0.updateComplete
    const proseMirror0 = hoja0.querySelector('.ProseMirror')
    const expand0 = panel0.querySelector(
      '.icon-button[aria-label="Expand conversation"]',
    ) as HTMLButtonElement
    expand0.focus()
    expand0.click()
    await Promise.resolve()
    expect(seen).toEqual(['popout'])

    renderPresentation('fullscreen')
    await settle(container)
    const host1 = chatHost(container)!
    const panel1 = host1.panel!
    const restore = panel1.querySelector(
      '.icon-button[aria-label="Return conversation to sidebar"]',
    ) as HTMLButtonElement
    expect(host1).toBe(host0)
    expect(panel1).toBe(panel0)
    expect(panel1.querySelector('hoja-editor[posture="composer"]')).toBe(hoja0)
    expect(hoja0.querySelector('.ProseMirror')).toBe(proseMirror0)
    expect(restore).toBe(expand0)
    expect(host1.presentation).toBe('fullscreen')
    expect(panel1.presentation).toBe('fullscreen')
    expect(host1.shadowRoot?.activeElement).toBe(expand0)

    restore.click()
    await Promise.resolve()
    expect(seen).toEqual(['popout', 'restore'])

    renderPresentation('rail')
    await settle(container)
    const host2 = chatHost(container)!
    expect(host2).toBe(host0)
    expect(host2.panel).toBe(panel0)
    expect(panel0.querySelector('hoja-editor[posture="composer"]')).toBe(hoja0)
    expect(hoja0.querySelector('.ProseMirror')).toBe(proseMirror0)
    expect(host2.presentation).toBe('rail')
    expect(panel0.presentation).toBe('rail')
    expect(panel0.querySelector('[aria-label="Expand conversation"]')).toBe(expand0)
    expect(host2.shadowRoot?.activeElement).toBe(expand0)
  })

  it('lifts chat inside a controlled scalar right panel', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'workspace-chat-stack' })

    const container = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: { service, sessionId: session.id },
      chrome: { rightPanel: 'chat' },
    })
    document.body.appendChild(container)
    await settle(container)

    const panels = Array.from(container.querySelectorAll('.right-panel'))
      .map((el) => el.getAttribute('data-panel'))
    const host = chatHost(container)

    expect(panels).toEqual(['chat'])
    expect(host).not.toBeNull()
    expect(host!.closest('.right-panel')?.getAttribute('data-panel')).toBe('chat')
    expect(container.querySelector('.right-panel[data-panel="chat"] mn-chat-panel')).toBeNull()
    expect(container.querySelector('.right-panel[data-panel="wires"]')).toBeNull()
  })
})
