import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { makeFixtureHome, withHome } from './helpers.mjs'
import { parseEdits, planDescribe, applyDescribe, summarizeDescribe } from '../skills/token-coupons/src/describe.mjs'
import { discoverSkills } from '../skills/token-coupons/src/discover.mjs'
import { parseFrontmatter, setFrontmatterText } from '../skills/token-coupons/src/lib/util.mjs'

const LONG = 'Rewrite the description so it names what the skill does, the words a person would say when they want it, and where it stops.'

function fixture () {
  return makeFixtureHome({
    skills: [
      { name: 'alpha', description: 'Alpha does the alpha thing.' },
      { name: 'beta', description: 'Beta is gated already.', gate: 'true' },
      { name: 'gamma', description: 'Gamma lives in a plugin cache.', where: 'plugin-cache', plugin: 'plug' },
    ],
  })
}

describe('setFrontmatterText', () => {
  test('replaces a single line description with a folded block that reads back the same', () => {
    const before = '---\nname: a\ndescription: Short one.\nallowed-tools: Read\n---\n\n# a\n\nBody.\n'
    const res = setFrontmatterText(before, 'description', LONG)
    assert.equal(res.ok, true, res.reason)
    assert.match(res.text, /^description: >-$/m)
    assert.equal(parseFrontmatter(res.text).data.description, LONG)
    assert.match(res.text, /^allowed-tools: Read$/m, 'every other key is left alone')
    assert.match(res.text, /# a\n\nBody\./, 'the body is untouched')
  })

  test('replaces a block description without eating the keys or the blank line after it', () => {
    const before = [
      '---',
      'name: a',
      'description: >-',
      '  One line of the old description,',
      '  and a second line of it.',
      'disable-model-invocation: true',
      '',
      '---',
      '',
      'Body.',
      '',
    ].join('\n')
    const res = setFrontmatterText(before, 'description', 'A new one.')
    assert.equal(res.ok, true, res.reason)
    const fm = parseFrontmatter(res.text)
    assert.equal(fm.data.description, 'A new one.')
    assert.equal(fm.data['disable-model-invocation'], 'true')
    assert.equal(res.text.split('One line of the old').length, 1, 'the old value is gone')
    assert.match(res.text, /\n\n---\n/, 'the blank line before the closing fence survives')
  })

  test('wraps long text, adds the key when it is missing, and refuses empty or fenceless files', () => {
    const res = setFrontmatterText('---\nname: a\n---\n\nBody.\n', 'description', LONG)
    assert.equal(res.ok, true)
    assert.equal(parseFrontmatter(res.text).data.description, LONG)
    for (const line of res.text.split('\n')) assert.ok(line.length <= 96, 'no line runs past the wrap width: ' + line)

    assert.equal(setFrontmatterText('---\nname: a\n---\n', 'description', '   ').ok, false)
    assert.equal(setFrontmatterText('no fence here\n', 'description', 'x').ok, false)
    assert.equal(setFrontmatterText('---\nname: a\n', 'description', 'x').ok, false)
  })
})

describe('describe: reading the file', () => {
  test('accepts the documented shape, a bare array, and an apply worklist', () => {
    const doc = parseEdits(JSON.stringify({ version: 1, descriptions: [{ name: 'alpha', description: 'x' }] }))
    assert.equal(doc.ok, true)
    assert.equal(doc.edits[0].description, 'x')

    const bare = parseEdits(JSON.stringify([{ name: 'alpha', description: 'x' }]))
    assert.equal(bare.ok, true)

    const work = parseEdits(JSON.stringify({ worklist: [{ name: 'alpha', path: '/p/SKILL.md', newDescription: 'x' }] }))
    assert.equal(work.ok, true)
    assert.equal(work.edits[0].description, 'x')
  })

  test('refuses a file it cannot read as a whole', () => {
    assert.match(parseEdits('').reason, /empty/)
    assert.match(parseEdits('nope').reason, /valid JSON/)
    assert.match(parseEdits('{"version": 9, "descriptions": []}').reason, /version 9/)
    assert.match(parseEdits('{"other": []}').reason, /"descriptions" list/)
    assert.match(parseEdits('{"descriptions": [{"description": "x"}]}').reason, /neither a name nor a path/)
  })
})

describe('describe: planning and writing', () => {
  test('a dry run changes nothing and shows the character count both ways', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const md = join(fx.skillPath('alpha'), 'SKILL.md')
        const before = readFileSync(md, 'utf8')
        const plan = planDescribe([{ name: 'alpha', description: LONG }], { skills: discoverSkills() })
        const result = applyDescribe(plan, { yes: false, trashDir: join(fx.home, 'trash') })
        assert.equal(result.dryRun, true)
        assert.equal(result.applied, 0)
        assert.equal(result.steps[0].kind, 'write-description')
        assert.equal(result.steps[0].beforeChars, 'Alpha does the alpha thing.'.length)
        assert.equal(result.steps[0].afterChars, LONG.length)
        assert.equal(readFileSync(md, 'utf8'), before, 'nothing was written')
        assert.match(summarizeDescribe(result), /Plan only/)
      })
    } finally { fx.cleanup() }
  })

  test('with --yes it writes the one key, keeps a copy first, and the undo line restores it', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const md = join(fx.skillPath('beta'), 'SKILL.md')
        const before = readFileSync(md, 'utf8')
        const plan = planDescribe([{ name: 'beta', description: LONG }], { skills: discoverSkills() })
        const result = applyDescribe(plan, { yes: true, trashDir: join(fx.home, 'trash') })
        assert.equal(result.applied, 1)
        assert.equal(result.steps[0].error, null)

        const after = readFileSync(md, 'utf8')
        const fm = parseFrontmatter(after)
        assert.equal(fm.data.description, LONG)
        assert.equal(fm.data['disable-model-invocation'], 'true', 'the gate line is left where it was')
        assert.match(after, /# beta/, 'the body is left alone')

        const backup = result.steps[0].backup
        assert.ok(existsSync(backup), 'the file it replaced was copied first')
        assert.equal(readFileSync(backup, 'utf8'), before)
        assert.match(result.steps[0].undo, /^cp /)
      })
    } finally { fx.cleanup() }
  })

  test('refuses an empty description, one past the cap, and a skill that is not installed', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planDescribe([
          { name: 'alpha', description: '' },
          { name: 'alpha', description: 'x'.repeat(1600) },
          { name: 'nope', description: LONG },
        ], { skills })
        assert.equal(plan.steps.length, 3)
        assert.equal(plan.steps.every((s) => s.kind === 'refuse'), true)
        assert.match(plan.refused[0].reason, /empty description/)
        assert.match(plan.refused[1].reason, /1536 character cap/)
        assert.match(plan.refused[2].reason, /no installed skill matches/)
        assert.match(summarizeDescribe(applyDescribe(plan, { yes: true })), /Refused/)
      })
    } finally { fx.cleanup() }
  })

  test('text that already matches is a no change step, and saved tokens only count real writes', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const same = planDescribe([{ name: 'alpha', description: 'Alpha does the alpha thing.' }], { skills })
        assert.equal(same.steps[0].kind, 'noop')
        const r = applyDescribe(same, { yes: true, trashDir: join(fx.home, 'trash') })
        assert.equal(r.applied, 0)
        assert.equal(r.savedTokens, 0)

        const shorter = planDescribe([{ name: 'beta', description: 'Beta.' }], { skills })
        const w = applyDescribe(shorter, { yes: true, trashDir: join(fx.home, 'trash') })
        assert.ok(w.savedTokens > 0, 'a shorter description reports what it took off every message')
      })
    } finally { fx.cleanup() }
  })

  test('a plugin cache skill is written to its source copy when one is on this machine', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'gamma', description: 'Gamma in the cache.', where: 'plugin-cache', marketplace: 'srcmp', plugin: 'plug', version: '1.0.0' },
        { name: 'gamma', description: 'Gamma in the cache.', where: 'project-plugin', project: 'plug-src' },
      ],
      installed: [{ key: 'plug@srcmp', marketplace: 'srcmp', plugin: 'plug', version: '1.0.0' }],
      knownMarketplaces: { srcmp: { source: { source: 'directory', path: '__HOME__/Projects/plug-src' } } },
    })
    try {
      // known_marketplaces holds an absolute path, so the fixture home goes in
      // only once the temporary directory exists.
      const km = join(fx.home, '.claude', 'plugins', 'known_marketplaces.json')
      writeFileSync(km, readFileSync(km, 'utf8').replace('__HOME__', fx.home))
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planDescribe([{ name: 'gamma', description: LONG }], { skills })
        assert.equal(plan.steps.length, 1)
        const step = plan.steps[0]
        assert.equal(step.kind, 'write-description')
        assert.match(step.path, /plug-src/, 'the source copy is the one that gets edited')
        assert.match(step.detail, /source copy/)
        applyDescribe(plan, { yes: true, trashDir: join(fx.home, 'trash') })
        assert.equal(parseFrontmatter(readFileSync(step.path, 'utf8')).data.description, LONG)
      })
    } finally { fx.cleanup() }
  })

  test('a SKILL.md with no readable settings block is refused, not rewritten', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const md = join(fx.skillPath('alpha'), 'SKILL.md')
        writeFileSync(md, 'no frontmatter at all\n')
        const plan = planDescribe([{ name: 'alpha', path: fx.skillPath('alpha'), description: LONG }], { skills: discoverSkills() })
        assert.equal(plan.steps[0].kind, 'refuse')
        assert.match(plan.refused[0].reason, /cannot be edited safely/)
        assert.equal(readFileSync(md, 'utf8'), 'no frontmatter at all\n')
      })
    } finally { fx.cleanup() }
  })
})
