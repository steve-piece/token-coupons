import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, readlinkSync, lstatSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { makeFixtureHome, withHome } from './helpers.mjs'
import { parseDecisions, planApply, applyPlan, summarizeApply, trashStamp } from '../src/apply.mjs'
import { discoverSkills } from '../src/discover.mjs'

// A fixed local time, so the trash folder name is the same on every machine.
const NOW = new Date(2026, 7, 15, 12, 34, 56)
const STAMP = '20260815-123456'

const DELTA_DESC = 'Delta lives in a project and carries a description long enough to be worth a rewrite pass.'

function fixture () {
  return makeFixtureHome({
    skills: [
      { name: 'alpha', description: 'Alpha does A.' },
      { name: 'beta', description: 'Beta does B.', gate: 'false' },
      { name: 'zeta', description: 'Zeta does Z.', gate: 'true' },
      { name: 'theta', description: 'Theta does T.' },
      { name: 'gamma', description: 'Gamma ships inside a plugin.', where: 'plugin-cache', plugin: 'plug' },
      { name: 'delta', description: DELTA_DESC, where: 'project', project: 'demo' },
      { name: 'eps', description: 'Eps is symlinked in.', where: 'project-plugin', project: 'lib', symlinkAs: 'eps' },
    ],
  })
}

const decisionsFile = {
  version: 1,
  generatedOn: '2026-08-15',
  source: 'token-coupons html report',
  decisions: [
    { name: 'alpha', path: '~/.claude/skills/alpha', action: 'delete', note: '' },
    { name: 'beta', action: 'active', note: '' },
    { name: 'zeta', action: 'passive', note: '' },
    { name: 'theta', action: 'keep', note: '' },
    { name: 'plug:gamma', action: 'delete', note: '' },
    { name: 'delta', action: 'optimize', note: '' },
    { name: 'eps', action: 'delete', note: '' },
    { name: 'nope', action: 'delete', note: '' },
  ],
}

/** Every file, folder and shortcut under a root, so a dry run can be proved inert. */
function snapshot (root) {
  const out = {}
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const key = rel ? rel + '/' + name : name
      const st = lstatSync(full)
      if (st.isSymbolicLink()) out[key] = 'shortcut to ' + readlinkSync(full)
      else if (st.isDirectory()) { out[key] = 'folder'; walk(full, key) }
      else out[key] = readFileSync(full, 'utf8')
    }
  }
  walk(root, '')
  return out
}

function kindsOf (plan) {
  const out = {}
  for (const s of plan.steps) out[s.name] = s.kind
  return out
}

describe('parseDecisions', () => {
  test('accepts the exported shape and normalises every entry', () => {
    const res = parseDecisions(JSON.stringify(decisionsFile))
    assert.equal(res.ok, true)
    assert.equal(res.reason, null)
    assert.equal(res.decisions.length, 8)
    assert.deepEqual(res.decisions[1], { name: 'beta', path: '', action: 'active', note: '' })
  })

  test('accepts a bare list of decisions', () => {
    const res = parseDecisions(JSON.stringify(decisionsFile.decisions))
    assert.equal(res.ok, true)
    assert.equal(res.decisions.length, 8)
  })

  test('rejects what it cannot use, in plain words', () => {
    assert.equal(parseDecisions('').ok, false)
    assert.match(parseDecisions('{').reason, /not valid JSON/)
    assert.match(parseDecisions('{"version":1}').reason, /needs a "decisions" list/)
    assert.match(parseDecisions('{"version":2,"decisions":[]}').reason, /version 1/)
    assert.match(parseDecisions('{"decisions":[{"action":"delete"}]}').reason, /neither a name nor a path/)
    assert.match(parseDecisions('{"decisions":["alpha"]}').reason, /not an object/)
  })
})

