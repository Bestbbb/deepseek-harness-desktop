import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import Commands from '@deepseek-ai/dsh-commands'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import Subagents, { type ResolvedSubagentStartRequest, type SubagentResult, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import DelegationLauncher from '../src/index.ts'
import { DELEGATION_COMMAND } from '../src/protocol.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })

async function bench(controller = true, maxTaskBytes = 16, outputLimitBytes = 512) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(Commands)
  await ctx.plugin(Jobs)
  await ctx.plugin(Subagents)
  if (controller) ctx.jobs.attachController('test')
  const owner = ctx.plugin(() => {})
  // This driver never executes a parent model; real registries own command and job lifecycle.
  const agent = { id: SessionId('parent'), session: Session.create(SessionId('parent')), ctx: owner.ctx, options: {} } as unknown as Agent
  ctx.agents.register(agent)
  const start = vi.fn<(request: ResolvedSubagentStartRequest) => Promise<SubagentRun>>()
  const removeProvider = ctx.subagents.registerProvider({ name: 'fixture', inheritsParentContext: false,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, start })
  const fiber = await ctx.plugin(DelegationLauncher, { maxTaskBytes, outputLimitBytes })
  const launcher = ctx.get('delegationLauncher') as DelegationLauncher
  const command = (value: unknown) => ctx.commands.execute(agent, `/${DELEGATION_COMMAND} ${JSON.stringify(value)}`, [], new AbortController().signal)
  return { ctx, agent, owner, start, removeProvider, fiber, launcher, command }
}

function completed(result: SubagentResult = { stopReason: 'completed', output: [{ type: 'text', text: 'fixture result' }] }) {
  const dispose = vi.fn().mockResolvedValue(undefined)
  return { id: SessionId('child'), localAgent: undefined, result: Promise.resolve(result), dispose }
}

it('lists live providers without starting work and retracts the command on disposal', async () => {
  const b = await bench()
  expect(b.launcher.providers()).toEqual(['fixture'])
  const provider = b.ctx.subagents.getProvider('fixture')!
  const removeZeta = b.ctx.subagents.registerProvider({ ...provider, name: 'zeta' })
  const removeAlpha = b.ctx.subagents.registerProvider({ ...provider, name: 'alpha' })
  expect(b.launcher.providers()).toEqual(['alpha', 'fixture', 'zeta'])
  expect(b.ctx.subagents.list()).toEqual(['fixture', 'zeta', 'alpha'])
  removeZeta(); removeAlpha()
  expect(b.start).not.toHaveBeenCalled()
  expect(b.ctx.commands.list(b.agent).some(row => row.name === DELEGATION_COMMAND)).toBe(true)
  b.removeProvider()
  expect(b.launcher.providers()).toEqual([])
  await expect(b.command({ provider: 'fixture', task: 'hello' })).resolves.toMatchObject({ result: { kind: 'error' } })
  expect(b.ctx.jobs.list(b.agent)).toEqual([])
  await b.fiber.dispose()
  expect(b.ctx.commands.list(b.agent).some(row => row.name === DELEGATION_COMMAND)).toBe(false)
})

it('validates JSON, exact fields, nonempty task and UTF-8 byte limits before starting', async () => {
  const b = await bench()
  await expect(b.ctx.commands.execute(b.agent, `/${DELEGATION_COMMAND} nope`, [], new AbortController().signal))
    .resolves.toMatchObject({ result: { kind: 'error' } })
  for (const value of [null, {}, { provider: 'fixture', task: '' }, { provider: 'fixture', task: '   ' },
    { provider: 'fixture', task: 'hello', env: {} }, { provider: 'fixture', task: '界'.repeat(6) }]) {
    await expect(b.command(value)).resolves.toMatchObject({ result: { kind: 'error' } })
  }
  expect(b.start).not.toHaveBeenCalled()
  const run = completed()
  b.start.mockResolvedValueOnce(run)
  await expect(b.command({ provider: 'fixture', task: ' 界界界界界a ' })).resolves.toMatchObject({ result: { kind: 'success' } })
  expect(b.start.mock.calls[0]![0].parent).toBe(b.agent)
  expect(b.start.mock.calls[0]![0].prompt).toEqual([{ type: 'text', text: '界界界界界a' }])
  const job = b.ctx.jobs.list(b.agent)[0]!
  expect(job.outputLimitBytes).toBe(512)
  await b.ctx.jobs.wait(job.id, 1000, b.agent)
  expect(b.ctx.jobs.read(job.id, b.agent).text).toBe('fixture result')
  expect(run.dispose).toHaveBeenCalledOnce()
  const events = b.agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'command/run').at(-1)).toMatchObject({ data: { name: DELEGATION_COMMAND } })
  expect(events.filter(event => event.type === 'command/done').at(-1)).toMatchObject({ data: { kind: 'success' } })
})

