import test from 'node:test'
import assert from 'node:assert/strict'

import { money } from '../skills/token-coupons/src/lib/util.mjs'
import { sessionStats } from '../skills/token-coupons/src/calls.mjs'
import {
  loadPricing, costModel, yourModel, ageInDays, normalizeModelId,
  bundledPricingPath, STALE_DAYS,
} from '../skills/token-coupons/src/pricing.mjs'

// A fixture price list, so no test ever depends on what a vendor charges today.
// Round numbers on purpose: every expected figure below is checkable by hand.
const PRICING = {
  currency: 'USD',
  per: 1000000,
  verifiedOn: '2026-08-01',
  models: [
    {
      id: 'fixture-frontier', vendor: 'Fixture', label: 'Fixture Frontier',
      input: 10, cachedInput: 1, cacheWrite: 20, output: 50,
      contextWindow: 1000000, tier: 'frontier', source: 'https://example.test/prices',
    },
    {
      id: 'fixture-mid', vendor: 'Fixture', label: 'Fixture Mid',
      input: 2, cachedInput: 0.2, cacheWrite: null, output: 10,
      contextWindow: 1000000, tier: 'mid', source: 'https://example.test/prices',
    },
    {
      id: 'fixture-small', vendor: 'Fixture', label: 'Fixture Small',
      input: 1, cachedInput: 0.1, cacheWrite: 2, output: 5,
      contextWindow: 200000, tier: 'small', source: 'https://example.test/prices',
    },
  ],
}

// Stats shaped exactly like sessionStats() output, with numbers chosen so the
// multipliers are obvious: 20 API calls a chat, 4 chats a day, 28 a week.
function makeStats (over = {}) {
  return Object.assign({
    measured: true,
    sessions: 8,
    days: 2,
    firstSession: '2026-08-01',
    sessionsPerDay: 4,
    sessionsPerWeek: 28,
    apiCallsPerSessionMedian: 20,
    apiCallsPerSessionMean: 20,
    apiCallsTotal: 160,
    inputTokensTotal: 2000000,
    inputTokensPerWeek: 7000000,
    cacheReadShare: 0.9,
    cacheWriteShare: 0.05,
    modelsSeen: [{ model: 'fixture-mid', apiCalls: 120 }, { model: 'fixture-small', apiCalls: 40 }],
    note: 'measured from session transcripts',
  }, over)
}

const near = (actual, expected, msg) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  (msg || 'value') + ': expected ' + expected + ', got ' + actual,
)
const byId = (cost, id) => cost.perModel.find((m) => m.id === id)

