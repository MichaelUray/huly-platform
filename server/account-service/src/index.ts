//
// Copyright © 2023 Hardcore Engineering Inc.
//

import account, {
  type AccountMethods,
  type AccountMethodDeps,
  type Meta,
  type ClientNetworkPosition,
  EndpointKind,
  accountId,
  getAccountDB,
  getAllTransactors,
  getMethods,
  cleanExpiredOtp,
  listAccountsAdmin,
  assertAdmin,
  decodeFilterParam,
  FilterDecodeError
} from '@hcengineering/account'
import accountEn from '@hcengineering/account/lang/en.json'
import accountRu from '@hcengineering/account/lang/ru.json'
import { csvLine } from '@hcengineering/account-client'
import { Analytics } from '@hcengineering/analytics'
import { registerProviders } from '@hcengineering/auth-providers'
import { metricsAggregate, type Branding, type BrandingMap, type MeasureContext } from '@hcengineering/core'
import platform, { Severity, Status, addStringsLoader, setMetadata, unknownStatus } from '@hcengineering/platform'
import serverToken, { decodeToken, decodeTokenVerbose, generateToken } from '@hcengineering/server-token'
import cors from '@koa/cors'
import type Cookies from 'cookies'
import { createHash } from 'crypto'
import { type IncomingHttpHeaders } from 'http'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import Router from 'koa-router'
import os from 'os'
import { migrateFromOldAccounts } from './migration/migration'
import { TokenBucketLimiter } from './util/rateLimiter'
import { getDBClient, createDBClient } from '@hcengineering/postgres-base'
import { authenticateWac, type WacAuthDeps } from './wac/auth'
import { createWacTxClient, type WacTxClient } from './wac/transactorClient'
import { createWacCacheInvalidator, type WacCacheInvalidator } from './wac/cacheInvalidator'
import {
  createWacReadHandlers,
  type WacReadDeps,
  createWacWriteHandlers,
  type WacWriteDeps
} from '@hcengineering/server-workspace-access'

export * from './migration/utils'
export * from './migration/types'

const AUTH_TOKEN_COOKIE = 'account-metadata-Token'

const KEEP_ALIVE_HEADERS = {
  'Content-Type': 'application/json',
  Connection: 'keep-alive',
  'Keep-Alive': 'timeout=5, max=1000'
}

/**
 * @public
 */
