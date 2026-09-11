/** Human-requested delegation through existing providers and owner-scoped background jobs. */
import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as wire } from 'zod'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TaskRead, TaskCancellation } from './types.ts'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { DELEGATION_COMMAND } from './protocol.ts'

/** Deployment limits; account and provider enablement stay with their existing owners. */
export interface Config {
  /** Maximum UTF-8 bytes accepted for one task. */
  maxTaskBytes: number
  /** Maximum bytes in a complete background-job notice or output read. */
  outputLimitBytes: number
}

/** Human delegation and session-owned task controls over the existing provider and job services. */
export class DelegationLauncher extends TypertRemoteService {
  private readonly resultByteLimit: number
  static inject = ['commands', 'subagents', 'jobs']
  static Config = z.object({
    maxTaskBytes: z.natural().min(1).default(16_384),
    outputLimitBytes: z.natural().min(1).default(32_768),
  })

  constructor(ctx: Context, config: Config) {
    super(ctx, 'delegationLauncher')
    const { maxTaskBytes, outputLimitBytes } = config
    this.resultByteLimit = outputLimitBytes
    const request = wire.strictObject({ provider: wire.string().min(1), task: wire.string().trim().min(1) })
    ctx.commands.register({
      name: DELEGATION_COMMAND,
      description: 'Delegate a task to a loaded provider as a background job. May use provider quota.',
      input: { hint: 'JSON with provider and task; use the Delegate task panel for guided entry.' },
      handler: (invocation) => {
        let value: unknown
        try { value = JSON.parse(invocation.rawInput) } catch {
          // Slash-command input is user-authored JSON, never executable configuration.
          return { kind: 'error', text: 'Delegation requires JSON with provider and task.' }
        }
        const parsed = request.safeParse(value)
        if (!parsed.success || Buffer.byteLength(parsed.data.task, 'utf8') > maxTaskBytes) {
          return { kind: 'error', text: 'Delegation task is empty, invalid or exceeds the configured byte limit.' }
        }
        if (ctx.subagents.getProvider(parsed.data.provider) === undefined) {
          return { kind: 'error', text: 'The selected delegation provider is not loaded. Refresh the provider list.' }
        }
        return this.start(invocation, parsed.data.provider, parsed.data.task, outputLimitBytes)
      },
    })
  }

  /**
   * Read provider names without probing executables, accounts or models.
   * @returns Sorted registered names; presence does not prove authentication or successful inference.
   */
  @Remote('providers')
  providers(): string[] {
    return this.ctx.subagents.list().toSorted()
  }

  /**
   * Collect final text without consuming a running task's output cursor.
   * @param agent - Current session owner, resolved by the existing Remote Agent converter.
   * @param id - Subagent job belonging to that owner.
   * @returns Bounded terminal output, pending state or an unavailable result without private diagnostics.
   */
  @Remote('readJob')
  readJob(agent: Agent, id: JobId): TaskRead {
    try {
      const job = this.ctx.jobs.get(id, agent)
      if (job.kind !== 'subagent' || job.ownerSession !== agent.id) return { kind: 'unavailable' }
      if (job.status === 'running' || job.status === 'stopping') return { kind: 'pending' }
      const source = this.ctx.jobs.read(id, agent).text
      // One extra UTF-16 unit preserves a surrogate pair crossing the bounded prefix.
      const bytes = Buffer.from(source.slice(0, this.resultByteLimit + 1), 'utf8')
      return { kind: 'ready', status: job.status,
        text: new TextDecoder().decode(bytes.subarray(0, this.resultByteLimit), { stream: true }),
        truncated: source.length > this.resultByteLimit || bytes.length > this.resultByteLimit }
    } catch {
      // Unknown, foreign and removed jobs share one safe response; producer output readers may also fail.
      return { kind: 'unavailable' }
    }
  }

  /**
   * Request cancellation through the registry without claiming cleanup has finished.
   * @param agent - Current session owner, resolved by the existing Remote Agent converter.
   * @param id - Subagent job belonging to that owner.
   * @returns Registry acknowledgement, or uncertainty without retrying or exposing provider errors.
   */
  @Remote('cancelJob')
  cancelJob(agent: Agent, id: JobId): TaskCancellation {
    try {
      const job = this.ctx.jobs.get(id, agent)
      if (job.kind !== 'subagent' || job.ownerSession !== agent.id) return 'unconfirmed'
      return this.ctx.jobs.kill(id, agent)
    } catch {
      // A cancellation callback can throw after requesting termination; do not claim it was not applied.
      return 'unconfirmed'
    }
  }

  private start(invocation: CommandInvocation, provider: string, task: string, outputLimitBytes: number): CommandResult {
    invocation.signal.throwIfAborted()
    try {
      const id = this.ctx.jobs.start({
        kind: 'subagent', label: `Delegation: ${provider}`, owner: invocation.agent, outputLimitBytes,
        run: () => {
          const controller = new AbortController()
          const started = this.ctx.subagents.start(provider, {
            parent: invocation.agent, prompt: [{ type: 'text', text: task }], signal: controller.signal,
          })
          return {
            cancel: () => { controller.abort() },
            done: settle(started, controller.signal),
          }
        },
      })
      return { kind: 'success', text: `Delegation queued as ${id}. Use the session's background jobs to inspect or cancel it.` }
    } catch {
      // Job admission errors may contain private workspace paths; no job was published.
      return { kind: 'error', text: 'Delegation could not be queued. The session needs an available background-job controller.' }
    }
  }
}

/** Retain job ownership until provider startup, result and disposal have all settled. */
async function settle(started: Promise<SubagentRun>, signal: AbortSignal): Promise<JobOutcome> {
  try {
    const run = await started
    try {
      const result = await run.result
      if (result.stopReason === 'completed') {
        return { status: 'completed', output: result.output.filter(block => block.type === 'text').map(block => block.text).join('') }
      }
      return result.stopReason === 'aborted' && result.diagnostic === undefined
        ? { status: 'killed' } : { status: 'failed', detail: 'Delegation failed; check provider configuration.' }
    } finally { await run.dispose() }
  } catch {
    // Start, result and cleanup errors can contain account or process details; do not put them in job notices.
    return signal.aborted ? { status: 'killed' } : { status: 'failed', detail: 'Delegation could not complete; check provider configuration.' }
  }
}

export default DelegationLauncher
