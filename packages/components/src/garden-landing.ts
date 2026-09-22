/**
 * garden-landing - pure Garden brochure page.
 *
 * Garden's original landing entrypoint initialized analytics and mounted the
 * consent host directly. This lift keeps the page visual and interactive, but
 * turns those effects into shell-observable CTA events.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './garden-hero-canvas.js'

export type MnLandingName = 'garden' | 'sophia'

export interface MnLandingActionDetail {
  readonly landing: MnLandingName
  readonly action: string
  readonly placement: string
  readonly href: string
}

function emitAction(host: HTMLElement, detail: MnLandingActionDetail): void {
  host.dispatchEvent(new CustomEvent<MnLandingActionDetail>('mn-landing-action', {
    detail,
    bubbles: true,
    composed: true,
  }))
}

@customElement('garden-landing')
export class GardenLanding extends SkinAware(LitElement) {
  static styles = [
    css`
      ${unsafeCSS(iconStyles)}

      :host {
        --landing-font-display: Georgia, 'Times New Roman', serif;
        --landing-font-body: Georgia, 'Times New Roman', serif;
        --landing-font-ui: var(--mn-font-sans, system-ui, -apple-system, sans-serif);
        --landing-cream: var(--mn-color-surface-base, #faf8f3);
        --landing-panel: var(--mn-color-surface-raised, #fffdfa);
        --landing-border: var(--mn-color-border-subtle, #e6dfd2);
        --landing-ink: var(--mn-color-text-primary, #1f241e);
        --landing-muted: var(--mn-color-text-secondary, #687064);
        --landing-soft: var(--mn-color-text-muted, #8a9185);
        --landing-sage-100: #e8f0dc;
        --landing-sage-200: #d4e4c8;
        --landing-sage-300: #b8d192;
        --landing-sage-500: #7fa647;
        --landing-sage-600: #658538;
        --landing-sage-700: #4d6429;
        display: block;
        min-height: 100vh;
        background: var(--landing-cream);
        color: var(--landing-ink);
        font-family: var(--landing-font-body);
        line-height: 1.7;
      }

      a {
        color: inherit;
      }

      .hero {
        min-height: min(100vh, 920px);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 72px 24px 84px;
        position: relative;
        overflow: hidden;
      }

      .hero-content {
        position: relative;
        z-index: 1;
        max-width: 720px;
      }

      .kicker,
      .section-label,
      .mini-label,
      .card-hint,
      .timeline-month,
      .community-link small {
        font-family: var(--landing-font-ui);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .kicker,
      .section-label,
      .card-hint {
        color: var(--landing-sage-600);
      }

      h1,
      h2,
      h3 {
        font-family: var(--landing-font-display);
        font-weight: 400;
        letter-spacing: -0.01em;
        color: var(--landing-ink);
      }

      .wordmark {
        margin: 12px 0;
        font-size: clamp(70px, 12vw, 118px);
        line-height: 0.92;
        color: var(--landing-sage-700);
      }

      .headline {
        margin: 0 auto 18px;
        max-width: 640px;
        font-size: clamp(30px, 4.5vw, 46px);
        line-height: 1.08;
      }

      .summary,
      .section-desc,
      .lede {
        color: var(--landing-muted);
        font-size: clamp(17px, 2vw, 20px);
        font-weight: 300;
      }

      .summary {
        max-width: 600px;
        margin: 0 auto 32px;
      }

      .cta-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 14px;
      }

      .btn-primary,
      .btn-secondary {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        border-radius: 3px;
        text-decoration: none;
        transition: transform 0.16s ease, background 0.18s ease, border-color 0.18s ease;
      }

      .btn-primary {
        padding: 11px 26px;
        background: var(--landing-sage-600);
        color: #ffffff;
        border: 1px solid var(--landing-sage-600);
      }

      .btn-primary:hover {
        background: var(--landing-sage-700);
        transform: translateY(-1px);
      }

      .btn-secondary {
        color: var(--landing-muted);
        border-bottom: 1px solid transparent;
      }

      .btn-secondary:hover {
        color: var(--landing-sage-600);
        border-bottom-color: var(--landing-sage-300);
      }

      .scroll-indicator {
        position: absolute;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        color: var(--landing-soft);
        font-family: var(--landing-font-ui);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      section.band {
        padding: 76px 24px;
        border-top: 1px solid var(--landing-border);
      }

      section.band.alt {
        background: var(--landing-panel);
      }

      .inner {
        width: min(1120px, 100%);
        margin: 0 auto;
      }

      .section-header {
        max-width: 720px;
        margin: 0 auto 42px;
        text-align: center;
      }

      .section-title {
        margin: 8px 0 12px;
        font-size: clamp(32px, 5vw, 48px);
        line-height: 1.1;
      }

      .workspace-screens {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(180px, 0.28fr);
        gap: 24px;
        align-items: end;
      }

      .screenshot {
        appearance: none;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: zoom-in;
        text-align: inherit;
      }

      .screenshot img,
      .mock-screen {
        display: block;
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--landing-border);
        box-shadow:
          0 4px 8px rgba(45, 58, 46, 0.05),
          0 22px 46px rgba(45, 58, 46, 0.10);
      }

      .screenshot:hover img {
        transform: translateY(-2px);
      }

      .screenshot img {
        transition: transform 0.22s ease;
      }

      .mock-screen {
        min-height: 420px;
        background:
          linear-gradient(90deg, rgba(232, 240, 220, 0.9) 0 22%, transparent 22% 100%),
          linear-gradient(90deg, transparent 0 67%, rgba(248, 247, 242, 0.94) 67% 100%),
          #fffdfa;
        overflow: hidden;
        padding: 18px;
      }

      .mock-top {
        height: 28px;
        border-bottom: 1px solid var(--landing-border);
        margin: -18px -18px 18px;
        background: rgba(250, 248, 243, 0.95);
      }

      .mock-grid {
        display: grid;
        grid-template-columns: 0.9fr 1.8fr 0.85fr;
        gap: 18px;
      }

      .mock-column {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .mock-pill,
      .mock-line,
      .mock-card {
        border-radius: 5px;
        background: rgba(101, 133, 56, 0.11);
      }

      .mock-pill {
        height: 22px;
      }

      .mock-line {
        height: 12px;
      }

      .mock-card {
        min-height: 72px;
        border: 1px solid rgba(101, 133, 56, 0.14);
        background: rgba(255, 255, 255, 0.72);
      }

      .mock-editor {
        min-height: 330px;
        border-radius: 7px;
        padding: 22px;
        background: rgba(255, 255, 255, 0.8);
      }

      .mock-heading {
        width: 74%;
        height: 24px;
        margin-bottom: 22px;
        background: rgba(77, 100, 41, 0.18);
        border-radius: 5px;
      }

      .mock-editor .mock-line:nth-child(2) { width: 96%; }
      .mock-editor .mock-line:nth-child(3) { width: 86%; }
      .mock-editor .mock-line:nth-child(4) { width: 92%; }
      .mock-editor .mock-line:nth-child(5) { width: 65%; }

      .mobile-shot {
        max-width: 260px;
        justify-self: center;
      }

      .lightbox {
        position: fixed;
        inset: 0;
        z-index: var(--mn-z-modal, 1400);
        border: 0;
        background: rgba(20, 26, 20, 0.88);
        cursor: zoom-out;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 28px;
      }

      .lightbox img {
        max-width: 100%;
        max-height: 100%;
        border-radius: 8px;
        box-shadow: 0 24px 72px rgba(0, 0, 0, 0.28);
      }

      .architecture {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
        gap: 34px;
        align-items: center;
      }

      .arch-map {
        display: grid;
        gap: 14px;
      }

      .arch-row {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 14px;
        align-items: center;
      }

      .arch-node,
      .collab-card,
      .more-card,
      .wire-panel,
      .community-link,
      .about-card {
        border: 1px solid var(--landing-border);
        border-radius: 8px;
        background: var(--landing-panel);
      }

      .arch-node,
      .collab-card {
        cursor: pointer;
        padding: 20px;
        text-align: center;
        transition: border-color 0.18s ease, transform 0.16s ease, box-shadow 0.18s ease;
      }

      .arch-node:hover,
      .collab-card:hover,
      .arch-node.active,
      .collab-card.active {
        border-color: var(--landing-sage-500);
        transform: translateY(-1px);
        box-shadow: 0 12px 30px rgba(45, 58, 46, 0.08);
      }

      .arch-node-title,
      .card-title,
      .wire-title {
        margin: 8px 0 4px;
        font-family: var(--landing-font-display);
        font-size: 21px;
        color: var(--landing-ink);
      }

      .arch-node-desc,
      .card-desc,
      .more-card,
      .wire-copy,
      .about-card {
        color: var(--landing-muted);
        font-size: 15px;
      }

      .arch-link {
        height: 1px;
        width: 36px;
        background: var(--landing-sage-300);
      }

      .arch-detail {
        min-height: 280px;
        padding: 24px;
        border-radius: 8px;
        border: 1px solid var(--landing-sage-200);
        background: rgba(232, 240, 220, 0.28);
      }

      .arch-detail h3,
      .collab-detail h3 {
        margin: 0 0 12px;
        font-size: 24px;
      }

      .arch-detail ul,
      .collab-detail ul {
        margin: 0;
        padding-left: 18px;
      }

      .arch-detail li,
      .collab-detail li {
        margin: 8px 0;
        color: var(--landing-muted);
      }

      .wires-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
        max-width: 820px;
        margin: 0 auto;
      }

      .wire-panel {
        padding: 22px;
      }

      .wire-edge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--landing-sage-100);
        color: var(--landing-sage-700);
        font-family: var(--landing-font-ui);
        font-size: 11px;
        font-weight: 700;
      }

      .wire-row + .wire-row {
        margin-top: 12px;
      }

      .sophia-panel {
        max-width: 740px;
        margin: 0 auto;
        text-align: center;
      }

      .timeline {
        display: flex;
        justify-content: center;
        align-items: center;
        margin: 0 0 28px;
      }

      .timeline-line {
        width: 42px;
        height: 1px;
        background: var(--landing-border);
      }

      .timeline-month {
        padding: 0 8px;
        color: var(--landing-soft);
      }

      .timeline-month.now {
        color: var(--landing-sage-600);
      }

      .collab-grid,
      .more-grid,
      .community-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }

      .collab-detail {
        margin-top: 18px;
        padding: 22px;
        border: 1px solid var(--landing-sage-200);
        border-radius: 8px;
        background: rgba(232, 240, 220, 0.25);
      }

      .more-card,
      .community-link,
      .about-card {
        padding: 22px;
      }

      .graph-shot {
        width: min(820px, 100%);
        margin: 0 auto 26px;
      }

      .graph-shot img {
        display: block;
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--landing-border);
        box-shadow:
          0 4px 8px rgba(45, 58, 46, 0.05),
          0 20px 42px rgba(45, 58, 46, 0.09);
      }

      .community-link {
        display: block;
        text-decoration: none;
        transition: border-color 0.18s ease, transform 0.16s ease;
      }

      .community-link:hover {
        border-color: var(--landing-sage-400);
        transform: translateY(-1px);
      }

      .cta {
        text-align: center;
      }

      .cta h2 {
        margin: 0 0 20px;
        font-size: clamp(30px, 4vw, 44px);
      }

      .footer-note {
        margin-top: 18px;
        color: var(--landing-soft);
      }

      .about-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 20px;
      }

      button.reset {
        appearance: none;
        font: inherit;
      }

      .close-button {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--landing-muted);
        cursor: pointer;
        padding: 4px;
        float: right;
      }

      @media (max-width: 860px) {
        .workspace-screens,
        .architecture,
        .wires-grid,
        .collab-grid,
        .more-grid,
        .community-grid,
        .about-grid {
          grid-template-columns: 1fr;
        }

        .arch-row {
          grid-template-columns: 1fr;
        }

        .arch-link {
          display: none;
        }

        .mobile-shot {
          max-width: 220px;
        }
      }
    `,
  ]

  @property({ type: String })
  appHref = 'https://garden.sophia-labs.com/app'

  @property({ type: String })
  discordHref = 'https://discord.gg/WMwxRRVDru'

  @property({ type: String })
  emailHref = 'mailto:vera@sophia-labs.com'

  @property({ type: String })
  screenshotSrc = '/marcy_screenshot_0.jpg'

  @property({ type: String })
  mobileScreenshotSrc = '/mobilemarcyss.jpg'

  @property({ type: String })
  graphScreenshotSrc = '/graphviewss.png'

  @state() private screenshotExpanded = false
  @state() private activeDetail: 'documents' | 'retrieval' | 'graph' | null = null
  @state() private activeCollab: 'people' | 'sophia' | 'agents' | null = null

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.screenshotExpanded = false
      this.activeDetail = null
      this.activeCollab = null
    }
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('keydown', this.onKeyDown)
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('keydown', this.onKeyDown)
    super.disconnectedCallback()
  }

  private action(action: string, placement: string, href: string): void {
    emitAction(this, { landing: 'garden', action, placement, href })
  }

  private detailTemplate() {
    switch (this.activeDetail) {
      case 'documents':
        return html`
          <h3>Documents stay readable.</h3>
          <ul>
            <li>Write in a normal editor with headings, lists, comments, links, and source material.</li>
            <li>Imports keep their original file beside the editable document.</li>
            <li>Daily notes, folders, history, and public publishing stay part of the same workspace.</li>
          </ul>
        `
      case 'retrieval':
        return html`
          <h3>Retrieval is grounded.</h3>
          <ul>
            <li>Blocks, documents, tags, wires, and source annotations become addressable context.</li>
            <li>Sophia can cite the workspace it is using instead of treating memory as a black box.</li>
            <li>The graph gives agents a live map of what matters now.</li>
          </ul>
        `
      case 'graph':
        return html`
          <h3>The graph is first-class.</h3>
          <ul>
            <li>Every connection can carry a predicate, not just a backlink.</li>
            <li>Documents, blocks, artifacts, comments, and workflows share one semantic substrate.</li>
            <li>Local and hosted modes use the same vocabulary boundary.</li>
          </ul>
        `
      default:
        return html`
          <h3>Click a layer.</h3>
          <ul>
            <li>Garden keeps prose comfortable while making structure available to tools.</li>
            <li>The visible document and the underlying graph are two views of one workspace.</li>
            <li>That is the foundation for collaboration with Sophia and other agents.</li>
          </ul>
        `
    }
  }

  private collabTemplate() {
    switch (this.activeCollab) {
      case 'people':
        return html`
          <h3>People</h3>
          <ul>
            <li>Share public graphs, write together, and preserve the reasoning trail.</li>
            <li>Comments and wires make disagreement and evidence visible beside the draft.</li>
          </ul>
        `
      case 'sophia':
        return html`
          <h3>Sophia</h3>
          <ul>
            <li>Sophia works from the workspace graph, not just the current prompt.</li>
            <li>The assistant can follow links, cite blocks, and keep continuity across sessions.</li>
          </ul>
        `
      case 'agents':
        return html`
          <h3>Agents</h3>
          <ul>
            <li>Local tools can read, write, search, and connect the same graph through explicit contracts.</li>
            <li>Agent work lands as structured changes instead of untraceable side effects.</li>
          </ul>
        `
      default:
        return nothing
    }
  }

  render() {
    return html`
      <section class="hero">
        <garden-hero-canvas .blobCount=${14}></garden-hero-canvas>
        <div class="hero-content">
          <div class="kicker">Research and writing, with memory</div>
          <h1 class="wordmark">Garden</h1>
          <h2 class="headline">Where research becomes understanding.</h2>
          <p class="summary">
            Garden is a knowledge environment for long projects: a calm writing
            workspace, a semantic graph underneath, and an AI collaborator that can
            remember how your ideas connect.
          </p>
          <div class="cta-row">
            <a class="btn-primary" href=${this.appHref} @click=${() => this.action('signup', 'hero', this.appHref)}>
              Sign up ${icon('arrow-right', { size: 18 })}
            </a>
            <a class="btn-secondary" href=${this.discordHref} target="_blank" rel="noopener" @click=${() => this.action('discord', 'hero', this.discordHref)}>
              Join the Discord
            </a>
          </div>
        </div>
        <div class="scroll-indicator">Scroll</div>
      </section>

      <section id="preview" class="band">
        <div class="inner">
          <div class="section-header">
            <div class="section-label">One Workspace</div>
            <h2 class="section-title">Research on the left. Draft in the center. Help in context.</h2>
            <p class="section-desc">
              Garden keeps the whole thinking surface together: documents, notes,
              comments, wires, graph views, and chat all live around the editor.
            </p>
          </div>
          <div class="workspace-screens">
            <button class="screenshot" type="button" @click=${() => { this.screenshotExpanded = true }}>
              <img src=${this.screenshotSrc} alt="Garden desktop workspace" />
            </button>
            <img class="mobile-shot" src=${this.mobileScreenshotSrc} alt="Garden mobile workspace" />
          </div>
          ${this.screenshotExpanded ? html`
            <button class="lightbox" type="button" @click=${() => { this.screenshotExpanded = false }} aria-label="Close expanded screenshot">
              <img src=${this.screenshotSrc} alt="Garden workspace full screen" />
            </button>
          ` : nothing}
        </div>
      </section>

      <section class="band alt">
        <div class="inner">
          <div class="section-header">
            <div class="section-label">Your Data Lives Twice</div>
            <h2 class="section-title">It looks like a writing app. Underneath, it is a knowledge graph.</h2>
            <p class="section-desc">
              The editor stays humane. The substrate stays explicit enough for
              search, agents, provenance, and public views.
            </p>
          </div>
          <div class="architecture">
            <div class="arch-map">
              <button class="arch-node reset ${this.activeDetail === 'documents' ? 'active' : ''}" type="button" @click=${() => { this.activeDetail = this.activeDetail === 'documents' ? null : 'documents' }}>
                ${icon('file-text', { size: 24 })}
                <div class="arch-node-title">Documents</div>
                <div class="arch-node-desc">Readable writing surface</div>
                <div class="card-hint">Inspect</div>
              </button>
              <div class="arch-row">
                <button class="arch-node reset ${this.activeDetail === 'retrieval' ? 'active' : ''}" type="button" @click=${() => { this.activeDetail = this.activeDetail === 'retrieval' ? null : 'retrieval' }}>
                  ${icon('bot', { size: 24 })}
                  <div class="arch-node-title">Retrieval</div>
                  <div class="arch-node-desc">Context Sophia can use</div>
                  <div class="card-hint">Inspect</div>
                </button>
                <div class="arch-link"></div>
                <button class="arch-node reset ${this.activeDetail === 'graph' ? 'active' : ''}" type="button" @click=${() => { this.activeDetail = this.activeDetail === 'graph' ? null : 'graph' }}>
                  ${icon('network', { size: 24 })}
                  <div class="arch-node-title">Graph</div>
                  <div class="arch-node-desc">Semantic relationships</div>
                  <div class="card-hint">Inspect</div>
                </button>
              </div>
            </div>
            <div class="arch-detail">
              ${this.activeDetail ? html`
                <button class="close-button" type="button" @click=${() => { this.activeDetail = null }} aria-label="Close architecture detail">${icon('x', { size: 16 })}</button>
              ` : nothing}
              ${this.detailTemplate()}
            </div>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="inner">
          <div class="section-header">
            <div class="section-label">Beyond Backlinks</div>
            <h2 class="section-title">Every connection tells you what it means.</h2>
            <p class="section-desc">
              Garden wires are typed. A note can support a claim, contradict a
              draft, cite a source, or open a new line of inquiry.
            </p>
          </div>
          <div class="wires-grid">
            <div class="wire-panel">
              <div class="mini-label">Before</div>
              <p class="wire-row">source <span class="wire-edge">links to</span> draft</p>
              <p class="wire-row">note <span class="wire-edge">links to</span> note</p>
              <p class="wire-copy">A backlink tells you that two things are connected, then leaves the relationship implicit.</p>
            </div>
            <div class="wire-panel">
              <div class="mini-label">Garden</div>
              <p class="wire-row">source <span class="wire-edge">supports</span> claim</p>
              <p class="wire-row">field note <span class="wire-edge">complicates</span> theory</p>
              <p class="wire-copy">A wire names the relationship so people and agents can reason over it later.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="band alt">
        <div class="inner sophia-panel">
          <div class="timeline" aria-hidden="true">
            <span class="timeline-month">Month 1</span><span class="timeline-line"></span>
            <span class="timeline-month">Month 2</span><span class="timeline-line"></span>
            <span class="timeline-month now">Now</span>
          </div>
          <div class="section-label">Why Sophia</div>
          <h2 class="section-title">An AI collaborator with continuity.</h2>
          <p class="lede">
            Sophia attunes to the workspace: documents, links, tags, wires, and
            the history of what mattered. The goal is not just faster text. It is
            better companionship for long thought.
          </p>
        </div>
      </section>

      <section class="band">
        <div class="inner">
          <div class="section-header">
            <div class="section-label">Not Just You</div>
            <h2 class="section-title">Write together.</h2>
            <p class="section-desc">Garden is designed for a future where human collaborators, Sophia, and local agents can work in the same structured space.</p>
          </div>
          <div class="collab-grid">
            ${[
              ['people', 'user', 'People', 'Collaborators share context instead of sending static files.'],
              ['sophia', 'bot', 'Sophia', 'The assistant reads the graph that your work already produces.'],
              ['agents', 'git-merge', 'Agents', 'Tools can make precise, inspectable changes through the same boundary.'],
            ].map(([id, glyph, title, desc]) => html`
              <button class="collab-card reset ${this.activeCollab === id ? 'active' : ''}" type="button" @click=${() => { this.activeCollab = this.activeCollab === id ? null : id as 'people' | 'sophia' | 'agents' }}>
                ${icon(glyph, { size: 24 })}
                <div class="card-title">${title}</div>
                <div class="card-desc">${desc}</div>
                <div class="card-hint">Open</div>
              </button>
            `)}
          </div>
          ${this.activeCollab ? html`
            <div class="collab-detail">
              <button class="close-button" type="button" @click=${() => { this.activeCollab = null }} aria-label="Close collaboration detail">${icon('x', { size: 16 })}</button>
              ${this.collabTemplate()}
            </div>
          ` : nothing}
        </div>
      </section>

      <section class="band alt">
        <div class="inner">
          <div class="section-header">
            <div class="section-label">And More</div>
            <h2 class="section-title">Dozens of small surfaces, one workspace.</h2>
          </div>
          <div class="graph-shot">
            <img src=${this.graphScreenshotSrc} alt="Garden graph view" />
          </div>
          <div class="more-grid">
            <div class="more-card">Public graph publishing for readable shared work.</div>
            <div class="more-card">Original-file views beside editable extracted documents.</div>
            <div class="more-card">Daily notes, source annotations, history, and workspace restoration.</div>
          </div>
        </div>
      </section>

      <section class="band cta">
        <div class="inner">
          <h2>Build a memory palace for your work.</h2>
          <div class="cta-row">
            <a class="btn-primary" href=${this.appHref} @click=${() => this.action('signup', 'footer', this.appHref)}>
              Sign up ${icon('arrow-right', { size: 18 })}
            </a>
            <a class="btn-secondary" href=${this.emailHref} @click=${() => this.action('email', 'footer', this.emailHref)}>
              vera@sophia-labs.com
            </a>
          </div>
          <div class="footer-note">Questions, collaborations, and field reports are welcome.</div>
        </div>
      </section>

      <section class="band alt">
        <div class="inner">
          <div class="section-header">
            <div class="section-label">Open By Default</div>
            <h2 class="section-title">See the work in progress.</h2>
            <p class="section-desc">Garden is being built in public conversation with researchers, writers, and software agents.</p>
          </div>
          <div class="community-grid">
            <a class="community-link" href=${this.discordHref} target="_blank" rel="noopener" @click=${() => this.action('discord', 'community', this.discordHref)}>
              <small>Community</small>
              <div class="card-title">Discord</div>
              <div class="card-desc">Join discussions, demos, and design notes.</div>
            </a>
            <a class="community-link" href="https://github.com/sophia-labs" target="_blank" rel="noopener" @click=${() => this.action('github', 'community', 'https://github.com/sophia-labs')}>
              <small>Source</small>
              <div class="card-title">GitHub</div>
              <div class="card-desc">Follow the implementation as it evolves.</div>
            </a>
            <a class="community-link" href=${this.emailHref} @click=${() => this.action('email', 'community', this.emailHref)}>
              <small>Contact</small>
              <div class="card-title">Email</div>
              <div class="card-desc">Talk with us about research workflows.</div>
            </a>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="inner about-grid">
          <div class="about-card">
            <div class="section-label">Sophia Labs</div>
            We build shared worlds for human and machine thought: tools where
            knowledge stays inspectable, collaborative, and alive.
          </div>
          <div class="about-card">
            <div class="section-label">Garden</div>
            Garden is the first product: a writing and research environment where
            memory is not an afterthought.
          </div>
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'garden-landing': GardenLanding
  }
}
