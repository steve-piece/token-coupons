// One action per skill, plus the sentence that explains it.
//
// The rules are deliberately conservative. Nothing here proposes deleting a
// skill the agent has ever chosen on its own, and the only delete case is a
// skill the person owns, has never used, and has not touched in months. The
// cheap win is almost always the same one: a skill that is never chosen by the
// agent does not need its description in the listing, only its name, so setting
// it to run when the person types its name keeps the skill and stops the rent.
//
// Priority order is fixed by the contract: the first rule that matches decides
// the action, while every flag that applies is recorded regardless.

import { nameLineChars, toTokens, listingCost, DEFAULT_PER_ENTRY_CAP } from './budget.mjs'
import { fmt } from './lib/util.mjs'

/** Overridable through the `thresholds` option. */
export const DEFAULT_THRESHOLDS = {
  thinChars: 60,
  heavyChars: 600,
  optimizeTargetChars: 350,
  staleDays: 90,
  // A skill installed days ago has had no chance to be chosen yet, so "never
  // used" says nothing about it. Below this age a zero-call skill is left alone.
  newSkillDays: 14,
  heaviestListSize: 15,
}

/** Delete is only ever offered for files the person owns and can move. */
const DELETABLE_LOCATIONS = new Set(['user', 'user-symlink', 'project'])

/** The order flags are reported in, so output is stable for tests and the page. */
const FLAG_ORDER = [
  'never-called', 'summoned-only', 'heavy-description', 'thin-description',
  'capped', 'unroutable', 'dormant-active', 'not-editable', 'stale', 'too-new',
]

/**
 * @param rows RankedRow inputs: a Skill joined with calls, activeCalls,
 *             passiveCalls, and (optionally) the listingCost fields. Missing
 *             listing fields are derived here so hand built rows work.
 * @param opts { economics, budget, thresholds, today }
 */
export function recommend (rows = [], opts = {}) {
  const thresholds = Object.assign({}, DEFAULT_THRESHOLDS, opts.thresholds || {})
  const budget = opts.budget || null
  const cap = (budget && Number(budget.perEntryCap)) || DEFAULT_PER_ENTRY_CAP
  const now = opts.today ? new Date(opts.today) : new Date()
  const economics = opts.economics || null
  const unroutable = new Set((economics && economics.overflowUnroutable && economics.overflowUnroutable.names) || [])

  const ranked = rows.map((row) => decide(row, { thresholds, cap, now, unroutable }))

  ranked.sort((a, b) => (
    b.recommendation.impactTokensPerCall - a.recommendation.impactTokensPerCall ||
    b.descriptionTokens - a.descriptionTokens ||
    compare(nameOf(a), nameOf(b))
  ))
  ranked.forEach((r, i) => { r.recommendation.rank = i + 1 })

  const counts = { keep: 0, active: 0, passive: 0, optimize: 0, delete: 0, review: 0 }
  for (const r of ranked) {
    const a = r.recommendation.action
    if (counts[a] === undefined) counts[a] = 0
    counts[a] += 1
  }

  const heaviest = ranked
    .filter((r) => r.mode !== 'active')
    .sort((a, b) => (Number(b.descriptionChars) || 0) - (Number(a.descriptionChars) || 0) || compare(nameOf(a), nameOf(b)))
    .slice(0, thresholds.heaviestListSize)

  const thin = ranked.filter((r) => r.recommendation.flags.includes('thin-description'))

  return { rows: ranked, heaviest, thin, thresholds, counts }
}

function decide (row, { thresholds, cap, now, unroutable }) {
  const out = Object.assign({}, row)
  const name = nameOf(out)
  const mode = out.mode === 'active' ? 'active' : 'passive'
  const descriptionChars = Number(out.descriptionChars) || 0
  const calls = Number(out.calls) || 0
  const passiveCalls = Number(out.passiveCalls) || 0

  // Derive the listing fields when the caller did not join them on already.
  const cost = listingCost(descriptionChars, name, cap)
  if (!Number.isFinite(out.listingChars)) out.listingChars = cost.chars
  if (!Number.isFinite(out.listingTokens)) out.listingTokens = cost.tokens
  if (!Number.isFinite(out.descriptionTokens)) out.descriptionTokens = cost.descriptionTokens
  if (typeof out.capped !== 'boolean') out.capped = cost.capped

  const listingTokens = out.listingTokens
  const nameChars = nameLineChars(name)
  const nameTokens = toTokens(nameChars)
  const ageDays = ageInDays(out.modifiedOn, now)
  // Age only says something worth acting on when the skill was never used, the
  // same way a short description only matters when nothing routes to it.
  const stale = calls === 0 && ageDays !== null && ageDays > thresholds.staleDays
  // Freshly installed and never used is not evidence of anything yet.
  const tooNew = calls === 0 && ageDays !== null && ageDays <= thresholds.newSkillDays
  const heavy = mode === 'passive' && descriptionChars > thresholds.heavyChars
  const thin = mode === 'passive' && calls === 0 && descriptionChars < thresholds.thinChars
  const capped = mode === 'passive' && out.capped === true
  const summonedOnly = mode === 'passive' && calls > 0 && passiveCalls === 0
  const isUnroutable = unroutable.has(name) || (Array.isArray(out.names) && out.names.some((n) => unroutable.has(n)))
  const notEditable = out.editable === false

  const flagSet = new Set()
  if (calls === 0) flagSet.add('never-called')
  if (summonedOnly) flagSet.add('summoned-only')
  if (heavy) flagSet.add('heavy-description')
  if (thin) flagSet.add('thin-description')
  if (capped) flagSet.add('capped')
  if (isUnroutable) flagSet.add('unroutable')
  if (mode === 'active' && calls === 0) flagSet.add('dormant-active')
  if (notEditable) flagSet.add('not-editable')
  if (stale) flagSet.add('stale')
  if (tooNew) flagSet.add('too-new')
  const flags = FLAG_ORDER.filter((f) => flagSet.has(f))

  let action = 'keep'
  let rule = 'keep'
  if (mode === 'active' && calls === 0) {
    action = 'review'; rule = 'dormant-active'
  } else if (mode === 'passive' && calls === 0 && descriptionChars < thresholds.thinChars) {
    action = 'optimize'; rule = 'thin'
  } else if (mode === 'passive' && tooNew) {
    action = 'keep'; rule = 'too-new'
  } else if (mode === 'passive' && calls === 0 && DELETABLE_LOCATIONS.has(out.location) && ageDays !== null && ageDays > thresholds.staleDays) {
    action = 'delete'; rule = 'stale'
  } else if (mode === 'passive' && calls === 0) {
    action = 'active'; rule = 'never-called'
  } else if (summonedOnly) {
    action = 'active'; rule = 'summoned-only'
  } else if (mode === 'passive' && passiveCalls > 0 && (heavy || out.capped === true)) {
    action = 'optimize'; rule = capped ? 'capped' : 'heavy'
  }

  let impactTokensPerCall = 0
  if (action === 'active' || action === 'delete') {
    impactTokensPerCall = listingTokens - nameTokens
  } else if (action === 'optimize') {
    impactTokensPerCall = Math.max(0, listingTokens - toTokens(thresholds.optimizeTargetChars + nameChars))
  }

  const reason = reasonFor(rule, {
    mode, calls, passiveCalls, descriptionChars, listingTokens, nameTokens,
    ageDays, cap, impactTokensPerCall, thresholds, flags, sourcePath: out.sourcePath || null,
  })

  out.recommendation = { action, reason, flags, impactTokensPerCall, rank: 0 }
  return out
}

