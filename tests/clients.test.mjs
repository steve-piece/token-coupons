// The other tools on the machine: their chats are read, their uses land on
// the same rows, and the report says what it could and could not read.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { makeFixtureHome, withHome, hasSqlite } from './helpers.mjs'
import { buildReport } from '../skills/token-coupons/src/report.mjs'
import { renderText } from '../skills/token-coupons/src/render-text.mjs'
import { renderList } from '../skills/token-coupons/src/render-list.mjs'
import { planApply, parseDecisions } from '../skills/token-coupons/src/apply.mjs'
import { discoverSkills } from '../skills/token-coupons/src/discover.mjs'

const FORBIDDEN = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))
const TODAY = '2026-08-15'
const fresh = (mod) => import('../skills/token-coupons/src/' + mod + '?' + Math.random())

describe('reading each tool\'s chats', () => {
  test('Codex: a typed $skill is a command call, a read is a context call, and neither is counted twice', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.', where: 'codex' }, { name: 'beta', description: 'Beta.', where: 'agents-dir' }],
      codex: {
        config: '',
        sessions: [{
          id: 's1', date: '2026-08-10T10:00:00Z', model: 'gpt-5.4',
          turns: [
            { user: 'do it with $alpha' },
            { skillBlock: { name: 'alpha', path: '__HOME__/.codex/skills/alpha/SKILL.md' } },
            { read: '__HOME__/.codex/skills/alpha/SKILL.md' },
            { assistant: 'ok' },
            { user: 'now the beta thing' },
            { read: '__HOME__/.agents/skills/beta/SKILL.md' },
            { read: '__HOME__/.agents/skills/beta/SKILL.md' },
            { assistant: 'done' },
          ],
        }],
      },
    })
    try {
      await withHome(fx.home, async () => {
        const { scanCodex } = await fresh('calls-codex.mjs')
        const { calls, sessions, coverage } = scanCodex()
        assert.deepEqual(calls.map((c) => [c.skill, c.mode]), [['alpha', 'command'], ['beta', 'context']])
        assert.equal(calls[0].path, join(fx.home, '.codex', 'skills', 'alpha', 'SKILL.md'))
        assert.equal(sessions.length, 1)
        assert.equal(sessions[0].apiCalls, 2)
        assert.deepEqual(sessions[0].models, { 'gpt-5.4': 2 })
        assert.equal(sessions[0].contextWindow, 258400)
        assert.equal(coverage.measured, true)
        assert.equal(coverage.sources[0].files, 1)
      })
    } finally { fx.cleanup() }
  })

  test('Codex: with no chats the coverage says so instead of reporting zero uses as a fact', async () => {
    const fx = makeFixtureHome({ skills: [], codex: { config: '' } })
    try {
      await withHome(fx.home, async () => {
        const { scanCodex } = await fresh('calls-codex.mjs')
        const { coverage } = scanCodex()
        assert.equal(coverage.measured, false)
        assert.match(coverage.notes[0], /no Codex chats found/)
      })
    } finally { fx.cleanup() }
  })

  test('Cursor command line: an attached skill is a command call, a Read is a context call, dated by the file', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.', where: 'cursor' }, { name: 'beta', description: 'Beta.', where: 'agents-dir' }],
      cursor: {
        transcripts: [{
          id: 'c1', date: '2026-08-11T10:00:00Z',
          turns: [
            { attached: [{ name: 'alpha', path: '__HOME__/.cursor/skills/alpha/SKILL.md' }], query: '/alpha go' },
            { read: '__HOME__/.cursor/skills/alpha/SKILL.md' },
            { assistant: 'ok' },
            { user: 'help me with beta' },
            { read: '__HOME__/.agents/skills/beta/SKILL.md' },
            { assistant: 'done' },
          ],
        }],
      },
    })
    try {
      await withHome(fx.home, async () => {
        const { scanCursor } = await fresh('calls-cursor.mjs')
        const { calls, sessions, coverage } = scanCursor()
        assert.deepEqual(calls.map((c) => [c.skill, c.mode, c.ts.slice(0, 10)]), [['alpha', 'command', '2026-08-11'], ['beta', 'context', '2026-08-11']])
        assert.equal(sessions.filter((s) => s.source === 'cli').length, 1)
        assert.equal(coverage.sources[0].files, 1)
        assert.equal(coverage.sources[0].read, true)
      })
    } finally { fx.cleanup() }
  })

  test('Cursor app: read through node:sqlite when this Node has it, and said to be unread otherwise', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.', where: 'cursor' }, { name: 'beta', description: 'Beta.', where: 'agents-dir' }],
      cursor: {
        app: {
          composers: [{
            id: 'comp1', createdAt: '2026-08-12T10:00:00Z', model: 'claude-4.5-opus',
            bubbles: [
              { user: '/alpha please' },
              { read: '__HOME__/.cursor/skills/alpha/SKILL.md' },
              { user: 'and the beta one' },
              { read: '__HOME__/.agents/skills/beta/SKILL.md' },
            ],
          }],
        },
      },
    })
    try {
      await withHome(fx.home, async () => {
        const { scanCursor } = await fresh('calls-cursor.mjs')
        const { calls, sessions, coverage } = scanCursor()
        const app = coverage.sources.find((s) => s.label === 'Cursor app chats')
        if (hasSqlite()) {
          assert.equal(app.read, true)
          assert.equal(app.files, 1)
          assert.deepEqual(calls.map((c) => [c.skill, c.mode]), [['alpha', 'command'], ['beta', 'context']])
          assert.equal(calls[0].ts.slice(0, 10), '2026-08-12')
          const s = sessions.find((x) => x.source === 'app')
          assert.deepEqual(s.models, { 'claude-4.5-opus': 1 })
        } else {
          assert.equal(app.read, false)
          assert.equal(calls.length, 0)
          assert.ok(coverage.notes.some((n) => /node:sqlite/.test(n)), 'the report says why the app chats were not read')
        }
      })
    } finally { fx.cleanup() }
  })

  test('Gemini CLI: activate_skill is the call, typed when the message before names it', async () => {
    const fx = makeFixtureHome({
      skills: [{ name: 'alpha', description: 'Alpha.', where: 'gemini' }, { name: 'beta', description: 'Beta.', where: 'gemini' }],
      gemini: {
        chats: [{
          name: 'session-1', date: '2026-08-13T10:00:00Z',
          messages: [
            { role: 'user', text: '/alpha now' }, { role: 'model', activate: 'alpha' },
            { role: 'user', text: 'something about beta' }, { role: 'model', activate: 'beta' },
          ],
        }],
      },
    })
    try {
      await withHome(fx.home, async () => {
        const { scanGemini } = await fresh('calls-gemini.mjs')
        const { calls, sessions, coverage } = scanGemini()
        assert.deepEqual(calls.map((c) => [c.skill, c.mode]), [['alpha', 'command'], ['beta', 'context']])
        assert.equal(sessions.length, 1)
        assert.equal(coverage.measured, true)
      })
    } finally { fx.cleanup() }
  })
})

