//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Phase 2.5 — guard tests for the new GuestSettings tab.
//
// We can't render Svelte components in jest-node (the wider WAC test
// suite is component-free for the same reason), so these tests pin the
// invariants we CAN check from plain TS:
//
//   1. `tabsForRole` includes `guest-settings` for OWNER +
//      IMPERSONATING_ADMIN and excludes it for every other role.
//   2. The tab id constant + IntlString key exist on the plugin so
//      AccessCenter's labelIntl lookup resolves to a registered key
//      (preventing the dynamic getEmbeddedLabel fallback from kicking
//      in for the 5th tab).
//   3. The GuestSettingsView source file exists at the expected path
//      and exports a default Svelte component (svelte-compile would
//      catch a missing default-export at build time, but pinning the
//      path here means a rename / move is caught earlier).
//   4. The legacy compat-shim points at the new tab.
//

import fs from 'fs'
import path from 'path'
import { tabsForRole } from '../stores/roleStore'
import wac from '../plugin'

const PROJECT_ROOT = path.join(__dirname, '..', '..')
const SETTING_RESOURCES_ROOT = path.join(
  PROJECT_ROOT, '..', 'setting-resources'
)

describe('GuestSettings — Phase 2.5 5th tab', () => {
  describe('role gating', () => {
    it('OWNER sees guest-settings', () => {
      expect(tabsForRole('OWNER')).toContain('guest-settings')
    })

    it('IMPERSONATING_ADMIN sees guest-settings', () => {
      // Impersonation == Owner-equivalent edit; this matches canEdit().
      expect(tabsForRole('IMPERSONATING_ADMIN')).toContain('guest-settings')
    })

    it.each([
      'MAINTAINER',
      'MAINTAINER_PLUS_SPACE_OWNER',
      'INSTANCE_ADMIN_READONLY',
      'USER_SELF_SCOPED',
      'SPACE_OWNER_SCOPED'
    ] as const)('%s does NOT see guest-settings', (role) => {
      expect(tabsForRole(role)).not.toContain('guest-settings')
    })

    it('GUEST sees no tabs at all', () => {
      expect(tabsForRole('GUEST')).toEqual([])
    })

    it('OWNER tab order: People → Resources → My Access → Audit → Guest Settings → Presets', () => {
      // Pin position so a future tab insertion doesn't accidentally
      // push GuestSettings into a confusing slot. WAC-Presets sits AFTER
      // guest-settings as the workspace-templates surface.
      const tabs = tabsForRole('OWNER')
      expect(tabs.indexOf('guest-settings')).toBe(4)
      expect(tabs[tabs.length - 1]).toBe('presets')
    })
  })

  describe('plugin IntlString registration', () => {
    it('GuestSettings tab label is registered on the wac plugin', () => {
      expect(wac.string.GuestSettings).toBeDefined()
      // IntlString values follow the `plugin:string.Key` pattern after
      // the platform's `plugin()` helper post-processes the bag.
      expect(typeof wac.string.GuestSettings).toBe('string')
      expect(wac.string.GuestSettings).toContain('GuestSettings')
    })

    it('GuestSettingsUnavailable fallback string is registered', () => {
      expect(wac.string.GuestSettingsUnavailable).toBeDefined()
      expect(typeof wac.string.GuestSettingsUnavailable).toBe('string')
    })
  })

  describe('source file invariants', () => {
    it('GuestSettingsView.svelte exists at the documented path', () => {
      const p = path.join(
        PROJECT_ROOT, 'src', 'components', 'guestSettings', 'GuestSettingsView.svelte'
      )
      expect(fs.existsSync(p)).toBe(true)
    })

    it('GuestSettingsView.svelte declares the editorComponent + canEdit props', () => {
      const p = path.join(
        PROJECT_ROOT, 'src', 'components', 'guestSettings', 'GuestSettingsView.svelte'
      )
      const src = fs.readFileSync(p, 'utf-8')
      // Pin the export prop names — the AccessCenter shell passes them
      // verbatim; a silent rename would break the wiring.
      expect(src).toMatch(/export let editorComponent/)
      expect(src).toMatch(/export let canEdit/)
      // Pin the AnyComponent mount via <Component is={...}/>.
      expect(src).toMatch(/<Component\s+is=\{editorComponent\}/)
    })

    it('GuestPermissionsEditor.svelte (extracted editor body) exists', () => {
      const p = path.join(
        SETTING_RESOURCES_ROOT, 'src', 'components', 'GuestPermissionsEditor.svelte'
      )
      expect(fs.existsSync(p)).toBe(true)
    })

    it('GuestPermissionsEditor.svelte preserves the same field mutations as the legacy editor', () => {
      // Verbatim port — pin the four mutation entry points to catch any
      // accidental drop during a future refactor:
      //   * updateDoc(ModulePermissionGroup, ..., { enabled })            module access toggle
      //   * updateDoc(ModulePermissionGroup, ..., { disabledPermissions }) per-permission toggle
      //   * updateAllowReadOnlyGuests                                     anonymous-guest opt-in
      //   * updateAllowGuestSignUp                                        anonymous-guest sign-up
      //   * createDoc/updateDoc(GuestCommunicationSettings, ..., { allowedCards }) guest chat allowlist
      const p = path.join(
        SETTING_RESOURCES_ROOT, 'src', 'components', 'GuestPermissionsEditor.svelte'
      )
      const src = fs.readFileSync(p, 'utf-8')
      expect(src).toMatch(/updateDoc\([\s\S]*?ModulePermissionGroup[\s\S]*?enabled/)
      expect(src).toMatch(/updateDoc\([\s\S]*?ModulePermissionGroup[\s\S]*?disabledPermissions/)
      expect(src).toMatch(/updateAllowReadOnlyGuests/)
      expect(src).toMatch(/updateAllowGuestSignUp/)
      expect(src).toMatch(/GuestCommunicationSettings/)
      expect(src).toMatch(/allowedCards/)
    })

    it('GuestPermissionsEditor.svelte respects the canEdit prop on every mutation path', () => {
      // Defense-in-depth: the role gate is the source of truth, but the
      // editor MUST short-circuit writes if a caller mis-passes canEdit=false.
      const p = path.join(
        SETTING_RESOURCES_ROOT, 'src', 'components', 'GuestPermissionsEditor.svelte'
      )
      const src = fs.readFileSync(p, 'utf-8')
      expect(src).toMatch(/export let canEdit: boolean/)
      // Each async mutation handler short-circuits via `globalReadOnly`
      // (derived from `!canEdit`).
      expect(src).toMatch(/globalReadOnly = !canEdit/)
      // toggleModule, togglePermission, handleToggleReadonlyAccess,
      // handleToggleGuestSignUp, onAllowedCardsChange all guard.
      const guardHits = src.split('\n').filter((l) => /if \(globalReadOnly\) return/.test(l)).length
      expect(guardHits).toBeGreaterThanOrEqual(5)
    })

    it('legacy GuestPermissionsSettings.svelte shim points at the guest-settings tab', () => {
      const p = path.join(
        SETTING_RESOURCES_ROOT, 'src', 'components', 'GuestPermissionsSettings.svelte'
      )
      const src = fs.readFileSync(p, 'utf-8')
      expect(src).toMatch(/initialTab="guest-settings"/)
      // The previous people/by-role wiring is gone.
      expect(src).not.toMatch(/initialSub="by-role"/)
    })

    it('AccessCenter.svelte mounts GuestSettingsView when the active tab is guest-settings', () => {
      const p = path.join(
        PROJECT_ROOT, 'src', 'components', 'AccessCenter.svelte'
      )
      const src = fs.readFileSync(p, 'utf-8')
      expect(src).toMatch(/active === 'guest-settings'/)
      expect(src).toMatch(/<GuestSettingsView /)
      // The new guestSettingsComponent prop is declared and forwarded.
      expect(src).toMatch(/export let guestSettingsComponent/)
      expect(src).toMatch(/editorComponent=\{guestSettingsComponent\}/)
    })
  })
})
