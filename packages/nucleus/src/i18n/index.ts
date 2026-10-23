import { en } from './en.js'
import { ja } from './ja.js'

export type Locale = 'en' | 'ja'
export type MessageKey = keyof typeof en
export type Message = string | { readonly other: string; readonly one?: string; readonly zero?: string; readonly two?: string; readonly few?: string; readonly many?: string }
export type Catalog = Readonly<Partial<Record<MessageKey, Message>>>
export type MessageParams = Readonly<Record<string, string | number>>

export function resolveLocale(explicit?: string | null, browserLanguage?: string | null): Locale {
  const language = (explicit || browserLanguage || 'en').toLowerCase().split(/[-_]/)[0]
  return language === 'ja' ? 'ja' : 'en'
}

let currentLocale: Locale = 'en'
const listeners = new Set<(locale: Locale) => void>()

export const localeSource = {
  get: (): Locale => currentLocale,
  set(locale: Locale): void {
    if (currentLocale === locale) return
    currentLocale = locale
    for (const listener of [...listeners]) listener(locale)
  },
  subscribe(listener: (locale: Locale) => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}, catalog: Catalog = locale === 'ja' ? ja : en): string {
  const localized = catalog[key]
  const message: Message = localized ?? en[key]
  const messageLocale = localized === undefined ? 'en' : locale
  const template = typeof message === 'string'
    ? message
    : message[new Intl.PluralRules(messageLocale).select(Number(params.count ?? 0))] ?? message.other
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]))
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLocale, key, params)
}

/** For caller-owned UI copy. Use only on interface labels, never document content. A missing label stays empty. */
export function localizeLabel(label: string | null | undefined): string {
  if (!label) return ''
  return Object.prototype.hasOwnProperty.call(en, label) ? t(label as MessageKey) : label
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale = currentLocale): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions, locale = currentLocale): string {
  return new Intl.DateTimeFormat(locale, options).format(value)
}

/** Structural Lit controller contract; the core has no renderer or browser dependency. */
export class LocaleController {
  private unsubscribe?: () => void

  constructor(private readonly host: { addController(controller: LocaleController): void; requestUpdate(): void }) {
    host.addController(this)
  }

  hostConnected(): void {
    this.unsubscribe?.()
    this.unsubscribe = localeSource.subscribe(() => this.host.requestUpdate())
    this.host.requestUpdate()
  }

  hostDisconnected(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
