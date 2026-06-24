// Pins every locale bundle's key-set to en.json so future PRs cannot
// silently introduce drift (Q-WAC-LOCALE=A fallback policy).
//
// makeLocalesTest in @hcengineering/platform only compares en vs ru,
// which is too narrow to catch admin-shared strings missing in cs/ko/etc.
// This test enforces full coverage across all 13 bundles.

type Bundle = Record<string, Record<string, string>>

const LANGS = ['cs', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt-br', 'pt', 'ru', 'tr', 'zh'] as const

const loadBundle = async (lang: string): Promise<Bundle> => {
  const mod = (await import(`../../lang/${lang}.json`)) as Bundle & { default?: Bundle }
  return (mod.default ?? mod) as Bundle
}

describe('login-assets locale completeness', () => {
  let reference: Bundle

  beforeAll(async () => {
    reference = await loadBundle('en')
  })

  for (const lang of LANGS) {
    it(`${lang} contains every key present in en`, async () => {
      const bundle = await loadBundle(lang)
      const missing: string[] = []
      for (const [section, keys] of Object.entries(reference)) {
        const localSection = bundle[section] ?? {}
        for (const key of Object.keys(keys)) {
          if (!(key in localSection)) {
            missing.push(`${section}.${key}`)
          }
        }
      }
      expect(missing).toEqual([])
    })

    it(`${lang} every value is a non-empty string`, async () => {
      const bundle = await loadBundle(lang)
      const empty: string[] = []
      for (const [section, keys] of Object.entries(bundle)) {
        for (const [key, value] of Object.entries(keys)) {
          if (typeof value !== 'string' || value.length === 0) {
            empty.push(`${section}.${key}`)
          }
        }
      }
      expect(empty).toEqual([])
    })
  }
})
