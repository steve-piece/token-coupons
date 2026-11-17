// The decision list. The companion to the share card: where the card carries
// one number, this page carries every row behind it and lets a person change
// any of them.
//
// Four things shape it:
//
//   The waste is accounted for in full. The headline figure is split into
//   where each dollar sits: what the choices give back, new skills it is too
//   early to judge, skills another tool picks, and the name lines a command
//   still costs. Changing a row moves its dollars between those parts, so the
//   gap between "wasted" and "back" always explains itself.
//
//   Data, not sentences. Usage, description length and age are drawn in their
//   own cells, so tags are kept for the signals those cells cannot show.
//
//   Two questions, two controls. Context or command, and keep, shorten or
//   delete, are separate segmented controls. A dot marks the suggestion and a
//   dashed outline marks what the skill is today, so the current state is
//   never hidden behind a proposal.
//
//   Nothing here writes to disk. The page produces a decisions file the person
//   pastes back to their agent, which is what actually applies anything.
//
// The stylesheet and the page script live beside this file in list/, read
// once at load and inlined, so the page stays one self contained document.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fmt, money } from './lib/util.mjs'
import { CLIENTS, clientLabel } from './clients.mjs'
import { scoreReport, headline, GRADE_COLOR, WEIGHTS } from './score.mjs'
import { LOGO_PATHS } from './list/logos.mjs'

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'list')
const CSS = readFileSync(join(HERE, 'page.css'), 'utf8')
const JS = readFileSync(join(HERE, 'page.js'), 'utf8')

/* -------------------------------------------------------------- vocabulary */

// The short names a tool gets wherever space is tight. The full name is always
// in the title beside it.
const TOOL_ABBR = { claude: 'CC', codex: 'CX', cursor: 'CU', gemini: 'GE' }

// Where a folder lives, in two words. The long phrasing moves to the tooltip.
const ORIGIN = {
  user: ['Personal', 'in your skills folder'],
  'user-symlink': ['Linked', 'a shortcut in your skills folder'],
  'plugin-cache': ['Plugin cache', 'installed by a plugin; edits are wiped on the next update'],
  marketplace: ['Marketplace', 'a marketplace checkout'],
  project: ['Project', 'in this project'],
  'project-source': ['Project', 'in this project'],
  agents: ['Shared', 'in the shared .agents skills folder'],
}

// Signals that are not already visible in the Usage or Description cells.
// Never used, too long, too short and stale are drawn as data in those cells,
// so they are not repeated as tags.
const TAG_DEFS = {
  unroutable: ['danger', 'Out of reach', 'dropped from the listing to fit the budget: the agent cannot pick it, and nothing warns you'],
  capped: ['danger', 'Cut off', 'longer than the agent reads, so the tail of the description is thrown away'],
  'summoned-only': ['info', 'You type it', 'you start it by name four times in five, so it pays to sit in the router for little return'],
  'dormant-command': ['plain', 'Already a command', 'already waits for its name; it costs one line and nothing changes by editing it'],
  'usage-unmeasured': ['warn', 'Usage unknown', 'listed by a tool whose chats this run could not read, so never used is not certain'],
}

const FILTERS = [
  ['never-called', 'Never used'],
  ['summoned-only', 'You type it'],
  ['heavy-description', 'Too long'],
  ['thin-description', 'Too short'],
  ['unroutable', 'Out of reach'],
  ['stale', 'Stale'],
  ['too-new', 'New'],
]

/* ------------------------------------------------------------------ render */

/** @param {object} report a Report from report.mjs @returns {string} one HTML document */
export function renderList (report, { cardHref = null } = {}) {
  tipSeq = 0
  const r = report || {}
  const s = r.summary || {}
  const skills = Array.isArray(r.skills) ? r.skills : []
  const th = r.thresholds || {}
  const today = dayNum(r.generatedOn)
  const ctx = { r, s, th, today, waste: wasteSet(r), cap: (r.budget && r.budget.perEntryCap) || 1536 }
  const rows = skills.map((x, i) => rowModel(x, i, ctx))

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Skill Decisions</title>',
    '<style>' + CSS + '</style>',
    '</head><body>',
    '<div class="wrap">',
    mast(r, cardHref),
    hero(r, s),
    wastePanel(r, s, ctx.waste),
    tools(r),
    table(rows, ctx),
    '</div>',
    tray(),
    dialog(r, rows),
    '<script type="application/json" id="report-data">' + JSON.stringify(r).replace(/</g, '\\u003c') + '</script>',
    '<script>' + JS.replace('__LABELS__', JSON.stringify(Object.fromEntries(CLIENTS.map((c) => [c.id, c.label])))) + '</script>',
    '</body></html>',
    '',
  ].join('\n')
}

