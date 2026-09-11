/** Optional synchronous notification policy; it neither sends notifications nor changes task execution. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-desktop-native'
import { NOTIFICATION_CONTROLS_NAMESPACE, type NotificationPreferences } from './settings.ts'

const Preferences: z<NotificationPreferences> = z.object({
  completed: z.boolean().default(true),
  failed: z.boolean().default(true),
})

/** The same Host settings provider owns validation, persistence and change observation. */
export const inject = ['settings']

/**
 * Register saved notification choices and remove the policy with the plugin fiber.
 * @param ctx - Host plugin context; desktop-native owns the policy dispatch and delivery.
 */
export function apply(ctx: Context): void {
  ctx.settings.register(NOTIFICATION_CONTROLS_NAMESPACE, Preferences)
  ctx.on('desktop/task-notification', (outcome, next) => {
    const preference = ctx.settings.get(NOTIFICATION_CONTROLS_NAMESPACE) as NotificationPreferences
    return (outcome === 'completed' ? preference.completed : preference.failed) && next()
  })
}
