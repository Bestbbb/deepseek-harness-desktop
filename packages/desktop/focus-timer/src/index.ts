/** Register the optional timer's preference in the existing Host settings service. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { FOCUS_TIMER_NAMESPACE, type FocusTimerSettings } from './settings.ts'

const FocusTimerSettingsSchema: z<FocusTimerSettings> = z.object({
  minutes: z.number().step(1).min(1).max(1440),
})

/**
 * Expose a durable duration when a settings provider is composed; add no model input.
 * @param ctx - Host context owning the reversible settings registration.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(FOCUS_TIMER_NAMESPACE, FocusTimerSettingsSchema)
  })
}
