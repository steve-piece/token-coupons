// A realistic synthetic Report, in the exact shape docs/architecture.md
// describes, so the HTML renderer can be built and tested without touching a
// real machine. Twelve skills cover every recommendation action and every flag,
// four models are priced, one of them was actually seen in the transcripts, and
// one recorded call matches no installed skill.
//
// Everything derived (listing cost, overflow, impact, rank, economics, dollars)
// is computed here with the same formulas the contract states, so the fixture
// stays internally consistent instead of drifting from hand typed numbers.

const CHARS_PER_TOKEN = 4
const PER_ENTRY_CAP = 1536
const BUDGET_CHARS = 3000
const HOME = '/Users/example'

const THRESHOLDS = {
  thinChars: 60,
  heavyChars: 600,
  optimizeTargetChars: 350,
  staleDays: 90,
  heaviestListSize: 15,
}

const GENERATED_ON = '2026-08-15'
const SINCE = '2026-07-18'

function nameLineChars (name) { return String(name).length + 4 }
function toTokens (chars) { return Math.ceil((Number(chars) || 0) / CHARS_PER_TOKEN) }

function listingCost (descriptionChars, name, cap = PER_ENTRY_CAP) {
  const desc = Math.min(descriptionChars, cap)
  const overhead = nameLineChars(name)
  return {
    listingChars: desc + overhead,
    listingTokens: toTokens(desc + overhead),
    descriptionTokens: toTokens(desc),
    capped: descriptionChars > cap,
  }
}

function round (n, places = 6) { return +(Number(n) || 0).toFixed(places) }

