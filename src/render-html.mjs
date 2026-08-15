// The interactive report. One HTML file, no external assets, no network, no
// framework. It has to work three ways: opened from disk with a double click,
// opened inside a sandboxed viewer where downloads silently do nothing, and
// read by a person who has never heard the phrase "context window".
//
// The whole Report is embedded once as JSON. The markup is written out here so
// the page is readable with scripting switched off, and the inline script uses
// that same embedded object as the source of truth for the export.

import { fmt, money } from './lib/util.mjs'

const ACTIONS = [
  ['keep', 'Keep', 'leave this skill exactly as it is'],
  ['passive', 'Passive', 'let the agent find this skill on its own, which means its description is sent every message'],
  ['active', 'Active', 'stop sending the description, and reach the skill by typing its name yourself'],
  ['optimize', 'Optimize', 'keep the skill but rewrite the description shorter'],
  ['delete', 'Delete', 'remove the skill, moving the folder to a trash directory so you can put it back'],
]

const FILTERS = [
  ['all', 'All', 'every skill'],
  ['never-called', 'Never called', 'the agent has never once used these'],
  ['summoned-only', 'Summoned only', 'you always type these yourself, the agent never picks them'],
  ['heavy-description', 'Heavy', 'the description is long enough to be worth rewriting'],
  ['thin-description', 'Thin', 'the description is so short the agent may not be able to tell what it is for'],
  ['unroutable', 'Unroutable', 'these are installed but the agent cannot reach them right now'],
  ['changed', 'Changed by me', 'rows where you picked something other than what was recommended'],
]

const TERMS = {
  listing: 'the list of every installed skill, name and description, that rides along in every message you send',
  routed: 'the agent read the description and chose this skill on its own',
  summoned: 'you typed the name of this skill yourself',
  cached: 'the usual case: the list is stored once at the start of a chat and re-read cheaply after that',
  uncached: 'the worst case: full price on every single message, useful as an upper bound',
  unroutable: 'installed, but the agent cannot see enough about it to choose it, and nothing warns you',
  window: 'the context window is how much text the model can hold at once. The skill list gets a fixed slice of it, and anything past that slice loses its description',
}

