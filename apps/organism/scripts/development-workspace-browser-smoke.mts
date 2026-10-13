/** Read-only smoke through the actual Garden app switcher and development service. */
import { chromium } from 'playwright'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const origin = process.env.DEVELOPMENT_PANE_ORIGIN ?? 'http://127.0.0.1:5189'
const graphId = process.env.DEVELOPMENT_PANE_GRAPH ?? 'development-workspace-20260919'
const url = new URL('/',origin)
url.search = new URLSearchParams({source:'cell',graph:graphId,development:'1',studio:'development'}).toString()
const browser = await chromium.launch({headless:true,channel:process.env.DEVELOPMENT_PANE_BROWSER_CHANNEL ?? 'chrome'})
try {
  const page = await browser.newPage({viewport:{width:1500,height:1000}})
  const errors: string[] = []
  page.on('pageerror',error => errors.push(error.message))
  await page.goto(url.href)
  await page.locator('mn-top-bar [role="tab"]').filter({hasText:'Choreograph'}).click({timeout:30_000})
  const editor = page.locator('sh-development-code-editor .cm-content').first()
  await editor.waitFor({timeout:20_000})
  if (!await editor.innerText()) throw new Error('Shared Garden source did not render')
  const output = process.env.DEVELOPMENT_PANE_SCREENSHOT ?? join(tmpdir(),'development-normal-app-smoke.png')
  await page.screenshot({path:output})
  await page.locator('mn-top-bar [role="tab"]').filter({hasText:'Garden'}).click()
  if (await page.locator('mn-top-bar [role="tab"]').filter({hasText:'Garden'}).getAttribute('aria-selected') !== 'true') {
    throw new Error('Garden app did not resume')
  }
  if (errors.length) throw new Error(errors.join('\n'))
  process.stdout.write(`Development pane: actual source rendered; Garden app resumed; screenshot ${output}\n`)
} finally { await browser.close() }