// The twelve skills, before anything is derived. `action`, `reason` and
// `baseFlags` are what recommend.mjs would produce for these inputs; the
// `unroutable` and `not-editable` flags are added below from the computed
// overflow set and the editable bit, exactly as the contract says.
const BASE = [
  {
    name: 'legacy-migration-helper',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    calls: 0, activeCalls: 0, passiveCalls: 0,
    firstSeen: null, lastSeen: null,
    modifiedOn: '2025-11-04',
    gateDeclared: false, gateValue: null,
    description: 'Migrate an older project from the previous internal framework to the current one. Use when someone asks to upgrade a legacy service, port an old module, rewrite a deprecated integration, move a package off the retired build system, or bring an inherited repository up to current standards. Handles the full sweep: reading the old configuration, mapping every deprecated call to its replacement, rewriting the build files, updating the test harness, and producing a migration report for review. Also covers the rollback plan, the staged cutover, and the checklist a reviewer walks before the change is merged. Trigger on phrases like upgrade the legacy app, port this old service, get us off the old framework, modernize this repository, or fix the deprecated build.',
    action: 'delete',
    reason: 'The agent has never used this once, and nobody has touched the file in nine months. Deleting it moves the folder to a trash directory, so you can put it back.',
    baseFlags: ['never-called', 'stale'],
  },
  {
    name: 'figma-handoff',
    plugin: 'design',
    location: 'plugin-cache',
    editable: false,
    mode: 'passive',
    calls: 14, activeCalls: 2, passiveCalls: 12,
    firstSeen: '2026-07-21', lastSeen: '2026-08-13',
    modifiedOn: '2026-08-02',
    gateDeclared: false, gateValue: null,
    description: 'Turn a finished design file into working front end code, and push finished code back into the design file so the two never drift apart. Use whenever someone shares a design link, asks to build a screen from a mockup, asks to implement a component from the design system, asks to update an existing design to match what shipped, or asks whether the code and the design still agree. Reads frames, layers, variables, text styles, color styles, spacing tokens, component variants, and the naming conventions the team already uses, then writes components that reuse the existing primitives rather than inventing new ones. Covers responsive behavior at every breakpoint the design declares, dark and light variants, hover, focus, disabled and loading states, empty states, error states, and the accessible names every control needs. Also covers the reverse direction: taking a page that already exists in the product and generating the design file for it, including auto layout, spacing tokens, and a component library the designers can edit. Use for phrases like build this screen, implement this mockup, code this design, match the design, sync design and code, push this page into the design file, generate a design from this component, audit the design system, or check whether the design and the build have drifted. Works with a single frame, a whole page, a flow of several screens, or an entire design system, and it always asks which existing components to reuse before it writes anything new.',
    action: 'optimize',
    reason: 'The description is long enough that Claude Code cuts it off, so part of it is never even read. It lives inside a plugin cache folder, so the rewrite belongs in the plugin source repository, not here.',
    baseFlags: ['heavy-description', 'capped'],
  },
  {
    name: 'weekly-status-digest',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    calls: 0, activeCalls: 0, passiveCalls: 0,
    firstSeen: null, lastSeen: null,
    modifiedOn: '2026-08-03',
    gateDeclared: false, gateValue: null,
    description: 'Collect what happened across the week and write it up as a short digest for the team. Pulls closed issues, merged pull requests, shipped releases, and open blockers, groups them by project, and writes a plain summary a manager can read in a minute. Use when someone asks for a weekly update, a status roundup, a Friday summary, a sprint recap, or a short note on what moved this week and what is stuck.',
    action: 'active',
    reason: 'The agent has never picked this on its own, so its description is rent you pay every message for nothing. Switch it to manual and you keep the skill by typing its name.',
    baseFlags: ['never-called'],
  },
  {
    name: 'sell-slice',
    plugin: 'bytheslice',
    location: 'marketplace',
    editable: true,
    mode: 'passive',
    calls: 22, activeCalls: 22, passiveCalls: 0,
    firstSeen: '2026-07-19', lastSeen: '2026-08-14',
    modifiedOn: '2026-07-30',
    gateDeclared: false, gateValue: null,
    description: 'Deliver one slice of work end to end: confirm the scope, plan the build, write the code, run the checks, and stop for review before anything is merged. Use for a single focused change that should ship on its own rather than a whole feature. Run it once per slice, in a fresh conversation, so the context stays small and the review stays honest.',
    action: 'active',
    reason: 'You always start this one yourself by typing its name, and the agent has never chosen it. Switching it to manual keeps it working and stops paying for a description nobody reads.',
    baseFlags: ['summoned-only'],
  },
  {
    name: 'pdf-toolkit',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    calls: 31, activeCalls: 3, passiveCalls: 28,
    firstSeen: '2026-07-18', lastSeen: '2026-08-15',
    modifiedOn: '2026-08-09',
    gateDeclared: false, gateValue: null,
    description: 'Do anything with PDF files: read them, pull the text or the tables out, merge several into one, split one apart, rotate pages, stamp a watermark, fill in a form, encrypt or decrypt, pull out the images, or run text recognition on a scan so it becomes searchable. Use whenever a PDF file is mentioned by name, whenever someone asks to produce one, and whenever a document arrives that a person would open in a PDF reader. Handles single files and whole folders, keeps the page order, reports which pages failed, and never overwrites the original unless it is told to.',
    action: 'optimize',
    reason: 'The agent uses this one often, so keep it. The description is longer than it needs to be, and every extra sentence rides along on every message you send.',
    baseFlags: ['heavy-description'],
  },
  {
    name: 'csv-quick-stats',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    calls: 0, activeCalls: 0, passiveCalls: 0,
    firstSeen: null, lastSeen: null,
    modifiedOn: '2026-06-22',
    gateDeclared: false, gateValue: null,
    description: 'Quick stats for a CSV file.',
    action: 'optimize',
    reason: 'The description is one short line, which may be why the agent has never found it. Write a fuller description before you decide whether to keep this skill at all.',
    baseFlags: ['never-called', 'thin-description'],
  },
  {
    name: 'deploy-preview-cleanup',
    plugin: null,
    location: 'project',
    editable: true,
    mode: 'passive',
    calls: 0, activeCalls: 0, passiveCalls: 0,
    firstSeen: null, lastSeen: null,
    modifiedOn: '2026-01-27',
    gateDeclared: false, gateValue: null,
    description: 'Find preview deployments that no longer have an open pull request behind them and shut them down, then report what was removed and how much it was costing to leave running.',
    action: 'delete',
    reason: 'Never used, and the file has not changed in over six months. It moves to a trash directory, so nothing is lost if you want it back.',
    baseFlags: ['never-called', 'stale'],
  },
  {
    name: 'db-migrate-prod',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'active',
    calls: 0, activeCalls: 0, passiveCalls: 0,
    firstSeen: null, lastSeen: null,
    modifiedOn: '2026-05-11',
    gateDeclared: true, gateValue: 'true',
    description: 'Run a database migration against the production database, with a dry run first, a confirmation step, and a written rollback command for every statement it applies.',
    action: 'review',
    reason: 'This one is already set to manual, so it costs one short line and nothing more. There is nothing to save here. Decide whether you still want it around.',
    baseFlags: ['dormant-active'],
  },
  {
    name: 'release-notes',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'active',
    calls: 9, activeCalls: 9, passiveCalls: 0,
    firstSeen: '2026-07-20', lastSeen: '2026-08-12',
    modifiedOn: '2026-07-28',
    gateDeclared: true, gateValue: 'true',
    description: 'Write the release notes for a version: group the merged changes by what a user would notice, call out anything that breaks, and leave the internal cleanup at the bottom.',
    action: 'passive',
    reason: 'You reach for this every release and always have to type it yourself. Letting the agent offer it costs one short description and would save you the typing.',
    baseFlags: [],
  },
  {
    name: 'unit-test-writer',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    calls: 57, activeCalls: 2, passiveCalls: 55,
    firstSeen: '2026-07-18', lastSeen: '2026-08-15',
    modifiedOn: '2026-08-11',
    gateDeclared: false, gateValue: null,
    description: 'Write tests for code that has none: pick the cases that actually fail, cover the boundaries, keep each test readable on its own, and never assert on something the code does not promise.',
    action: 'keep',
    reason: 'The agent reaches for this constantly and the description is already short. Leave it exactly as it is.',
    baseFlags: [],
  },
  {
    name: 'email-best-practices',
    plugin: 'resend',
    location: 'marketplace',
    editable: true,
    mode: 'passive',
    calls: 6, activeCalls: 0, passiveCalls: 6,
    firstSeen: '2026-07-25', lastSeen: '2026-08-10',
    modifiedOn: '2026-07-14',
    gateDeclared: false, gateValue: null,
    description: 'Rules for sending mail that arrives: how to set up the sending domain, when to send from a subdomain, what a good reply address looks like, and the mistakes that get a whole domain blocked.',
    action: 'keep',
    reason: 'Used regularly and priced fairly. Nothing to change.',
    baseFlags: [],
  },
  {
    name: 'brand-voice',
    plugin: null,
    location: 'user',
    editable: true,
    mode: 'passive',
    calls: 3, activeCalls: 2, passiveCalls: 1,
    firstSeen: '2026-08-01', lastSeen: '2026-08-14',
    modifiedOn: '2026-08-06',
    gateDeclared: false, gateValue: null,
    description: 'How we write: short sentences, no hype, no filler openers.',
    action: 'keep',
    reason: 'Short, used, and the agent has picked it on its own. Leave it alone.',
    baseFlags: [],
  },
]

