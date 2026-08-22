/** Cross-platform production-closure smoke test for the bundled desktop runtime. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const desktopDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtime = join(desktopDir, 'resources/runtime')
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
const entry = join(runtime, 'app/node_modules/@deepseek-ai/dsh/lib/bin.js')
const patch = join(runtime, 'desktop.cordis.yml')
const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
const renderedPatch = join(home, 'desktop.cordis.yml')
const authToken = 'desktop-smoke-token'
const requestBody = JSON.stringify({
  type: 'client-request',
  rpcId: 'desktop-runtime-smoke',
  method: 'host.describe',
  payload: {},
})
const logs = []
let patchSource = await readFile(patch, 'utf8')
for (const [placeholder, modulePath] of [
  ['__DSH_DESKTOP_NATIVE_ENTRY__', join(runtime, 'app/node_modules/@deepseek-ai/dsh-desktop-native/lib/index.js')],
]) patchSource = patchSource.replaceAll(placeholder, JSON.stringify(pathToFileURL(modulePath).href))
await writeFile(renderedPatch, patchSource)
const child = spawn(node, [entry, 'web', '--patch', renderedPatch, '--port', '0', '--no-open'], {
  cwd: join(runtime, 'app'),
  env: {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_AUTH_TOKEN: authToken,
    DSH_DESKTOP_BRIDGE_URL: 'http://127.0.0.1:9',
    DSH_DESKTOP_BRIDGE_TOKEN: 'desktop-bridge-smoke-token',
    DSH_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

function readLines(stream) {
  const reader = createInterface({ input: stream })
  reader.on('line', (line) => {
    logs.push(line)
    if (logs.length > 80) logs.shift()
  })
  return reader
}

const stdout = readLines(child.stdout)
const stderr = readLines(child.stderr)

function readyOrigin() {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Harness runtime readiness timed out.\n${logs.join('\n')}`))
    }, 60_000)
    const onLine = (line) => {
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(line)
      if (match === null) return
      clearTimeout(timeout)
      stdout.off('line', onLine)
      resolveReady(match[1])
    }
    stdout.on('line', onLine)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`Harness runtime exited before readiness (${code ?? signal}).\n${logs.join('\n')}`))
    })
  })
}

function webSocketOpened(url, protocols) {
  return new Promise((resolveSocket, reject) => {
    const socket = protocols.length === 0 ? new WebSocket(url) : new WebSocket(url, protocols)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error(`WebSocket timed out: ${url}`))
    }, 10_000)
    socket.addEventListener('open', () => {
      clearTimeout(timeout)
      resolveSocket(socket)
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket was rejected: ${url}`))
    }, { once: true })
  })
}

async function fetchWhenListening(url, init) {
  const deadline = Date.now() + 60_000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Harness runtime exited before opening ${url} (${child.exitCode ?? child.signalCode}).\n${logs.join('\n')}`,
      )
    }
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error
      await new Promise(resolve => { setTimeout(resolve, 50) })
    }
  }
  throw new Error(`Harness runtime did not open ${url}: ${String(lastError)}\n${logs.join('\n')}`)
}

try {
  const origin = await readyOrigin()
  const endpoint = new URL('/api/host.describe', origin)
  const unauthorized = await fetchWhenListening(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody,
  })
  if (unauthorized.status !== 403) {
    throw new Error(`Unauthenticated desktop RPC returned HTTP ${unauthorized.status}, expected 403`)
  }
  const authorized = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-desktop-token': authToken,
    },
    body: requestBody,
  })
  if (!authorized.ok) {
    throw new Error(`Authenticated desktop RPC returned HTTP ${authorized.status}: ${await authorized.text()}`)
  }
  const body = await authorized.json()
  if (body?.result?.ok !== true) {
    throw new Error(`host.describe did not return an ok result: ${JSON.stringify(body)}`)
  }
  const socketOrigin = origin.replace(/^http:/, 'ws:')
  const protocol = `dsh-auth.${authToken}`
  const sockets = await Promise.all([
    webSocketOpened(`${socketOrigin}/api/events.mux`, [protocol]),
    webSocketOpened(`${socketOrigin}/api/events.host`, [protocol]),
  ])
  for (const socket of sockets) socket.close()
  console.log(`desktop runtime smoke passed: ${origin}`)
} finally {
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => { child.once('exit', resolveExit) }),
    new Promise(resolveTimeout => { setTimeout(resolveTimeout, 5_000) }),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
  stdout.close()
  stderr.close()
  await rm(home, { recursive: true, force: true })
}
