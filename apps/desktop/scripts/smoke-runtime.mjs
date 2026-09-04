/** Verify the packaged Web profile, authentication, Session upgrades, and reconnects without provider keys. */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const desktopDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtime = resolve(process.env.DSH_DESKTOP_RUNTIME_OUTPUT ?? join(desktopDir, 'resources/runtime'))
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
const entry = join(runtime, 'app/node_modules/@deepseek-ai/dsh/lib/bin.js')
const requireRuntime = createRequire(join(runtime, 'app/package.json'))
const { WebSocket } = requireRuntime('ws')
const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
const renderedPatch = join(home, 'desktop.cordis.yml')
const logs = []
const sockets = new Set()
let child
let stdout
let stderr

function readLines(stream) {
  const reader = createInterface({ input: stream })
  reader.on('line', line => {
    logs.push(line.replace(/([?&]token=)[^\s&#]+/gu, '$1<redacted>'))
    if (logs.length > 80) logs.shift()
  })
  return reader
}

function readyUrl() {
  return new Promise((resolveReady, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      stdout.off('line', onLine)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const onLine = line => {
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\S*)/u.exec(line)
      if (match === null) return
      cleanup()
      resolveReady(new URL(match[1]))
    }
    const onError = error => { cleanup(); reject(error) }
    const onExit = (code, signal) => onError(new Error(
      'Harness exited before readiness (' + (code ?? signal) + ').\n' + logs.join('\n'),
    ))
    const timeout = setTimeout(() => onError(new Error(
      'Harness readiness timed out.\n' + logs.join('\n'),
    )), 60_000)
    stdout.on('line', onLine)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function fetchWhenListening(url, init = {}) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Harness exited before listening.\n' + logs.join('\n'))
    }
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
    } catch {
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 50) })
    }
  }
  throw new Error('Harness did not start listening.\n' + logs.join('\n'))
}

async function rpc(origin, endpoint, cookie, args = {}) {
  return fetchWhenListening(new URL('/api/' + endpoint, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'smoke-' + endpoint, method: endpoint, payload: { args },
    }),
  })
}

function verifyStream(origin, cookie) {
  return new Promise((resolveStream, reject) => {
    const socket = new WebSocket(origin.replace(/^http/u, 'ws') + '/api/remote.mux', {
      headers: cookie === undefined ? {} : { cookie },
    })
    sockets.add(socket)
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      error === undefined ? resolveStream() : reject(error)
      socket.terminate()
    }
    const timeout = setTimeout(() => finish(new Error('Remote event stream timed out')), 10_000)
    socket.once('close', () => {
      sockets.delete(socket)
      finish(new Error('Remote event stream closed before readiness'))
    })
    socket.once('error', finish)
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      cookie === undefined && response.statusCode === 401
        ? finish()
        : finish(new Error('Remote stream rejected with HTTP ' + response.statusCode))
    })
    socket.once('open', () => {
      if (cookie === undefined) {
        finish(new Error('Unauthenticated WebSocket was accepted'))
        return
      }
      socket.send(JSON.stringify({
        type: 'open', streamId: 'desktop-smoke', endpoint: '$events', payload: { args: {} },
      }))
    })
    socket.on('message', data => {
      if (settled) return
      try {
        const frame = JSON.parse(data.toString())
        assert.equal(frame.type, 'item')
        assert.equal(frame.streamId, 'desktop-smoke')
        assert.equal(frame.value.type, 'ready')
        assert.equal(typeof frame.value.clientId, 'string')
        finish()
      } catch (error) {
        finish(error)
      }
    })
  })
}

function startRuntime(port) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(name)))
  child = spawn(node, [entry, 'web', '--patch', renderedPatch, '--port', String(port), '--no-open'], {
    cwd: join(runtime, 'app'),
    env: {
      ...env, DSH_HOME: home,
      DSH_DESKTOP_BRIDGE_URL: 'http://127.0.0.1:9',
      DSH_DESKTOP_BRIDGE_TOKEN: 'desktop-bridge-smoke-token',
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  stdout = readLines(child.stdout)
  stderr = readLines(child.stderr)
}

async function stopRuntime(signal = 'SIGTERM') {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const stopping = child
    const exited = once(stopping, 'exit')
    stopping.kill(signal)
    const forced = setTimeout(() => stopping.kill('SIGKILL'), 5_000)
    try {
      await exited
    } finally {
      clearTimeout(forced)
    }
  }
  stdout?.close()
  stderr?.close()
}

// Physical released-format records are independent of the installed writer.
// Encoding them with the current persistence API would skip the upgrade path.
async function seedLegacySession(version) {
  const id = 'desktop-upgrade-v' + version
  // This historical workspace is metadata only; the smoke never runs a task there.
  const cwd = process.platform === 'win32' ? 'C:\\dsh-desktop-upgrade-fixture' : '/dsh-desktop-upgrade-fixture'
  const project = process.platform === 'win32' ? '--C-dsh-desktop-upgrade-fixture--' : '--dsh-desktop-upgrade-fixture--'
  const dir = join(home, 'sessions', project, id)
  const header = { type: 'session', version, id, createdAt: 1, cwd, delegationDepth: 0 }
  const question = { id: id + '-user', role: 'user', content: [{ type: 'text', text: 'Retain this question.' }], source: { kind: 'user' } }
  const answer = { id: id + '-assistant', role: 'assistant', content: [{ type: 'text', text: 'Retained answer.' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', data: question, surfaceOp: 'append' },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Retained answer.' } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: answer }, sourceEventSeqs: [3, 4], surfaceOp: 'append' },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((event, seq) => ({ ...event, seq, time: 100 + seq }))
  const expected = events.filter(event => event.type !== 'assistant/chunk').map((event, seq) => {
    if (event.type !== 'assistant/message') return { ...event, seq }
    return {
      type: event.type, seq, time: event.time, surfaceOp: 'append',
      data: {
        turn: 1, step: 1, message: answer,
        stream: [
          { type: 'text-chunks', time0: 103, index: 0, dt: [], texts: ['Retained answer.'] },
          { type: 'chunk', time: 104, chunk: { type: 'finish', reason: { kind: 'stop' } } },
        ],
      },
    }
  })
  const encode = rows => zstdCompressSync(rows.map(row => JSON.stringify(row) + '\n').join(''), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  })
  const source = Buffer.concat([encode([header]), encode(events)])
  const sourcePath = join(dir, version === 0 ? 'session.jsonl.zstd' : 'session.v1.jsonl.zstd')
  await mkdir(dir, { recursive: true })
  await writeFile(sourcePath, source, { flag: 'wx' })
  return { id, dir, header, sourcePath, source, expected }
}

