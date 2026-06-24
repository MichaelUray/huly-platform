import {
  validateWebhookUrl,
  isBlockedIp,
  assertResolvedHostSafe,
  WebhookUrlError
} from '../webhooks/ssrf'

describe('validateWebhookUrl', () => {
  it('accepts a normal https URL', () => {
    const r = validateWebhookUrl('https://example.com/hook')
    expect(r.host).toBe('example.com')
  })

  it('rejects http://', () => {
    expect(() => validateWebhookUrl('http://example.com/hook')).toThrow(WebhookUrlError)
  })

  it('rejects file:// and ftp://', () => {
    expect(() => validateWebhookUrl('file:///etc/passwd')).toThrow(/scheme_not_https/)
    expect(() => validateWebhookUrl('ftp://example.com/x')).toThrow(/scheme_not_https/)
  })

  it('rejects empty / non-string / oversized URLs', () => {
    expect(() => validateWebhookUrl('')).toThrow(/invalid_url/)
    expect(() => validateWebhookUrl(undefined as unknown as string)).toThrow(/invalid_url/)
    expect(() => validateWebhookUrl('https://' + 'a'.repeat(2100))).toThrow(/invalid_url/)
  })

  it('rejects URLs with embedded credentials', () => {
    expect(() => validateWebhookUrl('https://user:pw@example.com/hook')).toThrow(/invalid_url/)
  })

  it('rejects literal-IP destinations in the private blocklist', () => {
    expect(() => validateWebhookUrl('https://192.168.1.1/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://10.0.0.5/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://127.0.0.1/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://169.254.169.254/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://172.16.5.5/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://100.64.0.1/hook')).toThrow(/host_is_blocked_ip/)
  })

  it('rejects literal-IPv6 destinations in the private blocklist', () => {
    expect(() => validateWebhookUrl('https://[::1]/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://[fc00::1]/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://[fe80::1]/hook')).toThrow(/host_is_blocked_ip/)
  })

  it('rejects "localhost"', () => {
    expect(() => validateWebhookUrl('https://localhost/hook')).toThrow(/host_is_blocked_ip/)
    expect(() => validateWebhookUrl('https://LocalHost:8443/hook')).toThrow(/host_is_blocked_ip/)
  })
})

describe('isBlockedIp', () => {
  it('classifies IPv4 ranges', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true)
    expect(isBlockedIp('172.16.0.1')).toBe(true)
    expect(isBlockedIp('172.31.255.255')).toBe(true)
    expect(isBlockedIp('172.32.0.1')).toBe(false)
    expect(isBlockedIp('192.168.0.1')).toBe(true)
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('169.254.0.1')).toBe(true)
    expect(isBlockedIp('100.64.0.1')).toBe(true)
    expect(isBlockedIp('100.128.0.1')).toBe(false)
    expect(isBlockedIp('8.8.8.8')).toBe(false)
  })

  it('classifies IPv6 ranges', () => {
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('fc00::1')).toBe(true)
    expect(isBlockedIp('fd12:3456::1')).toBe(true)
    expect(isBlockedIp('fe80::1')).toBe(true)
    expect(isBlockedIp('2001:db8::1')).toBe(false)
  })

  it('treats IPv4-mapped IPv6 as IPv4 for blocklist purposes', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:192.168.1.1')).toBe(true)
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false)
  })

  it('returns false for non-IP strings', () => {
    expect(isBlockedIp('example.com')).toBe(false)
    expect(isBlockedIp('')).toBe(false)
  })
})

describe('assertResolvedHostSafe', () => {
  it('passes when all answers are public', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:db8::1', family: 6 }
    ])
    await expect(assertResolvedHostSafe('example.com', lookup)).resolves.toBeUndefined()
  })

  it('rejects when any answer is private', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.1', family: 4 }
    ])
    await expect(assertResolvedHostSafe('rebind.test', lookup)).rejects.toThrow(/host_is_blocked_ip/)
  })

  it('rejects when DNS returns no records', async () => {
    const lookup = jest.fn().mockResolvedValue([])
    await expect(assertResolvedHostSafe('nx.example', lookup)).rejects.toThrow(/host_unresolvable/)
  })

  it('rejects when DNS throws', async () => {
    const lookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertResolvedHostSafe('nx.example', lookup)).rejects.toThrow(/host_unresolvable/)
  })
})
