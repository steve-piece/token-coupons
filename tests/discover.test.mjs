import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeFixtureHome, withHome } from './helpers.mjs'

describe('discover', () => {
  test('finds skills across roots, defaults mode to passive, dedupes symlinks, classifies location', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'alpha', description: 'Alpha does A.' },
        { name: 'beta', description: 'Beta does B.', gate: 'true' },
        { name: 'gamma', description: 'Gamma.', where: 'plugin-cache', plugin: 'plug' },
        { name: 'delta', description: 'Delta lives in a project.', where: 'project', project: 'demo' },
        { name: 'eps', description: 'Eps in a repo, symlinked.', where: 'project-plugin', project: 'lib', symlinkAs: 'eps' },
      ],
    })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await import('../src/discover.mjs?' + Math.random())
        const skills = discoverSkills()
        const by = Object.fromEntries(skills.map((s) => [s.name, s]))
        assert.equal(skills.length, 5)
        assert.equal(by.alpha.mode, 'passive')
        assert.equal(by.alpha.gateDeclared, false)
        assert.equal(by.beta.mode, 'active')
        assert.equal(by.gamma.location, 'plugin-cache')
        assert.equal(by.gamma.editable, false)
        assert.equal(by.gamma.names[0], 'plug:gamma')
        assert.equal(by.delta.location, 'project')
        assert.equal(by.eps.aliases.length, 2, 'symlink and target collapse to one row')
        assert.equal(by.eps.symlinks.length, 1)
        assert.equal(by.alpha.descriptionChars, 'Alpha does A.'.length)
      })
    } finally { fx.cleanup() }
  })
})
