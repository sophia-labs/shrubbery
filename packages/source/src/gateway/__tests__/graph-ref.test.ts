import { describe, expect, it } from 'vitest'
import {
  graphRefOwner,
  isOwnGraphOwner,
  localGraphKey,
  ownerPrincipal,
  parseLocalGraphKey,
} from '../graph-ref.js'
import { sourceMirrorKey } from '../../mirror/source-mirror.js'

const me = 'a989b9be-4001-709d-193c-b71fcf9ff45f'
const idle = 'user:a989b9be-4001-709d-193c-b71fcf9ff450'

describe('graphs are identified by owner and id', () => {
  it('keeps the account\'s own graphs under their bare id, byte for byte', () => {
    expect(localGraphKey({ owner: null, graphId: 'onboarding' }, me)).toBe('onboarding')
    expect(localGraphKey({ owner: `user:${me}`, graphId: 'onboarding' }, me)).toBe('onboarding')
    expect(localGraphKey({ owner: me, graphId: 'onboarding' }, `user:${me}`)).toBe('onboarding')
    expect(isOwnGraphOwner(undefined, me)).toBe(true)
    expect(graphRefOwner(`user:${me}`, me)).toBeNull()
  })

  it('qualifies another owner\'s same-id graph, so the two keys never meet', () => {
    const theirs = localGraphKey({ owner: idle, graphId: 'onboarding' }, me)
    expect(theirs).not.toBe('onboarding')
    expect(theirs.startsWith('onboarding')).toBe(true)
    expect(parseLocalGraphKey(theirs)).toEqual({ owner: idle, graphId: 'onboarding' })
    expect(parseLocalGraphKey('onboarding')).toEqual({ owner: null, graphId: 'onboarding' })
    expect(graphRefOwner(idle, me)).toBe(idle)
    expect(ownerPrincipal(' sub-1 ')).toBe('user:sub-1')
    expect(() => localGraphKey({ owner: null, graphId: ' ' }, me)).toThrow()
  })

  it('files the offline mirror of each under its own storage key; the own key is unchanged', () => {
    const own = sourceMirrorKey({ userId: me, graphId: 'onboarding' })
    expect(own).toBe(`${me}\u001fonboarding`)
    const theirs = sourceMirrorKey({
      userId: me,
      graphId: 'onboarding',
      localKey: localGraphKey({ owner: idle, graphId: 'onboarding' }, me),
    })
    expect(theirs).not.toBe(own)
    expect(sourceMirrorKey({ userId: me, graphId: 'onboarding', localKey: 'onboarding' })).toBe(own)
  })
})
