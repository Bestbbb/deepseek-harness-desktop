/** Controlled process failures; the packaged smoke separately runs real pnpm. */
import assert from 'node:assert/strict'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const config = JSON.parse(await readFile(new URL('./manager.json', import.meta.url), 'utf8'))
if (process.argv.includes('--version')) {
  console.log(config.mode === 'version' ? 'wrong' : config.mode === 'output' ? 'x'.repeat(4096) : '11.7.0')
} else {
  assert.equal(process.env.DSH_FAKE_SECRET, undefined)
  assert.equal(process.env.NODE_OPTIONS, undefined)
  assert.equal(process.env.FAKE_AMBIENT, undefined)
  assert.equal(process.env.npm_config_offline, 'true')
  assert.equal(process.env.npm_config_ignore_scripts, 'true')
  assert(process.argv.includes('--ignore-pnpmfile'))
  assert(process.argv.includes('--config.auto-install-peers=false'))
  assert(process.argv.includes('--ignore-workspace'))
  assert.equal(await readFile(process.env.npm_config_userconfig, 'utf8'), '')
  if (config.mode === 'fail') process.exit(29)
  if (config.mode === 'hang') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    await writeFile(config.started, JSON.stringify([process.pid, child.pid]))
    setInterval(() => {}, 1000)
  } else if (process.argv.includes('--lockfile-only')) {
    await writeFile(join(process.cwd(), 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  } else {
    const directory = join(process.cwd(), 'node_modules/@example/plugin')
    await mkdir(directory, { recursive: true })
    if (config.mode === 'escape') {
      const { rm } = await import('node:fs/promises')
      await rm(directory, { recursive: true })
      await symlink(config.outside, directory, 'junction')
    } else {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@example/plugin', version: config.mode === 'identity' ? 'wrong' : '1.0.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
    }
    await writeFile(join(process.cwd(), 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  }
}
