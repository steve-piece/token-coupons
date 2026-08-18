// Discovery: every skill the machine can see, what its frontmatter declares,
// where it lives, and whether Claude Code actually puts it in the listing.
//
// A skill is a directory with SKILL.md; the invocable name is the directory
// name, prefixed with plugin: when it lives inside a plugin. Rows are
// deduplicated by real path so a symlinked skill is one row with aliases.
//
// This tool is Claude Code only, so the folders it looks in are the ones
// Claude Code reads (code.claude.com/docs/en/skills): ~/.claude/skills, the
// .claude/skills of the project you are working in, and the skills of ENABLED
// plugins from the plugin cache. Folders belonging to other tools are not
// scanned at all; inventorying another client's skills would be noise here.
//
// Of the folders it does scan, not all are in the listing: marketplace
// checkouts, plugin source repos, other projects, disabled plugins and stale
// cache versions sit on disk without costing anything per message. Those are
// reported separately as notLoaded rather than scored.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, basename, sep } from 'node:path'

import { listDir, isDir, isSymlink, parseFrontmatter, readText, readJson } from './lib/util.mjs'
import { homeDir, claudeDir, pluginsDir, settingsFiles } from './paths.mjs'

export function skillRoots () {
  const HOME = homeDir()
  const roots = [join(claudeDir(), 'skills')]
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
 * in place; the fix belongs in the plugin's source repo (linked as sourcePath
 * when that repo is on this machine).
 */
export function classifyLocation (real, dir) {
  const HOME = homeDir()
  if (real.includes('/.claude/plugins/cache/')) return { location: 'plugin-cache', editable: false }
  if (real.includes('/.claude/plugins/marketplaces/')) return { location: 'marketplace', editable: true }
  if (dir.startsWith(join(HOME, '.claude', 'skills')) && isSymlink(dir)) return { location: 'user-symlink', editable: true }
  if (dir.startsWith(join(HOME, '.claude', 'skills'))) return { location: 'user', editable: true }
  if (dir.startsWith(join(HOME, 'Projects')) && /\/\.claude\/skills\/[^/]+$/.test(dir)) return { location: 'project', editable: true }
  if (dir.startsWith(join(HOME, 'Projects'))) return { location: 'project-source', editable: true }
  return { location: 'other', editable: true }
}

/**
 * What Claude Code has installed and enabled, read from the files it keeps
 * itself. Missing files degrade to "everything in the cache counts", which is
 * the older behaviour and the right fallback for a fixture.
 */
export function pluginState () {
  const installed = readJson(join(pluginsDir(), 'installed_plugins.json'))
  const enabled = {}
  for (const file of settingsFiles()) {
    const s = readJson(file)
    if (s.ok && s.value && s.value.enabledPlugins) Object.assign(enabled, s.value.enabledPlugins)
  }
  const installPaths = new Map() // realpath of install dir -> plugin@mp
  if (installed.ok && installed.value && installed.value.plugins) {
    for (const [key, entries] of Object.entries(installed.value.plugins)) {
      for (const e of Array.isArray(entries) ? entries : [entries]) {
        if (!e || !e.installPath) continue
        let real = e.installPath
        try { real = realpathSync(e.installPath) } catch { /* keep as given */ }
        installPaths.set(real, key)
      }
    }
  }
  return { hasRegistry: installed.ok, installPaths, enabled }
}

/**
 * Marketplaces whose source is a directory on this machine, plus any repo under
 * ~/Projects that carries a .claude-plugin/marketplace.json naming a known
 * marketplace. Both are places where the SOURCE of a cached plugin skill lives.
 */
function marketplaceSources () {
  const out = new Map() // marketplace name -> [source dirs]
  const known = readJson(join(pluginsDir(), 'known_marketplaces.json'))
  if (known.ok && known.value) {
    for (const [name, v] of Object.entries(known.value)) {
      const src = v && v.source
      if (src && src.source === 'directory' && src.path) push(out, name, safeReal(src.path))
    }
  }
  const projects = join(homeDir(), 'Projects')
  for (const rel of walkDirs(projects, 3)) {
    const mf = readJson(join(projects, rel, '.claude-plugin', 'marketplace.json'))
    if (mf.ok && mf.value && mf.value.name) push(out, String(mf.value.name), safeReal(join(projects, rel)))
  }
  return out
}

function push (map, k, v) { if (!v) return; const a = map.get(k) || []; if (!a.includes(v)) a.push(v); map.set(k, a) }
function safeReal (p) { try { return realpathSync(p) } catch { return null } }

/**
 * Discover every skill on disk. Each row carries `loaded` (true when Claude
 * Code lists it right now, from this working directory), `loadedReason` in
 * plain words, and, for loaded plugin-cache rows whose source repo is on this
 * machine, `sourcePath` pointing at the editable copy. Source copies that were
 * folded into a loaded row are dropped from the returned list and appear in
 * that row's `copies`.
 *
 * @param cwd  the working directory Claude Code would be started from
 */
