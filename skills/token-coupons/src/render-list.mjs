// The decision list. The companion to the share card: same dark ground, same
// mono voice, but where the card carries one number this page carries every
// row behind it and lets a person change any of them.
//
// Three things shape it:
//
//   Money, not tokens. A token count is a unit nobody has intuition for. Every
//   row is priced per month at the same rate the card quotes, so the two
//   documents can never disagree about what a skill costs.
//
//   Passive and active first. Nobody can make these decisions without knowing
//   what the two modes are, so the page opens by explaining them and nothing
//   else. That difference is the only lever the tool pulls.
//
//   One dark look, no light variant, matching the card it ships beside.
//
// Nothing here writes to disk. The page produces a decisions file the person
// pastes back to their agent, which is what actually applies anything.

import { fmt, money } from './lib/util.mjs'
import { INK, MONO } from './render-card.mjs'
import { scoreReport, headline, GRADE_COLOR } from './score.mjs'

const ACTIONS = [
  ['keep', 'Keep', 'leave this skill exactly as it is'],
  ['passive', 'Passive', 'let the agent pick it, which means paying for its description in every message'],
  ['active', 'Active', 'stop sending the description; reach it by typing its name'],
  ['optimize', 'Optimize', 'keep the skill, rewrite the description shorter'],
  ['delete', 'Delete', 'remove it, moving the folder to a trash directory so you can put it back'],
]

const FILTERS = [
  ['all', 'All'],
  ['never-called', 'Never used'],
  ['summoned-only', 'You type it'],
  ['heavy-description', 'Too long'],
  ['thin-description', 'Too short'],
  ['unroutable', 'Out of reach'],
  ['changed', 'Changed by me'],
]

