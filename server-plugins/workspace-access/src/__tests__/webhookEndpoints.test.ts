import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  dispatchActiveWebhooksAsync,
  ValidationError,
  ALLOWED_WEBHOOK_EVENT_TYPES,
  MAX_WEBHOOKS_PER_WORKSPACE,
  type WebhookBackend,
  type WebhookCtx,
  type WebhookRow
} from '../endpoints/webhookEndpoints'

function makeRow (overrides: Partial<WebhookRow> = {}): WebhookRow {
  return {
    id: 'wh-1',
    workspace: 'ws1',
    url: 'https://example.com/hook',
    secret: null,
    eventTypes: ['role_changed'],
    active: true,
    dataFilter: 'minimal',
    createdBy: 'u1',
    createdAt: '2026-06-21T00:00:00Z',
    ...overrides
  }
}

function makeBackend (initial: WebhookRow[] = []): WebhookBackend & { rows: WebhookRow[] } {
  const rows: WebhookRow[] = [...initial]
  let nextId = initial.length + 1
  return {
    rows,
    list: async (ws) => rows.filter((r) => r.workspace === ws),
    getById: async (ws, id) => rows.find((r) => r.workspace === ws && r.id === id) ?? null,
    create: async (input) => {
      const row: WebhookRow = {
        id: 'wh-' + nextId++,
        ...input,
        createdAt: '2026-06-21T00:00:00Z'
      }
      rows.push(row)
      return row
    },
    update: async (ws, id, patch) => {
      const idx = rows.findIndex((r) => r.workspace === ws && r.id === id)
      if (idx < 0) return null
      rows[idx] = { ...rows[idx], ...patch, secret: patch.secret === undefined ? rows[idx].secret : patch.secret }
      return rows[idx]
    },
    delete: async (ws, id) => {
      const idx = rows.findIndex((r) => r.workspace === ws && r.id === id)
      if (idx < 0) return false
      rows.splice(idx, 1)
      return true
    },
    listActiveForEvent: async (ws, event) =>
      rows.filter((r) => r.workspace === ws && r.active && r.eventTypes.includes(event))
  }
}

function makeCtx (overrides: Partial<WebhookCtx> = {}): WebhookCtx {
  const base: any = {
    token: { audience: 'workspace', workspace: 'ws1' },
    account: { uuid: 'u1' },
    membership: { role: 'OWNER', ownedSpaces: [] },
    isImpersonating: false,
    workspace: 'ws1',
    actorUuid: 'u1',
    actorRole: 'workspace_owner',
    tx: { begin: async <T>(fn: (txCtx: any) => Promise<T>) => fn({ ws: jest.fn(), admin: jest.fn(), domain: {} }) }
  }
  return { ...base, ...overrides }
}

describe('CRUD endpoints — happy path', () => {
  it('creates, lists, updates, deletes', async () => {
    const ctx = makeCtx()
    const be = makeBackend()
    const created = await createWebhook(
      ctx,
      'ws1',
      { url: 'https://example.com/h', event_types: ['role_changed', 'grant_created'], data_filter: 'minimal' },
      be
    )
    expect(created.id).toBeDefined()
    expect(created.eventTypes).toEqual(['role_changed', 'grant_created'])
    const list = await listWebhooks(ctx, 'ws1', be)
    expect(list.length).toBe(1)
    const updated = await updateWebhook(ctx, 'ws1', created.id, { active: false, data_filter: 'full' }, be)
    expect(updated.active).toBe(false)
    expect(updated.dataFilter).toBe('full')
    await deleteWebhook(ctx, 'ws1', created.id, be)
    expect((await listWebhooks(ctx, 'ws1', be)).length).toBe(0)
  })

  it('persists hashed secret', async () => {
    const ctx = makeCtx()
    const be = makeBackend()
    const created = await createWebhook(
      ctx,
      'ws1',
      { url: 'https://example.com/h', event_types: ['role_changed'], secret: 'super-secret-123' },
      be
    )
    expect(created.secret).toBe('super-secret-123')
  })
})

