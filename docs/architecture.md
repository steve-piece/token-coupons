# token-coupons architecture and module contract

This file is the contract every module is written against. If a shape here
changes, change it here first, then in the code, then in the tests.

## What the tool does, in one paragraph

Every session, Claude Code puts a listing of every installed skill (name
plus description) into the system prompt, and every API call re-sends it. The
listing has a silent budget (1 percent of the context window), and on overflow
Claude Code drops descriptions least-invoked first, so a skill
can be installed, correct, and unreachable with no error anywhere.
`token-coupons` reads the skills on disk and the session transcripts already
on disk, and reports: what the listing costs, which skills the agent has never
read, what that waste costs in dollars per chat and per week on current
models, and a ranked recommendation per skill (keep, active, optimize, delete).
The HTML report lets a person mark decisions; `apply` carries them out.

Listed versus on disk: not every skill folder on the machine is in that
listing. Claude Code reads `~/.claude/skills`, the `.claude/skills` of the
project you are working in, and the skills of enabled plugins out of the plugin
cache, and those are the only folders this tool opens. Some of what it passes
on the way is still not listed: marketplace checkouts, plugin source repos,
other projects, disabled plugins and older versions left in the cache sit on
disk without reaching the listing, so they cost nothing per message. Folders
belonging to other tools are out of scope entirely. They are never scanned, so
they are not rows in the report at all, not even unlisted ones.
Every economic number, recommendation and dollar figure runs over listed skills
only; everything else is reported separately as `notLoaded`, so nobody thinks
it was missed.

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
src/discover.mjs           discoverSkills({cwd}) -> Skill[]   (Claude Code folders only, see shape below; cwd decides which project skills are listed)
src/calls.mjs              scanTranscripts(since, {cacheTtlMinutes}) -> {calls: Call[], sessions: Session[]}, sessionStats(sessions, {since, today, cacheTtlMinutes})
src/economics.mjs          economics(rows, budget) -> Economics
src/recommend.mjs          recommend(rows, {economics, budget, thresholds, today}) -> {rows: RankedRow[], heaviest, thin, thresholds, counts}
src/pricing.mjs            loadPricing(path?, {today}?) -> Pricing, costModel({wastedTokens, listingTokens, stats, pricing, cached, today}) -> Cost
src/report.mjs             buildReport(opts) -> Report   (joins everything above; opts.cwd reaches discover, opts.cacheTtlMinutes reaches calls)
src/render-text.mjs        renderText(report, {color, top}) -> string
src/render-list.mjs        renderList(report, {cardHref}) -> the dark decision list, companion to the card
src/render-html.mjs        renderHtml(report) -> the earlier light report page, no longer wired to a flag
src/score.mjs              scoreReport(report) -> {score, grade, parts, ratios, tokens}
src/render-card.mjs        renderCardSvg(report) -> svg ; renderCardPage(report) -> the postable scorecard
src/apply.mjs              planApply(decisions, {skills}) -> Plan ; applyPlan(plan, {yes, trashDir}) -> Result ; cacheNote(result) -> the re-send warning
data/pricing.json          the price table (shape below)
.claude-plugin/marketplace.json    the one plugin marketplace that points at this repo
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
  marketplace: 'bytheslice' | null,     // the cache or checkout folder the row came out of
  installKey: 'bytheslice@steve-piece' | null,   // plugin@marketplace, from installed_plugins.json
  location: 'user' | 'user-symlink' | 'project' | 'project-source' | 'marketplace' | 'plugin-cache' | 'other',
  editable: true | false,               // false only for plugin-cache
  loaded: true | false,                 // true iff Claude Code lists it from the cwd this run was given
  loadedReason: 'enabled plugin x@y',   // one plain sentence, set either way
  sourcePath: '/abs/editable/copy' | null,        // loaded plugin-cache rows whose source is on this machine
  copies: [{ path, location, sameDescription }],  // source copies folded into this row
  mode: 'passive' | 'active',           // active iff disable-model-invocation is true; absent = passive
  gateDeclared: bool, gateValue: 'true' | 'false' | null,
  description: '...', descriptionChars: 412,
  modifiedOn: 'YYYY-MM-DD' | null,
}
```

`loaded` follows Claude Code's documented rules
(code.claude.com/docs/en/skills). Loaded: `~/.claude/skills` (real folders and
symlinks, and a symlink there makes its target loaded), the `.claude/skills` of
the project `cwd` is inside, and the skills of enabled plugins read out of the
plugin cache (`~/.claude/plugins/installed_plugins.json` plus `enabledPlugins`
in settings). Not loaded: marketplace checkouts, plugin source repos under
`~/Projects` (`project-source`), another project's `.claude/skills`, disabled
plugins, and older versions left behind in the cache. `loadedReason` says which
of those it was. Folders no Claude Code install reads are not scanned, so they
produce no row either way; `classifyLocation` still carries branches for other
tools' skill folders, but no scanned root reaches them, so those values are dead
and belong out of the code.

`linkCopies()` runs last and folds a source copy into the loaded row it is the
source of: a marketplace checkout of a cached plugin skill, or a repo under
`~/Projects` carrying a `.claude-plugin/marketplace.json` for that marketplace.
The loaded row gains `sourcePath` (the copy to edit, a `~/Projects` repo
preferred over a checkout) and a `copies` entry; the folded row is dropped from
the returned list, so one plugin skill is one row.

### Row (Skill joined with calls, produced in report.mjs)

Skill plus: `calls, activeCalls, passiveCalls, firstSeen, lastSeen`
(YYYY-MM-DD or null), `listingChars, listingTokens, descriptionTokens,
capped` from `listingCost`, and `path`: `realPath` run through `tildify`, which
is the value the HTML page writes into the decisions file.

Calls attach to every row, listed or not, so a project skill used inside its own
project still shows its history. Only rows with `loaded: true` go on to
economics, recommendations, cost and `report.skills`; the rest are cut down to
the compact `notLoaded` shape (see Report below) and scored nowhere.

### RankedRow (from recommend.mjs)

Row plus:

```js
recommendation: {
  action: 'keep' | 'active' | 'passive' | 'optimize' | 'delete' | 'review',
  reason: 'short, numbers first, at most two sentences (see the style rule below)',
  flags: ['never-called', 'summoned-only', 'heavy-description', 'thin-description', 'capped', 'unroutable', 'dormant-active', 'not-editable', 'stale', 'too-new'],
  impactTokensPerCall: 118,      // tokens saved per API call if the action is taken (0 for keep)
  rank: 1,                       // 1 = most impactful
}
```

Rules, in priority order (first match wins; flags accumulate regardless):

1. `mode === 'active'` and `calls === 0`: action `review`, flag `dormant-active`. Costs one line; nothing to save; the person decides whether it still exists for a reason.
2. `mode === 'passive'`, `calls === 0`, `descriptionChars < thresholds.thinChars`: action `optimize`, flags `never-called`, `thin-description`. The description may be too thin to route to; rewrite before deciding anything else. (The thin flag is only meaningful when the invocation count is zero. A thin description that gets routed to is fine.)
3. `mode === 'passive'`, `calls === 0`, and `modifiedOn` within `thresholds.newSkillDays`: action `keep`, flag `too-new`. A skill installed days ago has had no chance to be chosen, so a zero call count is not evidence. It outranks the stale and never-called rules; a thin description still wins over it, because that is worth fixing on day one.
4. `mode === 'passive'`, `calls === 0`, `location` in `user`, `user-symlink`, `project`, and `modifiedOn` older than `thresholds.staleDays`: action `delete`, flags `never-called`, `stale`. Alternative offered in the UI: `active`.
5. `mode === 'passive'`, `calls === 0`: action `active`, flag `never-called`.
6. `mode === 'passive'`, `calls > 0`, `passiveCalls === 0`: action `active`, flag `summoned-only`.
7. `mode === 'passive'`, `passiveCalls > 0`, (`descriptionChars > thresholds.heavyChars` or `capped`): action `optimize`, flag `heavy-description` (and `capped` when over the per-entry cap).
8. otherwise `keep`.

Extra flags: `unroutable` if the name is in `economics.overflowUnroutable.names`; `not-editable` if `editable === false`.

Reason style: numbers first, at most two sentences, under 30 words. The reason
does not restate a flag, because the renderers already show `unroutable` and
`not-editable` as badges. The single exception is `not-editable`, which appends
one clause: with a `sourcePath` it says to edit the source copy because the
installed copy refreshes on the next plugin update, and without one it says the
change belongs in the plugin's own repository.

`impactTokensPerCall`: for `active` and `delete`, `listingTokens - ceil(nameLineChars/4)`; for `optimize`, `max(0, listingTokens - ceil((thresholds.optimizeTargetChars + nameLineChars)/4))`; for `review` and `keep`, 0. Sort by impact desc, then descriptionTokens desc, then name.

Default thresholds (exported, overridable): `thinChars: 60`, `heavyChars: 600`,
`optimizeTargetChars: 350`, `staleDays: 90`, `newSkillDays: 14`,
`heaviestListSize: 15`.

`heaviest`: top `heaviestListSize` passive rows by `descriptionChars`, each with
`calls` shown, regardless of recommendation. `thin`: every row carrying
`thin-description`.

### Session and stats (from calls.mjs)

```js
Session: { id, project, firstTs, lastTs, apiCalls, models: {model: n}, inputTokens, cacheReadTokens, cacheWriteTokens, uncachedInputTokens, outputTokens, skillCalls, listingWrites, cacheBreaks: {firstOfSession, modelSwitch, effortSwitch, cacheExpired} }
Stats:   { measured, sessions, days, firstSession, sessionsPerDay, sessionsPerWeek, apiCallsPerSessionMedian, apiCallsPerSessionMean, apiCallsTotal, inputTokensTotal, inputTokensPerWeek, cacheReadShare, cacheWriteShare, listingWritesPerSession, listingWritesPerSessionMedian, cacheBreaks, cacheBreaksTotal, cacheTtlMinutes, modelsSeen: [{model, apiCalls}], note }
```

`apiCalls` counts distinct `requestId` per transcript (one response is stored
as several lines). Synthetic messages are skipped. Subagent transcripts are not
read; everything is a lower bound.

`listingWrites` counts the requests that pay for the listing at the cache write
rate rather than the read rate, one per break of the cached prefix. A break is
claimed only when both signals agree: the usage shows more cache creation than
cache read (the prefix did not match), and one of four causes is present
(`firstOfSession`, `modelSwitch`, `effortSwitch`, `cacheExpired`, the last being
a gap longer than `cacheTtlMinutes`, default 60). Either signal alone is noisy.
`listingWritesPerSession` is the mean, because the mean is what reconstructs the
real total; the median is carried alongside it for reference.

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
      "cacheWrite": 10.00,               // per 1M cache creation tokens (null if the vendor has no separate rate)
      "cacheWrite5m": 6.25,              // optional, the short lived cache rate, recorded but not priced
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
OpenAI and Google models. `cacheWrite` is the one hour cache rate, because that
is what agent sessions use; `cacheWrite5m` is recorded for reference and is
never priced. Prices are data, never code. `loadPricing()` returns
`{currency, per, verifiedOn, models, stale, ageDays, path, error}` where stale
is true past 60 days, `path` is the file that was read, and `error` is a plain
sentence (or null) so a missing price list degrades to no dollar figures instead
of failing the report.

### Cost (from pricing.mjs)

```js
costModel({ wastedTokens, listingTokens, stats, pricing, cached = true }) -> {
  assumptions: { apiCallsPerSession, cacheWritesPerSession, cacheBreaks, cacheTtlMinutes,
                 sessionsPerDay, sessionsPerWeek, measured, cached, note },
  perModel: [{
    id, label, vendor, tier, source, seenInTranscripts: bool,   // source is the pricing page URL, or null
    listing: { perCall, perChat, perDay, perWeek, perMonth },   // dollars, listing as a whole (month = week * 52/12)
    wasted:  { perCall, perChat, perDay, perWeek, perMonth },   // dollars, never-called plus summoned-only
    uncached: { wastedPerChat, wastedPerWeek, wastedPerMonth }, // same at list price, for the honest upper bound
  }],
  volume: {
    listingTokensPerWeek, wastedTokensPerWeek,
    listingTokensPerMonth, wastedTokensPerMonth,       // week * 52/12
    inputTokensPerWeek,                                // measured, all input
    listingShareOfInput, wastedShareOfInput,           // 0..1, this is the "usage limits" view
  },
  pricingVerifiedOn, pricingStale
}
```

Cached math per chat:
`tokens * (cacheWrite * writes + cachedInput * (calls - writes)) / 1e6`, where
`writes` is `stats.listingWritesPerSession` clamped to at least 1 and at most
`calls`. The listing sits at the front of the cached prefix, so every break of
that prefix pays the write rate again; assuming exactly one write per chat
understates the bill. When `cacheWrite` is null use `input` for the writes.
Uncached: `tokens * input * calls / 1e6`. Per day and per week multiply by
measured sessions per day and per week.

### Report (from report.mjs)

```js
{
  version: 1,
  tool: { name: 'token-coupons', version },
  generatedOn: 'YYYY-MM-DD', since: 'YYYY-MM-DD' | null,
  budget, totals, economics, stats, cost,
  pricing: { path, verifiedOn, stale, ageDays, error, models },  // models is a count, not the list
  thresholds,                    // what recommend.mjs ran with, after any override
  skills: RankedRow[],           // every LISTED skill, sorted by rank
  heaviest: RankedRow[], thin: RankedRow[],
  notLoaded: [{ name, path, location, reason, plugin, installKey, mode,
                descriptionChars, calls, activeCalls, passiveCalls, lastSeen }],
  unmatchedCalls: [{skill, calls}],
  summary: {                     // the thirteen fields the agent reads first
    skills, notListed, listingTokensPerCall, overBudgetRatio, neverCalledPassive, unroutable, summonedOnly,
    wastedTokensPerCall, savedTokensPerCallIfApplied, fitsAfter,
    wastedPerWeekOnYourModel: { model, dollars, dollarsPerMonth } | null,
    recommendedActions: { active: n, delete: n, optimize: n, review: n, keep: n, passive: n }
  }
}
```

`skills`, `heaviest`, `thin`, `economics`, `cost` and every recommendation cover
listed rows only. `notLoaded` is everything else found on disk, sorted by
`calls` descending then by name, with `reason` copied from `loadedReason`. It is
reassurance, not a problem list: nothing in it costs a token per message, so
nothing in it is scored or recommended on.

Every listed skill carries a recommendation, ranks run 1 to N with no gaps,
`impactTokensPerCall` never rises as rank rises, and the six counts in
`recommendedActions` add up to `totals.skills`. `summary` has thirteen keys, and
`pickSummary(report)` returns all thirteen with `null` for anything unknown.

`totals` keeps the fields the old report had: `skills, declaredActive,
declaredPassive, gateDeclaredAnywhere, transcriptsRead, callsTotal,
callsMatched, calledSkills, neverCalled, neverCalledActive, neverCalledPassive`,
and adds three: `onDiskNotListed` (the length of `notLoaded`),
`notListedByReason` (`{reason: count}`) and `withSourceCopy` (listed rows
carrying a `sourcePath`). `skills` and every never-called count are over listed
rows; `callsMatched` counts calls on listed and unlisted rows together.

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
planApply(decisions, {skills, thresholds}) -> {
  steps: [{ name, action, path, kind: 'set-gate' | 'unset-gate' | 'unlink' | 'trash' | 'worklist' | 'refuse' | 'noop', detail, undo }],
  worklist: [{ name, path, currentDescription, currentChars, targetChars }],  // optimize items, for the agent to rewrite
  refused: [{ name, action, reason }],   // plugin-cache deletes, unknown skills, unparseable frontmatter
}
applyPlan(plan, {yes, trashDir, now}) -> {
  applied: n, skipped: n, dryRun: bool,
  trashDir, stamp,                       // the root and the YYYYMMDD-HHMMSS folder deletes land in
  steps: [{...step, done: bool, error}],
  worklist, refused,                     // carried through from the plan so one object is enough
}
```

