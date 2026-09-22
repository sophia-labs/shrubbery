/**
 * mn-ops-health-page - controlled Garden ops triage surface.
 *
 * Garden's version owned polling, copy, URL, and app-session side effects. This
 * Shrubbery lift keeps the operator UI and snapshot formatting, while callers
 * own every effect.
 */
import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnOpsHealthStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MnOpsHealthAlert {
  readonly code?: string | null
  readonly message?: string | null
  readonly severity?: string | null
  readonly suggested_action?: string | null
}

export interface MnOpsHealthQueueBucket {
  readonly unclaimed_queue?: string | number | null
  readonly unclaimed_high?: string | number | null
  readonly unclaimed_medium?: string | number | null
  readonly unclaimed_low?: string | number | null
  readonly depth?: string | number | null
}

export interface MnOpsHealthWorkerPressure {
  readonly available?: boolean | null
  readonly reason?: string | null
  readonly collected_at?: string | null
  readonly summary?: Record<string, unknown> | null
  readonly workers?: readonly Record<string, unknown>[] | null
}

export interface MnOpsHealthQueue {
  readonly mode?: string | null
  readonly unclaimed_high?: string | number | null
  readonly unclaimed_medium?: string | number | null
  readonly unclaimed_low?: string | number | null
  readonly depth?: string | number | null
  readonly core?: MnOpsHealthQueueBucket | null
  readonly embeddings?: MnOpsHealthQueueBucket | null
  readonly worker_pressure?: MnOpsHealthWorkerPressure | null
}

export interface MnOpsHealthService {
  readonly name?: string | null
  readonly status?: string | null
  readonly latency_ms?: string | number | null
  readonly error?: string | null
}

export interface MnOpsHealthWorkload {
  readonly name?: string | null
  readonly node?: string | null
  readonly workload?: string | null
  readonly ready_containers?: string | number | null
  readonly container_count?: string | number | null
  readonly phase?: string | null
  readonly restart_count?: string | number | null
  readonly rolled_out_at?: string | null
  readonly last_restart_at?: string | null
  readonly memory_bytes?: string | number | null
  readonly memory_limit_bytes?: string | number | null
  readonly memory_limit_pct?: string | number | null
  readonly cpu_millicores?: string | number | null
  readonly cpu_limit_millicores?: string | number | null
}

export interface MnOpsHealthController {
  readonly kind?: string | null
  readonly name?: string | null
  readonly status?: string | null
  readonly ready_replicas?: string | number | null
  readonly desired_replicas?: string | number | null
  readonly updated_replicas?: string | number | null
  readonly available_replicas?: string | number | null
}

export interface MnOpsHealthSnapshot {
  readonly overall_status?: string | null
  readonly generated_at?: string | null
  readonly alerts?: readonly MnOpsHealthAlert[] | null
  readonly queue?: MnOpsHealthQueue | null
  readonly services?: readonly MnOpsHealthService[] | null
  readonly workloads?: readonly MnOpsHealthWorkload[] | null
  readonly controllers?: readonly MnOpsHealthController[] | null
  readonly k8s?: Record<string, unknown> | null
  readonly sections?: Record<string, { readonly collected_at?: string | null } | null> | null
}

export interface MnOpsHealthCopyJsonDetail {
  readonly snapshot: MnOpsHealthSnapshot
}

interface NodeRow {
  readonly name: string
  readonly pods: number
  readonly ready: number
  readonly restarts: number
}

