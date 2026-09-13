/** Read-only publication check using the same catalog and archive validators as desktop installation. */
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCatalog } from '../packages/desktop/bundle-preparation/src/catalog.ts'
import { inspectArchive } from '../packages/desktop/bundle-preparation/src/archive.ts'
import { boundedFile } from '../packages/desktop/bundle-preparation/src/files.ts'

/** Publication budgets; reviewers can impose stricter limits than the shipped desktop. */
export interface MarketplaceReviewLimits {
  maxCatalogBytes: number
  maxArtifactBytes: number
  maxExpandedBytes: number
  maxArchiveEntries: number
  maxManifestBytes: number
}

/**
 * Verify a local catalog and all its artifacts without extracting, importing, installing or downloading code.
 * @param directory - Directory containing catalog.json and the declared tarballs.
 * @param limits - Explicit byte and archive-entry budgets.
 * @returns Number of entries checked; rejects empty catalogs, missing guidance or invalid artifacts.
 */
export async function verifyMarketplaceCatalog(directory: string, limits: MarketplaceReviewLimits): Promise<number> {
  const entries = parseCatalog(await boundedFile(join(directory, 'catalog.json'), limits.maxCatalogBytes))
  if (entries.length === 0) throw new Error('Marketplace publication requires at least one Bundle')
  for (const entry of entries) {
    if (entry.details === null) throw new Error(`${entry.id}: bilingual accounts, access and setup guidance is required`)
    if (entry.artifact.size > limits.maxArtifactBytes) throw new Error(`${entry.id}: artifact exceeds publication byte limit`)
    const bytes = await boundedFile(join(directory, entry.artifact.file), entry.artifact.size)
    if (bytes.length !== entry.artifact.size || createHash('sha256').update(bytes).digest('hex') !== entry.artifact.sha256) {
      throw new Error(`${entry.id}: artifact size or SHA-256 does not match the catalog`)
    }
    await inspectArchive(bytes, entry, limits)
  }
  return entries.length
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (directory === undefined || process.argv.length !== 3) throw new Error('Usage: pnpm marketplace:verify <catalog-directory>')
  const count = await verifyMarketplaceCatalog(resolve(directory), {
    maxCatalogBytes: 1_048_576, maxArtifactBytes: 52_428_800,
    maxExpandedBytes: 134_217_728, maxArchiveEntries: 10_000, maxManifestBytes: 1_048_576,
  })
  console.log(`Verified ${String(count)} Bundle artifact(s). This checks packaging, not publisher trust, code safety or runtime compatibility.`)
}