function mast (r, cardHref) {
  return '<header class="mast"><span class="dot"></span><span class="brand">token-coupons</span>' +
    '<span class="crumb">Skill decisions</span>' +
    (cardHref ? '<a class="back" href="' + attr(cardHref) + '">Back to the scorecard</a>' : '') +
    '<span class="when">' + esc(r.generatedOn || '') + '</span>' +
    '<button type="button" id="theme-toggle" class="icon-btn" aria-label="switch light or dark">' + ICON.theme + '</button></header>'
}

/* ------------------------------------------------------------------- hero */

function hero (r, s) {
  const scored = scoreReport(r)
  const tone = GRADE_COLOR[scored.grade] || 'rose'
  const recent = r.totals && r.totals.usedRecently
  const over = Number(s.overBudgetRatio) || ((r.economics || {}).perSession || {}).overBudgetRatio || 0
  const budgetTok = (r.budget && r.budget.tokens) || 0
  const lines = headline(s, r.economics || {}, scored)

  const parts = ['earned', 'fit', 'reach'].map((k) => {
    const got = scored.parts[k]; const max = WEIGHTS[k]
    const label = { earned: 'Earned', fit: 'Fits', reach: 'Reach' }[k]
    const tip = {
      earned: 'share of listing tokens spent on skills the agent has picked at least once',
      fit: 'full marks at or under the listing allowance, none at twice over',
      reach: 'a tenth off for every skill the agent is silently dropping',
    }[k]
    return '<div class="part" title="' + attr(tip) + '"><span class="pk">' + label + '</span>' +
      '<span class="pm"><i style="width:' + pct(got, max) + '%"></i></span>' +
      '<span class="pv">' + fmtN(got) + '<span class="dim">/' + max + '</span></span></div>'
  }).join('')

  const kpis = []
  if (recent && Number.isFinite(Number(recent.skills))) {
    kpis.push(kpi(fmt(recent.skills) + '<span class="of">/' + fmt(s.skills || 0) + '</span>', 'used, last ' + fmt(recent.days) + ' days', 'plain',
      fmt(recent.uses) + ' uses in all. The rest were sent with every message and never opened.', true))
  }
  kpis.push(kpi(fmt(s.unroutable || 0), 'out of reach', (s.unroutable ? 'bad' : 'plain'),
    'Installed and correct, but dropped from the listing to fit the budget, so the agent cannot pick them.'))
  if (over) {
    kpis.push(kpi(over.toFixed(2) + '<span class="of">x</span>', 'over the listing budget', over > 1 ? 'warn' : 'good',
      fmt(s.listingTokensPerCall || 0) + ' tokens a message against room for ' + fmt(budgetTok) + '.', true,
      '<span class="kbar"><i style="width:' + Math.min(100, Math.round(100 / Math.max(over, 1))) + '%"></i></span>'))
  }

  return [
    '<section class="hero">',
    '<div class="scorecard">',
    '<div class="scoretop"><span class="sv">' + esc(String(scored.score)) + '</span><span class="sd">/100</span>' +
      '<span class="grade ' + tone + '">' + esc(scored.grade) + '</span></div>',
    '<div class="parts">' + parts + '</div>',
    '</div>',
    '<div class="herotext">',
    '<h1>' + esc(lines[0] || '') + '</h1>',
    lines[1] ? '<p class="sub">' + esc(lines[1]) + '</p>' : '',
    '<div class="kpis" style="--k:' + kpis.length + '">' + kpis.join('') + '</div>',
    '</div>',
    '</section>',
  ].join('\n')
}

/* ------------------------------------------------------------------ waste */

/** The skills the wasted figure counts: context skills never picked, plus the
 *  ones you mostly start by typing. Same lists the economics block prices. */
