import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { makeFixtureHome, withHome } from './helpers.mjs'
import {
  runRecord, pickFlags, saveRun, loadLastRun, listRuns, pruneRuns,
  mergeFlags, compareRuns, RUN_VERSION, REMEMBERED_FLAGS,
} from '../skills/token-coupons/src/runs.mjs'
import { buildReport } from '../skills/token-coupons/src/report.mjs'
import { runsDir } from '../skills/token-coupons/src/paths.mjs'

const day = (n) => new Date(Date.UTC(2026, 7, n, 12, 0, 0))

function tmp () {
  const dir = mkdtempSync(join(tmpdir(), 'tc-runs-'))
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } } }
}

/** A record shaped like the real one, without building a whole report. */
function record (over = {}) {
  return Object.assign({
    version: RUN_VERSION,
    ranAt: '2026-08-10T12:00:00.000Z',
    tool: '0.1.0',
    generatedOn: '2026-08-10',
    cwd: '/Users/me/Projects/a',
    flags: { since: '2026-06-01' },
    summary: { listingTokensPerCall: 10000, wastedTokensPerCall: 7000, wastedPerWeekOnYourModel: 10 },
    counts: { keep: 1 },
    skills: [{ name: 'alpha', mode: 'passive', chars: 100, calls: 2 }],
  }, over)
}

describe('runs: the record', () => {
  test('keeps the settings that change what is measured, and drops the rest', () => {
    const flags = { since: '2026-06-01', cwd: '/x', uncached: true, html: 'r.html', card: 'c.html', out: 'o.json', open: true, fresh: false }
    const kept = pickFlags(flags)
    assert.deepEqual(Object.keys(kept).sort(), ['cwd', 'since', 'uncached'])
    for (const k of ['html', 'card', 'out', 'open']) {
      assert.equal(kept[k], undefined, k + ' only changes what is written, so reusing it would write files nobody asked for')
    }
    assert.equal(REMEMBERED_FLAGS.includes('html'), false)
  })

  test('is one line per skill, not the whole report', () => {
    const rec = runRecord({
      generatedOn: '2026-08-17',
      summary: { listingTokensPerCall: 10 },
      totals: { recommendedActions: { keep: 2 } },
      skills: [{ names: ['alpha'], mode: 'passive', descriptionChars: 120, calls: 3, recommendation: { reason: 'a long sentence' } }],
    }, { flags: { since: '2026-06-01' }, cwd: '/x', ranAt: '2026-08-17T00:00:00.000Z' })
    assert.deepEqual(rec.skills, [{ name: 'alpha', mode: 'passive', chars: 120, calls: 3 }])
    assert.equal(rec.counts.keep, 2)
    assert.equal(rec.cwd, '/x')
    assert.equal(rec.flags.since, '2026-06-01')
  })
})

describe('runs: the folder', () => {
  test('saves, reads back the newest, and never grows past keep', () => {
    const t = tmp()
    try {
      for (let n = 1; n <= 5; n++) saveRun(record({ generatedOn: '2026-08-0' + n }), { dir: t.dir, keep: 3, now: day(n) })
      const names = listRuns(t.dir)
      assert.equal(names.length, 3, 'the oldest were removed')
      const last = loadLastRun(t.dir)
      assert.equal(last.generatedOn, '2026-08-05', 'newest first')
      assert.ok(last.path.endsWith('.json'))
    } finally { t.cleanup() }
  })

  test('two saves in the same second do not overwrite each other', () => {
    const t = tmp()
    try {
      saveRun(record({ generatedOn: 'a' }), { dir: t.dir, now: day(1) })
      saveRun(record({ generatedOn: 'b' }), { dir: t.dir, now: day(1) })
      assert.equal(listRuns(t.dir).length, 2)
    } finally { t.cleanup() }
  })

  test('an empty folder, unreadable JSON, and a version from the future all read as no history', () => {
    const t = tmp()
    try {
      assert.equal(loadLastRun(t.dir), null)
      assert.equal(loadLastRun(join(t.dir, 'nope')), null)
      saveRun(record(), { dir: t.dir, now: day(1) })
      writeFileSync(join(t.dir, listRuns(t.dir)[0]), 'not json')
      assert.equal(loadLastRun(t.dir), null, 'a broken file is skipped, never thrown')
      saveRun(record({ version: 99 }), { dir: t.dir, now: day(2) })
      assert.equal(loadLastRun(t.dir), null, 'a record this version cannot read is skipped')
      pruneRuns(join(t.dir, 'nope'), 1)
    } finally { t.cleanup() }
  })

  test('the default folder is outside the skill, so a skill update cannot wipe it', async () => {
    const fx = makeFixtureHome({ skills: [] })
    try {
      await withHome(fx.home, () => {
        assert.equal(runsDir(), join(fx.home, '.token-coupons', 'runs'))
      })
    } finally { fx.cleanup() }
  })
})

