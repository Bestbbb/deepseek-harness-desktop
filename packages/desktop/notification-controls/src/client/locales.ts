/** Plugin-owned labels; task contents and notification transport remain outside this editor. */
export const en = {
  configure: 'Configure notifications', choices: 'Background task notifications',
  intro: 'Control the desktop’s existing task notifications. Changes apply to future task completions.',
  completed: 'Notify when a task finishes', failed: 'Notify when a task fails',
  loading: 'Loading notification preferences…', unavailable: 'Preferences cannot be saved in this connection.',
  saving: 'Saving…', unconfirmed: 'The change could not be confirmed. Check the current switches before trying again.',
  use: 'Leave the app in the background while a task runs. Notifications require OS permission and omit task text. Canceled tasks and subagents do not notify.',
  removal: 'Removing this plugin restores the desktop’s default notifications; it does not mute them. Your saved choices are retained for reinstallation.',
} as const

/** Keys shared by both supported locales. */
export type NotificationControlsKey = keyof typeof en

/** Simplified Chinese configuration and first-use copy. */
export const zh: Record<NotificationControlsKey, string> = {
  configure: '设置通知', choices: '后台任务通知',
  intro: '控制桌面已有的任务通知。修改会应用到之后结束的任务。',
  completed: '任务完成时通知', failed: '任务失败时通知',
  loading: '正在读取通知偏好…', unavailable: '当前连接无法保存偏好。',
  saving: '正在保存…', unconfirmed: '无法确认修改结果。请核对当前开关后再重试。',
  use: '任务运行时将应用切到后台。通知需要系统授权，不包含任务内容。取消的任务及子代理不发送通知。',
  removal: '卸载此插件会恢复桌面的默认通知，并不会静音。已保存的选择会保留，供重新安装时使用。',
}
