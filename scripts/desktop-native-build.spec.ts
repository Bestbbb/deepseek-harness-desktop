/** Desktop native builds refuse foreign hosts and select the bundled Node headers. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const helper = pathToFileURL(resolve(import.meta.dirname, '../apps/desktop/scripts/runtime-native.mjs')).href
const desktopRequire = createRequire(resolve(import.meta.dirname, '../apps/desktop/package.json'))

function evaluate(body: string, timeout = 10_000): ReturnType<typeof spawnSync> {
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import { assertNativeBuildHost, nativeBuildEnvironment, rebuildNativePackage } from ${JSON.stringify(helper)}; ${body}`,
  ], {
    encoding: 'utf8', timeout,
    env: Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(name))),
  })
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
      const before = { npm_config_target: '24.14.1', npm_package_config_node_gyp_target: '24.14.1', npm_package_config_node_gyp_arch: 'x64', npm_config_node_gyp: 'missing-builder.js', PATH: 'build-tools' };
      const after = nativeBuildEnvironment('22.22.0', 'arm64', before);
      console.log(JSON.stringify({ before, after }));
    `)
    expect(result.status).toBe(0)
    const value = JSON.parse(String(result.stdout)) as { before: Record<string, string>; after: Record<string, string> }
    expect(value.before).toEqual({
      npm_config_target: '24.14.1', npm_package_config_node_gyp_target: '24.14.1',
      npm_package_config_node_gyp_arch: 'x64', npm_config_node_gyp: 'missing-builder.js', PATH: 'build-tools',
    })
    expect(value.after).toEqual({
      ...value.before, npm_config_target: '22.22.0', npm_config_arch: 'arm64',
      npm_package_config_node_gyp_target: '22.22.0', npm_package_config_node_gyp_arch: 'arm64',
      npm_config_node_gyp: desktopRequire.resolve('node-gyp/bin/node-gyp.js'),
    })
  })

  it('runs the installed build lifecycle with the desktop-owned node-gyp', () => {
    const result = evaluate(`
      import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-gyp-'));
      try {
        writeFileSync(join(root, 'package.json'), JSON.stringify({
          name: 'desktop-gyp-probe', version: '1.0.0', private: true,
          scripts: {
            preinstall: 'node -p "JSON.stringify({stage:1})"',
            install: 'node-gyp --version',
            postinstall: 'node -p "JSON.stringify({stage:3})"',
          },
        }));
        process.env.npm_config_node_gyp = join(root, 'missing-builder.js');
        await rebuildNativePackage(root, '22.22.0', process.arch);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    `, 20_000)
    expect(result.status).toBe(0)
    expect(String(result.stdout)).toMatch(/\{"stage":1\}[\s\S]*\nv12\.4\.0\s*[\s\S]*\{"stage":3\}/)
  })

  it('rejects an install failure without running postinstall', () => {
    const result = evaluate(`
      import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-gyp-failure-'));
      try {
        writeFileSync(join(root, 'package.json'), JSON.stringify({
          name: 'desktop-gyp-failure', version: '1.0.0', private: true,
          scripts: {
            install: 'node -e "process.exit(7)"',
            postinstall: 'node -p "JSON.stringify({unexpected:3})"',
          },
        }));
        try { await rebuildNativePackage(root, '22.22.0', process.arch); }
        catch (error) { console.log(JSON.stringify({exitCode:error.code})); }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    `, 20_000)
    expect(result.status).toBe(0)
    expect(String(result.stdout)).toContain('{"exitCode":7}')
    expect(String(result.stdout)).not.toContain('unexpected')
  })
})
