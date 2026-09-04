/** Native addon preparation targets the Node ABI shipped inside the desktop app. */

import { createRequire } from 'node:module'
import runScript from '@npmcli/run-script'

const desktopRequire = createRequire(import.meta.url)

/**
 * Reject a foreign native build before replacing a generated runtime directory.
 * @param {string} platform - Runtime target operating system.
 * @param {string} arch - Runtime target architecture.
 */
export function assertNativeBuildHost(platform, arch) {
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(`Desktop runtime preparation requires a ${platform}-${arch} builder; this host is ${process.platform}-${process.arch}. Prepare native addons on the target platform before packaging.`)
  }
}

/**
 * Select the desktop-owned node-gyp and shipped Node headers independently of npm's bundled compiler.
 * @param {string} version - Bundled Node release without a leading v.
 * @param {string} arch - Bundled Node architecture.
 * @param {NodeJS.ProcessEnv} environment - Builder environment, left unchanged.
 * @returns {NodeJS.ProcessEnv} Environment for the approved dependency rebuild.
 */
export function nativeBuildEnvironment(version, arch, environment = process.env) {
  const build = {
    npm_config_node_gyp: desktopRequire.resolve('node-gyp/bin/node-gyp.js'),
    npm_config_target: version,
    npm_config_arch: arch,
    npm_package_config_node_gyp_target: version,
    npm_package_config_node_gyp_arch: arch,
  }
  // npm's runner merges process.env again; preserve its key spellings with the
  // pinned values so Windows cannot select an inherited case variant instead.
  return {
    ...Object.fromEntries(Object.entries(environment).map(([name, value]) => [
      name, Object.hasOwn(build, name.toLowerCase()) ? build[name.toLowerCase()] : value,
    ])),
    ...build,
  }
}

/**
 * Run one approved installed package's build lifecycle with the pinned compiler.
 * @param {string} directory - Installed dependency directory.
 * @param {string} version - Bundled Node release without a leading v.
 * @param {string} arch - Bundled Node architecture.
 */
export async function rebuildNativePackage(directory, version, arch) {
  const env = nativeBuildEnvironment(version, arch)
  for (const event of ['preinstall', 'install', 'postinstall']) {
    await runScript({
      event, path: directory, env, nodeGyp: env.npm_config_node_gyp, stdio: 'inherit',
    })
  }
}
