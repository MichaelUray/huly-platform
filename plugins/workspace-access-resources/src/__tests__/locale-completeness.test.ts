//
// Copyright © 2026 Hardcore Engineering Inc.
//
// C5 guard test — every lang/*.json must declare the same set of keys
// as the canonical en.json. Per Q-WAC-LOCALE=A all 13 locales ship now,
// and translation work happens on top of the English fallback that we
// seeded into each file.
//
// Drift in any direction (key added to en but not propagated; key
// removed from en but still in a translation) breaks builds — keeping
// the translator surface honest.
//

import fs from 'fs'
import path from 'path'

const LANG_DIR = path.join(__dirname, '..', '..', 'lang')
const EXPECTED_LOCALES = [
  'cs', 'de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'pt-br', 'ru', 'tr', 'zh'
] as const

interface Bundle { string: Record<string, string> }

function loadBundle (locale: string): Bundle {
  const raw = fs.readFileSync(path.join(LANG_DIR, `${locale}.json`), 'utf-8')
  return JSON.parse(raw) as Bundle
}

describe('locale completeness', () => {
  it('ships exactly the expected 13 locale files', () => {
    const onDisk = fs.readdirSync(LANG_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => f.replace(/\.json$/, ''))
      .sort()
    expect(onDisk).toEqual([...EXPECTED_LOCALES].sort())
  })

  const enKeys = Object.keys(loadBundle('en').string).sort()

  it('en.json has at least 31 keys (C5 sweep target)', () => {
    // Sanity check so a regression that strips half the bundle is loud.
    expect(enKeys.length).toBeGreaterThanOrEqual(31)
  })

  for (const locale of EXPECTED_LOCALES) {
    if (locale === 'en') continue
    it(`${locale}.json has the same key-set as en.json`, () => {
      const localeKeys = Object.keys(loadBundle(locale).string).sort()
      const missing = enKeys.filter((k) => !localeKeys.includes(k))
      const extra = localeKeys.filter((k) => !enKeys.includes(k))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })
  }

  for (const locale of EXPECTED_LOCALES) {
    it(`${locale}.json values are all non-empty strings`, () => {
      const bundle = loadBundle(locale)
      for (const [key, value] of Object.entries(bundle.string)) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
        if (typeof value !== 'string' || value.length === 0) {
          throw new Error(`${locale}.json: empty value for key "${key}"`)
        }
      }
    })
  }
})
