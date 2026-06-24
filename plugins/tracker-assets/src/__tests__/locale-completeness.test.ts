//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0/
//

import fs from 'fs'
import path from 'path'

describe('tracker-assets locale completeness', () => {
  const langDir = path.resolve(__dirname, '../../lang')
  const en = JSON.parse(fs.readFileSync(path.join(langDir, 'en.json'), 'utf8'))
  const enKeys = new Set(Object.keys(en.string))

  for (const file of fs.readdirSync(langDir)) {
    if (file === 'en.json') continue
    if (!file.endsWith('.json')) continue
    it(`${file} has the same key-set under string as en.json`, () => {
      const lang = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'))
      const langKeys = new Set(Object.keys(lang.string))
      const missing = [...enKeys].filter((k) => !langKeys.has(k))
      const extra = [...langKeys].filter((k) => !enKeys.has(k))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })
  }
})
