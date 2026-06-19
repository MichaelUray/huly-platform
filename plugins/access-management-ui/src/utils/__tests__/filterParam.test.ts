import { decodeFilterParam, encodeFilterParam } from '../filterParam'

describe('filterParam round-trip', () => {
  it('round-trips a flat filter', () => {
    const original = { role: 'OWNER', name: 'Älice' }
    expect(decodeFilterParam(encodeFilterParam(original))).toEqual(original)
  })

  it('round-trips nested + array filter values', () => {
    const original = {
      activityBucket: ['today', '7d'],
      range: { from: 1, to: 100 }
    }
    expect(decodeFilterParam(encodeFilterParam(original))).toEqual(original)
  })

  it('rejects __proto__ keys', () => {
    const raw = Buffer.from('{"__proto__":{"polluted":true}}').toString('base64')
    expect(() => decodeFilterParam(raw)).toThrow(/forbidden key/)
  })

  it('rejects constructor keys recursively', () => {
    const raw = Buffer.from('{"a":{"constructor":{"b":1}}}').toString('base64')
    expect(() => decodeFilterParam(raw)).toThrow(/forbidden key/)
  })

  it('returns null on invalid base64', () => {
    expect(decodeFilterParam('not-base64-!!')).toBeNull()
  })

  it('returns null on non-object payload', () => {
    expect(decodeFilterParam(Buffer.from('"a-string"').toString('base64'))).toBeNull()
    expect(decodeFilterParam(Buffer.from('[1,2]').toString('base64'))).toBeNull()
    expect(decodeFilterParam(Buffer.from('null').toString('base64'))).toBeNull()
  })
})
