import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { scoreReport, GRADES, WEIGHTS } from '../src/score.mjs'
import { renderCardSvg, renderCardPage, wrap, bigNum, CARD_WIDTH, CARD_HEIGHT } from '../src/render-card.mjs'
import { sampleReport } from './fixtures/sample-report.mjs'

/** A report shaped like the real one, with only the fields the score reads. */
function report ({ listing, wasted, over = 1, unroutable = 0 }) {
  return {
    generatedOn: '2026-08-17',
    summary: {
      listingTokensPerCall: listing,
      wastedTokensPerCall: wasted,
      unroutable,
      skills: 90,
      notListed: 40,
      neverCalledPassive: 60,
      savedTokensPerCallIfApplied: wasted - 400,
      fitsAfter: true,
      recommendedActions: { active: 41, delete: 25, optimize: 8, review: 0, keep: 20, passive: 0 },
      wastedPerWeekOnYourModel: { model: 'Claude Opus 5', dollars: 8.97, dollarsPerMonth: 38.88 },
    },
    economics: { perSession: { overBudgetRatio: over } },
    cost: { volume: { wastedTokensPerWeek: 15732252, wastedTokensPerMonth: 68173092 } },
  }
}

describe('score', () => {
  test('a listing where every token has been read, fits, and drops nothing is an A', () => {
    const s = scoreReport(report({ listing: 5000, wasted: 0, over: 0.6 }))
    assert.equal(s.score, 100)
    assert.equal(s.grade, 'A')
  })

  test('a listing where nothing has ever been read scores only on fit and reach', () => {
    const s = scoreReport(report({ listing: 5000, wasted: 5000, over: 0.5 }))
    assert.equal(s.parts.earned, 0)
    assert.equal(s.score, WEIGHTS.fit + WEIGHTS.reach)
    assert.equal(s.grade, 'F')
  })

  test('being over the allowance costs fit, and twice over costs all of it', () => {
    assert.equal(scoreReport(report({ listing: 100, wasted: 0, over: 1.5 })).parts.fit, WEIGHTS.fit * 0.5)
    assert.equal(scoreReport(report({ listing: 100, wasted: 0, over: 2 })).parts.fit, 0)
    assert.equal(scoreReport(report({ listing: 100, wasted: 0, over: 9 })).parts.fit, 0, 'never negative')
  })

  test('each unroutable skill costs a tenth of reach, and ten costs all of it', () => {
    assert.equal(scoreReport(report({ listing: 100, wasted: 0, unroutable: 1 })).parts.reach, WEIGHTS.weights === undefined ? 9 : 9)
    assert.equal(scoreReport(report({ listing: 100, wasted: 0, unroutable: 10 })).parts.reach, 0)
    assert.equal(scoreReport(report({ listing: 100, wasted: 0, unroutable: 40 })).parts.reach, 0, 'never negative')
  })

  test('every grade band has a verdict, and an empty report does not throw', () => {
    for (const g of GRADES) assert.ok(g.verdict.length > 10)
    const s = scoreReport({})
    assert.ok(Number.isFinite(s.score))
    assert.ok(s.grade)
  })
})

describe('card', () => {
  const svg = renderCardSvg(report({ listing: 10832, wasted: 7777, over: 1.08, unroutable: 3 }))

  test('is one self contained svg with no external reference', () => {
    assert.equal((svg.match(/<svg /g) || []).length, 1)
    assert.match(svg, new RegExp('viewBox="0 0 ' + CARD_WIDTH + ' ' + CARD_HEIGHT + '"'))
    // nothing that would taint the canvas or fail to rasterize. The xmlns is a
    // namespace identifier, never fetched, so it is the one allowed http string.
    assert.equal(/(?:src|href|url\()\s*=?\s*["']?https?:/.test(svg), false)
    assert.equal(svg.replace('http://www.w3.org/2000/svg', '').includes('http'), false)
    assert.equal(svg.includes('foreignObject'), false)
    assert.equal(svg.includes('<image'), false)
  })

  test('carries the numbers a reader would check', () => {
    assert.ok(svg.includes('>45<'), 'the score')
    assert.ok(svg.includes('>D<'), 'the grade')
    assert.ok(svg.includes('7,777'), 'wasted tokens')
    assert.ok(svg.includes('10,832'), 'listing tokens')
    assert.ok(svg.includes('$38.88'), 'the monthly bill')
    assert.ok(svg.includes('token-coupons'), 'the wordmark')
  })

  test('describes itself for a screen reader', () => {
    const alt = (svg.match(/aria-label="([^"]*)"/) || [])[1] || ''
    assert.match(alt, /score 45 out of 100/)
    assert.match(alt, /grade D/)
  })

  test('the split bar is drawn in proportion to the waste', () => {
    const lean = renderCardSvg(report({ listing: 1000, wasted: 0 }))
    assert.equal(/fill="#FF6B8A" opacity="0.92"/.test(lean), false, 'no waste, no rose slab')
    assert.ok(/fill="#FF6B8A" opacity="0.92"/.test(svg), 'waste present, rose slab drawn')
  })

  test('the page ships both save paths, and no banned character reaches it', () => {
    const page = renderCardPage(report({ listing: 10832, wasted: 7777, over: 1.08, unroutable: 3 }))
    assert.ok(page.includes('claude.use(\'downloads\')'), 'the artifact viewer path')
    assert.ok(page.includes('a.download'), 'the opened from disk path')
    assert.ok(page.includes('toBlob'), 'the rasterizer')
    assert.ok(page.includes('id="png"'))
    const DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))
    assert.equal(DASHES.some((d) => page.includes(d)), false, 'no forbidden dash reaches the page')
  })

  test('a report with no priced model still renders', () => {
    const bare = report({ listing: 900, wasted: 500 })
    delete bare.summary.wastedPerWeekOnYourModel
    const out = renderCardSvg(bare)
    assert.ok(out.includes('</svg>'))
    assert.equal(out.includes('undefined'), false)
    assert.equal(out.includes('NaN'), false)
  })

  test('renders from the full sample report without leaving a hole', () => {
    const out = renderCardSvg(sampleReport())
    assert.equal(out.includes('undefined'), false)
    assert.equal(out.includes('NaN'), false)
  })
})

describe('card helpers', () => {
  test('wrap breaks on words at the budget', () => {
    assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four'])
    assert.deepEqual(wrap('', 10), [])
  })
  test('bigNum shortens only where it helps', () => {
    assert.equal(bigNum(812), '812')
    assert.equal(bigNum(20518), '21K')
    assert.equal(bigNum(15732252), '15.7M')
    assert.equal(bigNum(2400000000), '2.4B')
  })
})