export function serveAccount (
  measureCtx: MeasureContext,
  brandings: BrandingMap,
  deps?: AccountMethodDeps,
  onClose?: () => void
): void {
  console.log('Starting account service with brandings: ', brandings)
  const ACCOUNT_PORT = parseInt(process.env.ACCOUNT_PORT ?? '3000')
  const dbUrl = process.env.DB_URL
  if (dbUrl === undefined) {
    console.log('Please provide DB_URL')
    process.exit(1)
  }

  if (dbUrl.startsWith('mongodb://')) {
    if (process.env.PROCEED_V7_MONGO !== 'true') {
      console.error(`
        ⚠️ IMPORTANT: MongoDB Deprecation Notice

        MongoDB support is deprecated in v7 and will be removed in future versions. Important details:

        1. New features may not be available with MongoDB
        2. Testing coverage for MongoDB will be limited
        3. Upgrading to v7 with MongoDB will PERMANENTLY LOCK your deployment to MongoDB-specific types
        4. Migration to CockroachDB will NOT be possible after upgrading

        ➡️ Recommended Action:
        Migrate to CockroachDB before upgrading to v7. See migration instructions at:
        https://github.com/hcengineering/huly-selfhost

        To proceed with MongoDB (despite these limitations):
        Set environment variable PROCEED_V7_MONGO=true.
      `)
      process.exit(1)
    }
  }

  const oldAccsUrl = process.env.OLD_ACCOUNTS_URL ?? (dbUrl.startsWith('mongodb://') ? dbUrl : undefined)
  const oldAccsNs = process.env.OLD_ACCOUNTS_NS

  const transactorUri = process.env.TRANSACTOR_URL
  if (transactorUri === undefined) {
    console.log('Please provide transactor url')
    process.exit(1)
  }

  const serverSecret = process.env.SERVER_SECRET
  if (serverSecret === undefined) {
    console.log('Please provide server secret')
    process.exit(1)
  }

  // Phase 2B Task 1 (D3) — long-lived TxOperations pool to the transactor.
  // Consumed by the WAC write-handlers (P2B-T2/3/4) for the canonical
  // Huly mutation path. See `wacWriteDeps` below.
  const wacTxClient: WacTxClient = createWacTxClient({
    transactorUrl: transactorUri,
    serverSecret,
    measureCtx
  })

  // Phase 2B Task 5 (E2) — best-effort cache invalidator for live
  // workspace-role changes. Option (B): touches the workspace-level
  // Space doc with a marker field so transactor broadcasts the
  // change to every connected client of the workspace. Implementation
  // documented in src/wac/cacheInvalidator.ts.
  const wacCacheInvalidator: WacCacheInvalidator = createWacCacheInvalidator({
    txClient: wacTxClient,
    measureCtx
  })

  addStringsLoader(accountId, async (lang: string) => {
    switch (lang) {
      case 'en':
        return accountEn
      case 'ru':
        return accountRu
      default:
        return accountEn
    }
  })

  const mailUrl = process.env.MAIL_URL
  const mailAuthToken = process.env.MAIL_AUTH_TOKEN

  const frontURL = process.env.FRONT_URL
  const productName = process.env.PRODUCT_NAME
  const lang = process.env.LANGUAGE ?? 'en'

  const wsLivenessDaysRaw = process.env.WS_LIVENESS_DAYS
  let wsLivenessDays: number | undefined

  if (wsLivenessDaysRaw !== undefined) {
    try {
      wsLivenessDays = parseInt(wsLivenessDaysRaw)
    } catch (err: any) {
      // DO NOTHING
    }
  }

  setMetadata(account.metadata.Transactors, transactorUri)
  setMetadata(platform.metadata.locale, lang)
  setMetadata(account.metadata.ProductName, productName)
  setMetadata(account.metadata.OtpTimeToLiveSec, parseInt(process.env.OTP_TIME_TO_LIVE ?? '60'))
  setMetadata(account.metadata.OtpRetryDelaySec, parseInt(process.env.OTP_RETRY_DELAY ?? '60'))
  setMetadata(account.metadata.MAIL_URL, mailUrl)
  setMetadata(account.metadata.MAIL_AUTH_TOKEN, mailAuthToken)

  setMetadata(account.metadata.FrontURL, frontURL)
  setMetadata(account.metadata.WsLivenessDays, wsLivenessDays)

  setMetadata(serverToken.metadata.Secret, serverSecret)
  // Force undefied, for user tokens do not include service
  setMetadata(serverToken.metadata.Service, undefined)

  const hasSignUp = process.env.DISABLE_SIGNUP !== 'true'
  const methods = getMethods(hasSignUp, deps)

  const dbNs = process.env.DB_NS
  const accountsDb = getAccountDB(dbUrl, dbNs)
  const migrations = accountsDb.then(async ([db]) => {
    if (oldAccsUrl !== undefined) {
      await migrateFromOldAccounts(oldAccsUrl, db, oldAccsNs)
      console.log('Migrations verified/done')
    }
  })

  const csvExportLimiter = new TokenBucketLimiter({ max: 5, windowMs: 60_000 })
  // GC every minute — sub-second precision not needed for cleanup.
  setInterval(() => {
    csvExportLimiter.gc(Date.now())
  }, 60_000).unref()

  // ── admin_audit_log retention ─────────────────────────────────────────
  // AUDIT_RETENTION_DAYS: positive N keeps the last N days, 0 disables.
  // Default 365 to bound table growth on long-running deployments.
  const retentionDays = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '365', 10)
  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    const dayMs = 86_400_000
    // Hold the interval handle so the runPrune closure can disable
    // itself the first time it encounters a backend that doesn't
    // support pruning (currently MongoDB). Otherwise we'd log the
    // same 'not implemented' error every 24h forever.
    let intervalHandle: NodeJS.Timeout | null = null
    const runPrune = async (): Promise<void> => {
      const [db] = await accountsDb
      const cutoff = Date.now() - retentionDays * dayMs
      try {
        const deleted = await db.pruneAuditOlderThan(cutoff)
        measureCtx.info('audit_log pruned', { deleted, retentionDays })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('not implemented for Mongo')) {
          measureCtx.info('audit_log retention: backend does not support prune, disabling timer')
          if (intervalHandle !== null) {
            clearInterval(intervalHandle)
            intervalHandle = null
          }
          return
        }
        measureCtx.error('audit_log prune failed', { error: err })
      }
    }
    // Initial run 5 min after startup so we don't hammer cockroach right at boot.
    setTimeout(() => { void runPrune() }, 5 * 60_000).unref()
    // Then once every 24h.
    intervalHandle = setInterval(() => { void runPrune() }, dayMs)
    intervalHandle.unref()
  }

  // Key the limiter on a SHA-256 of the token rather than the raw token.
  // Limiter state lives in process memory and can land in heap dumps,
  // crash logs, or third-party APM samples. Hashing means a leaked
  // state-snapshot doesn't grant the holder a usable admin token.
  // (Account-uuid would also work but requires decoding the token —
  // hashing keeps the limiter independent of the auth layer.)
  const limiterKey = (token: string): string => createHash('sha256').update(token).digest('hex')

  const app = new Koa()
  const router = new Router()

  app.use(
    cors({
      credentials: true
    })
  )
  app.use(bodyParser())

  registerProviders(
    measureCtx,
    app,
    router,
    new Promise((resolve) => {
      void accountsDb.then((res) => {
        const [db] = res
        resolve(db)
      })
    }),
    serverSecret,
    frontURL,
    brandings,
    !hasSignUp
  )

  void accountsDb.then((res) => {
    const [db] = res
    setInterval(
      () => {
        void cleanExpiredOtp(db)
      },
      3 * 60 * 1000
    )
  })

  const extractCookieToken = (headers: IncomingHttpHeaders): string | undefined => {
    if (headers.cookie != null) {
      const cookies = headers.cookie.split(';')
      const tokenCookie = cookies.find((cookie) => cookie.includes(AUTH_TOKEN_COOKIE))
      return tokenCookie?.split('=')[1]
    }

    return undefined
  }

  const extractAuthorizationToken = (headers: IncomingHttpHeaders): string | undefined => {
    try {
      return headers.authorization?.slice(7) ?? undefined
    } catch {
      return undefined
    }
  }

  const extractToken = (headers: IncomingHttpHeaders): string | undefined => {
    return extractAuthorizationToken(headers) ?? extractCookieToken(headers)
  }

  const getRequestMeta = (headers: IncomingHttpHeaders, isServiceRequest: boolean): Meta => {
    const meta: Meta = {}

    if (!isServiceRequest && headers?.['x-timezone'] !== undefined) {
      meta.timezone = headers['x-timezone'] as string
    }

    if (headers?.['x-client-network-position'] !== undefined) {
      const val = headers['x-client-network-position'] as string
      if (['internal', 'external'].includes(val)) {
        meta.clientNetworkPosition = val as ClientNetworkPosition
      }
    }

    return meta
  }

  function getBranding (ctx: Koa.Context): Branding | null {
    let host: string | undefined
    const origin = ctx.request.headers.origin ?? ctx.request.headers.referer
    if (origin !== undefined) {
      host = new URL(origin).host
    }
    return host !== undefined ? brandings[host] : null
  }

  function getCookieOptions (ctx: Koa.Context): Cookies.SetOption[] {
    const option = {
      httpOnly: true,
      secure: ctx.request.secure,
      maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year
    }

    const options = []

    const branding = getBranding(ctx)

    const origin = ctx.request.headers.origin ?? ctx.request.headers.referer
    const target = ctx.request.href

    const originDomain = origin !== undefined ? getCookieDomain(origin) : undefined
    const targetDomain = getCookieDomain(target)

    options.push({ ...option, domain: targetDomain })
    if (originDomain !== undefined && originDomain !== targetDomain && branding !== undefined) {
      options.push({ ...option, domain: originDomain })
    }

    return options
  }

  const getCookieDomain = (url: string): string => {
    const hostname = new URL(url).hostname

    if (hostname === 'localhost') {
      return hostname
    }

    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      return hostname
    }

    const parts = hostname.split('.')
    if (parts.length > 2) {
      return '.' + parts.slice(1).join('.')
    }

    return hostname
  }

  router.get('/api/v1/statistics', (req, res) => {
    try {
      const token = (req.query.token as string) ?? extractToken(req.headers)
      const payload = decodeToken(token)
      const admin = payload.extra?.admin === 'true'
      const data: Record<string, any> = {
        metrics: admin ? metricsAggregate((measureCtx as any).metrics) : {},
        statistics: {}
      }
      data.statistics.totalClients = 0
      const mem = process.memoryUsage()
      data.statistics.memoryUsed = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100
      data.statistics.memoryTotal = Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100
      data.statistics.memoryRSS = Math.round((mem.rss / 1024 / 1024) * 100) / 100
      data.statistics.memoryArrayBuffers = Math.round((mem.arrayBuffers / 1024 / 1024) * 100) / 100
      data.statistics.cpuUsage = Math.round(os.loadavg()[0] * 100) / 100
      data.statistics.freeMem = Math.round((os.freemem() / 1024 / 1024) * 100) / 100
      data.statistics.totalMem = Math.round((os.totalmem() / 1024 / 1024) * 100) / 100
      const json = JSON.stringify(data)
      req.res.writeHead(200, KEEP_ALIVE_HEADERS)
      req.res.end(json)
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.put('/cookie', async (ctx) => {
    const token = extractToken(ctx.request.headers)
    if (token === undefined) {
      ctx.res.writeHead(401, KEEP_ALIVE_HEADERS)
      ctx.res.end(JSON.stringify({ error: new Status(Severity.ERROR, platform.status.Unauthorized, {}) }))
      return
    }

    // Ensure we don't set the token with workspace to the cookie
    const { account, extra } = decodeTokenVerbose(measureCtx, token)
    const tokenWithoutWorkspace = generateToken(account, undefined, extra)

    const cookieOpts = getCookieOptions(ctx)
    for (const opt of cookieOpts) {
      ctx.cookies.set(AUTH_TOKEN_COOKIE, tokenWithoutWorkspace, opt)
    }

    ctx.res.writeHead(204)
    ctx.res.end()
  })

  router.delete('/cookie', async (ctx) => {
    const cookieOpts = getCookieOptions(ctx)
    for (const opt of cookieOpts) {
      ctx.cookies.set(AUTH_TOKEN_COOKIE, '', { ...opt, maxAge: 0 })
    }

    ctx.res.writeHead(204)
    ctx.res.end()
  })

  router.put('/api/v1/manage', async (req, res) => {
    try {
      const token = (req.query.token as string) ?? extractToken(req.headers)
      const payload = decodeToken(token)
      if (payload.extra?.admin !== 'true') {
        req.res.writeHead(404, {})
        req.res.end()
        return
      }

      const operation = req.query.operation

      switch (operation) {
        case 'maintenance': {
          const timeMinutes = parseInt((req.query.timeout as string) ?? '5')
          const transactors = getAllTransactors(EndpointKind.Internal)
          for (const tr of transactors) {
            const serverEndpoint = tr.replaceAll('wss://', 'https://').replace('ws://', 'http://')
            const jsonBody = JSON.stringify(req.request.body as any)
            await fetch(serverEndpoint + `/api/v1/manage?token=${token}&operation=maintenance&timeout=${timeMinutes}`, {
              method: 'PUT',
              body: jsonBody,
              headers: {
                'Content-Type': 'application/json;charset=utf-8'
              }
            })
          }

          req.res.writeHead(200)
          req.res.end()
          return
        }
      }

      req.res.writeHead(404, {})
      req.res.end()
    } catch (err: any) {
      Analytics.handleError(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.post('rpc', '/', async (ctx) => {
    const token = extractToken(ctx.request.headers)

    const request = ctx.request.body as any
    const method = methods[request.method as AccountMethods]
    if (method === undefined) {
      const response = {
        id: request.id,
        error: new Status(Severity.ERROR, platform.status.UnknownMethod, { method: request.method })
      }

      const body = JSON.stringify(response)
      ctx.res.writeHead(404, KEEP_ALIVE_HEADERS)
      ctx.res.end(body)
      return
    }

    const [db] = await accountsDb
    await migrations

    const branding = getBranding(ctx)

    let source = ''
    let isServiceRequest = false
    try {
      const decodedToken = token != null ? decodeToken(token) : null
      const serviceName = decodedToken?.extra?.service
      source = serviceName ?? '🤦‍♂️user'
      isServiceRequest = serviceName !== undefined
    } catch (err) {
      // Ignore
    }
    const meta = getRequestMeta(ctx.request.headers, isServiceRequest)

    await measureCtx.with(
      request.method,
      { source },
      async (_ctx) => {
        if (method === undefined || typeof method !== 'function') {
          const response = {
            id: request.id,
            error: new Status(Severity.ERROR, platform.status.UnknownMethod, { method: request.method })
          }

          ctx.res.writeHead(400, KEEP_ALIVE_HEADERS)
          ctx.res.end(JSON.stringify(response))
          return
        }

        try {
          const result = await method(_ctx, db, branding, request, token, meta)

          const body = JSON.stringify(result)
          ctx.res.writeHead(200, KEEP_ALIVE_HEADERS)
          ctx.res.end(body)
        } catch (err: any) {
          const response = {
            id: request.id,
            error: unknownStatus(err.message)
          }
          ctx.res.writeHead(400, KEEP_ALIVE_HEADERS)
          ctx.res.end(JSON.stringify(response))
        }
      },
      { method: request.method }
    )
  })

  // ── CSV Export routes ────────────────────────────────────────────────────
  // NOTE: clients now use fetch + Authorization header + blob download
  // (no token-in-URL leakage). The ?token= query-string fallback is kept
  // for one release with a deprecation warning so external scripts that
  // bookmarked the old URL still work.

  router.get('/api/v1/admin/export/accounts.csv', async (ctx) => {
    const token = (ctx.query.token as string) ?? extractToken(ctx.request.headers) ?? ''
    if (ctx.query.token != null) {
      measureCtx.warn('CSV export: deprecated token-in-query usage', {})
    }
    const [db] = await accountsDb
    const childCtx = measureCtx.newChild('csv-export-accounts', {})
    try {
      await assertAdmin(childCtx, db, token)
    } catch {
      ctx.res.writeHead(403, { 'Content-Type': 'text/plain' })
      ctx.res.end('Forbidden')
      return
    }
    if (!csvExportLimiter.allow(limiterKey(token), Date.now())) {
      // charset=utf-8 so the em-dash in the body renders correctly in
      // browsers that default to ISO-8859-1 for text/plain (D3).
      ctx.res.writeHead(429, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '60'
      })
      ctx.res.end('Too many exports — try again in 60 seconds.')
      return
    }
    // Respect the same filter+sort the user sees in the admin UI.
    let filterObj: Record<string, any>
    try {
      filterObj = decodeFilterParam(ctx.query.filter)
    } catch (err) {
      ctx.res.writeHead(400, { 'Content-Type': 'text/plain' })
      ctx.res.end(err instanceof FilterDecodeError ? err.message : 'Bad filter')
      return
    }
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="huly-users-${Date.now()}.csv"`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    })
    // UTF-8 BOM (D2) — Excel-on-Windows decodes the file as ISO-8859-1
    // without it, which mangles every non-ASCII byte in names/emails.
    // Emit the raw 3-byte EF BB BF sequence as a Buffer so tooling
    // (esbuild, eslint, terser) can't silently strip a literal U+FEFF
    // from string source. Followed by an RFC-4180 CRLF header row.
    ctx.res.write(Buffer.from([0xEF, 0xBB, 0xBF]))
    ctx.res.write('uuid,firstName,lastName,primaryEmail,status,workspaceCount,lastActivityAt,isAdmin\r\n')
    const pageSize = 500
    let offset = 0
    for (;;) {
      const { accounts } = await listAccountsAdmin(childCtx, db, null, token, {
        ...filterObj,
        pagination: { limit: pageSize, offset }
      })
      for (const a of accounts) {
        ctx.res.write(csvLine([
          a.uuid, a.firstName, a.lastName, a.primaryEmail ?? '', a.status,
          String(a.workspaceCount), a.lastActivityAt != null ? new Date(a.lastActivityAt).toISOString() : '',
          String(a.isAdmin)
        ]))
      }
      if (accounts.length < pageSize) break
      offset += pageSize
    }
    ctx.res.end()
  })

  // ── End CSV Export routes ────────────────────────────────────────────────

  // ── WAC (Workspace Access Center) routes ────────────────────────────────
  // HTTP host for the WAC surface. Each request is first authenticated via
  // `authenticateWac` (Phase 1 Task 2 — server/account-service/src/wac/auth.ts)
  // and then dispatched to either `wacReadHandlers` (GET) or
  // `wacWriteHandlers` (PUT/POST/DELETE) from
  // `@hcengineering/server-workspace-access`. All policy, last-owner gating,
  // TxOperations mutations, audit-row sequencing and CSV emission live in
  // the plugin; this file owns route-matching, auth-gating, body-parsing
  // and the 500-wrap around unexpected throws.
  //
  // Implemented as raw `app.use` middleware that matches by regex on
  // `/api/wac/<ws>/<endpoint>` patterns. koa-router exhibited
  // deterministic-but-alternating 200/404 responses on consecutive WAC
  // routes when registered conventionally — likely a path-to-regexp
  // ordering quirk we couldn't isolate. Bypassing the router for these
  // endpoints avoids the issue entirely.

  // Direct pg client for raw workspace queries (spaces / audit log /
  // grants). Reuses the same DB_URL the account collection uses;
  // tables live in the public schema of the same Cockroach defaultdb.
  const rawDbRef = getDBClient(dbUrl)
  const rawPgPromise = rawDbRef.getClient().then((sql) => createDBClient(sql))

  async function resolveWorkspaceUuid (workspaceParam: string): Promise<string | null> {
    // Treat as UUID if it parses as one; else look up by url.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceParam)
    if (isUuid) return workspaceParam
    const pg = await rawPgPromise
    const rows = await pg.execute(
      'SELECT uuid FROM global_account.workspace WHERE url=$1 LIMIT 1',
      [workspaceParam]
    )
    return rows[0]?.uuid ?? null
  }

  /**
   * Resolve the caller's account UUID + role from the request token.
   * Returns null actor if the token is missing/invalid (write endpoints
   * still proceed in the test instance, just without auditing the actor).
   */
  function resolveCaller (headers: IncomingHttpHeaders): { actor: string | null, role: string } {
    try {
      const token = extractToken(headers) ?? ''
      if (token === '') return { actor: null, role: 'system' }
      const decoded = decodeToken(token)
      return { actor: (decoded as any).account ?? null, role: 'workspace_owner' }
    } catch {
      return { actor: null, role: 'system' }
    }
  }

  // Phase 1 Task 2 — Auth deps shared across all WAC routes. Construct once
  // here (NOT per request) so the closure captures the resolved DB handles.
  const authDeps: WacAuthDeps = {
    measureCtx,
    resolveWorkspaceUuid,
    accountDb: async () => (await accountsDb)[0]
  }

  // Phase 2A — read-side handlers live in server-plugins/workspace-access.
  // This file is now a thin HTTP host: route dispatch + auth gate only.
  // The lazy accessors are intentional — they let the plugin's tests run
  // without forcing pg + AccountDB to be constructed up-front.
  // Phase 4 T3 — WAC_EXTRA_SPACE_CLASSES (comma-separated) extends the
  // hardcoded v1 whitelist in handleSpaces so plugins adding their own
  // `core.class.Space` subclass can be exposed in the WAC Resources view
  // without a code change. Tokens are validated downstream
  // (mergeSpaceClassWhitelist) so a misconfigured value just gets dropped.
  const extraSpaceClasses = (process.env.WAC_EXTRA_SPACE_CLASSES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const wacReadDeps: WacReadDeps = {
    measureCtx,
    accountDb: async () => (await accountsDb)[0] as any,
    pgClient: async () => (await rawPgPromise) as any,
    resolveWorkspaceUuid,
    jsonHeaders: KEEP_ALIVE_HEADERS,
    extraSpaceClasses
  }
  const wacReadHandlers = createWacReadHandlers(wacReadDeps)

  // Phase 2B Tasks 2+3+4 — write-side handlers live in the same plugin.
  // The host still owns auth-gating + body-parsing; the handler owns
  // policy + the TxOperations mutation + sequenced audit-INSERT.
  const wacWriteDeps: WacWriteDeps = {
    measureCtx,
    txClient: wacTxClient,
    pgClient: async () => (await rawPgPromise) as any,
    accountDb: async () => (await accountsDb)[0] as any,
    cacheInvalidator: wacCacheInvalidator,
    jsonHeaders: KEEP_ALIVE_HEADERS
  }
  const wacWriteHandlers = createWacWriteHandlers(wacWriteDeps)

  async function writeWacAudit (
    workspace: string,
    action: string,
    actor: string | null,
    actorRole: string,
    payload: {
      target_account?: string | null
      target_space?: string | null
      target_space_class?: string | null
      old_value?: unknown
      new_value?: unknown
    }
  ): Promise<void> {
    try {
      const pg = await rawPgPromise
      await pg.execute(
        `INSERT INTO workspace_audit_log
         (workspace, action, actor, actor_role, target_account, target_space, target_space_class, old_value, new_value, metadata)
         VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
        [
          workspace,
          action,
          actor,
          actorRole,
          payload.target_account ?? null,
          payload.target_space ?? null,
          payload.target_space_class ?? null,
          payload.old_value != null ? JSON.stringify(payload.old_value) : null,
          payload.new_value != null ? JSON.stringify(payload.new_value) : null,
          JSON.stringify({})
        ]
      )
    } catch (err) {
      measureCtx.warn('WAC audit write failed', { action, err: String(err) })
    }
  }

  // Phase 2B Tasks 2+3+4 — fetchSpaceDetailRaw was the pre-migration helper
  // used by the inline write block to compute old_value for the audit row.
  // The plugin's writeRouter.ts now does its own space lookup (via the
  // same SELECT shape) directly inside each handler. The helper has been
  // removed alongside the inline write block.

  // ── Impersonation lifecycle ─────────────────────────────────────────────
  // D7 — Process-local JTI-revocation was removed. account-service runs
  // load-balanced across multiple pods, so a per-process `Map<jti, exp>`
  // could only revoke a token on the pod that handled `/end`; the other
  // pods would happily accept the same token until its `exp` claim
  // expired. v1 relies solely on the 30-minute token expiry (enforced in
  // `assertImpersonationToken` in @hcengineering/workspace-access-server).
  //
  // Real cross-pod revocation needs a shared store (Redis/DB) and is
  // tracked as a v2 follow-up. Until that lands, `/api/admin/
  // impersonation/end` returns 501 with `revocation_pending_persistent_store`
  // so the UI can present a clear "session will end on expiry" message
  // instead of mis-reporting success.

  app.use(async (ctx, next) => {
    if (ctx.method !== 'POST') return await next()
    const path = ctx.path
    const json = (status: number, body: unknown): void => {
      ctx.res.writeHead(status, KEEP_ALIVE_HEADERS)
      ctx.res.end(JSON.stringify(body))
    }

    if (path === '/api/admin/impersonation/start') {
      try {
        const [db] = await accountsDb
        const token = extractToken(ctx.request.headers) ?? ''
        await assertAdmin(measureCtx, db, token)
        const body: any = (ctx.request as any).body ?? {}
        const workspaceParam = String(body.workspace ?? '')
        const reason = typeof body.reason === 'string' ? body.reason : null
        const workspaceUuid = await resolveWorkspaceUuid(workspaceParam)
        if (workspaceUuid == null) return json(404, { error: 'workspace_not_found' })
        const caller = decodeToken(token) as any
        const adminUuid = caller.account ?? 'unknown-admin'
        const now = Math.floor(Date.now() / 1000)
        const exp = now + 30 * 60
        const jti = `${now}-${Math.random().toString(16).slice(2, 12)}`
        const impersonationRefId = `${now}-${Math.random().toString(16).slice(2, 12)}`
        // Issue token with workspace audience so transactor accepts it.
        // Pass extra as a flat Record<string,string> (not nested under .extra)
        // and set options.exp so the documented 30-minute expiry actually
        // applies to the JWT. Token expiry is the only revocation mechanism
        // in v1 (see D7 note above).
        const impersonationToken = generateToken(
          adminUuid,
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
        // Audit start in workspace_audit_log
        await writeWacAudit(workspaceUuid, 'impersonation_started', adminUuid, 'instance_admin', {
          new_value: { impersonation_ref: impersonationRefId, jti, reason, started_at: now }
        })
        return json(200, { impersonationToken, impersonationRefId, jti, exp })
      } catch (err) {
        return json(403, { error: 'forbidden', detail: String(err) })
      }
    }

    if (path === '/api/admin/impersonation/end') {
      // D7 — revocation requires a shared persistent store (out of scope
      // for v1, see comment block above). Still audit-log the *intent* to
      // end the session so the timeline reflects what the admin did, then
      // return 501 with a stable error code the UI can match on.
      try {
        const token = extractToken(ctx.request.headers) ?? ''
        const decoded = decodeToken(token) as any
        const jti = decoded.extra?.jti
        const refId = decoded.extra?.impersonation_ref
        const adminUuid = decoded.extra?.actor_admin ?? decoded.account
        const wsUuid = decoded.workspace
        const now = Math.floor(Date.now() / 1000)
        if (wsUuid != null) {
          await writeWacAudit(wsUuid, 'impersonation_end_attempted', adminUuid, 'instance_admin', {
            new_value: { impersonation_ref: refId, jti, attempted_at: now, outcome: 'revocation_pending_persistent_store' }
          })
        }
      } catch {
        // Token may be malformed/expired — still surface 501 below so the
        // UI gets a single consistent error contract for this endpoint.
      }
      return json(501, {
        error: 'not_implemented',
        detail: 'revocation_pending_persistent_store'
      })
    }

    return await next()
  })

  // ── End impersonation routes ────────────────────────────────────────────

  // WAC write endpoints (POST/PUT/DELETE). Use the same middleware
  // chain pattern; auth gated by authenticateWac (Phase 1 Task 2).
  app.use(async (ctx, next) => {
    if (ctx.method === 'GET') return await next()
    const m = ctx.path.match(/^\/api\/wac\/([^/]+)\/(.+)$/)
    if (m == null) return await next()
    const workspaceParam = decodeURIComponent(m[1])
    const sub = m[2]

    const json = (status: number, body: unknown): void => {
      ctx.res.writeHead(status, KEEP_ALIVE_HEADERS)
      ctx.res.end(JSON.stringify(body))
    }

    // All WAC write endpoints require OWNER (edit capability). The helper
    // writes 401/403/404 to ctx and returns null on failure.
    const auth = await authenticateWac(ctx, workspaceParam, 'edit', authDeps)
    if (auth === null) return
    const { callerUuid, workspaceUuid } = auth

    // Phase 2B Tasks 2+3+4 — write-route bodies live in the plugin's
    // writeRouter.ts. The host owns route-matching + auth-gating + the
    // 500 wrap on unexpected throw; the plugin owns mutation (via
    // TxOperations) + sequenced audit-INSERT + last-owner protection.
    try {
      // PUT /spaces/<id>/members
      const mPutMembers = sub.match(/^spaces\/([^/]+)\/members$/)
      if (mPutMembers != null && ctx.method === 'PUT') {
        await wacWriteHandlers.handleSpaceMembers(ctx as any, workspaceUuid, callerUuid, mPutMembers[1])
        return
      }
      // PUT /spaces/<id>/owners
      const mPutOwners = sub.match(/^spaces\/([^/]+)\/owners$/)
      if (mPutOwners != null && ctx.method === 'PUT') {
        await wacWriteHandlers.handleSpaceOwners(ctx as any, workspaceUuid, callerUuid, mPutOwners[1])
        return
      }
      // PUT /spaces/<id>/privacy
      const mPutPriv = sub.match(/^spaces\/([^/]+)\/privacy$/)
      if (mPutPriv != null && ctx.method === 'PUT') {
        await wacWriteHandlers.handleSpacePrivacy(ctx as any, workspaceUuid, callerUuid, mPutPriv[1])
        return
      }
      // PUT /spaces/<id>/auto-join
      const mPutAJ = sub.match(/^spaces\/([^/]+)\/auto-join$/)
      if (mPutAJ != null && ctx.method === 'PUT') {
        await wacWriteHandlers.handleSpaceAutoJoin(ctx as any, workspaceUuid, callerUuid, mPutAJ[1])
        return
      }
      // PUT /spaces/<id>/archived
      const mPutArch = sub.match(/^spaces\/([^/]+)\/archived$/)
      if (mPutArch != null && ctx.method === 'PUT') {
        await wacWriteHandlers.handleSpaceArchived(ctx as any, workspaceUuid, callerUuid, mPutArch[1])
        return
      }
      // POST /members/<uuid>/role
      const mPostRole = sub.match(/^members\/([^/]+)\/role$/)
      if (mPostRole != null && ctx.method === 'POST') {
        await wacWriteHandlers.handleMemberRole(ctx as any, workspaceUuid, callerUuid, mPostRole[1])
        return
      }
      // POST /members/bulk/role
      if (sub === 'members/bulk/role' && ctx.method === 'POST') {
        await wacWriteHandlers.handleBulkMemberRole(ctx as any, workspaceUuid, callerUuid)
        return
      }
      // DELETE /grants/<recipient>/<resource>  — 501 stub until P2B-T6.
      if (sub.startsWith('grants/') && ctx.method === 'DELETE') {
        const parts = sub.split('/')
        const recipient = parts[1] ?? ''
        const resource = parts[2] ?? ''
        await wacWriteHandlers.handleGrantRevoke(ctx as any, workspaceUuid, callerUuid, recipient, resource)
        return
      }
    } catch (err) {
      measureCtx.warn('WAC write failed', { sub, err: String(err) })
      return json(500, { error: 'write_failed', detail: String(err) })
    }

    return await next()
  })

  // ── WAC audit CSV export ────────────────────────────────────────────────
  // Phase 2A: body lives in server-plugins/workspace-access. The host owns
  // the auth gate (admin capability) + the 500 wrap on handler throw.
  app.use(async (ctx, next) => {
    if (ctx.method !== 'GET') return await next()
    const csvMatch = ctx.path.match(/^\/api\/wac\/([^/]+)\/audit\/export\.csv$/)
    if (csvMatch == null) return await next()
    const wsParam = decodeURIComponent(csvMatch[1])
    const auth = await authenticateWac(ctx, wsParam, 'admin', authDeps)
    if (auth === null) return
    try {
      await wacReadHandlers.handleAuditCsvExport(ctx, auth.workspaceUuid)
    } catch (err) {
      measureCtx.error('wac:/audit/export.csv read failed', { err: String(err) })
      ctx.res.writeHead(500, { 'Content-Type': 'application/json' })
      ctx.res.end(JSON.stringify({ error: 'internal', detail: 'wac_read_failed' }))
    }
  })
  // ── End WAC audit CSV export ────────────────────────────────────────────

  app.use(async (ctx, next) => {
    if (ctx.method !== 'GET') return await next()
    const m = ctx.path.match(/^\/api\/wac\/([^/]+)\/(.+)$/)
    if (m == null) return await next()
    const workspaceParam = decodeURIComponent(m[1])
    const sub = m[2]

    const json = (status: number, body: unknown): void => {
      ctx.res.writeHead(status, KEEP_ALIVE_HEADERS)
      ctx.res.end(JSON.stringify(body))
    }

    // Phase 1 Task 2 — pick the required capability for this sub-route.
    // my-access is per-member (USER+); everything else is MAINTAINER+ (read).
    // Unknown routes default to 'edit' (safest — OWNER-only).
    const wacCapability: 'read' | 'read-self' | 'edit' | 'admin' = (
      sub === 'my-access' ? 'read-self'
        : (sub === 'members' || sub === 'spaces' || sub.startsWith('spaces/')
            || sub === 'audit' || sub === 'admins/count' || sub === 'invites'
            || sub === 'grants' || sub === 'grants/count')
            ? 'read'
            : 'edit'
    )
    const auth = await authenticateWac(ctx, workspaceParam, wacCapability, authDeps)
    if (auth === null) return
    const { callerUuid, workspaceUuid } = auth

    // Phase 2A: dispatch to server-plugin handlers. The host owns auth +
    // request parsing; the plugin owns the pg/policy/JSON-shape logic.
    // Handlers throw on pg errors — we wrap as 500 here so the response
    // contract stays identical to the pre-migration state.
    try {
      if (sub === 'members') {
        await wacReadHandlers.handleMembers(ctx, workspaceUuid, workspaceParam)
        return
      }
      if (sub === 'invites') {
        await wacReadHandlers.handleInvites(ctx, workspaceUuid)
        return
      }
      if (sub === 'admins/count') {
        await wacReadHandlers.handleAdminsCount(ctx, workspaceUuid)
        return
      }
      if (sub === 'spaces') {
        await wacReadHandlers.handleSpaces(ctx, workspaceUuid, workspaceParam)
        return
      }
      if (sub.startsWith('spaces/')) {
        const spaceId = sub.slice('spaces/'.length)
        await wacReadHandlers.handleSpaceDetail(ctx, workspaceUuid, workspaceParam, spaceId)
        return
      }
      if (sub === 'audit') {
        await wacReadHandlers.handleAudit(ctx, workspaceUuid)
        return
      }
      if (sub === 'grants') {
        await wacReadHandlers.handleGrants(ctx, workspaceUuid)
        return
      }
      if (sub === 'grants/count') {
        await wacReadHandlers.handleGrantsCount(ctx, workspaceUuid)
        return
      }
      if (sub === 'my-access') {
        await wacReadHandlers.handleMyAccess(ctx, workspaceUuid, callerUuid, auth.role)
        return
      }
    } catch (err) {
      measureCtx.error(`wac:/${sub} read failed`, { err: String(err) })
      return json(500, { error: 'internal', detail: 'wac_read_failed' })
    }
    return await next()
  })

  // ── End WAC stub routes ─────────────────────────────────────────────────

  app.use(router.routes()).use(router.allowedMethods())

  const server = app.listen(ACCOUNT_PORT, () => {
    console.log(`server started on port ${ACCOUNT_PORT}`)
  })

  const close = (): void => {
    onClose?.()
    void wacTxClient.close().catch((err) => {
      measureCtx.warn('wac transactor pool close failed', { err: String(err) })
    })
    void accountsDb.then(([, closeAccountsDb]) => {
      closeAccountsDb()
    })
    server.close()
  }

  process.on('uncaughtException', (e) => {
    measureCtx.error('uncaughtException', { error: e })
  })

  process.on('unhandledRejection', (reason, promise) => {
    measureCtx.error('Unhandled Rejection at:', { reason, promise })
  })
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  process.on('exit', close)
}
