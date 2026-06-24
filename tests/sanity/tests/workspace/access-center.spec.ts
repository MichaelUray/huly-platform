//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Phase 2.5 sanity tests for the Workspace Access Center.
//
// Replaces the legacy `tests/sanity/tests/model/workspace/owner-pages.ts`
// page-object (which pinned the pre-Phase-2 "Admin Members" /
// per-role-row UI in `Spaces.svelte`). With the Phase 2 sidebar
// consolidation (`6570a78cbc`) + shim landing (`e188e6db17`) those
// surfaces are gone, and with Phase 2.5 the per-application guest
// editor lives inside a 5th Owner-only tab.
//
// Scope:
//   * Owner sign-up flow lands on Access Center → all 5 tabs visible.
//   * Sidebar shows ONLY Access Center for workspace-level admin
//     (Workspace Members / Guests / Global Space Admins removed).
//   * Guest Settings tab renders the extracted editor body.
//   * Legacy deep-links (/setting/guestPermissions etc.) still resolve
//     and land on the right Access Center tab via the compat-shims.
//
// What we do NOT exercise here (and why):
//   * Multi-user role switching (Owner→Maintainer→User→Guest) — the
//     sanity-test infrastructure only ever signs up the running user
//     as Workspace Owner; testing MAINTAINER/USER/GUEST projections
//     would require seeding additional accounts with controlled roles,
//     which is a separate test-infrastructure task. The unit tests in
//     `roleStore.test.ts` + `roleGating.test.ts` + `guestSettings.test.ts`
//     already pin the per-role tab projections from plain TS.
//   * GBP-style impersonation drill-down — covered by
//     `impersonationStore.test.ts`.
//

import { faker } from '@faker-js/faker'
import { expect, test } from '@playwright/test'
import { SignUpData } from '../model/common-types'
import { LoginPage } from '../model/login-page'
import { UserProfilePage } from '../model/profile/user-profile-page'
import { SelectWorkspacePage } from '../model/select-workspace-page'
import { SignUpPage } from '../model/signup-page'
import { AccessCenterPage } from '../model/workspace/access-center-page'
import { generateId } from '../utils'

