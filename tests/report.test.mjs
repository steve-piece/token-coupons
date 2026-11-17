import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeFixtureHome, withHome } from './helpers.mjs'
import { buildReport, pickSummary, joinCalls, toolVersion } from '../skills/token-coupons/src/report.mjs'
import { renderText } from '../skills/token-coupons/src/render-text.mjs'

const FORBIDDEN = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))
const TODAY = '2026-08-15'

const LONG = 'Use this whenever someone wants the alpha treatment for a file, a folder, a repo, or a whole workspace, ' +
  'including all the edge cases a newcomer would not think of. It reads, checks, fixes and reports. '.repeat(3)

function fixture () {
  return makeFixtureHome({
    // Ages count back from the day the report is told it is, so these stay
    // fixed no matter when the suite runs.
    today: TODAY,
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
        assert.equal(r.totals.declaredCommand, 1)
        assert.equal(r.totals.declaredContext, 5)
        assert.equal(r.totals.transcriptsRead, 2)
        assert.equal(r.totals.callsTotal, 4)
        assert.equal(r.totals.callsMatched, 3)
        assert.equal(r.totals.calledSkills, 2)
        assert.equal(r.totals.neverCalled, 4)
        assert.equal(r.totals.neverCalledCommand, 1)
        assert.equal(r.totals.neverCalledContext, 3)
        assert.deepEqual(r.unmatchedCalls, [{ client: 'claude', skill: 'ghost', calls: 1 }])
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
        assert.equal(by.alpha.contextCalls, 2)
        assert.equal(by.alpha.commandCalls, 0)
        assert.equal(by.alpha.firstSeen, '2026-08-10')
        assert.equal(by.alpha.lastSeen, '2026-08-10')
        assert.equal(by.eps.calls, 1)
        assert.equal(by.eps.commandCalls, 1)
        assert.equal(by.eps.contextCalls, 0)
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
        assert.equal(by.gamma.recommendation.action, 'command')
        assert.ok(by.gamma.recommendation.flags.includes('not-editable'))
        assert.equal(by.delta.recommendation.action, 'review')
        assert.equal(by.eps.recommendation.action, 'command')
        assert.ok(by.eps.recommendation.flags.includes('summoned-only'))
        assert.equal(by.zeta.recommendation.action, 'optimize')
        assert.ok(by.zeta.recommendation.flags.includes('thin-description'))
        assert.equal(r.thin.length, 1)
        assert.equal(r.heaviest[0].name, 'alpha')
        assert.deepEqual(r.summary.recommendedActions, { command: 2, delete: 1, optimize: 1, review: 1, keep: 1, context: 0 })
      })
    } finally { fx.cleanup() }
  })

  test('summary has every field, and prices the waste on the model the transcripts used', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const s = r.summary
        for (const k of ['skills', 'listingTokensPerCall', 'overBudgetRatio', 'neverCalledContext', 'unroutable', 'summonedOnly',
          'wastedTokensPerCall', 'savedTokensPerCallIfApplied', 'fitsAfter', 'wastedPerWeekOnYourModel', 'recommendedActions']) {
          assert.ok(k in s, 'summary is missing ' + k)
        }
        assert.equal(s.skills, 6)
        assert.equal(s.neverCalledContext, 3)
        assert.equal(s.summonedOnly, 1)
        assert.equal(s.unroutable, 0)
        assert.equal(s.listingTokensPerCall, r.economics.perSession.totalListingTokens)
        assert.equal(s.wastedTokensPerCall, r.economics.wastedPerCall.tokens)
        // The headline saving is the sum of the rows that act, so a person can
        // add the column up and get it. It used to be the figure for gating
        // every unused skill, which promised tokens for rows marked keep.
        const acted = r.skills.filter((x) => ['command', 'delete', 'optimize'].includes(x.recommendation.action))
        assert.equal(s.savedTokensPerCallIfApplied, acted.reduce((n, x) => n + x.recommendation.impactTokensPerCall, 0))
        assert.equal(s.savedTokensPerCallIfApplied, r.economics.ifApplied.tokens)
        assert.equal(r.economics.ifApplied.count, acted.length)
        assert.equal(s.savedOnYourModel.tokens, s.savedTokensPerCallIfApplied)
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
      { skill: 'plug:x', bare: 'x', ts: '2026-08-01T00:00:00Z', mode: 'context' },
      { skill: 'x', bare: 'x', ts: '2026-08-02T00:00:00Z', mode: 'command' },
      { skill: 'x', bare: 'x', ts: '2026-08-03T00:00:00Z', mode: 'context' },
      { skill: 'nope', bare: 'nope', ts: '2026-08-03T00:00:00Z', mode: 'context' },
      { skill: 'nope', bare: 'nope', ts: '2026-08-04T00:00:00Z', mode: 'context' },
      { skill: 'other:y', bare: 'y', ts: '2026-08-04T00:00:00Z', mode: 'context' },
    ]
    const { rows, unmatchedCalls } = joinCalls(skills, calls, { perEntryCap: 1536 })
    assert.equal(rows[0].calls, 1, 'plug:x gets its own call')
    assert.equal(rows[1].calls, 2, 'bare x goes to the skill whose canonical name is x')
    assert.equal(rows[1].commandCalls, 1)
    assert.equal(rows[1].contextCalls, 1)
    assert.equal(rows[1].firstSeen, '2026-08-02')
    assert.equal(rows[1].lastSeen, '2026-08-03')
    assert.equal(rows[2].calls, 1, 'a plugin prefixed call falls back to the bare name')
    assert.deepEqual(unmatchedCalls, [{ client: 'claude', skill: 'nope', calls: 2 }])
    assert.equal(rows[1].recentCalls, 0, 'with no window given, nothing counts as recent')
  })

  test('counts the calls inside the recent window, per skill and per tool', () => {
    const calls = [
      { skill: 'x', bare: 'x', ts: '2026-07-01T00:00:00Z', mode: 'context' },
      { skill: 'x', bare: 'x', ts: '2026-08-02T00:00:00Z', mode: 'command' },
      { skill: 'x', bare: 'x', ts: '2026-08-03T00:00:00Z', mode: 'context' },
      { skill: 'y', bare: 'y', ts: '2026-07-31T23:59:59Z', mode: 'context' },
      { client: 'cursor', skill: 'y', bare: 'y', ts: '2026-08-05T00:00:00Z', mode: 'context' },
    ]
    const { rows } = joinCalls(skills, calls, { perEntryCap: 1536 }, { recentSince: '2026-08-01' })
    assert.equal(rows[1].calls, 3)
    assert.equal(rows[1].recentCalls, 2, 'the July call is outside the window')
    assert.equal(rows[2].recentCalls, 0, 'one second before the window is still before it')
    assert.equal(rows[2].callsByClient.cursor.recent, 1, 'another tool keeps its own count, and it is not Claude Code')
  })
})