async function verifyLegacySession(origin, cookie, fixture) {
  const response = await rpc(origin, 'session/page', cookie, {
    request: { address: { kind: 'session', sessionId: fixture.id }, throughSeq: fixture.expected.length - 1, maxMessages: 20 },
  })
  assert.equal(response.status, 200, fixture.id)
  const body = await response.json()
  assert.equal(body.result?.ok, true, fixture.id + ': ' + JSON.stringify(body.result))
  assert.equal(body.result.value.hasMore, false)
  assert.deepEqual(body.result.value.records, fixture.expected.map(event => ({ type: 'event', event })))
  assert.deepEqual(await readFile(fixture.sourcePath), fixture.source, 'released Session source must remain byte-identical')
  const current = await readFile(join(fixture.dir, 'session.v2.jsonl.zstd'))
  const frames = []
  for (let offset = 0; offset < current.length;) {
    // Node's decoder consumes one frame; the log contains a header plus append frames.
    const { buffer, engine } = zstdDecompressSync(current.subarray(offset), { info: true })
    assert.ok(engine.bytesWritten > 0 && engine.bytesWritten <= current.length - offset)
    frames.push(buffer)
    offset += engine.bytesWritten
  }
  const rows = Buffer.concat(frames).toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(rows, [{ ...fixture.header, version: 2, isSeeded: false }, ...fixture.expected])
  return current
}

try {
  const patch = (await readFile(join(runtime, 'desktop.cordis.yml'), 'utf8')).replaceAll(
    '__DSH_DESKTOP_NATIVE_ENTRY__',
    JSON.stringify(pathToFileURL(join(runtime, 'app/node_modules/@deepseek-ai/dsh-desktop-native/lib/index.js')).href),
  )
  await writeFile(renderedPatch, patch)
  const legacy = await Promise.all([0, 1].map(seedLegacySession))
  startRuntime(0)
  const url = await readyUrl()
  assert.match(url.searchParams.get('token') ?? '', /^[A-Za-z0-9_-]{43}$/u)
  assert.equal((await fetchWhenListening(url.origin)).status, 401)
  assert.equal((await rpc(url.origin, 'settings/describe')).status, 401)
  await verifyStream(url.origin)

  const exchange = await fetchWhenListening(url, { redirect: 'manual' })
  assert.equal(exchange.status, 303)
  assert.equal(exchange.headers.get('location'), '/')
  const setCookie = exchange.headers.get('set-cookie') ?? ''
  assert.ok(setCookie.includes('HttpOnly'))
  assert.ok(setCookie.includes('SameSite=Strict'))
  const cookie = setCookie.split(';', 1)[0]
  const html = await fetchWhenListening(url.origin, { headers: { cookie } })
  assert.equal(html.status, 200)
  assert.match(await html.text(), /<html/iu)

  for (const endpoint of ['settings/describe', 'llm/listProviders', 'session/list']) {
    const args = endpoint === 'session/list' ? { _request: {} } : {}
    const response = await rpc(url.origin, endpoint, cookie, args)
    assert.equal(response.status, 200, endpoint)
    const body = await response.json()
    assert.equal(body.rpcId, 'smoke-' + endpoint)
    assert.equal(body.result?.ok, true, endpoint + ': ' + JSON.stringify(body.result))
  }
  await verifyStream(url.origin, cookie)
  const migrated = []
  for (const fixture of legacy) migrated.push(await verifyLegacySession(url.origin, cookie, fixture))
  await stopRuntime('SIGKILL')
  startRuntime(url.port)
  const restarted = await readyUrl()
  assert.equal(restarted.origin, url.origin)
  assert.ok(restarted.searchParams.get('token') !== url.searchParams.get('token'), 'restart must rotate the launch token')
  assert.equal((await fetchWhenListening(restarted.origin)).status, 401)
  const resumed = await rpc(restarted.origin, 'settings/describe', cookie)
  assert.equal(resumed.status, 200, 'the existing cookie must survive runtime restart')
  assert.equal((await resumed.json()).result?.ok, true)
  await verifyStream(restarted.origin, cookie)
  for (const [index, fixture] of legacy.entries()) {
    assert.deepEqual(await verifyLegacySession(restarted.origin, cookie, fixture), migrated[index], 'reopening must reuse the committed current generation')
  }
  console.log('desktop runtime smoke passed: ' + url.origin + ' (cookie login, RPC, models, v0/v1 Session upgrades, event stream, restart reconnect)')
} finally {
  for (const socket of sockets) socket.terminate()
  await stopRuntime()
  await rm(home, { recursive: true, force: true })
}
