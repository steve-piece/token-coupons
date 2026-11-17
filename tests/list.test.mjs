import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { renderList } from '../skills/token-coupons/src/render-list.mjs'
import { sampleReport } from './fixtures/sample-report.mjs'

const report = sampleReport()
const html = renderList(report, { cardHref: 'card.html' })
const ours = html.split('id="report-data"')[0]

/** The markup of one row, by its index in report.skills. */
function rowOf (i) {
  const at = html.indexOf('<tr data-i="' + i + '"')
  return at === -1 ? '' : html.slice(at, html.indexOf('</tr>', at))
}
/** The checked value of one of a row's two controls. */
function checked (row, kind) {
  const seg = row.split('data-kind="' + kind + '"')[1] || ''
  const m = seg.split('</div>')[0].match(/value="(\w+)" checked/)
  return m ? m[1] : null
}
const dollars = (s) => Number(String(s).replace(/[^0-9.]/g, ''))
const wasteText = (k) => (html.match(new RegExp('data-wv="' + k + '">([^<]*)<')) || [])[1]
const wasteCount = (k) => Number((html.match(new RegExp('data-wn="' + k + '">(\\d+)<')) || [])[1])

describe('the waste, accounted for in full', () => {
  const names = new Set([...report.economics.neverCalledContext.names, ...report.economics.summonedOnlyContext.names])
  const waste = report.skills.filter((x) => names.has(x.names[0]))
  const total = waste.reduce((n, x) => n + x.dollarsPerMonth, 0)

  test('the headline is every wasted skill priced the way its row is', () => {
    assert.match(html, /<section class="waste" id="waste"/)
    assert.match(html, new RegExp('<span class="wv bad">\\$' + total.toFixed(2) + '</span><span class="wk">wasted a month'))
  })

  test('the bar splits that whole figure, and its parts add back up to it', () => {
    const widths = [...html.matchAll(/class="ws ws-\w+" data-w="\w+" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]))
    assert.equal(widths.length, 5, 'back, new, other tools, still listed, name lines')
    assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.05)
    const parts = ['back', 'fresh', 'elsewhere', 'left', 'nameline'].reduce((n, k) => n + dollars(wasteText(k)), 0)
    assert.ok(Math.abs(parts - total) < 0.01, 'parts ' + parts + ' against ' + total)
  })

  test('back starts on the suggestions, counting only wasted skills', () => {
    const back = waste.reduce((n, x) => {
      const a = x.recommendation.action
      return ['command', 'delete', 'optimize'].includes(a) && x.location !== 'plugin-cache'
        ? n + x.recommendation.impactTokensPerCall * x.dollarsPerMonth / x.listingTokens : n
    }, 0)
    assert.equal(dollars(html.match(/id="k-save">([^<]*)</)[1]).toFixed(2), back.toFixed(2))
    assert.equal(wasteCount('back'), waste.filter((x) => x.recommendation.impactTokensPerCall > 0).length)
  })

  test('a suggestion that saves nothing is still listed, never counted as back', () => {
    // csv-quick-stats is unused and too short: shortening it gives nothing back
    assert.equal(wasteCount('left'), 1)
    assert.match(html, /data-wk="left" title="unused, and nothing in the current choices/)
  })

  test('what shortening a used skill saves is shown apart, since it is not waste', () => {
    assert.match(html, /<p class="wextra" id="w-extra">Plus <b class="good" data-wv="extra">\$[\d.]+<\/b> from shortening <span data-wn="extra">2<\/span> skills you do use/)
    assert.match(html, /id="k-total">\$[\d.]+<\/b> back in all/)
  })

  test('the held back parts are buttons that filter the list to exactly those rows', () => {
    assert.match(html, /<button type="button" class="wl" data-wk="fresh" data-goflag="waste-fresh" aria-pressed="false"/)
    assert.match(html, /<button type="button" class="wl" data-wk="elsewhere" data-goflag="waste-elsewhere" aria-pressed="false"/)
    const tagged = (f) => (html.match(new RegExp('data-flags="[^"]*\\b' + f + '\\b')) || []).length
    assert.equal(tagged('waste-fresh'), wasteCount('fresh'))
    assert.equal(tagged('waste-elsewhere'), wasteCount('elsewhere'))
  })

  test('names the tool that picks them when one does', () => {
    const r = sampleReport()
    const x = r.skills.find((s) => s.names[0] === 'weekly-status-digest')
    x.recommendation = { ...x.recommendation, action: 'keep', impactTokensPerCall: 0, flags: [...x.recommendation.flags, 'picked-elsewhere'] }
    x.callsByClient = { cursor: { calls: 2, contextCalls: 2, commandCalls: 0 } }
    const page = renderList(r)
    assert.match(page, /aria-label="Cursor"[^]*?Cursor picks these<\/span><span class="wlv" data-wv="elsewhere">\$0\.241</)
  })

  test('sits between the score and the list it summarizes', () => {
    const at = (s) => html.indexOf(s)
    assert.ok(at('class="scorecard"') < at('id="waste"') && at('id="waste"') < at('id="list"'))
  })
})

