/** Observe the selected Profile and unchanged Harness home through the real CLI startup path. */
import { writeFileSync } from 'node:fs'

/** Record only fixture-owned startup metadata; an optional failure precedes launcher commit. */
export function apply(_ctx, config) {
  const index = process.argv.indexOf('--profile')
  writeFileSync(config.receipt, JSON.stringify({
    profile: process.argv[index + 1],
    home: process.env.DSH_HOME,
  }))
  if (config.fail) throw new Error('Deliberate candidate Profile startup failure')
}
