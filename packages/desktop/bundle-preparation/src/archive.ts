/** Inspect reviewed tar bytes without extracting or evaluating any package code. */
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { Parser, type ReadEntry } from 'tar'
import { z } from 'zod'
import type { InstallerConfig, ReviewedBundle } from './types.ts'

const manifestSchema = z.object({
  name: z.string(), version: z.string(),
  dsh: z.object({ bundle: z.object({ patch: z.string().min(1) }) }),
})
const decompress = promisify(gunzip)

/**
 * Accept portable, relative archive paths beneath the npm package root.
 * @param path - archive or Bundle patch path.
 * @returns Whether the name is safe on both supported desktop operating systems.
 */
export function portablePath(path: string): boolean {
  return path.length > 0 && !/[\\:<>"|?*\x00-\x1f]/u.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'
      && !/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
}

/**
 * Check archive bounds, portable names, package identity and a contained Bundle patch.
 * Links and special files are unsupported; byte identity is checked by the calling service.
 * @param bytes - complete reviewed compressed tarball.
 * @param review - expected catalog identity.
 * @param limits - deployment-owned archive budgets.
 * @returns After parsing every entry; no file is extracted or imported.
 */
export async function inspectArchive(bytes: Buffer, review: ReviewedBundle, limits: Pick<InstallerConfig, 'maxExpandedBytes' | 'maxArchiveEntries' | 'maxManifestBytes'>): Promise<void> {
  const uncompressed = await decompress(bytes, { maxOutputLength: limits.maxExpandedBytes })
  let count = 0
  const paths = new Set<string>()
  const files = new Set<string>()
  const manifestChunks: Buffer[] = []
  const parser = new Parser({ strict: true, maxMetaEntrySize: limits.maxManifestBytes })
  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject)
    parser.on('end', resolve)
    parser.on('entry', (entry: ReadEntry) => {
      const path = entry.path.replace(/\/$/u, '')
      if (++count > limits.maxArchiveEntries) {
        parser.abort(new Error('bundle preparation: archive exceeds expansion limits'))
        return
      }
      if (!portablePath(path) || (path !== 'package' && !path.startsWith('package/'))
        || paths.has(path.toLowerCase()) || (entry.type !== 'File' && entry.type !== 'Directory')) {
        parser.abort(new Error('bundle preparation: unsupported archive path or entry type'))
        return
      }
      paths.add(path.toLowerCase())
      if (entry.type === 'File') files.add(path)
      if (path === 'package/package.json') {
        if (entry.size > limits.maxManifestBytes) {
          parser.abort(new Error('bundle preparation: package manifest exceeds byte limit'))
          return
        }
        entry.on('data', (chunk: Buffer) => manifestChunks.push(chunk))
      }
      entry.resume()
    })
    parser.end(uncompressed)
  })
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(manifestChunks))))
  if (manifest.name !== review.packageName || manifest.version !== review.version) {
    throw new Error('bundle preparation: package identity does not match the reviewed catalog')
  }
  const patch = manifest.dsh.bundle.patch.replace(/^\.\//u, '')
  if (!portablePath(patch) || !files.has(`package/${patch}`)) {
    throw new Error('bundle preparation: Bundle patch must name a file inside the package')
  }
}