it('does not start a provider without a controller and holds job ownership after plugin removal', async () => {
  const b = await bench(false)
  await expect(b.command({ provider: 'fixture', task: 'hello' })).resolves.toMatchObject({ result: { kind: 'error' } })
  expect(b.start).not.toHaveBeenCalled()
  b.ctx.jobs.attachController('test')
  const result = Promise.withResolvers<SubagentResult>()
  const run = { ...completed(), result: result.promise }
  b.start.mockImplementation(async (request) => {
    request.signal.addEventListener('abort', () => { result.resolve({ stopReason: 'aborted', output: [] }) }, { once: true })
    return run
  })
  await b.command({ provider: 'fixture', task: 'hello' })
  const job = b.ctx.jobs.list(b.agent)[0]!
  await b.fiber.dispose()
  expect(b.ctx.jobs.get(job.id, b.agent).status).toBe('running')
  b.ctx.jobs.kill(job.id, b.agent)
  expect((await b.ctx.jobs.wait(job.id, 1000, b.agent)).status).toBe('killed')
  expect(run.dispose).toHaveBeenCalledOnce()
})

it.each(['refusal', 'error', 'max-tokens', 'aborted'] as const)('keeps provider diagnostics private (%s)', async (stopReason) => {
  const b = await bench()
  b.start.mockResolvedValue(completed({ stopReason, output: [{ type: 'text', text: 'partial' }], diagnostic: '/private/provider/state' }))
  await b.command({ provider: 'fixture', task: 'hello' })
  const job = b.ctx.jobs.list(b.agent)[0]!
  expect((await b.ctx.jobs.wait(job.id, 1000, b.agent)).status).toBe('failed')
  expect(JSON.stringify(b.ctx.jobs.read(job.id, b.agent))).not.toContain('/private')
  expect(b.ctx.jobs.read(job.id, b.agent).text).toBe('')
})

it.each(['start', 'result', 'dispose'] as const)('contains infrastructure failure and awaits cleanup (%s)', async (phase) => {
  const b = await bench()
  const run = completed()
  if (phase === 'start') b.start.mockRejectedValue(new Error('/private/start'))
  else b.start.mockImplementation(async () => {
    if (phase === 'result') run.result = Promise.reject(new Error('/private/result'))
    if (phase === 'dispose') run.dispose.mockRejectedValue(new Error('/private/dispose'))
    return run
  })
  await b.command({ provider: 'fixture', task: 'hello' })
  const job = b.ctx.jobs.list(b.agent)[0]!
  expect((await b.ctx.jobs.wait(job.id, 1000, b.agent)).status).toBe('failed')
  expect(JSON.stringify(b.ctx.jobs.read(job.id, b.agent))).not.toContain('/private')
  expect(run.dispose).toHaveBeenCalledTimes(phase === 'start' ? 0 : 1)
})

