import { afterEach,describe,expect,it,vi } from 'vitest'
import { decodeAgentStatus } from '../agent-status-read.js'
import { ChoreographStudioService,ChoreographStudioController } from '../choreograph-studio-service.js'
import type { ShrubberyContract } from '@shrubbery/nucleus'

export function statusFixture(graphId='angels') {
  return {schemaVersion:1,graphId,graphIncarnation:'incarnation-1',asOf:'2026-09-08T23:00:00Z',authority:'graph-shared-reports',agents:[{agentId:'agent-0123456789abcdef',agentIri:'urn:sophia:agent:agent-0123456789abcdef',label:'Correspondent',reports:[{bodyId:'body-1',sessionId:null,runId:null,seatLabel:null,activity:'Reading letters',reportedAt:'2026-09-08T22:59:50Z',expiresAt:'2026-09-08T23:00:50Z',freshness:'recent',origin:'operator-reported',ingressPrincipal:'user:fixture'}]}]}
}

function contract(callTool:(name:string,args:Readonly<Record<string,unknown>>)=>Promise<unknown>) {
  let principal='user:fixture'
  let listener=()=>{}
  return {
    auth:{token:()=>'',userId:()=>principal,isAuthenticated:()=>true,whenReady:async()=>{},onChange:(next:()=>void)=>{listener=next;return()=>{listener=()=>{}}}},
    runtime:{mode:()=> 'hosted',isGateway:()=>true,graphBaseUrl:(graph:string)=>`https://gateway.test/o/owner/g/${graph}`},
    rest:{graphs:async()=>[],query:async()=>({rows:[]}),update:async()=>{}},rawMcp:{callTool},
    changePrincipal(next:string){principal=next;listener()},
  } satisfies Pick<ShrubberyContract,'auth'|'runtime'|'rest'> & {rawMcp:{callTool:typeof callTool};changePrincipal:(next:string)=>void}
}

