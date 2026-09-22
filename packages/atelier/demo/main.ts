import '../../tokens/css/tokens.css'
import '../../tokens/css/semantic.css'
import '../../tokens/css/component.css'
import '../../tokens/css/skin-garden.css'
import '../../tokens/css/theme-dark.css'
import '../src/mn-vtuber.ts'
import type {
  MnVtuber,
  MnVtuberCameraFrame,
  MnVtuberExpressionPreset,
  MnVtuberGesture,
  MnVtuberPuppetState,
} from '../src/mn-vtuber.ts'
import {
  parseNT,
  parseVtuberControlOverlay,
  selectVtuberControlChannel,
  serializeVtuberControlChannelsToTriples,
  triplesToNT,
  type VtuberControlChannel,
} from '../../nucleus/src/workspace/index.ts'
import './style.css'

const avatar = document.querySelector<MnVtuber>('#avatar')!
const status = document.querySelector<HTMLPreElement>('#status')!
// Point this at any local .vrm you want to puppet. Supply your own model URL
// (an absolute http(s) URL, or a Vite `/@fs/<abs-path>` handle to a file inside
// this demo's configured fs.allow roots — see vite.config.ts). Intentionally
// blank by default so the demo carries no machine-specific path.
const DEFAULT_MODEL_URL = ''
const CHANNEL_ID = 'vtuber-main'
const TARGET_PANEL = 'panel-avatar'
const TARGET_REGION = 'region-center'

const modelUrl = document.querySelector<HTMLInputElement>('#model-url')!
const expression = document.querySelector<HTMLSelectElement>('#expression')!
const cameraFrame = document.querySelector<HTMLSelectElement>('#camera-frame')!
const mouth = document.querySelector<HTMLInputElement>('#mouth')!
const lookX = document.querySelector<HTMLInputElement>('#look-x')!
const lookY = document.querySelector<HTMLInputElement>('#look-y')!
const scale = document.querySelector<HTMLInputElement>('#scale')!
const gesture = document.querySelector<HTMLSelectElement>('#gesture')!
const headYaw = document.querySelector<HTMLInputElement>('#head-yaw')!
const headPitch = document.querySelector<HTMLInputElement>('#head-pitch')!
const headRoll = document.querySelector<HTMLInputElement>('#head-roll')!
const bodyYaw = document.querySelector<HTMLInputElement>('#body-yaw')!
const bodyLean = document.querySelector<HTMLInputElement>('#body-lean')!
const chestPitch = document.querySelector<HTMLInputElement>('#chest-pitch')!
const talk = document.querySelector<HTMLInputElement>('#talk')!
const smile = document.querySelector<HTMLInputElement>('#smile')!
const strain = document.querySelector<HTMLInputElement>('#strain')!
const leftArm = document.querySelector<HTMLInputElement>('#left-arm')!
const rightArm = document.querySelector<HTMLInputElement>('#right-arm')!
const armBend = document.querySelector<HTMLInputElement>('#arm-bend')!
const animated = document.querySelector<HTMLInputElement>('#animated')!
const dark = document.querySelector<HTMLInputElement>('#dark')!
const controlTriples = document.querySelector<HTMLTextAreaElement>('#control-triples')!

modelUrl.value ||= DEFAULT_MODEL_URL

function channelFromControls(): VtuberControlChannel {
  return {
    id: CHANNEL_ID,
    label: 'Shrubbery VTuber demo',
    targetPanel: TARGET_PANEL,
    modelUrl: modelUrl.value.trim(),
    expression: expression.value as MnVtuberExpressionPreset,
    material: 'capture-safe',
    cameraFrame: cameraFrame.value as MnVtuberCameraFrame,
    animated: animated.checked,
    fallback: true,
    mouth: Number(mouth.value),
    blink: 0,
    lookX: Number(lookX.value),
    lookY: Number(lookY.value),
    scale: Number(scale.value),
    appearance: {
      accentTint: '#d6a84f',
      eyeTint: '#5f8fdc',
      hairTint: '#2e3440',
      outfitTint: '#49636f',
      skinWarmth: 0.2,
    },
    poseSource: 'pose:assistant-presenter',
    lipsyncSource: 'audio:assistant-turn',
    gazeSource: 'gaze:pointer',
    clockSource: 'clock:workspace',
    statusSink: 'events:vtuber-status',
  }
}

function writeTriplesFromControls(): void {
  controlTriples.value = triplesToNT(serializeVtuberControlChannelsToTriples([channelFromControls()]))
}

