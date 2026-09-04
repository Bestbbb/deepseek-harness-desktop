/** Desktop native builds refuse foreign hosts and select the bundled Node headers. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const helper = pathToFileURL(resolve(import.meta.dirname, '../apps/desktop/scripts/runtime-native.mjs')).href

function evaluate(body: string): ReturnType<typeof spawnSync> {
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import { assertNativeBuildHost, nativeBuildEnvironment } from ${JSON.stringify(helper)}; ${body}`,
  ], { encoding: 'utf8', timeout: 10_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return result
}

describe('desktop native build', () => {
  it('accepts the executing platform and architecture', () => {
    expect(evaluate('assertNativeBuildHost(process.platform, process.arch)').status).toBe(0)
  })

  it('rejects a foreign operating system or architecture', () => {
    for (const expression of [
      "assertNativeBuildHost(process.platform === 'win32' ? 'darwin' : 'win32', process.arch)",
      "assertNativeBuildHost(process.platform, process.arch === 'arm64' ? 'x64' : 'arm64')",
    ]) {
      const result = evaluate(expression)
      expect(result.status).toBe(1)
      expect(String(result.stderr)).toContain('Prepare native addons on the target platform')
    }
  })

  it('pins Node headers and architecture without mutating inherited configuration', () => {
    const result = evaluate(`
      const before = { npm_config_target: '24.14.1', npm_package_config_node_gyp_target: '24.14.1', npm_package_config_node_gyp_arch: 'x64', PATH: 'build-tools' };
      const after = nativeBuildEnvironment('22.22.0', 'arm64', before);
      console.log(JSON.stringify({ before, after }));
    `)
    expect(result.status).toBe(0)
    const value = JSON.parse(String(result.stdout)) as { before: Record<string, string>; after: Record<string, string> }
    expect(value.before).toEqual({
      npm_config_target: '24.14.1', npm_package_config_node_gyp_target: '24.14.1',
      npm_package_config_node_gyp_arch: 'x64', PATH: 'build-tools',
    })
    expect(value.after).toEqual({
      ...value.before, npm_config_target: '22.22.0', npm_config_arch: 'arm64',
      npm_package_config_node_gyp_target: '22.22.0', npm_package_config_node_gyp_arch: 'arm64',
    })
  })
})