describe('native Agent status consumer',()=>{
  afterEach(()=>vi.useRealTimers())
  it('decodes real v1 field names and keeps identity/attribution distinct',()=>{
    expect(decodeAgentStatus(statusFixture(),'angels').agents[0]).toMatchObject({agentId:'agent-0123456789abcdef',reports:[{activity:'Reading letters',attribution:'operator-reported',bodyId:'body-1'}]})
  })
  it.each([
    (v:ReturnType<typeof statusFixture>)=>{v.graphId='private'},
    (v:ReturnType<typeof statusFixture>)=>{v.agents[0].agentIri='urn:sophia:agent:other'},
    (v:ReturnType<typeof statusFixture>)=>{v.agents[0].reports[0].reportedAt='2026-09-08T23:00:01Z'},
    (v:ReturnType<typeof statusFixture>)=>{v.agents[0].reports[0].expiresAt='2026-09-08T22:59:40Z'},
    (v:ReturnType<typeof statusFixture>)=>{v.agents[0].reports[0].freshness='expired'},
    (v:ReturnType<typeof statusFixture>)=>{v.agents.push(v.agents[0])},
    (v:ReturnType<typeof statusFixture>)=>{v.agents[0].reports.push(v.agents[0].reports[0])},
    (v:ReturnType<typeof statusFixture>)=>{v.asOf='2026-02-30T23:00:00Z'},
  ])('refuses malformed or wrong-scope snapshots',mutate=>{const fixture=statusFixture();mutate(fixture);expect(()=>decodeAgentStatus(fixture,'angels')).toThrow()})
  it('does not accept missing agents as a successful empty read',()=>{
    expect(()=>decodeAgentStatus({...statusFixture(),agents:undefined},'angels')).toThrow()
    expect(decodeAgentStatus({...statusFixture(),agents:[]},'angels').agents).toEqual([])
  })
  it('accepts the native nullable-label and empty optional seat-label forms without inventing a name',()=>{
    const fixture=statusFixture()
    const input={...fixture,agents:[{...fixture.agents[0],label:null,reports:[{...fixture.agents[0].reports[0],seatLabel:'',activity:' ',agentId:fixture.agents[0].agentId,graphIncarnation:fixture.graphIncarnation,ttlSeconds:60,schemaVersion:1}]}]}
    expect(decodeAgentStatus(input,'angels').agents[0].label).toBe(fixture.agents[0].agentId)
    expect(()=>decodeAgentStatus({...input,agents:[{...input.agents[0],reports:[{...input.agents[0].reports[0],graphIncarnation:'old'}]}]},'angels')).toThrow('incarnation')
  })
  it('calls only the graph-routed read tool; unsupported, permission and malformed differ from empty',async()=>{
    const read=vi.fn(async(_name:string,_args:Readonly<Record<string,unknown>>)=>statusFixture())
    const service=new ChoreographStudioService(contract(read))
    expect((await service.loadAgentStatus('angels')).kind).toBe('ok')
    expect(read.mock.calls).toEqual([['agent_status',{graphId:'angels',graph_id:'angels'}]])
    for(const problem of [Error('Forbidden (403)'),Error('Offline')]) {
      const result=await new ChoreographStudioService(contract(async()=>{throw problem})).loadAgentStatus('angels')
      expect(result.kind).toBe('error')
    }
    expect((await new ChoreographStudioService(contract(async()=>({}))).loadAgentStatus('angels')).kind).toBe('error')
    expect((await new ChoreographStudioService(contract(async()=>{throw Object.assign(Error('No tool'),{code:-32601})})).loadAgentStatus('angels')).kind).toBe('unavailable')
  })
  it('fences graph replacement, late results and principal changes',async()=>{
    let resolve!:(value:unknown)=>void
    const delayed=new Promise<unknown>(done=>{resolve=done})
    const read=vi.fn(async(_name:string,args:Readonly<Record<string,unknown>>)=>args.graphId==='angels'?delayed:statusFixture('other'))
    const auth=contract(read)
    const controller=new ChoreographStudioController(new ChoreographStudioService(auth))
    const first=controller.refreshAgentStatus('angels')
    await Promise.resolve()
    await controller.refreshAgentStatus('other')
    resolve(statusFixture());await first
    expect(controller.getState().agentSubjects[0].label).toBe('Correspondent')
    expect(controller.getState().agentStatusSource).toContain('/g/other')
    controller.selectAgent('urn:sophia:agent:agent-0123456789abcdef')
    auth.changePrincipal('user:another')
    expect(controller.getState().agentSubjects).toEqual([])
    expect(controller.getState().selectedAgentIri).toBe('')
    controller.destroy()
  })
  it('bounds authentication loading and does not begin a read after the timeout',async()=>{
    vi.useFakeTimers()
    const read=vi.fn(async(_name:string,_args:Readonly<Record<string,unknown>>)=>statusFixture())
    let resolveAuth!:()=>void
    const authReady=new Promise<void>(resolve=>{resolveAuth=resolve})
    const host=contract(read);host.auth.whenReady=()=>authReady
    const pending=new ChoreographStudioService(host).loadAgentStatus('angels')
    await vi.advanceTimersByTimeAsync(12001)
    expect(await pending).toMatchObject({kind:'error',error:expect.stringContaining('timed out')})
    resolveAuth();await Promise.resolve();await Promise.resolve()
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('clears a selected report on principal change without mistaking token refresh for a scope change',async()=>{
    const host=contract(async()=>statusFixture())
    const controller=new ChoreographStudioController(new ChoreographStudioService(host))
    await controller.refreshAgentStatus('angels')
    const agentIri=statusFixture().agents[0].agentIri
    controller.selectAgent(agentIri)
    host.changePrincipal('user:fixture')
    expect(controller.getState().selectedAgentIri).toBe(agentIri)
    host.changePrincipal('user:other')
    expect(controller.getState().agentSubjects).toEqual([])
    expect(controller.getState().selectedAgentIri).toBe('')
    controller.destroy()
  })
})
