/** Test-only marketplace consumer: queue once through Cordis after the launcher commits. */
import { readFile, rename, writeFile } from 'node:fs/promises'

export const inject = ['appReady', 'bundlePreparation', 'desktop']

/** Persist a fixture result atomically and drain the operation when its plugin is disposed. */
export function apply(ctx, config) {
  ctx.effect(() => {
    let pending
    const detach = ctx.appReady.onReady(() => {
      pending = (async () => {
        try { await readFile(config.resultFile); return } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        let result
        try {
          const { activeProfile } = await ctx.desktop.profileSelection()
          result = await ctx.bundlePreparation.queueActivation(config.id, activeProfile, null)
        } catch {
          result = { error: 'Fixture Bundle queue failed' }
        }
        await writeFile(`${config.resultFile}.pending`, JSON.stringify(result), { flag: 'wx' })
        await rename(`${config.resultFile}.pending`, config.resultFile)
      })()
    })
    return async () => { detach(); await pending }
  })
}
