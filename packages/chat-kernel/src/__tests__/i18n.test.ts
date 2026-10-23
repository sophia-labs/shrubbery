import { afterEach, describe, expect, it } from 'vitest'
import { localeSource } from '@shrubbery/nucleus'
import { ShChatPanel } from '../chat-panel.js'

void ShChatPanel

afterEach(() => {
  document.body.replaceChildren()
  localeSource.set('en')
})

describe('Japanese chat chrome', () => {
  it('renders and updates composer labels without reloading the conversation', async () => {
    localeSource.set('ja')
    const element = document.createElement('sh-chat-panel') as ShChatPanel
    element.draft = 'Save'
    document.body.append(element)
    await element.updateComplete
    expect(element.querySelector('.send-button')?.getAttribute('aria-label')).toBe('メッセージを送信')
    expect(element.querySelector('.composer-label')?.textContent).toContain('にメッセージ')
    localeSource.set('en')
    await element.updateComplete
    expect(element.querySelector('.send-button')?.getAttribute('aria-label')).toBe('Send message')
    expect(element.draft).toBe('Save')
  })
})
