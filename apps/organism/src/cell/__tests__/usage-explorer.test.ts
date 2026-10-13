import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostedUsageExplorer, usageCsv, type UsageEvent } from '../usage-explorer.js'
import '../usage-explorer-view.js'
import type { UsageExplorerView } from '../usage-explorer-view.js'
const event: UsageEvent = { id:'cloud-1:a', source:'cloud-1', ts:100, recordedAt:'1970-01-01T00:00:00.100Z', timezone:'utc', provider:'zen', model:'old-model', status:'completed', surface:'chat', graphId:null, sessionId:null, fundingSource:null, inputTokens:10, outputTokens:2, cacheReadTokens:0, cacheWriteTokens:0, totalTokens:null, costMicroUsd:100, providerCostMicroUsd:90, providerReportedCostMicroUsd:null, markupMicroUsd:10 }
const coverage = [{ source:'sirin', eventCount:1, firstTs:200, lastTs:200, state:'recorded-events', capturedAt:null }, { source:'cloud-1', eventCount:1, firstTs:100, lastTs:100, state:'imported-snapshot', capturedAt:'2026-09-21T00:00:00Z' }]
const envelope = { schema:'sophia.usage-explorer.v1', userId:'alice', fromTs:0, toTs:1000, items:[event], nextCursor:null, coverage }
afterEach(() => document.body.replaceChildren())
describe('usage explorer', () => {
  it('uses the native fetch receiver and refuses foreign-owner or stale data', async () => {
    let owner='alice', body: unknown=envelope, change=false
    const fetcher = async function(this: unknown, _url: RequestInfo | URL, init?: RequestInit) {
      expect(this).toBe(globalThis);expect(init?.cache).toBe('no-store');expect(init?.headers).toEqual({ Authorization:'Bearer human' })
      if(change)owner='bob'
      return Response.json(body)
    }
    const reader=new HostedUsageExplorer({ userId:()=>owner,token:()=> 'human' },'https://sirin.test',fetcher)
    expect((await reader.page()).items).toEqual([event])
    body={...envelope,userId:'bob'};await expect(reader.page()).rejects.toThrow('Invalid usage')
    body=envelope;change=true;await expect(reader.page()).rejects.toThrow('session changed')
  })
  it('neutralizes spreadsheet formulas while preserving recorded costs and unknown fields', () => {
    const csv=usageCsv([{...event,model:'=HYPERLINK("private")'}])
    expect(csv).toContain('"\'=HYPERLINK(""private"")"')
    expect(csv).toContain('costMicroUsd');expect(csv).toContain('"100"')
    expect(csv).not.toContain('undefined')
  })
  it('loads both sources, filters old history, and exposes events instead of an empty 30-day summary', async () => {
    const reader={page:vi.fn(async (after?: string) => after ? {items:[{...event,id:'sirin:b',source:'sirin' as const,ts:200,model:'new-model',costMicroUsd:200}],nextCursor:null,coverage} : {items:[event],nextCursor:'next',coverage})}
    const el=document.createElement('mn-usage-explorer') as UsageExplorerView;el.reader=reader;document.body.append(el)
    await vi.waitFor(()=>expect(el.shadowRoot?.querySelectorAll('tbody tr').length).toBe(2))
    expect(el.shadowRoot!.textContent).toContain('all retained events loaded')
    expect(el.shadowRoot!.textContent).toContain('$0.0003')
    expect(reader.page.mock.calls).toEqual([[undefined],['next']])
    const input=el.shadowRoot!.querySelector('input[type=search]') as HTMLInputElement;input.value='old-model';input.dispatchEvent(new Event('input'));await el.updateComplete
    expect(el.shadowRoot!.querySelectorAll('tbody tr').length).toBe(1)
    expect(el.shadowRoot!.textContent).toContain('$0.0001')
    ;(el.shadowRoot!.querySelector('tbody button') as HTMLButtonElement).click();await el.updateComplete
    expect(el.shadowRoot!.querySelector('.details')?.textContent).toContain('Unknown / not recorded')
    ;[...el.shadowRoot!.querySelectorAll('button')].find(b=>b.textContent==='30 days')!.click();await el.updateComplete
    expect(el.shadowRoot!.querySelectorAll('tbody tr').length).toBe(0)
    expect(el.shadowRoot!.textContent).toContain('No events match these filters.')
    expect(el.shadowRoot!.querySelectorAll('.coverage .group').length).toBe(2)
    expect(el.shadowRoot!.textContent).toContain('cloud-1 · 1 retained event') // coverage remains all-time
  })
})
