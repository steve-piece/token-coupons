# token-coupons architecture and module contract

This file is the contract every module is written against. If a shape here
changes, change it here first, then in the code, then in the tests.

## What the tool does, in one paragraph

Every session, the agent client puts a listing of every installed skill (name
plus description) into the system prompt, and every API call re-sends it. The
listing has a silent budget (Claude Code: 1 percent of the context window),
and on overflow the client drops descriptions least-invoked first, so a skill
can be installed, correct, and unreachable with no error anywhere.
`token-coupons` reads the skills on disk and the session transcripts already
on disk, and reports: what the listing costs, which skills the agent has never
read, what that waste costs in dollars per chat and per week on current
models, and a ranked recommendation per skill (keep, active, optimize, delete).
The HTML report lets a person mark decisions; `apply` carries them out.

## House rules (non-negotiable)

- Zero runtime dependencies. `node:test` for tests. Node 20 or newer.
- No em dashes or en dashes anywhere: not in code, comments, strings, docs,
  README, or the HTML. The seven forbidden code points are U+2010 to U+2015
  and U+2212. `node tests/dash-scan.mjs` fails the build if one appears.
- Every module reads roots through `src/paths.mjs` so tests can point the
  whole tool at a fixture with `TOKEN_COUPONS_HOME=<dir>`.
- Reads local files only. No network, ever. Pricing is a data file with a
  verified-on date; refreshing it is a human or agent action, not a fetch.
- Nothing `apply` does is unrecoverable: deletes move to a trash directory,
  symlinks are unlinked not followed, and plugin cache paths are refused.
- The report is honest about what is measured versus assumed. Every number
  that rests on an assumption carries a `note` or an `assumed: true` flag.

## Module map

```
bin/token-coupons.mjs      CLI: report (default) | apply | pricing | help
src/paths.mjs              homeDir(), claudeDir(), projectsDir(), pluginsDir(), trashDir(), tildify()
src/lib/util.mjs           readText, readJson, listDir, isDir, isSymlink, safeReal, walk,
                           parseFrontmatter (block scalars ok), setFrontmatterKey, fmt, money
src/budget.mjs             CHARS_PER_TOKEN=4, detectContextWindow, listingBudget, listingCost, nameLineChars, toTokens
src/discover.mjs           discoverSkills() -> Skill[]   (see shape below)
src/calls.mjs              scanTranscripts(since) -> {calls: Call[], sessions: Session[]}, sessionStats(sessions, {since, today})
src/economics.mjs          economics(rows, budget) -> Economics
src/recommend.mjs          recommend(rows, {economics, budget, thresholds}) -> {rows: RankedRow[], heaviest, thin, thresholds}
src/pricing.mjs            loadPricing(path?) -> Pricing, costModel({wastedTokens, listingTokens, stats, pricing, cached}) -> Cost
src/report.mjs             buildReport(opts) -> Report   (joins everything above)
src/render-text.mjs        renderText(report, {color}) -> string
src/render-html.mjs        renderHtml(report) -> string  (self-contained, theme aware, interactive)
src/apply.mjs              planApply(decisions, {skills}) -> Plan ; applyPlan(plan, {yes, trashDir}) -> Result
data/pricing.json          the price table (shape below)
skills/token-coupons/      the Agent Skill that drives the loop (SKILL.md, references/, evals/)
tests/*.test.mjs           node:test, one file per module, fixture built under a temp TOKEN_COUPONS_HOME
tests/helpers.mjs          makeFixtureHome({skills, transcripts, settings}) -> {home, cleanup}
tests/dash-scan.mjs        fails on any forbidden dash in the repo
```

## Shapes

### Skill (from discover.mjs)

```js
{
  name: 'plugin-audit',                 // directory name
  names: ['bytheslice:plugin-audit', 'plugin-audit'],  // invocable names, first is canonical
  frontmatterName: 'plugin-audit',
  realPath: '/abs/real/path',
  skillMd: '/abs/real/path/SKILL.md',
  aliases: ['/every/path/that/reached/it'],
  symlinks: ['~/.claude/skills/x'],     // aliases that are symlinks in ~/.claude/skills
  plugin: 'bytheslice' | null,
  location: 'user' | 'user-symlink' | 'project' | 'marketplace' | 'plugin-cache' | 'agents-dir' | 'cursor' | 'other',
  editable: true | false,               // false only for plugin-cache
  mode: 'passive' | 'active',           // active iff disable-model-invocation is true; absent = passive
  gateDeclared: bool, gateValue: 'true' | 'false' | null,
  description: '...', descriptionChars: 412,
  modifiedOn: 'YYYY-MM-DD' | null,
}
```

