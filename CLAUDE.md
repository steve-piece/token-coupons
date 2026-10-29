# token-coupons

An agent skill (and a one-plugin Claude Code marketplace) that prices the skill
listing Claude Code sends with every message, finds skills the agent never
uses across Claude Code, Codex, Cursor and Gemini CLI, and carries out the
user's keep / command / optimize / delete decisions with an undo line for each.

## Where things are

- `skills/token-coupons/`: everything that ships. `SKILL.md` is the eight step
  loop, `bin/token-coupons.mjs` is the CLI, `src/` the modules, `references/`
  the docs the skill reads on demand, `data/pricing.json` the model prices.
- `docs/architecture.md`: the module contract and data shapes. Change a shape
  there first, then the code, then the tests.
- `tests/`: `node:test` suites plus `dash-scan.mjs`.
- `.claude-plugin/`: `plugin.json` and `marketplace.json`. Keep their versions
  in step with each other.
- `future-recommendations.md`: logged follow-up work.

## Commands

```bash
node --test
```

```bash
node tests/dash-scan.mjs
```

```bash
node skills/token-coupons/bin/token-coupons.mjs report
```

CI runs the first two on Node 20 and 22. Run both before every commit.

## House rules

The full list lives in `docs/architecture.md` under House rules. The ones that
break things most often:

- Zero runtime dependencies, Node 20 or newer, no build step.
- No network, ever. Pricing is a data file with a verified-on date.
- No em dashes, en dashes or other forbidden dash code points anywhere in the
  repo. `dash-scan.mjs` fails CI on one.
- Read every root through `src/paths.mjs` so tests can redirect the tool with
  `TOKEN_COUPONS_HOME=<dir>`. Tests never touch the real home directory.
- Nothing `apply` or `describe` does is unrecoverable: trash, never erase;
  unlink symlinks, never follow them; refuse plugin cache deletes.
- Only Claude Code's listing is priced. Other tools count as uses, never as cost.
- Mark every assumed number with a `note` or `assumed: true`.

## Writing style

Plain words, short sentences, no jargon in user-facing text (report, README,
SKILL.md). Commit subjects are a plain sentence in the imperative, like the
existing history.
