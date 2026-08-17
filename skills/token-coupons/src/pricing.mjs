// What the skill listing actually costs in dollars.
//
// Prices are data, never code: they live in data/pricing.json with the date
// they were checked, and refreshing them is a human or agent action. Nothing
// here touches the network.
//
// The cost model priced here is the one the agent client really runs. The
// skill listing sits in the system prompt, so it is sent again on every single
// API call of every session. With caching on (the default) the first call of a
// session writes the listing into the cache and every later call reads it back
// at about a tenth of the price. With caching off it is paid at full price
// every time, which is the honest upper bound.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { readJson } from './lib/util.mjs'

/** A price list older than this is called stale and the report says so. */
export const STALE_DAYS = 60
/** 52 weeks over 12 months. Used for the per month figures. */
export const WEEKS_PER_MONTH = 52 / 12

/** Order the report lists models in when the transcripts do not decide it. */
export const TIER_ORDER = { frontier: 0, mid: 1, small: 2 }

const DAY_MS = 86400000

/**
 * The price list that ships inside the skill, found relative to this file so it
 * resolves wherever the skill directory was copied to and whatever folder the
 * command was run from.
 */
export function bundledPricingPath () {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pricing.json')
}

function parseDay (value) {
  const t = Date.parse(String(value || '') + 'T00:00:00Z')
  return Number.isNaN(t) ? null : t
}

/** Whole days between the date a price was checked and today. Never negative. */
export function ageInDays (verifiedOn, today = null) {
  const from = parseDay(verifiedOn)
  if (from === null) return null
  const to = today ? parseDay(today) : Date.now()
  if (to === null) return null
  return Math.max(0, Math.floor((to - from) / DAY_MS))
}

/**
 * Read the price list. `path` defaults to the copy bundled with the package.
 * Returns the file plus how old it is, so every number the report prints can
 * carry its own honesty label.
 *
 * A missing or broken file is not fatal: the report still runs, it just has no
 * dollar figures, and `error` says why in plain words.
 */
export function loadPricing (path = null, { today = null } = {}) {
  const file = path || bundledPricingPath()
  const read = readJson(file)
  if (!read.ok || !read.value || typeof read.value !== 'object') {
    return emptyPricing(file, 'could not read the price list at ' + file + ': ' + (read.reason || 'unknown reason'))
  }
  if (!Array.isArray(read.value.models)) {
    return emptyPricing(file, 'the price list at ' + file + ' has no list of models in it')
  }
  const data = read.value
  const ageDays = ageInDays(data.verifiedOn, today)
  return {
    currency: data.currency || 'USD',
    per: Number(data.per) || 1000000,
    verifiedOn: data.verifiedOn || null,
    models: data.models,
    stale: ageDays === null ? true : ageDays > STALE_DAYS,
    ageDays,
    path: file,
    error: null,
  }
}

function emptyPricing (file, error) {
  return { currency: 'USD', per: 1000000, verifiedOn: null, models: [], stale: true, ageDays: null, path: file, error }
}

/**
 * Transcripts write model ids like `claude-opus-5[1m]` when a bigger context
 * window is switched on. That is the same model at the same price, so compare
 * ids with the trailing bracket removed.
 */
export function normalizeModelId (id) {
  return String(id || '').trim().toLowerCase().replace(/\[[^\]]*\]\s*$/, '')
}

function callsByModel (stats) {
  const out = new Map()
  for (const entry of (stats && stats.modelsSeen) || []) {
    const key = normalizeModelId(entry && entry.model)
    if (!key) continue
    out.set(key, (out.get(key) || 0) + (Number(entry.apiCalls) || 0))
  }
  return out
}

/**
 * The price entry for the model the transcripts used most, or null when the
 * transcripts name a model that is not in the price list.
 */
export function yourModel (stats, pricing) {
  const seen = (stats && stats.modelsSeen) || []
  const models = (pricing && pricing.models) || []
  for (const entry of seen) {
    const want = normalizeModelId(entry && entry.model)
    const hit = models.find((m) => normalizeModelId(m.id) === want)
    if (hit) return hit
  }
  return null
}

/**
 * Price a number of tokens that ride in the system prompt of every API call.
 *
 * @param wastedTokens  tokens spent on descriptions that have never once been
 *                      chosen by the router (never called plus summoned only)
 * @param listingTokens tokens the whole skill listing costs
 * @param stats         sessionStats() from src/calls.mjs
 * @param pricing       loadPricing() output, or any object of the same shape
 * @param cached        true prices the real caching behaviour, false prices the
 *                      upper bound where nothing is cached
 *
 * The listing sits in the system prompt, at the very front of the cached
 * prefix, so it is paid at the WRITE price on every request that breaks the
 * cache from the front and at the read price on all the others. How often that
 * happens is measured per machine in calls.mjs (first request of a session,
 * model switch, effort switch, cache expiry); it is not once per chat, which is
 * what this model used to assume.
 */
