//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

import * as fs from 'fs'
import * as path from 'path'

// Phase 1 Task 2 — guard that every /api/wac/* middleware in src/index.ts
// gates its handlers through `authenticateWac` before any pg.execute call.
//
// We use a source-grep approach (mirroring wacNoFallback.test.ts):
// extracting and dependency-injecting the koa middleware closures would be
// extremely invasive (the middlewares close over `accountsDb`, `rawPgPromise`,
// `measureCtx`, `resolveWorkspaceUuid`, etc., all built inside serveAccount).
// A regex/AST-grep assertion is sufficient for CI to catch any regression
// that adds a WAC route without an auth gate.
describe('WAC routes — authenticateWac gate (Phase 1 Task 2)', () => {
  const indexSrc = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf-8')

  it('imports authenticateWac from ./wac/auth', () => {
    expect(indexSrc).toMatch(/from\s+'\.\/wac\/auth'/)
    expect(indexSrc).toMatch(/authenticateWac/)
  })

  it('constructs WacAuthDeps once with measureCtx + resolveWorkspaceUuid + accountDb', () => {
    expect(indexSrc).toMatch(/const\s+authDeps\s*:\s*WacAuthDeps\s*=/)
    expect(indexSrc).toMatch(/resolveWorkspaceUuid\s*,/)
    expect(indexSrc).toMatch(/accountDb:\s*async\s*\(\)\s*=>\s*\(await\s+accountsDb\)\[0\]/)
  })

  // Each WAC middleware block in index.ts must call authenticateWac before
  // any pg.execute / db.getWorkspaceMembers / db.getWorkspaceRole call. We
  // assert this by counting middleware that match /api/wac/ and verifying
  // each one has an authenticateWac( call within the same block.
  it('every /api/wac/ middleware contains an authenticateWac( call', () => {
    // Find middleware blocks: `app.use(async (ctx, next) => { ... })`
    // We approximate by splitting on top-level `app.use(async` and looking
    // at the contents until the matching closing parens. A simpler heuristic
    // suffices: for every occurrence of the WAC route regex in the file,
    // there must be an authenticateWac( call within the next 30 lines.
    const lines = indexSrc.split('\n')
    const wacRouteRegex = /\/\^\\\/api\\\/wac\\\//
    const matches: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (wacRouteRegex.test(lines[i])) matches.push(i)
    }
    expect(matches.length).toBeGreaterThanOrEqual(3) // write + csv + read

    for (const idx of matches) {
      const window = lines.slice(idx, idx + 30).join('\n')
      expect(window).toMatch(/authenticateWac\(/)
    }
  })

  it('authenticateWac is called with the correct capability per middleware', () => {
    // Write middleware: requires 'edit' for all mutations
    expect(indexSrc).toMatch(/authenticateWac\([^)]*'edit'[^)]*authDeps\)/)
    // CSV export: requires 'admin'
    expect(indexSrc).toMatch(/authenticateWac\(ctx,\s*wsParam,\s*'admin',\s*authDeps\)/)
    // Read middleware uses a wacCapability variable that toggles between
    // read / read-self / edit. Assert the variable and the read-self branch
    // exist (my-access).
    expect(indexSrc).toMatch(/wacCapability/)
    expect(indexSrc).toMatch(/'read-self'/)
    expect(indexSrc).toMatch(/'read'/)
  })

  it('authenticateWac is invoked BEFORE any pg.execute call in each middleware', () => {
    // For every middleware block opening with /api/wac/, the first
    // occurrence of `authenticateWac(` must precede the first occurrence
    // of `pg.execute(` in that block.
    const lines = indexSrc.split('\n')
    const wacRouteRegex = /\/\^\\\/api\\\/wac\\\//
    const middlewareStarts: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (wacRouteRegex.test(lines[i])) middlewareStarts.push(i)
    }

    for (let i = 0; i < middlewareStarts.length; i++) {
      const start = middlewareStarts[i]
      const end = i + 1 < middlewareStarts.length ? middlewareStarts[i + 1] : Math.min(start + 400, lines.length)
      const block = lines.slice(start, end)
      const authIdx = block.findIndex((l) => l.includes('authenticateWac('))
      const pgIdx = block.findIndex((l) => l.includes('pg.execute('))
      expect(authIdx).toBeGreaterThanOrEqual(0)
      // pgIdx may be -1 if the middleware block has no direct pg.execute
      // (e.g. CSV middleware which uses pg.execute but is short — both should
      // still be ordered authentcateWac first).
      if (pgIdx >= 0) {
        expect(authIdx).toBeLessThan(pgIdx)
      }
    }
  })

  it('removes the per-route `workspaceUuid == null -> 404` short-circuit in WAC reads', () => {
    // After Phase 1 Task 2, authenticateWac handles the 404. The repeating
    // pattern `if (workspaceUuid == null) { return json(404, ...) }` must
    // not appear inside the WAC GET middleware (it was used in 9 places).
    // We allow the legacy check inside `/api/admin/impersonation/start`
    // (different route family, untouched in this pass).
    const wacGetStart = indexSrc.indexOf('// ── End WAC audit CSV export ─')
    const wacGetEnd = indexSrc.indexOf('// ── End WAC stub routes ─')
    expect(wacGetStart).toBeGreaterThan(0)
    expect(wacGetEnd).toBeGreaterThan(wacGetStart)
    const block = indexSrc.slice(wacGetStart, wacGetEnd)
    // Should have ZERO occurrences of the legacy null-check fallback now.
    const occurrences = (block.match(/if \(workspaceUuid == null\)/g) ?? []).length
    expect(occurrences).toBe(0)
  })

  it('write middleware threads callerUuid into the handler dispatch', () => {
    // The auditing helper needs the real caller, not null. After Phase 2B
    // T2/3/4 the inline `caller = { actor: callerUuid, ... }` literal is
    // gone — callerUuid is passed positionally to each handler.
    const wacWriteStart = indexSrc.indexOf('// WAC write endpoints')
    const wacWriteEnd = indexSrc.indexOf('// ── WAC audit CSV export')
    expect(wacWriteStart).toBeGreaterThan(0)
    expect(wacWriteEnd).toBeGreaterThan(wacWriteStart)
    const block = indexSrc.slice(wacWriteStart, wacWriteEnd)
    // Each dispatch call site forwards (workspaceUuid, callerUuid, ...).
    expect(block).toMatch(/wacWriteHandlers\.handleSpaceMembers\([^)]*callerUuid/)
    expect(block).toMatch(/wacWriteHandlers\.handleMemberRole\([^)]*callerUuid/)
    // resolveCaller(ctx.request.headers) must NOT be called inside the
    // WAC write block anymore (still allowed in NON-WAC routes).
    expect(block).not.toMatch(/resolveCaller\(/)
  })

  it('resolveCaller is preserved for non-WAC routes', () => {
    // Sanity: the function still exists for backward compat (other
    // code paths may use it). We only require it NOT to be called inside
    // any /api/wac/ middleware.
    expect(indexSrc).toMatch(/function resolveCaller/)
  })

  it('DELETE /grants/<r>/<res> still gated + dispatched to handleGrantRevoke', () => {
    // After Phase 2B T2/3/4 the 501 stub body moved into the plugin
    // (writeRouter.ts). The host's responsibility is now to (a) gate via
    // authenticateWac and (b) dispatch to wacWriteHandlers.handleGrantRevoke
    // — which still returns 501 with detail wac_grant_revoke_pending_v2.
    const wacWriteStart = indexSrc.indexOf('// WAC write endpoints')
    const wacWriteEnd = indexSrc.indexOf('// ── WAC audit CSV export')
    expect(wacWriteStart).toBeGreaterThan(0)
    const block = indexSrc.slice(wacWriteStart, wacWriteEnd)
    expect(block).toMatch(/wacWriteHandlers\.handleGrantRevoke\(/)
    expect(block).toMatch(/sub\.startsWith\('grants\/'\)\s*&&\s*ctx\.method\s*===\s*'DELETE'/)
  })
})
