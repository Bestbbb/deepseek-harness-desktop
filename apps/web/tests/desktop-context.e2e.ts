/** The shipping desktop overlay records installed-app guidance in a real Web round trip. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  fixtureUserPrompts, launchWebScaffold, readPersistedEvents, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, REPO_ROOT } from './support.ts'

const FIXTURE = join(REPO_ROOT, 'snapshots/web/desktop-context/session.v2.jsonl')

describe('desktop context in the shipped Web composition', () => {
  let root: string | undefined
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-desktop-context-'))
    const source = await readFile(join(REPO_ROOT, 'apps/desktop/runtime/desktop.cordis.yml'), 'utf8')
    const overlay = source
      .replaceAll('__DSH_DESKTOP_NATIVE_ENTRY__', JSON.stringify(pathToFileURL(
        join(REPO_ROOT, 'packages/desktop/desktop-native/lib/index.js'),
      ).href))
      .replaceAll('!!js process.env.DSH_DESKTOP_BRIDGE_URL', JSON.stringify('http://127.0.0.1:9'))
      .replaceAll('!!js process.env.DSH_DESKTOP_BRIDGE_TOKEN', JSON.stringify('desktop-context-fixture-token'))
    const patchPath = join(root, 'desktop.cordis.yml')
    await writeFile(patchPath, overlay)
    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, compareReplaySession: true,
      extraOverlayPath: patchPath,
      extraInstallAnchors: [join(REPO_ROOT, 'packages/desktop/desktop-native/package.json')],
    })
    browser = await chromium.launch()
    // The fixture persists clientTimeZone; the browser must not inherit the runner's zone.
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 }, locale: 'en-US', timezoneId: 'Asia/Taipei',
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (root !== undefined) await rm(root, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'desktop context teardown failed')
  })

  it('persists desktop orientation without Web development instructions or private bridge credentials', async () => {
    if (scaffold === undefined) throw new Error('desktop scaffold did not start')
    const prompts = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0]
    if (prompt === undefined) throw new Error('desktop fixture has no user prompt')
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(prompt)
    await input.press('Enter')
    const sessionId = await settled
    const events = await readPersistedEvents(scaffold, sessionId)
    const header = events.find(event => event.type === 'request/header')
    if (header?.type !== 'request/header') throw new Error('desktop turn did not persist its model request header')
    expect(header.data.header.system).toContain('Harness Desktop, a desktop application built on DeepSeek Harness')
    expect(header.data.header.system).not.toMatch(/pnpm run dev:web|DSH_WEB_URL|implementation checkout is at/)
    expect(JSON.stringify(events)).not.toMatch(/desktop-context-fixture-token|127\.0\.0\.1:9/)
    await expect.poll(() => page.getByText('DONE', { exact: true }).count()).toBeGreaterThan(0)
  })
})
