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
import { scoreReport, headline, GRADE_COLOR } from './score.mjs'

// The page carries its own palette rather than the card's. The card is one
// dark object meant to be posted somewhere else; this is a document a person
// reads and works in, so it follows the reader's theme in both directions.
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

// Two independent questions, so two controls. Blending them into one select
// made the reader choose between "make it active" and "shorten it" when those
// are not alternatives: a skill can be both.
const MODES = [
  ['passive', 'Passive', 'the agent can pick it, so its description is sent in every message'],
  ['active', 'Active', 'the description stops being sent; you reach it by typing its name'],
]

const DISPOSITIONS = [
  ['keep', 'Keep', 'leave the skill as it is'],
  ['optimize', 'Shorten', 'keep the skill, rewrite the description shorter'],
  ['delete', 'Delete', 'remove it, moving the folder to a trash directory so you can put it back'],
]

const MODE_TIP = 'Passive: the agent can pick it on its own, so its description rides in every message. ' +
  'Active: the description is not sent, and you start it by typing its name.'

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
    '<button type="button" id="theme-toggle" class="ghost sm" title="switch between the light and dark version of this page">Dark or light</button>',
    '</div>',
    '<h1>Every skill, and what it costs you</h1>',
    '<p class="lede">' + fmt(s.skills || 0) + ' skills are described again in every message you send. Below is each one, ' +
      'what it costs a month, and what to do about it.</p>',
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
    // The scoring rule sits behind a question rather than on the page: it is
    // the answer to "why this number", so it should appear when that is asked
    // and stay out of the way otherwise. Hover or focus reveals it.
    '<p class="note tipwrap"><button type="button" class="tiptrigger" aria-describedby="score-how">' +
      '<span class="tipmark" aria-hidden="true">?</span>How is the score calculated?</button>' +
      '<span class="tip" role="tooltip" id="score-how">Scored out of 100: how much of the list has earned its place (70), ' +
      'whether the whole list fits the space your agent gives it (20), and whether anything is being silently dropped (10). ' +
      'Every change below moves it.</span></p>',
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
    'On a flat plan this is not a bill you will see: it is what the waste is worth, and it eats into your plan\'s limits ' +
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
      '<td class="act">' + modeSelect(x, i, name) + '</td>',
      '<td class="num used"><span>' + fmt(x.passiveCalls || 0) + '</span><span class="slash">/</span><span>' + fmt(x.activeCalls || 0) + '</span></td>',
      '<td class="num cost">' + (priced
        ? '<span>' + esc(money(cost)) + '</span><span class="bar" aria-hidden="true"><i style="width:' + bar + '%"></i></span>'
        : '<span>' + fmt(x.descriptionTokens || 0) + '</span>') + '</td>',
      '<td class="why">' + esc(rec.reason || '') + '</td>',
      '<td class="act">' + dispositionSelect(x, i, name, preset) + '</td>',
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
    '<th title="' + attr(MODE_TIP) + '">Type</th>',
    '<th class="num" title="how often it was used: times the agent picked it on its own, then times you typed its name">Used</th>',
    '<th class="num">' + (priced ? 'Cost a month' : 'Desc. tokens') + '</th>',
    '<th>Why</th>',
    '<th title="every control starts on the suggestion, so changing nothing accepts all of them">Decision</th>',
    '</tr></thead>',
    '<tbody id="rows">' + rows + '</tbody>',
    '</table>',
    '</div>',
    '<p class="note">Click a skill name to see its full description and path.' +
      (unroutable ? ' The rows marked out of reach are already being dropped: installed, correct, and still unreachable.' : '') + '</p>',
    '</section>',
  ].join('\n')
}

/**
 * Passive or active. It starts on whichever the tool suggests, which is only
 * different from today's value when the suggestion is to gate the skill, and
 * the option labels carry the suggestion so the column that used to hold it is
 * no longer needed.
 */
