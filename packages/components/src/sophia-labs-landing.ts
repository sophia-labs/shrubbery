/**
 * sophia-labs-landing - pure Sophia Labs landing page.
 *
 * The Garden source initialized analytics and consent directly. This component
 * keeps the page controlled: links navigate normally and also emit CTA intents
 * for a shell to observe.
 */

import { LitElement, css, html, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import type { MnLandingActionDetail } from './garden-landing.js'
import './sophia-hero-canvas.js'

@customElement('sophia-labs-landing')
export class SophiaLabsLanding extends SkinAware(LitElement) {
  static styles = [
    css`
      ${unsafeCSS(iconStyles)}

      :host {
        display: block;
        min-height: 100vh;
        background: var(--mn-color-surface-base, #f8f9fc);
        color: var(--mn-color-text-primary, #1f2430);
        font-family: var(--mn-font-serif, Georgia, serif);
      }

      a {
        color: var(--mn-color-text-link, #4f46e5);
        text-decoration-thickness: 1px;
        text-underline-offset: 3px;
      }

      .main-section {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 64px 24px;
        position: relative;
        overflow: hidden;
      }

      .main-content {
        position: relative;
        z-index: 1;
        width: min(560px, 100%);
      }

      .wordmark,
      .projects-label,
      .project-status {
        font-family: var(--mn-font-sans, system-ui, -apple-system, sans-serif);
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-weight: 700;
      }

      .wordmark {
        margin: 0 0 48px;
        font-size: 12px;
        color: var(--mn-color-info, #4f46e5);
      }

      .mission {
        margin-bottom: 48px;
      }

      .mission-headline {
        margin: 0 0 24px;
        font-size: clamp(30px, 6vw, 42px);
        line-height: 1.25;
        color: var(--mn-color-text-primary, #1f2430);
      }

      .mission-body {
        color: var(--mn-color-text-secondary, #5f6674);
        font-size: 16px;
        line-height: 1.75;
      }

      .mission-body p {
        margin: 0 0 16px;
      }

      .mission-body p:last-child {
        margin-bottom: 0;
      }

      .projects {
        width: 100%;
        border-top: 1px solid var(--mn-color-border-subtle, #dfe4ec);
        padding-top: 30px;
        text-align: left;
      }

      .projects-label {
        margin-bottom: 14px;
        font-size: 10px;
        color: var(--mn-color-text-muted, #8a92a1);
      }

      .project-link {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px 0;
        border-bottom: 1px solid var(--mn-color-border-subtle, #dfe4ec);
        color: inherit;
        text-decoration: none;
        transition: padding-left 0.18s ease;
      }

      .project-link:hover {
        padding-left: 8px;
      }

      .project-icon {
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: var(--mn-color-surface-accent, #eef2ff);
        color: var(--mn-color-text-accent, #4f46e5);
        flex: 0 0 auto;
      }

      .project-info {
        flex: 1 1 auto;
        min-width: 0;
      }

      .project-name {
        color: var(--mn-color-text-primary, #1f2430);
        font-size: 18px;
        font-weight: 600;
      }

      .project-desc {
        color: var(--mn-color-text-secondary, #5f6674);
        font-size: 14px;
        line-height: 1.4;
      }

      .project-status {
        padding: 3px 8px;
        border-radius: 4px;
        background: var(--mn-color-surface-accent, #eef2ff);
        color: var(--mn-color-text-accent, #4f46e5);
        font-size: 10px;
      }

      .project-arrow {
        color: var(--mn-color-text-muted, #8a92a1);
        transition: transform 0.18s ease, color 0.18s ease;
      }

      .project-link:hover .project-arrow {
        color: var(--mn-color-info, #4f46e5);
        transform: translateX(4px);
      }

      .landing-footer {
        position: absolute;
        bottom: 24px;
        left: 0;
        right: 0;
        z-index: 1;
        color: var(--mn-color-text-muted, #8a92a1);
        font-size: 12px;
      }

      @media (max-width: 560px) {
        .main-section {
          padding: 48px 18px 72px;
        }

        .project-link {
          align-items: flex-start;
        }

        .project-status {
          display: none;
        }
      }
    `,
  ]

  @property({ type: String })
  gardenHref = '/garden'

  @property({ type: String })
  emailHref = 'mailto:vera@sophia-labs.com'

  private action(action: string, placement: string, href: string): void {
    this.dispatchEvent(new CustomEvent<MnLandingActionDetail>('mn-landing-action', {
      detail: { landing: 'sophia', action, placement, href },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    return html`
      <section class="main-section">
        <sophia-hero-canvas .nodeCount=${14}></sophia-hero-canvas>

        <div class="main-content">
          <h1 class="wordmark">Sophia Labs</h1>

          <div class="mission">
            <p class="mission-headline">Making it more joyful to think together.</p>
            <div class="mission-body">
              <p>
                We build shared worlds for human and machine thought. Our first
                project is Garden, a knowledge environment where your writing,
                your ideas, and an AI thinking partner named Sophia live together
                in a semantic graph. It is live now.
              </p>
              <p>
                Get in touch:
                <a href=${this.emailHref} @click=${() => this.action('email', 'mission', this.emailHref)}>vera@sophia-labs.com</a>
              </p>
            </div>
          </div>

          <section class="projects">
            <div class="projects-label">Current Work</div>
            <a class="project-link" href=${this.gardenHref} @click=${() => this.action('garden', 'projects', this.gardenHref)}>
              <span class="project-icon">${icon('sprout', { size: 18 })}</span>
              <div class="project-info">
                <div class="project-name">Garden</div>
                <div class="project-desc">Write, connect, think - with an AI that remembers</div>
              </div>
              <span class="project-status">Live</span>
              <span class="project-arrow">${icon('chevron-right', { size: 18 })}</span>
            </a>
          </section>
        </div>

        <footer class="landing-footer">San Francisco | Mexico City</footer>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sophia-labs-landing': SophiaLabsLanding
  }
}
