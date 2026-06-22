import {
  processBulkInviteCsv,
  previewBulkInviteCsv,
  splitCsvLine,
  stripBom,
  hashEmail,
  previewRowForResponse,
  BulkInviteError,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  type BulkInviteCtx
} from '../endpoints/bulkInviteEndpoints'

function makeCtx (overrides: Partial<BulkInviteCtx> = {}): BulkInviteCtx {
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

const ROLES = ['OWNER', 'MAINTAINER', 'USER', 'GUEST']
const SPACES = new Set(['proj-1', 'proj-2', 'team-a'])
const spaceExists = async (_ws: string, s: string): Promise<boolean> => SPACES.has(s)

describe('splitCsvLine', () => {
  it('handles plain fields', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('handles quoted fields with commas inside', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(splitCsvLine('a,"hello ""world""",d')).toEqual(['a', 'hello "world"', 'd'])
  })

  it('handles a trailing empty field', () => {
    expect(splitCsvLine('a,b,')).toEqual(['a', 'b', ''])
  })
})

describe('stripBom', () => {
  it('removes UTF-8 BOM', () => {
    expect(stripBom('﻿hello')).toBe('hello')
  })
  it('passes BOM-less strings through', () => {
    expect(stripBom('hello')).toBe('hello')
  })
})

describe('hashEmail', () => {
  it('is deterministic and case-insensitive', () => {
    expect(hashEmail('Alice@Example.com')).toBe(hashEmail('alice@example.com'))
    expect(hashEmail('alice@example.com')).toBe(hashEmail('  alice@example.com  '))
  })
  it('different emails → different hashes', () => {
    expect(hashEmail('a@b.com')).not.toBe(hashEmail('c@d.com'))
  })
})

describe('processBulkInviteCsv — parse + validate', () => {
  const ctx = makeCtx()
  const baseOpts = {
    workspace: 'ws1',
    dryRun: true,
    validRoles: ROLES,
    spaceExists
  } as const

  it('parses a clean CSV with header + 2 valid rows', async () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,proj-1;proj-2',
      'bob@example.com,MAINTAINER,'
    ].join('\n')
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.summary.total).toBe(2)
    expect(r.preview.summary.valid).toBe(2)
    expect(r.preview.rows[0].addToSpaces).toEqual(['proj-1', 'proj-2'])
    expect(r.preview.rows[1].addToSpaces).toEqual([])
    expect(r.toSend).toBeUndefined()
  })

  it('rejects empty CSV', async () => {
    await expect(processBulkInviteCsv(ctx, { ...baseOpts, csv: '' })).rejects.toThrow(/empty_csv/)
  })

  it('rejects CSV without required headers', async () => {
    const csv = ['name,foo', 'alice,bar'].join('\n')
    await expect(processBulkInviteCsv(ctx, { ...baseOpts, csv })).rejects.toThrow(/missing_header/)
  })

  it('flags invalid email', async () => {
    const csv = ['email,role,addToSpaces', 'not-an-email,USER,'].join('\n')
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.rows[0].status).toBe('invalid_email')
  })

  it('flags invalid role', async () => {
    const csv = ['email,role,addToSpaces', 'alice@example.com,BOSS,'].join('\n')
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.rows[0].status).toBe('invalid_role')
  })

  it('flags missing space', async () => {
    const csv = ['email,role,addToSpaces', 'alice@example.com,USER,proj-1;nope-space'].join('\n')
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.rows[0].status).toBe('space_not_found')
    expect(r.preview.rows[0].detail).toContain('nope-space')
  })

  it('flags duplicate email (case-insensitive)', async () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,',
      'Alice@Example.com,MAINTAINER,'
    ].join('\n')
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.rows[1].status).toBe('invalid_csv')
    expect(r.preview.rows[1].detail).toMatch(/duplicate/)
  })

  it('handles CRLF + BOM', async () => {
    const csv = '﻿email,role,addToSpaces\r\nalice@example.com,USER,proj-1\r\n'
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.summary.total).toBe(1)
    expect(r.preview.rows[0].status).toBe('ok')
  })

  it('honours quoted addToSpaces with semicolons', async () => {
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,"proj-1;proj-2"'
    const r = await processBulkInviteCsv(ctx, { ...baseOpts, csv })
    expect(r.preview.rows[0].addToSpaces).toEqual(['proj-1', 'proj-2'])
  })

  it('blocks oversized CSV (> 1 MiB)', async () => {
    const big = 'email,role,addToSpaces\n' + 'a@b.com,USER,\n'.repeat(80_000)
    await expect(processBulkInviteCsv(ctx, { ...baseOpts, csv: big })).rejects.toThrow(/csv_too_large|too_many_rows/)
  })
})

