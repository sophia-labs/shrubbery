import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator } from 'playwright'

const RECEIPT_ENV = 'SOPHIA_ARC_F4_RECEIPT_JSON'
const MAX_RECEIPT_BYTES = 32_768
const MAX_SESSIONS = 65
const MAX_TEXT_LENGTH = 128
const LIVE_PROOF_TIMEOUT_MS = 30_000

interface ExpectedLedger {
	readonly directAcceptedChildren: number
	readonly maxChildren: number
	readonly occupiedChildren: number
	readonly maxConcurrentChildren: number
	readonly budgetCostSpentUsdMicros: number
	readonly budgetCostReservedUsdMicros: number
	readonly budgetCostRemainingUsdMicros: number
	readonly budgetCostMaxUsdMicros: number
	readonly budgetAccountRevision: number
	readonly budgetAccountExhausted: boolean
}

interface ExpectedChild {
	readonly name: string
	readonly allocationState: 'reserved' | 'settled' | 'released'
	readonly allocatedCostUsdMicros: number
	readonly settledActualCostUsdMicros: number | null
}

interface ArcF4Receipt {
	readonly schema: 'sophia.arc-f4-browser-receipt.v1'
	readonly parentStatus: string
	readonly sessionCount: number
	readonly notebookCellEvidence: readonly string[]
	readonly ledger: ExpectedLedger
	readonly children: readonly ExpectedChild[]
}

interface DisplayedChild {
	readonly name: string
	readonly sessionId: string
	readonly allocationState: string | null
	readonly allocatedCostUsdMicros: number | null
	readonly settledActualCostUsdMicros: number | null
	readonly hasActual: boolean
	readonly hasOverage: boolean
}

interface DisplayedFamily {
	readonly parentStatus: string
	readonly summary: string
	readonly ledger: {
		readonly accepted: string
		readonly active: string
		readonly cost: string
		readonly revision: string
		readonly exhausted: boolean
	}
	readonly children: readonly DisplayedChild[]
}

function failReceipt(message: string): never {
	throw new Error(`${RECEIPT_ENV}: ${message}`)
}

function record(value: unknown, context: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return failReceipt(`${context} must be a JSON object`)
	}
	return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
	const actual = Object.keys(value).sort()
	const wanted = [...expected].sort()
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		failReceipt(`${context} must contain exactly: ${wanted.join(', ')}`)
	}
}

function integer(value: unknown, context: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
		return failReceipt(`${context} must be a non-negative safe integer no greater than ${maximum}`)
	}
	return value as number
}

function text(value: unknown, context: string): string {
	if (
		typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAX_TEXT_LENGTH
		|| [...value].some((character) => {
			const code = character.charCodeAt(0)
			return code <= 0x1f || code === 0x7f
		})
	) {
		return failReceipt(`${context} must be 1-${MAX_TEXT_LENGTH} printable characters`)
	}
	return value
}

