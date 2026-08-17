// The terminal report. Plain text, sections in a fixed order, colors only when
// asked for. Every sentence should make sense to someone who has never heard
// the phrase "context window": the listing is "the list of skills sent with
// every message", and gating is "start only when you type its name".

import { fmt, money } from './lib/util.mjs'

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

const ACTION_ORDER = ['active', 'delete', 'optimize', 'review', 'keep', 'passive']

/**
 * @param report a Report from report.mjs
 * @param opts   { color: bool, top: number of ranked rows to show }
 */
export function renderText (report, { color = false, top = 15 } = {}) {
  const r = report || {}
  const paint = painter(color)
  const out = []
  const line = (s = '') => out.push(s)
  const head = (s) => { line(); line(paint.bold(s)) }

  const eco = r.economics || {}
  const per = eco.perSession || {}
  const budget = r.budget || eco.budget || {}
  const summary = r.summary || {}
  const cost = r.cost || {}
  const totals = r.totals || {}
  const skills = Array.isArray(r.skills) ? r.skills : []
  // Two copies of one skill (a marketplace checkout and its plugin cache copy,
  // say) share a name; show where each lives so the lists stay readable.
  const nameCount = new Map()
  for (const s of skills) nameCount.set(baseName(s), (nameCount.get(baseName(s)) || 0) + 1)
  const nameOf = (s) => baseName(s) + ((nameCount.get(baseName(s)) || 0) > 1 ? ' (' + (s.location || 'other') + ')' : '')

  // title
  const meta = ['generated ' + (r.generatedOn || 'today')]
  if (r.since) meta.push('sessions since ' + r.since)
  if (totals.transcriptsRead !== undefined) meta.push(fmt(totals.transcriptsRead) + ' sessions read')
  line(paint.bold('token-coupons') + ' ' + (r.tool && r.tool.version ? 'v' + r.tool.version + ' ' : '') + paint.dim('(' + meta.join(', ') + ')'))
  line(paint.dim('Claude Code carries a list of every installed skill, name and description, in every message you send. This is what that list costs.'))
  line(paint.dim('Cost is counted in tokens: small chunks of text, about four characters each, and everything you send is billed by the token.'))

  // WHAT THE LISTING COSTS
  head('WHAT THE LISTING COSTS')
  line('  Skills in your listing: ' + fmt(totals.skills || 0) +
    ' (' + fmt(totals.declaredPassive || 0) + ' let the agent pick them, ' + fmt(totals.declaredActive || 0) + ' start only when you type their name)' +
    (totals.onDiskNotListed ? paint.dim('  plus ' + fmt(totals.onDiskNotListed) + ' on disk but not listed, see ON DISK, NOT LISTED') : ''))
  line('  Allowance for the list: ' + fmt(budget.chars || 0) + ' characters, about ' + fmt(budget.tokens || 0) + ' tokens' +
    paint.dim(' (' + describeBudget(budget) + ')'))
  line('  The list right now:     ' + fmt(per.passiveListingChars || 0) + ' characters of descriptions, about ' + fmt(per.passiveListingTokens || 0) + ' tokens' +
    (per.activeListingTokens ? ', plus ' + fmt(per.activeListingTokens) + ' tokens of name lines' : ''))
  line('  Sent with every message: about ' + fmt(per.totalListingTokens || 0) + ' tokens')
  if (per.fitsBudget === false) {
    line('  ' + paint.red('Over the allowance by ' + fmt(per.overBudgetBy || 0) + ' characters (' + trimNum(per.overBudgetRatio) + 'x).') +
      ' Past that line Claude Code drops descriptions quietly, least used first, so those skills cannot be found by the agent.')
  } else if (per.fitsBudget === true) {
    line('  ' + paint.green('Fits inside the allowance.') + ' Nothing is being dropped.')
  }

  // the three counts
  line()
  const never = eco.neverCalledPassive || {}
  const unroutable = eco.overflowUnroutable || {}
  const summoned = eco.summonedOnlyPassive || {}
  line('  ' + padEnd(fmt(never.count || 0), 5) + ' never used, but described on every message' + paint.dim('  ' + fmt(never.tokens || 0) + ' tokens per message'))
  line('  ' + padEnd(fmt(unroutable.count || 0), 5) + ' cannot be reached (their description is being dropped to fit)')
  line('  ' + padEnd(fmt(summoned.count || 0), 5) + ' only ever started by you typing their name' + paint.dim('  ' + fmt(summoned.tokens || 0) + ' tokens per message'))

  // savings sentence
  const gated = eco.ifGated || {}
  line()
  if ((gated.count || 0) > 0) {
    line('  ' + paint.cyan('Set those ' + fmt(gated.count) + ' skills to start only when you type their name and you save about ' +
      fmt(gated.savedTokensPerSession || 0) + ' tokens on every message') + (gated.fitsBudgetAfter
      ? ', and the list fits its allowance again.'
      : ', though the list is still over its allowance until some descriptions are shortened.'))
  } else {
    line('  ' + paint.green('Nothing here is being wasted: every described skill has been chosen by the agent at least once.'))
  }

  // WHAT IT COSTS IN DOLLARS
  head('WHAT IT COSTS IN DOLLARS')
  const models = Array.isArray(cost.perModel) ? cost.perModel : []
  if (!models.length) {
    line('  No price list could be read' + (r.pricing && r.pricing.error ? ': ' + r.pricing.error : '.'))
  } else {
    const vol = cost.volume || {}
    if (vol.wastedTokensPerWeek) {
      line('  ' + paint.bold(fmt(vol.wastedTokensPerWeek) + ' tokens') + ' wasted per week, ' + paint.bold(fmt(vol.wastedTokensPerMonth || 0)) + ' per month, from ' +
        fmt(summary.wastedTokensPerCall || 0) + ' unused tokens riding in every message.')
      line()
    }
    const rows = models.map((m) => [
      (m.seenInTranscripts ? '* ' : '  ') + String(m.label || m.id),
      money(m.wasted.perWeek),
      money(m.wasted.perMonth),
      money(m.uncached.wastedPerWeek),
      money(m.listing.perMonth),
    ])
    const header = ['  model', 'wasted/week', 'wasted/month', 'uncached/week', 'whole list/month']
    for (const l of table([header, ...rows], [1, 2, 3, 4])) line('  ' + l)
    if (models.some((m) => m.seenInTranscripts)) line(paint.dim('  * seen in your own sessions'))
    const a = cost.assumptions || {}
    line(paint.dim('  Assumes ' + fmt(a.apiCallsPerSession || 0) + ' messages per chat and ' + trimNum(a.sessionsPerWeek || 0) + ' chats per week' +
      (a.measured ? ', measured from your sessions' : ', assumed because no session history was found') +
      (a.cached === false ? '. Prices are the no caching upper bound.' : '. Prices follow the real caching: the list is saved into the cache and re-read cheaply until something throws the saved copy away.')))
    line(paint.dim('  The uncached column is the same week with nothing stored and reused, so the whole list is paid at full price every message. It is the highest the bill could be.'))
    const br = a.cacheBreaks
    if (a.cached !== false && br && a.cacheWritesPerSession > 1) {
      const bits = []
      if (br.firstOfSession) bits.push(fmt(br.firstOfSession) + ' chat starts')
      if (br.cacheExpired) bits.push(fmt(br.cacheExpired) + ' gaps longer than ' + fmt(a.cacheTtlMinutes || 60) + ' minutes')
      if (br.modelSwitch) bits.push(fmt(br.modelSwitch) + ' model switches')
      if (br.effortSwitch) bits.push(fmt(br.effortSwitch) + ' effort switches')
      line(paint.dim('  The saved copy is thrown away and rewritten ' + trimNum(a.cacheWritesPerSession) + ' times per chat, measured: ' + bits.join(', ') +
        '. Each rewrite pays the save price instead of the cheap re-read price, which is why this costs more than one save per chat would.'))
    }
    if (vol.inputTokensPerWeek) {
      line(paint.dim('  Share of everything you send: the list is ' + pct(vol.listingShareOfInput) + ' of your input, the wasted part is ' + pct(vol.wastedShareOfInput) + '.'))
    }
    line(paint.dim('  Prices verified on ' + (cost.pricingVerifiedOn || 'an unknown date') + (cost.pricingStale ? ', which is more than 60 days ago, so check them before quoting them.' : '.')))
  }
  const yours = summary.wastedPerWeekOnYourModel
  if (yours && typeof yours.dollars === 'number') {
    line('  ' + paint.bold('On ' + yours.model + ', the model you actually use, the unused descriptions cost about ' + money(yours.dollars) + ' a week' +
      (typeof yours.dollarsPerMonth === 'number' ? ' (' + money(yours.dollarsPerMonth) + ' a month)' : '') + '.'))
  }

  // RECOMMENDED
  head('RECOMMENDED')
  const counts = summary.recommendedActions || {}
  line('  ' + ACTION_ORDER.filter((k) => counts[k]).map((k) => fmt(counts[k]) + ' ' + actionLabel(k)).join(', ') || '  nothing to do')
  line(paint.dim('  active = start only when you type its name, optimize = rewrite the description shorter, review = it already starts only when you type its name, so this one is your call'))
  const shown = skills.slice(0, top)
  if (shown.length) {
    line()
    const rows = shown.map((s) => [
      String(s.recommendation.rank),
      paint.action(s.recommendation.action),
      fmt(s.recommendation.impactTokensPerCall),
      nameOf(s),
    ])
    const lines = table([['#', 'action', 'saves/msg', 'skill'], ...rows], [0, 2])
    lines.forEach((l, i) => {
      line('  ' + l)
      if (i > 0) line(paint.dim('       ' + wrap(shown[i - 1].recommendation.reason, 100, '       ')))
    })
  }
  if (skills.length > shown.length) line(paint.dim('  ' + fmt(skills.length - shown.length) + ' more in the JSON or HTML report.'))

  // HEAVIEST DESCRIPTIONS
  head('HEAVIEST DESCRIPTIONS')
  const heaviest = Array.isArray(r.heaviest) ? r.heaviest : []
  if (!heaviest.length) line('  none')
  else {
    const rows = heaviest.map((s) => [nameOf(s), fmt(s.descriptionChars) + ' chars', fmt(s.descriptionTokens || 0) + ' tokens', uses(s.calls) + (s.capped ? ', capped' : '')])
    for (const l of table(rows, [1, 2, 3])) line('  ' + l)
  }

  // THIN
  head('THIN DESCRIPTIONS')
  const thin = Array.isArray(r.thin) ? r.thin : []
  if (!thin.length) line('  none')
  else for (const s of thin) line('  ' + nameOf(s) + paint.dim('  ' + fmt(s.descriptionChars) + ' chars: ' + short(s.description, 60)))

  // NEVER CALLED
  head('NEVER CALLED')
  const neverPassive = skills.filter((s) => s.calls === 0 && s.mode !== 'active').map(nameOf)
  const neverActive = skills.filter((s) => s.calls === 0 && s.mode === 'active').map(nameOf)
  line('  Described on every message (' + fmt(neverPassive.length) + '):')
  line('    ' + wrap(neverPassive.length ? neverPassive.join(', ') : 'none', 100, '    '))
  line('  Already start only when you type their name (' + fmt(neverActive.length) + '):')
  line('    ' + wrap(neverActive.length ? neverActive.join(', ') : 'none', 100, '    '))

  // CALLED
  head('CALLED')
  const called = skills.filter((s) => s.calls > 0).sort((a, b) => b.calls - a.calls || (nameOf(a) < nameOf(b) ? -1 : 1))
  if (!called.length) line('  none in the sessions read')
  else {
    const rows = called.map((s) => [nameOf(s), fmt(s.calls), fmt(s.passiveCalls), fmt(s.activeCalls), s.lastSeen || '', s.mode === 'active' ? 'starts only when you type it' : ''])
    for (const l of table([['skill', 'uses', 'agent picked', 'you typed', 'last seen', ''], ...rows], [1, 2, 3])) line('  ' + l)
  }

  // ON DISK, NOT LISTED
  head('ON DISK, NOT LISTED')
  const notLoaded = Array.isArray(r.notLoaded) ? r.notLoaded : []
  if (!notLoaded.length) line('  every skill found on disk is in the listing')
  else {
    line(paint.dim('  these cost nothing per message: Claude Code does not put them in the listing from this folder. Grouped by why.'))
    const byReason = new Map()
    for (const n of notLoaded) { const a = byReason.get(n.reason) || []; a.push(n); byReason.set(n.reason, a) }
    for (const [reason, list] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
      line('  ' + fmt(list.length) + '  ' + reason)
      const names = list.map((n) => n.name + (n.calls ? ' (' + uses(n.calls) + ')' : ''))
      line(paint.dim('     ' + wrap(names.join(', '), 100, '     ')))
    }
  }

  // UNMATCHED
  head('UNMATCHED')
  const un = Array.isArray(r.unmatchedCalls) ? r.unmatchedCalls : []
  if (!un.length) line('  every recorded skill call matched an installed skill')
  else {
    line(paint.dim('  calls in the transcripts that match no skill on disk today: removed, renamed, a plugin no longer present, or a skill built into Claude Code itself'))
    for (const u of un) line('  ' + u.skill + paint.dim('  ' + uses(u.calls)))
  }

  line()
  return out.join('\n') + '\n'
}

