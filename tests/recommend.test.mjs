import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { recommend, DEFAULT_THRESHOLDS } from '../src/recommend.mjs'
import { listingCost, nameLineChars, toTokens } from '../src/budget.mjs'

const TODAY = '2026-08-15'

/** A Row: a discovered skill joined with its call counts. */
function row (over = {}) {
  const name = over.name || 'alpha'
  const chars = over.descriptionChars === undefined ? 200 : over.descriptionChars
  return Object.assign({
    name,
    names: [name],
    frontmatterName: name,
    realPath: '/real/' + name,
    skillMd: '/real/' + name + '/SKILL.md',
    aliases: ['/real/' + name],
    symlinks: [],
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    gateDeclared: false,
    gateValue: null,
    description: 'x'.repeat(chars),
    descriptionChars: chars,
    // 60 days: past the new-skill window (14) and short of stale (90), so a row
    // only trips those rules when a test asks for it by passing modifiedOn.
    modifiedOn: daysAgo(60),
    calls: 0,
    activeCalls: 0,
    passiveCalls: 0,
    firstSeen: null,
    lastSeen: null,
  }, over, { descriptionChars: chars })
}

function daysAgo (n, from = TODAY) {
  return new Date(Date.parse(from + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10)
}

function run (rows, opts = {}) {
  return recommend(rows, Object.assign({ today: TODAY }, opts))
}

function only (r) { return r.rows[0].recommendation }

// Reasons are short: numbers first, at most two sentences, under 30 words.
function sentences (text) { return (String(text).match(/\./g) || []).length }
function short (text) { return String(text).split(/\s+/).length <= 30 }

describe('recommend: rules in priority order', () => {
  test('rule 1: an active skill nobody has used is left for the person to review', () => {
    const rec = only(run([row({ name: 'alpha', mode: 'active', calls: 0 })]))
    assert.equal(rec.action, 'review')
    assert.ok(rec.flags.includes('dormant-active'))
    assert.equal(rec.impactTokensPerCall, 0, 'an active skill already costs only its name line')
    assert.match(rec.reason, /Never used/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 2: never called and too thin to route to wins over the delete rule', () => {
    const rec = only(run([row({
      name: 'alpha', calls: 0, descriptionChars: 40, location: 'user', modifiedOn: daysAgo(300),
    })]))
    assert.equal(rec.action, 'optimize', 'thin is checked before stale')
    assert.deepEqual(rec.flags, ['never-called', 'thin-description', 'stale'])
    assert.match(rec.reason, /40 chars/)
    assert.match(rec.reason, /Never used/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 3: never called, yours to move, and untouched for months is a delete', () => {
    const rec = only(run([row({
      name: 'alpha', calls: 0, descriptionChars: 200, location: 'user', modifiedOn: daysAgo(300),
    })]))
    assert.equal(rec.action, 'delete')
    assert.deepEqual(rec.flags, ['never-called', 'stale'])
    assert.equal(rec.impactTokensPerCall, 50)
    assert.match(rec.reason, /300 days ago/)
    assert.match(rec.reason, /50 tokens/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 3 does not fire for a skill you cannot move, or one edited recently', () => {
    const notYours = only(run([row({
      name: 'alpha', calls: 0, location: 'plugin-cache', editable: false, modifiedOn: daysAgo(300),
    })]))
    assert.equal(notYours.action, 'active', 'a plugin cache skill is never proposed for deletion')

    const fresh = only(run([row({ name: 'alpha', calls: 0, modifiedOn: daysAgo(89) })]))
    assert.equal(fresh.action, 'active')
    assert.ok(!fresh.flags.includes('stale'))
  })

  test('staleDays is an exclusive boundary: 90 days is fine, 91 is stale', () => {
    const at = only(run([row({ name: 'alpha', calls: 0, modifiedOn: daysAgo(90) })]))
    assert.equal(at.action, 'active')
    const past = only(run([row({ name: 'alpha', calls: 0, modifiedOn: daysAgo(91) })]))
    assert.equal(past.action, 'delete')
  })

  test('rule 4: never called becomes name only, which keeps the skill and stops the rent', () => {
    const rec = only(run([row({ name: 'alpha', calls: 0, descriptionChars: 200 })]))
    assert.equal(rec.action, 'active')
    assert.deepEqual(rec.flags, ['never-called'])
    assert.equal(rec.impactTokensPerCall, 50)
    assert.match(rec.reason, /200 chars/)
    assert.match(rec.reason, /50 tokens/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 5: used only when the person types its name becomes name only', () => {
    const rec = only(run([row({
      name: 'alpha', calls: 4, activeCalls: 4, passiveCalls: 0, descriptionChars: 200,
    })]))
    assert.equal(rec.action, 'active')
    assert.deepEqual(rec.flags, ['summoned-only'])
    assert.equal(rec.impactTokensPerCall, 50)
    assert.match(rec.reason, /4 times/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 6: routed to but heavy gets a rewrite, not a gate', () => {
    const rec = only(run([row({
      name: 'alpha', calls: 6, activeCalls: 2, passiveCalls: 4, descriptionChars: 800,
    })]))
    assert.equal(rec.action, 'optimize')
    assert.deepEqual(rec.flags, ['heavy-description'])
    assert.equal(rec.impactTokensPerCall, 113)
    assert.match(rec.reason, /800 chars/)
    assert.match(rec.reason, /350 chars/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 6: over the per entry cap is an optimize even when the length is under heavyChars', () => {
    const rec = only(run([row({
      name: 'alpha', calls: 3, passiveCalls: 3, descriptionChars: 2000,
    })], { thresholds: { heavyChars: 5000 } }))
    assert.equal(rec.action, 'optimize')
    assert.deepEqual(rec.flags, ['capped'])
    assert.equal(rec.impactTokensPerCall, 297)
    assert.match(rec.reason, /1,536 char cap/)
    assert.ok(sentences(rec.reason) <= 2 && short(rec.reason), 'short: ' + rec.reason)
  })

  test('rule 7: everything else is left alone, for both modes', () => {
    const res = run([
      row({ name: 'alpha', calls: 9, activeCalls: 2, passiveCalls: 7, descriptionChars: 300 }),
      row({ name: 'beta', mode: 'active', calls: 5, activeCalls: 5, passiveCalls: 0, descriptionChars: 900 }),
    ])
    const by = byName(res)
    assert.equal(by.alpha.recommendation.action, 'keep')
    assert.deepEqual(by.alpha.recommendation.flags, [])
    assert.equal(by.alpha.recommendation.impactTokensPerCall, 0)
    assert.match(by.alpha.recommendation.reason, /7 of 9 times/)

    assert.equal(by.beta.recommendation.action, 'keep', 'an active skill that gets used is fine as it is')
    assert.deepEqual(by.beta.recommendation.flags, [], 'length flags are meaningless once the description is out of the listing')
    assert.equal(by.beta.recommendation.impactTokensPerCall, 0)
  })
})

describe('recommend: flags', () => {
  test('flags accumulate even though only the first matching rule sets the action', () => {
    const res = run([row({
      name: 'alpha', calls: 0, descriptionChars: 40, location: 'plugin-cache', editable: false, modifiedOn: daysAgo(400),
    })], { economics: { overflowUnroutable: { names: ['alpha'] } } })
    const rec = only(res)
    assert.equal(rec.action, 'optimize')
    assert.deepEqual(rec.flags, ['never-called', 'thin-description', 'unroutable', 'not-editable', 'stale'])
    assert.ok(sentences(rec.reason) <= 3, 'still short with the not-editable clause folded in: ' + rec.reason)
  })

  test('a heavy description on a summoned only skill carries both flags', () => {
    const rec = only(run([row({
      name: 'alpha', calls: 4, activeCalls: 4, passiveCalls: 0, descriptionChars: 800,
    })]))
    assert.equal(rec.action, 'active')
    assert.deepEqual(rec.flags, ['summoned-only', 'heavy-description'])
    assert.equal(rec.impactTokensPerCall, 200)
  })

  test('a skill you cannot edit says the change belongs in the plugin source repo', () => {
    const rec = only(run([row({
      name: 'plug:alpha', names: ['plug:alpha', 'alpha'], calls: 0, editable: false, location: 'plugin-cache',
    })]))
    assert.ok(rec.flags.includes('not-editable'))
    assert.match(rec.reason, /source repo/)
    assert.match(rec.reason, /plugin/)
  })

  test('unroutable is read from the economics overflow list and matches any invocable name', () => {
    const res = run([
      row({ name: 'plug:alpha', names: ['plug:alpha', 'alpha'], calls: 2, passiveCalls: 2, descriptionChars: 300 }),
      row({ name: 'beta', calls: 2, passiveCalls: 2, descriptionChars: 300 }),
    ], { economics: { overflowUnroutable: { names: ['alpha'] } } })
    const by = byName(res)
    assert.ok(by['plug:alpha'].recommendation.flags.includes('unroutable'))
    // unroutable is a badge, not prose: the reason stays short and the flag carries it
    assert.ok(!by.beta.recommendation.flags.includes('unroutable'))
  })
})

describe('recommend: impact math', () => {
  test('gating drops everything but the name line', () => {
    const res = run([row({ name: 'alpha', calls: 0, descriptionChars: 200 })])
    const r = res.rows[0]
    const expected = listingCost(200, 'alpha').tokens - toTokens(nameLineChars('alpha'))
    assert.equal(r.recommendation.impactTokensPerCall, expected)
    assert.equal(expected, 50)
    assert.equal(r.listingTokens, 53, 'listing fields are filled in when the caller did not join them')
    assert.equal(r.descriptionTokens, 50)
    assert.equal(r.capped, false)
  })

  test('optimizing leaves the target length plus the name line behind', () => {
    const res = run([row({ name: 'alpha', calls: 6, passiveCalls: 6, descriptionChars: 800 })])
    const expected = listingCost(800, 'alpha').tokens - toTokens(DEFAULT_THRESHOLDS.optimizeTargetChars + nameLineChars('alpha'))
    assert.equal(res.rows[0].recommendation.impactTokensPerCall, expected)
    assert.equal(expected, 113)
  })

  test('an optimize that would not shrink anything reports zero, never a negative', () => {
    const rec = only(run([row({ name: 'alpha', calls: 0, descriptionChars: 40 })]))
    assert.equal(rec.action, 'optimize')
    assert.equal(rec.impactTokensPerCall, 0)
  })

  test('the per entry cap bounds the impact of a very long description', () => {
    const res = run([row({ name: 'alpha', calls: 3, passiveCalls: 3, descriptionChars: 9000 })])
    assert.equal(res.rows[0].capped, true)
    assert.equal(res.rows[0].recommendation.impactTokensPerCall, 297, 'anything past 1536 chars was never charged for')
  })

  test('keep and review are always zero', () => {
    const res = run([
      row({ name: 'alpha', calls: 9, passiveCalls: 9, descriptionChars: 300 }),
      row({ name: 'beta', mode: 'active', calls: 0, descriptionChars: 900 }),
    ])
    for (const r of res.rows) assert.equal(r.recommendation.impactTokensPerCall, 0)
  })
})

describe('recommend: ordering and lists', () => {
  test('rank is impact first, then description size, then name', () => {
    const res = run([
      row({ name: 'zzz', calls: 5, passiveCalls: 5, descriptionChars: 100 }),
      row({ name: 'ddd', calls: 5, passiveCalls: 5, descriptionChars: 100 }),
      row({ name: 'eee', calls: 5, passiveCalls: 5, descriptionChars: 100 }),
      row({ name: 'aaa', calls: 5, passiveCalls: 5, descriptionChars: 300 }),
      row({ name: 'bbb', calls: 0, descriptionChars: 200 }),
      row({ name: 'ccc', calls: 0, descriptionChars: 800 }),
    ])
    assert.deepEqual(res.rows.map((r) => r.name), ['ccc', 'bbb', 'aaa', 'ddd', 'eee', 'zzz'])
    assert.deepEqual(res.rows.map((r) => r.recommendation.rank), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(res.rows.map((r) => r.recommendation.impactTokensPerCall), [200, 50, 0, 0, 0, 0])
  })

  test('heaviest is the biggest passive descriptions, capped at heaviestListSize', () => {
    const res = run([
      row({ name: 'big', calls: 0, descriptionChars: 900 }),
      row({ name: 'mid', calls: 4, passiveCalls: 4, descriptionChars: 800 }),
      row({ name: 'small', calls: 4, passiveCalls: 4, descriptionChars: 100 }),
      row({ name: 'gated', mode: 'active', calls: 4, activeCalls: 4, descriptionChars: 5000 }),
    ], { thresholds: { heaviestListSize: 2 } })
    assert.deepEqual(res.heaviest.map((r) => r.name), ['big', 'mid'])
    assert.equal(res.heaviest[0].calls, 0, 'calls travel with the row')
    assert.ok(!res.heaviest.some((r) => r.name === 'gated'), 'active skills pay for a name line only')
  })

  test('thin is every row carrying the thin flag, in rank order', () => {
    const res = run([
      row({ name: 'aaa', calls: 0, descriptionChars: 10 }),
      row({ name: 'bbb', calls: 0, descriptionChars: 59 }),
      row({ name: 'ccc', calls: 0, descriptionChars: 60 }),
      row({ name: 'ddd', calls: 3, passiveCalls: 3, descriptionChars: 10 }),
    ])
    assert.deepEqual(res.thin.map((r) => r.name), ['bbb', 'aaa'])
    assert.ok(res.thin.every((r) => r.recommendation.flags.includes('thin-description')))
  })

  test('counts always carry all six actions, including the ones nothing produced', () => {
    const res = run([
      row({ name: 'a-keep', calls: 9, passiveCalls: 9, descriptionChars: 300 }),
      row({ name: 'b-active', calls: 0, descriptionChars: 200 }),
      row({ name: 'c-optimize', calls: 6, passiveCalls: 6, descriptionChars: 800 }),
      row({ name: 'd-delete', calls: 0, descriptionChars: 200, modifiedOn: daysAgo(200) }),
      row({ name: 'e-review', mode: 'active', calls: 0, descriptionChars: 200 }),
    ])
    assert.deepEqual(res.counts, { keep: 1, active: 1, passive: 0, optimize: 1, delete: 1, review: 1 })
    assert.equal(Object.values(res.counts).reduce((a, b) => a + b, 0), res.rows.length)
  })
})

describe('recommend: thresholds', () => {
  test('defaults are exported and returned', () => {
    assert.deepEqual(DEFAULT_THRESHOLDS, {
      thinChars: 60, heavyChars: 600, optimizeTargetChars: 350, staleDays: 90, newSkillDays: 14, heaviestListSize: 15,
    })
    assert.deepEqual(run([]).thresholds, DEFAULT_THRESHOLDS)
  })

  test('every threshold can be overridden, and the rest keep their defaults', () => {
    const rows = [
      row({ name: 'aaa', calls: 4, passiveCalls: 4, descriptionChars: 200 }),
      row({ name: 'bbb', calls: 0, descriptionChars: 200 }),
      // 30 days: old enough that a lowered staleDays can reach it, and past the
      // new-skill window, so "too new to judge" does not shadow the stale rule.
      row({ name: 'ccc', calls: 0, descriptionChars: 200, modifiedOn: daysAgo(30) }),
    ]
    const loose = run(rows, { thresholds: { heavyChars: 100 } })
    assert.equal(byName(loose).aaa.recommendation.action, 'optimize', 'a lower heavyChars catches more')

    const picky = run(rows, { thresholds: { thinChars: 300 } })
    assert.equal(byName(picky).bbb.recommendation.action, 'optimize', 'a higher thinChars calls more descriptions thin')

    const impatient = run(rows, { thresholds: { staleDays: 5 } })
    assert.equal(byName(impatient).ccc.recommendation.action, 'delete', 'a lower staleDays ages skills faster')

    // too new outranks stale: nobody should be told to delete something they
    // installed last week, however low staleDays is set.
    const fresh = run([row({ name: 'ddd', calls: 0, descriptionChars: 200, modifiedOn: daysAgo(3) })], { thresholds: { staleDays: 1 } })
    assert.equal(fresh.rows[0].recommendation.action, 'keep')
    assert.ok(fresh.rows[0].recommendation.flags.includes('too-new'))

    const res = run(rows, { thresholds: { staleDays: 5 } })
    assert.equal(res.thresholds.staleDays, 5)
    assert.equal(res.thresholds.heavyChars, DEFAULT_THRESHOLDS.heavyChars)
  })

  test('optimizeTargetChars changes what an optimize is worth', () => {
    const rows = [row({ name: 'alpha', calls: 6, passiveCalls: 6, descriptionChars: 800 })]
    const tight = run(rows, { thresholds: { optimizeTargetChars: 100 } })
    assert.equal(tight.rows[0].recommendation.impactTokensPerCall, 175)
    assert.match(tight.rows[0].recommendation.reason, /100 chars/)
  })

  test('the per entry cap follows the budget when one is passed', () => {
    const rows = [row({ name: 'alpha', calls: 3, passiveCalls: 3, descriptionChars: 800 })]
    const res = run(rows, { budget: { perEntryCap: 400 }, thresholds: { heavyChars: 5000 } })
    assert.equal(res.rows[0].capped, true)
    assert.equal(res.rows[0].recommendation.action, 'optimize')
    assert.equal(res.rows[0].descriptionTokens, 100)
  })
})

describe('recommend: inputs', () => {
  test('the caller rows are copied, not edited in place', () => {
    const input = row({ name: 'alpha', calls: 0 })
    const res = run([input])
    assert.equal(input.recommendation, undefined)
    assert.equal(input.listingTokens, undefined)
    assert.equal(res.rows[0].name, 'alpha')
  })

  test('joined listing fields are trusted when the caller already computed them', () => {
    const res = run([row({ name: 'alpha', calls: 0, descriptionChars: 200, listingTokens: 99, descriptionTokens: 96, capped: true })])
    assert.equal(res.rows[0].recommendation.impactTokensPerCall, 96, '99 tokens less the 3 token name line')
  })

  test('an empty list is a valid report', () => {
    const res = recommend([], { today: TODAY })
    assert.deepEqual(res.rows, [])
    assert.deepEqual(res.heaviest, [])
    assert.deepEqual(res.thin, [])
    assert.deepEqual(res.counts, { keep: 0, active: 0, passive: 0, optimize: 0, delete: 0, review: 0 })
  })

  test('today defaults to now, and a missing file date never reads as stale', () => {
    const res = recommend([row({ name: 'alpha', calls: 0, modifiedOn: null })])
    assert.equal(res.rows[0].recommendation.action, 'active')
    assert.ok(!res.rows[0].recommendation.flags.includes('stale'))
  })
})

function byName (res) {
  return Object.fromEntries(res.rows.map((r) => [r.name, r]))
}

describe('recommend: a freshly installed skill is not dead weight', () => {
  test('never used but installed days ago is left alone, and says so', () => {
    const rec = only(run([row({ name: 'archify', calls: 0, descriptionChars: 375, modifiedOn: daysAgo(1) })]))
    assert.equal(rec.action, 'keep', 'one day old with no calls proves nothing')
    assert.ok(rec.flags.includes('too-new'))
    assert.ok(rec.flags.includes('never-called'))
    assert.equal(rec.impactTokensPerCall, 0, 'nothing to claim as a saving')
    assert.match(rec.reason, /yesterday/)
    assert.ok(short(rec.reason), 'short: ' + rec.reason)
  })

  test('past the new-skill window the never-called rule takes over again', () => {
    const rec = only(run([row({ name: 'archify', calls: 0, descriptionChars: 375, modifiedOn: daysAgo(20) })]))
    assert.equal(rec.action, 'active')
    assert.ok(!rec.flags.includes('too-new'))
  })

  test('too new never hides a description too thin to route to', () => {
    const rec = only(run([row({ name: 'x', calls: 0, descriptionChars: 30, modifiedOn: daysAgo(2) })]))
    assert.equal(rec.action, 'optimize', 'a thin description is worth fixing on day one')
    assert.ok(rec.flags.includes('thin-description'))
  })

  test('newSkillDays is overridable', () => {
    const rows = [row({ name: 'x', calls: 0, descriptionChars: 375, modifiedOn: daysAgo(20) })]
    assert.equal(only(run(rows, { thresholds: { newSkillDays: 30 } })).action, 'keep')
    assert.equal(only(run(rows, { thresholds: { newSkillDays: 3 } })).action, 'active')
  })
})
