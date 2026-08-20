/** Browser-safe desktop authentication constants and per-launch token lookup. */

/** HTTP header carrying the desktop WebView's per-launch bearer token. */
export const DESKTOP_AUTH_HEADER = 'x-dsh-desktop-token'
/** WebSocket subprotocol prefix carrying the same bearer token during upgrade. */
export const DESKTOP_AUTH_PROTOCOL_PREFIX = 'dsh-auth.'

/**
 * Read the non-enumerable token installed by the native WebView before page scripts run.
 * @returns The token in a desktop WebView, otherwise undefined.
 */
export function desktopAuthToken(): string | undefined {
  const value = (globalThis as { __DSH_DESKTOP_AUTH_TOKEN__?: unknown }).__DSH_DESKTOP_AUTH_TOKEN__
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Add desktop authentication to an HTTP header collection when the native host installed a token.
 * @param initial - caller-owned request headers.
 * @returns A new Headers value containing the caller fields and optional token.
 */
export function withDesktopAuth(initial?: HeadersInit): Headers {
  const headers = new Headers(initial)
  const token = desktopAuthToken()
  if (token !== undefined) headers.set(DESKTOP_AUTH_HEADER, token)
  return headers
}

/**
 * Build the optional WebSocket subprotocol list for the native desktop carrier.
 * @returns An empty list outside desktop, or one token-bearing protocol.
 */
export function desktopAuthProtocols(): string[] {
  const token = desktopAuthToken()
  return token === undefined ? [] : [`${DESKTOP_AUTH_PROTOCOL_PREFIX}${token}`]
}
