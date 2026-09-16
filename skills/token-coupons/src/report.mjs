// The join. Every other module measures one thing; this one reads them all
// once, lines the numbers up, and produces the single Report object that the
// text view, the HTML page, the JSON output and the skill all read.
//
// Order of work: discover the skills on disk, read the session transcripts,
// join calls onto skills, size the listing against its budget, work out the
// economics, rank a recommendation per skill, price the waste, then write the
// short summary block an agent reads before anything else.

import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'

import { VERSION } from './version.mjs'
import { runRecord, compareRuns } from './runs.mjs'
import { discoverSkills } from './discover.mjs'
import { scanAllClients, sessionStats } from './calls.mjs'
import { CLIENTS, clientLabel, entryChars, listingBudgetFor } from './clients.mjs'
import { listingBudget, listingCost } from './budget.mjs'
import { economics as computeEconomics } from './economics.mjs'
import { recommend } from './recommend.mjs'
import { loadPricing, costModel, yourModel, normalizeModelId } from './pricing.mjs'
import { tildify } from './paths.mjs'

export const REPORT_VERSION = 1

/** The tool version. */
export function toolVersion () { return VERSION }

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
export function buildReport ({ since = null, budgetOpts = {}, pricingPath = null, cached = true, thresholds = {}, today = null, cwd = process.cwd(), cacheTtlMinutes = undefined, previous = null, runFlags = {}, ranAt = null } = {}) {
  const generatedOn = dayOf(today)
  const everything = discoverSkills({ cwd })
  const scans = scanAllClients(since || null, { cacheTtlMinutes })
  // Claude Code's chats alone feed the cost multipliers: the listing being
  // priced is the one Claude Code sends, on the model Claude Code ran.
  const { calls, sessions } = scans.byClient.claude
  const stats = sessionStats(sessions, { since: since || null, today: today || null, cacheTtlMinutes })
  const budget = listingBudget(budgetOpts || {})

  // Calls from every client attach to every row, listed or not, so a project
  // skill used inside its project still shows its history and a skill Codex
  // reads is not "never used". Economics run over the rows Claude Code LISTS:
  // an unlisted skill costs nothing per message here and cannot be dropped.
  const joined = joinCalls(everything, scans.calls, budget)
  markUnmeasured(joined.rows, scans.byClient)
  const rows = joined.rows.filter((r) => r.loaded)
  const notLoaded = joined.rows.filter((r) => !r.loaded).map(briefUnlisted).sort((a, b) => b.callsAllClients - a.callsAllClients || (a.name < b.name ? -1 : 1))
  const unmatchedCalls = joined.unmatchedCalls
  const clients = clientSummaries(joined.rows, scans.byClient)

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

  // One rate, derived from the model the transcripts actually ran on, so a row
  // and the headline figure can never disagree about what a token costs.
  const rate = dollarsPerTokenPerMonth(cost, economics)
  if (rate !== null) {
    for (const row of ranked.rows) row.dollarsPerMonth = round(row.listingTokens * rate, 4)
    cost.dollarsPerTokenPerMonth = rate
  }

  const totals = buildTotals(rows, sessions, calls, notLoaded, clients)
  const summary = buildSummary({ rows: ranked.rows, economics, stats, pricing, cost, counts: ranked.counts, notLoaded })
  // Claude Code's own entry carries the priced figures, so the two can never disagree.
  const mine = clients.find((c) => c.id === 'claude')
  if (mine) {
    mine.listingTokens = economics.perSession.totalListingTokens
    mine.listingChars = economics.perSession.contextListingChars + economics.perSession.commandListingChars
    mine.budget = { chars: budget.chars, tokens: budget.tokens, contextWindow: budget.contextWindow, source: budget.windowSource }
    mine.overBudget = economics.perSession.fitsBudget === false
  }

  // The record this run leaves for the next one, and what moved since the last.
  // `run` is built here rather than by the caller so that whatever is compared
  // is exactly what gets saved, and a report read back off disk explains itself.
  const run = runRecord({ generatedOn, summary, totals, skills: ranked.rows }, { flags: runFlags, cwd, ranAt })

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
    clients,
    summary,
    run,
    previous: previous
      ? {
          ranAt: previous.ranAt || null,
          generatedOn: previous.generatedOn || null,
          cwd: previous.cwd || null,
          flags: previous.flags || {},
          summary: previous.summary || {},
          // One line per skill, carried through so the card can count what
          // actually changed rather than what was once recommended.
          skills: Array.isArray(previous.skills) ? previous.skills : [],
          drift: compareRuns(previous, run),
        }
      : null,
  }
}