function puppetFromControls(): MnVtuberPuppetState {
  const bend = Number(armBend.value)
  return {
    bodyLean: Number(bodyLean.value),
    bodyYaw: Number(bodyYaw.value),
    breath: 1,
    chest: {
      pitch: Number(chestPitch.value),
      yaw: Number(bodyYaw.value) * 0.12,
    },
    gesture: gesture.value as MnVtuberGesture,
    gestureWeight: gesture.value === 'none' ? 0 : 1,
    head: {
      pitch: Number(headPitch.value),
      yaw: Number(headYaw.value),
      roll: Number(headRoll.value),
    },
    idle: animated.checked ? 1 : 0,
    leftArm: {
      bend,
      raise: Number(leftArm.value),
      spread: Number(leftArm.value) * 0.45,
      wrist: Number(leftArm.value) * -0.35,
    },
    rightArm: {
      bend,
      raise: Number(rightArm.value),
      spread: Number(rightArm.value) * 0.45,
      wrist: Number(rightArm.value) * 0.35,
    },
    smile: Number(smile.value),
    strain: Number(strain.value),
    talk: Number(talk.value),
  }
}

function syncControlsFromChannel(channel: VtuberControlChannel): void {
  modelUrl.value = channel.modelUrl ?? ''
  expression.value = channel.expression ?? 'focused'
  cameraFrame.value = channel.cameraFrame ?? 'bust'
  mouth.value = String(channel.mouth ?? 0)
  lookX.value = String(channel.lookX ?? 0)
  lookY.value = String(channel.lookY ?? 0)
  scale.value = String(channel.scale ?? 1)
  animated.checked = channel.animated ?? true
}

function applyChannel(channel: VtuberControlChannel): void {
  avatar.controlChannel = channel.id
  avatar.modelUrl = channel.modelUrl ?? ''
  avatar.expression = (channel.expression ?? 'focused') as MnVtuberExpressionPreset
  avatar.material = channel.material ?? 'capture-safe'
  avatar.cameraFrame = (channel.cameraFrame ?? 'bust') as MnVtuberCameraFrame
  avatar.animated = channel.animated ?? true
  avatar.fallback = channel.fallback ?? true
  avatar.mouth = channel.mouth ?? 0
  avatar.blink = channel.blink ?? 0
  avatar.lookX = channel.lookX ?? 0
  avatar.lookY = channel.lookY ?? 0
  avatar.scale = channel.scale ?? 1
  avatar.appearance = channel.appearance
}

function applyPuppetControls(): void {
  avatar.puppet = puppetFromControls()
}

function applyTriplesToAvatar(): void {
  try {
    const overlay = parseVtuberControlOverlay(parseNT(controlTriples.value))
    const channel = selectVtuberControlChannel(overlay, {
      panelId: TARGET_PANEL,
      regionId: TARGET_REGION,
    })
    if (!channel) throw new Error(`No VTuber control channel targets ${TARGET_PANEL}`)
    syncControlsFromChannel(channel)
    applyChannel(channel)
    applyPuppetControls()
  } catch (error) {
    status.textContent = JSON.stringify({ status: 'overlay-error', error: String(error) }, null, 2)
  }
}

function syncControls(): void {
  document.documentElement.dataset.theme = dark.checked ? 'dark' : 'light'
  writeTriplesFromControls()
  applyTriplesToAvatar()
  applyPuppetControls()
}

for (const control of [
  modelUrl,
  expression,
  cameraFrame,
  mouth,
  lookX,
  lookY,
  scale,
  gesture,
  headYaw,
  headPitch,
  headRoll,
  bodyYaw,
  bodyLean,
  chestPitch,
  talk,
  smile,
  strain,
  leftArm,
  rightArm,
  armBend,
  animated,
  dark,
]) {
  control.addEventListener('input', syncControls)
}

document.querySelector<HTMLButtonElement>('#write-triples')!.addEventListener('click', () => {
  writeTriplesFromControls()
})

document.querySelector<HTMLButtonElement>('#apply-triples')!.addEventListener('click', () => {
  applyTriplesToAvatar()
})

document.querySelector<HTMLButtonElement>('#clear-model')!.addEventListener('click', () => {
  modelUrl.value = ''
  syncControls()
})

avatar.addEventListener('mn-vtuber-status', (event) => {
  status.textContent = JSON.stringify((event as CustomEvent).detail, null, 2)
})

avatar.addEventListener('mn-vtuber-load', (event) => {
  status.textContent = JSON.stringify((event as CustomEvent).detail, null, 2)
})

avatar.addEventListener('mn-vtuber-error', (event) => {
  status.textContent = JSON.stringify((event as CustomEvent).detail, null, 2)
})

writeTriplesFromControls()
syncControls()
