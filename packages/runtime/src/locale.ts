import { localeSource, resolveLocale } from '@shrubbery/nucleus'
export { LocaleController } from '@shrubbery/nucleus'

const LOCALE_STORAGE_KEY = 'shrubbery.locale'

/** The browser edge owns persistence and document metadata, just as it owns theme. */
export function installLocale(doc: Document = document, browser: Window = window): () => void {
  let explicit: string | null = null
  try { explicit = browser.localStorage.getItem(LOCALE_STORAGE_KEY) } catch { /* Storage may be unavailable. */ }
  localeSource.set(resolveLocale(explicit, browser.navigator.language))
  const sync = (): void => { doc.documentElement.lang = localeSource.get() }
  sync()
  const unsubscribe = localeSource.subscribe(sync)
  const onStorage = (event: StorageEvent): void => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
      localeSource.set(resolveLocale(event.newValue, browser.navigator.language))
    }
  }
  browser.addEventListener('storage', onStorage)
  return () => {
    unsubscribe()
    browser.removeEventListener('storage', onStorage)
  }
}

export function setLanguage(value: string, storage?: Pick<Storage, 'setItem'> | null): void {
  const locale = resolveLocale(value)
  try { (storage === undefined ? globalThis.localStorage : storage)?.setItem(LOCALE_STORAGE_KEY, locale) } catch { /* Keep the in-memory preference. */ }
  localeSource.set(locale)
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') installLocale()
