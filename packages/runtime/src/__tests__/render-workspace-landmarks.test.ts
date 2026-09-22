import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { describe, expect, it } from 'vitest'
import { renderWorkspace } from '../render-workspace.js'

describe('Garden spine landmarks', () => {
  it('exposes navigation, main, and complementary landmarks in spine order', () => {
    const frame = renderWorkspace(GARDEN_DEFAULT)
    const landmarks = Array.from(frame.querySelectorAll<HTMLElement>(
      '[role="navigation"], [role="main"], [role="complementary"]',
    ))
    expect(landmarks.map(node => node.getAttribute('role'))).toEqual([
      'navigation', 'main', 'complementary',
    ])
    expect(landmarks[0]?.getAttribute('aria-label')).toBe('Workspace')
    expect(landmarks[2]?.getAttribute('aria-label')).toBe('Secondary panels')
  })

  it('keeps exactly one main landmark when the lifted editor owns the canonical anchor', () => {
    const frame = renderWorkspace(GARDEN_DEFAULT, {
      editorHost: {
        get: () => ({
          centerMode: 'document',
          graphId: 'graph-a',
          documentId: 'doc-a',
          status: 'idle',
          error: null,
          provider: null,
        }),
        subscribe: () => () => undefined,
      },
    })
    const centerPane = frame.querySelector<HTMLElement>('[data-role="center"]')
    const mains = frame.querySelectorAll<HTMLElement>('[role="main"]')
    expect(centerPane?.hasAttribute('role')).toBe(false)
    expect(mains).toHaveLength(1)
    expect(mains[0]?.id).toBe('mn-main-editor')
  })
})
