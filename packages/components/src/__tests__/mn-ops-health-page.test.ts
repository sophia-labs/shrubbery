/**
 * REAL component test - mn-ops-health-page controlled operator surface.
 *
 * The element renders a host-owned health snapshot and emits composed intents for
 * refresh, back navigation, and JSON copy. It never polls or rewrites host state
 * by itself.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../mn-ops-health-page.js'
import type {
  MnOpsHealthCopyJsonDetail,
  MnOpsHealthPage,
  MnOpsHealthSnapshot,
} from '../mn-ops-health-page.js'

async function mount(setup?: (el: MnOpsHealthPage) => void): Promise<MnOpsHealthPage> {
  const el = document.createElement('mn-ops-health-page') as MnOpsHealthPage
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnOpsHealthPage) => el.shadowRoot!
const text = (node: ParentNode) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const snapshot: MnOpsHealthSnapshot = {
  overall_status: 'degraded',
  generated_at: '2026-06-23T12:00:00.000Z',
  alerts: [
    {
      severity: 'warning',
      code: 'queue_depth_high',
      message: 'Core queue is above threshold',
      suggested_action: 'Scale workers or inspect stuck leases.',
    },
  ],
  k8s: { available: true, metrics_available: true },
  sections: {
    services: { collected_at: '2026-06-23T11:59:00.000Z' },
    queue: { collected_at: '2026-06-23T11:58:00.000Z' },
    k8s: { collected_at: '2026-06-23T11:57:00.000Z' },
  },
  queue: {
    mode: 'priority',
    unclaimed_high: 4,
    unclaimed_medium: 8,
    unclaimed_low: 1,
    depth: 13,
    core: {
      unclaimed_queue: 'core',
      unclaimed_high: 2,
      unclaimed_medium: 5,
      unclaimed_low: 0,
      depth: 7,
    },
    embeddings: {
      unclaimed_queue: 'embeddings',
      unclaimed_high: 1,
      unclaimed_medium: 3,
      unclaimed_low: 1,
      depth: 5,
    },
    worker_pressure: {
      available: true,
      reason: 'fresh',
      collected_at: '2026-06-23T11:56:00.000Z',
      summary: {
        workers_total: 3,
        heartbeat_workers_total: 2,
        held_leases_total: 6,
        core_inbox_high_total: 2,
        core_inbox_medium_total: 5,
        core_inbox_low_total: 0,
        core_inbox_depth_total: 7,
        embeddings_inbox_high_total: 1,
        embeddings_inbox_medium_total: 3,
        embeddings_inbox_low_total: 1,
        embeddings_inbox_depth_total: 5,
      },
      workers: [
        {
          worker_id: 'worker-a',
          heartbeat_ttl_seconds: 28,
          held_leases: 2,
          core_inbox_depth: 4,
          embeddings_inbox_depth: 1,
          inbox_depth_total: 5,
        },
      ],
    },
  },
  services: [
    { name: 'gateway', status: 'ok', latency_ms: 12 },
    { name: 'embeddings', status: 'degraded', latency_ms: 140, error: 'slow response' },
  ],
  workloads: [
    {
      name: 'api-abc',
      node: 'node-a',
      workload: 'api',
      ready_containers: 1,
      container_count: 1,
      phase: 'Running',
      restart_count: 0,
      memory_bytes: 134217728,
      memory_limit_bytes: 268435456,
      memory_limit_pct: 50,
      cpu_millicores: 140,
      cpu_limit_millicores: 500,
    },
    {
      name: 'worker-def',
      node: 'node-a',
      workload: 'worker',
      ready_containers: 0,
      container_count: 1,
      phase: 'CrashLoopBackOff',
      restart_count: 3,
      memory_bytes: 67108864,
      memory_limit_bytes: 268435456,
      memory_limit_pct: 25,
      cpu_millicores: 80,
      cpu_limit_millicores: 500,
    },
  ],
  controllers: [
    {
      kind: 'Deployment',
      name: 'api',
      status: 'degraded',
      ready_replicas: 1,
      desired_replicas: 2,
      updated_replicas: 2,
      available_replicas: 1,
    },
  ],
}

describe('mn-ops-health-page - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-ops-health-page')).toBeDefined()
  })

  it('renders loading, empty, and error states from controlled props', async () => {
    const el = await mount((node) => {
      node.status = 'loading'
      node.error = 'ops endpoint timed out'
    })

    expect(text(sr(el))).toContain('Loading ops snapshot...')
    expect(text(sr(el))).toContain('ops endpoint timed out')
    expect((sr(el).querySelector('.actions button:nth-of-type(2)') as HTMLButtonElement).disabled).toBe(true)
    expect((sr(el).querySelector('.actions button:nth-of-type(3)') as HTMLButtonElement).disabled).toBe(true)

    el.status = 'idle'
    el.error = ''
    await el.updateComplete
    expect(text(sr(el))).toContain('No data yet.')
  })

  it('renders a realistic ops snapshot with meta, alerts, queue, services, pods, nodes, and controllers', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.snapshot = snapshot
    })

    expect(text(sr(el).querySelector('.meta')!)).toContain('degraded')
    expect(text(sr(el))).toContain('queue_depth_high: Core queue is above threshold')
    expect(text(sr(el))).toContain('Core Queue')
    expect(text(sr(el))).toContain('Embeddings Queue')
    expect(text(sr(el))).toContain('worker-a')
    expect(text(sr(el))).toContain('gateway')
    expect(text(sr(el))).toContain('slow response')
    expect(text(sr(el))).toContain('api-abc')
    expect(text(sr(el))).toContain('128 MB / 256 MB (50.0%)')
    expect(text(sr(el))).toContain('140m / 500m')
    expect(text(sr(el))).toContain('node-a')
    expect(text(sr(el))).toContain('2')
    expect(text(sr(el))).toContain('Deployment')
    expect(text(sr(el))).toContain('api')
  })

  it('emits composed refresh, back, and copy-json intents without doing host effects', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.snapshot = snapshot
    })
    let refreshes = 0
    let backs = 0
    const copies: MnOpsHealthCopyJsonDetail[] = []
    el.addEventListener('mn-ops-health-refresh', () => {
      refreshes += 1
    })
    el.addEventListener('mn-ops-health-back', () => {
      backs += 1
    })
    el.addEventListener('mn-ops-health-copy-json', (event) => {
      copies.push((event as CustomEvent<MnOpsHealthCopyJsonDetail>).detail)
    })

    const buttons = Array.from(sr(el).querySelectorAll('.actions .btn')) as HTMLButtonElement[]
    buttons[0].click()
    buttons[1].click()
    buttons[2].click()

    expect(backs).toBe(1)
    expect(refreshes).toBe(1)
    expect(copies).toEqual([{ snapshot }])
  })
})