function modeSelect (x, i, name) {
  const today = x.mode === 'active' ? 'active' : 'passive'
  const rec = ((x.recommendation || {}).action === 'active') ? 'active' : today
  const opts = MODES.map(([value, label, tip]) =>
    '<option value="' + value + '"' + (value === rec ? ' selected' : '') + ' title="' + attr(tip) + '">' +
    esc(label + (value === rec && rec !== today ? ' (suggested)' : '')) + '</option>').join('')
  return '<select class="mode" data-index="' + i + '" data-rec="' + attr(rec) + '" data-today="' + attr(today) +
    '" data-name="' + attr(name) + '" aria-label="' + attr('passive or active for ' + name) + '">' + opts + '</select>'
}

/** Keep, shorten or delete. Orthogonal to the mode above: a skill can be both active and shortened. */
function dispositionSelect (x, i, name, preset) {
  const locked = x.location === 'plugin-cache'
  const rec = DISPOSITIONS.some(([v]) => v === preset) ? preset : 'keep'
  const opts = DISPOSITIONS.map(([value, label, tip]) => {
    const disabled = value === 'delete' && locked
    return '<option value="' + value + '"' + (value === rec ? ' selected' : '') + (disabled ? ' disabled' : '') +
      ' title="' + attr(disabled ? 'this lives in a plugin cache folder; remove it with claude plugin uninstall instead' : tip) + '">' +
      esc(label + (value === rec && rec !== 'keep' ? ' (suggested)' : '')) + '</option>'
  }).join('')
  return '<select class="action" data-index="' + i + '" data-rec="' + attr(rec) + '" data-name="' + attr(name) +
    '" aria-label="' + attr('what to do with ' + name) + '">' + opts + '</select>'
}

/**
 * The disposition control starts on the suggestion. Gating suggestions live in
 * the mode control instead, so 'active' and 'passive' land on Keep here, as do
 * 'review' and a delete the plugin system would undo.
 */
export function presetFor (action, location) {
  if (action === 'delete' && location === 'plugin-cache') return 'keep'
  return DISPOSITIONS.some(([v]) => v === action) ? action : 'keep'
}

function mark (tone, label, tip) {
  return '<span class="pill ' + tone + ' xs" title="' + attr(tip) + '">' + esc(label) + '</span>'
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
    // One row can produce two entries, because mode and disposition are
    // separate questions: gating a skill and shortening it are not exclusive.
    decisions: skills.flatMap((x) => {
      const name = (x.names && x.names[0]) || x.name
      const path = x.path || x.realPath || ''
      const out = []
      const today = x.mode === 'active' ? 'active' : 'passive'
      if ((x.recommendation || {}).action === 'active' && today !== 'active') out.push({ name, path, action: 'active', note: '' })
      const disposition = presetFor((x.recommendation || {}).action, x.location)
      if (disposition !== 'keep') out.push({ name, path, action: disposition, note: '' })
      return out
    }),
  }
}

function island (report) {
  return '<script type="application/json" id="report-data">' + JSON.stringify(report).replace(/</g, '\\u003c') + '</script>'
}

/* ---------------------------------------------------------------- pieces */

