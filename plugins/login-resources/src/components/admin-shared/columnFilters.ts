//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Back-compat shim. Existed before WAC extracted the canonical
// implementation into @hcengineering/access-management-ui. Inlined
// here (rather than re-exporting deep) because webpack's bundling
// rejects deep imports of the lib's TS source. Keep this in sync with
// access-management-ui/src/utils/mergeColumnFilters.ts.
//

export function mergeColumnFilters (cf: Record<string, any>): Record<string, any> {
  return Object.values(cf).reduce<Record<string, any>>((acc, partial) => {
    if (partial == null) return acc
    return { ...acc, ...partial }
  }, {})
}
