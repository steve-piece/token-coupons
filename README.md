# token-coupons

Find out what your installed Claude Code skills cost on every message, which ones the agent never reads, and what to do about it.

[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dependencies 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#install)
[![node 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](#install)

## The problem in 20 seconds

Every skill you install carries a description. Claude Code puts a listing of every installed skill, name plus description, into the system prompt, and re-sends it with every single API call. Install 200 skills and you are paying for 200 descriptions on every message of every chat, whether or not any of them get used.

That listing has a budget you never see. Claude Code gives it about 1 percent of the context window. When the listing goes over, Claude Code keeps every name but starts dropping descriptions, least-invoked first, until the rest fits. A skill with no description in the listing cannot be picked by the agent on its own. It is installed, it is correct, and it is unreachable, and nothing anywhere prints an error.

`token-coupons` reads the skills on your disk and the session transcripts already on your disk, and tells you: what the listing costs per message, which skills have never once been chosen, which ones are being dropped right now, what the waste costs in dollars per week and per month on the model you actually use, and one recommended action per skill. It counts only what Claude Code actually lists from where you run it (your `~/.claude/skills`, the current project's `.claude/skills`, and enabled plugins); everything else on disk is shown separately and costs nothing.

## Install

It is an Agent Skill, not a package. There is nothing to publish and nothing to keep up to date but the skill itself.

```bash
npx skills add steve-piece/token-coupons
```

Then say `/token-coupons` in Claude Code and let the agent drive the whole loop. Node 20 or newer is the only requirement: no dependencies, no install step, no network.

Two other ways in, if you prefer them:

```bash
# Claude Code plugin: this repo is a marketplace with one plugin
claude plugin marketplace add steve-piece/token-coupons
claude plugin install token-coupons@token-coupons
```

```bash
# from a clone, point your skills folder at the copy in this repo
git clone https://github.com/steve-piece/token-coupons
ln -s "$PWD/token-coupons/skills/token-coupons" ~/.claude/skills/token-coupons
```

## Driving it yourself

Everything the skill runs is a command you can run. `TC` below is the tool inside the skill directory, wherever it landed:

```bash
TC="node $HOME/.claude/skills/token-coupons/bin/token-coupons.mjs"
```

Print the report. Nothing is changed on disk.

```bash
$TC report
```

Write the interactive page and open it in your browser.

```bash
$TC report --html=report.html --open
```

Or write the share card: one dark card of what the changes saved, sized for posting, with a button that saves it as a PNG.

```bash
$TC report --card=scorecard.html --open
```

In the page, every row starts on the recommendation. Change the rows you disagree with, then press Copy on the decisions box at the bottom. If an agent is driving, paste that JSON into your next message and say "proceed with these decisions". By hand, save it as `decisions.json` and carry it out yourself: once without `--yes` to read the plan, then again with `--yes`.

```bash
$TC apply decisions.json         # prints the plan, writes nothing
$TC apply decisions.json --yes   # makes the changes
```

`apply -` reads the same JSON from stdin, so `pbpaste | $TC apply -` works too.

`apply` never edits a description: rewriting one is writing, so it hands you a worklist instead. Once the new text exists, `describe` files it, replacing that one key and leaving every other line of the file alone.

```bash
echo '{"version": 1, "descriptions": [{"name": "some-skill", "description": "the new text"}]}' > descriptions.json
$TC describe descriptions.json         # prints the plan, writes nothing
$TC describe descriptions.json --yes   # writes them, keeping a copy of each file first
```

## What you get

Real output from the author's machine, trimmed to fit here (`report --since=2026-06-01 --no-color`):

```text
token-coupons v0.1.0 (generated 2026-08-17, sessions since 2026-06-01, 167 sessions read)

WHAT THE LISTING COSTS
  Skills in your listing: 94 (93 let the agent pick them, 1 start only when you type their name)
                          plus 81 on disk but not listed, see ON DISK, NOT LISTED
  Allowance for the list: 40,000 characters, about 10,000 tokens (1 percent of a 1,000,000 token window)
  The list right now:     43,296 characters of descriptions, about 10,824 tokens, plus 8 tokens of name lines
  Sent with every message: about 10,832 tokens
  Over the allowance by 3,296 characters (1.08x). Past that line Claude Code drops descriptions
  quietly, least used first, so those skills cannot be found by the agent.

  65    never used, but described on every message  7,089 tokens per message
  3     cannot be reached (their description is being dropped to fit)
  7     only ever started by you typing their name  689 tokens per message

  Set those 72 skills to start only when you type their name and you save about 7,338 tokens on
  every message, and the list fits its allowance again.

WHAT IT COSTS IN DOLLARS
  15,748,425 tokens wasted per week, 68,243,175 per month, from 7,777 unused tokens in every message.

    model                     wasted/week  wasted/month  uncached/week  whole list/month
  * Claude Opus 5                  $12.04        $52.18         $78.74            $72.68
  * Claude Sonnet 5                 $4.82        $20.87         $31.50            $29.07
    GPT-5.6 Sol                     $9.85        $42.67         $78.74            $59.44
  * seen in your own sessions
  Assumes 135 messages per chat and 15 chats per week, measured from your sessions.
  The saved copy is thrown away and rewritten 3.76 times per chat, measured: 127 chat starts,
  396 gaps longer than 60 minutes, 91 model switches, 5 effort switches.
  Share of everything you send: the list is 2.02 percent of your input, the wasted part is 1.45 percent.

RECOMMENDED
  41 to gate (active), 25 to delete, 8 to rewrite (optimize), 20 to keep

   #  action    saves/msg  skill
   1  delete          384  typescript-e2e-testing
       Never used, last edited 150 days ago, 2,327 chars sent every message.
   2  active          286  app-review
       Never used in these sessions, yet its 1,143 chars description costs 290 tokens a message.
```

Reading the arithmetic in that block: 7,089 plus 689 is what those 72 descriptions spend today, and gating a skill still leaves its name line in the list, so the saving is 7,338 rather than the full 7,778. The 3 that cannot be reached are counted inside the 65, not on top of them. The 81 on disk but not listed are skills Claude Code does not put in the list from this folder (other projects, marketplace checkouts, plugin source repos, disabled plugins, older versions left in the plugin cache), so they are listed at the bottom for completeness and cost nothing.

The full report has these sections: what the listing costs, what it costs in dollars, recommended (every skill ranked by how much it saves, with one short reason each), heaviest descriptions, thin descriptions, never called, called (with uses split into agent picked and you typed), on disk but not listed, and calls in your transcripts that match nothing installed today.

## How it works

```mermaid
flowchart LR
  S["skills on disk<br/>SKILL.md frontmatter"] --> D["discover"]
  T["transcripts on disk<br/>~/.claude/projects"] --> C["scan calls"]
  D --> E["economics<br/>what fits, what is dropped"]
  C --> E
  E --> R["recommend<br/>one action per skill"]
  R --> M["cost model"]
  P[("skills/token-coupons/data/pricing.json")] --> M
  M --> O1["text report"]
  M --> O2["HTML page"]
  M --> O3["JSON"]
```

The decision loop, with the bundled skill driving it:

```mermaid
sequenceDiagram
  participant P as You
  participant A as Agent
  participant T as token-coupons
  participant H as HTML page
  A->>T: report
  T-->>A: summary + report.html
  A->>P: verdict, then the page
  P->>H: mark a decision per skill
  H-->>P: Copy (the decisions JSON)
  P->>A: paste it: "proceed with these decisions"
  A->>T: apply (plan first, then --yes)
  T-->>A: steps with undo lines, plus a rewrite worklist
  A->>A: draft the new descriptions
  A->>T: describe (plan first, then --yes)
  A->>T: report again, with the card
  T-->>P: before and after, and the scorecard
```

## The three numbers

**Never called** means the agent has not once chosen this skill in the sessions read, while its description still goes out with every message.

**Cannot be reached (unroutable)** means the listing is over its allowance and this skill's description is one Claude Code is dropping, so the agent cannot pick it at all until something shrinks.

**Only ever started by you typing its name (summoned only)** means the skill does get used, but never by the agent's own choice, so its description in the listing buys nothing.

### The cost model

- Prices assume caching by default, because that is how Claude Code runs: the listing rides at the very front of the saved prompt, so it is written into the cache and re-read cheaply on later messages.
- That saved copy does not last a whole chat: starting a chat, switching model, switching effort, and coming back after it has expired each throw it away, and the listing is then paid at the write rate (roughly twice input) rather than the read rate (a tenth of it). `/compact` is not one of those. How often it happens is measured from your own transcripts; `--cache-ttl=MIN` sets how long the saved copy survives (default 60, the Claude subscription behaviour) and `--uncached` still prices the worst case, where nothing is cached at all.
- Messages per chat and chats per week are measured from your own transcripts. When no history is found, the report says the numbers were assumed instead.
- On a subscription, dollars are the wrong unit, so the report also gives the listing as a share of everything you send.
- Prices are a data file (`skills/token-coupons/data/pricing.json`) with a verified-on date, never code, and the report says so when that date is more than 60 days old.

## Conventions

| Mode | In the skill's SKILL.md | What is sent every message |
| --- | --- | --- |
| Passive (the default) | no `disable-model-invocation` line | the name and the whole description |
| Active | `disable-model-invocation: true` | the name line only; you start it by typing its name |

| Action | When it is recommended | What `apply` does | Undo |
| --- | --- | --- | --- |
| `keep` | it gets used and its description is a reasonable size | nothing, it is left out of the plan | nothing to undo |
| `active` | never used, or only ever started by name | sets `disable-model-invocation: true` in SKILL.md | delete that line |
| `passive` | you want the agent to be able to pick it again | removes that line | add the line back |
| `optimize` | used, but the description is over 600 characters or past the per entry cap, or never used and too thin to route to | changes no file; puts the skill on a worklist with a target of about 350 characters, which `describe` then writes back | `cp` the copy `describe` kept back over the file |
| `delete` | never used, in a folder you own, and not edited in 90 days | unlinks the shortcut under `~/.claude/skills`, or moves the folder into the trash folder | `ln -s` it back, or move the folder back |
| `review` (report only) | already active, never used; costs one name line | not an action you send back: answer it with one of the five above | nothing |

Plugin skills are a special case: the installed copy lives in the plugin cache and is overwritten on the next update. When the plugin's source repo is on your machine, `apply` and `describe` edit that source copy instead and tell you to run `claude plugin update`; when it is not, the cache copy is edited with a warning.

## Use it from your agent

Say `/token-coupons`. The agent runs the report, leads with one verdict line, hands you the HTML page, and stops. Nothing on disk changes while it waits. Mark your decisions in the page, press Copy, and paste the JSON into your next message with "proceed with these decisions". The agent runs `apply` without `--yes` first and shows you the plan, asks, then runs it, drafts new text for the descriptions marked `optimize` and files them with `describe`, then re-runs the report and hands you the scorecard of what the pass saved.

The skill ships with `disable-model-invocation: true`, so it only ever runs when you ask for it, and `model: opus`, because the one judgment call in the loop is rewriting a description well. It pre-approves no tools: this loop moves folders and rewrites files, so every command goes through the normal permission prompt.

The whole tool lives inside `skills/token-coupons`. That is deliberate: `skills add` copies a skill directory, so anything sitting outside it would not come along.

## CLI reference

```text
token-coupons report [--since=YYYY-MM-DD] [--window=N] [--fraction=F] [--budget=CHARS]
                     [--pricing=FILE] [--uncached] [--cache-ttl=MIN] [--json] [--html=FILE]
                     [--card=FILE] [--out=FILE] [--open] [--no-color] [--cwd=DIR]
token-coupons apply <decisions.json | -> [--yes] [--trash=DIR] [--json]
token-coupons describe <descriptions.json | -> [--yes] [--trash=DIR] [--json]
token-coupons pricing [--pricing=FILE] [--json]
token-coupons help

  --since=DATE     only read sessions on or after this day
  --cwd=DIR        count a project's own skills as listed from this folder (default: where you run it)
  --window=N       context window size in tokens, instead of reading it from your settings
  --fraction=F     share of the window the listing may use (default 0.01)
  --budget=CHARS   a fixed allowance in characters, which wins over --fraction
  --pricing=FILE   a price list to use instead of the bundled data/pricing.json
  --uncached       price the worst case, where nothing is cached
  --cache-ttl=MIN  minutes the saved prompt survives with no messages (default 60, the Claude
                   subscription behaviour; use 5 on a plain API key)
  --json           print JSON instead of text
  --html=FILE      also write the decision list: every skill priced per month, with a suggestion you can change
  --card=FILE      also write the shareable saved card, which exports itself as a PNG
  --out=FILE       also write the report JSON
  --open           open the HTML page in your browser after writing it
  --no-color       plain text without colors
  --yes            apply and describe only: actually make the changes
  --trash=DIR      apply and describe only: where deleted folders and replaced files go
                   (default ~/.token-coupons/trash)
```

`report` exits 0 when it finishes. `apply` and `describe` exit 1 if a step failed, 0 otherwise; refusals are not failures. An unknown flag or command exits 2.

## Privacy and safety

- Local files only, and only the ones Claude Code itself reads. It reads your skill folders (`~/.claude/skills`, a project's own `.claude/skills`, plugin marketplaces and caches, and a shallow pass over `~/Projects`), your session transcripts under `~/.claude/projects`, and `~/.claude/settings.json` (plus `settings.local.json`) for the model you run. Folders belonging to other tools are never opened.
- No network access, ever. Prices ship as a data file with a date on them; refreshing them is a human action, not a fetch.
- `report` writes nothing unless you pass `--html` or `--out`.
- `apply` and `describe` write nothing without `--yes`, and nothing they do is unrecoverable: shortcuts under `~/.claude/skills` are unlinked rather than followed, folders are moved to `~/.token-coupons/trash/<timestamp>` rather than erased, a file about to have its description replaced is copied into that same folder first, and copies owned by the plugin cache are refused with the `claude plugin uninstall` command to run instead. Every step prints its own undo line.
- Set `TOKEN_COUPONS_HOME` to point the whole tool at a different home directory.

## Contributing

```bash
pnpm test                    # node --test, no dependencies to install
node tests/dash-scan.mjs     # fails on any em dash or en dash in the repo
```

The whole tool is `skills/token-coupons`, and `tests/` at the repo root reaches into it. Nothing the tool needs at runtime may live outside that directory: `skills add` copies it on its own, and anything left behind would simply be missing. The root `package.json` is private and exists for the test script.

One rule that trips everyone up: no em dashes or en dashes anywhere in this repo, including code, comments, strings, docs, and the generated HTML. Use commas, colons, parentheses, or periods. Run the dash scan before you open a pull request.

Node 20 or newer. Zero runtime dependencies, and it stays that way.

## License

MIT. See [LICENSE](LICENSE).
