import { buildQuery } from '../api/buildQuery'

describe('buildQuery', () => {
  it('returns empty for no opts', () => {
    expect(buildQuery()).toBe('')
    expect(buildQuery({})).toBe('')
  })

  it('encodes cursor + sort + limit', () => {
    const s = buildQuery({ cursor: 'c1', sort: 'name', limit: 25 })
    expect(s).toContain('cursor=c1')
    expect(s).toContain('sort=name')
    expect(s).toContain('limit=25')
    expect(s.startsWith('?')).toBe(true)
  })

  it('encodes filter as a single base64 param (never as [object Object])', () => {
    const s = buildQuery({ filter: { roleIn: ['OWNER'], name: 'a' } })
    expect(s).toContain('filter=')
    expect(s).not.toContain('[object')
  })

  it('drops the filter param when filter is empty', () => {
    expect(buildQuery({ filter: {} })).toBe('')
  })
})
