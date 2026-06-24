//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Phase 1 Task 4 — D5 role-semantics matrix.
//
// Locks in the contract documented in the brief:
//
//   | Role       | tabsForRole       | canEdit | canReadWorkspaceWide |
//   | ---------- | ----------------- | ------- | -------------------- |
//   | OWNER      | 4 tabs            | true    | true                 |
//   | MAINTAINER | 4 tabs            | false   | true                 |
//   | USER       | ['my-access']     | false   | false                |
//   | GUEST      | []                | false   | false                |
//
// The helpers operate on `EffectiveRole`, so USER is exercised via its
// most common resolution (`USER_SELF_SCOPED`) and the OWNER/MAINTAINER
// rows are also asserted against the impersonation-derived variants so
// the matrix doesn't quietly diverge for drill-down sessions.
//

import { get } from 'svelte/store'
import {
  canEdit,
  canReadWorkspaceWide,
  effectiveRole,
  isGuestVariant,
  roleStore,
  tabsForRole
} from '../stores/roleStore'
import { impersonationStore } from '../stores/impersonationStore'
import type { WorkspaceRole } from '../types'

describe('D5 role-semantics matrix', () => {
  describe('tabsForRole', () => {
    it('OWNER sees all four tabs', () => {
      expect(tabsForRole('OWNER')).toEqual(['people', 'resources', 'my-access', 'audit'])
    })

    it('MAINTAINER sees all four tabs (read-only, gated inside)', () => {
      expect(tabsForRole('MAINTAINER')).toEqual(['people', 'resources', 'my-access', 'audit'])
    })

    it('MAINTAINER_PLUS_SPACE_OWNER sees all four tabs', () => {
      expect(tabsForRole('MAINTAINER_PLUS_SPACE_OWNER')).toEqual([
        'people',
        'resources',
        'my-access',
        'audit'
      ])
    })

    it('USER sees only the My Access tab', () => {
      expect(tabsForRole('USER_SELF_SCOPED')).toEqual(['my-access'])
    })

    it('SPACE_OWNER_SCOPED (USER who owns a space) sees only My Access', () => {
      // Per-space edit affordances are gated inside the My Access view via
      // ownedSpaceIds, not via the top-level tab list.
      expect(tabsForRole('SPACE_OWNER_SCOPED')).toEqual(['my-access'])
    })

    it('GUEST sees no tabs (backend already returns 403)', () => {
      expect(tabsForRole('GUEST')).toEqual([])
    })
  })

  describe('canEdit', () => {
    it('OWNER can edit', () => {
      expect(canEdit('OWNER')).toBe(true)
    })

    it('MAINTAINER cannot edit (read-only mode)', () => {
      expect(canEdit('MAINTAINER')).toBe(false)
      expect(canEdit('MAINTAINER_PLUS_SPACE_OWNER')).toBe(false)
    })

    it('USER cannot edit workspace-wide', () => {
      expect(canEdit('USER_SELF_SCOPED')).toBe(false)
      expect(canEdit('SPACE_OWNER_SCOPED')).toBe(false)
    })

    it('GUEST cannot edit', () => {
      expect(canEdit('GUEST')).toBe(false)
    })
  })

  describe('canReadWorkspaceWide', () => {
    it('OWNER reads workspace-wide', () => {
      expect(canReadWorkspaceWide('OWNER')).toBe(true)
    })

    it('MAINTAINER reads workspace-wide', () => {
      expect(canReadWorkspaceWide('MAINTAINER')).toBe(true)
      expect(canReadWorkspaceWide('MAINTAINER_PLUS_SPACE_OWNER')).toBe(true)
    })

    it('USER does not read workspace-wide', () => {
      expect(canReadWorkspaceWide('USER_SELF_SCOPED')).toBe(false)
      expect(canReadWorkspaceWide('SPACE_OWNER_SCOPED')).toBe(false)
    })

    it('GUEST does not read workspace-wide', () => {
      expect(canReadWorkspaceWide('GUEST')).toBe(false)
    })
  })
})

// ----------------------------------------------------------------------------
// T3 — Guest sub-role matrix.
//
// All three guest variants (GUEST / READONLY_GUEST / DOC_GUEST) collapse
// to the same EffectiveRole bucket (`GUEST`) for v1 — they share the
// "no tabs, no edit, no workspace-wide read" capability set. Finer
// per-variant gating is a v2 follow-up.
// ----------------------------------------------------------------------------

describe('T3 Guest sub-role matrix', () => {
  const guestVariants: WorkspaceRole[] = ['GUEST', 'READONLY_GUEST', 'DOC_GUEST']

  describe('isGuestVariant', () => {
    for (const r of guestVariants) {
      it(`recognizes ${r} as a guest variant`, () => {
        expect(isGuestVariant(r)).toBe(true)
      })
    }
    it('rejects non-guest roles', () => {
      expect(isGuestVariant('OWNER')).toBe(false)
      expect(isGuestVariant('MAINTAINER')).toBe(false)
      expect(isGuestVariant('USER')).toBe(false)
    })
  })

  describe('effectiveRole derivation', () => {
    // Reset the impersonation store to 'normal' so derivation depends
    // solely on the workspace-role under test.
    beforeEach(() => {
      impersonationStore.set({
        state: 'normal',
        exp: null,
        ref: null,
        workspace: null
      })
    })

    for (const r of guestVariants) {
      it(`collapses workspaceRole=${r} to EffectiveRole=GUEST`, () => {
        roleStore.set({ workspaceRole: r, ownedSpaceIds: [], hydrated: true })
        expect(get(effectiveRole)).toBe('GUEST')
      })
    }
  })

  describe('capability bucket (no tabs / no edit / no read)', () => {
    // After the collapse to EffectiveRole=GUEST, the existing helpers
    // already enforce the matrix; re-assert here so a future regression
    // (e.g. splitting the buckets) shows up in this exact test file.
    for (const r of guestVariants) {
      it(`${r} → tabsForRole=[] (via collapse to GUEST)`, () => {
        roleStore.set({ workspaceRole: r, ownedSpaceIds: [], hydrated: true })
        impersonationStore.set({ state: 'normal', exp: null, ref: null, workspace: null })
        expect(tabsForRole(get(effectiveRole))).toEqual([])
      })
      it(`${r} → canEdit=false`, () => {
        roleStore.set({ workspaceRole: r, ownedSpaceIds: [], hydrated: true })
        impersonationStore.set({ state: 'normal', exp: null, ref: null, workspace: null })
        expect(canEdit(get(effectiveRole))).toBe(false)
      })
      it(`${r} → canReadWorkspaceWide=false`, () => {
        roleStore.set({ workspaceRole: r, ownedSpaceIds: [], hydrated: true })
        impersonationStore.set({ state: 'normal', exp: null, ref: null, workspace: null })
        expect(canReadWorkspaceWide(get(effectiveRole))).toBe(false)
      })
    }
  })
})