const nameOf = (x) => (x.names && x.names[0]) || x.name || ''
function wasteSet (r) {
  const e = r.economics || {}
  return new Set([...((e.neverCalledContext || {}).names || []), ...((e.summonedOnlyContext || {}).names || [])])
}

/** Where every wasted dollar goes under the suggestions. The client redraws
 *  the same buckets from the rows as you change them. */
function wasteBuckets (r, waste) {
  const b = { back: 0, nameline: 0, fresh: 0, elsewhere: 0, left: 0, extra: 0 }
  const n = { back: 0, fresh: 0, elsewhere: 0, left: 0, extra: 0 }
  const pickers = new Set()
  for (const x of r.skills || []) {
    const rec = x.recommendation || {}
    const flags = rec.flags || []
    const d = Number(x.dollarsPerMonth) || 0
    const acts = ['command', 'delete', 'optimize'].includes(rec.action) && !(rec.action === 'delete' && x.location === 'plugin-cache')
    const got = acts && x.listingTokens ? (Number(rec.impactTokensPerCall) || 0) * d / x.listingTokens : 0
    if (!waste.has(nameOf(x))) { if (got) { b.extra += got; n.extra++ } continue }
    if (flags.includes('picked-elsewhere')) {
      Object.entries(x.callsByClient || {}).forEach(([id, t]) => { if (id !== 'claude' && t && Number(t.contextCalls) > 0) pickers.add(id) })
    }
    if (got > 0) { b.back += got; b.nameline += d - got; n.back++ } else {
      const k = flags.includes('too-new') ? 'fresh' : flags.includes('picked-elsewhere') ? 'elsewhere' : 'left'
      b[k] += d; n[k]++
    }
  }
  const total = b.back + b.nameline + b.fresh + b.elsewhere + b.left
  return { b, n, total, pickers: [...pickers] }
}

function wastePanel (r, s, waste) {
  const { b, n, total, pickers } = wasteBuckets(r, waste)
  if (!total) return ''
  const model = ((s.wastedPerWeekOnYourModel || {}).model) || ((s.savedOnYourModel || {}).model) || ''
  const share = ((r.cost || {}).volume || {}).wastedShareOfInput
  const who = pickers.length ? pickers.map(clientLabel).join(' and ') + (pickers.length > 1 ? ' pick' : ' picks') + ' these' : 'Other tools pick these'
  const w = (v) => (v / total * 100).toFixed(2) + '%'
  const SEGS = [
    ['back', 'Back with your choices', 'the suggestions you have kept, plus any you added', null, null],
    ['fresh', 'New, check back in 14 days', 'installed in the last 14 days, so not being used yet proves nothing', 'waste-fresh', null],
    ['elsewhere', who, 'unused here, but another tool that reads the same command setting picks them; a command here would take them away there', 'waste-elsewhere', pickers],
    ['left', 'Still listed', 'unused, and nothing in the current choices takes them out of the listing', null, null],
    ['nameline', 'Name lines stay', 'a command still lists its name, so a sliver of each saving stays listed', null, null],
  ]
  const bar = SEGS.map(([k, label]) => '<i class="ws ws-' + k + '" data-w="' + k + '" style="width:' + w(b[k]) + '" title="' + attr(label) + '"></i>').join('')
  const legend = SEGS.map(([k, label, tip, flag, ids]) => {
    const inner = '<span class="sw ws-' + k + '"></span>' +
      '<span class="wlk">' + (ids && ids.length ? ids.map((id) => logo(id, clientLabel(id))).join('') : '') + esc(label) + '</span>' +
      '<span class="wlv" data-wv="' + k + '">' + esc(money(b[k])) + '</span>' +
      (k === 'nameline' ? '' : '<span class="wln" data-wn="' + k + '">' + n[k] + '</span>')
    const hide = (k === 'left' && !b.left) ? ' hidden' : ''
    return flag
      ? '<button type="button" class="wl" data-wk="' + k + '" data-goflag="' + flag + '" aria-pressed="false" title="' + attr(tip + '. Show them in the list.') + '"' + hide + '>' + inner + '</button>'
      : '<span class="wl" data-wk="' + k + '" title="' + attr(tip) + '"' + hide + '>' + inner + '</span>'
  }).join('')

  return [
    '<section class="waste" id="waste" data-total="' + total + '">',
    '<div class="wtop">',
    '<div class="wstat"><span class="wv bad">' + esc(money(total)) + '</span><span class="wk">wasted a month' +
      info('tip-waste', 'Descriptions of skills the agent never picks, or that you start by typing, sent with every message. At ' + model +
        ' API prices; on a flat plan it is not a bill but it eats into your limits' +
        (typeof share === 'number' && share > 0 ? ' (' + (share * 100).toFixed(1) + '% of everything you send)' : '') + '.') + '</span></div>',
    '<div class="wstat right"><span class="wv good" id="k-save">' + esc(money(b.back)) + '</span><span class="wk">of it back with your choices</span></div>',
    '</div>',
    '<div class="wbar" aria-hidden="true">' + bar + '</div>',
    '<div class="wlegend">' + legend + '</div>',
    '<p class="wextra" id="w-extra"' + (b.extra ? '' : ' hidden') + '>Plus <b class="good" data-wv="extra">' + esc(money(b.extra)) + '</b> from shortening ' +
      '<span data-wn="extra">' + n.extra + '</span> skills you do use, so <b class="good" id="k-total">' + esc(money(b.back + b.extra)) + '</b> back in all.</p>',
    '</section>',
  ].join('\n')
}

