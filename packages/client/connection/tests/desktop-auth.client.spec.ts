import { afterEach, describe, expect, it } from 'vitest'
import { desktopAuthProtocols, withDesktopAuth } from '../src/desktop-auth.ts'

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__DSH_DESKTOP_AUTH_TOKEN__')
})

describe('desktop client authentication', () => {
  it('adds no carrier credentials outside the native WebView', () => {
    expect(withDesktopAuth().has('x-dsh-desktop-token')).toBe(false)
    expect(desktopAuthProtocols()).toEqual([])
  })

  it('adds the installed token to HTTP and WebSocket carriers', () => {
    Object.defineProperty(globalThis, '__DSH_DESKTOP_AUTH_TOKEN__', {
      value: 'desktop-token',
      configurable: true,
    })
    expect(withDesktopAuth({ accept: 'application/json' }).get('x-dsh-desktop-token')).toBe('desktop-token')
    expect(desktopAuthProtocols()).toEqual(['dsh-auth.desktop-token'])
  })
})