- Which file gets edited: for a `plugin-cache` row carrying a `sourcePath`,
  `active`, `passive` and `optimize` all target `<sourcePath>/SKILL.md`, and the
  step `detail` adds that the installed copy picks the change up on the next
  plugin update (`claude plugin update <installKey>` when the key is known).
  Without a source copy the cache file itself is edited, and the `detail` warns
  that the next plugin update overwrites it, so the same change belongs in the
  plugin's repository too. Every other location edits its own `skillMd`.
- `active`: `setFrontmatterKey(text, 'disable-model-invocation', 'true')`.
- `passive`: remove the key (`null`). Undo is the reverse call.
- `delete`: if the row has symlinks under `~/.claude/skills`, unlink those and leave the target (undo: `ln -s`); else if `location === 'plugin-cache'` refuse with the `claude plugin uninstall` hint; else move the real directory to `<trashDir>/<YYYYMMDD-HHMMSS>/<name>` (undo: `mv` back). Deletes also refuse when the skill directory is inside a git work tree that is not clean for that path? No: keep it simple, trash is the safety net.
- `optimize`: no file change; goes to `worklist` with `targetChars = thresholds.optimizeTargetChars`.
- Without `--yes` nothing is written; the plan is printed. With `--yes` steps run and each prints its undo line.
- Steps carry the extra keys their kind needs: `edit` on `set-gate` and
  `unset-gate`, `target` on `unlink`, `folder` on `trash` (and `to` once
  `applyPlan` has picked the exact destination).

