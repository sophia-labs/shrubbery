import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { HojaComposerDetail, HojaEditor } from '@shrubbery/hoja'
import type {
  MnAccessAddDetail,
  MnAccessManagerModel,
  MnAccessRemoveDetail,
  MnAccessRoleChangeDetail,
  MnWorkspaceDetail,
  MnWorkspaceSummary,
} from '@shrubbery/components'
import {
  applySkinTheme,
  isVisualIdentitySkin,
  nextVisualIdentitySkin,
  type Theme,
  type VisualIdentitySkin,
} from '@shrubbery/tokens'
import {
  defineWorkspaceSurfaceElement,
  type SurfaceRatioChange,
  type WorkspaceSurfaceElement,
  type WorkspaceSurfaceModel,
} from '@shrubbery/runtime/layout'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import { WebAudioMorsePlayer, WebAudioStraightKey } from './audio.js'
import {
  createKochBackend,
  rememberActorName,
  type KochRoom,
  type KochRoomAccessGrant,
} from './backend.js'
import { normalizeDisplayName, type KochActor } from './actor.js'
import {
  KOCH_FACE_CATALOGUE,
  type KochCurriculumFaceValue,
  type KochPracticeFaceValue,
  type KochPracticePhase,
  type KochProgressFaceValue,
} from './faces.js'
import {
  DEFAULT_SETTINGS,
  generatePrompt,
  lessonCharacters,
  scoreCopy,
  type CopyScore,
  type KochCharacter,
  type PracticePrompt,
  type PracticeSettings,
} from './koch.js'
import {
  StraightKeyCapture,
  scoreKeying,
  targetDitMs,
} from './keying.js'
import {
  buildDefaultKochLayout,
  loadKochLayout,
  persistKochLayout,
  upgradeDefaultKochLayout,
  type KochLayoutSource,
} from './layout.js'
import {
  DEFAULT_PREFERENCES,
  EMPTY_PROGRESS,
  ensureKochInformationModel,
  loadGraphPerformance,
  loadPreferences,
  loadProgress,
  savePreferences,
  saveSession,
  type PracticeActivity,
  type PracticeScore,
  type GraphPerformanceSnapshot,
  type ProgressSnapshot,
} from './progress.js'
import { assertGraphId, kochProjectionGraphIri } from './vocabulary.js'

type BackendState = 'connecting' | 'online' | 'error'

function initialGraphId(): string {
  let query = ''
  try { query = new URL(window.location.href).searchParams.get('graph')?.trim() ?? '' } catch { /* default below */ }
  const graphId = query || import.meta.env.VITE_KOCH_GRAPH_ID?.trim() || 'koch-morse'
  assertGraphId(graphId)
  return graphId
}

function initialAppearance(): { skin: VisualIdentitySkin; theme: Theme } {
  try {
    const saved = JSON.parse(window.localStorage.getItem('shrubbery.organism.settings.v1') ?? '{}') as Record<string, unknown>
    const skin = isVisualIdentitySkin(saved.skin) ? saved.skin : 'garden'
    const theme = saved.theme === 'dark' ? 'dark' : saved.theme === 'light' ? 'light' : 'light'
    return { skin, theme }
  } catch {
    return { skin: 'garden', theme: 'light' }
  }
}

function persistAppearance(patch: { skin?: VisualIdentitySkin; theme?: Theme }): void {
  try {
    const key = 'shrubbery.organism.settings.v1'
    const saved = JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<string, unknown>
    window.localStorage.setItem(key, JSON.stringify({ ...saved, ...patch }))
  } catch { /* appearance remains live even when browser storage is unavailable */ }
}

const GRAPH_ID = initialGraphId()
const SURFACE_TAG = 'koch-practice-surface'
const APPEARANCE = initialAppearance()
const FALLBACK_ROOM: KochRoom = Object.freeze({
  graphId: GRAPH_ID,
  title: GRAPH_ID,
  role: 'owner',
  cellState: 'running',
})

defineWorkspaceSurfaceElement(SURFACE_TAG, KOCH_FACE_CATALOGUE)

@customElement('koch-app')
export class KochApp extends LitElement {
  @state() private backend: BackendState = 'connecting'
  @state() private backendError = ''
  @state() private notice = ''
  @state() private activity: PracticeActivity = 'receive'
  @state() private phase: KochPracticePhase = 'ready'
  @state() private progress: ProgressSnapshot = EMPTY_PROGRESS
  @state() private lesson = 2
  @state() private settings: PracticeSettings = DEFAULT_SETTINGS
  @state() private prompt: PracticePrompt | null = null
  @state() private copy = ''
  @state() private score: PracticeScore | null = null
  @state() private saveError = ''
  @state() private audioError = ''
  @state() private unlocked = false
  @state() private selectedCharacter: KochCharacter = 'M'
  @state() private showNotation = false
  @state() private layoutDocument: LayoutDocument = buildDefaultKochLayout(GRAPH_ID)
  @state() private layoutSource: KochLayoutSource = 'seeded'
  @state() private layoutReadAt = 0
  @state() private actor: KochActor = { id: 'local', displayName: 'Local learner' }
  @state() private room: KochRoom = FALLBACK_ROOM
  @state() private rooms: readonly KochRoom[] = []
  @state() private roomsStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  @state() private roomsError = ''
  @state() private createRoomDraft = ''
  @state() private createRoomRequested = false
  @state() private nameDraft = this.actor.displayName
  @state() private performance: GraphPerformanceSnapshot | null = null
  @state() private accessGrants: readonly KochRoomAccessGrant[] = []
  @state() private accessModel: MnAccessManagerModel | null = null
  @state() private roomBusy = false
  @state() private activeSkin: VisualIdentitySkin = APPEARANCE.skin
  @state() private theme: Theme = APPEARANCE.theme
  @state() private keyedPattern = ''
  @state() private keyedCharacterCount = 0
  @state() private keyDown = false

  private readonly deployment = createKochBackend(GRAPH_ID)
  private readonly writer = this.deployment.writer
  private readonly source = this.deployment.source
  private readonly player = new WebAudioMorsePlayer()
  private readonly keyer = new WebAudioStraightKey()
  private keyingCapture: StraightKeyCapture | null = null
  private characterTimer: ReturnType<typeof setTimeout> | null = null
  private playbackTimer: ReturnType<typeof setTimeout> | null = null
  private layoutPollTimer: ReturnType<typeof setInterval> | null = null
  private preferenceTimer: ReturnType<typeof setTimeout> | null = null
  private playbackSerial = 0
  private sessionId = ''
  private sessionCompletedAt = ''
  private preferenceWrites: Promise<void> = Promise.resolve()