### Row (Skill joined with calls, produced in report.mjs)

Skill plus: `calls, activeCalls, passiveCalls, firstSeen, lastSeen`
(YYYY-MM-DD or null), and `listingChars, listingTokens, descriptionTokens,
capped` from `listingCost`.

### RankedRow (from recommend.mjs)

Row plus:

```js
recommendation: {
  action: 'keep' | 'active' | 'passive' | 'optimize' | 'delete' | 'review',
  reason: 'one plain sentence a newcomer understands',
  flags: ['never-called', 'summoned-only', 'heavy-description', 'thin-description', 'capped', 'unroutable', 'dormant-active', 'not-editable', 'stale'],
  impactTokensPerCall: 118,      // tokens saved per API call if the action is taken (0 for keep)
  rank: 1,                       // 1 = most impactful
}
```

Rules, in priority order (first match wins; flags accumulate regardless):

1. `mode === 'active'` and `calls === 0`: action `review`, flag `dormant-active`. Costs one line; nothing to save; the person decides whether it still exists for a reason.
2. `mode === 'passive'`, `calls === 0`, `descriptionChars < thresholds.thinChars`: action `optimize`, flags `never-called`, `thin-description`. The description may be too thin to route to; rewrite before deciding anything else. (The thin flag is only meaningful when the invocation count is zero. A thin description that gets routed to is fine.)
3. `mode === 'passive'`, `calls === 0`, `location` in `user`, `user-symlink`, `project`, and `modifiedOn` older than `thresholds.staleDays`: action `delete`, flags `never-called`, `stale`. Alternative offered in the UI: `active`.
4. `mode === 'passive'`, `calls === 0`: action `active`, flag `never-called`.
5. `mode === 'passive'`, `calls > 0`, `passiveCalls === 0`: action `active`, flag `summoned-only`.
6. `mode === 'passive'`, `passiveCalls > 0`, (`descriptionChars > thresholds.heavyChars` or `capped`): action `optimize`, flag `heavy-description` (and `capped` when over the per-entry cap).
7. otherwise `keep`.

