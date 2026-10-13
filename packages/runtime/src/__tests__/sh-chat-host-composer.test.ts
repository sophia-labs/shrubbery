/**
 * The composer after Send, through the REAL editor (NO MOCKS).
 *
 * Defect guarded (F-step-zero D1, seen live): the composer kept the sent text after
 * a successful send, in the panel, in the editor and in sessionStorage, and the
 * next message was glued onto it ("…workspace?Now say that again…"). The survival
 * tests missed it because they drive the composer through a synthetic `onChange`
 * callback: no ProseMirror document ever held the text, so the editor's own echo
 * of it could not happen. Here a person types through the editor's real view, then
 * sends by clicking Send and by pressing Enter.
 */

import type { Editor } from '@shrubbery/editor-kernel'
import { html, render, type nothing } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import { makeLocalChatService, mountChatHost } from '../index.js'
import type { ShChatHost } from '../index.js'

afterEach(() => {
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

const chatHost = (container: HTMLElement) => container.querySelector('#sh-chat-host') as ShChatHost | null

function connectedContainer(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

function mountHost(container: HTMLElement, service: ReturnType<typeof makeLocalChatService>, sessionId: string): void {
  render(html`<div class="main">${mountChatHost(service, sessionId) as unknown as typeof nothing}</div>`, container)
}

async function settle(container: HTMLElement): Promise<void> {
  const host = chatHost(container)
  if (!host) return
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

type HojaElement = HTMLElement & { value: string; updateComplete: Promise<boolean> }

const panelOf = (host: ShChatHost) => host.panel!
const composerOf = (host: ShChatHost): HojaElement =>
  panelOf(host).querySelector('hoja-editor[posture="composer"]') as HojaElement
const editorOf = (host: ShChatHost): Editor => (composerOf(host) as unknown as { editor: Editor }).editor
const composerText = (host: ShChatHost): string => composerOf(host).querySelector('.ProseMirror')?.textContent ?? ''
const userTurns = (host: ShChatHost): string[] =>
  Array.from(panelOf(host).querySelectorAll('.message.user')).map(node => node.textContent ?? '')

/** A person typing: one real ProseMirror transaction through the editor's own view. */
async function type(host: ShChatHost, text: string): Promise<void> {
  const editor = editorOf(host)
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.insertText(text, from, to))
  await panelOf(host).updateComplete
  await composerOf(host).updateComplete
}

async function clickSend(host: ShChatHost): Promise<void> {
  const button = panelOf(host).querySelector<HTMLButtonElement>('.send-button')!
  expect(button.disabled).toBe(false)
  button.click()
}

function pressEnter(host: ShChatHost): void {
  composerOf(host).querySelector('.ProseMirror')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
}

async function finishTurn(host: ShChatHost, container: HTMLElement, bubbles: number): Promise<void> {
  await until(() =>
    host.store?.getState().streaming === false
    && panelOf(host).querySelectorAll('.message').length >= bubbles)
  await settle(container)
}

async function ready(): Promise<{
  service: ReturnType<typeof makeLocalChatService>
  sessionId: string
  container: HTMLElement
  host: ShChatHost
}> {
  const service = makeLocalChatService()
  const session = await service.createSession({ title: 't' })
  const container = connectedContainer()
  mountHost(container, service, session.id)
  await settle(container)
  const host = chatHost(container)!
  // The panel, its composer and TipTap under it each mount a tick after the last.
  await until(() => {
    const hoja = host.panel?.querySelector('hoja-editor[posture="composer"]') as
      | (HTMLElement & { editor?: Editor | null })
      | null
      | undefined
    return Boolean(hoja?.editor)
  })
  return { service, sessionId: session.id, container, host }
}

describe('the composer after Send, through the real editor', () => {
  it('is empty in the panel, in the editor and in sessionStorage after a click on Send', async () => {
    const { sessionId, container, host } = await ready()
    await type(host, 'Reply with one sentence.')
    expect(panelOf(host).draft).toBe('Reply with one sentence.')
    expect(window.sessionStorage.getItem(`garden:chat:draft:${sessionId}`)).toBe('Reply with one sentence.')

    await clickSend(host)
    await finishTurn(host, container, 2)

    expect(userTurns(host)).toHaveLength(1)
    expect(panelOf(host).draft).toBe('')
    expect(composerOf(host).value).toBe('')
    expect(composerText(host)).toBe('')
    expect(window.sessionStorage.getItem(`garden:chat:draft:${sessionId}`)).toBeNull()
  })

  it('is empty after Enter as well', async () => {
    const { sessionId, container, host } = await ready()
    await type(host, 'Sent with the keyboard.')

    pressEnter(host)
    await finishTurn(host, container, 2)

    expect(panelOf(host).draft).toBe('')
    expect(composerText(host)).toBe('')
    expect(window.sessionStorage.getItem(`garden:chat:draft:${sessionId}`)).toBeNull()
  })

  it('sends the second message on its own, not glued to the first', async () => {
    const { service, sessionId, container, host } = await ready()
    await type(host, 'Reply with one sentence: what can you help me with?')
    await clickSend(host)
    await finishTurn(host, container, 2)

    await type(host, 'Now say that again in five words or fewer.')
    expect(composerText(host)).toBe('Now say that again in five words or fewer.')
    await clickSend(host)
    await finishTurn(host, container, 4)

    const said = (await service.hydrateSession(sessionId)).messages
      .filter(message => message.role === 'user')
      .map(message => message.content)
    expect(said).toEqual([
      'Reply with one sentence: what can you help me with?',
      'Now say that again in five words or fewer.',
    ])
    expect(composerText(host)).toBe('')
  })

  it('keeps an unsent draft: typing alone is not a send', async () => {
    const { sessionId, host } = await ready()
    await type(host, 'still thinking about it')
    await panelOf(host).updateComplete
    expect(composerText(host)).toBe('still thinking about it')
    expect(window.sessionStorage.getItem(`garden:chat:draft:${sessionId}`)).toBe('still thinking about it')
  })
})