describe('the saving is what the recommendations give back', () => {
  const sum = (r) => r.skills
    .filter((x) => ['command', 'delete', 'optimize'].includes(x.recommendation.action))
    .reduce((n, x) => n + x.recommendation.impactTokensPerCall, 0)

  test('a skill kept for being new is not counted, though gating everything would count it', async () => {
    const long = 'Does a long list of things for a long list of people on a long list of occasions, every one of them useful.'
    const fx = makeFixtureHome({
      today: TODAY,
      skills: [
        { name: 'old', description: long, mtimeDaysAgo: 40 },
        { name: 'fresh', description: long, mtimeDaysAgo: 3 },
      ],
      transcripts: [{ session: 's', date: '2026-08-10T10:00:00Z', turns: [{ user: 'hi' }, { assistant: 'hello' }] }],
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const by = Object.fromEntries(r.skills.map((s) => [s.name, s]))
        assert.equal(by.old.recommendation.action, 'command')
        assert.equal(by.fresh.recommendation.action, 'keep')
        assert.equal(r.summary.savedTokensPerCallIfApplied, by.old.recommendation.impactTokensPerCall, 'one row acts, so the saving is that row')
        assert.ok(r.economics.ifGated.savedTokensPerSession > r.summary.savedTokensPerCallIfApplied, 'gating both would save more, and is not what is recommended')
        const text = renderText(r)
        assert.match(text, /Take the 1 suggestion below and you save about \d+ tokens on every message\./)
        assert.equal(/Set those/.test(text), false)
        // The saving is stated and that is all: an account of what was not
        // suggested, and why, read as a second number to puzzle over.
        assert.equal(/left alone|more unused skill/.test(text), false)
        assert.equal('leftAlone' in r.economics.ifApplied, false)
      })
    } finally { fx.cleanup() }
  })

  test('a skill another tool picks is not counted either', async () => {
    const long = 'Does a long list of things for a long list of people on a long list of occasions, every one of them useful.'
    const fx = makeFixtureHome({
      today: TODAY,
      skills: [
        { name: 'mine', description: long, mtimeDaysAgo: 40 },
        { name: 'theirs', description: long, mtimeDaysAgo: 40 },
      ],
      transcripts: [{ session: 's', date: '2026-08-10T10:00:00Z', turns: [{ user: 'hi' }, { assistant: 'hello' }] }],
      cursor: { transcripts: [{ id: 'c', date: '2026-08-11T10:00:00Z', turns: [{ user: 'help' }, { read: '__HOME__/.claude/skills/theirs/SKILL.md' }, { assistant: 'ok' }] }] },
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        assert.equal(r.summary.savedTokensPerCallIfApplied, sum(r))
        assert.equal(r.economics.ifApplied.count, 1)
        const by = Object.fromEntries(r.skills.map((x) => [x.name, x]))
        assert.equal(by.theirs.recommendation.action, 'keep')
        assert.equal(r.summary.savedTokensPerCallIfApplied, by.mine.recommendation.impactTokensPerCall)
      })
    } finally { fx.cleanup() }
  })

  test('a shortened description counts, which gating alone never did', async () => {
    const heavy = 'Use this whenever someone wants the heavy treatment for a file, a folder or a repo. '.repeat(10)
    const fx = makeFixtureHome({
      today: TODAY,
      skills: [{ name: 'heavy', description: heavy, mtimeDaysAgo: 40 }],
      transcripts: [{ session: 's', date: '2026-08-10T10:00:00Z', turns: [{ user: 'do it' }, { skill: 'heavy' }] }],
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const [row] = r.skills
        assert.equal(row.recommendation.action, 'optimize')
        assert.ok(row.recommendation.impactTokensPerCall > 0)
        assert.equal(r.economics.ifGated.savedTokensPerSession, 0, 'nothing is unused, so gating everything unused saves nothing')
        assert.equal(r.summary.savedTokensPerCallIfApplied, row.recommendation.impactTokensPerCall)
        assert.ok(r.summary.savedOnYourModel.dollarsPerMonth > 0, 'priced off the whole list when nothing is wasted')
      })
    } finally { fx.cleanup() }
  })

  test('the dollars follow the tokens: the same price per token as the waste', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const s = buildReport({ today: TODAY }).summary
        const perToken = s.wastedPerWeekOnYourModel.dollarsPerMonth / s.wastedTokensPerCall
        assert.ok(Math.abs(s.savedOnYourModel.dollarsPerMonth - perToken * s.savedTokensPerCallIfApplied) < 0.001)
        assert.ok(s.savedOnYourModel.dollarsPerMonth <= s.wastedPerWeekOnYourModel.dollarsPerMonth)
      })
    } finally { fx.cleanup() }
  })

  test('fits afterwards is judged on what the recommendations free, not on gating everything', async () => {
    const long = 'Does a long list of things for a long list of people on a long list of occasions, every one of them useful.'
    const fx = makeFixtureHome({
      today: TODAY,
      skills: [
        { name: 'old', description: long, mtimeDaysAgo: 40 },
        { name: 'fresh', description: long, mtimeDaysAgo: 3 },
        { name: 'fresher', description: long, mtimeDaysAgo: 2 },
      ],
      transcripts: [{ session: 's', date: '2026-08-10T10:00:00Z', turns: [{ user: 'hi' }, { assistant: 'hello' }] }],
    })
    try {
      await withHome(fx.home, () => {
        // room for two of the three descriptions, so one has to go
        const r = buildReport({ today: TODAY, budgetOpts: { fixedChars: 150 } })
        assert.equal(r.economics.perSession.fitsBudget, false)
        assert.equal(r.economics.ifGated.fitsBudgetAfter, true, 'gating all three would fit')
        assert.equal(r.summary.fitsAfter, false, 'but only one is recommended, and that is not enough')
        assert.match(renderText(r), /though the list is still over its allowance\./)
      })
    } finally { fx.cleanup() }
  })
})