// Tooltip ids for the figure tiles, counted per render so the page is the
// same bytes every time it is built from the same report.
let tipSeq = 0

function kpi (valueHtml, label, tone, tip, raw = false, extra = '') {
  const id = 'tip-k' + (++tipSeq)
  return '<div class="kpi ' + tone + '"><span class="kv">' + (raw ? valueHtml : esc(valueHtml)) + '</span>' +
    '<span class="kk">' + esc(label) + info(id, tip) + '</span>' + extra + '</div>'
}

function info (id, tip) {
  return '<span class="info"><button type="button" class="info-btn" aria-describedby="' + id + '" aria-label="more about this">' + ICON.info + '</button>' +
    '<span class="tip" role="tooltip" id="' + id + '">' + esc(tip) + '</span></span>'
}

/* ------------------------------------------------------------------ tools */

function tools (r) {
  const all = Array.isArray(r.clients) ? r.clients : []
  if (all.length < 2) return ''
  const rows = all.map((c) => {
    const notes = ((c.coverage || {}).notes || []).join(' ')
    const isCC = c.id === 'claude'
    return '<tr' + (isCC ? ' class="me"' : '') + '>' +
      '<th scope="row">' + logo(c.id, c.label) + esc(c.label) +
        (notes ? info('tn-' + c.id, notes) : '') + '</th>' +
      '<td class="num">' + fmt(c.skills) + '</td>' +
      '<td class="num">' + (isCC ? '<span class="dim">all</span>' : fmt(c.alsoInClaude || 0)) + '</td>' +
      '<td class="num">' + fmt(c.listingTokens) + (c.overBudget ? ' <span class="pill danger xs">over</span>' : '') + '</td>' +
      '<td class="num">' + (c.budget ? fmt(c.budget.tokens) : '<span class="dim">none published</span>') + '</td>' +
      '<td class="num">' + fmt(c.sessions) + '</td>' +
      '<td class="num">' + fmt(c.skillCalls) + '</td>' +
      '<td class="ctr">' + (c.honoursGate ? '<span class="yes" title="a command here is a command there">' + ICON.check + '</span>' : '<span class="no" title="ignores the command setting">' + ICON.x + '</span>') + '</td>' +
      '</tr>'
  }).join('')
  return [
    '<details class="tools" id="tools">',
    '<summary><span class="sumk">Tools on this machine</span><span class="sumv">' + all.map((c) => logo(c.id, c.label)).join('') + '</span>' +
      '<span class="dim">each sends its own list on its own model; shared folders change everywhere</span></summary>',
    '<div class="tablewrap"><table class="toolt"><thead><tr><th>Tool</th><th class="num">Skills</th><th class="num">Shared w/ CC</th><th class="num">Tokens / msg</th>' +
      '<th class="num">Allowance</th><th class="num">Chats read</th><th class="num">Skill uses</th><th class="ctr">Honors command</th></tr></thead>',
    '<tbody>' + rows + '</tbody></table></div>',
    '</details>',
  ].join('\n')
}

