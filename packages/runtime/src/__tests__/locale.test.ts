import { afterEach, describe, expect, it } from 'vitest'
import { LitElement, html } from 'lit'
import { localeSource, t } from '@shrubbery/nucleus'
import { installLocale, LocaleController, setLanguage } from '../locale.js'

class LocaleExample extends LitElement {
  protected readonly locale = new LocaleController(this)
  render() { return html`<button>${t('Save')}</button>` }
}
if (!customElements.get('locale-example')) customElements.define('locale-example', LocaleExample)

afterEach(() => {
  document.body.replaceChildren()
  localeSource.set('en')
})

describe('browser locale', () => {
  it('updates open Lit surfaces, persists an explicit setting, and sets html lang', async () => {
    const previous = localStorage.getItem('shrubbery.locale')
    const previousLang = document.documentElement.lang
    const dispose = installLocale()
    const element = document.createElement('locale-example') as LocaleExample
    try {
      document.body.append(element)
      await element.updateComplete
      setLanguage('ja')
      await element.updateComplete
      expect(element.shadowRoot!.textContent).toContain('保存')
      expect(document.documentElement.lang).toBe('ja')
      expect(localStorage.getItem('shrubbery.locale')).toBe('ja')
      setLanguage('en')
      await element.updateComplete
      expect(element.shadowRoot!.textContent).toContain('Save')
      expect(document.documentElement.lang).toBe('en')
    } finally {
      dispose()
      if (previous === null) localStorage.removeItem('shrubbery.locale')
      else localStorage.setItem('shrubbery.locale', previous)
      document.documentElement.lang = previousLang
    }
  })
})
