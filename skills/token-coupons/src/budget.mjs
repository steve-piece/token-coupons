// The skill listing budget. These are CLIENT settings, not model limits, and
// they are documented for Claude Code: the listing gets
// skillListingBudgetFraction of the context window (default 1 percent) or a
// fixed SLASH_COMMAND_TOOL_CHAR_BUDGET, and each entry is capped at
// skillListingMaxDescChars (1536) of description. On overflow the client keeps
// every NAME and drops DESCRIPTIONS least-invoked first, so an overflowed skill
// is still listed but can never be routed to. No error says so.

import { readFileSync } from 'node:fs'
import { settingsFiles } from './paths.mjs'

/** The same rough ratio the client's own cost display uses. */
export const CHARS_PER_TOKEN = 4

export const DEFAULT_FRACTION = 0.01
export const DEFAULT_PER_ENTRY_CAP = 1536

/**
 * Read the context window from the user's Claude Code settings instead of
 * guessing. A model id carrying [1m] runs a 1,000,000 token window; anything
 * else is treated as 200,000. Getting this wrong by 5x turns a real 2.5x
 * overrun into an alarming 12.6x one.
 */
export function detectContextWindow () {
  for (const file of settingsFiles()) {
    try {
      const s = JSON.parse(readFileSync(file, 'utf8'))
      const model = String(s.model || '')
      const short = file.split('/').slice(-2).join('/')
      if (/\[1m\]/i.test(model)) return { window: 1000000, source: short + ' model=' + model }
      if (model) return { window: 200000, source: short + ' model=' + model }
    } catch { /* absent or unparseable, keep looking */ }
  }
  return { window: 200000, source: 'default, no model in settings' }
}

export function listingBudget ({ contextWindow = null, fraction = DEFAULT_FRACTION, fixedChars = null, perEntryCap = DEFAULT_PER_ENTRY_CAP } = {}) {
  const detected = contextWindow ? { window: contextWindow, source: '--window flag' } : detectContextWindow()
  const win = detected.window
  const tokens = fixedChars ? Math.round(fixedChars / CHARS_PER_TOKEN) : Math.round(win * fraction)
  return {
    chars: fixedChars || tokens * CHARS_PER_TOKEN,
    tokens,
    perEntryCap,
    contextWindow: win,
    windowSource: detected.source,
    fraction,
    source: fixedChars ? 'SLASH_COMMAND_TOOL_CHAR_BUDGET' : 'skillListingBudgetFraction',
  }
}

/** Chars the name line alone costs when a description is shed or the skill is active. */
export function nameLineChars (name) { return String(name).length + 4 }

/**
 * What one skill costs in the listing: description (capped) plus the name line.
 * `capped` is true when the description exceeds the per entry cap, which is
 * the strongest possible signal that it needs a rewrite.
 */
export function listingCost (descriptionChars, name, cap = DEFAULT_PER_ENTRY_CAP) {
  const desc = Math.min(descriptionChars, cap)
  const overhead = nameLineChars(name)
  return {
    chars: desc + overhead,
    tokens: Math.ceil((desc + overhead) / CHARS_PER_TOKEN),
    descriptionTokens: Math.ceil(desc / CHARS_PER_TOKEN),
    capped: descriptionChars > cap,
  }
}

export function toTokens (chars) { return Math.ceil((Number(chars) || 0) / CHARS_PER_TOKEN) }
