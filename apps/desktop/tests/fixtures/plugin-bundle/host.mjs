/** Test-only external Bundle host contribution; no inference or user-home writes. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ready from 'dsh-fixture-dependency'

export const inject = ['appReady']

/** Record activation in the smoke-owned Harness home. */
export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => writeFile(join(process.env.DSH_HOME, 'plugin-activated'), ready)))
}
