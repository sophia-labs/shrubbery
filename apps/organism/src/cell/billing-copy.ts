/**
 * The vocabulary of Sophia's billing surfaces: the numbers Vera ruled on
 * (2026-09-29), the one money formatter, and the strings whose wording is a
 * commitment to the person paying. One home, so a number the copy states is the
 * same number everywhere it is stated.
 *
 * The strings live here, not scattered through views, so a reviewer can read
 * every promise the billing UI makes in one place. Tests spell the strings out
 * literally rather than importing them: importing would pin nothing.
 */

import { localeSource } from '@shrubbery/nucleus'
import { formatFeePercent } from '@shrubbery/runtime/chat-services/credits-facts'

// The service fee is NOT a constant here. Vera, 2026-10-03: it is the backend's to say (the balance
// answer's `feeBps`: 15% today, 20% after the flip), so the copy that states it takes it as an argument and
// leaves the sentence out when the backend has not said: a number the SPA cannot read is never guessed.

/** What an account with no ledger row yet is worth: the lazily created starter credit. */
export const STARTER_CREDIT_MICRO_USD = 1_000_000
export const STARTER_CREDIT_LABEL = '$1.00 starter credit'

/** What the Billing section is for now that credits, not plans, are what is on sale. */
export const BILLING_DESCRIPTION = 'Your credit balance and how to add credits.'

/** The fallback Usage summary's one note (E-billing-enforce.md 4.5.5, hosted-billing.ts:156). */
export const USAGE_SUMMARY_NOTE =
  'Costs shown here are deducted from your credit balance unless the call used your own provider key. Earlier history was imported and was not deducted from this balance.'

/**
 * The Usage explorer's paragraph (E-billing-enforce.md 4.5.5, usage-explorer-view.ts), with the fee the
 * backend charges (`feePercent`, in percent) stated; with none named, the same words without it.
 */
export function usageExplorerNote(feePercent: number | null): string {
  const cost = feePercent === null
    ? 'at the cost shown'
    : `at the cost shown: the model's price plus a ${formatFeePercent(feePercent)}% service fee`
  return `Calls Sophia paid for are deducted from your credits ${cost}. Calls that ran on your own provider key are not deducted. History imported from the earlier service is shown for reference and was not deducted from this balance.`
}

/**
 * What Add credits promises about the price and the terms of the money: the fee the backend charges
 * (`feePercent`, in percent), and that credits are prepaid and non-refundable. With no fee named, the
 * second sentence alone.
 */
export function feeNote(feePercent: number | null): string {
  return feePercent === null
    ? 'Credits are prepaid and non-refundable.'
    : `You pay the model's price plus a ${formatFeePercent(feePercent)}% service fee. Credits are prepaid and non-refundable.`
}

/** Micro-dollars as US dollars; 'Unavailable' for anything that is not a safe integer. */
export function formatMicroUsd(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? new Intl.NumberFormat(localeSource.get(), { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(value / 1_000_000)
    : 'Unavailable'
}
