// The panel: the report cut down to what a small live view can hold.
//
// The text report is a page and the decision list is a document. Neither fits
// in a status line or a pane beside a conversation, and a view that small
// should not have to read a megabyte of report to draw six numbers. So this
// module picks them: what the list costs, the three counts, what taking the
// recommendations is worth, the first few rows worth acting on, and one line
// per other tool. Plain JSON, a few kilobytes, with a version on it.
//
// It exists for the Claude Code mod that ships with the plugin install (see
// hooks/ at the repo root), which draws it and decides nothing. Everything a
// number means is decided here, where it is tested, so the mod stays a view.
// A skill installed on its own never loads that mod and loses nothing: this
// is one more way to print the same report.
//
// Two sources. A fresh measurement gives the whole panel. The record the last
// run left gives the top half only (a record keeps the summary and one line
// per skill, not the reasons), and says so in `state`, so a view can show
// something the moment a session starts and fill in the rest when asked.

import { VERSION } from './version.mjs'
import { scoreReport } from './score.mjs'
import { tildify } from './paths.mjs'

export const PANEL_VERSION = 1

/** How many rows worth acting on the panel carries unless told otherwise. */
export const DEFAULT_PANEL_ROWS = 8

const ACTIONS = { command: 0, delete: 0, optimize: 0, review: 0, keep: 0, context: 0 }

/**
 * The whole panel, from a Report.
 *
 * @param report from buildReport
 * @param rows   how many rows worth acting on to carry
 */
export function panelOf (report, { rows = DEFAULT_PANEL_ROWS } = {}) {
  const r = report || {}
  const s = r.summary || {}
  const eco = r.economics || {}
  const budget = r.budget || {}
  const limit = Math.max(0, Math.floor(Number(rows)) || 0)

  const actionable = (Array.isArray(r.skills) ? r.skills : []).filter((x) => x.recommendation && x.recommendation.action !== 'keep')
  const top = actionable.slice(0, limit).map((x) => ({
    rank: x.recommendation.rank,
    action: x.recommendation.action,
    saves: Number(x.recommendation.impactTokensPerCall) || 0,
    name: (Array.isArray(x.names) && x.names[0]) || x.name || '',
    why: String(x.recommendation.reason || ''),
  }))

  const tools = (Array.isArray(r.clients) ? r.clients : []).filter((c) => c.id !== 'claude').map((c) => ({
    id: c.id,
    label: c.label,
    skills: Number(c.skills) || 0,
    // How many of them are the same folders Claude Code lists.
    alsoInClaude: typeof c.alsoInClaude === 'number' ? c.alsoInClaude : null,
    tokens: Number(c.listingTokens) || 0,
    allowanceTokens: c.budget && Number(c.budget.tokens) ? Number(c.budget.tokens) : null,
    over: typeof c.overBudget === 'boolean' ? c.overBudget : null,
    chats: Number(c.sessions) || 0,
    uses: Number(c.skillCalls) || 0,
    readsGate: Boolean(c.honoursGate),
    notes: (c.coverage && Array.isArray(c.coverage.notes)) ? c.coverage.notes.map(String) : [],
  }))

  return Object.assign(base(s, {
    state: 'measured',
    generatedOn: r.generatedOn || null,
    ranAt: (r.run && r.run.ranAt) || null,
    cwd: r.run && r.run.cwd ? tildify(r.run.cwd) : null,
    allowanceTokens: Number(budget.tokens) || null,
    alsoElsewhere: num(((Array.isArray(r.clients) ? r.clients : []).find((c) => c.id === 'claude') || {}).alsoElsewhere),
    neverUsedTokens: num((eco.neverCalledContext || {}).tokens),
    typedOnlyTokens: num((eco.summonedOnlyContext || {}).tokens),
    score: scoreOf(r),
  }), {
    // Distinct skills at least one tool lists. The lists overlap, so this is
    // less than the per tool counts added together.
    installed: num((r.totals || {}).listedByAnyTool),
    top,
    more: Math.max(0, actionable.length - top.length),
    tools,
    drift: (r.previous && Array.isArray(r.previous.drift)) ? r.previous.drift.map(String) : [],
  })
}

