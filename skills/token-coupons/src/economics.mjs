// Listing economics: the numbers that turn "you have a lot of skills" into
// "this is what it costs and what is silently broken". Everything is per
// session, because the listing is paid on every API call of every session.

import { listingCost, nameLineChars, CHARS_PER_TOKEN } from './budget.mjs'

/**
 * The share of a skill's uses that have to be you typing its name before it
 * counts as "started by you". Four in five, not all of them.
 *
 * It used to be all of them: one pick by the agent in forty uses and a skill
 * stopped counting, however plainly it was a command you run by hand. At four
 * in five the rule also demands evidence by itself: a skill the agent picked
 * once needs four typed uses beside that pick before it qualifies.
 */
export const DEFAULT_TYPED_SHARE = 0.8

/**
 * True when a skill has been used, and you typed its name for at least `share`
 * of those uses. The one test both the economics and the recommendations use,
 * so the count and the rows it comes from can never disagree.
 */
export function isMostlyTyped (row, share = DEFAULT_TYPED_SHARE) {
  const calls = Number(row && row.calls) || 0
  const typed = Number(row && row.commandCalls) || 0
  if (calls <= 0 || typed <= 0) return false
  const floor = Number(share)

  return typed / calls >= (floor > 0 && floor <= 1 ? floor : DEFAULT_TYPED_SHARE)
}

/**
 * @param rows   skills joined with call counts: needs mode, names, descriptionChars,
 *               calls, commandCalls, contextCalls
 * @param budget from listingBudget()
 * @param opts   { typedShare } the share of uses that must be typed (default 0.8)
 */
export function economics (rows, budget, { typedShare = DEFAULT_TYPED_SHARE } = {}) {
  const context = rows.filter((r) => r.mode === 'context')
  const costed = context.map((r) => Object.assign({}, r, listingCost(r.descriptionChars, r.names[0], budget.perEntryCap)))
  const spend = costed.reduce((n, r) => n + r.chars, 0)

  // 1. Never called, yet in the listing every session.
  const deadWeight = costed.filter((r) => r.calls === 0)
  const deadChars = deadWeight.reduce((n, r) => n + r.chars, 0)

  // 2. Overflow: the client drops descriptions least-invoked first. Simulate
  //    that ordering (calls ascending, then longest first as tiebreak, since a
  //    long never-called entry is the cheapest to shed) until spend fits.
  const shedOrder = costed.slice().sort((a, b) => a.calls - b.calls || b.chars - a.chars)
  const overflow = []
  let running = spend
  for (const r of shedOrder) {
    if (running <= budget.chars) break
    overflow.push(r)
    running -= r.chars - nameLineChars(r.names[0]) // name line survives, description goes
  }

  // 3. Started by you: reached by typing the name at least `typedShare` of the
  //    time (four uses in five by default), yet declared a context skill and
  //    paying to be picked. The key is still called summonedOnly, from when the
  //    bar was every use; run records and the summary carry that name.
  const summonedOnly = costed.filter((r) => isMostlyTyped(r, typedShare))
  const summonedChars = summonedOnly.reduce((n, r) => n + r.chars, 0)

  const commandNow = rows.filter((r) => r.mode === 'command')
  const commandCost = commandNow.reduce((n, r) => n + nameLineChars(r.names[0]), 0)

  const gatedCount = deadWeight.length + summonedOnly.length
  const gatedNameLines = [...deadWeight, ...summonedOnly].reduce((n, r) => n + nameLineChars(r.names[0]), 0)
  const savedChars = deadChars + summonedChars - gatedNameLines

  return {
    budget,
    perSession: {
      contextListingChars: spend,
      contextListingTokens: Math.ceil(spend / CHARS_PER_TOKEN),
      commandListingChars: commandCost,
      commandListingTokens: Math.ceil(commandCost / CHARS_PER_TOKEN),
      totalListingTokens: Math.ceil((spend + commandCost) / CHARS_PER_TOKEN),
      overBudgetBy: Math.max(0, spend - budget.chars),
      overBudgetRatio: budget.chars ? +(spend / budget.chars).toFixed(2) : null,
      fitsBudget: spend <= budget.chars,
    },
    neverCalledContext: {
      count: deadWeight.length,
      names: deadWeight.map((r) => r.names[0]),
      chars: deadChars,
      tokens: Math.ceil(deadChars / CHARS_PER_TOKEN),
      note: 'in the listing every session, never once chosen by the router',
    },
    overflowUnroutable: {
      count: overflow.length,
      names: overflow.map((r) => r.names[0]),
      note: overflow.length
        ? 'listed by name only: Claude Code drops descriptions least-invoked first when the budget overflows, so these cannot be routed to and no error says so'
        : 'the context listing fits the budget, nothing is being dropped',
    },
    summonedOnlyContext: {
      count: summonedOnly.length,
      names: summonedOnly.map((r) => r.names[0]),
      chars: summonedChars,
      tokens: Math.ceil(summonedChars / CHARS_PER_TOKEN),
      share: typedShare,
      note: 'started by you typing its name at least ' + Math.round(typedShare * 100) + ' percent of the time, yet declared a context skill and paying to be picked',
    },
    // Waste: tokens spent every API call on descriptions the router has never
    // used, or used so rarely that typing the name is how the skill really
    // gets started. This is the number the cost model prices.
    wastedPerCall: {
      chars: deadChars + summonedChars,
      tokens: Math.ceil((deadChars + summonedChars) / CHARS_PER_TOKEN),
      count: gatedCount,
    },
    ifGated: {
      charsAfter: spend - savedChars,
      tokensAfter: Math.ceil((spend - savedChars) / CHARS_PER_TOKEN),
      savedChars,
      savedTokensPerSession: Math.ceil(savedChars / CHARS_PER_TOKEN),
      fitsBudgetAfter: (spend - savedChars) <= budget.chars,
      count: gatedCount,
    },
  }
}

