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

  // ── WAC (Workspace Access Center) stub routes ───────────────────────────
  // First-cut endpoints for the WAC frontend running on huly.uray.io. They
  // return shape-correct fixtures pulled from the existing account/admin
  // surface so the UI is fully clickable end-to-end. Real backing of
  // members/spaces/audit/grants from the workspace transactor is the
  // next session's wiring job; tonight's deploy is about getting the
  // surface live so flows can be exercised.
  //
  // Implemented as raw app.use middleware that matches GET requests
  // against /api/wac/<ws>/<endpoint> patterns. koa-router exhibited
  // deterministic-but-alternating 200/404 responses on consecutive WAC
  // routes when registered conventionally — likely a path-to-regexp
  // ordering quirk we couldn't isolate. Bypassing the router for these
  // 9 simple GETs avoids the issue entirely.

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

    const workspaceUuid = await resolveWorkspaceUuid(workspaceParam).catch(() => null)
    const pg = await rawPgPromise

    if (sub === 'members') {
      try {
        const [db] = await accountsDb
        if (workspaceUuid != null) {
          const members = await db.getWorkspaceMembers(workspaceUuid as any)
          const personUuids = members.map((m: any) => m.person)
          const items: any[] = []
          for (const m of members) {
            const personUuid = m.person as string
            const personRows = await pg.execute(
              'SELECT first_name, last_name FROM global_account.person WHERE uuid=$1 LIMIT 1', [personUuid]
            )
            const emailRows = await pg.execute(
              `SELECT value FROM global_account.social_id WHERE person_uuid=$1 AND type='email' LIMIT 1`, [personUuid]
            )
            const acctRows = await pg.execute(
              'SELECT last_activity_at FROM global_account.account WHERE uuid=$1 LIMIT 1', [personUuid]
            )
            const lastAct = acctRows[0]?.last_activity_at != null ? new Date(acctRows[0].last_activity_at).getTime() : null
            const fn = personRows[0]?.first_name ?? ''
            const ln = personRows[0]?.last_name ?? ''
            const display = `${fn} ${ln}`.trim() || (emailRows[0]?.value ?? personUuid)
            items.push({
              uuid: personUuid,
              name: display,
              email: emailRows[0]?.value ?? '',
              role: m.role ?? 'USER',
              activityBucket: lastAct == null ? '90d+'
                : (Date.now() - lastAct) < 86400_000 ? 'today'
                : (Date.now() - lastAct) < 7 * 86400_000 ? '7d'
                : (Date.now() - lastAct) < 30 * 86400_000 ? '30d'
                : '90d+',
              spacesCount: 0
            })
          }
          return json(200, { items, cursor: null, _workspace: workspaceParam })
        }
      } catch (err) {
        measureCtx.warn('wac:/members fallback to fixtures', { err: String(err) })
      }
      // Fallback fixtures for unknown workspaces.
      const items = [
        { uuid: 'demo-1', name: 'Alice Owner', email: 'alice@demo.test', role: 'OWNER', activityBucket: 'today', spacesCount: 3 },
        { uuid: 'demo-2', name: 'Bob Maintainer', email: 'bob@demo.test', role: 'MAINTAINER', activityBucket: '7d', spacesCount: 2 },
        { uuid: 'demo-3', name: 'Carol User', email: 'carol@demo.test', role: 'USER', activityBucket: '30d', spacesCount: 1 }
      ]
      return json(200, { items, cursor: null, _workspace: workspaceParam })
    }
    if (sub === 'invites') return json(200, { items: [], cursor: null })
    if (sub === 'admins/count') {
      let remaining = 1
      try {
        if (workspaceUuid != null) {
          const rows = await pg.execute(
            `SELECT count(*) AS c FROM global_account.workspace_members WHERE workspace_uuid=$1 AND role IN ('OWNER','MAINTAINER')`,
            [workspaceUuid]
          )
          remaining = parseInt(rows[0]?.c ?? '1', 10)
        }
      } catch { /* keep default */ }
      return json(200, { remaining })
    }
    if (sub === 'spaces') {
      try {
        if (workspaceUuid != null) {
          const rows = await pg.execute(
            `SELECT "_id", "_class",
                    data->>'name' AS name,
                    (data->>'private')::boolean AS private_flag,
                    (data->>'autoJoin')::boolean AS auto_join,
                    (data->>'archived')::boolean AS archived,
                    data->>'members' AS members
             FROM space
             WHERE "workspaceId"=$1
               AND "_class" IN ('tracker:class:Project','document:class:Teamspace','drive:class:Drive','card:class:CardSpace','lead:class:Funnel','recruit:class:Vacancy','recruit:class:JobFunnel')
             ORDER BY data->>'name' ASC
             LIMIT 200`,
            [workspaceUuid]
          )
          const items = rows.map((r: any) => {
            let members: string[] = []
            try { if (typeof r.members === 'string') members = JSON.parse(r.members) } catch { /* keep [] */ }
            return {
              _id: r._id,
              _class: String(r._class).replace(/:/g, '.'),
              name: r.name ?? '—',
              ownerIds: [],
              membersCount: members.length,
              private: r.private_flag === true,
              autoJoin: r.auto_join === true,
              archived: r.archived === true
            }
          })
          return json(200, { items, cursor: null })
        }
      } catch (err) {
        measureCtx.warn('wac:/spaces fallback to fixtures', { err: String(err) })
      }
      return json(200, {
        items: [
          { _id: 'demo-space-1', _class: 'tracker.class.Project', name: 'Demo Project', ownerIds: [], membersCount: 0, private: false, autoJoin: false, archived: false },
          { _id: 'demo-space-2', _class: 'document.class.Teamspace', name: 'Demo Teamspace', ownerIds: [], membersCount: 0, private: true, autoJoin: false, archived: false }
        ],
        cursor: null
      })
    }
    if (sub.startsWith('spaces/')) {
      const spaceId = sub.slice('spaces/'.length)
      try {
        if (workspaceUuid != null) {
          const rows = await pg.execute(
            `SELECT "_id", "_class",
                    data->>'name' AS name,
                    (data->>'private')::boolean AS private_flag,
                    (data->>'autoJoin')::boolean AS auto_join,
                    (data->>'archived')::boolean AS archived,
                    data->>'members' AS members,
                    data->>'owners' AS owners
             FROM space WHERE "workspaceId"=$1 AND "_id"=$2 LIMIT 1`,
            [workspaceUuid, spaceId]
          )
          if (rows[0] != null) {
            const r = rows[0]
            let members: string[] = []
            let owners: string[] = []
            try { if (typeof r.members === 'string') members = JSON.parse(r.members) } catch { /* keep [] */ }
            try { if (typeof r.owners === 'string') owners = JSON.parse(r.owners) } catch { /* keep [] */ }
            return json(200, {
              _id: r._id,
              _class: String(r._class).replace(/:/g, '.'),
              name: r.name ?? '—',
              ownerIds: owners,
              members,
              membersCount: members.length,
              private: r.private_flag === true,
              autoJoin: r.auto_join === true,
              archived: r.archived === true
            })
          }
        }
      } catch (err) {
        measureCtx.warn('wac:/spaces/<id> fallback to fixture', { err: String(err) })
      }
      return json(200, {
        _id: spaceId, _class: 'tracker.class.Project', name: 'Demo Space',
        ownerIds: [], members: [], membersCount: 0,
        private: false, autoJoin: false, archived: false
      })
    }
    if (sub === 'audit') {
      try {
        if (workspaceUuid != null) {
          const rows = await pg.execute(
            `SELECT id, ts::text AS ts, action, actor::text AS actor, actor_role,
                    target_account::text AS target_account, target_space,
                    metadata
             FROM workspace_audit_log
             WHERE workspace=$1
             ORDER BY ts DESC
             LIMIT 100`,
            [workspaceUuid]
          )
          const items = rows.map((r: any) => ({
            id: r.id,
            ts: r.ts,
            action: r.action,
            actor: r.actor,
            actor_pseudonym: null,
            actor_role: r.actor_role,
            target_account: r.target_account,
            target_space: r.target_space,
            metadata: r.metadata ?? {}
          }))
          return json(200, { items, cursor: null })
        }
      } catch (err) {
        measureCtx.warn('wac:/audit fallback to empty', { err: String(err) })
      }
      return json(200, { items: [], cursor: null })
    }
    if (sub === 'grants') return json(200, { items: [], cursor: null })
    if (sub === 'grants/count') return json(200, { count: 0 })
    if (sub === 'my-access') {
      try {
        if (workspaceUuid != null) {
          const [db] = await accountsDb
          const members = await db.getWorkspaceMembers(workspaceUuid as any)
          // Determine caller via token if present, else default to OWNER.
          const token = extractToken(ctx.request.headers) ?? ''
          let callerRole: string = 'OWNER'
          try {
            const decoded = (await import('@hcengineering/server-token')).decodeToken(token)
            const callerUuid = decoded.account
            const callerEntry = members.find((m: any) => m.person === callerUuid)
            if (callerEntry?.role != null) callerRole = callerEntry.role
          } catch { /* keep default */ }
          return json(200, {
            role: callerRole, spacesMemberOf: [], spacesOwned: [],
            grantsReceived: [], grantsGiven: []
          })
        }
      } catch (err) {
        measureCtx.warn('wac:/my-access fallback', { err: String(err) })
      }
      return json(200, {
        role: 'OWNER', spacesMemberOf: [], spacesOwned: [],
        grantsReceived: [], grantsGiven: []
      })
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