/* ------------------------------------------------------------------ helpers */

function painter (color) {
  const wrapIn = (code) => (s) => color ? code + s + ANSI.reset : String(s)
  const p = {
    bold: wrapIn(ANSI.bold),
    dim: wrapIn(ANSI.dim),
    red: wrapIn(ANSI.red),
    green: wrapIn(ANSI.green),
    yellow: wrapIn(ANSI.yellow),
    cyan: wrapIn(ANSI.cyan),
  }
  p.action = (a) => {
    if (a === 'delete') return p.red(a)
    if (a === 'active' || a === 'optimize') return p.yellow(a)
    if (a === 'keep') return p.green(a)
    return p.cyan(a)
  }
  return p
}

function describeBudget (b) {
  if (!b || !b.contextWindow) return 'Claude Code default'
  if (b.source === 'SLASH_COMMAND_TOOL_CHAR_BUDGET') return 'fixed by SLASH_COMMAND_TOOL_CHAR_BUDGET'
  return trimNum((b.fraction || 0) * 100) + ' percent of a ' + fmt(b.contextWindow) + ' token window, ' + (b.windowSource || 'detected')
}

function actionLabel (k) {
  return { active: 'to gate (active)', delete: 'to delete', optimize: 'to rewrite (optimize)', review: 'to review', keep: 'to keep', passive: 'to open up (passive)' }[k] || k
}

