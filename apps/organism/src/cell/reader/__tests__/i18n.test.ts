import { afterEach, describe, expect, it } from 'vitest'
import { localeSource } from '@shrubbery/nucleus'
import '../reader-bar.js'
import '../reader-contents.js'

afterEach(() => {
  document.body.replaceChildren()
  localeSource.set('en')
})

describe('Japanese reader', () => {
  it('renders Contents and reader search labels without translating document titles', async () => {
    localeSource.set('ja')
    const contents = document.createElement('mn-reader-contents')
    const bar = document.createElement('mn-reader-bar')
    bar.title = 'Save'
    document.body.append(contents, bar)
    await Promise.all([contents.updateComplete, bar.updateComplete])
    expect(contents.shadowRoot!.textContent).toContain('目次')
    expect(contents.shadowRoot!.textContent).toContain('このドキュメントには見出しがありません。')
    expect(bar.shadowRoot!.querySelector('[data-search-open]')?.getAttribute('aria-label')).toBe('検索')
    expect(bar.shadowRoot!.querySelector('.title')?.textContent).toContain('Save')
  })
})
