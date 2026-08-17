// Run history: what the last report was told, and what it found.
//
// A report is only as steady as its inputs, and two of them change without
// anyone noticing. The folder the command ran in decides whose project skills
// count as listed, and the session window decides how much history is read. Run
// the same tool from a different folder on a different day and one machine can
// produce two answers that look nothing alike, with nothing anywhere saying
// why. That is the whole reason this module exists.
//
// So every run leaves a small record: the flags it was given, the folder it ran
// in, the summary it produced, and one line per skill. The next run reads the
// most recent record, reuses any flag nobody typed again, and says out loud
// what moved.
//
// History lives in ~/.token-coupons/runs, deliberately outside the skill
// folder. A plugin update replaces the plugin cache and `skills update`
// re-copies an installed skill, so history kept in there would be wiped by the
// very event it exists to survive.

import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { readJson, listDir, timeStamp, fmt } from './lib/util.mjs'
import { VERSION } from './version.mjs'
import { runsDir as defaultRunsDir } from './paths.mjs'

/** The record format. Bumped only when an older file can no longer be read. */
export const RUN_VERSION = 1

/** How many run files are kept before the oldest are removed. */
export const DEFAULT_KEEP = 30

/**
 * Flags worth remembering: the ones that change what the report measures. A
 * flag that only changes what is written out (--html, --card, --out, --open)
 * is not here, because reusing it would write files nobody asked for.
 */
export const REMEMBERED_FLAGS = ['since', 'window', 'fraction', 'budget', 'pricing', 'cache-ttl', 'cwd', 'uncached']

/** A headline number has to move by this much before it is worth a word. */
export const DEFAULT_DRIFT = 0.2

/* ------------------------------------------------------------------ */
/* the record                                                          */
/* ------------------------------------------------------------------ */

/**
 * The small record a run leaves behind. Not the report: one line per skill is
 * enough to explain a number that moved, and the whole report is megabytes.
 *
 * @param report from buildReport
 * @param flags  only what was actually typed on this run
 * @param cwd    the folder the run counted project skills from
 */
export function runRecord (report, { flags = {}, cwd = '', ranAt = null } = {}) {
  const r = report || {}
  return {
    version: RUN_VERSION,
    ranAt: ranAt || new Date().toISOString(),
    tool: VERSION,
    generatedOn: r.generatedOn || null,
    cwd: String(cwd || ''),
    flags: pickFlags(flags),
    summary: Object.assign({}, r.summary || {}),
    counts: Object.assign({}, (r.totals && r.totals.recommendedActions) || {}),
    skills: (r.skills || []).map((s) => ({
      name: (Array.isArray(s.names) && s.names[0]) || s.name,
      mode: s.mode,
      chars: Number(s.descriptionChars) || 0,
      calls: Number(s.calls) || 0,
    })),
  }
}

/** Only the remembered flags, only when they carry a value. */
export function pickFlags (flags) {
  const out = {}
  for (const key of REMEMBERED_FLAGS) {
    const v = (flags || {})[key]
    if (v === undefined || v === null || v === '' || v === false) continue
    out[key] = v
  }
  return out
}

/* ------------------------------------------------------------------ */
/* reading and writing                                                 */
/* ------------------------------------------------------------------ */

/** Every run file in `dir`, newest first. Names sort in time order. */
export function listRuns (dir = null) {
  const root = dir || defaultRunsDir()
  return listDir(root).filter((n) => /^\d{8}-\d{6}(-\d+)?\.json$/.test(n)).sort().reverse()
}

/**
 * The most recent record, or null when there is no readable history. A file
 * this version cannot read is skipped rather than fatal: history is a
 * convenience, and losing it must never stop a report.
 */
export function loadLastRun (dir = null) {
  const root = dir || defaultRunsDir()
  for (const name of listRuns(root)) {
    const res = readJson(join(root, name))
    if (!res.ok || !res.value || typeof res.value !== 'object') continue
    if (Number(res.value.version) !== RUN_VERSION) continue
    return Object.assign({ path: join(root, name) }, res.value)
  }
  return null
}

/** Write one record and remove the oldest files past `keep`. Returns the path. */
export function saveRun (record, { dir = null, keep = DEFAULT_KEEP, now = null } = {}) {
  const root = dir || defaultRunsDir()
  mkdirSync(root, { recursive: true })
  const stamp = timeStamp(now || new Date())
  let path = join(root, stamp + '.json')
  let n = 2
  while (listDir(root).includes(stamp + (n > 2 ? '-' + (n - 1) : '') + '.json') && n < 100) {
    path = join(root, stamp + '-' + n + '.json')
    n++
  }
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n')
  pruneRuns(root, keep)
  return path
}

