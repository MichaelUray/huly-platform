//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Phase 2.5 — slim page-object for Settings → General / Templates /
// Enums helpers that previously lived in `owner-pages.ts`. The legacy
// page-object also targeted the pre-Phase-2 `Members.svelte` ("owner
// link") and `Spaces.svelte` ("Admin Members") UIs; those surfaces have
// been consolidated into the Access Center (see `access-center.spec.ts`)
// so the legacy locators no longer apply and this file does NOT carry
// them forward.
//

import { expect, type Locator, type Page } from '@playwright/test'

export class WorkspaceMiscPage {
  readonly page: Page

  constructor (page: Page) {
    this.page = page
  }

  workspaceLogo = (): Locator => this.page.locator('.hulyComponent .hulyAvatar-container')
  publicTemplate = (): Locator => this.page.getByText('Public templates')
  createTemplate = (): Locator => this.page.getByRole('button', { name: 'CREATE TEMPLATE' })
  saveTemplate = (): Locator => this.page.getByRole('button', { name: 'Save template' })
  newTemplateName = (): Locator => this.page.getByPlaceholder('New template')
  templateName = (name: string): Locator => this.page.locator('span').filter({ hasText: name })
  createEnum = (): Locator => this.page.getByRole('button', { name: 'Create enum' })
  addEnum = (): Locator => this.page.locator('.buttons-group > button:nth-child(2)')
  enterEnumTitle = (): Locator => this.page.getByPlaceholder('Enum title')
  enterEnumName = (): Locator => this.page.getByPlaceholder('Enter option title')
  saveButton = (): Locator => this.page.getByRole('button', { name: 'Save' })
  createdEnum = (name: string): Locator => this.page.getByRole('button', { name: `${name} 1 option` })
  enumOption = (name: string): Locator => this.page.getByRole('button', { name })
  avatarLarge = (): Locator => this.page.locator('.hulyAvatarSize-medium.ava-image')

  async clickOnWorkspaceLogo (): Promise<void> {
    await this.workspaceLogo().click()
  }

  async saveUploadedLogo (): Promise<void> {
    await this.saveButton().nth(1).click()
    await this.saveButton().nth(0).click()
  }

  async checkIfPictureIsUploaded (): Promise<void> {
    await expect(this.avatarLarge()).toBeVisible()
    await expect(this.avatarLarge()).toHaveAttribute('src')
  }

  async createTemplateWithName (templateName: string): Promise<void> {
    await expect(this.publicTemplate()).toBeVisible()
    await this.createTemplate().click()
    await this.newTemplateName().fill(templateName)
    await this.saveTemplate().click()
    await expect(this.templateName(templateName)).toBeVisible()
  }

  async createEnumWithName (enumTitle: string, enumName: string): Promise<void> {
    await this.createEnum().click()
    await this.enterEnumTitle().fill(enumTitle)
    await this.addEnum().click()
    await this.enterEnumName().fill(enumName)
    await this.page.keyboard.press('Enter')
    await this.saveButton().click()
    await expect(this.createdEnum(enumTitle)).toBeVisible()
    await this.createdEnum(enumTitle).click()
    await expect(this.enumOption(enumName)).toBeVisible()
  }
}
