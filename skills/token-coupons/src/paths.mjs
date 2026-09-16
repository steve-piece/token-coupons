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

/**
 * The other tools that read skills. Each keeps its skills, its config and its
 * chat history under one dot folder, so every root here hangs off homeDir()
 * and a fixture can stand in for the whole machine. CODEX_HOME is honoured
 * the way Codex documents it, but only on the real home: inside a fixture it
 * would point the scan back out of it.
 */
export function agentsDir () { return join(homeDir(), '.agents') }
export function codexDir () {
  const env = process.env.CODEX_HOME
  return (env && !process.env.TOKEN_COUPONS_HOME) ? env : join(homeDir(), '.codex')
}
export function cursorDir () { return join(homeDir(), '.cursor') }
export function geminiDir () { return join(homeDir(), '.gemini') }

/** Codex's machine wide skills folder. Inside a fixture it sits under the fixture. */
export function etcCodexSkillsDir () {
  return process.env.TOKEN_COUPONS_HOME ? join(homeDir(), 'etc', 'codex', 'skills') : '/etc/codex/skills'
}

/**
 * Where the Cursor app keeps its chats: one SQLite file, at a different place
 * on each platform. A fixture puts one at cursor-app/state.vscdb in its home.
 */
export function cursorAppDbCandidates () {
  const h = homeDir()
  if (process.env.TOKEN_COUPONS_HOME) return [join(h, 'cursor-app', 'state.vscdb')]
  const appData = process.env.APPDATA || join(h, 'AppData', 'Roaming')
  return [
    join(h, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
    join(h, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
    join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  ]
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
