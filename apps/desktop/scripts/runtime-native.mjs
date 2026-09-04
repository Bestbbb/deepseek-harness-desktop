/** Native addon preparation targets the Node ABI shipped inside the desktop app. */

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
 * Pin node-gyp to the shipped Node headers, independently of the build-tool Node.
 * @param {string} version - Bundled Node release without a leading v.
 * @param {string} arch - Bundled Node architecture.
 * @param {NodeJS.ProcessEnv} environment - Builder environment, left unchanged.
 * @returns {NodeJS.ProcessEnv} Environment for the approved dependency rebuild.
 */
export function nativeBuildEnvironment(version, arch, environment = process.env) {
  return {
    ...environment,
    npm_config_target: version,
    npm_config_arch: arch,
    npm_package_config_node_gyp_target: version,
    npm_package_config_node_gyp_arch: arch,
  }
}
