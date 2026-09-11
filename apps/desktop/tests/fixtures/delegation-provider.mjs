/** Controlled external provider for the packaged marketplace smoke; no account or model access. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile, rename } from 'node:fs/promises'

export const inject = ['appReady', 'subagents', 'jobs']

/** Own provider runs and a private loopback controller through complete disposal. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const runs = []
    const handlers = new Set()
    let closing = false
    const detachProvider = ctx.subagents.registerProvider({
      name: 'marketplace-fixture', inheritsParentContext: false,
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      start: async (request) => {
        assert(!closing)
        const result = Promise.withResolvers()
        const cleanup = Promise.withResolvers()
        const state = { request, result, cleanup, disposed: false }
        runs.push(state)
        const abort = () => result.resolve({ stopReason: 'aborted', output: [] })
        if (request.signal.aborted) abort()
        else request.signal.addEventListener('abort', abort, { once: true })
        return { id: `fixture-child-${runs.length}`, result: result.promise,
          dispose: async () => {
            await cleanup.promise
            request.signal.removeEventListener('abort', abort)
            state.disposed = true
          } }
      },
    })
    const snapshot = () => runs.map(run => ({
      prompt: run.request.prompt, owner: run.request.parent.id,
      aborted: run.request.signal.aborted, disposed: run.disposed,
    }))
    const server = createServer((request, response) => {
      if (closing || request.headers['x-delegation-fixture'] !== 'private-test') { response.writeHead(403).end(); return }
      const handle = async () => {
        if (request.method === 'POST' && request.url === '/complete') {
          const run = runs[0]
          assert(run)
          const job = ctx.jobs.list(run.request.parent).find(job => job.kind === 'subagent')
          assert(job)
          // A real waiting consumer claims completion before the controlled provider settles, avoiding model inference.
          const settled = ctx.jobs.wait(job.id, 10_000, run.request.parent)
          run.result.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Packaged delegation result' }] })
          run.cleanup.resolve()
          assert.equal((await settled).status, 'completed')
        } else if (request.method === 'POST' && request.url === '/cleanup') {
          const run = runs[1]
          assert(run?.request.signal.aborted)
          run.cleanup.resolve()
        } else if (request.method !== 'GET' || request.url !== '/state') {
          response.writeHead(404).end(); return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(snapshot()))
      }
      const running = handle().catch(() => { response.writeHead(500).end() })
      handlers.add(running)
      void running.then(() => handlers.delete(running))
    })
    let startup = Promise.resolve()
    const detachReady = ctx.appReady.onReady(() => {
      startup = (async () => {
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        await writeFile(`${config.resultFile}.pending`, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }), { flag: 'wx' })
        await rename(`${config.resultFile}.pending`, config.resultFile)
      })().catch(() => { ctx.logger.error('Delegation fixture did not start') })
    })
    return async () => {
      closing = true
      detachReady(); detachProvider()
      for (const run of runs) {
        run.result.resolve({ stopReason: 'aborted', output: [] })
        run.cleanup.resolve()
      }
      await startup
      if (server.listening) {
        const stopped = once(server, 'close')
        server.close(); server.closeAllConnections()
        await stopped
      }
      await Promise.allSettled(handlers)
    }
  })
}