function baseName (s) { return (Array.isArray(s.names) && s.names[0]) || s.name || '' }

function uses (n) { return fmt(n) + (Number(n) === 1 ? ' use' : ' uses') }

function trimNum (n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return String(+v.toFixed(2))
}

function pct (v) {
  const n = Number(v) || 0
  return (n * 100 < 0.1 && n > 0 ? '<0.1' : trimNum(n * 100)) + ' percent'
}

function short (s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 3) + '...' : t
}

function padEnd (s, n) { return String(s) + ' '.repeat(Math.max(0, n - visibleLength(s))) }
function padStart (s, n) { return ' '.repeat(Math.max(0, n - visibleLength(s))) + String(s) }
function visibleLength (s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').length }

/** Column aligned rows. `rightCols` are right aligned. */
function table (rows, rightCols = []) {
  const widths = []
  for (const row of rows) row.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, visibleLength(c)) })
  return rows.map((row) => row.map((c, i) => rightCols.includes(i) ? padStart(c, widths[i]) : padEnd(c, widths[i])).join('  ').replace(/\s+$/, ''))
}

function wrap (text, width, indent) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > width) { lines.push(cur); cur = w } else cur = cur ? cur + ' ' + w : w
  }
  if (cur) lines.push(cur)
  return lines.map((l, i) => (i === 0 ? '' : indent) + l).join('\n')
}
