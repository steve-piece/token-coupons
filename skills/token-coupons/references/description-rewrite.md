---
domain: skill
holds: "A description can lose half its length without losing a single trigger, because what makes it long is almost always the how, and the router never needed the how."
applies-to: [token-coupons, claude-code, cursor, other-clients]
stability: stable
verified-on: 2026-08-15
related: [report-anatomy, decisions-file, listing-budget, cost-model]
---

# Shrinking a description without breaking it

## What the description is actually for

Before a skill runs, the agent sees its name and its description and nothing else. So the
description is the entire decision surface: it has to say what the skill does, when to reach for it,
and when not to. It does not have to say how the skill works. The body says that, and the body is
free, because it is only read after the skill starts.

That is why shrinking is usually safe. The characters being cut were never doing routing work.

## Keep these four

1. **The capability sentence.** One line: what it produces. "Drafts reminder emails for unpaid
   invoices."
2. **The trigger phrases,** quoted, in the words a person would actually type. These are the literal
   surface the router matches on. Cutting these is the one edit that genuinely breaks a skill.
3. **The boundary.** The wrong reading of the skill's own name, or the sibling skill to prefer
   instead. One clause: "Not for creating an invoice: use invoice-builder for that."
4. **The push, if the skill undertriggers.** "even if they never say the word invoice."

## Cut these three

1. **The how.** Steps, internal file names, the order of operations, which template it reads. All of
   it belongs in the body.
2. **Restatements.** The same trigger said twice in different words.
3. **Hedging and ceremony.** "This skill can help you to", "as needed", "where appropriate".

## Targets

- Aim for about **350 characters**. That is roughly the median across installed skills, and it fits
  every published budget with room to spare.
- **Never exceed 1536 characters.** Past that, Claude Code cuts the description off mid sentence,
  and the cut can land before your trigger phrases. See [listing-budget](listing-budget.md).
- If the skill may be published, 1024 is the portable ceiling worth respecting.
- Slash only skills (the ones carrying `disable-model-invocation: true`) never route at all. One
  line is the right length for those, no triggers needed.

## Before and after

Before, 626 characters. Everything after the first sentence is the how.

```yaml
description: "Use when the user wants to chase unpaid invoices. This skill reads the open invoice list from the billing export, groups every invoice by how many days it is overdue, drafts a reminder for each bucket from the templates in references/, checks the tone against the house style guide, and queues the drafts for review. It treats the 7 day, 14 day, and 30 day buckets differently, applies late fees per the contract terms, and writes a summary table at the end. Trigger on \"chase invoices\", \"who owes me money\", \"send payment reminders\", or \"overdue invoices\". Do not use it to create a new invoice, use invoice-builder for that."
```

After, 331 characters. Every trigger phrase survived, the boundary survived, the how is gone.

```yaml
description: "Drafts reminder emails for unpaid invoices, grouped by how late each one is. Use when the user says \"chase invoices\", \"who owes me money\", \"send payment reminders\", or \"overdue invoices\", and whenever they ask who has not paid yet, even if they never say the word invoice. Not for creating an invoice: use invoice-builder for that."
```

That is 295 characters saved, about 74 tokens off every API call for as long as the skill stays
installed.

## Two YAML traps

- An unquoted colon followed by a space is a parse error, and the whole frontmatter fails to load.
  Quote the entire string, or use a `>-` block.
- A `>-` block folds into one line with single spaces, and that folded string is what gets measured
  and sent. Indentation costs you nothing.

Edit the `description` only. Do not touch the body, the name, or any other key in this pass.

## Re-measure, do not estimate

```bash
token-coupons report --out="$HOME/.token-coupons/after.json"
node -e "const r=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.token-coupons/after.json','utf8'));for(const s of r.skills)if(process.argv.slice(1).includes(s.names[0]))console.log(s.names[0], s.descriptionChars, s.listingTokens, s.capped)" invoice-chaser
```

If `capped` is still true, the rewrite did not go far enough. If `descriptionChars` came in under 60,
it went too far and the skill will now be flagged as too thin to route to.