test('loadPricing reads the bundled file and reports its age', () => {
  const p = loadPricing()
  assert.equal(p.error, null)
  assert.equal(p.path, bundledPricingPath())
  assert.equal(p.currency, 'USD')
  assert.equal(p.per, 1000000)
  assert.match(p.verifiedOn, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(p.models.length >= 9, 'expected the required models to be present')
  assert.equal(typeof p.ageDays, 'number')
  assert.equal(typeof p.stale, 'boolean')
})

test('the bundled file carries every field the report needs', () => {
  const p = loadPricing()
  const ids = p.models.map((m) => m.id)
  for (const want of ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5']) {
    assert.ok(ids.includes(want), 'missing required model id ' + want)
  }
  for (const m of p.models) {
    assert.equal(typeof m.input, 'number', m.id + ' input')
    assert.equal(typeof m.cachedInput, 'number', m.id + ' cachedInput')
    assert.ok(m.cacheWrite === null || typeof m.cacheWrite === 'number', m.id + ' cacheWrite')
    assert.equal(typeof m.output, 'number', m.id + ' output')
    assert.equal(typeof m.contextWindow, 'number', m.id + ' contextWindow')
    assert.ok(['frontier', 'mid', 'small'].includes(m.tier), m.id + ' tier')
    assert.match(m.source, /^https:\/\//, m.id + ' source')
  }
  // Anthropic sessions use the 1 hour cache, with the 5 minute rate alongside.
  for (const m of p.models.filter((x) => x.vendor === 'Anthropic')) {
    assert.ok(m.cacheWrite > m.cacheWrite5m, m.id + ' 1 hour writes should cost more than 5 minute writes')
  }
})

test('staleness flips after the cutoff', () => {
  const path = bundledPricingPath()
  const fresh = loadPricing(path, { today: loadPricing(path).verifiedOn })
  assert.equal(fresh.ageDays, 0)
  assert.equal(fresh.stale, false)

  const on = new Date(Date.parse(fresh.verifiedOn + 'T00:00:00Z') + STALE_DAYS * 86400000)
  const justOk = loadPricing(path, { today: on.toISOString().slice(0, 10) })
  assert.equal(justOk.ageDays, STALE_DAYS)
  assert.equal(justOk.stale, false)

  const later = new Date(Date.parse(fresh.verifiedOn + 'T00:00:00Z') + (STALE_DAYS + 1) * 86400000)
  const old = loadPricing(path, { today: later.toISOString().slice(0, 10) })
  assert.equal(old.ageDays, STALE_DAYS + 1)
  assert.equal(old.stale, true)
})

test('a missing price file explains itself instead of crashing', () => {
  const p = loadPricing('/nowhere/at/all/pricing.json')
  assert.deepEqual(p.models, [])
  assert.equal(p.stale, true)
  assert.match(p.error, /could not read the price list/)
  const cost = costModel({ wastedTokens: 100, listingTokens: 1000, stats: makeStats(), pricing: p })
  assert.deepEqual(cost.perModel, [])
})

test('ageInDays never goes negative and survives a bad date', () => {
  assert.equal(ageInDays('2026-08-01', '2026-08-11'), 10)
  assert.equal(ageInDays('2026-08-01', '2026-07-01'), 0)
  assert.equal(ageInDays('not a date', '2026-08-01'), null)
})

test('cached math: the first call of a chat writes, the rest read', () => {
  const stats = makeStats()
  const cost = costModel({ wastedTokens: 1000, listingTokens: 4000, stats, pricing: PRICING })
  const m = byId(cost, 'fixture-frontier')

  // 1000 tokens * (20 write + 1 read * 19 later calls) / 1e6
  near(m.wasted.perChat, 1000 * (20 + 1 * 19) / 1e6, 'wasted per chat')
  near(m.listing.perChat, 4000 * (20 + 1 * 19) / 1e6, 'listing per chat')
  near(m.wasted.perCall, m.wasted.perChat / 20, 'wasted per call')
  assert.equal(money(m.wasted.perChat), '$0.039')
})

test('uncached math is the same tokens at full price on every call', () => {
  const stats = makeStats()
  const cost = costModel({ wastedTokens: 1000, listingTokens: 4000, stats, pricing: PRICING, cached: false })
  const m = byId(cost, 'fixture-frontier')

  near(m.wasted.perChat, 1000 * 10 * 20 / 1e6, 'wasted per chat, nothing cached')
  near(m.wasted.perCall, 1000 * 10 / 1e6, 'wasted per call, nothing cached')
  near(m.listing.perChat, 4000 * 10 * 20 / 1e6, 'listing per chat, nothing cached')
})

test('the uncached upper bound is reported even in cached mode', () => {
  const stats = makeStats()
  const cost = costModel({ wastedTokens: 1000, listingTokens: 4000, stats, pricing: PRICING })
  const m = byId(cost, 'fixture-frontier')

  near(m.uncached.wastedPerChat, 1000 * 10 * 20 / 1e6, 'uncached per chat')
  near(m.uncached.wastedPerWeek, (1000 * 10 * 20 / 1e6) * 28, 'uncached per week')
  assert.ok(m.uncached.wastedPerChat > m.wasted.perChat, 'caching must be the cheaper number')
})

test('a vendor with no cache write charge falls back to the input price', () => {
  const stats = makeStats()
  const cost = costModel({ wastedTokens: 1000, listingTokens: 1000, stats, pricing: PRICING })
  const mid = byId(cost, 'fixture-mid')

  // cacheWrite is null, so the first call is billed at the 2.00 input rate.
  near(mid.wasted.perChat, 1000 * (2 + 0.2 * 19) / 1e6, 'null cacheWrite falls back to input')
})

test('per day and per week come straight from the measured session counts', () => {
  const stats = makeStats({ sessionsPerDay: 4, sessionsPerWeek: 28 })
  const cost = costModel({ wastedTokens: 1000, listingTokens: 4000, stats, pricing: PRICING })
  const m = byId(cost, 'fixture-frontier')

  near(m.wasted.perDay, m.wasted.perChat * 4, 'wasted per day')
  near(m.wasted.perWeek, m.wasted.perChat * 28, 'wasted per week')
  near(m.listing.perDay, m.listing.perChat * 4, 'listing per day')
  near(m.listing.perWeek, m.listing.perChat * 28, 'listing per week')

  assert.equal(cost.assumptions.apiCallsPerSession, 20)
  assert.equal(cost.assumptions.sessionsPerDay, 4)
  assert.equal(cost.assumptions.sessionsPerWeek, 28)
  assert.equal(cost.assumptions.measured, true)
  assert.equal(cost.assumptions.cached, true)
  assert.match(cost.assumptions.note, /measured from session transcripts/)
})

test('volume shares of measured input stay inside 0 to 1', () => {
  const stats = makeStats({ inputTokensPerWeek: 7000000 })
  const cost = costModel({ wastedTokens: 1000, listingTokens: 4000, stats, pricing: PRICING })

  assert.equal(cost.volume.listingTokensPerWeek, 4000 * 20 * 28)
  assert.equal(cost.volume.wastedTokensPerWeek, 1000 * 20 * 28)
  assert.equal(cost.volume.inputTokensPerWeek, 7000000)
  near(cost.volume.listingShareOfInput, (4000 * 20 * 28) / 7000000, 'listing share')
  near(cost.volume.wastedShareOfInput, (1000 * 20 * 28) / 7000000, 'wasted share')
  for (const key of ['listingShareOfInput', 'wastedShareOfInput']) {
    assert.ok(cost.volume[key] >= 0 && cost.volume[key] <= 1, key + ' must be between 0 and 1')
  }
})

test('shares are clamped when the listing looks bigger than all measured input', () => {
  const tiny = costModel({ wastedTokens: 9000000, listingTokens: 9000000, stats: makeStats({ inputTokensPerWeek: 1000 }), pricing: PRICING })
  assert.equal(tiny.volume.listingShareOfInput, 1)
  assert.equal(tiny.volume.wastedShareOfInput, 1)

  const none = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats({ inputTokensPerWeek: 0 }), pricing: PRICING })
  assert.equal(none.volume.listingShareOfInput, 0)
  assert.equal(none.volume.wastedShareOfInput, 0)
})

