import { afterEach, describe, expect, it, vi } from 'vitest'
import '../wf-agent-status-view.js'
import '../wf-studio-shell.js'
import type { WfAgentStatusSubject, WfAgentStatusView } from '../wf-agent-status-view.js'
import type { WfStudioShell } from '../wf-studio-shell.js'

const agent: WfAgentStatusSubject = {
  agentIri:'urn:sophia:agent:agent-a1', agentId:'agent-a1', label:'The Correspondent',
  reports:[{bodyId:'body-1',sessionId:'ags-1',runId:'wfr-1',activity:'Reading a letter',reportedAtMs:9000,expiresAtMs:12000,attribution:'operator-reported',reporterPrincipal:'user:fixture'}],
}

async function mount(setup:(element:WfAgentStatusView)=>void = ()=>{}):Promise<WfAgentStatusView> {
  const element=document.createElement('wf-agent-status-view')
  setup(element)
  document.body.append(element)
  await element.updateComplete
  return element
}

afterEach(()=>{ document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('Agent status view — real controlled component',()=>{
  it('starts a newly selected Agent at its heading but preserves same-Agent reading position',async()=>{
    const other={...agent,agentIri:'urn:sophia:agent:agent-a2',agentId:'agent-a2',label:'Another correspondent'}
    const el=await mount(el=>{el.status='ready';el.agents=[agent,other];el.selectedAgentIri=agent.agentIri;el.graphId='one'})
    const detail=()=>el.shadowRoot!.querySelector<HTMLElement>('.detail')!
    detail().scrollTop=180
    el.agents=[{...agent,label:'Updated label'},other];await el.updateComplete
    expect(detail().scrollTop).toBe(180)
    el.selectedAgentIri=other.agentIri;await el.updateComplete
    expect(detail().scrollTop).toBe(0)
    detail().scrollTop=120
    el.graphId='two';await el.updateComplete
    expect(detail().scrollTop).toBe(0)
  })

  it('distinguishes an ontology Agent from its reported body/session/run and never calls fetch',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch')
    const el=await mount(el=>{ el.status='ready'; el.agents=[agent]; el.selectedAgentIri=agent.agentIri; el.graphId='angels'; el.observedAtMs=10000; el.receivedAtMonotonicMs=performance.now() })
    const text=el.shadowRoot!.textContent!
    expect(text).toContain('The Correspondent')
    expect(text).toContain('urn:sophia:agent:agent-a1')
    expect(text).toContain('ags-1')
    expect(text).toContain('body-1')
    expect(text).toContain('Reading a letter')
    expect(text).toContain('not independently verified runtime liveness')
    expect(text).toContain('not a global roster')
    const selected=vi.fn(); const run=vi.fn()
    el.addEventListener('choreo-agent-select',selected); el.addEventListener('choreo-run-select',run)
    ;(el.shadowRoot!.querySelector('.agent') as HTMLButtonElement).click()
    expect(selected.mock.calls[0][0].detail).toEqual({agentIri:agent.agentIri})
    expect(el.shadowRoot!.querySelector('.report button')).toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('expires a recent report while still open, independent of browser wall-clock skew',async()=>{
    vi.useFakeTimers()
    let monotonic=500
    vi.spyOn(performance,'now').mockImplementation(()=>monotonic)
    const el=await mount(el=>{ el.status='ready'; el.agents=[agent]; el.selectedAgentIri=agent.agentIri; el.observedAtMs=10000; el.receivedAtMonotonicMs=500 })
    expect(el.shadowRoot!.querySelector('.presence')!.textContent).toContain('Recent report')
    monotonic=2501; vi.advanceTimersByTime(1000); await el.updateComplete
    expect(el.shadowRoot!.querySelector('.presence')!.textContent).toContain('Report expired')
    expect(el.shadowRoot!.textContent).toContain('Reading a letter')
    el.remove(); expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['idle','loading','unavailable','error'] as const)('does not turn %s into a successful empty roster',async status=>{
    const el=await mount(el=>{el.status=status;el.error=status==='error'?'Forbidden (403)':''})
    expect(el.shadowRoot!.textContent).not.toContain('No Agent reports in this workspace')
    if(status==='error') expect(el.shadowRoot!.querySelector('[role=alert]')!.textContent).toContain('Forbidden (403)')
  })

  it('shows a successful empty read and no-report Agent separately',async()=>{
    const el=await mount(el=>{el.status='empty'})
    expect(el.shadowRoot!.textContent).toContain('No Agent reports in this workspace')
    el.status='ready';el.agents=[{...agent,reports:[]}];el.selectedAgentIri=agent.agentIri;await el.updateComplete
    expect(el.shadowRoot!.textContent).toContain('No status report')
    expect(el.shadowRoot!.textContent).not.toContain('Recent report')
  })

  it('marks exactly one Studio navigation destination and passes status to the Agents screen',async()=>{
    const el=document.createElement('wf-studio-shell') as WfStudioShell
    el.graphId='angels';el.agentStatus='ready';el.agentSubjects=[agent];el.selectedAgentIri=agent.agentIri
    document.body.append(el);await el.updateComplete
    expect(el.shadowRoot!.querySelectorAll('[data-active=true]')).toHaveLength(1)
    const button=Array.from(el.shadowRoot!.querySelectorAll('button')).find(button=>button.textContent?.includes('Agents'))!
    button.click();await el.updateComplete
    const view=el.shadowRoot!.querySelector('wf-agent-status-view') as WfAgentStatusView
    expect(view.agents).toEqual([agent]);expect(view.selectedAgentIri).toBe(agent.agentIri)
    expect(el.shadowRoot!.querySelectorAll('[aria-current=page]')).toHaveLength(1)
  })
})
