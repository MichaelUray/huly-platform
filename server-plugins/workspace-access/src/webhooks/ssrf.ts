//
// Copyright © 2026 Hardcore Engineering Inc.
//
// SSRF guard for outbound webhooks. Two stages:
//
//   1. validateWebhookUrl(url)    — synchronous structural check
//      (scheme, no userinfo, parseable host).
//   2. assertResolvedHostSafe(host, lookup)
//                                 — async DNS check, blocks any
//      address inside the private/loopback/link-local/CGNAT/unique-local
//      blocks listed below.
//
// Both stages are deliberately independent so callers can unit-test
// the structural part without a DNS dependency.
//
// Private-range blocklist (RFC 1918 / RFC 4193 / RFC 6598 / RFC 3927):
//   IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
//         127.0.0.0/8, 169.254.0.0/16, 100.64.0.0/10
//   IPv6: ::1, fc00::/7, fe80::/10
//

import { isIP } from 'net'

export class WebhookUrlError extends Error {
  readonly code: string
  constructor (code: string, message?: string) {
    // Always include the stable `code` in the message so caller .toThrow
    // matchers + log lines remain searchable by code.
    super(message != null && message !== code ? `${code}: ${message}` : code)
    this.name = 'WebhookUrlError'
    this.code = code
  }
}

export interface UrlValidationResult {
  url: URL
  host: string
}

/**
 * Synchronous structural validation. Returns the parsed URL and the
 * hostname for the subsequent DNS-resolution step. Throws on any
 * disallowed scheme/shape.
 *
 * Rejection codes (stable, surfaceable to the API):
 *   invalid_url           — not parseable, contains userinfo, etc.
 *   scheme_not_https      — only https:// is allowed
 *   host_empty            — missing host component
 *   host_is_blocked_ip    — host is a literal IP inside the blocklist
 */
export function validateWebhookUrl (raw: string): UrlValidationResult {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    throw new WebhookUrlError('invalid_url', 'URL must be a non-empty string up to 2048 chars')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WebhookUrlError('invalid_url', 'URL not parseable')
  }
  if (url.protocol !== 'https:') {
    throw new WebhookUrlError('scheme_not_https', `Only https:// is allowed, got ${url.protocol}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new WebhookUrlError('invalid_url', 'URLs with embedded credentials are rejected')
  }
  // URL.hostname keeps the IPv6 brackets (`[::1]`); strip them before
  // running the IP-vs-blocklist check so the literal-IP guard fires
  // for IPv6 URLs too.
  const rawHost = url.hostname
  if (rawHost === '') {
    throw new WebhookUrlError('host_empty', 'Host component is empty')
  }
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost
  // If the host happens to be a literal IP, run the blocklist check
  // already at this stage so we don't even attempt a DNS resolve.
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) {
      throw new WebhookUrlError('host_is_blocked_ip', `Host ${host} is in the private/loopback blocklist`)
    }
  }
  // localhost is not a literal IP but explicit-block it so it doesn't
  // sneak through if /etc/hosts maps it to a public address.
  if (host.toLowerCase() === 'localhost') {
    throw new WebhookUrlError('host_is_blocked_ip', 'Host "localhost" is blocked')
  }
  return { url, host }
}

/**
 * Decide whether an already-resolved IP address falls inside the
 * blocklist. Exposed so the dispatcher can run the check against each
 * answer returned by DNS lookup.
 */
export function isBlockedIp (ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isBlockedIPv4(ip)
  if (v === 6) return isBlockedIPv6(ip)
  return false
}

function isBlockedIPv4 (ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false
  }
  const [a, b] = parts
  // 0.0.0.0/8 (current network)
  if (a === 0) return true
  // 10.0.0.0/8
  if (a === 10) return true
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isBlockedIPv6 (ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  // IPv4-mapped (::ffff:a.b.c.d) — re-check against IPv4 block list
  const mappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(normalized)
  if (mappedMatch != null) {
    return isBlockedIPv4(mappedMatch[1])
  }
  // fc00::/7 — Unique Local Addresses (fc.. or fd..)
  if (/^fc/.test(normalized) || /^fd/.test(normalized)) return true
  // fe80::/10 — Link-local
  if (/^fe8/.test(normalized) || /^fe9/.test(normalized) || /^fea/.test(normalized) || /^feb/.test(normalized)) return true
  return false
}

export type LookupFn = (host: string) => Promise<Array<{ address: string, family: 4 | 6 }>>

/**
 * Resolves a host via the provided lookup function and asserts that
 * NONE of the returned addresses is in the blocklist.
 * Throws WebhookUrlError('host_is_blocked_ip') on any hit so that a
 * DNS rebinding setup that returns a private answer for one of the
 * records can't sneak through.
 */
export async function assertResolvedHostSafe (host: string, lookup: LookupFn): Promise<void> {
  let answers: Array<{ address: string, family: 4 | 6 }>
  try {
    answers = await lookup(host)
  } catch (err) {
    throw new WebhookUrlError('host_unresolvable', `DNS lookup failed for ${host}`)
  }
  if (answers.length === 0) {
    throw new WebhookUrlError('host_unresolvable', `DNS lookup returned no records for ${host}`)
  }
  for (const ans of answers) {
    if (isBlockedIp(ans.address)) {
      throw new WebhookUrlError('host_is_blocked_ip', `Host ${host} resolves to blocked IP ${ans.address}`)
    }
  }
}
