---
name: token-coupons
description: >-
  Audit what your installed skills cost on every message and which ones the agent never reads, put
  the interactive report in front of you, then carry out your decisions. Run it with /token-coupons.
disable-model-invocation: true
---

# token-coupons

Seven steps, in order. Stop where it says stop. Never delete or edit a skill this loop did not
produce a decision for.

**When NOT to use:** one skill did not fire and the person wants that one description fixed, or a
skill is being written right now. That is a single file edit, not a full audit.

## Step 0. Find the tool

Prefer the published package:

```bash
npx --yes token-coupons@latest help
```

If that fails (offline, npx blocked), run the copy shipped beside this skill. `SKILL_DIR` is the
**real** folder this file sits in, not the path you reached it through. Inside an installed plugin
that is `${CLAUDE_PLUGIN_ROOT}/skills/token-coupons`. If this skill was installed with `ln -s` into
`~/.claude/skills`, resolve the link first (`readlink` the SKILL.md path), because
`~/.claude/skills/token-coupons/../../bin` does not exist and the command below fails with
`MODULE_NOT_FOUND`.

```bash
node SKILL_DIR/../../bin/token-coupons.mjs help
```

Whichever one answered is `TC` for the rest of this file.

## Step 1. Run the report

```bash
mkdir -p "$HOME/.token-coupons"
TC report --html="$HOME/.token-coupons/report.html" --out="$HOME/.token-coupons/report.json" --card="$HOME/.token-coupons/scorecard.html"
```

`--card` writes a second, much smaller page: one dark scorecard with a score out
of 100 and a button that saves it as a PNG. Offer it whenever the person sounds
like they want to show someone (a teammate, a post), and when you publish it as
an artifact declare the `downloads` capability so the button can actually save.

Run it from the folder they usually start Claude Code in: a project's own `.claude/skills` only
count as listed from inside that project. Add `--since=YYYY-MM-DD` if the person only wants recent
history. Add `--uncached` if they want the list price upper bound instead of the cached price. The
tool reads local files only and writes nothing outside the two paths above.

## Step 2. Read the summary, and only the summary

```bash
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.token-coupons/report.json','utf8')).summary,null,2))"
```

Do not read the whole report file. It holds one row per installed skill and will swamp the
conversation; the person reads that detail in the page, not in chat.

Lead with one verdict line, picked by the ladder in [references/report-anatomy.md](references/report-anatomy.md):
skills that cannot be routed to beat dollars, dollars beat tokens. Then at most three supporting
lines. No table yet.

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
2. Dry run. Without `--yes` nothing is written:
   ```bash
   TC apply "$HOME/.token-coupons/decisions.json"
   ```
   (`TC apply -` reads the same JSON from stdin if you would rather pipe it than write a file.)
3. Show the plan back to them, grouped by action, one line per skill. Call out every entry under
   `refused` and why. Say plainly that Delete moves the folder to a trash directory and can be put
   back, and that Optimize changes no file yet.
4. Wait for a yes. Then:
   ```bash
   TC apply "$HOME/.token-coupons/decisions.json" --yes
   ```
5. Keep the undo line each step prints in your reply. If the command exits 1, name the steps that
   failed instead of reporting success.

## Step 6. Rewrite the Optimize descriptions

Every Optimize decision lands in the plan's `worklist` with the current description and a
`targetChars`. For each one, edit only the `description` in that skill's SKILL.md, following
[references/description-rewrite.md](references/description-rewrite.md): keep the trigger phrases and
the boundary, cut the how, aim for about 350 characters, never go over 1536.

When a plugin skill's source repo is on this machine, the worklist `path` already points at that
source copy, so edit it there and mention that the installed copy refreshes on the next plugin
update. A `path` still under `.claude/plugins/cache/` means no source copy was found: skip it, say
so, and say the fix belongs in that plugin's own repository.

## Step 7. Re-run and hand over the receipt

```bash
TC report --out="$HOME/.token-coupons/report-after.json"
```

Read the new `summary` the same way as Step 2, then close with exactly three lines:

- **Tokens per API call:** before to after, for the whole skill listing.
- **Dollars per week:** before to after, on the model their transcripts actually show. If nothing
  was measured, say the number is an estimate and say what it assumed.
- **Fits the budget:** yes or no, and if no, how much is still over.

Background for those numbers, when they ask: [references/cost-model.md](references/cost-model.md) for
the money, [references/listing-budget.md](references/listing-budget.md) for the budget and why a
skill can go silent with no error anywhere.
