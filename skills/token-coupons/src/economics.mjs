// Listing economics: the numbers that turn "you have a lot of skills" into
// "this is what it costs and what is silently broken". Everything is per
// session, because the listing is paid on every API call of every session.

import { listingCost, nameLineChars, CHARS_PER_TOKEN } from './budget.mjs'

/**
 * @param rows   skills joined with call counts: needs mode, names, descriptionChars,
 *               calls, commandCalls, contextCalls
 * @param budget from listingBudget()
 */
export function economics (rows, budget) {
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

  // 3. Summoned only: the user always reaches these by slash, the router never
  //    chose them, yet they are declared context skills and pay routing rent.
  const summonedOnly = costed.filter((r) => r.calls > 0 && r.contextCalls === 0 && r.commandCalls > 0)
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
      note: 'always summoned by slash, never chosen by the router, yet declared a context skill and paying routing rent',
    },
    // Pure waste: tokens spent every API call on descriptions that have never
    // once helped the router. This is the number the cost model prices.
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