describe('planApply', () => {
  test('gives every decision the right kind of step, and every step an undo line', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply(parseDecisions(JSON.stringify(decisionsFile)).decisions, { skills })
        const kinds = kindsOf(plan)

        assert.equal(kinds.alpha, 'trash')
        assert.equal(kinds.beta, 'set-gate')
        assert.equal(kinds.zeta, 'unset-gate')
        assert.equal(kinds.delta, 'worklist')
        assert.equal(kinds.eps, 'unlink')
        assert.equal(kinds['plug:gamma'], 'refuse')
        assert.equal(kinds.nope, 'refuse')
        assert.equal(kinds.theta, undefined, 'keep never becomes a step')

        assert.equal(plan.steps.length, 7)
        for (const s of plan.steps) {
          assert.ok(s.undo && s.undo.length > 4, s.name + ' has no undo line')
          assert.ok(s.detail && s.detail.length > 4, s.name + ' has no detail line')
        }
      })
    } finally { fx.cleanup() }
  })

  test('matches by path with a leading ~, and by name when there is no path', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const byPath = planApply([{ name: 'wrong-name-on-purpose', path: '~/.claude/skills/alpha', action: 'delete' }], { skills })
        assert.equal(byPath.steps[0].kind, 'trash')
        assert.equal(byPath.steps[0].name, 'alpha')

        const byName = planApply([{ name: 'plug:gamma', action: 'optimize' }], { skills })
        assert.equal(byName.steps[0].kind, 'worklist')
        assert.equal(byName.worklist[0].name, 'plug:gamma')
      })
    } finally { fx.cleanup() }
  })

  test('refuses an unknown skill and an unknown action', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply([
          { name: 'nope', action: 'delete' },
          { name: 'alpha', action: 'incinerate' },
        ], { skills })
        assert.equal(plan.refused.length, 2)
        assert.match(plan.refused[0].reason, /no installed skill matches/)
        assert.match(plan.refused[1].reason, /is not an action this tool knows/)
        assert.equal(snapshotHasAlpha(fx.home), true)
      })
    } finally { fx.cleanup() }
  })

  test('worklist carries the current description, its size, and the target size', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply([{ name: 'delta', action: 'optimize' }], { skills })
        assert.equal(plan.worklist.length, 1)
        assert.equal(plan.worklist[0].currentDescription, DELTA_DESC)
        assert.equal(plan.worklist[0].currentChars, DELTA_DESC.length)
        assert.equal(plan.worklist[0].targetChars, 350, 'default target')

        const tuned = planApply([{ name: 'delta', action: 'optimize' }], { skills, thresholds: { optimizeTargetChars: 200 } })
        assert.equal(tuned.worklist[0].targetChars, 200)
      })
    } finally { fx.cleanup() }
  })

  test('asking for a state a skill is already in is a noop, not an edit', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply([
          { name: 'zeta', action: 'active' },
          { name: 'alpha', action: 'passive' },
        ], { skills })
        assert.deepEqual(plan.steps.map((s) => s.kind), ['noop', 'noop'])
      })
    } finally { fx.cleanup() }
  })
})

function snapshotHasAlpha (home) {
  return existsSync(join(home, '.claude', 'skills', 'alpha', 'SKILL.md'))
}

