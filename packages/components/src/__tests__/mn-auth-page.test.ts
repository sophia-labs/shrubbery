/**
 * REAL component test - Garden auth forms as pure Shrubbery chrome.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '../mn-auth-page.js'
import type {
  MnAuthModeChangeDetail,
  MnAuthPage,
  MnAuthSignInDetail,
  MnAuthSignUpDetail,
  MnAuthVerifyEmailDetail,
  MnSignInForm,
  MnSignUpForm,
  MnVerifyEmailForm,
} from '../mn-auth-page.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount<T extends HTMLElement>(tag: string, setup?: (el: T) => void): Promise<T> {
  const el = document.createElement(tag) as T
  setup?.(el)
  document.body.appendChild(el)
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete
  return el
}

function setInput(root: ShadowRoot, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector)!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
}

function setCheck(root: ShadowRoot, selector: string, checked: boolean): void {
  const input = root.querySelector<HTMLInputElement>(selector)!
  input.checked = checked
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

describe('mn-auth-page and auth forms', () => {
  beforeAll(() => {
    expect(customElements.get('mn-auth-page')).toBeDefined()
    expect(customElements.get('mn-sign-in-form')).toBeDefined()
    expect(customElements.get('mn-sign-up-form')).toBeDefined()
    expect(customElements.get('mn-verify-email-form')).toBeDefined()
  })

  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('sign-in form emits credentials and switch mode intents without auth services', async () => {
    const el = await mount<MnSignInForm>('mn-sign-in-form')
    const submissions: MnAuthSignInDetail[] = []
    const modes: MnAuthModeChangeDetail[] = []
    const legacy: string[] = []
    el.addEventListener('mn-auth-sign-in-submit', event => {
      submissions.push((event as CustomEvent<MnAuthSignInDetail>).detail)
    })
    el.addEventListener('mn-auth-mode-change', event => {
      modes.push((event as CustomEvent<MnAuthModeChangeDetail>).detail)
    })
    el.addEventListener('switch-to-signup', () => legacy.push('signup'))

    setInput(sr(el), '[data-auth-field="identity"]', 'vera@example.com')
    setInput(sr(el), '[data-auth-field="password"]', 'correct horse')
    await el.updateComplete
    sr(el).querySelector<HTMLFormElement>('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    sr(el).querySelector<HTMLButtonElement>('.link-button')!.click()

    expect(submissions).toEqual([{ identity: 'vera@example.com', password: 'correct horse' }])
    expect(modes).toEqual([{ mode: 'signup' }])
    expect(legacy).toEqual(['signup'])
  })

  it('sign-up form validates locally and emits a pure create-account intent', async () => {
    const el = await mount<MnSignUpForm>('mn-sign-up-form')
    const submissions: MnAuthSignUpDetail[] = []
    el.addEventListener('mn-auth-sign-up-submit', event => {
      submissions.push((event as CustomEvent<MnAuthSignUpDetail>).detail)
    })

    sr(el).querySelector<HTMLFormElement>('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(sr(el).textContent).toContain('Username is required')
    expect(submissions).toEqual([])

    setInput(sr(el), '[data-auth-field="username"]', 'vera')
    setInput(sr(el), '[data-auth-field="email"]', 'vera@example.com')
    setInput(sr(el), '[data-auth-field="name"]', 'Vera')
    setInput(sr(el), '[data-auth-field="password"]', 'GoodPass1')
    setInput(sr(el), '[data-auth-field="confirmPassword"]', 'GoodPass1')
    setCheck(sr(el), '[data-auth-field="acceptedPrivacy"]', true)
    setCheck(sr(el), '[data-auth-field="acceptedTerms"]', true)
    await el.updateComplete

    sr(el).querySelector<HTMLFormElement>('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    expect(submissions).toEqual([
      {
        username: 'vera',
        email: 'vera@example.com',
        name: 'Vera',
        password: 'GoodPass1',
        acceptedPrivacy: true,
        acceptedTerms: true,
      },
    ])
  })

  it('verify form masks delivery destination and emits verify/resend intents', async () => {
    const el = await mount<MnVerifyEmailForm>('mn-verify-email-form', node => {
      node.identity = 'vera@example.com'
      node.deliveryDestination = 'vera@example.com'
    })
    const verifies: MnAuthVerifyEmailDetail[] = []
    const resends: Array<{ identity: string }> = []
    el.addEventListener('mn-auth-verify-email-submit', event => {
      verifies.push((event as CustomEvent<MnAuthVerifyEmailDetail>).detail)
    })
    el.addEventListener('mn-auth-resend-verification', event => {
      resends.push((event as CustomEvent<{ identity: string }>).detail)
    })

    expect(sr(el).textContent).toContain('v**a@example.com')
    setInput(sr(el), '[data-auth-field="code"]', '123456')
    await el.updateComplete
    sr(el).querySelector<HTMLFormElement>('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    sr(el).querySelector<HTMLButtonElement>('.secondary-action')!.click()

    expect(verifies).toEqual([{ identity: 'vera@example.com', code: '123456' }])
    expect(resends).toEqual([{ identity: 'vera@example.com' }])
  })

  it('auth page composes modes and re-emits only one submit event', async () => {
    const el = await mount<MnAuthPage>('mn-auth-page', node => {
      node.mode = 'signin'
      node.successMessage = 'Email verified. Sign in to continue.'
    })
    const modes: MnAuthModeChangeDetail[] = []
    const submissions: MnAuthSignInDetail[] = []
    el.addEventListener('mn-auth-mode-change', event => {
      modes.push((event as CustomEvent<MnAuthModeChangeDetail>).detail)
    })
    el.addEventListener('mn-auth-sign-in-submit', event => {
      submissions.push((event as CustomEvent<MnAuthSignInDetail>).detail)
    })

    expect(sr(el).textContent).toContain('Email verified')
    const form = sr(el).querySelector('mn-sign-in-form') as MnSignInForm
    await form.updateComplete
    setInput(sr(form), '[data-auth-field="identity"]', 'vera@example.com')
    setInput(sr(form), '[data-auth-field="password"]', 'correct horse')
    await form.updateComplete
    sr(form).querySelector<HTMLFormElement>('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    sr(form).querySelector<HTMLButtonElement>('.link-button')!.click()
    await el.updateComplete

    expect(submissions).toEqual([{ identity: 'vera@example.com', password: 'correct horse' }])
    expect(modes).toEqual([{ mode: 'signup' }])
    expect(el.mode).toBe('signup')
    expect(sr(el).querySelector('mn-sign-up-form')).not.toBeNull()
  })
})