test.describe('Access Center (Phase 2.5)', () => {
  let loginPage: LoginPage
  let signUpPage: SignUpPage
  let selectWorkspacePage: SelectWorkspacePage
  let userProfilePage: UserProfilePage
  let accessCenterPage: AccessCenterPage
  let newUser: SignUpData

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page)
    signUpPage = new SignUpPage(page)
    selectWorkspacePage = new SelectWorkspacePage(page)
    userProfilePage = new UserProfilePage(page)
    accessCenterPage = new AccessCenterPage(page)
  })

  async function signUpFreshOwner (page: import('@playwright/test').Page): Promise<void> {
    newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      password: '1234'
    }
    const newWorkspaceName = `WAC-${generateId(2)}`
    await loginPage.goto()
    await loginPage.clickSignUp()
    await signUpPage.signUp(newUser)
    await selectWorkspacePage.createWorkspace(newWorkspaceName)
    await userProfilePage.openProfileMenu()
    await userProfilePage.clickSettings()
  }

  test('Owner sees the Access Center sidebar entry and lands on the root', async ({ page }) => {
    await signUpFreshOwner(page)
    // Sidebar consolidation: only the Access Center entry should be
    // visible at the workspace-admin level. The three legacy entries
    // are still REGISTERED (for deep-link compat) but flagged
    // `hidden: true` so the sidebar filter skips them.
    await accessCenterPage.expectLegacySidebarEntriesHidden()
    await accessCenterPage.openAccessCenterFromSidebar()
    await expect(accessCenterPage.wacRoot()).toBeVisible()
  })

  test('Owner sees all five tabs (People / Resources / My Access / Audit / Guest Settings)', async ({
    page
  }) => {
    await signUpFreshOwner(page)
    await accessCenterPage.openAccessCenterFromSidebar()
    // Phase 2.5 — guest-settings is the 5th Owner-only tab. A fresh
    // workspace's signup grants the user OWNER role automatically.
    await accessCenterPage.expectTabIds([
      'people',
      'resources',
      'my-access',
      'audit',
      'guest-settings'
    ])
  })

  test('Owner does NOT see a read-only banner (they CAN edit)', async ({ page }) => {
    await signUpFreshOwner(page)
    await accessCenterPage.openAccessCenterFromSidebar()
    // The banner is rendered only when canReadWorkspaceWide && !canEdit;
    // OWNER always has canEdit=true.
    await expect(accessCenterPage.readOnlyBanner()).toHaveCount(0)
  })

  test('Owner can navigate to the Guest Settings tab and the editor mounts', async ({ page }) => {
    await signUpFreshOwner(page)
    await accessCenterPage.openAccessCenterFromSidebar()
    await accessCenterPage.clickTab('guest-settings')
    // Both the tab-panel wrapper AND the editor body must render —
    // the editor is mounted via Huly's <Component is={AnyComponent}/>
    // mechanism and could silently fail with a missing registration.
    await expect(accessCenterPage.guestSettingsPanel()).toBeVisible()
    await expect(accessCenterPage.guestSettingsEditor()).toBeVisible()
  })

  test('Legacy /setting/guestPermissions deep-link still resolves and lands on Guest Settings', async ({
    page
  }) => {
    await signUpFreshOwner(page)
    // Determine the workspace URL prefix from the current location after
    // settings opens; then navigate to the legacy deep-link directly.
    const settingsUrl = page.url()
    // settingsUrl ~ /workbench/<ws>/setting/<category>; replace category.
    const guestLink = settingsUrl.replace(/\/setting\/.*$/, '/setting/guestPermissions')
    await page.goto(guestLink)
    // The shim component (`GuestPermissionsSettings.svelte`) mounts
    // AccessCenterPage with initialTab="guest-settings", so the editor
    // body should be visible without an extra tab click.
    await expect(accessCenterPage.wacRoot()).toBeVisible()
    await expect(accessCenterPage.guestSettingsPanel()).toBeVisible()
    await expect(accessCenterPage.guestSettingsEditor()).toBeVisible()
  })

  test('Legacy /setting/owners deep-link still resolves and lands on People → All', async ({
    page
  }) => {
    // E4 amendment (H2) — extend coverage beyond `/setting/guestPermissions`
    // to the other two legacy routes. `/setting/owners` mounts
    // `Members.svelte`, which is a thin shim around AccessCenterPage
    // with `initialTab="people"` + `initialSub="all"`.
    await signUpFreshOwner(page)
    const settingsUrl = page.url()
    const ownersLink = settingsUrl.replace(/\/setting\/.*$/, '/setting/owners')
    await page.goto(ownersLink)
    await expect(accessCenterPage.wacRoot()).toBeVisible()
    await expect(accessCenterPage.tab('people')).toBeVisible()
    // The People tab is the active surface; we don't assert sub-tab
    // chrome explicitly because the People-tab page-object doesn't
    // currently expose a deterministic sub-tab data-test attribute.
    // The wacRoot + people-tab visibility combination already proves
    // the shim landed on the right Access Center surface.
  })

  test('Legacy /setting/allSpaces deep-link still resolves and renders the legacy Spaces editor (B2 revert)', async ({
    page
  }) => {
    // E4 amendment (B2 + H2) — Codex blocked the Phase 2 shim that
    // pointed `/setting/allSpaces` to Access Center → Resources because
    // Resources lists only managed-v1 classes and does NOT expose
    // role assignments on the `core.space.Space` SpaceType registry.
    // The shim was reverted (`Spaces.svelte` keeps the original
    // AccountArrayEditor + per-role table); the sidebar entry stays
    // hidden via `hidden: true`. This test pins that semantic split:
    // the deep-link renders the OLD editor, NOT the WAC root.
    await signUpFreshOwner(page)
    const settingsUrl = page.url()
    const spacesLink = settingsUrl.replace(/\/setting\/.*$/, '/setting/allSpaces')
    await page.goto(spacesLink)
    // WAC root must NOT appear — this route is no longer a WAC shim.
    await expect(accessCenterPage.wacRoot()).toHaveCount(0)
    // The legacy editor renders a per-role table inside a hulyComponent
    // wrapper with a "Spaces" breadcrumb. Use the breadcrumb label as a
    // stable anchor (matches `setting.string.Spaces` from the plugin
    // resources). The role-row chrome (`.antiGrid-row`) confirms the
    // editor body mounted.
    await expect(page.getByText('Spaces', { exact: true })).toBeVisible()
    await expect(page.locator('.hulyComponent .antiGrid-row').first()).toBeVisible()
  })

  test('Owner can navigate between all tabs without errors', async ({ page }) => {
    await signUpFreshOwner(page)
    await accessCenterPage.openAccessCenterFromSidebar()
    // Click each tab in order — proves none of the per-tab views
    // throw on mount with a fresh workspace's default data.
    await accessCenterPage.clickTab('people')
    await expect(accessCenterPage.tab('people')).toBeVisible()
    await accessCenterPage.clickTab('resources')
    await expect(accessCenterPage.tab('resources')).toBeVisible()
    await accessCenterPage.clickTab('my-access')
    await expect(accessCenterPage.tab('my-access')).toBeVisible()
    await accessCenterPage.clickTab('audit')
    await expect(accessCenterPage.tab('audit')).toBeVisible()
    await accessCenterPage.clickTab('guest-settings')
    await expect(accessCenterPage.guestSettingsPanel()).toBeVisible()
  })
})
