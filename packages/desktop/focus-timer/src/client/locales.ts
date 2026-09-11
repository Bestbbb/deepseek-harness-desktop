/** Localized labels for the account-free sidebar timer. */
export const en = {
  title: 'Focus timer', open: 'Open timer', close: 'Close timer', minutes: 'Duration in minutes',
  description: 'A local timer for focused work. Closing this panel keeps it running.',
  limit: 'Choose a whole number from 1 to 1440 minutes.',
  lifetime: 'Reloading the page, quitting the app or unloading the plugin clears the timer. No sound or system notification is sent.',
  start: 'Start', pause: 'Pause', resume: 'Resume', reset: 'Reset',
  idle: 'Choose a duration', running: 'Focusing', paused: 'Paused', done: 'Time is up. Take a break.',
  remaining: '{minutes}:{seconds}', badge: 'Focus timer: {time}',
  preference: 'Plugin settings', preferenceHint: 'Save a duration for fresh timers on this device. The countdown itself is not saved.',
  loadingPreference: 'Loading saved duration…', unavailablePreference: 'Saving is unavailable. You can still run a temporary timer.',
  noPreference: 'No saved duration', savedPreference: 'Saved duration: {minutes} min',
  savePreference: 'Save this duration', clearPreference: 'Clear saved duration', savingPreference: 'Saving…',
  unconfirmedPreference: 'The preference could not be confirmed. Check the saved duration before trying again.',
} as const

/** Dictionary keys shared by both supported locales. */
export type FocusTimerKey = keyof typeof en

/** Simplified Chinese timer copy. */
export const zh: Record<FocusTimerKey, string> = {
  title: '专注计时器', open: '打开计时器', close: '关闭计时器', minutes: '计时时长（分钟）',
  description: '专注工作时使用的本地计时器。关闭此面板后继续计时。',
  limit: '请输入 1 至 1440 之间的整数分钟。',
  lifetime: '刷新页面、退出应用或卸载插件会清除计时。不播放声音，也不发送系统通知。',
  start: '开始', pause: '暂停', resume: '继续', reset: '重置',
  idle: '选择时长', running: '专注中', paused: '已暂停', done: '时间到了，休息一下吧。',
  remaining: '{minutes}:{seconds}', badge: '专注计时器：{time}',
  preference: '插件设置', preferenceHint: '在此设备上保存新计时器的常用时长。倒计时进度本身不会保存。',
  loadingPreference: '正在读取已保存的时长…', unavailablePreference: '暂时无法保存。仍可使用临时计时器。',
  noPreference: '尚未保存时长', savedPreference: '已保存时长：{minutes} 分钟',
  savePreference: '保存此时长', clearPreference: '清除已保存时长', savingPreference: '正在保存…',
  unconfirmedPreference: '无法确认设置是否已保存。请核对已保存时长后再重试。',
}