/* ------------------------------------------------------------------ table */

function rowModel (x, i, ctx) {
  const rec = x.recommendation || {}
  const raw = Array.isArray(rec.flags) ? rec.flags : []
  // A command that was never used is counted apart from never used context
  // skills in the headline, so the filter counts it the same way.
  const flags = raw.includes('dormant-command') ? raw.filter((f) => f !== 'never-called') : raw
  const name = (x.names && x.names[0]) || x.name || 'skill'
  const todayMode = x.mode === 'command' ? 'command' : 'context'
  const recMode = rec.action === 'command' ? 'command' : todayMode
  const locked = x.location === 'plugin-cache'
  const recAct = rec.action === 'delete' && locked ? 'keep' : (['optimize', 'delete'].includes(rec.action) ? rec.action : 'keep')
  return { x, i, rec, flags, name, todayMode, recMode, recAct, locked }
}

function table (rows, ctx) {
  const { s } = ctx
  const counts = {}
  rows.forEach((m) => m.flags.forEach((f) => { counts[f] = (counts[f] || 0) + 1 }))
  const suggested = rows.filter((m) => m.recMode !== m.todayMode || m.recAct !== 'keep').length
  const maxCost = rows.reduce((n, m) => Math.max(n, Number(m.x.dollarsPerMonth) || 0), 0) || 1

  const tabs = [
    ['all', 'All', rows.length],
    ['suggested', 'Suggested', suggested],
    ['changed', 'Changed by me', 0],
  ].map(([v, label, n]) => '<button type="button" class="tab' + (v === 'all' ? ' on' : '') + '" data-scope="' + v + '" aria-pressed="' + (v === 'all') + '">' +
    esc(label) + '<span class="n" ' + (v === 'changed' ? 'id="n-changed"' : '') + '>' + n + '</span></button>').join('')

  const chips = FILTERS.filter(([k]) => counts[k]).map(([k, label]) =>
    '<button type="button" class="chip" data-flag="' + k + '" aria-pressed="false">' + esc(label) + '<span class="n">' + counts[k] + '</span></button>').join('')

  return [
    '<section class="list" id="list">',
    '<div class="toolbar">',
    '<div class="tabs" role="group" aria-label="which rows">' + tabs + '</div>',
    '<label class="search">' + ICON.search + '<input type="search" id="search" placeholder="Search skills" aria-label="search skills"></label>',
    '</div>',
    '<div class="subbar">',
    '<div class="chips" role="group" aria-label="filter by signal">' + chips + '</div>',
    '<div class="bulk" id="bulk">Set <b id="bulk-n">0</b> shown to' +
      '<button type="button" class="ghost sm" data-bulk="command">Command</button>' +
      '<button type="button" class="ghost sm" data-bulk="keep">As today</button>' +
      '<button type="button" class="ghost sm" data-bulk="suggested">Suggested</button></div>',
    '<div class="key"><span class="keyi"><span class="sugdot"></span>suggested</span><span class="keyi"><span class="todaybar"></span>today</span>' +
      info('tip-modes', 'Context: the agent can pick it, so its description rides in every message. Command: only its name is listed and you start it by typing it (disable-model-invocation: true). Cursor reads that line too; Codex and Gemini CLI do not.') + '</div>',
    '</div>',
    '<div class="tablewrap main">',
    '<table class="grid">',
    '<colgroup><col class="c-rank"><col class="c-skill"><col class="c-use"><col class="c-desc"><col class="c-cost"><col class="c-save"><col class="c-type"><col class="c-act"></colgroup>',
    '<thead><tr>',
    '<th class="num"><button type="button" class="sort" data-sort="rank">#</button></th>',
    '<th><button type="button" class="sort" data-sort="name">Skill</button></th>',
    '<th><button type="button" class="sort" data-sort="use" title="times the agent picked it, then times you typed it, in Claude Code">Usage</button></th>',
    '<th><button type="button" class="sort" data-sort="chars" title="description length against the per entry cap; the tick is where too long starts">Description</button></th>',
    '<th class="num"><button type="button" class="sort" data-sort="cost">Cost / mo</button></th>',
    '<th class="num"><button type="button" class="sort" data-sort="save" title="what your current choices on this row recover">Saves / mo</button></th>',
    '<th>Type</th>',
    '<th>Action</th>',
    '</tr></thead>',
    '<tbody id="rows">' + rows.map((m) => row(m, ctx, maxCost)).join('\n') + '</tbody>',
    '</table>',
    '</div>',
    '<p class="empty" id="empty" hidden>No skills match. <button type="button" class="link" id="clear">Clear filters</button></p>',
    '</section>',
  ].join('\n')
}

