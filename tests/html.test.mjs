import test from 'node:test'
import assert from 'node:assert/strict'

import { renderHtml } from '../src/render-html.mjs'
import { sampleReport } from './fixtures/sample-report.mjs'

const FORBIDDEN_DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]
  .map((c) => String.fromCodePoint(c))

const report = sampleReport()
const html = renderHtml(report)

/** The JSON island, decoded. */
function islandJson (source = html) {
  const m = source.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)
  assert.ok(m, 'the report data island is missing')
  return JSON.parse(m[1])
}

/** Every `<select>` block, in document order. */
function selectBlocks (source = html) {
  return source.split('<select').slice(1).map((chunk) => '<select' + chunk.slice(0, chunk.indexOf('</select>')))
}

/** What the action control should start on: the recommendation, with review folded into keep. */
function expectedPreset (skill) {
  const action = (skill.recommendation || {}).action
  if (action === 'review' || !action) return 'keep'
  if (action === 'delete' && skill.location === 'plugin-cache') return 'keep'
  return action
}

test('renders one document with a doctype and a title', () => {
  assert.ok(html.startsWith('<!doctype html>'))
  assert.match(html, /<title>[^<]*token-coupons[^<]*<\/title>/)
})

test('embeds the report once and it parses back to the same summary', () => {
  assert.equal(html.split('id="report-data"').length - 1, 1)
  const parsed = islandJson()
  assert.deepEqual(parsed.summary, report.summary)
  assert.equal(parsed.skills.length, report.skills.length)
})

test('escapes < inside the island so nothing can close the tag early', () => {
  const raw = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1]
  assert.equal(raw.includes('<'), false, 'a raw < survived into the JSON island')
  const spiked = renderHtml(Object.assign({}, report, {
    tool: { name: 'token-coupons', version: '</script><script>boom()</script>' },
  }))
  assert.equal(islandJson(spiked).tool.version, '</script><script>boom()</script>')
})

test('one action control per skill', () => {
  const blocks = selectBlocks()
  assert.equal(blocks.length, report.skills.length)
  blocks.forEach((block, i) => {
    assert.ok(block.includes('data-index="' + i + '"'))
    assert.ok(block.includes('data-name="' + report.skills[i].names[0] + '"'))
  })
})

test('every control offers Keep, Passive, Active, Optimize, Delete', () => {
  for (const block of selectBlocks()) {
    for (const value of ['keep', 'passive', 'active', 'optimize', 'delete']) {
      assert.ok(block.includes('<option value="' + value + '"'), 'missing option ' + value)
    }
  }
})

test('the preselected option is the recommendation, with review mapped to keep', () => {
  const blocks = selectBlocks()
  report.skills.forEach((skill, i) => {
    const selected = blocks[i].match(/<option value="([a-z]+)" selected/)
    assert.ok(selected, 'no preselected option for ' + skill.names[0])
    assert.equal(selected[1], expectedPreset(skill), 'wrong preset for ' + skill.names[0])
    assert.equal(blocks[i].split(' selected').length - 1, 1, 'more than one option preselected')
  })
  // the fixture really does exercise the review mapping
  assert.ok(report.skills.some((s) => (s.recommendation || {}).action === 'review'))
})

test('Delete is disabled for skills living in a plugin cache', () => {
  const blocks = selectBlocks()
  const cached = report.skills.filter((s) => s.location === 'plugin-cache')
  assert.ok(cached.length > 0, 'the fixture needs at least one plugin cache skill')
  report.skills.forEach((skill, i) => {
    const del = blocks[i].match(/<option value="delete"[^>]*>/)[0]
    const disabled = del.includes('disabled')
    assert.equal(disabled, skill.location === 'plugin-cache', 'wrong delete state for ' + skill.names[0])
  })
})

test('carries all three theme blocks and paints the body itself', () => {
  assert.ok(html.includes(':root {'), 'no light palette on :root')
  assert.ok(html.includes('@media (prefers-color-scheme: dark)'), 'no system dark block')
  assert.ok(html.includes(':root:not([data-theme="light"])'), 'system dark block is not guarded')
  assert.ok(html.includes(':root[data-theme="dark"]'), 'no explicit dark block')
  assert.match(html, /body\s*\{[^}]*background:\s*var\(--bg\)/)
})