function parseLedger(value: unknown): ExpectedLedger {
	const ledger = record(value, 'ledger')
	exactKeys(ledger, [
		'directAcceptedChildren',
		'maxChildren',
		'occupiedChildren',
		'maxConcurrentChildren',
		'budgetCostSpentUsdMicros',
		'budgetCostReservedUsdMicros',
		'budgetCostRemainingUsdMicros',
		'budgetCostMaxUsdMicros',
		'budgetAccountRevision',
		'budgetAccountExhausted',
	], 'ledger')
	const parsed: ExpectedLedger = {
		directAcceptedChildren: integer(ledger.directAcceptedChildren, 'ledger.directAcceptedChildren', MAX_SESSIONS - 1),
		maxChildren: integer(ledger.maxChildren, 'ledger.maxChildren', MAX_SESSIONS - 1),
		occupiedChildren: integer(ledger.occupiedChildren, 'ledger.occupiedChildren', MAX_SESSIONS - 1),
		maxConcurrentChildren: integer(ledger.maxConcurrentChildren, 'ledger.maxConcurrentChildren', MAX_SESSIONS - 1),
		budgetCostSpentUsdMicros: integer(ledger.budgetCostSpentUsdMicros, 'ledger.budgetCostSpentUsdMicros'),
		budgetCostReservedUsdMicros: integer(ledger.budgetCostReservedUsdMicros, 'ledger.budgetCostReservedUsdMicros'),
		budgetCostRemainingUsdMicros: integer(ledger.budgetCostRemainingUsdMicros, 'ledger.budgetCostRemainingUsdMicros'),
		budgetCostMaxUsdMicros: integer(ledger.budgetCostMaxUsdMicros, 'ledger.budgetCostMaxUsdMicros'),
		budgetAccountRevision: integer(ledger.budgetAccountRevision, 'ledger.budgetAccountRevision'),
		budgetAccountExhausted: ledger.budgetAccountExhausted === true
			? true
			: ledger.budgetAccountExhausted === false
				? false
				: failReceipt('ledger.budgetAccountExhausted must be a boolean'),
	}
	if (parsed.directAcceptedChildren > parsed.maxChildren) {
		failReceipt('ledger.directAcceptedChildren cannot exceed ledger.maxChildren')
	}
	if (parsed.occupiedChildren > parsed.maxConcurrentChildren) {
		failReceipt('ledger.occupiedChildren cannot exceed ledger.maxConcurrentChildren')
	}
	if (parsed.occupiedChildren > parsed.directAcceptedChildren) {
		failReceipt('ledger.occupiedChildren cannot exceed ledger.directAcceptedChildren')
	}
	const unspent = Math.max(0, parsed.budgetCostMaxUsdMicros - parsed.budgetCostSpentUsdMicros)
	const expectedRemaining = Math.max(0, unspent - parsed.budgetCostReservedUsdMicros)
	if (parsed.budgetCostRemainingUsdMicros !== expectedRemaining) {
		failReceipt('ledger.budgetCostRemainingUsdMicros is inconsistent with spent, reserved, and max')
	}
	if (
		(parsed.budgetCostSpentUsdMicros > parsed.budgetCostMaxUsdMicros
			|| parsed.budgetCostReservedUsdMicros > unspent)
		&& !parsed.budgetAccountExhausted
	) {
		failReceipt('ledger must mark an aggregate cost overage exhausted')
	}
	return parsed
}

function parseChild(value: unknown, index: number): ExpectedChild {
	const child = record(value, `children[${index}]`)
	exactKeys(child, [
		'name',
		'allocationState',
		'allocatedCostUsdMicros',
		'settledActualCostUsdMicros',
	], `children[${index}]`)
	const allocationState = child.allocationState
	if (allocationState !== 'reserved' && allocationState !== 'settled' && allocationState !== 'released') {
		failReceipt(`children[${index}].allocationState must be reserved, settled, or released`)
	}
	const settledActualCostUsdMicros = child.settledActualCostUsdMicros === null
		? null
		: integer(child.settledActualCostUsdMicros, `children[${index}].settledActualCostUsdMicros`)
	if ((allocationState === 'settled') !== (settledActualCostUsdMicros !== null)) {
		failReceipt(`children[${index}] must carry actual cost exactly when its allocation is settled`)
	}
	return {
		name: text(child.name, `children[${index}].name`),
		allocationState,
		allocatedCostUsdMicros: integer(child.allocatedCostUsdMicros, `children[${index}].allocatedCostUsdMicros`),
		settledActualCostUsdMicros,
	}
}

