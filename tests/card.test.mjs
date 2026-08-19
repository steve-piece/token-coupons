import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { scoreReport, GRADES, WEIGHTS } from '../skills/token-coupons/src/score.mjs'
import { renderCardSvg, renderCardPage, linkedinHref, wrap, bigNum, CARD_WIDTH, CARD_HEIGHT, REPO } from '../skills/token-coupons/src/render-card.mjs'
import { headline } from '../skills/token-coupons/src/score.mjs'
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
      savedOnYourModel: { model: 'Claude Opus 5', dollars: 8.29, dollarsPerMonth: 35.93, tokens: wasted - 400 },
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

  test('the grade bands descend, and an empty report does not throw', () => {
    const mins = GRADES.map((g) => g.min)
    assert.deepEqual(mins, [...mins].sort((a, b) => b - a), 'bands are ordered high to low')
    assert.equal(GRADES[GRADES.length - 1].min, 0, 'the last band catches everything')
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
    // Nothing that would taint the canvas or fail to rasterize: no fetched
    // resource. A navigation anchor loads nothing, so it is allowed, and so is
    // the xmlns, which is a namespace identifier rather than a URL.
    assert.equal(/\bsrc\s*=|url\(\s*["']?https?:|xlink:href/.test(svg), false)
    const navigable = svg
      .replace('http://www.w3.org/2000/svg', '')
      .replace(/<a href="[^"]*"[^>]*>/g, '')
      .replace(/>[^<]*github\.com[^<]*</g, '><')
    assert.equal(navigable.includes('http'), false, 'the only URLs left are the link and its label')
    assert.equal(svg.includes('foreignObject'), false)
    assert.equal(svg.includes('<image'), false)
  })

  test('leads with what was saved, not with the score', () => {
    assert.ok(svg.includes('>I SAVED<'), 'the headline is the claim, nothing else')
    // the basis is a footnote, since a flat plan is not billed this
    assert.ok(svg.includes('Savings estimates based on your most used'), 'the basis, wrapped to a left column')
    assert.ok(svg.includes('models API pricing.'))
    // the model is not named: the claim is the saving, not which model made it
    assert.equal(svg.includes('Claude Opus 5'), false)
    assert.ok(svg.includes('10,832'), 'the before figure')
    assert.ok(svg.includes('token-coupons'), 'the wordmark')
    assert.ok(svg.includes('View on GitHub') && svg.includes('github.com/steve-piece/token-coupons'))
    // the score is a diagnosis and lives on the list instead
    assert.equal(svg.includes('SKILL LISTING SCORE'), false)
    assert.equal(/>D<\/text>/.test(svg), false, 'no grade chip')
  })

  test('describes itself for a screen reader', () => {
    const alt = (svg.match(/aria-label="([^"]*)"/) || [])[1] || ''
    assert.match(alt, /Saved \$/)
    assert.match(alt, /tokens off every message/)
    assert.match(alt, /went from/)
  })

  test('the after bar is drawn shorter than the before bar, in proportion', () => {
    const widths = [...svg.matchAll(/<rect x="76" y="\d+" width="(\d+)" height="34"/g)].map((m) => Number(m[1]))
    assert.equal(widths.length, 2, 'a before bar and an after bar')
    assert.ok(widths[1] < widths[0], 'after is shorter than before')
  })

  test('the repo is printed with its mark, so a card that travels is traceable', () => {
    assert.ok(REPO.startsWith('https://github.com/'))
    assert.ok(svg.includes(REPO.replace(/^https?:\/\//, '')))
    assert.ok(svg.includes('View on GitHub'))
    assert.match(svg, /<g transform="translate\([\d.]+ [\d.]+\) scale\([\d.]+\)"/, 'the mark is drawn, not fetched')
  })

  test('the pill is the one command a stranger can run, not the slash command', () => {
    assert.ok(svg.includes('npx skills add steve-piece/token-coupons'))
    // Never the package manager: there is no package, and a card that told
    // someone to npm install this would send them nowhere.
    assert.equal(/npm install|npx token-coupons/.test(svg), false)
  })

  test('the tiles name what changed, in the words the card owner chose', () => {
    // Active is the mode that takes a description out of the listing, and the
    // decision list says the same, so the two documents cannot disagree.
    assert.ok(svg.includes('skills set to active'))
    assert.equal(svg.includes('set to passive'), false)
    assert.ok(svg.includes('unused skills removed'))
    assert.ok(svg.includes('descriptions optimized'))
    // removed is the only count drawn in the warning colour
    assert.match(svg, /fill="#FF6B8A">\d+<\/text>/)
  })

  test('the page ships both save paths, and no banned character reaches it', () => {
    const page = renderCardPage(report({ listing: 10832, wasted: 7777, over: 1.08, unroutable: 3 }))
    assert.ok(page.includes('claude.use(\'downloads\')'), 'the artifact viewer path')
    assert.ok(page.includes('a.download'), 'the opened from disk path')
    assert.ok(page.includes('toBlob'), 'the rasterizer')
    assert.ok(page.includes('id="png"'))
    assert.ok(page.includes('Save image'))
    // Copying an image is blocked inside the artifact viewer, so the button
    // that promised it is gone rather than sitting there failing.
    assert.equal(/Copy image|ClipboardItem|navigator\.clipboard/.test(page), false)
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

describe('headline', () => {
  test('names what is buying nothing and what it costs', () => {
    const lines = headline({}, {
      neverCalledPassive: { count: 65 },
      summonedOnlyPassive: { count: 7 },
    }, { tokens: { wasted: 7777 } })
    assert.equal(lines.length, 2)
    assert.equal(lines[0], '65 skills have never been used. 7 more you only type yourself.')
    assert.equal(lines[1], 'Their descriptions cost 7,777 tokens in every message you send.')
    for (const l of lines) assert.ok(l.length <= 64, 'fits the 64 character column: ' + l)
  })

  test('drops the clause it has no number for, and reads right at one', () => {
    const only = headline({}, { neverCalledPassive: { count: 1 }, summonedOnlyPassive: { count: 0 } }, { tokens: { wasted: 300 } })
    assert.equal(only[0], '1 skill has never been used.')
    const summonedOnly = headline({}, { neverCalledPassive: { count: 0 }, summonedOnlyPassive: { count: 4 } }, { tokens: { wasted: 300 } })
    assert.equal(summonedOnly[0], '4 more you only type yourself.')
  })

  test('says so plainly when nothing is wasted', () => {
    const clean = headline({}, { neverCalledPassive: { count: 0 }, summonedOnlyPassive: { count: 0 } }, { tokens: { wasted: 0 } })
    assert.equal(clean.length, 1)
    assert.match(clean[0], /read at least once/)
  })
})

describe('the card page', () => {
  const r = report({ listing: 10832, wasted: 7777, over: 1.08, unroutable: 3 })

  test('offers save then share, each with its own glyph', () => {
    const page = renderCardPage(r)
    const bar = page.slice(page.indexOf('<div class="bar">'), page.indexOf('</div>', page.indexOf('<div class="bar">')))
    // Save comes first because the composer cannot carry the picture: the image
    // has to exist on disk before the draft is any use.
    assert.ok(bar.indexOf('Save image') < bar.indexOf('Draft a LinkedIn post'), 'save first')
    assert.equal((bar.match(/class="ico"/g) || []).length, 2, 'one glyph each')
    assert.match(bar, /<a class="btn alt" id="li" href="https:\/\/www\.linkedin\.com/, 'a link, not a scripted navigation')
    assert.match(bar, /target="_blank" rel="noreferrer noopener"/)
    // the card is the end of the loop, so it does not send anyone back to the list
    assert.equal(page.includes('See suggestions'), false)
  })

  test('the draft opens with the numbers already written, and says the picture is not included', () => {
    const href = linkedinHref(r)
    const text = decodeURIComponent(href.split('text=')[1] || '')
    assert.match(href, /^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/)
    assert.match(text, /7,377 tokens off every message/)
    assert.match(text, /74 of mine were described in every message/, 'the three action counts, summed')
    assert.match(text, /\$35\.93 a month at API prices/)
    assert.ok(text.includes(REPO), 'and where it came from')
    // The platform takes words from a link and nothing else, so the page has to
    // say so rather than let someone post a card with no card in it.
    assert.match(renderCardPage(r), /Save the image first/)
  })

  test('a report with no priced model drafts without inventing a dollar figure', () => {
    const bare = report({ listing: 900, wasted: 500 })
    delete bare.summary.savedOnYourModel
    const text = decodeURIComponent(linkedinHref(bare).split('text=')[1] || '')
    assert.equal(/\$/.test(text), false)
    assert.match(text, /tokens off every message/)
  })

  test('scales the card to the viewport, so the whole thing reads on one screen', () => {
    const page = renderCardPage(r)
    assert.match(page, /max-height: calc\(100vh - \d+px\)/, 'the card is bounded by the viewport')
    assert.ok(page.includes('justify-content: center'), 'the controls sit centred under it')
    // the export is unaffected by how it is displayed
    assert.ok(page.includes('c.width = ' + CARD_WIDTH + ' * scale'))
    assert.ok(page.includes('c.height = ' + CARD_HEIGHT + ' * scale'))
  })

  test('the status line starts empty rather than describing the file', () => {
    const page = renderCardPage(r)
    assert.match(page, /id="msg" role="status" aria-live="polite"><\/p>/)
    assert.equal(page.includes('crisp post'), false)
  })
})

describe('the GitHub link', () => {
  const svg = renderCardSvg(report({ listing: 10832, wasted: 7777, over: 1.08, unroutable: 3 }))

  test('makes the mark, the label and the URL one target', () => {
    const anchor = svg.slice(svg.indexOf('<a href='), svg.indexOf('</a>'))
    assert.ok(anchor.includes(REPO), 'points at the repo')
    assert.ok(anchor.includes('target="_blank"') && anchor.includes('rel="noreferrer noopener"'))
    assert.ok(anchor.includes('<g transform='), 'the mark is inside it')
    assert.ok(anchor.includes('View on GitHub'), 'and so is the label')
    assert.ok(anchor.includes(REPO.replace(/^https?:\/\//, '')), 'and the URL line')
  })

  test('carries no styling of its own, so the footer looks unchanged', () => {
    const anchor = svg.slice(svg.indexOf('<a href='), svg.indexOf('</a>'))
    assert.equal(/text-decoration|class=|style=/.test(anchor), false)
  })
})