test('seenInTranscripts marks the models the transcripts actually used', () => {
  const cost = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats(), pricing: PRICING })
  assert.equal(byId(cost, 'fixture-mid').seenInTranscripts, true)
  assert.equal(byId(cost, 'fixture-small').seenInTranscripts, true)
  assert.equal(byId(cost, 'fixture-frontier').seenInTranscripts, false)
})

test('a bracketed transcript id still matches the plain price list id', () => {
  assert.equal(normalizeModelId('fixture-mid[1m]'), 'fixture-mid')
  const stats = makeStats({ modelsSeen: [{ model: 'fixture-frontier[1m]', apiCalls: 5 }] })
  const cost = costModel({ wastedTokens: 100, listingTokens: 100, stats, pricing: PRICING })
  assert.equal(byId(cost, 'fixture-frontier').seenInTranscripts, true)
  assert.equal(yourModel(stats, PRICING).id, 'fixture-frontier')
})

test('perModel sorts used models first, then frontier, mid, small', () => {
  const cost = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats(), pricing: PRICING })
  assert.deepEqual(cost.perModel.map((m) => m.id), ['fixture-mid', 'fixture-small', 'fixture-frontier'])

  const unused = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats({ modelsSeen: [] }), pricing: PRICING })
  assert.deepEqual(unused.perModel.map((m) => m.id), ['fixture-frontier', 'fixture-mid', 'fixture-small'])
})

