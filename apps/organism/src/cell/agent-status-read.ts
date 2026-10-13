import type { WfAgentStatusSubject, WfAgentStatusReport } from '@shrubbery/components'

export interface AgentStatusSnapshot {
  readonly graphId:string
  readonly graphIncarnation:string
  readonly asOfMs:number
  readonly agents:readonly WfAgentStatusSubject[]
}

function record(value:unknown,label:string):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string,unknown>
}
function required(value:unknown,label:string,max=2048):string {
  if(typeof value!=='string' || !value.trim() || new TextEncoder().encode(value).length>max) throw Error(`${label} is invalid.`)
  return value
}
function optional(value:unknown,label:string,max=128):string|null {
  return value===null ? null : required(value,label,max)
}
function time(value:unknown,label:string):number {
  const text=required(value,label,64)
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(text)
  if(!parts) throw Error(`${label} is not an RFC3339 timestamp.`)
  const [,yearText,monthText,dayText,hourText,minuteText,secondText,zoneHour='0',zoneMinute='0']=parts
  const year=Number(yearText),month=Number(monthText),day=Number(dayText)
  const leap=year%4===0 && (year%100!==0 || year%400===0)
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31]
  if(year<1 || month<1 || month>12 || day<1 || day>days[month-1] || Number(hourText)>23 || Number(minuteText)>59 || Number(secondText)>59 || Number(zoneHour)>23 || Number(zoneMinute)>59 || !Number.isFinite(Date.parse(text))) throw Error(`${label} has an invalid calendar date or time.`)
  return Date.parse(text)
}

/** The native graph-shared v1 wire. Never accept a missing/malformed list as empty. */
export function decodeAgentStatus(value:unknown,graphId:string):AgentStatusSnapshot {
  const root=record(value,'Agent status')
  if(root.schemaVersion!==1 || root.authority!=='graph-shared-reports' || root.graphId!==graphId) throw Error('Agent status schema or graph scope does not match.')
  const graphIncarnation=required(root.graphIncarnation,'Graph incarnation',128)
  const asOfMs=time(root.asOf,'Server read time')
  if(!Array.isArray(root.agents) || root.agents.length>1024) throw Error('Agent status has no valid bounded agents array.')
  const identities=new Set<string>()
  let reportCount=0
  const agents=root.agents.map((value):WfAgentStatusSubject=>{
    const agent=record(value,'Agent')
    const agentId=required(agent.agentId,'Agent ID',64)
    if(!/^agent-[a-f0-9]{16}$/.test(agentId) || agent.agentIri!==`urn:sophia:agent:${agentId}` || identities.has(agentId)) throw Error('Agent ontology identity is invalid or duplicated.')
    identities.add(agentId)
    if(agent.label!==null && (typeof agent.label!=='string' || new TextEncoder().encode(agent.label).length>1024)) throw Error('Agent label is invalid.')
    const label=typeof agent.label==='string' && agent.label.trim() ? agent.label : agentId
    if(!Array.isArray(agent.reports)) throw Error('Agent reports must be an array.')
    const bodies=new Set<string>()
    const reports=agent.reports.map((value):WfAgentStatusReport=>{
      if(++reportCount>256) throw Error('Agent status exceeds the native report bound.')
      const report=record(value,'Agent report')
      const bodyId=required(report.bodyId,'Body ID',128)
      const reporterPrincipal=optional(report.ingressPrincipal,'Ingress principal',1024)
      const key=JSON.stringify([bodyId,reporterPrincipal])
      if(bodies.has(key)) throw Error('Agent body report is duplicated.')
      bodies.add(key)
      const reportedAtMs=time(report.reportedAt,'Report time'), expiresAtMs=time(report.expiresAt,'Expiry time')
      if(reportedAtMs>asOfMs || expiresAtMs-reportedAtMs<30000 || expiresAtMs-reportedAtMs>600000) throw Error('Agent report time or expiry is inconsistent.')
      const expectedFreshness=expiresAtMs>asOfMs?'recent':'expired'
      if(report.freshness!==expectedFreshness) throw Error('Agent report freshness contradicts server time.')
      if(report.origin!=='self-reported' && report.origin!=='operator-reported') throw Error('Agent report attribution is invalid.')
      if(report.seatLabel!==null && (typeof report.seatLabel!=='string' || new TextEncoder().encode(report.seatLabel).length>128 || /[\u0000-\u001f\u007f]/.test(report.seatLabel))) throw Error('Seat label is invalid.')
      if(typeof report.activity!=='string' || !report.activity.length || new TextEncoder().encode(report.activity).length>2048) throw Error('Activity is invalid.')
      if(report.agentId!==undefined && report.agentId!==agentId) throw Error('Report Agent identity does not match.')
      if(report.graphIncarnation!==undefined && report.graphIncarnation!==graphIncarnation) throw Error('Report incarnation does not match.')
      return {bodyId,reporterPrincipal,reportedAtMs,expiresAtMs,attribution:report.origin,
        sessionId:optional(report.sessionId,'Session ID'),runId:optional(report.runId,'Run ID'),
        activity:report.activity,}
    })
    return {agentId,agentIri:String(agent.agentIri),label,reports}
  })
  return {graphId,graphIncarnation,asOfMs,agents}
}
