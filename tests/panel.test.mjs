// The panel: the report cut down for a small live view, and the command that
// prints it. The mod that draws it is tested inside Claude Code itself
// (tests/mod.test.tsx, `claude plugin test .`); everything here runs on a bare
// Node, which is the half a standalone skill install actually has.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeFixtureHome, withHome } from './helpers.mjs'
import { buildReport } from '../skills/token-coupons/src/report.mjs'
import { panelOf, panelFromRun, emptyPanel, PANEL_VERSION, DEFAULT_PANEL_ROWS } from '../skills/token-coupons/src/render-panel.mjs'
import { statusText } from '../hooks/token-coupons.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'skills', 'token-coupons', 'bin', 'token-coupons.mjs')
const TODAY = '2026-08-15'
const FORBIDDEN = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))

function fixture () {
  return makeFixtureHome({
    today: TODAY,
    skills: [
      { name: 'alpha', description: 'Alpha does the alpha thing whenever anyone asks for it, and it is well used by everyone.', mtimeDaysAgo: 30 },
      { name: 'beta', description: 'Beta has never been used by anyone at all, and it sits in the user folder gathering dust.', mtimeDaysAgo: 200 },
      { name: 'gamma', description: 'Gamma lives inside a plugin cache and nobody has ever asked for it in any session.', where: 'plugin-cache', plugin: 'plug', mtimeDaysAgo: 30 },
      { name: 'delta', description: 'Delta is only ever started by the person typing its name, never picked by the agent.', mtimeDaysAgo: 30 },
    ],
    transcripts: [{
      session: 's1', date: '2026-08-10T10:00:00Z',
      turns: [{ user: 'do alpha' }, { skill: 'alpha' }, { user: '/delta now' }, { skill: 'delta' }, { assistant: 'ok' }],
    }],
    settings: { model: 'claude-opus-5[1m]' },
    codex: { config: '' },
  })
}

function run (args, home) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { TOKEN_COUPONS_HOME: home, NO_COLOR: '1' }),
  })
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' }
}

describe('panelOf', () => {
  test('carries the same numbers the report does, and only the rows worth acting on', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const p = panelOf(r)
        assert.equal(p.version, PANEL_VERSION)
        assert.equal(p.state, 'measured')
        assert.equal(p.generatedOn, TODAY)
        assert.equal(p.listing.skills, r.summary.skills)
        assert.equal(p.listing.tokens, r.summary.listingTokensPerCall)
        assert.equal(p.listing.allowanceTokens, r.budget.tokens)
        assert.equal(p.listing.fits, true)
        assert.equal(p.counts.neverUsed, r.summary.neverCalledContext)
        assert.equal(p.counts.neverUsedTokens, r.economics.neverCalledContext.tokens)
        assert.equal(p.counts.typedOnly, 1)
        assert.equal(p.counts.typedOnlyTokens, r.economics.summonedOnlyContext.tokens)
        assert.equal(p.wastedTokens, r.summary.wastedTokensPerCall)
        assert.equal(p.saving.tokens, r.summary.savedTokensPerCallIfApplied)
        assert.deepEqual(p.actions, r.summary.recommendedActions)
        assert.equal(typeof p.score.score, 'number')
        // rows: everything but keep, in the report's own rank order
        const expected = r.skills.filter((s) => s.recommendation.action !== 'keep')
        assert.deepEqual(p.top.map((t) => t.name), expected.map((s) => s.names[0]))
        assert.deepEqual(p.top.map((t) => t.saves), expected.map((s) => s.recommendation.impactTokensPerCall))
        assert.equal(p.top.some((t) => t.action === 'keep'), false)
        assert.equal(p.more, 0)
        // one line per other tool on the machine, and never Claude Code itself
        assert.deepEqual(p.tools.map((t) => t.id), ['codex'])
        assert.equal(p.tools[0].readsGate, false)
        // the overlap between the lists rides along, so a view never has to guess it
        assert.equal(p.tools[0].alsoInClaude, r.clients.find((c) => c.id === 'codex').alsoInClaude)
        assert.equal(p.listing.alsoElsewhere, r.clients.find((c) => c.id === 'claude').alsoElsewhere)
        // and the one total a short list leads with: every skill some tool lists, counted once
        assert.equal(p.installed, r.totals.listedByAnyTool)
        assert.equal(p.installed, r.totals.skills + r.totals.listedByOtherToolsOnly)
        assert.match(p.tools[0].notes[0], /no Codex chats found/)
      })
    } finally { fx.cleanup() }
  })

  test('rows are capped, and what was cut is counted rather than dropped silently', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const all = r.skills.filter((s) => s.recommendation.action !== 'keep').length
        const p = panelOf(r, { rows: 1 })
        assert.equal(p.top.length, 1)
        assert.equal(p.more, all - 1)
        assert.equal(panelOf(r, { rows: 0 }).top.length, 0)
        assert.equal(DEFAULT_PANEL_ROWS, 8)
      })
    } finally { fx.cleanup() }
  })

  test('stays a few kilobytes, which is the whole point of it', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const text = JSON.stringify(panelOf(r))
        assert.ok(text.length < JSON.stringify(r).length / 3, 'far smaller than the report it is cut from')
        for (const ch of FORBIDDEN) assert.equal(text.includes(ch), false)
      })
    } finally { fx.cleanup() }
  })

  test('survives a report with nothing in it', () => {
    const p = panelOf({})
    assert.equal(p.state, 'measured')
    assert.equal(p.listing.tokens, 0)
    assert.deepEqual(p.top, [])
    assert.deepEqual(p.tools, [])
  })
})

