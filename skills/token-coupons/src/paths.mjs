// Every filesystem root the tool reads, in one place, so tests can point the
// whole thing at a fixture by setting TOKEN_COUPONS_HOME.

import { homedir } from 'node:os'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'

export function homeDir () {
  return process.env.TOKEN_COUPONS_HOME || homedir()
}

export function claudeDir () { return join(homeDir(), '.claude') }
export function projectsDir () { return join(claudeDir(), 'projects') }
export function pluginsDir () { return join(claudeDir(), 'plugins') }
export function settingsFiles () {
  return [join(claudeDir(), 'settings.json'), join(claudeDir(), 'settings.local.json')]
}

/** Where `apply` moves deleted skills so nothing is ever unrecoverable. */
export function trashDir () {
  return process.env.TOKEN_COUPONS_TRASH || join(homeDir(), '.token-coupons', 'trash')
}

/**
 * Where each run leaves its record, so the next one can reuse the same settings
 * and say what moved.
 *
 * Not inside the skill folder, on purpose. A plugin update replaces the plugin
 * cache and `skills update` re-copies an installed skill, so history kept there
 * would be wiped by the very event it exists to survive. One folder in the home
 * directory also means one place to look, whichever way the skill was installed.
 */
export function runsDir () {
  return process.env.TOKEN_COUPONS_RUNS || join(homeDir(), '.token-coupons', 'runs')
}

/**
 * Replace the home prefix with ~ for display. Real paths are matched too, so
 * a home that sits behind a symlink (macOS /var to /private/var, for one)
 * still collapses to ~.
 */
export function tildify (p) {
  const s = String(p || '')
  const h = homeDir()
  let real = h
  try { real = realpathSync(h) } catch { /* home may not exist yet */ }
  for (const prefix of [h, real]) {
    if (prefix && (s === prefix || s.startsWith(prefix + '/'))) return '~' + s.slice(prefix.length)
  }
  return s
}
