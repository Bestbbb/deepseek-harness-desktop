/** Inspect installed Skill discovery and loading through the packaged Web profile, without inference. */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'desktop-skill-smoke'
export const inject = ['agents', 'agentPresets', 'skills', 'appReady']

/** Mount a standard session and compare its Skill provider with the installed bundle. */
export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(async () => {
    let handle
    try {
      handle = await ctx.agents.create({
        sessionId: 'desktop-skill-smoke-' + randomUUID(),
        meta: { cwd: process.env.DSH_HOME },
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') },
      })
      const options = { scope: handle.agent, cwd: process.env.DSH_HOME }
      const expected = process.env.DSH_SKILL_INSTALLED === '1'
      const skill = (await ctx.skills.list(options)).find(skill => skill.name === 'frontend-design')
      if (Boolean(skill) !== expected) throw new Error('Installed Skill catalog mismatch')
      const loaded = await ctx.skills.get('frontend-design', options)
      if (Boolean(loaded) !== expected) throw new Error('Installed Skill load mismatch')
      if (loaded && (loaded.path !== join(process.env.DSH_HOME, 'skills/frontend-design/SKILL.md') || !loaded.content.includes(process.env.DSH_SKILL_EXPECTED_TEXT))) {
        throw new Error('Skill did not load from the desktop home')
      }
      await handle.dispose()
      handle = undefined
      process.stdout.write('DESKTOP_SKILLS_OK\n')
      process.exit(0)
    } catch (error) {
      if (handle) await handle.dispose()
      process.stderr.write(String(error) + '\n')
      process.exit(1)
    }
  }))
}
