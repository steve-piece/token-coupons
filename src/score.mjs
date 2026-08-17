// The scorecard number. One 0 to 100 figure a person can post, built from the
// three things the report already measures, weighted by how much each one
// actually costs.
//
//   earned  70  the share of listing tokens spent on skills the agent has
//               chosen at least once. This is the whole point: a description
//               is there to be read, and one that never gets read is rent.
//   fit     20  headroom against the listing allowance. Full marks at or
//               under it, nothing at twice over.
//   reach   10  skills the client is silently dropping. Full marks at none,
//               nothing at ten or more.
//
// Deliberately harsh on `earned`: a listing where most tokens buy no routing
// decision is failing at its only job, however tidy the rest looks.

export const WEIGHTS = { earned: 70, fit: 20, reach: 10 }

/**
 * Where each grade starts. Anything under the last one is an F. There is no
 * sentence attached on purpose: the card states what is actually happening,
 * built from the counts, rather than an adjective picked to match a band.
 */
export const GRADES = [
  { grade: 'A', min: 90 },
  { grade: 'B', min: 75 },
  { grade: 'C', min: 60 },
  { grade: 'D', min: 45 },
  { grade: 'F', min: 0 },
]

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0))

/**
 * @param report a Report from report.mjs
 * @returns { score, grade, parts: {earned, fit, reach}, ratios: {...}, tokens: {...} }
 */
export function scoreReport (report) {
  const r = report || {}
  const s = r.summary || {}
  const per = (r.economics && r.economics.perSession) || {}

  const listing = Number(s.listingTokensPerCall) || 0
  const wasted = Number(s.wastedTokensPerCall) || 0
  const earning = Math.max(0, listing - wasted)

  // 1. Earned: tokens that have bought at least one routing decision.
  const earnedRatio = listing > 0 ? earning / listing : 1
  // 2. Fit: 1.0 at or under the allowance, 0 at twice over.
  const over = Number(per.overBudgetRatio) || 0
  const fitRatio = over <= 1 ? 1 : clamp01(1 - (over - 1))
  // 3. Reach: every skill the client is dropping costs a tenth of this part.
  const unroutable = Number(s.unroutable) || 0
  const reachRatio = clamp01(1 - unroutable / 10)

  const parts = {
    earned: round(WEIGHTS.earned * clamp01(earnedRatio)),
    fit: round(WEIGHTS.fit * fitRatio),
    reach: round(WEIGHTS.reach * reachRatio),
  }
  const score = Math.round(parts.earned + parts.fit + parts.reach)
  const band = GRADES.find((g) => score >= g.min) || GRADES[GRADES.length - 1]

  return {
    score,
    grade: band.grade,
    parts,
    weights: WEIGHTS,
    ratios: {
      earned: round(earnedRatio, 4),
      fit: round(fitRatio, 4),
      reach: round(reachRatio, 4),
    },
    tokens: { listing, wasted, earning },
  }
}

function round (n, places = 1) { return +(Number(n) || 0).toFixed(places) }
