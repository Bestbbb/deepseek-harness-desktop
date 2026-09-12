/** Keep desktop registration mocks independent of generated remote artifacts. */

import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { mockedDesktopRemotePlugin } from './desktop-remote-test-resolution.ts'

it.each([
  '@deepseek-ai/dsh-bundle-marketplace/remote',
  '@deepseek-ai/dsh-delegation-launcher/remote',
])('requires an explicit mock for %s', (name) => {
  const plugin = mockedDesktopRemotePlugin()
  const id = plugin.resolveId(name)
  expect(id).toBeDefined()
  const source = plugin.load(id!)
  expect(source).toBeDefined()
  expect(() => { runInNewContext(source!) }).toThrow('must explicitly mock')
})

it('does not replace other modules or similarly named generated remotes', () => {
  const plugin = mockedDesktopRemotePlugin()
  for (const name of [
    '@deepseek-ai/dsh-bundle-marketplace',
    '@deepseek-ai/dsh-bundle-marketplace/remote-extra',
    '@deepseek-ai/dsh-api-remotes/remote',
  ]) {
    expect(plugin.resolveId(name)).toBeUndefined()
    expect(plugin.load(name)).toBeUndefined()
    expect(plugin.load('\0dsh-mocked-remote:' + name)).toBeUndefined()
  }
})
