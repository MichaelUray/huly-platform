import { decodeFilterParam, encodeFilterParam } from '../filterParam'

// jsdom + Node both provide atob/btoa; avoid touching `Buffer` because the
// `ui` rig's tsconfig does not include @types/node.
function b64 (utf8: string): string {
  const bytes = new TextEncoder().encode(utf8)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

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
    expect(() => decodeFilterParam(b64('{"__proto__":{"polluted":true}}'))).toThrow(/forbidden key/)
  })

  it('rejects constructor keys recursively', () => {
    expect(() => decodeFilterParam(b64('{"a":{"constructor":{"b":1}}}'))).toThrow(/forbidden key/)
  })

  it('returns null on invalid base64', () => {
    expect(decodeFilterParam('not-base64-!!')).toBeNull()
  })

  it('returns null on non-object payload', () => {
    expect(decodeFilterParam(b64('"a-string"'))).toBeNull()
    expect(decodeFilterParam(b64('[1,2]'))).toBeNull()
    expect(decodeFilterParam(b64('null'))).toBeNull()
  })
})
