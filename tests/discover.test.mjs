import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { makeFixtureHome, withHome } from './helpers.mjs'

const fresh = () => import('../skills/token-coupons/src/discover.mjs?' + Math.random())

describe('discover', () => {
  test('finds skills across roots, defaults mode to context, dedupes symlinks, classifies location', async () => {
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
        assert.equal(by.alpha.mode, 'context')
        assert.equal(by.alpha.gateDeclared, false)
        assert.equal(by.alpha.loaded, true)
        assert.equal(by.beta.mode, 'command')
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

  test('folders belonging to other tools are scanned, and each row says which tools list it', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'mine', description: 'In the Claude Code folder.' },
        { name: 'cursors', description: 'Cursor keeps this one.', where: 'cursor' },
        { name: 'agents', description: 'The shared folder keeps this one.', where: 'agents-dir' },
        { name: 'linked', description: 'Kept in the shared folder, linked into Claude Code and Cursor.', where: 'agents-dir', symlinkAs: 'linked', cursorSymlinkAs: 'linked' },
        { name: 'codexs', description: 'Codex keeps this one.', where: 'codex' },
        { name: 'shipped', description: 'Ships with Codex.', where: 'codex-system' },
        { name: 'geminis', description: 'Gemini CLI keeps this one.', where: 'gemini' },
        { name: 'deep', description: 'A skill inside a skill.', where: 'agents-nested', parent: 'agents' },
      ],
      codex: { config: '' },
      gemini: {},
    })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const rows = discoverSkills({ cwd: fx.home })
        const by = Object.fromEntries(rows.map((s) => [s.name, s]))
        assert.deepEqual(rows.map((s) => s.name).sort(), ['agents', 'codexs', 'cursors', 'deep', 'geminis', 'linked', 'mine', 'shipped'])
        // Claude Code's own view is unchanged: loaded means Claude Code lists it
        assert.equal(by.mine.loaded, true)
        assert.equal(by.cursors.loaded, false)
        assert.match(by.cursors.loadedReason, /Cursor skill; Claude Code does not read that folder/)
        assert.equal(by.linked.loaded, true)
        // and every row says which tools on this machine list it
        assert.deepEqual(by.mine.listedIn, ['claude', 'cursor'], 'Cursor reads ~/.claude/skills as well')
        assert.deepEqual(by.cursors.listedIn, ['cursor'])
        assert.deepEqual(by.agents.listedIn, ['codex', 'cursor'], 'the shared folder reaches both')
        assert.deepEqual(by.linked.listedIn, ['claude', 'codex', 'cursor'])
        assert.equal(by.linked.aliases.length, 3, 'real folder plus two shortcuts, one row')
        assert.deepEqual(by.codexs.listedIn, ['codex', 'cursor'], 'Cursor reads ~/.codex/skills as a compatibility path')
        assert.deepEqual(by.shipped.listedIn, ['codex'])
        assert.equal(by.shipped.location, 'codex-system')
        assert.equal(by.shipped.editable, false)
        assert.deepEqual(by.geminis.listedIn, ['gemini'])
        assert.deepEqual(by.deep.listedIn, ['codex'], 'Codex walks nested skills; Cursor publishes no rule, so it is not counted there')
        assert.match(by.deep.listing.cursor.reason, /publishes no rule/)
        assert.equal(by.deep.location, 'agents')
      })
    } finally { fx.cleanup() }
  })

  test('a tool that is not on this machine gets no verdict at all', async () => {
    const fx = makeFixtureHome({ skills: [{ name: 'mine', description: 'Mine.' }] })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const [row] = discoverSkills({ cwd: fx.home })
        assert.deepEqual(Object.keys(row.listing), ['claude'])
        assert.deepEqual(row.listedIn, ['claude'])
      })
    } finally { fx.cleanup() }
  })

  test('Codex config switches skills and plugins off, and the openai.yaml policy keeps one out of the list', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'on', description: 'On.', where: 'codex' },
        { name: 'off', description: 'Off.', where: 'codex' },
        { name: 'quiet', description: 'Explicit only.', where: 'codex', openaiPolicy: false },
        { name: 'loud', description: 'Explicit allowed.', where: 'codex', openaiPolicy: true },
        { name: 'plugged', description: 'From an enabled plugin.', where: 'codex-plugin-cache', marketplace: 'mp', plugin: 'good' },
        { name: 'unplugged', description: 'From a plugin nobody enabled.', where: 'codex-plugin-cache', marketplace: 'mp', plugin: 'bad' },
      ],
      codex: { config: '' },
    })
    try {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(fx.home, '.codex', 'config.toml'), [
        'model = "gpt-5.4"', '',
        '[[skills.config]]', 'path = "' + join(fx.home, '.codex', 'skills', 'off', 'SKILL.md') + '"', 'enabled = false', '',
        '[plugins."good@mp"]', 'enabled = true', '',
        '[plugins."bad@mp"]', 'enabled = false', '',
      ].join('\n'))
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const by = Object.fromEntries(discoverSkills({ cwd: fx.home }).map((s) => [s.name, s]))
        assert.equal(by.on.listing.codex.listed, true)
        assert.equal(by.off.listing.codex.listed, false)
        assert.match(by.off.listing.codex.reason, /switched off/)
        assert.equal(by.quiet.listing.codex.listed, false)
        assert.match(by.quiet.listing.codex.reason, /only \$quiet reaches it/)
        assert.equal(by.quiet.codexImplicit, false)
        assert.equal(by.loud.listing.codex.listed, true)
        assert.equal(by.loud.codexImplicit, true)
        assert.equal(by.plugged.listing.codex.listed, true)
        assert.equal(by.plugged.names[0], 'good:plugged')
        assert.equal(by.unplugged.listing.codex.listed, false)
        assert.match(by.unplugged.listing.codex.reason, /switched off/)
      })
    } finally { fx.cleanup() }
  })

  test('Cursor lists an installed, enabled plugin version and nothing else from its cache', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'live', description: 'Installed and enabled.', where: 'cursor-plugin-cache', pluginId: '100', ref: 'aaa' },
        { name: 'stale', description: 'An older commit.', where: 'cursor-plugin-cache', pluginId: '100', ref: 'zzz' },
        { name: 'dark', description: 'Installed, every capability off.', where: 'cursor-plugin-cache', pluginId: '200', ref: 'bbb' },
        { name: 'stray', description: 'Nothing declares it.', where: 'cursor-plugin-cache', pluginId: '300', ref: 'ccc' },
        { name: 'dev', description: 'Under development.', where: 'cursor-plugin-local', plugin: 'mine' },
        { name: 'builtin', description: 'Ships with Cursor.', where: 'cursor-builtin' },
      ],
      cursor: {
        plugins: {
          plugins: [
            { name: 'alpha', pluginId: '100', gitRef: 'aaa', enabledCapabilities: ['static'], declaredCapabilityPaths: { skill: ['skills/live/SKILL.md', 'skills/stale/SKILL.md'] } },
            { name: 'beta', pluginId: '200', gitRef: 'bbb', enabledCapabilities: [], declaredCapabilityPaths: { skill: ['skills/dark/SKILL.md'] } },
          ],
        },
      },
    })
    try {
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const by = Object.fromEntries(discoverSkills({ cwd: fx.home }).map((s) => [s.name, s]))
        assert.equal(by.live.listing.cursor.listed, true)
        assert.equal(by.live.plugin, 'alpha', 'the numeric cache folder is named through the manifest')
        assert.equal(by.stale.listing.cursor.listed, false)
        assert.match(by.stale.listing.cursor.reason, /older version/)
        assert.equal(by.dark.listing.cursor.listed, false)
        assert.match(by.dark.listing.cursor.reason, /disabled/)
        assert.equal(by.stray.listing.cursor.listed, false)
        assert.equal(by.dev.listing.cursor.listed, true)
        assert.equal(by.dev.location, 'cursor-plugin-local')
        assert.equal(by.builtin.listing.cursor.listed, true)
        assert.equal(by.builtin.location, 'cursor-builtin')
        assert.equal(by.builtin.editable, false)
      })
    } finally { fx.cleanup() }
  })

  test('Cursor caches a plugin twice and marks the installed copy, and only that copy counts', async () => {
    const fx = makeFixtureHome({
      skills: [
        { name: 'twin', description: 'The installed copy.', where: 'cursor-plugin-cache', pluginId: '100', ref: 'aaa' },
        { name: 'twin', description: 'The other copy.', where: 'cursor-plugin-cache', pluginId: 'alpha', ref: 'aaa' },
      ],
      cursor: { plugins: { plugins: [{ name: 'alpha', pluginId: '100', gitRef: 'aaa', enabledCapabilities: ['static'], declaredCapabilityPaths: { skill: ['skills/twin/SKILL.md'] } }] } },
    })
    try {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(fx.home, '.cursor', 'plugins', 'cache', 'cursor-public', '100', 'aaa.installed'), '')
      await withHome(fx.home, async () => {
        const { discoverSkills } = await fresh()
        const rows = discoverSkills({ cwd: fx.home }).filter((s) => s.name === 'twin')
        assert.equal(rows.length, 2)
        const listed = rows.filter((r) => r.listing.cursor.listed)
        assert.equal(listed.length, 1)
        assert.ok(listed[0].realPath.includes('/100/'))
        const other = rows.find((r) => !r.listing.cursor.listed)
        assert.match(other.listing.cursor.reason, /second copy/)
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