describe('processBulkInviteCsv — dispatch gate', () => {
  const ctx = makeCtx()

  it('refuses dispatch when invalid rows are present', async () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,proj-1',
      'not-an-email,USER,proj-1'
    ].join('\n')
    await expect(
      processBulkInviteCsv(ctx, {
        workspace: 'ws1',
        dryRun: false,
        validRoles: ROLES,
        spaceExists,
        csv
      })
    ).rejects.toThrow(/invalid_rows_present/)
  })

  it('returns toSend list when every row is valid', async () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,proj-1',
      'bob@example.com,MAINTAINER,team-a'
    ].join('\n')
    const r = await processBulkInviteCsv(ctx, {
      workspace: 'ws1',
      dryRun: false,
      validRoles: ROLES,
      spaceExists,
      csv
    })
    expect(r.toSend?.length).toBe(2)
    expect(r.toSend?.[0].email).toBe('alice@example.com')
  })
})

describe('Gating', () => {
  it('rejects MAINTAINER caller', async () => {
    const ctx = makeCtx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } } as any)
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,'
    await expect(
      processBulkInviteCsv(ctx, {
        workspace: 'ws1',
        dryRun: true,
        validRoles: ROLES,
        spaceExists,
        csv
      })
    ).rejects.toThrow(/bulk_invite_not_allowed/)
  })

  it('rejects workspace-claim mismatch', async () => {
    const ctx = makeCtx({ token: { audience: 'workspace', workspace: 'ws2' } } as any)
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,'
    await expect(
      processBulkInviteCsv(ctx, {
        workspace: 'ws1',
        dryRun: true,
        validRoles: ROLES,
        spaceExists,
        csv
      })
    ).rejects.toThrow(/workspace mismatch/)
  })

  it('allows IMPERSONATING_ADMIN', async () => {
    const ctx = makeCtx({ isImpersonating: true, instanceAdminUuid: 'admin-x' } as any)
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,'
    const r = await processBulkInviteCsv(ctx, {
      workspace: 'ws1',
      dryRun: true,
      validRoles: ROLES,
      spaceExists,
      csv
    })
    expect(r.preview.summary.total).toBe(1)
  })
})

describe('DSGVO cleanup', () => {
  const ctx = makeCtx()

  it('auditMetadata carries only aggregate counts, no emails', async () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,proj-1',
      'bob@example.com,MAINTAINER,team-a',
      'oops,USER,'
    ].join('\n')
    const r = await processBulkInviteCsv(ctx, {
      workspace: 'ws1',
      dryRun: true,
      validRoles: ROLES,
      spaceExists,
      csv
    })
    expect(r.auditMetadata).toEqual({
      count: 3,
      valid: 2,
      invalid: 1,
      byStatus: { ok: 2, invalid_email: 1 }
    })
    const serialized = JSON.stringify(r.auditMetadata)
    expect(serialized).not.toContain('alice@example.com')
    expect(serialized).not.toContain('bob@example.com')
    expect(serialized).not.toContain('oops')
  })

  it('rows carry sha256 hashes for audit-friendly matching', async () => {
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,proj-1'
    const r = await processBulkInviteCsv(ctx, {
      workspace: 'ws1',
      dryRun: true,
      validRoles: ROLES,
      spaceExists,
      csv
    })
    expect(r.preview.rows[0].emailHash).toMatch(/^[a-f0-9]{64}$/)
    expect(r.preview.rows[0].emailHash).toBe(hashEmail('alice@example.com'))
  })

  it('previewRowForResponse strips internal-only fields (emailHash)', async () => {
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,proj-1'
    const r = await processBulkInviteCsv(ctx, {
      workspace: 'ws1',
      dryRun: true,
      validRoles: ROLES,
      spaceExists,
      csv
    })
    const view = previewRowForResponse(r.preview.rows[0])
    expect(view).toEqual({
      line: 2,
      email: 'alice@example.com',
      role: 'USER',
      addToSpaces: ['proj-1'],
      status: 'ok',
      detail: undefined
    })
    expect((view as any).emailHash).toBeUndefined()
  })
})

