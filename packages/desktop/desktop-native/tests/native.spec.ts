import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SessionStore, SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import NativeDesktopHost, { resolveConfig } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop native bridge provider', () => {
  it('keeps turn notifications opt-in outside the desktop overlay', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(NativeDesktopHost, { endpoint: 'http://127.0.0.1:43123', token: 'token' })
      ctx.sessions.create().append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('contains notification failure without exposing error details or rejecting the committed turn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private native error')))
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(NativeDesktopHost, {
        endpoint: 'http://127.0.0.1:43123', token: 'token', notifyOnTurnEnd: true,
      })
      const session = ctx.sessions.create()
      expect(() => session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })).not.toThrow()
      await expect.poll(() => warn.mock.calls.length).toBe(1)
      expect(warn).toHaveBeenCalledWith('desktop-native: background notification could not be delivered')
      expect(session.snapshotEvents().at(-1)?.type).toBe('turn/end')
    } finally {
      await ctx.fiber.dispose()
      warn.mockRestore()
    }
  })

  it('notifies only live top-level completion and failure, with no task contents', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response('{"ok":true}')))
    vi.stubGlobal('fetch', fetch)
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      const fiber = ctx.plugin(NativeDesktopHost, {
        endpoint: 'http://127.0.0.1:43123', token: 'bridge-secret', notifyOnTurnEnd: true,
      })
      await fiber
      const session = ctx.sessions.create()
      const child = ctx.sessions.create(undefined, { meta: { parentSession: session.id } })
      child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const ignored: TurnEndReason[] = [
        { kind: 'blocked' }, { kind: 'max-tokens' }, { kind: 'interrupted' },
        { kind: 'aborted', reason: { kind: 'legacy' } },
      ]
      for (const reason of ignored) session.append('turn/end', { turn: 1, reason })
      expect(fetch).not.toHaveBeenCalled()
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      session.append('turn/end', { turn: 3, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private failure' } } })
      await expect.poll(() => fetch.mock.calls.length).toBe(2)
      expect(fetch.mock.calls.map(call => call[1]?.body)).toEqual([
        JSON.stringify({ title: 'Harness Desktop', body: 'Task finished. Open Harness Desktop to review.', backgroundOnly: true }),
        JSON.stringify({ title: 'Harness Desktop', body: 'Task failed. Open Harness Desktop to review.', backgroundOnly: true }),
      ])
      ctx.sessions.create(SessionId('restored'), { seed: session.snapshotEvents() })
      expect(fetch).toHaveBeenCalledTimes(2)
      await fiber.dispose()
      session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([true, false])('scopes desktop orientation to the provider lifetime (prompt first: %s)', async (promptFirst) => {
    const ctx = new Context()
    try {
      if (promptFirst) await ctx.plugin(SystemPrompt)
      const fiber = ctx.plugin(NativeDesktopHost, {
        endpoint: 'http://127.0.0.1:43123', token: 'bridge-secret',
      })
      await fiber
      if (!promptFirst) await ctx.plugin(SystemPrompt)
      await expect.poll(async () => renderPrompt(await ctx.systemPrompt.assemble()))
        .toContain('Harness Desktop, a desktop application built on DeepSeek Harness')
      const prompt = renderPrompt(await ctx.systemPrompt.assemble())
      expect(prompt).not.toContain('bridge-secret')
      expect(prompt).not.toContain('43123')
      const removePersona = ctx.systemPrompt.section({
        name: 'fixture:persona', order: 0, text: 'A complete custom persona.', complete: true,
      })
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('A complete custom persona.')
      removePersona()
      await fiber.dispose()
      expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Harness Desktop')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('accepts only an exact IPv4 loopback HTTP origin', () => {
    expect(resolveConfig({ endpoint: 'http://127.0.0.1:43123', token: 'token' }))
      .toEqual({ endpoint: 'http://127.0.0.1:43123', token: 'token', timeoutMs: 5_000, notifyOnTurnEnd: false })
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
    const statusUrl = status?.[0]
    const statusHref = typeof statusUrl === 'string'
      ? statusUrl
      : statusUrl instanceof URL
        ? statusUrl.href
        : statusUrl?.url
    expect(statusHref).toBe('http://127.0.0.1:43123/v1/status')
    expect(status?.[1]?.headers).toMatchObject({ 'x-dsh-desktop-bridge-token': 'bridge-secret' })
    const notification = fetch.mock.calls[1]
    const notificationBody = notification?.[1]?.body
    if (typeof notificationBody !== 'string') throw new TypeError('expected the notification body to be a string')
    expect(notificationBody).toBe('{"title":"Finished","body":"The task completed."}')
    expect(notificationBody).not.toContain('bridge-secret')
    await host.setAutostart(true)
    expect(fetch.mock.calls[2]?.[1]?.body).toBe('{"enabled":true}')
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

  it.each([new Error('offline'), 'offline'])('reports a rejected bridge transport (%s)', async (failure) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    const ctx = new Context()
    try {
      const host = new NativeDesktopHost(ctx, {
        endpoint: 'http://127.0.0.1:43123', token: 'bridge-secret',
      })
      await expect(host.status()).rejects.toThrow('desktop-native: native operation failed: offline')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
