/** Package-owned invariant companion for the Tauri native desktop provider. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-native'

/** Cordis companion plugin name. */
export const name = 'desktop-native-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: every call is an authenticated, request-scoped bridge round trip. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
