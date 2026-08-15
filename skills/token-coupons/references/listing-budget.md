---
domain: listing
holds: "The space for skill descriptions is a client setting, not a model limit, and when it runs out the client keeps every name and quietly drops descriptions starting with the skills you use least."
applies-to: [token-coupons, claude-code, cursor, other-clients]
stability: provisional
verified-on: 2026-08-15
related: [report-anatomy, description-rewrite, cost-model, decisions-file]
---

# The listing budget, and the failure it hides

## What the budget is

Every session, the client builds a list of installed skills (name plus description) and puts it in
the system prompt. That list gets a fixed allowance. In Claude Code the allowance is **1 percent of
the context window**, and each single entry is capped at **1536 characters** of description.

Concretely, on a 200,000 token window: 2,000 tokens, about 8,000 characters. At a typical 350
character description plus its name line, that is room for roughly **twenty two skills**. On a
1,000,000 token window it is 10,000 tokens, about 40,000 characters, roughly a hundred skills.

Two settings move it: `skillListingBudgetFraction` changes the 1 percent,
`SLASH_COMMAND_TOOL_CHAR_BUDGET` replaces it with a flat character count.

## Which folders actually reach the list

Only three, per code.claude.com/docs/en/skills: `~/.claude/skills`, the `.claude/skills` of the
project you started Claude Code in, and the skills of **enabled** plugins out of
`~/.claude/plugins/cache/`. A symlink under `~/.claude/skills` counts, so a skill kept in a repo can
be linked in.

Everything else costs nothing per message: marketplace checkouts, a plugin's source repository,
another project's `.claude/skills`, `~/.agents/skills`, `~/.cursor/skills`, disabled plugins, and old
versions left in the cache. The report puts those under `notLoaded` and scores none. This is why the
run folder matters: the same machine reports different numbers inside a project than outside it.

## Trimming without editing the skill

For user and project skills there is a no-edit alternative. `skillOverrides` in `settings.json` takes
one of three values per skill: `name-only` keeps the name and drops the description,
`user-invocable-only` does the same but keeps it reachable by name, and `off` removes it entirely.
Same saving as the gate line, without touching a file someone else owns (code.claude.com/docs/en/skills).
It does nothing for plugin skills: there the choice is editing the source copy or disabling the plugin.

## The failure nobody is told about

When the list does not fit, the client does not error and does not warn. It keeps **every name** and
starts **dropping descriptions**, beginning with the skills invoked least.

So the skill is still installed, still correct, still listed. The agent can see that something called
`invoice-chaser` exists and has no idea what it is for, which means it will never choose it. Nothing
in any log says this happened. This is the one documented way a perfectly good skill goes silent, and
it is why the report has an unroutable list at all.

Note which skills it hits: the least used ones. A skill nobody uses loses its description, which
guarantees it stays unused. It cannot recover on its own.

## Where the window number comes from

The tool reads the model out of `settings.json` or `settings.local.json`. A model id carrying `[1m]`
means a 1,000,000 token window; anything else is treated as 200,000; no model at all falls back to
200,000 and says so in `budget.windowSource`.

This matters more than it sounds. Guessing the window five times too small turns a real 2.5 times
overrun into an alarming 12.6 times one, and the person then deletes skills they needed.

## Overriding it

| Flag | What it does | Use it when |
|---|---|---|
| `--window=N` | sets the context window directly, in tokens | the detected model is wrong, or you are checking another machine |
| `--fraction=F` | changes the share of the window, default `0.01` | the client's fraction setting has been customised |
| `--budget=CHARS` | replaces the calculation with a flat character allowance | a fixed character budget is configured |

`--budget` wins over `--fraction`, and `--fraction` is applied to whatever window `--window` or
detection produced. The per entry cap of 1536 does not move.

## What other clients publish

| Client | Allowance | What happens on overflow |
|---|---|---|
| Claude Code | 1 percent of the window, 1536 per entry | keeps names, drops descriptions least invoked first, silently |
| Codex | 2 percent of the window, or 8,000 characters when the window is unknown | shortens descriptions first, then omits skills, with a warning |
| Cursor | nothing published | nothing published |
| Copilot | nothing published | nothing published |
| Kiro | nothing published | nothing published |

Codex also puts each skill's file path in the listing, so its real ceiling arrives sooner than the
character count suggests.

## Two things that do not help

- **Bundling skills into a plugin.** A plugin takes part by volume only. Forty skills inside one
  plugin spend exactly what forty loose skills spend, and no manifest key raises the allowance.
- **Splitting a long description across lines.** Line breaks and indentation are not counted. The
  folded string is what gets sent, and what gets measured.

The only two moves that free real space are taking a skill out of the router's list (its gate line or
`skillOverrides`) and making its description shorter. See [description-rewrite](description-rewrite.md).
