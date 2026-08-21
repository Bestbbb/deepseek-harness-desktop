/**
 * Authenticated loopback Service Provider for the Tauri native desktop host.
 * @module @deepseek-ai/dsh-desktop-native
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DesktopHost, type DesktopNotification, type DesktopStatus } from '@deepseek-ai/dsh-desktop'

const TOKEN_HEADER = 'x-dsh-desktop-bridge-token'

/** Private native-bridge connection parameters injected by the desktop supervisor. */
export interface Config {
  /** Loopback HTTP origin of the per-launch native bridge. */
  endpoint: string
  /** Per-launch bearer token known only to the native host and Harness child. */
  token: string
  /** Maximum time allowed for one native operation. */
  timeoutMs?: number
}

interface ResolvedConfig {
  endpoint: string
  token: string
  timeoutMs: number
}

export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  token: z.string().role('secret').required(),
  timeoutMs: z.natural().min(1).default(5_000),
})

/**
 * Resolve and validate the private bridge origin before any operation can send its token.
 * @param config - schema-resolved plugin configuration.
 * @returns Normalized configuration with a URL origin and explicit timeout.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const endpoint = new URL(config.endpoint)
  if (endpoint.protocol !== 'http:'
    || endpoint.hostname !== '127.0.0.1'
    || endpoint.port === ''
    || endpoint.username !== ''
    || endpoint.password !== ''
    || endpoint.pathname !== '/'
    || endpoint.search !== ''
    || endpoint.hash !== '') {
    throw new Error('desktop-native: endpoint must be an http://127.0.0.1:<port> origin')
  }
  if (config.token.length === 0) throw new Error('desktop-native: token must not be empty')
  return {
    endpoint: endpoint.origin,
    token: config.token,
    timeoutMs: config.timeoutMs ?? 5_000,
  }
}

/** Tauri-hosted implementation of `ctx.desktop` over a private per-launch HTTP bridge. */
export class NativeDesktopHost extends DesktopHost {
  static Config = Config
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = resolveConfig(config)
  }

  /**
   * Probe the native bridge for desktop availability.
   * @returns The current native desktop status after the bridge responds.
   */
  async status(): Promise<DesktopStatus> {
    await this.request('GET', '/v1/status')
    return { available: true }
  }

  /**
   * Ask the native shell to reveal and focus its main window.
   * @returns After the native shell acknowledges the request.
   */
  show(): Promise<void> {
    return this.request('POST', '/v1/show')
  }

  /**
   * Deliver a user-visible notification through the native shell.
   * @param notification - Notification title and optional body to display.
   * @returns After the native shell accepts the notification.
   */
  notify(notification: DesktopNotification): Promise<void> {
    return this.request('POST', '/v1/notify', notification)
  }

  /**
   * Enable or disable native login startup for the desktop application.
   * @param enabled - Whether the application should start at login.
   * @returns After the operating system records the state.
   */
  setAutostart(enabled: boolean): Promise<void> {
    return this.request('POST', '/v1/autostart', { enabled })
  }

  private async request(method: 'GET' | 'POST', pathname: string, body?: object): Promise<void> {
    let response: Response
    try {
      response = await fetch(new URL(pathname, this.config.endpoint), {
        method,
        headers: {
          [TOKEN_HEADER]: this.config.token,
          ...body === undefined ? {} : { 'content-type': 'application/json' },
        },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      throw new Error(`desktop-native: native operation failed: ${renderError(error)}`)
    }
    if (!response.ok) {
      throw new Error(`desktop-native: native operation failed with HTTP ${String(response.status)}`)
    }
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default NativeDesktopHost