function row (m, ctx, maxCost) {
  const { x, i, rec, flags, name, todayMode, recMode, recAct, locked } = m
  const { th, today, cap } = ctx
  const cost = Number(x.dollarsPerMonth) || 0
  const chars = Number(x.descriptionChars) || 0
  const usage = (Number(x.contextCalls) || 0) + (Number(x.commandCalls) || 0)
  const state = (recMode !== todayMode || recAct !== 'keep') ? 'suggested' : ''
  // Waste buckets the breakdown legend filters on; never shown as chips.
  const wf = !ctx.waste.has(name) ? [] : flags.includes('too-new') ? ['waste-fresh'] : flags.includes('picked-elsewhere') ? ['waste-elsewhere'] : []

  return [
    '<tr data-i="' + i + '" data-flags="' + attr(flags.concat(wf).join(' ')) + '" data-state="' + state + '" data-changed="no"',
    ' data-rank="' + (rec.rank || i + 1) + '" data-name="' + attr(name.toLowerCase()) + '" data-use="' + usage + '" data-chars="' + chars + '" data-cost="' + cost + '">',
    '<td class="num rank">' + esc(String(rec.rank || i + 1)) + '</td>',
    '<td class="skill">' + skillCell(x, i, name, flags, today) + '</td>',
    '<td class="use">' + usageCell(x, today) + '</td>',
    '<td class="desc">' + descCell(x, flags, th, cap, today) + '</td>',
    '<td class="num cost"><span class="cv">' + esc(money(cost)) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round(cost / maxCost * 100)) + '%"></i></span></td>',
    '<td class="num save"><span class="sv0" data-save="' + i + '">0</span></td>',
    '<td class="ctl">' + seg('t' + i, [['context', 'Context'], ['command', 'Command']], recMode, recMode !== todayMode ? recMode : null, todayMode, {}, name, 'type') + '</td>',
    '<td class="ctl">' + seg('a' + i, [['keep', 'Keep'], ['optimize', 'Shorten'], ['delete', 'Delete']], recAct, recAct !== 'keep' ? recAct : null, 'keep',
      locked ? { delete: 'lives in a plugin cache; uninstall the plugin instead' } : {}, name, 'action') + '</td>',
    '</tr>',
  ].join('')
}

function skillCell (x, i, name, flags, today) {
  const chips = []
  if (x.plugin) chips.push('<span class="meta plug" title="part of the ' + attr(x.plugin) + ' plugin">' + ICON.plug + esc(x.plugin) + '</span>')
  const o = ORIGIN[x.location] || [String(x.location || 'elsewhere'), String(x.location || '')]
  chips.push('<span class="meta' + (x.location === 'plugin-cache' ? ' lock' : '') + '" title="' + attr(o[1]) + '">' +
    (x.location === 'plugin-cache' ? ICON.lock : x.location === 'user-symlink' ? ICON.link : ICON.folder) + esc(o[0]) + '</span>')
  if (x.sourcePath) chips.push('<span class="meta src" title="' + attr('edits go to the source copy at ' + x.sourcePath) + '">' + ICON.pen + 'source copy</span>')

  const listed = (Array.isArray(x.listedIn) ? x.listedIn : []).filter((id) => id !== 'claude')
  const tools = listed.length ? '<span class="tools-in" title="' + attr('also listed by ' + listed.map(clientLabel).join(', ')) + '">' +
    listed.map((id) => logo(id, clientLabel(id))).join('') + '</span>' : ''

  const tags = []
  flags.forEach((f) => { if (TAG_DEFS[f]) tags.push(tag(...TAG_DEFS[f])) })
  // The two tags whose value is the whole point, so they carry it.
  const by = x.callsByClient || {}
  const others = Object.entries(by).filter(([id, t]) => id !== 'claude' && t && Number(t.calls) > 0)
  if (flags.includes('picked-elsewhere')) {
    const who = others.filter(([, t]) => Number(t.contextCalls) > 0).map(([id, t]) => clientLabel(id) + ' ' + t.contextCalls + 'x')
    tags.push(tag('good', (who[0] || 'Elsewhere') + ' picks it', 'another tool that reads the same command setting chose it on its own; a command here would take it away there'))
  } else if (flags.includes('used-elsewhere') && others.length) {
    tags.push(tag('plain', 'Used in ' + others.map(([id, t]) => clientLabel(id) + ' ' + t.calls + 'x').join(', '), 'another tool on this machine uses this folder'))
  }
  if (flags.includes('too-new')) {
    const age = daysSince(x.modifiedOn, today)
    tags.push(tag('info', 'New' + (age !== null ? ', ' + (age === 0 ? 'today' : age + 'd') : ''), 'installed in the last 14 days and not used yet, which is expected; no saving is claimed'))
  }

  return '<button type="button" class="sname" data-detail="' + i + '" aria-expanded="false">' + esc(name) + ICON.chev + '</button>' +
    '<div class="metas">' + tags.join('') + chips.join('') + tools + '</div>'
}

