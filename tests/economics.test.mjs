// The one rule that decides what counts as "started by you", tested where it
// lives: the economics count it and the recommendations flag it, both through
// isMostlyTyped, so the two can never disagree about which skills those are.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { economics, ifApplied, isMostlyTyped, DEFAULT_TYPED_SHARE } from '../skills/token-coupons/src/economics.mjs'
import { recommend } from '../skills/token-coupons/src/recommend.mjs'
import { listingBudget } from '../skills/token-coupons/src/budget.mjs'

const budget = listingBudget({ contextWindow: 1000000 })

function skill (name, calls, commandCalls, over = {}) {
  return Object.assign({
    name, names: [name], mode: 'context', descriptionChars: 196, location: 'user', editable: true,
    calls, commandCalls, contextCalls: calls - commandCalls, modifiedOn: '2026-06-01',
  }, over)
}

describe('isMostlyTyped', () => {
  test('four typed uses in five is the bar, and it is a share, not a count', () => {
    assert.equal(DEFAULT_TYPED_SHARE, 0.8)
    assert.equal(isMostlyTyped({ calls: 5, commandCalls: 4 }), true)
    assert.equal(isMostlyTyped({ calls: 40, commandCalls: 32 }), true)
    assert.equal(isMostlyTyped({ calls: 4, commandCalls: 3 }), false)
    assert.equal(isMostlyTyped({ calls: 40, commandCalls: 31 }), false)
  })

  test('every use typed still counts, and a skill never used or never typed does not', () => {
    assert.equal(isMostlyTyped({ calls: 1, commandCalls: 1 }), true)
    assert.equal(isMostlyTyped({ calls: 0, commandCalls: 0 }), false)
    assert.equal(isMostlyTyped({ calls: 9, commandCalls: 0 }), false)
    assert.equal(isMostlyTyped(null), false)
  })

  test('one pick by the agent needs four typed uses beside it, so the bar asks for evidence on its own', () => {
    for (let typed = 1; typed <= 3; typed++) assert.equal(isMostlyTyped({ calls: typed + 1, commandCalls: typed }), false)
    assert.equal(isMostlyTyped({ calls: 5, commandCalls: 4 }), true)
  })

  test('a share that makes no sense falls back to the default instead of counting everything', () => {
    for (const bad of [0, -1, 2, NaN, 'x']) assert.equal(isMostlyTyped({ calls: 4, commandCalls: 3 }, bad), false)
    assert.equal(isMostlyTyped({ calls: 4, commandCalls: 3 }, 0.75), true)
  })
})

describe('economics: skills started by you', () => {
  const rows = [
    skill('always', 4, 4),      // 100 percent
    skill('mostly', 16, 13),    // 81 percent: counted now, not before
    skill('sometimes', 10, 5),  // 50 percent
    skill('agent', 9, 0),
    skill('unused', 0, 0),
  ]

  test('counts the mostly typed skill, prices it as waste, and says what the bar was', () => {
    const e = economics(rows, budget)
    assert.deepEqual(e.summonedOnlyContext.names, ['always', 'mostly'])
    assert.equal(e.summonedOnlyContext.count, 2)
    assert.equal(e.summonedOnlyContext.share, 0.8)
    assert.match(e.summonedOnlyContext.note, /at least 80 percent of the time/)
    assert.deepEqual(e.neverCalledContext.names, ['unused'], 'never used and started by you stay separate piles')
    assert.equal(e.wastedPerCall.count, 3)
    assert.equal(e.wastedPerCall.chars, e.neverCalledContext.chars + e.summonedOnlyContext.chars)
    assert.equal(e.ifGated.count, 3)
  })

  test('the bar moves with the option, and 1 is the old rule', () => {
    assert.deepEqual(economics(rows, budget, { typedShare: 1 }).summonedOnlyContext.names, ['always'])
    assert.deepEqual(economics(rows, budget, { typedShare: 0.5 }).summonedOnlyContext.names, ['always', 'mostly', 'sometimes'])
  })

  test('the rows flagged are exactly the rows counted', () => {
    const e = economics(rows, budget)
    const flagged = recommend(rows, { economics: e, budget, today: '2026-08-15' }).rows
      .filter((r) => r.recommendation.flags.includes('summoned-only')).map((r) => r.names[0]).sort()
    assert.deepEqual(flagged, [...e.summonedOnlyContext.names].sort())
  })
})

describe('ifApplied: what the recommendations give back', () => {
  const rows = [
    skill('always', 4, 4),
    skill('mostly', 16, 13),
    skill('agent', 9, 0),
    skill('unused', 0, 0),
  ]
  const eco = economics(rows, budget)
  const ranked = recommend(rows, { economics: eco, budget, today: '2026-08-15' }).rows

  test('is the sum of the rows that act, and counts them by action', () => {
    const applied = ifApplied(ranked, eco)
    const acted = ranked.filter((r) => ['command', 'delete', 'optimize'].includes(r.recommendation.action))
    assert.equal(applied.tokens, acted.reduce((n, r) => n + r.recommendation.impactTokensPerCall, 0))
    assert.equal(applied.count, acted.length)
    assert.equal(applied.byAction.command + applied.byAction.delete + applied.byAction.optimize, applied.count)
    assert.equal(applied.fitsBudgetAfter, true)
    assert.equal(applied.charsAfter, eco.perSession.contextListingChars - applied.chars)
  })

  test('rows that say keep give back nothing, whatever gating them would have saved', () => {
    const kept = ranked.map((r) => r.recommendation.action === 'keep' ? r : Object.assign({}, r, {
      recommendation: Object.assign({}, r.recommendation, { action: 'keep', impactTokensPerCall: 0, flags: ['never-called', 'too-new'] }),
    }))
    const applied = ifApplied(kept, eco)
    assert.equal(applied.tokens, 0)
    assert.equal(applied.count, 0)
    assert.equal(applied.chars, 0)
    assert.equal(applied.charsAfter, eco.perSession.contextListingChars)
    assert.ok(eco.ifGated.savedTokensPerSession > 0, 'while the gate everything figure has not moved')
  })

  test('survives rows and economics that are missing', () => {
    const empty = ifApplied(null, null)
    assert.equal(empty.tokens, 0)
    assert.equal(empty.count, 0)
    assert.equal(empty.fitsBudgetAfter, null)
  })
})

