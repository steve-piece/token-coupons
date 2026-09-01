import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { renderList } from '../skills/token-coupons/src/render-list.mjs'
import { sampleReport } from './fixtures/sample-report.mjs'

const report = sampleReport()
const html = renderList(report, { cardHref: 'card.html' })

describe('the decision list', () => {
  test('explains the two kinds of skill directly above the list that asks about them', () => {
    const modesAt = html.indexOf('Two kinds of skill, and the whole idea')
    const tableAt = html.indexOf('id="rows-section"')
    const figuresAt = html.indexOf('id="figures"')
    assert.ok(modesAt > 0, 'the explainer exists')
    assert.ok(modesAt < tableAt, 'and it comes before the table it explains')
    assert.ok(figuresAt > 0 && figuresAt < modesAt, 'sitting below the figures, not above them')
    assert.ok(html.includes("Descriptions injected in the model's context, used as needed."), 'context, in one line')
    assert.ok(html.includes('Skills activated through direct reference within the prompt.'), 'command, in one line')
    assert.ok(html.includes('One line in the YAML: <code>disable-model-invocation: true</code>'))
  })

  test('names the two kinds context and command, and never the old two words', () => {
    const ours = html.split('report-data')[0]
    assert.match(ours, /<option value="context"/)
    assert.match(ours, /<option value="command"/)
    assert.equal(/<option value="(passive|active)"/.test(ours), false)
    assert.equal(/\bPassive\b/.test(ours), false, 'the old word is gone from the copy too')
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

  test('gives two controls per skill, one per question, each preset to the suggestion', () => {
    const rows = (html.match(/<tr data-index=/g) || []).length
    assert.equal(rows, report.skills.length)
    // context or command is one question, keep or shorten or delete is another,
    // so a row carries one control for each
    assert.equal((html.match(/select class="action"/g) || []).length, rows)
    assert.equal((html.match(/select class="mode"/g) || []).length, rows)

    // a review suggestion changes nothing, so both controls sit where they are
    const review = report.skills.findIndex((s) => (s.recommendation || {}).action === 'review')
    if (review !== -1) {
      const block = html.split('data-index="' + review + '"').slice(1).join('data-index="')
      assert.match(block.slice(0, 1400), /data-rec="keep"/)
    }
    // a suggestion to make it a command belongs to the type control, never the other
    const gate = report.skills.findIndex((s) => (s.recommendation || {}).action === 'command')
    assert.notEqual(gate, -1, 'the fixture has at least one of these')
    const block = html.split('data-index="' + gate + '"').slice(1).join('data-index="').slice(0, 1600)
    assert.match(block, /class="mode"[^>]*data-rec="command"/)
    assert.match(block, /class="action"[^>]*data-rec="keep"/)
  })

  test('says which choice is a suggestion, without hiding what the skill is today', () => {
    const gate = report.skills.findIndex((s) => (s.recommendation || {}).action === 'command')
    const block = html.split('data-index="' + gate + '"').slice(1).join('data-index="').slice(0, 1600)
    // the option text is the value alone: the state is not smuggled into the word
    assert.equal(/\(suggested\)/.test(html), false, 'no parenthetical inside an option')
    assert.match(block, /<span class="ctl" data-state="suggested"><select class="mode"/)
    assert.match(block, /<span class="state">suggested, Context today<\/span>/)
    // and a row the tool would leave alone carries no state at all
    const keep = report.skills.findIndex((s) => (s.recommendation || {}).action === 'keep')
    if (keep !== -1) {
      const quiet = html.split('data-index="' + keep + '"').slice(1).join('data-index="').slice(0, 1600)
      assert.match(quiet, /<span class="ctl" data-state=""><select class="mode"/)
    }
  })

  test('keys the tags under a name, since a hover tooltip is not discoverable', () => {
    assert.match(html, /<span class="legendk">Tags<\/span>/)
    assert.match(html, /class="legendtext">dropped from the list to fit the budget/)
    // and the location line says where in words, not in a label needing its own key
    assert.match(html, /class="where" title="where this skill lives on this machine">/)
    assert.match(html, /in your skills folder/)
    assert.equal(/>linked in</.test(html), false, 'the old label read as a company name')
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
      assert.ok(['command', 'context', 'optimize', 'delete'].includes(d.action), 'keep is never exported')
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
    assert.match(html, /eats into your plan's limits/)
  })

  test('explains why the wasted and recovered figures cannot match', () => {
    assert.match(html, /do not match, and cannot/)
    assert.match(html, /leaves its <strong>name<\/strong> in the list/)
  })
})

describe('the score, now that it lives here', () => {
  test('is shown above the list it is telling you to change', () => {
    const scoreAt = html.indexOf('id="score"')
    const tableAt = html.indexOf('id="rows-section"')
    assert.ok(scoreAt > 0 && scoreAt < tableAt)
    assert.match(html, /class="sv">\d+<\/span><span class="sd">\/100</)
    assert.match(html, /class="grade (emerald|amber|rose)"/)
  })

  test('carries the headline that says what is buying nothing', () => {
    assert.match(html, /have never been used/)
    assert.match(html, /in every message you send/)
  })

  test('says how the score is built, so it is not a black box', () => {
    assert.match(html, /earned its place \(70\)/)
    assert.match(html, /fits the space your agent gives it \(20\)/)
    assert.match(html, /silently dropped \(10\)/)
  })

  test('keeps that rule behind a question, revealed on hover or focus', () => {
    assert.match(html, /<button type="button" class="tiptrigger" aria-describedby="score-how">/)
    assert.match(html, /How is the score calculated\?/)
    assert.match(html, /<span class="tip" role="tooltip" id="score-how">Scored out of 100/)
    assert.match(html, /\.tipwrap:hover \.tip, \.tipwrap:focus-within \.tip \{[^}]*visibility: visible/)
  })
})
