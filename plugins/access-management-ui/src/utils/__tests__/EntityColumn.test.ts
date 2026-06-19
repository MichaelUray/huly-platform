import type { EntityColumn } from '../EntityColumn'
import type { Doc, Ref } from '@hcengineering/core'

interface Account extends Doc {
  _id: Ref<Doc>
  name: string
  role: 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
}

describe('EntityColumn<T>', () => {
  it('accepts keyof T as key (compile-time)', () => {
    const col: EntityColumn<Account> = { key: 'name', label: 'lbl' as any }
    expect(col.key).toBe('name')
  })
  it('accepts string for virtual columns (compile-time)', () => {
    const col: EntityColumn<Account> = { key: 'computed', label: 'lbl' as any }
    expect(col.key).toBe('computed')
  })
  it('carries optional width / sort / visible attributes', () => {
    const col: EntityColumn<Account> = {
      key: 'role', label: 'lbl' as any, sort: true, width: 120,
      visible: (a) => a.role !== 'GUEST'
    }
    expect(col.sort).toBe(true)
    expect(col.width).toBe(120)
    expect(col.visible?.({ _id: 'x' as Ref<Doc>, _class: 'c' as any, name: '', role: 'GUEST', space: 'sp' as any, modifiedOn: 0, modifiedBy: 'm' as any })).toBe(false)
  })
})
