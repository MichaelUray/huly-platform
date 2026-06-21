//
// Phase 2.5 — the legacy "User the owner is showing inside the owner tab"
// and "User is able to set himself as an spaces admin" tests pinned the
// pre-Phase-2 `Members.svelte` ("owner link" in the legacy Members panel)
// and `Spaces.svelte` ("Admin Members" + per-role rows) UIs. Both
// surfaces have been folded into the Workspace Access Center (Phase 2
// commits `6570a78cbc` + `e188e6db17`, Phase 2.5 5th-tab port). The new
// equivalent test surface lives in `access-center.spec.ts`; this file
// keeps only the orthogonal Settings tests (general/picture, text
// templates, classes, enums).
//
// The old page-object `owner-pages.ts` is deleted; the still-valid
// helper methods (workspace logo / template / enum) moved into
// `workspace-misc-page.ts`.
//

import { SignUpData } from '../model/common-types'
import { LoginPage } from '../model/login-page'
import { SelectWorkspacePage } from '../model/select-workspace-page'
import { SignUpPage } from '../model/signup-page'
import { test } from '@playwright/test'
import { generateId, uploadFile } from '../utils'
import { UserProfilePage } from '../model/profile/user-profile-page'
import { ButtonType, WorkspaceSettingsPage } from '../model/workspace/workspace-settings-page'
import { WorkspaceMiscPage } from '../model/workspace/workspace-misc-page'
import { faker } from '@faker-js/faker'
import { ClassesPage } from '../model/workspace/classes-pages'

test.describe('Workspace tests', () => {
  let loginPage: LoginPage
  let signUpPage: SignUpPage
  let selectWorkspacePage: SelectWorkspacePage
  let userProfilePage: UserProfilePage
  let workspaceSettingsPage: WorkspaceSettingsPage
  let miscPage: WorkspaceMiscPage
  let newUser: SignUpData
  let classesPage: ClassesPage

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page)
    signUpPage = new SignUpPage(page)
    selectWorkspacePage = new SelectWorkspacePage(page)
    userProfilePage = new UserProfilePage(page)
    workspaceSettingsPage = new WorkspaceSettingsPage(page)
    miscPage = new WorkspaceMiscPage(page)
    classesPage = new ClassesPage(page)
  })

  test('User is able to change workspace picture', async ({ page }) => {
    newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      password: '1234'
    }
    const newWorkspaceName = `New Workspace Name - ${generateId(2)}`
    await loginPage.goto()
    await loginPage.clickSignUp()
    await signUpPage.signUp(newUser)
    await selectWorkspacePage.createWorkspace(newWorkspaceName)
    await userProfilePage.openProfileMenu()
    await userProfilePage.clickSettings()
    await workspaceSettingsPage.selectWorkspaceSettingsTab(ButtonType.General)
    await miscPage.clickOnWorkspaceLogo()
    await uploadFile(page, 'cat3.jpeg')
    await miscPage.saveUploadedLogo()
    await miscPage.checkIfPictureIsUploaded()
  })

  test('User is able to create template', async ({ page }) => {
    newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      password: '1234'
    }
    const newWorkspaceName = `New Workspace Name - ${generateId(2)}`
    const newTemplateName = faker.word.words(2)
    await loginPage.goto()
    await loginPage.clickSignUp()
    await signUpPage.signUp(newUser)
    await selectWorkspacePage.createWorkspace(newWorkspaceName)
    await userProfilePage.openProfileMenu()
    await userProfilePage.clickSettings()
    await workspaceSettingsPage.selectWorkspaceSettingsTab(ButtonType.TextTemplate)
    await miscPage.createTemplateWithName(newTemplateName)
  })

  test('User is able to see all the classes', async ({ page }) => {
    newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      password: '1234'
    }
    const newWorkspaceName = `New Workspace Name - ${generateId(2)}`
    await loginPage.goto()
    await loginPage.clickSignUp()
    await signUpPage.signUp(newUser)
    await selectWorkspacePage.createWorkspace(newWorkspaceName)
    await userProfilePage.openProfileMenu()
    await userProfilePage.clickSettings()
    await workspaceSettingsPage.selectWorkspaceSettingsTab(ButtonType.Classes)
    await classesPage.checkIfClassesExists()
  })

  test('User is able to create Enum', async ({ page }) => {
    newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      password: '1234'
    }
    const newWorkspaceName = `New Workspace Name - ${generateId(2)}`
    const enumTitle = faker.word.words(2)
    const enumName = faker.word.words(2)
    await loginPage.goto()
    await loginPage.clickSignUp()
    await signUpPage.signUp(newUser)
    await selectWorkspacePage.createWorkspace(newWorkspaceName)
    await userProfilePage.openProfileMenu()
    await userProfilePage.clickSettings()
    await workspaceSettingsPage.selectWorkspaceSettingsTab(ButtonType.Enums)
    await miscPage.createEnumWithName(enumTitle, enumName)
  })

  // Seems that there is currently a bug
  test.skip('User is able to create Enums', async ({ page }) => {
    newUser = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      password: '1234'
    }
    const newWorkspaceName = `New Workspace Name - ${generateId(2)}`
    const enumTitle = faker.word.words(2)
    const enumName = faker.word.words(2)
    await loginPage.goto()
    await loginPage.clickSignUp()
    await signUpPage.signUp(newUser)
    await selectWorkspacePage.createWorkspace(newWorkspaceName)
    await userProfilePage.openProfileMenu()
    await userProfilePage.clickSettings()
    await workspaceSettingsPage.selectWorkspaceSettingsTab(ButtonType.InviteSettings)
    await miscPage.createEnumWithName(enumTitle, enumName)
  })
})