/** @param {object} report a Report from report.mjs @returns {string} one HTML document */
export function renderList (report, { cardHref = null } = {}) {
  const r = report || {}
  const s = r.summary || {}
  const skills = Array.isArray(r.skills) ? r.skills : []

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Skill Decisions</title>',
    '<style>' + styles() + '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    header(r, s, cardHref),
    score(r, s),
    modes(),
    figures(s, r.cost),
    table(skills, r),
    notListed(r),
    exportFooter(r, skills),
    '</div>',
    island(r),
    '<script>' + script() + '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/* ------------------------------------------------------------------ head */

function header (r, s, cardHref) {
  return [
    '<header class="head">',
    '<div class="mast">',
    '<span class="dot"></span><span class="brand">token-coupons</span>',
    cardHref ? '<a class="back" href="' + attr(cardHref) + '">Back to the scorecard</a>' : '',
    '<span class="when">' + esc(r.generatedOn || '') + '</span>',
    '</div>',
    '<h1>Every skill, and what it costs you</h1>',
    '<p class="lede">' + fmt(s.skills || 0) + ' skills ride along in every message you send. Below is each one, what it costs a ' +
      'month, and what to do about it. Change any row you disagree with, then send the result back to your agent. Nothing on ' +
      'this page touches your disk.</p>',
    '</header>',
  ].join('\n')
}

/**
 * The segmentation, stated before anything asks the reader to use it. Two
 * modes, one line each on what each costs, because that difference is the
 * whole lever.
 */
function modes () {
  return [
    '<section class="section" id="modes">',
    '<h2 class="eyebrow">The two modes, and the whole idea</h2>',
    '<div class="modes">',
    '<article class="mode">',
    '<div class="modehead"><span class="pill warn">Passive</span></div>',
    '<p>Descriptions injected in the model\'s context, used as needed.</p>',
    '</article>',
    '<article class="mode">',
    '<div class="modehead"><span class="pill good">Active</span></div>',
    '<p>Skills activated through direct reference within the prompt.</p>',
    '<p class="modefine">One line in the YAML: <code>disable-model-invocation: true</code></p>',
    '</article>',
    '</div>',
    '<p class="note">Every row below is that one question: <strong>does the agent need to find this by itself, or do you ' +
      'always reach for it yourself?</strong> If you always type it, make it active and it stops costing you anything.</p>',
    '</section>',
  ].join('\n')
}

/**
 * The score, and what is behind it. It lives here rather than on the card
 * because it is a diagnosis: it belongs next to the list of things it is
 * telling you to change, not on the thing you post afterwards.
 */
function score (r, s) {
  const scored = scoreReport(r)
  const tone = GRADE_COLOR[scored.grade] || 'rose'
  return [
    '<section class="section" id="score">',
    '<div class="scorerow">',
    '<div class="scorenum"><span class="sv">' + esc(String(scored.score)) + '</span><span class="sd">/100</span></div>',
    '<span class="grade ' + tone + '">' + esc(scored.grade) + '</span>',
    '<div class="scoretext">',
    headline(s, r.economics || {}, scored).map((l) => '<p>' + esc(l) + '</p>').join(''),
    '</div>',
    '</div>',
    '<p class="note">Scored out of 100: how much of the list has earned its place (70), whether it fits its allowance (20), ' +
      'and whether anything is being silently dropped (10). Every change below moves it.</p>',
    '</section>',
  ].join('\n')
}

/* --------------------------------------------------------------- figures */

function figures (s, cost) {
  const wasted = s.wastedPerWeekOnYourModel
  const saved = s.savedOnYourModel
  const model = (saved && saved.model) || (wasted && wasted.model) || null
  const share = ((cost || {}).volume || {}).wastedShareOfInput
  const shareText = (typeof share === 'number' && share > 0)
    ? (share < 0.001 ? 'under 0.1 percent' : (share * 100).toFixed(1) + ' percent')
    : null
  const cells = []
  // Green on what you get back, red on the count that causes it. The wasted
  // figure sits between them and needs no colour of its own.
  if (saved) cells.push(fig(money(saved.dollarsPerMonth), 'a month, back', 'good'))
  if (wasted) cells.push(fig(money(wasted.dollarsPerMonth), 'a month, wasted', 'plain'))
  cells.push(fig(fmt(s.neverCalledPassive || 0), 'skills never used', 'bad'))
  if (!cells.length) return ''
  // Two things a reader will otherwise get wrong: why the two dollar figures
  // differ, and whether a flat plan actually bills any of this.
  const residue = (wasted && saved && typeof wasted.dollarsPerMonth === 'number' && typeof saved.dollarsPerMonth === 'number')
    ? wasted.dollarsPerMonth - saved.dollarsPerMonth : null
  const notes = []
  notes.push('<p class="note">' + (model ? 'At ' + esc(model) + ' API prices. ' : '') +
    'On a flat plan this is not a bill you will see: it is what the waste is worth, and it comes out of your usage allowance ' +
    'instead' + (shareText ? ', where it is ' + esc(shareText) + ' of everything you send' : '') + '.</p>')
  if (residue !== null && residue > 0.005) {
    notes.push('<p class="note">The two figures do not match, and cannot: gating a skill removes its description but leaves its ' +
      '<strong>name</strong> in the list. Those name lines are the last ' + esc(money(residue)) + ' a month, and no decision here ' +
      'removes them.</p>')
  }
  return [
    '<section class="section" id="figures">',
    '<div class="figs">' + cells.join('') + '</div>',
    notes.join(''),
    '</section>',
  ].join('\n')
}

function fig (value, label, tone) {
  return '<div class="fig ' + tone + '"><span class="v">' + esc(value) + '</span>' +
    '<span class="k">' + esc(label) + '</span></div>'
}

/* ----------------------------------------------------------------- table */

function table (skills, r) {
  const priced = skills.some((x) => typeof x.dollarsPerMonth === 'number')
  const maxCost = skills.reduce((n, x) => Math.max(n, Number(x.dollarsPerMonth) || 0), 0) || 1

  const rows = skills.map((x, i) => {
    const rec = x.recommendation || {}
    const flags = Array.isArray(rec.flags) ? rec.flags : []
    const name = (x.names && x.names[0]) || x.name || 'skill'
    const preset = presetFor(rec.action, x.location)
    const cost = Number(x.dollarsPerMonth) || 0
    const bar = Math.max(2, Math.round((cost / maxCost) * 100))
    const marks = []
    if (flags.includes('unroutable')) marks.push(mark('danger', 'out of reach', 'your agent is dropping this description to fit, so it cannot pick this skill and nothing warns you'))
    if (flags.includes('capped')) marks.push(mark('warn', 'cut off', 'longer than your agent will read, so the tail is thrown away'))
    if (x.sourcePath) marks.push(mark('plain', 'source on disk', 'the editable copy is at ' + x.sourcePath))

    return [
      '<tr data-index="' + i + '" data-flags="' + attr(flags.join(' ')) + '" data-changed="no">',
      '<td class="num rank">' + esc(String(rec.rank || i + 1)) + '</td>',
      '<td class="skill">',
      '<button type="button" class="sname" data-detail="' + i + '" aria-expanded="false">' + esc(name) + '</button>',
      '<span class="where">' + esc([x.plugin ? 'from ' + x.plugin : '', locationLabel(x.location)].filter(Boolean).join(', ')) + '</span>',
      marks.length ? '<span class="marks">' + marks.join('') + '</span>' : '',
      '</td>',
      '<td>' + (x.mode === 'active' ? '<span class="pill good sm">Active</span>' : '<span class="pill warn sm">Passive</span>') + '</td>',
      '<td class="num">' + fmt(x.passiveCalls || 0) + '</td>',
      '<td class="num">' + fmt(x.activeCalls || 0) + '</td>',
      '<td class="num cost">' + (priced
        ? '<span>' + esc(money(cost)) + '</span><span class="bar" aria-hidden="true"><i style="width:' + bar + '%"></i></span>'
        : '<span>' + fmt(x.descriptionTokens || 0) + '</span>') + '</td>',
      '<td>' + recPill(rec.action) + '</td>',
      '<td class="why">' + esc(rec.reason || '') + '</td>',
      '<td class="act">' + select(x, i, name, preset) + '</td>',
      '</tr>',
    ].join('')
  }).join('\n')

  const unroutable = (r.economics && r.economics.overflowUnroutable && r.economics.overflowUnroutable.count) || 0
  return [
    '<section class="section" id="rows-section">',
    '<div class="sechead"><h2>The list</h2><span class="count" id="row-count">' + skills.length + ' skills</span></div>',
    '<div class="chips" role="group" aria-label="filters">',
    FILTERS.map(([v, label]) => '<button type="button" class="chip' + (v === 'all' ? ' on' : '') +
      '" data-filter="' + attr(v) + '" aria-pressed="' + (v === 'all' ? 'true' : 'false') + '">' + esc(label) + '</button>').join(''),
    '</div>',
    '<input type="search" id="search" placeholder="Search names, plugins, descriptions" aria-label="search the list">',
    '<div class="tablewrap">',
    '<table>',
    '<thead><tr>',
    '<th class="num rank">#</th>',
    '<th>Skill</th>',
    '<th>Today</th>',
    '<th class="num" title="the agent read the description and chose it on its own">Agent</th>',
    '<th class="num" title="you typed its name">You</th>',
    '<th class="num">' + (priced ? 'Cost a month' : 'Desc. tokens') + '</th>',
    '<th>Suggested</th>',
    '<th>Why</th>',
    '<th>Your call</th>',
    '</tr></thead>',
    '<tbody id="rows">' + rows + '</tbody>',
    '</table>',
    '</div>',
    '<p class="note">Click a skill name to see its full description and path.' +
      (unroutable ? ' The rows marked out of reach are already being dropped: installed, correct, and still unreachable.' : '') + '</p>',
    '</section>',
  ].join('\n')
}

function select (x, i, name, preset) {
  const locked = x.location === 'plugin-cache'
  const opts = ACTIONS.map(([value, label, tip]) => {
    const disabled = value === 'delete' && locked
    return '<option value="' + value + '"' + (value === preset ? ' selected' : '') + (disabled ? ' disabled' : '') +
      ' title="' + attr(disabled ? 'this lives in a plugin cache folder; remove it with claude plugin uninstall instead' : tip) + '">' +
      esc(label) + '</option>'
  }).join('')
  return '<select class="action" data-index="' + i + '" data-rec="' + attr(preset) + '" data-name="' + attr(name) +
    '" aria-label="' + attr('what to do with ' + name) + '">' + opts + '</select>'
}

/** The control starts on the suggestion. Review has no control of its own, so it lands on Keep. */
export function presetFor (action, location) {
  if (action === 'review' || !action) return 'keep'
  if (action === 'delete' && location === 'plugin-cache') return 'keep'
  return ACTIONS.some(([v]) => v === action) ? action : 'keep'
}

function recPill (action) {
  const tone = { delete: 'danger', optimize: 'warn', active: 'good', passive: 'good', review: 'plain', keep: 'plain' }[action] || 'plain'
  const label = { delete: 'Delete', optimize: 'Shorten', active: 'Active', passive: 'Passive', review: 'Review', keep: 'Keep' }[action] || 'Keep'
  return '<span class="pill ' + tone + ' sm">' + esc(label) + '</span>'
}

function mark (tone, label, tip) {
  return '<span class="pill ' + tone + ' xs" title="' + attr(tip) + '">' + esc(label) + '</span>'
}

/* ------------------------------------------------------------ not listed */

function notListed (r) {
  const list = Array.isArray(r.notLoaded) ? r.notLoaded : []
  if (!list.length) return ''
  const groups = new Map()
  for (const n of list) { const a = groups.get(n.reason) || []; a.push(n); groups.set(n.reason, a) }
  return [
    '<section class="section" id="not-listed">',
    '<details>',
    '<summary>' + fmt(list.length) + ' more skills sit on disk and cost you nothing</summary>',
    '<p class="note">Your agent does not put these in the list from this folder, so they are neither scored nor priced. Grouped by why.</p>',
    [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([reason, items]) =>
      '<h3 class="grouphead">' + fmt(items.length) + ' <span class="dim">' + esc(reason) + '</span></h3>' +
      '<p class="names">' + items.map((n) => esc(n.name)).join(', ') + '</p>').join(''),
    '</details>',
    '</section>',
  ].join('\n')
}

/* ---------------------------------------------------------------- export */

function exportFooter (r, skills) {
  const starting = JSON.stringify(decisionsOf(r, skills), null, 2)
  return [
    '<section class="section" id="export">',
    '<div class="sechead"><h2>Send it back</h2><span class="count" id="changed-count">0 changed</span></div>',
    '<p class="note">Copy this and paste it into your next message with <code>proceed with these decisions</code>. Your agent ' +
      'shows you the plan and waits for a yes before touching anything.</p>',
    '<div class="codeblock">',
    '<div class="codehead"><span class="codetitle">decisions.json</span>',
    '<button type="button" id="copy" class="go sm">Copy</button>',
    '<button type="button" id="reset" class="ghost sm">Reset my changes</button>',
    '</div>',
    '<textarea id="decisions-json" spellcheck="false" aria-label="the decisions file, ready to copy">' + esc(starting) + '</textarea>',
    '</div>',
    '<p class="note" id="export-note" role="status" aria-live="polite">Nothing has changed on disk, and nothing will until you say so.</p>',
    '</section>',
  ].join('\n')
}

function decisionsOf (r, skills) {
  return {
    version: 1,
    generatedOn: r.generatedOn || null,
    source: 'token-coupons html report',
    decisions: skills.map((x) => {
      const action = presetFor((x.recommendation || {}).action, x.location)
      if (action === 'keep') return null
      return { name: (x.names && x.names[0]) || x.name, path: x.path || x.realPath || '', action, note: '' }
    }).filter(Boolean),
  }
}

function island (report) {
  return '<script type="application/json" id="report-data">' + JSON.stringify(report).replace(/</g, '\\u003c') + '</script>'
}

/* ---------------------------------------------------------------- pieces */

function locationLabel (loc) {
  return {
    user: 'your folder', 'user-symlink': 'linked in', project: 'this project', marketplace: 'marketplace',
    'plugin-cache': 'plugin cache', 'agents-dir': 'agents folder', cursor: 'cursor folder', other: 'elsewhere',
  }[loc] || String(loc || '')
}

function esc (v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function attr (v) { return esc(v) }

/* ----------------------------------------------------------------- style */

function styles () {
  return `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: ${INK.ink}; color: ${INK.text}; font: 14.5px/1.6 ${MONO}; overflow-x: hidden; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 40px 24px 96px; }
h1 { font-size: 30px; letter-spacing: -0.01em; margin: 18px 0 0; font-weight: 700; }
h2 { font-size: 19px; margin: 0; font-weight: 700; }
h3 { font-size: 14px; margin: 16px 0 2px; font-weight: 600; }
p { margin: 0 0 10px; }
code { font-size: .92em; background: ${INK.panelUp}; padding: 2px 6px; border-radius: 6px; color: ${INK.cyan}; }
strong { color: ${INK.text}; font-weight: 700; }
a { color: ${INK.cyan}; }

.mast { display: flex; align-items: center; gap: 12px; }
.dot { width: 11px; height: 11px; border-radius: 50%; background: ${INK.cyan}; box-shadow: 0 0 14px ${INK.cyan}; }
.brand { font-weight: 700; font-size: 17px; }
.back { font-size: 13px; text-decoration: none; border: 1px solid ${INK.line}; border-radius: 999px; padding: 4px 12px; }
.back:hover { border-color: ${INK.cyan}; }
.when { margin-left: auto; color: ${INK.muted}; font-size: 13px; }
.lede { color: ${INK.muted}; max-width: 78ch; margin-top: 10px; }

.section { margin-top: 44px; }
.sechead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid ${INK.line}; padding-bottom: 10px; margin-bottom: 16px; }
.eyebrow { font-size: 13px; letter-spacing: .22em; text-transform: uppercase; color: ${INK.muted}; font-weight: 400; margin-bottom: 14px; }
.note { color: ${INK.muted}; font-size: 13.5px; max-width: 84ch; }
.count { color: ${INK.muted}; font-size: 13px; }
.dim { color: ${INK.muted}; font-weight: 400; }

.scorerow { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.scorenum { display: flex; align-items: baseline; gap: 6px; }
.sv { font-size: 72px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.sd { font-size: 22px; color: ${INK.muted}; }
.grade { display: inline-flex; align-items: center; justify-content: center; width: 58px; height: 58px; border-radius: 16px; font-size: 32px; font-weight: 700; background: ${INK.panelUp}; border: 1px solid ${INK.line}; }
.grade.emerald { color: ${INK.emerald}; border-color: ${INK.emerald}; }
.grade.amber { color: ${INK.amber}; border-color: ${INK.amber}; }
.grade.rose { color: ${INK.rose}; border-color: ${INK.rose}; }
.scoretext { flex: 1 1 380px; min-width: 300px; }
.scoretext p { margin: 0; font-size: 15px; }
.scoretext p + p { color: ${INK.muted}; }

.modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.mode { background: ${INK.panel}; border: 1px solid ${INK.line}; border-radius: 16px; padding: 18px 22px; }
.modehead { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.modecost { color: ${INK.muted}; font-size: 13px; }
.mode p { color: ${INK.muted}; margin: 0 0 8px; }
.modefine { font-size: 13px; border-top: 1px solid ${INK.line}; padding-top: 10px; margin: 12px 0 0 !important; }

.pill { display: inline-block; border-radius: 999px; padding: 3px 12px; font-size: 13px; font-weight: 700; border: 1px solid transparent; white-space: nowrap; }
.pill.sm { font-size: 12px; padding: 2px 10px; font-weight: 600; }
.pill.xs { font-size: 11px; padding: 1px 8px; font-weight: 500; }
.pill.good { background: rgba(53,227,161,.14); color: ${INK.emerald}; }
.pill.warn { background: rgba(255,192,105,.14); color: ${INK.amber}; }
.pill.danger { background: rgba(255,107,138,.14); color: ${INK.rose}; }
.pill.plain { background: ${INK.panelUp}; color: ${INK.muted}; border-color: ${INK.line}; }

.figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
.fig { background: ${INK.panel}; border: 1px solid ${INK.line}; border-radius: 16px; padding: 20px 22px 20px 26px; position: relative; overflow: hidden; }
.fig::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.fig.good::before { background: ${INK.emerald}; box-shadow: 0 0 18px ${INK.emerald}; }
.fig.bad::before { background: ${INK.rose}; box-shadow: 0 0 18px ${INK.rose}; }
.fig.plain::before { background: ${INK.muted}; opacity: .5; }
.fig .v { display: block; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.fig.good .v { color: ${INK.emerald}; }
.fig.bad .v { color: ${INK.rose}; }
.fig .k { display: block; margin-top: 4px; color: ${INK.muted}; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.chip, .ghost, .go {
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px; min-height: 34px; padding: 6px 14px;
  border: 1px solid ${INK.line}; background: ${INK.panelUp}; color: ${INK.text};
  transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;
}
.ghost, .go { border-radius: 10px; }
.go { background: ${INK.emerald}; border-color: ${INK.emerald}; color: #052A1D; font-weight: 700; }
.go:hover { filter: brightness(1.08); }
.chip:hover, .ghost:hover { border-color: ${INK.cyan}; color: ${INK.cyan}; }
.chip.on { background: rgba(77,216,255,.14); border-color: ${INK.cyan}; color: ${INK.cyan}; font-weight: 700; }
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid ${INK.cyan}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

input[type="search"] {
  font: inherit; font-size: 14px; padding: 9px 13px; width: 100%; max-width: 420px; margin-bottom: 14px;
  border: 1px solid ${INK.line}; border-radius: 10px; background: ${INK.panel}; color: ${INK.text};
}
input[type="search"]::placeholder { color: ${INK.muted}; }

.tablewrap { overflow-x: auto; border: 1px solid ${INK.line}; border-radius: 16px; background: ${INK.panel}; }
table { border-collapse: collapse; width: 100%; min-width: 1020px; font-size: 13px; }
th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid ${INK.line}; vertical-align: top; }
thead th { position: sticky; top: 0; z-index: 2; background: ${INK.panelUp}; font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: ${INK.muted}; font-weight: 600; white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: ${INK.panelUp}; }
th.num, td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
th.rank, td.rank { width: 42px; color: ${INK.muted}; }
td.skill { min-width: 210px; }
.sname { font: inherit; font-weight: 700; color: ${INK.text}; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.sname:hover, .sname[aria-expanded="true"] { color: ${INK.cyan}; }
.where { display: block; color: ${INK.muted}; font-size: 12px; }
.marks { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px; }
td.cost span:first-child { display: block; font-weight: 700; }
td.cost .bar { display: block; height: 3px; background: ${INK.line}; border-radius: 2px; margin-top: 5px; overflow: hidden; }
td.cost .bar i { display: block; height: 100%; background: ${INK.rose}; }
td.why { min-width: 250px; max-width: 350px; color: ${INK.muted}; font-size: 12.5px; line-height: 1.45; }
td.act select { font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid ${INK.line}; border-radius: 8px; background: ${INK.panelUp}; color: ${INK.text}; }
tr[data-changed="yes"] td.act select { border-color: ${INK.cyan}; color: ${INK.cyan}; }
tr.detail td { background: ${INK.panelUp}; padding: 14px 18px 16px 58px; }
tr.detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; max-width: 96ch; font-size: 12.5px; }
tr.detail dt { color: ${INK.muted}; }
tr.detail dd { margin: 0; }
tr.detail dd.desc { white-space: pre-wrap; }

details > summary { cursor: pointer; color: ${INK.cyan}; font-weight: 700; }
.names { color: ${INK.muted}; font-size: 12.5px; margin: 0 0 10px; }

.codeblock { border: 1px solid ${INK.line}; border-radius: 14px; background: ${INK.panel}; overflow: hidden; }
.codehead { display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 16px; background: ${INK.panelUp}; border-bottom: 1px solid ${INK.line}; }
.codetitle { color: ${INK.muted}; font-size: 12.5px; margin-right: auto; }
.go.sm, .ghost.sm { min-height: 30px; padding: 4px 12px; font-size: 12.5px; }
textarea {
  display: block; width: 100%; min-height: 240px; padding: 14px 16px; border: 0; resize: vertical;
  font-family: ${MONO}; font-size: 12.5px; line-height: 1.55; background: ${INK.panel}; color: ${INK.text};
}
[hidden] { display: none !important; }
@media (max-width: 640px) { .wrap { padding: 24px 14px 72px; } h1 { font-size: 24px; } }
`
}

/* ------------------------------------------------------------------ code */

function script () {
  return `
(function () {
  var report = {};
  try { report = JSON.parse(document.getElementById('report-data').textContent); } catch (e) { report = {}; }
  var skills = report.skills || [];
  var selects = [].slice.call(document.querySelectorAll('select.action'));
  var rows = [].slice.call(document.querySelectorAll('#rows tr'));
  var search = document.getElementById('search');
  var rowCount = document.getElementById('row-count');
  var changed = document.getElementById('changed-count');
  var box = document.getElementById('decisions-json');
  var note = document.getElementById('export-note');
  var filter = 'all';
  var openDetail = {};

  var index = skills.map(function (s) {
    var rec = s.recommendation || {};
    return [(s.names || [])[0], s.name, s.plugin, s.location, s.description, rec.reason].filter(Boolean).join(' ').toLowerCase();
  });
  function on (el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function say (t) { if (note) note.textContent = t; }

  var chips = [].slice.call(document.querySelectorAll('[data-filter]'));
  chips.forEach(function (chip) {
    on(chip, 'click', function () {
      filter = chip.getAttribute('data-filter');
      chips.forEach(function (c) {
        var active = c === chip;
        c.classList.toggle('on', active);
        c.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      apply();
    });
  });
  on(search, 'input', apply);

  function apply () {
    var q = search ? search.value.trim().toLowerCase() : '';
    var shown = 0;
    rows.forEach(function (tr) {
      var flags = ' ' + (tr.getAttribute('data-flags') || '') + ' ';
      var passF = filter === 'all' ? true
        : filter === 'changed' ? tr.getAttribute('data-changed') === 'yes'
        : flags.indexOf(' ' + filter + ' ') !== -1;
      var i = Number(tr.getAttribute('data-index'));
      var passQ = !q || (index[i] || '').indexOf(q) !== -1;
      var vis = passF && passQ;
      tr.hidden = !vis;
      if (openDetail[i]) openDetail[i].hidden = !vis;
      if (vis) shown++;
    });
    if (rowCount) rowCount.textContent = shown === rows.length ? rows.length + ' skills' : shown + ' of ' + rows.length + ' skills';
  }

  function decisions () {
    var out = [];
    selects.forEach(function (sel) {
      if (sel.value === 'keep') return;
      var s = skills[Number(sel.getAttribute('data-index'))] || {};
      out.push({ name: sel.getAttribute('data-name'), path: s.path || s.realPath || '', action: sel.value, note: '' });
    });
    return { version: 1, generatedOn: report.generatedOn || null, source: 'token-coupons html report', decisions: out };
  }

  function refresh () {
    var n = 0;
    selects.forEach(function (sel) {
      var isChanged = sel.value !== sel.getAttribute('data-rec');
      if (isChanged) n++;
      var tr = rows[Number(sel.getAttribute('data-index'))];
      if (tr) tr.setAttribute('data-changed', isChanged ? 'yes' : 'no');
    });
    if (changed) changed.textContent = n === 1 ? '1 changed' : n + ' changed';
    if (box) box.value = JSON.stringify(decisions(), null, 2);
    if (filter === 'changed') apply();
  }
  selects.forEach(function (sel) { on(sel, 'change', refresh); });

  on(document.getElementById('reset'), 'click', function () {
    selects.forEach(function (sel) { sel.value = sel.getAttribute('data-rec'); });
    if (search) search.value = '';
    filter = 'all';
    chips.forEach(function (c) {
      var active = c.getAttribute('data-filter') === 'all';
      c.classList.toggle('on', active);
      c.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    refresh(); apply();
    say('Back to the suggestions, filters cleared.');
  });

  on(document.getElementById('copy'), 'click', function () {
    if (!box) return;
    var done = false;
    box.focus(); box.select();
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    if (done) { say('Copied. Paste it into your next message and add: proceed with these decisions.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(
        function () { say('Copied. Paste it into your next message and add: proceed with these decisions.'); },
        function () { say('Copying is blocked here. The text is selected, so copy it with your keyboard.'); });
      return;
    }
    say('Copying is blocked here. The text is selected, so copy it with your keyboard.');
  });

  [].slice.call(document.querySelectorAll('button[data-detail]')).forEach(function (btn) {
    on(btn, 'click', function () {
      var i = Number(btn.getAttribute('data-detail'));
      var tr = rows[i];
      if (!tr) return;
      if (openDetail[i]) {
        openDetail[i].parentNode.removeChild(openDetail[i]);
        delete openDetail[i];
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
      var s = skills[i] || {};
      var rec = s.recommendation || {};
      var d = document.createElement('tr');
      d.className = 'detail';
      var td = document.createElement('td');
      td.colSpan = 9;
      var dl = document.createElement('dl');
      function add (k, v, cls) {
        var dt = document.createElement('dt'); dt.textContent = k;
        var dd = document.createElement('dd'); dd.textContent = v; if (cls) dd.className = cls;
        dl.appendChild(dt); dl.appendChild(dd);
      }
      add('Description', s.description || '(none)', 'desc');
      add('Length', (s.descriptionChars || 0) + ' characters, about ' + (s.descriptionTokens || 0) + ' tokens a message');
      if (typeof s.dollarsPerMonth === 'number') add('Costs', '$' + s.dollarsPerMonth.toFixed(2) + ' a month');
      add('Where', s.path || s.realPath || '');
      if (s.sourcePath) add('Source copy', s.sourcePath);
      add('Used', (s.calls || 0) + ' times: ' + (s.passiveCalls || 0) + ' picked by the agent, ' + (s.activeCalls || 0) + ' typed by you' + (s.lastSeen ? ', last on ' + s.lastSeen : ''));
      add('Why', rec.reason || '');
      td.appendChild(dl); d.appendChild(td);
      tr.parentNode.insertBefore(d, tr.nextSibling);
      openDetail[i] = d;
      btn.setAttribute('aria-expanded', 'true');
    });
  });

  refresh();
})();
`
}
