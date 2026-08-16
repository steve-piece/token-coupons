import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeFixtureHome, withHome } from './helpers.mjs'
import { buildReport, pickSummary, joinCalls, toolVersion } from '../src/report.mjs'
import { renderText } from '../src/render-text.mjs'

const FORBIDDEN = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))
const TODAY = '2026-08-15'

const LONG = 'Use this whenever someone wants the alpha treatment for a file, a folder, a repo, or a whole workspace, ' +
  'including all the edge cases a newcomer would not think of. It reads, checks, fixes and reports. '.repeat(3)

function fixture () {
  return makeFixtureHome({
    skills: [
      // Ages are set on purpose: a skill installed in the last 14 days reads as
      // "too new to judge", which would mask the rule each of these exercises.
      { name: 'alpha', description: LONG, mtimeDaysAgo: 30 },
      { name: 'beta', description: 'Beta does something nobody has asked for in a long while, and it is a user skill.', mtimeDaysAgo: 200 },
      { name: 'gamma', description: 'Gamma lives inside a plugin cache and has never been used by anyone.', where: 'plugin-cache', plugin: 'plug', mtimeDaysAgo: 30 },
      { name: 'delta', description: 'Delta is already gated and dormant.', gate: 'true', mtimeDaysAgo: 30 },
      { name: 'eps', description: 'Eps is only ever summoned by the person typing its name, never routed to.', mtimeDaysAgo: 30 },
      { name: 'zeta', description: 'Zeta.', mtimeDaysAgo: 30 },
    ],
    transcripts: [
      {
        session: 's1', date: '2026-08-10T10:00:00Z',
        turns: [
          { user: 'please /eps now' }, { skill: 'eps' },
          { user: 'do the alpha thing' }, { skill: 'alpha' },
          { user: 'and again' }, { skill: 'alpha' },
          { user: 'ghost?' }, { skill: 'ghost' },
          { assistant: 'done', split: true },
        ],
      },
      {
        session: 's2', date: '2026-08-12T10:00:00Z',
        turns: [{ user: 'hi' }, { assistant: 'hello' }, { assistant: 'more' }],
      },
    ],
    settings: { model: 'claude-opus-5[1m]' },
  })
}

