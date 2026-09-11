/** Test-only protocol fixture; packaged acceptance separately executes the real dsh CLI. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

assert.equal(process.env.DSH_FAKE_SECRET, undefined)
const profile = basename(process.cwd())
const manifest = JSON.parse(await readFile(join(process.env.DSH_HOME, 'profiles', profile, 'package.json'), 'utf8'))
if (process.argv.includes('--version')) {
  console.log(manifest.wrongVersion ? 'wrong' : 'fixture')
} else {
  assert.deepEqual(process.argv.slice(2), ['--profile', profile, '--dump-config'])
  assert.equal(manifest.dsh.profile.patchReload, 'startup')
  assert.equal(manifest.dsh.profile.bundles.includes('@example/plugin'), !manifest.expectRemoved)
  if (manifest.failDump) process.exit(31)
  console.log('[]')
}
