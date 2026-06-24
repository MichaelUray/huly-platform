import {
  dispatchWebhook,
  buildPayload,
  signPayload,
  type WebhookSubscription,
  type AuditEvent
} from '../webhooks/dispatcher'

const baseSub: WebhookSubscription = {
  id: 'wh-1',
  workspace: 'ws1',
  url: 'https://example.com/hook',
  secret: null,
  eventTypes: ['role_changed'],
  active: true,
  dataFilter: 'minimal'
}

const baseEvent: AuditEvent = {
  workspace: 'ws1',
  action: 'role_changed',
  timestamp: '2026-06-21T12:00:00Z',
  actorUuid: 'actor-u',
  targetAccountUuid: 'target-u',
  targetSpace: 'space-1',
  targetEmail: 'a@b.com',
  targetName: 'Alice Bob'
}

const publicLookup = async (): Promise<Array<{ address: string, family: 4 | 6 }>> =>
  [{ address: '93.184.216.34', family: 4 }]

describe('buildPayload', () => {
  it('omits PII in minimal mode', () => {
    const p = buildPayload(baseSub, baseEvent)
    expect(p.target_email).toBeUndefined()
    expect(p.target_name).toBeUndefined()
    expect(p.actor_uuid).toBe('actor-u')
    expect(p.target_account_uuid).toBe('target-u')
    expect(p.workspace).toBe('ws1')
    expect(p.action).toBe('role_changed')
  })

  it('includes PII in full mode', () => {
    const p = buildPayload({ ...baseSub, dataFilter: 'full' }, baseEvent)
    expect(p.target_email).toBe('a@b.com')
    expect(p.target_name).toBe('Alice Bob')
  })
})

describe('signPayload', () => {
  it('produces a stable sha256 prefix', () => {
    const sig = signPayload('shhh-secret', '{"a":1}')
    expect(sig.startsWith('sha256=')).toBe(true)
    // identical body+secret → identical signature
    expect(sig).toBe(signPayload('shhh-secret', '{"a":1}'))
    // changing the body changes the signature
    expect(sig).not.toBe(signPayload('shhh-secret', '{"a":2}'))
    // changing the secret changes the signature
    expect(sig).not.toBe(signPayload('other', '{"a":1}'))
  })
})

describe('dispatchWebhook — happy path', () => {
  it('returns ok=true on first 200 and emits the signature header', async () => {
    let captured: Record<string, string> | undefined
    const fakeFetch = jest.fn(async (_url: string, init: any) => {
      captured = init.headers as Record<string, string>
      return new Response('ok', { status: 200 })
    })
    const sub: WebhookSubscription = { ...baseSub, secret: 'shhh-secret-1' }
    const res = await dispatchWebhook(sub, baseEvent, {
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => undefined,
      lookup: publicLookup
    })
    expect(res.ok).toBe(true)
    expect(res.attempts.length).toBe(1)
    expect(captured?.['x-wac-webhook-signature']).toMatch(/^sha256=/)
    expect(captured?.['x-wac-event']).toBe('role_changed')
    expect(captured?.['x-wac-workspace']).toBe('ws1')
    expect(captured?.['x-wac-webhook-id']).toBe('wh-1')
  })

  it('omits signature header when no secret is set', async () => {
    let captured: Record<string, string> | undefined
    const fakeFetch = jest.fn(async (_url: string, init: any) => {
      captured = init.headers as Record<string, string>
      return new Response('ok', { status: 200 })
    })
    const res = await dispatchWebhook(baseSub, baseEvent, {
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => undefined,
      lookup: publicLookup
    })
    expect(res.ok).toBe(true)
    expect(captured?.['x-wac-webhook-signature']).toBeUndefined()
  })
})

describe('dispatchWebhook — retry', () => {
  it('retries on 500 and reports all attempts', async () => {
    const fakeFetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const sleeps: number[] = []
    const res = await dispatchWebhook(baseSub, baseEvent, {
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async (ms: number) => {
        sleeps.push(ms)
      },
      lookup: publicLookup,
      retryDelaysMs: [1, 2, 3]
    })
    expect(res.ok).toBe(true)
    expect(res.attempts.length).toBe(3)
    expect(sleeps).toEqual([1, 2])
  })

  it('gives up after all retries and records the failure audit', async () => {
    const fakeFetch = jest.fn(async () => new Response('boom', { status: 500 }))
    const failureSpy = jest.fn(async () => undefined)
    const res = await dispatchWebhook(baseSub, baseEvent, {
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => undefined,
      lookup: publicLookup,
      retryDelaysMs: [1, 1, 1],
      recordFailureAudit: failureSpy
    })
    expect(res.ok).toBe(false)
    expect(res.attempts.length).toBe(4)
    expect(failureSpy).toHaveBeenCalledTimes(1)
  })

  it('bails out (no retry) on URL validation failure', async () => {
    const sub: WebhookSubscription = { ...baseSub, url: 'http://example.com/hook' }
    const fakeFetch = jest.fn(async () => new Response('ok', { status: 200 }))
    const res = await dispatchWebhook(sub, baseEvent, {
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => undefined,
      lookup: publicLookup
    })
    expect(res.ok).toBe(false)
    expect(res.attempts.length).toBe(1)
    expect(fakeFetch).not.toHaveBeenCalled()
    expect(res.attempts[0].error).toMatch(/scheme_not_https/)
  })

  it('bails out when DNS resolves to a private IP', async () => {
    const fakeFetch = jest.fn()
    const res = await dispatchWebhook(baseSub, baseEvent, {
      fetch: fakeFetch as unknown as typeof fetch,
      sleep: async () => undefined,
      lookup: async () => [{ address: '192.168.1.1', family: 4 }]
    })
    expect(res.ok).toBe(false)
    expect(fakeFetch).not.toHaveBeenCalled()
    expect(res.attempts[0].error).toMatch(/host_is_blocked_ip/)
  })
})
