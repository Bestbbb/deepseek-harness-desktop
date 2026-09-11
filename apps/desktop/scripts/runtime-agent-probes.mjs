/** Resolve the pinned provider dependencies at build time; never import or run either agent. */
import { createRequire } from 'node:module'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Record relocatable executable paths for the same dependency closure used by delegation.
 * @param {string} root - Directory containing every recorded runtime file.
 * @param {{codex: string, claude: string}} anchors - Provider entry files used for Node resolution.
 * @param {string} platform - Target platform matching the installed native payload.
 * @param {string} arch - Target CPU architecture.
 * @returns {Promise<{schemaVersion: number, codexWrapper: string, claudeExecutable: string}>} Validated relative paths.
 */
export async function agentProbeManifest(root, anchors, platform, arch) {
  const base = await realpath(root)
  const codex = createRequire(resolve(anchors.codex)).resolve('@openai/codex/package.json')
  const manifest = JSON.parse(await readFile(codex, 'utf8'))
  if (manifest.name !== '@openai/codex' || typeof manifest.bin?.codex !== 'string') throw new Error('Codex wrapper manifest is invalid')
  const sdk = createRequire(resolve(anchors.claude)).resolve('@anthropic-ai/claude-agent-sdk')
  const sdkManifest = JSON.parse(await readFile(join(dirname(sdk), 'package.json'), 'utf8'))
  const payloadName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  const payload = createRequire(sdk).resolve(`${payloadName}/package.json`)
  const payloadManifest = JSON.parse(await readFile(payload, 'utf8'))
  const expectedVersion = sdkManifest.optionalDependencies?.[payloadName]
  if (typeof expectedVersion !== 'string' || expectedVersion === ''
    || payloadManifest.name !== payloadName || payloadManifest.version !== expectedVersion) {
    throw new Error('Claude SDK native payload does not match the pinned SDK')
  }
  const confined = async (file) => {
    const actual = await realpath(file)
    const path = relative(base, actual)
    if (path === '' || isAbsolute(path) || path.split(sep).includes('..') || !(await stat(actual)).isFile()) {
      throw new Error('Agent executable must be a file inside the prepared runtime')
    }
    return path.split(sep).join('/')
  }
  return {
    schemaVersion: 1,
    codexWrapper: await confined(resolve(dirname(codex), manifest.bin.codex)),
    claudeExecutable: await confined(join(dirname(payload), platform === 'win32' ? 'claude.exe' : 'claude')),
  }
}