  static styles = css`
    :host {
      display: block;
      min-height: 100dvh;
      color: var(--mn-color-text-primary, #17231d);
      background: var(--mn-color-surface-sunken, #f4f5f2);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    * { box-sizing: border-box; }

    .shell {
      height: 100dvh;
      min-height: 620px;
      display: grid;
      grid-template-rows: var(--mn-y-slice-1-height, 40px) minmax(0, 1fr) 30px;
      overflow: hidden;
    }

    mn-top-bar { min-width: 0; }

    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      padding: var(--mn-space-3, 12px);
      overflow: hidden;
    }

    koch-practice-surface {
      border: 1px solid var(--mn-color-border-default, #d8ddd8);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-sunken, #f4f5f2);
      box-shadow: var(--mn-shadow-card, 0 2px 8px rgb(0 0 0 / 0.04));
    }

    koch-practice-surface [data-layout-grid-interior='true'] {
      padding: var(--mn-space-3, 12px);
      min-height: 100%;
      grid-template-columns: repeat(4, minmax(260px, 1fr)) !important;
      grid-auto-rows: minmax(620px, 1fr) !important;
      align-content: stretch !important;
    }

    koch-practice-surface [data-layout-grid-cell-id] {
      border: 1px solid var(--mn-color-border-default, #d8ddd8);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-xs, 0 1px 2px rgb(0 0 0 / 0.035));
    }

    .koch-face {
      width: 100%;
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: var(--mn-color-text-primary, #17231d);
      background: var(--mn-color-surface-base, #fff);
    }

    .face-scroll,
    .practice-scroll {
      min-height: 0;
      flex: 1 1 auto;
      overflow: auto;
      padding: var(--mn-space-4, 16px);
    }

    .practice-scroll {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
    }

    .practice-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mn-space-5, 20px);
    }

    .face-kicker,
    .practice-heading h1,
    .practice-heading p { margin: 0; }

    .face-kicker {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #356d4d));
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .practice-heading h1 {
      margin-top: var(--mn-space-1, 4px);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: clamp(30px, 3vw, 42px);
      font-weight: 520;
      line-height: 1.1;
      letter-spacing: -0.025em;
    }

    .lesson-method {
      margin-top: var(--mn-space-2, 8px);
      max-width: 52ch;
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
    }

    .active-alphabet {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 4px);
      margin-top: var(--mn-space-3, 12px) !important;
    }

    .active-alphabet span {
      display: grid;
      min-width: 32px;
      height: 32px;
      place-items: center;
      border: 1px solid var(--mn-color-border-default, #ccd3ce);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-base, 15px);
      font-weight: 700;
    }

    .active-alphabet span.newest {
      border-color: var(--mn-color-accent, #356d4d);
      background: var(--mn-color-interactive-selected, #e1eee6);
      color: var(--mn-color-text-accent, #285c40);
      box-shadow: inset 0 -2px 0 var(--mn-color-accent, #356d4d);
    }

    .practice-options {
      display: flex;
      align-items: flex-end;
      gap: var(--mn-space-3, 12px);
      flex: 0 0 auto;
    }

    .practice-options label,
    .practice-options fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }

    .practice-options label > span,
    .practice-options legend {
      display: block;
      margin-bottom: var(--mn-space-1, 4px);
      color: var(--mn-color-text-tertiary, #78827c);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    select,
    .segmented,
    .segmented button {
      min-height: max(34px, var(--mn-control-height, 30px));
      border: 1px solid var(--mn-color-border-default, #ccd3ce);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
    }

    select {
      max-width: 180px;
      padding: 0 var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-control, 6px);
    }

    .segmented {
      display: flex;
      overflow: hidden;
      border-radius: var(--mn-radius-control, 6px);
    }

    .segmented button {
      min-width: 38px;
      border: 0;
      border-right: 1px solid var(--mn-color-border-default, #ccd3ce);
      cursor: pointer;
    }

    .segmented button:last-child { border-right: 0; }
    .segmented button[aria-pressed='true'] {
      background: var(--mn-color-interactive-selected, #e1eee6);
      color: var(--mn-color-text-accent, #285c40);
      font-weight: 700;
    }

    .receiver-controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(150px, 1fr));
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-sunken, #f4f5f2);
    }

    .receiver-controls label > span {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-xs, 12px);
    }

    .receiver-controls label > span strong {
      color: var(--mn-color-text-primary, #17231d);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 11px);
      white-space: nowrap;
    }

    .receiver-controls input {
      width: 100%;
      min-height: 24px;
      margin: 3px 0 0;
      accent-color: var(--mn-color-accent, #356d4d);
      cursor: pointer;
    }
    .receiver-controls.sending-controls { grid-template-columns: repeat(2, minmax(150px, 1fr)); }

    .copy-card::part(body) { padding: var(--mn-space-4, 16px); }
    .copy-card-header,
    .review-header,
    .character-card-header,
    .copy-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
    }

    .copy-card-header {
      color: var(--mn-color-text-secondary, #5b665f);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .copy-card-header .active-signal {
      color: var(--mn-color-text-accent, #285c40);
      font-weight: 750;
    }

    .copy-instruction {
      display: flex;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      margin-bottom: var(--mn-space-3, 12px);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-sm, 13px);
    }

    .copy-instruction strong { color: var(--mn-color-text-primary, #17231d); }

    hoja-editor {
      display: block;
      min-height: 160px;
      --hoja-editor-min-height: 148px;
      --hoja-surface: var(--mn-color-surface-sunken, #f4f5f2);
      --hoja-border: var(--mn-color-border-default, #ccd3ce);
      --hoja-focus: var(--mn-color-accent, #356d4d);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 20px;
      letter-spacing: 0.09em;
    }

    .send-target {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-height: 58px;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #ccd3ce);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f4f5f2);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .send-target span {
      display: grid;
      min-width: 29px;
      height: 34px;
      place-items: center;
      border-radius: 4px;
    }
    .send-target span.complete { color: var(--mn-color-text-tertiary, #78827c); text-decoration: line-through; }
    .send-target span.current {
      background: var(--mn-color-interactive-selected, #e1eee6);
      color: var(--mn-color-text-accent, #285c40);
      box-shadow: inset 0 -3px 0 var(--mn-color-accent, #356d4d);
    }
    .straight-key-station {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(180px, 1fr);
      gap: var(--mn-space-4, 16px);
      align-items: stretch;
      margin-top: var(--mn-space-3, 12px);
    }
    .live-pattern {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-text-tertiary, #78827c);
      font-size: var(--mn-text-xs, 12px);
    }
    .live-pattern code {
      min-height: 28px;
      color: var(--mn-color-text-primary, #17231d);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 22px;
      letter-spacing: 0.2em;
    }
    .straight-key {
      position: relative;
      min-height: 88px;
      border: 1px solid var(--mn-color-border-strong, #aeb8b1);
      border-radius: var(--mn-radius-surface, 8px);
      background: linear-gradient(#fff, #e8ebe8);
      color: var(--mn-color-text-secondary, #5b665f);
      box-shadow: 0 5px 0 #aeb8b1, 0 8px 14px rgb(0 0 0 / 0.12);
      cursor: pointer;
      touch-action: none;
      user-select: none;
    }
    .straight-key span {
      display: block;
      width: 54px;
      height: 12px;
      margin: 0 auto 10px;
      border-radius: 999px;
      background: var(--mn-color-text-primary, #17231d);
    }
    .straight-key.pressed {
      transform: translateY(4px);
      border-color: var(--mn-color-accent, #356d4d);
      background: var(--mn-color-interactive-selected, #e1eee6);
      color: var(--mn-color-text-accent, #285c40);
      box-shadow: 0 1px 0 #789183, 0 3px 7px rgb(0 0 0 / 0.1);
    }
    .straight-key:disabled { cursor: not-allowed; opacity: 0.55; box-shadow: none; }

    .copy-actions { flex-wrap: wrap; }
    .key-help {
      color: var(--mn-color-text-tertiary, #78827c);
      font-size: var(--mn-text-2xs, 11px);
    }

    kbd {
      padding: 1px 4px;
      border: 1px solid var(--mn-color-border-default, #ccd3ce);
      border-radius: 3px;
      background: var(--mn-color-surface-sunken, #f4f5f2);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }

    .review-card::part(body) { padding: var(--mn-space-4, 16px); }
    .review-header strong { font-size: var(--mn-text-lg, 18px); color: var(--mn-color-danger, #a13a35); }
    .review-header strong.passed { color: var(--mn-color-success-strong, #2c6948); }

    .copy-review {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      margin: 0;
      font-size: var(--mn-text-sm, 13px);
    }

    .copy-review dt { color: var(--mn-color-text-tertiary, #78827c); }
    .copy-review dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .copy-review code { font-family: var(--mn-font-mono, ui-monospace, monospace); }
    .threshold-copy { margin: var(--mn-space-3, 12px) 0 0; color: var(--mn-color-text-secondary, #5b665f); font-size: var(--mn-text-sm, 13px); }

    .inline-error,
    .backend-error {
      margin: 0;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-danger-border, #d7aaa6);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-danger-surface, #fff2f0);
      color: var(--mn-color-danger-strong, #8e2f2b);
      font-size: var(--mn-text-sm, 13px);
      white-space: pre-wrap;
    }

    .inline-state {
      margin: 0;
      padding: var(--mn-space-3, 12px);
      border-left: 3px solid var(--mn-color-warning, #a77720);
      background: var(--mn-color-warning-surface, #fff9e9);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
    }

    .backend-error {
      position: absolute;
      inset: var(--mn-space-5, 20px);
      z-index: 5;
      align-self: start;
      box-shadow: var(--mn-shadow-card, 0 4px 18px rgb(0 0 0 / 0.12));
    }

    .notice {
      position: absolute;
      right: var(--mn-space-5, 20px);
      bottom: var(--mn-space-5, 20px);
      z-index: 6;
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      max-width: min(480px, calc(100% - 40px));
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-warning-border, #d6bd84);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-warning-surface, #fff9e9);
      color: var(--mn-color-text-primary, #17231d);
      box-shadow: var(--mn-shadow-card, 0 4px 18px rgb(0 0 0 / 0.12));
      font-size: var(--mn-text-sm, 13px);
    }

    .create-room-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: var(--mn-space-5, 20px);
      background: rgb(16 28 22 / 0.36);
      backdrop-filter: blur(2px);
    }

    .create-room-dialog { width: min(480px, 100%); }
    .create-room-dialog::part(body) { padding: var(--mn-space-4, 16px); }
    .create-room-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: var(--mn-space-3, 12px); }
    .create-room-dialog-header strong { font-family: var(--mn-font-serif, Georgia, serif); font-size: var(--mn-text-lg, 18px); }
    .create-room-dialog p { margin: 0 0 var(--mn-space-3, 12px); color: var(--mn-color-text-secondary, #5b665f); font-size: var(--mn-text-sm, 13px); line-height: 1.5; }
    .create-room-dialog label > span { display: block; margin-bottom: 5px; color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-2xs, 11px); font-weight: 650; text-transform: uppercase; }
    hoja-editor.create-room-editor { min-height: 76px; --hoja-editor-min-height: 72px; font-size: var(--mn-text-md, 15px); letter-spacing: 0; }
    .create-room-dialog-actions { display: flex; justify-content: flex-end; gap: var(--mn-space-2, 8px); }

    .character-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(42px, 1fr));
      gap: var(--mn-space-1, 4px);
    }

    .character {
      aspect-ratio: 1;
      min-width: 0;
      min-height: 42px;
      border: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-tertiary, #78827c);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-weight: 650;
      cursor: pointer;
    }

    .character.learned { color: var(--mn-color-text-primary, #17231d); border-color: var(--mn-color-border-default, #ccd3ce); }
    .character.current { box-shadow: inset 0 -3px 0 var(--mn-color-accent, #356d4d); }
    .character.selected {
      border-color: var(--mn-color-accent, #356d4d);
      background: var(--mn-color-interactive-selected, #e1eee6);
      color: var(--mn-color-text-accent, #285c40);
    }
    .character:disabled { cursor: not-allowed; opacity: 0.52; }

    .character-card::part(body) { padding: var(--mn-space-4, 16px); }
    .character-card-header { font-size: var(--mn-text-xs, 12px); color: var(--mn-color-text-secondary, #5b665f); }
    .character-detail {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
    }
    .character-detail > strong {
      grid-row: 1 / span 2;
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: 54px;
      font-weight: 500;
      line-height: 1;
    }
    .character-detail code { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 20px; letter-spacing: 0.12em; }
    .character-detail span { color: var(--mn-color-text-secondary, #5b665f); font-size: var(--mn-text-sm, 13px); }
    .character-detail .notation-hidden { grid-row: 1 / span 2; line-height: 1.45; }

    .notation-toggle {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-xs, 12px);
    }

    .active-set,
    .sequence-disclosure,
    .method-note {
      margin-top: var(--mn-space-4, 16px);
      padding-top: var(--mn-space-4, 16px);
      border-top: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      font-size: var(--mn-text-sm, 13px);
    }

    .section-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
    }
    .section-heading span { color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-xs, 12px); }
    .active-character-grid { grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); }

    .sequence-disclosure summary {
      display: flex;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      cursor: pointer;
      font-weight: 650;
      list-style-position: inside;
    }
    .sequence-disclosure summary span { color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-xs, 12px); font-weight: 500; }
    .full-character-grid { margin-top: var(--mn-space-3, 12px); }
    .method-note { margin-bottom: 0; color: var(--mn-color-text-secondary, #5b665f); line-height: 1.5; }

    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-border-subtle, #e2e6e2);
    }
    .stat-grid > div { padding: var(--mn-space-3, 12px); background: var(--mn-color-surface-base, #fff); }
    .stat-grid strong,
    .stat-grid span { display: block; }
    .stat-grid strong { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: var(--mn-text-lg, 18px); }
    .stat-grid span { margin-top: 2px; color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-2xs, 11px); text-transform: uppercase; }

    .record-section { margin-top: var(--mn-space-5, 20px); }
    .record-section h2 {
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .empty-copy { margin: 0; color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-sm, 13px); }

    .room-card::part(body) { padding: var(--mn-space-3, 12px); }
    .room-heading,
    .room-heading > div {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }
    .room-heading { justify-content: space-between; }
    .room-heading > div { min-width: 0; }
    .room-heading span { color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-2xs, 11px); }
    .room-card p { margin: var(--mn-space-2, 8px) 0 0; color: var(--mn-color-text-secondary, #5b665f); font-size: var(--mn-text-xs, 12px); line-height: 1.45; }
    .room-reference { display: block; overflow: hidden; color: var(--mn-color-text-tertiary, #78827c); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .room-fields { display: grid; gap: var(--mn-space-3, 12px); margin-top: var(--mn-space-3, 12px); }
    .room-fields label { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; align-items: end; }
    .room-fields label > span { grid-column: 1 / -1; color: var(--mn-color-text-tertiary, #78827c); font-size: var(--mn-text-2xs, 11px); font-weight: 650; text-transform: uppercase; }
    hoja-editor.compact-composer {
      min-height: 40px;
      --hoja-editor-min-height: 38px;
      font-size: var(--mn-text-sm, 13px);
      letter-spacing: 0;
    }
    .people-section { padding: var(--mn-space-3, 12px); border: 1px solid var(--mn-color-border-subtle, #e2e6e2); border-radius: var(--mn-radius-surface, 8px); }
    .people-section .section-heading { margin: 0 0 var(--mn-space-2, 8px); }
    .people-section h2 { margin: 0; }
    .people-list { display: grid; gap: var(--mn-space-2, 8px); margin: 0; padding: 0; list-style: none; }
    .people-list > li { padding: var(--mn-space-2, 8px); border: 1px solid var(--mn-color-border-subtle, #e2e6e2); border-radius: var(--mn-radius-control, 6px); background: var(--mn-color-surface-base, #fff); }
    .people-list > li.self { border-color: var(--mn-color-accent, #356d4d); background: var(--mn-color-interactive-selected, #e1eee6); }
    .person-heading { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--mn-space-2, 8px); align-items: baseline; }
    .person-heading strong { overflow: hidden; font-size: var(--mn-text-sm, 13px); text-overflow: ellipsis; white-space: nowrap; }
    .person-rank,
    .self-mark { color: var(--mn-color-text-tertiary, #78827c); font-size: 10px; text-transform: uppercase; }
    .person-performance { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin-top: var(--mn-space-2, 8px); overflow: hidden; border: 1px solid var(--mn-color-border-subtle, #e2e6e2); border-radius: 4px; background: var(--mn-color-border-subtle, #e2e6e2); }
    .person-performance > div { min-width: 0; padding: 6px; background: var(--mn-color-surface-base, #fff); }
    .person-performance > div > span { display: block; color: var(--mn-color-text-tertiary, #78827c); font-size: 9px; font-weight: 700; text-transform: uppercase; }
    .person-performance strong,
    .person-performance small,
    .person-performance em { display: block; margin-top: 2px; }
    .person-performance strong { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: var(--mn-text-md, 15px); }
    .person-performance small,
    .person-performance em { overflow: hidden; color: var(--mn-color-text-tertiary, #78827c); font-size: 9px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
    .person-asof { display: block; margin-top: 5px; color: var(--mn-color-text-tertiary, #78827c); font-size: 9px; text-align: right; }

    .session-list { margin: 0; padding: 0; list-style: none; }
    .session-list li {
      display: grid;
      grid-template-columns: 28px 46px 1fr auto;
      gap: var(--mn-space-2, 8px);
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      font-size: var(--mn-text-xs, 12px);
    }
    .session-list small,
    .session-list time { color: var(--mn-color-text-tertiary, #78827c); }

    .character-stats > div {
      display: grid;
      grid-template-columns: 24px 1fr 38px;
      gap: var(--mn-space-2, 8px);
      align-items: center;
      margin-top: 7px;
      font-size: var(--mn-text-xs, 12px);
    }
    progress { width: 100%; height: 5px; accent-color: var(--mn-color-accent, #356d4d); }

    .unlock-rule {
      margin: var(--mn-space-5, 20px) 0 0;
      padding: var(--mn-space-3, 12px);
      border-left: 3px solid var(--mn-color-accent, #356d4d);
      background: var(--mn-color-surface-sunken, #f4f5f2);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
    }

    .testimony {
      margin-top: var(--mn-space-5, 20px);
      padding-top: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-subtle, #e2e6e2);
      color: var(--mn-color-text-secondary, #5b665f);
      font-size: var(--mn-text-xs, 12px);
    }
    .testimony summary { cursor: pointer; font-weight: 650; }
    .testimony dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 10px; }
    .testimony dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .testimony code { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 10px; }

    .testimony-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      min-width: 0;
      padding: 0 var(--mn-space-4, 16px);
      border-top: 1px solid var(--mn-color-border-default, #d8ddd8);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-tertiary, #78827c);
      font-size: var(--mn-text-2xs, 11px);
    }
    .testimony-bar span,
    .testimony-bar code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .testimony-bar code { font-family: var(--mn-font-mono, ui-monospace, monospace); }

    @media (max-width: 1160px) {
      koch-practice-surface [data-layout-grid-interior='true'] {
        grid-template-columns: repeat(2, minmax(300px, 1fr)) !important;
        grid-auto-rows: minmax(430px, auto) !important;
        align-content: start !important;
      }
      koch-practice-surface [data-layout-grid-cell-id='practice'] { grid-column: 1 / -1 !important; }
    }

    @media (max-width: 720px) {
      .shell { min-height: 560px; }
      .appbar { padding: 0 var(--mn-space-3, 12px); }
      .breadcrumb .graph { display: none; }
      .stage { padding: var(--mn-space-1, 4px); }
      koch-practice-surface [data-layout-grid-interior='true'] {
        padding: var(--mn-space-1, 4px);
        grid-template-columns: minmax(0, 1fr) !important;
      }
      koch-practice-surface [data-layout-grid-cell-id] { grid-column: 1 !important; }
      .practice-heading { flex-direction: column; }
      .practice-options { width: 100%; justify-content: space-between; }
      .receiver-controls { grid-template-columns: 1fr; }
      .receiver-controls.sending-controls { grid-template-columns: 1fr; }
      .copy-instruction { flex-direction: column; }
      .straight-key-station { grid-template-columns: 1fr; }
      .key-help { display: none; }
      .testimony-bar code { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.001ms !important; }
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.applyAppearance()
    window.addEventListener('keydown', this.handleGlobalKeydown)
    window.addEventListener('keyup', this.handleGlobalKeyup)
    void this.boot()
  }

  disconnectedCallback(): void {
    this.stopPlayback()
    this.stopKeying()
    if (this.layoutPollTimer) clearInterval(this.layoutPollTimer)
    if (this.preferenceTimer) clearTimeout(this.preferenceTimer)
    window.removeEventListener('keydown', this.handleGlobalKeydown)
    window.removeEventListener('keyup', this.handleGlobalKeyup)
    void this.deployment.close()
    super.disconnectedCallback()
  }

  protected updated(changed: PropertyValues): void {
    if (!changed.has('phase')) return
    if (this.phase === 'playing' || this.phase === 'copying') this.focusCopy()
    if (this.phase === 'review' || this.phase === 'ready') this.focusPrimaryAction()
  }

  private readonly handleGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (this.phase === 'playing' || this.phase === 'copying' || this.phase === 'sending')) {
      event.preventDefault()
      this.cancelPractice()
      return
    }
    if (this.phase === 'sending') {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        this.beginKeyingElement()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        void this.finishSendingRun()
      }
      return
    }
    if (event.code !== 'Space' || (this.phase !== 'ready' && this.phase !== 'review')) return
    const interactive = event.composedPath().some((node) => {
      if (!(node instanceof HTMLElement)) return false
      return node.matches('input, textarea, select, button, summary, a, hoja-editor, mn-button, [contenteditable="true"]')
    })
    if (interactive || this.backend !== 'online' || this.room.role === 'viewer') return
    event.preventDefault()
    this.startPractice()
  }

  private readonly handleGlobalKeyup = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || this.phase !== 'sending') return
    event.preventDefault()
    this.endKeyingElement()
  }

  private async boot(): Promise<void> {
    this.backend = 'connecting'
    this.backendError = ''
    this.notice = ''
    this.roomsStatus = 'loading'
    this.roomsError = ''
    try {
      this.actor = await this.deployment.ready()
      this.nameDraft = this.actor.displayName
      this.rooms = await this.deployment.listRooms()
      this.roomsStatus = 'ready'
      const room = this.rooms.find((candidate) => candidate.graphId === GRAPH_ID)
      if (!room) {
        const urlHasGraph = new URL(window.location.href).searchParams.has('graph')
        if (!urlHasGraph && this.rooms[0]) {
          this.navigateToRoom(this.rooms[0].graphId, true)
          return
        }
        throw new Error(
          this.rooms.length === 0
            ? 'No Garden graph is available to this account. Create one in Garden, then open its Koch view.'
            : `Graph ${GRAPH_ID} is not in this account’s Garden catalog. Access must be granted before its link can open.`,
        )
      }
      this.room = room
      this.layoutDocument = buildDefaultKochLayout(GRAPH_ID, undefined, this.actor.id)
      if (this.room.role !== 'viewer') {
        await ensureKochInformationModel(this.writer, this.source, GRAPH_ID, this.actor)
      }
      const [progress, preferences, layout, performance] = await Promise.all([
        loadProgress(this.source, GRAPH_ID, this.actor.id),
        loadPreferences(this.source, GRAPH_ID, this.actor.id),
        loadKochLayout(this.source, GRAPH_ID, this.actor.id),
        loadGraphPerformance(this.source, GRAPH_ID),
      ])
      this.progress = progress
      this.lesson = progress.currentLesson
      this.selectedCharacter = lessonCharacters(progress.currentLesson).at(-1)!
      this.settings = preferences.settings
      this.showNotation = preferences.showNotation
      this.performance = performance
      const upgradedLayout = layout.source === 'graph'
        ? upgradeDefaultKochLayout(layout.document, GRAPH_ID, undefined, this.actor.id)
        : { document: layout.document, upgraded: false }
      this.layoutDocument = upgradedLayout.document
      this.layoutReadAt = layout.readAt
      if (this.room.role !== 'viewer' && (layout.source === 'missing' || upgradedLayout.upgraded)) {
        await persistKochLayout(this.writer, GRAPH_ID, upgradedLayout.document, this.actor.id)
      }
      if (layout.source === 'missing') {
        this.layoutSource = 'seeded'
      } else {
        this.layoutSource = 'graph'
      }
      this.backend = 'online'
      await this.refreshAccess()
      this.beginLayoutPolling()
    } catch (error) {
      this.backend = 'error'
      if (this.roomsStatus === 'loading') {
        this.roomsStatus = 'error'
        this.roomsError = error instanceof Error ? error.message : String(error)
      }
      this.backendError = error instanceof Error ? error.message : String(error)
    }
  }

  private beginLayoutPolling(): void {
    if (this.layoutPollTimer) clearInterval(this.layoutPollTimer)
    const interval = Math.max(5_000, this.source.description.suggestedPollMs ?? 5_000)
    this.layoutPollTimer = setInterval(() => {
      void this.refreshGraphLayout()
      void this.refreshPerformance()
    }, interval)
  }

  private async refreshGraphLayout(): Promise<void> {
    if (this.backend !== 'online') return
    try {
      const result = await loadKochLayout(this.source, GRAPH_ID, this.actor.id)
      if (result.source !== 'graph') return
      this.layoutReadAt = result.readAt
      this.layoutSource = 'graph'
      if (JSON.stringify(result.document) !== JSON.stringify(this.layoutDocument)) {
        this.layoutDocument = result.document
      }
    } catch (error) {
      this.notice = `Layout refresh failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async refreshPerformance(): Promise<void> {
    if (this.backend !== 'online') return
    try {
      this.performance = await loadGraphPerformance(this.source, GRAPH_ID)
    } catch (error) {
      this.notice = `Graph performance refresh failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private practiceBinding(): KochPracticeFaceValue {
    return {
      backendOnline: this.backend === 'online',
      practiceAllowed: this.room.role !== 'viewer',
      practiceDisabledReason: 'You have viewer access to this graph. You can inspect every filed performance, but an editor grant is required to file a run.',
      activity: this.activity,
      phase: this.phase,
      lesson: this.lesson,
      highestLesson: this.progress.currentLesson,
      settings: this.settings,
      prompt: this.prompt,
      copy: this.copy,
      score: this.score,
      keyedPattern: this.keyedPattern,
      keyedCharacterCount: this.keyedCharacterCount,
      keyDown: this.keyDown,
      sessionId: this.sessionId,
      unlocked: this.unlocked,
      saveError: this.saveError,
      audioError: this.audioError,
      onStart: () => this.startPractice(),
      onActivityChange: (activity) => this.setActivity(activity),
      onReplay: () => this.replay(),
      onCancel: () => this.cancelPractice(),
      onSubmit: () => void this.submitCopy(),
      onFinishSend: () => void this.finishSendingRun(),
      onKeyDown: () => this.beginKeyingElement(),
      onKeyUp: () => this.endKeyingElement(),
      onRetrySave: () => void this.retrySave(),
      onCopyChange: (detail) => this.updateCopy(detail),
      onLessonChange: (lesson) => this.setLesson(lesson),
      onRunLengthChange: (count) => this.setRunLength(count),
      onCharacterWpmChange: (value) => this.setCharacterWpm(value),
      onEffectiveWpmChange: (value) => this.setEffectiveWpm(value),
      onToneChange: (value) => this.setTone(value),
    }
  }

  private curriculumBinding(): KochCurriculumFaceValue {
    return {
      lesson: this.lesson,
      selectedCharacter: this.selectedCharacter,
      showNotation: this.showNotation,
      busy: this.phase === 'playing' || this.phase === 'copying' || this.phase === 'sending' || this.phase === 'saving',
      progress: this.progress,
      onCharacterSelect: (character) => this.hearCharacter(character),
      onNotationChange: (show) => {
        this.showNotation = show
        this.schedulePreferenceSave()
      },
    }
  }

  private progressBinding(): KochProgressFaceValue {
    return {
      progress: this.progress,
      actor: this.actor,
      activity: this.activity,
      room: this.room,
      nameDraft: this.nameDraft,
      performance: this.performance,
      accessGrants: this.accessGrants,
      canWrite: this.room.role !== 'viewer',
      roomBusy: this.roomBusy,
      onNameDraftChange: (detail) => { this.nameDraft = detail.value },
      onSaveName: () => void this.saveActorName(),
      onCopyInvite: () => void this.copyRoomInvite(),
    }
  }

  private surfaceModel(): WorkspaceSurfaceModel<null> {
    const document = this.layoutDocument
    const bindings = new Map<string, unknown>([
      ['practice', this.practiceBinding()],
      ['curriculum', this.curriculumBinding()],
      ['progress', this.progressBinding()],
    ])
    return {
      build: () => ({ document, bindings, metadata: null }),
      onRatioChange: (change) => this.handleRatioChange(change),
    }
  }

  private handleRatioChange(change: SurfaceRatioChange): void {
    this.layoutDocument = change.document
    if (change.phase !== 'commit') return
    if (this.room.role === 'viewer') {
      this.notice = 'Viewer access cannot file a personal layout in this graph.'
      return
    }
    void persistKochLayout(this.writer, GRAPH_ID, change.document, this.actor.id)
      .then(() => {
        this.layoutSource = 'graph'
        this.layoutReadAt = Date.now()
        this.notice = ''
      })
      .catch((error) => {
        this.notice = `Layout save failed: ${error instanceof Error ? error.message : String(error)}`
      })
  }

  private focusCopy(): void {
    requestAnimationFrame(() => {
      const surface = this.renderRoot.querySelector<WorkspaceSurfaceElement>(SURFACE_TAG)
      surface?.querySelector<HojaEditor>('hoja-editor')?.focus()
    })
  }

  private focusPrimaryAction(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const surface = this.renderRoot.querySelector<WorkspaceSurfaceElement>(SURFACE_TAG)
      const action = surface?.querySelector<HTMLElement>('mn-button[data-primary-run]')
      action?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.focus()
    }))
  }

  private stopPlayback(): void {
    this.playbackSerial += 1
    if (this.playbackTimer) clearTimeout(this.playbackTimer)
    this.playbackTimer = null
    this.player.stop()
  }

  private stopKeying(): void {
    if (this.characterTimer) clearTimeout(this.characterTimer)
    this.characterTimer = null
    this.keyer.stop()
    this.keyDown = false
  }

  private beginKeyingElement(): void {
    if (this.phase !== 'sending' || !this.keyingCapture) return
    if (this.characterTimer) clearTimeout(this.characterTimer)
    this.characterTimer = null
    if (!this.keyingCapture.keyDown()) return
    this.keyDown = true
    void this.keyer.press(this.settings.toneHz).catch((error) => {
      this.audioError = error instanceof Error ? error.message : String(error)
    })
  }

  private endKeyingElement(): void {
    if (this.phase !== 'sending' || !this.keyingCapture) return
    const element = this.keyingCapture.keyUp()
    if (!element) return
    this.keyer.release()
    this.keyDown = false
    this.keyedPattern = this.keyingCapture.livePattern
    if (this.characterTimer) clearTimeout(this.characterTimer)
    this.characterTimer = setTimeout(
      () => this.closeKeyedCharacter(),
      // Two units is the midpoint between a one-unit intra-character gap and
      // the canonical three-unit character gap. Close here, then assess the
      // learner's actual next-key gap against three units.
      this.keyingCapture.ditMs * 2,
    )
  }

  private closeKeyedCharacter(): void {
    if (this.characterTimer) clearTimeout(this.characterTimer)
    this.characterTimer = null
    const character = this.keyingCapture?.closeCharacter()
    if (!character) return
    this.keyedCharacterCount = this.keyingCapture?.characterCount ?? 0
    this.keyedPattern = this.keyingCapture?.livePattern ?? ''
    if (this.prompt && this.keyedCharacterCount >= this.prompt.plain.length) {
      void this.finishSendingRun()
    }
  }

  private async playText(text: string, trackPractice: boolean): Promise<void> {
    this.stopPlayback()
    this.audioError = ''
    const serial = this.playbackSerial
    try {
      const timeline = await this.player.play(text, this.settings)
      if (!trackPractice) return
      this.phase = 'playing'
      this.playbackTimer = setTimeout(() => {
        if (serial === this.playbackSerial && this.phase === 'playing') this.phase = 'copying'
      }, timeline.durationSeconds * 1_000)
    } catch (error) {
      this.audioError = error instanceof Error ? error.message : String(error)
      if (trackPractice) this.phase = 'copying'
    }
  }

  private startPractice(): void {
    if (this.backend !== 'online' || this.room.role === 'viewer') return
    this.prompt = generatePrompt(this.lesson, this.settings)
    this.copy = ''
    this.score = null
    this.saveError = ''
    this.audioError = ''
    this.unlocked = false
    this.keyedPattern = ''
    this.keyedCharacterCount = 0
    this.keyDown = false
    this.sessionId = crypto.randomUUID()
    this.sessionCompletedAt = ''
    if (this.activity === 'send') {
      this.stopPlayback()
      this.keyingCapture = new StraightKeyCapture(targetDitMs(this.settings.characterWpm))
      this.phase = 'sending'
    } else {
      this.keyingCapture = null
      void this.playText(this.prompt.grouped, true)
    }
  }

  private replay(): void {
    if (this.prompt) void this.playText(this.prompt.grouped, true)
  }

  private cancelPractice(): void {
    if (this.phase !== 'playing' && this.phase !== 'copying' && this.phase !== 'sending') return
    this.stopPlayback()
    this.stopKeying()
    this.phase = 'ready'
    this.prompt = null
    this.copy = ''
    this.score = null
    this.sessionId = ''
    this.sessionCompletedAt = ''
    this.audioError = ''
    this.keyingCapture = null
    this.keyedPattern = ''
    this.keyedCharacterCount = 0
    this.focusPrimaryAction()
  }

  private hearCharacter(character: KochCharacter): void {
    if (this.phase === 'playing' || this.phase === 'copying' || this.phase === 'sending' || this.phase === 'saving') return
    this.selectedCharacter = character
    void this.playText(character, false)
  }

  private updateCopy(detail: HojaComposerDetail): void {
    this.copy = detail.value.toUpperCase()
  }

  private async submitCopy(): Promise<void> {
    if (this.activity !== 'receive' || !this.prompt || this.phase === 'saving' || this.phase === 'review') return
    this.stopPlayback()
    this.score = scoreCopy(this.prompt.plain, this.copy)
    this.sessionCompletedAt ||= new Date().toISOString()
    await this.fileCurrentRun()
  }

  private async finishSendingRun(): Promise<void> {
    if (this.activity !== 'send' || !this.prompt || !this.keyingCapture || this.phase !== 'sending') return
    if (this.keyingCapture.isDown) this.endKeyingElement()
    if (this.characterTimer) clearTimeout(this.characterTimer)
    this.characterTimer = null
    this.keyingCapture.closeCharacter()
    this.keyedCharacterCount = this.keyingCapture.characterCount
    if (this.keyedCharacterCount === 0) {
      this.notice = 'Key at least one character before finishing the run.'
      return
    }
    this.stopKeying()
    this.score = scoreKeying(this.prompt.plain, this.keyingCapture.snapshot())
    this.sessionCompletedAt ||= new Date().toISOString()
    await this.fileCurrentRun()
  }

  private async retrySave(): Promise<void> {
    if (!this.prompt || !this.score) return
    await this.fileCurrentRun()
  }

  private async fileCurrentRun(): Promise<void> {
    if (!this.prompt || !this.score) return
    this.phase = 'saving'
    this.saveError = ''
    const oldUnlockedLesson = this.progress.currentLesson
    const practicedLesson = this.lesson
    try {
      await saveSession(this.writer, GRAPH_ID, {
        prompt: this.prompt,
        score: this.score,
        settings: this.settings,
        id: this.sessionId,
        completedAt: this.sessionCompletedAt,
        actor: this.actor,
      })
      const [progress, performance] = await Promise.all([
        loadProgress(this.source, GRAPH_ID, this.actor.id),
        loadGraphPerformance(this.source, GRAPH_ID),
      ])
      this.progress = progress
      this.performance = performance
      this.unlocked = this.score.activity === 'receive' && progress.currentLesson > oldUnlockedLesson
      this.lesson = this.unlocked ? progress.currentLesson : practicedLesson
      if (this.unlocked) this.selectedCharacter = lessonCharacters(progress.currentLesson).at(-1)!
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error)
    } finally {
      this.phase = 'review'
    }
  }

  private setLesson(lesson: number): void {
    this.lesson = Math.max(2, Math.min(this.progress.currentLesson, lesson))
    this.selectedCharacter = lessonCharacters(this.lesson).at(-1)!
  }

  private setActivity(activity: PracticeActivity): void {
    if (this.phase !== 'ready' && this.phase !== 'review') return
    this.activity = activity
    this.phase = 'ready'
    this.prompt = null
    this.score = null
    this.copy = ''
    this.saveError = ''
    this.audioError = ''
    this.keyedPattern = ''
    this.keyedCharacterCount = 0
  }

  private setRunLength(characterCount: number): void {
    this.settings = { ...this.settings, characterCount }
    this.schedulePreferenceSave()
  }

  private setCharacterWpm(characterWpm: number): void {
    this.settings = {
      ...this.settings,
      characterWpm,
      effectiveWpm: Math.min(characterWpm, this.settings.effectiveWpm),
    }
    this.schedulePreferenceSave()
  }

  private setEffectiveWpm(effectiveWpm: number): void {
    this.settings = { ...this.settings, effectiveWpm }
    this.schedulePreferenceSave()
  }

  private setTone(toneHz: number): void {
    this.settings = { ...this.settings, toneHz }
    this.schedulePreferenceSave()
  }

  private schedulePreferenceSave(): void {
    if (this.room.role === 'viewer') return
    if (this.preferenceTimer) clearTimeout(this.preferenceTimer)
    this.preferenceTimer = setTimeout(() => {
      this.preferenceTimer = null
      const preferences = { settings: this.settings, showNotation: this.showNotation }
      this.preferenceWrites = this.preferenceWrites
        .catch(() => undefined)
        .then(() => savePreferences(this.writer, GRAPH_ID, preferences, this.actor))
        .then(() => { this.notice = '' })
        .catch((error) => {
          this.notice = `Preference save failed: ${error instanceof Error ? error.message : String(error)}`
        })
    }, 450)
  }

  private navigateToRoom(graphId: string, replace = false): void {
    assertGraphId(graphId)
    if (graphId === GRAPH_ID) return
    const url = new URL(window.location.href)
    url.searchParams.set('graph', graphId)
    url.searchParams.delete('room')
    if (replace) window.location.replace(url.toString())
    else window.location.assign(url.toString())
  }

  private async refreshRooms(): Promise<void> {
    this.roomsStatus = 'loading'
    this.roomsError = ''
    try {
      this.rooms = await this.deployment.listRooms()
      this.room = this.rooms.find((candidate) => candidate.graphId === GRAPH_ID) ?? this.room
      this.roomsStatus = 'ready'
    } catch (error) {
      this.roomsStatus = 'error'
      this.roomsError = error instanceof Error ? error.message : String(error)
    }
  }

  private async createRoom(): Promise<void> {
    this.roomBusy = true
    this.createRoomRequested = true
    try {
      const created = await this.deployment.createRoom(this.createRoomDraft)
      this.rooms = [...this.rooms.filter((candidate) => candidate.graphId !== created.graphId), created]
      this.notice = `Created ${created.title}. Opening its graph-native Koch view…`
      this.navigateToRoom(created.graphId)
    } catch (error) {
      this.notice = `Could not create graph: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      this.roomBusy = false
    }
  }

