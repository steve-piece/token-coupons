---
domain: report
holds: "The report is a stack of blocks, only one of them (summary) belongs in the conversation, and which of its numbers leads is decided by a fixed ladder rather than by taste."
applies-to: [token-coupons, claude-code]
stability: stable
verified-on: 2026-08-15
related: [decisions-file, description-rewrite, cost-model, listing-budget]
---

# What the report says, block by block

## Read this much, no more

`summary` is thirteen fields. It is the only block that belongs in chat. Everything else exists so the
HTML page can render it and so `apply` can act on it. Reading `skills` into the conversation costs
more than the waste being reported.

## Which number leads

Walk the ladder and stop at the first hit. Silently broken beats expensive, expensive beats large.

1. `summary.unroutable > 0`. Lead with it: that many skills are installed and correct but the agent
   cannot see what they are for, and nothing anywhere reports an error. Say the count and name two.
2. `summary.wastedPerWeekOnYourModel` is present. Lead with the dollars per week (add the month figure), and name the model
   it was priced on. Add "on current prices, cached" so nobody reads it as a bill.
3. Otherwise lead with `summary.wastedTokensPerCall`: tokens paid on every single API call for
   descriptions that have never once been used.

The second line is always `summary.savedTokensPerCallIfApplied` plus `summary.fitsAfter`: what
changes if the recommendations are taken, and whether the listing fits afterwards.

If `summary.notListed` is large, give it one clause and move on: that many skills sit on disk without
being in the listing, so they cost nothing per message. It is reassurance, never the lead.

## The thirteen summary fields

| Field | Plain reading |
|---|---|
| `skills` | how many skills are in the listing from this folder, counted once each, symlinks and plugin source copies folded in |
| `notListed` | how many more sit on disk outside the listing: other projects, marketplace checkouts, disabled plugins. They cost nothing per message and are scored nowhere |
| `listingTokensPerCall` | what the whole name plus description listing costs on every API call |
| `overBudgetRatio` | 1.0 means it exactly fills the space Claude Code allows; 2.5 means two and a half times over |
| `neverCalledPassive` | open to the router, never once chosen by it |
| `unroutable` | listed by name only, because Claude Code dropped their descriptions to fit |
| `summonedOnly` | only ever reached by typing a slash, yet still paying to sit in the router's list |
| `wastedTokensPerCall` | never called plus summoned only, per API call |
| `savedTokensPerCallIfApplied` | what the recommendations recover, per API call |
| `fitsAfter` | true if the listing fits the budget once the recommendations are applied |
| `wastedPerWeekOnYourModel` | `{ model, dollars, dollarsPerMonth }` for the model the transcripts actually ran on, or null when none of them is in the price list |
| `recommendedActions` | how many skills landed on each action: `active`, `delete`, `optimize`, `review`, `keep`, `passive`. The six add up to `skills` |

## The other blocks, and who they are for

- `budget`: the space Claude Code gives the listing, the context window it was derived from, and
  where that window was read from. See [listing-budget](listing-budget.md).
- `totals`: raw counts (skills, how many declare the gate, transcripts read, calls matched), plus
  `onDiskNotListed`, `notListedByReason` and `withSourceCopy`. Useful when someone doubts a number.
- `economics`: the same waste split into never called, overflow, and summoned only, each with a
  plain `note` sentence you can quote as is.
- `stats`: sessions, API calls per session, models seen, input tokens per week, cache shares. This is
  the multiplier that turns a listing size into money.
- `cost`: per model dollars per week and per month, cached and uncached, the wasted tokens per week and month in `cost.volume`, plus the share of input line. `cost.assumptions` is where those dollars come from and is the block to quote when someone asks why: requests per chat, chats per week, whether it was `measured`, and `cacheWritesPerSession` with the `cacheBreaks` behind it (chat starts, model switches, effort switches, gaps past `cacheTtlMinutes`). See [cost-model](cost-model.md).
- `skills`: every skill as a ranked row. The page renders this. Do not paste it.
- `heaviest` and `thin`: the longest descriptions, and the ones too short to route to.
- `notLoaded`: every skill on disk that Claude Code does not list from this folder, each with a plain
  `reason`, sorted by use. Nothing here is scored: an unlisted skill costs nothing per message.
- `unmatchedCalls`: skill calls in the transcripts with no skill on disk to match, usually renamed or
  uninstalled skills.
- `pricing`: which price file was read, the date on it, how old that is, and an `error` sentence when
  it could not be read at all. Quote the error rather than the missing dollars.
- `thresholds`: the cutoffs the recommendations were made with, after any override. Useful when
  someone asks why a particular skill was called heavy or thin.

## Flags, in words a newcomer can act on

| Flag | What it means |
|---|---|
| `never-called` | in the listing every session, never once chosen |
| `summoned-only` | you always type its slash; the router never picked it |
| `heavy-description` | its description is long enough to crowd out others |
| `thin-description` | too short for the router to tell when it applies |
| `capped` | past the per entry limit, so part of it is already cut off |
| `unroutable` | name is listed, description was dropped, cannot be chosen |
| `dormant-active` | slash only and never used; costs one line, saves nothing to change |
| `too-new` | installed inside the last 14 days and not used yet, which is expected; it is left alone and no saving is claimed |
| `not-editable` | lives in a plugin cache; edit its source copy when one is on this machine, or the next update wipes the change |
| `stale` | the file has not been touched in a long time |

## Actions the tool recommends

`keep` leave it alone. `active` add the slash only gate so it stops paying routing rent. `passive`
remove that gate so the router can pick it. `optimize` rewrite the description shorter, see
[description-rewrite](description-rewrite.md). `delete` move it to trash. `review` a judgement call
only the person can make.

## Honesty markers

Any number resting on an assumption carries a `note` or `assumed: true`. Repeat those words when you
repeat the number. Subagent transcripts are not read, so every count is a floor, never a ceiling.