## CLI surface

```
token-coupons report [--since=YYYY-MM-DD] [--cwd=DIR] [--window=N] [--fraction=F] [--budget=CHARS]
                     [--pricing=FILE] [--uncached] [--cache-ttl=MIN] [--json] [--html=FILE]
                     [--card=FILE] [--out=FILE] [--open] [--no-color]
token-coupons apply <decisions.json> [--yes] [--trash=DIR] [--json]
token-coupons pricing [--pricing=FILE] [--json]
token-coupons help
```

`--cache-ttl=MIN` is how long the saved prompt survives with no traffic, and it
decides when a gap counts as a cache break. The default is 60 minutes, which is
what a Claude subscription gets; a plain API key is 5 unless the one hour cache
is turned on.

`--version` and `-v` print the version. `--today=YYYY-MM-DD` fixes what the tool
calls today, and `--top=N` sets how many ranked rows the text report prints;
both exist so tests are reproducible and neither is in `help`.

`report` with no flags prints the text report. `--json` prints the Report.
`--html=FILE` writes the interactive page (and still prints the text report
unless `--json`). `--out=FILE` writes the Report JSON next to it. `--open`
opens the HTML in the default browser after writing. Exit code 0 always for
report; apply exits 1 if any step errored.

## HTML report requirements