/** The compact row shape for skills that are on disk but not in Claude Code's listing. */
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
    commandCalls: r.commandCalls,
    contextCalls: r.contextCalls,
    lastSeen: r.lastSeen,
    listedIn: r.listedIn || [],
    listing: r.listing || {},
    callsByClient: r.callsByClient || {},
    callsElsewhere: r.callsElsewhere || 0,
    callsAllClients: r.callsAllClients || 0,
    lastSeenAnywhere: r.lastSeenAnywhere || null,
    unmeasuredClients: r.unmeasuredClients || [],
  }
}

/**
 * Which of a row's listing clients this run could not read chats for. A
 * skill listed by a tool whose usage is unknown is never "never used" with
 * enough confidence to delete; recommend.mjs reads this to hold back.
 */
function markUnmeasured (rows, byClient) {
  for (const r of rows) {
    r.unmeasuredClients = (r.listedIn || []).filter((id) => id !== 'claude' && byClient[id] && !byClient[id].coverage.measured)
  }
}

/**
 * One entry per client on this machine: what its list holds and costs, what
 * of its chats were read, and how many skill uses came out of them. This is
 * the block the OTHER TOOLS section renders, and the honesty record for every
 * per client count elsewhere in the report.
 */
function clientSummaries (rows, byClient) {
  const out = []
  for (const client of CLIENTS) {
    const scan = byClient[client.id]
    if (!scan) continue
    const listed = rows.filter((r) => r.listing && r.listing[client.id] && r.listing[client.id].listed)
    const chars = listed.reduce((n, r) => n + entryChars(client.id, { name: r.names[0], descriptionChars: r.descriptionChars, path: r.skillMd }), 0)
    const contextWindow = scan.sessions.reduce((w, s) => Math.max(w, Number(s.contextWindow) || 0), 0) || null
    const budget = client.id === 'claude' ? null : listingBudgetFor(client.id, { contextWindow })
    const models = {}
    let first = null
    let last = null
    for (const s of scan.sessions) {
      for (const [m, n] of Object.entries(s.models || {})) models[m] = (models[m] || 0) + n
      if (s.firstTs && (!first || s.firstTs < first)) first = s.firstTs
      if (s.lastTs && (!last || s.lastTs > last)) last = s.lastTs
    }
    const matched = rows.reduce((n, r) => n + (((r.callsByClient || {})[client.id] || {}).calls || 0), 0)
    const onlyHere = rows.filter((r) => r.listedIn && r.listedIn.length === 1 && r.listedIn[0] === client.id).map((r) => r.names[0]).sort()
    out.push({
      id: client.id,
      label: client.label,
      honoursGate: client.honoursGate,
      sigil: client.sigil,
      skills: listed.length,
      listingChars: chars,
      listingTokens: Math.ceil(chars / 4),
      budget,
      overBudget: budget ? chars > budget.chars : null,
      onlyHere,
      sessions: scan.sessions.length,
      firstSession: first ? first.slice(0, 10) : null,
      lastSession: last ? last.slice(0, 10) : null,
      skillCalls: scan.calls.length,
      callsMatched: matched,
      modelsSeen: Object.entries(models).sort((a, b) => b[1] - a[1]).map(([model, apiCalls]) => ({ model, apiCalls })),
      coverage: scan.coverage,
    })
  }
  return out
}

/**
 * Attribute every recorded skill call to a discovered skill. A call that
 * carries the path of the SKILL.md it read (Codex and Cursor do) is matched
 * by that path first, through the real folder and every alias, so a shortcut
 * and its target are one skill. Otherwise a call names a skill exactly as the
 * client resolved it (`plugin:name` or `name`); the canonical name of a skill
 * wins over an alias, and the first skill to claim a name keeps it. Calls
 * that match nothing are counted under unmatchedCalls, per client, so a
 * stale transcript never disappears silently.
 *
 * `calls`, `commandCalls`, `contextCalls`, `firstSeen` and `lastSeen` on a row
 * are Claude Code's, because those are the numbers that say whether Claude
 * Code's router has ever chosen the skill. The other clients sit beside them
 * in `callsByClient`, with `callsElsewhere` and `callsAllClients` as the sums.
 */