describe('panelFromRun', () => {
  test('gives the top half from a run record, and says where it came from', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: TODAY })
        const p = panelFromRun(r.run)
        assert.equal(p.state, 'last-run')
        assert.equal(p.generatedOn, TODAY)
        assert.equal(p.listing.tokens, r.summary.listingTokensPerCall)
        assert.equal(p.listing.allowanceTokens, null, 'a record does not keep the allowance, so none is invented')
        assert.equal(p.listing.alsoElsewhere, null, 'nor which skills other tools list')
        assert.equal(p.installed, null)
        assert.equal(p.counts.neverUsed, r.summary.neverCalledContext)
        assert.equal(p.counts.neverUsedTokens, null)
        assert.deepEqual(p.score, panelOf(r).score, 'the score reads the same from either source')
        assert.deepEqual(p.top, [])
        assert.deepEqual(p.tools, [])
      })
    } finally { fx.cleanup() }
  })

  test('no record, or one with no summary, is the empty panel', () => {
    for (const nothing of [null, undefined, {}, { ranAt: 'x' }]) {
      const p = panelFromRun(nothing)
      assert.equal(p.state, 'empty')
      assert.equal(p.listing, null)
    }
    assert.deepEqual(panelFromRun(null), emptyPanel())
  })
})

describe('cli: panel', () => {
  test('prints the panel as JSON and leaves no run record behind', () => {
    const fx = fixture()
    try {
      const runs = join(fx.home, 'runs')
      const r = run(['panel', '--runs=' + runs, '--today=' + TODAY], fx.home)
      assert.equal(r.code, 0, r.err)
      const p = JSON.parse(r.out)
      assert.equal(p.version, PANEL_VERSION)
      assert.equal(p.state, 'measured')
      assert.ok(p.top.length > 0)
      assert.equal(existsSync(runs), false, 'looking must not become the baseline the next report compares against')
    } finally { fx.cleanup() }
  })

  test('--last reads the record a report left, without measuring, and is empty before any report', () => {
    const fx = fixture()
    try {
      const runs = join(fx.home, 'runs')
      const before = JSON.parse(run(['panel', '--last', '--runs=' + runs], fx.home).out)
      assert.equal(before.state, 'empty')

      assert.equal(run(['report', '--runs=' + runs, '--today=' + TODAY], fx.home).code, 0)
      const after = JSON.parse(run(['panel', '--last', '--runs=' + runs], fx.home).out)
      assert.equal(after.state, 'last-run')
      assert.equal(after.generatedOn, TODAY)
      assert.ok(after.listing.tokens > 0)
      assert.equal(readdirSync(runs).length, 1, 'still the one record the report wrote')
    } finally { fx.cleanup() }
  })

  test('measures the way the last report was told to, so the two never disagree', () => {
    const fx = fixture()
    try {
      const runs = join(fx.home, 'runs')
      run(['report', '--budget=120', '--runs=' + runs, '--today=' + TODAY], fx.home)
      const p = JSON.parse(run(['panel', '--runs=' + runs, '--today=' + TODAY], fx.home).out)
      assert.equal(p.listing.allowanceTokens, 30, '--budget carried forward from the report')
      assert.equal(p.listing.fits, false)
      assert.equal(readdirSync(runs).length, 1)
    } finally { fx.cleanup() }
  })

  test('--rows sets how many rows come back, and help says what the command is for', () => {
    const fx = fixture()
    try {
      const p = JSON.parse(run(['panel', '--rows=1', '--runs=' + join(fx.home, 'runs'), '--today=' + TODAY], fx.home).out)
      assert.equal(p.top.length, 1)
      const help = run(['help'], fx.home).out
      assert.match(help, /token-coupons panel \[--last\] \[--rows=N\]/)
      assert.match(help, /writes nothing, not even a run record/)
    } finally { fx.cleanup() }
  })
})

