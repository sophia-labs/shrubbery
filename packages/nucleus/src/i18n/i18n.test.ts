import { afterEach, describe, expect, it } from 'vitest'
import { formatDate, formatNumber, localeSource, resolveLocale, t, translate } from './index.js'

afterEach(() => localeSource.set('en'))

describe('i18n core', () => {
  it('interpolates parameters without interpreting HTML or replacement characters', () => {
    expect(translate('en', 'greeting', { name: '<Vera> $&' })).toBe('Hello, <Vera> $&')
    expect(translate('ja', 'greeting', { name: 'ヴェラ' })).toBe('こんにちは、ヴェラさん')
    expect(translate('en', 'greeting')).toBe('Hello, {name}')
  })

  it('selects plural forms through Intl.PluralRules', () => {
    expect(translate('en', 'items.count', { count: 0 })).toBe('0 items')
    expect(translate('en', 'items.count', { count: 1 })).toBe('1 item')
    expect(translate('en', 'items.count', { count: 2 })).toBe('2 items')
    expect(translate('ja', 'items.count', { count: 1 })).toBe('1件')
    expect(translate('ja', 'items.count', { count: 20 })).toBe('20件')
    expect(translate('en', 'items.count', { count: 1 }, { 'items.count': { other: '{count} total' } })).toBe('1 total')
  })

  it('falls back to English for each missing key', () => {
    expect(translate('ja', 'Save', {}, { Delete: '削除' })).toBe('Save')
    expect(translate('ja', 'Delete', {}, { Delete: '削除' })).toBe('削除')
    expect(translate('ja', 'greeting', { name: 'Vera' }, {})).toBe('Hello, Vera')
    expect(translate('ja', 'items.count', { count: 1 }, {})).toBe('1 item')
  })

  it.each([
    ['ja', 'en-US', 'ja'],
    ['en', 'ja-JP', 'en'],
    [null, 'ja-JP', 'ja'],
    [undefined, 'JA_jp', 'ja'],
    ['', 'ja', 'ja'],
    [undefined, undefined, 'en'],
    [undefined, 'fr-FR', 'en'],
    ['fr', 'ja', 'en'],
  ] as const)('resolves setting %s and browser language %s to %s', (setting, browser, expected) => {
    expect(resolveLocale(setting, browser)).toBe(expected)
  })

  it('publishes changes once and releases subscribers', () => {
    const seen: string[] = []
    const unsubscribe = localeSource.subscribe(locale => seen.push(locale))
    localeSource.set('ja')
    localeSource.set('ja')
    expect(t('Save')).toBe('保存')
    unsubscribe()
    localeSource.set('en')
    expect(seen).toEqual(['ja'])
  })

  it('defers subscriptions added while publishing until the next change', () => {
    const seen: string[] = []
    let stopReplacement: (() => void) | undefined
    const stopFirst = localeSource.subscribe(() => {
      seen.push('first')
      stopFirst()
      stopReplacement = localeSource.subscribe(() => { seen.push('replacement') })
    })
    try {
      localeSource.set('ja')
      expect(seen).toEqual(['first'])
      localeSource.set('en')
      expect(seen).toEqual(['first', 'replacement'])
    } finally {
      stopFirst()
      stopReplacement?.()
    }
  })

  it('formats numbers and dates in the active locale', () => {
    localeSource.set('ja')
    expect(formatNumber(12345.6)).toBe(new Intl.NumberFormat('ja').format(12345.6))
    const date = new Date('2026-10-22T12:00:00Z')
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const
    expect(formatDate(date, options)).toBe(new Intl.DateTimeFormat('ja', options).format(date))
    expect(formatNumber(12.5, { style: 'currency', currency: 'USD' }, 'en')).toBe('$12.50')
  })
})
