/** Build-time resolution uses real package metadata without executing agent entry points. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(platform = 'darwin') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-probes-'))
  roots.push(root)
  const script = join(root, 'probe.mjs')
  await cp(new URL('../apps/desktop/scripts/runtime-agent-probes.mjs', import.meta.url), script)
  const packageFile = async (name: string, manifest: object, file: string) => {
    const directory = join(root, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(directory, file), 'throw new Error("agent must not execute during resolution")')
    return directory
  }
  const codex = await packageFile('@openai/codex', { bin: { codex: 'wrapper.js' } }, 'wrapper.js')
  const payloadName = `@anthropic-ai/claude-agent-sdk-${platform}-arm64`
  await packageFile('@anthropic-ai/claude-agent-sdk', {
    main: 'sdk.mjs', optionalDependencies: { [payloadName]: '1.2.3' },
  }, 'sdk.mjs')
  const payload = await packageFile(payloadName, { version: '1.2.3' }, platform === 'win32' ? 'claude.exe' : 'claude')
  const module = await import(pathToFileURL(script).href) as {
    agentProbeManifest: (root: string, anchors: { codex: string; claude: string }, platform: string, arch: string)
    => Promise<{ schemaVersion: number; codexWrapper: string; claudeExecutable: string }>
  }
  const anchors = { codex: join(root, 'providers/codex/index.js'), claude: join(root, 'providers/claude/index.js') }
  return { root, codex, payload, resolve: () => module.agentProbeManifest(root, anchors, platform, 'arm64') }
}

it.each(['darwin', 'win32'])('records only relocatable pinned runtime paths (%s)', async (platform) => {
  const f = await fixture(platform)
  expect(await f.resolve()).toEqual({ schemaVersion: 1, codexWrapper: 'node_modules/@openai/codex/wrapper.js',
    claudeExecutable: `node_modules/@anthropic-ai/claude-agent-sdk-${platform}-arm64/claude${platform === 'win32' ? '.exe' : ''}` })
})

it('rejects mismatched native payloads, malformed wrappers and missing executables', async () => {
  const f = await fixture()
  const original = await readFile(join(f.payload, 'package.json'))
  await writeFile(join(f.payload, 'package.json'), '{"name":"other","version":"1.2.3"}')
  await expect(f.resolve()).rejects.toThrow('pinned SDK')
  await writeFile(join(f.payload, 'package.json'), JSON.stringify({ ...JSON.parse(original.toString()), version: '9.9.9' }))
  await expect(f.resolve()).rejects.toThrow('pinned SDK')
  await writeFile(join(f.payload, 'package.json'), original)
  await rm(join(f.payload, 'claude'))
  await expect(f.resolve()).rejects.toThrow()
  await writeFile(join(f.codex, 'package.json'), '{"name":"@openai/codex","bin":{}}')
  await expect(f.resolve()).rejects.toThrow('wrapper manifest')
})

it('requires the SDK to declare an exact payload version', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'),
    '{"name":"@anthropic-ai/claude-agent-sdk","main":"sdk.mjs"}')
  await expect(f.resolve()).rejects.toThrow('pinned SDK')
})

it('refuses a wrapper outside the prepared runtime', async () => {
  const f = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'dsh-unrelated-agent-'))
  roots.push(outside)
  const wrapper = join(outside, 'wrapper.js')
  await writeFile(wrapper, 'throw new Error("never execute")')
  await writeFile(join(f.codex, 'package.json'), JSON.stringify({ name: '@openai/codex', bin: { codex: wrapper } }))
  await expect(f.resolve()).rejects.toThrow('inside the prepared runtime')
})