describe('applyPlan', () => {
  test('a dry run changes nothing on disk and still shows where every folder would land', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply(decisionsFile, { skills })
        const trash = join(fx.home, 'trashcan')
        const before = snapshot(fx.home)

        const res = applyPlan(plan, { yes: false, trashDir: trash, now: NOW })

        assert.equal(res.dryRun, true)
        assert.equal(res.applied, 0)
        assert.equal(res.skipped, res.steps.length)
        assert.equal(existsSync(trash), false, 'the trash folder is not even created')
        assert.deepEqual(snapshot(fx.home), before, 'not one byte moved')

        const trashStep = res.steps.find((s) => s.kind === 'trash')
        assert.equal(trashStep.to, join(trash, STAMP, 'alpha'))
        assert.match(trashStep.undo, /^mv /)
      })
    } finally { fx.cleanup() }
  })

  test('with yes it flips the gate and leaves every other byte of the file alone', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const betaMd = join(fx.home, '.claude', 'skills', 'beta', 'SKILL.md')
        const zetaMd = join(fx.home, '.claude', 'skills', 'zeta', 'SKILL.md')
        const betaBefore = readFileSync(betaMd, 'utf8')
        const zetaBefore = readFileSync(zetaMd, 'utf8')

        const plan = planApply(decisionsFile, { skills })
        applyPlan(plan, { yes: true, trashDir: join(fx.home, 'trashcan'), now: NOW })

        // active: exactly one line differs, and it is the gate line
        const betaAfter = readFileSync(betaMd, 'utf8')
        const a = betaBefore.split('\n')
        const b = betaAfter.split('\n')
        assert.equal(a.length, b.length)
        const changed = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y)
        assert.deepEqual(changed, [['disable-model-invocation: false', 'disable-model-invocation: true']])

        // passive: the gate line is gone and nothing else moved
        const zetaAfter = readFileSync(zetaMd, 'utf8')
        assert.equal(zetaAfter.includes('disable-model-invocation'), false)
        assert.equal(zetaAfter, zetaBefore.split('\n').filter((l) => !l.startsWith('disable-model-invocation:')).join('\n'))
      })
    } finally { fx.cleanup() }
  })

  test('with yes it unlinks the shortcut and leaves the real folder alone', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const link = join(fx.home, '.claude', 'skills', 'eps')
        const target = join(fx.home, 'Projects', 'lib', 'skills', 'eps')
        assert.equal(lstatSync(link).isSymbolicLink(), true)

        const plan = planApply(decisionsFile, { skills })
        const res = applyPlan(plan, { yes: true, trashDir: join(fx.home, 'trashcan'), now: NOW })

        assert.equal(existsSync(link), false)
        assert.equal(existsSync(join(target, 'SKILL.md')), true, 'the real skill survives')
        const step = res.steps.find((s) => s.kind === 'unlink')
        assert.equal(step.done, true)
        assert.match(step.undo, /^ln -s /)
        assert.ok(step.undo.endsWith(' ' + link))
      })
    } finally { fx.cleanup() }
  })

  test('with yes it moves a user skill into the dated trash folder', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const trash = join(fx.home, 'trashcan')
        const plan = planApply(decisionsFile, { skills })
        const res = applyPlan(plan, { yes: true, trashDir: trash, now: NOW })

        const moved = join(trash, STAMP, 'alpha')
        assert.equal(existsSync(join(fx.home, '.claude', 'skills', 'alpha')), false, 'gone from where it was')
        assert.equal(readFileSync(join(moved, 'SKILL.md'), 'utf8').includes('name: alpha'), true, 'and intact in the trash')

        const step = res.steps.find((s) => s.kind === 'trash')
        assert.equal(step.done, true)
        assert.equal(step.error, null)
        assert.equal(step.to, moved)
        assert.equal(step.undo, 'mv ' + moved + ' ' + step.path)
        assert.equal(res.stamp, STAMP)
      })
    } finally { fx.cleanup() }
  })

  test('a plugin copy is refused with the uninstall hint and is still on disk after', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const gamma = skills.find((s) => s.name === 'gamma')
        const plan = planApply(decisionsFile, { skills })
        applyPlan(plan, { yes: true, trashDir: join(fx.home, 'trashcan'), now: NOW })

        const refusal = plan.refused.find((r) => r.name === 'plug:gamma')
        assert.equal(refusal.action, 'delete')
        assert.ok(refusal.reason.includes('run: claude plugin uninstall plug'), refusal.reason)
        assert.equal(existsSync(join(gamma.realPath, 'SKILL.md')), true, 'nothing was deleted')
      })
    } finally { fx.cleanup() }
  })

  test('counts what it did and passes the worklist and refusals through', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply(decisionsFile, { skills })
        const res = applyPlan(plan, { yes: true, trashDir: join(fx.home, 'trashcan'), now: NOW })
        assert.equal(res.dryRun, false)
        assert.equal(res.applied, 4, 'trash, set-gate, unset-gate, unlink')
        assert.equal(res.skipped, 3, 'worklist and two refusals')
        assert.equal(res.worklist.length, 1)
        assert.equal(res.refused.length, 2)
        assert.equal(res.steps.every((s) => s.error === null), true)
      })
    } finally { fx.cleanup() }
  })

  test('a step whose file cannot be edited safely is refused rather than guessed at', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills().map((s) => (s.name === 'alpha' ? Object.assign({}, s, { skillMd: join(s.realPath, 'MISSING.md') }) : s))
        const plan = planApply([{ name: 'alpha', action: 'active' }], { skills })
        assert.equal(plan.steps[0].kind, 'refuse')
        assert.match(plan.refused[0].reason, /could not read/)
      })
    } finally { fx.cleanup() }
  })
})

