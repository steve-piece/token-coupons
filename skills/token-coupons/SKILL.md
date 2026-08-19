---
name: token-coupons
description: Audit what your installed skills cost on every message, decide what to change, then carry it out. Run it with /token-coupons.
disable-model-invocation: true
model: opus
---

# token-coupons

Eight steps, in order. Stop where it says stop. Never delete or edit a skill this loop did not
produce a decision for.

Two rules hold the whole way through:

- **Write nothing by hand.** Every change to a skill file has a command. The only writing you do is
  the text of a description, and even that is filed by a command rather than an edit.
- **Show the command before you run it.** Nothing here is pre-approved, on purpose: this loop moves
  folders and rewrites files, and the permission prompt is the last check before it does.

**When NOT to use:** one skill did not fire and the person wants that one description fixed, or a
skill is being written right now. That is a single file edit, not a full audit.

## Step 0. Find the tool

The tool lives inside this skill directory. `SKILL_DIR` is the **real** folder this file sits in,
with symlinks resolved, because `skills add` installs into `~/.agents/skills` and links from
`~/.claude/skills`.

```bash
SKILL_DIR="$(dirname "$(node -p "require('node:fs').realpathSync('$HOME/.claude/skills/token-coupons/SKILL.md')")")"
TC() { node "$SKILL_DIR/bin/token-coupons.mjs" "$@"; }
TC help
```

Installed as a plugin instead, `SKILL_DIR` is `${CLAUDE_PLUGIN_ROOT}/skills/token-coupons`. Working
from a clone, it is `<repo>/skills/token-coupons`. `TC` means that command for the rest of this file.

It needs Node 20 or newer and nothing else: no install step, no dependencies, no network.

## Step 1. Run the report

```bash
mkdir -p "$HOME/.token-coupons"
TC report --html="$HOME/.token-coupons/report.html" --out="$HOME/.token-coupons/report.json"
```

Run it from the folder they usually start Claude Code in: a project's own `.claude/skills` only
count as listed from inside that project. Add `--since=YYYY-MM-DD` if the person only wants recent
history. Add `--uncached` if they want the list price upper bound instead of the cached price.

Every run leaves a record in `~/.token-coupons/runs`, and this one reads the last. Two things follow
from that, and both belong in your reply:

- **Any setting nobody typed again is carried forward.** If they asked for `--since=2026-06-01` last
  month, this report reads the same stretch of history without being told. That is what stops two
  reports a week apart from disagreeing for no reason. `--fresh` ignores the history entirely.
- **A `SINCE YOUR LAST RUN` block appears when something moved:** a different folder, skills added or
  gone, or a headline number up or down by more than a fifth. Read it before the summary and say what
  it found. Silence there means the two runs measured the same thing.

The tool reads local files only and writes nothing outside the paths you give it and that run record.

No scorecard yet. The card is the picture of what changed, so it belongs at the end, after the
changes are real.

## Step 2. Read the summary, and only the summary

```bash
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.token-coupons/report.json','utf8')).summary,null,2))"
```

Do not read the whole report file. It holds one row per installed skill and will swamp the
conversation; the person reads that detail in the page, not in chat.

Lead with one verdict line, picked by the ladder in [references/report-anatomy.md](references/report-anatomy.md):
skills that cannot be routed to beat dollars, dollars beat tokens. Then at most three supporting
lines. No table yet.

If `report.previous` is set, its `drift` list comes first, in one line. A number that moved because
the folder changed is not the same news as one that moved because they installed twelve skills, and
saying which it was is the difference between a report they trust and one they argue with.

## Step 3. Put the report in front of them

- If an Artifact tool is available, publish `$HOME/.token-coupons/report.html` with it and hand over
  the link. The page is one self contained file, so it works inside a sandboxed frame.
- Otherwise open it locally (`TC report --open ...`, or `open <path>` on macOS, `xdg-open <path>` on
  Linux) and give the absolute path in the reply as well, so they can find it again later.

## Step 4. Tell them what to do, then stop

Say this, near enough word for word:

> Every row is already set to what I recommend. Change any row you disagree with, using Keep,
> Passive, Active, Optimize, or Delete. Click a skill name if you want to see its full description.
> When you are done, press Copy on the decisions box at the bottom (or the Copy button at the top if
> you are happy with everything) and paste the JSON into your next message with the words "proceed
> with these decisions". Nothing has changed on disk yet, and nothing will until you say so.

Stop. Do not run `apply`, do not edit a SKILL.md, do not delete anything while you wait.

## Step 5. On return, plan first, then apply

