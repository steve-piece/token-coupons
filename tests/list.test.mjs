import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { renderList } from '../src/render-list.mjs'
import { sampleReport } from './fixtures/sample-report.mjs'

const report = sampleReport()
const html = renderList(report, { cardHref: 'card.html' })

describe('the decision list', () => {
  test('opens by explaining the two modes, before asking for any decision', () => {
    const modesAt = html.indexOf('The two modes, and the whole idea')
    const tableAt = html.indexOf('id="rows-section"')
    assert.ok(modesAt > 0, 'the explainer exists')
    assert.ok(modesAt < tableAt, 'and it comes before the table')
    assert.ok(html.includes("Descriptions injected in the model's context, used as needed."), 'passive, in one line')
    assert.ok(html.includes('Skills activated through direct reference within the prompt.'), 'active, in one line')
    assert.ok(html.includes('One line in the YAML: <code>disable-model-invocation: true</code>'))
  })

  test('leads with money, and prices every row the same way', () => {
    assert.ok(html.includes('a month, back'), 'the recoverable figure comes first')
    assert.ok(html.includes('a month, wasted'))
    // green on what you get back, red on the count behind it
    assert.match(html, /class="fig good"><span class="v">\$/)
    assert.match(html, /class="fig bad"><span class="v">\d+<\/span><span class="k">skills never used/)
    assert.ok(html.includes('Cost a month'), 'the column is money, not tokens')
    const rows = (html.match(/<tr data-index=/g) || []).length
    const costs = (html.match(/td class="num cost"/g) || []).length
    assert.equal(costs, rows, 'every row carries a cost cell')
  })

  test('gives one control per skill, preset to the suggestion', () => {
    const rows = (html.match(/<tr data-index=/g) || []).length
    assert.equal((html.match(/select class="action"/g) || []).length, rows)
    assert.equal(rows, report.skills.length)
    // a review suggestion has no control of its own, so it lands on keep
    const review = report.skills.findIndex((s) => (s.recommendation || {}).action === 'review')
    if (review !== -1) {
      const block = html.split('data-index="' + review + '"')[2] || ''
      assert.match(block.slice(0, 900), /data-rec="keep"/)
    }
  })

  test('refuses to offer delete where the folder is not the person to fix', () => {
    const cached = report.skills.some((s) => s.location === 'plugin-cache')
    if (cached) assert.ok(html.includes('value="delete" disabled'))
  })

  test('links back to the card when it has one, and omits the link when it does not', () => {
    assert.ok(html.includes('href="card.html"'))
    assert.equal(renderList(report).includes('Back to the scorecard'), false)
  })

  test('is self contained, dark, and free of the banned characters', () => {
    assert.equal(/(?:src|href)="https?:/.test(html), false, 'no external asset')
    assert.ok(html.includes('id="report-data"'), 'the data island the script reads')
    assert.ok(html.includes('color-scheme: dark'))
    const DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))
    // only our own markup: a skill description on disk may contain anything
    const ours = html.split('report-data')[0]
    assert.equal(DASHES.some((d) => ours.includes(d)), false)
  })

  test('the decisions file starts on the suggestions, in the contract shape', () => {
    const raw = html.slice(html.indexOf('<textarea id="decisions-json"'))
    const inner = raw.slice(raw.indexOf('>') + 1, raw.indexOf('</textarea>'))
    const json = JSON.parse(inner
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    assert.equal(json.version, 1)
    assert.ok(Array.isArray(json.decisions))
    for (const d of json.decisions) {
      assert.ok(d.name && typeof d.path === 'string')
      assert.ok(['active', 'passive', 'optimize', 'delete'].includes(d.action), 'keep is never exported')
    }
  })

  test('survives a report with nothing in it', () => {
    const out = renderList({ summary: {}, skills: [] })
    assert.ok(out.includes('</html>'))
    assert.equal(out.includes('undefined'), false)
    assert.equal(out.includes('NaN'), false)
  })
})

describe('the two questions a reader asks about the money', () => {
  test('says the figures are API prices, and what a flat plan actually pays', () => {
    assert.ok(html.includes('API prices'))
    assert.match(html, /not a bill you will see/)
    assert.match(html, /usage allowance/)
  })

  test('explains why the wasted and recovered figures cannot match', () => {
    assert.match(html, /do not match, and cannot/)
    assert.match(html, /leaves its <strong>name<\/strong> in the list/)
  })
})