it('waits for cancelled startup and disposal before publishing terminal state', async () => {
  const b = await bench()
  const started = Promise.withResolvers<SubagentRun>()
  const released = Promise.withResolvers<undefined>()
  const run = completed({ stopReason: 'aborted', output: [] })
  run.dispose.mockReturnValueOnce(released.promise)
  try {
    b.start.mockReturnValueOnce(started.promise)
    await b.command({ provider: 'fixture', task: 'hello' })
    const job = b.ctx.jobs.list(b.agent)[0]!
    b.ctx.jobs.kill(job.id, b.agent)
    expect(b.start.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(b.ctx.jobs.get(job.id, b.agent).status).toBe('stopping')
    started.resolve(run)
    await vi.waitFor(() => { expect(run.dispose).toHaveBeenCalledOnce() })
    expect(b.ctx.jobs.get(job.id, b.agent).status).toBe('stopping')
    released.resolve(undefined)
    expect((await b.ctx.jobs.wait(job.id, 1000, b.agent)).status).toBe('killed')
  } finally {
    started.resolve(run)
    released.resolve(undefined)
  }
})

it('settles pre-publication cancellation without converting it to a provider error', async () => {
  const b = await bench()
  b.start.mockImplementation(request => new Promise((_, reject) => {
    request.signal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
  }))
  await b.command({ provider: 'fixture', task: 'hello' })
  const job = b.ctx.jobs.list(b.agent)[0]!
  b.ctx.jobs.kill(job.id, b.agent)
  expect((await b.ctx.jobs.wait(job.id, 1000, b.agent)).status).toBe('killed')
})

it.each([
  ...[1, 2, 3, 512].map(limit => ({ limit, input: '界'.repeat(200), expected: '界'.repeat(Math.floor(limit / 3)), truncated: true })),
  { limit: 4, input: '😀x', expected: '😀', truncated: true },
  { limit: 3, input: '😀', expected: '', truncated: true },
  { limit: 4, input: '😀', expected: '😀', truncated: false },
  { limit: 2, input: 'ab', expected: 'ab', truncated: false },
  { limit: 2, input: 'abc', expected: 'ab', truncated: true },
])('bounds final output to $limit UTF-8 bytes for $expected', async ({ limit, input, expected, truncated }) => {
  const b = await bench(true, 16, limit)
  b.start.mockResolvedValueOnce(completed({ stopReason: 'completed', output: [{ type: 'text', text: input }] }))
  await b.command({ provider: 'fixture', task: 'hello' })
  const job = b.ctx.jobs.list(b.agent)[0]!
  await b.ctx.jobs.wait(job.id, 1000, b.agent)
  const result = b.launcher.readJob(b.agent, job.id)
  expect(result).toEqual({ kind: 'ready', status: 'completed', text: expected, truncated })
  expect(b.launcher.readJob(b.agent, job.id)).toEqual(result)
  expect(b.ctx.jobs.get(job.id, b.agent).reported).toBe(true)
  expect(b.launcher.cancelJob(b.agent, job.id)).toBe('already-finished')
})

it('refuses foreign, unowned, missing and non-subagent task controls', async () => {
  const b = await bench()
  const foreign = { ...b.agent, id: SessionId('foreign'), session: Session.create(SessionId('foreign')), ctx: b.ctx.plugin(() => {}).ctx }
  b.ctx.agents.register(foreign)
  const cancel = vi.fn()
  const run = () => ({ cancel, done: Promise.resolve({ status: 'completed' as const, output: 'private' }) })
  const ids = [
    b.ctx.jobs.start({ kind: 'subagent', owner: foreign, label: 'private', run }),
    b.ctx.jobs.start({ kind: 'subagent', label: 'unowned', run }),
    b.ctx.jobs.start({ kind: 'bash', owner: b.agent, label: 'other kind', run }),
    JobId('missing'),
  ]
  for (const id of ids) {
    expect(b.launcher.readJob(b.agent, id)).toEqual({ kind: 'unavailable' })
    expect(b.launcher.cancelJob(b.agent, id)).toBe('unconfirmed')
  }
  expect(cancel).not.toHaveBeenCalled()
})

it('reads only after settlement and acknowledges cancellation before cleanup completes', async () => {
  const b = await bench()
  const result = Promise.withResolvers<SubagentResult>()
  const released = Promise.withResolvers<undefined>()
  const run = { ...completed(), result: result.promise }
  run.dispose.mockReturnValueOnce(released.promise)
  b.start.mockImplementation(async (request) => {
    request.signal.addEventListener('abort', () => { result.resolve({ stopReason: 'aborted', output: [] }) }, { once: true })
    return run
  })
  try {
    await b.command({ provider: 'fixture', task: 'hello' })
    const job = b.ctx.jobs.list(b.agent)[0]!
    expect(b.launcher.readJob(b.agent, job.id)).toEqual({ kind: 'pending' })
    expect(b.ctx.jobs.get(job.id, b.agent).reported).toBe(false)
    expect(b.launcher.cancelJob(b.agent, job.id)).toBe('requested')
    expect(b.ctx.jobs.get(job.id, b.agent).status).toBe('stopping')
    expect(b.launcher.readJob(b.agent, job.id)).toEqual({ kind: 'pending' })
    released.resolve(undefined)
    await b.ctx.jobs.wait(job.id, 1000, b.agent)
    expect(b.launcher.readJob(b.agent, job.id)).toEqual({ kind: 'ready', status: 'killed', text: '', truncated: false })
  } finally {
    result.resolve({ stopReason: 'aborted', output: [] })
    released.resolve(undefined)
  }
})

it('contains producer read and cancellation exceptions without exposing private diagnostics', async () => {
  const b = await bench()
  const job = b.ctx.jobs.start({ kind: 'subagent', owner: b.agent, label: 'fixture', run: () => ({
    cancel: () => { throw new Error('/private/cancel') },
    readOutput: () => { throw new Error('/private/output') },
    done: Promise.resolve({ status: 'failed' }),
  }) })
  expect(b.launcher.cancelJob(b.agent, job)).toBe('unconfirmed')
  await b.ctx.jobs.wait(job, 1000, b.agent)
  expect(b.launcher.readJob(b.agent, job)).toEqual({ kind: 'unavailable' })
})
