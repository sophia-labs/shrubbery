import type { ShrubberyContract } from '@shrubbery/nucleus'

type CellAuthContract = Pick<ShrubberyContract, 'auth' | 'runtime'>

/**
 * Resolve credentials for each request. Hosted identity comes exclusively from
 * the gateway-verified bearer: X-User-ID is neither CORS-admitted nor trusted
 * there. A local loopback cell still consumes the session identity header.
 * Callers retain their content/accept headers, never a stale supplied identity.
 */
export function cellAuthHeaders(
  contract: CellAuthContract,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const headers = { ...extra }
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'x-user-id') delete headers[name]
  }
  const token = contract.auth.token()
  if (token) headers.Authorization = `Bearer ${token}`
  if (contract.runtime.mode?.() === 'local') {
    const userId = contract.auth.userId()
    if (userId) headers['X-User-ID'] = userId
  }
  return headers
}
