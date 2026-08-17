---
domain: cost
holds: "The listing is re-sent on every single API call at whichever rate applies, and because it rides at the front of the saved prompt it is re-saved at the write rate every time something breaks that prompt, measured per machine rather than assumed to be once per chat."
applies-to: [token-coupons, claude-code]
stability: provisional
verified-on: 2026-08-15
related: [report-anatomy, listing-budget, description-rewrite, decisions-file]
---

# How the dollars are worked out

## The one idea

The list of installed skills lives in the system prompt, which is sent again with every API call, and
a single chat makes dozens of those. A description is not paid for once when the skill runs; it is
paid every time the agent takes a turn, used or not. Cost is therefore three numbers multiplied: how
big the listing is, how many API calls get made, and the price per token.

## Cached, and how often the cache is thrown away

Providers charge less for input they have already seen: writing into the cache costs about twice
ordinary input, reading it back about a tenth. That is why a long listing is cheaper than it looks.

It is not saved once per chat, though. The listing sits in the system prompt, at the very front of
the saved prompt, so anything that invalidates the front makes the whole listing get saved again at
the write rate instead of re-read at the read rate. Four things do that: the first request of a chat,
switching model, switching thinking effort, and coming back after a gap longer than the cache
lifetime. `/compact` is **not** one of them, because it rewrites the conversation and the system
prompt in front of it survives.

How often that happens is measured per machine from the transcripts. A break is counted only if both
agree: the request wrote more into the cache than it read back, and one of the four causes was
present. Either signal alone is noisy, since one big file read can outweigh a cache read on an
ordinary turn, and a model switch two turns into a chat costs almost nothing.

Per chat, with caching on (the default, and what actually happens in a normal session):

```
tokens * (cacheWrite * writes + cachedInput * (calls - writes)) / 1000000
```

`writes` is that measured count, at least 1 and never more than the requests in the chat. It reaches
the report as `cost.assumptions.cacheWritesPerSession`, beside `cacheBreaks` (the four causes,
counted) and `cacheTtlMinutes`. When a vendor publishes no separate cache write rate, those requests
are priced at the normal input rate. `--cache-ttl=MIN` sets the lifetime a gap is measured against:
60 minutes by default, the one hour cache a Claude subscription gets, against 5 on a plain API key.

With caching off, the honest upper bound at list price:

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
- how often the saved prompt was thrown away per chat, and which of the four causes did it

Assumed, and labelled as such wherever it appears:

- four characters per token, the same rough ratio Claude Code's own cost display uses
- that the skill listing sits at the front of the cached part of the prompt
- when there is no session history at all, three sessions per day and twenty five API calls per
  session, which the report says out loud in its `note`

Every count is a floor. Subagent transcripts are not read, and subagents carry their own copy of the
listing, so the real number is higher than the reported one, never lower.

## The line for people who never see a bill

Most people are on a subscription and have no invoice to compare against. For them the useful number
is not dollars, it is share: `listingShareOfInput` and `wastedShareOfInput`, the fraction of all
input tokens spent re-sending the skill menu, and the fraction spent re-sending parts of that menu
which have never once been used. That is the number that turns into hitting a usage limit early. Say
it as a percentage of everything sent, not as an abstraction.

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
