import { formatGrantExpiryStatus, humaniseDuration, wacStrings } from '../i18n'

describe('formatGrantExpiryStatus', () => {
  const NOW = Date.parse('2026-06-21T12:00:00Z')

  it('returns Never for null expiresAt', () => {
    const s = formatGrantExpiryStatus(null, NOW)
    expect(s.kind).toBe('never')
    expect(s.text).toBe(wacStrings.grantExpiryNever)
  })

  it('returns Expired when expiresAt is in the past', () => {
    const s = formatGrantExpiryStatus('2026-06-20T12:00:00Z', NOW)
    expect(s.kind).toBe('expired')
    expect(s.text).toBe(wacStrings.grantExpired)
  })

  it('returns Expired when expiresAt == now (boundary)', () => {
    const s = formatGrantExpiryStatus('2026-06-21T12:00:00Z', NOW)
    expect(s.kind).toBe('expired')
  })

  it('returns Expiring with formatted duration in the future', () => {
    const s = formatGrantExpiryStatus('2026-06-24T12:00:00Z', NOW)
    expect(s.kind).toBe('expiring')
    expect(s.text).toBe(wacStrings.grantExpiresInTemplate('3d'))
  })

  it('treats malformed ISO as Never (defensive fallback)', () => {
    const s = formatGrantExpiryStatus('garbage', NOW)
    expect(s.kind).toBe('never')
  })
})

describe('humaniseDuration', () => {
  it('days dominate when >= 1 day', () => {
    expect(humaniseDuration(3 * 86400 * 1000)).toBe('3d')
    expect(humaniseDuration(1 * 86400 * 1000)).toBe('1d')
  })

  it('hours when 1h <= delta < 1d', () => {
    expect(humaniseDuration(5 * 3600 * 1000)).toBe('5h')
    expect(humaniseDuration(1 * 3600 * 1000)).toBe('1h')
  })

  it('minutes when 1m <= delta < 1h', () => {
    expect(humaniseDuration(45 * 60 * 1000)).toBe('45m')
    expect(humaniseDuration(60 * 1000)).toBe('1m')
  })

  it('"<1m" for sub-minute deltas', () => {
    expect(humaniseDuration(45 * 1000)).toBe('<1m')
    expect(humaniseDuration(0)).toBe('<1m')
  })
})

describe('wacStrings', () => {
  it('exposes the four spec keys', () => {
    expect(typeof wacStrings.grantExpiryLabel).toBe('string')
    expect(typeof wacStrings.grantExpiryNever).toBe('string')
    expect(typeof wacStrings.grantExpired).toBe('string')
    expect(typeof wacStrings.grantExpiresInTemplate).toBe('function')
    expect(wacStrings.grantExpiresInTemplate('3d')).toContain('3d')
  })
})