export function joinCalls (skills, calls, budget) {
  const canonical = new Map()
  const alias = new Map()
  const byDir = new Map()
  for (const s of skills) {
    const names = Array.isArray(s.names) && s.names.length ? s.names : [s.name]
    if (names[0] && !canonical.has(names[0])) canonical.set(names[0], s)
    for (const n of names) if (n && !alias.has(n)) alias.set(n, s)
    for (const d of [s.realPath].concat(Array.isArray(s.aliases) ? s.aliases : [])) {
      if (!d) continue
      if (!byDir.has(d)) byDir.set(d, s)
      const real = safeReal(d)
      if (real && !byDir.has(real)) byDir.set(real, s)
    }
  }
  const empty = () => ({ calls: 0, commandCalls: 0, contextCalls: 0, firstSeen: null, lastSeen: null })
  const tally = new Map()
  const unmatched = new Map()
  for (const c of calls) {
    const client = c.client || 'claude'
    const dir = c.path ? dirname(String(c.path)) : null
    const target = (dir && (byDir.get(dir) || byDir.get(safeReal(dir)))) ||
      canonical.get(c.skill) || alias.get(c.skill) || (c.bare && (canonical.get(c.bare) || alias.get(c.bare))) || null
    if (!target) {
      const key = client + '\n' + c.skill
      unmatched.set(key, (unmatched.get(key) || 0) + 1)
      continue
    }
    let t = tally.get(target)
    if (!t) { t = {}; tally.set(target, t) }
    const b = t[client] || (t[client] = empty())
    b.calls++
    if (c.mode === 'command') b.commandCalls++
    else b.contextCalls++
    const day = c.ts ? String(c.ts).slice(0, 10) : null
    if (day) {
      if (!b.firstSeen || day < b.firstSeen) b.firstSeen = day
      if (!b.lastSeen || day > b.lastSeen) b.lastSeen = day
    }
  }
  const cap = budget && budget.perEntryCap
  const rows = skills.map((s) => {
    const byClient = tally.get(s) || {}
    const mine = byClient.claude || empty()
    const name = (Array.isArray(s.names) && s.names[0]) || s.name
    const cost = listingCost(Number(s.descriptionChars) || 0, name, cap)
    let elsewhere = 0
    let lastAnywhere = mine.lastSeen
    for (const [id, b] of Object.entries(byClient)) {
      if (id !== 'claude') elsewhere += b.calls
      if (b.lastSeen && (!lastAnywhere || b.lastSeen > lastAnywhere)) lastAnywhere = b.lastSeen
    }
    return Object.assign({}, s, {
      path: tildify(s.realPath),
      calls: mine.calls,
      commandCalls: mine.commandCalls,
      contextCalls: mine.contextCalls,
      firstSeen: mine.firstSeen,
      lastSeen: mine.lastSeen,
      callsByClient: byClient,
      callsElsewhere: elsewhere,
      callsAllClients: mine.calls + elsewhere,
      lastSeenAnywhere: lastAnywhere,
      listingChars: cost.chars,
      listingTokens: cost.tokens,
      descriptionTokens: cost.descriptionTokens,
      capped: cost.capped,
    })
  })
  const unmatchedCalls = [...unmatched.entries()]
    .map(([key, n]) => { const [client, skill] = key.split('\n'); return { client, skill, calls: n } })
    .sort((a, b) => b.calls - a.calls || (a.skill < b.skill ? -1 : 1) || (a.client < b.client ? -1 : 1))
  return { rows, unmatchedCalls }
}

function safeReal (p) { try { return realpathSync(p) } catch { return null } }

/**
 * What one listing token costs per month, from the priced waste. Null when no
 * model in the price list matches the transcripts, in which case rows carry no
 * dollar figure rather than a guessed one.
 */
function dollarsPerTokenPerMonth (cost, economics) {
  const wastedTokens = Number(economics.wastedPerCall.tokens) || 0
  if (wastedTokens <= 0) return null
  const seen = (cost.perModel || []).find((m) => m.seenInTranscripts) || (cost.perModel || [])[0]
  const perMonth = seen && seen.wasted && Number(seen.wasted.perMonth)
  if (!perMonth || !isFinite(perMonth)) return null
  return perMonth / wastedTokens
}

