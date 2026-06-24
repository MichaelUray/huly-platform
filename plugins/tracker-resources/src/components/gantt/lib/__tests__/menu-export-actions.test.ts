//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  formatRangeLabel,
  defaultExportStamp,
  runExportToPng,
  runExportToPdf,
  type ExportSnapshot
} from '../menu-export-actions'
import * as exporter from '../exporter'

jest.mock('../exporter', () => ({
  exportGanttDataToPng: jest.fn(),
  exportGanttDataToPdf: jest.fn()
}))

const snap: ExportSnapshot = {
  rows: [],
  relations: [],
  summaryRanges: new Map(),
  timeScale: { toX: () => 0, fromX: () => 0 } as any,
  dateRange: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 11, 31) },
  totalCanvasWidth: 1000
}

describe('formatRangeLabel', () => {
  it('formats a timestamp as a short-month + year label', () => {
    // Locale-dependent — assert it's a non-empty string that contains a year.
    const out = formatRangeLabel(Date.UTC(2026, 5, 21))
    expect(out).toMatch(/2026/)
  })
})

describe('defaultExportStamp', () => {
  it('uses ISO YYYY-MM-DD as the suffix', () => {
    const stamp = defaultExportStamp(new Date(Date.UTC(2026, 5, 21, 12, 0, 0)))
    expect(stamp).toBe('gantt-2026-06-21')
  })
  it('falls back to "now" when no argument supplied', () => {
    const stamp = defaultExportStamp()
    expect(stamp).toMatch(/^gantt-\d{4}-\d{2}-\d{2}$/)
  })
})

describe('runExportToPng', () => {
  beforeEach(() => {
    (exporter.exportGanttDataToPng as jest.Mock).mockReset()
  })
  it('returns null on success', async () => {
    (exporter.exportGanttDataToPng as jest.Mock).mockResolvedValue(undefined)
    const err = await runExportToPng(snap, 'stamp-1')
    expect(err).toBeNull()
    expect(exporter.exportGanttDataToPng).toHaveBeenCalledTimes(1)
  })
  it('returns the Error when exporter rejects', async () => {
    (exporter.exportGanttDataToPng as jest.Mock).mockRejectedValue(new Error('boom'))
    const err = await runExportToPng(snap, 'stamp-1')
    expect(err).not.toBeNull()
    expect(err!.message).toBe('boom')
  })
  it('wraps non-Error rejections', async () => {
    (exporter.exportGanttDataToPng as jest.Mock).mockRejectedValue('string-error')
    const err = await runExportToPng(snap, 'stamp-1')
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toBe('string-error')
  })
  it('passes the snapshot fields through to exporter args', async () => {
    (exporter.exportGanttDataToPng as jest.Mock).mockResolvedValue(undefined)
    await runExportToPng(snap, 'stamp-1')
    const args = (exporter.exportGanttDataToPng as jest.Mock).mock.calls[0][0]
    expect(args.range).toEqual([snap.dateRange.from, snap.dateRange.to])
    expect(args.chartWidth).toBe(snap.totalCanvasWidth)
    expect(args.title).toContain('2026')
  })
})

describe('runExportToPdf', () => {
  it('returns null on success', async () => {
    (exporter.exportGanttDataToPdf as jest.Mock).mockResolvedValue(undefined)
    const err = await runExportToPdf(snap, 'stamp-1')
    expect(err).toBeNull()
  })
})
