/** Bounded HTTPS reads; redirects and ambient credentials are never forwarded. */

/**
 * Read a complete response under one deadline, including body consumption.
 * @param url - deployment-validated HTTPS endpoint.
 * @param limit - maximum decoded response bytes.
 * @param timeoutMs - whole response deadline.
 * @param signal - operation owner's cancellation.
 * @param transport - instance-local network implementation.
 * @returns Complete bytes, with the response reader released on every exit.
 */
export async function downloadCatalogBytes(
  url: string, limit: number, timeoutMs: number, signal: AbortSignal, transport: typeof fetch = fetch,
): Promise<Buffer> {
  const deadline = new AbortController()
  const cancellation = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(() =>{  deadline.abort(new Error('bundle catalog: download timed out')) }, timeoutMs)
  try {
    cancellation.throwIfAborted()
    const response = await transport(url, { signal: cancellation, redirect: 'error', credentials: 'omit', cache: 'no-store' })
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new Error('bundle catalog: download failed')
    }
    const reader = response.body.getReader()
    try {
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        cancellation.throwIfAborted()
        const { done, value } = await reader.read()
        cancellation.throwIfAborted()
        if (done) return Buffer.concat(chunks, size)
        size += value.length
        if (size > limit) throw new Error('bundle catalog: download exceeds byte limit')
        chunks.push(value)
      }
    } finally {
      // Abort and network errors can also reject cancel; the original read error owns the result.
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } finally { clearTimeout(timer) }
}