const MODELS = [
  {
    id: 'claude-opus-5', label: 'Claude Opus 5', vendor: 'Anthropic', tier: 'frontier',
    input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25,
    seenInTranscripts: true, source: 'https://www.anthropic.com/pricing',
  },
  {
    id: 'claude-sonnet-5', label: 'Claude Sonnet 5', vendor: 'Anthropic', tier: 'mid',
    input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15,
    seenInTranscripts: false, source: 'https://www.anthropic.com/pricing',
  },
  {
    id: 'gpt-5.2', label: 'GPT 5.2', vendor: 'OpenAI', tier: 'frontier',
    input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14,
    seenInTranscripts: false, source: 'https://openai.com/api/pricing',
  },
  {
    id: 'gemini-3-pro', label: 'Gemini 3 Pro', vendor: 'Google', tier: 'frontier',
    input: 2.5, cachedInput: 0.625, cacheWrite: null, output: 15,
    seenInTranscripts: false, source: 'https://ai.google.dev/pricing',
  },
]

const STATS = {
  measured: true,
  sessions: 84,
  days: 28,
  firstSession: '2026-07-18',
  sessionsPerDay: 3,
  sessionsPerWeek: 21,
  apiCallsPerSessionMedian: 38,
  apiCallsPerSessionMean: 44.2,
  apiCallsTotal: 3713,
  inputTokensTotal: 334000000,
  inputTokensPerWeek: 83500000,
  cacheReadShare: 0.931,
  cacheWriteShare: 0.049,
  modelsSeen: [{ model: 'claude-opus-5', apiCalls: 3713 }],
  note: 'measured from session transcripts',
}

