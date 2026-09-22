/**
 * Sophia hero canvas - subtle Three.js background lifted from Garden.
 *
 * Pure visual component. WebGL setup is guarded so tests and unsupported
 * environments still render a stable canvas/fallback layer instead of throwing.
 */
import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import * as THREE from 'three'

const COLORS = {
  indigo200: 0xc7d2fe,
  indigo300: 0xa5b4fc,
  indigo400: 0x818cf8,
  cream: 0xf8f9fc,
  mist: 0xe8eaf0,
}

@customElement('sophia-hero-canvas')
export class SophiaHeroCanvas extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      background:
        radial-gradient(circle at 30% 25%, rgba(199, 210, 254, 0.26), transparent 28%),
        radial-gradient(circle at 75% 65%, rgba(129, 140, 248, 0.14), transparent 30%),
        #f8f9fc;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .fallback {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 22% 40%, rgba(165, 180, 252, 0.22), transparent 20%),
        radial-gradient(circle at 60% 35%, rgba(224, 231, 255, 0.35), transparent 28%),
        linear-gradient(135deg, rgba(248, 249, 252, 0.9), rgba(232, 234, 240, 0.5));
    }
  `

  @property({ type: Number })
  nodeCount = 12

  @property({ type: Boolean })
  autoRotate = true

  @property({ type: Boolean, attribute: 'animate' })
  animated = true

  @state() private webglReady = false

  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private animationFrameId: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private clock = new THREE.Clock()
  private nodeGroup: THREE.Group | null = null
  private nodes: Array<{
    mesh: THREE.Mesh
    baseY: number
    phase: number
    amplitude: number
    speed: number
    rotationSpeed: THREE.Vector3
  }> = []

  firstUpdated(): void {
    this.setupScene()
  }

  disconnectedCallback(): void {
    this.cleanup()
    super.disconnectedCallback()
  }

  private setupScene(): void {
    const canvas = this.renderRoot.querySelector('canvas')
    if (!canvas) return

    const rect = this.getBoundingClientRect()
    const width = Math.max(1, rect.width || 1200)
    const height = Math.max(1, rect.height || 720)

    try {
      this.scene = new THREE.Scene()
      this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000)
      this.camera.position.set(0, 0, 25)
      this.camera.lookAt(0, 0, 0)

      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      })
      this.renderer.setSize(width, height, false)
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
      this.renderer.setClearColor(0x000000, 0)
    } catch {
      this.cleanup()
      this.webglReady = false
      return
    }

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0))
    this.nodeGroup = new THREE.Group()
    this.scene.add(this.nodeGroup)
    this.createNodes()
    this.createParticles()

    if ('ResizeObserver' in globalThis) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: nextWidth, height: nextHeight } = entry.contentRect
          if (nextWidth > 0 && nextHeight > 0 && this.camera && this.renderer) {
            this.camera.aspect = nextWidth / nextHeight
            this.camera.updateProjectionMatrix()
            this.renderer.setSize(nextWidth, nextHeight, false)
            this.requestFrame()
          }
        }
      })
      this.resizeObserver.observe(this)
    }

    this.webglReady = true
    this.clock.start()
    this.requestFrame()
  }

  private requestFrame(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)
    this.animationFrameId = requestAnimationFrame(this.runAnimation)
  }

  private createNodes(): void {
    if (!this.nodeGroup) return
    const shapes = ['sphere', 'ring', 'torus', 'octahedron']
    const colors = [COLORS.indigo200, COLORS.indigo300, COLORS.indigo400, COLORS.mist, COLORS.cream]

    for (let i = 0; i < this.nodeCount; i++) {
      const shape = shapes[Math.floor(Math.random() * shapes.length)]
      const color = colors[Math.floor(Math.random() * colors.length)]
      const mesh = this.createShape(shape, color)
      const radius = 5 + Math.random() * 12
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      mesh.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta) * 0.5,
        radius * Math.cos(phi) * 0.3,
      )
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      this.nodeGroup.add(mesh)
      this.nodes.push({
        mesh,
        baseY: mesh.position.y,
        phase: Math.random() * Math.PI * 2,
        amplitude: 0.05 + Math.random() * 0.08,
        speed: 0.15 + Math.random() * 0.15,
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.001,
          (Math.random() - 0.5) * 0.0015,
          (Math.random() - 0.5) * 0.001,
        ),
      })
    }
  }

  private createShape(type: string, color: number): THREE.Mesh {
    const size = 0.2 + Math.random() * 0.25
    let geometry: THREE.BufferGeometry
    switch (type) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(size, 16, 16)
        break
      case 'ring':
        geometry = new THREE.TorusGeometry(size * 0.8, size * 0.15, 8, 24)
        break
      case 'torus':
        geometry = new THREE.TorusGeometry(size * 0.5, size * 0.25, 8, 16)
        break
      case 'octahedron':
        geometry = new THREE.OctahedronGeometry(size * 0.6, 0)
        break
      default:
        geometry = new THREE.SphereGeometry(size * 0.5, 12, 12)
    }

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
    })
    return new THREE.Mesh(geometry, material)
  }

  private createParticles(): void {
    if (!this.scene) return
    const particleCount = 60
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3
      const radius = 8 + Math.random() * 18
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      positions[i3 + 2] = radius * Math.cos(phi)

      const brightness = 0.65 + Math.random() * 0.2
      colors[i3] = brightness * 0.75
      colors[i3 + 1] = brightness * 0.78
      colors[i3 + 2] = brightness
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
      sizeAttenuation: true,
    })))
  }

  private runAnimation = (): void => {
    this.animationFrameId = null
    if (!this.renderer || !this.scene || !this.camera) return
    const elapsed = this.clock.getElapsedTime()

    for (const node of this.nodes) {
      node.mesh.position.y = node.baseY + Math.sin(elapsed * node.speed + node.phase) * node.amplitude
      node.mesh.rotation.x += node.rotationSpeed.x
      node.mesh.rotation.y += node.rotationSpeed.y
      node.mesh.rotation.z += node.rotationSpeed.z
    }

    if (this.autoRotate && this.nodeGroup) {
      this.nodeGroup.rotation.y = elapsed * 0.02
    }

    this.renderer.render(this.scene, this.camera)
    if (this.animated) {
      this.animationFrameId = requestAnimationFrame(this.runAnimation)
    }
  }

  private cleanup(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    if (this.scene) {
      this.scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose())
          else object.material.dispose()
        }
      })
    }

    this.renderer?.dispose()
    this.renderer = null
    this.scene = null
    this.camera = null
    this.nodeGroup = null
    this.nodes = []
  }

  render() {
    return html`
      <canvas aria-hidden="true"></canvas>
      ${this.webglReady ? null : html`<div class="fallback" aria-hidden="true"></div>`}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sophia-hero-canvas': SophiaHeroCanvas
  }
}
