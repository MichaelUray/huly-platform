import type { EntityColumn } from '../EntityColumn'

interface AccountRow {
  _id: string
  name: string
  role: 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
}

describe('EntityColumn<T>', () => {
  it('accepts keyof T as key (compile-time)', () => {
    const col: EntityColumn<AccountRow> = { key: 'name', label: 'lbl' as any }
    expect(col.key).toBe('name')
  })
  it('accepts string for virtual columns (compile-time)', () => {
    const col: EntityColumn<AccountRow> = { key: 'computed', label: 'lbl' as any }
    expect(col.key).toBe('computed')
  })
  it('carries optional width / sort / visible attributes', () => {
    const col: EntityColumn<AccountRow> = {
      key: 'role',
      label: 'lbl' as any,
      sort: true,
      width: 120,
      visible: (a) => a.role !== 'GUEST'
    }
    expect(col.sort).toBe(true)
    expect(col.width).toBe(120)
    expect(col.visible?.({ _id: 'x', name: '', role: 'GUEST' })).toBe(false)
  })
})