describe('summarizeApply', () => {
  test('prints every step with its undo line, the rewrite list, and the refusals', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply(decisionsFile, { skills })
        const text = summarizeApply(applyPlan(plan, { yes: false, trashDir: join(fx.home, 'trashcan'), now: NOW }))

        assert.match(text, /Plan only\. Nothing on your disk was changed\./)
        assert.equal(/\u001b\[/.test(text), false, 'no color codes')
        for (const s of plan.steps) assert.ok(text.includes(s.name), 'missing step ' + s.name)
        assert.equal(text.split('\n').filter((l) => l.includes('undo: ')).length, plan.steps.length)
        assert.match(text, /Rewrite these descriptions/)
        assert.ok(text.includes(DELTA_DESC.length + ' characters now, aim for about 350 characters'))
        assert.match(text, /Refused/)
        assert.ok(text.includes('run: claude plugin uninstall plug'))
      })
    } finally { fx.cleanup() }
  })

  test('after a real run it reports what was carried out', async () => {
    const fx = fixture()
    try {
      await withHome(fx.home, () => {
        const skills = discoverSkills()
        const plan = planApply(decisionsFile, { skills })
        const text = summarizeApply(applyPlan(plan, { yes: true, trashDir: join(fx.home, 'trashcan'), now: NOW }))
        assert.match(text, /Carried out 4 of 7 steps\./)
        assert.match(text, /\[done\] trash {2}alpha/)
      })
    } finally { fx.cleanup() }
  })
})

describe('trashStamp', () => {
  test('reads YYYYMMDD-HHMMSS in local time', () => {
    assert.equal(trashStamp(NOW), STAMP)
    assert.equal(trashStamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405')
    assert.match(trashStamp(null), /^\d{8}-\d{6}$/)
  })
})

describe('the prompt cache warning', () => {
  test('a plan that writes says the listing change costs one re-send, and a plan that does not stays quiet', async () => {
    const { summarizeApply, cacheNote } = await import('../src/apply.mjs')
    const writes = { dryRun: true, applied: 0, steps: [{ name: 'a', action: 'active', kind: 'set-gate', detail: 'd', undo: 'u' }], worklist: [], refused: [] }
    assert.match(summarizeApply(writes), /re-send its whole conversation at full price/)
    assert.match(summarizeApply(writes), /\/clear/)

    const done = { dryRun: false, applied: 1, steps: writes.steps.map((s) => ({ ...s, done: true })), worklist: [], refused: [] }
    assert.match(summarizeApply(done), /The skill list has changed/)

    const nothing = { dryRun: true, applied: 0, steps: [{ name: 'a', action: 'keep', kind: 'noop', detail: 'd', undo: 'u' }], worklist: [], refused: [] }
    assert.equal(cacheNote(nothing), '', 'a plan that changes no skill file has no cache cost')
    assert.equal(cacheNote({ steps: [] }), '')

    // a rewrite is a file edit too, but it is the agent that edits it later, so
    // the warning belongs to the steps that actually touch a skill now
    const worklistOnly = { dryRun: true, applied: 0, steps: [{ name: 'a', action: 'optimize', kind: 'worklist', detail: 'd', undo: 'u' }], worklist: [], refused: [] }
    assert.equal(cacheNote(worklistOnly), '')
  })
})