describe('the decision list', () => {
  test('gives two controls per skill, one per question, each preset to the suggestion', () => {
    const rows = (html.match(/<tr data-i=/g) || []).length
    assert.equal(rows, report.skills.length)
    assert.equal((html.match(/<div class="seg" role="radiogroup" data-kind="type"/g) || []).length, rows)
    assert.equal((html.match(/<div class="seg" role="radiogroup" data-kind="action"/g) || []).length, rows)

    // a suggestion to make it a command belongs to the type control, never the other
    const gate = report.skills.findIndex((s) => s.recommendation.action === 'command')
    assert.notEqual(gate, -1, 'the fixture has at least one of these')
    assert.equal(checked(rowOf(gate), 'type'), 'command')
    assert.equal(checked(rowOf(gate), 'action'), 'keep')

    // a review suggestion changes nothing, so both controls sit where they are
    const review = report.skills.findIndex((s) => s.recommendation.action === 'review')
    assert.equal(checked(rowOf(review), 'action'), 'keep')
  })

  test('marks the suggestion and what the skill is today, without words inside the options', () => {
    const gate = report.skills.findIndex((s) => s.recommendation.action === 'command')
    const row = rowOf(gate)
    assert.match(row, /<label class="sg today"><input type="radio" name="t\d+" value="context"/)
    assert.match(row, /<label class="sg sug"><input type="radio" name="t\d+" value="command" checked/)
    assert.equal(/\(suggested\)/.test(html), false)
    assert.match(row, /data-state="suggested"/)
    const keep = report.skills.findIndex((s) => s.recommendation.action === 'keep')
    assert.match(rowOf(keep), /data-state=""/)
  })

  test('names the two kinds context and command, and never the old two words', () => {
    assert.match(ours, /value="context"/)
    assert.match(ours, /value="command"/)
    assert.equal(/value="(passive|active)"/.test(ours), false)
    assert.equal(/\bPassive\b/.test(ours), false)
    assert.match(ours, /disable-model-invocation: true/, 'the one line that makes a command is named')
  })

  test('prices every row in money', () => {
    const rows = (html.match(/<tr data-i=/g) || []).length
    assert.equal((html.match(/<td class="num cost"><span class="cv">\$/g) || []).length, rows)
    assert.ok(html.includes('Cost / mo'))
  })

  test('draws usage and description length as data, and keeps tags for the rest', () => {
    assert.match(html, /<span class="pk">agent<\/span>/)
    assert.match(html, /<span class="pk">you<\/span>/)
    assert.match(html, /<div class="meter (ok|warn|danger)"/)
    assert.match(html, /<span class="tag danger" title="dropped from the listing to fit the budget[^"]*">Out of reach<\/span>/)
    assert.match(html, /<span class="tag plain" title="[^"]*">Already a command<\/span>/)
  })

  test('refuses to offer delete where the folder is not the person to fix', () => {
    const cached = report.skills.findIndex((s) => s.location === 'plugin-cache')
    assert.match(rowOf(cached), /<label class="sg dis" title="lives in a plugin cache; uninstall the plugin instead"><input type="radio" name="a\d+" value="delete" disabled/)
  })

  test('links back to the card when it has one, and omits the link when it does not', () => {
    assert.ok(html.includes('<a class="back" href="card.html">Back to the scorecard</a>'))
    assert.equal(renderList(report).includes('Back to the scorecard'), false)
  })

  test('is self contained, follows the reader\'s theme, and is free of the banned characters', () => {
    assert.equal(/(?:src|href)="https?:/.test(html), false, 'no external asset')
    assert.equal(html.split('id="report-data"').length - 1, 1, 'one data island for the page script')
    assert.ok(html.includes('color-scheme: light dark'))
    assert.equal(html.includes('__LABELS__'), false, 'the tool names are filled in')
    const DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) => String.fromCodePoint(c))
    // only our own markup: a skill description on disk may contain anything
    assert.equal(DASHES.some((d) => ours.includes(d)), false)
  })

  test('is the same bytes every time it is built from the same report', () => {
    assert.equal(renderList(report, { cardHref: 'card.html' }), html)
  })

  test('the decisions file starts on the suggestions, in the contract shape', () => {
    const raw = html.slice(html.indexOf('<textarea id="decisions-json"'))
    const inner = raw.slice(raw.indexOf('>') + 1, raw.indexOf('</textarea>'))
    const json = JSON.parse(inner
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    assert.equal(json.version, 1)
    assert.equal(json.source, 'token-coupons html report')
    for (const d of json.decisions) {
      assert.ok(d.name && typeof d.path === 'string')
      assert.ok(['command', 'context', 'optimize', 'delete'].includes(d.action), 'keep is never exported')
    }
    const gate = report.skills.find((s) => s.recommendation.action === 'command')
    assert.ok(json.decisions.some((d) => d.name === gate.names[0] && d.action === 'command'))
    const cached = report.skills.find((s) => s.location === 'plugin-cache')
    assert.equal(json.decisions.some((d) => d.name === cached.names[0] && d.action === 'delete'), false)
  })

  test('survives a report with nothing in it', () => {
    const out = renderList({ summary: {}, skills: [] })
    assert.ok(out.includes('</html>'))
    assert.equal(out.includes('undefined'), false)
    assert.equal(out.includes('NaN'), false)
    assert.equal(out.includes('id="waste"'), false, 'no waste, no breakdown')
  })
})