/** Keep the newest `keep` files, remove the rest. Never throws. */
export function pruneRuns (dir, keep = DEFAULT_KEEP) {
  const names = listRuns(dir)
  for (const name of names.slice(Math.max(0, keep))) {
    try { unlinkSync(join(dir, name)) } catch { /* the folder is a convenience, not a database */ }
  }
}

/* ------------------------------------------------------------------ */
/* reuse and drift                                                     */
/* ------------------------------------------------------------------ */

/**
 * The flags this run should use: what was typed wins, and anything the last
 * run was told but nobody typed again is carried forward. That is the whole
 * stabiliser. Asking for `--since=2026-06-01` once should not mean every later
 * report silently reads a different stretch of history.
 *
 * @returns { flags, reused: ['since', ...] }
 */
export function mergeFlags (typed, previous) {
  const mine = pickFlags(typed)
  const theirs = pickFlags(previous && previous.flags)
  const flags = Object.assign({}, mine)
  const reused = []
  for (const key of REMEMBERED_FLAGS) {
    if (flags[key] !== undefined) continue
    if (theirs[key] === undefined) continue
    flags[key] = theirs[key]
    reused.push(key)
  }
  return { flags, reused }
}

/**
 * What changed since the last run, in plain sentences, worst first. Empty when
 * two runs agree, which is the answer people should get most of the time.
 */
export function compareRuns (previous, current, { drift = DEFAULT_DRIFT } = {}) {
  if (!previous || !current) return []
  const notes = []
  const before = previous.summary || {}
  const after = current.summary || {}

  // 1. The folder, first, because it silently changes which skills are counted.
  if (previous.cwd && current.cwd && previous.cwd !== current.cwd) {
    notes.push('Run from a different folder this time (' + previous.cwd + ' before), so a different project\'s own skills count as listed.')
  }

  // 2. What is installed. This explains most of what follows it.
  const was = new Set((previous.skills || []).map((s) => s.name))
  const now = new Set((current.skills || []).map((s) => s.name))
  const added = [...now].filter((n) => !was.has(n))
  const gone = [...was].filter((n) => !now.has(n))
  if (added.length || gone.length) {
    const parts = []
    if (added.length) parts.push(added.length + ' skill' + (added.length === 1 ? '' : 's') + ' added')
    if (gone.length) parts.push(gone.length + ' gone')
    notes.push(parts.join(', ') + ' since the last run' + nameHint([...added, ...gone]) + '.')
  }

  // 3. The headline numbers, only when they moved enough to notice.
  for (const [key, label] of [
    ['listingTokensPerCall', 'The listing'],
    ['wastedTokensPerCall', 'The wasted part'],
  ]) {
    const note = moved(before[key], after[key], drift)
    if (note) notes.push(label + ' went from ' + fmt(before[key]) + ' to ' + fmt(after[key]) + ' tokens a message, ' + note + '.')
  }

  const dollars = moved(before.wastedPerWeekOnYourModel, after.wastedPerWeekOnYourModel, drift)
  if (dollars) {
    notes.push('Dollars per week moved ' + dollars + '. Prices, the model your sessions ran on, or how much you chat can each do that.')
  }

  return notes
}

/**
 * "up 38 percent" when a number moved past the threshold, else null.
 *
 * A number that is missing on either side is silence, not a change. The dollar
 * figures are null whenever no price could be found for the model in use, and
 * Number(null) is 0, so without this a run with prices followed by one without
 * would announce that the cost fell to nothing.
 */
function moved (before, after, drift) {
  if (before === null || before === undefined || before === '') return null
  if (after === null || after === undefined || after === '') return null
  const a = Number(before)
  const b = Number(after)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null
  const change = (b - a) / a
  if (Math.abs(change) < drift) return null
  return (change > 0 ? 'up ' : 'down ') + Math.round(Math.abs(change) * 100) + ' percent'
}

/** Up to three names in brackets, so a note stays one line. */
function nameHint (names) {
  const shown = names.slice(0, 3)
  if (!shown.length) return ''
  return ' (' + shown.join(', ') + (names.length > shown.length ? ', and ' + (names.length - shown.length) + ' more' : '') + ')'
}