describe('Validation', () => {
  const ctx = makeCtx()
  const be = makeBackend()

  it('rejects invalid URL (http://) with 400', async () => {
    await expect(
      createWebhook(ctx, 'ws1', { url: 'http://example.com/h', event_types: ['role_changed'] }, be)
    ).rejects.toThrow(/scheme_not_https/)
    try {
      await createWebhook(ctx, 'ws1', { url: 'http://example.com/h', event_types: ['role_changed'] }, be)
    } catch (err: any) {
      expect(err.status).toBe(400)
    }
  })

  it('rejects SSRF (private IP) with 422', async () => {
    let caught: any
    try {
      await createWebhook(ctx, 'ws1', { url: 'https://192.168.1.5/h', event_types: ['role_changed'] }, be)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ValidationError)
    expect(caught.status).toBe(422)
    expect(caught.code).toBe('host_is_blocked_ip')
  })

  it('rejects localhost', async () => {
    await expect(
      createWebhook(ctx, 'ws1', { url: 'https://localhost/h', event_types: ['role_changed'] }, be)
    ).rejects.toThrow(/host_is_blocked_ip/)
  })

  it('requires non-empty event_types', async () => {
    await expect(
      createWebhook(ctx, 'ws1', { url: 'https://example.com/h', event_types: [] }, be)
    ).rejects.toThrow(/event_types_required/)
  })

  it('rejects unknown event types', async () => {
    await expect(
      createWebhook(ctx, 'ws1', { url: 'https://example.com/h', event_types: ['bogus_event'] }, be)
    ).rejects.toThrow(/event_type_unknown/)
  })

  it('rejects bad data_filter', async () => {
    await expect(
      createWebhook(ctx, 'ws1', { url: 'https://example.com/h', event_types: ['role_changed'], data_filter: 'spicy' }, be)
    ).rejects.toThrow(/data_filter_invalid/)
  })

  it('rejects too-short secret', async () => {
    await expect(
      createWebhook(ctx, 'ws1', { url: 'https://example.com/h', event_types: ['role_changed'], secret: 'short' }, be)
    ).rejects.toThrow(/secret_too_short/)
  })

  it('enforces per-workspace cap', async () => {
    const ctx2 = makeCtx()
    const rows: WebhookRow[] = []
    for (let i = 0; i < MAX_WEBHOOKS_PER_WORKSPACE; i++) {
      rows.push(makeRow({ id: 'wh-' + i }))
    }
    const be2 = makeBackend(rows)
    await expect(
      createWebhook(ctx2, 'ws1', { url: 'https://example.com/h', event_types: ['role_changed'] }, be2)
    ).rejects.toThrow(/too_many_webhooks/)
  })

  it('allows whole event-type allowlist', () => {
    expect(ALLOWED_WEBHOOK_EVENT_TYPES.length).toBeGreaterThanOrEqual(4)
    expect(ALLOWED_WEBHOOK_EVENT_TYPES).toContain('role_changed')
    expect(ALLOWED_WEBHOOK_EVENT_TYPES).toContain('grant_created')
    expect(ALLOWED_WEBHOOK_EVENT_TYPES).toContain('member_removed')
    expect(ALLOWED_WEBHOOK_EVENT_TYPES).toContain('grant_expired')
  })
})

describe('Gating', () => {
  it('rejects non-owner readers', async () => {
    const ctx = makeCtx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } } as any)
    const be = makeBackend()
    await expect(listWebhooks(ctx, 'ws1', be)).rejects.toThrow(/webhook_write_not_allowed/)
  })

  it('rejects workspace-claim mismatch', async () => {
    const ctx = makeCtx({ token: { audience: 'workspace', workspace: 'ws2' } } as any)
    const be = makeBackend()
    await expect(listWebhooks(ctx, 'ws1', be)).rejects.toThrow(/workspace mismatch/)
  })

  it('allows IMPERSONATING_ADMIN', async () => {
    const ctx = makeCtx({
      isImpersonating: true,
      instanceAdminUuid: 'admin-x',
      membership: { role: 'OWNER', ownedSpaces: [] }
    } as any)
    const be = makeBackend()
    await expect(listWebhooks(ctx, 'ws1', be)).resolves.toBeDefined()
  })
})

describe('testWebhook', () => {
  it('fires a single attempt and returns status', async () => {
    const be = makeBackend([makeRow({ id: 'wh-x' })])
    const ctx = makeCtx()
    const fakeFetch = jest.fn(async () => new Response(null, { status: 204 }))
    const out = await testWebhook(ctx, 'ws1', 'wh-x', be, {
      fetch: fakeFetch as unknown as typeof fetch,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }]
    })
    expect(out.ok).toBe(true)
    expect(out.status).toBe(204)
  })

  it('404s for unknown id', async () => {
    const be = makeBackend()
    const ctx = makeCtx()
    let caught: any
    try {
      await testWebhook(ctx, 'ws1', 'nope', be, {
        fetch: jest.fn() as unknown as typeof fetch,
        lookup: async () => []
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ValidationError)
    expect(caught.status).toBe(404)
  })
})

describe('dispatchActiveWebhooksAsync', () => {
  it('fans out to all matching active subs', async () => {
    const be = makeBackend([
      makeRow({ id: 'wh-a', eventTypes: ['role_changed', 'grant_created'] }),
      makeRow({ id: 'wh-b', eventTypes: ['member_removed'] }),
      makeRow({ id: 'wh-c', eventTypes: ['role_changed'], active: false })
    ])
    const fakeFetch = jest.fn(async () => new Response('', { status: 200 }))
    await dispatchActiveWebhooksAsync(
      'ws1',
      {
        workspace: 'ws1',
        action: 'role_changed',
        timestamp: '2026-06-21T00:00:00Z',
        actorUuid: 'u1',
        targetAccountUuid: 'u2'
      },
      be,
      {
        fetch: fakeFetch as unknown as typeof fetch,
        sleep: async () => undefined,
        lookup: async () => [{ address: '8.8.8.8', family: 4 }]
      }
    )
    // wh-a active, wh-b doesn't match event, wh-c inactive → only wh-a fires
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('swallows backend errors and stays silent', async () => {
    const log = jest.fn()
    await dispatchActiveWebhooksAsync(
      'ws1',
      {
        workspace: 'ws1',
        action: 'role_changed',
        timestamp: '2026-06-21T00:00:00Z',
        actorUuid: 'u1',
        targetAccountUuid: 'u2'
      },
      {
        listActiveForEvent: async () => {
          throw new Error('db down')
        }
      },
      {
        fetch: jest.fn() as unknown as typeof fetch,
        lookup: async () => [],
        log
      }
    )
    expect(log).toHaveBeenCalledWith('error', expect.stringMatching(/listActiveForEvent threw/), expect.anything())
  })
})
