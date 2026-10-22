import { describe, expect, it } from 'vitest'
import { documentLink, isMnemosyneLink, linkOfTarget, objectLink, parseLink, recordOfTarget, targetOfElement } from './links.js'

describe('whiteboard links', () => {
  const iri = 'urn:mnemosyne:local:graph:freud:run:r1#item/1 a'

  it('round-trips document and object links, whatever the characters', () => {
    expect(parseLink(documentLink('freud', 'doc 1/x'))).toEqual({ kind: 'document', graphId: 'freud', documentId: 'doc 1/x' })
    expect(parseLink(objectLink('freud', iri))).toEqual({ kind: 'object', graphId: 'freud', iri })
  })

  it('reads a web address, a malformed link and an unknown kind as no target', () => {
    expect(parseLink('https://example.com/a')).toBeNull()
    expect(parseLink('mnemosyne://document/freud')).toBeNull()
    expect(parseLink('mnemosyne://widget/freud/x')).toBeNull()
    expect(parseLink('mnemosyne://document/freud/%zz')).toBeNull()
    expect(isMnemosyneLink('https://example.com')).toBe(false)
    expect(isMnemosyneLink(null)).toBe(false)
  })

  it('reads an element back into the target it was linked to, with its snapshot', () => {
    const target = { kind: 'object', graphId: 'freud', iri, label: 'The Wolf Man dream', classLabel: 'DreamReport' } as const
    const element = { link: linkOfTarget(target), customData: { mnemosyne: recordOfTarget(target) } }
    expect(targetOfElement(element)).toEqual(target)
    expect(targetOfElement({ link: 'https://example.com' })).toBeNull()
  })
})
