/**
 * The two toasts of a top-up that lands, and where they go.
 *
 * "Payment received. Your credits are on the way." is the return's toast; "Credits added" (or, when the
 * wait ran out, "have not arrived yet") is how the wait ended. `mn-toast` anchors every toast to the same
 * corner of the screen, so a second toast shown while the first is still up does not sit beside it, it
 * covers it: found in real browsers, at 1440 and at 390, where "Payment received" showed as a stub peeking
 * out from under "Credits added". One message at a time: the result takes the place of the toast it follows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import { showCheckoutResultToast, showCheckoutReturnToast } from '../checkout-return.js'

afterEach(() => document.body.replaceChildren())

async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('one message at a time after a top-up', () => {
  it('a credit that arrived takes the place of "your credits are on the way", instead of covering it', async () => {
    const onTheWay = showCheckoutReturnToast(document, 'success', 'topup')
    const credited = showCheckoutResultToast(document, 'credited', 11_000_000)

    await until(() => !document.body.contains(onTheWay))
    expect(document.body.querySelectorAll('mn-toast')).toHaveLength(1)
    expect(document.body.contains(credited)).toBe(true)
  })

  it('does the same when the wait ran out, and when the balance could not be read', async () => {
    for (const result of ['late', 'unreadable'] as const) {
      const onTheWay = showCheckoutReturnToast(document, 'success', 'topup')
      const outcome = showCheckoutResultToast(document, result, null)
      await until(() => !document.body.contains(onTheWay))
      expect(document.body.querySelectorAll('mn-toast')).toHaveLength(1)
      expect(document.body.contains(outcome)).toBe(true)
      outcome.remove()
    }
  })

  it('leaves alone a toast that is not the return’s own', async () => {
    const other = document.createElement('mn-toast')
    other.setAttribute('data-something-else', 'yes')
    other.autoShow = false
    document.body.append(other)
    other.show()

    showCheckoutReturnToast(document, 'success', 'topup')
    showCheckoutResultToast(document, 'credited', 11_000_000)
    await until(() => document.body.querySelectorAll('mn-toast[data-checkout-return]').length === 0)

    expect(document.body.contains(other)).toBe(true)
    expect(other.hasAttribute('closing')).toBe(false)
  })

  it('has nothing to take the place of when the person already closed the first one', async () => {
    const onTheWay = showCheckoutReturnToast(document, 'success', 'topup')
    onTheWay.dismiss()
    await until(() => !document.body.contains(onTheWay))

    const credited = showCheckoutResultToast(document, 'credited', 11_000_000)
    expect(document.body.contains(credited)).toBe(true)
    expect(document.body.querySelectorAll('mn-toast')).toHaveLength(1)
  })
})