describe('BulkInviteError', () => {
  it('exposes code + status', () => {
    const err = new BulkInviteError('csv_too_large', 'too big', 413)
    expect(err.code).toBe('csv_too_large')
    expect(err.status).toBe(413)
    expect(err.message).toContain('csv_too_large')
  })
})

describe('previewBulkInviteCsv — host-side dry-run parser', () => {
  it('throws empty_csv on empty payload', () => {
    expect(() => previewBulkInviteCsv('', ROLES)).toThrow(/empty_csv/)
  })

  it('returns zero rows for a header-only CSV (header is NOT parsed as data)', () => {
    const r = previewBulkInviteCsv('email,role,addToSpaces', ROLES)
    expect(r.rows).toEqual([])
    expect(r.summary.total).toBe(0)
    expect(r.summary.valid).toBe(0)
    expect(r.summary.invalid).toBe(0)
  })

  it('happy path: header + 2 valid rows → 2 rows valid, header skipped', async () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,proj-1',
      'bob@example.com,MAINTAINER,'
    ].join('\n')
    const r = previewBulkInviteCsv(csv, ROLES)
    expect(r.rows).toHaveLength(2)
    expect(r.summary).toEqual({ total: 2, valid: 2, invalid: 0, byStatus: { ok: 2 } })
    expect(r.rows[0].email).toBe('alice@example.com')
    expect(r.rows[0].status).toBe('ok')
    expect(r.rows[0].line).toBe(2) // header=line 1, first data row=line 2
    expect(r.rows[0].addToSpaces).toEqual(['proj-1'])
    expect(r.rows[0].addToSpaces_unvalidated).toBe(true)
    expect(r.rows[1].addToSpaces_unvalidated).toBe(false) // empty addToSpaces
  })

  it('flags duplicate email (case-insensitive)', () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,',
      'Alice@Example.com,MAINTAINER,'
    ].join('\n')
    const r = previewBulkInviteCsv(csv, ROLES)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].status).toBe('ok')
    expect(r.rows[1].status).toBe('invalid_csv')
    expect(r.rows[1].detail).toMatch(/duplicate/)
  })

  it('flags invalid_email + invalid_role per row', () => {
    const csv = [
      'email,role,addToSpaces',
      'not-an-email,USER,',
      'alice@example.com,BOSS,'
    ].join('\n')
    const r = previewBulkInviteCsv(csv, ROLES)
    expect(r.rows[0].status).toBe('invalid_email')
    expect(r.rows[1].status).toBe('invalid_role')
    expect(r.summary.invalid).toBe(2)
  })

  it('blocks oversized CSV (> MAX_CSV_BYTES)', () => {
    const big = 'email,role,addToSpaces\n' + 'a'.repeat(MAX_CSV_BYTES + 16)
    expect(() => previewBulkInviteCsv(big, ROLES)).toThrow(/csv_too_large/)
  })

  it('blocks too-many-rows (> MAX_CSV_ROWS data rows)', () => {
    const lines: string[] = ['email,role,addToSpaces']
    for (let i = 0; i < MAX_CSV_ROWS + 1; i++) {
      lines.push(`u${i}@example.com,USER,`)
    }
    expect(() => previewBulkInviteCsv(lines.join('\n'), ROLES)).toThrow(/too_many_rows/)
  })

  it('rejects CSV missing required headers', () => {
    expect(() => previewBulkInviteCsv('name,foo\nalice,bar', ROLES)).toThrow(/missing_header/)
  })

  it('audit_metadata carries only aggregate counts (no emails)', () => {
    const csv = [
      'email,role,addToSpaces',
      'alice@example.com,USER,',
      'oops,USER,'
    ].join('\n')
    const r = previewBulkInviteCsv(csv, ROLES)
    expect(r.auditMetadata).toEqual({ count: 2, valid: 1, invalid: 1, byStatus: { ok: 1, invalid_email: 1 } })
    const serialized = JSON.stringify(r.auditMetadata)
    expect(serialized).not.toContain('alice@example.com')
    expect(serialized).not.toContain('oops')
  })

  it('emailHash present on every row for audit-friendly matching', () => {
    const csv = 'email,role,addToSpaces\nalice@example.com,USER,'
    const r = previewBulkInviteCsv(csv, ROLES)
    expect(r.rows[0].emailHash).toBe(hashEmail('alice@example.com'))
    expect(r.rows[0].emailHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