describe('buildReport', () => {
  test('joins discovery, calls, economics, recommendations and pricing into one report', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ since: '2026-08-01', today: TODAY })
        assert.equal(r.version, 1)
        assert.equal(r.tool.name, 'token-coupons')
        assert.equal(r.tool.version, toolVersion())
        assert.equal(r.generatedOn, TODAY)
        assert.equal(r.since, '2026-08-01')
        assert.equal(r.skills.length, 6)
        assert.equal(r.totals.skills, 6)
        assert.equal(r.totals.declaredActive, 1)
        assert.equal(r.totals.declaredPassive, 5)
        assert.equal(r.totals.transcriptsRead, 2)
        assert.equal(r.totals.callsTotal, 4)
        assert.equal(r.totals.callsMatched, 3)
        assert.equal(r.totals.calledSkills, 2)
        assert.equal(r.totals.neverCalled, 4)
        assert.equal(r.totals.neverCalledActive, 1)
        assert.equal(r.totals.neverCalledPassive, 3)
        assert.deepEqual(r.unmatchedCalls, [{ skill: 'ghost', calls: 1 }])
        assert.equal(r.budget.contextWindow, 1000000)
        assert.ok(r.economics && r.economics.perSession && r.stats && r.cost)
        assert.equal(r.stats.measured, true)
      })
    } finally { fx.cleanup() }
  })

  test('rows carry the call split, listing cost, tildified path, and are sorted by rank', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const by = Object.fromEntries(r.skills.map((s) => [s.name, s]))
        assert.equal(by.alpha.calls, 2)
        assert.equal(by.alpha.passiveCalls, 2)
        assert.equal(by.alpha.activeCalls, 0)
        assert.equal(by.alpha.firstSeen, '2026-08-10')
        assert.equal(by.alpha.lastSeen, '2026-08-10')
        assert.equal(by.eps.calls, 1)
        assert.equal(by.eps.activeCalls, 1)
        assert.equal(by.eps.passiveCalls, 0)
        assert.equal(by.beta.calls, 0)
        assert.equal(by.beta.firstSeen, null)
        assert.equal(by.alpha.listingTokens, Math.ceil((LONG.length + 'alpha'.length + 4) / 4))
        assert.equal(by.alpha.descriptionTokens, Math.ceil(LONG.length / 4))
        assert.equal(by.alpha.capped, false)
        assert.equal(by.gamma.path, '~/.claude/plugins/cache/mp/plug/1.0.0/skills/gamma')
        assert.equal(by.gamma.names[0], 'plug:gamma')
        r.skills.forEach((s, i) => assert.equal(s.recommendation.rank, i + 1))
        assert.equal(r.skills[0].recommendation.rank, 1)
      })
    } finally { fx.cleanup() }
  })

  test('recommendations follow the contract rules for each fixture skill', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const by = Object.fromEntries(r.skills.map((s) => [s.name, s]))
        assert.equal(by.alpha.recommendation.action, 'keep')
        assert.equal(by.beta.recommendation.action, 'delete')
        assert.ok(by.beta.recommendation.flags.includes('stale'))
        assert.equal(by.gamma.recommendation.action, 'active')
        assert.ok(by.gamma.recommendation.flags.includes('not-editable'))
        assert.equal(by.delta.recommendation.action, 'review')
        assert.equal(by.eps.recommendation.action, 'active')
        assert.ok(by.eps.recommendation.flags.includes('summoned-only'))
        assert.equal(by.zeta.recommendation.action, 'optimize')
        assert.ok(by.zeta.recommendation.flags.includes('thin-description'))
        assert.equal(r.thin.length, 1)
        assert.equal(r.heaviest[0].name, 'alpha')
        assert.deepEqual(r.summary.recommendedActions, { active: 2, delete: 1, optimize: 1, review: 1, keep: 1, passive: 0 })
      })
    } finally { fx.cleanup() }
  })

  test('summary has every field, and prices the waste on the model the transcripts used', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const s = r.summary
        for (const k of ['skills', 'listingTokensPerCall', 'overBudgetRatio', 'neverCalledPassive', 'unroutable', 'summonedOnly',
          'wastedTokensPerCall', 'savedTokensPerCallIfApplied', 'fitsAfter', 'wastedPerWeekOnYourModel', 'recommendedActions']) {
          assert.ok(k in s, 'summary is missing ' + k)
        }
        assert.equal(s.skills, 6)
        assert.equal(s.neverCalledPassive, 3)
        assert.equal(s.summonedOnly, 1)
        assert.equal(s.unroutable, 0)
        assert.equal(s.listingTokensPerCall, r.economics.perSession.totalListingTokens)
        assert.equal(s.wastedTokensPerCall, r.economics.wastedPerCall.tokens)
        assert.equal(s.savedTokensPerCallIfApplied, r.economics.ifGated.savedTokensPerSession)
        assert.equal(s.fitsAfter, true)
        assert.ok(s.wastedPerWeekOnYourModel, 'expected a priced model')
        assert.equal(s.wastedPerWeekOnYourModel.model, 'Claude Opus 5')
        assert.ok(s.wastedPerWeekOnYourModel.dollars > 0)
        assert.ok(r.cost.perModel.length > 0)
        assert.equal(r.cost.perModel[0].id, 'claude-opus-5', 'the model seen in transcripts sorts first')
        assert.equal(r.cost.perModel[0].seenInTranscripts, true)
        assert.equal(r.pricing.error, null)
        assert.deepEqual(pickSummary(r), s)
      })
    } finally { fx.cleanup() }
  })

  test('a fixed character budget can be forced and produces unroutable skills', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY, budgetOpts: { fixedChars: 200 } })
        assert.equal(r.budget.source, 'SLASH_COMMAND_TOOL_CHAR_BUDGET')
        assert.equal(r.budget.chars, 200)
        assert.equal(r.economics.perSession.fitsBudget, false)
        assert.ok(r.summary.unroutable > 0)
        const flagged = r.skills.filter((s) => s.recommendation.flags.includes('unroutable'))
        assert.equal(flagged.length, r.summary.unroutable)
      })
    } finally { fx.cleanup() }
  })

  test('a broken price list degrades to no dollar figures instead of failing', async () => {
    const fx = fixture()
    try {
      const bad = join(fx.home, 'broken.json')
      writeFileSync(bad, '{ not json')
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY, pricingPath: bad })
        assert.equal(r.cost.perModel.length, 0)
        assert.equal(r.summary.wastedPerWeekOnYourModel, null)
        assert.ok(r.pricing.error, 'error text is carried in the report')
        assert.equal(r.skills.length, 6)
        const text = renderText(r, { color: false })
        assert.match(text, /No price list could be read/)
      })
    } finally { fx.cleanup() }
  })

  test('uncached mode is passed through to the cost model', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const cached = buildReport({ today: TODAY })
        const un = buildReport({ today: TODAY, cached: false })
        assert.equal(cached.cost.assumptions.cached, true)
        assert.equal(un.cost.assumptions.cached, false)
        assert.ok(un.cost.perModel[0].wasted.perWeek > cached.cost.perModel[0].wasted.perWeek)
      })
    } finally { fx.cleanup() }
  })

  test('an empty home still builds a report with assumed rates', async () => {
    const fx = makeFixtureHome({ skills: [], transcripts: [] })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        assert.equal(r.skills.length, 0)
        assert.equal(r.summary.skills, 0)
        assert.equal(r.stats.measured, false)
        assert.equal(r.summary.wastedPerWeekOnYourModel, null)
        assert.equal(r.summary.fitsAfter, true)
        const text = renderText(r)
        assert.match(text, /WHAT THE LISTING COSTS/)
      })
    } finally { fx.cleanup() }
  })
})