/** @param {object} report a Report from report.mjs @returns {string} one HTML document */
export function renderHtml (report) {
  const r = report || {}
  const summary = r.summary || {}
  const economics = r.economics || {}
  const cost = r.cost || {}
  const skills = Array.isArray(r.skills) ? r.skills : []

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>token-coupons report</title>',
    '<style>' + styles() + '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    header(r, summary, economics, cost),
    costStrip(cost, summary),
    table(skills),
    heaviestSection(r),
    thinSection(r),
    unroutableSection(economics),
    notListedSection(r),
    exportFooter(r, skills),
    '</div>',
    island(r),
    '<script>' + script() + '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/* ------------------------------------------------------------------ header */

function header (r, s, economics, cost) {
  const ratio = s.overBudgetRatio
  const fits = ratio === null || ratio === undefined ? null : ratio <= 1
  const ratioText = fits === null ? 'unknown' : (fits ? 'fits' : trimNum(ratio) + 'x')

  const nums = [
    [fmt(s.skills || 0), 'skills in your listing', 'the skills Claude Code puts in the list from this folder: your ~/.claude/skills, this project, and enabled plugins' + (s.notListed ? '. Another ' + fmt(s.notListed) + ' sit on disk but are not listed; see the section near the bottom' : '')],
    [fmt(s.listingTokensPerCall || 0), 'tokens in every message', TERMS.listing],
    [ratioText, 'against its allowance', 'the client gives the skill list a fixed slice of the space a model can hold at once. Past that line it starts dropping descriptions, quietly'],
    [fmt(s.neverCalledPassive || 0), 'never once used', 'the agent has never chosen these, yet you pay for their descriptions in every message'],
    [fmt(s.unroutable || 0), 'cannot be reached', TERMS.unroutable],
  ]

  const saved = s.savedTokensPerCallIfApplied || 0
  const after = s.fitsAfter
    ? 'That brings the list back inside its allowance, so nothing gets dropped any more.'
    : 'That is not quite enough on its own, so some skills stay out of reach until more descriptions are shortened.'
  const yours = s.wastedPerWeekOnYourModel
  const dollars = yours && typeof yours.dollars === 'number'
    ? ' On ' + esc(yours.model) + ', the model you actually use, those unused descriptions cost about ' +
      esc(money(yours.dollars)) + ' a week.'
    : ''

  const meta = []
  if (r.generatedOn) meta.push('Generated ' + esc(r.generatedOn))
  if (r.since) meta.push('sessions since ' + esc(r.since))
  if (economics.budget && economics.budget.contextWindow) {
    meta.push('<span title="' + attr(TERMS.window) + '">allowance ' + fmt(economics.budget.chars) + ' characters out of a ' +
      fmt(economics.budget.contextWindow) + ' token context window (' + esc(economics.budget.source || 'client default') + ')</span>')
  }
  if (cost.assumptions && cost.assumptions.measured === false) meta.push('no session history found, so the rates below are assumed')

  return [
    '<header class="head">',
    '<div class="titlerow">',
    '<h1>token-coupons</h1>',
    '<button type="button" id="theme-toggle" class="ghost" title="switch between the light and dark version of this page">Dark or light</button>',
    '</div>',
    '<p class="lede">Every message you send re-sends a list of every skill you have installed, name and description. ' +
      'This page shows what that list costs, which skills have never been used, which ones cannot be reached at all, ' +
      'and lets you mark what to do about each of them. The cost is counted in tokens, which are the small chunks of ' +
      'text (about four characters each) that everything you send is billed by.</p>',
    '<div class="bignums">',
    nums.map(([value, label, tip]) =>
      '<div class="bignum" title="' + attr(tip) + '"><span class="v">' + esc(value) + '</span><span class="k">' + esc(label) + '</span></div>').join(''),
    '</div>',
    '<p class="savings"><strong>' + fmt(saved) + ' tokens</strong> would come off every single message if you accepted every ' +
      'recommendation below. ' + esc(after) + dollars + '</p>',
    meta.length ? '<p class="meta">' + meta.join(' &middot; ') + '</p>' : '',
    '</header>',
  ].join('\n')
}

/* --------------------------------------------------------------- cost strip */

function costStrip (cost, summary) {
  const models = Array.isArray(cost.perModel) ? cost.perModel : []
  const a = cost.assumptions || {}
  const v = cost.volume || {}
  const listingTokens = Number(summary.listingTokensPerCall) || 0
  const wastedTokens = Number(summary.wastedTokensPerCall) || 0
  const scale = wastedTokens > 0 ? listingTokens / wastedTokens : null

  const cards = models.map((m, i) => {
    const w = m.wasted || {}
    const u = m.uncached || {}
    const l = m.listing || {}
    const listChatUncached = scale === null ? null : Number(u.wastedPerChat || 0) * scale
    const listWeekUncached = scale === null ? null : Number(u.wastedPerWeek || 0) * scale
    return [
      '<article class="card' + (i >= 6 ? ' extra" hidden' : '"') + '>',
      '<div class="cardhead">',
      '<h3>' + esc(m.label || m.id || 'model') + '</h3>',
      m.seenInTranscripts
        ? '<span class="badge ok" title="this model shows up in your own session history, so this row is the one that matters to you">your model</span>'
        : '',
      '</div>',
      '<div class="figs">',
      fig(w.perChat, u.wastedPerChat, 'wasted per chat'),
      fig(w.perWeek, u.wastedPerWeek, 'wasted per week'),
      '</div>',
      '<p class="fine" data-cached="' + attr('Whole list: ' + money(l.perChat || 0) + ' per chat, ' + money(l.perWeek || 0) + ' per week.') +
        '" data-uncached="' + attr(listChatUncached === null
          ? 'Whole list: ' + money(l.perChat || 0) + ' per chat at the stored price.'
          : 'Whole list: ' + money(listChatUncached) + ' per chat, ' + money(listWeekUncached) + ' per week.') + '">' +
        esc('Whole list: ' + money(l.perChat || 0) + ' per chat, ' + money(l.perWeek || 0) + ' per week.') + '</p>',
      '<p class="fine muted">' + esc([m.vendor, m.tier].filter(Boolean).join(', ')) +
        (m.source ? ' &middot; <a href="' + attr(m.source) + '" rel="noreferrer noopener">price list</a>' : '') + '</p>',
      '</article>',
    ].join('')
  }).join('\n')

  const sharePct = pctText(v.wastedShareOfInput)
  const shareLine = sharePct === null
    ? ''
    : '<p class="note" title="if you pay a flat subscription rather than per token, this is the number that matters: it is how much of your weekly allowance goes to skills nobody used">' +
      'On a flat subscription: unused skill descriptions are <strong>' + esc(sharePct) + '</strong> of everything you send in a week.</p>'

  const assumeBits = []
  if (a.apiCallsPerSession) assumeBits.push('about ' + fmt(a.apiCallsPerSession) + ' requests per chat')
  if (a.sessionsPerWeek) assumeBits.push('about ' + trimNum(a.sessionsPerWeek) + ' chats per week')
  const assumeLine = 'Based on ' + (assumeBits.length ? assumeBits.join(' and ') : 'default rates') + ', ' +
    (a.measured === false ? 'assumed because no session history was found.' : 'measured from your own session history.') +
    (cost.pricingVerifiedOn ? ' Prices checked on ' + cost.pricingVerifiedOn + '.' : '')

  return [
    '<section class="section" id="cost">',
    '<div class="sechead">',
    '<h2>What it costs</h2>',
    '<div class="chips" role="group" aria-label="price mode">',
    '<button type="button" class="chip on" data-mode="cached" aria-pressed="true" title="' + attr(TERMS.cached) + '">Cached</button>',
    '<button type="button" class="chip" data-mode="uncached" aria-pressed="false" title="' + attr(TERMS.uncached) + '">Uncached</button>',
    '</div>',
    '</div>',
    '<p class="sub">The same waste, priced on ' + (models.length === 1 ? 'the one model in the price list' : 'all ' + models.length + ' models in the price list') +
      ', so you can see it whichever one you are on.</p>',
    '<div class="cards">' + cards + '</div>',
    models.length > 6
      ? '<p><button type="button" id="show-all-models" class="ghost">Show all ' + models.length + ' models</button></p>'
      : '',
    shareLine,
    '<p class="note' + (cost.pricingStale ? ' warn' : '') + '">' + esc(assumeLine) +
      (cost.pricingStale ? ' <strong>These prices are more than two months old, so treat the dollars as a rough guide.</strong>' : '') + '</p>',
    '</section>',
  ].join('\n')
}

function fig (cachedValue, uncachedValue, label) {
  const c = money(cachedValue || 0)
  const u = money(uncachedValue === undefined || uncachedValue === null ? cachedValue || 0 : uncachedValue)
  return '<div class="fig"><span class="v" data-cached="' + attr(c) + '" data-uncached="' + attr(u) + '">' + esc(c) +
    '</span><span class="k">' + esc(label) + '</span></div>'
}

/* --------------------------------------------------------- recommendations */

function table (skills) {
  const maxTokens = skills.reduce((n, s) => Math.max(n, Number(s.descriptionTokens) || 0), 0) || 1

  const rows = skills.map((s, i) => {
    const rec = s.recommendation || {}
    const flags = Array.isArray(rec.flags) ? rec.flags : []
    const name = (s.names && s.names[0]) || s.name || 'skill'
    const preset = presetFor(rec.action, s.location)
    const width = Math.max(2, Math.round(((Number(s.descriptionTokens) || 0) / maxTokens) * 100))

    // No search text in the markup: the script builds the index from the
    // embedded report, so descriptions are not written into the page twice.
    return [
      '<tr data-index="' + i + '" data-flags="' + attr(flags.join(' ')) + '" data-changed="no">',
      '<td class="rank">' + esc(String(rec.rank || i + 1)) + '</td>',
      '<td class="skill">',
      '<span class="sname">' + esc(name) + '</span>',
      s.plugin ? '<span class="sub2">from the ' + esc(s.plugin) + ' plugin</span>' : '',
      '<span class="badge loc" title="' + attr(locationTip(s.location)) + '">' + esc(locationLabel(s.location)) + '</span>',
      (s.sourcePath ? ' <span class="badge loc" title="' + attr('the editable source of this plugin skill is on this machine at ' + s.sourcePath + '; apply edits that copy, and the installed copy refreshes on the next plugin update') + '">source on disk</span>' : ''),
      '</td>',
      '<td>' + modeCell(s.mode) + '</td>',
      '<td class="num" title="' + attr(TERMS.routed) + '">' + fmt(s.passiveCalls || 0) + '</td>',
      '<td class="num" title="' + attr(TERMS.summoned) + '">' + fmt(s.activeCalls || 0) + '</td>',
      '<td class="num tok"><span>' + fmt(s.descriptionTokens || 0) + '</span>' +
        '<span class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></span></td>',
      '<td>' + recBadge(rec.action) + '</td>',
      '<td class="why"><span title="' + attr(rec.reason || '') + '">' + esc(clip(rec.reason || '', 150)) + '</span></td>',
      '<td class="act">' + select(s, i, name, preset) + '</td>',
      '</tr>',
    ].join('')
  }).join('\n')

  return [
    '<section class="section" id="recommendations">',
    '<div class="sechead"><h2>Every skill, worst offender first</h2></div>',
    '<p class="sub">Pick what you want done with each one in the last column. Nothing happens on this page: you export your ' +
      'choices at the bottom and the agent carries them out.</p>',
    '<div class="chips" role="group" aria-label="filters">',
    FILTERS.map(([value, label, tip]) =>
      '<button type="button" class="chip' + (value === 'all' ? ' on' : '') + '" data-filter="' + attr(value) +
      '" aria-pressed="' + (value === 'all' ? 'true' : 'false') + '" title="' + attr(tip) + '">' + esc(label) + '</button>').join(''),
    '</div>',
    '<div class="searchrow">',
    '<input type="search" id="search" placeholder="Search names, plugins, descriptions" aria-label="search the table">',
    '<span class="count" id="row-count">Showing ' + skills.length + ' of ' + skills.length + ' skills</span>',
    '</div>',
    '<div class="tablewrap">',
    '<table>',
    '<thead><tr>',
    '<th class="rank">#</th>',
    '<th>Skill</th>',
    '<th title="passive means the agent can pick it and pays for its description, active means it only runs when you ask for it by name">Mode now</th>',
    '<th class="num" title="' + attr(TERMS.routed) + '">Routed</th>',
    '<th class="num" title="' + attr(TERMS.summoned) + '">Summoned</th>',
    '<th class="num" title="how much of every message this one description takes up">Desc. tokens</th>',
    '<th>Recommended</th>',
    '<th>Why</th>',
    '<th>Your call</th>',
    '</tr></thead>',
    '<tbody id="rows">',
    rows,
    '</tbody>',
    '</table>',
    '</div>',
    '</section>',
  ].join('\n')
}

function select (s, i, name, preset) {
  const locked = s.location === 'plugin-cache'
  const opts = ACTIONS.map(([value, label, tip]) => {
    const disabled = value === 'delete' && locked
    return '<option value="' + value + '"' + (value === preset ? ' selected' : '') + (disabled ? ' disabled' : '') +
      ' title="' + attr(disabled ? 'this skill lives in a plugin cache folder, so remove it with claude plugin uninstall instead' : tip) + '">' +
      esc(label) + '</option>'
  }).join('')
  return '<select class="action" data-index="' + i + '" data-rec="' + attr(preset) + '" data-name="' + attr(name) +
    '" aria-label="' + attr('what to do with ' + name) + '">' + opts + '</select>'
}

/** The select starts on the recommendation. Review has no control of its own, so it lands on Keep. */
function presetFor (action, location) {
  if (action === 'review' || !action) return 'keep'
  if (action === 'delete' && location === 'plugin-cache') return 'keep'
  return ACTIONS.some(([v]) => v === action) ? action : 'keep'
}

function modeCell (mode) {
  return mode === 'active'
    ? '<span class="badge" title="the agent will not pick this on its own, so it costs one short line and nothing more">Only when you ask</span>'
    : '<span class="badge" title="the agent can pick this on its own, which is why its full description is sent every message">Agent can pick it</span>'
}

function recBadge (action) {
  const tone = { delete: 'danger', optimize: 'warn', active: 'accent', passive: 'accent', review: 'plain', keep: 'ok' }[action] || 'plain'
  const label = { delete: 'Delete', optimize: 'Optimize', active: 'Active', passive: 'Passive', review: 'Review', keep: 'Keep' }[action] || 'Keep'
  const tip = (ACTIONS.find(([v]) => v === action) || [])[2] ||
    'nothing to save here, so this is a judgement call for you'
  return '<span class="badge ' + tone + '" title="' + attr(tip) + '">' + esc(label) + '</span>'
}

/* --------------------------------------------------------------- the lists */

function heaviestSection (r) {
  const list = Array.isArray(r.heaviest) ? r.heaviest : []
  if (!list.length) return ''
  return [
    '<section class="section" id="heaviest">',
    '<div class="sechead"><h2>The longest descriptions</h2></div>',
    '<p class="sub">These take the most room in every message. Shortening the top few is usually the fastest win, ' +
      'and a shorter description often routes better than a long one.</p>',
    '<ul class="list">',
    list.map((s) => {
      const rec = s.recommendation || {}
      const flags = Array.isArray(rec.flags) ? rec.flags : []
      const needs = flags.includes('heavy-description') || flags.includes('capped')
      return '<li><span class="ln">' + esc((s.names && s.names[0]) || s.name) + '</span>' +
        '<span class="lm">' + fmt(s.descriptionTokens || 0) + ' tokens</span>' +
        '<span class="lm">' + fmt(s.calls || 0) + ' uses</span>' +
        (needs
          ? '<span class="badge warn" title="' + attr(flags.includes('capped')
            ? 'this one is long enough that the client cuts it off, so the tail of it is never read at all'
            : 'long enough to be worth a rewrite') + '">needs a rewrite</span>'
          : '') + '</li>'
    }).join(''),
    '</ul>',
    '</section>',
  ].join('\n')
}

function thinSection (r) {
  const list = Array.isArray(r.thin) ? r.thin : []
  if (!list.length) return ''
  return [
    '<section class="section" id="thin">',
    '<div class="sechead"><h2>Descriptions that are too short</h2></div>',
    '<p class="sub">A thin description that has never been used may simply be unfindable: the agent cannot tell what the ' +
      'skill is for, so it never picks it. Rewriting is usually the right move before deleting.</p>',
    '<ul class="list">',
    list.map((s) => '<li><span class="ln">' + esc((s.names && s.names[0]) || s.name) + '</span>' +
      '<span class="lm">' + fmt(s.descriptionChars || 0) + ' characters</span>' +
      '<span class="lm">' + fmt(s.calls || 0) + ' uses</span></li>').join(''),
    '</ul>',
    '</section>',
  ].join('\n')
}

function unroutableSection (economics) {
  const o = (economics && economics.overflowUnroutable) || {}
  const names = Array.isArray(o.names) ? o.names : []
  if (!names.length) return ''
  return [
    '<section class="section" id="unroutable">',
    '<div class="sechead"><h2>Installed but out of reach</h2></div>',
    '<p class="sub">The skill list is over its allowance, so the client keeps the names and throws away the descriptions, ' +
      'starting with the least used. Without a description the agent has nothing to go on, so these can never be chosen. ' +
      'No error message tells you this is happening. They still work if you type the name yourself.</p>',
    '<ul class="list">',
    names.map((n) => '<li><span class="ln">' + esc(n) + '</span></li>').join(''),
    '</ul>',
    '<p class="note">Not sure where one of these came from? Run <code>claude plugin details</code> with the plugin name ' +
      'to see which plugin installed it.</p>',
    '</section>',
  ].join('\n')
}

function notListedSection (r) {
  const list = Array.isArray(r.notLoaded) ? r.notLoaded : []
  if (!list.length) return ''
  const groups = new Map()
  for (const n of list) { const a = groups.get(n.reason) || []; a.push(n); groups.set(n.reason, a) }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  return [
    '<section class="section" id="not-listed">',
    '<div class="sechead"><h2>On disk, but not in your listing</h2></div>',
    '<p class="sub">These ' + fmt(list.length) + ' skills exist on this machine but Claude Code does not put them in the list from this folder, ' +
      'so they cost nothing per message and are not scored above. Grouped by why. ' +
      'A number in brackets is how many times that skill was used anyway, for example inside its own project.</p>',
    '<details class="groups">',
    '<summary>Show them</summary>',
    ordered.map(([reason, items]) => [
      '<h3 class="grouphead">' + fmt(items.length) + ' <span class="dim">' + esc(reason) + '</span></h3>',
      '<ul class="list compact">',
      items.map((n) => '<li><span class="ln">' + esc(n.name) + '</span>' + (n.calls ? ' <span class="dim">(' + fmt(n.calls) + ')</span>' : '') + '</li>').join(''),
      '</ul>',
    ].join('\n')).join('\n'),
    '</details>',
    '</section>',
  ].join('\n')
}

/* -------------------------------------------------------------- the export */

function exportFooter (r, skills) {
  const starting = JSON.stringify({
    version: 1,
    generatedOn: r.generatedOn || null,
    source: 'token-coupons html report',
    decisions: skills.map((s) => {
      const rec = s.recommendation || {}
      const action = presetFor(rec.action, s.location)
      if (action === 'keep') return null
      return { name: (s.names && s.names[0]) || s.name, path: s.path || s.realPath || '', action, note: '' }
    }).filter(Boolean),
  }, null, 2)

  return [
    '<section class="section" id="export">',
    '<div class="sechead"><h2>Send your choices back</h2></div>',
    '<p class="sub">The box below is the file the agent needs. It updates as you change the last column above.</p>',
    '<div class="btns">',
    '<button type="button" id="accept-all" class="primary" title="set every row back to what the tool recommends">Accept all recommendations</button>',
    '<button type="button" id="reset" class="ghost" title="undo your changes and clear the filters">Reset to recommendations</button>',
    '<button type="button" id="copy" class="ghost" title="copy the text in the box to your clipboard">Copy JSON</button>',
    '<button type="button" id="download" class="ghost" title="save the box as a file, if this viewer allows it">Download decisions.json</button>',
    '<span class="count" id="changed-count">0 rows changed from the recommendation</span>',
    '</div>',
    '<p class="note" id="export-note" role="status">If the download does nothing, copy the text from the box instead. ' +
      'Some viewers block files from saving, and that is fine: copying works everywhere.</p>',
    '<textarea id="decisions-json" spellcheck="false" aria-label="the decisions file, ready to copy">' + esc(starting) + '</textarea>',
    '<div class="callout">',
    '<p><strong>Next step</strong></p>',
    '<p>Save this as decisions.json, then tell your agent: proceed with token-coupons apply decisions.json</p>',
    '</div>',
    '</section>',
  ].join('\n')
}

/* -------------------------------------------------------------- data island */

function island (report) {
  // "<" becomes < so no string inside the report can close this tag early.
  const json = JSON.stringify(report).replace(/</g, '\\u003c')
  return '<script type="application/json" id="report-data">' + json + '</script>'
}

/* ------------------------------------------------------------------- pieces */

function locationLabel (loc) {
  return {
    user: 'your folder',
    'user-symlink': 'linked in',
    project: 'this project',
    marketplace: 'marketplace',
    'plugin-cache': 'plugin cache',
    'agents-dir': 'agents folder',
    cursor: 'cursor folder',
    other: 'elsewhere',
  }[loc] || String(loc || 'elsewhere')
}

function locationTip (loc) {
  if (loc === 'plugin-cache') return 'inside a plugin cache folder, which gets overwritten on the next plugin update, so edits here do not survive'
  if (loc === 'marketplace') return 'came from a plugin marketplace you added'
  if (loc === 'project') return 'lives inside one project rather than your home folder'
  if (loc === 'user-symlink') return 'a shortcut in your skills folder pointing somewhere else'
  return 'where this skill lives on disk'
}

function clip (text, n) {
  const t = String(text || '')
  return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t
}

function trimNum (n) {
  const v = Number(n)
  if (!isFinite(v)) return '0'
  return String(+v.toFixed(2))
}

function pctText (share) {
  const v = Number(share)
  if (!isFinite(v) || v <= 0) return null
  if (v < 0.001) return 'under 0.1 percent'
  return (v * 100).toFixed(1) + ' percent'
}

function esc (s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function attr (s) { return esc(s) }

/* ---------------------------------------------------------------- the style */

function styles () {
  return `
:root {
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
  --radius: 12px;
}
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
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow-x: hidden;
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 40px 20px 96px; }
h1 { font-size: 26px; letter-spacing: -0.01em; margin: 0; }
h2 { font-size: 19px; letter-spacing: -0.01em; margin: 0; }
h3 { font-size: 15px; margin: 0; }
p { margin: 0 0 10px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
a { color: var(--accent); }

.titlerow { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.lede { max-width: 68ch; color: var(--muted); margin-top: 10px; }
.meta { color: var(--muted); font-size: 13px; margin-top: 14px; }
.head { padding-bottom: 8px; }

.bignums { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 28px 0 20px; }
.bignum { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 16px 14px; box-shadow: var(--shadow); }
.bignum .v { display: block; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }
.bignum .k { display: block; color: var(--muted); font-size: 12.5px; margin-top: 6px; }
.savings { background: var(--accent-soft); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; max-width: 78ch; }

.section { margin-top: 48px; }
.sechead { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 14px; }
.sub { color: var(--muted); max-width: 76ch; font-size: 14px; }
.note { color: var(--muted); font-size: 13px; max-width: 80ch; margin-top: 12px; }
.note.warn { color: var(--warn); }
.muted { color: var(--muted); }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip, .ghost, .primary {
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text); padding: 5px 12px;
}
.ghost, .primary { border-radius: 8px; padding: 7px 13px; }
.primary { background: var(--accent); border-color: var(--accent); color: #ffffff; font-weight: 600; }
.chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.chip:hover, .ghost:hover { background: var(--surface-2); }
.chip.on:hover { background: var(--accent-soft); }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; box-shadow: var(--shadow); }
.cardhead { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.figs { display: flex; gap: 20px; margin: 12px 0 8px; }
.fig .v { display: block; font-size: 21px; font-weight: 600; letter-spacing: -0.01em; }
.fig .k { display: block; color: var(--muted); font-size: 12px; }
.fine { font-size: 12.5px; color: var(--muted); margin: 0 0 4px; }

.badge { display: inline-block; font-size: 11.5px; line-height: 1.5; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); white-space: nowrap; }
.badge.ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.badge.warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.badge.danger { background: var(--danger-soft); color: var(--danger); border-color: transparent; }
.badge.accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.badge.loc { margin-left: 6px; }

.searchrow { display: flex; align-items: center; gap: 12px; margin: 12px 0; flex-wrap: wrap; }
input[type="search"] {
  font: inherit; font-size: 14px; padding: 7px 11px; min-width: 260px; flex: 1 1 260px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
}
.count { color: var(--muted); font-size: 13px; }

.tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
table { border-collapse: collapse; width: 100%; min-width: 940px; font-size: 13.5px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-2); font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--surface-2); }
th.num, td.num { text-align: right; white-space: nowrap; }
th.rank, td.rank { text-align: right; color: var(--muted); width: 34px; }
td.skill { min-width: 200px; }
.sname { font-weight: 600; }
.sub2 { display: block; color: var(--muted); font-size: 12px; }
td.tok span:first-child { display: inline-block; min-width: 34px; }
.bar { display: block; height: 4px; background: var(--surface-2); border-radius: 3px; margin-top: 5px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--bar); }
td.why { min-width: 280px; max-width: 380px; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
td.act select { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--text); }
tr[data-changed="yes"] td.act select { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }

.list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.list li { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.list li:last-child { border-bottom: 0; }
.ln { font-weight: 600; flex: 1 1 auto; }
.list.compact { display: flex; flex-wrap: wrap; border: 0; background: transparent; gap: 4px 12px; margin: 4px 0 14px; }
.list.compact li { border: 0; padding: 2px 0; font-size: 13px; }
.list.compact .ln { font-weight: 500; }
.dim { color: var(--muted); font-weight: 400; }
.grouphead { font-size: 14px; margin: 14px 0 4px; font-weight: 600; }
details.groups > summary { cursor: pointer; color: var(--accent); font-weight: 600; margin: 6px 0; }
.lm { color: var(--muted); font-size: 12.5px; white-space: nowrap; }

.btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
textarea {
  width: 100%; min-height: 190px; margin-top: 10px; padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.5;
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--text); resize: vertical;
}
.callout { margin-top: 16px; border: 1px solid var(--accent); background: var(--accent-soft); border-radius: var(--radius); padding: 14px 16px; }
.callout p { margin: 0; }
.callout p + p { margin-top: 6px; font-size: 15px; }
[hidden] { display: none !important; }
@media (max-width: 620px) {
  .wrap { padding: 24px 14px 72px; }
  .bignum .v { font-size: 24px; }
}
`
}

/* ----------------------------------------------------------------- the code */

function script () {
  return `
(function () {
  var island = document.getElementById('report-data');
  var report = {};
  try { report = JSON.parse(island.textContent); } catch (e) { report = {}; }
  var skills = report.skills || [];
  var root = document.documentElement;

  var selects = Array.prototype.slice.call(document.querySelectorAll('select.action'));
  var rows = Array.prototype.slice.call(document.querySelectorAll('#rows tr'));
  var search = document.getElementById('search');
  var rowCount = document.getElementById('row-count');
  var changedCount = document.getElementById('changed-count');
  var jsonBox = document.getElementById('decisions-json');
  var note = document.getElementById('export-note');
  var filter = 'all';

  /* what the search box looks through, built from the embedded report */
  var searchIndex = skills.map(function (s) {
    var rec = s.recommendation || {};
    return [(s.names || [])[0], s.name, s.plugin, s.location, s.description, rec.reason, (rec.flags || []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
  });

  function on (el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  /* theme */
  on(document.getElementById('theme-toggle'), 'click', function () {
    var dark = root.getAttribute('data-theme') === 'dark';
    if (dark) { root.setAttribute('data-theme', 'light'); return; }
    if (root.getAttribute('data-theme') === 'light') { root.removeAttribute('data-theme'); return; }
    root.setAttribute('data-theme', 'dark');
  });

  /* cached or uncached prices */
  var modeChips = Array.prototype.slice.call(document.querySelectorAll('[data-mode]'));
  modeChips.forEach(function (chip) {
    on(chip, 'click', function () {
      var mode = chip.getAttribute('data-mode');
      modeChips.forEach(function (c) {
        var active = c === chip;
        c.classList.toggle('on', active);
        c.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      Array.prototype.slice.call(document.querySelectorAll('[data-' + mode + ']')).forEach(function (el) {
        el.textContent = el.getAttribute('data-' + mode);
      });
    });
  });

  var showAll = document.getElementById('show-all-models');
  on(showAll, 'click', function () {
    var extras = Array.prototype.slice.call(document.querySelectorAll('.card.extra'));
    var hidden = extras.length && extras[0].hidden;
    extras.forEach(function (el) { el.hidden = !hidden; });
    showAll.textContent = hidden ? 'Show fewer models' : 'Show all models';
  });

  /* filters and search */
  var filterChips = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  filterChips.forEach(function (chip) {
    on(chip, 'click', function () {
      filter = chip.getAttribute('data-filter');
      filterChips.forEach(function (c) {
        var active = c === chip;
        c.classList.toggle('on', active);
        c.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      applyFilters();
    });
  });
  on(search, 'input', applyFilters);

  function applyFilters () {
    var q = search ? search.value.trim().toLowerCase() : '';
    var shown = 0;
    rows.forEach(function (tr) {
      var flags = ' ' + (tr.getAttribute('data-flags') || '') + ' ';
      var passFilter = filter === 'all'
        ? true
        : filter === 'changed'
          ? tr.getAttribute('data-changed') === 'yes'
          : flags.indexOf(' ' + filter + ' ') !== -1;
      var passSearch = !q || (searchIndex[Number(tr.getAttribute('data-index'))] || '').indexOf(q) !== -1;
      var visible = passFilter && passSearch;
      tr.hidden = !visible;
      if (visible) shown++;
    });
    if (rowCount) rowCount.textContent = 'Showing ' + shown + ' of ' + rows.length + ' skills';
  }

  /* decisions */
  function decisions () {
    var out = [];
    selects.forEach(function (sel) {
      if (sel.value === 'keep') return;
      var skill = skills[Number(sel.getAttribute('data-index'))] || {};
      out.push({
        name: sel.getAttribute('data-name'),
        path: skill.path || skill.realPath || '',
        action: sel.value,
        note: ''
      });
    });
    return { version: 1, generatedOn: report.generatedOn || null, source: 'token-coupons html report', decisions: out };
  }

  function refresh () {
    var changed = 0;
    selects.forEach(function (sel) {
      var isChanged = sel.value !== sel.getAttribute('data-rec');
      if (isChanged) changed++;
      var tr = rows[Number(sel.getAttribute('data-index'))];
      if (tr) tr.setAttribute('data-changed', isChanged ? 'yes' : 'no');
    });
    if (changedCount) {
      changedCount.textContent = changed === 1
        ? '1 row changed from the recommendation'
        : changed + ' rows changed from the recommendation';
    }
    if (jsonBox) jsonBox.value = JSON.stringify(decisions(), null, 2);
    if (filter === 'changed') applyFilters();
  }

  selects.forEach(function (sel) { on(sel, 'change', refresh); });

  on(document.getElementById('accept-all'), 'click', function () {
    selects.forEach(function (sel) { sel.value = sel.getAttribute('data-rec'); });
    refresh();
    say('Every row is back on the recommended choice.');
  });

  on(document.getElementById('reset'), 'click', function () {
    selects.forEach(function (sel) { sel.value = sel.getAttribute('data-rec'); });
    if (search) search.value = '';
    filter = 'all';
    filterChips.forEach(function (c) {
      var active = c.getAttribute('data-filter') === 'all';
      c.classList.toggle('on', active);
      c.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    refresh();
    applyFilters();
    say('Reset. Filters cleared and every row is back on the recommended choice.');
  });

  on(document.getElementById('copy'), 'click', function () {
    if (!jsonBox) return;
    jsonBox.focus();
    jsonBox.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    if (done) { say('Copied. Paste it into a file called decisions.json.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonBox.value).then(
        function () { say('Copied. Paste it into a file called decisions.json.'); },
        function () { say('Copying is blocked here. The text is selected, so copy it with your keyboard.'); }
      );
      return;
    }
    say('Copying is blocked here. The text is selected, so copy it with your keyboard.');
  });

  on(document.getElementById('download'), 'click', function () {
    if (!jsonBox) return;
    try {
      var blob = new Blob([jsonBox.value], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'decisions.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      say('If no file appeared, this viewer blocks saving. Use Copy JSON instead.');
    } catch (e) {
      say('Saving is blocked here. Use Copy JSON instead.');
    }
  });

  function say (text) { if (note) note.textContent = text; }

  refresh();
  applyFilters();
})();
`
}
