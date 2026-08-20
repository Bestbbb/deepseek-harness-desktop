import { describe, expect, it } from 'vitest'
import {
  isDesktopAuthenticatedRequest,
  isDesktopAuthenticatedUpgrade,
} from '../src/desktop-auth-host.ts'

const TOKEN = 'a'.repeat(43)

describe('desktop connection authentication', () => {
  it('preserves ordinary Web requests when no token is configured', () => {
    expect(isDesktopAuthenticatedRequest({ headers: {} }, undefined)).toBe(true)
    expect(isDesktopAuthenticatedUpgrade({ headers: {} }, undefined)).toBe(true)
  })

  it('requires the exact HTTP bearer token', () => {
    expect(isDesktopAuthenticatedRequest({ headers: { 'x-dsh-desktop-token': TOKEN } }, TOKEN)).toBe(true)
    expect(isDesktopAuthenticatedRequest({ headers: {} }, TOKEN)).toBe(false)
    expect(isDesktopAuthenticatedRequest({ headers: { 'x-dsh-desktop-token': `${TOKEN}x` } }, TOKEN)).toBe(false)
  })

  it('requires the exact token-bearing WebSocket subprotocol', () => {
    expect(isDesktopAuthenticatedUpgrade({
      headers: { 'sec-websocket-protocol': `other, dsh-auth.${TOKEN}` },
    }, TOKEN)).toBe(true)
    expect(isDesktopAuthenticatedUpgrade({
      headers: { 'sec-websocket-protocol': 'other' },
    }, TOKEN)).toBe(false)
  })
})