function parseReceipt(): ArcF4Receipt {
	const source = process.env[RECEIPT_ENV]
	if (!source) {
		return failReceipt('required; pass the live organism display receipt as JSON')
	}
	if (Buffer.byteLength(source, 'utf8') > MAX_RECEIPT_BYTES) {
		return failReceipt(`must not exceed ${MAX_RECEIPT_BYTES} UTF-8 bytes`)
	}
	let decoded: unknown
	try {
		decoded = JSON.parse(source)
	} catch (error) {
		return failReceipt(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
	}
	const receipt = record(decoded, 'receipt')
	exactKeys(receipt, [
		'schema',
		'parentStatus',
		'sessionCount',
		'notebookCellEvidence',
		'ledger',
		'children',
	], 'receipt')
	if (receipt.schema !== 'sophia.arc-f4-browser-receipt.v1') {
		return failReceipt('schema must be sophia.arc-f4-browser-receipt.v1')
	}
	const sessionCount = integer(receipt.sessionCount, 'sessionCount', MAX_SESSIONS)
	if (sessionCount < 1) return failReceipt('sessionCount must include the parent and be at least 1')
	if (!Array.isArray(receipt.notebookCellEvidence)) {
		return failReceipt('notebookCellEvidence must be a JSON array')
	}
	if (receipt.notebookCellEvidence.length < 1 || receipt.notebookCellEvidence.length > MAX_SESSIONS) {
		return failReceipt(`notebookCellEvidence must contain 1-${MAX_SESSIONS} entries`)
	}
	const notebookCellEvidence = receipt.notebookCellEvidence.map((value, index) =>
		text(value, `notebookCellEvidence[${index}]`))
	if (!Array.isArray(receipt.children)) return failReceipt('children must be a JSON array')
	if (receipt.children.length > MAX_SESSIONS - 1) {
		return failReceipt(`children must not contain more than ${MAX_SESSIONS - 1} entries`)
	}
	const children = receipt.children.map(parseChild)
	if (children.length !== sessionCount - 1) {
		return failReceipt('sessionCount must equal one parent plus children.length')
	}
	const names = new Set(children.map((child) => child.name))
	if (names.size !== children.length) return failReceipt('children names must be unique')
	const ledger = parseLedger(receipt.ledger)
	if (ledger.directAcceptedChildren !== children.length) {
		return failReceipt('ledger.directAcceptedChildren must equal children.length')
	}
	return {
		schema: receipt.schema,
		parentStatus: text(receipt.parentStatus, 'parentStatus'),
		sessionCount,
		notebookCellEvidence,
		ledger,
		children,
	}
}

function normalized(value: string | null): string {
	return value?.replace(/\s+/gu, ' ').trim() ?? ''
}

async function budgetValue(row: Locator, label: 'cost' | 'actual'): Promise<{ readonly present: boolean; readonly value: number | null }> {
	const budgets = row.locator('.budget')
	for (let index = 0; index < await budgets.count(); index += 1) {
		const budget = budgets.nth(index)
		if (normalized(await budget.locator('.label').textContent()) !== label) continue
		const raw = normalized(await budget.locator('.number').textContent())
		return { present: true, value: /^\d+$/u.test(raw) ? Number(raw) : null }
	}
	return { present: false, value: null }
}

async function readDisplayedFamily(family: Locator): Promise<DisplayedFamily> {
	const ledgerMetrics = family.locator('.ledger .ledger-metric')
	const acceptedLabel = normalized(await ledgerMetrics.nth(0).locator('.label').textContent())
	const acceptedValue = normalized(await ledgerMetrics.nth(0).locator('.number').textContent())
	const activeLabel = normalized(await ledgerMetrics.nth(1).locator('.label').textContent())
	const activeValue = normalized(await ledgerMetrics.nth(1).locator('.number').textContent())
	const costMetric = ledgerMetrics.nth(2)
	const costNumbers = costMetric.locator('.number')
	const costValues = await Promise.all(
		[0, 1, 2, 3].map(async (index) => normalized(await costNumbers.nth(index).textContent())),
	)
	const children: DisplayedChild[] = []
	const rows = family.locator('.child')
	for (let index = 0; index < await rows.count(); index += 1) {
		const row = rows.nth(index)
		const cost = await budgetValue(row, 'cost')
		const actual = await budgetValue(row, 'actual')
		children.push({
			name: normalized(await row.locator('.name').textContent()),
			sessionId: normalized(await row.locator('.session-id').textContent()),
			allocationState: await row.locator('.allocation-state').count() === 1
				? normalized(await row.locator('.allocation-state').textContent())
				: null,
			allocatedCostUsdMicros: cost.value,
			settledActualCostUsdMicros: actual.value,
			hasActual: actual.present,
			hasOverage: await row.locator('.allocation-overage').count() === 1,
		})
	}
	return {
		parentStatus: normalized(await family.locator('header .status').textContent()),
		summary: normalized(await family.locator('header .summary').textContent()),
		ledger: {
			accepted: `${acceptedLabel} ${acceptedValue}`,
			active: `${activeLabel} ${activeValue}`,
			cost: `cost ${costValues[0]} spent · ${costValues[1]} reserved · ${costValues[2]} remaining / ${costValues[3]} µUSD`,
			revision: normalized(await family.locator('.ledger-revision').textContent()),
			exhausted: await family.locator('.account-exhausted').count() === 1,
		},
		children,
	}
}

function expectedDisplayedFamily(receipt: ArcF4Receipt): DisplayedFamily {
	const { ledger } = receipt
	return {
		parentStatus: receipt.parentStatus,
		summary: `${receipt.children.length} ${receipt.children.length === 1 ? 'child' : 'children'}`,
		ledger: {
			accepted: `accepted ${ledger.directAcceptedChildren} / ${ledger.maxChildren}`,
			active: `active ${ledger.occupiedChildren} / ${ledger.maxConcurrentChildren}`,
			cost: `cost ${ledger.budgetCostSpentUsdMicros} spent · ${ledger.budgetCostReservedUsdMicros} reserved · ${ledger.budgetCostRemainingUsdMicros} remaining / ${ledger.budgetCostMaxUsdMicros} µUSD`,
			revision: `ledger rev ${ledger.budgetAccountRevision}`,
			exhausted: ledger.budgetAccountExhausted,
		},
		children: receipt.children.map((child) => ({
			name: child.name,
			sessionId: '',
			allocationState: `allocation ${child.allocationState}`,
			allocatedCostUsdMicros: child.allocatedCostUsdMicros,
			settledActualCostUsdMicros: child.settledActualCostUsdMicros,
			hasActual: child.settledActualCostUsdMicros !== null,
			hasOverage: child.settledActualCostUsdMicros !== null
				&& child.settledActualCostUsdMicros > child.allocatedCostUsdMicros,
		})),
	}
}

function comparable(family: DisplayedFamily): Omit<DisplayedFamily, 'children'> & { readonly children: readonly Omit<DisplayedChild, 'sessionId'>[] } {
	return {
		...family,
		children: family.children.map(({ sessionId: _sessionId, ...child }) => child),
	}
}

async function waitForReceipt(family: Locator, expected: DisplayedFamily): Promise<DisplayedFamily> {
	const deadline = Date.now() + LIVE_PROOF_TIMEOUT_MS
	let displayed = await readDisplayedFamily(family)
	while (Date.now() < deadline) {
		if (JSON.stringify(comparable(displayed)) === JSON.stringify(comparable(expected))) return displayed
		await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250))
		displayed = await readDisplayedFamily(family)
	}
	assert.deepEqual(comparable(displayed), comparable(expected), 'the live family Face did not converge to the supplied F4 receipt')
	return displayed
}