test('every priced row carries its label, vendor and tier', () => {
  const cost = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats(), pricing: PRICING })
  const m = byId(cost, 'fixture-mid')
  assert.equal(m.label, 'Fixture Mid')
  assert.equal(m.vendor, 'Fixture')
  assert.equal(m.tier, 'mid')
})

test('yourModel picks the busiest model in the transcripts, or nothing', () => {
  assert.equal(yourModel(makeStats(), PRICING).id, 'fixture-mid')
  assert.equal(yourModel(makeStats({ modelsSeen: [{ model: 'some-other-model', apiCalls: 9 }] }), PRICING), null)
  assert.equal(yourModel(makeStats({ modelsSeen: [] }), PRICING), null)
  // An unpriced busiest model falls through to the next one that is priced.
  const mixed = makeStats({ modelsSeen: [{ model: 'some-other-model', apiCalls: 99 }, { model: 'fixture-small', apiCalls: 3 }] })
  assert.equal(yourModel(mixed, PRICING).id, 'fixture-small')
})

test('the staleness flag rides along on the cost model', () => {
  const stale = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats(), pricing: PRICING, today: '2027-01-01' })
  assert.equal(stale.pricingVerifiedOn, '2026-08-01')
  assert.equal(stale.pricingStale, true)

  const fresh = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: makeStats(), pricing: PRICING, today: '2026-08-10' })
  assert.equal(fresh.pricingStale, false)

  // loadPricing already worked out staleness, so costModel trusts it.
  const loaded = Object.assign({}, PRICING, { stale: true, ageDays: 400 })
  assert.equal(costModel({ wastedTokens: 1, listingTokens: 1, stats: makeStats(), pricing: loaded }).pricingStale, true)
})

test('it works on a real sessionStats object with no history at all', () => {
  const stats = sessionStats([], { today: '2026-08-15' })
  const cost = costModel({ wastedTokens: 1000, listingTokens: 4000, stats, pricing: PRICING })
  assert.equal(cost.assumptions.measured, false)
  assert.equal(cost.assumptions.apiCallsPerSession, 25)
  assert.match(cost.assumptions.note, /no session history found/)
  assert.equal(cost.volume.inputTokensPerWeek, 0)
  assert.equal(cost.volume.wastedShareOfInput, 0)
  assert.ok(byId(cost, 'fixture-frontier').wasted.perChat > 0)
})

test('it works on a real sessionStats object built from sessions', () => {
  const sessions = [
    { id: 'a', project: 'p', firstTs: '2026-08-08T10:00:00Z', lastTs: '2026-08-08T11:00:00Z', apiCalls: 10, models: { 'fixture-mid': 10 }, inputTokens: 100000, cacheReadTokens: 90000, cacheWriteTokens: 5000, uncachedInputTokens: 5000, outputTokens: 2000, skillCalls: 1 },
    { id: 'b', project: 'p', firstTs: '2026-08-09T10:00:00Z', lastTs: '2026-08-09T11:00:00Z', apiCalls: 30, models: { 'fixture-mid': 20, 'fixture-frontier': 10 }, inputTokens: 300000, cacheReadTokens: 280000, cacheWriteTokens: 10000, uncachedInputTokens: 10000, outputTokens: 5000, skillCalls: 2 },
  ]
  const stats = sessionStats(sessions, { today: '2026-08-15' })
  const cost = costModel({ wastedTokens: 500, listingTokens: 2500, stats, pricing: PRICING })

  assert.equal(cost.assumptions.measured, true)
  assert.equal(cost.assumptions.apiCallsPerSession, stats.apiCallsPerSessionMedian)
  assert.equal(cost.assumptions.sessionsPerWeek, stats.sessionsPerWeek)
  assert.equal(cost.perModel[0].id, 'fixture-mid')
  assert.equal(cost.perModel[0].seenInTranscripts, true)
  assert.equal(yourModel(stats, PRICING).id, 'fixture-mid')
  assert.equal(cost.volume.wastedTokensPerWeek, 500 * stats.apiCallsPerSessionMedian * stats.sessionsPerWeek)
})