describe('what was used lately', () => {
  test('counts listed skills used in the last thirty days, and the uses, from the day the report is told it is', async () => {
    const fx = makeFixtureHome({
      today: '2026-08-15',
      skills: [
        { name: 'now', description: 'Used this month by the agent, and so it counts as recent use.', mtimeDaysAgo: 60 },
        { name: 'then', description: 'Used long ago and not since, so it was used but not lately.', mtimeDaysAgo: 60 },
        { name: 'never', description: 'Never used by anyone at all in any session that was read.', mtimeDaysAgo: 60 },
      ],
      transcripts: [
        { session: 'old', date: '2026-06-01T10:00:00Z', turns: [{ user: 'a' }, { skill: 'then' }, { user: 'b' }, { skill: 'now' }] },
        { session: 'new', date: '2026-08-10T10:00:00Z', turns: [{ user: 'c' }, { skill: 'now' }, { user: 'd' }, { skill: 'now' }] },
      ],
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: '2026-08-15' })
        assert.deepEqual(r.totals.usedRecently, { days: 30, skills: 1, uses: 2 })
        assert.equal(r.totals.calledSkills, 2, 'used ever is still its own count')
        const by = Object.fromEntries(r.skills.map((s) => [s.name, s]))
        assert.equal(by.now.recentCalls, 2)
        assert.equal(by.now.calls, 3)
        assert.equal(by.then.recentCalls, 0)
      })
    } finally { fx.cleanup() }
  })

  test('never claims a longer window than the history that was read', async () => {
    const fx = makeFixtureHome({
      today: '2026-08-15',
      skills: [{ name: 'now', description: 'Used in the only week of history there is on this machine.', mtimeDaysAgo: 60 }],
      transcripts: [{ session: 'new', date: '2026-08-08T10:00:00Z', turns: [{ user: 'c' }, { skill: 'now' }] }],
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: '2026-08-15' })
        assert.equal(r.totals.usedRecently.days, 7, 'seven days of sessions, so seven days is what it says')
        assert.equal(r.totals.usedRecently.skills, 1)
        const since = buildReport({ today: '2026-08-15', since: '2026-08-12' })
        assert.equal(since.totals.usedRecently.days, 3, 'a --since inside the month shortens the window to match')
        assert.equal(since.totals.usedRecently.skills, 0)
      })
    } finally { fx.cleanup() }
  })

  test('with no history at all it says thirty days and zero, not a guess', async () => {
    const fx = makeFixtureHome({ skills: [{ name: 'a', description: 'A skill on a machine with no sessions at all yet.' }] })
    try {
      await withHome(fx.home, () => {
        assert.deepEqual(buildReport({ today: '2026-08-15' }).totals.usedRecently, { days: 30, skills: 0, uses: 0 })
      })
    } finally { fx.cleanup() }
  })
})

describe('pickSummary', () => {
  test('fills every field with null when the report has none', () => {
    const s = pickSummary({})
    assert.equal(s.skills, null)
    assert.equal(s.wastedPerWeekOnYourModel, null)
    assert.deepEqual(s.recommendedActions, { command: 0, delete: 0, optimize: 0, review: 0, keep: 0, context: 0 })
    assert.equal(Object.keys(s).length, 13)
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
