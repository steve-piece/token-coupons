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
