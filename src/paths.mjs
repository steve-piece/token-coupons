// Every filesystem root the tool reads, in one place, so tests can point the
// whole thing at a fixture by setting TOKEN_COUPONS_HOME.

import { homedir } from 'node:os'
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

/** Replace the home prefix with ~ for display. */
export function tildify (p) {
  const h = homeDir()
  return String(p || '').startsWith(h) ? '~' + String(p).slice(h.length) : String(p || '')
}
