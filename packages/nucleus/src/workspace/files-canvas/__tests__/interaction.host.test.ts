// @vitest-environment node
/** The two small pieces of the host binding that are pure, so they are tested here and not left to the DOM. */
import { describe, expect, it } from 'vitest'
import { fileKey } from '../../folder-view-contract.js'
import { focusKey, toShellPatch } from '../interaction.js'
import { buildScene, draftKey, ghostKey } from '../scene.js'
import { file, inputOf, keyOf } from './support/fixtures.js'

describe('toShellPatch and focusKey', () => {
  const scene = buildScene({
    ...inputOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 176, y: 16 }]),
    contests: [{ file: file('a'), candidates: [{ id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'theirs', x: 500, y: 300, origin: 'other', label: 'other tab', at: 2 }] }],
    drafts: [{ draftId: 'd', kind: 'folder', label: 'Untitled folder', placement: { x: 336, y: 16 } }],
  }).scene

  it('tells the shell the file a focused card stands for: a real card its own, a ghost the file it is a position of, a draft none', () => {
    expect(toShellPatch({ focused: keyOf(file('b')) }, scene)).toEqual({ focused: file('b') })
    expect(toShellPatch({ focused: ghostKey(keyOf(file('a')), 'theirs') }, scene)).toEqual({ focused: file('a') })
    expect(toShellPatch({ focused: draftKey('d') }, scene)).toEqual({ focused: null })
    expect(toShellPatch({ focused: null }, scene)).toEqual({ focused: null })
    expect(toShellPatch({ focused: 'a card that has gone' }, scene)).toEqual({ focused: null })
  })

  it('passes the camera and the cut buffer through, and says nothing about what did not change', () => {
    const camera = { x: 5, y: 6, zoom: 1.5 }
    expect(toShellPatch({ camera, cut: [file('a')] }, scene)).toEqual({ camera, cut: [file('a')] })
    expect(toShellPatch({}, scene)).toEqual({})
    expect('focused' in toShellPatch({ camera }, scene)).toBe(false)
  })

  it('reads the focus back from the session the shell echoes', () => {
    expect(focusKey({ focused: file('b') })).toBe(fileKey(file('b')))
    expect(focusKey({ focused: null })).toBeNull()
    expect(focusKey({})).toBeNull()
  })

  it('keeps the ghost the host has focused when the shell echoes the file the ghost is a position of: it is the same focus, not a move to the real card', () => {
    const ghost = ghostKey(keyOf(file('a')), 'theirs')
    const told = toShellPatch({ focused: ghost }, scene).focused                      // the file: the shell cannot hold a ghost
    expect(focusKey({ focused: told }, ghost, scene)).toBe(ghost)
    // The real card is a different thing to the host, so a focus on it stays on it, and one the shell moves to another file is taken.
    expect(focusKey({ focused: told }, keyOf(file('a')), scene)).toBe(keyOf(file('a')))
    expect(focusKey({ focused: file('b') }, ghost, scene)).toBe(keyOf(file('b')))
    expect(focusKey({ focused: null }, ghost, scene)).toBeNull()
    // A key the scene no longer has, or no previous focus at all, is what it always was.
    expect(focusKey({ focused: told }, 'a card that has gone', scene)).toBe(keyOf(file('a')))
    expect(focusKey({ focused: told }, null, scene)).toBe(keyOf(file('a')))
    expect(focusKey({ focused: told }, ghost)).toBe(keyOf(file('a')))
  })
})
