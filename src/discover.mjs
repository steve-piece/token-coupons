// Discovery: every skill the machine can see, what its frontmatter declares,
// and where it lives. A skill is a directory with SKILL.md; the invocable name
// is the directory name, prefixed with plugin: when it lives inside a plugin.
// Deduplicated by real path so a symlinked skill is one row with aliases.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

import { listDir, isDir, isSymlink, parseFrontmatter, readText } from './lib/util.mjs'
import { homeDir, claudeDir, pluginsDir } from './paths.mjs'

export function skillRoots () {
  const HOME = homeDir()
  const roots = [
    join(claudeDir(), 'skills'),
    join(HOME, '.agents', 'skills'),
    join(HOME, '.cursor', 'skills'),
  ]
  const marketplaces = join(pluginsDir(), 'marketplaces')
  for (const mp of listDir(marketplaces)) {
    roots.push(join(marketplaces, mp, 'skills'))
    // marketplaces that are themselves collections of single-skill plugins
    for (const sub of listDir(join(marketplaces, mp))) {
      const d = join(marketplaces, mp, sub)
      if (isDir(d) && existsSync(join(d, 'SKILL.md'))) roots.push(join(marketplaces, mp))
    }
  }
  const cache = join(pluginsDir(), 'cache')
  for (const mp of listDir(cache)) {
    for (const plugin of listDir(join(cache, mp))) {
      for (const ver of listDir(join(cache, mp, plugin))) {
        roots.push(join(cache, mp, plugin, ver, 'skills'))
        roots.push(join(cache, mp, plugin, ver, '.claude', 'skills'))
      }
    }
  }
  // project-level skills under ~/Projects, shallow
  const projects = join(HOME, 'Projects')
  for (const rel of walkDirs(projects, 4)) {
    if (basename(rel) === 'skills') roots.push(join(projects, rel))
    if (basename(rel) === '.claude') roots.push(join(projects, rel, 'skills'))
  }
  return [...new Set(roots)].filter(isDir)
}

function walkDirs (dir, depth, base = dir, out = [], cur = 0) {
  if (cur >= depth) return out
  for (const name of listDir(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.next') continue
    const full = join(dir, name)
    if (!isDir(full)) continue
    out.push(full.slice(base.length + 1))
    walkDirs(full, depth, base, out, cur + 1)
  }
  return out
}

/**
 * Where a skill lives decides what `apply` may do to it. Anything under the
 * plugin cache is overwritten on the next plugin update, so it is not editable
 * in place; the fix belongs in the plugin's source repo.
 */
export function classifyLocation (real, dir) {
  const HOME = homeDir()
  if (real.includes('/.claude/plugins/cache/')) return { location: 'plugin-cache', editable: false }
  if (real.includes('/.claude/plugins/marketplaces/')) return { location: 'marketplace', editable: true }
  if (dir.startsWith(join(HOME, '.claude', 'skills')) && isSymlink(dir)) return { location: 'user-symlink', editable: true }
  if (dir.startsWith(join(HOME, '.claude', 'skills'))) return { location: 'user', editable: true }
  if (dir.startsWith(join(HOME, '.agents', 'skills'))) return { location: 'agents-dir', editable: true }
  if (dir.startsWith(join(HOME, '.cursor', 'skills'))) return { location: 'cursor', editable: true }
  if (dir.startsWith(join(HOME, 'Projects'))) return { location: 'project', editable: true }
  return { location: 'other', editable: true }
}

export function discoverSkills () {
  const byReal = new Map()
  for (const root of skillRoots()) {
    // some roots ARE the skill (single-skill plugin roots collected above)
    const candidates = existsSync(join(root, 'SKILL.md')) ? [root] : listDir(root).map((n) => join(root, n))
    for (const dir of candidates) {
      const skillMd = join(dir, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      let real
      try { real = realpathSync(dir) } catch { continue }
      const fm = parseFrontmatter(readText(skillMd) || '')
      const name = (fm.ok && fm.data.name) ? String(fm.data.name) : basename(dir)
      const plugin = pluginNameFor(real)
      const invocable = plugin ? plugin + ':' + basename(dir) : basename(dir)
      const gate = fm.ok ? fm.data['disable-model-invocation'] : undefined
      const mode = String(gate).toLowerCase() === 'true' ? 'active' : 'passive'
      const description = fm.ok ? String(fm.data.description || '') : ''
      const existing = byReal.get(real)
      if (existing) {
        if (!existing.aliases.includes(dir)) existing.aliases.push(dir)
        if (!existing.names.includes(invocable)) existing.names.push(invocable)
        // a symlink alias in ~/.claude/skills makes the row user-editable and unlinkable
        const loc = classifyLocation(real, dir)
        if (loc.location === 'user-symlink') existing.symlinks.push(dir)
        continue
      }
      const loc = classifyLocation(real, dir)
      let modifiedOn = null
      try { modifiedOn = statSync(skillMd).mtime.toISOString().slice(0, 10) } catch { /* leave null */ }
      byReal.set(real, {
        name: basename(dir),
        names: [invocable, basename(dir)].filter((v, i, a) => a.indexOf(v) === i),
        frontmatterName: name,
        realPath: real,
        skillMd: join(real, 'SKILL.md'),
        aliases: [dir],
        symlinks: loc.location === 'user-symlink' ? [dir] : [],
        plugin: plugin || null,
        location: loc.location,
        editable: loc.editable,
        mode,
        gateDeclared: gate !== undefined,
        gateValue: gate === undefined ? null : String(gate),
        description,
        descriptionChars: description.length,
        modifiedOn,
      })
    }
  }
  return [...byReal.values()]
}

/** If this skill sits inside a plugin tree, return the plugin name for name:skill attribution. */
export function pluginNameFor (real) {
  // .../cache/<marketplace>/<plugin>/<version>/skills/<skill>
  const m = real.match(/\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/(?:\.claude\/)?skills\/[^/]+$/)
  if (m) return m[1]
  // .../marketplaces/<mp>/skills/<skill>  -> plugin is the marketplace-level plugin.json name
  const m2 = real.match(/\/plugins\/marketplaces\/([^/]+)\/skills\/[^/]+$/)
  if (m2) return manifestName(real.replace(/\/skills\/[^/]+$/, '')) || m2[1]
  // any tree with .claude-plugin/plugin.json above skills/
  const m3 = real.match(/^(.*)\/skills\/[^/]+$/)
  if (m3) return manifestName(m3[1])
  return null
}

function manifestName (root) {
  for (const rel of ['.claude-plugin/plugin.json', 'plugin.json']) {
    const t = readText(join(root, rel))
    if (!t) continue
    try { const n = JSON.parse(t).name; if (n) return String(n) } catch { /* fallthrough */ }
  }
  return null
}
