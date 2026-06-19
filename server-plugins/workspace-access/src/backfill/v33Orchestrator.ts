//
// Copyright © 2026 Hardcore Engineering Inc.
//
// V33 backfill orchestrator. Walks a workspace's current member /
// space / grant state and writes synthetic `*_backfill` rows into
// `workspace_audit_log`. Idempotent via the partial unique index
// `idx_wal_backfill_unique` (defined in V32).
//

export type BackfillState = 'running' | 'completed' | 'failed' | 'paused'
export const MAX_RETRIES = 3

export interface BackfillRow {
  id: string
  workspace: string
  state: BackfillState
  last_cursor: string | null
  retry_count: number
}

export interface BackfillBatch {
  items: Array<{
    action: string
    actor: string | null
    actor_role: string
    target_account?: string
    target_space?: string
    target_space_class?: string
    metadata?: Record<string, unknown>
  }>
  nextCursor: string | null
}

export interface BackfillDeps {
  getOrCreateRun: (workspace: string) => Promise<BackfillRow>
  updateRun: (id: string, patch: Partial<BackfillRow> & { failure_reason?: string }) => Promise<void>
  fetchNextBatch: (workspace: string, cursor: string | null, batchSize: number) => Promise<BackfillBatch>
  writeEntries: (workspace: string, items: BackfillBatch['items'], runId: string, batchId: string) => Promise<void>
  uuid: () => string
  now: () => number
}

export interface OrchestratorOptions {
  batchSize?: number
}

export async function v33BackfillWorkspace (
  deps: BackfillDeps,
  workspace: string,
  opts: OrchestratorOptions = {}
): Promise<{ runId: string; finalState: BackfillState }> {
  const batchSize = opts.batchSize ?? 500
  const run = await deps.getOrCreateRun(workspace)

  if (run.state === 'completed' || run.state === 'paused') {
    return { runId: run.id, finalState: run.state }
  }
  if (run.state === 'failed' && run.retry_count >= MAX_RETRIES) {
    return { runId: run.id, finalState: 'failed' }
  }

  try {
    await deps.updateRun(run.id, { state: 'running' })
    let cursor = run.last_cursor
    while (true) {
      const batch = await deps.fetchNextBatch(workspace, cursor, batchSize)
      if (batch.items.length === 0) break
      const batchId = deps.uuid()
      await deps.writeEntries(workspace, batch.items, run.id, batchId)
      cursor = batch.nextCursor
      await deps.updateRun(run.id, { last_cursor: cursor })
      if (batch.nextCursor == null) break
    }
    await deps.updateRun(run.id, { state: 'completed' })
    return { runId: run.id, finalState: 'completed' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await deps.updateRun(run.id, {
      state: 'failed',
      failure_reason: reason.slice(0, 500),
      retry_count: run.retry_count + 1
    })
    throw err
  }
}
