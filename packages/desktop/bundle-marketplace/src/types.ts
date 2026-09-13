/** Browser-safe marketplace commands and native activation observations. */
import type { BundleCatalogId, BundleCatalogStatus, BundleReviewToken, BundleCompatibilityIssue, BundleDetails, ProfileBundle } from '@deepseek-ai/dsh-bundle-preparation/types'
import type { DesktopProfileName, DesktopProfileSelection } from '@deepseek-ai/dsh-desktop'

/** Reviewed discovery metadata; artifact paths and configuration never cross this projection. */
export interface MarketplaceEntry {
  readonly id: BundleCatalogId
  readonly reviewToken: BundleReviewToken
  readonly title: string
  readonly packageName: string
  readonly version: string
  readonly publisher: string
  readonly source: string
  readonly details: BundleDetails | null
  readonly issues: readonly BundleCompatibilityIssue[]
}

/** Profile observations are independent of native activation and do not prove plugin health. */
export type MarketplaceProfile = { readonly profile: DesktopProfileName } & (
  | { readonly state: 'read'; readonly bundles: readonly ProfileBundle[] }
  | { readonly state: 'unavailable' }
)

/** Point-in-time native selection and on-disk versions, not a running-plugin health check. */
export interface MarketplaceSnapshot {
  readonly catalog: BundleCatalogStatus
  readonly entries: readonly MarketplaceEntry[]
  readonly selection: DesktopProfileSelection
  readonly profiles: readonly MarketplaceProfile[]
}

/** A rejected call may follow committed native state; read again before retrying. */
export type MarketplaceCommandResult = 'acknowledged' | 'unconfirmed'
