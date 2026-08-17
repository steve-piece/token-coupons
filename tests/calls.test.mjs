import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeFixtureHome, withHome } from './helpers.mjs'

describe('calls and sessions', () => {
  test('classifies summoned vs routed, counts API calls once per requestId, sums usage', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.' }, { name: 'beta', description: 'Beta.' }],
      transcripts: [{
        session: 's1', date: '2026-08-10T10:00:00Z',
        turns: [
          { user: 'please /alpha now' }, { skill: 'alpha' },
          { user: 'do the beta thing' }, { skill: 'beta', usage: { cacheRead: 5000, cacheWrite: 100 } },
          { assistant: 'done', split: true, usage: { cacheRead: 7000 } },
        ],
      }],
    })
    try {
      await withHome(fx.home, async () => {
        const { scanTranscripts, sessionStats } = await import('../src/calls.mjs?' + Math.random())
        const { calls, sessions } = scanTranscripts()
        assert.equal(calls.length, 2)
        assert.equal(calls.find((c) => c.skill === 'alpha').mode, 'active')
        assert.equal(calls.find((c) => c.skill === 'beta').mode, 'passive')
        assert.equal(sessions.length, 1)
        assert.equal(sessions[0].apiCalls, 3, 'split response counted once')
        assert.equal(sessions[0].cacheReadTokens, 1000 + 5000 + 7000)
        const st = sessionStats(sessions, { today: '2026-08-17' })
        assert.equal(st.measured, true)
        assert.equal(st.sessions, 1)
        assert.equal(st.apiCallsPerSessionMedian, 3)
        assert.ok(st.inputTokensPerWeek > 0)
        assert.equal(st.modelsSeen[0].model, 'claude-opus-5')
      })
    } finally { fx.cleanup() }
  })

  test('since filter drops older calls and falls back to assumptions with no history', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.' }],
      transcripts: [{ session: 'old', date: '2026-01-01T10:00:00Z', turns: [{ user: 'x' }, { skill: 'alpha' }] }],
    })
    try {
      await withHome(fx.home, async () => {
        const { scanTranscripts, sessionStats } = await import('../src/calls.mjs?' + Math.random())
        const { calls, sessions } = scanTranscripts('2026-06-01')
        assert.equal(calls.length, 0)
        assert.equal(sessions.length, 0)
        const st = sessionStats(sessions)
        assert.equal(st.measured, false)
        assert.equal(st.apiCallsPerSessionMedian, 25)
      })
    } finally { fx.cleanup() }
  })
})

describe('prompt cache breaks', () => {
  // The listing rides in the system prompt, at the front of the saved prefix,
  // so it is re-saved whenever the front of the request stops matching.
  const usage = { miss: { cacheWrite: 40000, cacheRead: 0 }, hit: { cacheWrite: 500, cacheRead: 40000 } }

  test('counts a break only when the usage and a cause agree', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.' }],
      transcripts: [{
        session: 's1',
        turns: [
          { assistant: 'first request of the chat', usage: usage.miss },
          { assistant: 'ordinary turn', usage: usage.hit },
          // a big file read writes more than it reads, but nothing invalidated
          // the front of the request, so this is not a break
          { assistant: 'read a huge file', usage: { cacheWrite: 60000, cacheRead: 41000 } },
          { assistant: 'switched model', model: 'claude-fable-5', usage: usage.miss },
          // same model as the turn before it, so the gap is the only cause
          { assistant: 'back after lunch', model: 'claude-fable-5', gapMinutes: 180, usage: usage.miss },
          // a model switch on a request that was mostly cached anyway costs
          // nothing, so it is not counted either
          { assistant: 'switch back to the first model', model: 'claude-opus-5', usage: usage.hit },
        ],
      }],
    })
    try {
      await withHome(fx.home, async () => {
        const { scanTranscripts, sessionStats } = await import('../src/calls.mjs?' + Math.random())
        const { sessions } = scanTranscripts()
        const s = sessions[0]
        assert.equal(s.apiCalls, 6)
        assert.equal(s.listingWrites, 3, 'chat start, model switch, expiry')
        assert.deepEqual(s.cacheBreaks, { firstOfSession: 1, modelSwitch: 1, effortSwitch: 0, cacheExpired: 1 })
        const st = sessionStats(sessions, { today: '2026-08-17' })
        assert.equal(st.listingWritesPerSession, 3)
        assert.equal(st.cacheBreaksTotal, 3)
        assert.equal(st.cacheTtlMinutes, 60)
      })
    } finally { fx.cleanup() }
  })

  test('an effort switch breaks it, and the expiry window is configurable', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.' }],
      transcripts: [{
        session: 's1',
        turns: [
          { assistant: 'start', effort: 'high', usage: usage.miss },
          { assistant: 'same effort', effort: 'high', usage: usage.hit },
          { assistant: 'effort changed', effort: 'low', usage: usage.miss },
          { assistant: 'ten minute gap', gapMinutes: 10, effort: 'low', usage: usage.miss },
        ],
      }],
    })
    try {
      await withHome(fx.home, async () => {
        const { scanTranscripts } = await import('../src/calls.mjs?' + Math.random())
        const hour = scanTranscripts(null).sessions[0]
        assert.equal(hour.cacheBreaks.effortSwitch, 1)
        assert.equal(hour.cacheBreaks.cacheExpired, 0, 'ten minutes is inside the default hour')
        const short = scanTranscripts(null, { cacheTtlMinutes: 5 }).sessions[0]
        assert.equal(short.cacheBreaks.cacheExpired, 1, 'on a five minute window the same gap is an expiry')
      })
    } finally { fx.cleanup() }
  })

  test('with no history the writes fall back to one per chat', async () => {
    const fx = makeFixtureHome({ skills: [{ name: 'alpha', description: 'Alpha.' }] })
    try {
      await withHome(fx.home, async () => {
        const { sessionStats } = await import('../src/calls.mjs?' + Math.random())
        const st = sessionStats([])
        assert.equal(st.listingWritesPerSession, 1)
        assert.equal(st.measured, false)
      })
    } finally { fx.cleanup() }
  })
})