/**
 * One short plain sentence, numbers first, under about 20 words. The flags
 * carry the rest (unroutable, not editable) and the renderers show them as
 * badges, so the reason never grows into a paragraph.
 */
function reasonFor (rule, c) {
  const uses = c.calls === 1 ? 'once' : fmt(c.calls) + ' times'
  const desc = fmt(c.descriptionChars) + ' chars'
  const cost = fmt(c.listingTokens) + ' tokens a message'
  const gain = 'saves ' + fmt(c.impactTokensPerCall) + ' tokens a message'
  const target = 'about ' + fmt(c.thresholds.optimizeTargetChars) + ' chars'
  let base

  if (rule === 'dormant-active') {
    base = 'Never used, and it already waits for you to type its name (' + fmt(c.nameTokens) + ' tokens a message). Keep or delete, your call'
  } else if (rule === 'thin') {
    base = 'Never used, and its description is only ' + desc + ': probably too short for the agent to know when it applies. Rewrite it first'
  } else if (rule === 'stale') {
    base = 'Never used, last edited ' + fmt(c.ageDays) + ' days ago, ' + desc + ' sent every message. Deleting (or making it wait for its name) ' + gain
  } else if (rule === 'never-called') {
    base = 'Never used in these sessions, yet its ' + desc + ' description costs ' + cost + '. Making it wait for its name ' + gain
  } else if (rule === 'summoned-only') {
    base = 'Used ' + uses + ', always by you typing its name, never picked by the agent. Its ' + desc + ' description buys nothing; gating it ' + gain
  } else if (rule === 'capped') {
    base = fmt(c.descriptionChars) + ' chars, past the ' + fmt(c.cap) + ' char cap, so the tail is thrown away unread. Cutting to ' + target + ' loses nothing and ' + gain
  } else if (rule === 'heavy') {
    base = 'The agent picks it on its own (' + fmt(c.passiveCalls) + ' of ' + uses + '), but ' + desc + ' costs ' + cost + '. Cutting to ' + target + ' ' + gain
  } else if (rule === 'too-new') {
    base = 'Installed ' + (c.ageDays === 0 ? 'today' : c.ageDays === 1 ? 'yesterday' : fmt(c.ageDays) + ' days ago') +
      ' and not used yet, which is expected. Its ' + desc + ' description costs ' + cost + '. Check back in a couple of weeks'
  } else if (c.mode === 'active') {
    base = 'Used ' + uses + ' and already waits for its name, so it costs ' + fmt(c.nameTokens) + ' tokens a message. Leave it'
  } else {
    base = 'The agent picks it on its own (' + fmt(c.passiveCalls) + ' of ' + uses + ') and it costs ' + cost + ', a fair price. Leave it'
  }

  if (c.flags.includes('not-editable')) {
    base += c.sourcePath
      ? '. Edit its source copy; the installed copy refreshes on the next plugin update'
      : '. This copy is the plugin cache; the change belongs in the plugin\'s source repo'
  }
  return base + '.'
}

/** Whole days between the file date and today, or null when there is no date. */
function ageInDays (modifiedOn, now) {
  if (!modifiedOn) return null
  const day = String(modifiedOn).slice(0, 10)
  const then = Date.parse(day + 'T00:00:00Z')
  if (Number.isNaN(then)) return null
  const today = Date.parse(toDay(now) + 'T00:00:00Z')
  if (Number.isNaN(today)) return null
  return Math.floor((today - then) / 86400000)
}

function toDay (d) {
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function nameOf (row) {
  return (Array.isArray(row.names) && row.names[0]) || row.name || ''
}

function compare (a, b) { return a < b ? -1 : a > b ? 1 : 0 }
