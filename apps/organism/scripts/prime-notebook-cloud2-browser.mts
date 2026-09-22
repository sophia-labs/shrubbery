import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const url = process.env.SOPHIA_NOTEBOOK_URL ?? 'http://127.0.0.1:5180/?graph=prime-notebook-lab'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const artifactPath = process.env.SOPHIA_NOTEBOOK_SCREENSHOT
	?? resolve(scriptDir, '../../../../artifacts/prime-notebook-arc-f3.png')

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const cells = page.locator('sh-compute-cell-view')
  const family = page.locator('sh-agent-session-family-view')
	await cells.nth(3).waitFor({ state: 'visible', timeout: 30_000 })
  await family.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(1_250)

  const count = await cells.count()
	assert.equal(count, 4, `expected the two parent and two Prime-child notebook cells, got ${count}`)
  const text: string[] = []
  for (let index = 0; index < count; index += 1) {
    text.push(await cells.nth(index).locator('.cell').innerText())
  }
	assert.match(text[0]!, /prime child admitted ags_[0-9a-f]+ acr_[0-9a-f]+/)
	assert.match(text[1]!, /parent continued after prime child 1/)
	assert.match(text[2]!, /resident value 1/)
	assert.match(text[3]!, /resident value 2/)
  for (const cellText of text) assert.match(cellText, /generation 0/)

  const familyText = await family.locator('.family').innerText()
  assert.match(familyText, /Agent Session family/)
  assert.match(familyText, /completed/)
  assert.match(familyText, /1 child/)
	assert.match(familyText, /prime-researcher/)
  assert.match(familyText, /registered/)
  assert.match(familyText, /admitted/)
	assert.match(familyText, /runtime\s+prime/)
	assert.match(familyText, /materialization\s+passivated/)
	assert.match(familyText, /worker\s+passivated/)
	assert.match(familyText, /kernel\s+shutdown/)
  assert.equal(await family.locator('.child').count(), 1)
  const bodyText = await page.locator('body').innerText()
  assert.doesNotMatch(bodyText, /unregistered collection itemFaceId/i)
  assert.doesNotMatch(bodyText, /layout error/i)
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(consoleErrors, [])

  await mkdir(dirname(artifactPath), { recursive: true })
  await page.screenshot({ path: artifactPath, fullPage: true })
  console.log(JSON.stringify({
    url,
    cells: count,
		cellEvidence: ['prime child admitted', 'parent continued after prime child 1', 'resident value 1', 'resident value 2'],
		family: {
			children: 1,
			name: 'prime-researcher',
			parentStatus: 'completed',
			materializationState: 'passivated',
			workerState: 'passivated',
			kernelState: 'shutdown',
    },
    pageErrors,
    consoleErrors,
    artifactPath,
  }, null, 2))
} finally {
  await browser.close()
}
