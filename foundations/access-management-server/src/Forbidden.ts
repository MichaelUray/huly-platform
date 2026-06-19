//
// Copyright © 2026 Hardcore Engineering Inc.
//

/** Thrown by access-management guards when an authorization check fails. */
export class Forbidden extends Error {
  constructor (reason: string) {
    super(reason)
    this.name = 'Forbidden'
  }
}
