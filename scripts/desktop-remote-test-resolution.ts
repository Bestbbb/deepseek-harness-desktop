/** Source-only resolution for desktop registration tests with explicit Remote mocks. */

/**
 * Resolve generated Remote imports explicitly mocked by desktop registration tests without built artifacts.
 * @returns a test-only resolver that rejects loading an unmocked generated Remote.
 */
export function mockedDesktopRemotePlugin() {
  const modules = new Set([
    '@deepseek-ai/dsh-bundle-marketplace/remote',
    '@deepseek-ai/dsh-delegation-launcher/remote',
  ])
  const prefix = '\0dsh-mocked-remote:'
  return {
    name: 'dsh-mocked-desktop-remotes',
    enforce: 'pre' as const,
    resolveId(id: string) {
      return modules.has(id) ? prefix + id : undefined
    },
    load(id: string) {
      if (!id.startsWith(prefix) || !modules.has(id.slice(prefix.length))) return
      return 'throw new Error("Desktop registration tests must explicitly mock their generated Remote")'
    },
  }
}
