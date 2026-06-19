//
// Minimal CommonJS shim of `svelte/store` for Jest. Mirrors the runtime
// surface we use (writable / derived / get); enough to test our store
// helpers without pulling Svelte's ESM source through Jest.
//

export interface Writable<T> {
  set: (value: T) => void
  update: (fn: (value: T) => T) => void
  subscribe: (run: (value: T) => void) => () => void
}

export interface Readable<T> {
  subscribe: (run: (value: T) => void) => () => void
}

export function writable<T> (initial: T): Writable<T> {
  let value = initial
  const subs = new Set<(value: T) => void>()
  return {
    set (v: T): void {
      value = v
      subs.forEach((s) => s(value))
    },
    update (fn: (v: T) => T): void {
      value = fn(value)
      subs.forEach((s) => s(value))
    },
    subscribe (run: (v: T) => void): () => void {
      subs.add(run)
      run(value)
      return () => subs.delete(run)
    }
  }
}

export function derived<S, R> (
  stores: Readable<S> | Readable<S>[],
  fn: (values: any) => R
): Readable<R> {
  const arr = Array.isArray(stores) ? stores : [stores]
  const isArray = Array.isArray(stores)
  const subs = new Set<(value: R) => void>()
  let current: R | undefined
  const values: any[] = arr.map(() => undefined)
  const initialized: boolean[] = arr.map(() => false)
  let allReady = false

  function recompute (): void {
    if (!allReady) {
      allReady = initialized.every(Boolean)
      if (!allReady) return
    }
    const input = isArray ? values : values[0]
    current = fn(input)
    subs.forEach((s) => s(current as R))
  }

  arr.forEach((s, i) => {
    s.subscribe((v) => {
      values[i] = v
      initialized[i] = true
      recompute()
    })
  })

  return {
    subscribe (run: (v: R) => void): () => void {
      subs.add(run)
      if (allReady && current !== undefined) run(current)
      return () => subs.delete(run)
    }
  }
}

export function get<T> (store: Readable<T>): T {
  let value: T = undefined as unknown as T
  const unsub = store.subscribe((v) => {
    value = v
  })
  unsub()
  return value
}