/** The Report the HTML renderer is built against. A fresh object every call. */
export function sampleReport () {
  const budget = {
    chars: BUDGET_CHARS,
    tokens: Math.round(BUDGET_CHARS / CHARS_PER_TOKEN),
    perEntryCap: PER_ENTRY_CAP,
    contextWindow: 200000,
    windowSource: '.claude/settings.json model=claude-opus-5',
    fraction: 0.01,
    source: 'SLASH_COMMAND_TOOL_CHAR_BUDGET',
  }

  const rows = BASE.map((b) => {
    const invocable = b.plugin ? b.plugin + ':' + b.name : b.name
    const names = [invocable, b.name].filter((v, i, a) => a.indexOf(v) === i)
    const realPath = realPathFor(b)
    const cost = listingCost(b.description.length, names[0], budget.perEntryCap)
    return Object.assign({}, b, cost, {
      names,
      frontmatterName: b.name,
      realPath,
      path: tilde(realPath),
      skillMd: realPath + '/SKILL.md',
      aliases: [realPath],
      symlinks: b.location === 'user-symlink' ? [HOME + '/.claude/skills/' + b.name] : [],
      descriptionChars: b.description.length,
    })
  })

  // Overflow, simulated the way the client sheds descriptions: least invoked
  // first, longest first as the tiebreak, until the passive listing fits.
  const passive = rows.filter((r) => r.mode === 'passive')
  const spend = passive.reduce((n, r) => n + r.listingChars, 0)
  const shedOrder = passive.slice().sort((a, b) => a.calls - b.calls || b.listingChars - a.listingChars)
  const overflow = []
  let running = spend
  for (const r of shedOrder) {
    if (running <= budget.chars) break
    overflow.push(r)
    running -= r.listingChars - nameLineChars(r.names[0])
  }
  const unroutableNames = overflow.map((r) => r.names[0])

  for (const r of rows) {
    const flags = r.baseFlags.slice()
    if (unroutableNames.includes(r.names[0])) flags.push('unroutable')
    if (!r.editable) flags.push('not-editable')
    r.recommendation = {
      action: r.action,
      reason: r.reason,
      flags,
      impactTokensPerCall: impactOf(r),
      rank: 0,
    }
    delete r.action
    delete r.reason
    delete r.baseFlags
  }

  rows.sort((a, b) =>
    b.recommendation.impactTokensPerCall - a.recommendation.impactTokensPerCall ||
    b.descriptionTokens - a.descriptionTokens ||
    a.names[0].localeCompare(b.names[0]))
  rows.forEach((r, i) => { r.recommendation.rank = i + 1 })

  const deadWeight = passive.filter((r) => r.calls === 0)
  const deadChars = deadWeight.reduce((n, r) => n + r.listingChars, 0)
  const summonedOnly = passive.filter((r) => r.calls > 0 && r.passiveCalls === 0 && r.activeCalls > 0)
  const summonedChars = summonedOnly.reduce((n, r) => n + r.listingChars, 0)
  const activeNow = rows.filter((r) => r.mode === 'active')
  const activeChars = activeNow.reduce((n, r) => n + nameLineChars(r.names[0]), 0)
  const gatedNameLines = [...deadWeight, ...summonedOnly].reduce((n, r) => n + nameLineChars(r.names[0]), 0)
  const savedChars = deadChars + summonedChars - gatedNameLines
  const wastedTokens = toTokens(deadChars + summonedChars)
  const listingTokens = toTokens(spend + activeChars)

  const economics = {
    budget,
    perSession: {
      passiveListingChars: spend,
      passiveListingTokens: toTokens(spend),
      activeListingChars: activeChars,
      activeListingTokens: toTokens(activeChars),
      totalListingTokens: listingTokens,
      overBudgetBy: Math.max(0, spend - budget.chars),
      overBudgetRatio: +(spend / budget.chars).toFixed(2),
      fitsBudget: spend <= budget.chars,
    },
    neverCalledPassive: {
      count: deadWeight.length,
      names: deadWeight.map((r) => r.names[0]),
      chars: deadChars,
      tokens: toTokens(deadChars),
      note: 'in the listing every session, never once chosen by the router',
    },
    overflowUnroutable: {
      count: overflow.length,
      names: unroutableNames,
      note: 'listed by name only: the client drops descriptions least-invoked first when the budget overflows, so these cannot be routed to and no error says so',
    },
    summonedOnlyPassive: {
      count: summonedOnly.length,
      names: summonedOnly.map((r) => r.names[0]),
      chars: summonedChars,
      tokens: toTokens(summonedChars),
      note: 'always summoned by slash, never chosen by the router, yet declared passive and paying routing rent',
    },
    wastedPerCall: {
      chars: deadChars + summonedChars,
      tokens: wastedTokens,
      count: deadWeight.length + summonedOnly.length,
    },
    ifGated: {
      charsAfter: spend - savedChars,
      tokensAfter: toTokens(spend - savedChars),
      savedChars,
      savedTokensPerSession: toTokens(savedChars),
      fitsBudgetAfter: (spend - savedChars) <= budget.chars,
      count: deadWeight.length + summonedOnly.length,
    },
  }

  const cost = buildCost({ wastedTokens, listingTokens })

  const counts = { active: 0, delete: 0, optimize: 0, review: 0, keep: 0, passive: 0 }
  for (const r of rows) counts[r.recommendation.action] = (counts[r.recommendation.action] || 0) + 1

  const yours = cost.perModel.find((m) => m.seenInTranscripts) || cost.perModel[0]
  // gating leaves the name line behind, so the saving is a share of the waste
  const savedShare = wastedTokens > 0 ? Math.min(1, economics.ifGated.savedTokensPerSession / wastedTokens) : 0
  // one rate for every row, the way report.mjs derives it
  const rate = yours && wastedTokens > 0 ? yours.wasted.perMonth / wastedTokens : null
  if (rate !== null) for (const r of rows) r.dollarsPerMonth = round(r.listingTokens * rate, 4)

  return {
    version: 1,
    tool: { name: 'token-coupons', version: '0.1.0' },
    generatedOn: GENERATED_ON,
    since: SINCE,
    budget,
    totals: {
      skills: rows.length,
      declaredActive: activeNow.length,
      declaredPassive: passive.length,
      gateDeclaredAnywhere: rows.filter((r) => r.gateDeclared).length,
      transcriptsRead: STATS.sessions,
      callsTotal: 145,
      callsMatched: rows.reduce((n, r) => n + r.calls, 0),
      calledSkills: rows.filter((r) => r.calls > 0).length,
      neverCalled: rows.filter((r) => r.calls === 0).length,
      neverCalledActive: activeNow.filter((r) => r.calls === 0).length,
      neverCalledPassive: deadWeight.length,
    },
    economics,
    stats: STATS,
    cost,
    skills: rows,
    heaviest: passive.slice()
      .sort((a, b) => b.descriptionChars - a.descriptionChars)
      .slice(0, THRESHOLDS.heaviestListSize),
    thin: rows.filter((r) => r.recommendation.flags.includes('thin-description')),
    unmatchedCalls: [{ skill: 'legacy-cleanup', calls: 3 }],
    thresholds: THRESHOLDS,
    summary: {
      skills: rows.length,
      listingTokensPerCall: listingTokens,
      overBudgetRatio: economics.perSession.overBudgetRatio,
      neverCalledPassive: deadWeight.length,
      unroutable: overflow.length,
      summonedOnly: summonedOnly.length,
      wastedTokensPerCall: wastedTokens,
      savedTokensPerCallIfApplied: economics.ifGated.savedTokensPerSession,
      fitsAfter: economics.ifGated.fitsBudgetAfter,
      wastedPerWeekOnYourModel: yours ? { model: yours.label, dollars: yours.wasted.perWeek, dollarsPerMonth: yours.wasted.perMonth } : null,
      savedOnYourModel: yours
        ? {
            model: yours.label,
            dollars: round(yours.wasted.perWeek * savedShare),
            dollarsPerMonth: round(yours.wasted.perMonth * savedShare),
            tokens: economics.ifGated.savedTokensPerSession,
          }
        : null,
      recommendedActions: counts,
    },
  }
}