async function waitForNotebookEvidence(
	cells: Locator,
	evidence: readonly string[],
): Promise<readonly string[]> {
	const deadline = Date.now() + LIVE_PROOF_TIMEOUT_MS
	let displayed: string[] = []
	while (Date.now() < deadline) {
		displayed = await Promise.all(
			Array.from({ length: await cells.count() }, async (_value, index) => cells.nth(index).locator('.cell').innerText()),
		)
		if (
			displayed.length === evidence.length
			&& evidence.every((expectedValue, index) => displayed[index]?.includes(expectedValue))
		) return displayed
		await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250))
	}
	assert.equal(displayed.length, evidence.length, 'notebook cell count must converge to the supplied live organism evidence')
	for (const [index, expectedValue] of evidence.entries()) {
		assert.ok(
			displayed[index]?.includes(expectedValue),
			`notebook cell ${index} must contain the supplied plain-text evidence ${JSON.stringify(expectedValue)}`,
		)
	}
	return displayed
}

const receipt = parseReceipt()
const expected = expectedDisplayedFamily(receipt)
const url = process.env.SOPHIA_NOTEBOOK_URL ?? 'http://127.0.0.1:5180/?graph=prime-notebook-lab'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const artifactPath = process.env.SOPHIA_NOTEBOOK_SCREENSHOT
	?? resolve(scriptDir, '../../../../artifacts/prime-notebook-arc-f4.png')

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LIVE_PROOF_TIMEOUT_MS })
	const cells = page.locator('sh-compute-cell-view')
	await cells.nth(receipt.notebookCellEvidence.length - 1).waitFor({
		state: 'visible',
		timeout: LIVE_PROOF_TIMEOUT_MS,
	})
	const displayedCellTexts = await waitForNotebookEvidence(cells, receipt.notebookCellEvidence)
	const families = page.locator('sh-agent-session-family-view')
	await families.first().waitFor({ state: 'visible', timeout: LIVE_PROOF_TIMEOUT_MS })
	assert.equal(await families.count(), 1, 'expected exactly one sealed Agent Session family Face')
	const family = families.first()
	await family.locator('.ledger').waitFor({ state: 'visible', timeout: LIVE_PROOF_TIMEOUT_MS })
	const displayed = await waitForReceipt(family, expected)

	assert.equal(
		await cells.count(),
		receipt.notebookCellEvidence.length,
		'notebook cell count must exactly match the supplied live organism evidence',
	)
	const displayedCellEvidence: string[] = []
	for (const [index, evidence] of receipt.notebookCellEvidence.entries()) {
		const cell = cells.nth(index)
		assert.equal(await cell.isVisible(), true, `notebook cell ${index} must be visible`)
		const cellText = displayedCellTexts[index] ?? ''
		assert.ok(
			cellText.includes(evidence),
			`notebook cell ${index} must contain the supplied plain-text evidence ${JSON.stringify(evidence)}`,
		)
		assert.match(cellText, /\bgeneration\s+0\b/iu, `notebook cell ${index} must be generation 0`)
		displayedCellEvidence.push(evidence)
	}

	assert.equal(receipt.sessionCount, displayed.children.length + 1, 'session count must include one parent and every displayed child')
	for (const child of displayed.children) {
		assert.match(child.sessionId, /^.{7}….{6}$/u, `${child.name} must expose only a shortened Session id`)
	}
	assert.equal(
		await family.locator('button, input, select, textarea, a[href], [contenteditable="true"], [role="button"], [role="textbox"]').count(),
		0,
		'the sealed family Face must remain read-only and non-operational',
	)
	const familyMarkup = await family.evaluate((element) => element.shadowRoot?.innerHTML ?? '')
	assert.doesNotMatch(familyMarkup, /\burn:[^<\s"']+/iu, 'the family Face must not leak graph IRIs')
	assert.doesNotMatch(familyMarkup, /\bags_[a-z0-9_-]{17,}\b/iu, 'the family Face must not leak full Agent Session ids')
	assert.doesNotMatch(
		familyMarkup,
		/\b(?:prompt|model|provider|binding[_ -]?digest|body[_ -]?id|activation[_ -]?id|sandbox[_ -]?id|request[_ -]?id|allocation[_ -]?id|operation[_ -]?id)\b/iu,
		'the family Face must not leak runtime authority or conversation coordinates',
	)

	const bodyText = await page.locator('body').innerText()
	assert.doesNotMatch(bodyText, /unregistered collection itemFaceId/iu)
	assert.doesNotMatch(bodyText, /layout error/iu)
	assert.deepEqual(pageErrors, [])
	assert.deepEqual(consoleErrors, [])

	await mkdir(dirname(artifactPath), { recursive: true })
	await page.screenshot({ path: artifactPath, fullPage: true })
	console.log(JSON.stringify({
		schema: 'sophia.arc-f4-browser-proof.v1',
		url,
		sessionCount: receipt.sessionCount,
		notebookCells: displayedCellEvidence.length,
		notebookCellEvidence: displayedCellEvidence,
		parentStatus: displayed.parentStatus,
		ledger: receipt.ledger,
		children: displayed.children.map((child) => ({
			name: child.name,
			allocationState: child.allocationState,
			allocatedCostUsdMicros: child.allocatedCostUsdMicros,
			settledActualCostUsdMicros: child.settledActualCostUsdMicros,
			overage: child.hasOverage,
		})),
		pageErrors,
		consoleErrors,
		artifactPath,
	}, null, 2))
} finally {
	await browser.close()
}