describe('joinCalls', () => {
  const skills = [
    { name: 'x', names: ['plug:x', 'x'], realPath: '/r/plug/x', descriptionChars: 40 },
    { name: 'x', names: ['x'], realPath: '/r/user/x', descriptionChars: 40 },
    { name: 'y', names: ['y'], realPath: '/r/user/y', descriptionChars: 10 },
  ]
  test('canonical names win over aliases and unmatched calls are tallied', () => {
    const calls = [
      { skill: 'plug:x', bare: 'x', ts: '2026-08-01T00:00:00Z', mode: 'passive' },
      { skill: 'x', bare: 'x', ts: '2026-08-02T00:00:00Z', mode: 'active' },
      { skill: 'x', bare: 'x', ts: '2026-08-03T00:00:00Z', mode: 'passive' },
      { skill: 'nope', bare: 'nope', ts: '2026-08-03T00:00:00Z', mode: 'passive' },
      { skill: 'nope', bare: 'nope', ts: '2026-08-04T00:00:00Z', mode: 'passive' },
      { skill: 'other:y', bare: 'y', ts: '2026-08-04T00:00:00Z', mode: 'passive' },
    ]
    const { rows, unmatchedCalls } = joinCalls(skills, calls, { perEntryCap: 1536 })
    assert.equal(rows[0].calls, 1, 'plug:x gets its own call')
    assert.equal(rows[1].calls, 2, 'bare x goes to the skill whose canonical name is x')
    assert.equal(rows[1].activeCalls, 1)
    assert.equal(rows[1].passiveCalls, 1)
    assert.equal(rows[1].firstSeen, '2026-08-02')
    assert.equal(rows[1].lastSeen, '2026-08-03')
    assert.equal(rows[2].calls, 1, 'a plugin prefixed call falls back to the bare name')
    assert.deepEqual(unmatchedCalls, [{ skill: 'nope', calls: 2 }])
  })
})

describe('pickSummary', () => {
  test('fills every field with null when the report has none', () => {
    const s = pickSummary({})
    assert.equal(s.skills, null)
    assert.equal(s.wastedPerWeekOnYourModel, null)
    assert.deepEqual(s.recommendedActions, { active: 0, delete: 0, optimize: 0, review: 0, keep: 0, passive: 0 })
    assert.equal(Object.keys(s).length, 12)
  })
})

describe('renderText', () => {
  test('prints every section in order, plain by default, colored on request, and no forbidden dashes', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const text = renderText(r, { color: false })
        const order = ['WHAT THE LISTING COSTS', 'WHAT IT COSTS IN DOLLARS', 'RECOMMENDED', 'HEAVIEST DESCRIPTIONS', 'THIN DESCRIPTIONS', 'NEVER CALLED', 'CALLED', 'UNMATCHED']
        let last = -1
        for (const h of order) {
          const at = text.indexOf(h)
          assert.ok(at > last, h + ' is missing or out of order')
          last = at
        }
        assert.equal(/\x1b\[/.test(text), false, 'no ANSI without color')
        assert.match(text, /Claude Opus 5/)
        assert.match(text, /ghost/)
        assert.match(text, /zeta/)
        assert.match(text, /Prices verified on 2026-08-15/)
        for (const ch of FORBIDDEN) assert.equal(text.includes(ch), false, 'forbidden dash in text report')
        const colored = renderText(r, { color: true })
        assert.ok(/\x1b\[/.test(colored), 'ANSI when color is on')
      })
    } finally { fx.cleanup() }
  })
})
