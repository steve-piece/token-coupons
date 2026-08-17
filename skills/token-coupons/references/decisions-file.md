---
domain: apply
holds: "One small JSON file names an action per skill, apply turns it into a plan you can read before anything is written, and every step that touches disk prints the command that reverses it."
applies-to: [token-coupons, claude-code]
stability: stable
verified-on: 2026-08-15
related: [report-anatomy, description-rewrite, listing-budget, cost-model]
---

# The decisions file, and what apply does with it

## Shape

The page's Copy button puts this on the clipboard, and the person pastes it into their next message (the page
tells them to add "proceed with these decisions"). Save it verbatim to a file, pipe it to `$TC apply -`, or write it by hand.

```json
{
  "version": 1,
  "generatedOn": "2026-08-15",
  "source": "token-coupons html report",
  "decisions": [
    { "name": "bytheslice:box-it-up", "path": "~/.claude/plugins/marketplaces/bytheslice/skills/box-it-up", "action": "active", "note": "" }
  ]
}
```

`path` is matched first, against the skill's real path with `~` expanded. `name` is the fallback when the path no longer exists. `note` is free text and is carried through untouched.

## The five actions

| Action | What apply does | Step kind |
|---|---|---|
| `keep` | nothing; dropped from the plan entirely | `noop` |
| `active` | writes `disable-model-invocation: true` into the frontmatter, so only a slash can start it | `set-gate` |
| `passive` | removes that key, so the router may start it again | `unset-gate` |
| `optimize` | changes no file; the skill lands in `worklist` for a description rewrite | `worklist` |
| `delete` | unlinks the symlink, or moves the real folder to trash | `unlink` or `trash` |

Delete picks its own path. If the skill is reachable through symlinks under `~/.claude/skills`, only those links are removed
and the real folder is left alone, so a skill living in a git repository is never touched. Otherwise the real directory is moved into `<trashDir>/<YYYYMMDD-HHMMSS>/<name>`. Nothing is ever erased.

## Plugin skills edit their source copy

A plugin skill lives in `.claude/plugins/cache/`, which the next update overwrites. When the row carries a `sourcePath` (the
page badges it "source on disk"), `active`, `passive` and `optimize` edit `<sourcePath>/SKILL.md` instead, and the step
`detail` says the installed copy picks the change up on the next `claude plugin update <plugin@marketplace>`. Say that update
line out loud: until it runs, the listing still carries the old description. With no source copy the cache file itself is
edited and the `detail` warns the next update wipes it, so say the fix belongs in the plugin's own repository. `delete` is refused on a cache row either way.

## What gets refused, and why

Refusals appear in `plan.refused` with a reason. Read every one of them out loud to the person.

- **Delete inside a plugin cache.** The next plugin update rewrites that folder, so removing it changes nothing for more
  than a day. The real fix is `claude plugin uninstall <plugin>`.
- **A skill the report does not know.** Renamed, moved, or already gone. Re-run the report.
- **Frontmatter that cannot be parsed,** or a `disable-model-invocation` written as a block value: handed back for a
  manual edit rather than risk corrupting the file.

## The two step run

Without `--yes` nothing is written. The plan prints and stops, and that is what you show the person before asking for a go ahead.

```bash
$TC apply "$HOME/.token-coupons/decisions.json"
$TC apply "$HOME/.token-coupons/decisions.json" --yes
```

`--trash=DIR` moves deletes somewhere else. `--json` prints the plan or the result as data, which is the
easiest way to pull `worklist` out for Step 6. Exit code 1 means at least one step errored; report which
ones rather than reporting success.

## Changing a skill costs one full re-send

Claude Code picks a skill edit up inside a chat that is already running, and the listing rides at the front of every
message, so the next message in any open chat re-sends its whole conversation at full price once. `apply` prints this
itself: relay that note, say the cheapest moment is right after `/clear` or between chats, and that it is a one-off.

## Undo lines

Every step carries an `undo` string, and `--yes` prints it as the step runs. Keep them in your reply.

| Step kind | How it is reversed |
|---|---|
| `set-gate` | remove the `disable-model-invocation` line again |
| `unset-gate` | add `disable-model-invocation: true` back |
| `unlink` | recreate the link with `ln -s <real path> <link path>` |
| `trash` | `mv <trash path> <original path>` |
| `worklist` | nothing to undo; no file was changed |

## Result

```js
{ applied, skipped, dryRun, steps: [{ name, action, path, kind, detail, undo, done, error }] }
```

`dryRun` true means this was the plan pass and disk was not touched. `done: false` with an `error` means that one step
failed while others may have succeeded; the file is only ever rewritten whole, so a failed step leaves the original in place.

## The second file: descriptions

`optimize` is the one action `apply` cannot finish, because the missing piece is written English rather than an edit.
It leaves the skill in `worklist` instead, carrying the name, the SKILL.md path, `currentDescription` and `targetChars`.

Draft one replacement per row, then hand them back as a second file. It is the same two step run, and it refuses an
empty description, one past the 1536 character cap, and any settings block it cannot edit safely.

```json
{ "version": 1, "descriptions": [{ "name": "some-skill", "description": "the new text" }] }
```

```bash
$TC describe "$HOME/.token-coupons/descriptions.json"
$TC describe "$HOME/.token-coupons/descriptions.json" --yes
```

A worklist row with a `description` added to it is accepted as is, so the block can go straight back without reshaping.
Only the `description` key changes; every other line of the file is left byte for byte. The file as it stood is copied
into the same trash folder first, which is what the `cp` undo line points at.
