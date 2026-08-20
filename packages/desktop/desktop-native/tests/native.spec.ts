import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import NativeDesktopHost, { resolveConfig } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop native bridge provider', () => {
  it('accepts only an exact IPv4 loopback HTTP origin', () => {
    expect(resolveConfig({ endpoint: 'http://127.0.0.1:43123', token: 'token' }))
      .toEqual({ endpoint: 'http://127.0.0.1:43123', token: 'token', timeoutMs: 5_000 })
    for (const endpoint of [
      'https://127.0.0.1:43123',
      'http://localhost:43123',
      'http://127.0.0.1:43123/path',
      'http://127.0.0.1',
    ]) {
      expect(() => resolveConfig({ endpoint, token: 'token' })).toThrow(/127\.0\.0\.1/)
    }
    expect(() => resolveConfig({ endpoint: 'http://127.0.0.1:43123', token: '' })).toThrow(/must not be empty/)
  })

  it('authenticates every allowlisted native operation without exposing the token in the body', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })))
    vi.stubGlobal('fetch', fetch)
    const ctx = new Context()
    const host = new NativeDesktopHost(ctx, {
      endpoint: 'http://127.0.0.1:43123',
      token: 'bridge-secret',
    })
    await expect(host.status()).resolves.toEqual({ available: true })
    await host.notify({ title: 'Finished', body: 'The task completed.' })
    const status = fetch.mock.calls[0]
    expect(String(status?.[0])).toBe('http://127.0.0.1:43123/v1/status')
    expect(status?.[1]?.headers).toMatchObject({ 'x-dsh-desktop-bridge-token': 'bridge-secret' })
    const notification = fetch.mock.calls[1]
    expect(notification?.[1]?.body).toBe('{"title":"Finished","body":"The task completed."}')
    expect(String(notification?.[1]?.body)).not.toContain('bridge-secret')
  })

  it('turns a bridge HTTP rejection into a stable operation failure', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('', { status: 403 }))))
    const ctx = new Context()
    const host = new NativeDesktopHost(ctx, {
      endpoint: 'http://127.0.0.1:43123',
      token: 'bridge-secret',
    })
    await expect(host.show()).rejects.toThrow('HTTP 403')
  })
})