function impactOf (r) {
  const nameTokens = Math.ceil(nameLineChars(r.names[0]) / CHARS_PER_TOKEN)
  const a = r.action
  if (a === 'active' || a === 'delete') return Math.max(0, r.listingTokens - nameTokens)
  if (a === 'optimize') {
    return Math.max(0, r.listingTokens - Math.ceil((THRESHOLDS.optimizeTargetChars + nameLineChars(r.names[0])) / CHARS_PER_TOKEN))
  }
  return 0
}

function buildCost ({ wastedTokens, listingTokens }) {
  const calls = STATS.apiCallsPerSessionMedian
  const perWeek = STATS.sessionsPerWeek
  const perDay = STATS.sessionsPerDay

  const perModel = MODELS.map((m) => {
    const first = m.cacheWrite === null ? m.input : m.cacheWrite
    const cachedChat = (tokens) => tokens * (first + m.cachedInput * (calls - 1)) / 1e6
    const uncachedChat = (tokens) => tokens * m.input * calls / 1e6
    return {
      id: m.id,
      label: m.label,
      vendor: m.vendor,
      tier: m.tier,
      seenInTranscripts: m.seenInTranscripts,
      source: m.source,
      listing: {
        perCall: round(listingTokens * m.cachedInput / 1e6),
        perChat: round(cachedChat(listingTokens)),
        perDay: round(cachedChat(listingTokens) * perDay),
        perWeek: round(cachedChat(listingTokens) * perWeek),
        perMonth: round(cachedChat(listingTokens) * perWeek * (52 / 12)),
      },
      wasted: {
        perCall: round(wastedTokens * m.cachedInput / 1e6),
        perChat: round(cachedChat(wastedTokens)),
        perDay: round(cachedChat(wastedTokens) * perDay),
        perWeek: round(cachedChat(wastedTokens) * perWeek),
        perMonth: round(cachedChat(wastedTokens) * perWeek * (52 / 12)),
      },
      uncached: {
        wastedPerChat: round(uncachedChat(wastedTokens)),
        wastedPerWeek: round(uncachedChat(wastedTokens) * perWeek),
        wastedPerMonth: round(uncachedChat(wastedTokens) * perWeek * (52 / 12)),
      },
    }
  })

  const listingTokensPerWeek = listingTokens * calls * perWeek
  const wastedTokensPerWeek = wastedTokens * calls * perWeek
  const listingTokensPerMonth = listingTokensPerWeek * (52 / 12)
  const wastedTokensPerMonth = wastedTokensPerWeek * (52 / 12)

  return {
    assumptions: {
      apiCallsPerSession: calls,
      sessionsPerDay: perDay,
      sessionsPerWeek: perWeek,
      measured: true,
      cached: true,
      note: 'API calls per chat and chats per week are the medians measured from your own session transcripts',
    },
    perModel,
    volume: {
      listingTokensPerWeek,
      wastedTokensPerWeek,
      listingTokensPerMonth,
      wastedTokensPerMonth,
      inputTokensPerWeek: STATS.inputTokensPerWeek,
      listingShareOfInput: round(listingTokensPerWeek / STATS.inputTokensPerWeek),
      wastedShareOfInput: round(wastedTokensPerWeek / STATS.inputTokensPerWeek),
    },
    pricingVerifiedOn: '2026-08-01',
    pricingStale: false,
  }
}

function realPathFor (b) {
  if (b.location === 'plugin-cache') {
    return HOME + '/.claude/plugins/cache/' + (b.plugin || 'mp') + '/' + (b.plugin || 'plug') + '/1.4.0/skills/' + b.name
  }
  if (b.location === 'marketplace') {
    return HOME + '/.claude/plugins/marketplaces/' + (b.plugin || 'mp') + '/skills/' + b.name
  }
  if (b.location === 'project') return HOME + '/Projects/checkout-service/.claude/skills/' + b.name
  if (b.location === 'agents-dir') return HOME + '/.agents/skills/' + b.name
  if (b.location === 'cursor') return HOME + '/.cursor/skills/' + b.name
  return HOME + '/.claude/skills/' + b.name
}

function tilde (p) { return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p }
