---
domain: cost
holds: "The listing is re-sent on every single API call, so its price is a size times a call count times a rate, and the only honest version of that sum says which of the three was measured and which was assumed."
applies-to: [token-coupons, claude-code]
stability: provisional
verified-on: 2026-08-15
related: [report-anatomy, listing-budget, description-rewrite, decisions-file]
---

# How the dollars are worked out

## The one idea

The list of installed skills lives in the system prompt. The system prompt is sent again with every
API call, and a single chat makes dozens of those. So a description is not paid for once when the
skill runs; it is paid for every time the agent takes a turn, whether or not the skill is ever used.

Cost is therefore three numbers multiplied: how many tokens the listing is, how many API calls get
made, and the price per token.

## Cached versus uncached

Providers charge less for input they have already seen. Within one chat, the first call writes the
system prompt into the cache and every call after that reads it. Writing costs a little more than
normal input; reading costs much less. That is why a long listing is cheaper than it looks, and why
the honest report shows both numbers.

Per chat, with caching on (the default, and what actually happens in a normal session):

```
tokens * (cacheWrite * 1 + cachedInput * (calls - 1)) / 1000000
```

When a vendor publishes no separate cache write rate, the first call is priced at the normal input
rate instead. Per chat with caching off, which is the honest upper bound at list price:

```
tokens * input * calls / 1000000
```

Per day and per week are those figures multiplied by the measured sessions per day and per week.
Nothing here estimates output tokens: the skill listing is input, and only input.

## Measured versus assumed

Read from the transcripts already on disk, no instrumentation added:

- how many sessions there were, and over how many days
- API calls per session, median and mean, counted once per response by request id
- which models actually ran, and how many calls each took
- total input tokens, and how much of it was cache reads and cache writes

Assumed, and labelled as such wherever it appears:

- four characters per token, the same rough ratio the client's own cost display uses
- that the skill listing sits inside the cached part of the prompt
- when there is no session history at all, three sessions per day and twenty five API calls per
  session, which the report says out loud in its `note`

Every count is a floor. Subagent transcripts are not read, and subagents carry their own copy of the
listing, so the real number is higher than the reported one, never lower.

## The line for people who never see a bill

Most people are on a subscription and have no invoice to compare against. For them the useful number
is not dollars, it is share: `listingShareOfInput` and `wastedShareOfInput`, the fraction of all
input tokens spent re-sending the skill menu, and the fraction spent re-sending parts of that menu
which have never once been used. That is the number that turns into hitting a usage limit early.

Say it as a percentage of everything sent, not as an abstraction.

## Prices are data, and they go stale

Rates live in `data/pricing.json` with a `verifiedOn` date. Nothing in this tool ever goes to the
network; the price table is refreshed by a person or an agent editing the file.

```bash
token-coupons pricing
```

That prints the table and the date it was checked. Past sixty days the report marks it stale and
`pricingStale` is true. When it is stale, say so before quoting any dollar figure, then offer to
refresh: open the pricing page in each model's `source` field, update `input`, `cachedInput`,
`cacheWrite`, and `output`, and set `verifiedOn` to today. A stale table is a worse failure than no
table, because it looks authoritative.
