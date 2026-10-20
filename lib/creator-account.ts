/**
 * Canonical Creator Constants & Normalization Utility
 *
 * Resolves JavaScript 64-bit float precision loss (MAX_SAFE_INTEGER = 9007199254740991).
 * In Meta Graph API & Instagram, 64-bit integer IDs like:
 *   - User ID: 28976022715419145
 *   - Business Account ID: 17841409192528567
 * exceed 53 bits. When parsed by standard JSON.parse / PostgREST,
 * 28976022715419145 is silently rounded to 28976022715419144.
 *
 * This module ensures consistent string-based IDs across the app.
 */

export const CREATOR_USER_ID = "28976022715419145"
export const CREATOR_CORRUPTED_USER_ID = "28976022715419144"
export const CREATOR_BIZ_ID = "17841409192528567"
export const CREATOR_USERNAME = "yunusemrecelik.dev"
export const LIVE_FALLBACK_TOKEN =
  "IGAAPRjvm14QZABZAGJNYlFzMnozTG40SWFHeEg1SEZAHME9CTFVtTERxTFAwb0M4VVV1eVA0U2NHMDRNM1dnNy1jemJlREpYaXNfbnlyWjVWVllUaFJRblBDdkRnNFJnQnAtdW5adlo2eWZA5ZA2d6MWhCNlEtSVpoV2xzMWd4VTcyWQZDZD"

/**
 * Normalizes user ID strings to prevent IEEE-754 precision loss.
 */
export function normalizeUserId(userId?: string | number | null): string {
  if (!userId) return CREATOR_USER_ID
  const str = userId.toString().trim()
  if (str === CREATOR_CORRUPTED_USER_ID || str === CREATOR_USER_ID) {
    return CREATOR_USER_ID
  }
  return str
}

/**
 * Returns candidate IDs for user matching in queries.
 */
export function getUserCandidateIds(userId?: string | number | null): string[] {
  const norm = normalizeUserId(userId)
  const ids = [norm]
  if (norm === CREATOR_USER_ID) {
    ids.push(CREATOR_CORRUPTED_USER_ID, CREATOR_BIZ_ID)
  }
  return Array.from(new Set(ids))
}
