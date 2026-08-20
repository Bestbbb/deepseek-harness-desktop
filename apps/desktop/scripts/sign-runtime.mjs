/** Sign nested Mach-O runtime code before Tauri seals the outer macOS app bundle. */

import { lstat, readdir } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = join(desktopDir, 'resources', 'runtime')
const platform = process.env.TAURI_ENV_PLATFORM ?? process.platform
const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '-'

if (platform !== 'darwin' && platform !== 'macos') {
  console.log(`desktop runtime signing skipped for ${platform}`)
  process.exit(0)
}

async function run(command, args, capture = false) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr?.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr })
      else reject(new Error(`${command} exited with ${code ?? signal}${stderr === '' ? '' : `: ${stderr}`}`))
    })
  })
}

async function candidates(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...await candidates(path))
      continue
    }
    if (!entry.isFile()) continue
    const mode = (await lstat(path)).mode
    if ((mode & 0o111) !== 0 || ['.node', '.dylib'].includes(extname(path))) result.push(path)
  }
  return result
}

async function isMachO(path) {
  const { stdout } = await run('/usr/bin/file', ['-b', path], true)
  return stdout.includes('Mach-O')
}

const nodeEntitlements = join(desktopDir, 'src-tauri', 'entitlements.node.plist')
const bundledNode = join(runtimeDir, 'node', 'node')
const macho = []
for (const path of await candidates(runtimeDir)) {
  if (await isMachO(path)) macho.push(path)
}
if (macho.length === 0) throw new Error(`No Mach-O runtime code found under ${runtimeDir}`)

for (const path of macho) {
  const args = ['--force', '--sign', identity]
  if (identity === '-') args.push('--timestamp=none')
  else args.push('--timestamp', '--options', 'runtime')
  if (path === bundledNode) args.push('--entitlements', nodeEntitlements)
  args.push(path)
  await run('/usr/bin/codesign', args)
  await run('/usr/bin/codesign', ['--verify', '--strict', path])
}

console.log(`signed ${macho.length} nested Mach-O runtime file(s) with identity ${JSON.stringify(identity)}`)