export function discoverSkills ({ cwd = process.cwd() } = {}) {
  const HOME = homeDir()
  const state = pluginState()
  const sources = marketplaceSources()
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
      const loc = classifyLocation(real, dir)
      const existing = byReal.get(real)
      if (existing) {
        if (!existing.aliases.includes(dir)) existing.aliases.push(dir)
        if (!existing.names.includes(invocable)) existing.names.push(invocable)
        if (loc.location === 'user-symlink') existing.symlinks.push(dir)
        // a symlink under ~/.claude/skills makes any target loaded
        if (loc.location === 'user' || loc.location === 'user-symlink') {
          existing.loaded = true
          existing.loadedReason = 'linked from ~/.claude/skills'
          existing.location = loc.location
          existing.editable = true
        }
        continue
      }
      let modifiedOn = null
      try { modifiedOn = statSync(skillMd).mtime.toISOString().slice(0, 10) } catch { /* leave null */ }
      const load = loadedState(loc.location, real, dir, { cwd, state, HOME })
      byReal.set(real, {
        name: basename(dir),
        names: [invocable, basename(dir)].filter((v, i, a) => a.indexOf(v) === i),
        frontmatterName: name,
        realPath: real,
        skillMd: join(real, 'SKILL.md'),
        aliases: [dir],
        symlinks: loc.location === 'user-symlink' ? [dir] : [],
        plugin: plugin || null,
        marketplace: marketplaceOf(real),
        installKey: load.installKey,
        location: loc.location,
        editable: loc.editable,
        loaded: load.loaded,
        loadedReason: load.reason,
        sourcePath: null,
        copies: [],
        mode,
        gateDeclared: gate !== undefined,
        gateValue: gate === undefined ? null : String(gate),
        description,
        descriptionChars: description.length,
        modifiedOn,
      })
    }
  }
  return linkCopies([...byReal.values()], sources)
}

/** Which marketplace a cache or checkout path belongs to, or null. */
function marketplaceOf (real) {
  const m = real.match(/\/\.claude\/plugins\/(?:cache|marketplaces)\/([^/]+)\//)
  return m ? m[1] : null
}

function loadedState (location, real, dir, { cwd, state, HOME }) {
  if (location === 'user' || location === 'user-symlink') return { loaded: true, reason: 'in ~/.claude/skills', installKey: null }
  if (location === 'project') {
    // Claude Code reads .claude/skills from the working directory and its
    // parents, never its children, so the only question is whether cwd sits
    // at or below the project root. Each side is compared as given and as
    // resolved, so a home behind a symlink (macOS /var to /private/var) and a
    // cwd that does not exist yet both compare like any other path.
    const projectRoot = dir.replace(/\/\.claude\/skills\/[^/]+$/, '')
    const roots = [projectRoot, safeReal(projectRoot)].filter(Boolean)
    const cwds = [cwd, safeReal(cwd)].filter(Boolean)
    const inside = cwds.some((c) => roots.some((r) => c === r || c.startsWith(r + sep)))
    return inside
      ? { loaded: true, reason: 'project skill, and you are working in that project', installKey: null }
      : { loaded: false, reason: 'project skill; loads only when you work in ' + projectRoot.replace(HOME, '~'), installKey: null }
  }
  if (location === 'plugin-cache') {
    // .../cache/<mp>/<plugin>/<version>/(.claude/)?skills/<skill>
    const installDir = real.replace(/\/(?:\.claude\/)?skills\/[^/]+$/, '')
    const key = state.installPaths.get(installDir) || null
    if (!state.hasRegistry) return { loaded: state.enabled[guessKey(real)] !== false, reason: 'plugin in the cache', installKey: guessKey(real) }
    if (!key) return { loaded: false, reason: 'an older version left in the plugin cache; not the installed one', installKey: null }
    if (state.enabled[key] === false) return { loaded: false, reason: 'plugin ' + key + ' is installed but disabled', installKey: key }
    return { loaded: true, reason: 'enabled plugin ' + key, installKey: key }
  }
  if (location === 'marketplace') return { loaded: false, reason: 'marketplace checkout; the installed copy lives in the plugin cache', installKey: null }
  if (location === 'project-source') return { loaded: false, reason: 'source repo; not installed from here', installKey: null }
  return { loaded: false, reason: 'outside every folder Claude Code reads', installKey: null }
}

function guessKey (real) {
  const m = real.match(/\/plugins\/cache\/([^/]+)\/([^/]+)\//)
  return m ? m[2] + '@' + m[1] : null
}

/**
 * Fold source copies into the loaded row they are the source of, so a plugin
 * skill counts once and gains an editable path. Two rows are the same skill
 * when they share the skill directory name and either the same marketplace
 * (checkout versus cache) or a marketplace whose source directory contains
 * the copy (a repo under ~/Projects, or a directory-sourced marketplace).
 */
export function linkCopies (rows, sources = new Map()) {
  const loaded = rows.filter((r) => r.loaded)
  const keep = []
  for (const r of rows) {
    if (r.loaded) { keep.push(r); continue }
    let target = null
    if (r.location === 'marketplace' && r.marketplace) {
      target = loaded.find((l) => l.location === 'plugin-cache' && l.marketplace === r.marketplace && l.name === r.name)
    } else if (r.location === 'project-source' || r.location === 'project' || r.location === 'other') {
      for (const [mp, dirs] of sources) {
        if (!dirs.some((d) => r.realPath === d || r.realPath.startsWith(d + sep))) continue
        target = loaded.find((l) => l.location === 'plugin-cache' && l.marketplace === mp && l.name === r.name)
        if (target) break
      }
    }
    if (!target) { keep.push(r); continue }
    // A repo under ~/Projects is the place to edit; a marketplace checkout is
    // only the fallback source when no repo copy exists.
    const current = target.copies.find((c) => c.path === target.sourcePath)
    if (!target.sourcePath || (current && current.location === 'marketplace' && r.location !== 'marketplace')) target.sourcePath = r.realPath
    target.copies.push({ path: r.realPath, location: r.location, sameDescription: r.description === target.description })
  }
  return keep
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

