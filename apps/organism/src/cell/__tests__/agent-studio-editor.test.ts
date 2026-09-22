import { canonicalJson, createSophiaClusterLeadProfile } from '@shrubbery/domain-kit/agent-studio'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../agent-studio-editor.js'
import type { AgentStudioApi, AgentStudioSnapshot } from '../agent-studio-api.js'
import type { MnAgentStudioEditor } from '../agent-studio-editor.js'

const profile = createSophiaClusterLeadProfile({
  ownerPrincipal: 'user:vera',
  runtimeBundleDigest: `sha256:${'a'.repeat(64)}`,
})

function snapshot(revision = 1): AgentStudioSnapshot {
  return {
    profile: {
      profile,
      canonicalContent: canonicalJson(profile),
      revision,
      updatedAt: `2026-08-09T12:00:0${revision}.000Z`,
    },
    activeDefinition: null,
  }
}

describe('mn-agent-studio-editor', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('exposes the complete source surface and keeps publish behind saved confirmation', async () => {
    const api = {
      load: vi.fn(async () => snapshot()),
      saveDraft: vi.fn(async () => snapshot(2)),
      publish: vi.fn(async () => ({
        snapshot: snapshot(2),
        publication: { publicationId: 'asp_test', agentId: 'agent-test' },
      })),
    } as unknown as AgentStudioApi
    const editor = document.createElement('mn-agent-studio-editor') as MnAgentStudioEditor
    editor.api = api
    document.body.append(editor)
    await editor.updateComplete
    await new Promise(resolve => setTimeout(resolve, 0))
    await editor.updateComplete

    const text = editor.shadowRoot!.textContent ?? ''
    for (const label of [
      'Identity & graph authority', 'System prompt', 'Charter', 'Geist', 'Inference',
      'Runtime profiles', 'Skills & harness', 'Tool manifest', 'Tool grant',
      'Domain budgets', 'Delegation', 'Triggers', 'Response schema',
    ]) expect(text).toContain(label)

    const publish = [...editor.shadowRoot!.querySelectorAll('button')].find(button => button.textContent === 'Publish')!
    expect(publish.disabled).toBe(true)
    const displayName = [...editor.shadowRoot!.querySelectorAll('label')]
      .find(label => label.textContent?.includes('Display name'))!
      .querySelector('input')!
    displayName.value = 'Vera’s Lead Agent'
    displayName.dispatchEvent(new Event('input', { bubbles: true }))
    await editor.updateComplete
    const save = [...editor.shadowRoot!.querySelectorAll('button')].find(button => button.textContent === 'Save draft')!
    save.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.saveDraft).toHaveBeenCalledOnce()
  })

  it('shows parse failures without mutating the durable profile', async () => {
    const api = { load: vi.fn(async () => snapshot()), saveDraft: vi.fn() } as unknown as AgentStudioApi
    const editor = document.createElement('mn-agent-studio-editor') as MnAgentStudioEditor
    editor.api = api
    document.body.append(editor)
    await editor.updateComplete
    await new Promise(resolve => setTimeout(resolve, 0))
    await editor.updateComplete
    const json = editor.shadowRoot!.querySelector<HTMLTextAreaElement>('textarea.json')!
    json.value = '{'
    json.dispatchEvent(new Event('input', { bubbles: true }))
    const validate = [...editor.shadowRoot!.querySelectorAll('button')].find(button => button.textContent === 'Validate')!
    validate.click()
    await editor.updateComplete
    expect(editor.shadowRoot!.textContent).toContain('Runtime profiles is not valid JSON')
    expect(api.saveDraft).not.toHaveBeenCalled()
  })
})
