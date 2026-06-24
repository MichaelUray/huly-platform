import { get } from 'svelte/store'
import { roleStore, effectiveRole, canEdit, canReadWorkspaceWide, tabsForRole } from '../stores/roleStore'
import { impersonationStore } from '../stores/impersonationStore'

describe('effectiveRole resolver', () => {
  beforeEach(() => {
    impersonationStore.set({ state: 'normal', exp: null, ref: null, workspace: null })
  })

  it('returns OWNER for plain workspace owner', () => {
    roleStore.set({ workspaceRole: 'OWNER', ownedSpaceIds: [], hydrated: true })
    expect(get(effectiveRole)).toBe('OWNER')
  })

  it('promotes Maintainer+SpaceOwner to MAINTAINER_PLUS_SPACE_OWNER', () => {
    roleStore.set({ workspaceRole: 'MAINTAINER', ownedSpaceIds: ['s1'], hydrated: true })
    expect(get(effectiveRole)).toBe('MAINTAINER_PLUS_SPACE_OWNER')
  })

  it('returns SPACE_OWNER_SCOPED for User+SpaceOwner', () => {
    roleStore.set({ workspaceRole: 'USER', ownedSpaceIds: ['s1'], hydrated: true })
    expect(get(effectiveRole)).toBe('SPACE_OWNER_SCOPED')
  })

  it('returns USER_SELF_SCOPED for plain user', () => {
    roleStore.set({ workspaceRole: 'USER', ownedSpaceIds: [], hydrated: true })
    expect(get(effectiveRole)).toBe('USER_SELF_SCOPED')
  })

  it('switches to IMPERSONATING_ADMIN on active impersonation', () => {
    roleStore.set({ workspaceRole: 'USER', ownedSpaceIds: [], hydrated: true })
    impersonationStore.set({ state: 'active', exp: 9999, ref: 'r', workspace: 'ws' })
    expect(get(effectiveRole)).toBe('IMPERSONATING_ADMIN')
  })

  it('returns INSTANCE_ADMIN_READONLY (NOT IMPERSONATING_ADMIN) for drill-down', () => {
    roleStore.set({ workspaceRole: 'USER', ownedSpaceIds: [], hydrated: true })
    impersonationStore.set({ state: 'drill-down', exp: null, ref: null, workspace: 'ws' })
    expect(get(effectiveRole)).toBe('INSTANCE_ADMIN_READONLY')
  })
})

describe('role gate helpers', () => {
  it('canEdit only for OWNER and IMPERSONATING_ADMIN', () => {
    expect(canEdit('OWNER')).toBe(true)
    expect(canEdit('IMPERSONATING_ADMIN')).toBe(true)
    expect(canEdit('MAINTAINER')).toBe(false)
    expect(canEdit('USER_SELF_SCOPED')).toBe(false)
    expect(canEdit('GUEST')).toBe(false)
    // Blue-banner drill-down MUST NOT be editable.
    expect(canEdit('INSTANCE_ADMIN_READONLY')).toBe(false)
  })

  it('canReadWorkspaceWide for OWNER/MAINTAINER variants/IMPERSONATING_ADMIN/INSTANCE_ADMIN_READONLY', () => {
    expect(canReadWorkspaceWide('OWNER')).toBe(true)
    expect(canReadWorkspaceWide('MAINTAINER')).toBe(true)
    expect(canReadWorkspaceWide('MAINTAINER_PLUS_SPACE_OWNER')).toBe(true)
    expect(canReadWorkspaceWide('IMPERSONATING_ADMIN')).toBe(true)
    expect(canReadWorkspaceWide('INSTANCE_ADMIN_READONLY')).toBe(true)
    expect(canReadWorkspaceWide('USER_SELF_SCOPED')).toBe(false)
    expect(canReadWorkspaceWide('SPACE_OWNER_SCOPED')).toBe(false)
    expect(canReadWorkspaceWide('GUEST')).toBe(false)
  })

  it('tabsForRole hides audit for plain users', () => {
    expect(tabsForRole('USER_SELF_SCOPED')).toEqual(['my-access'])
    // GUEST is fully blocked per D5 — backend returns 403, frontend
    // surfaces a friendly "no access" message instead of any tab.
    expect(tabsForRole('GUEST')).toEqual([])
  })

  it('tabsForRole shows the full surface plus guest-settings for OWNER', () => {
    // Phase 2.5 — OWNER (and IMPERSONATING_ADMIN) get the 5th
    // Owner-only `guest-settings` tab that hosts the extracted
    // GuestPermissionsEditor.
    expect(tabsForRole('OWNER')).toEqual([
      'people',
      'resources',
      'my-access',
      'audit',
      'guest-settings'
    ])
  })

  it('tabsForRole gives IMPERSONATING_ADMIN the same 5-tab Owner surface', () => {
    // Phase 2.5 — impersonation grants Owner-equivalent privileges
    // (every action dual-audited); the guest-settings tab MUST be
    // visible so the impersonator can fix a misconfigured workspace.
    expect(tabsForRole('IMPERSONATING_ADMIN')).toEqual([
      'people',
      'resources',
      'my-access',
      'audit',
      'guest-settings'
    ])
  })

  it('tabsForRole gives Maintainer read of all surfaces but NO guest-settings', () => {
    // Phase 2.5 — MAINTAINER stays at 4 tabs. The underlying
    // ModulePermissionGroup / allowReadOnlyGuest mutations are
    // Owner-gated server-side; hiding the tab avoids promising an
    // editor that would 403 on every click.
    expect(tabsForRole('MAINTAINER')).toEqual(['people', 'resources', 'my-access', 'audit'])
    expect(tabsForRole('MAINTAINER')).not.toContain('guest-settings')
  })

  it('tabsForRole gives Maintainer+SpaceOwner same 4-tab surface (no guest-settings)', () => {
    expect(tabsForRole('MAINTAINER_PLUS_SPACE_OWNER')).toEqual([
      'people',
      'resources',
      'my-access',
      'audit'
    ])
    expect(tabsForRole('MAINTAINER_PLUS_SPACE_OWNER')).not.toContain('guest-settings')
  })

  it('tabsForRole gives INSTANCE_ADMIN_READONLY 4-tab surface (no guest-settings)', () => {
    // Drill-down without impersonation is read-only — guest-settings
    // is an editor, so it stays hidden until the admin starts an
    // impersonation session.
    expect(tabsForRole('INSTANCE_ADMIN_READONLY')).toEqual([
      'people',
      'resources',
      'my-access',
      'audit'
    ])
    expect(tabsForRole('INSTANCE_ADMIN_READONLY')).not.toContain('guest-settings')
  })
})
