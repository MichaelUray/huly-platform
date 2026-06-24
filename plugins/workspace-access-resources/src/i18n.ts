//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Localisation strings for time-bounded grants UI (DSGVO Art. 5
// Abs. 1 lit. e). The wac-resources plugin does NOT yet wire into
// the platform-wide IntlString / addStringsLoader machinery — every
// label in the current PersonDrawer + GrantedAccessTab is a hard-
// coded English literal. To keep parity with that pattern and not
// drag in the whole platform i18n stack for four new keys, we ship a
// minimal `wacStrings` object that resolves to a language at module
// load time from `navigator.language`.
//
// The four spec keys (GrantExpiryLabel, GrantExpiryNever,
// GrantExpiresIn, GrantExpired) are translated for `en` and `de`;
// every other locale falls back to `en`. When the plugin grows a
// real IntlString layer (future plugin.ts), these strings are the
// canonical source for the loader.
//

export interface WacStringBundle {
  grantExpiryLabel: string
  grantExpiryNever: string
  grantExpiresInTemplate: (duration: string) => string
  grantExpired: string
  /** Inline validation error surfaced by PersonDrawer when applying. */
  grantExpiryInPast: string
}

const bundles: Record<string, WacStringBundle> = {
  en: {
    grantExpiryLabel: 'Expires',
    grantExpiryNever: 'Never expires',
    grantExpiresInTemplate: (duration: string) => `Expires in ${duration}`,
    grantExpired: 'Expired (will be removed soon)',
    grantExpiryInPast: 'Expiry must be in the future.'
  },
  de: {
    grantExpiryLabel: 'Läuft ab',
    grantExpiryNever: 'Unbefristet',
    grantExpiresInTemplate: (duration: string) => `Läuft in ${duration} ab`,
    grantExpired: 'Abgelaufen (wird in Kürze entfernt)',
    grantExpiryInPast: 'Ablaufzeitpunkt muss in der Zukunft liegen.'
  }
}

function detectLanguage (): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const tag = navigator.language.toLowerCase()
    if (tag.startsWith('de')) return 'de'
  }
  return 'en'
}

export const wacStrings: WacStringBundle = bundles[detectLanguage()] ?? bundles.en

export interface GrantExpiryStatus {
  kind: 'never' | 'expiring' | 'expired'
  text: string
}

/**
 * Format the expiry of a grant for display. Pure function — takes
 * `now` so tests are deterministic.
 *
 *   expiresAt = null            → "Never expires"
 *   expiresAt > now             → "Expires in {duration}"  (kind: expiring)
 *   expiresAt <= now            → "Expired (...)"          (kind: expired)
 *
 * The duration string is locale-coarse (days / hours / minutes); we
 * deliberately avoid a full i18n date-fns dependency for four lines
 * of presentation.
 */
export function formatGrantExpiryStatus (
  expiresAt: string | null,
  now: number,
  strings: WacStringBundle = wacStrings
): GrantExpiryStatus {
  if (expiresAt === null) {
    return { kind: 'never', text: strings.grantExpiryNever }
  }
  const target = Date.parse(expiresAt)
  if (Number.isNaN(target)) {
    return { kind: 'never', text: strings.grantExpiryNever }
  }
  if (target <= now) {
    return { kind: 'expired', text: strings.grantExpired }
  }
  const deltaMs = target - now
  const duration = humaniseDuration(deltaMs)
  return { kind: 'expiring', text: strings.grantExpiresInTemplate(duration) }
}

export function humaniseDuration (ms: number): string {
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (day >= 1) return day === 1 ? '1d' : `${day}d`
  if (hr >= 1) return hr === 1 ? '1h' : `${hr}h`
  if (min >= 1) return min === 1 ? '1m' : `${min}m`
  return '<1m'
}
