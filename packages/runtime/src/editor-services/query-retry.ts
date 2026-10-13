/** Retrying reads the transport marks retryable (a cell still waking). */

/**
 * A read that the transport marks RETRYABLE (a cell still waking: HTTP 503
 * `cell_upstream_unavailable`, `"retryable":true`) is retried twice before the
 * block shows an error — a cold cell otherwise leaves a block empty on open.
 */
export function isRetryableQueryError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /"retryable"\s*:\s*true|\b503\b|cell_upstream_unavailable/.test(message)
}

export async function runWithRetry<T>(attempt: () => Promise<T>, retries = 2, delayMs = 700): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt()
    } catch (cause) {
      if (tries >= retries || !isRetryableQueryError(cause)) throw cause
      await new Promise(resolve => setTimeout(resolve, delayMs * (tries + 1)))
    }
  }
}

