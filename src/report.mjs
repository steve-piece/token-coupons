// The join. Every other module measures one thing; this one reads them all
// once, lines the numbers up, and produces the single Report object that the
// text view, the HTML page, the JSON output and the skill all read.
//
// Order of work: discover the skills on disk, read the session transcripts,
// join calls onto skills, size the listing against its budget, work out the
// economics, rank a recommendation per skill, price the waste, then write the
// short summary block an agent reads before anything else.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { discoverSkills } from './discover.mjs'
import { scanTranscripts, sessionStats } from './calls.mjs'
import { listingBudget, listingCost } from './budget.mjs'
import { economics as computeEconomics } from './economics.mjs'
import { recommend } from './recommend.mjs'
import { loadPricing, costModel, yourModel, normalizeModelId } from './pricing.mjs'
import { tildify } from './paths.mjs'

export const REPORT_VERSION = 1

/** The tool version, read from package.json next to this module. */
export function toolVersion () {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/** YYYY-MM-DD for a Date, a date string, or now. */
export function dayOf (value = null) {
  const d = value instanceof Date ? value : (value ? new Date(value) : new Date())
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * Build the whole Report.
 *
 * @param since        YYYY-MM-DD, only sessions on or after this day are read
 * @param budgetOpts   { contextWindow, fraction, fixedChars, perEntryCap } for listingBudget
 * @param pricingPath  a price list to use instead of the bundled one
 * @param cached       true prices real caching, false prices the upper bound
 * @param thresholds   overrides for recommend.mjs DEFAULT_THRESHOLDS
 * @param today        fixes "today" so tests and staleness are reproducible
 */
export function buildReport ({ since = null, budgetOpts = {}, pricingPath = null, cached = true, thresholds = {}, today = null, cwd = process.cwd() } = {}) {
  const generatedOn = dayOf(today)
  const everything = discoverSkills({ cwd })
  const { calls, sessions } = scanTranscripts(since || null)
  const stats = sessionStats(sessions, { since: since || null, today: today || null })
  const budget = listingBudget(budgetOpts || {})

  // Calls attach to every row, listed or not, so a project skill used inside
  // its project still shows its history. Economics run over the LISTED rows
  // only: an unlisted skill costs nothing per message and cannot be dropped.
  const joined = joinCalls(everything, calls, budget)
  const rows = joined.rows.filter((r) => r.loaded)
  const notLoaded = joined.rows.filter((r) => !r.loaded).map(briefUnlisted).sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1))
  const unmatchedCalls = joined.unmatchedCalls

  const economics = computeEconomics(rows, budget)
  const ranked = recommend(rows, { economics, budget, thresholds: thresholds || {}, today: today || undefined })
  const pricing = loadPricing(pricingPath || null, { today: today || null })
  const cost = costModel({
    wastedTokens: economics.wastedPerCall.tokens,
    listingTokens: economics.perSession.totalListingTokens,
    stats,
    pricing,
    cached: cached !== false,
    today: today || null,
  })

  const totals = buildTotals(rows, sessions, calls, notLoaded)
  const summary = buildSummary({ rows: ranked.rows, economics, stats, pricing, cost, counts: ranked.counts, notLoaded })

  return {
    version: REPORT_VERSION,
    tool: { name: 'token-coupons', version: toolVersion() },
    generatedOn,
    since: since || null,
    budget,
    totals,
    economics,
    stats,
    cost,
    pricing: {
      path: tildify(pricing.path),
      verifiedOn: pricing.verifiedOn,
      stale: pricing.stale,
      ageDays: pricing.ageDays,
      error: pricing.error,
      models: pricing.models.length,
    },
    thresholds: ranked.thresholds,
    skills: ranked.rows,
    heaviest: ranked.heaviest,
    thin: ranked.thin,
    notLoaded,
    unmatchedCalls,
    summary,
  }
}

/** The compact row shape for skills that are on disk but not in the listing. */
function briefUnlisted (r) {
  return {
    name: (Array.isArray(r.names) && r.names[0]) || r.name,
    path: r.path,
    location: r.location,
    reason: r.loadedReason,
    plugin: r.plugin || null,
    installKey: r.installKey || null,
    mode: r.mode,
    descriptionChars: r.descriptionChars,
    calls: r.calls,
    activeCalls: r.activeCalls,
    passiveCalls: r.passiveCalls,
    lastSeen: r.lastSeen,
  }
}

/**
 * Attribute every recorded Skill call to a discovered skill. A call names a
 * skill exactly as the client resolved it (`plugin:name` or `name`); the
 * canonical name of a skill wins over an alias, and the first skill to claim
 * a name keeps it. Calls that match nothing are counted under unmatchedCalls
 * so a stale transcript never disappears silently.
 */
