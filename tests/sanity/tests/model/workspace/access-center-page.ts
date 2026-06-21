//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Phase 2.5 sanity-test page object for the Workspace Access Center
// (replaces the legacy OwnersPage which targeted the pre-Phase-2
// Members + Spaces UIs). Hooks the Playwright surface against the
// `data-test=...` attributes the WAC components carry — see
// `plugins/workspace-access-resources/src/components/AccessCenter.svelte`
// and friends.
//
// The page object is deliberately thin and assertion-light so it can
// be composed into multiple spec files. Each method either returns a
// Locator or performs a self-contained click; the spec is responsible
// for the surrounding assertions.
//

import { expect, type Locator, type Page } from '@playwright/test'

/** Tab ids — must stay in sync with `tabsForRole()` in WAC roleStore. */
export type WacTabId = 'people' | 'resources' | 'my-access' | 'audit' | 'guest-settings'

export class AccessCenterPage {
  readonly page: Page

  constructor (page: Page) {
    this.page = page
  }

  // ─── Sidebar (Settings shell) ──────────────────────────────────────
  sidebarSettingsNav = (): Locator => this.page.locator('#navGroup-setting')
  accessCenterSidebarItem = (): Locator =>
    this.sidebarSettingsNav().getByRole('button', { name: 'Access Center' })

  /**
   * Phase 2 T1 + 2.5 — the three legacy entries (Workspace Members,
   * Guests, Global Space Admins) MUST NOT appear in the sidebar after
   * the consolidation. Use these locators to assert their absence.
   */
  legacyMembersSidebarItem = (): Locator =>
    this.sidebarSettingsNav().getByRole('button', { name: 'Workspace Members', exact: true })

  legacyGuestsSidebarItem = (): Locator =>
    this.sidebarSettingsNav().getByRole('button', { name: 'Guests', exact: true })

  legacyGlobalSpaceAdminsSidebarItem = (): Locator =>
    this.sidebarSettingsNav().getByRole('button', { name: 'Global Space Admins', exact: true })

  // ─── Root + chrome ─────────────────────────────────────────────────
  wacRoot = (): Locator => this.page.locator('[data-test="wac-root"]')
  wacLoading = (): Locator => this.page.locator('[data-test="wac-loading"]')
  wacNoAccess = (): Locator => this.page.locator('[data-test="wac-no-access"]')
  readOnlyBanner = (): Locator => this.page.locator('[data-test="wac-readonly-banner"]')

  // ─── Tabs ──────────────────────────────────────────────────────────
  /**
   * Tab locator by id. The TabList component does not currently emit a
   * stable per-tab data-test attribute, so we fall back to a role+name
   * match scoped to the wac-tabs container.
   */
  tab = (id: WacTabId): Locator => {
    const labels: Record<WacTabId, string> = {
      people: 'People',
      resources: 'Resources',
      'my-access': 'My Access',
      audit: 'Audit',
      'guest-settings': 'Guest Settings'
    }
    return this.wacRoot().locator('.wac-tabs').getByText(labels[id], { exact: true })
  }

  async clickTab (id: WacTabId): Promise<void> {
    await this.tab(id).click()
  }

  // ─── Per-tab panel sanity checks ───────────────────────────────────
  guestSettingsPanel = (): Locator => this.page.locator('[data-test="wac-guest-settings"]')
  guestSettingsEditor = (): Locator => this.page.locator('[data-test="guest-settings-editor"]')

  // ─── Navigation helpers ────────────────────────────────────────────
  async openAccessCenterFromSidebar (): Promise<void> {
    await expect(this.accessCenterSidebarItem()).toBeVisible()
    await this.accessCenterSidebarItem().click()
    // The page may briefly show the loading state before the my-access
    // snapshot lands; wait for the root locator instead.
    await expect(this.wacRoot()).toBeVisible()
  }

  /**
   * Assert that the WAC tab strip shows exactly the given ids in
   * order. Useful for Owner/Maintainer/User differentiation.
   */
  async expectTabIds (ids: WacTabId[]): Promise<void> {
    for (const id of ids) {
      await expect(this.tab(id)).toBeVisible()
    }
    // Confirm any tab NOT in the list is hidden.
    const all: WacTabId[] = ['people', 'resources', 'my-access', 'audit', 'guest-settings']
    for (const id of all) {
      if (!ids.includes(id)) {
        await expect(this.tab(id)).toHaveCount(0)
      }
    }
  }

  /**
   * Assert the three legacy sidebar entries are NOT present (post-Phase-2
   * sidebar should only surface Access Center for workspace-level admin).
   */
  async expectLegacySidebarEntriesHidden (): Promise<void> {
    await expect(this.legacyMembersSidebarItem()).toHaveCount(0)
    await expect(this.legacyGuestsSidebarItem()).toHaveCount(0)
    await expect(this.legacyGlobalSpaceAdminsSidebarItem()).toHaveCount(0)
  }
}
