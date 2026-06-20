//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { decodeToken, generateToken } from '@hcengineering/server-token'

// Regression test for WAC impersonation token shape.
//
// Before this fix, `/api/admin/impersonation/start` called generateToken with
// the impersonation claims wrapped as `{ extra: { ... } }` (so the decoded
// payload had `extra.extra.{impersonation, jti, ...}`) and did NOT pass
// options.exp. The documented 30-minute expiry never reached the JWT.
//
// This test asserts the canonical shape: claims are flat on `decoded.extra`,
// and `decoded.exp` is set to ~now + 30 minutes.
//
// Note (D7, 2026-06): process-local JTI revocation was removed; v1 relies
// on the 30-min expiry as the sole revocation mechanism. So the `jti` claim
// is still surfaced (audit log + future v2 store) but no longer feeds a
// per-process Map.
describe('WAC impersonation token shape', () => {
  it('decodes with flat extra claims and expected exp', () => {
    const adminUuid = '123e4567-e89b-12d3-a456-426614174000'
    const workspaceUuid = '123e4567-e89b-12d3-a456-426614174001'
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 30 * 60
    const jti = `${now}-deadbeefcafe`
    const impersonationRefId = `${now}-feedfacefeed`

    const token = generateToken(
      adminUuid as any,
      workspaceUuid as any,
      {
        impersonation: 'true',
        impersonation_ref: impersonationRefId,
        actor_admin: adminUuid,
        jti,
        admin: 'true'
      },
      undefined,
      { exp }
    )

    const decoded = decodeToken(token) as any

    // The extra claims must be flat (not nested under extra.extra.*).
    expect(decoded.extra).toBeDefined()
    expect(decoded.extra.impersonation).toBe('true')
    expect(decoded.extra.jti).toBe(jti)
    expect(decoded.extra.impersonation_ref).toBe(impersonationRefId)
    expect(decoded.extra.actor_admin).toBe(adminUuid)
    expect(decoded.extra.admin).toBe('true')
    // No nested wrapper from the old bug.
    expect((decoded.extra as any).extra).toBeUndefined()

    // exp must be the explicit 30-minute window, not the JWT library default
    // and not absent.
    expect(typeof decoded.exp).toBe('number')
    const drift = Math.abs((decoded.exp as number) - exp)
    expect(drift).toBeLessThanOrEqual(60)

    // Workspace and account survive the round trip.
    expect(decoded.workspace).toBe(workspaceUuid)
    expect(decoded.account).toBe(adminUuid)
  })
})
