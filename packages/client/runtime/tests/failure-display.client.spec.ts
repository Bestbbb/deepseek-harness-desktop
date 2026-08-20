import { describe, expect, it } from 'vitest'
import { displayFailureMessage } from '../src/client/sessions/failure-display.ts'

describe('displayFailureMessage', () => {
  it('never projects credential-bearing provider diagnostics', () => {
    expect(displayFailureMessage({ code: 'MISSING_CREDENTIAL', message: 'DEEPSEEK_API_KEY missing' }))
      .toBe('API key is required')
    expect(displayFailureMessage({ code: 'INVALID_CREDENTIAL', message: 'sk-secret is malformed' }))
      .toBe('API key is invalid')
    expect(displayFailureMessage({ code: 'AUTH', message: 'provider echoed ds-secret' }))
      .toBe('API key is invalid')
  })

  it('preserves non-credential failure messages', () => {
    expect(displayFailureMessage({ code: 'PLUGIN', message: 'plugin exploded' })).toBe('plugin exploded')
  })
})