/** One skill kept in the shared folder, linked into Claude Code and Cursor, read by Codex and Cursor, never by Claude Code. */
function shared () {
  return makeFixtureHome({
    today: TODAY,
    skills: [
      { name: 'alpha', description: 'Alpha does a great many useful things for a great many people every single day.', where: 'agents-dir', symlinkAs: 'alpha', cursorSymlinkAs: 'alpha', mtimeDaysAgo: 200 },
      { name: 'beta', description: 'Beta is a plain Claude Code skill that Cursor also sees and picks.', mtimeDaysAgo: 200 },
      { name: 'gamma', description: 'Gamma lives with Gemini CLI and is linked into Claude Code, and has a description long enough to route to.', where: 'gemini', symlinkAs: 'gamma', mtimeDaysAgo: 200 },
    ],
    transcripts: [{ session: 's1', date: '2026-08-10T10:00:00Z', turns: [{ user: 'hi' }, { assistant: 'hello' }] }],
    codex: {
      config: '',
      sessions: [{ id: 'cx', date: '2026-08-10T10:00:00Z', turns: [{ user: 'alpha?' }, { read: '__HOME__/.agents/skills/alpha/SKILL.md' }, { assistant: 'ok' }] }],
    },
    cursor: {
      transcripts: [{
        id: 'cu', date: '2026-08-11T10:00:00Z',
        turns: [
          // alpha typed by name (a command call); beta read on the agent's own initiative (a context call)
          { user: '/alpha please' }, { read: '__HOME__/.cursor/skills/alpha/SKILL.md' },
          { user: 'help' }, { read: '__HOME__/.claude/skills/beta/SKILL.md' }, { assistant: 'ok' },
        ],
      }],
    },
    gemini: {},
  })
}