export function costModel ({ wastedTokens = 0, listingTokens = 0, stats = null, pricing = null, cached = true, today = null } = {}) {
  const s = stats || {}
  const p = pricing || { models: [] }
  const per = Number(p.per) || 1000000
  const models = Array.isArray(p.models) ? p.models : []

  const calls = Math.max(1, Math.round(Number(s.apiCallsPerSessionMedian) || Number(s.apiCallsPerSessionMean) || 1))
  // The mean, not the median: a minority of sessions break the cache many
  // times, and the mean is what reconstructs the real total number of writes.
  const writes = Math.min(calls, Math.max(1, Number(s.listingWritesPerSession) || 1))
  const sessionsPerDay = Number(s.sessionsPerDay) || 0
  const sessionsPerWeek = Number(s.sessionsPerWeek) || 0
  const wasted = Math.max(0, Number(wastedTokens) || 0)
  const listing = Math.max(0, Number(listingTokens) || 0)

  const seen = callsByModel(s)

  const priced = models.map((m, index) => {
    const input = Number(m.input) || 0
    const cachedInput = Number(m.cachedInput) || 0
    // Vendors without a separate charge for filling the cache bill the first
    // call at the normal input rate.
    const write = (m.cacheWrite === null || m.cacheWrite === undefined) ? input : Number(m.cacheWrite) || 0

    const perChatOf = (tokens) => cached
      ? tokens * (write * writes + cachedInput * (calls - writes)) / per
      : tokens * input * calls / per
    const spread = (tokens) => {
      const perChat = perChatOf(tokens)
      return {
        perCall: perChat / calls,
        perChat,
        perDay: perChat * sessionsPerDay,
        perWeek: perChat * sessionsPerWeek,
        perMonth: perChat * sessionsPerWeek * WEEKS_PER_MONTH,
      }
    }
    const uncachedPerChat = wasted * input * calls / per
    const key = normalizeModelId(m.id)

    return {
      id: m.id,
      label: m.label || m.id,
      vendor: m.vendor || null,
      tier: m.tier || null,
      seenInTranscripts: seen.has(key),
      // Carried through so the report can link the page a price was read from,
      // which is the first thing to open when the table has gone stale.
      source: m.source || null,
      listing: spread(listing),
      wasted: spread(wasted),
      uncached: { wastedPerChat: uncachedPerChat, wastedPerWeek: uncachedPerChat * sessionsPerWeek, wastedPerMonth: uncachedPerChat * sessionsPerWeek * WEEKS_PER_MONTH },
      _seenCalls: seen.get(key) || 0,
      _index: index,
    }
  })

  // Models the person actually uses first, busiest first, then the rest by
  // tier so the frontier prices (the scary ones) come before the cheap ones.
  priced.sort((a, b) => {
    if (a.seenInTranscripts !== b.seenInTranscripts) return a.seenInTranscripts ? -1 : 1
    if (a.seenInTranscripts && b._seenCalls !== a._seenCalls) return b._seenCalls - a._seenCalls
    const ta = TIER_ORDER[a.tier] ?? 99
    const tb = TIER_ORDER[b.tier] ?? 99
    if (ta !== tb) return ta - tb
    return a._index - b._index
  })
  const perModel = priced.map(({ _seenCalls, _index, ...rest }) => rest)

  const listingTokensPerWeek = listing * calls * sessionsPerWeek
  const wastedTokensPerWeek = wasted * calls * sessionsPerWeek
  const listingTokensPerMonth = listingTokensPerWeek * WEEKS_PER_MONTH
  const wastedTokensPerMonth = wastedTokensPerWeek * WEEKS_PER_MONTH
  const inputTokensPerWeek = Math.max(0, Number(s.inputTokensPerWeek) || 0)

  const ageDays = p.ageDays !== undefined ? p.ageDays : ageInDays(p.verifiedOn, today)
  const stale = p.stale !== undefined ? p.stale : (ageDays === null ? true : ageDays > STALE_DAYS)

  return {
    assumptions: {
      apiCallsPerSession: calls,
      cacheWritesPerSession: writes,
      cacheBreaks: s.cacheBreaks || null,
      cacheTtlMinutes: s.cacheTtlMinutes || null,
      sessionsPerDay,
      sessionsPerWeek,
      measured: !!s.measured,
      cached,
      note: assumptionNote(s, cached),
    },
    perModel,
    volume: {
      listingTokensPerWeek,
      wastedTokensPerWeek,
      listingTokensPerMonth,
      wastedTokensPerMonth,
      inputTokensPerWeek,
      listingShareOfInput: share(listingTokensPerWeek, inputTokensPerWeek),
      wastedShareOfInput: share(wastedTokensPerWeek, inputTokensPerWeek),
    },
    pricingVerifiedOn: p.verifiedOn || null,
    pricingStale: !!stale,
  }
}

function share (part, whole) {
  if (!whole) return 0
  const v = part / whole
  if (!Number.isFinite(v) || v < 0) return 0
  return v > 1 ? 1 : v
}

function assumptionNote (stats, cached) {
  const how = stats && stats.note
    ? String(stats.note)
    : 'no chat history was found, so the number of chats per day is a guess'
  const w = stats && Number(stats.listingWritesPerSession)
  const writes = cached && w > 1
    ? ' Your chats re-save it ' + (+w.toFixed(1)) + ' times each on average, measured, because starting a chat, switching model or effort, and coming back after an hour all throw the saved copy away.'
    : ''
  const caching = cached
    ? 'Prices assume the list is saved into the cache and re-read cheaply on later messages, which is what Claude Code does by default.' + writes
    : 'Prices assume nothing is saved and reused, so the whole list is paid for at full price on every message. This is the highest the bill could be.'
  return how + '. ' + caching
}