/**
 * The top half of the panel, from the record a run left behind. No rows and no
 * other tools: a record does not keep them. `state` says `last-run`, and the
 * date is the day that run was made, which may be a while ago.
 */
export function panelFromRun (run) {
  if (!run || typeof run !== 'object' || !run.summary) return emptyPanel()
  const s = run.summary
  const ratio = Number(s.overBudgetRatio) || 0
  return Object.assign(base(s, {
    state: 'last-run',
    generatedOn: run.generatedOn || (run.ranAt ? String(run.ranAt).slice(0, 10) : null),
    ranAt: run.ranAt || null,
    cwd: run.cwd ? tildify(run.cwd) : null,
    // A record keeps the ratio, not the allowance it was a ratio of, and
    // dividing one back out of the other lands a few tokens off the real
    // figure. Null says "not recorded" rather than printing a near miss.
    allowanceTokens: null,
    alsoElsewhere: null,
    neverUsedTokens: null,
    typedOnlyTokens: null,
    score: scoreOf({ summary: s, economics: { perSession: { overBudgetRatio: ratio } } }),
  }), { installed: null, top: [], more: 0, tools: [], drift: [] })
}

/** What there is to say before the tool has ever run on this machine. */
export function emptyPanel () {
  return {
    version: PANEL_VERSION,
    tool: VERSION,
    state: 'empty',
    generatedOn: null,
    ranAt: null,
    cwd: null,
    listing: null,
    counts: null,
    wastedTokens: null,
    saving: null,
    money: null,
    actions: Object.assign({}, ACTIONS),
    score: null,
    installed: null,
    top: [],
    more: 0,
    tools: [],
    drift: [],
  }
}

/** The fields both sources fill the same way, from a summary. */
function base (s, extra) {
  const ratio = num(s.overBudgetRatio)
  const wasted = s.wastedPerWeekOnYourModel || null
  const saved = s.savedOnYourModel || null
  return {
    version: PANEL_VERSION,
    tool: VERSION,
    state: extra.state,
    generatedOn: extra.generatedOn,
    ranAt: extra.ranAt,
    cwd: extra.cwd,
    listing: {
      skills: Number(s.skills) || 0,
      notListed: Number(s.notListed) || 0,
      tokens: Number(s.listingTokensPerCall) || 0,
      allowanceTokens: extra.allowanceTokens,
      // Skills in this list that another tool lists too: one folder, linked in.
      alsoElsewhere: extra.alsoElsewhere,
      overRatio: ratio,
      fits: ratio === null ? null : ratio <= 1,
    },
    counts: {
      neverUsed: Number(s.neverCalledContext) || 0,
      neverUsedTokens: extra.neverUsedTokens,
      outOfReach: Number(s.unroutable) || 0,
      typedOnly: Number(s.summonedOnly) || 0,
      typedOnlyTokens: extra.typedOnlyTokens,
    },
    wastedTokens: Number(s.wastedTokensPerCall) || 0,
    saving: {
      tokens: Number(s.savedTokensPerCallIfApplied) || 0,
      fitsAfter: typeof s.fitsAfter === 'boolean' ? s.fitsAfter : null,
    },
    money: wasted && typeof wasted.dollars === 'number'
      ? {
          model: String(wasted.model || ''),
          wastedPerWeek: wasted.dollars,
          wastedPerMonth: typeof wasted.dollarsPerMonth === 'number' ? wasted.dollarsPerMonth : null,
          savedPerMonth: saved && typeof saved.dollarsPerMonth === 'number' ? saved.dollarsPerMonth : null,
        }
      : null,
    actions: Object.assign({}, ACTIONS, s.recommendedActions || {}),
    score: extra.score,
  }
}

function scoreOf (reportLike) {
  const scored = scoreReport(reportLike)
  return { score: scored.score, grade: scored.grade }
}

function num (v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