export function joinCalls (skills, calls, budget) {
  const canonical = new Map()
  const alias = new Map()
  for (const s of skills) {
    const names = Array.isArray(s.names) && s.names.length ? s.names : [s.name]
    if (names[0] && !canonical.has(names[0])) canonical.set(names[0], s)
    for (const n of names) if (n && !alias.has(n)) alias.set(n, s)
  }
  const tally = new Map()
  const unmatched = new Map()
  for (const c of calls) {
    const target = canonical.get(c.skill) || alias.get(c.skill) || (c.bare && (canonical.get(c.bare) || alias.get(c.bare))) || null
    if (!target) {
      unmatched.set(c.skill, (unmatched.get(c.skill) || 0) + 1)
      continue
    }
    let t = tally.get(target)
    if (!t) { t = { calls: 0, activeCalls: 0, passiveCalls: 0, firstSeen: null, lastSeen: null }; tally.set(target, t) }
    t.calls++
    if (c.mode === 'active') t.activeCalls++
    else t.passiveCalls++
    const day = c.ts ? String(c.ts).slice(0, 10) : null
    if (day) {
      if (!t.firstSeen || day < t.firstSeen) t.firstSeen = day
      if (!t.lastSeen || day > t.lastSeen) t.lastSeen = day
    }
  }
  const cap = budget && budget.perEntryCap
  const rows = skills.map((s) => {
    const t = tally.get(s) || { calls: 0, activeCalls: 0, passiveCalls: 0, firstSeen: null, lastSeen: null }
    const name = (Array.isArray(s.names) && s.names[0]) || s.name
    const cost = listingCost(Number(s.descriptionChars) || 0, name, cap)
    return Object.assign({}, s, {
      path: tildify(s.realPath),
      calls: t.calls,
      activeCalls: t.activeCalls,
      passiveCalls: t.passiveCalls,
      firstSeen: t.firstSeen,
      lastSeen: t.lastSeen,
      listingChars: cost.chars,
      listingTokens: cost.tokens,
      descriptionTokens: cost.descriptionTokens,
      capped: cost.capped,
    })
  })
  const unmatchedCalls = [...unmatched.entries()]
    .map(([skill, n]) => ({ skill, calls: n }))
    .sort((a, b) => b.calls - a.calls || (a.skill < b.skill ? -1 : 1))
  return { rows, unmatchedCalls }
}

function buildTotals (rows, sessions, calls, notLoaded = []) {
  const active = rows.filter((r) => r.mode === 'active')
  const passive = rows.filter((r) => r.mode !== 'active')
  const matched = rows.reduce((n, r) => n + r.calls, 0) + notLoaded.reduce((n, r) => n + r.calls, 0)
  const byReason = {}
  for (const r of notLoaded) byReason[r.reason] = (byReason[r.reason] || 0) + 1
  return {
    skills: rows.length,
    onDiskNotListed: notLoaded.length,
    notListedByReason: byReason,
    withSourceCopy: rows.filter((r) => r.sourcePath).length,
    declaredActive: active.length,
    declaredPassive: passive.length,
    gateDeclaredAnywhere: rows.filter((r) => r.gateDeclared).length,
    transcriptsRead: sessions.length,
    callsTotal: calls.length,
    callsMatched: matched,
    calledSkills: rows.filter((r) => r.calls > 0).length,
    neverCalled: rows.filter((r) => r.calls === 0).length,
    neverCalledActive: active.filter((r) => r.calls === 0).length,
    neverCalledPassive: passive.filter((r) => r.calls === 0).length,
  }
}

function buildSummary ({ rows, economics, stats, pricing, cost, counts, notLoaded = [] }) {
  const per = economics.perSession
  const yours = yourModel(stats, pricing)
  let wastedPerWeekOnYourModel = null
  if (yours) {
    const key = normalizeModelId(yours.id)
    const priced = (cost.perModel || []).find((m) => normalizeModelId(m.id) === key)
    if (priced && priced.wasted && typeof priced.wasted.perWeek === 'number') {
      wastedPerWeekOnYourModel = { model: priced.label || priced.id, dollars: round(priced.wasted.perWeek) }
    }
  }
  const actions = Object.assign({ active: 0, delete: 0, optimize: 0, review: 0, keep: 0, passive: 0 }, counts || {})
  return {
    skills: rows.length,
    notListed: notLoaded.length,
    listingTokensPerCall: nullable(per.totalListingTokens),
    overBudgetRatio: nullable(per.overBudgetRatio),
    neverCalledPassive: nullable(economics.neverCalledPassive.count),
    unroutable: nullable(economics.overflowUnroutable.count),
    summonedOnly: nullable(economics.summonedOnlyPassive.count),
    wastedTokensPerCall: nullable(economics.wastedPerCall.tokens),
    savedTokensPerCallIfApplied: nullable(economics.ifGated.savedTokensPerSession),
    fitsAfter: typeof economics.ifGated.fitsBudgetAfter === 'boolean' ? economics.ifGated.fitsBudgetAfter : null,
    wastedPerWeekOnYourModel,
    recommendedActions: actions,
  }
}

const SUMMARY_KEYS = [
  'skills', 'notListed', 'listingTokensPerCall', 'overBudgetRatio', 'neverCalledPassive', 'unroutable', 'summonedOnly',
  'wastedTokensPerCall', 'savedTokensPerCallIfApplied', 'fitsAfter', 'wastedPerWeekOnYourModel', 'recommendedActions',
]

/**
 * The summary block with every key present (null when unknown), so an agent
 * can read it without checking for missing fields. Works on a full Report or
 * on anything carrying a `summary`.
 */
export function pickSummary (report) {
  const s = (report && report.summary) || {}
  const out = {}
  for (const k of SUMMARY_KEYS) out[k] = s[k] === undefined ? null : s[k]
  out.recommendedActions = Object.assign({ active: 0, delete: 0, optimize: 0, review: 0, keep: 0, passive: 0 }, out.recommendedActions || {})
  return out
}

function nullable (v) { return (v === undefined || (typeof v === 'number' && Number.isNaN(v))) ? null : v }
function round (n, places = 4) { return +(Number(n) || 0).toFixed(places) }