  private openCreateRoom(): void {
    this.createRoomRequested = true
    requestAnimationFrame(() => {
      this.renderRoot.querySelector<HojaEditor>('hoja-editor.create-room-editor')?.focus()
    })
  }

  private async saveActorName(): Promise<void> {
    if (this.room.role === 'viewer') {
      this.notice = 'An editor grant is required to file a graph-visible learner name.'
      return
    }
    this.roomBusy = true
    try {
      this.actor = {
        ...this.actor,
        displayName: normalizeDisplayName(this.nameDraft, this.actor.id),
      }
      this.nameDraft = this.actor.displayName
      rememberActorName(this.actor)
      await savePreferences(
        this.writer,
        GRAPH_ID,
        { settings: this.settings, showNotation: this.showNotation },
        this.actor,
      )
      await this.refreshPerformance()
      this.notice = `Graph-visible learner name saved as ${this.actor.displayName}.`
    } catch (error) {
      this.notice = `Could not save name: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      this.roomBusy = false
    }
  }

  private async copyRoomInvite(): Promise<void> {
    const url = new URL(window.location.href)
    url.searchParams.set('graph', GRAPH_ID)
    url.searchParams.delete('room')
    url.searchParams.delete('actor')
    url.searchParams.delete('name')
    try {
      await navigator.clipboard.writeText(url.toString())
      this.notice = this.deployment.mode === 'hosted'
        ? `Graph link copied. The recipient still needs a viewer or editor grant for ${this.room.title}.`
        : `Local graph link copied for ${this.room.title}.`
    } catch {
      this.notice = `Graph link: ${url.toString()}`
    }
  }

  private async refreshAccess(notice = ''): Promise<void> {
    const service = this.deployment.roomAccess
    if (!service) {
      this.accessGrants = []
      this.accessModel = null
      return
    }
    this.accessModel = {
      graphId: GRAPH_ID,
      graphTitle: this.room.title,
      currentRole: this.room.role,
      status: 'loading',
      grants: this.accessGrants,
      busyAction: 'refresh',
    }
    try {
      this.accessGrants = await service.list()
      this.accessModel = {
        graphId: GRAPH_ID,
        graphTitle: this.room.title,
        currentRole: this.room.role,
        status: 'ready',
        grants: this.accessGrants,
        notice: notice || null,
      }
    } catch (error) {
      this.accessModel = {
        graphId: GRAPH_ID,
        graphTitle: this.room.title,
        currentRole: this.room.role,
        status: 'error',
        grants: this.accessGrants,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async mutateAccess(
    action: 'add' | 'role' | 'remove',
    userId: string,
    operation: () => Promise<void>,
    notice: string,
  ): Promise<void> {
    if (!this.accessModel || !this.deployment.roomAccess || this.accessModel.busyAction) return
    this.accessModel = {
      ...this.accessModel,
      busyAction: action,
      busyUserId: userId,
      error: null,
      notice: null,
    }
    try {
      await operation()
      await this.refreshAccess(notice)
    } catch (error) {
      this.accessModel = {
        ...this.accessModel,
        status: this.accessGrants.length > 0 ? 'ready' : 'error',
        busyAction: null,
        busyUserId: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private addAccess(detail: MnAccessAddDetail): void {
    const service = this.deployment.roomAccess
    if (!service) return
    const userId = detail.userId.trim()
    if (!userId) return
    void this.mutateAccess(
      'add',
      userId,
      () => service.put(userId, detail),
      `${detail.displayName?.trim() || detail.email?.trim() || userId} can now ${detail.role === 'editor' ? 'practice in' : 'view'} this graph.`,
    )
  }

  private changeAccessRole(detail: MnAccessRoleChangeDetail): void {
    const service = this.deployment.roomAccess
    if (!service) return
    void this.mutateAccess(
      'role',
      detail.userId,
      () => service.put(detail.userId, { role: detail.role }),
      `Member role changed to ${detail.role}.`,
    )
  }

  private removeAccess(detail: MnAccessRemoveDetail): void {
    const service = this.deployment.roomAccess
    if (!service) return
    const grant = this.accessGrants.find((candidate) => candidate.userId === detail.userId)
    const label = grant?.displayName?.trim() || grant?.email?.trim() || detail.userId
    if (!window.confirm(`Remove ${label} from ${this.room.title}?`)) return
    void this.mutateAccess(
      'remove',
      detail.userId,
      () => service.remove(detail.userId),
      `${label} no longer has access to this graph.`,
    )
  }

  private applyAppearance(): void {
    applySkinTheme({ skin: this.activeSkin, theme: this.theme })
    applySkinTheme({ skin: this.activeSkin, theme: this.theme, target: document.body })
  }

  private toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark'
    persistAppearance({ theme: this.theme })
    this.applyAppearance()
  }

  private toggleSkin(): void {
    this.activeSkin = nextVisualIdentitySkin(this.activeSkin)
    persistAppearance({ skin: this.activeSkin })
    this.applyAppearance()
  }

  render() {
    const statusLabel = this.backend === 'online' ? 'Garden online' : this.backend === 'connecting' ? 'Connecting' : 'Garden unavailable'
    const statusState = this.backend === 'online' ? 'success' : this.backend === 'error' ? 'danger' : 'warning'
    const readLabel = this.layoutReadAt ? new Date(this.layoutReadAt).toLocaleTimeString() : 'not read yet'
    const workspaces: readonly MnWorkspaceSummary[] = this.rooms.map((room) => ({
      graphId: room.graphId,
      title: room.title,
      role: room.role,
      cellState: room.cellState,
      capabilities: {},
    }))

    return html`
      <div class="shell">
        <mn-top-bar
          brand="Garden"
          badge="Koch"
          glyph="leaf"
          activeApp="garden"
          .breadcrumbs=${[{ id: 'koch', label: 'Koch method', kind: 'view', current: true }]}
          .workspaces=${workspaces}
          .workspaceStatus=${this.roomsStatus}
          .workspaceError=${this.roomsError}
          .activeWorkspaceId=${GRAPH_ID}
          .access=${this.accessModel}
          .isDark=${this.theme === 'dark'}
          .activeSkin=${this.activeSkin}
          @mn-workspace-refresh=${() => void this.refreshRooms()}
          @mn-workspace-select=${(event: CustomEvent<MnWorkspaceDetail>) => this.navigateToRoom(event.detail.workspace.graphId)}
          @mn-workspace-create=${() => this.openCreateRoom()}
          @mn-access-open=${() => { if (this.accessModel?.status === 'idle') void this.refreshAccess() }}
          @mn-access-refresh=${() => void this.refreshAccess()}
          @mn-access-add=${(event: CustomEvent<MnAccessAddDetail>) => this.addAccess(event.detail)}
          @mn-access-role-change=${(event: CustomEvent<MnAccessRoleChangeDetail>) => this.changeAccessRole(event.detail)}
          @mn-access-remove=${(event: CustomEvent<MnAccessRemoveDetail>) => this.removeAccess(event.detail)}
          @mn-theme-toggle=${() => this.toggleTheme()}
          @mn-skin-toggle=${() => this.toggleSkin()}
          @mn-settings-toggle=${() => { this.notice = 'Koch uses the graph’s normal Garden settings; open the full Garden shell to change account or cell settings.' }}
          @mn-app-change=${() => { this.notice = 'Koch is a custom view of the active Garden graph.' }}
          @mn-navigate-home=${() => { this.notice = 'Use the graph picker to move through your Garden catalog.' }}
        >
          <mn-badge slot="actions" size="sm" .state=${statusState} .glyph=${this.backend === 'online' ? '●' : '○'} .label=${statusLabel}></mn-badge>
          <mn-badge slot="actions" size="sm" state="neutral" .label=${this.actor.displayName}></mn-badge>
          ${this.backend === 'error'
            ? html`<mn-button slot="actions" size="xs" variant="secondary" icon="refresh" @click=${() => void this.boot()}>Reconnect</mn-button>`
            : nothing}
        </mn-top-bar>

        ${this.createRoomRequested
          ? html`
              <div
                class="create-room-backdrop"
                role="presentation"
                @click=${(event: MouseEvent) => {
                  if (event.target === event.currentTarget && !this.roomBusy) this.createRoomRequested = false
                }}
              >
                <mn-card class="create-room-dialog" role="dialog" aria-modal="true" aria-label="Create Garden graph">
                  <div slot="header" class="create-room-dialog-header">
                    <strong class="mn-kind" data-kind="identity">New graph room</strong>
                    <mn-button size="xs" variant="ghost" icon="x" aria-label="Close" .disabled=${this.roomBusy} @click=${() => { this.createRoomRequested = false }}></mn-button>
                  </div>
                  <p class="mn-kind" data-kind="prose">Create an ordinary Garden graph. Its graph ID becomes the room identity; Koch sessions and Shrubbery surface triples will live inside it.</p>
                  <label>
                    <span>Graph title</span>
                    <hoja-editor
                      class="create-room-editor"
                      posture="composer"
                      valueKey="create-koch-graph"
                      .value=${this.createRoomDraft}
                      .disabled=${this.roomBusy}
                      label="New graph room title"
                      placeholder="Evening code practice"
                      @hoja-change=${(event: CustomEvent<HojaComposerDetail>) => { this.createRoomDraft = event.detail.value }}
                      @hoja-submit=${(event: CustomEvent<HojaComposerDetail>) => { this.createRoomDraft = event.detail.value; void this.createRoom() }}
                    ></hoja-editor>
                  </label>
                  <div slot="footer" class="create-room-dialog-actions">
                    <mn-button variant="ghost" .disabled=${this.roomBusy} @click=${() => { this.createRoomRequested = false }}>Cancel</mn-button>
                    <mn-button .loading=${this.roomBusy} .disabled=${!this.createRoomDraft.trim()} @click=${() => void this.createRoom()}>Create graph</mn-button>
                  </div>
                </mn-card>
              </div>
            `
          : nothing}

        <main class="stage">
          <koch-practice-surface .model=${this.surfaceModel()}></koch-practice-surface>
          ${this.backendError
            ? html`<div class="backend-error" role="alert">${this.backendError}</div>`
            : nothing}
          ${this.notice
            ? html`
                <div class="notice" role="status">
                  <span>${this.notice}</span>
                  <mn-button size="xs" variant="ghost" icon="x" aria-label="Dismiss message" @click=${() => { this.notice = '' }}></mn-button>
                </div>
              `
            : nothing}
        </main>

        <footer class="testimony-bar">
          <span>${this.deployment.mode} · graph ${GRAPH_ID} · ${this.room.role} · ${this.activity} · surface ${this.layoutSource} · read ${readLabel} · ${this.source.description.kind}</span>
          <code title=${kochProjectionGraphIri(GRAPH_ID)}>${kochProjectionGraphIri(GRAPH_ID)}</code>
        </footer>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'koch-app': KochApp
    'koch-practice-surface': WorkspaceSurfaceElement<null>
  }
}