describe('runs: carrying settings forward', () => {
  test('what was typed wins, what was not is carried forward', () => {
    const prev = record({ flags: { since: '2026-06-01', 'cache-ttl': '5', cwd: '/old' } })
    const m = mergeFlags({ since: '2026-08-01' }, prev)
    assert.equal(m.flags.since, '2026-08-01', 'typed wins')
    assert.equal(m.flags['cache-ttl'], '5', 'carried forward')
    assert.equal(m.flags.cwd, '/old')
    assert.deepEqual(m.reused.sort(), ['cache-ttl', 'cwd'])
  })

  test('no history means nothing is carried, and nothing is invented', () => {
    const m = mergeFlags({ since: '2026-08-01' }, null)
    assert.deepEqual(m.flags, { since: '2026-08-01' })
    assert.deepEqual(m.reused, [])
  })
})

describe('runs: drift', () => {
  test('two runs that agree say nothing at all', () => {
    assert.deepEqual(compareRuns(record(), record()), [])
    assert.deepEqual(compareRuns(null, record()), [])
  })

  test('the folder comes first, because it silently changes what is counted', () => {
    const notes = compareRuns(record(), record({ cwd: '/Users/me/Projects/b' }))
    assert.match(notes[0], /different folder/)
    assert.match(notes[0], /Projects\/a/, 'and says which one it was')
  })

  test('skills coming and going are named, up to three', () => {
    const after = record({
      skills: [
        { name: 'beta', mode: 'passive', chars: 1, calls: 0 },
        { name: 'gamma', mode: 'passive', chars: 1, calls: 0 },
      ],
    })
    const notes = compareRuns(record(), after)
    assert.match(notes[0], /2 skills added, 1 gone/)
    assert.match(notes[0], /beta/)
  })

  test('a headline number is only mentioned once it has really moved', () => {
    const small = compareRuns(record(), record({ summary: { listingTokensPerCall: 10500, wastedTokensPerCall: 7000, wastedPerWeekOnYourModel: 10 } }))
    assert.deepEqual(small, [], '5 percent is noise')

    const big = compareRuns(record(), record({ summary: { listingTokensPerCall: 4000, wastedTokensPerCall: 7000, wastedPerWeekOnYourModel: 10 } }))
    assert.equal(big.length, 1)
    assert.match(big[0], /The listing went from 10,000 to 4,000 tokens a message, down 60 percent/)

    const dollars = compareRuns(record(), record({ summary: { listingTokensPerCall: 10000, wastedTokensPerCall: 7000, wastedPerWeekOnYourModel: 14 } }))
    assert.match(dollars[0], /Dollars per week moved up 40 percent/)
  })

  test('a missing or zero number is left alone rather than guessed at', () => {
    const none = compareRuns(record(), record({ summary: { listingTokensPerCall: 10000, wastedTokensPerCall: 7000, wastedPerWeekOnYourModel: null } }))
    assert.deepEqual(none, [])
    const zero = compareRuns(record({ summary: { listingTokensPerCall: 0 } }), record())
    assert.deepEqual(zero, [], 'no percentage change from zero')
  })
})

describe('runs: through the report', () => {
  test('a report carries the record it will save, and no previous block without history', async () => {
    const fx = makeFixtureHome({ skills: [{ name: 'alpha', description: 'Alpha.' }] })
    try {
      await withHome(fx.home, () => {
        const r = buildReport({ today: '2026-08-17', cwd: fx.home, runFlags: { since: '2026-06-01' } })
        assert.equal(r.previous, null)
        assert.equal(r.run.version, RUN_VERSION)
        assert.equal(r.run.cwd, fx.home)
        assert.equal(r.run.flags.since, '2026-06-01')
        assert.deepEqual(r.run.summary, r.summary, 'what is compared is what is saved')
        assert.ok(JSON.stringify(r.run).length < JSON.stringify(r).length / 4, 'the record is small')
      })
    } finally { fx.cleanup() }
  })

  test('with history the report explains what moved', async () => {
    const fx = makeFixtureHome({ skills: [{ name: 'alpha', description: 'Alpha.' }] })
    const t = tmp()
    try {
      await withHome(fx.home, () => {
        const first = buildReport({ today: '2026-08-16', cwd: fx.home })
        saveRun(first.run, { dir: t.dir, now: day(16) })
        const prev = loadLastRun(t.dir)
        const second = buildReport({ today: '2026-08-17', cwd: '/somewhere/else', previous: prev })
        assert.equal(second.previous.generatedOn, '2026-08-16')
        assert.ok(second.previous.drift.some((n) => /different folder/.test(n)))
      })
    } finally { t.cleanup(); fx.cleanup() }
  })
})