Extra flags: `unroutable` if the name is in `economics.overflowUnroutable.names`; `not-editable` if `editable === false` (the reason must then say the fix belongs in the plugin's source repo).

`impactTokensPerCall`: for `active` and `delete`, `listingTokens - ceil(nameLineChars/4)`; for `optimize`, `max(0, listingTokens - ceil((thresholds.optimizeTargetChars + nameLineChars)/4))`; for `review` and `keep`, 0. Sort by impact desc, then descriptionTokens desc, then name.

Default thresholds (exported, overridable): `thinChars: 60`, `heavyChars: 600`,
`optimizeTargetChars: 350`, `staleDays: 90`, `heaviestListSize: 15`.

`heaviest`: top `heaviestListSize` passive rows by `descriptionChars`, each with
`calls` shown, regardless of recommendation. `thin`: every row carrying
`thin-description`.

### Session and stats (from calls.mjs)

```js
Session: { id, project, firstTs, lastTs, apiCalls, models: {model: n}, inputTokens, cacheReadTokens, cacheWriteTokens, uncachedInputTokens, outputTokens, skillCalls }
Stats:   { measured, sessions, days, firstSession, sessionsPerDay, sessionsPerWeek, apiCallsPerSessionMedian, apiCallsPerSessionMean, apiCallsTotal, inputTokensTotal, inputTokensPerWeek, cacheReadShare, cacheWriteShare, modelsSeen: [{model, apiCalls}], note }
```

`apiCalls` counts distinct `requestId` per transcript (one response is stored
as several lines). Synthetic messages are skipped. Subagent transcripts are not
read; everything is a lower bound.

### Pricing (data/pricing.json)

```json
{
  "currency": "USD",
  "per": 1000000,
  "verifiedOn": "YYYY-MM-DD",
  "models": [
    {
      "id": "claude-opus-5",            // must match transcript model ids where possible
      "vendor": "Anthropic",
      "label": "Claude Opus 5",
      "input": 5.00,                     // per 1M input tokens, uncached
      "cachedInput": 0.50,               // per 1M cache read tokens
      "cacheWrite": 6.25,                // per 1M cache creation tokens (null if the vendor has no separate rate)
      "output": 25.00,
      "contextWindow": 1000000,
      "tier": "frontier" | "mid" | "small",
      "source": "https://...pricing page...",
      "notes": "optional plain sentence"
    }
  ]
}
```

At least these ids: `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`,
`claude-opus-4-8` (seen in this machine's transcripts), plus the current top
OpenAI and Google models. Prices are data, never code. `loadPricing()` returns
`{...pricing, stale: bool, ageDays}` where stale is true past 60 days.

### Cost (from pricing.mjs)

```js
costModel({ wastedTokens, listingTokens, stats, pricing, cached = true }) -> {
  assumptions: { apiCallsPerSession, sessionsPerDay, sessionsPerWeek, measured, cached, note },
  perModel: [{
    id, label, vendor, tier, seenInTranscripts: bool,
    listing: { perCall, perChat, perDay, perWeek },   // dollars, listing as a whole
    wasted:  { perCall, perChat, perDay, perWeek },   // dollars, never-called plus summoned-only
    uncached: { wastedPerChat, wastedPerWeek },       // same at list price, for the honest upper bound
  }],
  volume: {
    listingTokensPerWeek, wastedTokensPerWeek,
    inputTokensPerWeek,                                // measured, all input
    listingShareOfInput, wastedShareOfInput,           // 0..1, this is the "usage limits" view
  },
  pricingVerifiedOn, pricingStale
}
```

Cached math per chat: `tokens * (cacheWrite * 1 + cachedInput * (calls - 1)) / 1e6`
(the first call of a session writes the cache, every later call reads it).
When `cacheWrite` is null use `input` for the first call. Uncached:
`tokens * input * calls / 1e6`. Per day and per week multiply by measured
sessions per day and per week.

### Report (from report.mjs)

```js
{
  version: 1,
  tool: { name: 'token-coupons', version },
  generatedOn: 'YYYY-MM-DD', since: 'YYYY-MM-DD' | null,
  budget, totals, economics, stats, cost,
  skills: RankedRow[],           // every skill, sorted by rank
  heaviest: RankedRow[], thin: RankedRow[],
  unmatchedCalls: [{skill, calls}],
  summary: {                     // the five lines the agent reads first
    skills, listingTokensPerCall, overBudgetRatio, neverCalledPassive, unroutable, summonedOnly,
    wastedTokensPerCall, savedTokensPerCallIfApplied, fitsAfter,
    wastedPerWeekOnYourModel: { model, dollars } | null,
    recommendedActions: { active: n, delete: n, optimize: n, review: n, keep: n }
  }
}
```

`totals` keeps the fields the old report had: `skills, declaredActive,
declaredPassive, gateDeclaredAnywhere, transcriptsRead, callsTotal,
callsMatched, calledSkills, neverCalled, neverCalledActive, neverCalledPassive`.

### Decisions file (HTML export in, apply in)

```json
{
  "version": 1,
  "generatedOn": "YYYY-MM-DD",
  "source": "token-coupons html report",
  "decisions": [
    { "name": "bytheslice:box-it-up", "path": "~/.claude/plugins/marketplaces/bytheslice/skills/box-it-up", "action": "active", "note": "" }
  ]
}
```

Actions: `keep` (no-op, omitted from plans), `active`, `passive`, `optimize`,
`delete`. `path` is matched to a discovered skill by realPath (after ~
expansion); `name` is the fallback match.

### Apply plan and result

```js
planApply(decisions, {skills}) -> {
  steps: [{ name, action, path, kind: 'set-gate' | 'unset-gate' | 'unlink' | 'trash' | 'worklist' | 'refuse' | 'noop', detail, undo }],
  worklist: [{ name, path, currentDescription, currentChars, targetChars }],  // optimize items, for the agent to rewrite
  refused: [{ name, action, reason }],   // plugin-cache deletes, unknown skills, unparseable frontmatter
}
applyPlan(plan, {yes, trashDir}) -> { applied: n, skipped: n, dryRun: bool, steps: [{...step, done: bool, error}] }
```

- `active`: `setFrontmatterKey(text, 'disable-model-invocation', 'true')`.
- `passive`: remove the key (`null`). Undo is the reverse call.
- `delete`: if the row has symlinks under `~/.claude/skills`, unlink those and leave the target (undo: `ln -s`); else if `location === 'plugin-cache'` refuse with the `claude plugin uninstall` hint; else move the real directory to `<trashDir>/<YYYYMMDD-HHMMSS>/<name>` (undo: `mv` back). Deletes also refuse when the skill directory is inside a git work tree that is not clean for that path? No: keep it simple, trash is the safety net.
- `optimize`: no file change; goes to `worklist` with `targetChars = thresholds.optimizeTargetChars`.
- Without `--yes` nothing is written; the plan is printed. With `--yes` steps run and each prints its undo line.

## CLI surface

```
token-coupons report [--since=YYYY-MM-DD] [--window=N] [--fraction=F] [--budget=CHARS]
                     [--pricing=FILE] [--uncached] [--json] [--html=FILE] [--out=FILE] [--open] [--no-color]
token-coupons apply <decisions.json> [--yes] [--trash=DIR] [--json]
token-coupons pricing [--pricing=FILE]
token-coupons help
```

`report` with no flags prints the text report. `--json` prints the Report.
`--html=FILE` writes the interactive page (and still prints the text report
unless `--json`). `--out=FILE` writes the Report JSON next to it. `--open`
opens the HTML in the default browser after writing. Exit code 0 always for
report; apply exits 1 if any step errored.

## HTML report requirements

- One file, no external assets, no fetch, no fonts from the network. Works
  opened from disk and inside a sandboxed artifact frame. Do not rely on
  `<a download>` (inert in artifact sandboxes): offer Copy to clipboard, a
  visible textarea with the JSON, and a download button that degrades quietly.
- Theme aware: light palette on `:root`, dark under
  `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
  and again under `:root[data-theme="dark"]`. Body has an explicit background.
- Sections in order: verdict header (five numbers and the savings sentence);
  cost strip (per model cards, wasted per chat and per week, cached by default
  with an uncached toggle, plus the share-of-input line for subscription users);
  recommendations table (every skill, sorted by rank, per-row action control
  Keep / Passive / Active / Optimize / Delete preselected to the recommendation,
  filters never-called / summoned-only / heavy / thin / unroutable / all, text
  search, plugin column, calls split routed and summoned, description tokens);
  heaviest descriptions list; thin descriptions list; unroutable list;
  export footer (Accept all recommendations, Reset, Copy JSON, Download,
  textarea, and the exact sentence to say to the agent next).
- Report data is embedded once as `<script type="application/json" id="report-data">`
  with `<` escaped as `<`. Everything renders from that object.
- Wide tables scroll inside their own container; the page never scrolls sideways.
- Plain language first. Every technical term gets a one-line tooltip or aside.

## Skill requirements (skills/token-coupons)

- `SKILL.md` frontmatter: `name: token-coupons`, a description that names the
  three moments it is for (audit skill cost, present the report, apply the
  decisions), and `disable-model-invocation: true` (this is an operation, run
  when asked, not something the router should fire).
- Body: the loop. 1 run report (prefer `npx token-coupons@latest`, fall back to
  `node <two dirs up>/bin/token-coupons.mjs`), 2 read `summary` and lead with
  the verdict, 3 present the HTML (publish as an artifact when that tool exists,
  otherwise open the file), 4 tell the person exactly what to do in the page
  and what to say when they return, 5 on return save the JSON, run `apply`
  without `--yes`, show the plan, run with `--yes`, 6 rewrite every `optimize`
  description per `references/description-rewrite.md`, 7 re-run report and
  show before and after.
- `references/`: `report-anatomy.md`, `decisions-file.md`,
  `description-rewrite.md`, `cost-model.md`, `listing-budget.md`. Each 40 to
  90 lines, plain language, no dashes.
- `evals/evals.json` in the agentskills.io shape with three realistic prompts.