- One file, no external assets, no fetch, no fonts from the network. Works
  opened from disk and inside a sandboxed artifact frame. No `<a download>`
  (inert in artifact sandboxes): the flow is Copy to clipboard, with the
  textarea visible and selectable as the fallback.
- Theme aware: light palette on `:root`, dark under
  `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
  and again under `:root[data-theme="dark"]`. Body has an explicit background.
- Sections in order: verdict header (five numbers, the first being skills in your listing, and the savings sentence);
  cost strip (per model cards, wasted per chat and per week, cached by default
  with an uncached toggle, plus the share-of-input line for subscription users);
  recommendations table (every skill, sorted by rank, per-row action control
  Keep / Passive / Active / Optimize / Delete preselected to the recommendation,
  filters never-called / summoned-only / heavy / thin / unroutable / all, text
  search, plugin column, calls split routed and summoned, description tokens);
  heaviest descriptions list; thin descriptions list; unroutable list;
  a collapsible "On disk, but not in your listing" section grouped by reason
  (report.notLoaded); export footer (Accept all recommendations, Reset, Copy JSON, Download,
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
  100 lines, plain language, no dashes.
- `evals/evals.json` in the agentskills.io shape with three realistic prompts.

## The share card (src/score.mjs, src/render-card.mjs)

`--card=FILE` writes a second, much smaller page: one dark scorecard sized for
posting, and a button that turns it into a PNG.

The score is 0 to 100 over three weighted parts, defined in `score.mjs`:
`earned` (70) is the share of listing tokens spent on skills the agent has
chosen at least once, `fit` (20) is headroom against the allowance (full marks
at or under it, none at twice over), `reach` (10) loses a tenth per unroutable
skill. Grades start at 90 A, 75 B, 60 C, 45 D, and F below. The weighting is
deliberately harsh on `earned`: a listing where most tokens buy no routing
decision is failing at its only job.

The line under the score is computed by `headline()`, not chosen from a table of
sentences per grade. It names how many skills have never been used, how many are
only ever typed by hand, and what those descriptions cost per message. An
adjective for the band would read as filler and would not tell anyone which
skills are the problem.

Three constraints shape the card and must not be broken casually:

- It is authored as **one inline SVG**, not HTML, because an SVG can be
  serialized, drawn on a canvas, and read back as a PNG with no library and no
  network. Nothing that would taint that canvas or fail to rasterize may go in:
  no external font, no `<foreignObject>`, no remote image. A test asserts this.
- Saving takes **two paths**. Inside the claude.ai artifact viewer a page cannot
  download on its own, so it asks the host through the `downloads` capability
  (declare `capabilities: {downloads: true}` when publishing) and the viewer
  confirms. Opened from disk there is no host, so it falls back to an anchor.
- It commits to **one dark look**, with no light variant, because it is meant to
  land in other people's apps where it cannot know the surrounding theme.

## The decision list (src/render-list.mjs)

`--html=FILE` writes the companion to the card: the same dark ground and mono
voice, carrying every row behind the headline figure so a person can change any
of them. Three rules shape it.

**Money, not tokens.** A token count is a unit nobody has intuition for. Every
row is priced per month from `cost.dollarsPerTokenPerMonth`, the single rate
`report.mjs` derives from the model the transcripts actually ran on, so the card
and the list can never disagree about what a skill costs. When no priced model
matches, rows fall back to token counts rather than a guessed price.

**Passive and active first.** The page opens by explaining the two modes and
nothing else, because nobody can make these decisions without knowing what they
are, and that difference is the only lever the tool pulls. A test asserts the
explainer sits above the table.

**One dark look**, matching the card it ships beside.

`src/render-html.mjs` is the earlier light page. It is no longer reached by any
flag, and it is kept only because a second session had uncommitted edits in it
when this landed. Delete it once that settles.