describe('the questions a reader asks about the money', () => {
  test('says the figures are API prices, and what a flat plan actually pays', () => {
    assert.match(html, /API prices; on a flat plan it is not a bill but it eats into your limits/)
  })

  test('says what the used count was counted over, and how many uses that was', () => {
    assert.match(html, /<span class="kv">9<span class="of">\/12<\/span><\/span><span class="kk">used, last 30 days/)
    assert.match(html, /61 uses in all\. The rest were sent with every message and never opened\./)
  })

  test('the window is whatever was measured, and a report that predates it draws no tile for it', () => {
    const short = sampleReport()
    short.totals.usedRecently = { days: 9, skills: 1, uses: 1 }
    assert.match(renderList(short), /<span class="kv">1<span class="of">\/12<\/span><\/span><span class="kk">used, last 9 days/)

    const older = sampleReport()
    delete older.totals.usedRecently
    const before = renderList(older)
    assert.equal(/used, last/.test(before), false)
    assert.match(before, /<div class="kpis" style="--k:2">/, 'the tiles close up around the missing one')
  })
})

describe('the score', () => {
  test('is shown above the list it is telling you to change', () => {
    assert.ok(html.indexOf('class="scorecard"') < html.indexOf('id="list"'))
    assert.match(html, /class="sv">\d+<\/span><span class="sd">\/100</)
    assert.match(html, /class="grade (emerald|amber|rose)"/)
  })

  test('carries the headline that says what is buying nothing', () => {
    assert.match(html, /have never been used/)
    assert.match(html, /in every message you send/)
  })

  test('shows how it is built, one bar per part', () => {
    for (const [label, max] of [['Earned', 70], ['Fits', 20], ['Reach', 10]]) {
      assert.match(html, new RegExp('<span class="pk">' + label + '</span>[^]*?<span class="dim">/' + max + '</span>'))
    }
  })
})
