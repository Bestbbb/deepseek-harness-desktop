/** Verify generated desktop presets through the shipped Web profile without inference. */
export const name = 'desktop-preset-smoke'
export const inject = ['agents', 'agentPresets', 'subagents', 'tools', 'appReady']

let stage = 'load'
const deadline = setTimeout(() => { process.stderr.write('Preset smoke timeout: ' + stage + '\n'); process.exit(1) }, 20000)

/** Inspect real provider registration and mount both the standard and generated presets. */
export function apply(ctx) {
  stage = 'apply'
  ctx.effect(() => ctx.appReady.onReady(async () => {
    try {
      stage = 'ready'
      const enabled = process.env.DSH_DESKTOP_SMOKE_ENABLED === '1'
      for (const provider of ['codex', 'claude-code', 'desktop-kimi', 'desktop-qoder']) {
        if ((ctx.subagents.getProvider(provider) !== undefined) !== enabled) throw new Error('Provider opt-in mismatch: ' + provider)
      }
      for (const id of ['standard', 'desktop-local-agents']) {
        stage = 'create:' + id
        const handle = await ctx.agents.create({
          sessionId: 'desktop-smoke-' + id,
          meta: { cwd: process.env.DSH_HOME },
          setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, id) },
        })
        try {
          const tools = handle.agent.ctx.tools.schemas(handle.agent).map(tool => tool.name)
          for (const tool of ['subagent_codex', 'subagent_claude_code', 'subagent_kimi', 'subagent_qoder']) {
            if (tools.includes(tool) !== (enabled && id === 'desktop-local-agents')) throw new Error('Tool grant mismatch: ' + id + ':' + tool)
          }
          if (enabled && id === 'desktop-local-agents') {
            for (const provider of ['desktop-kimi', 'desktop-qoder']) {
              stage = 'delegate:' + provider
              const run = await ctx.subagents.start(provider, {
                parent: handle.agent,
                prompt: [{ type: 'text', text: 'protocol fixture' }],
                signal: new AbortController().signal,
              })
              try {
                const result = await run.result
                if (result.stopReason !== 'completed' || result.output.map(part => part.text ?? '').join('') !== 'mock child answer') {
                  throw new Error('ACP delegation did not complete: ' + provider)
                }
              } finally { await run.dispose() }
            }
          }
        } finally { await handle.dispose() }
      }
      process.stdout.write('DESKTOP_PRESETS_OK\n')
      clearTimeout(deadline)
      process.exit(0)
    } catch (error) {
      process.stderr.write(String(error) + '\n')
      process.exit(1)
    }
  }))
}
