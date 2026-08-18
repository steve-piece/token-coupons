# Future Recommendations - token-coupons

> Running list of opportunities and improvements identified during work.
> Each summary links to its full write-up below. Entries are numbered in
> capture order and numbers are stable once assigned; new entries append
> at the bottom.
> Last updated: 2026-08-18

## Summary

| # | Recommendation | Priority | Rough effort |
|---|----------------|----------|--------------|
| 1 | **[Upload the social preview image](#1-upload-the-social-preview-image)** - the PNG is drawn and ready; the upload is a web form nobody but the owner can submit | High | Low |
| 2 | **[Rewrite the OG image tagline](#2-rewrite-the-og-image-tagline)** - the current line was rejected, and the image needs redrawing once the replacement is chosen | Medium | Low |
| 3 | **[Refine the README verbiage and design](#3-refine-the-readme-verbiage-and-design)** - the structure is right now; the sentence-level copy and the visual system have not had a second pass | Medium | Medium |
| 4 | **[Run the tests on push and pull request](#4-run-the-tests-on-push-and-pull-request)** - done: one workflow runs the suite and the dash scan on Node 20 and 22 | High | Low |
| 5 | **[Confirm the skill is indexed in the registry](#5-confirm-the-skill-is-indexed-in-the-registry)** - install works, search does not find it yet | Low | Low |
| 6 | **[Share the scorecard as a link, not an attachment](#6-share-the-scorecard-as-a-link-not-an-attachment)** - the LinkedIn draft cannot carry the picture, so posting is still a two-step | Low | High |
| 7 | **[Run the evals that ship with the skill](#7-run-the-evals-that-ship-with-the-skill)** - three eval cases exist and have never been executed against the skill | Medium | Medium |

---

## Details

### 1. Upload the social preview image

- **Status:** Open, blocked on the repo owner, identified 2026-08-18
- **Priority:** High
- **Rough effort:** Low
- **Context:** Shared anywhere, the repo link renders GitHub's auto-generated thumbnail: the owner avatar, the repo name and the description, laid out like a screenshot of a settings page. A replacement is drawn and rasterized at 1280x640, 264 KB, well inside GitHub's 1 MB limit. The generator is committed at `tools/og-image.mjs`.
- **Recommendation:** Upload the PNG at GitHub repo, Settings, General, Social preview, Edit, Upload an image. Regenerate first with `node tools/og-image.mjs og.svg` and rasterize with headless Chrome at 1280x640 if item 2 has landed by then.
- **Why it matters / impact if skipped:** Every share of the repo link, and every LinkedIn post the scorecard drafts, carries that thumbnail. It is the first impression of the project for anyone who has not seen it before.
- **Dependencies / notes:** There is no REST endpoint and no `gh` flag for the social preview; `gh repo edit --help` offers `--description` and `--add-topic` and nothing else. It is a web form, so an agent cannot submit it. Do item 2 first to avoid uploading twice.

### 2. Rewrite the OG image tagline

- **Status:** Open, identified 2026-08-18
- **Priority:** Medium
- **Rough effort:** Low
- **Context:** The first attempt read "Every skill you install rides along in every message you send" over "See what that costs. Cut what is never read." The owner rejected it. "Rides along" is vague: it gestures at the mechanism without naming it, and it buries the fact that the cost repeats.
- **Recommendation:** Pick a direction, then redraw. The README hero currently runs a different line that names the mechanism instead: "Every skill you install is described again in every message you send", with "Find the ones the agent has never read, and stop paying for them" underneath. If that direction lands, port it into `tools/og-image.mjs` so the repo card and the README hero say the same thing. If it does not, the angle worth trying next is the silent failure rather than the cost: skills that go unreachable with no error anywhere.
- **Why it matters / impact if skipped:** The tagline is the only sentence most people will read before deciding whether to click.
- **Dependencies / notes:** Blocks item 1. Keep the two in sync: a repo card and a README hero that disagree read as carelessness.

### 3. Refine the README verbiage and design

- **Status:** Open, identified 2026-08-18
- **Priority:** Medium
- **Rough effort:** Medium
- **Context:** The README was rebuilt around value, then proof, then mechanism, and dropped from 281 lines to 228 with more in it. That pass fixed the reading order, the repetition and the visual system. It did not do a sentence-level edit, and the visual layer is one hero and nothing else.
- **Recommendation:** Two separate passes, in this order. First the copy: read every sentence aloud and cut the ones that restate the sentence before them, tighten the three table columns that currently run long in narrow viewports, and check the proof block still shows the most striking numbers rather than the ones that happened to be true the day it was captured. Then the design: consider section headers as SVG, a small before-and-after visual for the two modes, and whether the actions table would read better as a diagram.
- **Why it matters / impact if skipped:** The structure carries a first-time reader now, but the prose is the thing that makes them trust the numbers. Nothing here is broken, so this is polish, and it should not jump the queue ahead of item 4.
- **Dependencies / notes:** Both `crafting-effective-readmes` and `beautify-github-readme` are installed globally. Re-run `python3 ~/.claude/skills/beautify-github-readme/scripts/audit_readme.py README.md` and re-render through `gh api /markdown` at 900 and 360 pixels after any change; that is how the last pass was verified.

### 4. Run the tests on push and pull request

- **Status:** Done 2026-08-18. `.github/workflows/test.yml` runs `node --test` and `node tests/dash-scan.mjs` on push and pull request against Node 20 and 22, and the README carries the workflow badge. Identified 2026-08-18.
- **Priority:** High
- **Rough effort:** Low
- **Context:** The repo went public with 188 passing tests and a lint (`node tests/dash-scan.mjs`) that nothing runs automatically. The README tells contributors to run the dash scan before opening a pull request, which is an honour system. There is no `.github/workflows` directory at all.
- **Recommendation:** Add one workflow running `node --test` and `node tests/dash-scan.mjs` on push and pull request against Node 20 and 22. No dependencies to install, so it is a checkout, a setup-node and two commands.
- **Why it matters / impact if skipped:** A public repo that accepts a pull request has no way to tell whether it breaks anything, and the dash rule is exactly the kind of thing a contributor will not know about. The cost of the gap grows the moment someone other than the author touches the code.
- **Dependencies / notes:** Consider a badge in the README once it is green. Keep the workflow honest: if it cannot run the whole suite, say which part it skips.

### 5. Confirm the skill is indexed in the registry

- **Status:** Open, identified 2026-08-18
- **Priority:** Low
- **Rough effort:** Low
- **Context:** `npx skills add steve-piece/token-coupons` was verified working the moment the repo went public: the CLI resolves it straight from GitHub and reads the skill description correctly. Search is a separate system. `npx skills find token-coupons` returned only unrelated coupon skills, because skills.sh indexes public repos on its own schedule and the repo was private until now.
- **Recommendation:** Re-run `npx skills find token-coupons` in a week. If it still does not appear, look at what the registry requires beyond a public repo with a discoverable `SKILL.md`.
- **Why it matters / impact if skipped:** Installing works either way, so nothing is broken. Discovery is the difference between people finding this and only being sent it.
- **Dependencies / notes:** Not actionable today; it is a wait-and-check.

### 6. Share the scorecard as a link, not an attachment

- **Status:** Open, identified 2026-08-18
- **Priority:** Low
- **Rough effort:** High
- **Context:** The scorecard page offers Save image and Draft a LinkedIn post. The draft opens the composer with the numbers already written, but LinkedIn accepts text from a link and never an image, so the person still has to attach the PNG by hand. The page says so plainly rather than pretending otherwise.
- **Recommendation:** If one-click sharing is worth it, the scorecard needs to become a public page per run, with its own OG tags pointing at a hosted PNG of that run's card. That means hosting, an upload path, and a decision about how long each card lives.
- **Why it matters / impact if skipped:** The two-step works and is honest. This is an ambition, not a defect.
- **Dependencies / notes:** Weigh it carefully: the card carries one person's real numbers and their most-used model, so any hosted version is publishing personal usage data. That is a privacy decision before it is an engineering one, and it cuts against the project's own promise that nothing leaves the machine.

### 7. Run the evals that ship with the skill

- **Status:** Open, identified 2026-08-18
- **Priority:** Medium
- **Rough effort:** Medium
- **Context:** `skills/token-coupons/evals/evals.json` holds three cases: audit what skills cost, present the report, apply the decisions. They were written alongside the skill and updated when the loop changed, but they have never been executed. The third case in particular now asserts behaviour that only landed recently (filing descriptions with `describe`, rendering the scorecard last).
- **Recommendation:** Run them with the eval tooling in `skill-creator`, then fix whichever of the two artefacts is wrong: the skill if it does not do what the eval expects, or the eval if it describes a loop that no longer exists.
- **Why it matters / impact if skipped:** The eval file currently claims a level of verification the project has not actually done. That is the one kind of dishonesty this codebase has otherwise been careful to avoid.
- **Dependencies / notes:** Expect the run to surface wording changes in `SKILL.md` rather than code changes.
