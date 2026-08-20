/** Host verification for the optional per-launch desktop bearer token. */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { DESKTOP_AUTH_HEADER, DESKTOP_AUTH_PROTOCOL_PREFIX } from './desktop-auth.ts'

interface DesktopAuthRequest {
  headers: IncomingHttpHeaders | Headers
}

function header(headers: IncomingHttpHeaders | Headers, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function matches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false
  const actualBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

/**
 * Verify one HTTP RPC request under the optional desktop authentication policy.
 * @param request - request headers.
 * @param expected - configured per-launch token; undefined preserves ordinary Web behavior.
 * @returns Whether the request may continue to the existing trust fence.
 */
export function isDesktopAuthenticatedRequest(
  request: DesktopAuthRequest,
  expected: string | undefined,
): boolean {
  return expected === undefined || matches(header(request.headers, DESKTOP_AUTH_HEADER), expected)
}

/**
 * Verify one WebSocket upgrade under the optional desktop authentication policy.
 * @param request - upgrade request headers.
 * @param expected - configured per-launch token; undefined preserves ordinary Web behavior.
 * @returns Whether the upgrade may continue to the existing trust fence.
 */
export function isDesktopAuthenticatedUpgrade(
  request: DesktopAuthRequest,
  expected: string | undefined,
): boolean {
  if (expected === undefined) return true
  const protocols = header(request.headers, 'sec-websocket-protocol')?.split(',').map(value => value.trim()) ?? []
  const provided = protocols.find(value => value.startsWith(DESKTOP_AUTH_PROTOCOL_PREFIX))
    ?.slice(DESKTOP_AUTH_PROTOCOL_PREFIX.length)
  return matches(provided, expected)
}
