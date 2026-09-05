/** Exercise the packaged recovery document without starting a real desktop or agent. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

it.each(['en-US', 'zh-CN'])('recovers the packaged loading page (%s)', async (locale) => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ locale })
    const calls: unknown[] = []
    await page.exposeFunction('fixtureInvoke', (command: string, args: unknown) => {
      calls.push({ command, args })
      return Promise.resolve()
    })
    await page.evaluate(() => {
      const invoke: unknown = Reflect.get(window, 'fixtureInvoke')
      Object.assign(window, { __TAURI__: { core: { invoke } } })
    })
    await page.setContent(await readFile(join(REPO_ROOT, 'apps/desktop/loading/index.html'), 'utf8'))
    const error = '<script>unsafe</script> Runtime unavailable'
    await page.evaluate(message => dispatchEvent(new CustomEvent('dsh-desktop-runtime-error', { detail: message })), error)
    expect(await page.getByRole('alert').textContent()).toBe(error)
    expect(await page.locator('#spinner').isVisible()).toBe(false)
    await page.getByRole('button', { name: locale === 'zh-CN' ? '重试' : 'Retry', exact: true }).click()
    await page.locator('#diagnostics').click()
    expect(calls).toEqual([
      { command: 'desktop_recovery', args: { action: 'retry' } },
      { command: 'desktop_recovery', args: { action: 'diagnostics' } },
    ])
    await page.evaluate(() => dispatchEvent(new CustomEvent('dsh-desktop-runtime-starting', { detail: 2 })))
    expect(await page.locator('#retry').isVisible()).toBe(false)
    expect(await page.getByRole('alert').isVisible()).toBe(false)
    expect(await page.locator('#spinner').isVisible()).toBe(true)
    expect(await page.getByRole('status').textContent()).toContain('2/3')
  } finally {
    await browser.close()
  }
})
