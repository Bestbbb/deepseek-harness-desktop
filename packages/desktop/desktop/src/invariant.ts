/** Package-owned invariant companion for the native desktop Service Definition. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop'

/** Cordis companion plugin name. */
export const name = 'desktop-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: Cordis owns duplicate service registration and disposal. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