function usageCell (x, today) {
  const a = Number(x.contextCalls) || 0
  const y = Number(x.commandCalls) || 0
  const elsewhere = Number(x.callsElsewhere) || 0
  const last = daysSince(x.lastSeen, today)
  const lastTxt = x.lastSeen ? (last === 0 ? 'today' : last + 'd ago') : 'never'
  return '<div class="pair"><span class="pn' + (a ? '' : ' z') + '">' + a + '</span><span class="pk">agent</span>' +
    '<span class="pn' + (y ? '' : ' z') + '">' + y + '</span><span class="pk">you</span></div>' +
    '<div class="sub' + (x.lastSeen ? '' : ' warn') + '">' + (x.lastSeen ? 'last ' : '') + lastTxt +
    (elsewhere ? ' <span class="plus" title="uses in other tools on this machine">+' + elsewhere + ' elsewhere</span>' : '') + '</div>'
}

function descCell (x, flags, th, cap, today) {
  const chars = Number(x.descriptionChars) || 0
  const heavy = Number(th.heavyChars) || 600
  const thin = Number(th.thinChars) || 60
  const tone = flags.includes('capped') ? 'danger' : (flags.includes('heavy-description') || flags.includes('thin-description')) ? 'warn' : 'ok'
  const edited = daysSince(x.modifiedOn, today)
  const stale = flags.includes('stale')
  const label = flags.includes('thin-description') ? 'too short' : flags.includes('heavy-description') ? 'too long' : ''
  return '<div class="meter ' + tone + '" title="' + attr(fmt(chars) + ' characters, about ' + fmt(x.descriptionTokens || 0) + ' tokens a message. Too short under ' + thin + ', too long over ' + heavy + ', cut off past ' + cap) + '">' +
    '<i style="width:' + pct(chars, cap) + '%"></i><b style="left:' + pct(heavy, cap) + '%"></b></div>' +
    '<div class="sub"><span class="' + (tone === 'ok' ? '' : tone) + '">' + fmt(chars) + ' ch' + (label ? ' ' + label : '') + '</span>' +
    (edited !== null ? ' <span class="' + (stale ? 'warn' : 'dim') + '" title="last edited ' + attr(x.modifiedOn) + '">&middot; ' + edited + 'd old</span>' : '') + '</div>'
}

/**
 * A segmented control. The pressed segment is the current choice; a dot marks
 * the tool's suggestion and a bar marks what the skill is today, so neither
 * needs a sentence under the control.
 */
function seg (group, options, selected, suggested, today, disabled, name, kind) {
  return '<div class="seg" role="radiogroup" data-kind="' + kind + '" aria-label="' + attr(kind + ' for ' + name) + '">' +
    options.map(([v, label]) => {
      const dis = disabled[v]
      return '<label class="sg' + (v === suggested ? ' sug' : '') + (v === today ? ' today' : '') + (dis ? ' dis' : '') + '"' + (dis ? ' title="' + attr(dis) + '"' : '') + '>' +
        '<input type="radio" name="' + group + '" value="' + v + '"' + (v === selected ? ' checked' : '') + (dis ? ' disabled' : '') +
        ' data-rec="' + attr(suggested || today) + '" data-today="' + attr(today) + '">' +
        '<span>' + esc(label) + '</span></label>'
    }).join('') + '</div>'
}

