//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Back-compat shim — see admin-shared/columnFilters.ts header.
//

export function tzTooltip (tsMs: number): string {
  const d = new Date(tsMs)
  let zoneName: string | undefined
  let offsetLabel: string | undefined
  try {
    const intlResolved = Intl.DateTimeFormat().resolvedOptions()
    zoneName = intlResolved.timeZone
    const fmt = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' })
    const parts = fmt.formatToParts(d)
    const off = parts.find((p) => p.type === 'timeZoneName')?.value
    if (off != null) offsetLabel = off
  } catch {
    // Intl unavailable
  }
  const localLine =
    zoneName != null && offsetLabel != null
      ? `Local time: ${d.toLocaleString()} (${zoneName}, ${offsetLabel})`
      : `Local time: ${d.toLocaleString()}`
  const utcLine = `UTC: ${d.toISOString().replace('T', ' ').slice(0, 19)}`
  return `${localLine}\n${utcLine}`
}