@customElement('mn-ops-health-page')
export class MnOpsHealthPage extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      height: 100%;
      overflow: auto;
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font-family: var(--mn-font-serif);
    }

    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: var(--mn-space-5);
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4);
      box-sizing: border-box;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--mn-space-3);
      flex-wrap: wrap;
    }

    .title {
      margin: 0;
      font-size: var(--mn-text-xl);
      color: var(--mn-color-text-accent-strong);
    }

    .subtitle {
      margin: var(--mn-space-1) 0 0;
      color: var(--mn-color-text-secondary);
      font-size: var(--mn-text-sm);
    }

    .actions {
      display: inline-flex;
      gap: var(--mn-space-2);
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2);
      padding: 0.45rem 0.7rem;
      border-radius: var(--mn-radius-md);
      border: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-secondary);
      cursor: pointer;
      font-family: var(--mn-font-serif);
      font-size: var(--mn-text-sm);
    }

    .btn:hover:not(:disabled) {
      background: var(--mn-color-surface-hover);
      color: var(--mn-color-text-primary);
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mn-space-3);
    }

    .meta-card,
    .card {
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-md);
      background: var(--mn-color-surface-base);
    }

    .meta-card {
      padding: var(--mn-space-3);
    }

    .meta-label {
      font-size: var(--mn-text-xs);
      color: var(--mn-color-text-tertiary);
      margin-bottom: var(--mn-space-1);
    }

    .meta-value {
      font-size: var(--mn-text-md);
      color: var(--mn-color-text-primary);
      font-weight: 600;
    }

    .status {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 10px;
      font-size: var(--mn-text-xs);
      font-weight: 600;
      text-transform: uppercase;
      border: 1px solid var(--mn-color-border-default);
    }

    .status.ok,
    .status.running {
      color: var(--mn-color-text-success);
      border-color: var(--mn-color-success-border);
      background: var(--mn-color-success-surface);
    }

    .status.warning,
    .status.degraded {
      color: var(--mn-color-text-warning);
      border-color: var(--mn-color-warning-border);
      background: var(--mn-color-warning-surface);
    }

    .status.critical,
    .status.down,
    .status.error {
      color: var(--mn-color-text-danger);
      border-color: var(--mn-color-danger-border);
      background: var(--mn-color-danger-surface);
    }

    .card {
      padding: var(--mn-space-4);
    }

    .card h3 {
      margin: 0 0 var(--mn-space-2);
      font-size: var(--mn-text-md);
      color: var(--mn-color-text-accent-strong);
    }

    .error {
      border: 1px solid var(--mn-color-danger-border);
      background: var(--mn-color-danger-surface);
      color: var(--mn-color-text-danger);
      border-radius: var(--mn-radius-md);
      padding: var(--mn-space-3);
      font-size: var(--mn-text-sm);
    }

    .alert-list {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2);
    }

    .alert {
      border-radius: var(--mn-radius-md);
      border: 1px solid var(--mn-color-border-subtle);
      padding: var(--mn-space-3);
      font-size: var(--mn-text-sm);
    }

    .alert.warning {
      border-color: var(--mn-color-warning-border);
      background: var(--mn-color-warning-surface);
    }

    .alert.critical {
      border-color: var(--mn-color-danger-border);
      background: var(--mn-color-danger-surface);
    }

    .alert-title {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2);
      margin-bottom: var(--mn-space-1);
      font-weight: 600;
    }

    .queue {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mn-space-2);
      font-size: var(--mn-text-sm);
    }

    .queue > div {
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-sm);
      padding: var(--mn-space-2);
      display: flex;
      justify-content: space-between;
      gap: var(--mn-space-2);
    }

    .queue-section {
      margin-top: var(--mn-space-3);
    }

    .queue-section h4 {
      margin: 0 0 var(--mn-space-2);
      font-size: var(--mn-text-sm);
      color: var(--mn-color-text-secondary);
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mn-text-sm);
      min-width: 860px;
    }

    th,
    td {
      text-align: left;
      padding: var(--mn-space-2) var(--mn-space-3);
      border-bottom: 1px solid var(--mn-color-border-subtle);
      vertical-align: top;
    }

    th {
      font-size: var(--mn-text-xs);
      color: var(--mn-color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      position: sticky;
      top: 0;
      background: var(--mn-color-surface-base);
      z-index: 1;
    }

    .subtle {
      color: var(--mn-color-text-tertiary);
      font-size: var(--mn-text-xs);
    }

    @media (max-width: 900px) {
      .meta,
      .queue {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `

  @property({ type: String })
  status: MnOpsHealthStatus = 'idle'

  @property({ attribute: false })
  snapshot: MnOpsHealthSnapshot | null = null

  @property({ type: String })
  error = ''

  @property({ type: String })
  title = 'Ops Health'

  @property({ type: String })
  subtitle = 'Internal runtime triage surface (operators only).'

  @property({ type: Boolean, attribute: 'hide-back' })
  hideBack = false

  @property({ type: Boolean, attribute: 'hide-copy' })
  hideCopy = false

  private emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private formatTs(iso: string | null | undefined): string {
    if (!iso) return '-'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString()
  }

  private formatRelative(iso: string | null | undefined): string {
    if (!iso) return '-'
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return '-'
    const diffSeconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (diffSeconds < 60) return `${diffSeconds}s ago`
    const mins = Math.floor(diffSeconds / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  private asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  private formatBytes(raw: unknown): string {
    const value = this.asNumber(raw)
    if (value == null) return '-'
    if (value < 1024) return `${value} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let scaled = value / 1024
    let unit = units[0]
    for (let i = 1; i < units.length && scaled >= 1024; i++) {
      scaled /= 1024
      unit = units[i]
    }
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${unit}`
  }

  private formatMemoryPair(usedRaw: unknown, limitRaw: unknown, pctRaw: unknown): string {
    const used = this.asNumber(usedRaw)
    const limit = this.asNumber(limitRaw)
    const pct = this.asNumber(pctRaw)
    if (used == null && limit == null) return '-'
    const pctLabel = pct != null ? ` (${pct.toFixed(1)}%)` : ''
    return `${this.formatBytes(used)} / ${this.formatBytes(limit)}${pctLabel}`
  }

  private formatCpuPair(usedRaw: unknown, limitRaw: unknown): string {
    const used = this.asNumber(usedRaw)
    const limit = this.asNumber(limitRaw)
    if (used == null && limit == null) return '-'
    return `${used != null ? `${Math.round(used)}m` : '-'} / ${limit != null ? `${Math.round(limit)}m` : '-'}`
  }

  private statusClass(value: unknown): string {
    const raw = String(value ?? 'unknown').toLowerCase()
    return raw.replace(/[^a-z0-9_-]+/g, '-')
  }

  private workerSummaryValue(summary: Record<string, unknown>, key: string): unknown {
    return summary[key] ?? 0
  }

  private nodeRows(workloads: readonly MnOpsHealthWorkload[]): NodeRow[] {
    const nodeMap = new Map<string, { pods: number; ready: number; restarts: number }>()
    for (const pod of workloads) {
      const node = String(pod.node ?? 'unscheduled')
      const ready = this.asNumber(pod.ready_containers) ?? 0
      const total = this.asNumber(pod.container_count) ?? 0
      const restarts = this.asNumber(pod.restart_count) ?? 0
      const existing = nodeMap.get(node) ?? { pods: 0, ready: 0, restarts: 0 }
      existing.pods += 1
      if (total > 0 && ready >= total) existing.ready += 1
      existing.restarts += restarts
      nodeMap.set(node, existing)
    }
    return Array.from(nodeMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private renderStatus(status: unknown): TemplateResult {
    const label = String(status ?? 'unknown')
    return html`
      <span
        class="status ${this.statusClass(label)}"
        data-testid="ops-health-status"
        role="status"
        aria-live="polite"
      >${label}</span>
    `
  }

  private renderQueueBucket(title: string, bucket: MnOpsHealthQueueBucket | null | undefined): TemplateResult | typeof nothing {
    if (!bucket) return nothing
    return html`
      <div class="queue-section">
        <h4>${title}</h4>
        <div class="queue">
          <div><span>Base</span><strong>${bucket.unclaimed_queue ?? '-'}</strong></div>
          <div><span>High</span><strong>${bucket.unclaimed_high ?? 0}</strong></div>
          <div><span>Medium</span><strong>${bucket.unclaimed_medium ?? 0}</strong></div>
          <div><span>Low</span><strong>${bucket.unclaimed_low ?? 0}</strong></div>
          <div><span>Depth</span><strong>${bucket.depth ?? 0}</strong></div>
        </div>
      </div>
    `
  }

  private renderAlerts(alerts: readonly MnOpsHealthAlert[]): TemplateResult {
    return html`
      <div class="card">
        <h3>Alerts</h3>
        ${alerts.length === 0 ? html`<div class="subtle">No active alerts.</div>` : html`
          <div class="alert-list">
            ${alerts.map((alert) => {
              const severity = this.statusClass(alert.severity ?? 'warning')
              return html`
                <div class="alert ${severity}">
                  <div class="alert-title">
                    ${icon(severity === 'critical' ? 'alert-circle' : 'alert-triangle', { size: 14 })}
                    <span>${alert.code ?? 'alert'}: ${alert.message ?? '-'}</span>
                  </div>
                  ${alert.suggested_action ? html`<div>${alert.suggested_action}</div>` : nothing}
                </div>
              `
            })}
          </div>
        `}
      </div>
    `
  }

  private renderQueue(queue: MnOpsHealthQueue | null | undefined): TemplateResult {
    return html`
      <div class="card">
        <h3>Queue</h3>
        ${queue ? html`
          <div class="queue-block">
            <div class="queue">
              <div><span>Mode</span><strong>${queue.mode ?? 'unknown'}</strong></div>
              <div><span>Total High</span><strong>${queue.unclaimed_high ?? 0}</strong></div>
              <div><span>Total Medium</span><strong>${queue.unclaimed_medium ?? 0}</strong></div>
              <div><span>Total Low</span><strong>${queue.unclaimed_low ?? 0}</strong></div>
              <div><span>Legacy</span><strong>${queue.depth ?? 0}</strong></div>
            </div>
            <div class="queue-buckets">
              ${this.renderQueueBucket('Core Queue', queue.core)}
              ${this.renderQueueBucket('Embeddings Queue', queue.embeddings)}
            </div>
          </div>
        ` : html`<div class="subtle">Queue unavailable.</div>`}
      </div>
    `
  }

  private renderWorkerPressure(queue: MnOpsHealthQueue | null | undefined): TemplateResult {
    const workerPressure = queue?.worker_pressure ?? null
    const summary = workerPressure?.summary ?? {}
    const rows = [...(workerPressure?.workers ?? [])].slice(0, 24)
    const available = Boolean(workerPressure?.available ?? false)

    return html`
      <div class="card">
        <h3>Worker Pressure</h3>
        ${workerPressure ? html`
          <div class="worker-pressure">
            <div class="queue">
              <div><span>Workers</span><strong>${this.workerSummaryValue(summary, 'workers_total')}</strong></div>
              <div><span>Heartbeat Workers</span><strong>${this.workerSummaryValue(summary, 'heartbeat_workers_total')}</strong></div>
              <div><span>Held Leases</span><strong>${this.workerSummaryValue(summary, 'held_leases_total')}</strong></div>
              <div><span>Core High</span><strong>${this.workerSummaryValue(summary, 'core_inbox_high_total')}</strong></div>
              <div><span>Core Medium</span><strong>${this.workerSummaryValue(summary, 'core_inbox_medium_total')}</strong></div>
              <div><span>Core Low</span><strong>${this.workerSummaryValue(summary, 'core_inbox_low_total')}</strong></div>
              <div><span>Core Inbox</span><strong>${this.workerSummaryValue(summary, 'core_inbox_depth_total')}</strong></div>
            </div>
            <div class="queue" style="margin-top: var(--mn-space-2);">
              <div><span>Emb High</span><strong>${this.workerSummaryValue(summary, 'embeddings_inbox_high_total')}</strong></div>
              <div><span>Emb Medium</span><strong>${this.workerSummaryValue(summary, 'embeddings_inbox_medium_total')}</strong></div>
              <div><span>Emb Low</span><strong>${this.workerSummaryValue(summary, 'embeddings_inbox_low_total')}</strong></div>
              <div><span>Embeddings Inbox</span><strong>${this.workerSummaryValue(summary, 'embeddings_inbox_depth_total')}</strong></div>
              <div><span>Collected</span><strong>${this.formatTs(workerPressure.collected_at ?? null)}</strong></div>
              <div><span>Status</span><strong>${available ? 'available' : 'unavailable'}</strong></div>
              <div><span>Reason</span><strong>${workerPressure.reason ?? '-'}</strong></div>
            </div>
            ${rows.length > 0 ? html`
              <div class="table-wrap" style="margin-top: var(--mn-space-2);">
                <table>
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>HB TTL</th>
                      <th>Leases</th>
                      <th>Core Inbox</th>
                      <th>Emb Inbox</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map((row) => html`
                      <tr>
                        <td>${row.worker_id ?? '-'}</td>
                        <td>${row.heartbeat_ttl_seconds ?? '-'}</td>
                        <td>${row.held_leases ?? 0}</td>
                        <td>${row.core_inbox_depth ?? 0}</td>
                        <td>${row.embeddings_inbox_depth ?? 0}</td>
                        <td>${row.inbox_depth_total ?? 0}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            ` : nothing}
          </div>
        ` : html`<div class="subtle">Worker pressure unavailable.</div>`}
      </div>
    `
  }

  private renderServices(services: readonly MnOpsHealthService[]): TemplateResult {
    return html`
      <div class="card">
        <h3>Services</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              ${services.map((svc) => html`
                <tr>
                  <td>${svc.name ?? '-'}</td>
                  <td>${this.renderStatus(svc.status ?? 'unknown')}</td>
                  <td>${svc.latency_ms ?? 0}ms</td>
                  <td>${svc.error ?? '-'}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  private renderPods(workloads: readonly MnOpsHealthWorkload[], metricsAvailable: boolean): TemplateResult {
    return html`
      <div class="card">
        <h3>Pods</h3>
        ${!metricsAvailable ? html`
          <div class="subtle" style="margin-bottom: var(--mn-space-2);">
            CPU/memory usage metrics are unavailable in this cluster right now (limits are still shown).
          </div>
        ` : nothing}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pod</th>
                <th>Workload</th>
                <th>Ready</th>
                <th>Phase</th>
                <th>Restarts</th>
                <th>Rolled Out</th>
                <th>Last Restart</th>
                <th>Memory (used / limit)</th>
                <th>CPU (used / limit)</th>
              </tr>
            </thead>
            <tbody>
              ${workloads.map((pod) => html`
                <tr>
                  <td>
                    <div>${pod.name ?? '-'}</div>
                    <div class="subtle">${pod.node ?? '-'}</div>
                  </td>
                  <td>${pod.workload ?? '-'}</td>
                  <td>${pod.ready_containers ?? 0}/${pod.container_count ?? 0}</td>
                  <td>${this.renderStatus(pod.phase === 'Running' ? 'ok' : (pod.phase ?? 'degraded'))}</td>
                  <td>${pod.restart_count ?? 0}</td>
                  <td>${pod.rolled_out_at ? this.formatRelative(pod.rolled_out_at) : '-'}</td>
                  <td>${pod.last_restart_at ? this.formatRelative(pod.last_restart_at) : '-'}</td>
                  <td>${this.formatMemoryPair(pod.memory_bytes, pod.memory_limit_bytes, pod.memory_limit_pct)}</td>
                  <td>${this.formatCpuPair(pod.cpu_millicores, pod.cpu_limit_millicores)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  private renderNodes(rows: readonly NodeRow[]): TemplateResult {
    return html`
      <div class="card">
        <h3>Nodes</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>Pods</th>
                <th>Ready Pods</th>
                <th>Total Restarts</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((node) => html`
                <tr>
                  <td>${node.name}</td>
                  <td>${node.pods}</td>
                  <td>${node.ready}/${node.pods}</td>
                  <td>${node.restarts}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  private renderControllers(controllers: readonly MnOpsHealthController[]): TemplateResult {
    return html`
      <div class="card">
        <h3>Controllers</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Status</th>
                <th>Ready</th>
                <th>Desired</th>
                <th>Updated</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              ${controllers.map((ctl) => html`
                <tr>
                  <td>${ctl.kind ?? '-'}</td>
                  <td>${ctl.name ?? '-'}</td>
                  <td>${this.renderStatus(ctl.status ?? 'unknown')}</td>
                  <td>${ctl.ready_replicas ?? 0}</td>
                  <td>${ctl.desired_replicas ?? 0}</td>
                  <td>${ctl.updated_replicas ?? 0}</td>
                  <td>${ctl.available_replicas ?? 0}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  private renderSnapshot(snapshot: MnOpsHealthSnapshot): TemplateResult {
    const services = snapshot.services ?? []
    const workloads = snapshot.workloads ?? []
    const controllers = snapshot.controllers ?? []
    const alerts = snapshot.alerts ?? []
    const queue = snapshot.queue ?? null
    const k8s = snapshot.k8s ?? {}
    const sections = snapshot.sections ?? {}
    const metricsAvailable = Boolean(
      k8s.metrics_available ?? workloads.some(
        (pod) => this.asNumber(pod.memory_bytes) != null || this.asNumber(pod.cpu_millicores) != null,
      ),
    )

    return html`
      <div class="snapshot">
      ${this.renderAlerts(alerts)}
      ${this.renderQueue(queue)}
      ${this.renderWorkerPressure(queue)}
      ${this.renderServices(services)}
      ${this.renderPods(workloads, metricsAvailable)}
      ${this.renderNodes(this.nodeRows(workloads))}
      ${this.renderControllers(controllers)}
      <div class="subtle" data-section-times>
        services ${this.formatTs(sections.services?.collected_at ?? null)} /
        queue ${this.formatTs(sections.queue?.collected_at ?? null)} /
        k8s ${this.formatTs(sections.k8s?.collected_at ?? null)}
      </div>
      </div>
    `
  }

  render() {
    const snapshot = this.snapshot
    const alerts = snapshot?.alerts ?? []
    const k8s = snapshot?.k8s ?? {}
    const overallStatus = snapshot?.overall_status ?? 'unknown'
    const generatedAt = snapshot?.generated_at ?? null
    const isLoading = this.status === 'loading'

    return html`
      <div class="wrap">
        <div class="header">
          <div>
            <h1 class="title">${this.title}</h1>
            <p class="subtitle">${this.subtitle}</p>
          </div>
          <div class="actions">
            ${this.hideBack ? nothing : html`
              <button class="btn" @click=${() => this.emit('mn-ops-health-back')}>
                ${icon('chevron-left', { size: 14 })}
                Back
              </button>
            `}
            <button class="btn" @click=${() => this.emit('mn-ops-health-refresh')} ?disabled=${isLoading}>
              ${icon('refresh-cw', { size: 14 })}
              Refresh
            </button>
            ${this.hideCopy ? nothing : html`
              <button
                class="btn"
                @click=${() => snapshot && this.emit('mn-ops-health-copy-json', { snapshot })}
                ?disabled=${!snapshot}
              >
                ${icon('copy', { size: 14 })}
                Copy JSON
              </button>
            `}
          </div>
        </div>

        <div class="meta">
          <div class="meta-card">
            <div class="meta-label">Overall</div>
            <div class="meta-value">${this.renderStatus(overallStatus)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Alerts</div>
            <div class="meta-value">${alerts.length}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">K8s</div>
            <div class="meta-value">${k8s.available ? 'available' : 'unavailable'}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Updated</div>
            <div class="meta-value">${this.formatTs(generatedAt)}</div>
          </div>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}

        ${snapshot ? this.renderSnapshot(snapshot) : html`
          <div class="card">
            ${isLoading ? 'Loading ops snapshot...' : 'No data yet.'}
          </div>
        `}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-ops-health-page': MnOpsHealthPage
  }
}
