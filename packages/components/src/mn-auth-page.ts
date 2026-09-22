/**
 * Auth and verification forms, lifted from Garden as pure controlled chrome.
 *
 * Garden's auth page performed provider calls, telemetry, title updates, and
 * browser persistence. Shrubbery keeps those effects in the host: these elements
 * own local input state and validation only, then emit composed submit/switch
 * intents for the shell to handle.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnAuthMode = 'signin' | 'signup' | 'verify'
export type MnAuthStatus = 'idle' | 'loading' | 'success' | 'error'

export interface MnAuthFieldChangeDetail {
  readonly field: string
  readonly value: string | boolean
}

export interface MnAuthModeChangeDetail {
  readonly mode: MnAuthMode
}

export interface MnAuthSignInDetail {
  readonly identity: string
  readonly password: string
}

export interface MnAuthSignUpDetail {
  readonly username: string
  readonly email: string
  readonly name: string
  readonly password: string
  readonly acceptedPrivacy: boolean
  readonly acceptedTerms: boolean
}

export interface MnAuthVerifyEmailDetail {
  readonly identity: string
  readonly code: string
}

export interface MnAuthResendVerificationDetail {
  readonly identity: string
}

type FieldErrors = Record<string, string>

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function emit<T>(host: LitElement, type: string, detail: T): void {
  host.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
}

function maskDestination(destination: string): string {
  const value = trimmed(destination)
  if (!value || value.includes('*')) return value
  const at = value.indexOf('@')
  if (at <= 1) return value
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const maskedLocal = `${local[0]}${'*'.repeat(Math.max(local.length - 2, 1))}${local.slice(-1)}`
  return `${maskedLocal}@${domain}`
}

const authStyles = css`
  ${unsafeCSS(iconStyles)}

  :host {
    display: block;
    color: var(--mn-color-text-primary, #111827);
    font-family: var(--mn-font-chrome, system-ui, sans-serif);
    font-size: var(--mn-text-sm, 13px);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--mn-space-3, 12px);
    margin: 0;
  }

  .title {
    margin: 0;
    color: var(--mn-color-text-primary, #111827);
    font-family: var(--mn-font-serif, Georgia, serif);
    font-size: var(--mn-text-xl, 20px);
    font-weight: 650;
    line-height: 1.2;
  }

  .subtitle {
    margin: -4px 0 var(--mn-space-2, 8px);
    color: var(--mn-color-text-secondary, #4b5563);
    font-size: var(--mn-text-sm, 13px);
    line-height: 1.45;
  }

  .banner {
    display: flex;
    align-items: flex-start;
    gap: var(--mn-space-2, 8px);
    padding: var(--mn-space-2-5, 10px) var(--mn-space-3, 12px);
    border: 1px solid var(--mn-color-border-subtle, #d1d5db);
    border-radius: var(--mn-radius-lg, 8px);
    background: var(--mn-color-surface-sunken, #f8fafc);
    color: var(--mn-color-text-secondary, #374151);
    line-height: 1.4;
  }

  .banner.error {
    border-color: var(--mn-color-danger-border, #fecaca);
    background: var(--mn-color-danger-surface, #fef2f2);
    color: var(--mn-color-danger-text, #991b1b);
  }

  .banner.success {
    border-color: var(--mn-color-success-border, #86efac);
    background: var(--mn-color-success-surface, #f0fdf4);
    color: var(--mn-color-success-text, #166534);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--mn-space-1, 4px);
  }

  label {
    color: var(--mn-color-text-primary, #111827);
    font-size: var(--mn-text-sm, 13px);
    font-weight: 600;
    line-height: 1.3;
  }

  .optional {
    color: var(--mn-color-text-tertiary, #6b7280);
    font-weight: 400;
  }

  input {
    width: 100%;
    min-height: 38px;
    padding: 0 var(--mn-space-3, 12px);
    border: 1px solid var(--mn-color-border-default, #d1d5db);
    border-radius: var(--mn-radius-control, 6px);
    background: var(--mn-color-surface-base, #fff);
    color: var(--mn-color-text-primary, #111827);
    font: inherit;
    box-sizing: border-box;
  }

  input:focus {
    border-color: var(--mn-color-border-focus, #2563eb);
    box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(37, 99, 235, 0.2));
    outline: none;
  }

  input[aria-invalid='true'] {
    border-color: var(--mn-color-danger-border, #b91c1c);
  }

  .field-error,
  .helper {
    font-size: var(--mn-text-xs, 12px);
    line-height: 1.35;
  }

  .field-error {
    color: var(--mn-color-danger, #b91c1c);
  }

  .helper {
    color: var(--mn-color-text-tertiary, #6b7280);
  }

  .checkbox-label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--mn-space-2, 8px);
    align-items: flex-start;
    color: var(--mn-color-text-secondary, #374151);
    font-weight: 400;
    line-height: 1.4;
  }

  .checkbox-label input {
    width: 16px;
    min-height: 16px;
    margin: 2px 0 0;
    padding: 0;
    accent-color: var(--mn-color-accent, #2563eb);
  }

  a,
  .link-button {
    color: var(--mn-color-text-accent, #1d4ed8);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
  }

  a:hover,
  .link-button:hover {
    text-decoration: underline;
  }

  .submit,
  .secondary-action {
    display: inline-flex;
    min-height: 38px;
    align-items: center;
    justify-content: center;
    gap: var(--mn-space-2, 8px);
    border-radius: var(--mn-radius-control, 6px);
    cursor: pointer;
    font: inherit;
    font-weight: 650;
    box-sizing: border-box;
  }

  .submit {
    width: 100%;
    margin-top: var(--mn-space-1, 4px);
    border: 1px solid var(--mn-color-accent, #2563eb);
    background: var(--mn-color-accent, #2563eb);
    color: var(--mn-color-text-on-accent, #fff);
  }

  .submit:hover:not(:disabled) {
    border-color: var(--mn-color-accent-hover, #1d4ed8);
    background: var(--mn-color-accent-hover, #1d4ed8);
  }

  .submit:disabled,
  .secondary-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .secondary-action {
    border: 1px solid var(--mn-color-border-default, #d1d5db);
    background: var(--mn-color-surface-raised, #fff);
    color: var(--mn-color-text-primary, #111827);
  }

  .switch {
    margin: var(--mn-space-2, 8px) 0 0;
    color: var(--mn-color-text-secondary, #4b5563);
    font-size: var(--mn-text-sm, 13px);
    text-align: center;
  }

  .link-button {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }
`

class AuthBase extends SkinAware(LitElement) {
  protected fieldChange(field: string, value: string | boolean): void {
    emit<MnAuthFieldChangeDetail>(this, 'mn-auth-field-change', { field, value })
  }

  protected setText(field: keyof this, value: string): void {
    ;(this as Record<string, unknown>)[field as string] = value
    this.fieldChange(field as string, value)
  }

  protected setBool(field: keyof this, value: boolean): void {
    ;(this as Record<string, unknown>)[field as string] = value
    this.fieldChange(field as string, value)
  }

  protected renderBanner(kind: 'error' | 'success', message: string): TemplateResult | typeof nothing {
    if (!trimmed(message)) return nothing
    return html`
      <div class=${`banner ${kind}`} role=${kind === 'error' ? 'alert' : 'status'}>
        ${icon(kind === 'error' ? 'alert-circle' : 'check', { size: 15 })}
        <span>${message}</span>
      </div>
    `
  }

  protected switchTo(mode: MnAuthMode): void {
    emit<MnAuthModeChangeDetail>(this, 'mn-auth-mode-change', { mode })
    if (mode === 'signin') {
      this.dispatchEvent(new CustomEvent('switch-to-signin', { bubbles: true, composed: true }))
    }
    if (mode === 'signup') {
      this.dispatchEvent(new CustomEvent('switch-to-signup', { bubbles: true, composed: true }))
    }
  }
}

@customElement('mn-sign-in-form')
export class MnSignInForm extends AuthBase {
  static styles = authStyles

  @property({ type: String }) identity = ''
  @property({ type: String }) password = ''
  @property({ type: String }) status: MnAuthStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: Boolean, attribute: 'allow-signup' }) allowSignup = true

  private submit(event: Event): void {
    event.preventDefault()
    const identity = trimmed(this.identity)
    if (!identity || !this.password || this.status === 'loading') return
    emit<MnAuthSignInDetail>(this, 'mn-auth-sign-in-submit', { identity, password: this.password })
  }

  render(): TemplateResult {
    const loading = this.status === 'loading'
    return html`
      <form novalidate @submit=${this.submit}>
        <h2 class="title">Sign in to your account</h2>
        ${this.renderBanner('error', this.error)}
        <div class="field">
          <label for="signin-identity">Username or email</label>
          <input
            id="signin-identity"
            data-auth-field="identity"
            type="text"
            autocomplete="username"
            .value=${this.identity}
            @input=${(event: Event) => this.setText('identity', (event.target as HTMLInputElement).value)}
            required
          />
        </div>
        <div class="field">
          <label for="signin-password">Password</label>
          <input
            id="signin-password"
            data-auth-field="password"
            type="password"
            autocomplete="current-password"
            .value=${this.password}
            @input=${(event: Event) => this.setText('password', (event.target as HTMLInputElement).value)}
            required
          />
        </div>
        <button class="submit" type="submit" ?disabled=${loading || !trimmed(this.identity) || !this.password}>
          ${loading ? 'Signing in...' : 'Sign in'}
        </button>
        ${this.allowSignup
          ? html`
              <p class="switch">
                Don't have an account?
                <button class="link-button" type="button" @click=${() => this.switchTo('signup')}>Sign up</button>
              </p>
            `
          : nothing}
      </form>
    `
  }
}

@customElement('mn-sign-up-form')
export class MnSignUpForm extends AuthBase {
  static styles = authStyles

  @property({ type: String }) username = ''
  @property({ type: String }) email = ''
  @property({ type: String }) name = ''
  @property({ type: String }) password = ''
  @property({ type: String, attribute: 'confirm-password' }) confirmPassword = ''
  @property({ type: String }) status: MnAuthStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: Boolean, attribute: 'accepted-privacy' }) acceptedPrivacy = false
  @property({ type: Boolean, attribute: 'accepted-terms' }) acceptedTerms = false
  @property({ type: Boolean, attribute: 'require-terms' }) requireTerms = true

  @state() private fieldErrors: FieldErrors = {}

  private validate(): boolean {
    const errors: FieldErrors = {}
    if (!trimmed(this.username)) errors.username = 'Username is required'
    else if (trimmed(this.username).length < 3) errors.username = 'Username must be at least 3 characters'

    if (!trimmed(this.email)) errors.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed(this.email))) errors.email = 'Enter a valid email address'

    if (!this.password) errors.password = 'Password is required'
    else if (this.password.length < 8) errors.password = 'Password must be at least 8 characters'
    else if (!/[A-Z]/.test(this.password)) errors.password = 'Password must include an uppercase letter'
    else if (!/[a-z]/.test(this.password)) errors.password = 'Password must include a lowercase letter'
    else if (!/[0-9]/.test(this.password)) errors.password = 'Password must include a number'

    if (this.password !== this.confirmPassword) errors.confirmPassword = 'Passwords do not match'

    if (this.requireTerms && !this.acceptedPrivacy) errors.acceptedPrivacy = 'You must agree to the Privacy Policy to continue'
    if (this.requireTerms && !this.acceptedTerms) errors.acceptedTerms = 'You must agree to the Terms and Conditions to continue'

    this.fieldErrors = errors
    return Object.keys(errors).length === 0
  }

  private submit(event: Event): void {
    event.preventDefault()
    if (this.status === 'loading' || !this.validate()) return
    emit<MnAuthSignUpDetail>(this, 'mn-auth-sign-up-submit', {
      username: trimmed(this.username),
      email: trimmed(this.email),
      name: trimmed(this.name),
      password: this.password,
      acceptedPrivacy: this.acceptedPrivacy,
      acceptedTerms: this.acceptedTerms,
    })
  }

  private renderError(field: string): TemplateResult | typeof nothing {
    const message = this.fieldErrors[field]
    return message ? html`<div class="field-error">${message}</div>` : nothing
  }

  render(): TemplateResult {
    const loading = this.status === 'loading'
    return html`
      <form novalidate @submit=${this.submit}>
        <h2 class="title">Sign up for a Sophia Labs account</h2>
        ${this.renderBanner('error', this.error)}
        <div class="field">
          <label for="signup-username">Username</label>
          <input
            id="signup-username"
            data-auth-field="username"
            type="text"
            autocomplete="username"
            aria-invalid=${this.fieldErrors.username ? 'true' : 'false'}
            .value=${this.username}
            @input=${(event: Event) => this.setText('username', (event.target as HTMLInputElement).value)}
            required
          />
          ${this.renderError('username')}
        </div>
        <div class="field">
          <label for="signup-email">Email</label>
          <input
            id="signup-email"
            data-auth-field="email"
            type="email"
            autocomplete="email"
            aria-invalid=${this.fieldErrors.email ? 'true' : 'false'}
            .value=${this.email}
            @input=${(event: Event) => this.setText('email', (event.target as HTMLInputElement).value)}
            required
          />
          ${this.renderError('email')}
        </div>
        <div class="field">
          <label for="signup-name">Name <span class="optional">(optional)</span></label>
          <input
            id="signup-name"
            data-auth-field="name"
            type="text"
            autocomplete="name"
            .value=${this.name}
            @input=${(event: Event) => this.setText('name', (event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label for="signup-password">Password</label>
          <input
            id="signup-password"
            data-auth-field="password"
            type="password"
            autocomplete="new-password"
            aria-invalid=${this.fieldErrors.password ? 'true' : 'false'}
            .value=${this.password}
            @input=${(event: Event) => this.setText('password', (event.target as HTMLInputElement).value)}
            required
          />
          ${this.fieldErrors.password
            ? this.renderError('password')
            : html`<div class="helper">At least 8 characters with uppercase, lowercase, and numbers.</div>`}
        </div>
        <div class="field">
          <label for="signup-confirm">Confirm password</label>
          <input
            id="signup-confirm"
            data-auth-field="confirmPassword"
            type="password"
            autocomplete="new-password"
            aria-invalid=${this.fieldErrors.confirmPassword ? 'true' : 'false'}
            .value=${this.confirmPassword}
            @input=${(event: Event) => this.setText('confirmPassword', (event.target as HTMLInputElement).value)}
            required
          />
          ${this.renderError('confirmPassword')}
        </div>
        ${this.requireTerms
          ? html`
              <div class="field">
                <label class="checkbox-label">
                  <input
                    data-auth-field="acceptedPrivacy"
                    type="checkbox"
                    .checked=${this.acceptedPrivacy}
                    @change=${(event: Event) => this.setBool('acceptedPrivacy', (event.target as HTMLInputElement).checked)}
                  />
                  <span>I agree to the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span>
                </label>
                ${this.renderError('acceptedPrivacy')}
              </div>
              <div class="field">
                <label class="checkbox-label">
                  <input
                    data-auth-field="acceptedTerms"
                    type="checkbox"
                    .checked=${this.acceptedTerms}
                    @change=${(event: Event) => this.setBool('acceptedTerms', (event.target as HTMLInputElement).checked)}
                  />
                  <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a></span>
                </label>
                ${this.renderError('acceptedTerms')}
              </div>
            `
          : nothing}
        <button class="submit" type="submit" ?disabled=${loading}>
          ${loading ? 'Creating account...' : 'Sign up'}
        </button>
        <p class="switch">
          Already have an account?
          <button class="link-button" type="button" @click=${() => this.switchTo('signin')}>Sign in</button>
        </p>
      </form>
    `
  }
}

@customElement('mn-verify-email-form')
export class MnVerifyEmailForm extends AuthBase {
  static styles = authStyles

  @property({ type: String }) identity = ''
  @property({ type: String }) code = ''
  @property({ type: String, attribute: 'delivery-destination' }) deliveryDestination = ''
  @property({ type: String, attribute: 'delivery-medium' }) deliveryMedium = ''
  @property({ type: String }) status: MnAuthStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: String }) success = ''
  @property({ type: Number, attribute: 'resend-cooldown' }) resendCooldown = 0

  private submit(event: Event): void {
    event.preventDefault()
    const identity = trimmed(this.identity)
    const code = trimmed(this.code)
    if (!identity || code.length < 6 || this.status === 'loading') return
    emit<MnAuthVerifyEmailDetail>(this, 'mn-auth-verify-email-submit', { identity, code })
  }

  private resend(): void {
    const identity = trimmed(this.identity)
    if (!identity || this.resendCooldown > 0 || this.status === 'loading') return
    emit<MnAuthResendVerificationDetail>(this, 'mn-auth-resend-verification', { identity })
  }

  render(): TemplateResult {
    const loading = this.status === 'loading'
    const destination = maskDestination(this.deliveryDestination)
    return html`
      <form novalidate @submit=${this.submit}>
        <h2 class="title">Verify your email</h2>
        <p class="subtitle">
          ${destination
            ? html`We sent a verification code to <strong>${destination}</strong>.`
            : 'Enter the verification code to activate your account.'}
        </p>
        ${this.renderBanner('success', this.success)}
        ${this.renderBanner('error', this.error)}
        <div class="field">
          <label for="verify-identity">Username or email</label>
          <input
            id="verify-identity"
            data-auth-field="identity"
            type="text"
            autocomplete="username"
            .value=${this.identity}
            @input=${(event: Event) => this.setText('identity', (event.target as HTMLInputElement).value)}
            required
          />
        </div>
        <div class="field">
          <label for="verify-code">Verification code</label>
          <input
            id="verify-code"
            data-auth-field="code"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            placeholder="000000"
            autocomplete="one-time-code"
            .value=${this.code}
            @input=${(event: Event) => this.setText('code', (event.target as HTMLInputElement).value)}
            required
          />
        </div>
        <button class="submit" type="submit" ?disabled=${loading || trimmed(this.code).length < 6 || !trimmed(this.identity)}>
          ${loading ? 'Verifying...' : 'Verify email'}
        </button>
        <button
          class="secondary-action"
          type="button"
          ?disabled=${loading || this.resendCooldown > 0 || !trimmed(this.identity)}
          @click=${this.resend}
        >
          ${this.resendCooldown > 0 ? `Resend available in ${this.resendCooldown}s` : 'Resend verification code'}
        </button>
        <p class="switch">
          <button class="link-button" type="button" @click=${() => this.switchTo('signin')}>Back to sign in</button>
        </p>
      </form>
    `
  }
}

@customElement('mn-auth-page')
export class MnAuthPage extends AuthBase {
  static styles = css`
    ${authStyles}

    :host {
      display: block;
      min-height: 100%;
      background: var(--mn-color-surface-base, #fff);
    }

    .page {
      display: flex;
      min-height: var(--mn-auth-page-min-height, 100dvh);
      flex-direction: column;
      background: var(--mn-color-surface-base, #fff);
    }

    .header {
      display: flex;
      min-height: 54px;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: 0 var(--mn-space-6, 24px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-accent, #eff6ff);
      box-sizing: border-box;
    }

    .brand-mark {
      display: inline-flex;
      width: 30px;
      height: 30px;
      align-items: center;
      justify-content: center;
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-accent, #1d4ed8);
      box-shadow: var(--mn-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08));
    }

    .brand {
      color: var(--mn-color-text-accent-strong, #1e3a8a);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-lg, 18px);
      font-weight: 650;
    }

    .body {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-8, 32px) var(--mn-space-5, 20px);
      background:
        linear-gradient(180deg, rgba(37, 99, 235, 0.05), transparent 220px),
        var(--mn-color-surface-base, #fff);
      box-sizing: border-box;
    }

    .card {
      width: min(100%, 430px);
      padding: var(--mn-space-7, 28px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-lg, 0 18px 42px rgba(15, 23, 42, 0.12));
      box-sizing: border-box;
    }

    @media (max-width: 520px) {
      .header {
        padding: 0 var(--mn-space-4, 16px);
      }

      .body {
        align-items: flex-start;
        padding: var(--mn-space-5, 20px) var(--mn-space-3, 12px);
      }

      .card {
        padding: var(--mn-space-5, 20px);
      }
    }
  `

  @property({ type: String }) mode: MnAuthMode = 'signin'
  @property({ type: String }) brand = 'Sophia Labs'
  @property({ type: String, attribute: 'success-message' }) successMessage = ''
  @property({ type: String, attribute: 'pending-identity' }) pendingIdentity = ''
  @property({ type: String, attribute: 'delivery-destination' }) deliveryDestination = ''
  @property({ type: String, attribute: 'delivery-medium' }) deliveryMedium = ''
  @property({ type: String, attribute: 'sign-in-status' }) signInStatus: MnAuthStatus = 'idle'
  @property({ type: String, attribute: 'sign-up-status' }) signUpStatus: MnAuthStatus = 'idle'
  @property({ type: String, attribute: 'verify-status' }) verifyStatus: MnAuthStatus = 'idle'
  @property({ type: String, attribute: 'sign-in-error' }) signInError = ''
  @property({ type: String, attribute: 'sign-up-error' }) signUpError = ''
  @property({ type: String, attribute: 'verify-error' }) verifyError = ''

  private setMode(mode: MnAuthMode): void {
    this.mode = mode
    emit<MnAuthModeChangeDetail>(this, 'mn-auth-mode-change', { mode })
  }

  private reemit<T>(event: Event, type: string): void {
    event.stopPropagation()
    this.dispatchEvent(new CustomEvent<T>(type, {
      detail: (event as CustomEvent<T>).detail,
      bubbles: true,
      composed: true,
    }))
  }

  private childModeChange(event: CustomEvent<MnAuthModeChangeDetail>): void {
    event.stopPropagation()
    this.setMode(event.detail.mode)
  }

  private renderMode(): TemplateResult {
    if (this.mode === 'signup') {
      return html`
        <mn-sign-up-form
          status=${this.signUpStatus}
          error=${this.signUpError}
          @mn-auth-mode-change=${this.childModeChange}
          @mn-auth-sign-up-submit=${(event: Event) => this.reemit<MnAuthSignUpDetail>(event, 'mn-auth-sign-up-submit')}
        ></mn-sign-up-form>
      `
    }
    if (this.mode === 'verify') {
      return html`
        <mn-verify-email-form
          identity=${this.pendingIdentity}
          delivery-destination=${this.deliveryDestination}
          delivery-medium=${this.deliveryMedium}
          status=${this.verifyStatus}
          error=${this.verifyError}
          @mn-auth-mode-change=${this.childModeChange}
          @mn-auth-verify-email-submit=${(event: Event) => this.reemit<MnAuthVerifyEmailDetail>(event, 'mn-auth-verify-email-submit')}
          @mn-auth-resend-verification=${(event: Event) => this.reemit<MnAuthResendVerificationDetail>(event, 'mn-auth-resend-verification')}
        ></mn-verify-email-form>
      `
    }
    return html`
      <mn-sign-in-form
        status=${this.signInStatus}
        error=${this.signInError}
        @mn-auth-mode-change=${this.childModeChange}
        @mn-auth-sign-in-submit=${(event: Event) => this.reemit<MnAuthSignInDetail>(event, 'mn-auth-sign-in-submit')}
      ></mn-sign-in-form>
    `
  }

  render(): TemplateResult {
    return html`
      <section class="page" aria-label=${`${this.brand} authentication`}>
        <header class="header">
          <span class="brand-mark" aria-hidden="true">${icon('sprout', { size: 18 })}</span>
          <span class="brand">${this.brand}</span>
        </header>
        <main class="body">
          <section class="card">
            ${this.renderBanner('success', this.successMessage)}
            ${this.renderMode()}
          </section>
        </main>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-auth-page': MnAuthPage
    'mn-sign-in-form': MnSignInForm
    'mn-sign-up-form': MnSignUpForm
    'mn-verify-email-form': MnVerifyEmailForm
  }
}
