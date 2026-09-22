import { html, nothing } from 'lit'
import type { HojaComposerDetail, HojaEditor } from '@shrubbery/hoja'
import type { WorkspaceBoundFaceDefinition } from '@shrubbery/runtime/layout'
import { formatAge, toEpochMs } from '@shrubbery/nucleus'
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import { KOCH_FACE_IDS } from './face-ids.js'
import {
  KOCH_SEQUENCE,
  MORSE,
  lessonCharacters,
  normalizeCopy,
  type CopyScore,
  type KochCharacter,
  type PracticePrompt,
  type PracticeSettings,
} from './koch.js'
import type { KeyingScore } from './keying.js'
import type {
  GraphPerformanceSnapshot,
  PracticeActivity,
  ProgressSnapshot,
} from './progress.js'
import type { KochActor } from './actor.js'
import type { KochRoom, KochRoomAccessGrant } from './backend.js'

export type KochPracticePhase = 'ready' | 'playing' | 'copying' | 'sending' | 'saving' | 'review'

export interface KochPracticeFaceValue {
  readonly backendOnline: boolean
  readonly practiceAllowed: boolean
  readonly practiceDisabledReason: string
  readonly activity: PracticeActivity
  readonly phase: KochPracticePhase
  readonly lesson: number
  readonly highestLesson: number
  readonly settings: PracticeSettings
  readonly prompt: PracticePrompt | null
  readonly copy: string
  readonly score: CopyScore | KeyingScore | null
  readonly keyedPattern: string
  readonly keyedCharacterCount: number
  readonly keyDown: boolean
  readonly sessionId: string
  readonly unlocked: boolean
  readonly saveError: string
  readonly audioError: string
  readonly onStart: () => void
  readonly onActivityChange: (activity: PracticeActivity) => void
  readonly onReplay: () => void
  readonly onCancel: () => void
  readonly onSubmit: () => void
  readonly onFinishSend: () => void
  readonly onKeyDown: () => void
  readonly onKeyUp: () => void
  readonly onRetrySave: () => void
  readonly onCopyChange: (detail: HojaComposerDetail) => void
  readonly onLessonChange: (lesson: number) => void
  readonly onRunLengthChange: (count: number) => void
  readonly onCharacterWpmChange: (value: number) => void
  readonly onEffectiveWpmChange: (value: number) => void
  readonly onToneChange: (value: number) => void
}

export interface KochCurriculumFaceValue {
  readonly lesson: number
  readonly selectedCharacter: KochCharacter
  readonly showNotation: boolean
  readonly busy: boolean
  readonly progress: ProgressSnapshot
  readonly onCharacterSelect: (character: KochCharacter) => void
  readonly onNotationChange: (show: boolean) => void
}

export interface KochProgressFaceValue {
  readonly progress: ProgressSnapshot
  readonly actor: KochActor
  readonly activity: PracticeActivity
  readonly room: KochRoom
  readonly nameDraft: string
  readonly performance: GraphPerformanceSnapshot | null
  readonly accessGrants: readonly KochRoomAccessGrant[]
  readonly canWrite: boolean
  readonly roomBusy: boolean
  readonly onNameDraftChange: (detail: HojaComposerDetail) => void
  readonly onSaveName: () => void
  readonly onCopyInvite: () => void
}

function acceptsKochProjectionResource(
  locator: ResourceLocator,
  kind: 'course' | 'learner',
): boolean {
  return locator.kind === 'iri'
    && locator.iri.startsWith('urn:mnemosyne:local:graph:')
    && locator.iri.includes(`:projection:koch-morse:${kind}:`)
}

