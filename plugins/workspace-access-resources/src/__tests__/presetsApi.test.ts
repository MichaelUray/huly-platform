//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Verifies presetsApi correctly hits the WAC presets endpoints with
// the bearer token from the default WAC client. The server contract
// is owned by server-plugins/workspace-access/src/http/presetsRouter.ts.
//

import { setDefaultWacClient, WacClient } from '../api/wacClient'
import { presetsApi, type PresetRow, type ApplyResponse } from '../api/presetsApi'

interface Call { url: string, init: RequestInit }

function installFetch (responder: () => any): Call[] {
  const calls: Call[] = []
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json () { return responder() },
      async text () { return '' }
    }
  })
  return calls
}

function installClient (): void {
  setDefaultWacClient(new WacClient({ getToken: () => 'unit-token' }))
}

const sampleRow: PresetRow = {
  id: 'p-1',
  workspace: 'ws-1',
  name: 'Demo',
  description: null,
  shape: { role: 'USER', addToSpaces: ['sp-1'] },
  created_by: 'u-1',
  created_at: '2026-06-21T00:00:00Z',
  updated_at: '2026-06-21T00:00:00Z'
}

describe('presetsApi', () => {
  const originalFetch = (globalThis as any).fetch

  beforeEach(installClient)
  afterEach(() => { (globalThis as any).fetch = originalFetch })

  it('list GETs /api/wac/<ws>/presets', async () => {
    const calls = installFetch(() => ({ items: [sampleRow], cursor: null }))
    const result = await presetsApi.list('ws-1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/wac/ws-1/presets')
    expect(calls[0].init.method).toBe('GET')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer unit-token')
    expect(result.items[0].id).toBe('p-1')
  })

  it('create POSTs to /api/wac/<ws>/presets with body', async () => {
    const calls = installFetch(() => ({ item: sampleRow }))
    await presetsApi.create('ws-1', {
      name: 'Demo',
      shape: { role: 'USER', addToSpaces: ['sp-1'] }
    })
    expect(calls[0].url).toBe('/api/wac/ws-1/presets')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'Demo',
      shape: { role: 'USER', addToSpaces: ['sp-1'] }
    })
  })

  it('update PUTs to /api/wac/<ws>/presets/<id> with partial body', async () => {
    const calls = installFetch(() => ({ item: sampleRow }))
    await presetsApi.update('ws-1', 'p-1', { name: 'Renamed' })
    expect(calls[0].url).toBe('/api/wac/ws-1/presets/p-1')
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: 'Renamed' })
  })

  it('remove DELETEs /api/wac/<ws>/presets/<id>', async () => {
    const calls = installFetch(() => ({}))
    await presetsApi.remove('ws-1', 'p-1')
    expect(calls[0].url).toBe('/api/wac/ws-1/presets/p-1')
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('apply POSTs to /api/wac/<ws>/presets/<id>/apply and surfaces the snapshot', async () => {
    const response: ApplyResponse = {
      applied: 1,
      results: [{ memberUuid: 'm-1', status: 'ok', addedToSpaces: 1 }],
      snapshot: sampleRow
    }
    const calls = installFetch(() => response)
    const result = await presetsApi.apply('ws-1', 'p-1', ['m-1'])
    expect(calls[0].url).toBe('/api/wac/ws-1/presets/p-1/apply')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ memberUuids: ['m-1'] })
    expect(result.snapshot.id).toBe('p-1')
    expect(result.applied).toBe(1)
  })
})
