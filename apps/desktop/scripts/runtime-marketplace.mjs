/** Build reviewed, self-contained marketplace artifacts from repository-owned source. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const reviewed = [
  { id: 'focus-timer', title: 'Focus Timer',
    en: {
      summary: 'Keep a simple focus countdown beside your conversation.',
      accounts: 'No account, model request or network service is needed.',
      access: 'Adds a sidebar panel and saves your preferred duration in local Harness settings. Countdown progress is not saved.',
      setup: 'After restarting, choose Installed → Open timer, or use Focus timer in the sidebar. Enter minutes and start. Closing the panel keeps it running; reloading or quitting clears the countdown. No sound or system notification is sent.',
    },
    zh: {
      summary: '在对话旁开启简单的专注倒计时。',
      accounts: '无需账号，不调用模型或网络服务。',
      access: '添加侧栏面板，并在本地 Harness 设置中保存偏好的时长；不保存倒计时进度。',
      setup: '重启后选择“已安装 → 打开计时器”，或点击侧栏的专注计时器。输入分钟数并开始。关闭面板会继续计时，刷新或退出会清除倒计时。不播放声音或发送系统通知。',
    },
  },
  { id: 'notification-controls', title: 'Notification Controls',
    en: {
      summary: 'Choose whether desktop tasks notify you when they finish or fail.',
      accounts: 'The controls need no account and do not run model tasks.',
      access: 'Saves notification preferences in local Harness settings and filters the desktop task-notification policy. It does not grant OS notification permission.',
      setup: 'After restarting, open Installed → Configure notifications. Both switches initially allow notifications. The app must be in the background and have OS permission. To silence notifications, turn off the switches; removing this Bundle restores the default notification behavior.',
    },
    zh: {
      summary: '选择桌面任务完成或失败时是否通知你。',
      accounts: '控制开关无需账号，不会启动模型任务。',
      access: '在本地 Harness 设置中保存通知偏好，并过滤桌面任务通知策略；不会授予操作系统通知权限。',
      setup: '重启后打开“已安装 → 配置通知”。两个开关初始均允许通知。应用需处于后台并获得系统通知权限。若要静音，请关闭开关；卸载此组合包会恢复默认通知行为。',
    },
  },
  { id: 'delegation-launcher', title: 'Delegate Tasks',
    en: {
      summary: 'Submit work to a loaded agent provider, then read or cancel its task.',
      accounts: 'Providers need their own setup or login. Execution and automatic parent-model completion handling may consume account quota. Installing or browsing does not run a model task.',
      access: 'Uses the selected session and workspace. The chosen provider may read or modify files, run commands and inherit conversation context according to its configuration. Task input and outcomes are logged.',
      setup: 'After restarting, open a session and choose Installed → Delegate a task. Choose a loaded provider, enter the task and confirm access before submitting. Read result collects finished output; Cancel task requests cancellation. This Bundle does not install or authenticate providers.',
    },
    zh: {
      summary: '向已加载的智能体提供方提交工作，并查看或取消任务。',
      accounts: '提供方需要单独配置或登录。执行任务及父模型自动处理完成结果可能消耗账号额度。安装或浏览不会启动模型任务。',
      access: '使用所选会话和工作区。提供方可能按其配置读写文件、运行命令或继承对话上下文。任务输入与结果会记录到日志。',
      setup: '重启后打开会话，选择“已安装 → 委派任务”。选择已加载的提供方、输入任务并确认访问范围后提交。“读取结果”获取已完成输出，“取消任务”请求取消。本组合包不负责安装提供方或登录账号。',
    },
  },
]

/**
 * Pack reviewed source with pinned pnpm, then atomically publish catalog metadata after the artifact.
 * Old content-addressed artifacts stay available to a running development host.
 * @param {string} output - caller-owned generated catalog directory.
 * @param {string} node - build host Node executable.
 * @param {string} manager - pinned pnpm entry.
 * @param {string} platform - reviewed target operating system.
 * @param {string} arch - reviewed target architecture.
 * @returns {Promise<void>} after the catalog and verified byte identity are published.
 */
export async function prepareMarketplace(output, node, manager, platform, arch) {
  const harness = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await mkdir(output, { recursive: true })
  const staging = await mkdtemp(join(output, '.pack-'))
  try {
    const entries = []
    for (const review of reviewed) {
      const packageDir = join(root, 'packages/desktop', review.id)
      const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
      if (manifest.name !== `@deepseek-ai/dsh-${review.id}` || manifest.version !== harness.version) {
        throw new Error(`${review.id} must match the reviewed Harness version and package identity`)
      }
      if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
        throw new Error(`${review.id} must declare a Bundle license`)
      }
      for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
        if ((await readFile(join(packageDir, file))).length === 0) throw new Error(`${review.id} build output is empty: ${file}`)
      }
      const packDirectory = join(staging, review.id)
      await mkdir(packDirectory)
      const artifact = await pack(packageDir, packDirectory, node, manager)
      const bytes = await readFile(artifact)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const file = `${review.id}-${sha256}.tgz`
      await rename(artifact, join(output, file))
      entries.push({
        id: review.id, title: review.title, packageName: manifest.name, version: manifest.version,
        publisher: 'Harness Desktop', source: 'https://github.com/Bestbbb/deepseek-harness-desktop',
        details: { license: manifest.license, en: review.en, zh: review.zh },
        harnessVersions: [harness.version], platforms: [`${platform}-${arch}`], artifact: { file, sha256, size: bytes.length },
      })
    }
    const pending = join(staging, 'catalog.json')
    await writeFile(pending, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, { flag: 'wx' })
    await rename(pending, join(output, 'catalog.json'))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Pack one reviewed package and reject incomplete output before catalog publication. */
async function pack(packageDir, staging, node, manager) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD/iu.test(key)))
  await new Promise((resolvePack, reject) => {
    // pack follows the declared bundled dependencies without changing the workspace install layout.
    const child = spawn(node, [manager, 'pack', '--config.node-linker=hoisted', '--pack-destination', staging], {
      cwd: packageDir, stdio: 'ignore', env: { ...env, npm_config_ignore_scripts: 'true', npm_config_manage_package_manager_versions: 'false' },
    })
    let timedOut = false
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60_000)
    child.once('error', error => { clearTimeout(deadline); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(deadline)
      if (code === 0 && signal === null && !timedOut) resolvePack()
      else reject(new Error(`Reviewed Bundle packaging failed (${code ?? signal})`))
    })
  })
  const files = (await readdir(staging)).filter(file => file.endsWith('.tgz'))
  if (files.length !== 1) throw new Error('Reviewed Bundle packaging must produce one tarball')
  return join(staging, files[0])
}
