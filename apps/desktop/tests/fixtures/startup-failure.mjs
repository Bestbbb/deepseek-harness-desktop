/** Hold plugin startup until the smoke observes the HTTP listener, then fail boot. */
export const inject = ['webServer']

/** Report the allocated port independently of the Web application's committed URL announcement. */
export async function apply(ctx, config) {
  const barrier = new URL(config.barrier)
  barrier.searchParams.set('port', String(ctx.webServer.port))
  const response = await fetch(barrier)
  if (!response.ok) throw new Error('Startup fixture barrier failed')
  await response.text()
  throw new Error('Deliberate desktop startup failure')
}
