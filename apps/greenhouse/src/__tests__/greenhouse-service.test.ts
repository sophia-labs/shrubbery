import { describe, expect, it } from 'vitest'

import { readGreenhouseConfig } from '../greenhouse-service.js'

describe('readGreenhouseConfig', () => {
  it('reads explicit agent address from the URL agent param', () => {
    const config = readGreenhouseConfig('?agent=beta&agentId=ignored')

    expect(config.agentId).toBe('beta')
  })

  it('falls back to the configured default agent address', () => {
    const config = readGreenhouseConfig('')

    expect(config.agentId).toBe('learner-1')
  })
})