1. Take the JSON they pasted (it starts with `{"version": 1`) and save it verbatim to
   `$HOME/.token-coupons/decisions.json`. Do not retype or reformat it. Shape and every action are
   in [references/decisions-file.md](references/decisions-file.md). If they pasted nothing but said
   "proceed with the recommendations", regenerate the default file from the report instead:
   `node -e` over `report.json` collecting every skill whose `recommendation.action` is not `keep`
   or `review`, in the same shape.
   If `$HOME/.token-coupons/report.json` is missing (a fresh chat, and the decisions came from an
   earlier one), run step 1 first: it is the "before" that step 7 compares against, and the run
   record it leaves is what makes the after report say what moved.
2. Dry run. Without `--yes` nothing is written:
   ```bash
   TC apply "$HOME/.token-coupons/decisions.json" --json > "$HOME/.token-coupons/plan.json"
   ```
   (`TC apply -` reads the same JSON from stdin if you would rather pipe it than write a file. Drop
   `--json` for the same plan as plain text.)
3. Show the plan back to them, grouped by action, one line per skill. Call out every entry under
   `refused` and why. Say plainly that Delete moves the folder to a trash directory and can be put
   back, and that Optimize changes no file yet.
4. Wait for a yes. Then:
   ```bash
   TC apply "$HOME/.token-coupons/decisions.json" --yes
   ```
5. Keep the undo line each step prints in your reply. Take them from the `--yes` run, not the dry
   run: the trash folder is stamped with the run time, so the plan's paths are already stale. If the
   command exits 1, name the steps that failed instead of reporting success.
6. `apply` ends with a note about the skill list having changed. Relay it: Claude Code picks the change
   up inside a chat that is already running, so the next message in any chat still open re-sends its
   whole conversation at full price once. Suggest `/clear` so that lands on an empty conversation.

## Step 6. Rewrite the Optimize descriptions, then file them

This is the one step that needs you rather than a command, because it is writing. Everything around
it is still a command.

1. Read the `worklist` block out of the plan you saved in step 5. Each row carries the skill name,
   the SKILL.md it belongs to, `currentDescription`, and a `targetChars`. That block is the whole
   input: do not open the SKILL.md files to read their descriptions.
   ```bash
   node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.token-coupons/plan.json','utf8')).worklist,null,2))"
   ```
2. Draft one new description per row, following
   [references/description-rewrite.md](references/description-rewrite.md): keep the trigger phrases
   and the boundary, cut the how, aim for about 350 characters, never go over 1536.
3. Write them to `$HOME/.token-coupons/descriptions.json`, one entry per row:
   ```json
   {"version": 1, "descriptions": [{"name": "some-skill", "description": "the new text"}]}
   ```
   Adding a `description` to each worklist row and sending the worklist back works too.
4. Dry run, then write. `describe` replaces the `description` key and leaves every other line of the
   file alone, so no SKILL.md is ever edited by hand:
   ```bash
   TC describe "$HOME/.token-coupons/descriptions.json"
   TC describe "$HOME/.token-coupons/descriptions.json" --yes
   ```
   It copies each file into the trash folder before writing it, so every rewrite has a `cp` undo
   line. It refuses an empty description, one past the 1536 character cap, and any file whose
   settings block it cannot edit safely. Report those refusals rather than working around them.

When a plugin skill's source repo is on this machine, `describe` writes to that source copy by
itself and says so; mention that the installed copy refreshes on the next plugin update. A path
still under `.claude/plugins/cache/` means no source copy was found: the write happens but the next
plugin update overwrites it, so say the lasting fix belongs in that plugin's own repository.

## Step 7. Re-run, render the scorecard, hand over the receipt

Now the numbers describe a machine that has actually changed.

```bash
TC report --out="$HOME/.token-coupons/report-after.json" --card="$HOME/.token-coupons/scorecard.html"
```

The card is one dark page: what the pass saved, in dollars a month at API prices, over what the
listing costs now. It carries its own Save image and Copy image buttons. Publish it as an artifact
and declare the `downloads` capability, or the save button has nothing to save to. Without an
Artifact tool, open it locally the way step 3 does and put the absolute path in the reply. Hand over
the link and say it is theirs to post.

Read the new `summary` the same way as step 2, then close with exactly three lines:

- **Tokens per API call:** before to after, for the whole skill listing.
- **Dollars per week:** before to after, on the model their transcripts actually show. If nothing
  was measured, say the number is an estimate and say what it assumed.
- **Fits the budget:** yes or no, and if no, how much is still over.

Background for those numbers, when they ask: [references/cost-model.md](references/cost-model.md) for
the money, [references/listing-budget.md](references/listing-budget.md) for the budget and why a
skill can go silent with no error anywhere.
