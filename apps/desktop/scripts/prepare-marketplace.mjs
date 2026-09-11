/** Prepare marketplace artifacts for a source-mode desktop without deploying its whole runtime. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareMarketplace } from './runtime-marketplace.mjs'
import { agentProbeManifest } from './runtime-agent-probes.mjs'
import { writeFile } from 'node:fs/promises'

const desktop = fileURLToPath(new URL('..', import.meta.url))
const manager = join(dirname(createRequire(new URL('../package.json', import.meta.url)).resolve('pnpm')), 'bin/pnpm.mjs')
await prepareMarketplace(join(desktop, 'resources/marketplace'), process.execPath, manager, process.platform, process.arch)
const root = join(desktop, '../..')
await writeFile(join(desktop, 'resources/agent-runtimes.json'), `${JSON.stringify(await agentProbeManifest(root, {
  codex: join(root, 'packages/subagent/subagent-codex/lib/index.js'),
  claude: join(root, 'packages/subagent/subagent-claude-code/lib/index.js'),
}, process.platform, process.arch), null, 2)}\n`)
