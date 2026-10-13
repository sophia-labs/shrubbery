import { describe, expect, it } from 'vitest'
import { descriptionLength, descriptionWords, estimatedDescriptionTokens } from '../choreo-tool-analysis.js'

describe('tool description analysis', () => {
  it('estimates only supplied name and description text using UTF-8 bytes', () => {
    expect(estimatedDescriptionTokens({ name: 'read', description: 'Open a document.' }))
      .toBe(Math.ceil(new TextEncoder().encode('read\nOpen a document.').length / 4))
    expect(estimatedDescriptionTokens({ name: 'é', description: '漢字' })).toBe(3)
  })

  it('uses mechanical word bands without scoring description quality', () => {
    expect(descriptionWords('  Open   a\n document  ')).toBe(3)
    expect(descriptionLength('')).toBe('missing')
    expect(descriptionLength('Open a document')).toBe('brief')
    expect(descriptionLength(Array(12).fill('word').join(' '))).toBe('standard')
    expect(descriptionLength(Array(61).fill('word').join(' '))).toBe('long')
  })
})
