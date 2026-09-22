/**
 * REAL artifact editor component.
 *
 * Fabric owns only local canvas editing state here. Save/generate/cancel leave
 * the component as composed intents, so hosts own persistence and AI effects.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../mn-artifact-editor.js'
import type {
  MnArtifactEditor,
  MnArtifactEditorGenerateDetail,
  MnArtifactEditorSaveDetail,
} from '../mn-artifact-editor.js'

async function mount(setup?: (el: MnArtifactEditor) => void): Promise<MnArtifactEditor> {
  const el = document.createElement('mn-artifact-editor') as MnArtifactEditor
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnArtifactEditor) => el.shadowRoot!
const text = (node: ParentNode) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''

describe('mn-artifact-editor', () => {
  beforeAll(() => {
    expect(customElements.get('mn-artifact-editor')).toBeDefined()
  })

  it('renders the lifted image-editor controls and canvas surface', async () => {
    const el = await mount((node) => {
      node.mimeType = 'image/jpeg'
      node.prompt = 'remove the background'
      node.generationTarget = 'artifact'
      node.generationError = 'Generation quota reached'
    })

    expect(sr(el).querySelector('canvas')).not.toBeNull()
    expect(text(sr(el))).toContain('Pan')
    expect(text(sr(el))).toContain('Crop')
    expect(text(sr(el))).toContain('Draw')
    expect(text(sr(el))).toContain('Save version')
    expect((sr(el).querySelector('.prompt') as HTMLInputElement).value).toBe('remove the background')
    expect((sr(el).querySelector('select') as HTMLSelectElement).value).toBe('artifact')
    expect(text(sr(el))).toContain('Generation quota reached')
  })

  it('emits save, generate, and cancel as host-owned intents', async () => {
    const el = await mount((node) => {
      node.mimeType = 'image/png'
      node.prompt = 'make it blue'
      node.generationTarget = 'version'
    })

    const saves: MnArtifactEditorSaveDetail[] = []
    const generations: MnArtifactEditorGenerateDetail[] = []
    let cancelled = 0
    el.addEventListener('mn-artifact-editor-save', ((event: CustomEvent<MnArtifactEditorSaveDetail>) => {
      saves.push(event.detail)
    }) as EventListener)
    el.addEventListener('mn-artifact-editor-generate', ((event: CustomEvent<MnArtifactEditorGenerateDetail>) => {
      generations.push(event.detail)
    }) as EventListener)
    el.addEventListener('mn-artifact-editor-cancel', () => {
      cancelled += 1
    })

    const buttons = [...sr(el).querySelectorAll('button')] as HTMLButtonElement[]
    buttons.find((button) => button.textContent?.includes('Save version'))!.click()
    buttons.find((button) => button.textContent?.trim() === 'Generate')!.click()
    buttons.find((button) => button.textContent?.trim() === 'Cancel')!.click()

    expect(saves).toHaveLength(1)
    expect(saves[0].mimeType).toBe('image/png')
    expect(typeof saves[0].dataUrl).toBe('string')
    expect(generations).toEqual([
      {
        dataUrl: saves[0].dataUrl,
        mimeType: 'image/png',
        prompt: 'make it blue',
        target: 'version',
      },
    ])
    expect(cancelled).toBe(1)
  })

  it('keeps generation disabled while prompt is empty or host is generating', async () => {
    const el = await mount((node) => {
      node.prompt = ''
    })

    const generate = () =>
      ([...sr(el).querySelectorAll('button')] as HTMLButtonElement[])
        .find((button) => button.textContent?.trim() === 'Generate' || button.textContent?.trim() === 'Generating...')!

    expect(generate().disabled).toBe(true)

    el.prompt = 'try this'
    el.generating = true
    await el.updateComplete

    expect(generate().disabled).toBe(true)
    expect(text(sr(el))).toContain('Generating...')
  })
})