/** A tool's mark, or its initials when there is no mark for it. */
function logo (id, label) {
  const p = LOGO_PATHS[id]
  return '<span class="logo l-' + attr(id) + '" role="img" aria-label="' + attr(label) + '" title="' + attr(label) + '">' +
    (p ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' + p + '</svg>' : esc(TOOL_ABBR[id] || '?')) + '</span>'
}

function tag (tone, label, tip) {
  return '<span class="tag ' + tone + '" title="' + attr(tip) + '">' + esc(label) + '</span>'
}

/* ------------------------------------------------------------ tray, dialog */

function tray () {
  return '<div class="tray" id="tray" role="region" aria-label="your decisions">' +
    '<div class="tray-in">' +
    '<div class="tstat"><span class="tv" id="t-count">0</span><span class="tk">changes</span></div>' +
    '<div class="tstat"><span class="tv good" id="t-save">$0</span><span class="tk">a month back</span></div>' +
    '<div class="tstat mine"><span class="tv" id="t-mine">0</span><span class="tk">yours</span></div>' +
    '<span class="tnote" id="t-note" role="status" aria-live="polite">Nothing changes on disk until your agent asks and you say yes.</span>' +
    '<button type="button" class="ghost risky" id="reset">Reset</button>' +
    '<button type="button" class="ghost" id="view">View JSON</button>' +
    '<button type="button" class="go" id="copy">' + ICON.copy + 'Copy</button>' +
    '</div></div>'
}

function dialog (r, rows) {
  return '<dialog id="json-dialog"><div class="dh"><b>decisions.json</b><span class="dim">paste it into your next message with "proceed with these decisions"</span>' +
    '<button type="button" class="icon-btn" id="close" aria-label="close">' + ICON.x + '</button></div>' +
    '<textarea id="decisions-json" spellcheck="false" readonly aria-label="the decisions file">' + esc(JSON.stringify(decisionsOf(r, rows), null, 2)) + '</textarea></dialog>'
}

/**
 * The decisions file as the page opens, on the suggestions. The page script
 * rebuilds it the same way on every change; this copy is there so the file is
 * right before any script runs. One row can give two entries, because kind and
 * disposition are separate questions.
 */
function decisionsOf (r, rows) {
  return {
    version: 1,
    generatedOn: r.generatedOn || null,
    source: 'token-coupons html report',
    decisions: rows.flatMap((m) => {
      const path = m.x.path || m.x.realPath || ''
      const out = []
      if (m.recMode !== m.todayMode) out.push({ name: m.name, path, action: m.recMode, note: '' })
      if (m.recAct !== 'keep') out.push({ name: m.name, path, action: m.recAct, note: '' })
      return out
    }),
  }
}

/* ------------------------------------------------------------------ bits */

function dayNum (d) { const t = Date.parse(d); return Number.isFinite(t) ? Math.floor(t / 864e5) : null }
function daysSince (d, today) { const n = dayNum(d); return n === null || today === null ? null : Math.max(0, today - n) }
function pct (v, max) { return Math.max(0, Math.min(100, Math.round((Number(v) || 0) / (Number(max) || 1) * 100))) }
function fmtN (n) { return Number.isInteger(n) ? String(n) : n.toFixed(1) }
function esc (v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function attr (v) { return esc(v) }

const svg = (d, extra = '') => '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' + extra + '>' + d + '</svg>'
const ICON = {
  info: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v3.6M8 5.2v.1"/>'),
  theme: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  x: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  plug: svg('<path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  link: svg('<path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.6.6M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.6-.6"/>'),
  folder: svg('<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>'),
  pen: svg('<path d="M10.5 2.5 13.5 5.5 6 13H3v-3z"/>'),
  copy: svg('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8A1.3 1.3 0 0 1 4.3 2.5H10"/>'),
  chev: svg('<path d="m6 4 4 4-4 4"/>', ' class="chev"'),
}
