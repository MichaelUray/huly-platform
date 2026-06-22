//
// Copyright © 2026 Hardcore Engineering Inc.
//
// C5 guard test — source-grep across src/components/**/*.svelte for
// hardcoded hex colors (`#RGB`, `#RRGGBB`, `#RRGGBBAA`) inside <style>
// blocks. Hardcoded colors break dark/light mode swaps and prevent
// rebrand without Svelte source edits.
//
// SpaceTypeIcon.svelte is allowlisted: its hex values are per-app
// brand-category accents living in a JS data table — they identify
// which Huly app a space belongs to, not a UI state — and are applied
// via a CSS custom property rather than a style-block declaration.
//

import fs from 'fs'
import path from 'path'

const COMPONENTS_DIR = path.join(__dirname, '..', 'components')
const PROJECT_ROOT = path.join(__dirname, '..', '..')

// Files that are exempt in entirety from the hex-color scan. Keep this
// list short and document each entry.
const FILE_ALLOWLIST = new Set<string>([
  // Per-app brand accents (tracker/document/drive/…). See header.
  'src/components/resources/SpaceTypeIcon.svelte'
])

interface Hit { file: string; line: number; snippet: string }

function walk (dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.svelte')) out.push(full)
  }
  return out
}

function extractStyleBlocks (text: string): { content: string, lineOffset: number }[] {
  const blocks: { content: string, lineOffset: number }[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index)
    const lineOffset = before.split('\n').length
    blocks.push({ content: m[1], lineOffset })
  }
  return blocks
}

function scan (): Hit[] {
  const hits: Hit[] = []
  // Match #RGB, #RRGGBB, #RRGGBBAA — but NOT CSS-id selectors like
  // `#some-id` (those are followed by a word char, never hex-then-end).
  // Pragmatically: require the hex chars to be followed by something
  // that isn't an additional word character (so `#abc;` matches but
  // `#abcdef-foo` doesn't — that's a selector).
  const hexRe = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F_-])/
  // E7 — extend the guard to rgba()/rgb()/hsl()/hsla() literals.
  // Codex E6 noted these slipped past the hex-only guard. Theme tokens
  // (var(--theme-…)) are preferred. The regex is anchored on the
  // function-name itself so `transform: rotate(…)` etc. don't match.
  const colorFnRe = /\b(rgba?|hsla?)\s*\(/

  for (const file of walk(COMPONENTS_DIR)) {
    const rel = path.relative(PROJECT_ROOT, file)
    if (FILE_ALLOWLIST.has(rel)) continue

    const text = fs.readFileSync(file, 'utf-8')
    for (const block of extractStyleBlocks(text)) {
      block.content.split('\n').forEach((line: string, i: number) => {
        // skip SCSS comment lines
        const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
        if (hexRe.test(stripped) || colorFnRe.test(stripped)) {
          hits.push({
            file: rel,
            line: block.lineOffset + i,
            snippet: line.trim()
          })
        }
      })
    }
  }
  return hits
}

describe('no hardcoded colors in <style> blocks', () => {
  it('finds zero hardcoded hex colors in non-allowlisted .svelte files', () => {
    const hits = scan()
    if (hits.length > 0) {
      const msg = hits.map((h) => `  - ${h.file}:${h.line}  ${h.snippet}`).join('\n')
      throw new Error(
        `Found ${hits.length} hardcoded hex color(s) in <style> blocks:\n${msg}\n\n` +
          `Replace each with a Huly theme token (see packages/theme/styles/_colors.scss). ` +
          `If the color is a genuine brand accent that no token represents, add the file ` +
          `to FILE_ALLOWLIST in this test (with a comment explaining why).`
      )
    }
  })
})
