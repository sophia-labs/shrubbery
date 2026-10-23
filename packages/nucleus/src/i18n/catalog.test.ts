import { describe, expect, it } from 'vitest'
import { en } from './en.js'
import { intentionallyIdentical, ja } from './ja.js'
import type { Message, MessageKey } from './index.js'

const forms = (message: Message): string[] => typeof message === 'string' ? [message] : Object.values(message).filter((value): value is string => typeof value === 'string')

describe('English and Japanese catalogs', () => {
  it('has a Japanese entry for every English key and no extra keys', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
  })

  it.each(Object.keys(en) as MessageKey[])('%s is translated, nonempty, and preserves parameters', key => {
    const source = forms(en[key])
    const translated = forms(ja[key])
    expect(translated.every(value => value.trim().length > 0)).toBe(true)
    if (!(intentionallyIdentical as readonly string[]).includes(key)) {
      for (const value of translated) expect(source).not.toContain(value)
    }
    const params = (values: string[]): string[] => [...new Set(values.flatMap(value => value.match(/\{\w+\}/g) ?? []))].sort()
    expect(params(translated)).toEqual(params(source))
  })
})