describe('one row, every tool', () => {
  test('uses from every tool land on the same row, beside Claude Code\'s own, and the report says what each tool could read', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const by = Object.fromEntries(r.skills.map((s) => [s.name, s]))
        assert.equal(by.alpha.calls, 0, 'Claude Code never used it')
        assert.equal(by.alpha.callsByClient.codex.calls, 1)
        assert.equal(by.alpha.callsByClient.codex.contextCalls, 1)
        assert.equal(by.alpha.callsByClient.cursor.calls, 1)
        assert.equal(by.alpha.callsByClient.cursor.commandCalls, 1, 'typed by name in Cursor')
        assert.equal(by.alpha.callsElsewhere, 2)
        assert.equal(by.alpha.callsAllClients, 2)
        assert.equal(by.alpha.lastSeenAnywhere, '2026-08-11')
        assert.deepEqual(by.alpha.listedIn, ['claude', 'codex', 'cursor'])
        assert.deepEqual(by.alpha.unmeasuredClients, [])
        assert.deepEqual(by.gamma.listedIn, ['claude', 'cursor', 'gemini'], 'Cursor reads ~/.claude/skills, so the shortcut counts there too')
        assert.deepEqual(by.gamma.unmeasuredClients, ['gemini'], 'Gemini CLI is here but left no chats; Cursor was read')
        assert.deepEqual(r.clients.map((c) => c.id), ['claude', 'codex', 'cursor', 'gemini'])
        const codex = r.clients.find((c) => c.id === 'codex')
        assert.equal(codex.sessions, 1)
        assert.equal(codex.skillCalls, 1)
        assert.equal(codex.callsMatched, 1)
        assert.equal(codex.skills, 1, 'Codex lists only the shared folder skill')
        assert.ok(codex.budget && codex.budget.chars > 0)
        assert.equal(codex.honoursGate, false)
        const gemini = r.clients.find((c) => c.id === 'gemini')
        assert.equal(gemini.coverage.measured, false)
        assert.equal(r.totals.callsElsewhere, 3)
        assert.equal(r.totals.usedElsewhere, 2)
        assert.deepEqual(r.totals.clientsRead, ['claude', 'codex', 'cursor', 'gemini'])
      })
    } finally { fx.cleanup() }
  })

  test('a stale skill used in another tool is gated, not deleted, and the reason says which tool', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const alpha = r.skills.find((s) => s.name === 'alpha')
        assert.equal(alpha.recommendation.action, 'command')
        assert.ok(alpha.recommendation.flags.includes('stale'))
        assert.ok(alpha.recommendation.flags.includes('used-elsewhere'))
        assert.match(alpha.recommendation.reason, /Used 2 times in Codex and Cursor, so keep the folder/)
      })
    } finally { fx.cleanup() }
  })

  test('a skill Cursor\'s agent picked on its own is kept, because the gate would take it away there too', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const beta = r.skills.find((s) => s.name === 'beta')
        assert.deepEqual(beta.listedIn, ['claude', 'cursor'])
        assert.equal(beta.recommendation.action, 'keep')
        assert.ok(beta.recommendation.flags.includes('picked-elsewhere'))
        assert.match(beta.recommendation.reason, /Cursor did \(1 times\) and reads the same setting/)
        assert.equal(beta.recommendation.impactTokensPerCall, 0)
      })
    } finally { fx.cleanup() }
  })

  test('a stale skill is gated rather than deleted when a tool that lists it had no readable chats', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const gamma = r.skills.find((s) => s.name === 'gamma')
        assert.equal(gamma.recommendation.action, 'command')
        assert.ok(gamma.recommendation.flags.includes('usage-unmeasured'))
        assert.match(gamma.recommendation.reason, /Gemini CLI lists it too and its chats could not be read, so it is gated rather than deleted/)
      })
    } finally { fx.cleanup() }
  })

  test('the stale delete still fires when nobody anywhere has used it and every listing tool was read', async () => {
    const fx = makeFixtureHome({
      today: TODAY,
      skills: [{ name: 'lonely', description: 'Lonely has never been opened by anyone in any tool at all, and its description is long enough to route to.', mtimeDaysAgo: 200 }],
      transcripts: [{ session: 's1', date: '2026-08-10T10:00:00Z', turns: [{ user: 'hi' }, { assistant: 'hello' }] }],
      cursor: { transcripts: [{ id: 'cu', date: '2026-08-11T10:00:00Z', turns: [{ user: 'hi' }, { assistant: 'ok' }] }] },
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const [lonely] = r.skills
        assert.deepEqual(lonely.listedIn, ['claude', 'cursor'])
        assert.equal(lonely.recommendation.action, 'delete')
      })
    } finally { fx.cleanup() }
  })

  test('a skill only another tool lists is reported as not in Claude Code\'s list, with its uses, and never priced', async () => {
    const fx = makeFixtureHome({
      today: TODAY,
      skills: [{ name: 'solo', description: 'Solo is a Codex skill.', where: 'codex' }],
      codex: { config: '', sessions: [{ id: 'cx', date: '2026-08-10T10:00:00Z', turns: [{ user: 'x' }, { read: '__HOME__/.codex/skills/solo/SKILL.md' }, { assistant: 'ok' }] }] },
    })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        assert.equal(r.skills.length, 0)
        assert.equal(r.notLoaded.length, 1)
        const [solo] = r.notLoaded
        assert.match(solo.reason, /a Codex skill; Claude Code does not read that folder/)
        assert.deepEqual(solo.listedIn, ['codex'])
        assert.equal(solo.callsAllClients, 1)
        assert.equal(r.totals.listedByOtherToolsOnly, 1)
      })
    } finally { fx.cleanup() }
  })
})

