// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'lit'
import '@shrubbery/components'
import '@shrubbery/hoja'
import {
  KOCH_FACE_CATALOGUE,
  type KochCurriculumFaceValue,
  type KochPracticeFaceValue,
  type KochProgressFaceValue,
} from '../src/faces.js'
import { KOCH_FACE_IDS } from '../src/face-ids.js'
import { DEFAULT_SETTINGS } from '../src/koch.js'
import { EMPTY_PROGRESS } from '../src/progress.js'

function draw(faceId: string, value: unknown): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const face = KOCH_FACE_CATALOGUE.find((candidate) => candidate.faceId === faceId)
  if (!face) throw new Error(`missing face ${faceId}`)
  render(face.render(target, value), target)
  return target
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('Koch ergonomic face contract', () => {
  it('keeps the active lesson, receiver settings, copy field, and primary action together', async () => {
    const onRunLengthChange = vi.fn()
    const value: KochPracticeFaceValue = {
      backendOnline: true,
      practiceAllowed: true,
      practiceDisabledReason: '',
      activity: 'receive',
      phase: 'ready',
      lesson: 3,
      highestLesson: 3,
      settings: DEFAULT_SETTINGS,
      prompt: null,
      copy: '',
      score: null,
      keyedPattern: '',
      keyedCharacterCount: 0,
      keyDown: false,
      sessionId: '',
      unlocked: false,
      saveError: '',
      audioError: '',
      onStart: vi.fn(),
      onActivityChange: vi.fn(),
      onReplay: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
      onFinishSend: vi.fn(),
      onKeyDown: vi.fn(),
      onKeyUp: vi.fn(),
      onRetrySave: vi.fn(),
      onCopyChange: vi.fn(),
      onLessonChange: vi.fn(),
      onRunLengthChange,
      onCharacterWpmChange: vi.fn(),
      onEffectiveWpmChange: vi.fn(),
      onToneChange: vi.fn(),
    }
    const target = draw(KOCH_FACE_IDS.practice, value)
    await Promise.resolve()

    expect(target.querySelector('h1')?.textContent).toBe('Lesson 3')
    expect(target.querySelectorAll('.active-alphabet span')).toHaveLength(3)
    expect(target.querySelector('select')?.value).toBe('3')
    expect(target.querySelectorAll('.receiver-controls input[type="range"]')).toHaveLength(3)
    expect(target.querySelector('hoja-editor')).not.toBeNull()
    expect(target.querySelector('mn-button[data-primary-run]')?.textContent).toContain('Start 25-character run')

    const runLengthButtons = [...target.querySelectorAll<HTMLButtonElement>('.segmented button')]
    runLengthButtons.find((button) => button.textContent === '50')?.click()
    expect(onRunLengthChange).toHaveBeenCalledWith(50)
  })

  it('prioritizes the current sound and active set while disclosing the full sequence on demand', () => {
    const value: KochCurriculumFaceValue = {
      lesson: 3,
      selectedCharacter: 'U',
      showNotation: true,
      busy: false,
      progress: EMPTY_PROGRESS,
      onCharacterSelect: vi.fn(),
      onNotationChange: vi.fn(),
    }
    const target = draw(KOCH_FACE_IDS.curriculum, value)

    expect(target.querySelector('.character-card')).not.toBeNull()
    expect(target.querySelectorAll('.active-character-grid .character')).toHaveLength(3)
    expect(target.querySelector('.character-detail code')?.textContent).toContain('· · −')
    const disclosure = target.querySelector<HTMLDetailsElement>('.sequence-disclosure')
    expect(disclosure?.open).toBe(false)
    expect(disclosure?.querySelectorAll('.full-character-grid .character')).toHaveLength(41)
  })

  it('keeps progress evidence separate from receiver controls', () => {
    const value: KochProgressFaceValue = {
      progress: EMPTY_PROGRESS,
      actor: { id: 'vera', displayName: 'Vera' },
      activity: 'receive',
      room: { graphId: 'koch-test', title: 'Koch Test', role: 'owner', cellState: 'running' },
      nameDraft: 'Vera',
      performance: {
        graphId: 'koch-test',
        readAt: Date.parse('2026-07-20T20:00:00.000Z'),
        standings: [{
          learnerId: 'urn:mnemosyne:local:graph:koch-test:koch:learner:vera',
          displayName: 'Vera',
          activity: 'receive',
          runs: 2,
          averageScore: 0.95,
          bestScore: 1,
          highestLesson: 3,
          correct: 19,
          total: 20,
          bestTimingScore: null,
          lastCompletedAt: '2026-07-20T19:55:00.000Z',
        }],
        participants: [{
          learnerId: 'urn:mnemosyne:local:graph:koch-test:koch:learner:vera',
          displayName: 'Vera',
          receive: {
            learnerId: 'urn:mnemosyne:local:graph:koch-test:koch:learner:vera',
            displayName: 'Vera',
            activity: 'receive',
            runs: 2,
            averageScore: 0.95,
            bestScore: 1,
            highestLesson: 3,
            correct: 19,
            total: 20,
            bestTimingScore: null,
            lastCompletedAt: '2026-07-20T19:55:00.000Z',
          },
          send: null,
        }],
      },
      accessGrants: [
        { userId: 'vera', role: 'owner', grantedAt: '2026-07-20T18:00:00.000Z', grantedBy: 'vera', displayName: 'Vera' },
        { userId: 'ada', role: 'viewer', grantedAt: '2026-07-20T18:00:00.000Z', grantedBy: 'vera', displayName: 'Ada' },
      ],
      canWrite: true,
      roomBusy: false,
      onNameDraftChange: vi.fn(),
      onSaveName: vi.fn(),
      onCopyInvite: vi.fn(),
    }
    const target = draw(KOCH_FACE_IDS.progress, value)

    expect(target.querySelector('.stat-grid')).not.toBeNull()
    expect(target.querySelector('.receiver-settings')).toBeNull()
    expect(target.querySelector('.unlock-rule')?.textContent).toContain('90%')
    expect(target.querySelectorAll('hoja-editor.compact-composer')).toHaveLength(1)
    expect(target.querySelector('.people-section')?.textContent).toContain('Performance in this graph')
    expect(target.querySelector('[data-kind="reference"]')?.textContent).toBe('koch-test')
    expect(target.querySelectorAll('.people-list > li')).toHaveLength(2)
    expect([...target.querySelectorAll('[data-kind="identity"]')].map((node) => node.textContent)).toContain('Ada')
    expect(target.querySelector('[data-kind="metric"] .mn-kind-value')?.textContent).toBe('100%')
    expect(target.querySelector('.people-list')?.textContent).toContain('no filed run')
  })

  it('presents straight-key sending as a first-class assessed activity', () => {
    const onKeyDown = vi.fn()
    const onKeyUp = vi.fn()
    const value: KochPracticeFaceValue = {
      backendOnline: true,
      practiceAllowed: true,
      practiceDisabledReason: '',
      activity: 'send',
      phase: 'sending',
      lesson: 2,
      highestLesson: 2,
      settings: { ...DEFAULT_SETTINGS, characterCount: 10 },
      prompt: { lesson: 2, characters: ['K', 'M'], plain: 'KMKMKMKMKM', grouped: 'KMKMK MKMKM' },
      copy: '',
      score: null,
      keyedPattern: '.-',
      keyedCharacterCount: 2,
      keyDown: false,
      sessionId: 'send-1',
      unlocked: false,
      saveError: '',
      audioError: '',
      onStart: vi.fn(),
      onActivityChange: vi.fn(),
      onReplay: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
      onFinishSend: vi.fn(),
      onKeyDown,
      onKeyUp,
      onRetrySave: vi.fn(),
      onCopyChange: vi.fn(),
      onLessonChange: vi.fn(),
      onRunLengthChange: vi.fn(),
      onCharacterWpmChange: vi.fn(),
      onEffectiveWpmChange: vi.fn(),
      onToneChange: vi.fn(),
    }
    const target = draw(KOCH_FACE_IDS.practice, value)
    const key = target.querySelector<HTMLButtonElement>('.straight-key')
    expect([...target.querySelectorAll('.send-target span')].map((span) => span.textContent).join('')).toBe('KMKMKMKMKM')
    expect(target.querySelector('.live-pattern code')?.textContent).toBe('.-')
    expect(key).not.toBeNull()
    key?.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }))
    key?.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onKeyUp).toHaveBeenCalledOnce()
  })
})