/** The actions that change what the list costs. Keep and review change nothing. */
const ACTED = new Set(['command', 'delete', 'optimize'])

/**
 * What taking the recommendations, exactly as given, gives back.
 *
 * `ifGated` above answers a different question: what if every skill nobody
 * uses were gated. The recommendations do less than that, and for a long time
 * the headline saving was the `ifGated` figure anyway, which promised tokens
 * for rows the same report said to keep; on one real machine that was 10,893
 * against the 6,420 its own rows added up to.
 *
 * So this is the sum of the rows: every row whose action is command, delete or
 * optimize contributes its own `impactTokensPerCall`, and nothing else does. A
 * person can add the column up and get the headline.
 *
 * @param rankedRows rows from recommend(), each with a recommendation
 * @param eco        the economics() result those rows were ranked with
 * @param opts       { optimizeTargetChars } the length an optimize aims for
 */
export function ifApplied (rankedRows, eco, { optimizeTargetChars = 350 } = {}) {
  const budget = (eco && eco.budget) || {}
  const spend = Number(eco && eco.perSession && eco.perSession.contextListingChars) || 0
  const byAction = { command: 0, delete: 0, optimize: 0 }
  let tokens = 0
  let chars = 0

  for (const row of Array.isArray(rankedRows) ? rankedRows : []) {
    const rec = row.recommendation || {}
    const name = (Array.isArray(row.names) && row.names[0]) || row.name || ''
    const nameLine = nameLineChars(name)
    const listingChars = Number(row.listingChars) || 0

    if (!ACTED.has(rec.action)) continue
    byAction[rec.action]++
    tokens += Number(rec.impactTokensPerCall) || 0
    // The allowance is spent by context skills only, so only they free room.
    if (row.mode !== 'command') {
      chars += rec.action === 'optimize'
        ? Math.max(0, listingChars - (optimizeTargetChars + nameLine))
        : Math.max(0, listingChars - nameLine)
    }
  }

  const charsAfter = Math.max(0, spend - chars)
  return {
    tokens,
    chars,
    count: byAction.command + byAction.delete + byAction.optimize,
    byAction,
    charsAfter,
    tokensAfter: Math.ceil(charsAfter / CHARS_PER_TOKEN),
    fitsBudgetAfter: budget.chars ? charsAfter <= budget.chars : null,
    note: 'the sum of the rows whose action is command, delete or optimize',
  }
}