describe('what the readers see', () => {
  test('the text report has an OTHER TOOLS section, an elsewhere column, and no forbidden dashes', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const text = renderText(buildReport({ today: TODAY }))
        assert.match(text, /Also on this machine: Codex, Cursor, Gemini CLI/)
        assert.match(text, /\nOTHER TOOLS\n/)
        assert.match(text, /Codex\n\s+In its list: 1 skills?, about \d+ tokens per message \(room for about/)
        assert.match(text, /Ignores disable-model-invocation: a command decision here changes nothing in Codex/)
        assert.match(text, /Cursor[\s\S]*Reads disable-model-invocation, so a command decision here applies there too/)
        assert.match(text, /no Gemini CLI chats found/)
        assert.match(text, /alpha \(Codex 1, Cursor 1\)/, 'never called in Claude Code, used next door')
        assert.match(text, /2 of these were used in another tool/)
        for (const ch of FORBIDDEN) assert.equal(text.includes(ch), false)
      })
    } finally { fx.cleanup() }
  })

  test('the decision page tags the row, counts the other tools in the Used column, and says who else lists it', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const html = renderList(buildReport({ today: TODAY }))
        assert.match(html, /Other tools on this machine/)
        assert.match(html, /<b>Codex<\/b> lists 1 skills/)
        assert.match(html, /also listed by Codex and Cursor/)
        assert.match(html, /class="elsewhere" title="also used in Codex 1 \(last 2026-08-10\), Cursor 1 \(last 2026-08-11\)">\+2</)
        assert.match(html, />used elsewhere</)
        assert.match(html, />picked elsewhere</)
        assert.match(html, />usage unknown</)
        assert.match(html, /Cursor reads that line too\. Codex and Gemini CLI do not\./)
        for (const ch of FORBIDDEN) assert.equal(html.includes(ch), false)
      })
    } finally { fx.cleanup() }
  })

  test('a command step says Cursor reads the same line when Cursor lists the skill', async () => {
    const fx = shared()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills({ cwd: fx.home })
        const plan = planApply(parseDecisions(JSON.stringify({ version: 1, decisions: [{ name: 'beta', action: 'command' }] })).decisions, { skills })
        const step = plan.steps.find((s) => s.kind === 'set-gate')
        assert.ok(step, 'a gate step was planned')
        assert.match(step.detail, /Cursor reads the same line/)
      })
    } finally { fx.cleanup() }
  })
})