test('no forbidden dash anywhere in the output', () => {
  for (const ch of FORBIDDEN_DASHES) {
    const at = html.indexOf(ch)
    assert.equal(at, -1, 'U+' + ch.codePointAt(0).toString(16).toUpperCase() + ' near: ' + html.slice(Math.max(0, at - 60), at + 60))
  }
})

test('loads nothing from the network: the only URLs are the pricing sources', () => {
  const allowed = new Set(report.cost.perModel.map((m) => m.source).filter(Boolean))
  const found = html.match(/https?:\/\/[^\s"'<>\\)]+/g) || []
  assert.ok(found.length > 0, 'the fixture should carry at least one pricing source link')
  for (const url of found) assert.ok(allowed.has(url), 'unexpected URL in the page: ' + url)
  assert.equal(/<link\s/i.test(html), false, 'no external stylesheet may be linked')
  assert.equal(/<script[^>]+src=/i.test(html), false, 'no external script may be loaded')
  assert.equal(/<img\s/i.test(html), false, 'no remote image may be loaded')
  assert.equal(/@import/.test(html), false)
  assert.equal(/url\(\s*['"]?https?:/.test(html), false)
})

test('the export footer says exactly what to do next', () => {
  assert.ok(html.includes('Save this as decisions.json, then tell your agent: proceed with token-coupons apply decisions.json'))
  assert.ok(html.includes('id="decisions-json"'))
  assert.ok(html.includes('Accept all recommendations'))
  assert.ok(html.includes('Reset to recommendations'))
  assert.ok(html.includes('Copy JSON'))
  assert.ok(html.includes('Download decisions.json'))
})

test('the textarea starts holding a decisions file in the contract shape', () => {
  const raw = html.match(/<textarea id="decisions-json"[^>]*>([\s\S]*?)<\/textarea>/)[1]
  const decoded = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const parsed = JSON.parse(decoded)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.source, 'token-coupons html report')
  assert.equal(parsed.generatedOn, report.generatedOn)
  assert.ok(Array.isArray(parsed.decisions))
  for (const d of parsed.decisions) {
    assert.ok(['active', 'passive', 'optimize', 'delete'].includes(d.action), 'keep is a no-op and must not be exported')
    assert.ok(d.path.startsWith('~'), 'paths are exported tildified: ' + d.path)
    assert.ok(report.skills.some((s) => s.names[0] === d.name))
  }
  const expected = report.skills.filter((s) => expectedPreset(s) !== 'keep').length
  assert.equal(parsed.decisions.length, expected)
})

test('shows every section the contract asks for, in order', () => {
  const order = ['id="cost"', 'id="recommendations"', 'id="heaviest"', 'id="thin"', 'id="unroutable"', 'id="export"']
  let at = -1
  for (const marker of order) {
    const found = html.indexOf(marker)
    assert.ok(found > at, marker + ' is missing or out of order')
    at = found
  }
})

test('the verdict header carries the five numbers and the savings sentence', () => {
  const head = html.slice(0, html.indexOf('id="cost"'))
  assert.equal(head.split('class="bignum"').length - 1, 5)
  assert.ok(head.includes('skills in your listing'))
  assert.ok(head.includes('tokens in every message'))
  assert.ok(head.includes('never once used'))
  assert.ok(head.includes('cannot be reached'))
  assert.ok(head.includes('against its allowance'))
  assert.ok(head.includes(String(report.summary.savedTokensPerCallIfApplied)))
  assert.ok(head.includes(report.summary.wastedPerWeekOnYourModel.model))
})

test('the cost strip has a card per model, a price mode toggle, and the honest fine print', () => {
  const strip = html.slice(html.indexOf('id="cost"'), html.indexOf('id="recommendations"'))
  assert.equal(strip.split('<article class="card').length - 1, report.cost.perModel.length)
  assert.ok(strip.includes('data-mode="cached"'))
  assert.ok(strip.includes('data-mode="uncached"'))
  assert.ok(strip.includes('data-uncached='), 'cards must carry the uncached numbers for the toggle')
  assert.ok(strip.includes('your model'), 'the model seen in transcripts needs its badge')
  assert.ok(strip.includes('requests per chat'))
  assert.ok(strip.includes('Prices checked on ' + report.cost.pricingVerifiedOn))
  assert.ok(/of everything you send in a week/.test(strip))
})

test('the table is filterable, searchable, and scrolls in its own container', () => {
  for (const f of ['never-called', 'summoned-only', 'heavy-description', 'thin-description', 'unroutable', 'changed', 'all']) {
    assert.ok(html.includes('data-filter="' + f + '"'), 'missing filter ' + f)
  }
  assert.ok(html.includes('id="search"'))
  assert.match(html, /\.tablewrap \{ overflow-x: auto;/)
  assert.match(html, /thead th \{ position: sticky;/)
  report.skills.forEach((s) => {
    const flags = (s.recommendation.flags || []).join(' ')
    assert.ok(html.includes('data-flags="' + flags + '"'), 'row flags not exposed for ' + s.names[0])
  })
})

test('the heaviest, thin, and unroutable lists name real rows', () => {
  const heavy = html.slice(html.indexOf('id="heaviest"'), html.indexOf('id="thin"'))
  assert.ok(heavy.includes(report.heaviest[0].names[0]))
  assert.ok(heavy.includes('needs a rewrite'))
  const thin = html.slice(html.indexOf('id="thin"'), html.indexOf('id="unroutable"'))
  assert.ok(thin.includes(report.thin[0].names[0]))
  assert.ok(thin.includes('unfindable'))
  const un = html.slice(html.indexOf('id="unroutable"'), html.indexOf('id="export"'))
  for (const name of report.economics.overflowUnroutable.names) assert.ok(un.includes(name), 'missing ' + name)
  assert.ok(un.includes('claude plugin details'))
})

test('jargon carries a plain explanation', () => {
  for (const phrase of ['re-sends a list of every skill', 'the agent read the description and chose this skill on its own',
    'you typed the name of this skill yourself', 'the usual case', 'nothing warns you',
    'the context window is how much text the model can hold at once']) {
    assert.ok(html.includes(phrase), 'missing plain language for: ' + phrase)
  }
})

test('the inline script is valid JavaScript and never closes its own tag', () => {
  const blocks = html.split('<script>').slice(1).map((c) => c.slice(0, c.indexOf('</script>')))
  assert.equal(blocks.length, 1, 'there should be exactly one behaviour script')
  assert.equal(blocks[0].includes('<' + '/script'), false)
  assert.doesNotThrow(() => new Function(blocks[0]), 'the inline script does not parse')
  assert.ok(blocks[0].length < 12000, 'keep the page script small and readable')
})

test('the markup balances', () => {
  const pairs = [['<section', '</section>'], ['<article', '</article>'], ['<table', '</table>'],
    ['<tr', '</tr>'], ['<select', '</select>'], ['<textarea', '</textarea>'], ['<ul', '</ul>'], ['<li>', '</li>']]
  for (const [open, close] of pairs) {
    assert.equal(html.split(open).length, html.split(close).length, 'unbalanced ' + open)
  }
  assert.equal(html.split('<td').length, html.split('</td>').length)
  assert.equal((html.match(/<th[\s>]/g) || []).length, (html.match(/<\/th>/g) || []).length)
})

test('stays small enough to open anywhere', () => {
  assert.ok(Buffer.byteLength(html, 'utf8') < 200 * 1024, 'page is ' + Buffer.byteLength(html, 'utf8') + ' bytes')
})

test('survives a report with the optional pieces missing', () => {
  const bare = { version: 1, generatedOn: '2026-08-15', summary: {}, skills: [] }
  const out = renderHtml(bare)
  assert.ok(out.startsWith('<!doctype html>'))
  assert.ok(out.includes('Save this as decisions.json'))
  assert.equal(selectBlocks(out).length, 0)
  assert.deepEqual(islandJson(out).summary, {})
})

test('warns when the price table has gone stale', () => {
  const stale = sampleReport()
  stale.cost.pricingStale = true
  const out = renderHtml(stale)
  assert.ok(out.includes('These prices are more than two months old'))
})