function buildTotals (rows, sessions, calls, notLoaded = [], clients = []) {
  const command = rows.filter((r) => r.mode === 'command')
  const context = rows.filter((r) => r.mode !== 'command')
  const matched = rows.reduce((n, r) => n + r.calls, 0) + notLoaded.reduce((n, r) => n + r.calls, 0)
  const byReason = {}
  for (const r of notLoaded) byReason[r.reason] = (byReason[r.reason] || 0) + 1
  return {
    skills: rows.length,
    onDiskNotListed: notLoaded.length,
    notListedByReason: byReason,
    listedByOtherToolsOnly: notLoaded.filter((r) => Array.isArray(r.listedIn) && r.listedIn.length).length,
    clientsRead: clients.map((c) => c.id),
    callsElsewhere: rows.reduce((n, r) => n + (r.callsElsewhere || 0), 0) + notLoaded.reduce((n, r) => n + (r.callsElsewhere || 0), 0),
    usedElsewhere: rows.filter((r) => (r.callsElsewhere || 0) > 0).length,
    withSourceCopy: rows.filter((r) => r.sourcePath).length,
    declaredCommand: command.length,
    declaredContext: context.length,
    gateDeclaredAnywhere: rows.filter((r) => r.gateDeclared).length,
    transcriptsRead: sessions.length,
    callsTotal: calls.length,
    callsMatched: matched,
    calledSkills: rows.filter((r) => r.calls > 0).length,
    neverCalled: rows.filter((r) => r.calls === 0).length,
    neverCalledCommand: command.filter((r) => r.calls === 0).length,
    neverCalledContext: context.filter((r) => r.calls === 0).length,
  }
}

function buildSummary ({ rows, economics, stats, pricing, cost, counts, notLoaded = [] }) {
  const per = economics.perSession
  const yours = yourModel(stats, pricing)
  let wastedPerWeekOnYourModel = null
  let savedOnYourModel = null
  if (yours) {
    const key = normalizeModelId(yours.id)
    const priced = (cost.perModel || []).find((m) => normalizeModelId(m.id) === key)
    if (priced && priced.wasted && typeof priced.wasted.perWeek === 'number') {
      wastedPerWeekOnYourModel = { model: priced.label || priced.id, dollars: round(priced.wasted.perWeek), dollarsPerMonth: round(priced.wasted.perMonth) }
      // What taking the recommendations is worth in money. The saving is a
      // share of the waste, because gating leaves the name line behind, so it
      // never quite reaches the full wasted figure.
      const wastedTokens = Number(economics.wastedPerCall.tokens) || 0
      const savedTokens = Number(economics.ifGated.savedTokensPerSession) || 0
      const share = wastedTokens > 0 ? Math.min(1, savedTokens / wastedTokens) : 0
      savedOnYourModel = {
        model: priced.label || priced.id,
        dollars: round(priced.wasted.perWeek * share),
        dollarsPerMonth: round(priced.wasted.perMonth * share),
        tokens: savedTokens,
      }
    }
  }
  const actions = Object.assign({ command: 0, delete: 0, optimize: 0, review: 0, keep: 0, context: 0 }, counts || {})
  return {
    skills: rows.length,
    notListed: notLoaded.length,
    listingTokensPerCall: nullable(per.totalListingTokens),
    overBudgetRatio: nullable(per.overBudgetRatio),
    neverCalledContext: nullable(economics.neverCalledContext.count),
    unroutable: nullable(economics.overflowUnroutable.count),
    summonedOnly: nullable(economics.summonedOnlyContext.count),
    wastedTokensPerCall: nullable(economics.wastedPerCall.tokens),
    savedTokensPerCallIfApplied: nullable(economics.ifGated.savedTokensPerSession),
    fitsAfter: typeof economics.ifGated.fitsBudgetAfter === 'boolean' ? economics.ifGated.fitsBudgetAfter : null,
    wastedPerWeekOnYourModel,
    savedOnYourModel,
    recommendedActions: actions,
  }
}

const SUMMARY_KEYS = [
  'skills', 'notListed', 'listingTokensPerCall', 'overBudgetRatio', 'neverCalledContext', 'unroutable', 'summonedOnly',
  'wastedTokensPerCall', 'savedTokensPerCallIfApplied', 'fitsAfter', 'wastedPerWeekOnYourModel', 'savedOnYourModel',
  'recommendedActions',
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
  out.recommendedActions = Object.assign({ command: 0, delete: 0, optimize: 0, review: 0, keep: 0, context: 0 }, out.recommendedActions || {})
  return out
}

function nullable (v) { return (v === undefined || (typeof v === 'number' && Number.isNaN(v))) ? null : v }
function round (n, places = 4) { return +(Number(n) || 0).toFixed(places) }
