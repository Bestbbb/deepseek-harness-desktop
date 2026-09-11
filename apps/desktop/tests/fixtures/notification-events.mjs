/** Private packaged-test event source; never included in application resources. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile, rename } from 'node:fs/promises'

export const inject = ['appReady', 'sessions', 'desktop']

/** Own a loopback event source and await actual native notify requests before answering the test. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const originalFetch = globalThis.fetch
    const notifications = new Set()
    const handlers = new Set()
    const notifyUrl = new URL('/v1/notify', config.bridgeEndpoint).href
    let closed = false
    // Each fixture runs in its own child process. Intercept only its exact native notification endpoint.
    globalThis.fetch = (input, init) => {
      const request = originalFetch(input, init)
      if (String(input) === notifyUrl) {
        notifications.add(request)
        void request.then(() => notifications.delete(request), () => notifications.delete(request))
      }
      return request
    }
    const server = createServer((request, response) => {
      if (closed || request.method !== 'POST' || request.headers['x-notification-fixture'] !== 'private-test'
        || !['/completed', '/error', '/child', '/restored', '/aborted'].includes(request.url)) {
        response.writeHead(400).end(); return
      }
      const handle = async () => {
        const parent = ctx.sessions.create()
        const session = request.url === '/child'
          ? ctx.sessions.create(undefined, { meta: { parentSession: parent.id } }) : parent
        const reason = request.url === '/error'
          ? { kind: 'error', error: { code: 'UNKNOWN', message: 'private fixture task details' } }
          : request.url === '/aborted' ? { kind: 'aborted', reason: { kind: 'legacy' } } : { kind: 'completed' }
        if (request.url === '/restored') {
          ctx.sessions.create(undefined, { seed: [{ ...parent.snapshotEvents()[0] },
            { type: 'turn/end', seq: 1, time: Date.now(), data: { turn: 1, reason } }] })
        } else session.append('turn/end', { turn: 1, reason })
        // NativeDesktopHost starts fetch synchronously from the post-commit observer; no sleep proves absence.
        await Promise.allSettled([...notifications])
        response.setHeader('content-type', 'application/json')
        response.end('{"committed":true}')
      }
      const running = handle().catch(() => { response.writeHead(500).end() })
      handlers.add(running)
      void running.then(() => handlers.delete(running))
    })
    let startup = Promise.resolve()
    const detach = ctx.appReady.onReady(() => {
      startup = (async () => {
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        await writeFile(`${config.resultFile}.pending`, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }))
        await rename(`${config.resultFile}.pending`, config.resultFile)
      })().catch(() => { ctx.logger.error('Notification fixture did not start') })
    })
    return async () => {
      closed = true
      detach()
      await startup
      globalThis.fetch = originalFetch
      if (server.listening) {
        const stopped = once(server, 'close')
        server.close(); server.closeAllConnections()
        await stopped
      }
      await Promise.allSettled([...handlers, ...notifications])
    }
  })
}