test('per month figures are per week times 52/12, for dollars and for tokens', async () => {
  const { costModel, WEEKS_PER_MONTH } = await import('../skills/token-coupons/src/pricing.mjs')
  const pricing = { currency: 'USD', per: 1000000, verifiedOn: '2026-08-15', models: [{ id: 'm', label: 'M', input: 10, cachedInput: 1, cacheWrite: 20, output: 50, tier: 'frontier' }] }
  const stats = { measured: true, apiCallsPerSessionMedian: 10, sessionsPerDay: 1, sessionsPerWeek: 7, inputTokensPerWeek: 1e9, modelsSeen: [] }
  const c = costModel({ wastedTokens: 1000, listingTokens: 2000, stats, pricing, today: '2026-08-15' })
  const m = c.perModel[0]
  const near = (a, b) => Math.abs(a - b) < 1e-9
  assert.ok(near(m.wasted.perMonth, m.wasted.perWeek * WEEKS_PER_MONTH))
  assert.ok(near(m.listing.perMonth, m.listing.perWeek * WEEKS_PER_MONTH))
  assert.ok(near(m.uncached.wastedPerMonth, m.uncached.wastedPerWeek * WEEKS_PER_MONTH))
  assert.ok(near(c.volume.wastedTokensPerMonth, c.volume.wastedTokensPerWeek * WEEKS_PER_MONTH))
  assert.equal(c.volume.wastedTokensPerWeek, 1000 * 10 * 7)
})

test('the listing is priced at the save rate once per cache break, not once per chat', async () => {
  const { costModel } = await import('../skills/token-coupons/src/pricing.mjs')
  const pricing = { currency: 'USD', per: 1000000, verifiedOn: '2026-08-15', models: [{ id: 'm', label: 'M', input: 10, cachedInput: 1, cacheWrite: 20, output: 50, tier: 'frontier' }] }
  const base = { measured: true, apiCallsPerSessionMedian: 10, sessionsPerDay: 1, sessionsPerWeek: 7, inputTokensPerWeek: 1e9, modelsSeen: [] }
  const once = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: base, pricing, today: '2026-08-15' })
  const four = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: { ...base, listingWritesPerSession: 4 }, pricing, today: '2026-08-15' })
  // one write plus nine reads, against four writes plus six reads
  const near = (a, b) => Math.abs(a - b) < 1e-9
  assert.ok(near(once.perModel[0].wasted.perChat, 1000 * (20 + 1 * 9) / 1e6))
  assert.ok(near(four.perModel[0].wasted.perChat, 1000 * (20 * 4 + 1 * 6) / 1e6))
  assert.ok(four.perModel[0].wasted.perWeek > once.perModel[0].wasted.perWeek, 'more breaks cost more')
  assert.equal(four.assumptions.cacheWritesPerSession, 4)
  assert.match(four.assumptions.note, /re-save it 4 times/)

  // writes can never exceed the number of requests, and never fall below one
  const silly = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: { ...base, listingWritesPerSession: 999 }, pricing, today: '2026-08-15' })
  assert.equal(silly.assumptions.cacheWritesPerSession, 10)
  const zero = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: { ...base, listingWritesPerSession: 0 }, pricing, today: '2026-08-15' })
  assert.equal(zero.assumptions.cacheWritesPerSession, 1)

  // the uncached upper bound does not use the cache at all, so it is unchanged
  const u1 = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: base, pricing, cached: false, today: '2026-08-15' })
  const u4 = costModel({ wastedTokens: 1000, listingTokens: 1000, stats: { ...base, listingWritesPerSession: 4 }, pricing, cached: false, today: '2026-08-15' })
  assert.equal(u1.perModel[0].wasted.perChat, u4.perModel[0].wasted.perChat)
})