// Only the locations discover can actually produce. The folders other tools
// keep their skills in are not scanned, so no row can carry one of them.
function locationLabel (loc) {
  return {
    user: 'your folder', 'user-symlink': 'linked in', project: 'this project',
    'project-source': 'this project', marketplace: 'marketplace', 'plugin-cache': 'plugin cache',
    other: 'elsewhere',
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
:root {
  color-scheme: light dark;
  --bg: #f6f6f4;
  --surface: #ffffff;
  --surface-2: #efefeb;
  --text: #191917;
  --muted: #63635b;
  --line: #dedcd5;
  --accent: #2f4fd0;
  --accent-soft: #e8ecfb;
  --ok: #14684a;
  --ok-soft: #e2f1ea;
  --warn: #855700;
  --warn-soft: #faefd9;
  --danger: #972e24;
  --danger-soft: #fbe7e3;
  --bar: #c9cdd8;
  --shadow: 0 1px 2px rgba(20, 20, 18, 0.06), 0 6px 18px rgba(20, 20, 18, 0.05);
}
/* the reader's system setting, unless they picked light on this page */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #121311;
    --surface: #1b1c19;
    --surface-2: #232420;
    --text: #eceae4;
    --muted: #a4a297;
    --line: #33342e;
    --accent: #9db0ff;
    --accent-soft: #1f2540;
    --ok: #74d1a4;
    --ok-soft: #142a20;
    --warn: #e5ba63;
    --warn-soft: #2d2413;
    --danger: #f0928a;
    --danger-soft: #331a17;
    --bar: #454740;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
}
/* and the toggle, which has to win over a light system setting too */
:root[data-theme="dark"] {
  --bg: #121311;
  --surface: #1b1c19;
  --surface-2: #232420;
  --text: #eceae4;
  --muted: #a4a297;
  --line: #33342e;
  --accent: #9db0ff;
  --accent-soft: #1f2540;
  --ok: #74d1a4;
  --ok-soft: #142a20;
  --warn: #e5ba63;
  --warn-soft: #2d2413;
  --danger: #f0928a;
  --danger-soft: #331a17;
  --bar: #454740;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 ${SANS}; overflow-x: hidden; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 40px 24px 96px; }
h1 { font-size: 30px; letter-spacing: -0.01em; margin: 18px 0 0; font-weight: 700; }
h2 { font-size: 19px; margin: 0; font-weight: 700; }
h3 { font-size: 14px; margin: 16px 0 2px; font-weight: 600; }
p { margin: 0 0 10px; }
code { font-family: ${MONO}; font-size: .92em; background: var(--surface-2); padding: 2px 6px; border-radius: 6px; color: var(--accent); }
strong { color: var(--text); font-weight: 700; }
a { color: var(--accent); }

.mast { display: flex; align-items: center; gap: 12px; }
.dot { width: 11px; height: 11px; border-radius: 50%; background: var(--accent); }
.brand { font-weight: 700; font-size: 17px; }
.back { font-size: 13px; text-decoration: none; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }
.back:hover { border-color: var(--accent); }
.when { margin-left: auto; color: var(--muted); font-size: 13px; }
.lede { color: var(--muted); max-width: 78ch; margin-top: 10px; }

.section { margin-top: 44px; }
.sechead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 16px; }
.eyebrow { font-size: 13px; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin-bottom: 14px; }
.note { color: var(--muted); font-size: 13.5px; max-width: 84ch; }

/* a question that answers itself on hover or focus */
.tipwrap { position: relative; display: inline-block; margin-top: 14px; }
.tiptrigger { font: inherit; color: var(--muted); background: none; border: 0; padding: 0; cursor: help; display: inline-flex; align-items: center; gap: 8px; text-decoration: underline dotted; text-underline-offset: 3px; }
.tiptrigger:hover, .tiptrigger:focus-visible { color: var(--accent); }
.tipmark { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; border: 1px solid currentColor; font-size: 11px; font-weight: 700; }
.tip { position: absolute; left: 0; top: calc(100% + 10px); z-index: 5; width: min(46ch, 80vw); padding: 12px 14px; border-radius: 12px; background: var(--surface-2); color: var(--text); border: 1px solid var(--line); box-shadow: var(--shadow); font-size: 13.5px; line-height: 1.5; opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity .12s ease, transform .12s ease, visibility 0s linear .12s; }
.tip::before { content: ""; position: absolute; left: 22px; top: -6px; width: 10px; height: 10px; background: var(--surface-2); border-left: 1px solid var(--line); border-top: 1px solid var(--line); transform: rotate(45deg); }
.tipwrap:hover .tip, .tipwrap:focus-within .tip { opacity: 1; visibility: visible; transform: none; transition-delay: 0s; }
@media (prefers-reduced-motion: reduce) { .tip { transition: none; } }
.count { color: var(--muted); font-size: 13px; }
.dim { color: var(--muted); font-weight: 400; }

.scorerow { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.scorenum { display: flex; align-items: baseline; gap: 6px; }
.sv { font-size: 72px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.sd { font-size: 22px; color: var(--muted); }
.grade { display: inline-flex; align-items: center; justify-content: center; width: 58px; height: 58px; border-radius: 16px; font-size: 32px; font-weight: 700; background: var(--surface-2); border: 1px solid var(--line); }
.grade.emerald { color: var(--ok); border-color: var(--ok); }
.grade.amber { color: var(--warn); border-color: var(--warn); }
.grade.rose { color: var(--danger); border-color: var(--danger); }
.scoretext { flex: 1 1 380px; min-width: 300px; }
.scoretext p { margin: 0; font-size: 15px; }
.scoretext p + p { color: var(--muted); }

.modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.mode { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 22px; box-shadow: var(--shadow); }
.modehead { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.modecost { color: var(--muted); font-size: 13px; }
.mode p { color: var(--muted); margin: 0 0 8px; }
.modefine { font-size: 13px; border-top: 1px solid var(--line); padding-top: 10px; margin: 12px 0 0 !important; }

.pill { display: inline-block; border-radius: 999px; padding: 3px 12px; font-size: 13px; font-weight: 700; border: 1px solid transparent; white-space: nowrap; }
.pill.sm { font-size: 12px; padding: 2px 10px; font-weight: 600; }
.pill.xs { font-size: 11px; padding: 1px 8px; font-weight: 500; }
.pill.good { background: var(--ok-soft); color: var(--ok); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.danger { background: var(--danger-soft); color: var(--danger); }
.pill.plain { background: var(--surface-2); color: var(--muted); border-color: var(--line); }

.figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
.fig { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px 20px 26px; position: relative; overflow: hidden; box-shadow: var(--shadow); }
.fig::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.fig.good::before { background: var(--ok); }
.fig.bad::before { background: var(--danger); }
.fig.plain::before { background: var(--muted); opacity: .5; }
.fig .v { display: block; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.fig.good .v { color: var(--ok); }
.fig.bad .v { color: var(--danger); }
.fig .k { display: block; margin-top: 4px; color: var(--muted); }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.chip, .ghost, .go {
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px; min-height: 34px; padding: 6px 14px;
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text);
  transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;
}
.ghost, .go { border-radius: 10px; }
.go { background: var(--ok); border-color: var(--ok); color: #052A1D; font-weight: 700; }
.go:hover { filter: brightness(1.08); }
.chip:hover, .ghost:hover { border-color: var(--accent); color: var(--accent); }
.chip.on { background: rgba(77,216,255,.14); border-color: var(--accent); color: var(--accent); font-weight: 700; }
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

input[type="search"] {
  font: inherit; font-size: 14px; padding: 9px 13px; width: 100%; max-width: 420px; margin-bottom: 14px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text);
}
input[type="search"]::placeholder { color: var(--muted); }

.tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); box-shadow: var(--shadow); }
table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: 13px; }
td.num, td.cost, .sv, .fig .v { font-family: ${MONO}; }
th, td { text-align: left; padding: 11px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-2); font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--surface-2); }
th.num, td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
th.rank, td.rank { width: 42px; color: var(--muted); }
td.skill { min-width: 180px; }
.sname { font: inherit; font-weight: 700; color: var(--text); background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.sname:hover, .sname[aria-expanded="true"] { color: var(--accent); }
.where { display: block; color: var(--muted); font-size: 12px; }
.marks { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px; }
td.cost span:first-child { display: block; font-weight: 700; }
td.cost .bar { display: block; height: 3px; background: var(--line); border-radius: 2px; margin-top: 5px; overflow: hidden; }
td.cost .bar i { display: block; height: 100%; background: var(--danger); }
td.why { min-width: 180px; max-width: 320px; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
td.used .slash { color: var(--muted); margin: 0 3px; }
td.act select { max-width: 150px; }
td.act select { font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); color: var(--text); }
tr[data-changed="yes"] td.act select[data-changed-mark], tr[data-changed="yes"] td.act select { border-color: var(--accent); color: var(--accent); }
tr.detail td { background: var(--surface-2); padding: 14px 18px 16px 58px; }
tr.detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; max-width: 96ch; font-size: 12.5px; }
tr.detail dt { color: var(--muted); }
tr.detail dd { margin: 0; }
tr.detail dd.desc { white-space: pre-wrap; }