describe('the line under the prompt', () => {
  const base = panelFromRun({ generatedOn: TODAY, summary: { skills: 10, listingTokensPerCall: 14517, overBudgetRatio: 1.45, neverCalledContext: 86, unroutable: 24, summonedOnly: 4, wastedTokensPerCall: 10762, savedTokensPerCallIfApplied: 10178, fitsAfter: true } })

  test('says what the list costs and what of it is unused, in one line', () => {
    assert.equal(statusText(base), 'skills list: 14,517 tokens a message, 10,762 unused, 24 out of reach (/coupons)')
  })

  test('is absent when the list is healthy, and before anything was measured', () => {
    const healthy = panelFromRun({ generatedOn: TODAY, summary: { skills: 3, listingTokensPerCall: 400, overBudgetRatio: 0.04, wastedTokensPerCall: 0, unroutable: 0 } })
    assert.equal(statusText(healthy), undefined)
    assert.equal(statusText(emptyPanel()), undefined)
    assert.equal(statusText(null), undefined)
  })

  test('still speaks up when the list is over its allowance with nothing unused', () => {
    const over = panelFromRun({ generatedOn: TODAY, summary: { skills: 3, listingTokensPerCall: 12000, overBudgetRatio: 1.2, wastedTokensPerCall: 0, unroutable: 0 } })
    assert.equal(statusText(over), 'skills list: 12,000 tokens a message (/coupons)')
  })
})

describe('the mod stays optional, and stays wired', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

  test('the plugin names one hooks module, and it is there', () => {
    const hooks = JSON.parse(read('hooks/hooks.json'))
    assert.deepEqual(hooks.modules, ['./token-coupons.mjs'])
    assert.ok(existsSync(join(ROOT, 'hooks', 'token-coupons.mjs')))
    const manifest = JSON.parse(read('.claude-plugin/plugin.json'))
    assert.equal(manifest.types, './types/index.d.ts')
    assert.ok(existsSync(join(ROOT, 'types', 'index.d.ts')))
  })

  test('nothing inside the skill folder reaches for the mod', () => {
    // `skills add` copies skills/token-coupons and nothing else, so a single
    // import or path out of it would break every standalone install.
    const skill = join(ROOT, 'skills', 'token-coupons')
    const offenders = []
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, name.name)
        if (name.isDirectory()) { walk(full); continue }
        if (!/\.(mjs|js|json)$/.test(name.name)) continue
        if (/(\.\.\/){2,}hooks\/|claude-code['"]|\$\.plugin\.root/.test(readFileSync(full, 'utf8'))) offenders.push(full.slice(skill.length + 1))
      }
    }
    walk(skill)
    assert.deepEqual(offenders, [])
  })

  test('the mod imports nothing, so builds that predate the state helpers still load it', () => {
    const source = read('hooks/token-coupons.mjs')
    assert.equal(/^\s*import\s/m.test(source), false)
    assert.match(source, /const PANEL_VERSION = 1\b/)
    assert.equal(PANEL_VERSION, 1, 'bump the mod and the contract together')
    for (const ch of FORBIDDEN) assert.equal(source.includes(ch), false)
  })

  test('the mod sets no raw colour, because one fixed yellow is unreadable on a light theme', () => {
    const source = read('hooks/token-coupons.mjs')
    assert.equal(/color: ?'/.test(source), false, 'colour goes through tint(), which also makes it bold')
    assert.equal(/'(yellow|red|green|cyan|blue|magenta)'/.test(source), false)
    // one meaning per colour, each a theme key: command dark blue, never used red,
    // the allowance yellow, started by you gray, what comes back green
    for (const pair of ["unused: 'error'", "allowance: 'warning'", "typed: 'inactive'", "command: 'remember'", "shorten: 'skill'", "saved: 'success'"]) {
      assert.ok(source.includes(pair), 'the colour table carries ' + pair)
    }
  })

  test('the mod only ever runs the panel command, which writes nothing', () => {
    const source = read('hooks/token-coupons.mjs')
    const argLists = [...source.matchAll(/runCli\(\$, (\[[^\]]*\])/g)].map((m) => m[1])
    assert.deepEqual(argLists.sort(), ["['panel', '--last']", "['panel']"])
  })
})
