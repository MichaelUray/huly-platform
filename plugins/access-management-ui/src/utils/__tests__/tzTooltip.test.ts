import { tzTooltip } from '../tzTooltip'

describe('tzTooltip', () => {
  it('returns two lines (local + UTC)', () => {
    const result = tzTooltip(Date.UTC(2026, 5, 15, 12, 30, 0))
    expect(result).toMatch(/Local time: /)
    expect(result).toMatch(/UTC: 2026-06-15 12:30:00/)
    expect(result.split('\n').length).toBe(2)
  })

  it('renders UTC with second precision', () => {
    const result = tzTooltip(Date.UTC(2026, 0, 1, 0, 0, 0))
    expect(result).toContain('UTC: 2026-01-01 00:00:00')
  })
})