details > summary { cursor: pointer; color: var(--accent); font-weight: 700; }
.names { color: var(--muted); font-size: 12.5px; margin: 0 0 10px; }

.codeblock { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); overflow: hidden; }
.codehead { display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 16px; background: var(--surface-2); border-bottom: 1px solid var(--line); }
.codetitle { color: var(--muted); font-size: 12.5px; margin-right: auto; }
.go.sm, .ghost.sm { min-height: 30px; padding: 4px 12px; font-size: 12.5px; }
textarea {
  display: block; width: 100%; min-height: 240px; padding: 14px 16px; border: 0; resize: vertical;
  font-family: ${MONO}; font-size: 12.5px; line-height: 1.55; background: var(--surface); color: var(--text);
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
  var modeSelects = [].slice.call(document.querySelectorAll('select.mode'));
  var allSelects = selects.concat(modeSelects);
  var rows = [].slice.call(document.querySelectorAll('#rows tr'));
  var search = document.getElementById('search');
  var rowCount = document.getElementById('row-count');
  var changed = document.getElementById('changed-count');
  var box = document.getElementById('decisions-json');
  var root = document.documentElement;

  /* system default, then dark, then light, so a reader on either setting can
     reach the other one */
  on(document.getElementById('theme-toggle'), 'click', function () {
    var now = root.getAttribute('data-theme');
    if (now === 'dark') { root.setAttribute('data-theme', 'light'); return; }
    if (now === 'light') { root.removeAttribute('data-theme'); return; }
    root.setAttribute('data-theme', 'dark');
  });
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

  function pathOf (sel) {
    var s = skills[Number(sel.getAttribute('data-index'))] || {};
    return s.path || s.realPath || '';
  }

  /* A row can send two entries: the mode only when it differs from today's
     value, and the disposition whenever it is not Keep. */
  function decisions () {
    var out = [];
    modeSelects.forEach(function (sel) {
      if (sel.value === sel.getAttribute('data-today')) return;
      out.push({ name: sel.getAttribute('data-name'), path: pathOf(sel), action: sel.value, note: '' });
    });
    selects.forEach(function (sel) {
      if (sel.value === 'keep') return;
      out.push({ name: sel.getAttribute('data-name'), path: pathOf(sel), action: sel.value, note: '' });
    });
    return { version: 1, generatedOn: report.generatedOn || null, source: 'token-coupons html report', decisions: out };
  }

  function refresh () {
    var touched = {};
    allSelects.forEach(function (sel) {
      var i = Number(sel.getAttribute('data-index'));
      if (sel.value !== sel.getAttribute('data-rec')) touched[i] = true;
    });
    var n = 0;
    rows.forEach(function (tr) {
      var i = Number(tr.getAttribute('data-index'));
      var isChanged = !!touched[i];
      if (isChanged) n++;
      tr.setAttribute('data-changed', isChanged ? 'yes' : 'no');
    });
    if (changed) changed.textContent = n === 1 ? '1 row changed' : n + ' rows changed';
    if (box) box.value = JSON.stringify(decisions(), null, 2);
    if (filter === 'changed') apply();
  }
  allSelects.forEach(function (sel) { on(sel, 'change', refresh); });

  on(document.getElementById('reset'), 'click', function () {
    allSelects.forEach(function (sel) { sel.value = sel.getAttribute('data-rec'); });
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
