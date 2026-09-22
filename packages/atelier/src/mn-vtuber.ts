/**
 * mn-vtuber — backend-free VTuber presenter component.
 *
 * The element is intentionally only the lifecycle/event shell. VRM loading,
 * capture-safe material preparation, pose synthesis, and procedural fallback
 * rigging live in sibling modules so each piece can be tested and replaced.
 */
import { LitElement, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import * as THREE from 'three'
import { SkinAware } from '@shrubbery/components'
import { disposeObject } from './mn-vtuber/dispose.js'
import { applyFallbackPose, createFallbackRig } from './mn-vtuber/fallback-rig.js'
import { errorMessage } from './mn-vtuber/math.js'
import { buildMnVtuberPose } from './mn-vtuber/pose.js'
import { vtuberStyles } from './mn-vtuber/styles.js'
import {
  applyVrmPose,
  loadVrmRuntime,
  refreshVrmAppearance,
} from './mn-vtuber/vrm-runtime.js'
import type {
  FallbackRig,
  MnVtuberAppearance,
  MnVtuberCameraFrame,
  MnVtuberExpressionPreset,
  MnVtuberPuppetState,
  MnVtuberMaterialMode,
  MnVtuberPose,
  MnVtuberStatus,
  MnVtuberStatusDetail,
  VrmRuntime,
} from './mn-vtuber/types.js'

export { buildMnVtuberPose } from './mn-vtuber/pose.js'
export { buildMnVtuberPuppetPose } from './mn-vtuber/puppet.js'
export {
  MN_VTUBER_EXPRESSION_NAMES,
  type MnVtuberAppearance,
  type MnVtuberArmPuppet,
  type MnVtuberCameraFrame,
  type MnVtuberExpressionPreset,
  type MnVtuberGesture,
  type MnVtuberMaterialMode,
  type MnVtuberPose,
  type MnVtuberPoseInput,
  type MnVtuberPuppetAngles,
  type MnVtuberPuppetState,
  type MnVtuberRenderStats,
  type MnVtuberRootMotion,
  type MnVtuberRotation,
  type MnVtuberStatus,
  type MnVtuberStatusDetail,
} from './mn-vtuber/types.js'

@customElement('mn-vtuber')
export class MnVtuber extends SkinAware(LitElement) {
  static styles = vtuberStyles

  @property({ type: String, attribute: 'model-url' }) modelUrl = ''
  @property({ type: String, attribute: 'control-channel' }) controlChannel = ''
  @property({ type: String }) label = 'VTuber avatar'
  @property({ type: String }) expression: MnVtuberExpressionPreset = 'focused'
  @property({ type: String }) material: MnVtuberMaterialMode = 'capture-safe'
  @property({ type: String, attribute: 'camera-frame' }) cameraFrame: MnVtuberCameraFrame = 'portrait'
  @property({ type: Boolean, attribute: 'animate' }) animated = true
  @property({ type: Boolean, attribute: 'fallback' }) fallback = true
  @property({ type: Number }) mouth = 0
  @property({ type: Number }) blink = 0
  @property({ type: Number, attribute: 'look-x' }) lookX = 0
  @property({ type: Number, attribute: 'look-y' }) lookY = 0
  @property({ type: Number }) scale = 1
  @property({ attribute: false }) appearance?: MnVtuberAppearance
  @property({ attribute: false }) puppet?: MnVtuberPuppetState
  @property({ attribute: false }) pose?: MnVtuberPose
  @property({ type: String, reflect: true }) status: MnVtuberStatus = 'idle'

  @state() private webglReady = false
  @state() private errorMessage = ''

  private animationFrameId: number | null = null
  private avatarRoot: THREE.Group | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private clock = new THREE.Clock(false)
  private elapsed = 0
  private fallbackRig: FallbackRig | null = null
  private loadVersion = 0
  private lookTarget = new THREE.Object3D()
  private renderer: THREE.WebGLRenderer | null = null
  private resizeObserver: ResizeObserver | null = null
  private scene: THREE.Scene | null = null
  private vrmRuntime: VrmRuntime | null = null

  override firstUpdated(): void {
    this.setupScene()
  }

  override updated(changed: Map<string, unknown>): void {
    if (!this.scene) return

    if (changed.has('modelUrl')) this.startModelLoad()
    if (changed.has('material') && this.vrmRuntime && this.modelUrl) {
      this.startModelLoad()
      return
    }
    if (changed.has('appearance')) this.applyAppearanceToRuntime()
    if (this.poseRelevantChange(changed)) this.requestFrame()
    if (changed.has('animated')) this.requestFrame()
    if (changed.has('controlChannel')) this.emitStatus('mn-vtuber-status')
  }

  override disconnectedCallback(): void {
    this.cleanup()
    super.disconnectedCallback()
  }

  private setupScene(): void {
    const canvas = this.renderRoot.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return

    const { width, height } = this.measure()
    try {
      this.scene = new THREE.Scene()
      this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100)
      this.renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        powerPreference: 'high-performance',
      })
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.06
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
      this.renderer.setSize(width, height, false)
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    } catch (error) {
      this.cleanup()
      this.webglReady = false
      this.setAttribute('data-webgl', 'fallback')
      this.setStatus('fallback', errorMessage(error))
      return
    }

    this.avatarRoot = new THREE.Group()
    this.avatarRoot.name = 'mn-vtuber-root'
    this.lookTarget.name = 'mn-vtuber-look-target'
    this.avatarRoot.add(this.lookTarget)
    this.scene.add(this.avatarRoot)
    this.addLights()
    this.installStudioFloor()

    this.fallbackRig = createFallbackRig()
    this.avatarRoot.add(this.fallbackRig.group)
    this.syncFallbackVisibility()
    this.syncCamera()
    this.observeResize()

    this.webglReady = true
    this.setAttribute('data-webgl', 'ready')
    this.clock.start()
    this.startModelLoad()
    this.requestFrame()
  }

  private addLights(): void {
    if (!this.scene) return
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x74869a, 1.2))
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28))

    const key = new THREE.DirectionalLight(0xfff7ea, 2.25)
    key.position.set(-2.2, 4.2, 3.4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 0.1
    key.shadow.camera.far = 8
    key.shadow.camera.left = -2.2
    key.shadow.camera.right = 2.2
    key.shadow.camera.top = 3.2
    key.shadow.camera.bottom = -0.8
    key.shadow.bias = -0.00018
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xb9d3ff, 0.62)
    fill.position.set(2.8, 2.2, 2.2)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(0x9fc5ff, 1.08)
    rim.position.set(0.8, 2.6, -2.8)
    this.scene.add(rim)
  }

  private installStudioFloor(): void {
    if (!this.scene) return

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.ShadowMaterial({ color: 0x1f2937, opacity: 0.18 }),
    )
    floor.name = 'mn-vtuber-floor'
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -0.01, -0.08)
    floor.receiveShadow = true
    this.scene.add(floor)

    const grid = new THREE.GridHelper(5, 12, 0x9fb2c3, 0xc8d4de)
    grid.name = 'mn-vtuber-floor-grid'
    grid.position.y = 0.002
    const gridMaterial = grid.material as THREE.Material | THREE.Material[]
    for (const material of Array.isArray(gridMaterial) ? gridMaterial : [gridMaterial]) {
      material.transparent = true
      material.opacity = 0.18
      material.depthWrite = false
    }
    this.scene.add(grid)
  }

  private observeResize(): void {
    if (!('ResizeObserver' in globalThis)) return
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeRenderer()
      this.requestFrame()
    })
    this.resizeObserver.observe(this)
  }

  private startModelLoad(): void {
    if (!this.scene || !this.avatarRoot) return

    const version = ++this.loadVersion
    this.clearVrmRuntime()
    this.syncFallbackVisibility()

    if (!this.modelUrl.trim()) {
      this.setStatus('fallback')
      return
    }

    void this.loadVrm(this.modelUrl.trim(), version)
  }

  private async loadVrm(modelUrl: string, version: number): Promise<void> {
    this.setStatus('loading')
    this.syncFallbackVisibility()

    try {
      const runtime = await loadVrmRuntime({
        appearance: this.appearance,
        lookTarget: this.lookTarget,
        materialMode: this.material,
        modelUrl,
      })
      if (version !== this.loadVersion) {
        disposeObject(runtime.scene)
        return
      }

      this.clearVrmRuntime()
      this.vrmRuntime = runtime
      this.avatarRoot?.add(runtime.scene)
      this.syncFallbackVisibility()
      this.applyCurrentPose(0)
      this.setStatus('ready')
      this.emitStatus('mn-vtuber-load')
      this.requestFrame()
    } catch (error) {
      if (version !== this.loadVersion) return
      this.clearVrmRuntime()
      this.setStatus('error', errorMessage(error))
      this.syncFallbackVisibility()
      this.emitStatus('mn-vtuber-error')
      this.requestFrame()
    }
  }

  private applyAppearanceToRuntime(): void {
    if (!this.vrmRuntime) return
    refreshVrmAppearance(this.vrmRuntime, this.material, this.appearance)
    this.requestFrame()
  }

  private syncFallbackVisibility(): void {
    if (!this.fallbackRig) return
    this.fallbackRig.group.visible = !this.vrmRuntime && this.fallback
  }

  private requestFrame(): void {
    if (!this.renderer || !this.scene || !this.camera) return
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)
    this.animationFrameId = requestAnimationFrame(this.renderFrame)
  }

  private renderFrame = (): void => {
    this.animationFrameId = null
    if (!this.renderer || !this.scene || !this.camera) return

    const delta = Math.min(this.clock.getDelta(), 0.05)
    if (this.animated) this.elapsed += delta
    this.syncCamera()
    this.applyCurrentPose(delta)
    this.renderer.render(this.scene, this.camera)

    if (this.animated) {
      this.animationFrameId = requestAnimationFrame(this.renderFrame)
    }
  }

  private applyCurrentPose(delta: number): void {
    if (!this.avatarRoot) return
    const pose = buildMnVtuberPose({
      blink: this.blink,
      elapsed: this.elapsed,
      expressionPreset: this.expression,
      lookX: this.lookX,
      lookY: this.lookY,
      mouth: this.mouth,
      overlay: this.pose,
      puppet: this.puppet,
    })

    this.avatarRoot.scale.setScalar(Math.max(0.1, this.scale))
    this.avatarRoot.position.set(pose.root.x ?? 0, pose.root.y ?? 0, pose.root.z ?? 0)
    this.avatarRoot.rotation.y = Math.sin(this.elapsed * 0.36) * 0.028 + this.lookX * 0.022 + (pose.root.bodyYaw ?? 0)

    if (this.vrmRuntime) {
      applyVrmPose(this.vrmRuntime, pose, this.lookTarget)
      this.vrmRuntime.vrm.update(delta)
      this.vrmRuntime.scene.updateMatrixWorld(true)
      return
    }

    if (this.fallbackRig) applyFallbackPose(this.fallbackRig, pose, this.elapsed)
  }

  private resizeRenderer(): void {
    if (!this.renderer || !this.camera) return
    const { width, height } = this.measure()
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
  }

  private syncCamera(): void {
    if (!this.camera) return

    const height = this.vrmRuntime?.height ?? 1.62
    const frame = this.cameraFrame === 'full'
      ? { fov: 35, target: 0.54, y: 0.7, z: 3.38 }
      : this.cameraFrame === 'bust'
        ? { fov: 29, target: 0.7, y: 0.82, z: 2.04 }
        : { fov: 25, target: 0.78, y: 0.91, z: 1.48 }
    const targetY = height * frame.target
    const y = height * frame.y
    this.camera.fov = frame.fov
    this.camera.position.set(0, y, frame.z)
    this.camera.lookAt(0, targetY, 0)
    this.camera.updateProjectionMatrix()
  }

  private poseRelevantChange(changed: Map<string, unknown>): boolean {
    return [
      'cameraFrame',
      'mouth',
      'blink',
      'lookX',
      'lookY',
      'pose',
      'puppet',
      'expression',
      'scale',
    ].some((key) => changed.has(key))
  }

  private measure(): { width: number; height: number } {
    const rect = this.getBoundingClientRect()
    return {
      height: Math.max(1, rect.height || 420),
      width: Math.max(1, rect.width || 320),
    }
  }

  private setStatus(status: MnVtuberStatus, error = ''): void {
    const changed = this.status !== status || this.errorMessage !== error
    this.status = status
    this.errorMessage = error
    if (changed) this.emitStatus('mn-vtuber-status')
  }

  private emitStatus(type: 'mn-vtuber-status' | 'mn-vtuber-load' | 'mn-vtuber-error'): void {
    this.dispatchEvent(new CustomEvent<MnVtuberStatusDetail>(type, {
      bubbles: true,
      composed: true,
      detail: this.statusDetail(),
    }))
  }

  private statusDetail(): MnVtuberStatusDetail {
    return {
      controlChannel: this.controlChannel || undefined,
      error: this.errorMessage || undefined,
      modelUrl: this.modelUrl,
      stats: this.vrmRuntime?.stats,
      status: this.status,
    }
  }

  private clearVrmRuntime(): void {
    if (!this.vrmRuntime) return
    this.vrmRuntime.scene.parent?.remove(this.vrmRuntime.scene)
    disposeObject(this.vrmRuntime.scene)
    this.vrmRuntime = null
  }

  private cleanup(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)
    this.animationFrameId = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.clearVrmRuntime()
    if (this.scene) disposeObject(this.scene)
    this.scene = null
    this.camera = null
    this.avatarRoot = null
    this.fallbackRig = null
    this.renderer?.dispose()
    this.renderer = null
    this.clock.stop()
  }

  override render() {
    const statusText = this.errorMessage ? `${this.status}: ${this.errorMessage}` : this.status
    return html`
      <div class="stage">
        <canvas role="img" aria-label=${this.label} tabindex="-1"></canvas>
        ${this.webglReady ? nothing : html`
          <div class="css-fallback" aria-hidden="true">
            <div class="css-avatar"></div>
          </div>
        `}
        <span class="status" aria-live="polite">${statusText}</span>
      </div>
    `
  }
}
