import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { makeFixtureHome, withHome } from './helpers.mjs'

const fresh = () => import('../skills/token-coupons/src/discover.mjs?' + Math.random())

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
        const { discoverSkills } = await fresh()
        const skills = discoverSkills({ cwd: fx.home })
        const by = Object.fromEntries(skills.map((s) => [s.name, s]))
        assert.equal(skills.length, 5)
        assert.equal(by.alpha.mode, 'passive')
        assert.equal(by.alpha.gateDeclared, false)
        assert.equal(by.alpha.loaded, true)
        assert.equal(by.beta.mode, 'active')
        assert.equal(by.gamma.location, 'plugin-cache')
        assert.equal(by.gamma.editable, false)
        assert.equal(by.gamma.names[0], 'plug:gamma')
        assert.equal(by.gamma.loaded, true, 'no registry file: cache copies count as loaded')
        assert.equal(by.delta.location, 'project')
        assert.equal(by.delta.loaded, false, 'a project skill is not loaded from outside its project')
        assert.match(by.delta.loadedReason, /loads only when you work in/)
        assert.equal(by.eps.aliases.length, 2, 'symlink and target collapse to one row')
        assert.equal(by.eps.symlinks.length, 1)
        assert.equal(by.eps.loaded, true, 'a symlink under ~/.claude/skills loads the target')
        assert.equal(by.alpha.descriptionChars, 'Alpha does A.'.length)
      })
    } finally { fx.cleanup() }
  })

  test('folders belonging to other tools are not scanned at all', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'mine', description: 'In the Claude Code folder.' },
        { name: 'cursors', description: 'Cursor keeps this one.', where: 'cursor' },
        { name: 'agents', description: 'Another tool keeps this one.', where: 'agents-dir' },
        { name: 'linked', description: 'Kept elsewhere, linked into Claude Code.', where: 'agents-dir', symlinkAs: 'linked' },
      ],
    })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const names = discoverSkills({ cwd: fx.home }).map((s) => s.name).sort()
        // this tool is Claude Code only: another client's folder is not its business
        assert.deepEqual(names, ['linked', 'mine'])
      })
    } finally { fx.cleanup() }
  })

  test('a project skill is loaded when the working directory is inside that project', async () => {
    const fx = makeFixtureHome({ skills: [{ name: 'delta', description: 'Delta.', where: 'project', project: 'demo' }] })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const inside = discoverSkills({ cwd: join(fx.home, 'Projects', 'demo', 'src') })
        assert.equal(inside[0].loaded, true)
        const outside = discoverSkills({ cwd: fx.home })
        assert.equal(outside[0].loaded, false)
        // The same two questions with every symlink resolved. On macOS the
        // temp dir sits behind /var to /private/var, which used to hide a bug
        // that only showed on Linux: a project below the working directory
        // counted as loaded.
        const realHome = realpathSync(fx.home)
        const above = discoverSkills({ cwd: join(realHome, 'Projects') })
        assert.equal(above[0].loaded, false, 'a project below cwd is not loaded')
        const within = discoverSkills({ cwd: join(realHome, 'Projects', 'demo') })
        assert.equal(within[0].loaded, true, 'the project root itself is inside')
      })
    } finally { fx.cleanup() }
  })

  test('with a plugin registry, only installed and enabled plugin versions are loaded', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'on', description: 'Enabled.', where: 'plugin-cache', marketplace: 'mp', plugin: 'good', version: '1.0.0' },
        { name: 'off', description: 'Disabled.', where: 'plugin-cache', marketplace: 'mp', plugin: 'bad', version: '1.0.0' },
        { name: 'old', description: 'Old version.', where: 'plugin-cache', marketplace: 'mp', plugin: 'good', version: '0.9.0' },
      ],
      installed: [{ key: 'good@mp', marketplace: 'mp', plugin: 'good', version: '1.0.0' }, { key: 'bad@mp', marketplace: 'mp', plugin: 'bad', version: '1.0.0' }],
      settings: { model: 'opus[1m]', enabledPlugins: { 'good@mp': true, 'bad@mp': false } },
    })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const by = Object.fromEntries(discoverSkills({ cwd: fx.home }).map((s) => [s.name, s]))
        assert.equal(by.on.loaded, true)
        assert.equal(by.on.installKey, 'good@mp')
        assert.equal(by.off.loaded, false)
        assert.match(by.off.loadedReason, /disabled/)
        assert.equal(by.old.loaded, false)
        assert.match(by.old.loadedReason, /older version/)
      })
    } finally { fx.cleanup() }
  })

  test('source copies fold into their loaded plugin row and hand it an editable sourcePath', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'x', description: 'X does x.', where: 'plugin-cache', marketplace: 'mp', plugin: 'plug', version: '1.0.0' },
        { name: 'x', description: 'X does x.', where: 'marketplace', marketplace: 'mp' },
        { name: 'y', description: 'Y.', where: 'plugin-cache', marketplace: 'srcmp', plugin: 'plug2', version: '1.0.0' },
        { name: 'y', description: 'Y edited.', where: 'project-plugin', project: 'plug2-repo' },
      ],
      installed: [
        { key: 'plug@mp', marketplace: 'mp', plugin: 'plug', version: '1.0.0' },
        { key: 'plug2@srcmp', marketplace: 'srcmp', plugin: 'plug2', version: '1.0.0' },
      ],
      knownMarketplaces: { srcmp: { source: { source: 'directory', path: '__HOME__/Projects/plug2-repo' } } },
    })
    try {
      // known_marketplaces needs the absolute fixture path
      const { readFileSync, writeFileSync } = await import('node:fs')
      const kmPath = join(fx.home, '.claude', 'plugins', 'known_marketplaces.json')
      writeFileSync(kmPath, readFileSync(kmPath, 'utf8').replace('__HOME__', fx.home))
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const rows = discoverSkills({ cwd: fx.home })
        const x = rows.filter((r) => r.name === 'x')
        assert.equal(x.length, 1, 'marketplace checkout folded into the cache row')
        assert.equal(x[0].location, 'plugin-cache')
        assert.ok(x[0].sourcePath && x[0].sourcePath.includes('/marketplaces/mp/'))
        assert.equal(x[0].copies.length, 1)
        assert.equal(x[0].copies[0].sameDescription, true)
        const y = rows.filter((r) => r.name === 'y')
        assert.equal(y.length, 1, 'directory-sourced marketplace repo folded into the cache row')
        assert.ok(y[0].sourcePath && y[0].sourcePath.includes('plug2-repo'))
        assert.equal(y[0].copies[0].sameDescription, false, 'the repo copy has moved on')
      })
    } finally { fx.cleanup() }
  })
})
