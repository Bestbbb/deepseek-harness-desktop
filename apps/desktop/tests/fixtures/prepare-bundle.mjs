/** Test-only consumer loaded by dsh before the packaged installation smoke. */
import assert from 'node:assert/strict'
import { readdir, rename, writeFile } from 'node:fs/promises'

export const inject = ['appReady', 'bundlePreparation']

// The polling parent must never observe a partially written JSON result.
async function publishResult(file, value) {
  const pending = `${file}.pending`
  await writeFile(pending, `${JSON.stringify(value)}\n`, { flag: 'wx' })
  await rename(pending, file)
}

/** Write a boot-free Profile composition receipt without activating it or requesting inference. */
export function apply(ctx, config) {
  ctx.effect(() => ctx.appReady.onReady(async () => {
    if (config.historyOnly) {
      const history = await ctx.bundlePreparation.listOperations()
      await publishResult(config.resultFile, history)
      return
    }
    const candidate = ctx.bundlePreparation.list().find(item => item.entry.id === config.id)
    if (!candidate) throw new Error('Preparation fixture has no catalog entry')
    const receipt = await ctx.bundlePreparation.prepareComposition(candidate.entry.id)
    const failed = ctx.bundlePreparation.list().find(item => item.entry.id === config.failureId)
    assert(failed, 'Missing-dependency fixture has no catalog entry')
    const before = await readdir(config.stagingDirectory)
    await assert.rejects(ctx.bundlePreparation.prepareDependencies(failed.entry.id), /package manager failed/u)
    assert.deepEqual(await readdir(config.stagingDirectory), before)
    const history = await ctx.bundlePreparation.listOperations()
    assert.equal(history.length, 2)
    assert(history.some(item => item.state === 'prepared' && item.kind === 'composition'))
    assert(history.some(item => item.state === 'failed' && item.kind === 'dependencies'))
    await publishResult(config.resultFile, receipt)
  }))
}