function decorateTarget(target: HTMLElement, face: 'practice' | 'curriculum' | 'progress'): void {
  target.dataset.kochFace = face
  target.style.overflow = 'hidden'
  target.style.background = 'var(--mn-color-surface-base, #fff)'
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function filedAge(value: string, readAt: number): string {
  const instant = toEpochMs(value)
  return instant === null ? '' : formatAge(instant, readAt)
}

function learnerActorId(learnerId: string): string {
  const encoded = learnerId.split(':').at(-1) ?? learnerId
  try { return decodeURIComponent(encoded) } catch { return encoded }
}

function grouped(value: string, size = 5): string {
  const clean = normalizeCopy(value)
  const groups: string[] = []
  for (let index = 0; index < clean.length; index += size) groups.push(clean.slice(index, index + size))
  return groups.join(' ')
}

function practiceFace(
  target: HTMLElement,
  value: KochPracticeFaceValue,
): unknown {
  decorateTarget(target, 'practice')
  const canCopy = value.phase === 'playing' || value.phase === 'copying'
  const active = canCopy || value.phase === 'sending'
  const settingsDisabled = active || value.phase === 'saving'
  const count = normalizeCopy(value.copy).length
  const newest = lessonCharacters(value.lesson).at(-1)
  const passed = (value.score?.accuracy ?? 0) >= 0.9
  const status = value.phase === 'playing'
    ? 'signal playing'
    : value.phase === 'copying'
      ? 'finish copy'
      : value.phase === 'sending'
        ? 'keying'
      : value.phase === 'saving'
        ? 'recording'
        : value.phase === 'review'
          ? 'run complete'
          : 'ready'
  const sendScore = value.score?.activity === 'send' ? value.score : null
  const receiveScore = value.score?.activity === 'receive' ? value.score : null

  return html`
    <section class="koch-face koch-practice" aria-label=${`Koch ${value.activity} practice`}>
      <mn-panel-header title=${value.activity === 'send' ? 'Sending drill' : 'Receiving drill'}>
        <mn-badge
          slot="actions"
          size="sm"
          .state=${active ? 'active' : value.saveError ? 'danger' : 'neutral'}
          .glyph=${active ? '◉' : ''}
          .label=${status}
        ></mn-badge>
      </mn-panel-header>

      <div class="practice-scroll">
        ${!value.practiceAllowed
          ? html`<p class="inline-state mn-kind" data-kind="state">${value.practiceDisabledReason}</p>`
          : nothing}
        <header class="practice-heading">
          <div class="lesson-summary">
            <p class="face-kicker">${value.activity === 'send' ? 'Sending lesson' : 'Receiving lesson'}</p>
            <h1>Lesson ${value.lesson}</h1>
            <p class="active-alphabet" aria-label=${`Active characters: ${lessonCharacters(value.lesson).join(', ')}`}>
              ${lessonCharacters(value.lesson).map((character) => html`<span class=${character === newest ? 'newest' : ''}>${character}</span>`)}
            </p>
            <p class="lesson-method">${value.activity === 'send'
              ? 'Key the shown text with Space or the on-screen straight key. Accuracy and rhythm are scored separately.'
              : 'Hear each character at full speed; slower spacing gives you room to copy.'}</p>
          </div>
          <div class="practice-options">
            <fieldset ?disabled=${settingsDisabled}>
              <legend>Activity</legend>
              <div class="segmented activity-switch">
                ${(['receive', 'send'] as const).map((activity) => html`
                  <button
                    type="button"
                    aria-pressed=${value.activity === activity ? 'true' : 'false'}
                    @click=${() => value.onActivityChange(activity)}
                  >${activity === 'receive' ? 'Receive' : 'Send'}</button>
                `)}
              </div>
            </fieldset>
            <label>
              <span>Lesson</span>
              <select
                .value=${String(value.lesson)}
                ?disabled=${settingsDisabled}
                @change=${(event: Event) => value.onLessonChange(Number((event.currentTarget as HTMLSelectElement).value))}
              >
                ${Array.from({ length: Math.max(1, value.highestLesson - 1) }, (_, index) => index + 2).map((lesson) => html`
                  <option value=${lesson} .selected=${lesson === value.lesson}>${lesson} · through ${KOCH_SEQUENCE[lesson - 1]}</option>
                `)}
              </select>
            </label>
            <fieldset ?disabled=${settingsDisabled}>
              <legend>Run length</legend>
              <div class="segmented">
                ${[10, 25, 50].map((length) => html`
                  <button
                    type="button"
                    aria-pressed=${value.settings.characterCount === length ? 'true' : 'false'}
                    @click=${() => value.onRunLengthChange(length)}
                  >${length}</button>
                `)}
              </div>
            </fieldset>
          </div>
        </header>

        <section class="receiver-controls ${value.activity === 'send' ? 'sending-controls' : ''}" aria-label=${value.activity === 'send' ? 'Keyer settings' : 'Receiver settings'}>
          <label>
            <span><span>${value.activity === 'send' ? 'Keying speed' : 'Character speed'}</span><strong>${value.settings.characterWpm} WPM</strong></span>
            <input type="range" min="15" max="35" step="1" .value=${String(value.settings.characterWpm)} ?disabled=${settingsDisabled} @input=${(event: Event) => value.onCharacterWpmChange(Number((event.currentTarget as HTMLInputElement).value))} />
          </label>
          ${value.activity === 'receive' ? html`
            <label>
              <span><span>Effective speed</span><strong>${value.settings.effectiveWpm} WPM</strong></span>
              <input type="range" min="5" .max=${String(value.settings.characterWpm)} step="1" .value=${String(value.settings.effectiveWpm)} ?disabled=${settingsDisabled} @input=${(event: Event) => value.onEffectiveWpmChange(Number((event.currentTarget as HTMLInputElement).value))} />
            </label>
          ` : nothing}
          <label>
            <span><span>Tone</span><strong>${value.settings.toneHz} Hz</strong></span>
            <input type="range" min="400" max="900" step="25" .value=${String(value.settings.toneHz)} ?disabled=${settingsDisabled} @input=${(event: Event) => value.onToneChange(Number((event.currentTarget as HTMLInputElement).value))} />
          </label>
        </section>

        <mn-card class="copy-card ${value.activity === 'send' ? 'send-card' : ''}">
          <div slot="header" class="copy-card-header">
            <span class=${value.phase === 'playing' ? 'active-signal' : ''}>${status}</span>
            <span>${value.activity === 'send' ? value.keyedCharacterCount : count} / ${value.settings.characterCount}</span>
          </div>
          ${value.activity === 'receive'
            ? html`
                <div class="copy-instruction">
                  <strong>${value.phase === 'playing'
                    ? 'Listen and type now.'
                    : value.phase === 'copying'
                      ? 'The signal has ended; finish your copy.'
                      : value.phase === 'saving'
                        ? 'Recording this run in Garden…'
                        : 'Type what you hear.'}</strong>
                  <span>Spaces are optional.</span>
                </div>
                <hoja-editor
                  posture="composer"
                  .valueKey=${value.sessionId || 'standing-by'}
                  .value=${value.copy}
                  .disabled=${!canCopy}
                  label="Morse copy"
                  .placeholder=${value.phase === 'ready' || value.phase === 'review'
                    ? 'Your copy will appear here'
                    : 'Type as the sounds arrive'}
                  @hoja-change=${(event: CustomEvent<HojaComposerDetail>) => value.onCopyChange(event.detail)}
                  @hoja-submit=${(event: CustomEvent<HojaComposerDetail>) => {
                    value.onCopyChange(event.detail)
                    value.onSubmit()
                  }}
                ></hoja-editor>
              `
            : html`
                <div class="copy-instruction">
                  <strong>${value.phase === 'sending'
                    ? 'Hold Space for each element; leave a character-length gap between letters.'
                    : value.phase === 'saving'
                      ? 'Recording symbols and timing in Garden…'
                      : 'Send the shown characters from memory.'}</strong>
                  <span>No notation appears during an assessed run.</span>
                </div>
                <div class="send-target" aria-label="Text to send">
                  ${(value.prompt?.plain ?? 'READY').split('').map((character, index) => html`
                    <span class=${index < value.keyedCharacterCount ? 'complete' : index === value.keyedCharacterCount && value.phase === 'sending' ? 'current' : ''}>${character}</span>
                  `)}
                </div>
                <div class="straight-key-station">
                  <div class="live-pattern" aria-live="polite">
                    <span>Current character</span>
                    <code>${value.keyedPattern || '· · ·'}</code>
                  </div>
                  <button
                    class="straight-key ${value.keyDown ? 'pressed' : ''}"
                    type="button"
                    aria-label="Straight key; press and hold"
                    aria-pressed=${value.keyDown ? 'true' : 'false'}
                    ?disabled=${value.phase !== 'sending'}
                    @contextmenu=${(event: Event) => event.preventDefault()}
                    @pointerdown=${(event: PointerEvent) => {
                      event.preventDefault()
                      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                      value.onKeyDown()
                    }}
                    @pointerup=${(event: PointerEvent) => { event.preventDefault(); value.onKeyUp() }}
                    @pointercancel=${() => value.onKeyUp()}
                  ><span aria-hidden="true"></span><strong>${value.keyDown ? 'KEY DOWN' : 'PRESS & HOLD'}</strong></button>
                </div>
              `}
          <div slot="footer" class="copy-actions">
            ${value.phase === 'ready' || value.phase === 'review'
              ? html`
                  <mn-button
                    data-primary-run
                    size="lg"
                    icon="play"
                    shortcut="Space"
                    .disabled=${!value.backendOnline || !value.practiceAllowed}
                    @click=${value.onStart}
                  >Start ${value.activity === 'send' ? 'sending' : `${value.settings.characterCount}-character run`}</mn-button>
                `
              : value.activity === 'send'
                ? html`
                    <mn-button icon="check" shortcut="Enter" .loading=${value.phase === 'saving'} @click=${value.onFinishSend}>Finish run</mn-button>
                    <mn-button variant="ghost" icon="stop" shortcut="Esc" .disabled=${value.phase === 'saving'} @click=${value.onCancel}>Stop run</mn-button>
                    <span class="key-help"><kbd>Space</kbd> is the straight key</span>
                  `
                : html`
                  <mn-button icon="check" shortcut="Enter" .loading=${value.phase === 'saving'} @click=${value.onSubmit}>Check copy</mn-button>
                  <mn-button variant="secondary" icon="rotate-ccw" .disabled=${value.phase === 'saving'} @click=${value.onReplay}>Replay</mn-button>
                  <mn-button variant="ghost" icon="stop" shortcut="Esc" .disabled=${value.phase === 'saving'} @click=${value.onCancel}>Stop run</mn-button>
                `}
            <span class="key-help"><kbd>Shift</kbd> + <kbd>Enter</kbd> adds a group break</span>
          </div>
        </mn-card>

        ${value.audioError ? html`<p class="inline-error" role="alert">Audio: ${value.audioError}</p>` : nothing}

        ${value.phase === 'review' && value.score
          ? html`
              <mn-card class="review-card">
                <div slot="header" class="review-header">
                  <span>${value.saveError ? 'Run not recorded' : 'Run recorded in Garden'}</span>
                  <strong class=${passed ? 'passed' : ''}>${percent(value.score.accuracy)}</strong>
                </div>
                <dl class="copy-review">
                  <dt>Target</dt><dd><code>${grouped(value.score.expected)}</code></dd>
                  <dt>${value.score.activity === 'send' ? 'Decoded' : 'Your copy'}</dt><dd><code>${grouped(value.score.entered) || '—'}</code></dd>
                  <dt>Result</dt><dd>${value.score.correct} of ${value.score.total} correct</dd>
                  ${sendScore ? html`
                    <dt>Element length</dt><dd>${percent(sendScore.durationScore)}</dd>
                    <dt>Spacing</dt><dd>${percent(sendScore.spacingScore)}</dd>
                    <dt>Consistency</dt><dd>${percent(sendScore.consistencyScore)}</dd>
                    <dt>Timing</dt><dd><strong>${percent(sendScore.timingScore)}</strong></dd>
                  ` : nothing}
                </dl>
                <p class="threshold-copy">
                  ${receiveScore
                    ? passed
                      ? value.unlocked ? `Passed. Lesson ${value.lesson} is now available.` : 'Passed at the 90% threshold.'
                      : 'Below 90%; repeat this character set.'
                    : 'Sending mastery is recorded separately; receiving remains the Koch lesson gate.'}
                </p>
                ${value.saveError ? html`<p class="inline-error" role="alert">${value.saveError}</p>` : nothing}
                <div slot="footer" class="copy-actions">
                  <mn-button data-primary-run icon="play" shortcut="Space" @click=${value.onStart}>${value.unlocked ? `Start lesson ${value.lesson}` : 'Repeat run'}</mn-button>
                  ${value.saveError
                    ? html`<mn-button variant="secondary" icon="refresh" @click=${value.onRetrySave}>Retry save</mn-button>`
                    : nothing}
                </div>
              </mn-card>
            `
          : nothing}
      </div>
    </section>
  `
}

function curriculumFace(
  target: HTMLElement,
  value: KochCurriculumFaceValue,
): unknown {
  decorateTarget(target, 'curriculum')
  const pattern = MORSE[value.selectedCharacter]
  const symbolic = pattern.replaceAll('.', '·').replaceAll('-', '−').split('').join(' ')
  const spoken = pattern.split('').map((part) => part === '.' ? 'dit' : 'dah').join(' ')
  const stats = new Map(value.progress.characterStats.map((stat) => [stat.character, stat]))

  return html`
    <section class="koch-face koch-curriculum" aria-label="Koch curriculum">
      <mn-panel-header title="Characters" .count=${lessonCharacters(value.lesson).length}></mn-panel-header>
      <div class="face-scroll">
        <mn-card class="character-card">
          <div slot="header" class="character-card-header">
            <span>Character ${KOCH_SEQUENCE.indexOf(value.selectedCharacter) + 1} of ${KOCH_SEQUENCE.length}</span>
            <mn-button size="xs" variant="ghost" icon="volume-2" .disabled=${value.busy} @click=${() => value.onCharacterSelect(value.selectedCharacter)}>Hear</mn-button>
          </div>
          <div class="character-detail">
            <strong>${value.selectedCharacter}</strong>
            ${value.showNotation
              ? html`<code>${symbolic}</code><span>${spoken}</span>`
              : html`<span class="notation-hidden">Notation hidden: learn the sound as one unit.</span>`}
          </div>
          <label slot="footer" class="notation-toggle">
            <input
              type="checkbox"
              .checked=${value.showNotation}
              @change=${(event: Event) => value.onNotationChange((event.currentTarget as HTMLInputElement).checked)}
            />
            <span>Show dit–dah breakdown</span>
          </label>
        </mn-card>

        <section class="active-set">
          <div class="section-heading">
            <strong>In this lesson</strong>
            <span>Newest: ${lessonCharacters(value.lesson).at(-1)}</span>
          </div>
          <div class="character-grid active-character-grid" role="list" aria-label="Characters active in this lesson">
            ${lessonCharacters(value.lesson).map((character, index) => {
              const selected = character === value.selectedCharacter
              const current = index === value.lesson - 1
              const stat = stats.get(character)
              return html`
                <button
                  type="button"
                  class="character learned ${current ? 'current' : ''} ${selected ? 'selected' : ''}"
                  aria-pressed=${selected ? 'true' : 'false'}
                  aria-label=${`${character}${stat ? `, ${percent(stat.accuracy)} accuracy` : ''}`}
                  title=${stat ? `${stat.correct}/${stat.seen} correct` : 'No copy evidence yet'}
                  ?disabled=${value.busy}
                  @click=${() => value.onCharacterSelect(character)}
                >${character}</button>
              `
            })}
          </div>
        </section>

        <details class="sequence-disclosure">
          <summary>Full LCWO sequence <span>${KOCH_SEQUENCE.length} characters</span></summary>
          <div class="character-grid full-character-grid" role="list" aria-label="Full LCWO Koch character order">
            ${KOCH_SEQUENCE.map((character, index) => {
              const learned = index < value.lesson
              const current = index === value.lesson - 1
              const selected = character === value.selectedCharacter
              const stat = stats.get(character)
              return html`
                <button
                  type="button"
                  class="character ${learned ? 'learned' : 'future'} ${current ? 'current' : ''} ${selected ? 'selected' : ''}"
                  aria-pressed=${selected ? 'true' : 'false'}
                  aria-label=${`${character}, character ${index + 1}${stat ? `, ${percent(stat.accuracy)} accuracy` : ''}`}
                  title=${`Lesson ${index + 1}${stat ? ` · ${stat.correct}/${stat.seen}` : ''}`}
                  ?disabled=${value.busy}
                  @click=${() => value.onCharacterSelect(character)}
                >${character}</button>
              `
            })}
          </div>
        </details>

        <p class="method-note">New characters enter one at a time. Character rhythm stays fast; spacing supplies the thinking time.</p>
      </div>
    </section>
  `
}

function progressFace(
  target: HTMLElement,
  value: KochProgressFaceValue,
): unknown {
  decorateTarget(target, 'progress')
  const recent = value.progress.sessions.slice(0, 8)
  const weakest = value.progress.characterStats.slice(0, 5)
  const testimony = value.progress.testimony
  const standings = (value.performance?.standings ?? [])
    .filter((entry) => entry.activity === value.activity)
    .sort((left, right) => right.bestScore - left.bestScore || right.averageScore - left.averageScore)
  const rank = new Map(standings.map((entry, index) => [entry.learnerId, index + 1]))
  const performancePeople = value.performance?.participants ?? []
  const people = [...performancePeople]
  for (const grant of value.accessGrants) {
    if (people.some((person) => learnerActorId(person.learnerId) === grant.userId)) continue
    people.push({
      learnerId: grant.userId,
      displayName: grant.displayName?.trim() || grant.email?.trim() || grant.userId,
      receive: null,
      send: null,
    })
  }

  return html`
    <section class="koch-face koch-progress" aria-label="Graph community and practice record">
      <mn-panel-header title=${`People · ${value.room.title}`} .count=${people.length}>
        <mn-badge slot="actions" size="sm" state="success" glyph="●" label="live RDF"></mn-badge>
      </mn-panel-header>
      <div class="face-scroll">
        <mn-card class="room-card">
          <div slot="header" class="room-heading">
            <div>
              <strong class="mn-kind" data-kind="identity">${value.room.title}</strong>
              <span class="mn-kind" data-kind="state">${value.room.role} · ${value.room.cellState}</span>
            </div>
            <mn-button class="mn-kind" data-kind="affordance" size="xs" variant="ghost" icon="link" @click=${value.onCopyInvite}>Copy link</mn-button>
          </div>
          <code class="room-reference mn-kind" data-kind="reference">${value.room.graphId}</code>
          <p class="mn-kind" data-kind="prose">This Garden graph is the room. Practice is solitary until you file a run; filed testimony is visible to everyone with graph access.</p>
          <div class="room-fields">
            <label>
              <span>Display name</span>
              <hoja-editor
                class="compact-composer"
                posture="composer"
                .valueKey=${`name-${value.actor.id}`}
                .value=${value.nameDraft}
                .disabled=${value.roomBusy || !value.canWrite}
                label="Leaderboard display name"
                placeholder="Your display name"
                @hoja-change=${(event: CustomEvent<HojaComposerDetail>) => value.onNameDraftChange(event.detail)}
                @hoja-submit=${(event: CustomEvent<HojaComposerDetail>) => { value.onNameDraftChange(event.detail); value.onSaveName() }}
              ></hoja-editor>
              <mn-button size="xs" variant="secondary" .disabled=${value.roomBusy || !value.canWrite} @click=${value.onSaveName}>Save name</mn-button>
            </label>
          </div>
        </mn-card>

        <section class="record-section people-section">
          <div class="section-heading">
            <h2>Performance in this graph</h2>
            <span>all learners</span>
          </div>
          ${people.length === 0
            ? html`<p class="empty-copy mn-kind" data-kind="state">No learner testimony is filed in this graph yet.</p>`
            : html`
                <ol class="people-list">
                  ${people.map((person) => {
                    const personActorId = learnerActorId(person.learnerId)
                    const self = personActorId === value.actor.id
                    const grant = value.accessGrants.find((candidate) => candidate.userId === personActorId)
                    const current = value.activity === 'send' ? person.send : person.receive
                    const last = [person.receive?.lastCompletedAt, person.send?.lastCompletedAt]
                      .filter((candidate): candidate is string => Boolean(candidate))
                      .sort()
                      .at(-1) ?? ''
                    return html`
                    <li class=${self ? 'self' : ''}>
                      <div class="person-heading">
                        <span class="person-rank mn-kind" data-kind="state">${current ? `#${rank.get(person.learnerId) ?? '–'} ${value.activity}` : grant?.role ?? 'unranked'}</span>
                        <strong class="mn-kind" data-kind="identity">${person.displayName}</strong>
                        ${self ? html`<span class="self-mark mn-kind" data-kind="state">you</span>` : nothing}
                      </div>
                      <div class="person-performance">
                        <div>
                          <span>Receive</span>
                          ${person.receive
                            ? html`<strong class="mn-kind" data-kind="metric"><span class="mn-kind-value">${percent(person.receive.bestScore)}</span></strong>
                                <small class="mn-kind" data-kind="testimony">${person.receive.runs} filed · L${person.receive.highestLesson} · ${person.receive.correct}/${person.receive.total}</small>`
                            : html`<em class="mn-kind" data-kind="state">no filed run</em>`}
                        </div>
                        <div>
                          <span>Send</span>
                          ${person.send
                            ? html`<strong class="mn-kind" data-kind="metric"><span class="mn-kind-value">${percent(person.send.bestScore)}</span></strong>
                                <small class="mn-kind" data-kind="testimony">${person.send.runs} filed${person.send.bestTimingScore === null ? '' : ` · ${percent(person.send.bestTimingScore)} timing`}</small>`
                            : html`<em class="mn-kind" data-kind="state">no filed run</em>`}
                        </div>
                      </div>
                      ${last && value.performance
                        ? html`<time class="person-asof mn-kind" data-kind="testimony" datetime=${last}>last filed ${filedAge(last, value.performance.readAt)}</time>`
                        : nothing}
                    </li>
                  `})}
                </ol>
              `}
        </section>

        <div class="stat-grid">
          ${value.activity === 'send' ? html`
            <div><strong>${value.progress.sendSessions}</strong><span>send runs</span></div>
            <div><strong>${percent(value.progress.bestSendAccuracy)}</strong><span>best code</span></div>
            <div><strong>${percent(value.progress.bestTimingScore)}</strong><span>best timing</span></div>
            <div><strong>${value.progress.currentLesson}</strong><span>open lesson</span></div>
          ` : html`
            <div><strong>${value.progress.totalCopied}</strong><span>copied</span></div>
            <div><strong>${percent(value.progress.overallAccuracy)}</strong><span>overall</span></div>
            <div><strong>${percent(value.progress.bestAccuracy)}</strong><span>best run</span></div>
            <div><strong>${value.progress.currentLesson}</strong><span>open lesson</span></div>
          `}
        </div>

        <section class="record-section">
          <h2>Recent sessions</h2>
          ${recent.length === 0
            ? html`<p class="empty-copy">No sessions recorded yet.</p>`
            : html`
                <ol class="session-list">
                  ${recent.map((session) => html`
                    <li>
                      <span>L${session.lesson}</span>
                      <strong>${percent(session.accuracy)}</strong>
                      <small>${session.activity === 'send' ? 'SEND' : 'COPY'} · ${session.correct}/${session.total}</small>
                      <time datetime=${session.completedAt}>${new Date(session.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                    </li>
                  `)}
                </ol>
              `}
        </section>

        <section class="record-section">
          <h2>${value.activity === 'send' ? 'Receive needs attention' : 'Needs attention'}</h2>
          ${weakest.length === 0
            ? html`<p class="empty-copy">Per-character evidence appears after a run.</p>`
            : html`
                <div class="character-stats">
                  ${weakest.map((stat) => html`
                    <div>
                      <strong>${stat.character}</strong>
                      <progress max="1" .value=${stat.accuracy} aria-label=${`${stat.character}: ${percent(stat.accuracy)}`}></progress>
                      <span>${stat.correct}/${stat.seen}</span>
                    </div>
                  `)}
                </div>
              `}
        </section>

        <p class="unlock-rule">A run at 90% or better opens the next character.</p>

        ${testimony
          ? html`
              <details class="testimony">
                <summary>RDF testimony</summary>
                <dl>
                  <dt>Source</dt><dd>${testimony.adapter}</dd>
                  <dt>Triples</dt><dd>${testimony.tripleCount}</dd>
                  <dt>Read</dt><dd>${new Date(testimony.readAt).toLocaleTimeString()}</dd>
                  <dt>Graph</dt><dd><code>${testimony.graphIri}</code></dd>
                </dl>
              </details>
            `
          : nothing}
      </div>
    </section>
  `
}

export const KOCH_FACE_CATALOGUE = [
  {
    faceId: KOCH_FACE_IDS.practice,
    persistence: 'persistent-relocatable',
    accepts: (locator) => acceptsKochProjectionResource(locator, 'learner'),
    constraints: () => ({ minWidth: 320, minHeight: 430, overflow: 'clip' }),
    render: (target, value) => practiceFace(target, value as KochPracticeFaceValue),
    focus: (target) => {
      const editor = target.querySelector<HojaEditor>('hoja-editor')
      if (!editor) return false
      editor.focus()
      return true
    },
  },
  {
    faceId: KOCH_FACE_IDS.curriculum,
    persistence: 'persistent-relocatable',
    accepts: (locator) => acceptsKochProjectionResource(locator, 'course'),
    constraints: () => ({ minWidth: 240, minHeight: 330, overflow: 'clip' }),
    render: (target, value) => curriculumFace(target, value as KochCurriculumFaceValue),
  },
  {
    faceId: KOCH_FACE_IDS.progress,
    persistence: 'persistent-relocatable',
    accepts: (locator) => acceptsKochProjectionResource(locator, 'learner'),
    constraints: () => ({ minWidth: 260, minHeight: 350, overflow: 'clip' }),
    render: (target, value) => progressFace(target, value as KochProgressFaceValue),
  },
] satisfies readonly WorkspaceBoundFaceDefinition[]
